/**
 * Video Model Registry
 *
 * Comprehensive registry of video generation models with capabilities and pricing.
 * Models are organized by vendor and include detailed capability information.
 */

import { Vendor } from '../../core/Vendor.js';
import type { ISourceLinks, IBaseModelDescription } from '../types/SharedTypes.js';
import { assertNoRegistryAliasCollisions, createRegistryHelpers } from './RegistryUtils.js';

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
  /** Supports generation from only a text prompt. Defaults to true for legacy entries. */
  textToVideo?: boolean;
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
  /** Resolution-specific rates when the provider does not use a flat rate. */
  perSecondByResolution?: Readonly<Record<string, number>>;
  /** Discounted offline/batch rate when supported. */
  batchPerSecondByResolution?: Readonly<Record<string, number>>;
  /** Optional charge for an image-to-video reference image. */
  inputImage?: number;
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
    VEO_3_1_LITE: 'veo-3.1-lite-generate-preview',
    GEMINI_OMNI_FLASH: 'gemini-omni-flash-preview',
    GEMINI_OMNI_1_1_FLASH: 'gemini-omni-1.1-flash',
  },
  [Vendor.Grok]: {
    // xAI Grok Imagine video generation
    GROK_IMAGINE_VIDEO: 'grok-imagine-video',
    GROK_IMAGINE_VIDEO_1_5: 'grok-imagine-video-1.5',
  },
} as const;

/**
 * Common sources for model information
 */
const OPENAI_SOURCES: ISourceLinks = {
  documentation: 'https://developers.openai.com/api/docs/guides/video-generation',
  apiReference: 'https://developers.openai.com/api/reference/resources/videos',
  pricing: 'https://developers.openai.com/api/docs/pricing',
  lastVerified: '2026-08-30',
};

const GOOGLE_SOURCES: ISourceLinks = {
  documentation: 'https://ai.google.dev/gemini-api/docs/video',
  apiReference: 'https://ai.google.dev/gemini-api/docs/models/veo',
  lastVerified: '2026-08-30',
};

const GROK_SOURCES: ISourceLinks = {
  documentation: 'https://docs.x.ai/docs/guides/video-generations',
  apiReference: 'https://docs.x.ai/api',
  lastVerified: '2026-08-30',
};

/**
 * Video Model Registry
 */
export const VIDEO_MODEL_REGISTRY: VideoModelRegistry = {
  // ============================================================================
  // OpenAI Sora Models (callable until the Videos API shutdown on 2026-09-24)
  // ============================================================================

  'sora-2': {
    name: 'sora-2',
    displayName: 'Sora 2',
    provider: Vendor.OpenAI,
    description: 'Deprecated video generation model with synced audio; migrate before the Videos API shutdown',
    isActive: true,
    lifecycle: 'deprecated',
    availability: 'public',
    deprecationDate: '2026-03-24',
    retirementDate: '2026-09-24',
    endpoints: ['video_generation', 'video_edit', 'batch'],
    releaseDate: '2025-10-06',
    sources: OPENAI_SOURCES,
    capabilities: {
      durations: [4, 8, 12, 16, 20],
      resolutions: ['720x1280', '1280x720'],
      aspectRatios: ['9:16', '16:9'],
      maxFps: 30,
      audio: true,
      textToVideo: true,
      imageToVideo: true,
      videoExtension: true,
      frameControl: false,
      features: { upscaling: false, styleControl: false, negativePrompt: false, seed: true },
    },
    pricing: {
      perSecond: 0.10,
      perSecondByResolution: { '720p': 0.10, '720x1280': 0.10, '1280x720': 0.10 },
      batchPerSecondByResolution: { '720p': 0.05, '720x1280': 0.05, '1280x720': 0.05 },
      currency: 'USD',
    },
  },

  'sora-2-pro': {
    name: 'sora-2-pro',
    displayName: 'Sora 2 Pro',
    provider: Vendor.OpenAI,
    description: 'Deprecated high-resolution video generation model; migrate before the Videos API shutdown',
    isActive: true,
    lifecycle: 'deprecated',
    availability: 'public',
    deprecationDate: '2026-03-24',
    retirementDate: '2026-09-24',
    endpoints: ['video_generation', 'video_edit', 'batch'],
    releaseDate: '2025-10-06',
    sources: OPENAI_SOURCES,
    capabilities: {
      durations: [4, 8, 12, 16, 20],
      resolutions: ['720x1280', '1280x720', '1024x1792', '1792x1024', '1080x1920', '1920x1080'],
      aspectRatios: ['9:16', '16:9'],
      maxFps: 30,
      audio: true,
      textToVideo: true,
      imageToVideo: true,
      videoExtension: true,
      frameControl: true,
      features: { upscaling: true, styleControl: true, negativePrompt: false, seed: true },
    },
    pricing: {
      perSecond: 0.30,
      perSecondByResolution: {
        '720p': 0.30, '720x1280': 0.30, '1280x720': 0.30,
        '1024p': 0.50, '1024x1792': 0.50, '1792x1024': 0.50,
        '1080p': 0.70, '1080x1920': 0.70, '1920x1080': 0.70,
      },
      batchPerSecondByResolution: {
        '720p': 0.15, '720x1280': 0.15, '1280x720': 0.15,
        '1024p': 0.25, '1024x1792': 0.25, '1792x1024': 0.25,
        '1080p': 0.35, '1080x1920': 0.35, '1920x1080': 0.35,
      },
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
    isActive: false,
    lifecycle: 'retired',
    retirementDate: '2026-06-30',
    replacementModel: 'veo-3.1-lite-generate-preview',
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
      perSecond: 0.10,
      perSecondByResolution: { '720p': 0.10, '1080p': 0.12, '4k': 0.30 },
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
      perSecondByResolution: { '720p': 0.40, '1080p': 0.40, '4k': 0.60 },
      currency: 'USD',
    },
  },

  'veo-3.1-lite-generate-preview': {
    name: 'veo-3.1-lite-generate-preview',
    displayName: 'Veo 3.1 Lite',
    provider: Vendor.Google,
    description: 'Cost-efficient Veo 3.1 preview for short 720p and 1080p clips with native audio',
    isActive: true,
    lifecycle: 'preview',
    availability: 'public',
    preferred: true,
    endpoints: ['video_generation'],
    releaseDate: '2026-06-30',
    sources: { ...GOOGLE_SOURCES, lastVerified: '2026-08-30' },
    capabilities: {
      durations: [4, 6, 8],
      resolutions: ['720p', '1080p'],
      aspectRatios: ['16:9', '9:16'],
      maxFps: 24,
      audio: true,
      imageToVideo: true,
      videoExtension: false,
      frameControl: true,
      features: { upscaling: false, styleControl: false, negativePrompt: true, seed: true },
    },
    pricing: {
      perSecond: 0.05,
      perSecondByResolution: { '720p': 0.05, '1080p': 0.08 },
      currency: 'USD',
    },
  },

  'gemini-omni-flash-preview': {
    name: 'gemini-omni-flash-preview',
    displayName: 'Gemini Omni Flash',
    provider: Vendor.Google,
    description: 'Conversational 720p video generation and editing through the Interactions API',
    isActive: true,
    lifecycle: 'deprecated',
    availability: 'public',
    deprecationDate: '2026-08-27',
    retirementDate: '2026-09-30',
    replacementModel: 'gemini-omni-1.1-flash',
    endpoints: ['interactions', 'video_generation', 'video_edit'],
    releaseDate: '2026-06-30',
    sources: {
      documentation: 'https://ai.google.dev/gemini-api/docs/omni',
      apiReference: 'https://ai.google.dev/api/interactions-api',
      lastVerified: '2026-08-30',
    },
    capabilities: {
      durations: [3, 4, 5, 6, 7, 8, 9, 10],
      resolutions: ['720p'],
      aspectRatios: ['16:9', '9:16'],
      maxFps: 24,
      audio: true,
      imageToVideo: true,
      videoExtension: false,
      frameControl: false,
      features: { upscaling: false, styleControl: true, negativePrompt: false, seed: false },
    },
    pricing: { perSecond: 0.10, perSecondByResolution: { '720p': 0.10 }, currency: 'USD' },
  },

  'gemini-omni-1.1-flash': {
    name: 'gemini-omni-1.1-flash',
    displayName: 'Gemini Omni 1.1 Flash',
    provider: Vendor.Google,
    description: 'Generally available conversational video generation and editing through the Interactions API',
    isActive: true,
    lifecycle: 'active',
    availability: 'public',
    preferred: true,
    endpoints: ['interactions', 'video_generation', 'video_edit'],
    releaseDate: '2026-08-27',
    sources: {
      documentation: 'https://ai.google.dev/gemini-api/docs/models/gemini-omni-flash',
      apiReference: 'https://ai.google.dev/api/interactions-api',
      pricing: 'https://ai.google.dev/gemini-api/docs/pricing',
      lastVerified: '2026-08-30',
    },
    capabilities: {
      durations: [3, 4, 5, 6, 7, 8, 9, 10],
      resolutions: ['360p', '720p', '1080p', '4k'],
      aspectRatios: ['16:9', '9:16'],
      maxFps: 24,
      audio: true,
      textToVideo: true,
      imageToVideo: true,
      videoExtension: false,
      frameControl: false,
      features: { upscaling: true, styleControl: true, negativePrompt: false, seed: false },
    },
    pricing: { perSecond: 0.10, perSecondByResolution: { '720p': 0.10 }, currency: 'USD' },
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
      perSecondByResolution: { '480p': 0.05, '720p': 0.07 },
      currency: 'USD',
    },
  },

  'grok-imagine-video-1.5': {
    name: 'grok-imagine-video-1.5',
    displayName: 'Grok Imagine Video 1.5',
    provider: Vendor.Grok,
    description: 'Higher-fidelity xAI video generation with 480p, 720p, and 1080p output',
    isActive: true,
    lifecycle: 'active',
    availability: 'public',
    preferred: true,
    aliases: ['grok-imagine-video-1.5-preview'],
    snapshots: ['grok-imagine-video-1.5-2026-05-30'],
    endpoints: ['video_generation'],
    releaseDate: '2026-06-01',
    sources: {
      documentation: 'https://docs.x.ai/developers/models/grok-imagine-video-1.5',
      pricing: 'https://docs.x.ai/developers/models/grok-imagine-video-1.5',
      lastVerified: '2026-08-30',
    },
    capabilities: {
      durations: [1, 5, 8, 10, 15],
      resolutions: ['480p', '720p', '1080p'],
      aspectRatios: ['16:9', '4:3', '1:1', '9:16', '3:4', '3:2', '2:3'],
      maxFps: 24,
      audio: true,
      textToVideo: true,
      imageToVideo: true,
      videoExtension: false,
      frameControl: false,
      features: { upscaling: true, styleControl: true, negativePrompt: false, seed: true },
    },
    pricing: {
      perSecond: 0.08,
      perSecondByResolution: { '480p': 0.08, '720p': 0.14, '1080p': 0.25 },
      inputImage: 0.01,
      currency: 'USD',
    },
  },
};

// Create helper functions using the registry utility
assertNoRegistryAliasCollisions(VIDEO_MODEL_REGISTRY, 'VIDEO_MODEL_REGISTRY');
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
/** Get active video models with a published deprecation notice. */
export const getDeprecatedVideoModels = helpers.getDeprecated;

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
export function calculateVideoCost(
  modelName: string,
  durationSeconds: number,
  options?: { resolution?: string; batch?: boolean; inputImages?: number }
): number | null {
  const model = getVideoModelInfo(modelName);
  if (!model || !model.pricing) {
    return null;
  }
  const resolutionPricing = options?.batch
    ? model.pricing.batchPerSecondByResolution
    : model.pricing.perSecondByResolution;
  const perSecond = options?.resolution && resolutionPricing
    ? resolutionPricing[options.resolution]
    : model.pricing.perSecond;
  if (perSecond === undefined) return null;
  return perSecond * durationSeconds
    + (options?.inputImages ?? 0) * (model.pricing.inputImage ?? 0);
}
