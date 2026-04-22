/**
 * MemorySystem — visibilityPolicy.
 *
 * Covers:
 *   - Policy fills `permissions` on entity creates when caller omitted it.
 *   - Policy fills `permissions` on fact creates, with canonicalized predicate
 *     and factKind in context.
 *   - Caller-explicit `permissions` always win over policy.
 *   - Policy returning `undefined` falls through to library defaults
 *     (world='read' — public).
 *   - Policy is not invoked when no policy is configured (back-compat).
 *   - End-to-end: a policy that sets world='none' actually hides the record
 *     from out-of-group / non-owner callers on read.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MemorySystem } from '@/memory/MemorySystem.js';
import { InMemoryAdapter } from '@/memory/adapters/inmemory/InMemoryAdapter.js';
import type {
  Permissions,
  VisibilityContext,
  VisibilityPolicy,
  ScopeFilter,
} from '@/memory/types.js';

describe('MemorySystem — visibilityPolicy', () => {
  let mem: MemorySystem;
  const ownerScope: ScopeFilter = { userId: 'u1', groupId: 'g1' };

  afterEach(async () => {
    if (mem && !mem.isDestroyed) await mem.shutdown();
  });

  it('applies policy to entity creates when permissions absent', async () => {
    const seen: VisibilityContext[] = [];
    const policy: VisibilityPolicy = (ctx) => {
      seen.push(ctx);
      return { group: 'read', world: 'none' };
    };
    mem = new MemorySystem({ store: new InMemoryAdapter(), visibilityPolicy: policy });

    const res = await mem.upsertEntity(
      {
        type: 'person',
        displayName: 'A',
        identifiers: [{ kind: 'email', value: 'a@a.com' }],
      },
      ownerScope,
    );

    expect(res.entity.permissions).toEqual({ group: 'read', world: 'none' });
    // Policy saw the entity type.
    expect(seen.some((c) => c.kind === 'entity' && c.entityType === 'person')).toBe(true);
  });

  it('applies policy to fact creates with canonical predicate + factKind', async () => {
    const seen: VisibilityContext[] = [];
    const policy: VisibilityPolicy = (ctx) => {
      seen.push(ctx);
      // User-private facts by default.
      return { group: 'none', world: 'none' };
    };
    mem = new MemorySystem({ store: new InMemoryAdapter(), visibilityPolicy: policy });

    const entity = (
      await mem.upsertEntity(
        {
          type: 'person',
          displayName: 'A',
          identifiers: [{ kind: 'email', value: 'a@a.com' }],
          // Entity override — make sure fact policy runs independently.
          permissions: { group: 'read', world: 'read' },
        },
        ownerScope,
      )
    ).entity;

    const fact = await mem.addFact(
      {
        subjectId: entity.id,
        predicate: 'note',
        kind: 'atomic',
        value: 'hello',
      },
      ownerScope,
    );

    expect(fact.permissions).toEqual({ group: 'none', world: 'none' });
    const factCtx = seen.find((c) => c.kind === 'fact');
    expect(factCtx?.predicate).toBe('note');
    expect(factCtx?.factKind).toBe('atomic');
  });

  it('caller-explicit permissions win over policy', async () => {
    const policy: VisibilityPolicy = () => ({ group: 'none', world: 'none' });
    mem = new MemorySystem({ store: new InMemoryAdapter(), visibilityPolicy: policy });

    const explicit: Permissions = { group: 'write', world: 'read' };
    const res = await mem.upsertEntity(
      {
        type: 'person',
        displayName: 'A',
        identifiers: [{ kind: 'email', value: 'a@a.com' }],
        permissions: explicit,
      },
      ownerScope,
    );
    expect(res.entity.permissions).toEqual(explicit);
  });

  it('policy returning undefined falls through to library defaults', async () => {
    const policy: VisibilityPolicy = () => undefined;
    mem = new MemorySystem({ store: new InMemoryAdapter(), visibilityPolicy: policy });

    const res = await mem.upsertEntity(
      {
        type: 'person',
        displayName: 'A',
        identifiers: [{ kind: 'email', value: 'a@a.com' }],
      },
      ownerScope,
    );
    // Library defaults: permissions stays undefined on the record;
    // effectivePermissions reads group='read', world='read'.
    expect(res.entity.permissions).toBeUndefined();
  });

  it('no policy configured → legacy behavior unchanged', async () => {
    mem = new MemorySystem({ store: new InMemoryAdapter() });
    const res = await mem.upsertEntity(
      {
        type: 'person',
        displayName: 'A',
        identifiers: [{ kind: 'email', value: 'a@a.com' }],
      },
      ownerScope,
    );
    expect(res.entity.permissions).toBeUndefined();

    const fact = await mem.addFact(
      { subjectId: res.entity.id, predicate: 'note', kind: 'atomic', value: 'x' },
      ownerScope,
    );
    expect(fact.permissions).toBeUndefined();
  });

  it('policy-applied world=none hides records from out-of-group callers on read', async () => {
    const policy: VisibilityPolicy = () => ({ group: 'read', world: 'none' });
    mem = new MemorySystem({ store: new InMemoryAdapter(), visibilityPolicy: policy });

    // Owner in group g1 writes an entity + fact. Policy stamps
    // {group:'read', world:'none'}.
    const { entity } = await mem.upsertEntity(
      {
        type: 'person',
        displayName: 'InsiderContact',
        identifiers: [{ kind: 'email', value: 'insider@corp.com' }],
      },
      ownerScope,
    );
    await mem.addFact(
      { subjectId: entity.id, predicate: 'note', kind: 'atomic', value: 'private' },
      ownerScope,
    );

    // Out-of-group caller (different groupId, different userId) must not see it.
    const outsiderScope: ScopeFilter = { userId: 'u2', groupId: 'g2' };
    const list = await mem.listEntities(
      { type: 'person' },
      { limit: 50 },
      outsiderScope,
    );
    expect(list.items.some((e) => e.id === entity.id)).toBe(false);

    // Same-group caller (different user, same groupId) can still read via group level.
    const teammateScope: ScopeFilter = { userId: 'u3', groupId: 'g1' };
    const teamList = await mem.listEntities(
      { type: 'person' },
      { limit: 50 },
      teammateScope,
    );
    expect(teamList.items.some((e) => e.id === entity.id)).toBe(true);
  });

  it('policy can differentiate by entity type', async () => {
    const policy = vi.fn<Parameters<VisibilityPolicy>, ReturnType<VisibilityPolicy>>(
      (ctx) => {
        if (ctx.kind === 'entity' && ctx.entityType === 'task') {
          return { group: 'none', world: 'none' };
        }
        if (ctx.kind === 'entity') {
          return { group: 'read', world: 'none' };
        }
        return undefined;
      },
    );
    mem = new MemorySystem({ store: new InMemoryAdapter(), visibilityPolicy: policy });

    const person = await mem.upsertEntity(
      {
        type: 'person',
        displayName: 'P',
        identifiers: [{ kind: 'email', value: 'p@p.com' }],
      },
      ownerScope,
    );
    const task = await mem.upsertEntity(
      {
        type: 'task',
        displayName: 'T',
        identifiers: [{ kind: 'canonical', value: 'task:t1' }],
      },
      ownerScope,
    );

    expect(person.entity.permissions).toEqual({ group: 'read', world: 'none' });
    expect(task.entity.permissions).toEqual({ group: 'none', world: 'none' });
  });

  it('policy can differentiate by predicate + factKind', async () => {
    const policy: VisibilityPolicy = (ctx) => {
      if (ctx.kind !== 'fact') return undefined;
      // Document-kind facts (e.g. profile, memos) go group-wide; atomic stay private.
      if (ctx.factKind === 'document') return { group: 'read', world: 'none' };
      return { group: 'none', world: 'none' };
    };
    mem = new MemorySystem({ store: new InMemoryAdapter(), visibilityPolicy: policy });

    const subj = (
      await mem.upsertEntity(
        {
          type: 'person',
          displayName: 'X',
          identifiers: [{ kind: 'email', value: 'x@x.com' }],
        },
        ownerScope,
      )
    ).entity;

    const atomic = await mem.addFact(
      {
        subjectId: subj.id,
        predicate: 'note',
        kind: 'atomic',
        value: 'v',
      },
      ownerScope,
    );
    const doc = await mem.addFact(
      {
        subjectId: subj.id,
        predicate: 'biography',
        kind: 'document',
        details: 'long text',
      },
      ownerScope,
    );

    expect(atomic.permissions).toEqual({ group: 'none', world: 'none' });
    expect(doc.permissions).toEqual({ group: 'read', world: 'none' });
  });
});
