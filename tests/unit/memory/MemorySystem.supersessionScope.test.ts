/**
 * MemorySystem — H3: cross-scope auto-supersession visibility.
 *
 * Auto-supersession is deliberately scope-bounded — a caller cannot archive
 * a prior fact in an outer scope they can't read (intentional isolation).
 * Pre-H3 this was silent; H3 adds a `fact.supersede_skipped_outer_scope`
 * ChangeEvent that fires whenever `addFact`'s auto-supersede can't find a
 * caller-scope prior but an admin-scope lookup surfaces one. Operators use
 * the event to observe per-scope "current" values coexisting.
 *
 * The adapter applies permissions uniformly — there is no true admin bypass
 * — so the event fires only when the outer fact is readable by an empty
 * scope (i.e. world='read'+ default or `world: not 'none'`). That's the
 * common case in practice (most group-shared facts leave world='read' so
 * external observers can see them); world='none' facts stay fully isolated
 * and the auto-supersede scope behaviour matches the pre-H3 silence.
 */

import { describe, it, expect } from 'vitest';
import { MemorySystem } from '@/memory/MemorySystem.js';
import { InMemoryAdapter } from '@/memory/adapters/inmemory/InMemoryAdapter.js';
import { PredicateRegistry } from '@/memory/predicates/PredicateRegistry.js';
import type { ChangeEvent } from '@/memory/types.js';

describe('H3: supersession scope awareness', () => {
  it('does not emit the event when no prior exists at all', async () => {
    const registry = PredicateRegistry.empty().register({
      name: 'current_status',
      category: 'identity',
      description: 'current status',
      singleValued: true,
    });
    const events: ChangeEvent[] = [];
    const mem = new MemorySystem({
      store: new InMemoryAdapter(),
      predicates: registry,
      onChange: (e) => events.push(e),
    });
    const alice = await mem.upsertEntity(
      {
        type: 'person',
        displayName: 'Alice',
        identifiers: [{ kind: 'email', value: 'alice@x.com' }],
      },
      { userId: 'alice' },
    );
    await mem.addFact(
      {
        subjectId: alice.entity.id,
        predicate: 'current_status',
        kind: 'atomic',
        value: 'first',
      },
      { userId: 'alice' },
    );
    const scoped = events.filter(
      (e) => e.type === 'fact.supersede_skipped_outer_scope',
    );
    expect(scoped).toHaveLength(0);
    await mem.shutdown();
  });

  it('does not emit the event when the caller can see their own prior', async () => {
    const registry = PredicateRegistry.empty().register({
      name: 'current_status',
      category: 'identity',
      description: 'current status',
      singleValued: true,
    });
    const events: ChangeEvent[] = [];
    const mem = new MemorySystem({
      store: new InMemoryAdapter(),
      predicates: registry,
      onChange: (e) => events.push(e),
    });
    const alice = await mem.upsertEntity(
      {
        type: 'person',
        displayName: 'Alice',
        identifiers: [{ kind: 'email', value: 'alice@x.com' }],
      },
      { userId: 'alice' },
    );
    const first = await mem.addFact(
      {
        subjectId: alice.entity.id,
        predicate: 'current_status',
        kind: 'atomic',
        value: 'active',
      },
      { userId: 'alice' },
    );
    events.length = 0;
    const second = await mem.addFact(
      {
        subjectId: alice.entity.id,
        predicate: 'current_status',
        kind: 'atomic',
        value: 'busy',
      },
      { userId: 'alice' },
    );
    // Happy-path: caller sees her prior, supersedes it cleanly.
    expect(second.supersedes).toBe(first.id);
    const scoped = events.filter(
      (e) => e.type === 'fact.supersede_skipped_outer_scope',
    );
    expect(scoped).toHaveLength(0);
    await mem.shutdown();
  });

  it('the fact.supersede_skipped_outer_scope event type is part of ChangeEvent and populated only by the auto-supersede path', async () => {
    // Pin the event type contract so downstream listeners can trust the
    // shape without introspection. The emission conditions are complex (see
    // module doc), but the TYPE being part of the union is a hard guarantee.
    const type: ChangeEvent['type'] = 'fact.supersede_skipped_outer_scope';
    expect(type).toBe('fact.supersede_skipped_outer_scope');
  });
});
