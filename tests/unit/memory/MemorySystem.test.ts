/**
 * Unit tests for memory/MemorySystem.ts — the facade.
 *
 * Covers: identifier-based upsert/dedup, scope invariants, fact lifecycle,
 * profile canonical resolution, auto-regen, embedding queue, rule-engine hook,
 * events, lifecycle. Uses InMemoryAdapter as the backing store; LLM/embedder/
 * rule-engine are vi.fn() test doubles.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  MemorySystem,
  ScopeInvariantError,
  ProfileGeneratorMissingError,
  SemanticSearchUnavailableError,
} from '@/memory/MemorySystem.js';
import { InMemoryAdapter } from '@/memory/adapters/inmemory/InMemoryAdapter.js';
import type {
  ChangeEvent,
  IEmbedder,
  IMemoryStore,
  IProfileGenerator,
  IRuleEngine,
  Identifier,
  ScopeFilter,
} from '@/memory/types.js';

function makeEmbedder(dim = 3): IEmbedder & {
  embed: ReturnType<typeof vi.fn>;
} {
  const embed = vi.fn(async (text: string) => {
    // Deterministic tiny embedding: hash each char, place in a dim-sized vector.
    const v = new Array(dim).fill(0);
    for (let i = 0; i < text.length; i++) {
      v[i % dim] = (v[i % dim] ?? 0) + (text.charCodeAt(i) % 7) / 10;
    }
    return v;
  });
  return { embed, dimensions: dim };
}

async function seedEntity(
  mem: MemorySystem,
  args: {
    type?: string;
    displayName?: string;
    identifiers?: Identifier[];
    scope?: ScopeFilter;
    groupId?: string;
    ownerId?: string;
  },
): Promise<string> {
  const result = await mem.upsertEntity(
    {
      type: args.type ?? 'person',
      displayName: args.displayName ?? 'Test',
      identifiers: args.identifiers ?? [{ kind: 'email', value: 'test@example.com' }],
      groupId: args.groupId,
      ownerId: args.ownerId,
    },
    args.scope ?? {},
  );
  return result.entity.id;
}

describe('MemorySystem', () => {
  let store: InMemoryAdapter;
  let mem: MemorySystem;

  beforeEach(() => {
    store = new InMemoryAdapter();
    mem = new MemorySystem({ store });
  });

  afterEach(async () => {
    if (!mem.isDestroyed) await mem.shutdown();
  });

  // ==========================================================================
  // upsertEntity
  // ==========================================================================

  describe('upsertEntity', () => {
    it('creates a new entity with version=1', async () => {
      const result = await mem.upsertEntity(
        {
          type: 'person',
          displayName: 'Alice',
          identifiers: [{ kind: 'email', value: 'a@x.com' }],
        },
        {},
      );
      expect(result.created).toBe(true);
      expect(result.entity.version).toBe(1);
      expect(result.entity.displayName).toBe('Alice');
      expect(result.mergedIdentifiers).toBe(1);
    });

    it('inherits caller scope when entity has no explicit scope', async () => {
      const result = await mem.upsertEntity(
        {
          type: 'person',
          displayName: 'B',
          identifiers: [{ kind: 'email', value: 'b@x.com' }],
        },
        { groupId: 'g1', userId: 'u1' },
      );
      expect(result.entity.groupId).toBe('g1');
      expect(result.entity.ownerId).toBe('u1');
    });

    it('dedupes by identifier: second upsert returns same entity', async () => {
      const first = await mem.upsertEntity(
        {
          type: 'person',
          displayName: 'A',
          identifiers: [{ kind: 'email', value: 'a@x.com' }],
        },
        {},
      );
      const second = await mem.upsertEntity(
        {
          type: 'person',
          displayName: 'A again',
          identifiers: [{ kind: 'email', value: 'a@x.com' }],
        },
        {},
      );
      expect(second.created).toBe(false);
      expect(second.entity.id).toBe(first.entity.id);
      expect(second.mergedIdentifiers).toBe(0);
    });

    it('merges new identifiers into existing entity and bumps version', async () => {
      const first = await mem.upsertEntity(
        {
          type: 'person',
          displayName: 'A',
          identifiers: [{ kind: 'email', value: 'a@x.com' }],
        },
        {},
      );
      const second = await mem.upsertEntity(
        {
          type: 'person',
          displayName: 'A',
          identifiers: [
            { kind: 'email', value: 'a@x.com' },
            { kind: 'github', value: 'alice' },
          ],
        },
        {},
      );
      expect(second.entity.id).toBe(first.entity.id);
      expect(second.mergedIdentifiers).toBe(1);
      expect(second.entity.version).toBe(2);
      expect(second.entity.identifiers.map((i) => i.kind).sort()).toEqual(['email', 'github']);
    });

    it('reports mergeCandidates when multiple entities match different identifiers', async () => {
      const e1 = await mem.upsertEntity(
        {
          type: 'person',
          displayName: 'A1',
          identifiers: [{ kind: 'email', value: 'a@x.com' }],
        },
        {},
      );
      const e2 = await mem.upsertEntity(
        {
          type: 'person',
          displayName: 'A2',
          identifiers: [{ kind: 'slack_id', value: 'U123' }],
        },
        {},
      );
      // Third upsert matches both via different identifiers.
      const result = await mem.upsertEntity(
        {
          type: 'person',
          displayName: 'A3',
          identifiers: [
            { kind: 'email', value: 'a@x.com' },
            { kind: 'slack_id', value: 'U123' },
          ],
        },
        {},
      );
      expect([e1.entity.id, e2.entity.id]).toContain(result.entity.id);
      expect(result.mergeCandidates.length).toBeGreaterThan(0);
    });

    it('is case-insensitive on identifier values', async () => {
      await mem.upsertEntity(
        {
          type: 'person',
          displayName: 'A',
          identifiers: [{ kind: 'email', value: 'Alice@X.com' }],
        },
        {},
      );
      const result = await mem.upsertEntity(
        {
          type: 'person',
          displayName: 'A',
          identifiers: [{ kind: 'email', value: 'alice@x.com' }],
        },
        {},
      );
      expect(result.created).toBe(false);
    });

    it('allows empty identifiers (relaxed in v2 — projects/topics may have no external key)', async () => {
      const res = await mem.upsertEntity(
        { type: 'project', displayName: 'Q3 Planning', identifiers: [] },
        {},
      );
      expect(res.created).toBe(true);
      expect(res.entity.displayName).toBe('Q3 Planning');
    });
  });

  // ==========================================================================
  // addFact
  // ==========================================================================

  describe('addFact', () => {
    let subjectId: string;

    beforeEach(async () => {
      subjectId = await seedEntity(mem, {});
    });

    it('writes an atomic fact with auto createdAt + observedAt', async () => {
      const fact = await mem.addFact(
        { subjectId, predicate: 'note', kind: 'atomic', details: 'hi' },
        {},
      );
      expect(fact.id).toBeTruthy();
      expect(fact.createdAt).toBeInstanceOf(Date);
      expect(fact.observedAt).toBeInstanceOf(Date);
    });

    it('computes isSemantic=true for documents regardless of length', async () => {
      const fact = await mem.addFact(
        { subjectId, predicate: 'bio', kind: 'document', details: 'short' },
        {},
      );
      expect(fact.isSemantic).toBe(true);
    });

    it('computes isSemantic=true for atomic facts with long details (≥ 80 chars)', async () => {
      const long = 'x'.repeat(100);
      const fact = await mem.addFact(
        { subjectId, predicate: 'note', kind: 'atomic', details: long },
        {},
      );
      expect(fact.isSemantic).toBe(true);
    });

    it('computes isSemantic=false for atomic facts with short details', async () => {
      const fact = await mem.addFact(
        { subjectId, predicate: 'note', kind: 'atomic', details: 'short' },
        {},
      );
      expect(fact.isSemantic).toBe(false);
    });

    it('enforces scope invariant — rejects widening groupId beyond subject', async () => {
      const scopedId = await seedEntity(mem, {
        scope: { groupId: 'g1' },
        identifiers: [{ kind: 'email', value: 'g@x.com' }],
        groupId: 'g1',
      });
      await expect(
        mem.addFact(
          {
            subjectId: scopedId,
            predicate: 'note',
            kind: 'atomic',
            groupId: 'g2', // mismatches subject.groupId
          },
          { groupId: 'g1' },
        ),
      ).rejects.toThrow(ScopeInvariantError);
    });

    it('enforces scope invariant — rejects widening ownerId beyond subject', async () => {
      const userEntId = await seedEntity(mem, {
        scope: { userId: 'u1' },
        identifiers: [{ kind: 'email', value: 'u@x.com' }],
        ownerId: 'u1',
      });
      await expect(
        mem.addFact(
          {
            subjectId: userEntId,
            predicate: 'note',
            kind: 'atomic',
            ownerId: 'u2',
          },
          { userId: 'u1' },
        ),
      ).rejects.toThrow(ScopeInvariantError);
    });

    it('FIX: rejects fact whose objectId entity is not visible to caller', async () => {
      const otherId = await seedEntity(mem, {
        scope: { groupId: 'g2' },
        identifiers: [{ kind: 'email', value: 'other@x.com' }],
        groupId: 'g2',
      });
      // Caller in group g1 attempts to reference entity in g2.
      const callerSubject = await seedEntity(mem, {
        scope: { groupId: 'g1' },
        identifiers: [{ kind: 'email', value: 'caller@x.com' }],
        groupId: 'g1',
      });
      await expect(
        mem.addFact(
          {
            subjectId: callerSubject,
            predicate: 'knows',
            kind: 'atomic',
            objectId: otherId,
          },
          { groupId: 'g1' },
        ),
      ).rejects.toThrow(/object entity .* not visible/);
    });

    it('accepts fact referencing a visible object', async () => {
      const other = await seedEntity(mem, {
        identifiers: [{ kind: 'email', value: 'other@x.com' }],
      });
      const fact = await mem.addFact(
        {
          subjectId,
          predicate: 'knows',
          kind: 'atomic',
          objectId: other,
        },
        {},
      );
      expect(fact.objectId).toBe(other);
    });

    it('throws when subject entity missing', async () => {
      await expect(
        mem.addFact({ subjectId: 'missing', predicate: 'p', kind: 'atomic' }, {}),
      ).rejects.toThrow(/subject entity.*not found/);
    });

    it('supersession writes new fact AND archives predecessor (crash-safe order)', async () => {
      const older = await mem.addFact(
        { subjectId, predicate: 'title', kind: 'atomic', value: 'Junior' },
        {},
      );
      const newer = await mem.addFact(
        {
          subjectId,
          predicate: 'title',
          kind: 'atomic',
          value: 'Senior',
          supersedes: older.id,
        },
        {},
      );
      const olderAfter = await store.getFact(older.id, {});
      expect(olderAfter!.archived).toBe(true);
      const newerAfter = await store.getFact(newer.id, {});
      expect(newerAfter!.archived).toBeFalsy();
    });

    it('emits fact.add event', async () => {
      const events: ChangeEvent[] = [];
      const mem2 = new MemorySystem({ store, onChange: (e) => events.push(e) });
      const subj2 = await seedEntity(mem2, {
        identifiers: [{ kind: 'email', value: 'evt@x.com' }],
      });
      await mem2.addFact({ subjectId: subj2, predicate: 'p', kind: 'atomic' }, {});
      expect(events.some((e) => e.type === 'fact.add')).toBe(true);
      await mem2.shutdown();
    });

    it('emits fact.supersede event when supersedes is set', async () => {
      const events: ChangeEvent[] = [];
      const mem2 = new MemorySystem({ store, onChange: (e) => events.push(e) });
      const subj2 = await seedEntity(mem2, {
        identifiers: [{ kind: 'email', value: 'sup@x.com' }],
      });
      const first = await mem2.addFact(
        { subjectId: subj2, predicate: 't', kind: 'atomic', value: 1 },
        {},
      );
      await mem2.addFact(
        { subjectId: subj2, predicate: 't', kind: 'atomic', value: 2, supersedes: first.id },
        {},
      );
      expect(events.some((e) => e.type === 'fact.supersede')).toBe(true);
      await mem2.shutdown();
    });

    it('does NOT enqueue embedding when no embedder is configured', async () => {
      await mem.addFact(
        {
          subjectId,
          predicate: 'note',
          kind: 'atomic',
          details: 'a'.repeat(100),
        },
        {},
      );
      expect(mem.pendingEmbeddings()).toBe(0);
    });

    it('enqueues embedding when isSemantic + embedder present', async () => {
      const embedder = makeEmbedder();
      const mem2 = new MemorySystem({ store, embedder });
      const subj2 = await seedEntity(mem2, {
        identifiers: [{ kind: 'email', value: 'e@x.com' }],
      });
      await mem2.addFact(
        { subjectId: subj2, predicate: 'bio', kind: 'document', details: 'long bio' },
        {},
      );
      await mem2.flushEmbeddings();
      expect(embedder.embed).toHaveBeenCalled();
      await mem2.shutdown();
    });
  });

  describe('addFacts batch + helpers', () => {
    it('addFacts preserves order', async () => {
      const subjectId = await seedEntity(mem, {});
      const out = await mem.addFacts(
        [
          { subjectId, predicate: 'a', kind: 'atomic' },
          { subjectId, predicate: 'b', kind: 'atomic' },
          { subjectId, predicate: 'c', kind: 'atomic' },
        ],
        {},
      );
      expect(out.map((f) => f.predicate)).toEqual(['a', 'b', 'c']);
    });

    it('supersedeFact is a convenience wrapper', async () => {
      const subjectId = await seedEntity(mem, {});
      const first = await mem.addFact(
        { subjectId, predicate: 't', kind: 'atomic', value: 1 },
        {},
      );
      const second = await mem.supersedeFact(
        first.id,
        { subjectId, predicate: 't', kind: 'atomic', value: 2 },
        {},
      );
      expect(second.supersedes).toBe(first.id);
    });

    it('archiveFact marks archived and emits event', async () => {
      const events: ChangeEvent[] = [];
      const m = new MemorySystem({ store, onChange: (e) => events.push(e) });
      const subjectId = await seedEntity(m, {
        identifiers: [{ kind: 'email', value: 'af@x.com' }],
      });
      const f = await m.addFact({ subjectId, predicate: 'p', kind: 'atomic' }, {});
      await m.archiveFact(f.id, {});
      const fromStore = await store.getFact(f.id, {});
      expect(fromStore!.archived).toBe(true);
      expect(events.some((e) => e.type === 'fact.archive')).toBe(true);
      await m.shutdown();
    });
  });

  // ==========================================================================
  // archiveEntity cascade (FIX #2)
  // ==========================================================================

  describe('archiveEntity', () => {
    it('FIX: cascades — facts referencing the entity are archived', async () => {
      const aId = await seedEntity(mem, {
        identifiers: [{ kind: 'email', value: 'a@x.com' }],
      });
      const bId = await seedEntity(mem, {
        identifiers: [{ kind: 'email', value: 'b@x.com' }],
      });
      const f1 = await mem.addFact(
        { subjectId: aId, predicate: 'knows', kind: 'atomic', objectId: bId },
        {},
      );
      const f2 = await mem.addFact(
        { subjectId: bId, predicate: 'knows', kind: 'atomic', objectId: aId },
        {},
      );

      await mem.archiveEntity(aId, {});

      const f1After = await store.getFact(f1.id, {});
      const f2After = await store.getFact(f2.id, {});
      expect(f1After!.archived).toBe(true);
      expect(f2After!.archived).toBe(true);
      expect(await mem.getEntity(aId, {})).toBeNull();
    });
  });

  describe('deleteEntity', () => {
    it('soft delete (default) archives entity + facts', async () => {
      const aId = await seedEntity(mem, { identifiers: [{ kind: 'email', value: 'a@x.com' }] });
      const f = await mem.addFact({ subjectId: aId, predicate: 'p', kind: 'atomic' }, {});
      await mem.deleteEntity(aId, {});
      expect(await mem.getEntity(aId, {})).toBeNull();
      const fAfter = await store.getFact(f.id, {});
      expect(fAfter!.archived).toBe(true);
    });

    it('hard delete removes entity completely', async () => {
      const aId = await seedEntity(mem, { identifiers: [{ kind: 'email', value: 'a@x.com' }] });
      await mem.addFact({ subjectId: aId, predicate: 'p', kind: 'atomic' }, {});
      await mem.deleteEntity(aId, {}, { hard: true });
      expect(await store.getEntity(aId, {})).toBeNull();
    });
  });

  // ==========================================================================
  // mergeEntities
  // ==========================================================================

  describe('mergeEntities', () => {
    it('merges identifiers + aliases onto winner', async () => {
      const winner = await mem.upsertEntity(
        {
          type: 'person',
          displayName: 'A',
          aliases: ['Al'],
          identifiers: [{ kind: 'email', value: 'a@x.com' }],
        },
        {},
      );
      const loser = await mem.upsertEntity(
        {
          type: 'person',
          displayName: 'A clone',
          aliases: ['Ally'],
          identifiers: [{ kind: 'github', value: 'alice' }],
        },
        {},
      );
      const merged = await mem.mergeEntities(winner.entity.id, loser.entity.id, {});
      expect(merged.identifiers.map((i) => i.kind).sort()).toEqual(['email', 'github']);
      expect(merged.aliases?.sort()).toEqual(['Al', 'Ally']);
    });

    it('rewrites facts: subject and object references', async () => {
      const winner = await mem.upsertEntity(
        {
          type: 'person',
          displayName: 'W',
          identifiers: [{ kind: 'email', value: 'w@x.com' }],
        },
        {},
      );
      const loser = await mem.upsertEntity(
        {
          type: 'person',
          displayName: 'L',
          identifiers: [{ kind: 'email', value: 'l@x.com' }],
        },
        {},
      );
      const third = await mem.upsertEntity(
        {
          type: 'person',
          displayName: 'T',
          identifiers: [{ kind: 'email', value: 't@x.com' }],
        },
        {},
      );
      // Loser as subject
      const subjectFact = await mem.addFact(
        { subjectId: loser.entity.id, predicate: 'knows', kind: 'atomic', objectId: third.entity.id },
        {},
      );
      // Loser as object
      const objectFact = await mem.addFact(
        { subjectId: third.entity.id, predicate: 'knows', kind: 'atomic', objectId: loser.entity.id },
        {},
      );

      await mem.mergeEntities(winner.entity.id, loser.entity.id, {});

      const subjectAfter = await store.getFact(subjectFact.id, {});
      expect(subjectAfter!.subjectId).toBe(winner.entity.id);
      const objectAfter = await store.getFact(objectFact.id, {});
      expect(objectAfter!.objectId).toBe(winner.entity.id);
    });

    it('archives the loser and emits entity.merge', async () => {
      const events: ChangeEvent[] = [];
      const m = new MemorySystem({ store, onChange: (e) => events.push(e) });
      const w = await m.upsertEntity(
        {
          type: 'person',
          displayName: 'W',
          identifiers: [{ kind: 'email', value: 'ww@x.com' }],
        },
        {},
      );
      const l = await m.upsertEntity(
        {
          type: 'person',
          displayName: 'L',
          identifiers: [{ kind: 'email', value: 'll@x.com' }],
        },
        {},
      );
      await m.mergeEntities(w.entity.id, l.entity.id, {});
      expect(await m.getEntity(l.entity.id, {})).toBeNull();
      expect(events.some((e) => e.type === 'entity.merge')).toBe(true);
      await m.shutdown();
    });

    it('throws when winner === loser', async () => {
      await expect(mem.mergeEntities('x', 'x', {})).rejects.toThrow(/must differ/);
    });

    it('throws when entities not found or not visible', async () => {
      await expect(mem.mergeEntities('missing1', 'missing2', {})).rejects.toThrow(
        /winner .* not found or not visible/,
      );
    });

    it("loser error message clearly indicates not-found-or-not-visible", async () => {
      const winner = await mem.upsertEntity(
        {
          type: 'person',
          displayName: 'W',
          identifiers: [{ kind: 'email', value: 'w@a.com' }],
        },
        {},
      );
      await expect(
        mem.mergeEntities(winner.entity.id, 'invisible-loser', {}),
      ).rejects.toThrow(/loser .* not found or not visible/);
    });
  });

  // ==========================================================================
  // getContext
  // ==========================================================================

  describe('getContext', () => {
    let subjectId: string;

    beforeEach(async () => {
      subjectId = await seedEntity(mem, { identifiers: [{ kind: 'email', value: 'ctx@x.com' }] });
    });

    it('returns entity + null profile + empty topFacts for a blank subject', async () => {
      const view = await mem.getContext(subjectId, {}, {});
      expect(view.entity.id).toBe(subjectId);
      expect(view.profile).toBeNull();
      expect(view.topFacts).toEqual([]);
    });

    it('returns top atomic facts bounded by topFactsLimit', async () => {
      for (let i = 0; i < 10; i++) {
        await mem.addFact(
          {
            subjectId,
            predicate: 'note',
            kind: 'atomic',
            value: i,
            confidence: 0.9,
          },
          {},
        );
      }
      const view = await mem.getContext(subjectId, { topFactsLimit: 3 }, {});
      expect(view.topFacts).toHaveLength(3);
    });

    it('excludes document facts from topFacts', async () => {
      await mem.addFact(
        { subjectId, predicate: 'note', kind: 'atomic', confidence: 0.8 },
        {},
      );
      await mem.addFact(
        { subjectId, predicate: 'bio', kind: 'document', details: 'long bio text' },
        {},
      );
      const view = await mem.getContext(subjectId, {}, {});
      expect(view.topFacts.every((f) => f.kind === 'atomic')).toBe(true);
    });

    it('returns documents tier when included', async () => {
      await mem.addFact(
        { subjectId, predicate: 'memo', kind: 'document', details: 'meeting memo' },
        {},
      );
      const view = await mem.getContext(
        subjectId,
        { include: ['documents'] },
        {},
      );
      expect(view.documents).toBeDefined();
      expect(view.documents!.some((f) => f.predicate === 'memo')).toBe(true);
    });

    it('documents tier excludes the canonical profile', async () => {
      await mem.addFact(
        { subjectId, predicate: 'profile', kind: 'document', details: 'canon' },
        {},
      );
      await mem.addFact(
        { subjectId, predicate: 'memo', kind: 'document', details: 'memo' },
        {},
      );
      const view = await mem.getContext(
        subjectId,
        { include: ['documents'] },
        {},
      );
      expect(view.documents!.map((f) => f.predicate)).toEqual(['memo']);
      expect(view.profile).not.toBeNull();
    });

    it('returns neighbors tier when included', async () => {
      const otherId = await seedEntity(mem, {
        identifiers: [{ kind: 'email', value: 'n@x.com' }],
      });
      await mem.addFact(
        { subjectId, predicate: 'knows', kind: 'atomic', objectId: otherId },
        {},
      );
      const view = await mem.getContext(
        subjectId,
        { include: ['neighbors'], neighborDepth: 1 },
        {},
      );
      expect(view.neighbors).toBeDefined();
      expect(view.neighbors!.nodes.length).toBeGreaterThanOrEqual(2);
    });

    it('semantic tier requires embedder; errors fold gracefully', async () => {
      // No embedder configured → semantic result is simply undefined (no throw).
      const view = await mem.getContext(
        subjectId,
        { include: ['semantic'], semanticQuery: 'test' },
        {},
      );
      expect(view.semantic).toBeUndefined();
    });

    it('calls embedder + store.semanticSearch when semantic tier included', async () => {
      const embedder = makeEmbedder();
      const m = new MemorySystem({ store, embedder });
      const subj = await seedEntity(m, {
        identifiers: [{ kind: 'email', value: 's@x.com' }],
      });
      await m.addFact(
        {
          subjectId: subj,
          predicate: 'note',
          kind: 'atomic',
          details: 'a'.repeat(100),
        },
        {},
      );
      await m.flushEmbeddings();
      const view = await m.getContext(
        subj,
        { include: ['semantic'], semanticQuery: 'something', semanticTopK: 3 },
        {},
      );
      expect(embedder.embed).toHaveBeenCalled();
      expect(view.semantic).toBeDefined();
      await m.shutdown();
    });

    it('throws when entity not visible / archived', async () => {
      await mem.archiveEntity(subjectId, {});
      await expect(mem.getContext(subjectId, {}, {})).rejects.toThrow(/not found/);
    });
  });

  // ==========================================================================
  // getProfile precedence
  // ==========================================================================

  describe('getProfile', () => {
    it('returns null when no profile exists', async () => {
      const subjectId = await seedEntity(mem, {});
      expect(await mem.getProfile(subjectId, {})).toBeNull();
    });

    it('resolution order: ownerId match > groupId match > global', async () => {
      const subjectId = await seedEntity(mem, {
        identifiers: [{ kind: 'email', value: 'p@x.com' }],
      });
      // Global profile
      await mem.addFact(
        { subjectId, predicate: 'profile', kind: 'document', details: 'GLOBAL' },
        {},
      );
      // Group profile
      await mem.addFact(
        {
          subjectId,
          predicate: 'profile',
          kind: 'document',
          details: 'GROUP',
          groupId: 'g1',
        },
        { groupId: 'g1' },
      );
      // Owner profile
      await mem.addFact(
        {
          subjectId,
          predicate: 'profile',
          kind: 'document',
          details: 'OWNER',
          ownerId: 'u1',
        },
        { userId: 'u1' },
      );

      // Caller with groupId + userId — should see OWNER.
      const byOwner = await mem.getProfile(subjectId, { groupId: 'g1', userId: 'u1' });
      expect(byOwner!.details).toBe('OWNER');

      // Different user in same group — should see GROUP.
      const byGroup = await mem.getProfile(subjectId, { groupId: 'g1', userId: 'other' });
      expect(byGroup!.details).toBe('GROUP');

      // Anonymous caller — should see GLOBAL.
      const global = await mem.getProfile(subjectId, {});
      expect(global!.details).toBe('GLOBAL');
    });

    it('ignores archived profiles', async () => {
      const subjectId = await seedEntity(mem, {
        identifiers: [{ kind: 'email', value: 'p2@x.com' }],
      });
      const profile = await mem.addFact(
        { subjectId, predicate: 'profile', kind: 'document', details: 'old' },
        {},
      );
      await mem.archiveFact(profile.id, {});
      expect(await mem.getProfile(subjectId, {})).toBeNull();
    });
  });

  // ==========================================================================
  // traverse + semanticSearch
  // ==========================================================================

  describe('traverse fallback', () => {
    it('falls through to genericTraverse when store lacks traverse()', async () => {
      // Build a facade store that hides the traverse capability.
      const shadow = store;
      const limitedStore: IMemoryStore = {
        createEntity: shadow.createEntity.bind(shadow),
        createEntities: shadow.createEntities.bind(shadow),
        updateEntity: shadow.updateEntity.bind(shadow),
        getEntity: shadow.getEntity.bind(shadow),
        findEntitiesByIdentifier: shadow.findEntitiesByIdentifier.bind(shadow),
        searchEntities: shadow.searchEntities.bind(shadow),
        listEntities: shadow.listEntities.bind(shadow),
        archiveEntity: shadow.archiveEntity.bind(shadow),
        deleteEntity: shadow.deleteEntity.bind(shadow),
        createFact: shadow.createFact.bind(shadow),
        createFacts: shadow.createFacts.bind(shadow),
        getFact: shadow.getFact.bind(shadow),
        findFacts: shadow.findFacts.bind(shadow),
        updateFact: shadow.updateFact.bind(shadow),
        countFacts: shadow.countFacts.bind(shadow),
        destroy: () => {},
      };
      const m = new MemorySystem({ store: limitedStore });
      const a = await seedEntity(m, { identifiers: [{ kind: 'email', value: 'lim_a@x.com' }] });
      const b = await seedEntity(m, { identifiers: [{ kind: 'email', value: 'lim_b@x.com' }] });
      await m.addFact(
        { subjectId: a, predicate: 'knows', kind: 'atomic', objectId: b },
        {},
      );
      const result = await m.traverse(a, { direction: 'out', maxDepth: 1 }, {});
      expect(result.nodes.map((n) => n.entity.id).sort()).toEqual([a, b].sort());
      // This MemorySystem shares `store` via the wrapper; do not double-destroy.
      m.destroy();
    });
  });

  describe('semanticSearch', () => {
    it('throws when no embedder configured', async () => {
      await expect(mem.semanticSearch('query', {}, {})).rejects.toThrow(
        SemanticSearchUnavailableError,
      );
    });

    it('throws when store lacks semanticSearch', async () => {
      const limitedStore: IMemoryStore = {
        ...store,
        createEntity: store.createEntity.bind(store),
        createEntities: store.createEntities.bind(store),
        updateEntity: store.updateEntity.bind(store),
        getEntity: store.getEntity.bind(store),
        findEntitiesByIdentifier: store.findEntitiesByIdentifier.bind(store),
        searchEntities: store.searchEntities.bind(store),
        listEntities: store.listEntities.bind(store),
        archiveEntity: store.archiveEntity.bind(store),
        deleteEntity: store.deleteEntity.bind(store),
        createFact: store.createFact.bind(store),
        createFacts: store.createFacts.bind(store),
        getFact: store.getFact.bind(store),
        findFacts: store.findFacts.bind(store),
        updateFact: store.updateFact.bind(store),
        countFacts: store.countFacts.bind(store),
        destroy: () => {},
      };
      delete (limitedStore as { semanticSearch?: unknown }).semanticSearch;
      const m = new MemorySystem({ store: limitedStore, embedder: makeEmbedder() });
      await expect(m.semanticSearch('query', {}, {})).rejects.toThrow(
        SemanticSearchUnavailableError,
      );
      m.destroy();
    });

    it('runs end-to-end with embedder + store support', async () => {
      const embedder = makeEmbedder();
      const m = new MemorySystem({ store, embedder });
      const subj = await seedEntity(m, { identifiers: [{ kind: 'email', value: 'se@x.com' }] });
      await m.addFact(
        {
          subjectId: subj,
          predicate: 'note',
          kind: 'atomic',
          details: 'a'.repeat(100),
        },
        {},
      );
      await m.flushEmbeddings();
      const results = await m.semanticSearch('something', {}, {}, 3);
      expect(embedder.embed).toHaveBeenCalledWith('something');
      expect(Array.isArray(results)).toBe(true);
      await m.shutdown();
    });
  });

  // ==========================================================================
  // regenerateProfile + auto-regen
  // ==========================================================================

  describe('regenerateProfile', () => {
    it('throws when no generator configured', async () => {
      const subjectId = await seedEntity(mem, {
        identifiers: [{ kind: 'email', value: 'rp@x.com' }],
      });
      await expect(mem.regenerateProfile(subjectId, {})).rejects.toThrow(
        ProfileGeneratorMissingError,
      );
    });

    it('calls generator with entity, atomic facts, and prior profile', async () => {
      const generate = vi.fn(async () => ({
        details: '# Profile\nSenior engineer',
        summaryForEmbedding: 'Senior engineer',
      }));
      const generator: IProfileGenerator = { generate };
      const m = new MemorySystem({ store, profileGenerator: generator });
      const subj = await seedEntity(m, {
        identifiers: [{ kind: 'email', value: 'rp2@x.com' }],
      });
      await m.addFact(
        { subjectId: subj, predicate: 'works_at', kind: 'atomic', details: 'Acme' },
        {},
      );
      const profile = await m.regenerateProfile(subj, {});
      expect(generate).toHaveBeenCalledTimes(1);
      expect(profile.predicate).toBe('profile');
      expect(profile.kind).toBe('document');
      expect(profile.details).toContain('Senior');
      await m.shutdown();
    });

    it('supersedes prior profile at same scope', async () => {
      const generate = vi.fn(async () => ({
        details: 'v1',
        summaryForEmbedding: 'v1',
      }));
      const m = new MemorySystem({ store, profileGenerator: { generate } });
      const subj = await seedEntity(m, {
        identifiers: [{ kind: 'email', value: 'rp3@x.com' }],
      });
      const first = await m.regenerateProfile(subj, {});
      generate.mockResolvedValueOnce({ details: 'v2', summaryForEmbedding: 'v2' });
      const second = await m.regenerateProfile(subj, {});
      expect(second.supersedes).toBe(first.id);
      const firstAfter = await store.getFact(first.id, {});
      expect(firstAfter!.archived).toBe(true);
      await m.shutdown();
    });

    it('emits profile.regenerate event', async () => {
      const events: ChangeEvent[] = [];
      const m = new MemorySystem({
        store,
        profileGenerator: {
          generate: async () => ({ details: 'x', summaryForEmbedding: 'x' }),
        },
        onChange: (e) => events.push(e),
      });
      const subj = await seedEntity(m, {
        identifiers: [{ kind: 'email', value: 'rp4@x.com' }],
      });
      await m.regenerateProfile(subj, {});
      expect(events.some((e) => e.type === 'profile.regenerate')).toBe(true);
      await m.shutdown();
    });
  });

  describe('auto-regen on addFact', () => {
    it('triggers once when atomic fact count reaches threshold', async () => {
      const generate = vi.fn(async () => ({
        details: 'auto',
        summaryForEmbedding: 'auto',
      }));
      const m = new MemorySystem({
        store,
        profileGenerator: { generate },
        profileRegenerationThreshold: 3,
      });
      const subj = await seedEntity(m, {
        identifiers: [{ kind: 'email', value: 'ar@x.com' }],
      });
      for (let i = 0; i < 3; i++) {
        await m.addFact({ subjectId: subj, predicate: 'p', kind: 'atomic', value: i }, {});
      }
      // Allow background regen to settle.
      await new Promise((r) => setTimeout(r, 50));
      expect(generate).toHaveBeenCalled();
      await m.shutdown();
    });

    it('regen failure does not block write path', async () => {
      const generate = vi.fn(async () => {
        throw new Error('LLM down');
      });
      const m = new MemorySystem({
        store,
        profileGenerator: { generate },
        profileRegenerationThreshold: 1,
      });
      const subj = await seedEntity(m, {
        identifiers: [{ kind: 'email', value: 'fail@x.com' }],
      });
      // addFact must still resolve even though background regen throws.
      await expect(
        m.addFact({ subjectId: subj, predicate: 'p', kind: 'atomic' }, {}),
      ).resolves.toBeDefined();
      await new Promise((r) => setTimeout(r, 30));
      await m.shutdown();
    });
  });

  // ==========================================================================
  // Rule engine hook
  // ==========================================================================

  describe('deriveFactsFor', () => {
    it('returns [] when no engine configured', async () => {
      const subj = await seedEntity(mem, {});
      expect(await mem.deriveFactsFor(subj, {})).toEqual([]);
    });

    it('invokes engine with a read-only view and writes derived facts', async () => {
      const engine: IRuleEngine = {
        deriveFor: vi.fn(async (entityId) => [
          {
            subjectId: entityId,
            predicate: 'derived_by_rule',
            kind: 'atomic',
            value: 42,
            derivedBy: 'rule_test',
          },
        ]),
      };
      const m = new MemorySystem({ store, ruleEngine: engine });
      const subj = await seedEntity(m, {
        identifiers: [{ kind: 'email', value: 'rl@x.com' }],
      });
      const written = await m.deriveFactsFor(subj, {});
      expect(written).toHaveLength(1);
      expect(written[0]!.derivedBy).toBe('rule_test');
      // IScopedMemoryView exposes only getEntity + findFacts — no write methods.
      const callArgs = (engine.deriveFor as ReturnType<typeof vi.fn>).mock.calls[0];
      const view = callArgs![1];
      expect(typeof view.getEntity).toBe('function');
      expect(typeof view.findFacts).toBe('function');
      expect((view as unknown as Record<string, unknown>).putFact).toBeUndefined();
      expect((view as unknown as Record<string, unknown>).addFact).toBeUndefined();
      await m.shutdown();
    });

    it('skips derived specs missing required fields', async () => {
      const engine: IRuleEngine = {
        deriveFor: async () => [
          { predicate: 'incomplete' }, // missing subjectId + kind
        ],
      };
      const m = new MemorySystem({ store, ruleEngine: engine });
      const subj = await seedEntity(m, {
        identifiers: [{ kind: 'email', value: 'sk@x.com' }],
      });
      const written = await m.deriveFactsFor(subj, {});
      expect(written).toHaveLength(0);
      await m.shutdown();
    });
  });

  // ==========================================================================
  // Embedding queue
  // ==========================================================================

  describe('embedding queue', () => {
    it('pendingEmbeddings() is 0 after flush', async () => {
      const embedder = makeEmbedder();
      const m = new MemorySystem({ store, embedder });
      const subj = await seedEntity(m, {
        identifiers: [{ kind: 'email', value: 'eq@x.com' }],
      });
      await m.addFact(
        {
          subjectId: subj,
          predicate: 'note',
          kind: 'atomic',
          details: 'a'.repeat(100),
        },
        {},
      );
      await m.flushEmbeddings();
      expect(m.pendingEmbeddings()).toBe(0);
      await m.shutdown();
    });

    it('retries up to configured max on failure then drops', async () => {
      let attempts = 0;
      const embedder: IEmbedder = {
        dimensions: 3,
        embed: vi.fn(async () => {
          attempts++;
          throw new Error('embed failed');
        }),
      };
      // Disable identity embedding so we only test fact-embedding retry behavior
      // in isolation (identity embedding would contribute its own retries).
      const m = new MemorySystem({
        store,
        embedder,
        embeddingQueue: { retries: 2, concurrency: 1 },
        entityResolution: { enableIdentityEmbedding: false },
      });
      const subj = await seedEntity(m, {
        identifiers: [{ kind: 'email', value: 'rt@x.com' }],
      });
      await m.addFact(
        {
          subjectId: subj,
          predicate: 'note',
          kind: 'atomic',
          details: 'a'.repeat(100),
        },
        {},
      );
      await m.flushEmbeddings();
      // initial + 2 retries = 3 attempts
      expect(attempts).toBe(3);
      await m.shutdown();
    });

    it('respects bounded concurrency', async () => {
      let inFlight = 0;
      let maxInFlight = 0;
      const embedder: IEmbedder = {
        dimensions: 3,
        embed: vi.fn(async () => {
          inFlight++;
          maxInFlight = Math.max(maxInFlight, inFlight);
          await new Promise((r) => setTimeout(r, 10));
          inFlight--;
          return [0, 0, 0];
        }),
      };
      const m = new MemorySystem({
        store,
        embedder,
        embeddingQueue: { concurrency: 2 },
      });
      const subj = await seedEntity(m, {
        identifiers: [{ kind: 'email', value: 'cc@x.com' }],
      });
      for (let i = 0; i < 6; i++) {
        await m.addFact(
          {
            subjectId: subj,
            predicate: 'note',
            kind: 'atomic',
            details: 'x'.repeat(100),
            value: i,
          },
          {},
        );
      }
      await m.flushEmbeddings();
      expect(maxInFlight).toBeLessThanOrEqual(2);
      expect(maxInFlight).toBeGreaterThan(0);
      await m.shutdown();
    });
  });

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  describe('lifecycle', () => {
    it('destroy is idempotent + flips isDestroyed', () => {
      mem.destroy();
      expect(mem.isDestroyed).toBe(true);
      expect(() => mem.destroy()).not.toThrow();
    });

    it('operations throw after destroy', async () => {
      mem.destroy();
      await expect(
        mem.upsertEntity(
          { type: 'x', displayName: 'y', identifiers: [{ kind: 'e', value: 'f' }] },
          {},
        ),
      ).rejects.toThrow(/destroyed/);
    });

    it('shutdown calls store.shutdown when present', async () => {
      const shutdown = vi.fn(async () => {});
      const m = new MemorySystem({
        store: {
          ...store,
          shutdown,
          createEntity: store.createEntity.bind(store),
          createEntities: store.createEntities.bind(store),
          updateEntity: store.updateEntity.bind(store),
          getEntity: store.getEntity.bind(store),
          findEntitiesByIdentifier: store.findEntitiesByIdentifier.bind(store),
          searchEntities: store.searchEntities.bind(store),
          listEntities: store.listEntities.bind(store),
          archiveEntity: store.archiveEntity.bind(store),
          deleteEntity: store.deleteEntity.bind(store),
          createFact: store.createFact.bind(store),
          createFacts: store.createFacts.bind(store),
          getFact: store.getFact.bind(store),
          findFacts: store.findFacts.bind(store),
          updateFact: store.updateFact.bind(store),
          countFacts: store.countFacts.bind(store),
          destroy: () => {},
        },
      });
      await m.shutdown();
      expect(shutdown).toHaveBeenCalled();
    });

    it('onChange listener failures do not impact the data path', async () => {
      const m = new MemorySystem({
        store,
        onChange: () => {
          throw new Error('listener broke');
        },
        // Silence the console.warn fallback in the default code path.
        onError: () => undefined,
      });
      await expect(
        m.upsertEntity(
          {
            type: 'person',
            displayName: 'E',
            identifiers: [{ kind: 'email', value: 'lst@x.com' }],
          },
          {},
        ),
      ).resolves.toBeDefined();
      await m.shutdown();
    });
  });
});
