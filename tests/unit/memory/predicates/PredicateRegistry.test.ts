/**
 * PredicateRegistry — canonicalization, validation, rendering, ranking merge.
 * Pure unit tests, no MemorySystem dependencies.
 */

import { describe, it, expect } from 'vitest';
import {
  PredicateRegistry,
  STANDARD_PREDICATES,
} from '@/memory/predicates/index.js';
import type { PredicateDefinition } from '@/memory/predicates/index.js';

const trivial: PredicateDefinition = {
  name: 'works_at',
  description: 'Person-to-organization employment.',
  category: 'identity',
  aliases: ['worksAt', 'employed_by'],
  rankingWeight: 1.5,
  defaultImportance: 1.0,
};

describe('PredicateRegistry — canonicalize', () => {
  it('snake_case input returns itself unchanged', () => {
    const r = new PredicateRegistry();
    expect(r.canonicalize('works_at')).toBe('works_at');
  });

  it('camelCase splits into snake_case', () => {
    const r = new PredicateRegistry();
    expect(r.canonicalize('worksAt')).toBe('works_at');
    expect(r.canonicalize('currentTitle')).toBe('current_title');
    expect(r.canonicalize('hasStatus')).toBe('has_status');
  });

  it('dashed input converts to snake_case', () => {
    const r = new PredicateRegistry();
    expect(r.canonicalize('works-at')).toBe('works_at');
    expect(r.canonicalize('has-due-date')).toBe('has_due_date');
  });

  it('whitespace converts to snake_case', () => {
    const r = new PredicateRegistry();
    expect(r.canonicalize('Works At')).toBe('works_at');
    expect(r.canonicalize('  has   status ')).toBe('has_status');
  });

  it('mixed case + mixed separators', () => {
    const r = new PredicateRegistry();
    expect(r.canonicalize('Works-At')).toBe('works_at');
    expect(r.canonicalize('Has Due-Date')).toBe('has_due_date');
  });

  it('aliases resolve to canonical name', () => {
    const r = new PredicateRegistry();
    r.register(trivial);
    expect(r.canonicalize('worksAt')).toBe('works_at'); // already normalizes
    expect(r.canonicalize('employed_by')).toBe('works_at'); // via alias
    expect(r.canonicalize('EMPLOYED_BY')).toBe('works_at'); // case-insensitive alias
  });

  it('unknown input passes through normalized (permissive)', () => {
    const r = new PredicateRegistry();
    expect(r.canonicalize('unknownPredicate')).toBe('unknown_predicate');
    expect(r.canonicalize('something-weird')).toBe('something_weird');
  });

  it('empty / single-character input handled safely', () => {
    const r = new PredicateRegistry();
    expect(r.canonicalize('')).toBe('');
    expect(r.canonicalize('x')).toBe('x');
  });

  it('collapses repeated separators', () => {
    const r = new PredicateRegistry();
    expect(r.canonicalize('foo___bar')).toBe('foo_bar');
    expect(r.canonicalize('__leading_trailing__')).toBe('leading_trailing');
  });

  it('canonicalize is idempotent', () => {
    const r = new PredicateRegistry();
    r.register(trivial);
    const once = r.canonicalize('worksAt');
    const twice = r.canonicalize(once);
    expect(twice).toBe(once);
    expect(twice).toBe('works_at');
  });
});

describe('PredicateRegistry — register / validation', () => {
  it('happy path', () => {
    const r = new PredicateRegistry();
    r.register(trivial);
    expect(r.has('works_at')).toBe(true);
    expect(r.get('works_at')?.name).toBe('works_at');
  });

  it('registerAll is chainable and registers all', () => {
    const r = new PredicateRegistry();
    r.registerAll([
      { name: 'a', description: 'A', category: 'x' },
      { name: 'b', description: 'B', category: 'x' },
    ]);
    expect(r.has('a')).toBe(true);
    expect(r.has('b')).toBe(true);
  });

  it('rejects duplicate name', () => {
    const r = new PredicateRegistry();
    r.register(trivial);
    expect(() => r.register(trivial)).toThrow(/duplicate predicate name/);
  });

  it('rejects aggregate + singleValued combination', () => {
    const r = new PredicateRegistry();
    expect(() =>
      r.register({
        name: 'bad',
        description: 'bad',
        category: 'x',
        isAggregate: true,
        singleValued: true,
      }),
    ).toThrow(/cannot be both isAggregate and singleValued/);
  });

  it('rejects alias that collides with another predicate name', () => {
    const r = new PredicateRegistry();
    r.register({ name: 'manages', description: '', category: 'x' });
    expect(() =>
      r.register({
        name: 'reports_to',
        description: '',
        category: 'x',
        aliases: ['manages'],
      }),
    ).toThrow(/collides with existing predicate name/);
  });

  it('rejects alias that collides with an already-registered alias', () => {
    const r = new PredicateRegistry();
    r.register({
      name: 'a',
      description: '',
      category: 'x',
      aliases: ['shared'],
    });
    expect(() =>
      r.register({
        name: 'b',
        description: '',
        category: 'x',
        aliases: ['shared'],
      }),
    ).toThrow(/already belongs to/);
  });

  it('rejects name that collides with an existing alias', () => {
    const r = new PredicateRegistry();
    r.register({
      name: 'a',
      description: '',
      category: 'x',
      aliases: ['b'],
    });
    expect(() =>
      r.register({ name: 'b', description: '', category: 'x' }),
    ).toThrow(/collides with existing alias/);
  });
});

describe('PredicateRegistry — unregister / get / has', () => {
  it('unregister removes name + aliases', () => {
    const r = new PredicateRegistry();
    r.register(trivial);
    r.unregister('works_at');
    expect(r.has('works_at')).toBe(false);
    expect(r.get('employed_by')).toBeNull();
  });

  it('unregister of unknown name is a no-op', () => {
    const r = new PredicateRegistry();
    expect(() => r.unregister('nope')).not.toThrow();
  });

  it('get/has are case-insensitive + resolve camelCase', () => {
    const r = new PredicateRegistry();
    r.register(trivial);
    expect(r.has('WORKS_AT')).toBe(true);
    expect(r.has('WorksAt')).toBe(true);
    expect(r.has('Employed-By')).toBe(true);
    expect(r.has('nope')).toBe(false);
  });
});

describe('PredicateRegistry — list / categories', () => {
  const r = PredicateRegistry.standard();

  it('list() returns all definitions when no filter', () => {
    expect(r.list().length).toBe(STANDARD_PREDICATES.length);
  });

  it('list({categories}) filters by category', () => {
    const taskOnly = r.list({ categories: ['task'] });
    // Floor — adding more task-category predicates is fine; this asserts the
    // existing-at-test-time set still appears.
    expect(taskOnly.length).toBeGreaterThanOrEqual(10);
    expect(taskOnly.every((d) => d.category === 'task')).toBe(true);
  });

  it('list({subjectType}) filters by subject type when declared', () => {
    const orgOnly = r.list({ subjectType: 'organization' });
    // Orgs appear in organizational only (where subjectTypes is set on some entries).
    expect(orgOnly.length).toBeGreaterThan(0);
    expect(
      orgOnly.every((d) => !d.subjectTypes || d.subjectTypes.includes('organization')),
    ).toBe(true);
  });

  it('subjectType filter keeps defs with no subjectTypes declared', () => {
    // part_of has no subjectTypes → should survive the filter
    const orgOnly = r.list({ subjectType: 'organization' });
    expect(orgOnly.some((d) => d.name === 'part_of')).toBe(true);
  });

  it('categories() returns sorted unique categories', () => {
    const cats = r.categories();
    expect(cats).toEqual([...cats].sort());
    expect(new Set(cats).size).toBe(cats.length);
    expect(cats).toContain('identity');
    expect(cats).toContain('task');
  });
});

describe('PredicateRegistry — renderForPrompt', () => {
  it('returns empty string for empty registry', () => {
    expect(new PredicateRegistry().renderForPrompt()).toBe('');
  });

  it('respects maxPerCategory', () => {
    const r = PredicateRegistry.standard();
    const categoryCount = r.categories().length;
    const rendered = r.renderForPrompt({ maxPerCategory: 2 });
    const predicateLines = rendered.split('\n').filter((l) => l.startsWith('- `'));
    expect(predicateLines.length).toBeLessThanOrEqual(categoryCount * 2);
  });

  it('honors categories filter (exclusive)', () => {
    const r = PredicateRegistry.standard();
    const rendered = r.renderForPrompt({ categories: ['identity', 'task'] });
    expect(rendered).toContain('### identity');
    expect(rendered).toContain('### task');
    expect(rendered).not.toContain('### communication');
  });

  it('includes inverse + aliases metadata', () => {
    const r = new PredicateRegistry();
    r.register({
      name: 'works_at',
      description: 'Employment.',
      category: 'identity',
      inverse: 'employs',
      aliases: ['worksAt'],
    });
    const rendered = r.renderForPrompt();
    expect(rendered).toContain('`works_at`');
    expect(rendered).toContain('`employs`');
    expect(rendered).toContain('`worksAt`');
  });

  it('includes examples when provided', () => {
    const r = new PredicateRegistry();
    r.register({
      name: 'x',
      description: 'desc',
      category: 'c',
      examples: ['(A, x, B)'],
    });
    const rendered = r.renderForPrompt();
    expect(rendered).toContain('(A, x, B)');
  });

  it('starts with the "## Predicate vocabulary" header', () => {
    const r = PredicateRegistry.standard();
    const rendered = r.renderForPrompt();
    expect(rendered.startsWith('## Predicate vocabulary')).toBe(true);
  });
});

describe('PredicateRegistry — toRankingWeights', () => {
  it('derives weights from rankingWeight fields', () => {
    const r = new PredicateRegistry();
    r.register({ name: 'a', description: '', category: 'x', rankingWeight: 1.5 });
    r.register({ name: 'b', description: '', category: 'x', rankingWeight: 0.5 });
    r.register({ name: 'c', description: '', category: 'x' }); // no weight → absent
    const w = r.toRankingWeights();
    expect(w).toEqual({ a: 1.5, b: 0.5 });
  });

  it('base object wins on collision', () => {
    const r = new PredicateRegistry();
    r.register({ name: 'a', description: '', category: 'x', rankingWeight: 1.5 });
    r.register({ name: 'b', description: '', category: 'x', rankingWeight: 0.5 });
    const w = r.toRankingWeights({ a: 99, c: 42 });
    expect(w.a).toBe(99); // caller override
    expect(w.b).toBe(0.5); // registry retained
    expect(w.c).toBe(42); // caller-only key preserved
  });

  it('returns a new object (does not mutate base)', () => {
    const r = new PredicateRegistry();
    r.register({ name: 'a', description: '', category: 'x', rankingWeight: 1 });
    const base = { x: 2 };
    const w = r.toRankingWeights(base);
    expect(base).toEqual({ x: 2 }); // unchanged
    expect(w).not.toBe(base);
  });
});

describe('PredicateRegistry — standard() factory', () => {
  it('produces exactly the expected number of predicates', () => {
    const r = PredicateRegistry.standard();
    expect(r.list().length).toBe(STANDARD_PREDICATES.length);
  });

  it('covers all standard categories', () => {
    const r = PredicateRegistry.standard();
    const cats = r.categories();
    expect(cats).toContain('identity');
    expect(cats).toContain('organizational');
    expect(cats).toContain('task');
    expect(cats).toContain('state');
    expect(cats).toContain('communication');
    expect(cats).toContain('observation');
    expect(cats).toContain('temporal');
    expect(cats).toContain('event');
    expect(cats).toContain('priority');
    expect(cats).toContain('document');
    expect(cats).toContain('social');
    expect(cats).toHaveLength(11);
  });

  it('contains the canonical `profile` predicate (consumed by getContext)', () => {
    const r = PredicateRegistry.standard();
    expect(r.has('profile')).toBe(true);
    expect(r.get('profile')?.category).toBe('document');
  });

  it('no alias collisions — standard set registers cleanly', () => {
    expect(() => PredicateRegistry.standard()).not.toThrow();
  });

  it('returns a fresh instance each call (no shared state)', () => {
    const a = PredicateRegistry.standard();
    const b = PredicateRegistry.standard();
    expect(a).not.toBe(b);
    a.register({ name: 'a_only', description: '', category: 'x' });
    expect(a.has('a_only')).toBe(true);
    expect(b.has('a_only')).toBe(false);
  });

  it('empty() returns an empty registry', () => {
    const r = PredicateRegistry.empty();
    expect(r.list()).toEqual([]);
    expect(r.categories()).toEqual([]);
  });

  it('all standard aliases resolve correctly', () => {
    const r = PredicateRegistry.standard();
    expect(r.canonicalize('worksAt')).toBe('works_at');
    expect(r.canonicalize('employed_by')).toBe('works_at');
    expect(r.canonicalize('committed')).toBe('committed_to');
    expect(r.canonicalize('current_position')).toBe('current_role');
  });

  it('no predicate has both isAggregate and singleValued', () => {
    for (const def of STANDARD_PREDICATES) {
      expect(def.isAggregate && def.singleValued).toBeFalsy();
    }
  });
});

describe('PredicateRegistry — findClosest (F3 length-aware)', () => {
  it('snaps a 1-char typo on a long predicate (works_at / work_at)', () => {
    const r = PredicateRegistry.empty().register({
      name: 'works_at',
      category: 'organizational',
      description: '',
    });
    const hit = r.findClosest('work_at');
    expect(hit).not.toBeNull();
    expect(hit!.name).toBe('works_at');
    expect(hit!.distance).toBe(1);
  });

  it('does NOT snap semantically-distinct predicates when caller tightens maxDistance=1', () => {
    // `talks_at` vs `works_at` is distance 2. Default length-aware budget
    // admits it on 8-char predicates; callers worried about semantic
    // corruption should set unknownPredicateFuzzyMaxDistance=1.
    const r = PredicateRegistry.empty().register({
      name: 'works_at',
      category: 'organizational',
      description: '',
    });
    const strict = r.findClosest('talks_at', { maxDistance: 1 });
    expect(strict).toBeNull();
  });

  it('length-aware budget allows distance 3 on 12+ char predicates', () => {
    const r = PredicateRegistry.empty().register({
      name: 'participated_in',
      category: 'event',
      description: '',
    });
    // 15 chars → budget floor(15/4) = 3. `particpated_in` is missing one
    // letter, distance 1 — should match easily.
    const easy = r.findClosest('particpated_in');
    expect(easy?.name).toBe('participated_in');
  });

  it('short predicate (<4 chars) still allows distance 1 (minor typo)', () => {
    const r = PredicateRegistry.empty().register({
      name: 'likes',
      category: 'attribute',
      description: '',
    });
    const hit = r.findClosest('liks'); // 1-char drop
    expect(hit?.name).toBe('likes');
    expect(hit?.distance).toBe(1);
  });

  it('returns null for predicates far beyond the budget', () => {
    const r = PredicateRegistry.empty().register({
      name: 'works_at',
      category: 'organizational',
      description: '',
    });
    expect(r.findClosest('completely_unrelated_predicate_xyz')).toBeNull();
  });

  it('honors explicit maxDistance override (tighten to 1)', () => {
    const r = PredicateRegistry.empty().register({
      name: 'works_at',
      category: 'organizational',
      description: '',
    });
    // 2-distance candidate no longer matches under tighter cap.
    expect(r.findClosest('work_atz', { maxDistance: 1 })).toBeNull();
  });
});

describe('MemorySystem — unknownPredicateFuzzyMaxDistance config (F3)', () => {
  it('passes the configured cap through resolveUnknownPredicate', async () => {
    const { MemorySystem } = await import('@/memory/MemorySystem.js');
    const { InMemoryAdapter } = await import('@/memory/adapters/inmemory/InMemoryAdapter.js');
    const registry = PredicateRegistry.empty().register({
      name: 'works_at',
      category: 'organizational',
      description: '',
    });
    // `work_atz` vs `works_at`: substitute s→nothing + insert z at end
    // → distance 2. Default length-aware budget admits it (min(2, 2) = 2).
    const loose = new MemorySystem({
      store: new InMemoryAdapter(),
      predicates: registry,
      unknownPredicatePolicy: 'fuzzy_map',
    });
    const loose_hit = loose.resolveUnknownPredicate('work_atz');
    expect(loose_hit.mappedTo).toBe('works_at');
    expect(loose_hit.distance).toBe(2);
    await loose.shutdown();

    // Same input with caller-tightened cap of 1 → no match.
    const strict = new MemorySystem({
      store: new InMemoryAdapter(),
      predicates: registry,
      unknownPredicatePolicy: 'fuzzy_map',
      unknownPredicateFuzzyMaxDistance: 1,
    });
    const strict_hit = strict.resolveUnknownPredicate('work_atz');
    expect(strict_hit.mappedTo).toBeUndefined();
    await strict.shutdown();
  });
});
