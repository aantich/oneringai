/**
 * Tests for surface-form normalization used by EntityResolver's exact-match tiers.
 * (Levenshtein-based fuzzy matching was removed in v1 — see EntityResolver header.)
 */

import { describe, it, expect } from 'vitest';
import { normalizeSurface } from '@/memory/resolution/fuzzy.js';

describe('normalizeSurface', () => {
  it('lowercases + trims', () => {
    expect(normalizeSurface('  Hello World  ')).toBe('hello world');
  });

  it('strips corporate suffixes', () => {
    expect(normalizeSurface('Microsoft Inc.')).toBe('microsoft');
    expect(normalizeSurface('Acme Corp')).toBe('acme');
    expect(normalizeSurface('Widget LLC')).toBe('widget');
    expect(normalizeSurface('Widget Limited')).toBe('widget');
  });

  it('strips non-alphanumeric punctuation', () => {
    expect(normalizeSurface("John's Coffee")).toBe('john s coffee');
    expect(normalizeSurface('A, B & C')).toBe('a b c');
  });

  it('collapses multiple spaces', () => {
    expect(normalizeSurface('hello   world')).toBe('hello world');
  });

  it('empty → empty', () => {
    expect(normalizeSurface('')).toBe('');
  });
});
