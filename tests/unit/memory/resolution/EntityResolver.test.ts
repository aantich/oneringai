/**
 * EntityResolver tests — via MemorySystem.resolveEntity + upsertEntityBySurface.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemorySystem } from '@/memory/MemorySystem.js';
import { InMemoryAdapter } from '@/memory/adapters/inmemory/InMemoryAdapter.js';
import type { ScopeFilter } from '@/memory/types.js';

const scope: ScopeFilter = { userId: 'test-user' };

describe('EntityResolver.resolve — via MemorySystem.resolveEntity', () => {
  let store: InMemoryAdapter;
  let mem: MemorySystem;

  beforeEach(() => {
    store = new InMemoryAdapter();
    mem = new MemorySystem({ store });
  });

  afterEach(async () => {
    if (!mem.isDestroyed) await mem.shutdown();
  });

  async function seedOrg(name: string, aliases: string[], identifiers: { kind: string; value: string }[]) {
    return await mem.upsertEntity(
      { type: 'organization', displayName: name, aliases, identifiers },
      scope,
    );
  }

  it('tier 1: exact identifier match → confidence 1.0', async () => {
    await seedOrg('Microsoft', [], [{ kind: 'domain', value: 'microsoft.com' }]);

    const candidates = await mem.resolveEntity(
      {
        surface: 'totally different name',
        type: 'organization',
        identifiers: [{ kind: 'domain', value: 'microsoft.com' }],
      },
      scope,
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.confidence).toBe(1.0);
    expect(candidates[0]!.matchedOn).toBe('identifier');
    expect(candidates[0]!.entity.displayName).toBe('Microsoft');
  });

  it('tier 2: exact displayName → confidence 0.9', async () => {
    await seedOrg('Microsoft', [], [{ kind: 'domain', value: 'microsoft.com' }]);

    const candidates = await mem.resolveEntity(
      { surface: 'Microsoft', type: 'organization' },
      scope,
    );
    expect(candidates[0]!.confidence).toBe(0.9);
    expect(candidates[0]!.matchedOn).toBe('displayName');
  });

  it('tier 3: exact alias match → confidence 0.85', async () => {
    await seedOrg('Microsoft', ['MSFT'], [{ kind: 'domain', value: 'microsoft.com' }]);

    const candidates = await mem.resolveEntity(
      { surface: 'MSFT', type: 'organization' },
      scope,
    );
    expect(candidates[0]!.confidence).toBe(0.85);
    expect(candidates[0]!.matchedOn).toBe('alias');
  });

  it('typos do NOT fuzzy-resolve by default (semantic tier is opt-in)', async () => {
    await seedOrg('Microsoft', [], [{ kind: 'domain', value: 'microsoft.com' }]);

    const candidates = await mem.resolveEntity(
      { surface: 'Microsft', type: 'organization' }, // typo
      scope,
    );
    // Semantic tier is behind `enableSemanticResolution: true` — without it,
    // tiers 1-3 are exact-only so a typo returns nothing. Behavior is identical
    // to the pre-semantic implementation; opt-in preserves backward compat.
    expect(candidates).toEqual([]);
  });

  it('normalized exact match still works (Microsoft vs Microsoft Inc.)', async () => {
    await seedOrg('Microsoft', [], [{ kind: 'domain', value: 'microsoft.com' }]);

    const candidates = await mem.resolveEntity(
      { surface: 'Microsoft Inc.', type: 'organization' },
      scope,
    );
    // After normalization these are identical, so it's actually exact displayName tier.
    expect(candidates[0]!.matchedOn).toBe('displayName');
  });

  it('type filter excludes mismatched types', async () => {
    await seedOrg('Microsoft', [], [{ kind: 'domain', value: 'microsoft.com' }]);
    await mem.upsertEntity(
      {
        type: 'project',
        displayName: 'Microsoft',
        identifiers: [{ kind: 'project_slug', value: 'microsoft-internal' }],
      },
      scope,
    );

    const orgCandidates = await mem.resolveEntity(
      { surface: 'Microsoft', type: 'organization' },
      scope,
    );
    expect(orgCandidates.every((c) => c.entity.type === 'organization')).toBe(true);
  });

  it('scope-filters — only visible entities returned', async () => {
    await seedOrg('Microsoft', [], [{ kind: 'domain', value: 'microsoft.com' }]);
    // Seed a group-scoped entity with same name in a different group.
    await mem.upsertEntity(
      {
        type: 'organization',
        displayName: 'Microsoft',
        identifiers: [{ kind: 'domain', value: 'msft-local.com' }],
        groupId: 'g2',
        ownerId: 'u-g2',
        permissions: { world: 'none' },
      },
      { groupId: 'g2', userId: 'u-g2' },
    );

    // Caller in g1 should only see the other Microsoft (the g2 one is private to g2).
    const c = await mem.resolveEntity(
      { surface: 'Microsoft', type: 'organization' },
      { groupId: 'g1', userId: 'u-caller' },
    );
    expect(c).toHaveLength(1);
  });

  it('context-aware disambiguation prefers entity sharing contextEntityIds', async () => {
    // Two Johns — disambiguate by shared colleague.
    const acme = await seedOrg('Acme', [], [{ kind: 'domain', value: 'acme.com' }]);

    const john1 = await mem.upsertEntity(
      {
        type: 'person',
        displayName: 'John Doe',
        identifiers: [{ kind: 'email', value: 'john@acme.com' }],
      },
      scope,
    );
    const john2 = await mem.upsertEntity(
      {
        type: 'person',
        displayName: 'John Doe',
        identifiers: [{ kind: 'email', value: 'john@other.com' }],
      },
      scope,
    );

    // Link john1 to acme via a fact.
    await mem.addFact(
      { subjectId: john1.entity.id, predicate: 'works_at', kind: 'atomic', objectId: acme.entity.id },
      {},
    );

    // Resolve "John Doe" with Acme in context — should boost john1.
    const candidates = await mem.resolveEntity(
      {
        surface: 'John Doe',
        type: 'person',
        contextEntityIds: [acme.entity.id],
      },
      scope,
    );
    expect(candidates.length).toBeGreaterThanOrEqual(2);
    expect(candidates[0]!.entity.id).toBe(john1.entity.id);

    // Suppress unused-var warning.
    expect(john2.entity.id).toBeDefined();
  });

  it('returns empty when nothing passes threshold', async () => {
    const candidates = await mem.resolveEntity(
      { surface: 'Nothing', type: 'organization' },
      scope,
    );
    expect(candidates).toEqual([]);
  });
});

describe('EntityResolver.upsertBySurface — via MemorySystem.upsertEntityBySurface', () => {
  let store: InMemoryAdapter;
  let mem: MemorySystem;

  beforeEach(() => {
    store = new InMemoryAdapter();
    mem = new MemorySystem({ store });
  });

  afterEach(async () => {
    if (!mem.isDestroyed) await mem.shutdown();
  });

  it('creates new entity when nothing matches', async () => {
    const result = await mem.upsertEntityBySurface(
      {
        surface: 'Microsoft',
        type: 'organization',
        identifiers: [{ kind: 'domain', value: 'microsoft.com' }],
      },
      scope,
    );
    expect(result.resolved).toBe(false);
    expect(result.entity.displayName).toBe('Microsoft');
    expect(result.mergeCandidates).toHaveLength(0);
  });

  it('auto-resolves to existing on strong-identifier match (confidence 1.0)', async () => {
    const first = await mem.upsertEntityBySurface(
      {
        surface: 'Microsoft',
        type: 'organization',
        identifiers: [{ kind: 'domain', value: 'microsoft.com' }],
      },
      scope,
    );

    // Second pass uses a different surface but same identifier.
    const second = await mem.upsertEntityBySurface(
      {
        surface: 'Microsoft Corporation',
        type: 'organization',
        identifiers: [{ kind: 'domain', value: 'microsoft.com' }],
      },
      scope,
    );
    expect(second.resolved).toBe(true);
    expect(second.entity.id).toBe(first.entity.id);
    // New surface should be stored as alias.
    expect(second.entity.aliases).toContain('Microsoft Corporation');
  });

  it('accumulates aliases on repeated surface variants', async () => {
    await mem.upsertEntityBySurface(
      {
        surface: 'Microsoft',
        type: 'organization',
        identifiers: [{ kind: 'domain', value: 'microsoft.com' }],
      },
      scope,
    );
    await mem.upsertEntityBySurface(
      {
        surface: 'MSFT',
        type: 'organization',
        identifiers: [{ kind: 'domain', value: 'microsoft.com' }],
      },
      scope,
    );
    const ent = (await mem.searchEntities('Microsoft', {}, {})).items[0]!;
    expect(ent.aliases).toContain('MSFT');
  });

  it('typo creates a new entity (typo-tolerant resolution is future work)', async () => {
    await mem.upsertEntityBySurface(
      {
        surface: 'Microsoft',
        type: 'organization',
        identifiers: [{ kind: 'domain', value: 'microsoft.com' }],
      },
      scope,
    );
    const result = await mem.upsertEntityBySurface(
      { surface: 'Microsft', type: 'organization' }, // typo
      scope,
    );
    // v1: no fuzzy tier → no candidates → new entity created.
    expect(result.resolved).toBe(false);
    expect(result.mergeCandidates).toEqual([]);
  });

  it('alias tier (0.85) auto-resolves when threshold is lowered to 0.8', async () => {
    const first = await mem.upsertEntityBySurface(
      {
        surface: 'Microsoft',
        type: 'organization',
        identifiers: [{ kind: 'domain', value: 'microsoft.com' }],
        aliases: ['MSFT'],
      },
      scope,
    );
    const result = await mem.upsertEntityBySurface(
      { surface: 'MSFT', type: 'organization' },
      scope,
      { autoResolveThreshold: 0.8 },
    );
    expect(result.resolved).toBe(true);
    expect(result.entity.id).toBe(first.entity.id);
  });

  it('exact displayName (conf 0.9) auto-resolves at default threshold 0.9', async () => {
    const first = await mem.upsertEntityBySurface(
      {
        surface: 'Acme',
        type: 'organization',
        identifiers: [{ kind: 'domain', value: 'acme.com' }],
      },
      scope,
    );
    const second = await mem.upsertEntityBySurface(
      { surface: 'Acme', type: 'organization' },
      scope,
    );
    expect(second.resolved).toBe(true);
    expect(second.entity.id).toBe(first.entity.id);
  });
});

describe('Configurable entity resolution thresholds', () => {
  it('custom autoResolveThreshold in config persists to upsertBySurface default', async () => {
    const store = new InMemoryAdapter();
    const mem = new MemorySystem({
      store,
      entityResolution: { autoResolveThreshold: 0.8 }, // alias tier 0.85 now passes
    });

    const first = await mem.upsertEntityBySurface(
      {
        surface: 'Microsoft',
        type: 'organization',
        identifiers: [{ kind: 'domain', value: 'microsoft.com' }],
        aliases: ['MSFT'],
      },
      scope,
    );
    // Alias match (0.85 confidence) now auto-resolves under the lower threshold.
    const result = await mem.upsertEntityBySurface(
      { surface: 'MSFT', type: 'organization' },
      scope
    );
    expect(result.resolved).toBe(true);
    expect(result.entity.id).toBe(first.entity.id);
    await mem.shutdown();
  });

  it('enableIdentityEmbedding: false disables identity embedding refresh', async () => {
    // Verifies that the queue doesn't receive identity jobs when disabled.
    let embedCalls = 0;
    const embedder = {
      dimensions: 3,
      embed: async () => {
        embedCalls++;
        return [1, 2, 3];
      },
    };
    const store = new InMemoryAdapter();
    const mem = new MemorySystem({
      store,
      embedder,
      entityResolution: { enableIdentityEmbedding: false },
    });
    await mem.upsertEntity(
      {
        type: 'person',
        displayName: 'X',
        identifiers: [{ kind: 'email', value: 'x@y.com' }],
      },
      scope,
    );
    await mem.flushEmbeddings();
    expect(embedCalls).toBe(0);
    await mem.shutdown();
  });

  it('enableIdentityEmbedding: true (default) triggers identity embedding', async () => {
    let embedCalls = 0;
    const embedder = {
      dimensions: 3,
      embed: async () => {
        embedCalls++;
        return [1, 2, 3];
      },
    };
    const store = new InMemoryAdapter();
    const mem = new MemorySystem({ store, embedder });
    await mem.upsertEntity(
      {
        type: 'person',
        displayName: 'X',
        identifiers: [{ kind: 'email', value: 'x@y.com' }],
      },
      scope,
    );
    await mem.flushEmbeddings();
    expect(embedCalls).toBeGreaterThan(0);
    await mem.shutdown();
  });
});

// =============================================================================
// Tier 4 — semantic match over identityEmbedding (opt-in)
// =============================================================================

describe('EntityResolver — tier 4: semantic match', () => {
  /**
   * Deterministic keyed embedder for the tests. Each surface the test seeds or
   * queries is assigned a hand-picked vector so cosine similarity is easy to
   * reason about. Anything we haven't mapped falls back to an orthogonal
   * vector (no false semantic hits).
   *
   * We drive seeds through MemorySystem.upsertEntity, which re-embeds on the
   * queue — so we have to provide the SAME vector for the seed's identity
   * string as for the matching query. `normalizeSurface` strips "Inc"/etc.
   * on both sides so that part lines up naturally; for displayName-only
   * seeds we key the map by the lowercased displayName.
   */
  function buildKeyedEmbedder(map: Record<string, number[]>, dims = 4) {
    const zero = Array.from({ length: dims }, () => 0);
    let calls = 0;
    return {
      dimensions: dims,
      embed: async (text: string): Promise<number[]> => {
        calls++;
        const key = text.toLowerCase();
        // Try exact key; else try first-word prefix (identity strings look
        // like "microsoft | alias: msft | domain=microsoft.com"). That lets
        // one-off surfaces match a canonical vector if they share a stem.
        if (map[key]) return [...map[key]];
        for (const k of Object.keys(map)) {
          if (key.includes(k)) return [...map[k]];
        }
        return [...zero];
      },
      get calls() {
        return calls;
      },
    };
  }

  it('opt-out by default — typos still miss even with an embedder configured', async () => {
    const embedder = buildKeyedEmbedder({
      microsoft: [1, 0, 0, 0],
      microsft: [0.98, 0.05, 0.05, 0], // very close cosine
    });
    const store = new InMemoryAdapter();
    const mem = new MemorySystem({ store, embedder });

    await mem.upsertEntity(
      { type: 'organization', displayName: 'Microsoft', identifiers: [] },
      scope,
    );
    await mem.flushEmbeddings();

    const candidates = await mem.resolveEntity(
      { surface: 'Microsft', type: 'organization' },
      scope,
    );
    expect(candidates).toEqual([]);
    await mem.shutdown();
  });

  it('opt-in resolves typos via semantic match (matchedOn: embedding)', async () => {
    const embedder = buildKeyedEmbedder({
      microsoft: [1, 0, 0, 0],
      microsft: [0.98, 0.05, 0.05, 0],
    });
    const store = new InMemoryAdapter();
    const mem = new MemorySystem({
      store,
      embedder,
      entityResolution: { enableSemanticResolution: true },
    });

    await mem.upsertEntity(
      { type: 'organization', displayName: 'Microsoft', identifiers: [] },
      scope,
    );
    await mem.flushEmbeddings();

    const candidates = await mem.resolveEntity(
      { surface: 'Microsft', type: 'organization' },
      scope,
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.matchedOn).toBe('embedding');
    expect(candidates[0]!.entity.displayName).toBe('Microsoft');
    // Confidence capped at 0.89 — strictly below default auto-resolve (0.9).
    expect(candidates[0]!.confidence).toBeLessThanOrEqual(0.89);
    expect(candidates[0]!.confidence).toBeGreaterThanOrEqual(0.75);
    await mem.shutdown();
  });

  it('confidence cap (0.89) prevents semantic tier alone from auto-merging', async () => {
    // Near-perfect cosine (0.99) — but we still cap at 0.89, so
    // upsertEntityBySurface (default threshold 0.9) won't merge.
    const embedder = buildKeyedEmbedder({
      acme: [1, 0, 0, 0],
      akme: [0.995, 0.01, 0, 0],
    });
    const store = new InMemoryAdapter();
    const mem = new MemorySystem({
      store,
      embedder,
      entityResolution: { enableSemanticResolution: true },
    });

    const seeded = await mem.upsertEntity(
      { type: 'organization', displayName: 'Acme', identifiers: [] },
      scope,
    );
    await mem.flushEmbeddings();

    const result = await mem.upsertEntityBySurface(
      { surface: 'Akme', type: 'organization' },
      scope,
    );
    // Created new entity instead of merging — semantic cap kept confidence below 0.9.
    expect(result.resolved).toBe(false);
    expect(result.entity.id).not.toBe(seeded.entity.id);
    // But the semantic match WAS surfaced as a merge candidate.
    expect(result.mergeCandidates.some((c) => c.matchedOn === 'embedding')).toBe(true);
    await mem.shutdown();
  });

  it('lowering autoResolveThreshold to 0.75 allows semantic merges', async () => {
    const embedder = buildKeyedEmbedder({
      acme: [1, 0, 0, 0],
      akme: [0.995, 0.01, 0, 0],
    });
    const store = new InMemoryAdapter();
    const mem = new MemorySystem({
      store,
      embedder,
      entityResolution: {
        enableSemanticResolution: true,
        autoResolveThreshold: 0.75,
      },
    });

    const seeded = await mem.upsertEntity(
      { type: 'organization', displayName: 'Acme', identifiers: [] },
      scope,
    );
    await mem.flushEmbeddings();

    const result = await mem.upsertEntityBySurface(
      { surface: 'Akme', type: 'organization' },
      scope,
    );
    expect(result.resolved).toBe(true);
    expect(result.entity.id).toBe(seeded.entity.id);
    await mem.shutdown();
  });

  it('tier-1 identifier match wins — semantic tier skipped to avoid embed cost', async () => {
    let embedCalls = 0;
    const embedder = {
      dimensions: 4,
      embed: async (_text: string): Promise<number[]> => {
        embedCalls++;
        return [1, 0, 0, 0];
      },
    };
    const store = new InMemoryAdapter();
    const mem = new MemorySystem({
      store,
      embedder,
      entityResolution: { enableSemanticResolution: true },
    });

    await mem.upsertEntity(
      {
        type: 'organization',
        displayName: 'Microsoft',
        identifiers: [{ kind: 'domain', value: 'microsoft.com' }],
      },
      scope,
    );
    await mem.flushEmbeddings();
    const before = embedCalls;

    const candidates = await mem.resolveEntity(
      {
        surface: 'whatever',
        type: 'organization',
        identifiers: [{ kind: 'domain', value: 'microsoft.com' }],
      },
      scope,
    );
    expect(candidates[0]!.confidence).toBe(1.0);
    expect(candidates[0]!.matchedOn).toBe('identifier');
    // Embedder NOT called for the resolution — tier 1 short-circuits.
    expect(embedCalls).toBe(before);
    await mem.shutdown();
  });

  it('never downgrades an existing higher-tier match (tier 2 beats tier 4 on same entity)', async () => {
    const embedder = buildKeyedEmbedder({ microsoft: [1, 0, 0, 0] });
    const store = new InMemoryAdapter();
    const mem = new MemorySystem({
      store,
      embedder,
      entityResolution: { enableSemanticResolution: true },
    });

    await mem.upsertEntity(
      { type: 'organization', displayName: 'Microsoft', identifiers: [] },
      scope,
    );
    await mem.flushEmbeddings();

    // Exact displayName match → tier 2 (0.9). Semantic would also produce
    // a candidate for the same entity; the higher-tier confidence must win.
    const candidates = await mem.resolveEntity(
      { surface: 'Microsoft', type: 'organization' },
      scope,
    );
    expect(candidates[0]!.matchedOn).toBe('displayName');
    expect(candidates[0]!.confidence).toBe(0.9);
    await mem.shutdown();
  });

  it('type filter is honored by the semantic tier', async () => {
    const embedder = buildKeyedEmbedder({ alpha: [1, 0, 0, 0] });
    const store = new InMemoryAdapter();
    const mem = new MemorySystem({
      store,
      embedder,
      entityResolution: { enableSemanticResolution: true },
    });

    // Two entities with near-identical identity embeddings but different types.
    await mem.upsertEntity(
      { type: 'person', displayName: 'Alpha', identifiers: [] },
      scope,
    );
    await mem.upsertEntity(
      { type: 'organization', displayName: 'Alpha', identifiers: [] },
      scope,
    );
    await mem.flushEmbeddings();

    const candidates = await mem.resolveEntity(
      { surface: 'Alpha', type: 'organization' },
      scope,
    );
    expect(candidates.every((c) => c.entity.type === 'organization')).toBe(true);
  });

  it('below minScore cosine floor (0.75) → no semantic candidate', async () => {
    // Cosine ≈ 0 for orthogonal vectors — well under the 0.75 floor.
    const embedder = buildKeyedEmbedder({
      alpha: [1, 0, 0, 0],
      beta: [0, 1, 0, 0],
    });
    const store = new InMemoryAdapter();
    const mem = new MemorySystem({
      store,
      embedder,
      entityResolution: { enableSemanticResolution: true },
    });

    await mem.upsertEntity(
      { type: 'organization', displayName: 'Alpha', identifiers: [] },
      scope,
    );
    await mem.flushEmbeddings();

    const candidates = await mem.resolveEntity(
      { surface: 'Beta', type: 'organization' },
      scope,
    );
    expect(candidates).toEqual([]);
    await mem.shutdown();
  });

  it('embedder failure logs + falls through to tier 1-3 (no crash)', async () => {
    const embedder = {
      dimensions: 4,
      embed: async (_text: string): Promise<number[]> => {
        throw new Error('boom');
      },
    };
    const store = new InMemoryAdapter();
    const mem = new MemorySystem({
      store,
      embedder,
      entityResolution: { enableSemanticResolution: true },
    });

    // Seed via direct adapter write so we don't go through the embed queue.
    await store.createEntity({
      type: 'organization',
      displayName: 'Microsoft',
      identifiers: [],
    });

    // Tier 2 still works even though tier 4's embedder throws.
    const candidates = await mem.resolveEntity(
      { surface: 'Microsoft', type: 'organization' },
      scope,
    );
    expect(candidates[0]!.matchedOn).toBe('displayName');
    await mem.shutdown();
  });

  it('context-aware disambiguation still boosts semantic candidates', async () => {
    // Two "John"s; John1 is linked to Acme via a fact. Resolve with Acme in
    // context — both Johns have nearly-identical identity embeddings, so
    // semantic surfaces both at near-equal confidence. Context overlap with
    // Acme should boost John1 to the top.
    const embedder = buildKeyedEmbedder({
      john: [1, 0, 0, 0],
      jon: [0.99, 0.1, 0, 0], // typo'd query vector — near-parallel to john
      acme: [0, 1, 0, 0],
    });
    const store = new InMemoryAdapter();
    const mem = new MemorySystem({
      store,
      embedder,
      entityResolution: { enableSemanticResolution: true },
    });

    const acme = await mem.upsertEntity(
      { type: 'organization', displayName: 'Acme', identifiers: [] },
      scope,
    );
    const john1 = await mem.upsertEntity(
      { type: 'person', displayName: 'John', identifiers: [] },
      scope,
    );
    const john2 = await mem.upsertEntity(
      { type: 'person', displayName: 'John', identifiers: [] },
      scope,
    );
    await mem.flushEmbeddings();

    await mem.addFact(
      { subjectId: john1.entity.id, predicate: 'works_at', kind: 'atomic', objectId: acme.entity.id },
      scope,
    );

    // Query with a typo so tiers 1-3 don't match — only semantic + context.
    const candidates = await mem.resolveEntity(
      { surface: 'Jon', type: 'person', contextEntityIds: [acme.entity.id] },
      scope,
    );
    // Both Johns surface via semantic; disambiguation puts john1 first.
    expect(candidates.length).toBeGreaterThanOrEqual(1);
    expect(candidates[0]!.entity.id).toBe(john1.entity.id);
    expect(john2.entity.id).toBeDefined();
    await mem.shutdown();
  });
});
