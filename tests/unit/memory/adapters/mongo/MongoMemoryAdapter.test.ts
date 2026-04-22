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
    permissions: overrides.permissions,
  };
}

/** Scope-private: group can read (default), world cannot. */
const PRIVATE_PERMS = { world: 'none' as const };
/** Owner-only: neither group nor world can read. */
const OWNER_ONLY_PERMS = { group: 'none' as const, world: 'none' as const };

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
    permissions: overrides.permissions,
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

    describe('getEntities (batch)', () => {
      it('returns [] for empty input', async () => {
        expect(await adapter.getEntities([], {})).toEqual([]);
      });

      it('preserves input order across a scrambled id list', async () => {
        const a = await adapter.createEntity(entityInput({ displayName: 'A' }));
        const b = await adapter.createEntity(entityInput({ displayName: 'B' }));
        const c = await adapter.createEntity(entityInput({ displayName: 'C' }));

        const out = await adapter.getEntities([c.id, a.id, b.id], {});
        expect(out).toHaveLength(3);
        expect(out[0]?.displayName).toBe('C');
        expect(out[1]?.displayName).toBe('A');
        expect(out[2]?.displayName).toBe('B');
      });

      it('null-pads missing ids', async () => {
        const a = await adapter.createEntity(entityInput({ displayName: 'A' }));
        const out = await adapter.getEntities(['ghost-1', a.id, 'ghost-2'], {});
        expect(out[0]).toBeNull();
        expect(out[1]?.displayName).toBe('A');
        expect(out[2]).toBeNull();
      });

      it('hides archived entities', async () => {
        const e = await adapter.createEntity(entityInput());
        await adapter.archiveEntity(e.id, {});
        const [got] = await adapter.getEntities([e.id], {});
        expect(got).toBeNull();
      });

      it('applies scope visibility filter (owner-only invisible to other users)', async () => {
        const priv = await adapter.createEntity(
          entityInput({ displayName: 'Private', ownerId: 'alice', permissions: OWNER_ONLY_PERMS }),
        );
        const pub = await adapter.createEntity(
          entityInput({ displayName: 'Public', ownerId: 'alice' }),
        );
        const bobView = await adapter.getEntities([priv.id, pub.id], { userId: 'bob' });
        expect(bobView[0]).toBeNull();
        expect(bobView[1]?.displayName).toBe('Public');
        const aliceView = await adapter.getEntities([priv.id, pub.id], { userId: 'alice' });
        expect(aliceView[0]?.displayName).toBe('Private');
        expect(aliceView[1]?.displayName).toBe('Public');
      });
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
          entityInput({
            groupId: 'g1',
            identifiers: [ident('email', 'shared@x.com')],
            permissions: PRIVATE_PERMS,
          }),
        );
        await adapter.createEntity(
          entityInput({
            groupId: 'g2',
            identifiers: [ident('email', 'shared@x.com')],
            permissions: PRIVATE_PERMS,
          }),
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

    it('findFacts minConfidence (H6: strict — legacy un-scored facts excluded)', async () => {
      await adapter.createFact(factInput(a.id, { confidence: 0.3 }));
      const highConf = await adapter.createFact(factInput(a.id, { confidence: 0.9 }));
      // Legacy un-scored fact — H6: excluded from confidence-filtered queries.
      await adapter.createFact(factInput(a.id));
      const res = await adapter.findFacts({ minConfidence: 0.5 }, {}, {});
      expect(res.items.map((f) => f.id)).toEqual([highConf.id]);
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
      const e = await adapter.createEntity(
        entityInput({ groupId: 'g1', permissions: PRIVATE_PERMS }),
      );
      expect(await adapter.getEntity(e.id, { groupId: 'g1' })).not.toBeNull();
      expect(await adapter.getEntity(e.id, { groupId: 'g2' })).toBeNull();
      expect(await adapter.getEntity(e.id, {})).toBeNull();
    });

    it('user+group requires both to match', async () => {
      const e = await adapter.createEntity(
        entityInput({ groupId: 'g1', ownerId: 'u1', permissions: OWNER_ONLY_PERMS }),
      );
      expect(await adapter.getEntity(e.id, { groupId: 'g1', userId: 'u1' })).not.toBeNull();
      expect(await adapter.getEntity(e.id, { groupId: 'g1', userId: 'u2' })).toBeNull();
      // u1 is the owner — visible even without group match.
      expect(await adapter.getEntity(e.id, { groupId: 'g2', userId: 'u1' })).not.toBeNull();
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
  // Semantic entity search — cursor-scan fallback
  // ==========================================================================

  describe('semanticSearchEntities cursor-scan fallback', () => {
    /** Seed an entity and write identityEmbedding via updateEntity (version bump). */
    async function seedWithEmbedding(
      overrides: Partial<NewEntity>,
      embedding: number[] | undefined,
    ): Promise<IEntity> {
      const e = await adapter.createEntity(entityInput(overrides));
      if (embedding !== undefined) {
        await adapter.updateEntity({ ...e, identityEmbedding: embedding, version: 2 });
        return (await adapter.getEntity(e.id, {}))!;
      }
      return e;
    }

    it('ranks entities by cosine similarity over identityEmbedding', async () => {
      const alpha = await seedWithEmbedding(
        { displayName: 'Alpha', type: 'organization' },
        [1, 0, 0],
      );
      const beta = await seedWithEmbedding(
        { displayName: 'Beta', type: 'organization' },
        [0.8, 0.2, 0],
      );
      await seedWithEmbedding({ displayName: 'Gamma', type: 'organization' }, [0, 0, 1]);

      const res = await adapter.semanticSearchEntities(
        [1, 0, 0],
        { type: 'organization' },
        { topK: 2 },
        {},
      );
      expect(res).toHaveLength(2);
      expect(res[0]!.entity.id).toBe(alpha.id);
      expect(res[0]!.score).toBeCloseTo(1, 5);
      expect(res[1]!.entity.id).toBe(beta.id);
    });

    it('skips entities without identityEmbedding and mismatched dimensions', async () => {
      await seedWithEmbedding({ displayName: 'Bare' }, undefined);
      await seedWithEmbedding({ displayName: 'Short' }, [1, 0]); // wrong dim
      const ok = await seedWithEmbedding({ displayName: 'Good' }, [1, 0, 0]);
      const res = await adapter.semanticSearchEntities([1, 0, 0], {}, { topK: 10 }, {});
      expect(res.map((r) => r.entity.id)).toEqual([ok.id]);
    });

    it('excludes archived entities', async () => {
      const live = await seedWithEmbedding({ displayName: 'Live' }, [1, 0, 0]);
      const gone = await seedWithEmbedding({ displayName: 'Gone' }, [1, 0, 0]);
      await adapter.archiveEntity(gone.id, {});
      const res = await adapter.semanticSearchEntities([1, 0, 0], {}, { topK: 10 }, {});
      expect(res.map((r) => r.entity.id)).toEqual([live.id]);
    });

    it('applies type filter (single + union)', async () => {
      const org = await seedWithEmbedding(
        { displayName: 'Alpha', type: 'organization' },
        [1, 0, 0],
      );
      const topic = await seedWithEmbedding({ displayName: 'Alpha', type: 'topic' }, [1, 0, 0]);
      await seedWithEmbedding({ displayName: 'Alpha', type: 'person' }, [1, 0, 0]);

      const single = await adapter.semanticSearchEntities(
        [1, 0, 0],
        { type: 'organization' },
        { topK: 10 },
        {},
      );
      expect(single.map((r) => r.entity.id)).toEqual([org.id]);

      const union = await adapter.semanticSearchEntities(
        [1, 0, 0],
        { types: ['organization', 'topic'] },
        { topK: 10 },
        {},
      );
      expect(new Set(union.map((r) => r.entity.id))).toEqual(new Set([org.id, topic.id]));
    });

    it('applies scope filter — cross-group private entities hidden', async () => {
      await seedWithEmbedding(
        { displayName: 'Secret', groupId: 'g2', permissions: PRIVATE_PERMS },
        [1, 0, 0],
      );
      const mine = await seedWithEmbedding(
        { displayName: 'Mine', groupId: 'g1' },
        [1, 0, 0],
      );
      const res = await adapter.semanticSearchEntities(
        [1, 0, 0],
        {},
        { topK: 10 },
        { groupId: 'g1' },
      );
      expect(res.map((r) => r.entity.id)).toEqual([mine.id]);
    });

    it('applies minScore floor', async () => {
      const close = await seedWithEmbedding({ displayName: 'Close' }, [1, 0, 0]);
      await seedWithEmbedding({ displayName: 'Far' }, [0, 1, 0]); // cosine 0
      const res = await adapter.semanticSearchEntities(
        [1, 0, 0],
        {},
        { topK: 10, minScore: 0.5 },
        {},
      );
      expect(res.map((r) => r.entity.id)).toEqual([close.id]);
    });

    it('uses find() not aggregate() when entityVectorIndexName is unset', async () => {
      await seedWithEmbedding({ displayName: 'Any' }, [1, 0, 0]);
      const before = entColl.aggregateCalls;
      await adapter.semanticSearchEntities([1, 0, 0], {}, { topK: 1 }, {});
      expect(entColl.aggregateCalls).toBe(before);
    });
  });

  // ==========================================================================
  // Semantic entity search — Atlas $vectorSearch path
  // ==========================================================================

  describe('semanticSearchEntities Atlas $vectorSearch path', () => {
    let atlasEnts: FakeMongoCollection<IEntity>;
    let atlasFacts: FakeMongoCollection<IFact>;
    let atlasAdapter: MongoMemoryAdapter;

    beforeEach(() => {
      atlasEnts = new FakeMongoCollection<IEntity>('entities');
      atlasFacts = new FakeMongoCollection<IFact>('facts');
      atlasAdapter = new MongoMemoryAdapter({
        entities: atlasEnts,
        facts: atlasFacts,
        factsCollectionName: 'facts',
        entityVectorIndexName: 'entities_vector',
      });
    });

    afterEach(() => {
      if (!atlasAdapter.isDestroyed) atlasAdapter.destroy();
    });

    it('dispatches to aggregate() when entityVectorIndexName is set', async () => {
      const e = await atlasAdapter.createEntity(entityInput({ type: 'organization' }));
      await atlasAdapter.updateEntity({ ...e, identityEmbedding: [1, 0, 0], version: 2 });

      const before = atlasEnts.aggregateCalls;
      const res = await atlasAdapter.semanticSearchEntities(
        [1, 0, 0],
        { type: 'organization' },
        { topK: 5 },
        {},
      );
      expect(atlasEnts.aggregateCalls).toBe(before + 1);
      expect(res).toHaveLength(1);
      expect(res[0]!.entity.id).toBe(e.id);
      expect(res[0]!.score).toBeCloseTo(1, 5);
    });
  });

  // ==========================================================================
  // ensureVectorSearchIndexes — index management helper
  // ==========================================================================

  describe('ensureVectorSearchIndexes', () => {
    it('creates facts + entities vector search indexes with expected definition', async () => {
      // waitUntilReady=false to avoid polling the fake's PENDING default forever.
      await adapter.ensureVectorSearchIndexes({
        dimensions: 1536,
        waitUntilReady: false,
      });
      const factDefs = factColl.createSearchIndexCalls.filter((d) => d.name === 'facts_vector');
      const entDefs = entColl.createSearchIndexCalls.filter((d) => d.name === 'entities_vector');
      expect(factDefs).toHaveLength(1);
      expect(entDefs).toHaveLength(1);
      expect(factDefs[0]!.type).toBe('vectorSearch');
      expect(factDefs[0]!.definition.fields![0]).toEqual({
        type: 'vector',
        path: 'embedding',
        numDimensions: 1536,
        similarity: 'cosine',
      });
      expect(entDefs[0]!.definition.fields![0]).toEqual({
        type: 'vector',
        path: 'identityEmbedding',
        numDimensions: 1536,
        similarity: 'cosine',
      });
    });

    it('skips creation when index already present (idempotent)', async () => {
      // First run seeds both indexes.
      await adapter.ensureVectorSearchIndexes({ dimensions: 8, waitUntilReady: false });
      expect(factColl.createSearchIndexCalls).toHaveLength(1);
      expect(entColl.createSearchIndexCalls).toHaveLength(1);

      // Second run must be a no-op for creation.
      await adapter.ensureVectorSearchIndexes({ dimensions: 8, waitUntilReady: false });
      expect(factColl.createSearchIndexCalls).toHaveLength(1);
      expect(entColl.createSearchIndexCalls).toHaveLength(1);
    });

    it('honors custom index names (factsIndexName / entitiesIndexName)', async () => {
      await adapter.ensureVectorSearchIndexes({
        dimensions: 4,
        factsIndexName: 'custom_facts_idx',
        entitiesIndexName: 'custom_ents_idx',
        waitUntilReady: false,
      });
      expect(factColl.createSearchIndexCalls[0]!.name).toBe('custom_facts_idx');
      expect(entColl.createSearchIndexCalls[0]!.name).toBe('custom_ents_idx');
    });

    it('skips facts when factsIndexName is null', async () => {
      await adapter.ensureVectorSearchIndexes({
        dimensions: 4,
        factsIndexName: null,
        waitUntilReady: false,
      });
      expect(factColl.createSearchIndexCalls).toHaveLength(0);
      expect(entColl.createSearchIndexCalls).toHaveLength(1);
    });

    it('accepts non-default similarity', async () => {
      await adapter.ensureVectorSearchIndexes({
        dimensions: 4,
        similarity: 'dotProduct',
        waitUntilReady: false,
      });
      expect(
        (factColl.createSearchIndexCalls[0]!.definition.fields![0] as { similarity: string })
          .similarity,
      ).toBe('dotProduct');
    });

    it('waits for queryable=true when waitUntilReady=true', async () => {
      // Script lifecycle: first list = empty (triggers create), then PENDING,
      // then READY. Each call consumes one snapshot.
      factColl.searchIndexSequence = [
        [], // list before create
        [{ name: 'facts_vector', status: 'PENDING', queryable: false }],
        [{ name: 'facts_vector', status: 'READY', queryable: true }],
      ];
      entColl.searchIndexSequence = [
        [],
        [{ name: 'entities_vector', status: 'PENDING', queryable: false }],
        [{ name: 'entities_vector', status: 'READY', queryable: true }],
      ];
      await adapter.ensureVectorSearchIndexes({
        dimensions: 4,
        waitUntilReady: true,
        readyPollMs: 1,
        readyTimeoutMs: 5_000,
      });
      // Reached READY for both.
      expect(factColl.listSearchIndexCalls).toBeGreaterThanOrEqual(3);
      expect(entColl.listSearchIndexCalls).toBeGreaterThanOrEqual(3);
    });

    it('throws when Atlas reports FAILED status', async () => {
      factColl.searchIndexSequence = [
        [], // before create
        [{ name: 'facts_vector', status: 'FAILED', queryable: false }],
      ];
      await expect(
        adapter.ensureVectorSearchIndexes({
          dimensions: 4,
          waitUntilReady: true,
          readyPollMs: 1,
          readyTimeoutMs: 2_000,
          entitiesIndexName: null, // isolate to facts
        }),
      ).rejects.toThrow(/FAILED/);
    });

    it('times out with an actionable error', async () => {
      // Never becomes queryable within the deadline.
      factColl.searchIndexSequence = [[]]; // triggers create, then polls real state
      await expect(
        adapter.ensureVectorSearchIndexes({
          dimensions: 4,
          waitUntilReady: true,
          readyPollMs: 1,
          readyTimeoutMs: 10,
          entitiesIndexName: null,
        }),
      ).rejects.toThrow(/timed out/);
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
  // Native $graphLookup — pipeline-shape assertions for the four fixes
  // ==========================================================================

  describe('traverse (native $graphLookup)', () => {
    let nativeAdapter: MongoMemoryAdapter;
    let nativeFacts: FakeMongoCollection<IFact>;
    let nativeEnts: FakeMongoCollection<IEntity>;

    beforeEach(() => {
      nativeEnts = new FakeMongoCollection<IEntity>('entities');
      nativeFacts = new FakeMongoCollection<IFact>('facts');
      nativeAdapter = new MongoMemoryAdapter({
        entities: nativeEnts,
        facts: nativeFacts,
        factsCollectionName: 'facts',
        useNativeGraphLookup: true,
      });
    });

    afterEach(() => {
      if (!nativeAdapter.isDestroyed) nativeAdapter.destroy();
    });

    it('direction="both" FALLS BACK to generic traversal (co-subject correctness) — no aggregate call', async () => {
      const anton = await nativeAdapter.createEntity(entityInput({ displayName: 'Anton' }));
      const john = await nativeAdapter.createEntity(entityInput({ displayName: 'John' }));
      const ew = await nativeAdapter.createEntity(entityInput({ displayName: 'Everworker' }));
      await nativeAdapter.createFact(factInput(anton.id, { predicate: 'works_at', objectId: ew.id }));
      await nativeAdapter.createFact(factInput(john.id, { predicate: 'works_at', objectId: ew.id }));

      const before = nativeFacts.aggregateCalls;
      const res = await nativeAdapter.traverse(
        anton.id,
        { direction: 'both', maxDepth: 2, predicates: ['works_at'] },
        {},
      );
      // aggregate NOT called for direction=both; generic path used findFacts.
      expect(nativeFacts.aggregateCalls).toBe(before);
      // "Who works with Anton?" — John must be discovered at depth 2.
      const ids = new Set(res.nodes.map((n) => n.entity.id));
      expect(ids.has(john.id)).toBe(true);
      expect(ids.has(ew.id)).toBe(true);
    });

    it('maxDepth=1 on direction="out" skips $graphLookup entirely (off-by-one fix)', async () => {
      const a = await nativeAdapter.createEntity(entityInput({ displayName: 'A' }));
      const b = await nativeAdapter.createEntity(entityInput({ displayName: 'B' }));
      await nativeAdapter.createFact(factInput(a.id, { predicate: 'knows', objectId: b.id }));

      let captured: unknown[] | null = null;
      const origAggregate = nativeFacts.aggregate.bind(nativeFacts);
      nativeFacts.aggregate = async (pipeline: unknown[]) => {
        captured = pipeline;
        return origAggregate(pipeline);
      };

      await nativeAdapter.traverse(a.id, { direction: 'out', maxDepth: 1 }, {});
      // Pipeline should be $match only — no $graphLookup stage.
      expect(captured).not.toBeNull();
      const hasGraphLookup = captured!.some(
        (stage) => typeof stage === 'object' && stage !== null && '$graphLookup' in stage,
      );
      expect(hasGraphLookup).toBe(false);
    });

    it('maxDepth=3 on direction="out" uses $graphLookup with maxDepth=1 (not 2)', async () => {
      const a = await nativeAdapter.createEntity(entityInput({ displayName: 'A' }));
      await nativeAdapter.createFact(factInput(a.id, { predicate: 'knows', objectId: a.id + '_x' }));

      let captured: unknown[] | null = null;
      const origAggregate = nativeFacts.aggregate.bind(nativeFacts);
      nativeFacts.aggregate = async (pipeline: unknown[]) => {
        captured = pipeline;
        return origAggregate(pipeline);
      };

      await nativeAdapter.traverse(a.id, { direction: 'out', maxDepth: 3 }, {});
      expect(captured).not.toBeNull();
      const graphStage = captured!.find(
        (stage) => typeof stage === 'object' && stage !== null && '$graphLookup' in stage,
      ) as { $graphLookup: { maxDepth: number } } | undefined;
      expect(graphStage).toBeDefined();
      // outer $match = depth 1. graphLookup should give depths 2..3 = 2 levels
      // = graphLookup.maxDepth = 1 (gives levels 0..1 → overall 2..3).
      expect(graphStage!.$graphLookup.maxDepth).toBe(1);
    });

    it('asOf is pushed into both $match and $graphLookup restrictSearchWithMatch', async () => {
      const a = await nativeAdapter.createEntity(entityInput({ displayName: 'A' }));
      await nativeAdapter.createFact(factInput(a.id, { predicate: 'knows', objectId: a.id + '_x' }));

      let captured: unknown[] | null = null;
      const origAggregate = nativeFacts.aggregate.bind(nativeFacts);
      nativeFacts.aggregate = async (pipeline: unknown[]) => {
        captured = pipeline;
        return origAggregate(pipeline);
      };

      const asOf = new Date('2024-01-15T00:00:00Z');
      await nativeAdapter.traverse(a.id, { direction: 'out', maxDepth: 3, asOf }, {});
      expect(captured).not.toBeNull();
      const stringified = JSON.stringify(captured);
      // Outer $match contains a createdAt $lte clause with our asOf.
      expect(stringified).toContain('createdAt');
      expect(stringified).toContain(asOf.toISOString());
      // Both validFrom and validUntil clauses should appear.
      expect(stringified).toContain('validFrom');
      expect(stringified).toContain('validUntil');
    });

    it('opts.limit caps the returned edges (not just nodes)', async () => {
      const a = await nativeAdapter.createEntity(entityInput({ displayName: 'A' }));
      // Build 10 outbound edges.
      for (let i = 0; i < 10; i++) {
        const b = await nativeAdapter.createEntity(entityInput({ displayName: `B${i}` }));
        await nativeAdapter.createFact(factInput(a.id, { predicate: 'knows', objectId: b.id }));
      }
      const res = await nativeAdapter.traverse(
        a.id,
        { direction: 'out', maxDepth: 1, limit: 3 },
        {},
      );
      expect(res.edges.length).toBeLessThanOrEqual(3);
    });

    // L-1 — predicates filter applies at depth 1 too (regression test for the
    // pre-existing bug where outer $match omitted the predicates clause).
    it('filters depth-1 edges by predicates', async () => {
      const a = await nativeAdapter.createEntity(entityInput({ displayName: 'A' }));
      const b = await nativeAdapter.createEntity(entityInput({ displayName: 'B' }));
      const c = await nativeAdapter.createEntity(entityInput({ displayName: 'C' }));
      await nativeAdapter.createFact(factInput(a.id, { predicate: 'works_at', objectId: b.id }));
      await nativeAdapter.createFact(factInput(a.id, { predicate: 'knows', objectId: c.id }));

      const res = await nativeAdapter.traverse(
        a.id,
        { direction: 'out', maxDepth: 1, predicates: ['works_at'] },
        {},
      );
      // Only the works_at edge survives the filter — 'knows' is excluded.
      expect(res.edges.length).toBe(1);
      expect(res.edges[0]!.fact.predicate).toBe('works_at');
    });

    // M-2 — edges and nodes must stay consistent under tight limits.
    it('edges and nodes are consistent under a tight limit', async () => {
      const a = await nativeAdapter.createEntity(entityInput({ displayName: 'A' }));
      for (let i = 0; i < 5; i++) {
        const b = await nativeAdapter.createEntity(entityInput({ displayName: `B${i}` }));
        await nativeAdapter.createFact(factInput(a.id, { predicate: 'knows', objectId: b.id }));
      }
      const res = await nativeAdapter.traverse(
        a.id,
        { direction: 'out', maxDepth: 1, limit: 3 },
        {},
      );
      expect(res.edges.length).toBeLessThanOrEqual(3);
      // Every surviving edge's from/to must appear in nodes.
      const nodeIds = new Set(res.nodes.map((n) => n.entity.id));
      for (const edge of res.edges) {
        expect(nodeIds.has(edge.from)).toBe(true);
        expect(nodeIds.has(edge.to)).toBe(true);
      }
    });

    // M-1 — depth-ascending slice. With multiple outer-match rows and some
    // having descendants, a tight limit must keep depth-1 edges (nearest)
    // instead of sacrificing siblings to keep one row's deep chain.
    it('prefers shallow edges when limit forces a cut', async () => {
      const a = await nativeAdapter.createEntity(entityInput({ displayName: 'A' }));
      const b = await nativeAdapter.createEntity(entityInput({ displayName: 'B' }));
      const c = await nativeAdapter.createEntity(entityInput({ displayName: 'C' }));
      const d = await nativeAdapter.createEntity(entityInput({ displayName: 'D' }));
      // Two depth-1 edges from A, plus a depth-2 from B.
      await nativeAdapter.createFact(factInput(a.id, { predicate: 'knows', objectId: b.id }));
      await nativeAdapter.createFact(factInput(a.id, { predicate: 'knows', objectId: c.id }));
      await nativeAdapter.createFact(factInput(b.id, { predicate: 'knows', objectId: d.id }));

      const res = await nativeAdapter.traverse(
        a.id,
        { direction: 'out', maxDepth: 2, limit: 2 },
        {},
      );
      expect(res.edges.length).toBe(2);
      // Both should be depth 1.
      for (const edge of res.edges) {
        expect(edge.depth).toBe(1);
      }
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

    it('creates owner-leading indexes for the permission-model owner shortcut', async () => {
      await ensureIndexes({ entities: entColl, facts: factColl });
      const entIdx = entColl.createdIndexes.map((i) => i.name);
      const factIdx = factColl.createdIndexes.map((i) => i.name);

      // Entities: owner-leading compounds.
      expect(entIdx).toContain('memory_ent_owner');
      expect(entIdx).toContain('memory_ent_owner_ident');

      // Facts: owner-leading compounds for subject + object lookups.
      expect(factIdx).toContain('memory_fact_owner_subject');
      expect(factIdx).toContain('memory_fact_owner_object');

      // Confirm the key specs — these indexes must start with ownerId so the
      // owner branch of scopeToFilter is sargable without a groupId constraint.
      const entOwner = entColl.createdIndexes.find((i) => i.name === 'memory_ent_owner');
      expect(entOwner).toBeDefined();
      expect(Object.keys(entOwner!.spec)[0]).toBe('ownerId');

      const factOwnerSubj = factColl.createdIndexes.find(
        (i) => i.name === 'memory_fact_owner_subject',
      );
      expect(factOwnerSubj).toBeDefined();
      expect(Object.keys(factOwnerSubj!.spec)[0]).toBe('ownerId');

      const factOwnerObj = factColl.createdIndexes.find(
        (i) => i.name === 'memory_fact_owner_object',
      );
      expect(factOwnerObj).toBeDefined();
      expect(Object.keys(factOwnerObj!.spec)[0]).toBe('ownerId');
    });

    it('is a no-op on collections without createIndex', async () => {
      const minimal = new MinimalFakeMongoCollection<IEntity>();
      const minimalF = new MinimalFakeMongoCollection<IFact>();
      await expect(
        ensureIndexes({ entities: minimal, facts: minimalF }),
      ).resolves.toBeUndefined();
    });

    it('MongoMemoryAdapter.ensureIndexes() delegates to the shared helper (H7)', async () => {
      const ents = new FakeMongoCollection<IEntity>();
      const facts2 = new FakeMongoCollection<IFact>();
      const a = new MongoMemoryAdapter({ entities: ents, facts: facts2 });
      await a.ensureIndexes();
      // At least the identifier + subject indexes must be present.
      expect(ents.createdIndexes.length).toBeGreaterThan(0);
      expect(facts2.createdIndexes.length).toBeGreaterThan(0);
      // Idempotent — safe to call twice.
      await a.ensureIndexes();
    });

    it('MemorySystem.ensureAdapterIndexes() routes through the adapter (H7)', async () => {
      const { MemorySystem } = await import('@/memory/MemorySystem.js');
      const ents = new FakeMongoCollection<IEntity>();
      const facts2 = new FakeMongoCollection<IFact>();
      const adapter2 = new MongoMemoryAdapter({ entities: ents, facts: facts2 });
      const mem = new MemorySystem({ store: adapter2 });
      await mem.ensureAdapterIndexes();
      expect(ents.createdIndexes.length).toBeGreaterThan(0);
      await mem.shutdown();
    });

    it('MemorySystem.ensureAdapterIndexes() is a no-op on InMemoryAdapter (H7)', async () => {
      const { MemorySystem } = await import('@/memory/MemorySystem.js');
      const { InMemoryAdapter } = await import('@/memory/adapters/inmemory/InMemoryAdapter.js');
      const mem = new MemorySystem({ store: new InMemoryAdapter() });
      await expect(mem.ensureAdapterIndexes()).resolves.toBeUndefined();
      await mem.shutdown();
    });
  });

  // ==========================================================================
  // Permissions — round-trip + patch
  // ==========================================================================

  describe('permissions round-trip', () => {
    it('persists entity permissions verbatim on create + read', async () => {
      const e = await adapter.createEntity(
        entityInput({
          displayName: 'Private',
          groupId: 'g1',
          ownerId: 'u1',
          permissions: { world: 'none' },
        }),
      );
      const back = await adapter.getEntity(e.id, { userId: 'u1' });
      expect(back).not.toBeNull();
      expect(back!.permissions).toEqual({ world: 'none' });
    });

    it('persists complex entity permissions (group:write, world:read)', async () => {
      const e = await adapter.createEntity(
        entityInput({
          displayName: 'Wiki',
          groupId: 'g1',
          ownerId: 'u1',
          permissions: { group: 'write', world: 'read' },
        }),
      );
      const back = await adapter.getEntity(e.id, { userId: 'u1' });
      expect(back!.permissions).toEqual({ group: 'write', world: 'read' });
    });

    it('persists fact permissions verbatim on create + read', async () => {
      const subj = await adapter.createEntity(entityInput({ ownerId: 'u1' }));
      const f = await adapter.createFact(
        factInput(subj.id, {
          predicate: 'secret_note',
          kind: 'atomic',
          value: 'x',
          ownerId: 'u1',
          permissions: { world: 'none', group: 'none' },
        }),
      );
      const back = await adapter.getFact(f.id, { userId: 'u1' });
      expect(back!.permissions).toEqual({ world: 'none', group: 'none' });
    });

    it('entity with undefined permissions round-trips as undefined (library defaults apply)', async () => {
      const e = await adapter.createEntity(entityInput({ ownerId: 'u1' }));
      const back = await adapter.getEntity(e.id, { userId: 'u1' });
      expect(back!.permissions).toBeUndefined();
    });

    it('updateFact can set permissions via patch', async () => {
      const subj = await adapter.createEntity(entityInput({ ownerId: 'u1' }));
      const f = await adapter.createFact(factInput(subj.id, { ownerId: 'u1' }));
      // Patch to set explicit permissions.
      await adapter.updateFact(
        f.id,
        { permissions: { world: 'none' } },
        { userId: 'u1' },
      );
      const back = await adapter.getFact(f.id, { userId: 'u1' });
      expect(back!.permissions).toEqual({ world: 'none' });
    });

    it('updateEntity preserves permissions on unrelated field updates', async () => {
      const e = await adapter.createEntity(
        entityInput({
          displayName: 'Original',
          ownerId: 'u1',
          permissions: { world: 'none' },
        }),
      );
      // Simulate a version-bump update that touches displayName but not perms.
      const next: IEntity = {
        ...e,
        displayName: 'Updated',
        version: e.version + 1,
        updatedAt: new Date(),
      };
      await adapter.updateEntity(next);
      const back = await adapter.getEntity(e.id, { userId: 'u1' });
      expect(back!.displayName).toBe('Updated');
      expect(back!.permissions).toEqual({ world: 'none' });
    });
  });
});
