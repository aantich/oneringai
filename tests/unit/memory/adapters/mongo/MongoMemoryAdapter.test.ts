/**
 * MongoMemoryAdapter unit tests — exercised against an in-memory FakeMongoCollection
 * that implements the wrapper-level IMongoCollectionLike contract (post-id-translation).
 * The adapter sees `id` on docs and filters; the real wrappers handle the `_id`
 * translation transparently (tested separately in integration tests with real Mongo).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  MongoMemoryAdapter,
  MongoOptimisticConcurrencyError,
} from '@/memory/adapters/mongo/MongoMemoryAdapter.js';
import { ensureIndexes } from '@/memory/adapters/mongo/indexes.js';
import type { IEntity, IFact, Identifier, NewEntity, NewFact } from '@/memory/types.js';
import { FakeMongoCollection, MinimalFakeMongoCollection } from './FakeMongoCollection.js';

function entityInput(overrides: Partial<NewEntity> = {}): NewEntity {
  return {
    type: overrides.type ?? 'person',
    displayName: overrides.displayName ?? 'Test Person',
    aliases: overrides.aliases,
    identifiers: overrides.identifiers ?? [],
    metadata: overrides.metadata,
    archived: overrides.archived,
    groupId: overrides.groupId,
    ownerId: overrides.ownerId,
  };
}

function factInput(subjectId: string, overrides: Partial<NewFact> = {}): NewFact {
  const now = new Date();
  return {
    subjectId,
    predicate: overrides.predicate ?? 'works_at',
    kind: overrides.kind ?? 'atomic',
    objectId: overrides.objectId,
    value: overrides.value,
    details: overrides.details,
    summaryForEmbedding: overrides.summaryForEmbedding,
    embedding: overrides.embedding,
    isSemantic: overrides.isSemantic,
    confidence: overrides.confidence,
    supersedes: overrides.supersedes,
    archived: overrides.archived,
    isAggregate: overrides.isAggregate,
    observedAt: overrides.observedAt ?? now,
    validFrom: overrides.validFrom,
    validUntil: overrides.validUntil,
    metadata: overrides.metadata,
    groupId: overrides.groupId,
    ownerId: overrides.ownerId,
  };
}

describe('MongoMemoryAdapter', () => {
  let entColl: FakeMongoCollection<IEntity>;
  let factColl: FakeMongoCollection<IFact>;
  let adapter: MongoMemoryAdapter;

  beforeEach(() => {
    entColl = new FakeMongoCollection<IEntity>('entities');
    factColl = new FakeMongoCollection<IFact>('facts');
    adapter = new MongoMemoryAdapter({
      entities: entColl,
      facts: factColl,
      factsCollectionName: 'facts',
    });
  });

  afterEach(() => {
    if (!adapter.isDestroyed) adapter.destroy();
  });

  // ==========================================================================
  // Entities
  // ==========================================================================

  describe('entities', () => {
    it('createEntity assigns id + version=1', async () => {
      const e = await adapter.createEntity(entityInput({ displayName: 'A' }));
      expect(e.id).toBeTruthy();
      expect(e.version).toBe(1);
      expect(e.displayName).toBe('A');
      expect(await adapter.getEntity(e.id, {})).not.toBeNull();
    });

    it('accepts version bump (N → N+1) via updateEntity', async () => {
      const e = await adapter.createEntity(entityInput({ displayName: 'A' }));
      await adapter.updateEntity({ ...e, displayName: 'B', version: 2 });
      expect((await adapter.getEntity(e.id, {}))?.displayName).toBe('B');
    });

    it('rejects out-of-order version bump', async () => {
      const e = await adapter.createEntity(entityInput());
      await expect(adapter.updateEntity({ ...e, version: 3 })).rejects.toThrow(
        MongoOptimisticConcurrencyError,
      );
    });

    it('rejects version < 2 on updateEntity (use createEntity for new)', async () => {
      const e = await adapter.createEntity(entityInput());
      await expect(adapter.updateEntity({ ...e, version: 1 })).rejects.toThrow(
        MongoOptimisticConcurrencyError,
      );
    });

    it('createEntities stores multiple', async () => {
      const out = await adapter.createEntities([
        entityInput({ displayName: 'A' }),
        entityInput({ displayName: 'B' }),
      ]);
      expect(out).toHaveLength(2);
      expect(await adapter.getEntity(out[0]!.id, {})).not.toBeNull();
      expect(await adapter.getEntity(out[1]!.id, {})).not.toBeNull();
    });

    it('archiveEntity hides from getEntity', async () => {
      const e = await adapter.createEntity(entityInput());
      await adapter.archiveEntity(e.id, {});
      expect(await adapter.getEntity(e.id, {})).toBeNull();
    });

    it('deleteEntity removes the document', async () => {
      const e = await adapter.createEntity(entityInput());
      await adapter.deleteEntity(e.id, {});
      expect(await adapter.getEntity(e.id, {})).toBeNull();
      expect(entColl.all).toHaveLength(0);
    });

    describe('findEntitiesByIdentifier', () => {
      const ident = (kind: string, value: string): Identifier => ({ kind, value });

      it('finds by (kind, value)', async () => {
        const e = await adapter.createEntity(
          entityInput({ identifiers: [ident('email', 'a@example.com')] }),
        );
        const found = await adapter.findEntitiesByIdentifier('email', 'a@example.com', {});
        expect(found).toHaveLength(1);
        expect(found[0]!.id).toBe(e.id);
      });

      it('is case-insensitive on value', async () => {
        await adapter.createEntity(
          entityInput({ identifiers: [ident('email', 'Alice@X.com')] }),
        );
        const found = await adapter.findEntitiesByIdentifier('email', 'ALICE@x.com', {});
        expect(found).toHaveLength(1);
      });

      it('scope-filters', async () => {
        const a = await adapter.createEntity(
          entityInput({ groupId: 'g1', identifiers: [ident('email', 'shared@x.com')] }),
        );
        await adapter.createEntity(
          entityInput({ groupId: 'g2', identifiers: [ident('email', 'shared@x.com')] }),
        );
        const found = await adapter.findEntitiesByIdentifier('email', 'shared@x.com', {
          groupId: 'g1',
        });
        expect(found.map((e) => e.id)).toEqual([a.id]);
      });
    });

    describe('searchEntities', () => {
      let aliceId: string;
      let bobId: string;
      let acmeId: string;

      beforeEach(async () => {
        const alice = await adapter.createEntity(
          entityInput({
            displayName: 'Alice Anderson',
            aliases: ['Ali'],
            identifiers: [{ kind: 'email', value: 'alice@acme.com' }],
          }),
        );
        const bob = await adapter.createEntity(entityInput({ displayName: 'Bob Builder' }));
        const acme = await adapter.createEntity(
          entityInput({ displayName: 'Acme Corp', type: 'organization' }),
        );
        aliceId = alice.id;
        bobId = bob.id;
        acmeId = acme.id;
      });

      it('matches displayName', async () => {
        const res = await adapter.searchEntities('alice', {}, {});
        expect(res.items.map((e) => e.id)).toEqual([aliceId]);
      });

      it('matches alias', async () => {
        const res = await adapter.searchEntities('ali', {}, {});
        expect(res.items.map((e) => e.id)).toContain(aliceId);
      });

      it('respects type filter', async () => {
        const res = await adapter.searchEntities('', { types: ['organization'] }, {});
        expect(res.items.map((e) => e.id)).toEqual([acmeId]);
      });

      it('paginates via cursor', async () => {
        const p1 = await adapter.searchEntities('', { limit: 2 }, {});
        expect(p1.items).toHaveLength(2);
        expect(p1.nextCursor).toBeDefined();
        const p2 = await adapter.searchEntities('', { limit: 2, cursor: p1.nextCursor }, {});
        expect(p2.items.length + p1.items.length).toBe(3);
        // suppress unused warnings
        expect(bobId).toBeTruthy();
      });

      it('ranks exact > alias-exact > displayName-substring > identifier-substring', async () => {
        // Clear the beforeEach setup: fresh collections for a deterministic check.
        const entColl = new FakeMongoCollection<IEntity>();
        const factColl = new FakeMongoCollection<IFact>();
        const local = new MongoMemoryAdapter({
          entities: entColl,
          facts: factColl,
          factsCollectionName: 'test_facts',
          useNativeGraphLookup: false,
        });
        const exactDn = await local.createEntity(
          entityInput({ displayName: 'Acme', type: 'organization' }),
        );
        const exactAlias = await local.createEntity(
          entityInput({
            displayName: 'ACM Holdings',
            aliases: ['acme'],
            type: 'organization',
          }),
        );
        const dnSub = await local.createEntity(
          entityInput({ displayName: 'Acme International', type: 'organization' }),
        );
        const identSub = await local.createEntity(
          entityInput({
            displayName: 'Alice',
            identifiers: [{ kind: 'email', value: 'a@acme.com' }],
          }),
        );
        const res = await local.searchEntities('acme', {}, {});
        expect(res.items.map((e) => e.id)).toEqual([
          exactDn.id,
          exactAlias.id,
          dnSub.id,
          identSub.id,
        ]);
        local.destroy();
      });
    });

    describe('listEntities', () => {
      let ids: string[];

      beforeEach(async () => {
        ids = [];
        for (let i = 0; i < 4; i++) {
          const e = await adapter.createEntity(entityInput());
          ids.push(e.id);
        }
      });

      it('paginates', async () => {
        const p1 = await adapter.listEntities({}, { limit: 2 }, {});
        expect(p1.items).toHaveLength(2);
        const p2 = await adapter.listEntities({}, { limit: 2, cursor: p1.nextCursor }, {});
        expect(p2.items).toHaveLength(2);
      });

      it('filters by ids', async () => {
        const res = await adapter.listEntities({ ids: [ids[0]!, ids[2]!] }, {}, {});
        expect(res.items.map((e) => e.id).sort()).toEqual([ids[0]!, ids[2]!].sort());
      });

      it('archived:true returns only archived', async () => {
        await adapter.archiveEntity(ids[0]!, {});
        const res = await adapter.listEntities({ archived: true }, {}, {});
        expect(res.items.map((e) => e.id)).toEqual([ids[0]!]);
      });

      describe('metadataFilter validation', () => {
        it('accepts literal values', async () => {
          await expect(
            adapter.listEntities({ metadataFilter: { state: 'active' } }, {}, {}),
          ).resolves.toBeTruthy();
        });

        it('accepts $in arrays', async () => {
          await expect(
            adapter.listEntities(
              { metadataFilter: { state: { $in: ['active', 'pending'] } } },
              {},
              {},
            ),
          ).resolves.toBeTruthy();
        });

        it('rejects keys starting with $', async () => {
          await expect(
            adapter.listEntities({ metadataFilter: { $where: 'x' } }, {}, {}),
          ).rejects.toThrow(/must not start with/);
        });

        it('rejects keys containing a dot', async () => {
          await expect(
            adapter.listEntities({ metadataFilter: { 'nested.field': 'x' } }, {}, {}),
          ).rejects.toThrow(/must not start with .* or contain/);
        });

        it('rejects unknown operator shapes', async () => {
          await expect(
            adapter.listEntities(
              { metadataFilter: { state: { $regex: '.*' } } },
              {},
              {},
            ),
          ).rejects.toThrow(/only literal values or \{\$in/);
        });

        it('rejects multi-key operator objects', async () => {
          await expect(
            adapter.listEntities(
              { metadataFilter: { state: { $in: ['x'], $regex: '.*' } } },
              {},
              {},
            ),
          ).rejects.toThrow(/only literal values or \{\$in/);
        });

        it('rejects $in with non-array values', async () => {
          await expect(
            adapter.listEntities(
              { metadataFilter: { state: { $in: 'not-an-array' as never } } },
              {},
              {},
            ),
          ).rejects.toThrow(/\$in must be an array/);
        });

        it('rejects $in arrays containing objects', async () => {
          await expect(
            adapter.listEntities(
              { metadataFilter: { state: { $in: [{ bad: 'value' }] } } },
              {},
              {},
            ),
          ).rejects.toThrow(/array must contain only primitives/);
        });
      });
    });
  });

  // ==========================================================================
  // Facts
  // ==========================================================================

  describe('facts', () => {
    let a: IEntity;
    let b: IEntity;
    let c: IEntity;

    beforeEach(async () => {
      a = await adapter.createEntity(entityInput({ displayName: 'A' }));
      b = await adapter.createEntity(entityInput({ displayName: 'B' }));
      c = await adapter.createEntity(entityInput({ displayName: 'C' }));
    });

    it('create/get round-trip', async () => {
      const f = await adapter.createFact(factInput(a.id));
      expect(f.id).toBeTruthy();
      const got = await adapter.getFact(f.id, {});
      expect(got?.subjectId).toBe(a.id);
    });

    it('createFacts batch', async () => {
      const out = await adapter.createFacts([factInput(a.id), factInput(a.id)]);
      expect(out).toHaveLength(2);
      expect(await adapter.getFact(out[0]!.id, {})).not.toBeNull();
      expect(await adapter.getFact(out[1]!.id, {})).not.toBeNull();
    });

    it('updateFact patches fields', async () => {
      const f = await adapter.createFact(factInput(a.id));
      await adapter.updateFact(f.id, { archived: true }, {});
      const got = await adapter.getFact(f.id, {});
      expect(got?.archived).toBe(true);
    });

    it('findFacts by subjectId', async () => {
      const f1 = await adapter.createFact(factInput(a.id));
      await adapter.createFact(factInput(b.id));
      const res = await adapter.findFacts({ subjectId: a.id }, {}, {});
      expect(res.items.map((f) => f.id)).toEqual([f1.id]);
    });

    it('findFacts by predicates[]', async () => {
      const f1 = await adapter.createFact(factInput(a.id, { predicate: 'knows' }));
      const f2 = await adapter.createFact(factInput(a.id, { predicate: 'works_at' }));
      await adapter.createFact(factInput(a.id, { predicate: 'other' }));
      const res = await adapter.findFacts({ predicates: ['knows', 'works_at'] }, {}, {});
      expect(res.items.map((f) => f.id).sort()).toEqual([f1.id, f2.id].sort());
    });

    it('findFacts hides archived by default', async () => {
      const live = await adapter.createFact(factInput(a.id));
      await adapter.createFact(factInput(a.id, { archived: true }));
      const res = await adapter.findFacts({ subjectId: a.id }, {}, {});
      expect(res.items.map((f) => f.id)).toEqual([live.id]);
    });

    it('findFacts archived:true returns only archived', async () => {
      await adapter.createFact(factInput(a.id));
      const archived = await adapter.createFact(factInput(a.id, { archived: true }));
      const res = await adapter.findFacts({ subjectId: a.id, archived: true }, {}, {});
      expect(res.items.map((f) => f.id)).toEqual([archived.id]);
    });

    it('findFacts minConfidence — missing confidence treated as 1.0', async () => {
      await adapter.createFact(factInput(a.id, { confidence: 0.3 }));
      const highConf = await adapter.createFact(factInput(a.id, { confidence: 0.9 }));
      const noConf = await adapter.createFact(factInput(a.id));
      const res = await adapter.findFacts({ minConfidence: 0.5 }, {}, {});
      expect(res.items.map((f) => f.id).sort()).toEqual([highConf.id, noConf.id].sort());
    });

    it('findFacts asOf filters by validity window', async () => {
      const tomorrow = new Date(Date.now() + 86_400_000);
      const farFuture = new Date(Date.now() + 100 * 86_400_000);
      const fut = await adapter.createFact(factInput(a.id, { validFrom: tomorrow }));

      const early = await adapter.findFacts({ subjectId: a.id, asOf: new Date() }, {}, {});
      expect(early.items).toHaveLength(0);
      const later = await adapter.findFacts({ subjectId: a.id, asOf: farFuture }, {}, {});
      expect(later.items).toHaveLength(1);
      expect(later.items[0]!.id).toBe(fut.id);
    });

    it('countFacts matches findFacts count', async () => {
      await adapter.createFact(factInput(a.id));
      await adapter.createFact(factInput(a.id));
      expect(await adapter.countFacts({ subjectId: a.id }, {})).toBe(2);
    });

    it('findFacts pagination with cursor', async () => {
      for (let i = 0; i < 5; i++) await adapter.createFact(factInput(a.id));
      const p1 = await adapter.findFacts({ subjectId: a.id }, { limit: 2 }, {});
      expect(p1.items).toHaveLength(2);
      const p2 = await adapter.findFacts(
        { subjectId: a.id },
        { limit: 2, cursor: p1.nextCursor },
        {},
      );
      expect(p2.items).toHaveLength(2);
      const p3 = await adapter.findFacts(
        { subjectId: a.id },
        { limit: 2, cursor: p2.nextCursor },
        {},
      );
      expect(p3.items).toHaveLength(1);
      expect(p3.nextCursor).toBeUndefined();
    });

    it('findFacts orderBy observedAt desc', async () => {
      const day = (n: number) => new Date(2026, 0, n);
      const f1 = await adapter.createFact(factInput(a.id, { observedAt: day(1) }));
      const f2 = await adapter.createFact(factInput(a.id, { observedAt: day(3) }));
      const f3 = await adapter.createFact(factInput(a.id, { observedAt: day(2) }));
      const res = await adapter.findFacts(
        { subjectId: a.id },
        { orderBy: { field: 'observedAt', direction: 'desc' } },
        {},
      );
      expect(res.items.map((f) => f.id)).toEqual([f2.id, f3.id, f1.id]);
    });

    // Suppress unused-var warnings for b, c
    it('b and c entities exist for use in relation tests below', () => {
      expect(b.id).toBeTruthy();
      expect(c.id).toBeTruthy();
    });
  });

  // ==========================================================================
  // Scope visibility
  // ==========================================================================

  describe('scope visibility pushed to Mongo filter', () => {
    it('global record visible to every scope', async () => {
      const e = await adapter.createEntity(entityInput());
      expect(await adapter.getEntity(e.id, {})).not.toBeNull();
      expect(await adapter.getEntity(e.id, { groupId: 'any' })).not.toBeNull();
      expect(await adapter.getEntity(e.id, { userId: 'u1' })).not.toBeNull();
    });

    it('group-scoped record only visible to matching groupId', async () => {
      const e = await adapter.createEntity(entityInput({ groupId: 'g1' }));
      expect(await adapter.getEntity(e.id, { groupId: 'g1' })).not.toBeNull();
      expect(await adapter.getEntity(e.id, { groupId: 'g2' })).toBeNull();
      expect(await adapter.getEntity(e.id, {})).toBeNull();
    });

    it('user+group requires both to match', async () => {
      const e = await adapter.createEntity(entityInput({ groupId: 'g1', ownerId: 'u1' }));
      expect(await adapter.getEntity(e.id, { groupId: 'g1', userId: 'u1' })).not.toBeNull();
      expect(await adapter.getEntity(e.id, { groupId: 'g1', userId: 'u2' })).toBeNull();
      expect(await adapter.getEntity(e.id, { groupId: 'g2', userId: 'u1' })).toBeNull();
    });
  });

  // ==========================================================================
  // Semantic search — cursor-cosine fallback path
  // ==========================================================================

  describe('semanticSearch fallback', () => {
    let a: IEntity;

    beforeEach(async () => {
      a = await adapter.createEntity(entityInput());
      await adapter.createFact(factInput(a.id, { embedding: [1, 0, 0] }));
      await adapter.createFact(factInput(a.id, { embedding: [0, 0, 1] }));
      await adapter.createFact(factInput(a.id, { embedding: [1, 0] })); // wrong dim
      await adapter.createFact(factInput(a.id)); // no embedding
    });

    it('ranks by cosine similarity (no vectorIndexName)', async () => {
      const res = await adapter.semanticSearch([1, 0, 0], {}, { topK: 2 }, {});
      expect(res[0]!.score).toBeCloseTo(1, 5);
      expect(res[0]!.fact.embedding).toEqual([1, 0, 0]);
    });

    it('skips wrong-dim + unembedded', async () => {
      const res = await adapter.semanticSearch([1, 0, 0], {}, { topK: 10 }, {});
      expect(res.every((r) => r.fact.embedding?.length === 3)).toBe(true);
    });
  });

  // ==========================================================================
  // Graph traverse — iterative fallback
  // ==========================================================================

  describe('traverse (iterative fallback)', () => {
    it('walks out edges', async () => {
      const a = await adapter.createEntity(entityInput({ displayName: 'A' }));
      const b = await adapter.createEntity(entityInput({ displayName: 'B' }));
      await adapter.createFact(factInput(a.id, { predicate: 'knows', objectId: b.id }));
      const n = await adapter.traverse(a.id, { direction: 'out', maxDepth: 1 }, {});
      expect(n.nodes.map((x) => x.entity.id).sort()).toEqual([a.id, b.id].sort());
      expect(n.edges).toHaveLength(1);
    });
  });

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  describe('lifecycle', () => {
    it('destroy flips flag and blocks further operations', async () => {
      adapter.destroy();
      expect(adapter.isDestroyed).toBe(true);
      await expect(adapter.getEntity('x', {})).rejects.toThrow(/destroyed/);
    });

    it('shutdown calls destroy', async () => {
      await adapter.shutdown();
      expect(adapter.isDestroyed).toBe(true);
    });

    it('collection lifecycle is caller-owned (destroy does not clear collection)', async () => {
      await adapter.createEntity(entityInput());
      adapter.destroy();
      expect(entColl.all).toHaveLength(1);
    });
  });

  // ==========================================================================
  // ensureIndexes
  // ==========================================================================

  describe('ensureIndexes', () => {
    it('creates the expected indexes when collections support createIndex', async () => {
      await ensureIndexes({ entities: entColl, facts: factColl });
      const entIdx = entColl.createdIndexes.map((i) => i.name);
      const factIdx = factColl.createdIndexes.map((i) => i.name);
      // No more memory_ent_pk / memory_fact_pk — _id is the native primary key.
      expect(entIdx).toContain('memory_ent_ident');
      expect(entIdx).toContain('memory_ent_list');
      expect(entIdx).toContain('memory_ent_tasks');
      expect(entIdx).toContain('memory_ent_events');
      expect(entIdx).not.toContain('memory_ent_pk');
      expect(factIdx).toContain('memory_fact_by_subject');
      expect(factIdx).toContain('memory_fact_by_object');
      expect(factIdx).toContain('memory_fact_by_context');
      expect(factIdx).toContain('memory_fact_recent_pred');
      expect(factIdx).not.toContain('memory_fact_pk');
    });

    it('is a no-op on collections without createIndex', async () => {
      const minimal = new MinimalFakeMongoCollection<IEntity>();
      const minimalF = new MinimalFakeMongoCollection<IFact>();
      await expect(
        ensureIndexes({ entities: minimal, facts: minimalF }),
      ).resolves.toBeUndefined();
    });
  });
});
