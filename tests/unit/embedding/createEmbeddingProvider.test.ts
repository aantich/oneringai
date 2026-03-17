/**
 * Unit tests for createEmbeddingProvider factory
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Connector } from '../../../src/core/Connector.js';
import { Vendor } from '../../../src/core/Vendor.js';
import { createEmbeddingProvider } from '../../../src/core/createEmbeddingProvider.js';
import { OpenAIEmbeddingProvider } from '../../../src/infrastructure/providers/openai/OpenAIEmbeddingProvider.js';
import { GoogleEmbeddingProvider } from '../../../src/infrastructure/providers/google/GoogleEmbeddingProvider.js';

describe('createEmbeddingProvider', () => {
  beforeEach(() => {
    Connector.clear();
  });

  afterEach(() => {
    Connector.clear();
  });

  it('should create OpenAI provider for OpenAI vendor', () => {
    const connector = Connector.create({
      name: 'test-openai',
      vendor: Vendor.OpenAI,
      auth: { type: 'api_key', apiKey: 'test-key' },
    });

    const provider = createEmbeddingProvider(connector);
    expect(provider).toBeInstanceOf(OpenAIEmbeddingProvider);
    expect(provider.name).toBe('openai-embedding');
    expect(provider.capabilities.embeddings).toBe(true);
  });

  it('should create Google provider for Google vendor', () => {
    const connector = Connector.create({
      name: 'test-google',
      vendor: Vendor.Google,
      auth: { type: 'api_key', apiKey: 'test-key' },
    });

    const provider = createEmbeddingProvider(connector);
    expect(provider).toBeInstanceOf(GoogleEmbeddingProvider);
    expect(provider.name).toBe('google-embedding');
    expect(provider.capabilities.embeddings).toBe(true);
  });

  it('should create OpenAI-compat provider for Ollama with auth: none', () => {
    const connector = Connector.create({
      name: 'ollama-local',
      vendor: Vendor.Ollama,
      auth: { type: 'none' as const },
      baseURL: 'http://localhost:11434/v1',
    });

    const provider = createEmbeddingProvider(connector);
    expect(provider).toBeInstanceOf(OpenAIEmbeddingProvider);
    expect(provider.name).toBe('ollama-local'); // Uses connector name
    expect(provider.capabilities.embeddings).toBe(true);
  });

  it('should create OpenAI-compat provider for Mistral', () => {
    const connector = Connector.create({
      name: 'test-mistral',
      vendor: Vendor.Mistral,
      auth: { type: 'api_key', apiKey: 'test-key' },
    });

    const provider = createEmbeddingProvider(connector);
    expect(provider).toBeInstanceOf(OpenAIEmbeddingProvider);
    expect(provider.name).toBe('test-mistral');
  });

  it('should create OpenAI-compat provider for Together', () => {
    const connector = Connector.create({
      name: 'test-together',
      vendor: Vendor.Together,
      auth: { type: 'api_key', apiKey: 'test-key' },
    });

    const provider = createEmbeddingProvider(connector);
    expect(provider).toBeInstanceOf(OpenAIEmbeddingProvider);
    expect(provider.name).toBe('test-together');
  });

  it('should create OpenAI-compat provider for DeepSeek', () => {
    const connector = Connector.create({
      name: 'test-deepseek',
      vendor: Vendor.DeepSeek,
      auth: { type: 'api_key', apiKey: 'test-key' },
    });

    const provider = createEmbeddingProvider(connector);
    expect(provider).toBeInstanceOf(OpenAIEmbeddingProvider);
    expect(provider.name).toBe('test-deepseek');
  });

  it('should create OpenAI-compat provider for Groq', () => {
    const connector = Connector.create({
      name: 'test-groq',
      vendor: Vendor.Groq,
      auth: { type: 'api_key', apiKey: 'test-key' },
    });

    const provider = createEmbeddingProvider(connector);
    expect(provider).toBeInstanceOf(OpenAIEmbeddingProvider);
    expect(provider.name).toBe('test-groq');
  });

  it('should create OpenAI-compat provider for Custom vendor with baseURL', () => {
    const connector = Connector.create({
      name: 'my-custom',
      vendor: Vendor.Custom,
      auth: { type: 'api_key', apiKey: 'test-key' },
      baseURL: 'https://my-api.example.com/v1',
    });

    const provider = createEmbeddingProvider(connector);
    expect(provider).toBeInstanceOf(OpenAIEmbeddingProvider);
    expect(provider.name).toBe('my-custom');
  });

  it('should throw for Custom vendor without baseURL', () => {
    const connector = Connector.create({
      name: 'no-url-custom',
      vendor: Vendor.Custom,
      auth: { type: 'api_key', apiKey: 'test-key' },
    });

    expect(() => createEmbeddingProvider(connector)).toThrow('requires baseURL');
  });

  it('should throw for Anthropic vendor (no embedding support)', () => {
    const connector = Connector.create({
      name: 'test-anthropic',
      vendor: Vendor.Anthropic,
      auth: { type: 'api_key', apiKey: 'test-key' },
    });

    expect(() => createEmbeddingProvider(connector)).toThrow('No embedding provider');
  });

  it('should throw for connector without vendor', () => {
    const connector = Connector.create({
      name: 'no-vendor',
      auth: { type: 'api_key', apiKey: 'test-key' },
    });

    expect(() => createEmbeddingProvider(connector)).toThrow();
  });

  it('should throw for JWT auth on OpenAI-compat providers', () => {
    const connector = Connector.create({
      name: 'jwt-ollama',
      vendor: Vendor.Ollama,
      auth: {
        type: 'jwt',
        privateKey: 'test-key',
        tokenUrl: 'https://example.com/token',
        clientId: 'test-id',
      } as any,
    });

    expect(() => createEmbeddingProvider(connector)).toThrow('requires API key authentication');
  });
});
