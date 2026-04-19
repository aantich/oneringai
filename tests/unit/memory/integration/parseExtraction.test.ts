/**
 * parseExtractionWithStatus — rich parser for LLM extraction output.
 *
 * C3: no silent returns on parse failure. Every non-ok status is actionable
 * (has reason + rawExcerpt) so callers can log/retry.
 */

import { describe, it, expect } from 'vitest';
import {
  parseExtractionWithStatus,
  parseExtractionResponse,
} from '@/memory/integration/parseExtraction.js';

describe('parseExtractionWithStatus', () => {
  it('returns ok + populated fields on valid JSON', () => {
    const raw = JSON.stringify({
      mentions: { m1: { surface: 'Alice', type: 'person' } },
      facts: [{ subject: 'm1', predicate: 'works_at', object: 'm2' }],
    });
    const r = parseExtractionWithStatus(raw);
    expect(r.status).toBe('ok');
    expect(r.mentions).toEqual({ m1: { surface: 'Alice', type: 'person' } });
    expect(r.facts).toHaveLength(1);
    expect(r.reason).toBeUndefined();
  });

  it('returns ok with empty fields when LLM correctly emits empty shape', () => {
    const r = parseExtractionWithStatus('{"mentions":{},"facts":[]}');
    expect(r.status).toBe('ok');
    expect(r.mentions).toEqual({});
    expect(r.facts).toEqual([]);
  });

  it('strips code fences', () => {
    const raw = '```json\n{"mentions":{},"facts":[]}\n```';
    expect(parseExtractionWithStatus(raw).status).toBe('ok');
  });

  it('recovers JSON from prose wrapping', () => {
    const raw = 'Here is the result: {"mentions":{"m1":{"surface":"X","type":"topic"}},"facts":[]} done.';
    const r = parseExtractionWithStatus(raw);
    expect(r.status).toBe('ok');
    expect(r.mentions.m1!.surface).toBe('X');
  });

  it('returns parse_error on empty input', () => {
    const r = parseExtractionWithStatus('');
    expect(r.status).toBe('parse_error');
    expect(r.reason).toMatch(/empty/);
    expect(r.rawExcerpt).toBe('');
  });

  it('returns parse_error on truncated JSON that cannot be recovered', () => {
    const r = parseExtractionWithStatus('not even close to json');
    expect(r.status).toBe('parse_error');
    expect(r.reason).toMatch(/could not parse/);
    expect(r.rawExcerpt).toBe('not even close to json');
  });

  it('returns shape_error when mentions is an array (LLM mistake)', () => {
    const raw = JSON.stringify({
      mentions: [{ surface: 'Alice' }], // array, not object
      facts: [],
    });
    const r = parseExtractionWithStatus(raw);
    expect(r.status).toBe('shape_error');
    expect(r.reason).toMatch(/mentions is not an object/);
    expect(r.mentions).toEqual({}); // fallback default
    expect(r.facts).toEqual([]);
  });

  it('returns shape_error when facts is a string (LLM mistake)', () => {
    const raw = JSON.stringify({ mentions: {}, facts: 'whoops' });
    const r = parseExtractionWithStatus(raw);
    expect(r.status).toBe('shape_error');
    expect(r.reason).toMatch(/facts is not an array/);
    expect(r.mentions).toEqual({});
    expect(r.facts).toEqual([]);
  });

  it('returns shape_error with partial mentions when facts is wrong but mentions is OK', () => {
    const raw = JSON.stringify({
      mentions: { m1: { surface: 'Alice', type: 'person' } },
      facts: null,
    });
    const r = parseExtractionWithStatus(raw);
    expect(r.status).toBe('shape_error');
    expect(r.mentions.m1!.surface).toBe('Alice');
    expect(r.facts).toEqual([]);
  });

  it('truncates rawExcerpt in log output for large payloads', () => {
    const huge = 'x'.repeat(2000);
    const r = parseExtractionWithStatus(huge);
    expect(r.rawExcerpt!.length).toBeLessThanOrEqual(501);
    expect(r.rawExcerpt!.endsWith('…')).toBe(true);
  });
});

describe('parseExtractionResponse (back-compat)', () => {
  it('returns {mentions,facts} without status for back-compat callers', () => {
    const r = parseExtractionResponse('{"mentions":{},"facts":[]}');
    expect(r).toEqual({ mentions: {}, facts: [] });
    expect((r as { status?: string }).status).toBeUndefined();
  });

  it('returns empty shape on parse failure (tolerant behaviour preserved)', () => {
    const r = parseExtractionResponse('garbage');
    expect(r).toEqual({ mentions: {}, facts: [] });
  });
});
