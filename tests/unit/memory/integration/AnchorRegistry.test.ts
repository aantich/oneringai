/**
 * AnchorRegistry — interface contract via StaticAnchorRegistry.
 */

import { describe, it, expect } from 'vitest';
import {
  StaticAnchorRegistry,
  type Anchor,
} from '@/memory/integration/AnchorRegistry.js';

const ANCHORS: Anchor[] = [
  { id: 'p1', label: 'Ship Q2 launch', kind: 'priority', metadata: { horizon: 'quarter' } },
  { id: 'p2', label: 'Hire VP Eng', kind: 'priority' },
];

describe('StaticAnchorRegistry', () => {
  it('returns the configured anchors regardless of userId', async () => {
    const reg = new StaticAnchorRegistry(ANCHORS);
    expect(await reg.getAnchorsForUser('u1')).toEqual(ANCHORS);
    expect(await reg.getAnchorsForUser('u2')).toEqual(ANCHORS);
  });

  it('does not alias the underlying list', async () => {
    const reg = new StaticAnchorRegistry(ANCHORS);
    const got = await reg.getAnchorsForUser('u1');
    got.pop();
    const again = await reg.getAnchorsForUser('u1');
    expect(again).toHaveLength(ANCHORS.length);
  });

  it('validateBinding accepts known ids', async () => {
    const reg = new StaticAnchorRegistry(ANCHORS);
    expect(await reg.validateBinding('u1', 'p1')).toBe(true);
    expect(await reg.validateBinding('u1', 'p2')).toBe(true);
  });

  it('validateBinding rejects unknown ids', async () => {
    const reg = new StaticAnchorRegistry(ANCHORS);
    expect(await reg.validateBinding('u1', 'unknown')).toBe(false);
    expect(await reg.validateBinding('u1', '')).toBe(false);
  });

  it('empty anchor list works (everything rejects)', async () => {
    const reg = new StaticAnchorRegistry([]);
    expect(await reg.getAnchorsForUser('u1')).toEqual([]);
    expect(await reg.validateBinding('u1', 'anything')).toBe(false);
  });
});
