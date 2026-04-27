/**
 * diffEntityMetadata — pure utility unit tests.
 */

import { describe, it, expect } from 'vitest';
import { diffEntityMetadata } from '@/memory/metadataDiff.js';

describe('diffEntityMetadata', () => {
  it('returns empty when nothing changed', () => {
    const out = diffEntityMetadata(
      { startTime: '2026-05-01', status: 'confirmed' },
      { startTime: '2026-05-01', status: 'confirmed' },
      ['startTime', 'status'],
    );
    expect(out).toEqual([]);
  });

  it('detects changed values', () => {
    const out = diffEntityMetadata(
      { status: 'confirmed' },
      { status: 'cancelled' },
      ['status'],
    );
    expect(out).toEqual([
      { key: 'status', before: 'confirmed', after: 'cancelled', kind: 'changed' },
    ]);
  });

  it('detects added keys', () => {
    const out = diffEntityMetadata({}, { status: 'cancelled' }, ['status']);
    expect(out).toEqual([
      { key: 'status', before: undefined, after: 'cancelled', kind: 'added' },
    ]);
  });

  it('detects removed keys', () => {
    const out = diffEntityMetadata({ status: 'confirmed' }, {}, ['status']);
    expect(out).toEqual([
      { key: 'status', before: 'confirmed', after: undefined, kind: 'removed' },
    ]);
  });

  it('handles undefined prev / next', () => {
    expect(diffEntityMetadata(undefined, { x: 1 }, ['x'])).toEqual([
      { key: 'x', before: undefined, after: 1, kind: 'added' },
    ]);
    expect(diffEntityMetadata({ x: 1 }, undefined, ['x'])).toEqual([
      { key: 'x', before: 1, after: undefined, kind: 'removed' },
    ]);
    expect(diffEntityMetadata(undefined, undefined, ['x'])).toEqual([]);
  });

  it('only reports watched keys', () => {
    const out = diffEntityMetadata(
      { a: 1, b: 2, c: 3 },
      { a: 9, b: 9, c: 9 },
      ['a'],
    );
    expect(out).toEqual([{ key: 'a', before: 1, after: 9, kind: 'changed' }]);
  });

  it('preserves watchedKeys order in output', () => {
    const out = diffEntityMetadata(
      { z: 1, a: 1, m: 1 },
      { z: 2, a: 2, m: 2 },
      ['m', 'z', 'a'],
    );
    expect(out.map((c) => c.key)).toEqual(['m', 'z', 'a']);
  });

  it('deep-compares arrays', () => {
    expect(
      diffEntityMetadata({ ids: ['a', 'b'] }, { ids: ['a', 'b'] }, ['ids']),
    ).toEqual([]);
    expect(
      diffEntityMetadata({ ids: ['a', 'b'] }, { ids: ['a', 'c'] }, ['ids']),
    ).toEqual([{ key: 'ids', before: ['a', 'b'], after: ['a', 'c'], kind: 'changed' }]);
  });

  it('deep-compares nested objects', () => {
    expect(
      diffEntityMetadata(
        { extra: { x: 1, y: { z: 2 } } },
        { extra: { x: 1, y: { z: 2 } } },
        ['extra'],
      ),
    ).toEqual([]);
    expect(
      diffEntityMetadata(
        { extra: { x: 1, y: { z: 2 } } },
        { extra: { x: 1, y: { z: 3 } } },
        ['extra'],
      ),
    ).toHaveLength(1);
  });

  it('compares Dates by timestamp not reference', () => {
    const a = new Date('2026-05-01T10:00Z');
    const b = new Date('2026-05-01T10:00Z');
    expect(diffEntityMetadata({ t: a }, { t: b }, ['t'])).toEqual([]);
    const later = new Date('2026-05-02T10:00Z');
    expect(diffEntityMetadata({ t: a }, { t: later }, ['t'])).toHaveLength(1);
  });

  it('treats null as a value (not absent)', () => {
    expect(diffEntityMetadata({ x: null }, { x: null }, ['x'])).toEqual([]);
    expect(diffEntityMetadata({ x: null }, { x: 'set' }, ['x'])).toEqual([
      { key: 'x', before: null, after: 'set', kind: 'changed' },
    ]);
  });
});
