import { createHash } from 'node:crypto';
import type { EvidenceRecord, EvidenceReference, EvidenceScope } from '../../domain/interfaces/IEvidenceStorage.js';

/** Messages contain no source payloads, credentials, or backend exception text. */
export class EvidenceError extends Error {
  constructor(readonly code: 'invalid' | 'capacity' | 'corrupt' | 'busy' | 'storage') {
    super(`Evidence ${code}`);
    this.name = 'EvidenceError';
  }
}
export function integer(value: number, minimum = 1): number {
  if (!Number.isSafeInteger(value) || value < minimum) throw new EvidenceError('invalid');
  return value;
}
export function hash(value: string | Buffer): string { return createHash('sha256').update(value).digest('hex'); }
export function validateScope(scope: EvidenceScope): Readonly<EvidenceScope> {
  if (!scope || typeof scope.ownerId !== 'string' || !scope.ownerId || scope.ownerId.length > 512 || typeof scope.namespace !== 'string' || !scope.namespace || scope.namespace.length > 512
    || (scope.tenantId !== undefined && (typeof scope.tenantId !== 'string' || !scope.tenantId || scope.tenantId.length > 512))) throw new EvidenceError('invalid');
  return Object.freeze({ ownerId: scope.ownerId, namespace: scope.namespace, ...(scope.tenantId === undefined ? {} : { tenantId: scope.tenantId }) });
}
/** Strict JSON with an optional incremental UTF-8 byte/work budget. Never invokes getters or toJSON. */
export function json(value: unknown, maxBytes = Infinity): string {
  if (maxBytes !== Infinity) integer(maxBytes, 0);
  let remaining = maxBytes;
  let work = maxBytes === Infinity ? Infinity : Math.max(1024, Math.min(Number.MAX_SAFE_INTEGER, maxBytes * 8));
  const parts: string[] = [];
  const seen = new Set<object>();
  const visit = (count = 1): void => { work -= count; if (work < 0) throw new EvidenceError('capacity'); };
  const append = (text: string): void => {
    const bytes = Buffer.byteLength(text);
    if (bytes > remaining) throw new EvidenceError('capacity');
    remaining -= bytes;
    parts.push(text);
  };
  const string = (text: string): void => {
    // Encoded JSON is at least this large. Reject huge strings before allocating an escaped copy.
    if (text.length + 2 > remaining) throw new EvidenceError('capacity');
    append('"');
    for (let offset = 0; offset < text.length;) {
      let end = Math.min(offset + 4096, text.length);
      if (end < text.length && text.charCodeAt(end - 1) >= 0xd800 && text.charCodeAt(end - 1) <= 0xdbff
        && text.charCodeAt(end) >= 0xdc00 && text.charCodeAt(end) <= 0xdfff) end--;
      append(JSON.stringify(text.slice(offset, end)).slice(1, -1));
      offset = end;
    }
    append('"');
  };
  const encode = (v: unknown, depth: number): void => {
    visit();
    if (depth > 100) throw new EvidenceError('invalid');
    if (typeof v === 'string') { string(v); return; }
    if (v === null || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) { append(JSON.stringify(v)); return; }
    if (typeof v !== 'object' || !v || seen.has(v)) throw new EvidenceError('invalid');
    if (!Array.isArray(v) && Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null) throw new EvidenceError('invalid');
    if (Object.getOwnPropertySymbols(v).length) throw new EvidenceError('invalid');
    // Enumerate names once, then fetch descriptors only as needed; do not materialize every value/descriptor.
    const names = Object.getOwnPropertyNames(v);
    visit(names.length);
    if (names.includes('toJSON')) throw new EvidenceError('invalid');
    seen.add(v);
    if (Array.isArray(v)) {
      const length = v.length;
      if (names.some(key => key !== 'length' && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= length))) throw new EvidenceError('invalid');
      append('[');
      for (let i = 0; i < length; i++) {
        const descriptor = Object.getOwnPropertyDescriptor(v, String(i));
        if (!descriptor || !('value' in descriptor)) throw new EvidenceError('invalid');
        if (i) append(',');
        encode(descriptor.value, depth + 1);
      }
      append(']');
    } else {
      append('{');
      let first = true;
      for (const key of names) {
        const descriptor = Object.getOwnPropertyDescriptor(v, key);
        if (!descriptor) throw new EvidenceError('invalid');
        if (!descriptor.enumerable) continue;
        if (!('value' in descriptor)) throw new EvidenceError('invalid');
        if (!first) append(',');
        first = false;
        string(key); append(':'); encode(descriptor.value, depth + 1);
      }
      append('}');
    }
    seen.delete(v);
  };
  encode(value, 0);
  return parts.join('');
}
export function validateRecord(r: EvidenceRecord): void {
  if (!r || r.version !== 1 || !Number.isFinite(r.recordedAt) || !r.source
    || typeof r.source.toolName !== 'string' || !r.source.toolName || typeof r.source.executionId !== 'string' || !r.source.executionId
    || !['read', 'write', 'unknown'].includes(r.source.effect)
    || !['succeeded', 'failed', 'denied', 'cancelled', 'timed_out'].includes(r.source.status)
    || !['settled', 'unknown', 'not_started'].includes(r.source.completion)
    || !Number.isFinite(r.source.startedAt) || !Number.isFinite(r.source.durationMs)
    || !Object.hasOwn(r.source, 'arguments') || !r.source.principal || typeof r.source.principal !== 'object' || Array.isArray(r.source.principal) ||
    Object.values(r.source.principal).some(v => typeof v !== 'string') || (r.expiresAt !== undefined && !Number.isFinite(r.expiresAt))) throw new EvidenceError('invalid');
}
export function validateEvidenceId(id: string): void {
  if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) throw new EvidenceError('invalid');
}
export function validateReference(r: EvidenceReference): void {
  if (!r || r.version !== 1 || typeof r.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(r.sha256) || !['process', 'restart', 'fsync'].includes(r.durability)) throw new EvidenceError('invalid');
  validateEvidenceId(r.id);
  integer(r.bytes);
}

/** Contain asynchronous rejection from a host callback whose contract is synchronous/observational. */
export function containAsyncRejection(value: unknown): void {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) return;
  try {
    // Use the intrinsic for native/cross-realm promises without reading user accessors.
    void Promise.prototype.then.call(value, undefined, () => undefined);
    return;
  } catch { /* Not a native promise. Inspect ordinary thenables without invoking getters. */ }
  let current: object | null = value;
  for (let depth = 0; current && depth < 16; depth++, current = Object.getPrototypeOf(current)) {
    const descriptor = Object.getOwnPropertyDescriptor(current, 'then');
    if (!descriptor) continue;
    if ('value' in descriptor && typeof descriptor.value === 'function') void Promise.resolve(value).catch(() => undefined);
    return;
  }
}
