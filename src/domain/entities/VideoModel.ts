/**
 * Video Model Registry
 *
 * Comprehensive registry of video generation models with capabilities and pricing.
 * Models are organized by vendor and include detailed capability information.
 */

import { Vendor } from '../../core/Vendor.js';
import type { ISourceLinks, IBaseModelDescription } from '../types/SharedTypes.js';
import { createRegistryHelpers } from './RegistryUtils.js';

/**
 * Video model capabilities
 */
export interface VideoModelCapabilities {
  /** Supported durations in seconds */
  durations: number[];
  /** Supported resolutions (e.g., '720p', '1080p', '720x1280') */
  resolutions: string[];
  /** Supported aspect ratios (e.g., '16:9', '9:16') - for vendors that use this instead of resolution */
  aspectRatios?: string[];
  /** Maximum frames per second */
  maxFps: number;
  /** Whether the model supports audio generation */
  audio: boolean;
  /** Whether the model supports image-to-video */
  imageToVideo: boolean;
  /** Whether the model supports video extension */
  videoExtension: boolean;
  /** Whether the model supports first/last frame specification */
  frameControl: boolean;
  /** Additional features */
  features: {
    /** Supports upscaling output */
    upscaling: boolean;
    /** Supports style/mood control */
    styleControl: boolean;
    /** Supports negative prompts */
    negativePrompt: boolean;
    /** Supports seed for reproducibility */
    seed: boolean;
  };
}

/**
 * Video model pricing
 */
export interface VideoModelPricing {
  /** Cost per second of generated video */
  perSecond: number;
  /** Currency */
  currency: string;
}

/**
 * Video model description
 */
export interface IVideoModelDescription extends IBaseModelDescription {
  capabilities: VideoModelCapabilities;
  pricing?: VideoModelPricing;
}

/**
 * Video model registry type
 */
type VideoModelRegistry = Record<string, IVideoModelDescription>;

/**
 * Model constants organized by vendor
 */
export const VIDEO_MODELS = {
  [Vendor.OpenAI]: {
    SORA_2: 'sora-2',
    SORA_2_PRO: 'sora-2-pro',
  },
  [Vendor.Google]: {
    // Gemini API (ai.google.dev) model names - use with API key
    VEO_2: 'veo-2.0-generate-001',
    VEO_3_1_FAST: 'veo-3.1-fast-generate-preview',
    VEO_3_1: 'veo-3.1-generate-preview',
  },
  [Vendor.Grok]: {
    // xAI Grok Imagine video generation
    GROK_IMAGINE_VIDEO: 'grok-imagine-video',
  },
} as const;

/**
 * Common sources for model information
 */
const OPENAI_SOURCES: ISourceLinks = {
  documentation: 'https://platform.openai.com/docs/guides/video-generation',
  apiReference: 'https://platform.openai.com/docs/api-reference/videos',
  lastVerified: '2026-01-25',
};

const GOOGLE_SOURCES: ISourceLinks = {
  documentation: 'https://ai.google.dev/gemini-api/docs/video',
  apiReference: 'https://ai.google.dev/gemini-api/docs/models/veo',
  lastVerified: '2026-03-04',
};

const GROK_SOURCES: ISourceLinks = {
  documentation: 'https://docs.x.ai/docs/guides/video-generations',
  apiReference: 'https://docs.x.ai/api',
  lastVerified: '2026-01-31',
};

/**
 * Video Model Registry
 */
export const VIDEO_MODEL_REGISTRY: VideoModelRegistry = {
  // ============================================================================
  // OpenAI Sora Models
  // ============================================================================

  'sora-2': {
    name: 'sora-2',
    displayName: 'Sora 2',
    provider: Vendor.OpenAI,
    description: 'Flagship video generation with synced audio. Extensions up to 120s total',
    isActive: true,
    releaseDate: '2025-10-06',
    sources: OPENAI_SOURCES,
    capabilities: {
      durations: [4, 8, 12, 16, 20],
      resolutions: ['720x1280', '1280x720'],
      aspectRatios: ['9:16', '16:9'],
      maxFps: 30,
      audio: true,
      imageToVideo: true,
      videoExtension: true, // Up to 6 extensions, max 120s total
      frameControl: false,
      features: {
        upscaling: false,
        styleControl: false,
        negativePrompt: false,
        seed: true,
      },
    },
    pricing: {
      perSecond: 0.10, // $0.05/sec batch API
      currency: 'USD',
    },
  },

  'sora-2-pro': {
    name: 'sora-2-pro',
    displayName: 'Sora 2 Pro',
    provider: Vendor.OpenAI,
    description: 'Most advanced synced-audio video generation. Up to 1080p, extensions up to 120s',
    isActive: true,
    releaseDate: '2025-10-06',
    sources: OPENAI_SOURCES,
    capabilities: {
      durations: [4, 8, 12, 16, 20],
      resolutions: ['720x1280', '1280x720', '1024x1792', '1792x1024', '1080x1920', '1920x1080'],
      aspectRatios: ['9:16', '16:9'],
      maxFps: 30,
      audio: true,
      imageToVideo: true,
      videoExtension: true, // Up to 6 extensions, max 120s total
      frameControl: true,
      features: {
        upscaling: true,
        styleControl: true,
        negativePrompt: false,
        seed: true,
      },
    },
    pricing: {
      perSecond: 0.30, // 720p base; $0.50/sec at 1024x, $0.70/sec at 1080p
      currency: 'USD',
    },
  },

  // ============================================================================
  // Google Veo Models
  // ============================================================================

  'veo-2.0-generate-001': {
    name: 'veo-2.0-generate-001',
    displayName: 'Veo 2.0',
    provider: Vendor.Google,
    isActive: true,
    sources: GOOGLE_SOURCES,
    capabilities: {
      durations: [5, 6, 7, 8],
      resolutions: ['720p'], // Veo 2 only supports 720p
      aspectRatios: ['16:9', '9:16'],
      maxFps: 24,
      audio: false,
      imageToVideo: false, // Veo 2 does not support reference images
      videoExtension: false,
      frameControl: true, // First/last frame interpolation supported
      features: {
        upscaling: false,
        styleControl: false,
        negativePrompt: true,
        seed: true,
      },
    },
    pricing: {
      perSecond: 0.35, // Updated per official pricing page (was $0.03)
      currency: 'USD',
    },
  },

  'veo-3.1-fast-generate-preview': {
    name: 'veo-3.1-fast-generate-preview',
    displayName: 'Veo 3.1 Fast',
    provider: Vendor.Google,
    isActive: true,
    sources: GOOGLE_SOURCES,
    capabilities: {
      durations: [4, 6, 8],
      resolutions: ['720p', '1080p', '4k'], // 1080p/4k require 8s duration
      aspectRatios: ['16:9', '9:16'],
      maxFps: 24,
      audio: true, // Native audio generation
      imageToVideo: true, // Up to 3 reference images
      videoExtension: true, // Supported (720p only)
      frameControl: true, // First/last frame interpolation
      features: {
        upscaling: false,
        styleControl: false,
        negativePrompt: true,
        seed: true,
      },
    },
    pricing: {
      perSecond: 0.15, // $0.15 for 720p/1080p, $0.35 for 4K
      currency: 'USD',
    },
  },

  'veo-3.1-generate-preview': {
    name: 'veo-3.1-generate-preview',
    displayName: 'Veo 3.1',
    provider: Vendor.Google,
    isActive: true,
    sources: GOOGLE_SOURCES,
    capabilities: {
      durations: [4, 6, 8],
      resolutions: ['720p', '1080p', '4k'], // 1080p and 4k require 8s duration
      aspectRatios: ['16:9', '9:16'],
      maxFps: 30,
      audio: true, // Native audio generation
      imageToVideo: true, // Up to 3 reference images
      videoExtension: true, // Supported (720p only)
      frameControl: true,
      features: {
        upscaling: true,
        styleControl: true,
        negativePrompt: true,
        seed: true,
      },
    },
    pricing: {
      perSecond: 0.40, // $0.40 for 720p/1080p, $0.60 for 4K
      currency: 'USD',
    },
  },

  // ============================================================================
  // xAI Grok Imagine Models
  // ============================================================================

  'grok-imagine-video': {
    name: 'grok-imagine-video',
    displayName: 'Grok Imagine Video',
    provider: Vendor.Grok,
    isActive: true,
    sources: GROK_SOURCES,
    capabilities: {
      durations: [1, 5, 8, 10, 15],
      resolutions: ['480p', '720p'],
      aspectRatios: ['16:9', '4:3', '1:1', '9:16', '3:4', '3:2', '2:3'],
      maxFps: 24,
      audio: true,
      imageToVideo: true,
      videoExtension: false,
      frameControl: false,
      features: {
        upscaling: false,
        styleControl: false,
        negativePrompt: false,
        seed: true,
      },
    },
    pricing: {
      perSecond: 0.05,
      currency: 'USD',
    },
  },
};

// Create helper functions using the registry utility
const helpers = createRegistryHelpers<IVideoModelDescription>(VIDEO_MODEL_REGISTRY);

/**
 * Get model information by name
 */
export const getVideoModelInfo = helpers.getInfo;

/**
 * Get all models for a specific vendor
 */
export const getVideoModelsByVendor = helpers.getByVendor;

/**
 * Get all currently active models
 */
export const getActiveVideoModels = helpers.getActive;

/**
 * Get models with a specific feature
 */
export function getVideoModelsWithFeature(feature: keyof VideoModelCapabilities['features']): IVideoModelDescription[] {
  return Object.values(VIDEO_MODEL_REGISTRY).filter(
    (model) => model.isActive && model.capabilities.features[feature]
  );
}

/**
 * Get models that support audio
 */
export function getVideoModelsWithAudio(): IVideoModelDescription[] {
  return Object.values(VIDEO_MODEL_REGISTRY).filter((model) => model.isActive && model.capabilities.audio);
}

/**
 * Calculate video generation cost
 */
export function calculateVideoCost(modelName: string, durationSeconds: number): number | null {
  const model = VIDEO_MODEL_REGISTRY[modelName];
  if (!model || !model.pricing) {
    return null;
  }

  return model.pricing.perSecond * durationSeconds;
}
