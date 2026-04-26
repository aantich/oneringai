/**
 * upsertEntity — metadata merge contract.
 *
 * Covers the new `metadataMerge` + `metadataMergeKeys` options on the
 * identifier-based upsert path. Default behavior must remain unchanged
 * (metadata ignored on resolve, set verbatim on create).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemorySystem } from '@/memory/MemorySystem.js';
import { InMemoryAdapter } from '@/memory/adapters/inmemory/InMemoryAdapter.js';
import type { ScopeFilter } from '@/memory/types.js';

const scope: ScopeFilter = { userId: 'u1' };

describe('upsertEntity — metadata merge', () => {
  let mem: MemorySystem;

  beforeEach(() => {
    mem = new MemorySystem({ store: new InMemoryAdapter() });
  });

  afterEach(async () => {
    if (!mem.isDestroyed) await mem.shutdown();
  });

  async function seed(metadata: Record<string, unknown>) {
    return mem.upsertEntity(
      {
        type: 'event',
        displayName: 'Quarterly review',
        identifiers: [{ kind: 'cal_event', value: 'evt-1' }],
        metadata,
      },
      scope,
    );
  }

  it('create: metadata set verbatim regardless of merge option (ISO date strings coerced to Date)', async () => {
    const res = await mem.upsertEntity(
      {
        type: 'event',
        displayName: 'Quarterly review',
        identifiers: [{ kind: 'cal_event', value: 'evt-1' }],
        metadata: { startTime: '2026-05-01T10:00Z', status: 'confirmed' },
        metadataMerge: 'overwrite',
      },
      scope,
    );
    expect(res.created).toBe(true);
    const md = res.entity.metadata as Record<string, unknown>;
    expect(md.startTime).toBeInstanceOf(Date);
    expect((md.startTime as Date).toISOString()).toBe('2026-05-01T10:00:00.000Z');
    expect(md.status).toBe('confirmed');
  });

  it('default (no merge option) — metadata is ignored on resolve, version not bumped', async () => {
    const first = await seed({ startTime: '2026-05-01T10:00Z', status: 'confirmed' });
    const second = await mem.upsertEntity(
      {
        type: 'event',
        displayName: 'Quarterly review',
        identifiers: [{ kind: 'cal_event', value: 'evt-1' }],
        // New metadata supplied but no merge mode → backward-compat: ignored.
        metadata: { startTime: '2026-05-02T10:00Z', status: 'cancelled' },
      },
      scope,
    );
    expect(second.entity.id).toBe(first.entity.id);
    expect(second.entity.version).toBe(1);
    const md = second.entity.metadata as Record<string, unknown>;
    expect(md.startTime).toBeInstanceOf(Date);
    expect((md.startTime as Date).toISOString()).toBe('2026-05-01T10:00:00.000Z');
    expect(md.status).toBe('confirmed');
  });

  it('overwrite mode: incoming keys win, version bumps', async () => {
    const first = await seed({ startTime: '2026-05-01T10:00Z', status: 'confirmed' });
    const second = await mem.upsertEntity(
      {
        type: 'event',
        displayName: 'Quarterly review',
        identifiers: [{ kind: 'cal_event', value: 'evt-1' }],
        metadata: { startTime: '2026-05-02T10:00Z', status: 'cancelled' },
        metadataMerge: 'overwrite',
      },
      scope,
    );
    expect(second.entity.id).toBe(first.entity.id);
    expect(second.entity.version).toBe(2);
    const md = second.entity.metadata as Record<string, unknown>;
    expect(md.startTime).toBeInstanceOf(Date);
    expect((md.startTime as Date).toISOString()).toBe('2026-05-02T10:00:00.000Z');
    expect(md.status).toBe('cancelled');
  });

  it('overwrite mode + metadataMergeKeys whitelist: only listed keys touched', async () => {
    const first = await seed({
      startTime: '2026-05-01T10:00Z',
      status: 'confirmed',
      organizerId: 'p_alice',
      attendeeIds: ['p_bob'],
    });
    const second = await mem.upsertEntity(
      {
        type: 'event',
        displayName: 'Quarterly review',
        identifiers: [{ kind: 'cal_event', value: 'evt-1' }],
        metadata: {
          startTime: '2026-05-02T10:00Z',
          status: 'cancelled',
          organizerId: 'p_carol', // not whitelisted → must be ignored
          attendeeIds: ['p_dan'], // not whitelisted → must be ignored
          unrelated: 'x',          // not whitelisted → must be ignored
        },
        metadataMerge: 'overwrite',
        metadataMergeKeys: ['startTime', 'status'],
      },
      scope,
    );
    const md = second.entity.metadata as Record<string, unknown>;
    expect(md.startTime).toBeInstanceOf(Date);
    expect((md.startTime as Date).toISOString()).toBe('2026-05-02T10:00:00.000Z');
    expect(md.status).toBe('cancelled');
    expect(md.organizerId).toBe('p_alice');
    expect(md.attendeeIds).toEqual(['p_bob']);
    expect(second.entity.version).toBe(2);
  });

  it('fillMissing mode: only adds absent keys', async () => {
    await seed({ startTime: '2026-05-01T10:00Z', status: 'confirmed' });
    const second = await mem.upsertEntity(
      {
        type: 'event',
        displayName: 'Quarterly review',
        identifiers: [{ kind: 'cal_event', value: 'evt-1' }],
        metadata: {
          startTime: '2026-05-02T10:00Z', // present → kept
          location: 'Boardroom A',         // missing → added
        },
        metadataMerge: 'fillMissing',
      },
      scope,
    );
    const md = second.entity.metadata as Record<string, unknown>;
    expect(md.startTime).toBeInstanceOf(Date);
    expect((md.startTime as Date).toISOString()).toBe('2026-05-01T10:00:00.000Z');
    expect(md.status).toBe('confirmed');
    expect(md.location).toBe('Boardroom A');
  });

  it('no-op when incoming values equal stored — version not bumped', async () => {
    const first = await seed({ startTime: '2026-05-01T10:00Z', status: 'confirmed' });
    const second = await mem.upsertEntity(
      {
        type: 'event',
        displayName: 'Quarterly review',
        identifiers: [{ kind: 'cal_event', value: 'evt-1' }],
        metadata: { startTime: '2026-05-01T10:00Z', status: 'confirmed' },
        metadataMerge: 'overwrite',
      },
      scope,
    );
    expect(second.entity.version).toBe(first.entity.version); // 1
  });

  it('handles arrays / nested objects via deep equality (no spurious bumps)', async () => {
    const first = await seed({ attendeeIds: ['a', 'b'], extra: { x: 1, y: [2, 3] } });
    const second = await mem.upsertEntity(
      {
        type: 'event',
        displayName: 'Quarterly review',
        identifiers: [{ kind: 'cal_event', value: 'evt-1' }],
        metadata: { attendeeIds: ['a', 'b'], extra: { x: 1, y: [2, 3] } }, // structurally equal
        metadataMerge: 'overwrite',
      },
      scope,
    );
    expect(second.entity.version).toBe(first.entity.version);
  });

  it('mixed merge: identifiers added AND metadata changed — single version bump', async () => {
    const first = await seed({ startTime: '2026-05-01T10:00Z' });
    const second = await mem.upsertEntity(
      {
        type: 'event',
        displayName: 'Quarterly review',
        identifiers: [
          { kind: 'cal_event', value: 'evt-1' }, // existing
          { kind: 'ical_uid', value: 'uid-xyz' }, // new
        ],
        metadata: { startTime: '2026-05-03T10:00Z' },
        metadataMerge: 'overwrite',
      },
      scope,
    );
    expect(second.entity.version).toBe(first.entity.version + 1);
    expect(second.entity.identifiers.map((i) => i.kind).sort()).toEqual(['cal_event', 'ical_uid']);
    const startTime = (second.entity.metadata as Record<string, unknown>).startTime;
    expect(startTime).toBeInstanceOf(Date);
    expect((startTime as Date).toISOString()).toBe('2026-05-03T10:00:00.000Z');
  });

  it('undefined incoming values are skipped', async () => {
    await seed({ startTime: '2026-05-01T10:00Z' });
    const second = await mem.upsertEntity(
      {
        type: 'event',
        displayName: 'Quarterly review',
        identifiers: [{ kind: 'cal_event', value: 'evt-1' }],
        metadata: { startTime: undefined as unknown as string, status: 'cancelled' },
        metadataMerge: 'overwrite',
      },
      scope,
    );
    const md = second.entity.metadata as Record<string, unknown>;
    expect(md.startTime).toBeInstanceOf(Date);
    expect((md.startTime as Date).toISOString()).toBe('2026-05-01T10:00:00.000Z');
    expect(md.status).toBe('cancelled');
  });

  it('coerces ISO date strings on first write so $gte/$lt range queries work', async () => {
    await mem.upsertEntity(
      {
        type: 'event',
        displayName: 'Range query target',
        identifiers: [{ kind: 'cal_event', value: 'evt-range' }],
        metadata: { startTime: '2026-05-01T10:00Z' },
      },
      scope,
    );
    // listEntities with a metadataFilter using Date should hit the entity —
    // proves the stored value is Date-typed (string would fail the BSON range).
    const page = await mem.listEntities(
      {
        type: 'event',
        metadataFilter: {
          startTime: {
            $gte: new Date('2026-04-30T00:00:00Z'),
            $lt: new Date('2026-05-02T00:00:00Z'),
          },
        },
      },
      {},
      scope,
    );
    expect(page.items).toHaveLength(1);
  });
});
