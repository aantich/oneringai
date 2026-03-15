/**
 * Image generation model registry with comprehensive metadata
 */

import { Vendor } from '../../core/Vendor.js';
import type { IBaseModelDescription, VendorOptionSchema } from '../types/SharedTypes.js';
import { createRegistryHelpers } from './RegistryUtils.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Supported image sizes by model
 */
export type ImageSize =
  | '256x256'
  | '512x512'
  | '1024x1024'
  | '1024x1536'
  | '1536x1024'
  | '1792x1024'
  | '1024x1792'
  | '1536x1536'
  | 'auto';

/**
 * Supported aspect ratios
 */
export type AspectRatio = '1:1' | '3:4' | '4:3' | '9:16' | '16:9' | '3:2' | '2:3' | '1:4' | '4:1' | '1:8' | '8:1' | '2:1' | '1:2';

/**
 * Image model capabilities
 */
export interface ImageModelCapabilities {
  /** Supported image sizes */
  sizes: readonly ImageSize[];

  /** Supported aspect ratios (Google) */
  aspectRatios?: readonly AspectRatio[];

  /** Maximum number of images per request */
  maxImagesPerRequest: number;

  /** Supported output formats */
  outputFormats: readonly string[];

  /** Feature support flags */
  features: {
    /** Text-to-image generation */
    generation: boolean;
    /** Image editing/inpainting */
    editing: boolean;
    /** Image variations */
    variations: boolean;
    /** Style control */
    styleControl: boolean;
    /** Quality control (standard/hd) */
    qualityControl: boolean;
    /** Transparent backgrounds */
    transparency: boolean;
    /** Prompt revision/enhancement */
    promptRevision: boolean;
  };

  /** Model limits */
  limits: {
    /** Maximum prompt length in characters */
    maxPromptLength: number;
    /** Rate limit (requests per minute) */
    maxRequestsPerMinute?: number;
  };

  /** Vendor-specific options schema */
  vendorOptions?: Record<string, VendorOptionSchema>;
}

/**
 * Image model pricing
 */
export interface ImageModelPricing {
  /** Cost per image at standard quality */
  perImageStandard?: number;
  /** Cost per image at HD quality */
  perImageHD?: number;
  /** Cost per image (flat rate) */
  perImage?: number;
  currency: 'USD';
}

/**
 * Complete image model description
 */
export interface IImageModelDescription extends IBaseModelDescription {
  capabilities: ImageModelCapabilities;
  pricing?: ImageModelPricing;
}

// =============================================================================
// Model Constants
// =============================================================================

export const IMAGE_MODELS = {
  [Vendor.OpenAI]: {
    /** GPT-Image-1.5: State-of-the-art image generation */
    GPT_IMAGE_1_5: 'gpt-image-1.5',
    /** ChatGPT-Image-Latest: Image model used in ChatGPT (floating alias) */
    CHATGPT_IMAGE_LATEST: 'chatgpt-image-latest',
    /** GPT-Image-1: Previous generation image model */
    GPT_IMAGE_1: 'gpt-image-1',
    /** GPT-Image-1-Mini: Cost-efficient version of GPT Image 1 */
    GPT_IMAGE_1_MINI: 'gpt-image-1-mini',
    /** DALL-E 3: Deprecated. High quality image generation */
    DALL_E_3: 'dall-e-3',
    /** DALL-E 2: Deprecated. Supports editing and variations */
    DALL_E_2: 'dall-e-2',
  },
  [Vendor.Google]: {
    /** Imagen 4.0: Latest Google image generation model */
    IMAGEN_4_GENERATE: 'imagen-4.0-generate-001',
    /** Imagen 4.0 Ultra: Highest quality */
    IMAGEN_4_ULTRA: 'imagen-4.0-ultra-generate-001',
    /** Imagen 4.0 Fast: Optimized for speed */
    IMAGEN_4_FAST: 'imagen-4.0-fast-generate-001',
    /** Nano Banana 2: Gemini 3.1 Flash native image gen with 4K support */
    GEMINI_3_1_FLASH_IMAGE: 'gemini-3.1-flash-image-preview',
    /** Nano Banana Pro: Gemini 3 Pro professional design engine with reasoning */
    GEMINI_3_PRO_IMAGE: 'gemini-3-pro-image-preview',
    /** Nano Banana: Gemini 2.5 Flash native image gen/editing */
    GEMINI_2_5_FLASH_IMAGE: 'gemini-2.5-flash-image',
  },
  [Vendor.Grok]: {
    /** Grok Imagine Image: xAI image generation with editing support */
    GROK_IMAGINE_IMAGE: 'grok-imagine-image',
    /** Grok 2 Image: xAI image generation (text-only input) */
    GROK_2_IMAGE_1212: 'grok-2-image-1212',
  },
} as const;

// =============================================================================
// Registry
// =============================================================================

/**
 * Complete image model registry
 * Last full audit: March 2026
 */
export const IMAGE_MODEL_REGISTRY: Record<string, IImageModelDescription> = {
  // ======================== OpenAI ========================

  'gpt-image-1.5': {
    name: 'gpt-image-1.5',
    displayName: 'GPT Image 1.5',
    provider: Vendor.OpenAI,
    description: 'State-of-the-art image generation with better instruction following and prompt adherence',
    isActive: true,
    releaseDate: '2025-12-16',
    sources: {
      documentation: 'https://developers.openai.com/api/docs/models/gpt-image-1.5',
      pricing: 'https://openai.com/pricing',
      lastVerified: '2026-03-14',
    },
    capabilities: {
      sizes: ['1024x1024', '1024x1536', '1536x1024', 'auto'],
      maxImagesPerRequest: 10,
      outputFormats: ['png', 'webp', 'jpeg'],
      features: {
        generation: true,
        editing: true,
        variations: false,
        styleControl: false,
        qualityControl: true,
        transparency: true,
        promptRevision: false,
      },
      limits: { maxPromptLength: 32000 },
      vendorOptions: {
        quality: {
          type: 'enum',
          label: 'Quality',
          description: 'Image quality level',
          enum: ['auto', 'low', 'medium', 'high'],
          default: 'auto',
          controlType: 'select',
        },
        background: {
          type: 'enum',
          label: 'Background',
          description: 'Background transparency (requires png or webp)',
          enum: ['auto', 'transparent', 'opaque'],
          default: 'auto',
          controlType: 'select',
        },
        output_format: {
          type: 'enum',
          label: 'Output Format',
          description: 'Image file format',
          enum: ['png', 'jpeg', 'webp'],
          default: 'png',
          controlType: 'select',
        },
        output_compression: {
          type: 'number',
          label: 'Compression',
          description: 'Compression level for JPEG/WebP (0-100)',
          min: 0,
          max: 100,
          default: 100,
          controlType: 'slider',
        },
        moderation: {
          type: 'enum',
          label: 'Moderation',
          description: 'Content moderation strictness',
          enum: ['auto', 'low'],
          default: 'auto',
          controlType: 'radio',
        },
      },
    },
    pricing: {
      perImageStandard: 0.034, // medium quality 1024x1024
      perImageHD: 0.133, // high quality 1024x1024
      currency: 'USD',
    },
  },

  'chatgpt-image-latest': {
    name: 'chatgpt-image-latest',
    displayName: 'ChatGPT Image Latest',
    provider: Vendor.OpenAI,
    description: 'Image model used in ChatGPT. Floating alias pointing to current ChatGPT image snapshot',
    isActive: true,
    releaseDate: '2025-12-01',
    sources: {
      documentation: 'https://developers.openai.com/api/docs/models/chatgpt-image-latest',
      pricing: 'https://openai.com/pricing',
      lastVerified: '2026-03-14',
    },
    capabilities: {
      sizes: ['1024x1024', '1024x1536', '1536x1024', 'auto'],
      maxImagesPerRequest: 10,
      outputFormats: ['png', 'webp', 'jpeg'],
      features: {
        generation: true,
        editing: true,
        variations: false,
        styleControl: false,
        qualityControl: true,
        transparency: true,
        promptRevision: false,
      },
      limits: { maxPromptLength: 32000 },
      vendorOptions: {
        quality: {
          type: 'enum',
          label: 'Quality',
          description: 'Image quality level',
          enum: ['auto', 'low', 'medium', 'high'],
          default: 'auto',
          controlType: 'select',
        },
        background: {
          type: 'enum',
          label: 'Background',
          description: 'Background transparency (requires png or webp)',
          enum: ['auto', 'transparent', 'opaque'],
          default: 'auto',
          controlType: 'select',
        },
        output_format: {
          type: 'enum',
          label: 'Output Format',
          description: 'Image file format',
          enum: ['png', 'jpeg', 'webp'],
          default: 'png',
          controlType: 'select',
        },
        output_compression: {
          type: 'number',
          label: 'Compression',
          description: 'Compression level for JPEG/WebP (0-100)',
          min: 0,
          max: 100,
          default: 100,
          controlType: 'slider',
        },
        moderation: {
          type: 'enum',
          label: 'Moderation',
          description: 'Content moderation strictness',
          enum: ['auto', 'low'],
          default: 'auto',
          controlType: 'radio',
        },
      },
    },
    pricing: {
      perImageStandard: 0.034, // medium quality 1024x1024
      perImageHD: 0.133, // high quality 1024x1024
      currency: 'USD',
    },
  },

  'gpt-image-1': {
    name: 'gpt-image-1',
    displayName: 'GPT Image 1',
    provider: Vendor.OpenAI,
    description: 'Previous generation OpenAI image model. More expensive than GPT Image 1.5',
    isActive: true,
    releaseDate: '2025-04-01',
    sources: {
      documentation: 'https://developers.openai.com/api/docs/models/gpt-image-1',
      pricing: 'https://openai.com/pricing',
      lastVerified: '2026-03-14',
    },
    capabilities: {
      sizes: ['1024x1024', '1024x1536', '1536x1024', 'auto'],
      maxImagesPerRequest: 10,
      outputFormats: ['png', 'webp', 'jpeg'],
      features: {
        generation: true,
        editing: true,
        variations: false,
        styleControl: false,
        qualityControl: true,
        transparency: true,
        promptRevision: false,
      },
      limits: { maxPromptLength: 32000 },
      vendorOptions: {
        quality: {
          type: 'enum',
          label: 'Quality',
          description: 'Image quality level',
          enum: ['auto', 'low', 'medium', 'high'],
          default: 'auto',
          controlType: 'select',
        },
        background: {
          type: 'enum',
          label: 'Background',
          description: 'Background transparency',
          enum: ['auto', 'transparent', 'opaque'],
          default: 'auto',
          controlType: 'select',
        },
        output_format: {
          type: 'enum',
          label: 'Output Format',
          description: 'Image file format',
          enum: ['png', 'jpeg', 'webp'],
          default: 'png',
          controlType: 'select',
        },
        output_compression: {
          type: 'number',
          label: 'Compression',
          description: 'Compression level for JPEG/WebP (0-100)',
          min: 0,
          max: 100,
          default: 75,
          controlType: 'slider',
        },
        moderation: {
          type: 'enum',
          label: 'Moderation',
          description: 'Content moderation strictness',
          enum: ['auto', 'low'],
          default: 'auto',
          controlType: 'radio',
        },
      },
    },
    pricing: {
      perImageStandard: 0.042, // medium quality 1024x1024
      perImageHD: 0.167, // high quality 1024x1024
      currency: 'USD',
    },
  },

  'gpt-image-1-mini': {
    name: 'gpt-image-1-mini',
    displayName: 'GPT Image 1 Mini',
    provider: Vendor.OpenAI,
    description: 'Cost-efficient version of GPT Image 1. Cheapest OpenAI image model',
    isActive: true,
    releaseDate: '2025-06-01',
    sources: {
      documentation: 'https://developers.openai.com/api/docs/models/gpt-image-1-mini',
      pricing: 'https://openai.com/pricing',
      lastVerified: '2026-03-14',
    },
    capabilities: {
      sizes: ['1024x1024', '1024x1536', '1536x1024', 'auto'],
      maxImagesPerRequest: 10,
      outputFormats: ['png', 'webp', 'jpeg'],
      features: {
        generation: true,
        editing: true,
        variations: false,
        styleControl: false,
        qualityControl: true,
        transparency: true,
        promptRevision: false,
      },
      limits: { maxPromptLength: 32000 },
      vendorOptions: {
        quality: {
          type: 'enum',
          label: 'Quality',
          description: 'Image quality level',
          enum: ['auto', 'low', 'medium', 'high'],
          default: 'auto',
          controlType: 'select',
        },
        background: {
          type: 'enum',
          label: 'Background',
          description: 'Background transparency (requires png or webp)',
          enum: ['auto', 'transparent', 'opaque'],
          default: 'auto',
          controlType: 'select',
        },
        output_format: {
          type: 'enum',
          label: 'Output Format',
          description: 'Image file format',
          enum: ['png', 'jpeg', 'webp'],
          default: 'png',
          controlType: 'select',
        },
        output_compression: {
          type: 'number',
          label: 'Compression',
          description: 'Compression level for JPEG/WebP (0-100)',
          min: 0,
          max: 100,
          default: 100,
          controlType: 'slider',
        },
        moderation: {
          type: 'enum',
          label: 'Moderation',
          description: 'Content moderation strictness',
          enum: ['auto', 'low'],
          default: 'auto',
          controlType: 'radio',
        },
      },
    },
    pricing: {
      perImageStandard: 0.011, // medium quality 1024x1024
      perImageHD: 0.036, // high quality 1024x1024
      currency: 'USD',
    },
  },

  'dall-e-3': {
    name: 'dall-e-3',
    displayName: 'DALL-E 3',
    provider: Vendor.OpenAI,
    description: 'Deprecated. High quality image generation with prompt revision. Migrate to gpt-image-1.5',
    isActive: false,
    releaseDate: '2023-11-06',
    deprecationDate: '2026-05-12',
    sources: {
      documentation: 'https://platform.openai.com/docs/guides/images',
      pricing: 'https://openai.com/pricing',
      lastVerified: '2026-01-25',
    },
    capabilities: {
      sizes: ['1024x1024', '1024x1792', '1792x1024'],
      maxImagesPerRequest: 1,
      outputFormats: ['png', 'url'],
      features: {
        generation: true,
        editing: false,
        variations: false,
        styleControl: true,
        qualityControl: true,
        transparency: false,
        promptRevision: true,
      },
      limits: { maxPromptLength: 4000 },
      vendorOptions: {
        quality: {
          type: 'enum',
          label: 'Quality',
          description: 'Image quality: standard or HD',
          enum: ['standard', 'hd'],
          default: 'standard',
          controlType: 'radio',
        },
        style: {
          type: 'enum',
          label: 'Style',
          description: 'Image style: vivid (hyper-real) or natural',
          enum: ['vivid', 'natural'],
          default: 'vivid',
          controlType: 'radio',
        },
      },
    },
    pricing: {
      perImageStandard: 0.040,
      perImageHD: 0.080,
      currency: 'USD',
    },
  },

  'dall-e-2': {
    name: 'dall-e-2',
    displayName: 'DALL-E 2',
    provider: Vendor.OpenAI,
    description: 'Deprecated. Fast image generation with editing and variation support. Migrate to gpt-image-1-mini',
    isActive: false,
    releaseDate: '2022-11-03',
    deprecationDate: '2026-05-12',
    sources: {
      documentation: 'https://platform.openai.com/docs/guides/images',
      pricing: 'https://openai.com/pricing',
      lastVerified: '2026-01-25',
    },
    capabilities: {
      sizes: ['256x256', '512x512', '1024x1024'],
      maxImagesPerRequest: 10,
      outputFormats: ['png', 'url'],
      features: {
        generation: true,
        editing: true,
        variations: true,
        styleControl: false,
        qualityControl: false,
        transparency: false,
        promptRevision: false,
      },
      limits: { maxPromptLength: 1000 },
      vendorOptions: {},
    },
    pricing: {
      perImage: 0.020,
      currency: 'USD',
    },
  },

  // ======================== Google ========================

  'imagen-4.0-generate-001': {
    name: 'imagen-4.0-generate-001',
    displayName: 'Imagen 4.0 Generate',
    provider: Vendor.Google,
    description: 'Google Imagen 4.0 - standard quality image generation',
    isActive: true,
    releaseDate: '2025-06-01',
    sources: {
      documentation: 'https://ai.google.dev/gemini-api/docs/imagen',
      pricing: 'https://ai.google.dev/pricing',
      lastVerified: '2026-03-04',
    },
    capabilities: {
      sizes: ['1024x1024'],
      aspectRatios: ['1:1', '3:4', '4:3', '9:16', '16:9'],
      maxImagesPerRequest: 4,
      outputFormats: ['png', 'jpeg'],
      features: {
        generation: true,
        editing: false,
        variations: false,
        styleControl: false,
        qualityControl: false,
        transparency: false,
        promptRevision: false,
      },
      limits: { maxPromptLength: 480 },
      vendorOptions: {
        aspectRatio: {
          type: 'enum',
          label: 'Aspect Ratio',
          description: 'Output image proportions',
          enum: ['1:1', '3:4', '4:3', '16:9', '9:16'],
          default: '1:1',
          controlType: 'select',
        },
        sampleImageSize: {
          type: 'enum',
          label: 'Resolution',
          description: 'Output image resolution',
          enum: ['1K', '2K'],
          default: '1K',
          controlType: 'radio',
        },
        outputMimeType: {
          type: 'enum',
          label: 'Output Format',
          description: 'Image file format',
          enum: ['image/png', 'image/jpeg'],
          default: 'image/png',
          controlType: 'select',
        },
        negativePrompt: {
          type: 'string',
          label: 'Negative Prompt',
          description: 'Elements to avoid in the generated image',
          controlType: 'textarea',
        },
        personGeneration: {
          type: 'enum',
          label: 'Person Generation',
          description: 'Controls whether people can appear in images',
          enum: ['dont_allow', 'allow_adult', 'allow_all'],
          default: 'allow_adult',
          controlType: 'select',
        },
        safetyFilterLevel: {
          type: 'enum',
          label: 'Safety Filter',
          description: 'Content safety filtering threshold',
          enum: ['block_none', 'block_only_high', 'block_medium_and_above', 'block_low_and_above'],
          default: 'block_medium_and_above',
          controlType: 'select',
        },
        enhancePrompt: {
          type: 'boolean',
          label: 'Enhance Prompt',
          description: 'Use LLM-based prompt rewriting for better quality',
          default: true,
          controlType: 'checkbox',
        },
        seed: {
          type: 'number',
          label: 'Seed',
          description: 'Random seed for reproducible generation (1-2147483647)',
          min: 1,
          max: 2147483647,
          controlType: 'text',
        },
        addWatermark: {
          type: 'boolean',
          label: 'Add Watermark',
          description: 'Add invisible SynthID watermark',
          default: true,
          controlType: 'checkbox',
        },
        language: {
          type: 'enum',
          label: 'Prompt Language',
          description: 'Language of the input prompt',
          enum: ['auto', 'en', 'zh', 'zh-CN', 'zh-TW', 'hi', 'ja', 'ko', 'pt', 'es'],
          default: 'en',
          controlType: 'select',
        },
      },
    },
    pricing: {
      perImage: 0.04,
      currency: 'USD',
    },
  },

  'imagen-4.0-ultra-generate-001': {
    name: 'imagen-4.0-ultra-generate-001',
    displayName: 'Imagen 4.0 Ultra',
    provider: Vendor.Google,
    description: 'Google Imagen 4.0 Ultra - highest quality image generation',
    isActive: true,
    releaseDate: '2025-06-01',
    sources: {
      documentation: 'https://ai.google.dev/gemini-api/docs/imagen',
      pricing: 'https://ai.google.dev/pricing',
      lastVerified: '2026-03-04',
    },
    capabilities: {
      sizes: ['1024x1024'],
      aspectRatios: ['1:1', '3:4', '4:3', '9:16', '16:9'],
      maxImagesPerRequest: 4,
      outputFormats: ['png', 'jpeg'],
      features: {
        generation: true,
        editing: false,
        variations: false,
        styleControl: false,
        qualityControl: true,
        transparency: false,
        promptRevision: false,
      },
      limits: { maxPromptLength: 480 },
      vendorOptions: {
        aspectRatio: {
          type: 'enum',
          label: 'Aspect Ratio',
          description: 'Output image proportions',
          enum: ['1:1', '3:4', '4:3', '16:9', '9:16'],
          default: '1:1',
          controlType: 'select',
        },
        sampleImageSize: {
          type: 'enum',
          label: 'Resolution',
          description: 'Output image resolution',
          enum: ['1K', '2K'],
          default: '1K',
          controlType: 'radio',
        },
        outputMimeType: {
          type: 'enum',
          label: 'Output Format',
          description: 'Image file format',
          enum: ['image/png', 'image/jpeg'],
          default: 'image/png',
          controlType: 'select',
        },
        negativePrompt: {
          type: 'string',
          label: 'Negative Prompt',
          description: 'Elements to avoid in the generated image',
          controlType: 'textarea',
        },
        personGeneration: {
          type: 'enum',
          label: 'Person Generation',
          description: 'Controls whether people can appear in images',
          enum: ['dont_allow', 'allow_adult', 'allow_all'],
          default: 'allow_adult',
          controlType: 'select',
        },
        safetyFilterLevel: {
          type: 'enum',
          label: 'Safety Filter',
          description: 'Content safety filtering threshold',
          enum: ['block_none', 'block_only_high', 'block_medium_and_above', 'block_low_and_above'],
          default: 'block_medium_and_above',
          controlType: 'select',
        },
        enhancePrompt: {
          type: 'boolean',
          label: 'Enhance Prompt',
          description: 'Use LLM-based prompt rewriting for better quality',
          default: true,
          controlType: 'checkbox',
        },
        seed: {
          type: 'number',
          label: 'Seed',
          description: 'Random seed for reproducible generation (1-2147483647)',
          min: 1,
          max: 2147483647,
          controlType: 'text',
        },
        addWatermark: {
          type: 'boolean',
          label: 'Add Watermark',
          description: 'Add invisible SynthID watermark',
          default: true,
          controlType: 'checkbox',
        },
        language: {
          type: 'enum',
          label: 'Prompt Language',
          description: 'Language of the input prompt',
          enum: ['auto', 'en', 'zh', 'zh-CN', 'zh-TW', 'hi', 'ja', 'ko', 'pt', 'es'],
          default: 'en',
          controlType: 'select',
        },
      },
    },
    pricing: {
      perImage: 0.06, // Updated per official pricing page (was $0.08)
      currency: 'USD',
    },
  },

  'imagen-4.0-fast-generate-001': {
    name: 'imagen-4.0-fast-generate-001',
    displayName: 'Imagen 4.0 Fast',
    provider: Vendor.Google,
    description: 'Google Imagen 4.0 Fast - optimized for speed',
    isActive: true,
    releaseDate: '2025-06-01',
    sources: {
      documentation: 'https://ai.google.dev/gemini-api/docs/imagen',
      pricing: 'https://ai.google.dev/pricing',
      lastVerified: '2026-03-04',
    },
    capabilities: {
      sizes: ['1024x1024'],
      aspectRatios: ['1:1', '3:4', '4:3', '9:16', '16:9'],
      maxImagesPerRequest: 4,
      outputFormats: ['png', 'jpeg'],
      features: {
        generation: true,
        editing: false,
        variations: false,
        styleControl: false,
        qualityControl: false,
        transparency: false,
        promptRevision: false,
      },
      limits: { maxPromptLength: 480 },
      vendorOptions: {
        aspectRatio: {
          type: 'enum',
          label: 'Aspect Ratio',
          description: 'Output image proportions',
          enum: ['1:1', '3:4', '4:3', '16:9', '9:16'],
          default: '1:1',
          controlType: 'select',
        },
        sampleImageSize: {
          type: 'enum',
          label: 'Resolution',
          description: 'Output image resolution',
          enum: ['1K', '2K'],
          default: '1K',
          controlType: 'radio',
        },
        outputMimeType: {
          type: 'enum',
          label: 'Output Format',
          description: 'Image file format',
          enum: ['image/png', 'image/jpeg'],
          default: 'image/png',
          controlType: 'select',
        },
        negativePrompt: {
          type: 'string',
          label: 'Negative Prompt',
          description: 'Elements to avoid in the generated image',
          controlType: 'textarea',
        },
        personGeneration: {
          type: 'enum',
          label: 'Person Generation',
          description: 'Controls whether people can appear in images',
          enum: ['dont_allow', 'allow_adult', 'allow_all'],
          default: 'allow_adult',
          controlType: 'select',
        },
        safetyFilterLevel: {
          type: 'enum',
          label: 'Safety Filter',
          description: 'Content safety filtering threshold',
          enum: ['block_none', 'block_only_high', 'block_medium_and_above', 'block_low_and_above'],
          default: 'block_medium_and_above',
          controlType: 'select',
        },
        enhancePrompt: {
          type: 'boolean',
          label: 'Enhance Prompt',
          description: 'Use LLM-based prompt rewriting for better quality',
          default: true,
          controlType: 'checkbox',
        },
        seed: {
          type: 'number',
          label: 'Seed',
          description: 'Random seed for reproducible generation (1-2147483647)',
          min: 1,
          max: 2147483647,
          controlType: 'text',
        },
        addWatermark: {
          type: 'boolean',
          label: 'Add Watermark',
          description: 'Add invisible SynthID watermark',
          default: true,
          controlType: 'checkbox',
        },
        language: {
          type: 'enum',
          label: 'Prompt Language',
          description: 'Language of the input prompt',
          enum: ['auto', 'en', 'zh', 'zh-CN', 'zh-TW', 'hi', 'ja', 'ko', 'pt', 'es'],
          default: 'en',
          controlType: 'select',
        },
      },
    },
    pricing: {
      perImage: 0.02,
      currency: 'USD',
    },
  },

  // ======================== Google Nano Banana (Gemini Native Image) ========================

  'gemini-3.1-flash-image-preview': {
    name: 'gemini-3.1-flash-image-preview',
    displayName: 'Nano Banana 2 (Gemini 3.1 Flash Image)',
    provider: Vendor.Google,
    description: 'High-efficiency native image generation and editing with 4K support and thinking capabilities',
    isActive: true,
    releaseDate: '2026-02-01',
    sources: {
      documentation: 'https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-image-preview',
      pricing: 'https://ai.google.dev/pricing',
      lastVerified: '2026-03-04',
    },
    capabilities: {
      sizes: ['512x512', '1024x1024', '1536x1536', 'auto'],
      aspectRatios: ['1:1', '1:4', '4:1', '1:8', '8:1'],
      maxImagesPerRequest: 4,
      outputFormats: ['png', 'jpeg'],
      features: {
        generation: true,
        editing: true,
        variations: false,
        styleControl: false,
        qualityControl: true, // Multiple resolution tiers: 0.5K, 1K, 2K, 4K
        transparency: false,
        promptRevision: false,
      },
      limits: { maxPromptLength: 131072 }, // 131K input tokens
      vendorOptions: {
        outputImageResolution: {
          type: 'enum',
          label: 'Resolution',
          description: 'Output image resolution tier',
          enum: ['0.5K', '1K', '2K', '4K'],
          default: '1K',
          controlType: 'select',
        },
      },
    },
    pricing: {
      // Per-image, varies by resolution: $0.045 (512px), $0.067 (1K), $0.101 (2K), $0.151 (4K)
      perImageStandard: 0.067, // 1K default
      perImageHD: 0.151, // 4K
      currency: 'USD',
    },
  },

  'gemini-3-pro-image-preview': {
    name: 'gemini-3-pro-image-preview',
    displayName: 'Nano Banana Pro (Gemini 3 Pro Image)',
    provider: Vendor.Google,
    description: 'Professional design engine with reasoning for studio-quality 4K visuals, complex layouts, and precise text rendering',
    isActive: true,
    releaseDate: '2025-11-01',
    sources: {
      documentation: 'https://ai.google.dev/gemini-api/docs/models/gemini-3-pro-image-preview',
      pricing: 'https://ai.google.dev/pricing',
      lastVerified: '2026-03-04',
    },
    capabilities: {
      sizes: ['1024x1024', 'auto'],
      aspectRatios: ['1:1', '3:4', '4:3', '9:16', '16:9'],
      maxImagesPerRequest: 4,
      outputFormats: ['png', 'jpeg'],
      features: {
        generation: true,
        editing: true,
        variations: false,
        styleControl: true, // Reasoning-driven design
        qualityControl: true, // 1K, 2K, 4K tiers
        transparency: false,
        promptRevision: false,
      },
      limits: { maxPromptLength: 65536 }, // 65K input tokens
      vendorOptions: {
        outputImageResolution: {
          type: 'enum',
          label: 'Resolution',
          description: 'Output image resolution tier',
          enum: ['1K', '2K', '4K'],
          default: '1K',
          controlType: 'select',
        },
      },
    },
    pricing: {
      // $0.134 per 1K/2K image, $0.24 per 4K image
      perImageStandard: 0.134, // 1K/2K
      perImageHD: 0.24, // 4K
      currency: 'USD',
    },
  },

  'gemini-2.5-flash-image': {
    name: 'gemini-2.5-flash-image',
    displayName: 'Nano Banana (Gemini 2.5 Flash Image)',
    provider: Vendor.Google,
    description: 'Native image generation and editing designed for fast, creative workflows',
    isActive: true,
    releaseDate: '2025-10-01',
    sources: {
      documentation: 'https://ai.google.dev/gemini-api/docs/models/gemini-2.5-flash-image',
      pricing: 'https://ai.google.dev/pricing',
      lastVerified: '2026-03-04',
    },
    capabilities: {
      sizes: ['1024x1024', 'auto'],
      aspectRatios: ['1:1', '3:4', '4:3', '9:16', '16:9'],
      maxImagesPerRequest: 4,
      outputFormats: ['png', 'jpeg'],
      features: {
        generation: true,
        editing: true,
        variations: false,
        styleControl: false,
        qualityControl: false,
        transparency: false,
        promptRevision: false,
      },
      limits: { maxPromptLength: 65536 }, // 65K input tokens
    },
    pricing: {
      perImage: 0.039, // $0.039 per image
      currency: 'USD',
    },
  },

  // ======================== xAI Grok ========================

  'grok-imagine-image': {
    name: 'grok-imagine-image',
    displayName: 'Grok Imagine Image',
    provider: Vendor.Grok,
    description: 'xAI Grok Imagine image generation with aspect ratio control and editing support',
    isActive: true,
    releaseDate: '2025-01-01',
    sources: {
      documentation: 'https://docs.x.ai/docs/guides/image-generation',
      pricing: 'https://docs.x.ai/docs/models',
      lastVerified: '2026-03-04',
    },
    capabilities: {
      sizes: ['1024x1024'],
      aspectRatios: ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '2:1', '1:2'],
      maxImagesPerRequest: 10,
      outputFormats: ['png', 'jpeg'],
      features: {
        generation: true,
        editing: true,
        variations: false,
        styleControl: false,
        qualityControl: false, // quality not supported by xAI API
        transparency: false,
        promptRevision: true,
      },
      limits: { maxPromptLength: 4096 },
      vendorOptions: {
        n: {
          type: 'number',
          label: 'Number of Images',
          description: 'Number of images to generate (1-10)',
          min: 1,
          max: 10,
          default: 1,
          controlType: 'slider',
        },
        response_format: {
          type: 'enum',
          label: 'Response Format',
          description: 'Format of the returned image',
          enum: ['url', 'b64_json'],
          default: 'url',
          controlType: 'radio',
        },
      },
    },
    pricing: {
      perImage: 0.02,
      currency: 'USD',
    },
  },

  'grok-2-image-1212': {
    name: 'grok-2-image-1212',
    displayName: 'Grok 2 Image',
    provider: Vendor.Grok,
    description: 'xAI Grok 2 image generation (text-only input, no editing)',
    isActive: true,
    releaseDate: '2024-12-12',
    sources: {
      documentation: 'https://docs.x.ai/docs/guides/image-generation',
      pricing: 'https://docs.x.ai/docs/models',
      lastVerified: '2026-02-01',
    },
    capabilities: {
      sizes: ['1024x1024'],
      aspectRatios: ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3'],
      maxImagesPerRequest: 10,
      outputFormats: ['png', 'jpeg'],
      features: {
        generation: true,
        editing: false,
        variations: false,
        styleControl: false,
        qualityControl: false, // quality not supported by xAI API
        transparency: false,
        promptRevision: false,
      },
      limits: { maxPromptLength: 4096 },
      vendorOptions: {
        n: {
          type: 'number',
          label: 'Number of Images',
          description: 'Number of images to generate (1-10)',
          min: 1,
          max: 10,
          default: 1,
          controlType: 'slider',
        },
        response_format: {
          type: 'enum',
          label: 'Response Format',
          description: 'Format of the returned image',
          enum: ['url', 'b64_json'],
          default: 'url',
          controlType: 'radio',
        },
      },
    },
    pricing: {
      perImage: 0.07,
      currency: 'USD',
    },
  },
};

// =============================================================================
// Helper Functions (using shared utilities)
// =============================================================================

const helpers = createRegistryHelpers(IMAGE_MODEL_REGISTRY);

export const getImageModelInfo = helpers.getInfo;
export const getImageModelsByVendor = helpers.getByVendor;
export const getActiveImageModels = helpers.getActive;

/**
 * Get image models that support a specific feature
 */
export function getImageModelsWithFeature(
  feature: keyof IImageModelDescription['capabilities']['features']
): IImageModelDescription[] {
  return Object.values(IMAGE_MODEL_REGISTRY).filter(
    (model) => model.isActive && model.capabilities.features[feature]
  );
}

/**
 * Calculate estimated cost for image generation
 */
export function calculateImageCost(
  modelName: string,
  imageCount: number,
  quality: 'standard' | 'hd' = 'standard'
): number | null {
  const model = getImageModelInfo(modelName);
  if (!model?.pricing) return null;

  if (model.pricing.perImage) {
    return imageCount * model.pricing.perImage;
  }

  const pricePerImage =
    quality === 'hd' ? model.pricing.perImageHD : model.pricing.perImageStandard;

  if (!pricePerImage) return null;
  return imageCount * pricePerImage;
}
