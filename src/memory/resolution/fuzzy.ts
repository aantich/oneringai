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
