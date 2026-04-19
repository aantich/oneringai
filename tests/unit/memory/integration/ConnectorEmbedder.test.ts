/**
 * Unit tests for ConnectorEmbedder.
 *
 * Uses a mock IEmbeddingProvider via ConnectorEmbedder.withProvider to test
 * the adapter logic without needing a real Connector/API plumbing for every
 * case. One integration-style test against a real Connector verifies the
 * lookup path.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ConnectorEmbedder } from '@/memory/integration/ConnectorEmbedder.js';
import { Connector } from '@/core/Connector.js';
import { Vendor } from '@/core/Vendor.js';
import type { IEmbeddingProvider, EmbeddingOptions } from '@/domain/interfaces/IEmbeddingProvider.js';

function makeMockProvider(
  options: { dimensions?: number; failOn?: (opts: EmbeddingOptions) => boolean } = {},
): IEmbeddingProvider & { embed: ReturnType<typeof vi.fn> } {
  const dim = options.dimensions ?? 3;
  return {
    name: 'mock-embed',
    capabilities: { embeddings: true } as never,
    embed: vi.fn(async (opts: EmbeddingOptions) => {
      if (options.failOn?.(opts)) throw new Error('mock provider failure');
      const inputs = Array.isArray(opts.input) ? opts.input : [opts.input];
      return {
        embeddings: inputs.map((text) => {
          const v = new Array(dim).fill(0);
          for (let i = 0; i < text.length; i++) {
            v[i % dim] = (v[i % dim] ?? 0) + (text.charCodeAt(i) % 7) / 10;
          }
          return v;
        }),
        model: opts.model,
        usage: { promptTokens: 0, totalTokens: 0 },
      };
    }),
  } as IEmbeddingProvider & { embed: ReturnType<typeof vi.fn> };
}

describe('ConnectorEmbedder', () => {
  describe('withProvider', () => {
    it('sets dimensions from config', () => {
      const provider = makeMockProvider();
      const emb = ConnectorEmbedder.withProvider({ provider, model: 'm1', dimensions: 3 });
      expect(emb.dimensions).toBe(3);
    });

    it('embed() forwards model + single string input', async () => {
      const provider = makeMockProvider();
      const emb = ConnectorEmbedder.withProvider({ provider, model: 'm1', dimensions: 3 });
      const vec = await emb.embed('hello');
      expect(vec).toHaveLength(3);
      expect(provider.embed).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'm1', input: 'hello' }),
      );
    });

    it('embedBatch() forwards arrays', async () => {
      const provider = makeMockProvider();
      const emb = ConnectorEmbedder.withProvider({ provider, model: 'm1', dimensions: 3 });
      const vecs = await emb.embedBatch!(['a', 'b', 'c']);
      expect(vecs).toHaveLength(3);
      expect(provider.embed).toHaveBeenCalledWith(
        expect.objectContaining({ input: ['a', 'b', 'c'] }),
      );
    });

    it('embedBatch([]) returns empty without calling provider', async () => {
      const provider = makeMockProvider();
      const emb = ConnectorEmbedder.withProvider({ provider, model: 'm1', dimensions: 3 });
      const vecs = await emb.embedBatch!([]);
      expect(vecs).toEqual([]);
      expect(provider.embed).not.toHaveBeenCalled();
    });

    it('forwards requestedDimensions to provider', async () => {
      const provider = makeMockProvider({ dimensions: 512 });
      const emb = ConnectorEmbedder.withProvider({
        provider,
        model: 'm1',
        dimensions: 512,
        requestedDimensions: 512,
      });
      await emb.embed('x');
      expect(provider.embed).toHaveBeenCalledWith(
        expect.objectContaining({ dimensions: 512 }),
      );
    });

    it('throws when provider returns no embedding for a single input', async () => {
      const broken: IEmbeddingProvider = {
        name: 'broken',
        capabilities: { embeddings: true } as never,
        embed: async (opts: EmbeddingOptions) => ({
          embeddings: [],
          model: opts.model,
          usage: { promptTokens: 0, totalTokens: 0 },
        }),
      };
      const emb = ConnectorEmbedder.withProvider({ provider: broken, model: 'm1', dimensions: 3 });
      await expect(emb.embed('x')).rejects.toThrow(/no embedding/);
    });

    it('throws when batch cardinality mismatches', async () => {
      const mismatching: IEmbeddingProvider = {
        name: 'mism',
        capabilities: { embeddings: true } as never,
        embed: async (opts: EmbeddingOptions) => ({
          embeddings: [[0, 0, 0]], // always returns one
          model: opts.model,
          usage: { promptTokens: 0, totalTokens: 0 },
        }),
      };
      const emb = ConnectorEmbedder.withProvider({
        provider: mismatching,
        model: 'm1',
        dimensions: 3,
      });
      await expect(emb.embedBatch!(['a', 'b'])).rejects.toThrow(/1 embeddings for 2 inputs/);
    });

    it('propagates provider errors', async () => {
      const provider = makeMockProvider({ failOn: () => true });
      const emb = ConnectorEmbedder.withProvider({ provider, model: 'm1', dimensions: 3 });
      await expect(emb.embed('x')).rejects.toThrow(/mock provider failure/);
    });

    it('rejects vectors whose length mismatches declared dimensions', async () => {
      const wrong: IEmbeddingProvider = {
        name: 'wrong',
        capabilities: { embeddings: true } as never,
        embed: async (opts: EmbeddingOptions) => ({
          embeddings: [[0.1, 0.2]], // 2-dim, caller declared 3
          model: opts.model,
          usage: { promptTokens: 0, totalTokens: 0 },
        }),
      };
      const emb = ConnectorEmbedder.withProvider({ provider: wrong, model: 'm1', dimensions: 3 });
      await expect(emb.embed('x')).rejects.toThrow(/dimension mismatch/);
    });

    it('rejects vectors containing NaN / Infinity', async () => {
      const bad: IEmbeddingProvider = {
        name: 'bad',
        capabilities: { embeddings: true } as never,
        embed: async (opts: EmbeddingOptions) => ({
          embeddings: [[0.1, Number.NaN, 0.3]],
          model: opts.model,
          usage: { promptTokens: 0, totalTokens: 0 },
        }),
      };
      const emb = ConnectorEmbedder.withProvider({ provider: bad, model: 'm1', dimensions: 3 });
      await expect(emb.embed('x')).rejects.toThrow(/non-finite/);
    });

    it('embedBatch also validates each vector shape', async () => {
      const mixed: IEmbeddingProvider = {
        name: 'mixed',
        capabilities: { embeddings: true } as never,
        embed: async (opts: EmbeddingOptions) => ({
          embeddings: [
            [0.1, 0.2, 0.3],
            [0.1, 0.2], // bad — wrong length
          ],
          model: opts.model,
          usage: { promptTokens: 0, totalTokens: 0 },
        }),
      };
      const emb = ConnectorEmbedder.withProvider({ provider: mixed, model: 'm1', dimensions: 3 });
      await expect(emb.embedBatch!(['a', 'b'])).rejects.toThrow(/dimension mismatch/);
    });
  });

  describe('constructor (real Connector registry path)', () => {
    beforeEach(() => Connector.clear());
    afterEach(() => Connector.clear());

    it('resolves a real connector and builds a real provider (OpenAI)', () => {
      Connector.create({
        name: 'test-openai-embedder',
        vendor: Vendor.OpenAI,
        auth: { type: 'api_key', apiKey: 'dummy-for-test' },
      });
      const emb = new ConnectorEmbedder({
        connector: 'test-openai-embedder',
        model: 'text-embedding-3-small',
        dimensions: 1536,
      });
      expect(emb.dimensions).toBe(1536);
      // We don't call embed() — that would hit the OpenAI API. Provider wiring verified.
    });

    it('throws when connector name unknown', () => {
      expect(
        () =>
          new ConnectorEmbedder({
            connector: 'not-registered',
            model: 'text-embedding-3-small',
            dimensions: 1536,
          }),
      ).toThrow();
    });
  });
});
