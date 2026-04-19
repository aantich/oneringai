/**
 * Identity embedding — skip enqueue when the identity string hasn't changed.
 *
 * Verifies that repeated upserts that don't change displayName/aliases/identifiers
 * don't trigger redundant embedder calls.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MemorySystem } from '@/memory/MemorySystem.js';
import { InMemoryAdapter } from '@/memory/adapters/inmemory/InMemoryAdapter.js';
import type { IEmbedder } from '@/memory/types.js';

function makeEmbedder(dim = 3): IEmbedder & { embed: ReturnType<typeof vi.fn> } {
  const embed = vi.fn(async (text: string) => {
    const v = new Array(dim).fill(0);
    for (let i = 0; i < text.length; i++) v[i % dim] += text.charCodeAt(i) / 100;
    return v;
  });
  return { embed, dimensions: dim };
}

describe('MemorySystem — identity embedding dedup', () => {
  let mem: MemorySystem;
  let embedder: ReturnType<typeof makeEmbedder>;

  beforeEach(() => {
    embedder = makeEmbedder();
    mem = new MemorySystem({ store: new InMemoryAdapter(), embedder });
  });
  afterEach(async () => {
    if (!mem.isDestroyed) await mem.shutdown();
  });

  it('embeds once for a new entity', async () => {
    await mem.upsertEntity(
      {
        type: 'person',
        displayName: 'Alice',
        identifiers: [{ kind: 'email', value: 'alice@example.com' }],
      },
      {},
    );
    await mem.flushEmbeddings();
    expect(embedder.embed).toHaveBeenCalledTimes(1);
  });

  it('does NOT re-embed when upsert produces no identity change', async () => {
    await mem.upsertEntity(
      {
        type: 'person',
        displayName: 'Alice',
        identifiers: [{ kind: 'email', value: 'alice@example.com' }],
      },
      {},
    );
    await mem.flushEmbeddings();
    expect(embedder.embed).toHaveBeenCalledTimes(1);

    // Repeated upsert — same identifier, same displayName. Should be no-op.
    await mem.upsertEntity(
      {
        type: 'person',
        displayName: 'Alice',
        identifiers: [{ kind: 'email', value: 'alice@example.com' }],
      },
      {},
    );
    await mem.flushEmbeddings();
    // Still exactly 1 — second upsert is a no-op (mergedIdentifiers=0, dirty=false).
    expect(embedder.embed).toHaveBeenCalledTimes(1);
  });

  it('re-embeds when displayName changes via alias addition', async () => {
    // First: create entity.
    await mem.upsertEntity(
      {
        type: 'person',
        displayName: 'Alice',
        identifiers: [{ kind: 'email', value: 'alice@example.com' }],
      },
      {},
    );
    await mem.flushEmbeddings();
    const firstCount = embedder.embed.mock.calls.length;

    // Add a new identifier. Identity changes → re-embed.
    await mem.upsertEntity(
      {
        type: 'person',
        displayName: 'Alice',
        identifiers: [
          { kind: 'email', value: 'alice@example.com' },
          { kind: 'slack_id', value: 'U123' },
        ],
      },
      {},
    );
    await mem.flushEmbeddings();
    expect(embedder.embed.mock.calls.length).toBeGreaterThan(firstCount);
  });
});
