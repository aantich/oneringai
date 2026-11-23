/**
 * GenericOpenAIProvider Unit Tests
 * Tests the generic OpenAI-compatible provider that works with various APIs
 *
 * CRITICAL: Tests the name property type fix (string vs literal)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Create mock functions with vi.hoisted for proper hoisting
const { mockCreate, mockOpenAI } = vi.hoisted(() => {
  const mockCreate = vi.fn();
  const mockOpenAI = vi.fn(() => ({
    chat: {
      completions: {
        create: mockCreate,
      },
    },
    responses: {
      create: mockCreate,
    },
  }));
  return { mockCreate, mockOpenAI };
});

// Mock OpenAI SDK
vi.mock('openai', () => ({
  default: mockOpenAI,
}));

// Import after mocking
import { Vendor } from '@/core/Vendor.js';
import { calculateCost, getModelInfo, LLM_MODELS } from '@/domain/entities/Model.js';
import { GenericOpenAIProvider } from '@/infrastructure/providers/generic/GenericOpenAIProvider.js';

describe('GenericOpenAIProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should allow custom name to be set', () => {
      const provider = new GenericOpenAIProvider('groq', {
        apiKey: 'test-key',
        baseURL: 'https://api.groq.com/openai/v1',
      });

      expect(provider.name).toBe('groq');
    });

    it('should accept any string value for name (CRITICAL FIX)', () => {
      // This tests that name is typed as string, not literal 'openai'
      const names = ['together', 'perplexity', 'grok', 'my-custom-api', 'local-llm'];

      for (const name of names) {
        const provider = new GenericOpenAIProvider(name, {
          apiKey: 'test-key',
          baseURL: 'https://example.com/v1',
        });

        expect(provider.name).toBe(name);
      }
    });

    it('should accept custom baseURL', () => {
      new GenericOpenAIProvider('custom', {
        apiKey: 'test-key',
        baseURL: 'https://my-custom-api.com/v1',
      });

      expect(mockOpenAI).toHaveBeenCalledWith(
        expect.objectContaining({
          baseURL: 'https://my-custom-api.com/v1',
        })
      );
    });

    it('should set default capabilities', () => {
      const provider = new GenericOpenAIProvider('test', {
        apiKey: 'test-key',
        baseURL: 'https://example.com',
      });

      expect(provider.capabilities).toEqual({
        text: true,
        images: false, // Conservative default
        videos: false,
        audio: false,
      });
    });

    it('should accept custom capabilities', () => {
      const provider = new GenericOpenAIProvider(
        'test',
        {
          apiKey: 'test-key',
          baseURL: 'https://example.com',
        },
        {
          text: true,
          images: true,
          videos: false,
          audio: true,
        }
      );

      expect(provider.capabilities).toEqual({
        text: true,
        images: true,
        videos: false,
        audio: true,
      });
    });

    it('should merge partial custom capabilities with defaults', () => {
      const provider = new GenericOpenAIProvider(
        'test',
        {
          apiKey: 'test-key',
          baseURL: 'https://example.com',
        },
        {
          images: true, // Only override images
        }
      );

      expect(provider.capabilities.text).toBe(true);
      expect(provider.capabilities.images).toBe(true);
      expect(provider.capabilities.videos).toBe(false);
      expect(provider.capabilities.audio).toBe(false);
    });

    it('should pass API key to OpenAI client', () => {
      new GenericOpenAIProvider('test', {
        apiKey: 'my-secret-key',
        baseURL: 'https://example.com',
      });

      expect(mockOpenAI).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKey: 'my-secret-key',
        })
      );
    });
  });

  describe('getModelCapabilities()', () => {
    let provider: GenericOpenAIProvider;

    beforeEach(() => {
      provider = new GenericOpenAIProvider('test', {
        apiKey: 'test-key',
        baseURL: 'https://example.com',
      });
    });

    it('should return registry capabilities for registered models', () => {
      // Grok models are in the registry and routed through generic provider
      const caps = provider.getModelCapabilities('grok-4-1-fast-reasoning');
      expect(caps.supportsTools).toBe(true);
      expect(caps.maxTokens).toBe(2000000);
    });

    it.each([
      LLM_MODELS[Vendor.Ollama].INKLING_2_MINI,
      'inkling-2-mini:latest',
      'inkling-2-mini:26b-a5b',
      'inkling-2-mini:26b-a5b-nvfp4',
    ])('resolves local Inkling capabilities for %s', (model) => {
      expect(getModelInfo(model)).toMatchObject({
        name: 'inkling-2-mini',
        provider: Vendor.Ollama,
        endpoints: ['responses', 'chat_completions'],
        features: { output: { tokens: null } },
      });
      expect(provider.getModelCapabilities(model)).toMatchObject({
        supportsTools: true,
        supportsVision: true,
        maxInputTokens: 1_048_576,
      });
      expect(calculateCost(model, 1000, 1000)).toBe(0);
    });

    it('should return vendor defaults for unregistered models', () => {
      const caps = provider.getModelCapabilities('llama-3-8b');
      expect(caps.maxTokens).toBe(32000);
      expect(caps.supportsVision).toBe(false);
    });

    it('should assume tools support for most OpenAI-compatible APIs', () => {
      const caps = provider.getModelCapabilities('any-model');
      expect(caps.supportsTools).toBe(true);
    });

    it('should assume JSON support for most models', () => {
      const caps = provider.getModelCapabilities('any-model');
      expect(caps.supportsJSON).toBe(true);
    });

    it('should not assume JSON schema support', () => {
      const caps = provider.getModelCapabilities('any-model');
      expect(caps.supportsJSONSchema).toBe(false);
    });
  });

  describe('inherits from OpenAITextProvider', () => {
    it('should have generate method', () => {
      const provider = new GenericOpenAIProvider('test', {
        apiKey: 'test-key',
        baseURL: 'https://example.com',
      });

      expect(typeof provider.generate).toBe('function');
    });

    it('should have streamGenerate method', () => {
      const provider = new GenericOpenAIProvider('test', {
        apiKey: 'test-key',
        baseURL: 'https://example.com',
      });

      expect(typeof provider.streamGenerate).toBe('function');
    });

    it('should call OpenAI SDK for generate', async () => {
      const provider = new GenericOpenAIProvider('test', {
        apiKey: 'test-key',
        baseURL: 'https://example.com',
      });

      // Mock Responses API format (not Chat Completions format)
      mockCreate.mockResolvedValue({
        id: 'test-123',
        created_at: Date.now(),
        model: 'test-model',
        status: 'completed',
        output: [
          {
            type: 'message',
            role: 'assistant',
            content: [
              {
                type: 'output_text',
                text: 'Hello!',
              },
            ],
          },
        ],
        output_text: 'Hello!',
        usage: { input_tokens: 5, output_tokens: 2, total_tokens: 7 },
      });

      const response = await provider.generate({
        model: 'test-model',
        input: 'Hi',
      });

      expect(mockCreate).toHaveBeenCalled();
      expect(response.output_text).toBe('Hello!');
    });
  });

  describe('use cases', () => {
    it('should work for Groq API', () => {
      const provider = new GenericOpenAIProvider('groq', {
        apiKey: 'groq-key',
        baseURL: 'https://api.groq.com/openai/v1',
      });

      expect(provider.name).toBe('groq');
    });

    it('should work for Together AI', () => {
      const provider = new GenericOpenAIProvider('together', {
        apiKey: 'together-key',
        baseURL: 'https://api.together.xyz/v1',
      });

      expect(provider.name).toBe('together');
    });

    it('should work for local Ollama', () => {
      const provider = new GenericOpenAIProvider('ollama', {
        apiKey: 'ollama', // Ollama doesn't need a key but SDK requires one
        baseURL: 'http://localhost:11434/v1',
      });

      expect(provider.name).toBe('ollama');
    });
  });
});
