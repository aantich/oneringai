/**
 * Embedding provider interface
 */

import { IProvider } from './IProvider.js';

/**
 * Options for generating embeddings
 */
export interface EmbeddingOptions {
  /** Model to use for embedding */
  model: string;
  /** Text(s) to embed — single string or array */
  input: string | string[];
  /** Output dimensions (for models that support MRL / dimension reduction) */
  dimensions?: number;
  /** Encoding format for the embedding values */
  encodingFormat?: 'float' | 'base64';
}

/**
 * Response from an embedding request
 */
export interface EmbeddingResponse {
  /** Embedding vectors — always array of arrays, even for single input */
  embeddings: number[][];
  /** Model used */
  model: string;
  /** Token usage */
  usage: {
    promptTokens: number;
    totalTokens: number;
  };
}

/**
 * Embedding provider interface
 */
export interface IEmbeddingProvider extends IProvider {
  /**
   * Generate embeddings for one or more inputs
   */
  embed(options: EmbeddingOptions): Promise<EmbeddingResponse>;

  /**
   * List available embedding models (optional)
   */
  listModels?(): Promise<string[]>;
}
