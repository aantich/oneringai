/**
 * OpenAI Embedding provider
 * Also used for OpenAI-compatible vendors (Ollama, Mistral, Together, etc.)
 * via baseURL override and name override.
 */

import OpenAI from 'openai';
import { BaseMediaProvider } from '../base/BaseMediaProvider.js';
import type {
  IEmbeddingProvider,
  EmbeddingOptions,
  EmbeddingResponse,
} from '../../../domain/interfaces/IEmbeddingProvider.js';
import type { ProviderCapabilities } from '../../../domain/interfaces/IProvider.js';
import type { OpenAIMediaConfig } from '../../../domain/types/ProviderConfig.js';
import {
  ProviderAuthError,
  ProviderRateLimitError,
  ProviderError,
} from '../../../domain/errors/AIErrors.js';

export class OpenAIEmbeddingProvider extends BaseMediaProvider implements IEmbeddingProvider {
  readonly name: string;
  readonly vendor: string;
  readonly capabilities: ProviderCapabilities = {
    text: false,
    images: false,
    videos: false,
    audio: false,
    embeddings: true,
  };

  private client: OpenAI;

  /**
   * @param config - OpenAI media config (apiKey, baseURL, etc.)
   * @param nameOverride - Custom name for generic/OpenAI-compatible vendors
   */
  constructor(config: OpenAIMediaConfig, nameOverride?: string) {
    super({ apiKey: config.auth.apiKey, ...config });

    this.name = nameOverride ?? 'openai-embedding';
    this.vendor = nameOverride ? 'generic' : 'openai';

    this.client = new OpenAI({
      apiKey: config.auth.apiKey,
      baseURL: config.baseURL,
      organization: config.organization,
      timeout: config.timeout,
      maxRetries: config.maxRetries,
    });
  }

  /**
   * Generate embeddings for one or more inputs
   */
  async embed(options: EmbeddingOptions): Promise<EmbeddingResponse> {
    return this.executeWithCircuitBreaker(
      async () => {
        try {
          this.logOperationStart('embedding.embed', {
            model: options.model,
            inputCount: Array.isArray(options.input) ? options.input.length : 1,
            dimensions: options.dimensions,
          });

          const params: OpenAI.EmbeddingCreateParams = {
            model: options.model,
            input: options.input,
          };

          if (options.dimensions !== undefined) {
            params.dimensions = options.dimensions;
          }

          if (options.encodingFormat) {
            params.encoding_format = options.encodingFormat;
          }

          const response = await this.client.embeddings.create(params);

          // Sort by index to ensure correct ordering
          const sorted = response.data.sort((a, b) => a.index - b.index);

          const result: EmbeddingResponse = {
            embeddings: sorted.map((d) => d.embedding as number[]),
            model: response.model,
            usage: {
              promptTokens: response.usage.prompt_tokens,
              totalTokens: response.usage.total_tokens,
            },
          };

          this.logOperationComplete('embedding.embed', {
            model: options.model,
            embeddingsCount: result.embeddings.length,
            dimensions: result.embeddings[0]?.length,
          });

          return result;
        } catch (error: any) {
          this.handleError(error);
          throw error; // TypeScript needs this
        }
      },
      'embedding.embed',
      { model: options.model }
    );
  }

  /**
   * List available embedding models
   */
  async listModels(): Promise<string[]> {
    try {
      const models = await this.client.models.list();
      return models.data
        .filter((m) => m.id.includes('embed'))
        .map((m) => m.id);
    } catch {
      return [];
    }
  }

  /**
   * Handle OpenAI API errors
   */
  private handleError(error: any): never {
    const message = error.message || 'Unknown embedding API error';
    const status = error.status;

    if (status === 401) {
      throw new ProviderAuthError(this.name, 'Invalid API key');
    }

    if (status === 429) {
      throw new ProviderRateLimitError(this.name, message as any);
    }

    if (status === 400) {
      throw new ProviderError(this.name, `Bad request: ${message}`);
    }

    throw new ProviderError(this.name, message);
  }
}
