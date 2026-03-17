/**
 * Embeddings capability exports
 */

// Main capability class
export { Embeddings } from './Embeddings.js';
export type { EmbeddingsCreateOptions } from './Embeddings.js';

// Types from interfaces
export type {
  EmbeddingOptions,
  EmbeddingResponse,
  IEmbeddingProvider,
} from '../../domain/interfaces/IEmbeddingProvider.js';
