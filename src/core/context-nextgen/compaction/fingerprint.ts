import { createHash } from 'node:crypto';

/** JSON object ordering is not state: JSONB and other faithful stores may reorder keys. */
export function nativeJSON(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
    return Object.fromEntries(Object.keys(item).sort().map(key => [key, (item as Record<string, unknown>)[key]]));
  });
}

/** Internal persisted-native digest; legacy transient request fingerprints stay unchanged. */
export function nativeFingerprint(value: unknown): string {
  return createHash('sha256').update(nativeJSON(value)).digest('hex');
}
