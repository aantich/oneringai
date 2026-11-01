/**
 * Robust JSON parser for LLM responses.
 *
 * LLMs frequently return malformed JSON: markdown fences, trailing commas,
 * escaped quotes inside strings, control characters, comments, single
 * quotes, unquoted keys, verbatim text containing embedded quotes.
 * This module attempts multiple repair strategies before giving up.
 *
 * Usage:
 *   import { parseJsonPermissive } from 'oneringai';
 *   const obj = parseJsonPermissive(llmResponseText);
 *
 * Strategies, tried in order:
 *   1. Direct JSON.parse (fast path)
 *   2. Extract JSON block from surrounding text (markdown fences, preamble)
 *   3. Conservative repair (trailing commas, comments, control chars, bad escapes, unescaped newlines)
 *   4. Aggressive repair (single quotes → double, unquoted keys)
 *   5. Field-strip fallback — null out fields most likely to carry verbatim
 *      text (see `ParseJsonPermissiveOptions.stripFieldsAsLastResort`)
 */

const DEFAULT_STRIP_FIELDS = [
  'details',
  'body',
  'quote',
  'sourceQuote',
  'excerpt',
  'narrative',
  'rawText',
];

export interface ParseJsonPermissiveOptions {
  /**
   * Field names that may contain verbatim text (quotes, newlines, unescaped
   * chars) which breaks JSON parsing. If all repair strategies fail, the
   * parser replaces each named field's value with `null` and retries.
   *
   * Defaults to `['details', 'body', 'quote', 'sourceQuote', 'excerpt',
   * 'narrative', 'rawText']` — the usual suspects across LLM schemas.
   *
   * Pass `[]` to disable the field-strip fallback entirely.
   */
  stripFieldsAsLastResort?: string[];
}

/**
 * Parse JSON from an LLM response with multiple repair strategies.
 *
 * @throws {@link JsonParseError} if all strategies fail.
 */
export function parseJsonPermissive(
  text: string,
  opts?: ParseJsonPermissiveOptions,
): unknown {
  if (!text || text.trim().length === 0) {
    throw new JsonParseError('Empty input', text);
  }

  // Strategy 1: Direct parse
  try {
    return JSON.parse(text);
  } catch {
    // continue
  }

  // Strategy 2: Extract JSON from surrounding text (markdown fences, preamble)
  const extracted = extractJsonBlock(text);
  if (extracted !== text) {
    try {
      return JSON.parse(extracted);
    } catch {
      // continue with extracted text for repair
    }
  }

  // Strategy 3: Conservative repair on the extracted text
  const target = extracted !== text ? extracted : text;
  const repaired = repairJson(target);
  try {
    return JSON.parse(repaired);
  } catch {
    // continue
  }

  // Strategy 4: Aggressive repair
  const aggressive = repairJsonAggressive(repaired);
  try {
    return JSON.parse(aggressive);
  } catch {
    // continue
  }

  // Strategy 5: Field-strip fallback. Verbatim text fields (email body, quote
  // excerpts, long narratives) are the #1 cause of residual parse failure
  // because LLMs mis-escape embedded quotes. Nulling these fields preserves
  // the rest of the payload rather than losing the whole response.
  const stripFields = opts?.stripFieldsAsLastResort ?? DEFAULT_STRIP_FIELDS;
  if (stripFields.length > 0) {
    const stripped = stripFields.reduce((acc, name) => stripFieldValue(acc, name), aggressive);
    if (stripped !== aggressive) {
      const strippedRepaired = repairJson(stripped);
      try {
        return JSON.parse(strippedRepaired);
      } catch (finalError: unknown) {
        const message = finalError instanceof Error ? finalError.message : String(finalError);
        throw new JsonParseError(
          `All JSON parse strategies failed (including field-strip of [${stripFields.join(', ')}]): ${message}`,
          text,
        );
      }
    }
  }

  throw new JsonParseError(
    'All JSON parse strategies failed: unable to parse LLM response as JSON',
    text,
  );
}

/**
 * Error thrown by {@link parseJsonPermissive} when every strategy fails.
 * Carries the first 500 chars of the raw input for debugging.
 */
export class JsonParseError extends Error {
  /** First 500 chars of the raw text that failed to parse. */
  public readonly rawSnippet: string;

  constructor(message: string, rawText: string) {
    const MAX_SNIPPET = 500;
    const snippet =
      rawText.length > MAX_SNIPPET
        ? `${rawText.slice(0, MAX_SNIPPET)}... (${rawText.length} chars total)`
        : rawText;
    super(`${message}\nRaw text: ${snippet}`);
    this.name = 'JsonParseError';
    this.rawSnippet = snippet;
  }
}

// ── Extraction ──

/**
 * Extract a JSON object or array from surrounding text.
 * Handles: markdown fences, leading/trailing prose, multiple objects (takes first).
 */
function extractJsonBlock(text: string): string {
  // Strip markdown code fences: ```json ... ``` or ``` ... ```
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (fenceMatch && fenceMatch[1] !== undefined) {
    return fenceMatch[1].trim();
  }

  // Find the outermost { ... } or [ ... ] using bracket matching
  const start = findFirstBracket(text);
  if (start === -1) return text;

  const open = text[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (ch === '\\' && inString) {
      escaped = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === open) depth++;
    if (ch === close) {
      depth--;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }

  // If bracket matching failed, fall back to greedy regex
  const greedyMatch = text.match(/\{[\s\S]*\}/);
  return greedyMatch ? greedyMatch[0] : text;
}

function findFirstBracket(text: string): number {
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{' || text[i] === '[') return i;
  }
  return -1;
}

// ── Repair (conservative) ──

/** Fix common LLM JSON issues that don't change semantics. */
function repairJson(text: string): string {
  let result = text;

  // Remove control characters (except \n, \r, \t which are valid in JSON strings)
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional removal of control chars from LLM output
  result = result.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');

  // Remove JS-style comments (// ... and /* ... */)
  result = removeComments(result);

  // Fix trailing commas before } or ]
  result = result.replace(/,\s*([\]}])/g, '$1');

  // Fix unescaped newlines inside string values
  result = fixNewlinesInStrings(result);

  // Fix bad escape sequences (e.g. \' which is invalid; stray \" delimiters)
  result = fixBadEscapes(result);

  return result;
}

// ── Repair (aggressive) ──

/** More aggressive repairs that may change semantics slightly. */
function repairJsonAggressive(text: string): string {
  let result = text;

  // Replace single-quoted strings with double-quoted
  result = replaceSingleQuotes(result);

  // Fix unquoted keys: { key: "value" } → { "key": "value" }
  result = result.replace(/([{,]\s*)([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:/g, '$1"$2":');

  // Fix trailing comma after last element (again, after other transforms)
  result = result.replace(/,\s*([\]}])/g, '$1');

  return result;
}

// ── Helpers ──

/** Remove JS-style comments from JSON text, respecting string boundaries. */
function removeComments(text: string): string {
  let result = '';
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (escaped) {
      result += ch;
      escaped = false;
      continue;
    }

    if (ch === '\\' && inString) {
      result += ch;
      escaped = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      result += ch;
      continue;
    }

    if (!inString) {
      // Line comment
      if (ch === '/' && text[i + 1] === '/') {
        const endOfLine = text.indexOf('\n', i);
        i = endOfLine === -1 ? text.length : endOfLine;
        continue;
      }
      // Block comment
      if (ch === '/' && text[i + 1] === '*') {
        const endBlock = text.indexOf('*/', i + 2);
        i = endBlock === -1 ? text.length : endBlock + 1;
        continue;
      }
    }

    result += ch;
  }

  return result;
}

/** Fix unescaped literal newlines inside JSON string values. Replaces with \\n. */
function fixNewlinesInStrings(text: string): string {
  const chars = [...text];
  const result: string[] = [];
  let inString = false;
  let escaped = false;

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i] ?? '';

    if (escaped) {
      result.push(ch);
      escaped = false;
      continue;
    }

    if (ch === '\\' && inString) {
      escaped = true;
      result.push(ch);
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      result.push(ch);
      continue;
    }

    if (inString && (ch === '\n' || ch === '\r')) {
      result.push('\\n');
      // Skip \r\n pair
      if (ch === '\r' && i + 1 < chars.length && chars[i + 1] === '\n') {
        i++;
      }
      continue;
    }

    result.push(ch);
  }

  return result.join('');
}

/**
 * Fix invalid escape sequences and escaped quotes used as string delimiters.
 *
 * Common LLM issues:
 *   - `\'` — never valid in JSON; replace with `'`.
 *   - `\"` used as a string delimiter (outside strings) — LLM confused
 *     itself; replace with plain `"`.
 */
function fixBadEscapes(text: string): string {
  // First pass: fix \' everywhere (never valid in JSON)
  const result = text.replace(/\\'/g, "'");

  // Second pass: fix \" that appear outside of strings (used as delimiters).
  const chars: string[] = [];
  let inString = false;
  let i = 0;

  while (i < result.length) {
    const ch = result[i] ?? '';
    const next = i + 1 < result.length ? (result[i + 1] ?? '') : '';

    if (inString) {
      if (ch === '\\' && next === '"') {
        // Inside a string, \" is a valid escape — keep it
        chars.push(ch, next);
        i += 2;
        continue;
      }
      if (ch === '\\' && next === '\\') {
        chars.push(ch, next);
        i += 2;
        continue;
      }
      if (ch === '"') {
        inString = false;
        chars.push(ch);
        i++;
        continue;
      }
      chars.push(ch);
      i++;
      continue;
    }

    // Outside a string
    if (ch === '"') {
      inString = true;
      chars.push(ch);
      i++;
      continue;
    }

    if (ch === '\\' && next === '"') {
      // \" outside a string — LLM used it as a string delimiter.
      // Replace with plain " and enter string mode.
      inString = true;
      chars.push('"');
      i += 2;
      continue;
    }

    chars.push(ch);
    i++;
  }

  return chars.join('');
}

/**
 * Replace single-quoted strings with double-quoted strings.
 * Heuristic: only outside existing double-quoted strings.
 */
function replaceSingleQuotes(text: string): string {
  const chars = [...text];
  const result: string[] = [];
  let inDouble = false;
  let inSingle = false;
  let escaped = false;

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i] ?? '';

    if (escaped) {
      result.push(ch);
      escaped = false;
      continue;
    }

    if (ch === '\\') {
      escaped = true;
      result.push(ch);
      continue;
    }

    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      result.push(ch);
      continue;
    }

    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      result.push('"'); // Replace ' with "
      continue;
    }

    // If inside a single-quoted string, escape any unescaped double quotes
    if (inSingle && ch === '"') {
      result.push('\\"');
      continue;
    }

    result.push(ch);
  }

  return result.join('');
}

/**
 * Strip the value of every `"<fieldName>": <value>` occurrence, replacing
 * the value with `null`. Handles string values (including LLM-escaped `\"`
 * delimiters) and non-string values (numbers, booleans, null).
 *
 * Nested objects/arrays are NOT traversed — we only strip one level of
 * match per scan, but the scan runs repeatedly (one call per fieldName
 * from the caller list). Nested structured values of a matching key are
 * left alone to avoid data loss beyond what's necessary.
 */
function stripFieldValue(text: string, fieldName: string): string {
  const key = `"${fieldName}"`;
  let result = text;
  let idx = result.indexOf(key);

  while (idx !== -1) {
    const colonIdx = result.indexOf(':', idx + key.length);
    if (colonIdx === -1) break;

    // Find where the value starts (skip whitespace)
    let valueStart = colonIdx + 1;
    while (valueStart < result.length && /\s/.test(result.charAt(valueStart))) {
      valueStart++;
    }

    const startCh = result.charAt(valueStart);
    // Skip structured values — only strip primitives to avoid accidental
    // loss of nested content (the fallback is for verbatim text, not
    // whole sub-objects).
    if (startCh === '{' || startCh === '[') {
      idx = result.indexOf(key, colonIdx + 1);
      continue;
    }

    let valueEnd = valueStart;
    let isStringValue = false;

    // Handle \" as string start (LLM escaped delimiter)
    if (startCh === '\\' && result.charAt(valueStart + 1) === '"') {
      valueEnd = valueStart + 2;
      isStringValue = true;
    } else if (startCh === '"') {
      valueEnd = valueStart + 1;
      isStringValue = true;
    }

    if (isStringValue) {
      // The whole reason we're here is that naive `"`-tracking already failed
      // (strategies 1–4). The string's internal quotes are mis-escaped, so a
      // state machine would stop at the first embedded `"`. Instead, find the
      // *structural* end of the value: a `"` that is followed (ignoring
      // whitespace) by `,`, `}`, or `]` — the tokens that can legally follow
      // a top-level value. Embedded mis-escaped quotes inside verbatim text
      // are never followed by a structural token, so they're skipped.
      valueEnd = findStructuralStringEnd(result, valueEnd);
    } else {
      // Non-string primitive (null, number, boolean) — scan to comma or closer
      while (valueEnd < result.length && !/[,}\]]/.test(result.charAt(valueEnd))) {
        valueEnd++;
      }
    }

    result = `${result.slice(0, colonIdx + 1)} null${result.slice(valueEnd)}`;
    // Advance past the replacement so we don't re-scan it
    idx = result.indexOf(key, colonIdx + 6);
  }

  return result;
}

/**
 * Find the end of a string value whose internal escapes may be broken.
 *
 * Invariant: a valid string value is terminated by a `"` that is
 * immediately followed (possibly after whitespace) by a structural token
 * — `,`, `}`, or `]`. Inside verbatim prose with mis-escaped quotes, the
 * internal `"` characters are followed by ordinary letters/spaces and
 * therefore skipped.
 *
 * Honours `\"` and `\\` escapes so that well-escaped content is still
 * walked without false termination.
 */
function findStructuralStringEnd(text: string, from: number): number {
  let i = from;
  while (i < text.length) {
    const ch = text.charAt(i);
    // Skip valid escapes — even if the LLM was inconsistent, respecting
    // well-formed escapes prevents us from terminating early on the first
    // properly-escaped \" inside a mostly-valid value.
    if (ch === '\\' && i + 1 < text.length) {
      const nextCh = text.charAt(i + 1);
      if (nextCh === '"' || nextCh === '\\') {
        i += 2;
        continue;
      }
    }

    if (ch === '"') {
      let j = i + 1;
      while (j < text.length && /\s/.test(text.charAt(j))) j++;
      if (j >= text.length) return i + 1;
      const after = text.charAt(j);
      if (after === ',' || after === '}' || after === ']') {
        return i + 1; // include the closing "
      }
    }

    i++;
  }
  return text.length;
}
