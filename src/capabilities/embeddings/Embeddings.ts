/**
 * Embeddings - High-level embedding capability
 *
 * Provides a unified interface for generating embeddings across multiple vendors.
 *
 * @example
 * ```typescript
 * import { Embeddings, Connector, Vendor } from '@everworker/oneringai';
 *
 * Connector.create({
 *   name: 'openai',
 *   vendor: Vendor.OpenAI,
 *   auth: { type: 'api_key', apiKey: process.env.OPENAI_API_KEY! },
 * });
 *
 * const embeddings = Embeddings.create({ connector: 'openai' });
 *
 * const result = await embeddings.embed('Hello world');
 * console.log(result.embeddings[0].length); // 1536
 *
 * // Batch embedding
 * const batch = await embeddings.embed(['Hello', 'World'], { dimensions: 512 });
 * console.log(batch.embeddings.length); // 2
 * ```
 */

import { Connector } from '../../core/Connector.js';
import { createEmbeddingProvider } from '../../core/createEmbeddingProvider.js';
import type {
  IEmbeddingProvider,
  EmbeddingOptions,
  EmbeddingResponse,
} from '../../domain/interfaces/IEmbeddingProvider.js';
import {
  EMBEDDING_MODELS,
  getEmbeddingModelInfo,
  type IEmbeddingModelDescription,
} from '../../domain/entities/EmbeddingModel.js';
import { Vendor } from '../../core/Vendor.js';

/**
 * Options for creating an Embeddings instance
 */
export interface EmbeddingsCreateOptions {
  /** Connector name or instance */
  connector: string | Connector;
  /** Default model to use (if not specified, uses vendor's default) */
  model?: string;
  /** Default dimensions (for MRL models) */
  dimensions?: number;
}

/**
 * Embeddings capability class
 */
export class Embeddings {
  private provider: IEmbeddingProvider;
  private connector: Connector;
  private defaultModel: string;
  private defaultDimensions?: number;

  private constructor(connector: Connector, model?: string, dimensions?: number) {
    this.connector = connector;
    this.provider = createEmbeddingProvider(connector);
    this.defaultModel = model || this.getDefaultModel();
    this.defaultDimensions = dimensions;
  }

  /**
   * Create an Embeddings instance
   */
  static create(options: EmbeddingsCreateOptions): Embeddings {
    const connector =
      typeof options.connector === 'string'
        ? Connector.get(options.connector)
        : options.connector;

    if (!connector) {
      throw new Error(`Connector not found: ${options.connector}`);
    }

    return new Embeddings(connector, options.model, options.dimensions);
  }

  /**
   * Generate embeddings for one or more inputs
   */
  async embed(
    input: string | string[],
    options?: { model?: string; dimensions?: number }
  ): Promise<EmbeddingResponse> {
    const fullOptions: EmbeddingOptions = {
      model: options?.model || this.defaultModel,
      input,
      dimensions: options?.dimensions ?? this.defaultDimensions,
    };

    return this.provider.embed(fullOptions);
  }

  /**
   * List available embedding models for this provider
   */
  async listModels(): Promise<string[]> {
    if (this.provider.listModels) {
      return this.provider.listModels();
    }

    // Fallback to registry
    const vendor = this.connector.vendor;
    if (vendor && EMBEDDING_MODELS[vendor as keyof typeof EMBEDDING_MODELS]) {
      return Object.values(EMBEDDING_MODELS[vendor as keyof typeof EMBEDDING_MODELS]);
    }

    return [];
  }

  /**
   * Get information about a specific embedding model
   */
  getModelInfo(modelName: string): IEmbeddingModelDescription | undefined {
    return getEmbeddingModelInfo(modelName);
  }

  /**
   * Get the underlying provider
   */
  getProvider(): IEmbeddingProvider {
    return this.provider;
  }

  /**
   * Get the current connector
   */
  getConnector(): Connector {
    return this.connector;
  }

  /**
   * Get the default model for this vendor
   */
  private getDefaultModel(): string {
    const vendor = this.connector.vendor;

    switch (vendor) {
      case Vendor.OpenAI:
        return EMBEDDING_MODELS[Vendor.OpenAI].TEXT_EMBEDDING_3_SMALL;
      case Vendor.Google:
        return EMBEDDING_MODELS[Vendor.Google].TEXT_EMBEDDING_004;
      case Vendor.Mistral:
        return EMBEDDING_MODELS[Vendor.Mistral].MISTRAL_EMBED;
      case Vendor.Ollama:
        return EMBEDDING_MODELS[Vendor.Ollama].QWEN3_EMBEDDING;
      default:
        // For generic/custom vendors, caller must specify a model
        throw new Error(`No default embedding model for vendor: ${vendor}. Specify a model explicitly.`);
    }
  }
}
