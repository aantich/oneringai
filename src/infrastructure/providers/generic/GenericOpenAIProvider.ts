/**
 * Generic OpenAI-compatible provider
 * Works with any service that implements the OpenAI Chat Completions API
 * Examples: Together AI, Groq, Perplexity, Grok (xAI), local models, etc.
 */

import { OpenAITextProvider } from '../openai/OpenAITextProvider.js';
import { ModelCapabilities } from '../../../domain/interfaces/ITextProvider.js';
import { ProviderCapabilities } from '../../../domain/interfaces/IProvider.js';
import { resolveModelCapabilities } from '../base/ModelCapabilityResolver.js';

export interface GenericOpenAIConfig {
  apiKey: string;
  baseURL: string; // Required - the API endpoint
  organization?: string;
  timeout?: number;
  maxRetries?: number;
  defaultModel?: string;
}

export class GenericOpenAIProvider extends OpenAITextProvider {
  readonly name: string;
  readonly capabilities: ProviderCapabilities;

  constructor(
    name: string,
    config: GenericOpenAIConfig,
    capabilities?: Partial<ProviderCapabilities>
  ) {
    super(config as any);
    this.name = name;

    // Set capabilities
    if (capabilities) {
      this.capabilities = {
        text: capabilities.text ?? true,
        images: capabilities.images ?? false,
        videos: capabilities.videos ?? false,
        audio: capabilities.audio ?? false,
      };
    } else {
      // Default generic capabilities
      this.capabilities = {
        text: true,
        images: false, // Conservative default
        videos: false,
        audio: false,
      };
    }
  }

  /**
   * Override API key validation for generic providers.
   * Services like Ollama don't require authentication, so accept any key including mock/placeholder keys.
   */
  protected override validateApiKey(): { isValid: boolean; warning?: string } {
    // Generic providers (Ollama, local models, etc.) may not need real API keys
    // Accept any non-undefined apiKey, including 'mock-key' from auth: { type: 'none' }
    return { isValid: true };
  }

  /**
   * Override listModels for error safety — some OpenAI-compatible APIs may not support /v1/models
   */
  async listModels(): Promise<string[]> {
    try {
      return await super.listModels();
    } catch (error) {
      this.logger.debug({ error: (error as Error).message }, 'listModels not supported by this endpoint');
      return [];
    }
  }

  /**
   * Override model capabilities for generic providers (registry-driven with conservative defaults)
   */
  getModelCapabilities(model: string): ModelCapabilities {
    return resolveModelCapabilities(model, {
      supportsTools: true,
      supportsVision: false,
      supportsJSON: true,
      supportsJSONSchema: false,
      maxTokens: 32000,
      maxInputTokens: 32000,
      maxOutputTokens: 4096,
    });
  }
}
