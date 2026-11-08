import { createHash, createHmac, randomKey, sealGCM, openGCM, encodeUTF8, decodeUTF8, encodeBase64, decodeBase64 } from '../../infrastructure/runtime/primitives.js';
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
  const key = randomKey(32);
  const digest = (scope: unknown): string => createHash('sha256').update(canonical(scope)).digest('hex');
  return {
    encode(scope, position, coverage) {
      const scopeHash = digest(scope), plaintext = encodeUTF8(canonical({ version: 1, scopeHash, position, coverage }));
      if (plaintext.length > CURSOR_MAX_BYTES) return invalid();
      const iv = randomKey(12);
      const { ciphertext, tag } = sealGCM(key, iv, encodeUTF8('oneringai-collections-v1'), plaintext);
      const envelope = new Uint8Array(iv.length + tag.length + ciphertext.length);
      envelope.set(iv); envelope.set(tag, iv.length); envelope.set(ciphertext, iv.length + tag.length);
      const continuation = 'c1.' + encodeBase64(envelope, true);
      if (continuation.length > CURSOR_MAX_BYTES) return invalid();
      const positionId = createHmac('sha256', key).update(canonical({ scopeHash, position })).digest('base64url');
      return { continuation, positionId };
    },
    decode(token, scope) {
      try {
        if (typeof token !== 'string' || token.length > CURSOR_MAX_BYTES || !/^c1\.[A-Za-z0-9_-]+$/.test(token)) return invalid();
        const data = decodeBase64(token.slice(3));
        if (data.length < 29 || encodeBase64(data, true) !== token.slice(3)) return invalid();
        const plain = openGCM(key, data.subarray(0, 12), encodeUTF8('oneringai-collections-v1'), data.subarray(28), data.subarray(12, 28));
        const value = JSON.parse(decodeUTF8(plain)) as Record<string, unknown>;
        if (value.version !== 1 || value.scopeHash !== digest(scope) || !['complete', 'incomplete', 'unknown'].includes(String(value.coverage)) || !Object.hasOwn(value, 'position')) return invalid();
        return { position: value.position, coverage: value.coverage as Coverage };
      } catch { return invalid(); }
    },
  };
}
