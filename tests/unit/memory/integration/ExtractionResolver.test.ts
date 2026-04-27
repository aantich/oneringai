/**
 * ExtractionResolver tests — end-to-end from raw LLM output → resolved facts.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemorySystem } from '@/memory/MemorySystem.js';
import { InMemoryAdapter } from '@/memory/adapters/inmemory/InMemoryAdapter.js';
import { ExtractionResolver } from '@/memory/integration/ExtractionResolver.js';
import type { ExtractionOutput } from '@/memory/integration/ExtractionResolver.js';
import type { ScopeFilter } from '@/memory/types.js';

describe('ExtractionResolver', () => {
  let store: InMemoryAdapter;
  let mem: MemorySystem;
  let resolver: ExtractionResolver;
  const scope: ScopeFilter = { userId: 'test-user' };

  beforeEach(() => {
    store = new InMemoryAdapter();
    mem = new MemorySystem({ store });
    resolver = new ExtractionResolver(mem);
  });

  afterEach(async () => {
    if (!mem.isDestroyed) await mem.shutdown();
  });

  const johnMicrosoftQ3: ExtractionOutput = {
    mentions: {
      m1: {
        surface: 'John Doe',
        type: 'person',
        identifiers: [{ kind: 'email', value: 'john@microsoft.com' }],
      },
      m2: {
        surface: 'Microsoft',
        type: 'organization',
        identifiers: [{ kind: 'domain', value: 'microsoft.com' }],
        aliases: ['MSFT', 'Microsoft Inc.'],
      },
      m3: { surface: 'Q3 Planning', type: 'project' },
    },
    facts: [
      { subject: 'm1', predicate: 'works_at', object: 'm2', confidence: 0.95, importance: 1.0 },
      { subject: 'm1', predicate: 'leads', object: 'm3', confidence: 0.8 },
      {
        subject: 'm1',
        predicate: 'mentioned_topic',
        value: 'erp_renewal',
        details: 'John expressed frustration with Oracle timeline',
        contextIds: ['m2', 'm3'],
        importance: 0.7,
      },
    ],
  };

  it('resolves 3 mentions to 3 distinct entities + writes 3 facts', async () => {
    const result = await resolver.resolveAndIngest(johnMicrosoftQ3, 'signal_123', scope);

    expect(result.entities).toHaveLength(3);
    expect(result.entities.every((e) => !e.resolved)).toBe(true); // all new
    expect(result.facts).toHaveLength(3);
    expect(result.unresolved).toEqual([]);
  });

  it('attaches sourceSignalId to every written fact', async () => {
    const result = await resolver.resolveAndIngest(johnMicrosoftQ3, 'signal_abc', scope);
    for (const f of result.facts) {
      expect(f.sourceSignalId).toBe('signal_abc');
    }
  });

  it('forwards evidenceQuote from ExtractionFactSpec onto the stored fact', async () => {
    const out: ExtractionOutput = {
      mentions: {
        m1: { surface: 'Alice', type: 'person' },
      },
      facts: [
        {
          subject: 'm1',
          predicate: 'committed_to',
          value: 'ship-by-eoq',
          evidenceQuote: '"we will ship by end of quarter"',
        },
      ],
    };
    const result = await resolver.resolveAndIngest(out, 'sig_eq', scope);
    expect(result.facts).toHaveLength(1);
    expect(result.facts[0]!.evidenceQuote).toBe('"we will ship by end of quarter"');
  });

  it('translates mention labels to real entity IDs in facts', async () => {
    const result = await resolver.resolveAndIngest(johnMicrosoftQ3, 'signal_1', scope);
    const john = result.entities.find((e) => e.label === 'm1')!;
    const microsoft = result.entities.find((e) => e.label === 'm2')!;
    const q3 = result.entities.find((e) => e.label === 'm3')!;

    const worksAt = result.facts.find((f) => f.predicate === 'works_at')!;
    expect(worksAt.subjectId).toBe(john.entity.id);
    expect(worksAt.objectId).toBe(microsoft.entity.id);

    const leads = result.facts.find((f) => f.predicate === 'leads')!;
    expect(leads.subjectId).toBe(john.entity.id);
    expect(leads.objectId).toBe(q3.entity.id);

    const topic = result.facts.find((f) => f.predicate === 'mentioned_topic')!;
    expect(topic.subjectId).toBe(john.entity.id);
    expect(topic.contextIds!.sort()).toEqual([microsoft.entity.id, q3.entity.id].sort());
  });

  it('preserves confidence + importance on facts', async () => {
    const result = await resolver.resolveAndIngest(johnMicrosoftQ3, 'signal_2', scope);
    const worksAt = result.facts.find((f) => f.predicate === 'works_at')!;
    expect(worksAt.confidence).toBe(0.95);
    expect(worksAt.importance).toBe(1.0);
  });

  it('on repeat ingest, resolves existing entities instead of duplicating', async () => {
    await resolver.resolveAndIngest(johnMicrosoftQ3, 'signal_1', scope);
    const second = await resolver.resolveAndIngest(johnMicrosoftQ3, 'signal_2', scope);

    // All three entities should be resolved (not created).
    expect(second.entities.every((e) => e.resolved)).toBe(true);
  });

  it('accumulates aliases on re-ingest with variant surface forms', async () => {
    await resolver.resolveAndIngest(johnMicrosoftQ3, 'signal_1', scope);

    const secondOutput: ExtractionOutput = {
      mentions: {
        m1: {
          surface: 'Microsoft Corporation',  // fresh variant not already in aliases
          type: 'organization',
          identifiers: [{ kind: 'domain', value: 'microsoft.com' }],
        },
      },
      facts: [],
    };
    const second = await resolver.resolveAndIngest(secondOutput, 'signal_2', scope);
    expect(second.entities[0]!.resolved).toBe(true);

    // Filter by organization type to avoid matching John's email.
    const entities = await store.searchEntities('Microsoft', { types: ['organization'] }, scope);
    const microsoft = entities.items[0]!;
    expect(microsoft.aliases).toBeDefined();
    // Aliases should contain the originally-supplied variants AND the new "Microsoft Corporation".
    expect(microsoft.aliases!).toContain('MSFT');
    expect(microsoft.aliases!).toContain('Microsoft Inc.');
    expect(microsoft.aliases!).toContain('Microsoft Corporation');
  });

  it('records fact targeting undefined mention label as unresolved', async () => {
    const bad: ExtractionOutput = {
      mentions: {
        m1: {
          surface: 'John',
          type: 'person',
          identifiers: [{ kind: 'email', value: 'john@x.com' }],
        },
      },
      facts: [
        // object label "m2" never declared
        { subject: 'm1', predicate: 'knows', object: 'm2' },
        // good fact should still be written
        { subject: 'm1', predicate: 'note', value: 'hello' },
      ],
    };
    const result = await resolver.resolveAndIngest(bad, 'signal_x', scope);
    expect(result.facts).toHaveLength(1);
    expect(result.facts[0]!.predicate).toBe('note');
    expect(result.unresolved).toHaveLength(1);
    expect(result.unresolved[0]!.reason).toMatch(/object label "m2"/);
  });

  it('records fact with bad subject label as unresolved', async () => {
    const bad: ExtractionOutput = {
      mentions: {
        m1: {
          surface: 'John',
          type: 'person',
          identifiers: [{ kind: 'email', value: 'john@x.com' }],
        },
      },
      facts: [{ subject: 'unknown_label', predicate: 'note', value: 'x' }],
    };
    const result = await resolver.resolveAndIngest(bad, 'signal', scope);
    expect(result.facts).toHaveLength(0);
    expect(result.unresolved[0]!.reason).toMatch(/subject label/);
  });

  it('records bad contextId label as unresolved but still writes the fact (C2)', async () => {
    const bad: ExtractionOutput = {
      mentions: {
        m1: {
          surface: 'John',
          type: 'person',
          identifiers: [{ kind: 'email', value: 'j@x.com' }],
        },
      },
      facts: [
        {
          subject: 'm1',
          predicate: 'note',
          value: 'x',
          contextIds: ['undefined_label'],
        },
      ],
    };
    const result = await resolver.resolveAndIngest(bad, 'signal', scope);
    // Prior behaviour dropped the entire fact on one missing contextId. New
    // behaviour: surface the drop in `unresolved`, keep the fact with the
    // labels that did resolve (here: none, so contextIds is undefined).
    expect(result.facts).toHaveLength(1);
    expect(result.facts[0]!.contextIds).toBeUndefined();
    expect(result.unresolved[0]!.reason).toMatch(/context label/);
  });

  it('preserves resolved contextIds when one label is missing', async () => {
    const mixed: ExtractionOutput = {
      mentions: {
        m1: {
          surface: 'John',
          type: 'person',
          identifiers: [{ kind: 'email', value: 'j@x.com' }],
        },
        m2: {
          surface: 'Q3 Planning',
          type: 'topic',
        },
      },
      facts: [
        {
          subject: 'm1',
          predicate: 'note',
          value: 'x',
          contextIds: ['m2', 'hallucinated_label'],
        },
      ],
    };
    const result = await resolver.resolveAndIngest(mixed, 'signal', scope);
    expect(result.facts).toHaveLength(1);
    expect(result.facts[0]!.contextIds).toHaveLength(1);
    expect(result.unresolved[0]!.reason).toMatch(/hallucinated_label/);
  });

  it('surfaces mergeCandidates when alias-tier match is below autoResolveThreshold', async () => {
    // Pre-seed Microsoft with an alias "MSFT".
    await mem.upsertEntityBySurface(
      {
        surface: 'Microsoft',
        type: 'organization',
        identifiers: [{ kind: 'domain', value: 'microsoft.com' }],
        aliases: ['MSFT'],
      },
      scope,
    );

    // Extract "MSFT" — alias tier returns confidence 0.85, which is below
    // the default 0.9 autoResolveThreshold → new entity created, but the
    // existing Microsoft surfaces as a merge candidate for human review.
    const output: ExtractionOutput = {
      mentions: {
        m1: { surface: 'MSFT', type: 'organization' },
      },
      facts: [],
    };
    const result = await resolver.resolveAndIngest(output, 'signal_merge', scope);
    expect(result.mergeCandidates.length).toBeGreaterThanOrEqual(1);
  });

  it('empty mentions + empty facts → empty result', async () => {
    const result = await resolver.resolveAndIngest(
      { mentions: {}, facts: [] },
      'signal_empty',
      scope,
    );
    expect(result.entities).toEqual([]);
    expect(result.facts).toEqual([]);
    expect(result.unresolved).toEqual([]);
  });

  it('handles task-as-entity — task entity + state attribute fact', async () => {
    const output: ExtractionOutput = {
      mentions: {
        m1: {
          surface: 'John',
          type: 'person',
          identifiers: [{ kind: 'email', value: 'j@acme.com' }],
        },
        m2: { surface: 'Send Q3 budget proposal', type: 'task' },
      },
      facts: [
        { subject: 'm1', predicate: 'committed_to', object: 'm2', confidence: 0.9 },
        {
          subject: 'm2',
          predicate: 'due_date',
          value: '2026-04-30',
          importance: 0.8,
        },
      ],
    };
    const result = await resolver.resolveAndIngest(output, 'signal_task', scope);
    expect(result.facts).toHaveLength(2);
    const task = result.entities.find((e) => e.entity.type === 'task');
    expect(task).toBeDefined();
    expect(task!.entity.displayName).toBe('Send Q3 budget proposal');
  });

  it('parses ISO date strings in observedAt/validFrom/validUntil', async () => {
    const output: ExtractionOutput = {
      mentions: {
        m1: {
          surface: 'John',
          type: 'person',
          identifiers: [{ kind: 'email', value: 'jd@x.com' }],
        },
      },
      facts: [
        {
          subject: 'm1',
          predicate: 'title',
          value: 'CTO',
          validFrom: '2026-01-01',
          validUntil: '2026-12-31',
          observedAt: '2026-02-15',
        },
      ],
    };
    const result = await resolver.resolveAndIngest(output, 'signal_dates', scope);
    const fact = result.facts[0]!;
    expect(fact.validFrom).toBeInstanceOf(Date);
    expect(fact.validFrom!.getFullYear()).toBe(2026);
    expect(fact.observedAt).toBeInstanceOf(Date);
  });

  describe('preResolved bindings', () => {
    it('uses pre-resolved entity id without calling upsertEntityBySurface', async () => {
      const antonSeed = await mem.upsertEntityBySurface(
        {
          surface: 'Anton Antich',
          type: 'person',
          identifiers: [{ kind: 'email', value: 'anton@everworker.ai' }],
        },
        scope,
      );

      const countBefore = (await store.listEntities({}, { limit: 100 }, scope)).items.length;

      const output: ExtractionOutput = {
        mentions: {
          m2: {
            surface: 'Acme Corp',
            type: 'organization',
            identifiers: [{ kind: 'domain', value: 'acme.com' }],
          },
        },
        facts: [{ subject: 'm1', predicate: 'works_at', object: 'm2', confidence: 0.95 }],
      };

      const result = await resolver.resolveAndIngest(output, 'signal_seed', scope, {
        preResolved: { m1: antonSeed.entity.id },
      });

      expect(result.facts).toHaveLength(1);
      expect(result.facts[0]!.subjectId).toBe(antonSeed.entity.id);
      expect(result.unresolved).toEqual([]);

      const countAfter = (await store.listEntities({}, { limit: 100 }, scope)).items.length;
      expect(countAfter).toBe(countBefore + 1);
    });

    it('ignores a mention that redeclares a pre-resolved label', async () => {
      const antonSeed = await mem.upsertEntityBySurface(
        {
          surface: 'Anton Antich',
          type: 'person',
          identifiers: [{ kind: 'email', value: 'anton@everworker.ai' }],
        },
        scope,
      );

      const output: ExtractionOutput = {
        mentions: {
          m1: {
            surface: 'Anton',
            type: 'person',
            identifiers: [{ kind: 'email', value: 'anton@everworker.ai' }],
          },
          m2: {
            surface: 'Acme',
            type: 'organization',
            identifiers: [{ kind: 'domain', value: 'acme.com' }],
          },
        },
        facts: [{ subject: 'm1', predicate: 'works_at', object: 'm2' }],
      };

      const result = await resolver.resolveAndIngest(output, 'signal_redeclare', scope, {
        preResolved: { m1: antonSeed.entity.id },
      });

      expect(result.facts).toHaveLength(1);
      expect(result.facts[0]!.subjectId).toBe(antonSeed.entity.id);

      const m1Entries = result.entities.filter((e) => e.label === 'm1');
      expect(m1Entries.length).toBeLessThanOrEqual(1);
      const m2 = result.entities.find((e) => e.label === 'm2')!;
      expect(m2).toBeDefined();
    });

    it('pre-resolved labels work as contextIds too', async () => {
      const dealSeed = await mem.upsertEntityBySurface(
        { surface: 'Acme Deal', type: 'topic', identifiers: [{ kind: 'domain', value: 'acme.com/deal-42' }] },
        scope,
      );

      const output: ExtractionOutput = {
        mentions: {
          m1: {
            surface: 'John',
            type: 'person',
            identifiers: [{ kind: 'email', value: 'john@acme.com' }],
          },
        },
        facts: [
          {
            subject: 'm1',
            predicate: 'mentioned_topic',
            value: 'pricing',
            contextIds: ['m_deal'],
          },
        ],
      };

      const result = await resolver.resolveAndIngest(output, 'signal_ctx', scope, {
        preResolved: { m_deal: dealSeed.entity.id },
      });

      expect(result.unresolved).toEqual([]);
      expect(result.facts[0]!.contextIds).toEqual([dealSeed.entity.id]);
    });
  });

  describe('unknownPredicatePolicy (H5)', () => {
    it('fuzzy-maps a near-miss to the closest registered predicate', async () => {
      const { PredicateRegistry } = await import('@/memory/predicates/PredicateRegistry.js');
      const mem2 = new MemorySystem({
        store: new InMemoryAdapter(),
        predicates: PredicateRegistry.standard(),
        // default policy is 'fuzzy_map'
      });
      const resolver2 = new ExtractionResolver(mem2);
      const out: ExtractionOutput = {
        mentions: {
          m1: {
            surface: 'John',
            type: 'person',
            identifiers: [{ kind: 'email', value: 'j@x.com' }],
          },
          m2: {
            surface: 'Acme',
            type: 'organization',
            identifiers: [{ kind: 'domain', value: 'acme.com' }],
          },
        },
        facts: [
          // `work_at` is a 1-char typo of the registered `works_at`.
          { subject: 'm1', predicate: 'work_at', object: 'm2' },
        ],
      };
      const result = await resolver2.resolveAndIngest(out, 'sig', scope);
      expect(result.facts).toHaveLength(1);
      expect(result.facts[0]!.predicate).toBe('works_at');
      // Mapping surfaces in newPredicates for audit.
      expect(result.newPredicates).toContain('work_at→works_at');
      await mem2.shutdown();
    });

    it('drop policy skips the fact entirely', async () => {
      const { PredicateRegistry } = await import('@/memory/predicates/PredicateRegistry.js');
      const mem2 = new MemorySystem({
        store: new InMemoryAdapter(),
        predicates: PredicateRegistry.standard(),
        unknownPredicatePolicy: 'drop',
      });
      const resolver2 = new ExtractionResolver(mem2);
      const out: ExtractionOutput = {
        mentions: {
          m1: { surface: 'X', type: 'topic' },
        },
        facts: [
          { subject: 'm1', predicate: 'wildly_invented_predicate', value: 'v' },
        ],
      };
      const result = await resolver2.resolveAndIngest(out, 'sig', scope);
      expect(result.facts).toHaveLength(0);
      expect(result.unresolved[0]!.reason).toMatch(/unknownPredicatePolicy='drop'/);
      expect(result.newPredicates).toContain('wildly_invented_predicate');
      await mem2.shutdown();
    });

    it('keep policy writes the unknown predicate verbatim', async () => {
      const { PredicateRegistry } = await import('@/memory/predicates/PredicateRegistry.js');
      const mem2 = new MemorySystem({
        store: new InMemoryAdapter(),
        predicates: PredicateRegistry.standard(),
        unknownPredicatePolicy: 'keep',
      });
      const resolver2 = new ExtractionResolver(mem2);
      const out: ExtractionOutput = {
        mentions: {
          m1: { surface: 'X', type: 'topic' },
        },
        facts: [
          { subject: 'm1', predicate: 'something_brand_new', value: 'v' },
        ],
      };
      const result = await resolver2.resolveAndIngest(out, 'sig', scope);
      expect(result.facts).toHaveLength(1);
      expect(result.facts[0]!.predicate).toBe('something_brand_new');
      expect(result.newPredicates).toContain('something_brand_new');
      await mem2.shutdown();
    });
  });
});
