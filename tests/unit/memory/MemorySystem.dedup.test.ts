/**
 * MemorySystem — dedup + updateFactDetails tests.
 *
 * Covers the session-ingestor use case: write the same fact twice, second
 * write should not create a new row; merging details in place should update
 * the existing fact.
 */

import { describe, it, expect } from 'vitest';
import { MemorySystem } from '@/memory/MemorySystem.js';
import { InMemoryAdapter } from '@/memory/adapters/inmemory/InMemoryAdapter.js';

const USER = 'u1';

function makeMem() {
  return new MemorySystem({ store: new InMemoryAdapter() });
}

async function bootstrap(mem: MemorySystem) {
  const r = await mem.upsertEntity(
    { type: 'person', displayName: 'Anton', identifiers: [{ kind: 'email', value: 'a@x' }] },
    { userId: USER },
  );
  return r.entity.id;
}

describe('addFact dedup=true', () => {
  it('returns existing on exact match and does NOT create a new row', async () => {
    const mem = makeMem();
    const subjectId = await bootstrap(mem);
    const first = await mem.addFact(
      { subjectId, predicate: 'works_at', kind: 'atomic', value: 'Everworker' },
      { userId: USER },
    );
    const second = await mem.addFact(
      {
        subjectId,
        predicate: 'works_at',
        kind: 'atomic',
        value: 'Everworker',
        dedup: true,
      },
      { userId: USER },
    );
    expect(second.id).toBe(first.id);
    const page = await mem.findFacts(
      { subjectId, predicate: 'works_at', archived: false },
      {},
      { userId: USER },
    );
    expect(page.items.length).toBe(1);
  });

  it('bumps observedAt on dup match', async () => {
    const mem = makeMem();
    const subjectId = await bootstrap(mem);
    const first = await mem.addFact(
      {
        subjectId,
        predicate: 'works_at',
        kind: 'atomic',
        value: 'Everworker',
        observedAt: new Date('2020-01-01'),
      },
      { userId: USER },
    );
    const later = new Date('2026-06-06');
    const second = await mem.addFact(
      {
        subjectId,
        predicate: 'works_at',
        kind: 'atomic',
        value: 'Everworker',
        dedup: true,
        observedAt: later,
      },
      { userId: USER },
    );
    expect(second.id).toBe(first.id);
    expect(second.observedAt?.getTime()).toBe(later.getTime());
  });

  it('inserts new row on (same subject, predicate) but different value', async () => {
    const mem = makeMem();
    const subjectId = await bootstrap(mem);
    const a = await mem.addFact(
      { subjectId, predicate: 'prefers', kind: 'atomic', value: 'concise' },
      { userId: USER },
    );
    const b = await mem.addFact(
      {
        subjectId,
        predicate: 'prefers',
        kind: 'atomic',
        value: 'verbose',
        dedup: true,
      },
      { userId: USER },
    );
    expect(b.id).not.toBe(a.id);
    const page = await mem.findFacts(
      { subjectId, predicate: 'prefers' },
      {},
      { userId: USER },
    );
    expect(page.items.length).toBe(2);
  });

  it('does not match archived facts — re-inserts', async () => {
    const mem = makeMem();
    const subjectId = await bootstrap(mem);
    const first = await mem.addFact(
      { subjectId, predicate: 'works_at', kind: 'atomic', value: 'Everworker' },
      { userId: USER },
    );
    await mem.archiveFact(first.id, { userId: USER });
    const second = await mem.addFact(
      {
        subjectId,
        predicate: 'works_at',
        kind: 'atomic',
        value: 'Everworker',
        dedup: true,
      },
      { userId: USER },
    );
    expect(second.id).not.toBe(first.id);
  });
});

describe('findDuplicateFact', () => {
  it('returns the matching fact', async () => {
    const mem = makeMem();
    const subjectId = await bootstrap(mem);
    const inserted = await mem.addFact(
      { subjectId, predicate: 'lives_in', kind: 'atomic', value: 'Lisbon' },
      { userId: USER },
    );
    const dup = await mem.findDuplicateFact(
      { subjectId, predicate: 'lives_in', kind: 'atomic', value: 'Lisbon' },
      { userId: USER },
    );
    expect(dup?.id).toBe(inserted.id);
  });

  it('returns null when no match', async () => {
    const mem = makeMem();
    const subjectId = await bootstrap(mem);
    const dup = await mem.findDuplicateFact(
      { subjectId, predicate: 'lives_in', kind: 'atomic', value: 'Nowhere' },
      { userId: USER },
    );
    expect(dup).toBeNull();
  });
});

describe('dedup — write-permission check (M-1)', () => {
  it('does NOT bump observedAt on a fact the caller cannot write', async () => {
    const mem = makeMem();
    // Alice owns an entity + fact with default permissions (world:read, world NOT write).
    const alice = await mem.upsertEntity(
      { type: 'person', displayName: 'Bob', identifiers: [{ kind: 'email', value: 'bob@x' }] },
      { userId: 'alice' },
    );
    const t0 = new Date('2020-01-01');
    const aliceFact = await mem.addFact(
      {
        subjectId: alice.entity.id,
        predicate: 'prefers',
        kind: 'atomic',
        value: 'pizza',
        observedAt: t0,
      },
      { userId: 'alice' },
    );

    // Carla (different user) invokes dedup. findDedupMatch will find Alice's
    // fact (world-readable) BUT write is denied (world='read' != 'write',
    // Carla is not the owner). The M-1 fix must fall through and NOT mutate
    // observedAt on Alice's record.
    await mem.addFact(
      {
        subjectId: alice.entity.id,
        predicate: 'prefers',
        kind: 'atomic',
        value: 'pizza',
        dedup: true,
        observedAt: new Date('2026-12-31'),
      },
      { userId: 'carla' },
    );

    // Reload and verify observedAt is STILL t0 — Carla did not mutate Alice's fact.
    const reloaded = await mem.getFact(aliceFact.id, { userId: 'alice' });
    expect(reloaded?.observedAt?.getTime()).toBe(t0.getTime());
  });
});

describe('dedup — structural value equality (M-2)', () => {
  it('matches object values regardless of key order', async () => {
    const mem = makeMem();
    const subjectId = await bootstrap(mem);
    const first = await mem.addFact(
      {
        subjectId,
        predicate: 'config',
        kind: 'atomic',
        value: { a: 1, b: 2, nested: { x: 10, y: 20 } },
      },
      { userId: USER },
    );
    const second = await mem.addFact(
      {
        subjectId,
        predicate: 'config',
        kind: 'atomic',
        value: { b: 2, a: 1, nested: { y: 20, x: 10 } },
        dedup: true,
      },
      { userId: USER },
    );
    expect(second.id).toBe(first.id);
  });

  it('distinguishes arrays with different order', async () => {
    const mem = makeMem();
    const subjectId = await bootstrap(mem);
    const a = await mem.addFact(
      { subjectId, predicate: 'tags', kind: 'atomic', value: ['x', 'y'] },
      { userId: USER },
    );
    const b = await mem.addFact(
      { subjectId, predicate: 'tags', kind: 'atomic', value: ['y', 'x'], dedup: true },
      { userId: USER },
    );
    // Arrays are positional — different order = different fact.
    expect(b.id).not.toBe(a.id);
  });
});

describe('dedup — case-insensitive + whitespace-normalised string values (H4)', () => {
  it('treats "Alice", "alice", "Alice " as the same fact', async () => {
    const mem = makeMem();
    const subjectId = await bootstrap(mem);
    const first = await mem.addFact(
      { subjectId, predicate: 'nickname', kind: 'atomic', value: 'Alice' },
      { userId: USER },
    );
    const lower = await mem.addFact(
      { subjectId, predicate: 'nickname', kind: 'atomic', value: 'alice', dedup: true },
      { userId: USER },
    );
    expect(lower.id).toBe(first.id);
    const trailing = await mem.addFact(
      { subjectId, predicate: 'nickname', kind: 'atomic', value: 'Alice ', dedup: true },
      { userId: USER },
    );
    expect(trailing.id).toBe(first.id);
    const doubleSpace = await mem.addFact(
      { subjectId, predicate: 'nickname', kind: 'atomic', value: '  Alice  ', dedup: true },
      { userId: USER },
    );
    expect(doubleSpace.id).toBe(first.id);
  });

  it('still distinguishes semantically different strings', async () => {
    const mem = makeMem();
    const subjectId = await bootstrap(mem);
    const first = await mem.addFact(
      { subjectId, predicate: 'nickname', kind: 'atomic', value: 'Alice' },
      { userId: USER },
    );
    const second = await mem.addFact(
      { subjectId, predicate: 'nickname', kind: 'atomic', value: 'Bob', dedup: true },
      { userId: USER },
    );
    expect(second.id).not.toBe(first.id);
  });

  it('does not apply case-insensitivity to object/number values', async () => {
    const mem = makeMem();
    const subjectId = await bootstrap(mem);
    // Number values — exact equality.
    const n1 = await mem.addFact(
      { subjectId, predicate: 'score', kind: 'atomic', value: 42 },
      { userId: USER },
    );
    const n2 = await mem.addFact(
      { subjectId, predicate: 'score', kind: 'atomic', value: 42, dedup: true },
      { userId: USER },
    );
    expect(n2.id).toBe(n1.id);
  });
});

describe('updateFactDetails', () => {
  it('updates details in place and recomputes isSemantic', async () => {
    const mem = makeMem();
    const subjectId = await bootstrap(mem);
    const fact = await mem.addFact(
      {
        subjectId,
        predicate: 'note',
        kind: 'atomic',
        value: 'x',
        details: 'short',
      },
      { userId: USER },
    );
    // short details → isSemantic false
    expect(fact.isSemantic).toBe(false);
    const long =
      'A long enough narrative that should cross the 80-character semantic threshold and thus flip isSemantic to true when applied via updateFactDetails — well past 80 chars.';
    const updated = await mem.updateFactDetails(fact.id, long, { userId: USER });
    expect(updated.details).toBe(long);
    expect(updated.isSemantic).toBe(true);
    // Re-fetch to confirm persistence
    const reloaded = await mem.getFact(fact.id, { userId: USER });
    expect(reloaded?.details).toBe(long);
  });

  it('throws on missing fact', async () => {
    const mem = makeMem();
    await bootstrap(mem);
    await expect(mem.updateFactDetails('nope', 'new', { userId: USER })).rejects.toThrow(
      /not found/,
    );
  });
});
