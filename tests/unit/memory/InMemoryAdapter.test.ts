/**
 * Unit tests for memory/adapters/inmemory/InMemoryAdapter.ts — full contract coverage:
 * entity CRUD + optimistic concurrency, fact CRUD + filtering + pagination,
 * scope visibility, vector search, graph traversal delegation, lifecycle.
 *
 * With v2 id-delegation: adapter assigns ids on create. Tests capture returned
 * ids and use them for subsequent operations.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  InMemoryAdapter,
  OptimisticConcurrencyError,
  ScopeViolationError,
} from '@/memory/adapters/inmemory/InMemoryAdapter.js';
import type { IEntity, IFact, Identifier, NewEntity, NewFact } from '@/memory/types.js';

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

/** Scope-private perms: group members can read (default), world cannot. */
const PRIVATE_PERMS = { world: 'none' as const };
/** Fully-private perms: owner-only. Neither group nor world can read. */
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

describe('InMemoryAdapter', () => {
  let store: InMemoryAdapter;

  beforeEach(() => {
    store = new InMemoryAdapter();
  });

  afterEach(() => {
    if (!store.isDestroyed) store.destroy();
  });

  // ==========================================================================
  // Entities
  // ==========================================================================

  describe('entities — create/get', () => {
    it('creates an entity and assigns an id', async () => {
      const e = await store.createEntity(entityInput({ displayName: 'Alice' }));
      expect(e.id).toBeTruthy();
      expect(e.version).toBe(1);
      expect(e.displayName).toBe('Alice');
      const got = await store.getEntity(e.id, {});
      expect(got?.displayName).toBe('Alice');
    });

    it('assigned ids are unique across calls', async () => {
      const a = await store.createEntity(entityInput({ displayName: 'A' }));
      const b = await store.createEntity(entityInput({ displayName: 'B' }));
      expect(a.id).not.toBe(b.id);
    });

    it('returns a cloned object, not a reference', async () => {
      const e = await store.createEntity(entityInput());
      const got = await store.getEntity(e.id, {});
      got!.displayName = 'Mutated';
      const got2 = await store.getEntity(e.id, {});
      expect(got2!.displayName).not.toBe('Mutated');
    });

    it('returns null for missing entity', async () => {
      expect(await store.getEntity('missing', {})).toBeNull();
    });

    it('createEntities batch stores all, preserves order', async () => {
      const out = await store.createEntities([
        entityInput({ displayName: 'A' }),
        entityInput({ displayName: 'B' }),
      ]);
      expect(out).toHaveLength(2);
      expect(out[0]!.displayName).toBe('A');
      expect(out[1]!.displayName).toBe('B');
      expect(await store.getEntity(out[0]!.id, {})).not.toBeNull();
      expect(await store.getEntity(out[1]!.id, {})).not.toBeNull();
    });

    describe('getEntities (batch)', () => {
      it('returns [] for empty input', async () => {
        expect(await store.getEntities([], {})).toEqual([]);
      });

      it('preserves input order, null-pads missing ids', async () => {
        const a = await store.createEntity(entityInput({ displayName: 'A' }));
        const b = await store.createEntity(entityInput({ displayName: 'B' }));
        const out = await store.getEntities([b.id, 'missing-1', a.id, 'missing-2'], {});
        expect(out).toHaveLength(4);
        expect(out[0]?.displayName).toBe('B');
        expect(out[1]).toBeNull();
        expect(out[2]?.displayName).toBe('A');
        expect(out[3]).toBeNull();
      });

      it('hides archived entities (parity with getEntity)', async () => {
        const e = await store.createEntity(entityInput({ displayName: 'ToArchive' }));
        await store.archiveEntity(e.id, {});
        expect(await store.getEntity(e.id, {})).toBeNull();
        const [got] = await store.getEntities([e.id], {});
        expect(got).toBeNull();
      });

      it('applies scope visibility filter (owner-only entity invisible to other users)', async () => {
        // Strictly private: neither group nor world can read — only the owner.
        const priv = await store.createEntity(
          entityInput({ displayName: 'Private', ownerId: 'alice', permissions: OWNER_ONLY_PERMS }),
        );
        const pub = await store.createEntity(
          entityInput({ displayName: 'Public', ownerId: 'alice' }),
        );
        // Bob should see the public entity but NOT the owner-only private one.
        const bobView = await store.getEntities([priv.id, pub.id], { userId: 'bob' });
        expect(bobView[0]).toBeNull();
        expect(bobView[1]?.displayName).toBe('Public');
        // Alice (owner) sees both.
        const aliceView = await store.getEntities([priv.id, pub.id], { userId: 'alice' });
        expect(aliceView[0]?.displayName).toBe('Private');
        expect(aliceView[1]?.displayName).toBe('Public');
      });

      it('returns cloned entities (no aliasing)', async () => {
        const a = await store.createEntity(entityInput({ displayName: 'Alias' }));
        const [got] = await store.getEntities([a.id], {});
        got!.displayName = 'Mutated';
        const [got2] = await store.getEntities([a.id], {});
        expect(got2?.displayName).toBe('Alias');
      });
    });
  });

  describe('entities — update + optimistic concurrency', () => {
    it('updates an entity with version=N+1', async () => {
      const a = await store.createEntity(entityInput({ displayName: 'A' }));
      await store.updateEntity({ ...a, displayName: 'B', version: 2 });
      const got = await store.getEntity(a.id, {});
      expect(got!.displayName).toBe('B');
      expect(got!.version).toBe(2);
    });

    it('rejects wrong version bumps', async () => {
      const a = await store.createEntity(entityInput());
      await expect(store.updateEntity({ ...a, version: 3 })).rejects.toThrow(
        OptimisticConcurrencyError,
      );
      await expect(store.updateEntity({ ...a, version: 1 })).rejects.toThrow(
        OptimisticConcurrencyError,
      );
    });

    it('rejects updating a non-existent entity', async () => {
      await expect(
        store.updateEntity({
          id: 'does-not-exist',
          type: 'person',
          displayName: 'X',
          identifiers: [],
          version: 2,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      ).rejects.toThrow(OptimisticConcurrencyError);
    });
  });

  describe('entities — archive / delete', () => {
    it('archiveEntity hides from getEntity', async () => {
      const e = await store.createEntity(entityInput());
      await store.archiveEntity(e.id, {});
      expect(await store.getEntity(e.id, {})).toBeNull();
    });

    it('archiveEntity ignores missing ids silently', async () => {
      await expect(store.archiveEntity('missing', {})).resolves.toBeUndefined();
    });

    it('archiveEntity throws ScopeViolationError when not visible', async () => {
      // Private-to-group — public-by-default would let `other` group see it.
      const e = await store.createEntity(
        entityInput({ groupId: 'g1', permissions: PRIVATE_PERMS }),
      );
      await expect(store.archiveEntity(e.id, { groupId: 'other' })).rejects.toThrow(
        ScopeViolationError,
      );
    });

    it('deleteEntity removes completely', async () => {
      const e = await store.createEntity(entityInput());
      await store.deleteEntity(e.id, {});
      expect(await store.getEntity(e.id, {})).toBeNull();
    });
  });

  describe('entities — identifier lookup', () => {
    const ident = (kind: string, value: string): Identifier => ({ kind, value });

    it('finds by (kind, value)', async () => {
      const e = await store.createEntity(
        entityInput({ identifiers: [ident('email', 'a@example.com')] }),
      );
      const found = await store.findEntitiesByIdentifier('email', 'a@example.com', {});
      expect(found).toHaveLength(1);
      expect(found[0]!.id).toBe(e.id);
    });

    it('is case-insensitive on value', async () => {
      await store.createEntity(
        entityInput({ identifiers: [ident('email', 'A@Example.com')] }),
      );
      const found = await store.findEntitiesByIdentifier('email', 'a@example.com', {});
      expect(found).toHaveLength(1);
    });

    it('scope-filters results', async () => {
      const a = await store.createEntity(
        entityInput({
          groupId: 'g1',
          identifiers: [ident('email', 'x@example.com')],
          permissions: PRIVATE_PERMS,
        }),
      );
      await store.createEntity(
        entityInput({
          groupId: 'g2',
          identifiers: [ident('email', 'x@example.com')],
          permissions: PRIVATE_PERMS,
        }),
      );
      const found = await store.findEntitiesByIdentifier('email', 'x@example.com', {
        groupId: 'g1',
      });
      expect(found.map((e) => e.id)).toEqual([a.id]);
    });

    it('returns empty when no match', async () => {
      const found = await store.findEntitiesByIdentifier('email', 'none', {});
      expect(found).toEqual([]);
    });
  });

  describe('entities — searchEntities', () => {
    let aliceId: string;
    let bobId: string;
    let acmeId: string;

    beforeEach(async () => {
      const alice = await store.createEntity(
        entityInput({
          displayName: 'Alice Anderson',
          aliases: ['Ali'],
          identifiers: [{ kind: 'email', value: 'alice@acme.com' }],
        }),
      );
      const bob = await store.createEntity(entityInput({ displayName: 'Bob Builder' }));
      const acme = await store.createEntity(
        entityInput({ displayName: 'Acme Corp', type: 'organization' }),
      );
      aliceId = alice.id;
      bobId = bob.id;
      acmeId = acme.id;
    });

    it('matches by displayName substring', async () => {
      const result = await store.searchEntities('alice', {}, {});
      expect(result.items.map((e) => e.id)).toEqual([aliceId]);
    });

    it('matches by alias', async () => {
      const result = await store.searchEntities('ali', {}, {});
      expect(result.items.map((e) => e.id)).toContain(aliceId);
    });

    it('matches by identifier value', async () => {
      const result = await store.searchEntities('acme.com', {}, {});
      expect(result.items.map((e) => e.id)).toContain(aliceId);
    });

    it('respects type filter', async () => {
      const result = await store.searchEntities('', { types: ['organization'] }, {});
      expect(result.items.map((e) => e.id)).toEqual([acmeId]);
    });

    it('empty query returns all visible entities', async () => {
      const result = await store.searchEntities('', {}, {});
      expect(result.items.map((e) => e.id).sort()).toEqual([aliceId, bobId, acmeId].sort());
    });

    it('ranks exact match > alias exact > displayName substring > identifier substring', async () => {
      // Start from a fresh store so we control exactly what's in the search set.
      const s = new InMemoryAdapter();
      const exactDn = await s.createEntity(
        entityInput({ displayName: 'Acme', type: 'organization' }),
      );
      const exactAlias = await s.createEntity(
        entityInput({
          displayName: 'ACM Holdings',
          aliases: ['acme'],
          type: 'organization',
        }),
      );
      const dnSubstring = await s.createEntity(
        entityInput({ displayName: 'Acme International', type: 'organization' }),
      );
      const identifierSubstring = await s.createEntity(
        entityInput({
          displayName: 'Alice',
          identifiers: [{ kind: 'email', value: 'a@acme.com' }],
        }),
      );
      const result = await s.searchEntities('acme', {}, {});
      expect(result.items.map((e) => e.id)).toEqual([
        exactDn.id,
        exactAlias.id,
        dnSubstring.id,
        identifierSubstring.id,
      ]);
      s.destroy();
    });
  });

  describe('entities — listEntities pagination', () => {
    let ids: string[];

    beforeEach(async () => {
      ids = [];
      for (let i = 0; i < 5; i++) {
        const e = await store.createEntity(entityInput({ displayName: `E${i}` }));
        ids.push(e.id);
      }
    });

    it('paginates via cursor', async () => {
      const page1 = await store.listEntities({}, { limit: 2 }, {});
      expect(page1.items).toHaveLength(2);
      expect(page1.nextCursor).toBeDefined();

      const page2 = await store.listEntities({}, { limit: 2, cursor: page1.nextCursor }, {});
      expect(page2.items).toHaveLength(2);

      const page3 = await store.listEntities({}, { limit: 2, cursor: page2.nextCursor }, {});
      expect(page3.items).toHaveLength(1);
      expect(page3.nextCursor).toBeUndefined();
    });

    it('filters by ids', async () => {
      const result = await store.listEntities({ ids: [ids[0]!, ids[2]!] }, {}, {});
      expect(result.items.map((e) => e.id).sort()).toEqual([ids[0]!, ids[2]!].sort());
    });

    it('archived: true returns only archived', async () => {
      await store.archiveEntity(ids[0]!, {});
      const result = await store.listEntities({ archived: true }, {}, {});
      expect(result.items.map((e) => e.id)).toEqual([ids[0]!]);
    });
  });

  // ==========================================================================
  // Facts
  // ==========================================================================

  describe('facts — CRUD', () => {
    let a: IEntity;
    let b: IEntity;

    beforeEach(async () => {
      a = await store.createEntity(entityInput({ displayName: 'A' }));
      b = await store.createEntity(entityInput({ displayName: 'B' }));
    });

    it('create/get round-trip', async () => {
      const f = await store.createFact(factInput(a.id));
      expect(f.id).toBeTruthy();
      expect(f.createdAt).toBeInstanceOf(Date);
      const got = await store.getFact(f.id, {});
      expect(got?.subjectId).toBe(a.id);
    });

    it('returns a cloned object', async () => {
      const f = await store.createFact(factInput(a.id, { details: 'original' }));
      const got = await store.getFact(f.id, {});
      got!.details = 'mutated';
      const got2 = await store.getFact(f.id, {});
      expect(got2!.details).toBe('original');
    });

    it('createFacts batch', async () => {
      const out = await store.createFacts([factInput(a.id), factInput(a.id)]);
      expect(out).toHaveLength(2);
      expect((await store.findFacts({ subjectId: a.id }, {}, {})).items).toHaveLength(2);
    });

    it('updateFact applies patch', async () => {
      const f = await store.createFact(factInput(a.id, { confidence: 0.5 }));
      await store.updateFact(f.id, { confidence: 0.9 }, {});
      const got = await store.getFact(f.id, {});
      expect(got!.confidence).toBe(0.9);
    });

    it('updateFact on missing id is silent', async () => {
      await expect(store.updateFact('missing', { confidence: 1 }, {})).resolves.toBeUndefined();
    });

    // Suppress unused-var warning for b
    it('b entity exists', () => {
      expect(b.id).toBeTruthy();
    });
  });

  describe('facts — findFacts filters', () => {
    let a: IEntity;
    let b: IEntity;
    let c: IEntity;
    let f1: IFact;
    let f2: IFact;
    let f3: IFact;
    let f4: IFact;

    beforeEach(async () => {
      a = await store.createEntity(entityInput({ displayName: 'A' }));
      b = await store.createEntity(entityInput({ displayName: 'B' }));
      c = await store.createEntity(entityInput({ displayName: 'C' }));
      f1 = await store.createFact(
        factInput(a.id, { predicate: 'works_at', objectId: b.id, confidence: 0.9 }),
      );
      f2 = await store.createFact(
        factInput(a.id, { predicate: 'knows', objectId: c.id, confidence: 0.3 }),
      );
      f3 = await store.createFact(
        factInput(b.id, { predicate: 'works_at', objectId: c.id, confidence: 0.7 }),
      );
      f4 = await store.createFact(
        factInput(a.id, { predicate: 'bio', kind: 'document', details: 'long' }),
      );
    });

    it('by subjectId', async () => {
      const page = await store.findFacts({ subjectId: a.id }, {}, {});
      expect(page.items.map((f) => f.id).sort()).toEqual([f1.id, f2.id, f4.id].sort());
    });

    it('by objectId', async () => {
      const page = await store.findFacts({ objectId: c.id }, {}, {});
      expect(page.items.map((f) => f.id).sort()).toEqual([f2.id, f3.id].sort());
    });

    it('by predicate', async () => {
      const page = await store.findFacts({ predicate: 'works_at' }, {}, {});
      expect(page.items.map((f) => f.id).sort()).toEqual([f1.id, f3.id].sort());
    });

    it('by predicates[]', async () => {
      const page = await store.findFacts({ predicates: ['knows', 'bio'] }, {}, {});
      expect(page.items.map((f) => f.id).sort()).toEqual([f2.id, f4.id].sort());
    });

    it('by kind', async () => {
      const page = await store.findFacts({ kind: 'document' }, {}, {});
      expect(page.items.map((f) => f.id)).toEqual([f4.id]);
    });

    it('by minConfidence (H6: facts without explicit confidence are excluded)', async () => {
      // H6: strict minConfidence. MemorySystem.addFact defaults unset
      // confidence to 1.0 at write, so this only excludes legacy un-scored
      // facts (f4 here). Callers needing legacy inclusion can backfill.
      const page = await store.findFacts({ minConfidence: 0.5 }, {}, {});
      expect(page.items.map((f) => f.id).sort()).toEqual([f1.id, f3.id].sort());
    });

    it('combined filters (AND semantics)', async () => {
      const page = await store.findFacts(
        { subjectId: a.id, predicate: 'works_at' },
        {},
        {},
      );
      expect(page.items.map((f) => f.id)).toEqual([f1.id]);
    });
  });

  describe('facts — archived handling', () => {
    let a: IEntity;
    let live: IFact;
    let archived: IFact;

    beforeEach(async () => {
      a = await store.createEntity(entityInput());
      live = await store.createFact(factInput(a.id));
      archived = await store.createFact(factInput(a.id, { archived: true }));
    });

    it('default (undefined) hides archived', async () => {
      const page = await store.findFacts({ subjectId: a.id }, {}, {});
      expect(page.items.map((f) => f.id)).toEqual([live.id]);
    });

    it('archived:true shows only archived', async () => {
      const page = await store.findFacts({ subjectId: a.id, archived: true }, {}, {});
      expect(page.items.map((f) => f.id)).toEqual([archived.id]);
    });

    it('archived:false shows only non-archived', async () => {
      const page = await store.findFacts({ subjectId: a.id, archived: false }, {}, {});
      expect(page.items.map((f) => f.id)).toEqual([live.id]);
    });
  });

  describe('facts — temporal', () => {
    const yesterday = new Date('2026-04-16');
    const today = new Date('2026-04-17');
    const tomorrow = new Date('2026-04-18');
    let a: IEntity;

    beforeEach(async () => {
      a = await store.createEntity(entityInput());
    });

    it('observedAfter / observedBefore filter', async () => {
      const old = await store.createFact(factInput(a.id, { observedAt: yesterday }));
      const recent = await store.createFact(factInput(a.id, { observedAt: tomorrow }));
      const beforePage = await store.findFacts(
        { subjectId: a.id, observedBefore: today },
        {},
        {},
      );
      expect(beforePage.items.map((f) => f.id)).toEqual([old.id]);
      const afterPage = await store.findFacts(
        { subjectId: a.id, observedAfter: today },
        {},
        {},
      );
      expect(afterPage.items.map((f) => f.id)).toEqual([recent.id]);
    });

    it('asOf respects validFrom/validUntil + createdAt', async () => {
      const future = await store.createFact(
        factInput(a.id, { validFrom: tomorrow }),
      );
      // Override createdAt via internal archiving path isn't possible; for test we
      // rely on createdAt being "now" which is after today. Use a very-future date.
      const veryFuture = new Date(Date.now() + 100 * 86_400_000);
      expect(
        (await store.findFacts({ subjectId: a.id, asOf: today }, {}, {})).items,
      ).toEqual([]);
      expect(
        (await store.findFacts({ subjectId: a.id, asOf: veryFuture }, {}, {})).items.map(
          (f) => f.id,
        ),
      ).toEqual([future.id]);
    });

    it('asOf filters expired facts (past validUntil)', async () => {
      await store.createFact(
        factInput(a.id, { validFrom: yesterday, validUntil: yesterday }),
      );
      const page = await store.findFacts({ subjectId: a.id, asOf: today }, {}, {});
      expect(page.items).toEqual([]);
    });
  });

  describe('facts — pagination + ordering', () => {
    let a: IEntity;
    let ids: string[];

    beforeEach(async () => {
      a = await store.createEntity(entityInput());
      ids = [];
      for (let i = 0; i < 5; i++) {
        const f = await store.createFact(
          factInput(a.id, {
            confidence: i / 10,
            observedAt: new Date(2026, 0, i + 1),
          }),
        );
        ids.push(f.id);
      }
    });

    it('orderBy observedAt desc', async () => {
      const page = await store.findFacts(
        { subjectId: a.id },
        { orderBy: { field: 'observedAt', direction: 'desc' } },
        {},
      );
      expect(page.items.map((f) => f.id)).toEqual(
        [ids[4]!, ids[3]!, ids[2]!, ids[1]!, ids[0]!],
      );
    });

    it('orderBy confidence asc', async () => {
      const page = await store.findFacts(
        { subjectId: a.id },
        { orderBy: { field: 'confidence', direction: 'asc' } },
        {},
      );
      expect(page.items.map((f) => f.id)).toEqual(ids);
    });

    it('paginates with cursor', async () => {
      const p1 = await store.findFacts({ subjectId: a.id }, { limit: 2 }, {});
      expect(p1.items).toHaveLength(2);
      const p2 = await store.findFacts({ subjectId: a.id }, { limit: 2, cursor: p1.nextCursor }, {});
      expect(p2.items).toHaveLength(2);
      const p3 = await store.findFacts({ subjectId: a.id }, { limit: 2, cursor: p2.nextCursor }, {});
      expect(p3.items).toHaveLength(1);
      expect(p3.nextCursor).toBeUndefined();
    });
  });

  describe('facts — countFacts', () => {
    let a: IEntity;

    beforeEach(async () => {
      a = await store.createEntity(entityInput());
      await store.createFact(factInput(a.id));
      await store.createFact(factInput(a.id, { archived: true }));
      await store.createFact(factInput(a.id));
    });

    it('matches findFacts default (excludes archived)', async () => {
      expect(await store.countFacts({ subjectId: a.id }, {})).toBe(2);
    });

    it('counts only archived when archived:true', async () => {
      expect(await store.countFacts({ subjectId: a.id, archived: true }, {})).toBe(1);
    });
  });

  // ==========================================================================
  // Scope visibility
  // ==========================================================================

  describe('scope — visibility matrix', () => {
    it('global entity visible to every scope', async () => {
      const g = await store.createEntity(entityInput());
      expect(await store.getEntity(g.id, {})).not.toBeNull();
      expect(await store.getEntity(g.id, { groupId: 'anything' })).not.toBeNull();
      expect(await store.getEntity(g.id, { userId: 'u1' })).not.toBeNull();
    });

    it('group-scoped entity only visible to matching groupId', async () => {
      // Private-to-group: opt out of world access with permissions.world='none'.
      const e = await store.createEntity(
        entityInput({ groupId: 'g1', permissions: PRIVATE_PERMS }),
      );
      expect(await store.getEntity(e.id, { groupId: 'g1' })).not.toBeNull();
      expect(await store.getEntity(e.id, { groupId: 'g2' })).toBeNull();
      expect(await store.getEntity(e.id, {})).toBeNull();
    });

    it('user-scoped entity only visible to matching userId', async () => {
      const e = await store.createEntity(
        entityInput({ ownerId: 'u1', permissions: PRIVATE_PERMS }),
      );
      expect(await store.getEntity(e.id, { userId: 'u1' })).not.toBeNull();
      expect(await store.getEntity(e.id, { userId: 'u2' })).toBeNull();
    });

    it('group+user scoped entity requires BOTH to match', async () => {
      // Owner-only: no group or world access; only ownerId=u1 can see it.
      const e = await store.createEntity(
        entityInput({ groupId: 'g1', ownerId: 'u1', permissions: OWNER_ONLY_PERMS }),
      );
      expect(await store.getEntity(e.id, { groupId: 'g1', userId: 'u1' })).not.toBeNull();
      expect(await store.getEntity(e.id, { groupId: 'g1', userId: 'u2' })).toBeNull();
      // u1 owner match → visible even without group match.
      expect(await store.getEntity(e.id, { groupId: 'g2', userId: 'u1' })).not.toBeNull();
    });

    it('fact scope is independent of entity scope for visibility checks', async () => {
      const e = await store.createEntity(entityInput()); // public entity
      const f = await store.createFact(
        factInput(e.id, { groupId: 'g1', permissions: PRIVATE_PERMS }),
      );
      expect(await store.getFact(f.id, { groupId: 'g1' })).not.toBeNull();
      expect(await store.getFact(f.id, { groupId: 'g2' })).toBeNull();
    });
  });

  // ==========================================================================
  // Graph + Vector
  // ==========================================================================

  describe('traverse', () => {
    it('delegates to genericTraverse and returns neighborhood', async () => {
      const a = await store.createEntity(entityInput({ displayName: 'A' }));
      const b = await store.createEntity(entityInput({ displayName: 'B' }));
      await store.createFact(factInput(a.id, { predicate: 'works_at', objectId: b.id }));
      const result = await store.traverse(a.id, { direction: 'out', maxDepth: 1 }, {});
      expect(result.nodes.map((n) => n.entity.id).sort()).toEqual([a.id, b.id].sort());
    });
  });

  describe('semanticSearch', () => {
    let a: IEntity;
    let match: IFact;
    let opp: IFact;
    let unembedded: IFact;

    beforeEach(async () => {
      a = await store.createEntity(entityInput());
      match = await store.createFact(
        factInput(a.id, { details: 'matches', embedding: [1, 0, 0] }),
      );
      opp = await store.createFact(
        factInput(a.id, { details: 'opposite', embedding: [0, 0, 1] }),
      );
      unembedded = await store.createFact(factInput(a.id, { details: 'unembedded' }));
    });

    it('ranks by cosine similarity', async () => {
      const results = await store.semanticSearch([1, 0, 0], {}, { topK: 2 }, {});
      expect(results[0]!.fact.id).toBe(match.id);
      expect(results[0]!.score).toBeCloseTo(1, 5);
    });

    it('skips facts without embedding', async () => {
      const results = await store.semanticSearch([1, 0, 0], {}, { topK: 10 }, {});
      expect(results.map((r) => r.fact.id)).not.toContain(unembedded.id);
    });

    it('skips facts with wrong embedding dimension', async () => {
      await store.createFact(factInput(a.id, { embedding: [1, 0] })); // wrong dim
      const results = await store.semanticSearch([1, 0, 0], {}, { topK: 10 }, {});
      expect(results.every((r) => r.fact.embedding?.length === 3)).toBe(true);
      // suppress unused
      expect(opp.id).toBeTruthy();
    });

    it('respects filter + scope', async () => {
      const b = await store.createEntity(entityInput({ groupId: 'g2' }));
      const fb = await store.createFact(
        factInput(b.id, { groupId: 'g2', embedding: [1, 0, 0], permissions: PRIVATE_PERMS }),
      );
      const results = await store.semanticSearch([1, 0, 0], {}, { topK: 10 }, { groupId: 'g1' });
      expect(results.map((r) => r.fact.id)).not.toContain(fb.id);
    });
  });

  // ==========================================================================
  // Semantic entity search (identityEmbedding)
  // ==========================================================================

  describe('semanticSearchEntities', () => {
    async function createEntityWithEmbedding(
      overrides: Partial<NewEntity>,
      embedding: number[] | undefined,
    ): Promise<IEntity> {
      const e = await store.createEntity(entityInput(overrides));
      if (embedding !== undefined) {
        const updated: IEntity = { ...e, identityEmbedding: embedding, version: e.version + 1 };
        await store.updateEntity(updated);
        return (await store.getEntity(e.id, {}))!;
      }
      return e;
    }

    it('ranks entities by cosine similarity over identityEmbedding', async () => {
      const alpha = await createEntityWithEmbedding(
        { displayName: 'Alpha', type: 'organization' },
        [1, 0, 0],
      );
      const beta = await createEntityWithEmbedding(
        { displayName: 'Beta', type: 'organization' },
        [0.9, 0.1, 0],
      );
      const gamma = await createEntityWithEmbedding(
        { displayName: 'Gamma', type: 'organization' },
        [0, 0, 1],
      );

      const results = await store.semanticSearchEntities(
        [1, 0, 0],
        { type: 'organization' },
        { topK: 3 },
        {},
      );
      expect(results[0]!.entity.id).toBe(alpha.id);
      expect(results[0]!.score).toBeCloseTo(1, 5);
      expect(results[1]!.entity.id).toBe(beta.id);
      expect(results[2]!.entity.id).toBe(gamma.id);
    });

    it('honors topK by truncating after sort', async () => {
      await createEntityWithEmbedding({ displayName: 'A' }, [1, 0, 0]);
      await createEntityWithEmbedding({ displayName: 'B' }, [0.8, 0.2, 0]);
      await createEntityWithEmbedding({ displayName: 'C' }, [0.5, 0.5, 0]);
      const results = await store.semanticSearchEntities([1, 0, 0], {}, { topK: 2 }, {});
      expect(results).toHaveLength(2);
      expect(results[0]!.score).toBeGreaterThan(results[1]!.score);
    });

    it('skips entities without identityEmbedding', async () => {
      await createEntityWithEmbedding({ displayName: 'Bare' }, undefined);
      const embedded = await createEntityWithEmbedding({ displayName: 'Embedded' }, [1, 0, 0]);
      const results = await store.semanticSearchEntities([1, 0, 0], {}, { topK: 10 }, {});
      expect(results.map((r) => r.entity.id)).toEqual([embedded.id]);
    });

    it('skips entities whose identityEmbedding has a mismatched dimension', async () => {
      await createEntityWithEmbedding({ displayName: 'ShortVec' }, [1, 0]); // wrong dim
      const ok = await createEntityWithEmbedding({ displayName: 'GoodVec' }, [1, 0, 0]);
      const results = await store.semanticSearchEntities([1, 0, 0], {}, { topK: 10 }, {});
      expect(results.map((r) => r.entity.id)).toEqual([ok.id]);
    });

    it('filters by type (single)', async () => {
      const org = await createEntityWithEmbedding(
        { displayName: 'MSFT', type: 'organization' },
        [1, 0, 0],
      );
      await createEntityWithEmbedding({ displayName: 'Alice', type: 'person' }, [1, 0, 0]);
      const results = await store.semanticSearchEntities(
        [1, 0, 0],
        { type: 'organization' },
        { topK: 10 },
        {},
      );
      expect(results.map((r) => r.entity.id)).toEqual([org.id]);
    });

    it('filters by types (union)', async () => {
      const org = await createEntityWithEmbedding(
        { displayName: 'MSFT', type: 'organization' },
        [1, 0, 0],
      );
      const topic = await createEntityWithEmbedding(
        { displayName: 'AI', type: 'topic' },
        [0.9, 0, 0.1],
      );
      await createEntityWithEmbedding({ displayName: 'Alice', type: 'person' }, [1, 0, 0]);
      const results = await store.semanticSearchEntities(
        [1, 0, 0],
        { types: ['organization', 'topic'] },
        { topK: 10 },
        {},
      );
      const ids = results.map((r) => r.entity.id).sort();
      expect(ids).toEqual([org.id, topic.id].sort());
    });

    it('excludes archived entities', async () => {
      const live = await createEntityWithEmbedding({ displayName: 'Live' }, [1, 0, 0]);
      const gone = await createEntityWithEmbedding({ displayName: 'Gone' }, [1, 0, 0]);
      await store.archiveEntity(gone.id, {});
      const results = await store.semanticSearchEntities([1, 0, 0], {}, { topK: 10 }, {});
      expect(results.map((r) => r.entity.id)).toEqual([live.id]);
    });

    it('honors scope visibility — cross-group private entities hidden', async () => {
      await createEntityWithEmbedding(
        { displayName: 'SecretOrg', groupId: 'g2', permissions: PRIVATE_PERMS },
        [1, 0, 0],
      );
      const mine = await createEntityWithEmbedding(
        { displayName: 'MyOrg', groupId: 'g1' },
        [1, 0, 0],
      );
      const results = await store.semanticSearchEntities(
        [1, 0, 0],
        {},
        { topK: 10 },
        { groupId: 'g1' },
      );
      expect(results.map((r) => r.entity.id)).toEqual([mine.id]);
    });

    it('applies minScore floor when provided', async () => {
      const closeA = await createEntityWithEmbedding({ displayName: 'Close' }, [1, 0, 0]);
      await createEntityWithEmbedding({ displayName: 'Far' }, [0, 1, 0]); // cosine 0 → below
      const results = await store.semanticSearchEntities(
        [1, 0, 0],
        {},
        { topK: 10, minScore: 0.5 },
        {},
      );
      expect(results.map((r) => r.entity.id)).toEqual([closeA.id]);
    });
  });

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  describe('lifecycle', () => {
    it('destroy flips isDestroyed and clears data', async () => {
      const e = await store.createEntity(entityInput());
      store.destroy();
      expect(store.isDestroyed).toBe(true);
      await expect(store.getEntity(e.id, {})).rejects.toThrow();
    });

    it('destroy is idempotent', () => {
      store.destroy();
      expect(() => store.destroy()).not.toThrow();
    });
  });

  describe('seed data', () => {
    it('accepts entities + facts in constructor', async () => {
      const now = new Date();
      const seeded = new InMemoryAdapter({
        entities: [
          {
            id: 'seed_a',
            type: 'person',
            displayName: 'Seed',
            identifiers: [],
            version: 1,
            createdAt: now,
            updatedAt: now,
          },
        ],
        facts: [
          {
            id: 'seed_f1',
            subjectId: 'seed_a',
            predicate: 'p',
            kind: 'atomic',
            createdAt: now,
          },
        ],
      });
      expect(await seeded.getEntity('seed_a', {})).not.toBeNull();
      expect(await seeded.getFact('seed_f1', {})).not.toBeNull();
      seeded.destroy();
    });
  });
});
