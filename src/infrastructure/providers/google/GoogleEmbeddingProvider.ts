/**
 * Google Embedding provider
 * Uses the Gemini embedding API (different from OpenAI-compatible format)
 */

import { BaseMediaProvider } from '../base/BaseMediaProvider.js';
import type {
  IEmbeddingProvider,
  EmbeddingOptions,
  EmbeddingResponse,
} from '../../../domain/interfaces/IEmbeddingProvider.js';
import type { ProviderCapabilities } from '../../../domain/interfaces/IProvider.js';
import type { GoogleConfig } from '../../../domain/types/ProviderConfig.js';
import {
  ProviderAuthError,
  ProviderRateLimitError,
  ProviderError,
} from '../../../domain/errors/AIErrors.js';

const GOOGLE_API_BASE = 'https://generativelanguage.googleapis.com';

interface GoogleEmbedContentResponse {
  embedding: {
    values: number[];
  };
}

interface GoogleBatchEmbedResponse {
  embeddings: Array<{
    values: number[];
  }>;
}

export class GoogleEmbeddingProvider extends BaseMediaProvider implements IEmbeddingProvider {
  readonly name: string = 'google-embedding';
  readonly vendor = 'google' as const;
  readonly capabilities: ProviderCapabilities = {
    text: false,
    images: false,
    videos: false,
    audio: false,
    embeddings: true,
  };

  private apiKey: string;

  constructor(config: GoogleConfig) {
    super(config);
    this.apiKey = config.apiKey;
  }

  /**
   * Generate embeddings using Google's embedContent / batchEmbedContents API
   */
  async embed(options: EmbeddingOptions): Promise<EmbeddingResponse> {
    return this.executeWithCircuitBreaker(
      async () => {
        try {
          const inputs = Array.isArray(options.input) ? options.input : [options.input];

          this.logOperationStart('embedding.embed', {
            model: options.model,
            inputCount: inputs.length,
            dimensions: options.dimensions,
          });

          let embeddings: number[][];

          if (inputs.length === 1) {
            embeddings = [await this.embedSingle(options.model, inputs[0]!, options.dimensions)];
          } else {
            embeddings = await this.embedBatch(options.model, inputs, options.dimensions);
          }

          const result: EmbeddingResponse = {
            embeddings,
            model: options.model,
            usage: {
              // Google doesn't return token usage in embedding responses
              promptTokens: 0,
              totalTokens: 0,
            },
          };

          this.logOperationComplete('embedding.embed', {
            model: options.model,
            embeddingsCount: result.embeddings.length,
            dimensions: result.embeddings[0]?.length,
          });

          return result;
        } catch (error: any) {
          if (error instanceof ProviderError) throw error;
          this.handleError(error);
          throw error;
        }
      },
      'embedding.embed',
      { model: options.model }
    );
  }

  private async embedSingle(model: string, text: string, dimensions?: number): Promise<number[]> {
    const url = `${GOOGLE_API_BASE}/v1beta/models/${model}:embedContent?key=${this.apiKey}`;

    const body: Record<string, unknown> = {
      content: {
        parts: [{ text }],
      },
    };

    if (dimensions !== undefined) {
      body.outputDimensionality = dimensions;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      await this.handleHttpError(response);
    }

    const data = (await response.json()) as GoogleEmbedContentResponse;
    return data.embedding.values;
  }

  private async embedBatch(model: string, texts: string[], dimensions?: number): Promise<number[][]> {
    const url = `${GOOGLE_API_BASE}/v1beta/models/${model}:batchEmbedContents?key=${this.apiKey}`;

    const requests = texts.map((text) => {
      const req: Record<string, unknown> = {
        model: `models/${model}`,
        content: {
          parts: [{ text }],
        },
      };
      if (dimensions !== undefined) {
        req.outputDimensionality = dimensions;
      }
      return req;
    });

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests }),
    });

    if (!response.ok) {
      await this.handleHttpError(response);
    }

    const data = (await response.json()) as GoogleBatchEmbedResponse;
    return data.embeddings.map((e) => e.values);
  }

  private async handleHttpError(response: Response): Promise<never> {
    const text = await response.text().catch(() => '');
    const status = response.status;

    if (status === 401 || status === 403) {
      throw new ProviderAuthError('google', 'Invalid API key');
    }

    if (status === 429) {
      throw new ProviderRateLimitError('google', undefined);
    }

    throw new ProviderError('google', `HTTP ${status}: ${text}`);
  }

  private handleError(error: any): never {
    const message = error.message || 'Unknown Google embedding error';
    throw new ProviderError('google', message);
  }
}
