/**
 * MemorySystem — registry-driven behavior tests.
 *
 * Covers: canonicalization on addFact/addFacts, defaultImportance,
 * isAggregate defaults, singleValued auto-supersede (on/off/explicit/scope),
 * strict-mode rejection, ranking weight merge, canonicalizePredicate +
 * hasPredicateRegistry + getPredicateDefinition public methods, constructor
 * strict-without-registry validation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemorySystem } from '@/memory/MemorySystem.js';
import { InMemoryAdapter } from '@/memory/adapters/inmemory/InMemoryAdapter.js';
import { PredicateRegistry } from '@/memory/predicates/index.js';
import type { PredicateDefinition } from '@/memory/predicates/index.js';

async function seedPerson(mem: MemorySystem, name = 'Alice'): Promise<string> {
  const res = await mem.upsertEntity(
    {
      type: 'person',
      displayName: name,
      identifiers: [{ kind: 'email', value: `${name.toLowerCase()}@example.com` }],
    },
    {},
  );
  return res.entity.id;
}

// A minimal custom registry used in most tests — avoids coupling to the full
// standard set so we can pinpoint behaviors.
function minimalRegistry(extra: PredicateDefinition[] = []): PredicateRegistry {
  const r = PredicateRegistry.empty();
  r.registerAll([
    {
      name: 'works_at',
      description: 'Employment.',
      category: 'identity',
      aliases: ['worksAt', 'employed_by'],
      defaultImportance: 1.0,
      rankingWeight: 2.0,
    },
    {
      name: 'current_title',
      description: 'Current title.',
      category: 'identity',
      defaultImportance: 1.0,
      rankingWeight: 1.5,
      singleValued: true,
    },
    {
      name: 'interaction_count',
      description: 'Interaction count aggregate.',
      category: 'communication',
      isAggregate: true,
    },
    {
      name: 'noted',
      description: 'Passing note.',
      category: 'observation',
      defaultImportance: 0.3,
      rankingWeight: 0.5,
    },
    ...extra,
  ]);
  return r;
}

describe('MemorySystem — constructor validation', () => {
  it("throws when predicateMode='strict' is set without a registry", () => {
    const store = new InMemoryAdapter();
    expect(
      () => new MemorySystem({ store, predicateMode: 'strict' }),
    ).toThrow(/requires a `predicates` registry/);
  });

  it('accepts strict mode when registry is provided', () => {
    const store = new InMemoryAdapter();
    expect(
      () =>
        new MemorySystem({
          store,
          predicates: minimalRegistry(),
          predicateMode: 'strict',
        }),
    ).not.toThrow();
  });

  it('no-registry construction continues to work (back-compat)', () => {
    const store = new InMemoryAdapter();
    expect(() => new MemorySystem({ store })).not.toThrow();
  });
});

describe('MemorySystem — canonicalizePredicate / registry introspection', () => {
  let mem: MemorySystem;

  beforeEach(() => {
    mem = new MemorySystem({ store: new InMemoryAdapter(), predicates: minimalRegistry() });
  });
  afterEach(async () => {
    if (!mem.isDestroyed) await mem.shutdown();
  });

  it('hasPredicateRegistry reflects config', () => {
    expect(mem.hasPredicateRegistry()).toBe(true);
    const plain = new MemorySystem({ store: new InMemoryAdapter() });
    expect(plain.hasPredicateRegistry()).toBe(false);
  });

  it('canonicalizePredicate normalizes camelCase + aliases', () => {
    expect(mem.canonicalizePredicate('worksAt')).toBe('works_at');
    expect(mem.canonicalizePredicate('employed_by')).toBe('works_at');
    expect(mem.canonicalizePredicate('EMPLOYED_BY')).toBe('works_at');
  });

  it('canonicalizePredicate passes through when no registry', () => {
    const plain = new MemorySystem({ store: new InMemoryAdapter() });
    expect(plain.canonicalizePredicate('worksAt')).toBe('worksAt');
  });

  it('getPredicateDefinition returns the definition or null', () => {
    expect(mem.getPredicateDefinition('works_at')?.name).toBe('works_at');
    expect(mem.getPredicateDefinition('worksAt')?.name).toBe('works_at');
    expect(mem.getPredicateDefinition('does_not_exist')).toBeNull();
  });
});

describe('MemorySystem.addFact — canonicalization', () => {
  let mem: MemorySystem;
  let aliceId: string;

  beforeEach(async () => {
    mem = new MemorySystem({
      store: new InMemoryAdapter(),
      predicates: minimalRegistry(),
    });
    aliceId = await seedPerson(mem);
  });
  afterEach(async () => {
    if (!mem.isDestroyed) await mem.shutdown();
  });

  it('camelCase input is stored as canonical snake_case', async () => {
    const fact = await mem.addFact(
      { subjectId: aliceId, predicate: 'worksAt', kind: 'atomic', value: 'Acme' },
      {},
    );
    expect(fact.predicate).toBe('works_at');
  });

  it('alias input is stored as canonical name', async () => {
    const fact = await mem.addFact(
      { subjectId: aliceId, predicate: 'employed_by', kind: 'atomic', value: 'Acme' },
      {},
    );
    expect(fact.predicate).toBe('works_at');
  });

  it('unknown predicate passes through normalized (permissive mode)', async () => {
    const fact = await mem.addFact(
      { subjectId: aliceId, predicate: 'randomThing', kind: 'atomic', value: 'x' },
      {},
    );
    expect(fact.predicate).toBe('random_thing');
  });

  it('applies defaultImportance when caller omits importance', async () => {
    const fact = await mem.addFact(
      { subjectId: aliceId, predicate: 'works_at', kind: 'atomic', value: 'Acme' },
      {},
    );
    expect(fact.importance).toBe(1.0);
  });

  it('caller importance wins over registry default', async () => {
    const fact = await mem.addFact(
      {
        subjectId: aliceId,
        predicate: 'works_at',
        kind: 'atomic',
        value: 'Acme',
        importance: 0.2,
      },
      {},
    );
    expect(fact.importance).toBe(0.2);
  });

  it('applies isAggregate default from registry', async () => {
    const fact = await mem.addFact(
      {
        subjectId: aliceId,
        predicate: 'interaction_count',
        kind: 'atomic',
        value: 1,
      },
      {},
    );
    expect(fact.isAggregate).toBe(true);
  });
});

describe('MemorySystem.addFact — strict mode', () => {
  let mem: MemorySystem;
  let aliceId: string;

  beforeEach(async () => {
    mem = new MemorySystem({
      store: new InMemoryAdapter(),
      predicates: minimalRegistry(),
      predicateMode: 'strict',
    });
    aliceId = await seedPerson(mem);
  });
  afterEach(async () => {
    if (!mem.isDestroyed) await mem.shutdown();
  });

  it('rejects unknown predicate with a clear error', async () => {
    await expect(
      mem.addFact(
        { subjectId: aliceId, predicate: 'unknownPredicate', kind: 'atomic', value: 'x' },
        {},
      ),
    ).rejects.toThrow(/not in registry/);
  });

  it('accepts known predicate (canonical)', async () => {
    await expect(
      mem.addFact(
        { subjectId: aliceId, predicate: 'works_at', kind: 'atomic', value: 'Acme' },
        {},
      ),
    ).resolves.toBeTruthy();
  });

  it('accepts alias input — canonicalized before the has() check', async () => {
    await expect(
      mem.addFact(
        { subjectId: aliceId, predicate: 'employed_by', kind: 'atomic', value: 'Acme' },
        {},
      ),
    ).resolves.toBeTruthy();
  });
});

describe('MemorySystem.addFact — singleValued auto-supersede', () => {
  let mem: MemorySystem;
  let aliceId: string;

  beforeEach(async () => {
    mem = new MemorySystem({
      store: new InMemoryAdapter(),
      predicates: minimalRegistry(),
    });
    aliceId = await seedPerson(mem);
  });
  afterEach(async () => {
    if (!mem.isDestroyed) await mem.shutdown();
  });

  it('writing a singleValued predicate twice supersedes the first', async () => {
    const first = await mem.addFact(
      { subjectId: aliceId, predicate: 'current_title', kind: 'atomic', value: 'Engineer' },
      {},
    );
    const second = await mem.addFact(
      { subjectId: aliceId, predicate: 'current_title', kind: 'atomic', value: 'Senior' },
      {},
    );
    expect(second.supersedes).toBe(first.id);

    // First is archived; second is active.
    const firstNow = await (mem as unknown as { store: InMemoryAdapter }).store.getFact(
      first.id,
      {},
    );
    expect(firstNow?.archived).toBe(true);
  });

  it('camelCase + alias inputs still trigger supersede (via canonicalization)', async () => {
    const first = await mem.addFact(
      { subjectId: aliceId, predicate: 'current_title', kind: 'atomic', value: 'A' },
      {},
    );
    // Write with a different case form — must be recognized as the same predicate.
    const second = await mem.addFact(
      { subjectId: aliceId, predicate: 'currentTitle', kind: 'atomic', value: 'B' },
      {},
    );
    expect(second.supersedes).toBe(first.id);
  });

  it('does NOT auto-supersede when predicateAutoSupersede:false', async () => {
    const memOff = new MemorySystem({
      store: new InMemoryAdapter(),
      predicates: minimalRegistry(),
      predicateAutoSupersede: false,
    });
    const pid = await seedPerson(memOff, 'Bob');
    const a = await memOff.addFact(
      { subjectId: pid, predicate: 'current_title', kind: 'atomic', value: 'A' },
      {},
    );
    const b = await memOff.addFact(
      { subjectId: pid, predicate: 'current_title', kind: 'atomic', value: 'B' },
      {},
    );
    expect(b.supersedes).toBeUndefined();
    // First is NOT archived.
    const firstNow = await (memOff as unknown as { store: InMemoryAdapter }).store.getFact(
      a.id,
      {},
    );
    expect(firstNow?.archived).toBeFalsy();
    await memOff.shutdown();
  });

  it('does NOT override an explicit supersedes passed by the caller', async () => {
    const a = await mem.addFact(
      { subjectId: aliceId, predicate: 'current_title', kind: 'atomic', value: 'A' },
      {},
    );
    const b = await mem.addFact(
      { subjectId: aliceId, predicate: 'current_title', kind: 'atomic', value: 'B' },
      {},
    );
    // Third call explicitly supersedes the FIRST fact (not the second), to
    // demonstrate caller's choice is respected.
    const c = await mem.addFact(
      {
        subjectId: aliceId,
        predicate: 'current_title',
        kind: 'atomic',
        value: 'C',
        supersedes: a.id,
      },
      {},
    );
    expect(c.supersedes).toBe(a.id); // not b.id (which would be auto)
  });

  it('does NOT auto-supersede for non-singleValued predicates', async () => {
    const a = await mem.addFact(
      { subjectId: aliceId, predicate: 'works_at', kind: 'atomic', value: 'Acme' },
      {},
    );
    const b = await mem.addFact(
      { subjectId: aliceId, predicate: 'works_at', kind: 'atomic', value: 'Contoso' },
      {},
    );
    expect(b.supersedes).toBeUndefined();
    expect(a.id).not.toBe(b.id);
  });

  it('does NOT fire when the predicate is unknown (registry has no singleValued info)', async () => {
    const a = await mem.addFact(
      { subjectId: aliceId, predicate: 'mystery_predicate', kind: 'atomic', value: 'A' },
      {},
    );
    const b = await mem.addFact(
      { subjectId: aliceId, predicate: 'mystery_predicate', kind: 'atomic', value: 'B' },
      {},
    );
    expect(b.supersedes).toBeUndefined();
    expect(a.id).not.toBe(b.id);
  });

  it('emits fact.supersede event on auto-supersede', async () => {
    const events: string[] = [];
    const mem2 = new MemorySystem({
      store: new InMemoryAdapter(),
      predicates: minimalRegistry(),
      onChange: (e) => events.push(e.type),
    });
    const pid = await seedPerson(mem2, 'Carol');
    await mem2.addFact(
      { subjectId: pid, predicate: 'current_title', kind: 'atomic', value: 'A' },
      {},
    );
    await mem2.addFact(
      { subjectId: pid, predicate: 'current_title', kind: 'atomic', value: 'B' },
      {},
    );
    expect(events).toContain('fact.supersede');
    await mem2.shutdown();
  });
});

describe('MemorySystem — ranking weight merge', () => {
  let aliceId: string;
  let mem: MemorySystem;

  afterEach(async () => {
    if (mem && !mem.isDestroyed) await mem.shutdown();
  });

  it('registry weights flow through to topFacts ranking', async () => {
    mem = new MemorySystem({
      store: new InMemoryAdapter(),
      predicates: minimalRegistry(),
    });
    aliceId = await seedPerson(mem);

    // works_at weight=2.0, noted weight=0.5 — both with same importance so the
    // delta comes from the weight.
    const nowMs = Date.now();
    await mem.addFact(
      {
        subjectId: aliceId,
        predicate: 'noted',
        kind: 'atomic',
        value: 'note',
        importance: 0.5,
        observedAt: new Date(nowMs),
      },
      {},
    );
    await mem.addFact(
      {
        subjectId: aliceId,
        predicate: 'works_at',
        kind: 'atomic',
        value: 'Acme',
        importance: 0.5,
        observedAt: new Date(nowMs),
      },
      {},
    );
    const ctx = await mem.getContext(aliceId, { topFactsLimit: 5 }, {});
    const preds = ctx.topFacts.map((f) => f.predicate);
    // works_at should rank higher than noted given 2.0 vs 0.5 weight.
    expect(preds.indexOf('works_at')).toBeLessThan(preds.indexOf('noted'));
  });

  it('user-supplied weights override registry weights', async () => {
    mem = new MemorySystem({
      store: new InMemoryAdapter(),
      predicates: minimalRegistry(),
      topFactsRanking: {
        predicateWeights: { works_at: 0.1, noted: 10.0 }, // invert
      },
    });
    aliceId = await seedPerson(mem);
    const nowMs = Date.now();
    await mem.addFact(
      {
        subjectId: aliceId,
        predicate: 'works_at',
        kind: 'atomic',
        value: 'Acme',
        importance: 0.5,
        observedAt: new Date(nowMs),
      },
      {},
    );
    await mem.addFact(
      {
        subjectId: aliceId,
        predicate: 'noted',
        kind: 'atomic',
        value: 'x',
        importance: 0.5,
        observedAt: new Date(nowMs),
      },
      {},
    );
    const ctx = await mem.getContext(aliceId, { topFactsLimit: 5 }, {});
    const preds = ctx.topFacts.map((f) => f.predicate);
    // With inverted weights, noted should now rank higher.
    expect(preds.indexOf('noted')).toBeLessThan(preds.indexOf('works_at'));
  });
});

describe('MemorySystem.addFacts — batch canonicalization', () => {
  it('canonicalizes predicates in batch writes', async () => {
    const mem = new MemorySystem({
      store: new InMemoryAdapter(),
      predicates: minimalRegistry(),
    });
    const aliceId = await seedPerson(mem);
    const facts = await mem.addFacts(
      [
        { subjectId: aliceId, predicate: 'worksAt', kind: 'atomic', value: 'Acme' },
        { subjectId: aliceId, predicate: 'employed_by', kind: 'atomic', value: 'Contoso' },
      ],
      {},
    );
    expect(facts.map((f) => f.predicate)).toEqual(['works_at', 'works_at']);
    await mem.shutdown();
  });
});

describe('MemorySystem — auto-supersede scope isolation', () => {
  it('auto-supersede only sees facts in the caller scope', async () => {
    // Two scopes: (g1, u1) and (g1, u2). Writing current_title as u1 must NOT
    // supersede a current_title written as u2 (which u1 cannot see).
    const mem = new MemorySystem({
      store: new InMemoryAdapter(),
      predicates: minimalRegistry(),
    });
    // Group-scoped person (visible to both u1 and u2 within g1).
    const personRes = await mem.upsertEntity(
      {
        type: 'person',
        displayName: 'Shared',
        identifiers: [{ kind: 'email', value: 'shared@example.com' }],
        groupId: 'g1',
      },
      { groupId: 'g1' },
    );
    const pid = personRes.entity.id;

    // User 1 sets current_title.
    const u1Fact = await mem.addFact(
      {
        subjectId: pid,
        predicate: 'current_title',
        kind: 'atomic',
        value: 'Engineer',
        ownerId: 'u1',
      },
      { groupId: 'g1', userId: 'u1' },
    );

    // User 2 sets current_title — must NOT supersede u1's (different scope).
    const u2Fact = await mem.addFact(
      {
        subjectId: pid,
        predicate: 'current_title',
        kind: 'atomic',
        value: 'Manager',
        ownerId: 'u2',
      },
      { groupId: 'g1', userId: 'u2' },
    );

    expect(u2Fact.supersedes).toBeUndefined();
    // u1 fact is untouched.
    const u1Now = await (mem as unknown as { store: InMemoryAdapter }).store.getFact(
      u1Fact.id,
      { groupId: 'g1', userId: 'u1' },
    );
    expect(u1Now?.archived).toBeFalsy();
    await mem.shutdown();
  });
});
