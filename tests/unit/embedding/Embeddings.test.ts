/**
 * Unit tests for Embeddings capability class
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Connector } from '../../../src/core/Connector.js';
import { Vendor } from '../../../src/core/Vendor.js';
import { Embeddings } from '../../../src/capabilities/embeddings/Embeddings.js';
import type { EmbeddingsCreateOptions } from '../../../src/capabilities/embeddings/Embeddings.js';
import type { IEmbeddingProvider, EmbeddingOptions, EmbeddingResponse } from '../../../src/domain/interfaces/IEmbeddingProvider.js';

// Mock the createEmbeddingProvider to avoid real HTTP calls
vi.mock('../../../src/core/createEmbeddingProvider.js', () => ({
  createEmbeddingProvider: vi.fn(),
}));

import { createEmbeddingProvider } from '../../../src/core/createEmbeddingProvider.js';
const mockCreateProvider = vi.mocked(createEmbeddingProvider);

function createMockProvider(overrides?: Partial<IEmbeddingProvider>): IEmbeddingProvider {
  return {
    name: 'mock-embedding',
    capabilities: { text: false, images: false, videos: false, audio: false, embeddings: true },
    validateConfig: vi.fn().mockResolvedValue(true),
    embed: vi.fn().mockResolvedValue({
      embeddings: [[0.1, 0.2, 0.3]],
      model: 'mock-model',
      usage: { promptTokens: 5, totalTokens: 5 },
    } satisfies EmbeddingResponse),
    listModels: vi.fn().mockResolvedValue(['model-a', 'model-b']),
    ...overrides,
  };
}

describe('Embeddings', () => {
  let mockProvider: IEmbeddingProvider;

  beforeEach(() => {
    Connector.clear();
    mockProvider = createMockProvider();
    mockCreateProvider.mockReturnValue(mockProvider);
  });

  afterEach(() => {
    Connector.clear();
    vi.clearAllMocks();
  });

  describe('create', () => {
    it('should create instance with connector name', () => {
      Connector.create({
        name: 'test-openai',
        vendor: Vendor.OpenAI,
        auth: { type: 'api_key', apiKey: 'test-key' },
      });

      const emb = Embeddings.create({ connector: 'test-openai' });
      expect(emb).toBeDefined();
      expect(emb.getConnector().name).toBe('test-openai');
    });

    it('should create instance with connector instance', () => {
      const connector = Connector.create({
        name: 'test-openai2',
        vendor: Vendor.OpenAI,
        auth: { type: 'api_key', apiKey: 'test-key' },
      });

      const emb = Embeddings.create({ connector });
      expect(emb).toBeDefined();
      expect(emb.getConnector()).toBe(connector);
    });

    it('should throw for unknown connector name', () => {
      expect(() => Embeddings.create({ connector: 'nonexistent' })).toThrow();
    });

    it('should use default model for OpenAI', () => {
      Connector.create({
        name: 'openai-emb',
        vendor: Vendor.OpenAI,
        auth: { type: 'api_key', apiKey: 'test' },
      });

      const emb = Embeddings.create({ connector: 'openai-emb' });
      // Embed with no model override — should use default
      emb.embed('test');
      expect(mockProvider.embed).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'text-embedding-3-small' })
      );
    });

    it('should use default model for Ollama', () => {
      Connector.create({
        name: 'ollama-emb',
        vendor: Vendor.Ollama,
        auth: { type: 'none' as const },
      });

      const emb = Embeddings.create({ connector: 'ollama-emb' });
      emb.embed('test');
      expect(mockProvider.embed).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'qwen3-embedding' })
      );
    });

    it('should use custom model when specified', () => {
      Connector.create({
        name: 'openai-custom',
        vendor: Vendor.OpenAI,
        auth: { type: 'api_key', apiKey: 'test' },
      });

      const emb = Embeddings.create({ connector: 'openai-custom', model: 'text-embedding-3-large' });
      emb.embed('test');
      expect(mockProvider.embed).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'text-embedding-3-large' })
      );
    });

    it('should use default dimensions when specified', () => {
      Connector.create({
        name: 'openai-dims',
        vendor: Vendor.OpenAI,
        auth: { type: 'api_key', apiKey: 'test' },
      });

      const emb = Embeddings.create({ connector: 'openai-dims', dimensions: 512 });
      emb.embed('test');
      expect(mockProvider.embed).toHaveBeenCalledWith(
        expect.objectContaining({ dimensions: 512 })
      );
    });
  });

  describe('embed', () => {
    let emb: Embeddings;

    beforeEach(() => {
      Connector.create({
        name: 'emb-test',
        vendor: Vendor.OpenAI,
        auth: { type: 'api_key', apiKey: 'test' },
      });
      emb = Embeddings.create({ connector: 'emb-test' });
    });

    it('should embed a single string', async () => {
      const result = await emb.embed('hello world');
      expect(result.embeddings).toHaveLength(1);
      expect(result.embeddings[0]).toEqual([0.1, 0.2, 0.3]);
      expect(result.model).toBe('mock-model');
      expect(result.usage.promptTokens).toBe(5);
    });

    it('should embed an array of strings', async () => {
      const batchResponse: EmbeddingResponse = {
        embeddings: [[0.1, 0.2], [0.3, 0.4]],
        model: 'mock-model',
        usage: { promptTokens: 10, totalTokens: 10 },
      };
      (mockProvider.embed as ReturnType<typeof vi.fn>).mockResolvedValueOnce(batchResponse);

      const result = await emb.embed(['hello', 'world']);
      expect(result.embeddings).toHaveLength(2);
    });

    it('should pass input to provider correctly', async () => {
      await emb.embed('test input');
      expect(mockProvider.embed).toHaveBeenCalledWith({
        model: 'text-embedding-3-small',
        input: 'test input',
        dimensions: undefined,
      });
    });

    it('should pass array input to provider correctly', async () => {
      await emb.embed(['a', 'b', 'c']);
      expect(mockProvider.embed).toHaveBeenCalledWith({
        model: 'text-embedding-3-small',
        input: ['a', 'b', 'c'],
        dimensions: undefined,
      });
    });

    it('should override model per-call', async () => {
      await emb.embed('test', { model: 'text-embedding-3-large' });
      expect(mockProvider.embed).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'text-embedding-3-large' })
      );
    });

    it('should override dimensions per-call', async () => {
      await emb.embed('test', { dimensions: 256 });
      expect(mockProvider.embed).toHaveBeenCalledWith(
        expect.objectContaining({ dimensions: 256 })
      );
    });

    it('should propagate provider errors', async () => {
      (mockProvider.embed as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('API error')
      );

      await expect(emb.embed('test')).rejects.toThrow('API error');
    });
  });

  describe('listModels', () => {
    it('should delegate to provider listModels', async () => {
      Connector.create({
        name: 'list-test',
        vendor: Vendor.OpenAI,
        auth: { type: 'api_key', apiKey: 'test' },
      });

      const emb = Embeddings.create({ connector: 'list-test' });
      const models = await emb.listModels();
      expect(models).toEqual(['model-a', 'model-b']);
    });

    it('should fallback to registry when provider has no listModels', async () => {
      const noListProvider = createMockProvider({ listModels: undefined });
      mockCreateProvider.mockReturnValue(noListProvider);

      Connector.create({
        name: 'no-list-test',
        vendor: Vendor.OpenAI,
        auth: { type: 'api_key', apiKey: 'test' },
      });

      const emb = Embeddings.create({ connector: 'no-list-test' });
      const models = await emb.listModels();
      expect(models).toContain('text-embedding-3-small');
      expect(models).toContain('text-embedding-3-large');
      expect(models).toContain('text-embedding-ada-002');
    });
  });

  describe('getModelInfo', () => {
    it('should return model info from registry', () => {
      Connector.create({
        name: 'info-test',
        vendor: Vendor.OpenAI,
        auth: { type: 'api_key', apiKey: 'test' },
      });

      const emb = Embeddings.create({ connector: 'info-test' });
      const info = emb.getModelInfo('text-embedding-3-small');
      expect(info).toBeDefined();
      expect(info?.capabilities.maxDimensions).toBe(1536);
    });

    it('should return undefined for unknown model', () => {
      Connector.create({
        name: 'info-test2',
        vendor: Vendor.OpenAI,
        auth: { type: 'api_key', apiKey: 'test' },
      });

      const emb = Embeddings.create({ connector: 'info-test2' });
      expect(emb.getModelInfo('unknown')).toBeUndefined();
    });
  });

  describe('getProvider', () => {
    it('should return the underlying provider', () => {
      Connector.create({
        name: 'prov-test',
        vendor: Vendor.OpenAI,
        auth: { type: 'api_key', apiKey: 'test' },
      });

      const emb = Embeddings.create({ connector: 'prov-test' });
      expect(emb.getProvider()).toBe(mockProvider);
    });
  });
});
