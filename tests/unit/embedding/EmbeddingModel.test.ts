/**
 * Unit tests for Embedding Model Registry
 */

import { describe, it, expect } from 'vitest';
import {
  EMBEDDING_MODEL_REGISTRY,
  EMBEDDING_MODELS,
  getEmbeddingModelInfo,
  getEmbeddingModelsByVendor,
  getActiveEmbeddingModels,
  getEmbeddingModelsWithFeature,
  calculateEmbeddingCost,
} from '../../../src/domain/entities/EmbeddingModel.js';
import { Vendor } from '../../../src/core/Vendor.js';

describe('EmbeddingModel Registry', () => {
  describe('Registry structure', () => {
    it('should have all declared OpenAI models', () => {
      expect(EMBEDDING_MODEL_REGISTRY['text-embedding-3-small']).toBeDefined();
      expect(EMBEDDING_MODEL_REGISTRY['text-embedding-3-large']).toBeDefined();
      expect(EMBEDDING_MODEL_REGISTRY['text-embedding-ada-002']).toBeDefined();
    });

    it('should have all declared Google models', () => {
      expect(EMBEDDING_MODEL_REGISTRY['text-embedding-004']).toBeDefined();
    });

    it('should have all declared Mistral models', () => {
      expect(EMBEDDING_MODEL_REGISTRY['mistral-embed']).toBeDefined();
    });

    it('should have all declared Ollama models', () => {
      expect(EMBEDDING_MODEL_REGISTRY['qwen3-embedding']).toBeDefined();
      expect(EMBEDDING_MODEL_REGISTRY['qwen3-embedding:4b']).toBeDefined();
      expect(EMBEDDING_MODEL_REGISTRY['qwen3-embedding:0.6b']).toBeDefined();
      expect(EMBEDDING_MODEL_REGISTRY['nomic-embed-text']).toBeDefined();
      expect(EMBEDDING_MODEL_REGISTRY['mxbai-embed-large']).toBeDefined();
    });

    it('should have consistent structure for all models', () => {
      for (const [name, model] of Object.entries(EMBEDDING_MODEL_REGISTRY)) {
        expect(model, `${name} missing 'name'`).toHaveProperty('name');
        expect(model, `${name} missing 'displayName'`).toHaveProperty('displayName');
        expect(model, `${name} missing 'provider'`).toHaveProperty('provider');
        expect(model, `${name} missing 'isActive'`).toHaveProperty('isActive');
        expect(model, `${name} missing 'sources'`).toHaveProperty('sources');
        expect(model, `${name} missing 'capabilities'`).toHaveProperty('capabilities');
        expect(model.sources, `${name} missing 'lastVerified'`).toHaveProperty('lastVerified');
      }
    });

    it('should have valid capabilities for all models', () => {
      for (const [name, model] of Object.entries(EMBEDDING_MODEL_REGISTRY)) {
        const caps = model.capabilities;
        expect(caps.maxTokens, `${name}: maxTokens`).toBeGreaterThan(0);
        expect(caps.defaultDimensions, `${name}: defaultDimensions`).toBeGreaterThan(0);
        expect(caps.maxDimensions, `${name}: maxDimensions`).toBeGreaterThan(0);
        expect(caps.defaultDimensions, `${name}: default <= max`).toBeLessThanOrEqual(caps.maxDimensions);
        expect(caps.features, `${name}: features`).toHaveProperty('matryoshka');
        expect(caps.features, `${name}: features`).toHaveProperty('instructionAware');
        expect(caps.features, `${name}: features`).toHaveProperty('batchInput');
        expect(caps.features, `${name}: features`).toHaveProperty('multilingual');
        expect(caps.limits.maxBatchSize, `${name}: maxBatchSize`).toBeGreaterThan(0);
      }
    });

    it('should have name field matching registry key', () => {
      for (const [key, model] of Object.entries(EMBEDDING_MODEL_REGISTRY)) {
        expect(model.name).toBe(key);
      }
    });
  });

  describe('getEmbeddingModelInfo', () => {
    it('should return model info for valid model', () => {
      const model = getEmbeddingModelInfo('text-embedding-3-small');
      expect(model).toBeDefined();
      expect(model?.name).toBe('text-embedding-3-small');
      expect(model?.provider).toBe(Vendor.OpenAI);
    });

    it('should return undefined for unknown model', () => {
      expect(getEmbeddingModelInfo('unknown-model')).toBeUndefined();
    });

    it('should return correct dimensions for qwen3-embedding', () => {
      const model = getEmbeddingModelInfo('qwen3-embedding');
      expect(model?.capabilities.defaultDimensions).toBe(4096);
      expect(model?.capabilities.maxDimensions).toBe(4096);
    });

    it('should return correct dimensions for qwen3-embedding:0.6b', () => {
      const model = getEmbeddingModelInfo('qwen3-embedding:0.6b');
      expect(model?.capabilities.defaultDimensions).toBe(1024);
      expect(model?.capabilities.maxDimensions).toBe(1024);
    });
  });

  describe('getEmbeddingModelsByVendor', () => {
    it('should return OpenAI models', () => {
      const models = getEmbeddingModelsByVendor(Vendor.OpenAI);
      expect(models.length).toBeGreaterThan(0);
      expect(models.every((m) => m.provider === Vendor.OpenAI)).toBe(true);
      expect(models.every((m) => m.isActive)).toBe(true);
    });

    it('should return Google models', () => {
      const models = getEmbeddingModelsByVendor(Vendor.Google);
      expect(models.length).toBe(1);
      expect(models[0]?.name).toBe('text-embedding-004');
    });

    it('should return Ollama models', () => {
      const models = getEmbeddingModelsByVendor(Vendor.Ollama);
      expect(models.length).toBe(5);
      expect(models.every((m) => m.provider === Vendor.Ollama)).toBe(true);
    });

    it('should return Mistral models', () => {
      const models = getEmbeddingModelsByVendor(Vendor.Mistral);
      expect(models.length).toBe(1);
      expect(models[0]?.name).toBe('mistral-embed');
    });

    it('should return empty for unsupported vendor', () => {
      expect(getEmbeddingModelsByVendor(Vendor.Anthropic).length).toBe(0);
    });
  });

  describe('getActiveEmbeddingModels', () => {
    it('should return only active models', () => {
      const models = getActiveEmbeddingModels();
      expect(models.length).toBeGreaterThan(0);
      expect(models.every((m) => m.isActive)).toBe(true);
    });

    it('should not include deprecated ada-002', () => {
      const models = getActiveEmbeddingModels();
      expect(models.find((m) => m.name === 'text-embedding-ada-002')).toBeUndefined();
    });
  });

  describe('getEmbeddingModelsWithFeature', () => {
    it('should find models with matryoshka support', () => {
      const models = getEmbeddingModelsWithFeature('matryoshka');
      expect(models.length).toBeGreaterThan(0);
      expect(models.some((m) => m.name === 'text-embedding-3-small')).toBe(true);
      expect(models.some((m) => m.name === 'qwen3-embedding')).toBe(true);
      expect(models.some((m) => m.name === 'nomic-embed-text')).toBe(true);
      // mxbai-embed-large does NOT support matryoshka
      expect(models.some((m) => m.name === 'mxbai-embed-large')).toBe(false);
    });

    it('should find models with instruction awareness', () => {
      const models = getEmbeddingModelsWithFeature('instructionAware');
      expect(models.length).toBeGreaterThan(0);
      expect(models.some((m) => m.name === 'qwen3-embedding')).toBe(true);
      expect(models.some((m) => m.name === 'text-embedding-004')).toBe(true);
      // OpenAI text-embedding-3 is NOT instruction-aware
      expect(models.some((m) => m.name === 'text-embedding-3-small')).toBe(false);
    });

    it('should find multilingual models', () => {
      const models = getEmbeddingModelsWithFeature('multilingual');
      expect(models.length).toBeGreaterThan(0);
      expect(models.some((m) => m.name === 'text-embedding-3-small')).toBe(true);
      expect(models.some((m) => m.name === 'qwen3-embedding')).toBe(true);
      // nomic-embed-text is NOT multilingual
      expect(models.some((m) => m.name === 'nomic-embed-text')).toBe(false);
    });
  });

  describe('calculateEmbeddingCost', () => {
    it('should calculate cost for text-embedding-3-small', () => {
      const cost = calculateEmbeddingCost('text-embedding-3-small', 1_000_000);
      expect(cost).toBe(0.02);
    });

    it('should calculate cost for text-embedding-3-large', () => {
      const cost = calculateEmbeddingCost('text-embedding-3-large', 1_000_000);
      expect(cost).toBe(0.13);
    });

    it('should calculate cost for smaller token counts', () => {
      const cost = calculateEmbeddingCost('text-embedding-3-small', 1000);
      expect(cost).toBeCloseTo(0.00002, 6);
    });

    it('should calculate cost for mistral-embed', () => {
      const cost = calculateEmbeddingCost('mistral-embed', 1_000_000);
      expect(cost).toBe(0.10);
    });

    it('should return 0 for free models (Google)', () => {
      const cost = calculateEmbeddingCost('text-embedding-004', 1_000_000);
      expect(cost).toBe(0);
    });

    it('should return null for Ollama models (no pricing)', () => {
      expect(calculateEmbeddingCost('qwen3-embedding', 1000)).toBeNull();
    });

    it('should return null for unknown model', () => {
      expect(calculateEmbeddingCost('unknown', 1000)).toBeNull();
    });
  });

  describe('Model constants', () => {
    it('should have EMBEDDING_MODELS constants for OpenAI', () => {
      expect(EMBEDDING_MODELS[Vendor.OpenAI].TEXT_EMBEDDING_3_SMALL).toBe('text-embedding-3-small');
      expect(EMBEDDING_MODELS[Vendor.OpenAI].TEXT_EMBEDDING_3_LARGE).toBe('text-embedding-3-large');
      expect(EMBEDDING_MODELS[Vendor.OpenAI].TEXT_EMBEDDING_ADA_002).toBe('text-embedding-ada-002');
    });

    it('should have EMBEDDING_MODELS constants for Google', () => {
      expect(EMBEDDING_MODELS[Vendor.Google].TEXT_EMBEDDING_004).toBe('text-embedding-004');
    });

    it('should have EMBEDDING_MODELS constants for Ollama', () => {
      expect(EMBEDDING_MODELS[Vendor.Ollama].QWEN3_EMBEDDING).toBe('qwen3-embedding');
      expect(EMBEDDING_MODELS[Vendor.Ollama].QWEN3_EMBEDDING_4B).toBe('qwen3-embedding:4b');
      expect(EMBEDDING_MODELS[Vendor.Ollama].QWEN3_EMBEDDING_0_6B).toBe('qwen3-embedding:0.6b');
      expect(EMBEDDING_MODELS[Vendor.Ollama].NOMIC_EMBED_TEXT).toBe('nomic-embed-text');
      expect(EMBEDDING_MODELS[Vendor.Ollama].MXBAI_EMBED_LARGE).toBe('mxbai-embed-large');
    });

    it('should have EMBEDDING_MODELS constants for Mistral', () => {
      expect(EMBEDDING_MODELS[Vendor.Mistral].MISTRAL_EMBED).toBe('mistral-embed');
    });
  });

  describe('Model-specific features', () => {
    it('should mark OpenAI text-embedding-3 as MRL-capable', () => {
      const small = getEmbeddingModelInfo('text-embedding-3-small');
      const large = getEmbeddingModelInfo('text-embedding-3-large');
      expect(small?.capabilities.features.matryoshka).toBe(true);
      expect(large?.capabilities.features.matryoshka).toBe(true);
    });

    it('should mark ada-002 as NOT MRL-capable', () => {
      const model = getEmbeddingModelInfo('text-embedding-ada-002');
      expect(model?.capabilities.features.matryoshka).toBe(false);
    });

    it('should mark ada-002 as inactive', () => {
      const model = getEmbeddingModelInfo('text-embedding-ada-002');
      expect(model?.isActive).toBe(false);
    });

    it('should mark all Qwen3 models as instruction-aware and multilingual', () => {
      for (const name of ['qwen3-embedding', 'qwen3-embedding:4b', 'qwen3-embedding:0.6b']) {
        const model = getEmbeddingModelInfo(name);
        expect(model?.capabilities.features.instructionAware, name).toBe(true);
        expect(model?.capabilities.features.multilingual, name).toBe(true);
        expect(model?.capabilities.features.matryoshka, name).toBe(true);
      }
    });

    it('should have correct max tokens for all models', () => {
      expect(getEmbeddingModelInfo('text-embedding-3-small')?.capabilities.maxTokens).toBe(8191);
      expect(getEmbeddingModelInfo('text-embedding-004')?.capabilities.maxTokens).toBe(2048);
      expect(getEmbeddingModelInfo('qwen3-embedding')?.capabilities.maxTokens).toBe(8192);
      expect(getEmbeddingModelInfo('mxbai-embed-large')?.capabilities.maxTokens).toBe(512);
    });
  });
});
