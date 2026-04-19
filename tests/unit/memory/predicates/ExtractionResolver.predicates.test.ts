/**
 * ExtractionResolver — predicate canonicalization + newPredicates tracking.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemorySystem } from '@/memory/MemorySystem.js';
import { InMemoryAdapter } from '@/memory/adapters/inmemory/InMemoryAdapter.js';
import { ExtractionResolver } from '@/memory/integration/ExtractionResolver.js';
import type { ExtractionOutput } from '@/memory/integration/ExtractionResolver.js';
import { PredicateRegistry } from '@/memory/predicates/index.js';
import { defaultExtractionPrompt } from '@/memory/integration/defaultExtractionPrompt.js';

function registry(): PredicateRegistry {
  const r = PredicateRegistry.empty();
  r.registerAll([
    {
      name: 'works_at',
      description: 'Employment.',
      category: 'identity',
      aliases: ['worksAt', 'employed_by'],
    },
    {
      name: 'leads',
      description: 'Leads a project.',
      category: 'task',
    },
  ]);
  return r;
}

describe('ExtractionResolver — canonicalization', () => {
  it('canonicalizes predicates in LLM output before writing', async () => {
    const mem = new MemorySystem({
      store: new InMemoryAdapter(),
      predicates: registry(),
    });
    const resolver = new ExtractionResolver(mem);

    const output: ExtractionOutput = {
      mentions: {
        m1: {
          surface: 'John',
          type: 'person',
          identifiers: [{ kind: 'email', value: 'j@a.com' }],
        },
        m2: {
          surface: 'Acme',
          type: 'organization',
          identifiers: [{ kind: 'domain', value: 'acme.com' }],
        },
      },
      facts: [
        // camelCase
        { subject: 'm1', predicate: 'worksAt', object: 'm2' },
        // alias
        { subject: 'm1', predicate: 'employed_by', object: 'm2' },
      ],
    };
    const result = await resolver.resolveAndIngest(output, 'sig_1', {});
    expect(result.facts).toHaveLength(2);
    expect(result.facts.every((f) => f.predicate === 'works_at')).toBe(true);
    expect(result.newPredicates).toEqual([]);
    await mem.shutdown();
  });

  it('tracks unknown predicates in newPredicates (permissive mode)', async () => {
    const mem = new MemorySystem({
      store: new InMemoryAdapter(),
      predicates: registry(),
    });
    const resolver = new ExtractionResolver(mem);

    const output: ExtractionOutput = {
      mentions: {
        m1: {
          surface: 'John',
          type: 'person',
          identifiers: [{ kind: 'email', value: 'j@a.com' }],
        },
      },
      facts: [
        { subject: 'm1', predicate: 'unknown_thing_one', value: 'x' },
        { subject: 'm1', predicate: 'unknownThingTwo', value: 'y' },
        // Duplicate (different surface form, same canonical) — must dedupe.
        { subject: 'm1', predicate: 'unknown-thing-one', value: 'z' },
      ],
    };
    const result = await resolver.resolveAndIngest(output, 'sig_2', {});
    expect(result.facts).toHaveLength(3); // permissive — all written
    expect(result.newPredicates).toEqual(['unknown_thing_one', 'unknown_thing_two']);
    await mem.shutdown();
  });

  it('strict-mode rejections land in unresolved AND newPredicates', async () => {
    const mem = new MemorySystem({
      store: new InMemoryAdapter(),
      predicates: registry(),
      predicateMode: 'strict',
    });
    const resolver = new ExtractionResolver(mem);

    const output: ExtractionOutput = {
      mentions: {
        m1: {
          surface: 'John',
          type: 'person',
          identifiers: [{ kind: 'email', value: 'j@a.com' }],
        },
      },
      facts: [
        { subject: 'm1', predicate: 'works_at', value: 'Acme' }, // accepted
        { subject: 'm1', predicate: 'mystery', value: 'y' }, // rejected
      ],
    };
    const result = await resolver.resolveAndIngest(output, 'sig_3', {});
    expect(result.facts).toHaveLength(1);
    expect(result.facts[0]!.predicate).toBe('works_at');
    expect(result.unresolved).toHaveLength(1);
    expect(result.unresolved[0]!.reason).toMatch(/not in registry/);
    expect(result.newPredicates).toEqual(['mystery']);
    await mem.shutdown();
  });

  it('newPredicates is empty when no registry is configured', async () => {
    const mem = new MemorySystem({ store: new InMemoryAdapter() });
    const resolver = new ExtractionResolver(mem);

    const output: ExtractionOutput = {
      mentions: {
        m1: {
          surface: 'John',
          type: 'person',
          identifiers: [{ kind: 'email', value: 'j@a.com' }],
        },
      },
      facts: [{ subject: 'm1', predicate: 'anything', value: 'x' }],
    };
    const result = await resolver.resolveAndIngest(output, 'sig_4', {});
    expect(result.facts).toHaveLength(1);
    expect(result.newPredicates).toEqual([]);
    await mem.shutdown();
  });
});

describe('defaultExtractionPrompt — registry rendering', () => {
  it('omits the predicate vocabulary section when no registry', () => {
    const prompt = defaultExtractionPrompt({ signalText: 'Hello' });
    expect(prompt).not.toContain('## Predicate vocabulary');
  });

  it('includes the predicate vocabulary section when registry is provided', () => {
    const prompt = defaultExtractionPrompt({
      signalText: 'Hello',
      predicateRegistry: registry(),
    });
    expect(prompt).toContain('## Predicate vocabulary');
    expect(prompt).toContain('`works_at`');
  });

  it('respects maxPredicatesPerCategory', () => {
    const bigRegistry = PredicateRegistry.empty();
    for (let i = 0; i < 10; i++) {
      bigRegistry.register({
        name: `p_${i}`,
        description: `pred ${i}`,
        category: 'same',
      });
    }
    const prompt = defaultExtractionPrompt({
      signalText: 'X',
      predicateRegistry: bigRegistry,
      maxPredicatesPerCategory: 3,
    });
    const predicateLines = prompt.split('\n').filter((l) => l.startsWith('- `p_'));
    expect(predicateLines.length).toBe(3);
  });
});
