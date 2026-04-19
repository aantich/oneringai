/**
 * Surface-form normalization used by EntityResolver to perform case-,
 * punctuation-, and corporate-suffix-insensitive exact matching.
 *
 * Levenshtein-based typo-tolerant matching was removed in v1 — see the
 * EntityResolver header for the rationale and future plan.
 */

const CORP_SUFFIXES_RE =
  /\b(inc\.?|incorporated|corp\.?|corporation|llc|ltd\.?|limited|co\.?|company|gmbh|s\.?a\.?|plc)\b/gi;
const WHITESPACE_RE = /\s+/g;
const NON_ALPHANUM_RE = /[^\p{L}\p{N}\s]/gu;

/**
 * Normalize a surface form for comparison:
 *   - lowercase
 *   - strip non-alphanumeric except whitespace (apostrophes, commas, dashes, etc.)
 *   - strip common corporate suffixes (Inc, Corp, LLC, etc.)
 *   - collapse whitespace
 *   - trim
 */
export function normalizeSurface(s: string): string {
  return s
    .toLowerCase()
    .replace(NON_ALPHANUM_RE, ' ')
    .replace(CORP_SUFFIXES_RE, ' ')
    .replace(WHITESPACE_RE, ' ')
    .trim();
}

/**
 * Classic two-row Levenshtein — O(len_a * len_b) time, O(min(len_a, len_b))
 * space. Used by the predicate-drift mapper (H5) to snap near-miss LLM output
 * like `"work_at"` onto the canonical `"works_at"`. Inputs should already be
 * normalised (snake_case) for a meaningful comparison.
 */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  if (Math.abs(a.length - b.length) > Math.max(a.length, b.length)) {
    return Math.max(a.length, b.length);
  }
  // Keep shorter string as `b` to minimise memory.
  const [x, y] = a.length < b.length ? [b, a] : [a, b];
  const prev = new Array<number>(y.length + 1);
  const curr = new Array<number>(y.length + 1);
  for (let j = 0; j <= y.length; j++) prev[j] = j;
  for (let i = 1; i <= x.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= y.length; j++) {
      const cost = x.charCodeAt(i - 1) === y.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1]! + 1,
        prev[j]! + 1,
        prev[j - 1]! + cost,
      );
    }
    for (let j = 0; j <= y.length; j++) prev[j] = curr[j]!;
  }
  return prev[y.length]!;
}
