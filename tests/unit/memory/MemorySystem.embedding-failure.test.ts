/**
 * Observability: verify fact.embedding.failed event fires after retries are exhausted.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { MemorySystem } from '@/memory/MemorySystem.js';
import { InMemoryAdapter } from '@/memory/adapters/inmemory/InMemoryAdapter.js';
import type { ChangeEvent, IEmbedder } from '@/memory/types.js';

function brokenEmbedder(): IEmbedder & { embed: ReturnType<typeof vi.fn> } {
  const embed = vi.fn(async () => {
    throw new Error('embedder is down');
  });
  return { embed, dimensions: 3 };
}

describe('EmbeddingQueue — fact.embedding.failed observability', () => {
  let mem: MemorySystem | undefined;
  afterEach(async () => {
    if (mem && !mem.isDestroyed) await mem.shutdown();
  });

  it('emits fact.embedding.failed after retries exhausted (fact job)', async () => {
    const events: ChangeEvent[] = [];
    mem = new MemorySystem({
      store: new InMemoryAdapter(),
      embedder: brokenEmbedder(),
      embeddingQueue: { retries: 1, concurrency: 1 },
      entityResolution: { enableIdentityEmbedding: false }, // isolate fact jobs
      onChange: (e) => events.push(e),
    });

    const ent = await mem.upsertEntity(
      {
        type: 'person',
        displayName: 'Alice',
        identifiers: [{ kind: 'email', value: 'a@a.com' }],
      },
      {},
    );
    // isSemantic triggers via long details string.
    await mem.addFact(
      {
        subjectId: ent.entity.id,
        predicate: 'memo',
        kind: 'document',
        details: 'x'.repeat(100),
      },
      {},
    );
    await mem.flushEmbeddings();

    const failed = events.find((e) => e.type === 'fact.embedding.failed');
    expect(failed).toBeDefined();
    if (failed?.type === 'fact.embedding.failed') {
      expect(failed.factId).toBeTruthy();
      expect(failed.entityId).toBeNull();
      expect(failed.attempts).toBeGreaterThanOrEqual(1);
      expect(failed.reason).toMatch(/embedder is down/);
    }
  });

  it('emits fact.embedding.failed for identity embedding jobs', async () => {
    const events: ChangeEvent[] = [];
    mem = new MemorySystem({
      store: new InMemoryAdapter(),
      embedder: brokenEmbedder(),
      embeddingQueue: { retries: 1, concurrency: 1 },
      onChange: (e) => events.push(e),
    });
    await mem.upsertEntity(
      {
        type: 'person',
        displayName: 'Alice',
        identifiers: [{ kind: 'email', value: 'a@a.com' }],
      },
      {},
    );
    await mem.flushEmbeddings();

    const failed = events.find(
      (e) => e.type === 'fact.embedding.failed' && e.entityId !== null,
    );
    expect(failed).toBeDefined();
    if (failed?.type === 'fact.embedding.failed') {
      expect(failed.entityId).toBeTruthy();
      expect(failed.factId).toBeNull();
    }
  });
});
