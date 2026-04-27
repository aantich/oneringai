/**
 * Pure helper used by callers (e.g. v25 calendar pipeline) to detect when
 * specific top-level metadata keys have changed between successive snapshots
 * of an entity. Lets the caller emit predicate facts (`cancelled`,
 * `rescheduled`) without re-implementing diff logic per call site.
 *
 * Intentionally minimal: only top-level keys, deep equality on values, no
 * smart shape-aware comparison. Callers are expected to pass canonical values
 * (Dates, primitives, plain JSON) — the helper does not normalise.
 */

export interface MetadataChange {
  key: string;
  before: unknown;
  after: unknown;
  /** `'added'` (key absent before), `'removed'` (key absent now), `'changed'` (different value). */
  kind: 'added' | 'removed' | 'changed';
}

/**
 * Compare `prev` and `next` over `watchedKeys`, returning a change record per
 * key that differs. Equal keys (deep-equal) are omitted. Order of the input
 * `watchedKeys` is preserved in the output.
 *
 * `prev` and `next` can be undefined — treated as empty objects.
 */
export function diffEntityMetadata(
  prev: Record<string, unknown> | undefined,
  next: Record<string, unknown> | undefined,
  watchedKeys: readonly string[],
): MetadataChange[] {
  const before = prev ?? {};
  const after = next ?? {};
  const out: MetadataChange[] = [];
  for (const key of watchedKeys) {
    const hadBefore = key in before;
    const hasNow = key in after;
    if (!hadBefore && !hasNow) continue;
    if (hadBefore && !hasNow) {
      out.push({ key, before: before[key], after: undefined, kind: 'removed' });
      continue;
    }
    if (!hadBefore && hasNow) {
      out.push({ key, before: undefined, after: after[key], kind: 'added' });
      continue;
    }
    if (!metadataDeepEqual(before[key], after[key])) {
      out.push({ key, before: before[key], after: after[key], kind: 'changed' });
    }
  }
  return out;
}

/**
 * Deep equality used by `diffEntityMetadata` and the metadata-merge path on
 * `MemorySystem.upsertEntity`. Handles primitives, plain objects, arrays, and
 * Dates (compared by timestamp). Cycles are not supported — entity metadata is
 * expected to be JSON-shaped.
 */
export function metadataDeepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return false;
  if (a instanceof Date || b instanceof Date) {
    if (!(a instanceof Date) || !(b instanceof Date)) return false;
    return a.getTime() === b.getTime();
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!metadataDeepEqual(a[i], b[i])) return false;
    return true;
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const ak = Object.keys(ao);
  const bk = Object.keys(bo);
  if (ak.length !== bk.length) return false;
  for (const k of ak) if (!metadataDeepEqual(ao[k], bo[k])) return false;
  return true;
}
