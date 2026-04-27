/**
 * parseExtractionWithStatus — whyActionable extraction (v5 addition).
 *
 * Existing fields are guarded by parseExtraction.test.ts; this file only
 * covers the v5 additive surface so that the original tests stay focused.
 */

import { describe, it, expect } from 'vitest';
import { parseExtractionWithStatus } from '@/memory/integration/parseExtraction.js';

describe('parseExtractionWithStatus — whyActionable', () => {
  it('passes whyActionable through when present and non-empty', () => {
    const raw = JSON.stringify({
      mentions: { m1: { surface: 'Alice', type: 'person' } },
      facts: [{ subject: 'm1', predicate: 'works_at', object: 'm2' }],
      whyActionable: 'Alice committed to ship the launch by EOQ.',
    });
    const r = parseExtractionWithStatus(raw);
    expect(r.status).toBe('ok');
    expect(r.whyActionable).toBe('Alice committed to ship the launch by EOQ.');
  });

  it('trims surrounding whitespace', () => {
    const raw = JSON.stringify({
      mentions: {},
      facts: [],
      whyActionable: '   spacey reason   ',
    });
    const r = parseExtractionWithStatus(raw);
    expect(r.whyActionable).toBe('spacey reason');
  });

  it('omits whyActionable when absent', () => {
    const raw = '{"mentions":{},"facts":[]}';
    const r = parseExtractionWithStatus(raw);
    expect(r.status).toBe('ok');
    expect(r.whyActionable).toBeUndefined();
  });

  it('omits whyActionable when empty/whitespace string', () => {
    const raw = JSON.stringify({ mentions: {}, facts: [], whyActionable: '   ' });
    const r = parseExtractionWithStatus(raw);
    expect(r.whyActionable).toBeUndefined();
  });

  it('omits whyActionable when wrong type', () => {
    const raw = JSON.stringify({ mentions: {}, facts: [], whyActionable: 42 });
    const r = parseExtractionWithStatus(raw);
    expect(r.whyActionable).toBeUndefined();
  });

  it('captures whyActionable even on shape_error so caller can preserve it', () => {
    // facts is not an array → shape_error, but whyActionable should still come through
    const raw = JSON.stringify({
      mentions: {},
      facts: 'not an array',
      whyActionable: 'kept anyway',
    });
    const r = parseExtractionWithStatus(raw);
    expect(r.status).toBe('shape_error');
    expect(r.whyActionable).toBe('kept anyway');
  });
});
