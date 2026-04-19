/**
 * Pure parser for LLM extraction output → `ExtractionOutput`.
 *
 * Lives outside `ConnectorExtractor` so callers (e.g. `SessionIngestorPluginNextGen`)
 * can parse without importing `Agent` (which would introduce an
 * Agent ↔ plugins cycle at module-load time).
 *
 * Two entry points:
 *
 *   - `parseExtractionWithStatus(raw)` returns a rich
 *     `{ status, mentions, facts, reason?, rawExcerpt? }` result so callers
 *     can distinguish "LLM said nothing useful" (status=ok, empty) from
 *     "parser couldn't make sense of the output" (status=parse_error /
 *     shape_error). This is the preferred form inside the library — every
 *     internal call site logs a structured warn on non-ok so transient LLM
 *     hiccups are observable rather than silent.
 *
 *   - `parseExtractionResponse(raw)` is the tolerant back-compat wrapper that
 *     returns only `ExtractionOutput`. Kept for public-API stability; new
 *     callers should prefer the rich form.
 */

import type { ExtractionOutput } from './ExtractionResolver.js';

/** Outcome of a parse attempt. `ok` is the only shape callers can trust the
 *  mentions/facts fields on (though they may still be empty). */
export type ParseStatus = 'ok' | 'parse_error' | 'shape_error';

/** Rich parse result. `rawExcerpt` is the first ~500 chars of the raw input
 *  — useful for logs without bloating them. */
export interface ParseExtractionResult {
  status: ParseStatus;
  mentions: ExtractionOutput['mentions'];
  facts: ExtractionOutput['facts'];
  /** Short human-readable reason when status !== 'ok'. */
  reason?: string;
  /** Truncated sample of the raw input for logging. */
  rawExcerpt?: string;
}

const RAW_EXCERPT_MAX = 500;

/**
 * Rich parser. Never throws — failures surface as non-ok status.
 *
 * - `status: 'parse_error'` — input didn't contain any valid JSON object.
 * - `status: 'shape_error'` — JSON parsed, but `mentions` was not an object
 *   (e.g. LLM emitted an array) or `facts` was not an array. Whichever
 *   fields *did* match the expected shape are still returned; the other is
 *   filled with the empty default so the caller can partial-commit if it
 *   wants to.
 * - `status: 'ok'` — parse succeeded; `mentions` + `facts` may still be
 *   empty if the LLM genuinely had nothing to extract.
 */
export function parseExtractionWithStatus(raw: string): ParseExtractionResult {
  const rawExcerpt = raw.length > RAW_EXCERPT_MAX ? raw.slice(0, RAW_EXCERPT_MAX) + '…' : raw;
  const cleaned = stripCodeFences(raw).trim();

  if (cleaned.length === 0) {
    // Explicitly treat empty output as parse_error — an empty string is not
    // a valid "nothing to extract" signal (that would be `{"mentions":{},"facts":[]}`).
    return {
      status: 'parse_error',
      mentions: {},
      facts: [],
      reason: 'LLM returned empty output',
      rawExcerpt,
    };
  }

  const parsed = safeJsonParse(cleaned);
  if (!parsed || typeof parsed !== 'object') {
    return {
      status: 'parse_error',
      mentions: {},
      facts: [],
      reason: 'could not parse JSON from LLM output',
      rawExcerpt,
    };
  }

  const obj = parsed as Record<string, unknown>;
  const mentionsOk =
    obj.mentions !== undefined &&
    typeof obj.mentions === 'object' &&
    obj.mentions !== null &&
    !Array.isArray(obj.mentions);
  const factsOk = obj.facts === undefined || Array.isArray(obj.facts);

  const mentions = mentionsOk ? (obj.mentions as ExtractionOutput['mentions']) : {};
  const facts = factsOk && Array.isArray(obj.facts) ? (obj.facts as ExtractionOutput['facts']) : [];

  if (!mentionsOk || !factsOk) {
    const shapeIssues: string[] = [];
    if (!mentionsOk) shapeIssues.push('mentions is not an object');
    if (!factsOk) shapeIssues.push('facts is not an array');
    return {
      status: 'shape_error',
      mentions,
      facts,
      reason: shapeIssues.join('; '),
      rawExcerpt,
    };
  }

  return { status: 'ok', mentions, facts };
}

/**
 * Resilient to code fences + leading/trailing prose. Returns an empty shape
 * rather than throwing so ingest pipelines can continue.
 *
 * **Prefer `parseExtractionWithStatus` for new code** — this wrapper cannot
 * distinguish "no extractable content" from "parse failure".
 */
export function parseExtractionResponse(raw: string): ExtractionOutput {
  const { mentions, facts } = parseExtractionWithStatus(raw);
  return { mentions, facts };
}

function safeJsonParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    const first = s.indexOf('{');
    const last = s.lastIndexOf('}');
    if (first >= 0 && last > first) {
      try {
        return JSON.parse(s.slice(first, last + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function stripCodeFences(s: string): string {
  return s.replace(/^\s*```(?:json)?\s*/, '').replace(/\s*```\s*$/, '');
}
