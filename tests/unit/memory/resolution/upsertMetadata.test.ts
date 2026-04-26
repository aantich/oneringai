/**
 * upsertEntityBySurface with metadata — conservative-merge contract.
 *
 * Covers:
 *   - create: metadata set verbatim
 *   - resolve + fillMissing (default): existing keys untouched, missing keys set
 *   - resolve + overwrite: shallow-merge, incoming wins
 *   - ExtractionMention.metadata flows through
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemorySystem } from '@/memory/MemorySystem.js';
import { InMemoryAdapter } from '@/memory/adapters/inmemory/InMemoryAdapter.js';
import { ExtractionResolver } from '@/memory/integration/ExtractionResolver.js';
import type { ScopeFilter } from '@/memory/types.js';

const scope: ScopeFilter = { userId: 'test-user' };

describe('upsertEntityBySurface — metadata', () => {
  let store: InMemoryAdapter;
  let mem: MemorySystem;

  beforeEach(() => {
    store = new InMemoryAdapter();
    mem = new MemorySystem({ store });
  });

  afterEach(async () => {
    if (!mem.isDestroyed) await mem.shutdown();
  });

  it('create: metadata is set verbatim on the new entity', async () => {
    const res = await mem.upsertEntityBySurface(
      {
        surface: 'Send budget by Friday',
        type: 'task',
        identifiers: [{ kind: 'canonical', value: 'task:alice:budget' }],
        metadata: { state: 'proposed', dueAt: '2026-04-30', assigneeId: 'alice' },
      },
      scope,
    );
    expect(res.resolved).toBe(false);
    const md = res.entity.metadata as Record<string, unknown>;
    expect(md.state).toBe('proposed');
    expect(md.dueAt).toBeInstanceOf(Date);
    expect((md.dueAt as Date).toISOString()).toBe('2026-04-30T00:00:00.000Z');
    expect(md.assigneeId).toBe('alice');
  });

  it('resolve + fillMissing (default): existing keys untouched, missing keys set', async () => {
    const first = await mem.upsertEntityBySurface(
      {
        surface: 'Send budget',
        type: 'task',
        identifiers: [{ kind: 'canonical', value: 'task:alice:budget' }],
        metadata: { state: 'in_progress', dueAt: '2026-04-30' },
      },
      scope,
    );

    // Second upsert hits the canonical identifier → resolve path.
    const res = await mem.upsertEntityBySurface(
      {
        surface: 'Send the budget',
        type: 'task',
        identifiers: [{ kind: 'canonical', value: 'task:alice:budget' }],
        metadata: {
          state: 'done',          // SHOULD NOT overwrite — existing 'in_progress' wins
          priority: 'high',       // SHOULD be added — key was missing
        },
      },
      scope,
    );
    expect(res.resolved).toBe(true);
    expect(res.entity.id).toBe(first.entity.id);
    const md = res.entity.metadata as Record<string, unknown>;
    expect(md.state).toBe('in_progress');
    expect(md.dueAt).toBeInstanceOf(Date);
    expect((md.dueAt as Date).toISOString()).toBe('2026-04-30T00:00:00.000Z');
    expect(md.priority).toBe('high');
  });

  it('resolve + overwrite: shallow-merge with incoming winning', async () => {
    const first = await mem.upsertEntityBySurface(
      {
        surface: 'Send budget',
        type: 'task',
        identifiers: [{ kind: 'canonical', value: 'task:alice:budget' }],
        metadata: { state: 'in_progress', dueAt: '2026-04-30' },
      },
      scope,
    );

    const res = await mem.upsertEntityBySurface(
      {
        surface: 'Send budget',
        type: 'task',
        identifiers: [{ kind: 'canonical', value: 'task:alice:budget' }],
        metadata: { state: 'done', priority: 'high' },
      },
      scope,
      { metadataMerge: 'overwrite' },
    );
    expect(res.entity.id).toBe(first.entity.id);
    const md = res.entity.metadata as Record<string, unknown>;
    expect(md.state).toBe('done');
    expect(md.dueAt).toBeInstanceOf(Date);
    expect((md.dueAt as Date).toISOString()).toBe('2026-04-30T00:00:00.000Z');
    expect(md.priority).toBe('high');
  });

  it('resolve without metadata: existing metadata untouched, no version bump just for metadata', async () => {
    const first = await mem.upsertEntityBySurface(
      {
        surface: 'Task A',
        type: 'task',
        identifiers: [{ kind: 'canonical', value: 'task:a' }],
        metadata: { state: 'in_progress' },
      },
      scope,
    );
    const versionAfterCreate = first.entity.version;

    const res = await mem.upsertEntityBySurface(
      {
        surface: 'Task A',
        type: 'task',
        identifiers: [{ kind: 'canonical', value: 'task:a' }],
      },
      scope,
    );
    expect(res.entity.metadata).toEqual({ state: 'in_progress' });
    expect(res.entity.version).toBe(versionAfterCreate);
  });

  it('ExtractionMention.metadata flows through ExtractionResolver', async () => {
    const resolver = new ExtractionResolver(mem);
    const out = await resolver.resolveAndIngest(
      {
        mentions: {
          t1: {
            surface: 'Review Q3 plan',
            type: 'task',
            identifiers: [{ kind: 'canonical', value: 'task:review-q3-plan' }],
            metadata: { state: 'proposed', dueAt: '2026-05-01' },
          },
        },
        facts: [],
      },
      'signal-1',
      scope,
    );
    expect(out.entities).toHaveLength(1);
    const md = out.entities[0]!.entity.metadata as Record<string, unknown>;
    expect(md.state).toBe('proposed');
    expect(md.dueAt).toBeInstanceOf(Date);
    expect((md.dueAt as Date).toISOString()).toBe('2026-05-01T00:00:00.000Z');
  });

  it('overwrite mode: structurally-equal nested-object metadata does NOT bump version', async () => {
    // Pre-coercion impl used `merged[k] !== v` (reference equality), which would
    // falsely flag every nested object/array as dirty on resolve, bumping the
    // version every call. The fix uses `metadataDeepEqual` — structurally equal
    // values are a no-op.
    const first = await mem.upsertEntityBySurface(
      {
        surface: 'Nested deep equal',
        type: 'project',
        identifiers: [{ kind: 'canonical', value: 'proj:nested-equal' }],
        metadata: {
          owners: ['alice', 'bob'],
          jarvis: { importance: 0.8, tags: ['core', 'q3'] },
        },
      },
      scope,
    );
    const vBefore = first.entity.version;
    const res = await mem.upsertEntityBySurface(
      {
        surface: 'Nested deep equal',
        type: 'project',
        identifiers: [{ kind: 'canonical', value: 'proj:nested-equal' }],
        // Same shape, fresh references — would have been dirty under `!==`.
        metadata: {
          owners: ['alice', 'bob'],
          jarvis: { importance: 0.8, tags: ['core', 'q3'] },
        },
      },
      scope,
      { metadataMerge: 'overwrite' },
    );
    expect(res.entity.version).toBe(vBefore);
  });

  it('overwrite mode: structurally-equal Date metadata does NOT bump version', async () => {
    const first = await mem.upsertEntityBySurface(
      {
        surface: 'Date equal',
        type: 'event',
        identifiers: [{ kind: 'canonical', value: 'evt:date-equal' }],
        metadata: { startTime: new Date('2026-05-01T10:00:00Z') },
      },
      scope,
    );
    const vBefore = first.entity.version;
    const res = await mem.upsertEntityBySurface(
      {
        surface: 'Date equal',
        type: 'event',
        identifiers: [{ kind: 'canonical', value: 'evt:date-equal' }],
        // Different Date instance, same instant. Reference-equality would bump.
        metadata: { startTime: new Date('2026-05-01T10:00:00Z') },
      },
      scope,
      { metadataMerge: 'overwrite' },
    );
    expect(res.entity.version).toBe(vBefore);
  });

  it('overwrite mode: structurally-different nested metadata DOES bump version', async () => {
    // Counterpoint to the deep-equal test: a real change must still flip dirty.
    const first = await mem.upsertEntityBySurface(
      {
        surface: 'Nested changes',
        type: 'project',
        identifiers: [{ kind: 'canonical', value: 'proj:nested-changes' }],
        metadata: { jarvis: { importance: 0.5 } },
      },
      scope,
    );
    const vBefore = first.entity.version;
    const res = await mem.upsertEntityBySurface(
      {
        surface: 'Nested changes',
        type: 'project',
        identifiers: [{ kind: 'canonical', value: 'proj:nested-changes' }],
        metadata: { jarvis: { importance: 0.9 } },
      },
      scope,
      { metadataMerge: 'overwrite' },
    );
    expect(res.entity.version).toBe(vBefore + 1);
    expect(
      ((res.entity.metadata as Record<string, unknown>).jarvis as Record<string, unknown>)
        .importance,
    ).toBe(0.9);
  });

  it('fillMissing drops undefined values without flipping dirty', async () => {
    const first = await mem.upsertEntityBySurface(
      {
        surface: 'Task B',
        type: 'task',
        identifiers: [{ kind: 'canonical', value: 'task:b' }],
        metadata: { state: 'pending' },
      },
      scope,
    );
    const vBefore = first.entity.version;
    const res = await mem.upsertEntityBySurface(
      {
        surface: 'Task B',
        type: 'task',
        identifiers: [{ kind: 'canonical', value: 'task:b' }],
        metadata: { state: undefined, priority: undefined },
      },
      scope,
    );
    expect(res.entity.version).toBe(vBefore);
    expect(res.entity.metadata).toEqual({ state: 'pending' });
  });
});
