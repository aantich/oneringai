/**
 * resolveRelatedItems / findSimilarOpenTasks — public traversal + semantic
 * primitives used by external pipelines (e.g. v25 reconciler).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MemorySystem } from '@/memory/MemorySystem.js';
import { InMemoryAdapter } from '@/memory/adapters/inmemory/InMemoryAdapter.js';
import type { IEmbedder, ScopeFilter } from '@/memory/types.js';

const scope: ScopeFilter = { userId: 'u1' };

// Token-aware deterministic embedder: each unique word maps to a coordinate
// (mod `dim`). Texts that share words → vectors that overlap on those axes →
// high cosine similarity. Lets us write meaningful ordering assertions.
const TOKEN_DIM = 32;
function tokenAxis(token: string): number {
  let h = 0;
  for (let i = 0; i < token.length; i++) h = (h * 31 + token.charCodeAt(i)) >>> 0;
  return h % TOKEN_DIM;
}
function makeEmbedder(): IEmbedder & { embed: ReturnType<typeof vi.fn> } {
  const embed = vi.fn(async (text: string) => {
    const v = new Array(TOKEN_DIM).fill(0);
    const tokens = text.toLowerCase().split(/\W+/).filter(Boolean);
    for (const t of tokens) v[tokenAxis(t)] += 1;
    return v;
  });
  return { embed, dimensions: TOKEN_DIM };
}

describe('resolveRelatedItems', () => {
  let mem: MemorySystem;

  beforeEach(() => {
    mem = new MemorySystem({ store: new InMemoryAdapter() });
  });

  afterEach(async () => {
    if (!mem.isDestroyed) await mem.shutdown();
  });

  async function person(name: string) {
    const r = await mem.upsertEntity(
      {
        type: 'person',
        displayName: name,
        identifiers: [{ kind: 'email', value: `${name.toLowerCase()}@x.com` }],
      },
      scope,
    );
    return r.entity.id;
  }

  async function task(name: string, metadata: Record<string, unknown>) {
    const r = await mem.upsertEntity(
      {
        type: 'task',
        displayName: name,
        identifiers: [{ kind: 'canonical', value: `task:${name}` }],
        metadata: { state: 'pending', ...metadata },
      },
      scope,
    );
    return r.entity.id;
  }

  async function event(name: string, metadata: Record<string, unknown>) {
    const r = await mem.upsertEntity(
      {
        type: 'event',
        displayName: name,
        identifiers: [{ kind: 'canonical', value: `event:${name}` }],
        metadata,
      },
      scope,
    );
    return r.entity.id;
  }

  it('returns tasks reachable by metadata role fields', async () => {
    const alice = await person('Alice');
    const bob = await person('Bob');
    await task('Alice task', { assigneeId: alice });
    await task('Bob task', { assigneeId: bob });

    const res = await mem.resolveRelatedItems([alice], scope);
    expect(res.tasks).toHaveLength(1);
    expect(res.tasks[0]!.task.displayName).toBe('Alice task');
    expect(res.tasks[0]!.matchedEntityId).toBe(alice);
  });

  it('unions across multiple input entities and dedupes', async () => {
    const alice = await person('Alice');
    const acme = await mem.upsertEntity(
      {
        type: 'organization',
        displayName: 'Acme',
        identifiers: [{ kind: 'domain', value: 'acme.com' }],
      },
      scope,
    );
    const orgId = acme.entity.id;
    const t1 = await task('T1', { assigneeId: alice, projectId: orgId });
    await task('T2', { assigneeId: alice });

    const res = await mem.resolveRelatedItems([alice, orgId], scope);
    // T1 hits via both — but should appear once.
    const ids = res.tasks.map((t) => t.task.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain(t1);
  });

  it('finds events the entity attends or hosts', async () => {
    const alice = await person('Alice');
    await event('Quarterly', {
      startTime: new Date(Date.now() + 86_400_000).toISOString(), // tomorrow
      attendeeIds: [alice],
    });

    const res = await mem.resolveRelatedItems([alice], scope, { types: ['event'] });
    expect(res.events).toHaveLength(1);
    expect(res.events[0]!.event.displayName).toBe('Quarterly');
    expect(res.events[0]!.matchedEntityId).toBe(alice);
  });

  it('respects taskStates filter', async () => {
    const alice = await person('Alice');
    await task('Open', { assigneeId: alice, state: 'pending' });
    await task('Closed', { assigneeId: alice, state: 'done' });

    // Default — only active states (excludes 'done')
    const def = await mem.resolveRelatedItems([alice], scope);
    expect(def.tasks.map((t) => t.task.displayName)).toEqual(['Open']);

    // Explicit override — caller wants 'done' too
    const all = await mem.resolveRelatedItems([alice], scope, {
      taskStates: ['pending', 'done'],
    });
    expect(all.tasks.map((t) => t.task.displayName).sort()).toEqual(['Closed', 'Open']);
  });

  it('respects types filter', async () => {
    const alice = await person('Alice');
    await task('T', { assigneeId: alice });
    await event('E', {
      startTime: new Date(Date.now() + 86_400_000).toISOString(),
      attendeeIds: [alice],
    });

    const tasksOnly = await mem.resolveRelatedItems([alice], scope, { types: ['task'] });
    expect(tasksOnly.tasks).toHaveLength(1);
    expect(tasksOnly.events).toHaveLength(0);

    const eventsOnly = await mem.resolveRelatedItems([alice], scope, { types: ['event'] });
    expect(eventsOnly.tasks).toHaveLength(0);
    expect(eventsOnly.events).toHaveLength(1);
  });

  it('caps total results at limit', async () => {
    const alice = await person('Alice');
    for (let i = 0; i < 8; i++) await task(`T${i}`, { assigneeId: alice });
    const res = await mem.resolveRelatedItems([alice], scope, { limit: 3 });
    expect(res.tasks.length).toBeLessThanOrEqual(3);
  });

  it('returns empty for unknown entity id', async () => {
    const res = await mem.resolveRelatedItems(['no-such-entity'], scope);
    expect(res.tasks).toEqual([]);
    expect(res.events).toEqual([]);
  });
});

describe('findSimilarOpenTasks', () => {
  let mem: MemorySystem;

  beforeEach(() => {
    // findSimilarOpenTasks goes through `store.semanticSearchEntities`
    // directly — it does not consult `entityResolution.enableSemanticResolution`,
    // which gates only the EntityResolver tier. Just providing an embedder is
    // enough to populate `IEntity.identityEmbedding` via the queue.
    mem = new MemorySystem({
      store: new InMemoryAdapter(),
      embedder: makeEmbedder(),
    });
  });

  afterEach(async () => {
    if (!mem.isDestroyed) await mem.shutdown();
  });

  async function task(name: string, state = 'pending') {
    const r = await mem.upsertEntity(
      {
        type: 'task',
        displayName: name,
        identifiers: [{ kind: 'canonical', value: `task:${name.replace(/\s+/g, '-').toLowerCase()}` }],
        metadata: { state },
      },
      scope,
    );
    return r.entity.id;
  }

  it('returns empty when adapter has no semanticSearchEntities', async () => {
    // Build a memory system whose store explicitly lacks semanticSearchEntities.
    const skinnyStore = {
      // Minimal IMemoryStore stub that throws on anything we don't intend to use.
      // The function signature defaults are enough — findSimilarOpenTasks bails
      // on the missing method before any other call.
    } as unknown as ConstructorParameters<typeof MemorySystem>[0]['store'];
    const memSkinny = new MemorySystem({ store: skinnyStore });
    const res = await memSkinny.findSimilarOpenTasks('anything', scope);
    expect(res).toEqual([]);
    await memSkinny.shutdown();
  });

  it('returns active tasks ranked by similarity', async () => {
    await task('Prepare slides for JP Morgan meeting');
    await task('Draft Q3 board memo');
    await task('Buy flowers');

    // Drain the embedding queue so identityEmbeddings exist.
    await mem.flushEmbeddings();

    const res = await mem.findSimilarOpenTasks('JP Morgan slides preparation', scope, { topK: 3 });
    expect(res.length).toBeGreaterThan(0);
    expect(res[0]!.task.displayName.toLowerCase()).toContain('jp morgan');
  });

  it('filters out non-active tasks', async () => {
    const closed = await task('Old prep task', 'done');
    await task('New prep task', 'pending');
    await mem.flushEmbeddings();

    const res = await mem.findSimilarOpenTasks('prep task', scope, { topK: 5 });
    const ids = res.map((r) => r.task.id);
    expect(ids).not.toContain(closed);
  });

  it('honors topK', async () => {
    for (let i = 0; i < 6; i++) await task(`Prep task ${i}`);
    await mem.flushEmbeddings();
    const res = await mem.findSimilarOpenTasks('prep', scope, { topK: 2 });
    expect(res.length).toBeLessThanOrEqual(2);
  });

  it('clamps absurd topK to project ceiling (≤100)', async () => {
    // Capture the over-fetch arg sent to the store. We don't have direct access
    // to the InMemoryAdapter's call args, so wrap semanticSearchEntities.
    for (let i = 0; i < 5; i++) await task(`T${i}`);
    await mem.flushEmbeddings();

    const adapter = (mem as unknown as { store: { semanticSearchEntities: Function } }).store;
    const orig = adapter.semanticSearchEntities.bind(adapter);
    let observedTopK: number | undefined;
    adapter.semanticSearchEntities = async (qv: number[], f: unknown, o: { topK: number }, s: unknown) => {
      observedTopK = o.topK;
      return orig(qv, f, o, s);
    };

    const res = await mem.findSimilarOpenTasks('T', scope, { topK: 100000 });
    // topK clamped to 100 → over-fetch capped at 300 (≤300 hard ceiling).
    expect(observedTopK).toBeLessThanOrEqual(300);
    // Result still bounded by clamped topK (and by data, which is 5 tasks).
    expect(res.length).toBeLessThanOrEqual(100);
  });

  it('rejects NaN/negative topK and minScore by clamping', async () => {
    await task('T');
    await mem.flushEmbeddings();
    // Negative topK clamps to 1; NaN minScore clamps to 0.
    const res = await mem.findSimilarOpenTasks('T', scope, {
      topK: -5,
      minScore: Number.NaN,
    });
    expect(res.length).toBeLessThanOrEqual(1);
  });
});
