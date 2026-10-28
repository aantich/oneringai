import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';
import { InvalidConfigError } from '../../domain/errors/AIErrors.js';
import type { Coverage } from '../../tools/connector/pages/types.js';

export interface CursorCodec {
  encode(scope: unknown, position: unknown, coverage: Coverage): { continuation: string; positionId: string };
  decode(token: string, scope: unknown): { position: unknown; coverage: Coverage };
}
export const CURSOR_MAX_BYTES = 65_536;
export function canonical(value: unknown): string {
  const visit = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(visit);
    if (item && typeof item === 'object') return Object.fromEntries(Object.entries(item).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, visit(v)]));
    return item;
  };
  return JSON.stringify(visit(value));
}
const invalid = (): never => { throw new InvalidConfigError('Invalid or expired collection continuation; retain the observed page and restart deliberately'); };
/** One ephemeral key; no tail cache, timestamp, storage or application authority. */
export function createCursorCodec(): CursorCodec {
  const key = randomBytes(32);
  const digest = (scope: unknown): string => createHash('sha256').update(canonical(scope)).digest('hex');
  return {
    encode(scope, position, coverage) {
      const scopeHash = digest(scope), plaintext = Buffer.from(canonical({ version: 1, scopeHash, position, coverage }));
      if (plaintext.length > CURSOR_MAX_BYTES) return invalid();
      const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(Buffer.from('oneringai-collections-v1'));
      const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      const continuation = 'c1.' + Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
      if (continuation.length > CURSOR_MAX_BYTES) return invalid();
      const positionId = createHmac('sha256', key).update(canonical({ scopeHash, position })).digest('base64url');
      return { continuation, positionId };
    },
    decode(token, scope) {
      try {
        if (typeof token !== 'string' || token.length > CURSOR_MAX_BYTES || !/^c1\.[A-Za-z0-9_-]+$/.test(token)) return invalid();
        const data = Buffer.from(token.slice(3), 'base64url');
        if (data.length < 29 || data.toString('base64url') !== token.slice(3)) return invalid();
        const decipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12));
        decipher.setAAD(Buffer.from('oneringai-collections-v1')); decipher.setAuthTag(data.subarray(12, 28));
        const value = JSON.parse(Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8')) as Record<string, unknown>;
        if (value.version !== 1 || value.scopeHash !== digest(scope) || !['complete', 'incomplete', 'unknown'].includes(String(value.coverage)) || !Object.hasOwn(value, 'position')) return invalid();
        return { position: value.position, coverage: value.coverage as Coverage };
      } catch { return invalid(); }
    },
  };
}
