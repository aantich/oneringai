/**
 * Embedding model registry with comprehensive metadata
 */

import { Vendor } from '../../core/Vendor.js';
import type { IBaseModelDescription, VendorOptionSchema } from '../types/SharedTypes.js';
import { assertNoRegistryAliasCollisions, createRegistryHelpers } from './RegistryUtils.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Embedding model capabilities
 */
export interface EmbeddingModelCapabilities {
  /** Maximum input tokens */
  maxTokens: number;

  /** Default output dimensions */
  defaultDimensions: number;

  /** Maximum output dimensions */
  maxDimensions: number;

  /** Input modalities embedded into the shared vector space. */
  inputModalities?: readonly ('text' | 'image' | 'audio' | 'video' | 'document')[];

  /** Feature support flags */
  features: {
    /** Matryoshka Representation Learning — flexible output dimensions */
    matryoshka: boolean;
    /** Supports task-specific instruction prefixes */
    instructionAware: boolean;
    /** Supports batched input (array of strings) in one call */
    batchInput: boolean;
    /** Supports 100+ languages */
    multilingual: boolean;
  };

  /** Model limits */
  limits: {
    /** Maximum inputs per batch request */
    maxBatchSize: number;
    /** Rate limit (requests per minute) */
    maxRequestsPerMinute?: number;
  };

  /** Vendor-specific options schema */
  vendorOptions?: Record<string, VendorOptionSchema>;
}

/**
 * Embedding model pricing
 */
export interface EmbeddingModelPricing {
  /** Cost per million tokens */
  perMTokens: number;
  perMImageTokens?: number;
  perMAudioTokens?: number;
  perMVideoTokens?: number;
  perImage?: number;
  perAudioSecond?: number;
  perVideoFrame?: number;
  /** Cost multiplier for asynchronous batch processing (for example, 0.5). */
  batchMultiplier?: number;
  currency: 'USD';
}

export interface EmbeddingCostOptions {
  /** Treat the legacy `tokens` argument as this modality. Defaults to text. */
  modality?: 'text' | 'image' | 'audio' | 'video';
  /** Additional modality-specific token buckets for mixed inputs. */
  imageTokens?: number;
  audioTokens?: number;
  videoTokens?: number;
  /** Unit counts accepted when token usage is unavailable. */
  images?: number;
  audioSeconds?: number;
  videoFrames?: number;
  /** Apply the model's published batch discount. */
  batch?: boolean;
}

/**
 * Complete embedding model description
 */
export interface IEmbeddingModelDescription extends IBaseModelDescription {
  capabilities: EmbeddingModelCapabilities;
  pricing?: EmbeddingModelPricing;
}

// =============================================================================
// Model Constants
// =============================================================================

export const EMBEDDING_MODELS = {
  [Vendor.OpenAI]: {
    /** text-embedding-3-small: Cost-efficient, 1536 dims, MRL support */
    TEXT_EMBEDDING_3_SMALL: 'text-embedding-3-small',
    /** text-embedding-3-large: High quality, 3072 dims, MRL support */
    TEXT_EMBEDDING_3_LARGE: 'text-embedding-3-large',
    /** text-embedding-ada-002: Legacy model */
    TEXT_EMBEDDING_ADA_002: 'text-embedding-ada-002',
  },
  [Vendor.Google]: {
    /** Gemini Embedding 2: current multimodal embedding model */
    GEMINI_EMBEDDING_2: 'gemini-embedding-2',
    /** Current text-only Gemini embedding model */
    GEMINI_EMBEDDING_001: 'gemini-embedding-001',
    /** text-embedding-004: Gemini embedding model */
    TEXT_EMBEDDING_004: 'text-embedding-004',
  },
  [Vendor.Mistral]: {
    /** mistral-embed: Mistral's embedding model */
    MISTRAL_EMBED: 'mistral-embed',
    /** Codestral Embed: code retrieval model with configurable dimensions. */
    CODESTRAL_EMBED: 'codestral-embed',
  },
  [Vendor.Ollama]: {
    /** Ollama's recommended compact multilingual embedding model. */
    EMBEDDINGGEMMA: 'embeddinggemma',
    /** Compact Sentence Transformers embedding model. */
    ALL_MINILM: 'all-minilm',
    /** qwen3-embedding: 8B parameter, best quality local model */
    QWEN3_EMBEDDING: 'qwen3-embedding',
    /** qwen3-embedding:4b: 4B parameter, middle ground */
    QWEN3_EMBEDDING_4B: 'qwen3-embedding:4b',
    /** qwen3-embedding:0.6b: Lightweight, fast */
    QWEN3_EMBEDDING_0_6B: 'qwen3-embedding:0.6b',
    /** nomic-embed-text: Compact 768-dim model */
    NOMIC_EMBED_TEXT: 'nomic-embed-text',
    /** mxbai-embed-large: Mixed Bread AI large embedding */
    MXBAI_EMBED_LARGE: 'mxbai-embed-large',
  },
} as const;

// =============================================================================
// Registry
// =============================================================================

/**
 * Complete embedding model registry
 * Last full audit: August 2026
 */
export const EMBEDDING_MODEL_REGISTRY: Record<string, IEmbeddingModelDescription> = {
  // ======================== OpenAI ========================

  'text-embedding-3-small': {
    name: 'text-embedding-3-small',
    displayName: 'Text Embedding 3 Small',
    provider: Vendor.OpenAI,
    description: 'Cost-efficient embedding model with MRL support for flexible dimensions',
    isActive: true,
    releaseDate: '2024-01-25',
    sources: {
      documentation: 'https://platform.openai.com/docs/guides/embeddings',
      pricing: 'https://openai.com/pricing',
      lastVerified: '2026-08-30',
    },
    capabilities: {
      maxTokens: 8191,
      defaultDimensions: 1536,
      maxDimensions: 1536,
      features: {
        matryoshka: true,
        instructionAware: false,
        batchInput: true,
        multilingual: true,
      },
      limits: {
        maxBatchSize: 2048,
        maxRequestsPerMinute: 3000,
      },
    },
    pricing: {
      perMTokens: 0.02,
      currency: 'USD',
    },
  },

  'text-embedding-3-large': {
    name: 'text-embedding-3-large',
    displayName: 'Text Embedding 3 Large',
    provider: Vendor.OpenAI,
    description: 'High-quality embedding model with MRL support, up to 3072 dimensions',
    isActive: true,
    releaseDate: '2024-01-25',
    sources: {
      documentation: 'https://platform.openai.com/docs/guides/embeddings',
      pricing: 'https://openai.com/pricing',
      lastVerified: '2026-08-30',
    },
    capabilities: {
      maxTokens: 8191,
      defaultDimensions: 3072,
      maxDimensions: 3072,
      features: {
        matryoshka: true,
        instructionAware: false,
        batchInput: true,
        multilingual: true,
      },
      limits: {
        maxBatchSize: 2048,
        maxRequestsPerMinute: 3000,
      },
    },
    pricing: {
      perMTokens: 0.13,
      currency: 'USD',
    },
  },

  'text-embedding-ada-002': {
    name: 'text-embedding-ada-002',
    displayName: 'Text Embedding Ada 002',
    provider: Vendor.OpenAI,
    description: 'Legacy embedding model, replaced by text-embedding-3 series',
    isActive: true,
    lifecycle: 'legacy',
    releaseDate: '2022-12-15',
    sources: {
      documentation: 'https://developers.openai.com/api/docs/models/text-embedding-ada-002',
      pricing: 'https://developers.openai.com/api/docs/pricing',
      lastVerified: '2026-08-30',
    },
    capabilities: {
      maxTokens: 8191,
      defaultDimensions: 1536,
      maxDimensions: 1536,
      features: {
        matryoshka: false,
        instructionAware: false,
        batchInput: true,
        multilingual: false,
      },
      limits: {
        maxBatchSize: 2048,
      },
    },
    pricing: {
      perMTokens: 0.10,
      currency: 'USD',
    },
  },

  // ======================== Google ========================

  'gemini-embedding-2': {
    name: 'gemini-embedding-2',
    displayName: 'Gemini Embedding 2',
    provider: Vendor.Google,
    description: 'Current multimodal embedding model mapping text, images, audio, video, and PDFs into one vector space',
    isActive: true,
    lifecycle: 'active',
    availability: 'public',
    preferred: true,
    endpoints: ['embeddings', 'batch'],
    releaseDate: '2026-04-28',
    sources: {
      documentation: 'https://ai.google.dev/gemini-api/docs/models/gemini-embedding-2',
      pricing: 'https://ai.google.dev/gemini-api/docs/pricing',
      lastVerified: '2026-08-30',
    },
    capabilities: {
      maxTokens: 8192,
      defaultDimensions: 3072,
      maxDimensions: 3072,
      inputModalities: ['text', 'image', 'audio', 'video', 'document'],
      features: { matryoshka: true, instructionAware: true, batchInput: true, multilingual: true },
      limits: { maxBatchSize: 100 },
    },
    pricing: {
      perMTokens: 0.20,
      perMImageTokens: 0.45,
      perMAudioTokens: 6.50,
      perMVideoTokens: 12,
      perImage: 0.00012,
      perAudioSecond: 0.00016,
      perVideoFrame: 0.00079,
      batchMultiplier: 0.5,
      currency: 'USD',
    },
  },

  'gemini-embedding-001': {
    name: 'gemini-embedding-001',
    displayName: 'Gemini Embedding',
    provider: Vendor.Google,
    description: 'Stable text-only Gemini embedding model with flexible dimensions',
    isActive: true,
    lifecycle: 'active',
    availability: 'public',
    endpoints: ['embeddings', 'batch'],
    releaseDate: '2025-06-01',
    sources: {
      documentation: 'https://ai.google.dev/gemini-api/docs/embeddings',
      pricing: 'https://ai.google.dev/gemini-api/docs/pricing',
      lastVerified: '2026-08-30',
    },
    capabilities: {
      maxTokens: 2048,
      defaultDimensions: 3072,
      maxDimensions: 3072,
      inputModalities: ['text'],
      features: { matryoshka: true, instructionAware: true, batchInput: true, multilingual: true },
      limits: { maxBatchSize: 100 },
    },
    pricing: { perMTokens: 0.15, batchMultiplier: 0.5, currency: 'USD' },
  },

  'text-embedding-004': {
    name: 'text-embedding-004',
    displayName: 'Text Embedding 004',
    provider: Vendor.Google,
    description: 'Gemini embedding model with dimension reduction support',
    isActive: false,
    lifecycle: 'retired',
    retirementDate: '2026-01-14',
    replacementModel: 'gemini-embedding-2',
    releaseDate: '2024-05-14',
    sources: {
      documentation: 'https://ai.google.dev/gemini-api/docs/embeddings',
      pricing: 'https://ai.google.dev/pricing',
      lastVerified: '2026-08-30',
    },
    capabilities: {
      maxTokens: 2048,
      defaultDimensions: 768,
      maxDimensions: 768,
      features: {
        matryoshka: true,
        instructionAware: true,
        batchInput: true,
        multilingual: true,
      },
      limits: {
        maxBatchSize: 100,
        maxRequestsPerMinute: 1500,
      },
      vendorOptions: {
        taskType: {
          type: 'enum',
          description: 'Task type for optimized embeddings',
          enum: [
            'RETRIEVAL_QUERY',
            'RETRIEVAL_DOCUMENT',
            'SEMANTIC_SIMILARITY',
            'CLASSIFICATION',
            'CLUSTERING',
            'QUESTION_ANSWERING',
            'FACT_VERIFICATION',
          ],
          label: 'Task Type',
          controlType: 'select',
        },
      },
    },
    pricing: {
      perMTokens: 0.00,
      currency: 'USD',
    },
  },

  // ======================== Mistral ========================

  'mistral-embed': {
    name: 'mistral-embed',
    displayName: 'Mistral Embed',
    provider: Vendor.Mistral,
    description: 'Mistral embedding model optimized for retrieval',
    isActive: true,
    releaseDate: '2024-02-26',
    sources: {
      documentation: 'https://docs.mistral.ai/capabilities/embeddings/',
      pricing: 'https://mistral.ai/products/la-plateforme#pricing',
      lastVerified: '2026-08-30',
    },
    capabilities: {
      maxTokens: 8192,
      defaultDimensions: 1024,
      maxDimensions: 1024,
      features: {
        matryoshka: false,
        instructionAware: false,
        batchInput: true,
        multilingual: true,
      },
      limits: {
        maxBatchSize: 512,
      },
    },
    pricing: {
      perMTokens: 0.10,
      currency: 'USD',
    },
  },

  'codestral-embed': {
    name: 'codestral-embed',
    displayName: 'Codestral Embed',
    provider: Vendor.Mistral,
    description: 'Code-specialized retrieval embeddings with configurable output dimensions and data types',
    isActive: true,
    lifecycle: 'active',
    availability: 'public',
    endpoints: ['embeddings', 'batch'],
    releaseDate: '2025-05-28',
    sources: {
      documentation: 'https://docs.mistral.ai/models/codestral-embed-25-05',
      pricing: 'https://docs.mistral.ai/models/codestral-embed-25-05',
      lastVerified: '2026-08-30',
    },
    capabilities: {
      maxTokens: 8192,
      defaultDimensions: 3072,
      maxDimensions: 3072,
      inputModalities: ['text'],
      features: { matryoshka: true, instructionAware: false, batchInput: true, multilingual: true },
      limits: { maxBatchSize: 128 },
      vendorOptions: {
        output_dimension: { type: 'number', description: 'Requested output vector dimensions', min: 1, max: 3072 },
        output_dtype: { type: 'enum', description: 'Output vector data type', enum: ['float', 'int8', 'uint8', 'binary', 'ubinary'], default: 'float' },
      },
    },
    pricing: { perMTokens: 0.15, currency: 'USD' },
  },

  // ======================== Ollama (Local) ========================

  'embeddinggemma': {
    name: 'embeddinggemma',
    displayName: 'EmbeddingGemma 300M',
    provider: Vendor.Ollama,
    description: 'Ollama-recommended compact multilingual embedding model from Google',
    isActive: true,
    lifecycle: 'active',
    availability: 'public',
    preferred: true,
    releaseDate: '2025-09-04',
    sources: {
      documentation: 'https://docs.ollama.com/capabilities/embeddings',
      apiReference: 'https://ollama.com/library/embeddinggemma',
      lastVerified: '2026-08-30',
    },
    capabilities: {
      maxTokens: 2048,
      defaultDimensions: 768,
      maxDimensions: 768,
      inputModalities: ['text'],
      features: { matryoshka: true, instructionAware: true, batchInput: true, multilingual: true },
      limits: { maxBatchSize: 512 },
    },
  },

  'all-minilm': {
    name: 'all-minilm',
    displayName: 'All MiniLM',
    provider: Vendor.Ollama,
    description: 'Small sentence embedding model for fast local semantic search',
    isActive: true,
    lifecycle: 'active',
    availability: 'public',
    sources: {
      documentation: 'https://docs.ollama.com/capabilities/embeddings',
      apiReference: 'https://ollama.com/library/all-minilm',
      lastVerified: '2026-08-30',
    },
    capabilities: {
      maxTokens: 512,
      defaultDimensions: 384,
      maxDimensions: 384,
      inputModalities: ['text'],
      features: { matryoshka: false, instructionAware: false, batchInput: true, multilingual: false },
      limits: { maxBatchSize: 512 },
    },
  },

  'qwen3-embedding': {
    name: 'qwen3-embedding',
    displayName: 'Qwen3 Embedding 8B',
    provider: Vendor.Ollama,
    description: 'Top-tier local embedding model (8B params). #1 on MTEB multilingual. ~5GB Q4.',
    isActive: true,
    releaseDate: '2025-06-09',
    sources: {
      documentation: 'https://huggingface.co/Qwen/Qwen3-Embedding-8B',
      pricing: 'https://ollama.com/library/qwen3-embedding',
      lastVerified: '2026-08-30',
    },
    capabilities: {
      maxTokens: 8192,
      defaultDimensions: 4096,
      maxDimensions: 4096,
      features: {
        matryoshka: true,
        instructionAware: true,
        batchInput: true,
        multilingual: true,
      },
      limits: {
        maxBatchSize: 512,
      },
    },
  },

  'qwen3-embedding:4b': {
    name: 'qwen3-embedding:4b',
    displayName: 'Qwen3 Embedding 4B',
    provider: Vendor.Ollama,
    description: 'Mid-range local embedding model (4B params). ~2.5GB Q4.',
    isActive: true,
    releaseDate: '2025-06-09',
    sources: {
      documentation: 'https://huggingface.co/Qwen/Qwen3-Embedding-4B',
      pricing: 'https://ollama.com/library/qwen3-embedding',
      lastVerified: '2026-08-30',
    },
    capabilities: {
      maxTokens: 8192,
      defaultDimensions: 4096,
      maxDimensions: 4096,
      features: {
        matryoshka: true,
        instructionAware: true,
        batchInput: true,
        multilingual: true,
      },
      limits: {
        maxBatchSize: 512,
      },
    },
  },

  'qwen3-embedding:0.6b': {
    name: 'qwen3-embedding:0.6b',
    displayName: 'Qwen3 Embedding 0.6B',
    provider: Vendor.Ollama,
    description: 'Lightweight local embedding model (0.6B params). ~400MB Q4. Runs on any laptop.',
    isActive: true,
    releaseDate: '2025-06-09',
    sources: {
      documentation: 'https://huggingface.co/Qwen/Qwen3-Embedding-0.6B',
      pricing: 'https://ollama.com/library/qwen3-embedding',
      lastVerified: '2026-08-30',
    },
    capabilities: {
      maxTokens: 8192,
      defaultDimensions: 1024,
      maxDimensions: 1024,
      features: {
        matryoshka: true,
        instructionAware: true,
        batchInput: true,
        multilingual: true,
      },
      limits: {
        maxBatchSize: 512,
      },
    },
  },

  'nomic-embed-text': {
    name: 'nomic-embed-text',
    displayName: 'Nomic Embed Text',
    provider: Vendor.Ollama,
    description: 'Compact 768-dim embedding model with MRL support. ~275MB.',
    isActive: true,
    releaseDate: '2024-02-02',
    sources: {
      documentation: 'https://huggingface.co/nomic-ai/nomic-embed-text-v1.5',
      pricing: 'https://ollama.com/library/nomic-embed-text',
      lastVerified: '2026-08-30',
    },
    capabilities: {
      maxTokens: 8192,
      defaultDimensions: 768,
      maxDimensions: 768,
      features: {
        matryoshka: true,
        instructionAware: true,
        batchInput: true,
        multilingual: false,
      },
      limits: {
        maxBatchSize: 512,
      },
    },
  },

  'mxbai-embed-large': {
    name: 'mxbai-embed-large',
    displayName: 'MixedBread Embed Large',
    provider: Vendor.Ollama,
    description: 'Mixed Bread AI large embedding model. ~670MB.',
    isActive: true,
    releaseDate: '2024-03-07',
    sources: {
      documentation: 'https://huggingface.co/mixedbread-ai/mxbai-embed-large-v1',
      pricing: 'https://ollama.com/library/mxbai-embed-large',
      lastVerified: '2026-08-30',
    },
    capabilities: {
      maxTokens: 512,
      defaultDimensions: 1024,
      maxDimensions: 1024,
      features: {
        matryoshka: false,
        instructionAware: true,
        batchInput: true,
        multilingual: false,
      },
      limits: {
        maxBatchSize: 512,
      },
    },
  },
};

// =============================================================================
// Helpers (via RegistryUtils)
// =============================================================================

assertNoRegistryAliasCollisions(EMBEDDING_MODEL_REGISTRY, 'EMBEDDING_MODEL_REGISTRY');
const helpers = createRegistryHelpers(EMBEDDING_MODEL_REGISTRY);

/** Get embedding model information by name */
export const getEmbeddingModelInfo = helpers.getInfo;

/** Get all active embedding models for a vendor */
export const getEmbeddingModelsByVendor = helpers.getByVendor;

/** Get all currently active embedding models */
export const getActiveEmbeddingModels = helpers.getActive;
/** Get active embedding models with a published deprecation notice. */
export const getDeprecatedEmbeddingModels = helpers.getDeprecated;

/**
 * Get embedding models that support a specific feature
 */
export function getEmbeddingModelsWithFeature(
  feature: keyof IEmbeddingModelDescription['capabilities']['features']
): IEmbeddingModelDescription[] {
  return Object.values(EMBEDDING_MODEL_REGISTRY).filter(
    (model) => model.isActive && model.capabilities.features[feature]
  );
}

// =============================================================================
// Cost Calculation
// =============================================================================

/**
 * Calculate embedding cost for a given model and token count
 * @param modelName - Model identifier
 * @param tokens - Number of input tokens
 * @returns Cost in USD, or null if model not found or has no pricing
 */
export function calculateEmbeddingCost(
  modelName: string,
  tokens: number,
  options: EmbeddingCostOptions = {}
): number | null {
  const model = getEmbeddingModelInfo(modelName);
  if (!model?.pricing) return null;
  const pricing = model.pricing;
  const rateByModality = {
    text: pricing.perMTokens,
    image: pricing.perMImageTokens,
    audio: pricing.perMAudioTokens,
    video: pricing.perMVideoTokens,
  } as const;
  const primaryRate = rateByModality[options.modality ?? 'text'];
  if (primaryRate === undefined) return null;

  let cost = (tokens / 1_000_000) * primaryRate;
  if (options.imageTokens !== undefined) {
    if (pricing.perMImageTokens === undefined) return null;
    cost += (options.imageTokens / 1_000_000) * pricing.perMImageTokens;
  } else if (options.images !== undefined) {
    if (pricing.perImage === undefined) return null;
    cost += options.images * pricing.perImage;
  }
  if (options.audioTokens !== undefined) {
    if (pricing.perMAudioTokens === undefined) return null;
    cost += (options.audioTokens / 1_000_000) * pricing.perMAudioTokens;
  } else if (options.audioSeconds !== undefined) {
    if (pricing.perAudioSecond === undefined) return null;
    cost += options.audioSeconds * pricing.perAudioSecond;
  }
  if (options.videoTokens !== undefined) {
    if (pricing.perMVideoTokens === undefined) return null;
    cost += (options.videoTokens / 1_000_000) * pricing.perMVideoTokens;
  } else if (options.videoFrames !== undefined) {
    if (pricing.perVideoFrame === undefined) return null;
    cost += options.videoFrames * pricing.perVideoFrame;
  }
  return cost * (options.batch ? (pricing.batchMultiplier ?? 1) : 1);
}
