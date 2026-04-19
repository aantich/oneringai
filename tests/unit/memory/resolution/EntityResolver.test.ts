/**
 * EntityResolver tests — via MemorySystem.resolveEntity + upsertEntityBySurface.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemorySystem } from '@/memory/MemorySystem.js';
import { InMemoryAdapter } from '@/memory/adapters/inmemory/InMemoryAdapter.js';
import type { ScopeFilter } from '@/memory/types.js';

describe('EntityResolver.resolve — via MemorySystem.resolveEntity', () => {
  let store: InMemoryAdapter;
  let mem: MemorySystem;
  const scope: ScopeFilter = {};

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
      {},
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

  it('typos do NOT fuzzy-resolve in v1 (typo-tolerant resolution is future work)', async () => {
    await seedOrg('Microsoft', [], [{ kind: 'domain', value: 'microsoft.com' }]);

    const candidates = await mem.resolveEntity(
      { surface: 'Microsft', type: 'organization' }, // typo
      scope,
    );
    // Intentionally no match — see EntityResolver header. The caller will
    // either see an empty array or nothing that clears autoResolveThreshold,
    // and `upsertEntityBySurface` will create a duplicate. Document this
    // behavior so future semantic-tier wiring is obvious.
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
      {},
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
      },
      { groupId: 'g2' },
    );

    // Caller in g1 should only see the global Microsoft.
    const c = await mem.resolveEntity({ surface: 'Microsoft', type: 'organization' }, { groupId: 'g1' });
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
      {},
    );
    const john2 = await mem.upsertEntity(
      {
        type: 'person',
        displayName: 'John Doe',
        identifiers: [{ kind: 'email', value: 'john@other.com' }],
      },
      {},
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
      {},
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
      {},
    );

    // Second pass uses a different surface but same identifier.
    const second = await mem.upsertEntityBySurface(
      {
        surface: 'Microsoft Corporation',
        type: 'organization',
        identifiers: [{ kind: 'domain', value: 'microsoft.com' }],
      },
      {},
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
      {},
    );
    await mem.upsertEntityBySurface(
      {
        surface: 'MSFT',
        type: 'organization',
        identifiers: [{ kind: 'domain', value: 'microsoft.com' }],
      },
      {},
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
      {},
    );
    const result = await mem.upsertEntityBySurface(
      { surface: 'Microsft', type: 'organization' }, // typo
      {},
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
      {},
    );
    const result = await mem.upsertEntityBySurface(
      { surface: 'MSFT', type: 'organization' },
      {},
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
      {},
    );
    const second = await mem.upsertEntityBySurface(
      { surface: 'Acme', type: 'organization' },
      {},
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
      {},
    );
    // Alias match (0.85 confidence) now auto-resolves under the lower threshold.
    const result = await mem.upsertEntityBySurface(
      { surface: 'MSFT', type: 'organization' },
      {},
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
      {},
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
      {},
    );
    await mem.flushEmbeddings();
    expect(embedCalls).toBeGreaterThan(0);
    await mem.shutdown();
  });
});
