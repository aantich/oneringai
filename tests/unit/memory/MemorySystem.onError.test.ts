/**
 * Observability: listener exceptions routed to onError hook (or console fallback).
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { MemorySystem } from '@/memory/MemorySystem.js';
import { InMemoryAdapter } from '@/memory/adapters/inmemory/InMemoryAdapter.js';
import type { ChangeEvent } from '@/memory/types.js';

describe('MemorySystem.onError — listener exception routing', () => {
  let mem: MemorySystem | undefined;
  afterEach(async () => {
    if (mem && !mem.isDestroyed) await mem.shutdown();
  });

  it('routes onChange exceptions to onError', async () => {
    const captured: Array<{ error: unknown; event: ChangeEvent }> = [];
    mem = new MemorySystem({
      store: new InMemoryAdapter(),
      onChange: () => {
        throw new Error('listener broke');
      },
      onError: (error, event) => {
        captured.push({ error, event });
      },
    });
    await mem.upsertEntity(
      {
        type: 'person',
        displayName: 'Alice',
        identifiers: [{ kind: 'email', value: 'a@a.com' }],
      },
      {},
    );
    expect(captured).toHaveLength(1);
    expect((captured[0]!.error as Error).message).toBe('listener broke');
    expect(captured[0]!.event.type).toBe('entity.upsert');
  });

  it('write path is unaffected when onChange throws', async () => {
    mem = new MemorySystem({
      store: new InMemoryAdapter(),
      onChange: () => {
        throw new Error('boom');
      },
      onError: () => undefined,
    });
    const res = await mem.upsertEntity(
      {
        type: 'person',
        displayName: 'Alice',
        identifiers: [{ kind: 'email', value: 'a@a.com' }],
      },
      {},
    );
    expect(res.entity.id).toBeTruthy();
    expect(res.created).toBe(true);
  });

  it('falls back to console.warn when no onError configured', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      mem = new MemorySystem({
        store: new InMemoryAdapter(),
        onChange: () => {
          throw new Error('listener broke');
        },
      });
      await mem.upsertEntity(
        {
          type: 'person',
          displayName: 'X',
          identifiers: [{ kind: 'email', value: 'x@a.com' }],
        },
        {},
      );
      expect(warn).toHaveBeenCalled();
      expect(
        warn.mock.calls.some((call) =>
          String(call[0] ?? '').includes('onChange listener threw'),
        ),
      ).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });

  it('onError that itself throws is swallowed (no crash)', async () => {
    mem = new MemorySystem({
      store: new InMemoryAdapter(),
      onChange: () => {
        throw new Error('a');
      },
      onError: () => {
        throw new Error('b');
      },
    });
    await expect(
      mem.upsertEntity(
        {
          type: 'person',
          displayName: 'X',
          identifiers: [{ kind: 'email', value: 'x@a.com' }],
        },
        {},
      ),
    ).resolves.toBeTruthy();
  });
});
