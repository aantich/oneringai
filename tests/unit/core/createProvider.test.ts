/**
 * createProvider Unit Tests
 * Tests the provider factory function
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Create mock classes with vi.hoisted for proper hoisting
const {
  MockOpenAITextProvider,
  MockAnthropicTextProvider,
  MockGoogleTextProvider,
  MockVertexAITextProvider,
  MockDeepSeekTextProvider,
  MockGrokTextProvider,
  MockGenericOpenAIProvider,
} = vi.hoisted(() => {
  const MockOpenAITextProvider = vi.fn().mockImplementation((config) => ({
    name: 'openai',
    config,
  }));

  const MockAnthropicTextProvider = vi.fn().mockImplementation((config) => ({
    name: 'anthropic',
    config,
  }));

  const MockGoogleTextProvider = vi.fn().mockImplementation((config) => ({
    name: 'google',
    config,
  }));

  const MockVertexAITextProvider = vi.fn().mockImplementation((config) => ({
    name: 'vertex-ai',
    config,
  }));

  const MockDeepSeekTextProvider = vi.fn().mockImplementation((config) => ({
    name: 'deepseek',
    config,
  }));

  const MockGenericOpenAIProvider = vi.fn().mockImplementation((name, config) => ({
    name,
    config,
  }));

  const MockGrokTextProvider = vi.fn().mockImplementation((name, config) => ({
    name,
    config,
  }));

  return {
    MockOpenAITextProvider,
    MockAnthropicTextProvider,
    MockGoogleTextProvider,
    MockVertexAITextProvider,
    MockDeepSeekTextProvider,
    MockGrokTextProvider,
    MockGenericOpenAIProvider,
  };
});

// Mock all provider classes
vi.mock('@/infrastructure/providers/openai/OpenAITextProvider.js', () => ({
  OpenAITextProvider: MockOpenAITextProvider,
}));

vi.mock('@/infrastructure/providers/anthropic/AnthropicTextProvider.js', () => ({
  AnthropicTextProvider: MockAnthropicTextProvider,
}));

vi.mock('@/infrastructure/providers/google/GoogleTextProvider.js', () => ({
  GoogleTextProvider: MockGoogleTextProvider,
}));

vi.mock('@/infrastructure/providers/vertex/VertexAITextProvider.js', () => ({
  VertexAITextProvider: MockVertexAITextProvider,
}));

vi.mock('@/infrastructure/providers/deepseek/DeepSeekTextProvider.js', () => ({
  DeepSeekTextProvider: MockDeepSeekTextProvider,
}));

vi.mock('@/infrastructure/providers/generic/GenericOpenAIProvider.js', () => ({
  GenericOpenAIProvider: MockGenericOpenAIProvider,
}));

vi.mock('@/infrastructure/providers/grok/GrokTextProvider.js', () => ({
  GrokTextProvider: MockGrokTextProvider,
}));

// Import after mocking
import { createProvider, createProviderAsync } from '@/core/createProvider.js';
import { Connector } from '@/core/Connector.js';
import { Vendor } from '@/core/Vendor.js';

describe('createProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Connector.clear();
  });

  afterEach(() => {
    Connector.clear();
  });

  describe('vendor routing', () => {
    it('should create OpenAITextProvider for OpenAI vendor', () => {
      Connector.create({
        name: 'openai-test',
        vendor: Vendor.OpenAI,
        auth: { type: 'api_key', apiKey: 'sk-test' },
      });

      const provider = createProvider(Connector.get('openai-test'));

      expect(provider.name).toBe('openai');
    });

    it('should create AnthropicTextProvider for Anthropic vendor', () => {
      Connector.create({
        name: 'anthropic-test',
        vendor: Vendor.Anthropic,
        auth: { type: 'api_key', apiKey: 'sk-ant-test' },
      });

      const provider = createProvider(Connector.get('anthropic-test'));

      expect(provider.name).toBe('anthropic');
    });

    it('should create GoogleTextProvider for Google vendor', () => {
      Connector.create({
        name: 'google-test',
        vendor: Vendor.Google,
        auth: { type: 'api_key', apiKey: 'google-key' },
      });

      const provider = createProvider(Connector.get('google-test'));

      expect(provider.name).toBe('google');
    });

    it('should create VertexAITextProvider for GoogleVertex vendor', () => {
      Connector.create({
        name: 'vertex-test',
        vendor: Vendor.GoogleVertex,
        auth: { type: 'api_key', apiKey: '' },
        options: {
          projectId: 'my-project',
          location: 'us-central1',
        },
      });

      const provider = createProvider(Connector.get('vertex-test'));

      expect(provider.name).toBe('vertex-ai');
    });

    it('should create GenericOpenAIProvider for Groq vendor', () => {
      Connector.create({
        name: 'groq-test',
        vendor: Vendor.Groq,
        auth: { type: 'api_key', apiKey: 'groq-key' },
      });

      const provider = createProvider(Connector.get('groq-test'));

      expect(provider.name).toBe('groq-test');
    });

    it('should create GenericOpenAIProvider for Together vendor', () => {
      Connector.create({
        name: 'together-test',
        vendor: Vendor.Together,
        auth: { type: 'api_key', apiKey: 'together-key' },
      });

      const provider = createProvider(Connector.get('together-test'));

      expect(provider.name).toBe('together-test');
    });

    it('should create GenericOpenAIProvider for Perplexity vendor', () => {
      Connector.create({
        name: 'perplexity-test',
        vendor: Vendor.Perplexity,
        auth: { type: 'api_key', apiKey: 'pplx-key' },
      });

      const provider = createProvider(Connector.get('perplexity-test'));

      expect(provider.name).toBe('perplexity-test');
    });

    it('should create the dedicated GrokTextProvider for Grok vendor', () => {
      Connector.create({
        name: 'grok-test',
        vendor: Vendor.Grok,
        auth: { type: 'api_key', apiKey: 'xai-key' },
      });

      const provider = createProvider(Connector.get('grok-test'));

      expect(provider.name).toBe('grok-test');
      expect(MockGrokTextProvider).toHaveBeenCalledWith(
        'grok-test',
        expect.objectContaining({ baseURL: 'https://api.x.ai/v1' }),
      );
    });

    it('should create the dedicated DeepSeekTextProvider for DeepSeek vendor', () => {
      Connector.create({
        name: 'deepseek-test',
        vendor: Vendor.DeepSeek,
        auth: { type: 'api_key', apiKey: 'deepseek-key' },
      });

      const provider = createProvider(Connector.get('deepseek-test'));

      expect(provider.name).toBe('deepseek');
      expect(MockDeepSeekTextProvider).toHaveBeenCalledWith(
        expect.objectContaining({
          connectorName: 'deepseek-test',
          host: undefined,
          transport: undefined,
        }),
      );
    });

    it('should pass DeepSeek host and transport options', () => {
      Connector.create({
        name: 'deepseek-openrouter',
        vendor: Vendor.DeepSeek,
        auth: { type: 'api_key', apiKey: 'openrouter-key' },
        options: {
          deepseekHost: 'openrouter',
          deepseekTransport: 'chat_completions',
        },
      });

      createProvider(Connector.get('deepseek-openrouter'));

      expect(MockDeepSeekTextProvider).toHaveBeenCalledWith(
        expect.objectContaining({
          host: 'openrouter',
          transport: 'chat_completions',
        }),
      );
    });

    it('should pass a custom DeepSeek endpoint through the connector', () => {
      Connector.create({
        name: 'deepseek-custom',
        vendor: Vendor.DeepSeek,
        auth: { type: 'api_key', apiKey: 'custom-key' },
        baseURL: 'https://deepseek.example.com/v1',
        options: { deepseekHost: 'custom' },
      });

      createProvider(Connector.get('deepseek-custom'));

      expect(MockDeepSeekTextProvider).toHaveBeenCalledWith(
        expect.objectContaining({
          baseURL: 'https://deepseek.example.com/v1',
          host: 'custom',
        }),
      );
    });

    it('should create GenericOpenAIProvider for Mistral vendor', () => {
      Connector.create({
        name: 'mistral-test',
        vendor: Vendor.Mistral,
        auth: { type: 'api_key', apiKey: 'mistral-key' },
      });

      const provider = createProvider(Connector.get('mistral-test'));

      expect(provider.name).toBe('mistral-test');
    });

    it('should create GenericOpenAIProvider for Ollama vendor', () => {
      Connector.create({
        name: 'ollama-test',
        vendor: Vendor.Ollama,
        auth: { type: 'api_key', apiKey: 'ollama' },
      });

      const provider = createProvider(Connector.get('ollama-test'));

      expect(provider.name).toBe('ollama-test');
    });

    it('should create GenericOpenAIProvider for Custom vendor with baseURL', () => {
      Connector.create({
        name: 'custom-test',
        vendor: Vendor.Custom,
        baseURL: 'https://my-custom-api.com/v1',
        auth: { type: 'api_key', apiKey: 'custom-key' },
      });

      const provider = createProvider(Connector.get('custom-test'));

      expect(provider.name).toBe('custom-test');
    });
  });

  describe('error handling', () => {
    it('should throw if connector has no vendor', () => {
      Connector.create({
        name: 'no-vendor',
        auth: { type: 'api_key', apiKey: 'test-key' },
      });

      expect(() => {
        createProvider(Connector.get('no-vendor'));
      }).toThrow(/no vendor/i);
    });

    it('should throw for Custom vendor without baseURL', () => {
      Connector.create({
        name: 'custom-no-url',
        vendor: Vendor.Custom,
        auth: { type: 'api_key', apiKey: 'test-key' },
      });

      expect(() => {
        createProvider(Connector.get('custom-no-url'));
      }).toThrow(/baseURL/i);
    });

    it('should throw for OAuth auth type', () => {
      Connector.create({
        name: 'oauth-connector',
        vendor: Vendor.OpenAI,
        auth: {
          type: 'oauth',
          flow: 'authorization_code',
          clientId: 'client-id',
          tokenUrl: 'https://auth.example.com/token',
          authorizationUrl: 'https://auth.example.com/authorize',
          redirectUri: 'http://localhost:3000/callback',
        },
      });

      expect(() => {
        createProvider(Connector.get('oauth-connector'));
      }).toThrow(/OAuth/i);
    });

    it('should throw for JWT auth type', () => {
      Connector.create({
        name: 'jwt-connector',
        vendor: Vendor.OpenAI,
        auth: {
          type: 'jwt',
          clientId: 'client-id',
          tokenUrl: 'https://auth.example.com/token',
          privateKey: 'key',
        },
      });

      expect(() => {
        createProvider(Connector.get('jwt-connector'));
      }).toThrow(/JWT/i);
    });
  });

  describe('config extraction', () => {
    it('should pass API key from connector', () => {
      Connector.create({
        name: 'openai-config',
        vendor: Vendor.OpenAI,
        auth: { type: 'api_key', apiKey: 'sk-my-secret-key' },
      });

      createProvider(Connector.get('openai-config'));

      expect(MockOpenAITextProvider).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKey: 'sk-my-secret-key',
        })
      );
    });

    it('passes validated runtime OpenAI API key providers without resolving them eagerly', async () => {
      const getApiKey = vi.fn(async () => 'fresh-key');
      Connector.create({
        name: 'openai-runtime-key',
        vendor: Vendor.OpenAI,
        auth: { type: 'api_key_provider', getApiKey },
      });

      createProvider(Connector.get('openai-runtime-key'));

      expect(getApiKey).not.toHaveBeenCalled();
      const config = MockOpenAITextProvider.mock.calls.at(-1)?.[0];
      expect(config?.apiKeyProvider).toEqual(expect.any(Function));
      expect(config?.apiKeyProvider).not.toBe(getApiKey);
      await expect(config?.apiKeyProvider()).resolves.toBe('fresh-key');
      expect(getApiKey).toHaveBeenCalledOnce();
    });

    it('rejects empty runtime OpenAI API keys before the SDK receives them', async () => {
      Connector.create({
        name: 'openai-empty-runtime-key',
        vendor: Vendor.OpenAI,
        auth: { type: 'api_key_provider', getApiKey: async () => '   ' },
      });

      createProvider(Connector.get('openai-empty-runtime-key'));
      const config = MockOpenAITextProvider.mock.calls.at(-1)?.[0];
      await expect(config?.apiKeyProvider()).rejects.toThrow(
        "Connector 'openai-empty-runtime-key' API key provider returned an empty key",
      );
    });

    it('should pass baseURL from connector', () => {
      Connector.create({
        name: 'openai-baseurl',
        vendor: Vendor.OpenAI,
        baseURL: 'https://custom.openai.com/v1',
        auth: { type: 'api_key', apiKey: 'test-key' },
      });

      createProvider(Connector.get('openai-baseurl'));

      expect(MockOpenAITextProvider).toHaveBeenCalledWith(
        expect.objectContaining({
          baseURL: 'https://custom.openai.com/v1',
        })
      );
    });

    it('should pass timeout from options', () => {
      Connector.create({
        name: 'openai-timeout',
        vendor: Vendor.OpenAI,
        auth: { type: 'api_key', apiKey: 'test-key' },
        options: { timeout: 30000 },
      });

      createProvider(Connector.get('openai-timeout'));

      expect(MockOpenAITextProvider).toHaveBeenCalledWith(
        expect.objectContaining({
          timeout: 30000,
        })
      );
    });

    it('should pass maxRetries from options', () => {
      Connector.create({
        name: 'openai-retries',
        vendor: Vendor.OpenAI,
        auth: { type: 'api_key', apiKey: 'test-key' },
        options: { maxRetries: 5 },
      });

      createProvider(Connector.get('openai-retries'));

      expect(MockOpenAITextProvider).toHaveBeenCalledWith(
        expect.objectContaining({
          maxRetries: 5,
        })
      );
    });

    it('should pass organization for OpenAI', () => {
      Connector.create({
        name: 'openai-org',
        vendor: Vendor.OpenAI,
        auth: { type: 'api_key', apiKey: 'test-key' },
        options: { organization: 'org-123' },
      });

      createProvider(Connector.get('openai-org'));

      expect(MockOpenAITextProvider).toHaveBeenCalledWith(
        expect.objectContaining({
          organization: 'org-123',
        })
      );
    });

    it('should pass anthropicVersion for Anthropic', () => {
      Connector.create({
        name: 'anthropic-version',
        vendor: Vendor.Anthropic,
        auth: { type: 'api_key', apiKey: 'test-key' },
        options: { anthropicVersion: '2024-01-01' },
      });

      createProvider(Connector.get('anthropic-version'));

      expect(MockAnthropicTextProvider).toHaveBeenCalledWith(
        expect.objectContaining({
          anthropicVersion: '2024-01-01',
        })
      );
    });

    it('should pass projectId and location for Vertex AI', () => {
      Connector.create({
        name: 'vertex-config',
        vendor: Vendor.GoogleVertex,
        auth: { type: 'api_key', apiKey: '' },
        options: {
          projectId: 'my-gcp-project',
          location: 'europe-west1',
        },
      });

      createProvider(Connector.get('vertex-config'));

      expect(MockVertexAITextProvider).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: 'my-gcp-project',
          location: 'europe-west1',
        })
      );
    });
  });

  describe('default baseURLs for generic providers', () => {
    it('should use default Groq baseURL', () => {
      Connector.create({
        name: 'groq-default',
        vendor: Vendor.Groq,
        auth: { type: 'api_key', apiKey: 'groq-key' },
      });

      createProvider(Connector.get('groq-default'));

      expect(MockGenericOpenAIProvider).toHaveBeenCalledWith(
        'groq-default',
        expect.objectContaining({
          baseURL: 'https://api.groq.com/openai/v1',
        })
      );
    });

    it('should use default Together baseURL', () => {
      Connector.create({
        name: 'together-default',
        vendor: Vendor.Together,
        auth: { type: 'api_key', apiKey: 'together-key' },
      });

      createProvider(Connector.get('together-default'));

      expect(MockGenericOpenAIProvider).toHaveBeenCalledWith(
        'together-default',
        expect.objectContaining({
          baseURL: 'https://api.together.xyz/v1',
        })
      );
    });

    it('should use default Ollama baseURL', () => {
      Connector.create({
        name: 'ollama-default',
        vendor: Vendor.Ollama,
        auth: { type: 'api_key', apiKey: 'ollama' },
      });

      createProvider(Connector.get('ollama-default'));

      expect(MockGenericOpenAIProvider).toHaveBeenCalledWith(
        'ollama-default',
        expect.objectContaining({
          baseURL: 'http://localhost:11434/v1',
        })
      );
    });
  });
});

describe('createProviderAsync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Connector.clear();
  });

  afterEach(() => {
    Connector.clear();
  });

  it('should work for API key auth (delegates to sync version)', async () => {
    Connector.create({
      name: 'openai-async',
      vendor: Vendor.OpenAI,
      auth: { type: 'api_key', apiKey: 'test-key' },
    });

    const provider = await createProviderAsync(Connector.get('openai-async'));

    expect(provider.name).toBe('openai');
  });
});
