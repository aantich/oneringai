# Multi-Modal Architecture Design

This is a historical design proposal. For current public classes, model lifecycle,
and supported operations use the [User Guide](USER_GUIDE.md).

## Executive Summary

This document proposes a comprehensive architecture for extending `oneringai` to support multiple modalities beyond text generation: **Image Generation**, **Video Generation**, **Text-to-Speech (TTS)**, and **Speech-to-Text (STT)**.

The design follows Clean Architecture principles, maintains backward compatibility, and leverages existing patterns in the codebase.

---

## Table of Contents

1. [Current State Analysis](#current-state-analysis)
2. [Architecture Decision](#architecture-decision)
3. [Shared Foundations](#shared-foundations)
4. [Domain Interfaces](#domain-interfaces)
5. [Model Registries](#model-registries)
6. [Capability Classes](#capability-classes)
7. [Vendor Capabilities Matrix](#vendor-capabilities-matrix)
8. [Validation Layer](#validation-layer)
9. [File Structure](#file-structure)
10. [Implementation Phases](#implementation-phases)

---

## Current State Analysis

### What We Already Have

```typescript
// IProvider.ts - Already anticipates multi-modal!
export interface ProviderCapabilities {
  text: boolean;
  images: boolean;   // Already defined
  videos: boolean;   // Already defined
  audio: boolean;    // Already defined
}
```

**Existing Patterns:**
1. Interface per capability
2. Base class with shared functionality (circuit breaker, logging, metrics)
3. Factory function for provider creation
4. Connector as single auth source
5. Lazy observability initialization
6. Model registry with comprehensive metadata

---

## Architecture Decision

### Option B: Separate Capability Classes ✅ (Recommended)

```typescript
const textAgent = Agent.create({ connector, model });
const imageGen = ImageGenerator.create({ connector, model });
const videoGen = VideoGenerator.create({ connector, model });
const tts = TextToSpeech.create({ connector, model });
const stt = SpeechToText.create({ connector, model });
```

**Benefits:**
- Single responsibility - each class does one thing well
- Tree-shakeable - only import what you use
- Vendor-appropriate - easy to check if vendor supports capability
- Simpler types - each class has specific response types
- Testable - mock only what you need

---

## Shared Foundations

### Core Principle: DRY Through Abstraction

All model registries and capability classes share common patterns. We extract these into reusable foundations.

### 1. Base Types (`src/domain/types/SharedTypes.ts`)

```typescript
// =============================================================================
// Shared Semantic Types - Used across all modalities
// =============================================================================

import type { Vendor as VendorType } from '../../core/Vendor.js';

/**
 * Aspect ratios - normalized across all visual modalities
 */
export type AspectRatio = '1:1' | '16:9' | '9:16' | '4:3' | '3:4' | '21:9' | '3:2' | '2:3';

/**
 * Quality levels - normalized across vendors
 */
export type QualityLevel = 'draft' | 'standard' | 'high' | 'ultra';

/**
 * Audio output formats
 */
export type AudioFormat = 'mp3' | 'opus' | 'aac' | 'flac' | 'wav' | 'pcm' | 'ogg';

/**
 * Output format preference
 */
export type OutputFormat = 'url' | 'base64' | 'buffer';

/**
 * Source links for model documentation/maintenance
 */
export interface ISourceLinks {
  /** Official documentation URL */
  documentation: string;
  /** Pricing page URL */
  pricing?: string;
  /** API reference URL */
  apiReference?: string;
  /** Last verified date (YYYY-MM-DD) */
  lastVerified: string;
}

/**
 * Vendor-specific option schema (for validation/documentation)
 */
export interface VendorOptionSchema {
  type: 'string' | 'number' | 'boolean' | 'enum' | 'array';
  description: string;
  required?: boolean;
  enum?: string[];
  min?: number;
  max?: number;
  default?: unknown;
}

/**
 * Base model description - shared by all registries
 */
export interface IBaseModelDescription {
  /** Model identifier (e.g., "dall-e-3") */
  name: string;

  /** Display name for UI */
  displayName: string;

  /** Vendor/provider */
  provider: VendorType;

  /** Model description */
  description?: string;

  /** Whether the model is currently available */
  isActive: boolean;

  /** Release date (YYYY-MM-DD) */
  releaseDate?: string;

  /** Deprecation date if scheduled */
  deprecationDate?: string;

  /** Documentation/pricing links for maintenance */
  sources: ISourceLinks;
}
```

### 2. Registry Utilities (`src/domain/entities/RegistryUtils.ts`)

```typescript
// =============================================================================
// Generic Registry Utilities - DRY helper factory
// =============================================================================

import type { Vendor as VendorType } from '../../core/Vendor.js';
import type { IBaseModelDescription } from '../types/SharedTypes.js';

/**
 * Creates standard helper functions for any model registry
 * Eliminates code duplication across Image, TTS, STT, Video registries
 */
export function createRegistryHelpers<T extends IBaseModelDescription>(
  registry: Record<string, T>
) {
  return {
    /**
     * Get model information by name
     */
    getInfo: (modelName: string): T | undefined => registry[modelName],

    /**
     * Get all models for a specific vendor
     */
    getByVendor: (vendor: VendorType): T[] =>
      Object.values(registry).filter((m) => m.provider === vendor && m.isActive),

    /**
     * Get all currently active models
     */
    getActive: (): T[] =>
      Object.values(registry).filter((m) => m.isActive),

    /**
     * Get all models (including inactive)
     */
    getAll: (): T[] => Object.values(registry),

    /**
     * Check if model exists
     */
    has: (modelName: string): boolean => modelName in registry,
  };
}

/**
 * Creates feature-based filter for registries with capabilities
 */
export function createCapabilityFilter<
  T extends IBaseModelDescription & { capabilities: Record<string, unknown> }
>(registry: Record<string, T>) {
  return {
    /**
     * Get models that support a specific feature
     */
    withFeature: <K extends keyof T['capabilities']>(
      feature: K,
      value?: T['capabilities'][K]
    ): T[] =>
      Object.values(registry).filter((m) => {
        if (!m.isActive) return false;
        const capValue = m.capabilities[feature];
        if (value !== undefined) return capValue === value;
        return Array.isArray(capValue) ? capValue.length > 0 : Boolean(capValue);
      }),
  };
}
```

### 3. Shared Voice Data (`src/domain/entities/SharedVoices.ts`)

```typescript
// =============================================================================
// Shared Voice Definitions - Eliminates duplication across TTS models
// =============================================================================

import type { IVoiceInfo } from './TTSModel.js';

/**
 * OpenAI TTS voices (shared across tts-1, tts-1-hd, gpt-4o-mini-tts)
 * Source: https://platform.openai.com/docs/guides/text-to-speech
 * Last verified: 2026-01-24
 */
export const OPENAI_VOICES: IVoiceInfo[] = [
  { id: 'alloy', name: 'Alloy', language: 'multi', gender: 'neutral', isDefault: true },
  { id: 'ash', name: 'Ash', language: 'multi', gender: 'male' },
  { id: 'ballad', name: 'Ballad', language: 'multi', gender: 'male' },
  { id: 'coral', name: 'Coral', language: 'multi', gender: 'female' },
  { id: 'echo', name: 'Echo', language: 'multi', gender: 'male' },
  { id: 'fable', name: 'Fable', language: 'multi', gender: 'neutral', accent: 'british' },
  { id: 'nova', name: 'Nova', language: 'multi', gender: 'female' },
  { id: 'onyx', name: 'Onyx', language: 'multi', gender: 'male' },
  { id: 'sage', name: 'Sage', language: 'multi', gender: 'female' },
  { id: 'shimmer', name: 'Shimmer', language: 'multi', gender: 'female' },
  { id: 'verse', name: 'Verse', language: 'multi', gender: 'neutral' },
  { id: 'marin', name: 'Marin', language: 'multi', gender: 'female' },
  { id: 'cedar', name: 'Cedar', language: 'multi', gender: 'male' },
];

/**
 * Google Gemini TTS voices
 * Source: https://ai.google.dev/gemini-api/docs/text-to-speech
 */
export const GEMINI_VOICES: IVoiceInfo[] = [
  { id: 'Puck', name: 'Puck', language: 'multi', gender: 'neutral', isDefault: true },
  { id: 'Charon', name: 'Charon', language: 'multi', gender: 'male' },
  { id: 'Kore', name: 'Kore', language: 'multi', gender: 'female' },
  { id: 'Fenrir', name: 'Fenrir', language: 'multi', gender: 'male' },
  { id: 'Aoede', name: 'Aoede', language: 'multi', gender: 'female' },
];

/**
 * Common language codes supported by multiple vendors
 */
export const COMMON_LANGUAGES = {
  /** Languages supported by OpenAI TTS (50+) */
  OPENAI_TTS: [
    'en', 'es', 'fr', 'de', 'it', 'pt', 'pl', 'ru', 'ja', 'ko', 'zh', 'ar', 'hi',
    'nl', 'sv', 'tr', 'af', 'hy', 'az', 'be', 'bs', 'bg', 'ca', 'hr', 'cs', 'da',
    'et', 'fi', 'gl', 'el', 'he', 'hu', 'is', 'id', 'lv', 'lt', 'mk', 'ms', 'mi',
    'ne', 'no', 'fa', 'ro', 'sr', 'sk', 'sl', 'sw', 'tl', 'ta', 'th', 'uk', 'ur',
    'vi', 'cy',
  ],

  /** Core languages (most vendors support these) */
  CORE: ['en', 'es', 'fr', 'de', 'it', 'pt', 'ja', 'ko', 'zh', 'ru', 'ar', 'hi'],

  /** ElevenLabs supported languages */
  ELEVENLABS: [
    'en', 'es', 'fr', 'de', 'it', 'pt', 'pl', 'ru', 'ja', 'ko', 'zh', 'ar', 'hi',
    'nl', 'sv', 'tr', 'cs', 'da', 'fi', 'el', 'he', 'hu', 'id', 'ms', 'no', 'ro',
    'sk', 'th', 'uk', 'vi',
  ],
};

/**
 * Common audio formats
 */
export const AUDIO_FORMATS = {
  /** OpenAI TTS output formats */
  OPENAI_TTS: ['mp3', 'opus', 'aac', 'flac', 'wav', 'pcm'] as const,

  /** ElevenLabs output formats */
  ELEVENLABS: ['mp3', 'pcm', 'ogg', 'wav'] as const,

  /** Common STT input formats */
  STT_INPUT: ['mp3', 'mp4', 'mpeg', 'mpga', 'm4a', 'wav', 'webm', 'flac', 'ogg'] as const,
};
```

### 4. Base Provider Class (`src/infrastructure/providers/base/BaseMediaProvider.ts`)

```typescript
// =============================================================================
// Base Media Provider - Shared functionality for all media providers
// =============================================================================

import { Logger } from '../../observability/Logger.js';
import { CircuitBreaker } from '../../resilience/CircuitBreaker.js';
import { MetricsCollector } from '../../observability/MetricsCollector.js';
import type { IProvider, ProviderCapabilities, ProviderConfig } from '../../../domain/interfaces/IProvider.js';

/**
 * Base class for all media providers (Image, Audio, Video)
 * Provides shared functionality: circuit breaker, logging, metrics
 */
export abstract class BaseMediaProvider implements IProvider {
  abstract readonly name: string;
  protected readonly logger: Logger;
  protected readonly circuitBreaker: CircuitBreaker;
  protected readonly metrics: MetricsCollector;
  protected readonly config: ProviderConfig;

  constructor(config: ProviderConfig) {
    this.config = config;
    this.logger = new Logger({ component: this.constructor.name });
    this.circuitBreaker = new CircuitBreaker({
      failureThreshold: config.circuitBreaker?.failureThreshold ?? 5,
      resetTimeout: config.circuitBreaker?.resetTimeout ?? 30000,
    });
    this.metrics = new MetricsCollector();
  }

  abstract get capabilities(): ProviderCapabilities;

  /**
   * Execute operation with circuit breaker protection
   */
  protected async executeWithCircuitBreaker<T>(
    operation: () => Promise<T>,
    operationName: string
  ): Promise<T> {
    const startTime = Date.now();

    try {
      const result = await this.circuitBreaker.execute(operation);
      this.metrics.recordLatency(operationName, Date.now() - startTime);
      this.metrics.recordSuccess(operationName);
      return result;
    } catch (error) {
      this.metrics.recordError(operationName, error);
      this.logger.error({ error, operation: operationName }, 'Operation failed');
      throw error;
    }
  }

  /**
   * Log operation with context
   */
  protected logOperation(operation: string, context: Record<string, unknown>): void {
    this.logger.info({ operation, ...context }, `${operation} started`);
  }
}
```

---

## Domain Interfaces

### 1. Extended Provider Capabilities

```typescript
// src/domain/interfaces/IProvider.ts (extended)

export interface ProviderCapabilities {
  // Existing
  text: boolean;
  images: boolean;
  videos: boolean;
  audio: boolean;

  // Granular capabilities
  features: {
    // Image capabilities
    imageGeneration?: boolean;
    imageEdit?: boolean;
    imageVariation?: boolean;
    imageAnalysis?: boolean;

    // Audio capabilities
    textToSpeech?: boolean;
    speechToText?: boolean;
    audioStreaming?: boolean;

    // Video capabilities
    videoGeneration?: boolean;
    videoAnalysis?: boolean;
  };
}
```

### 2. Audio Interfaces (`src/domain/interfaces/IAudioProvider.ts`)

```typescript
import type { IProvider } from './IProvider.js';
import type { AudioFormat, VendorOptionSchema } from '../types/SharedTypes.js';
import type { IVoiceInfo } from '../entities/TTSModel.js';

// =============================================================================
// Text-to-Speech
// =============================================================================

export interface TTSOptions {
  model: string;
  input: string;
  voice: string;
  format?: AudioFormat;
  speed?: number;
  /** Vendor-specific options passthrough */
  vendorOptions?: Record<string, unknown>;
}

export interface TTSResponse {
  audio: Buffer;
  format: AudioFormat;
  durationSeconds?: number;
  charactersUsed?: number;
}

export interface TTSStreamEvent {
  type: 'audio_chunk' | 'complete' | 'error';
  chunk?: Buffer;
  error?: Error;
}

export interface ITextToSpeechProvider extends IProvider {
  synthesize(options: TTSOptions): Promise<TTSResponse>;
  synthesizeStream?(options: TTSOptions): AsyncIterableIterator<TTSStreamEvent>;
  listVoices?(): Promise<IVoiceInfo[]>;
}

// =============================================================================
// Speech-to-Text
// =============================================================================

export interface STTOptions {
  model: string;
  audio: Buffer | string;
  language?: string;
  outputFormat?: 'json' | 'text' | 'srt' | 'vtt' | 'verbose_json';
  includeTimestamps?: boolean;
  timestampGranularity?: 'word' | 'segment';
  vendorOptions?: Record<string, unknown>;
}

export interface STTResponse {
  text: string;
  language?: string;
  durationSeconds?: number;
  words?: Array<{ word: string; start: number; end: number }>;
  segments?: Array<{ id: number; text: string; start: number; end: number }>;
}

export interface ISpeechToTextProvider extends IProvider {
  transcribe(options: STTOptions): Promise<STTResponse>;
  translate?(options: STTOptions): Promise<STTResponse>;
}
```

### 3. Image Interface (`src/domain/interfaces/IImageProvider.ts`)

```typescript
import type { IProvider } from './IProvider.js';
import type { AspectRatio, QualityLevel, OutputFormat } from '../types/SharedTypes.js';

export type ImageStyle = 'natural' | 'artistic' | 'photographic' | 'cinematic' | 'anime' | '3d-render' | 'digital-art';

export interface ImageGenerateOptions {
  model: string;
  prompt: string;
  negativePrompt?: string;
  aspectRatio?: AspectRatio;
  quality?: QualityLevel;
  style?: ImageStyle;
  count?: number;
  seed?: number;
  outputFormat?: OutputFormat;
  vendorOptions?: Record<string, unknown>;
}

export interface ImageEditOptions extends ImageGenerateOptions {
  image: Buffer | string;
  mask?: Buffer | string;
}

export interface ImageResponse {
  images: Array<{
    url?: string;
    base64?: string;
    buffer?: Buffer;
    revisedPrompt?: string;
  }>;
  model: string;
  created: number;
}

export interface IImageProvider extends IProvider {
  generateImage(options: ImageGenerateOptions): Promise<ImageResponse>;
  editImage?(options: ImageEditOptions): Promise<ImageResponse>;
  createVariation?(options: { model: string; image: Buffer | string; count?: number }): Promise<ImageResponse>;
}
```

### 4. Video Interface (`src/domain/interfaces/IVideoProvider.ts`)

```typescript
import type { IProvider } from './IProvider.js';
import type { AspectRatio } from '../types/SharedTypes.js';

export type VideoResolution = '480p' | '720p' | '1080p' | '4k';
export type VideoStyle = 'realistic' | 'animated' | 'cinematic' | 'documentary' | 'artistic' | '3d';

export interface VideoGenerateOptions {
  model: string;
  prompt: string;
  negativePrompt?: string;
  aspectRatio?: AspectRatio;
  resolution?: VideoResolution;
  style?: VideoStyle;
  durationSeconds?: number;
  frameRate?: number;
  seed?: number;
  sourceImage?: Buffer | string;
  vendorOptions?: Record<string, unknown>;
}

export interface VideoResponse {
  id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  videoUrl?: string;
  videoData?: Buffer;
  thumbnailUrl?: string;
  durationSeconds?: number;
  resolution?: string;
  createdAt: number;
  error?: string;
}

export interface VideoProgressEvent {
  type: 'queued' | 'processing' | 'progress' | 'completed' | 'failed';
  progress?: number;
  estimatedTimeRemaining?: number;
  video?: VideoResponse;
  error?: Error;
}

export interface IVideoProvider extends IProvider {
  generateVideo(options: VideoGenerateOptions): Promise<VideoResponse>;
  generateVideoWithProgress?(options: VideoGenerateOptions): AsyncIterableIterator<VideoProgressEvent>;
  getVideoStatus?(id: string): Promise<VideoResponse>;
  cancelVideo?(id: string): Promise<void>;
}
```

---

## Model Registries

### Design Principles

1. **Single source of truth** - Each model defined once
2. **Consistent structure** - All registries extend `IBaseModelDescription`
3. **Shared utilities** - Use `createRegistryHelpers()` for common functions
4. **Centralized shared data** - Voices, languages, formats in one place

### 1. Image Model Registry (`src/domain/entities/ImageModel.ts`)

```typescript
import { Vendor } from '../../core/Vendor.js';
import type { Vendor as VendorType } from '../../core/Vendor.js';
import type { IBaseModelDescription, AspectRatio, QualityLevel, VendorOptionSchema } from '../types/SharedTypes.js';
import { createRegistryHelpers, createCapabilityFilter } from './RegistryUtils.js';
import type { ImageStyle } from '../interfaces/IImageProvider.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Input modality combinations for image generation
 */
export interface ImageInputModes {
  textToImage: boolean;
  imageToImage: boolean;
  inpainting: boolean;
  outpainting: boolean;
  variation: boolean;
  upscaling: boolean;
  controlledGeneration?: boolean;
}

/**
 * Image model capabilities
 */
export interface ImageModelCapabilities {
  inputModes: ImageInputModes;
  aspectRatios: AspectRatio[];
  qualities: QualityLevel[];
  styles: ImageStyle[];
  maxImagesPerRequest: number;
  maxPromptLength?: number;
  features: {
    negativePrompt: boolean;
    seed: boolean;
  };
  sizeConstraints?: {
    minWidth: number;
    maxWidth: number;
    minHeight: number;
    maxHeight: number;
    stepSize?: number;
  };
  vendorOptions?: Record<string, VendorOptionSchema>;
}

/**
 * Image model pricing
 */
export interface ImageModelPricing {
  perImage?: number;
  perMegapixel?: number;
  tiers?: Array<{ quality: QualityLevel; size: string; price: number }>;
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
    GPT_IMAGE_1_5: 'gpt-image-1.5',
    GPT_IMAGE_1: 'gpt-image-1',
    GPT_IMAGE_1_MINI: 'gpt-image-1-mini',
    /** @deprecated Shutting down 2026-05-12 */
    DALL_E_3: 'dall-e-3',
    /** @deprecated Shutting down 2026-05-12 */
    DALL_E_2: 'dall-e-2',
  },
  [Vendor.Google]: {
    IMAGEN_4: 'imagen-4.0-generate-preview-05-20',
    IMAGEN_4_ULTRA: 'imagen-4.0-ultra-generate-exp-05-20',
    IMAGEN_3: 'imagen-3.0-generate-002',
    IMAGEN_3_FAST: 'imagen-3.0-fast-generate-001',
  },
  [Vendor.Custom]: {
    SD_3_5_LARGE: 'stable-diffusion-3.5-large',
    SD_3_5_LARGE_TURBO: 'stable-diffusion-3.5-large-turbo',
    FLUX_1_1_PRO: 'flux-1.1-pro',
    FLUX_1_1_PRO_ULTRA: 'flux-1.1-pro-ultra',
    FLUX_1_SCHNELL: 'flux-1-schnell',
  },
} as const;

// =============================================================================
// Shared Capability Presets (DRY)
// =============================================================================

const TEXT_TO_IMAGE_ONLY: ImageInputModes = {
  textToImage: true,
  imageToImage: false,
  inpainting: false,
  outpainting: false,
  variation: false,
  upscaling: false,
};

const FULL_IMAGE_MODES: ImageInputModes = {
  textToImage: true,
  imageToImage: true,
  inpainting: true,
  outpainting: true,
  variation: true,
  upscaling: true,
  controlledGeneration: true,
};

// =============================================================================
// Registry
// =============================================================================

export const IMAGE_MODEL_REGISTRY: Record<string, IImageModelDescription> = {
  // ======================== OpenAI ========================

  'gpt-image-1.5': {
    name: 'gpt-image-1.5',
    displayName: 'GPT Image 1.5',
    provider: Vendor.OpenAI,
    description: 'Latest OpenAI image model with advanced editing and superior prompt following',
    isActive: true,
    releaseDate: '2025-09-01',
    sources: {
      documentation: 'https://platform.openai.com/docs/guides/images',
      pricing: 'https://openai.com/api/pricing/',
      lastVerified: '2026-01-24',
    },
    capabilities: {
      inputModes: FULL_IMAGE_MODES,
      aspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4'],
      qualities: ['standard', 'high', 'ultra'],
      styles: ['natural', 'artistic', 'photographic', 'cinematic'],
      maxImagesPerRequest: 4,
      maxPromptLength: 8000,
      features: { negativePrompt: false, seed: true },
    },
    pricing: { perImage: 0.08, currency: 'USD' },
  },

  'gpt-image-1': {
    name: 'gpt-image-1',
    displayName: 'GPT Image 1',
    provider: Vendor.OpenAI,
    description: 'OpenAI standard image generation with excellent quality',
    isActive: true,
    releaseDate: '2025-03-01',
    sources: {
      documentation: 'https://platform.openai.com/docs/guides/images',
      pricing: 'https://openai.com/api/pricing/',
      lastVerified: '2026-01-24',
    },
    capabilities: {
      inputModes: {
        ...FULL_IMAGE_MODES,
        outpainting: false,
        upscaling: false,
        controlledGeneration: false,
      },
      aspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4'],
      qualities: ['standard', 'high'],
      styles: ['natural', 'artistic', 'photographic'],
      maxImagesPerRequest: 4,
      maxPromptLength: 4000,
      features: { negativePrompt: false, seed: true },
    },
    pricing: { perImage: 0.04, currency: 'USD' },
  },

  'gpt-image-1-mini': {
    name: 'gpt-image-1-mini',
    displayName: 'GPT Image 1 Mini',
    provider: Vendor.OpenAI,
    description: 'Fast, cost-effective image generation',
    isActive: true,
    releaseDate: '2025-06-01',
    sources: {
      documentation: 'https://platform.openai.com/docs/guides/images',
      pricing: 'https://openai.com/api/pricing/',
      lastVerified: '2026-01-24',
    },
    capabilities: {
      inputModes: TEXT_TO_IMAGE_ONLY,
      aspectRatios: ['1:1', '16:9', '9:16'],
      qualities: ['standard'],
      styles: ['natural', 'artistic'],
      maxImagesPerRequest: 4,
      maxPromptLength: 2000,
      features: { negativePrompt: false, seed: true },
    },
    pricing: { perImage: 0.015, currency: 'USD' },
  },

  'dall-e-3': {
    name: 'dall-e-3',
    displayName: 'DALL-E 3',
    provider: Vendor.OpenAI,
    description: '⚠️ DEPRECATED: Shutting down 2026-05-12. Migrate to GPT Image models.',
    isActive: false,
    releaseDate: '2023-11-06',
    deprecationDate: '2026-05-12',
    sources: {
      documentation: 'https://platform.openai.com/docs/guides/images',
      pricing: 'https://openai.com/pricing',
      lastVerified: '2026-01-24',
    },
    capabilities: {
      inputModes: TEXT_TO_IMAGE_ONLY,
      aspectRatios: ['1:1', '16:9', '9:16'],
      qualities: ['standard', 'high'],
      styles: ['natural', 'artistic'],
      maxImagesPerRequest: 1,
      maxPromptLength: 4000,
      features: { negativePrompt: false, seed: false },
    },
    pricing: {
      tiers: [
        { quality: 'standard', size: '1024x1024', price: 0.040 },
        { quality: 'standard', size: '1792x1024', price: 0.080 },
        { quality: 'high', size: '1024x1024', price: 0.080 },
        { quality: 'high', size: '1792x1024', price: 0.120 },
      ],
      currency: 'USD',
    },
  },

  // ======================== Google ========================

  'imagen-3.0-generate-002': {
    name: 'imagen-3.0-generate-002',
    displayName: 'Imagen 3',
    provider: Vendor.Google,
    description: "Google's high-quality image generation model",
    isActive: true,
    releaseDate: '2024-08-01',
    sources: {
      documentation: 'https://cloud.google.com/vertex-ai/generative-ai/docs/image/overview',
      pricing: 'https://cloud.google.com/vertex-ai/generative-ai/pricing',
      lastVerified: '2026-01-24',
    },
    capabilities: {
      inputModes: {
        textToImage: true,
        imageToImage: true,
        inpainting: true,
        outpainting: true,
        variation: false,
        upscaling: true,
      },
      aspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3'],
      qualities: ['standard', 'high'],
      styles: ['natural', 'photographic', 'artistic'],
      maxImagesPerRequest: 4,
      features: { negativePrompt: true, seed: true },
      vendorOptions: {
        personGeneration: {
          type: 'enum',
          description: 'Control generation of people in images',
          enum: ['dont_allow', 'allow_adult', 'allow_all'],
          default: 'allow_adult',
        },
        safetyFilterLevel: {
          type: 'enum',
          description: 'Safety filter strictness',
          enum: ['block_low_and_above', 'block_medium_and_above', 'block_only_high'],
          default: 'block_medium_and_above',
        },
      },
    },
    pricing: { perImage: 0.040, currency: 'USD' },
  },

  // ======================== Stability AI ========================

  'stable-diffusion-3.5-large': {
    name: 'stable-diffusion-3.5-large',
    displayName: 'Stable Diffusion 3.5 Large',
    provider: Vendor.Custom,
    description: "Stability AI's flagship model with excellent prompt adherence",
    isActive: true,
    releaseDate: '2024-10-22',
    sources: {
      documentation: 'https://platform.stability.ai/docs/api-reference',
      pricing: 'https://platform.stability.ai/pricing',
      lastVerified: '2026-01-24',
    },
    capabilities: {
      inputModes: {
        textToImage: true,
        imageToImage: true,
        inpainting: true,
        outpainting: true,
        variation: false,
        upscaling: true,
        controlledGeneration: true,
      },
      aspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4', '21:9', '3:2', '2:3'],
      qualities: ['draft', 'standard', 'high'],
      styles: ['natural', 'artistic', 'photographic', 'cinematic', 'anime', '3d-render', 'digital-art'],
      maxImagesPerRequest: 1,
      features: { negativePrompt: true, seed: true },
      sizeConstraints: {
        minWidth: 512,
        maxWidth: 2048,
        minHeight: 512,
        maxHeight: 2048,
        stepSize: 64,
      },
      vendorOptions: {
        cfg_scale: {
          type: 'number',
          description: 'Classifier-free guidance scale',
          min: 1,
          max: 10,
          default: 5,
        },
        steps: {
          type: 'number',
          description: 'Number of diffusion steps',
          min: 1,
          max: 50,
          default: 40,
        },
      },
    },
    pricing: { perImage: 0.065, currency: 'USD' },
  },

  // ======================== Black Forest Labs (Flux) ========================

  'flux-1.1-pro': {
    name: 'flux-1.1-pro',
    displayName: 'FLUX 1.1 Pro',
    provider: Vendor.Custom,
    description: 'Black Forest Labs flagship model with excellent quality and speed',
    isActive: true,
    releaseDate: '2024-10-01',
    sources: {
      documentation: 'https://docs.bfl.ml/',
      pricing: 'https://docs.bfl.ml/#pricing',
      lastVerified: '2026-01-24',
    },
    capabilities: {
      inputModes: TEXT_TO_IMAGE_ONLY,
      aspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4', '21:9'],
      qualities: ['standard', 'high'],
      styles: ['natural', 'artistic', 'photographic', 'cinematic'],
      maxImagesPerRequest: 1,
      features: { negativePrompt: false, seed: true },
      sizeConstraints: {
        minWidth: 256,
        maxWidth: 1440,
        minHeight: 256,
        maxHeight: 1440,
      },
      vendorOptions: {
        guidance: {
          type: 'number',
          description: 'Guidance scale for generation',
          min: 1.5,
          max: 5,
          default: 3,
        },
      },
    },
    pricing: { perImage: 0.040, currency: 'USD' },
  },
};

// =============================================================================
// Helper Functions (using shared utilities)
// =============================================================================

const helpers = createRegistryHelpers(IMAGE_MODEL_REGISTRY);
const capabilityFilter = createCapabilityFilter(IMAGE_MODEL_REGISTRY);

export const getImageModelInfo = helpers.getInfo;
export const getImageModelsByVendor = helpers.getByVendor;
export const getActiveImageModels = helpers.getActive;

export const getImageModelsWithInputMode = (mode: keyof ImageInputModes) =>
  capabilityFilter.withFeature('inputModes' as never).filter(
    (m) => m.capabilities.inputModes[mode]
  );

export function calculateImageCost(
  modelName: string,
  options?: { quality?: QualityLevel; size?: string; count?: number }
): number | null {
  const model = getImageModelInfo(modelName);
  if (!model?.pricing) return null;

  const count = options?.count ?? 1;

  if (model.pricing.tiers && options?.quality && options?.size) {
    const tier = model.pricing.tiers.find(
      (t) => t.quality === options.quality && t.size === options.size
    );
    if (tier) return tier.price * count;
  }

  if (model.pricing.perImage) {
    return model.pricing.perImage * count;
  }

  return null;
}
```

### 2. TTS Model Registry (`src/domain/entities/TTSModel.ts`)

```typescript
import { Vendor } from '../../core/Vendor.js';
import type { Vendor as VendorType } from '../../core/Vendor.js';
import type { IBaseModelDescription, AudioFormat, VendorOptionSchema } from '../types/SharedTypes.js';
import { createRegistryHelpers, createCapabilityFilter } from './RegistryUtils.js';
import { OPENAI_VOICES, GEMINI_VOICES, COMMON_LANGUAGES, AUDIO_FORMATS } from './SharedVoices.js';

// =============================================================================
// Types
// =============================================================================

export interface IVoiceInfo {
  id: string;
  name: string;
  language: string;
  gender: 'male' | 'female' | 'neutral';
  style?: string;
  previewUrl?: string;
  isDefault?: boolean;
  accent?: string;
}

export interface TTSModelCapabilities {
  voices: IVoiceInfo[];
  formats: readonly AudioFormat[] | AudioFormat[];
  languages: readonly string[] | string[];
  speed: {
    supported: boolean;
    min?: number;
    max?: number;
    default?: number;
  };
  features: {
    streaming: boolean;
    ssml: boolean;
    emotions: boolean;
    voiceCloning: boolean;
    wordTimestamps: boolean;
    instructionSteering?: boolean;
  };
  limits: {
    maxInputLength: number;
    maxRequestsPerMinute?: number;
  };
  vendorOptions?: Record<string, VendorOptionSchema>;
}

export interface TTSModelPricing {
  per1kCharacters: number;
  currency: 'USD';
}

export interface ITTSModelDescription extends IBaseModelDescription {
  capabilities: TTSModelCapabilities;
  pricing?: TTSModelPricing;
}

// =============================================================================
// Model Constants
// =============================================================================

export const TTS_MODELS = {
  [Vendor.OpenAI]: {
    GPT_4O_MINI_TTS: 'gpt-4o-mini-tts',
    TTS_1: 'tts-1',
    TTS_1_HD: 'tts-1-hd',
  },
  [Vendor.Google]: {
    GEMINI_TTS: 'gemini-tts',
  },
  [Vendor.Custom]: {
    ELEVENLABS_V3: 'eleven_v3',
    ELEVENLABS_MULTILINGUAL_V2: 'eleven_multilingual_v2',
    ELEVENLABS_TURBO_V2_5: 'eleven_turbo_v2_5',
  },
} as const;

// =============================================================================
// Shared Capability Presets (DRY)
// =============================================================================

const OPENAI_TTS_BASE: Omit<TTSModelCapabilities, 'features'> = {
  voices: OPENAI_VOICES,
  formats: AUDIO_FORMATS.OPENAI_TTS,
  languages: COMMON_LANGUAGES.OPENAI_TTS,
  speed: { supported: true, min: 0.25, max: 4.0, default: 1.0 },
  limits: { maxInputLength: 4096 },
};

const ELEVENLABS_VENDOR_OPTIONS: Record<string, VendorOptionSchema> = {
  stability: {
    type: 'number',
    description: 'Voice stability (0-1). Lower = more expressive',
    min: 0,
    max: 1,
    default: 0.5,
  },
  similarity_boost: {
    type: 'number',
    description: 'Voice similarity boost (0-1)',
    min: 0,
    max: 1,
    default: 0.75,
  },
  style: {
    type: 'number',
    description: 'Style exaggeration (0-1)',
    min: 0,
    max: 1,
    default: 0,
  },
  use_speaker_boost: {
    type: 'boolean',
    description: 'Enhance speaker clarity',
    default: true,
  },
};

// =============================================================================
// Registry
// =============================================================================

export const TTS_MODEL_REGISTRY: Record<string, ITTSModelDescription> = {
  // ======================== OpenAI ========================

  'gpt-4o-mini-tts': {
    name: 'gpt-4o-mini-tts',
    displayName: 'GPT-4o Mini TTS',
    provider: Vendor.OpenAI,
    description: 'Text-to-speech with instruction steering - customize voice style via prompts',
    isActive: true,
    releaseDate: '2025-03-01',
    sources: {
      documentation: 'https://platform.openai.com/docs/guides/text-to-speech',
      pricing: 'https://openai.com/pricing',
      lastVerified: '2026-01-24',
    },
    capabilities: {
      ...OPENAI_TTS_BASE,
      features: {
        streaming: true,
        ssml: false,
        emotions: true,
        voiceCloning: true,
        wordTimestamps: false,
        instructionSteering: true,
      },
      limits: { maxInputLength: 2000 },
      vendorOptions: {
        instructions: {
          type: 'string',
          description: 'Instructions for voice style (e.g., "speak like a calm meditation guide")',
        },
      },
    },
    pricing: { per1kCharacters: 0.015, currency: 'USD' },
  },

  'tts-1': {
    name: 'tts-1',
    displayName: 'TTS-1',
    provider: Vendor.OpenAI,
    description: 'Fast, low-latency text-to-speech optimized for real-time use',
    isActive: true,
    releaseDate: '2023-11-06',
    sources: {
      documentation: 'https://platform.openai.com/docs/guides/text-to-speech',
      pricing: 'https://openai.com/pricing',
      lastVerified: '2026-01-24',
    },
    capabilities: {
      ...OPENAI_TTS_BASE,
      features: {
        streaming: true,
        ssml: false,
        emotions: false,
        voiceCloning: false,
        wordTimestamps: false,
      },
    },
    pricing: { per1kCharacters: 0.015, currency: 'USD' },
  },

  'tts-1-hd': {
    name: 'tts-1-hd',
    displayName: 'TTS-1 HD',
    provider: Vendor.OpenAI,
    description: 'High-definition text-to-speech with improved audio quality',
    isActive: true,
    releaseDate: '2023-11-06',
    sources: {
      documentation: 'https://platform.openai.com/docs/guides/text-to-speech',
      pricing: 'https://openai.com/pricing',
      lastVerified: '2026-01-24',
    },
    capabilities: {
      ...OPENAI_TTS_BASE,
      features: {
        streaming: true,
        ssml: false,
        emotions: false,
        voiceCloning: false,
        wordTimestamps: false,
      },
    },
    pricing: { per1kCharacters: 0.030, currency: 'USD' },
  },

  // ======================== Google ========================

  'gemini-tts': {
    name: 'gemini-tts',
    displayName: 'Gemini TTS',
    provider: Vendor.Google,
    description: 'Google Gemini native text-to-speech',
    isActive: true,
    sources: {
      documentation: 'https://ai.google.dev/gemini-api/docs/text-to-speech',
      pricing: 'https://ai.google.dev/pricing',
      lastVerified: '2026-01-24',
    },
    capabilities: {
      voices: GEMINI_VOICES,
      formats: ['mp3', 'wav', 'ogg'],
      languages: COMMON_LANGUAGES.CORE,
      speed: { supported: true, min: 0.5, max: 2.0 },
      features: {
        streaming: true,
        ssml: false,
        emotions: false,
        voiceCloning: false,
        wordTimestamps: false,
      },
      limits: { maxInputLength: 8000 },
    },
  },

  // ======================== ElevenLabs ========================

  'eleven_v3': {
    name: 'eleven_v3',
    displayName: 'ElevenLabs v3',
    provider: Vendor.Custom,
    description: 'Latest ElevenLabs model with superior quality and emotional range',
    isActive: true,
    releaseDate: '2025-06-01',
    sources: {
      documentation: 'https://elevenlabs.io/docs/api-reference',
      pricing: 'https://elevenlabs.io/pricing',
      lastVerified: '2026-01-24',
    },
    capabilities: {
      voices: [], // Dynamic - fetched via API
      formats: AUDIO_FORMATS.ELEVENLABS,
      languages: COMMON_LANGUAGES.ELEVENLABS,
      speed: { supported: true, min: 0.5, max: 2.0 },
      features: {
        streaming: true,
        ssml: true,
        emotions: true,
        voiceCloning: true,
        wordTimestamps: true,
      },
      limits: { maxInputLength: 10000 },
      vendorOptions: ELEVENLABS_VENDOR_OPTIONS,
    },
    pricing: { per1kCharacters: 0.18, currency: 'USD' },
  },

  'eleven_multilingual_v2': {
    name: 'eleven_multilingual_v2',
    displayName: 'ElevenLabs Multilingual v2',
    provider: Vendor.Custom,
    description: 'High-quality multilingual TTS with emotion support',
    isActive: true,
    releaseDate: '2023-08-22',
    sources: {
      documentation: 'https://elevenlabs.io/docs/api-reference',
      pricing: 'https://elevenlabs.io/pricing',
      lastVerified: '2026-01-24',
    },
    capabilities: {
      voices: [], // Dynamic
      formats: ['mp3', 'pcm', 'ogg'],
      languages: COMMON_LANGUAGES.ELEVENLABS,
      speed: { supported: false },
      features: {
        streaming: true,
        ssml: true,
        emotions: true,
        voiceCloning: true,
        wordTimestamps: true,
      },
      limits: { maxInputLength: 5000 },
      vendorOptions: ELEVENLABS_VENDOR_OPTIONS,
    },
    pricing: { per1kCharacters: 0.30, currency: 'USD' },
  },
};

// =============================================================================
// Helper Functions
// =============================================================================

const helpers = createRegistryHelpers(TTS_MODEL_REGISTRY);

export const getTTSModelInfo = helpers.getInfo;
export const getTTSModelsByVendor = helpers.getByVendor;
export const getActiveTTSModels = helpers.getActive;

export function getTTSModelsWithFeature(
  feature: keyof ITTSModelDescription['capabilities']['features']
): ITTSModelDescription[] {
  return Object.values(TTS_MODEL_REGISTRY).filter(
    (m) => m.isActive && m.capabilities.features[feature]
  );
}

export function calculateTTSCost(modelName: string, characterCount: number): number | null {
  const model = getTTSModelInfo(modelName);
  if (!model?.pricing) return null;
  return (characterCount / 1000) * model.pricing.per1kCharacters;
}
```

### 3. STT Model Registry (`src/domain/entities/STTModel.ts`)

```typescript
import { Vendor } from '../../core/Vendor.js';
import type { Vendor as VendorType } from '../../core/Vendor.js';
import type { IBaseModelDescription, VendorOptionSchema } from '../types/SharedTypes.js';
import { createRegistryHelpers } from './RegistryUtils.js';
import { AUDIO_FORMATS } from './SharedVoices.js';

// =============================================================================
// Types
// =============================================================================

export type STTOutputFormat = 'json' | 'text' | 'srt' | 'vtt' | 'verbose_json';

export interface STTModelCapabilities {
  inputFormats: readonly string[] | string[];
  outputFormats: STTOutputFormat[];
  languages: string[];
  timestamps: {
    supported: boolean;
    granularities?: ('word' | 'segment')[];
  };
  features: {
    translation: boolean;
    diarization: boolean;
    streaming: boolean;
    punctuation: boolean;
    profanityFilter: boolean;
  };
  limits: {
    maxFileSizeMB: number;
    maxDurationSeconds?: number;
  };
  vendorOptions?: Record<string, VendorOptionSchema>;
}

export interface STTModelPricing {
  perMinute: number;
  currency: 'USD';
}

export interface ISTTModelDescription extends IBaseModelDescription {
  capabilities: STTModelCapabilities;
  pricing?: STTModelPricing;
}

// =============================================================================
// Model Constants
// =============================================================================

export const STT_MODELS = {
  [Vendor.OpenAI]: {
    GPT_4O_TRANSCRIBE: 'gpt-4o-transcribe',
    GPT_4O_TRANSCRIBE_DIARIZE: 'gpt-4o-transcribe-diarize',
    WHISPER_1: 'whisper-1',
  },
  [Vendor.Groq]: {
    WHISPER_LARGE_V3: 'whisper-large-v3',
    DISTIL_WHISPER: 'distil-whisper-large-v3-en',
  },
  [Vendor.Custom]: {
    ASSEMBLYAI_UNIVERSAL: 'assemblyai-universal',
    DEEPGRAM_NOVA_3: 'deepgram-nova-3',
  },
} as const;

// =============================================================================
// Shared Presets (DRY)
// =============================================================================

const WHISPER_BASE_CAPABILITIES: Omit<STTModelCapabilities, 'features' | 'limits'> = {
  inputFormats: AUDIO_FORMATS.STT_INPUT,
  outputFormats: ['json', 'text', 'srt', 'vtt', 'verbose_json'],
  languages: [], // Auto-detect, 50+ languages
  timestamps: { supported: true, granularities: ['word', 'segment'] },
};

// =============================================================================
// Registry
// =============================================================================

export const STT_MODEL_REGISTRY: Record<string, ISTTModelDescription> = {
  // ======================== OpenAI ========================

  'gpt-4o-transcribe': {
    name: 'gpt-4o-transcribe',
    displayName: 'GPT-4o Transcribe',
    provider: Vendor.OpenAI,
    description: 'GPT-4o based transcription with superior accuracy',
    isActive: true,
    releaseDate: '2025-04-01',
    sources: {
      documentation: 'https://platform.openai.com/docs/guides/speech-to-text',
      pricing: 'https://openai.com/pricing',
      lastVerified: '2026-01-24',
    },
    capabilities: {
      ...WHISPER_BASE_CAPABILITIES,
      features: {
        translation: true,
        diarization: false,
        streaming: true,
        punctuation: true,
        profanityFilter: false,
      },
      limits: { maxFileSizeMB: 25, maxDurationSeconds: 7200 },
    },
    pricing: { perMinute: 0.006, currency: 'USD' },
  },

  'gpt-4o-transcribe-diarize': {
    name: 'gpt-4o-transcribe-diarize',
    displayName: 'GPT-4o Transcribe + Diarization',
    provider: Vendor.OpenAI,
    description: 'GPT-4o transcription with speaker identification',
    isActive: true,
    releaseDate: '2025-04-01',
    sources: {
      documentation: 'https://platform.openai.com/docs/guides/speech-to-text',
      pricing: 'https://openai.com/pricing',
      lastVerified: '2026-01-24',
    },
    capabilities: {
      ...WHISPER_BASE_CAPABILITIES,
      outputFormats: ['json', 'verbose_json'],
      features: {
        translation: true,
        diarization: true,
        streaming: false,
        punctuation: true,
        profanityFilter: false,
      },
      limits: { maxFileSizeMB: 25, maxDurationSeconds: 7200 },
      vendorOptions: {
        max_speakers: {
          type: 'number',
          description: 'Maximum number of speakers to detect',
          min: 2,
          max: 10,
          default: 4,
        },
      },
    },
    pricing: { perMinute: 0.012, currency: 'USD' },
  },

  'whisper-1': {
    name: 'whisper-1',
    displayName: 'Whisper',
    provider: Vendor.OpenAI,
    description: "OpenAI's general-purpose speech recognition",
    isActive: true,
    releaseDate: '2023-03-01',
    sources: {
      documentation: 'https://platform.openai.com/docs/guides/speech-to-text',
      pricing: 'https://openai.com/pricing',
      lastVerified: '2026-01-24',
    },
    capabilities: {
      ...WHISPER_BASE_CAPABILITIES,
      inputFormats: ['mp3', 'mp4', 'mpeg', 'mpga', 'm4a', 'wav', 'webm'],
      features: {
        translation: true,
        diarization: false,
        streaming: false,
        punctuation: true,
        profanityFilter: false,
      },
      limits: { maxFileSizeMB: 25 },
    },
    pricing: { perMinute: 0.006, currency: 'USD' },
  },

  // ======================== Groq ========================

  'whisper-large-v3': {
    name: 'whisper-large-v3',
    displayName: 'Whisper Large v3 (Groq)',
    provider: Vendor.Groq,
    description: 'Ultra-fast Whisper on Groq LPUs - 12x cheaper than OpenAI',
    isActive: true,
    releaseDate: '2024-04-01',
    sources: {
      documentation: 'https://console.groq.com/docs/speech-text',
      pricing: 'https://groq.com/pricing/',
      lastVerified: '2026-01-24',
    },
    capabilities: {
      ...WHISPER_BASE_CAPABILITIES,
      timestamps: { supported: true, granularities: ['segment'] },
      outputFormats: ['json', 'text', 'verbose_json'],
      features: {
        translation: true,
        diarization: false,
        streaming: false,
        punctuation: true,
        profanityFilter: false,
      },
      limits: { maxFileSizeMB: 25 },
    },
    pricing: { perMinute: 0.0005, currency: 'USD' },
  },

  // ======================== AssemblyAI ========================

  'assemblyai-universal': {
    name: 'assemblyai-universal',
    displayName: 'AssemblyAI Universal',
    provider: Vendor.Custom,
    description: 'AssemblyAI Universal model - 93.3% accuracy, industry leading',
    isActive: true,
    releaseDate: '2024-01-01',
    sources: {
      documentation: 'https://www.assemblyai.com/docs',
      pricing: 'https://www.assemblyai.com/pricing',
      lastVerified: '2026-01-24',
    },
    capabilities: {
      inputFormats: ['mp3', 'mp4', 'wav', 'flac', 'ogg', 'webm', 'm4a'],
      outputFormats: ['json', 'text', 'srt', 'vtt'],
      languages: [
        'en', 'es', 'fr', 'de', 'it', 'pt', 'nl', 'ja', 'ko', 'zh',
        'ru', 'ar', 'hi', 'pl', 'tr', 'uk', 'vi',
      ],
      timestamps: { supported: true, granularities: ['word', 'segment'] },
      features: {
        translation: false,
        diarization: true,
        streaming: true,
        punctuation: true,
        profanityFilter: true,
      },
      limits: { maxFileSizeMB: 5000, maxDurationSeconds: 36000 },
      vendorOptions: {
        speaker_labels: { type: 'boolean', description: 'Enable speaker diarization' },
        auto_chapters: { type: 'boolean', description: 'Auto-generate chapters' },
        entity_detection: { type: 'boolean', description: 'Detect named entities' },
        sentiment_analysis: { type: 'boolean', description: 'Analyze sentiment' },
        auto_highlights: { type: 'boolean', description: 'Extract key phrases' },
        summarization: { type: 'boolean', description: 'Generate summary' },
      },
    },
    pricing: { perMinute: 0.0062, currency: 'USD' },
  },
};

// =============================================================================
// Helper Functions
// =============================================================================

const helpers = createRegistryHelpers(STT_MODEL_REGISTRY);

export const getSTTModelInfo = helpers.getInfo;
export const getSTTModelsByVendor = helpers.getByVendor;
export const getActiveSTTModels = helpers.getActive;

export function getSTTModelsWithFeature(
  feature: keyof ISTTModelDescription['capabilities']['features']
): ISTTModelDescription[] {
  return Object.values(STT_MODEL_REGISTRY).filter(
    (m) => m.isActive && m.capabilities.features[feature]
  );
}

export function calculateSTTCost(modelName: string, durationSeconds: number): number | null {
  const model = getSTTModelInfo(modelName);
  if (!model?.pricing) return null;
  return (durationSeconds / 60) * model.pricing.perMinute;
}
```

### 4. Video Model Registry (`src/domain/entities/VideoModel.ts`)

```typescript
import { Vendor } from '../../core/Vendor.js';
import type { Vendor as VendorType } from '../../core/Vendor.js';
import type { IBaseModelDescription, AspectRatio, VendorOptionSchema } from '../types/SharedTypes.js';
import { createRegistryHelpers } from './RegistryUtils.js';
import type { VideoResolution, VideoStyle } from '../interfaces/IVideoProvider.js';

// =============================================================================
// Types
// =============================================================================

export interface VideoInputModes {
  textToVideo: boolean;
  imageToVideo: boolean;
  videoToVideo: boolean;
  keyframeToVideo?: boolean;
  audioToVideo?: boolean;
  multiImageToVideo?: boolean;
}

export interface VideoModelCapabilities {
  inputModes: VideoInputModes;
  aspectRatios: AspectRatio[];
  resolutions: VideoResolution[];
  styles: VideoStyle[];
  duration: {
    min: number;
    max: number;
    step?: number;
  };
  frameRates: number[];
  features: {
    negativePrompt: boolean;
    seed: boolean;
    audioTrack: boolean;
    cameraControl: boolean;
    nativeAudio?: boolean;
    hdr?: boolean;
    motionBrush?: boolean;
  };
  limits?: {
    maxPromptLength?: number;
  };
  vendorOptions?: Record<string, VendorOptionSchema>;
}

export interface VideoModelPricing {
  perSecond?: number;
  perVideo?: number;
  tiers?: Array<{ resolution: VideoResolution; duration: number; price: number }>;
  currency: 'USD';
}

export interface IVideoModelDescription extends IBaseModelDescription {
  capabilities: VideoModelCapabilities;
  pricing?: VideoModelPricing;
}

// =============================================================================
// Model Constants
// =============================================================================

export const VIDEO_MODELS = {
  [Vendor.Google]: {
    VEO_3: 'veo-3.0-generate',
    VEO_3_FAST: 'veo-3.0-fast-generate',
    VEO_2: 'veo-2.0-generate-exp',
  },
  [Vendor.Custom]: {
    RUNWAY_GEN3_ALPHA: 'gen-3-alpha',
    RUNWAY_GEN3_ALPHA_TURBO: 'gen-3-alpha-turbo',
    LUMA_RAY_3: 'ray-3',
    LUMA_RAY_2: 'ray-2',
    KLING_1_6_PRO: 'kling-1.6-pro',
  },
} as const;

// =============================================================================
// Shared Presets (DRY)
// =============================================================================

const TEXT_TO_VIDEO_ONLY: VideoInputModes = {
  textToVideo: true,
  imageToVideo: false,
  videoToVideo: false,
};

const FULL_VIDEO_MODES: VideoInputModes = {
  textToVideo: true,
  imageToVideo: true,
  videoToVideo: true,
  keyframeToVideo: true,
  multiImageToVideo: true,
};

// =============================================================================
// Registry
// =============================================================================

export const VIDEO_MODEL_REGISTRY: Record<string, IVideoModelDescription> = {
  // ======================== Google ========================

  'veo-3.0-generate': {
    name: 'veo-3.0-generate',
    displayName: 'Veo 3',
    provider: Vendor.Google,
    description: "Google's flagship video model with NATIVE AUDIO generation",
    isActive: true,
    releaseDate: '2025-12-01',
    sources: {
      documentation: 'https://cloud.google.com/vertex-ai/generative-ai/docs/video/overview',
      pricing: 'https://cloud.google.com/vertex-ai/generative-ai/pricing',
      lastVerified: '2026-01-24',
    },
    capabilities: {
      inputModes: FULL_VIDEO_MODES,
      aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
      resolutions: ['720p', '1080p', '4k'],
      styles: ['realistic', 'cinematic', 'artistic', 'animated', 'documentary'],
      duration: { min: 5, max: 120 },
      frameRates: [24, 30, 60],
      features: {
        negativePrompt: true,
        seed: true,
        audioTrack: true,
        cameraControl: true,
        nativeAudio: true,
      },
      vendorOptions: {
        audio_prompt: {
          type: 'string',
          description: 'Prompt for native audio generation',
        },
        audio_style: {
          type: 'enum',
          description: 'Style of generated audio',
          enum: ['ambient', 'music', 'effects', 'dialogue', 'mixed'],
          default: 'mixed',
        },
      },
    },
    pricing: { perSecond: 0.035, currency: 'USD' },
  },

  'veo-2.0-generate-exp': {
    name: 'veo-2.0-generate-exp',
    displayName: 'Veo 2',
    provider: Vendor.Google,
    description: "Google's high-quality video generation model",
    isActive: true,
    releaseDate: '2024-12-01',
    sources: {
      documentation: 'https://cloud.google.com/vertex-ai/generative-ai/docs/video/overview',
      pricing: 'https://cloud.google.com/vertex-ai/generative-ai/pricing',
      lastVerified: '2026-01-24',
    },
    capabilities: {
      inputModes: {
        textToVideo: true,
        imageToVideo: true,
        videoToVideo: false,
      },
      aspectRatios: ['16:9', '9:16', '1:1'],
      resolutions: ['720p', '1080p'],
      styles: ['realistic', 'cinematic', 'artistic'],
      duration: { min: 5, max: 60 },
      frameRates: [24],
      features: {
        negativePrompt: true,
        seed: true,
        audioTrack: false,
        cameraControl: true,
      },
      vendorOptions: {
        camera_motion: {
          type: 'enum',
          description: 'Camera movement style',
          enum: ['static', 'pan_left', 'pan_right', 'tilt_up', 'tilt_down', 'zoom_in', 'zoom_out', 'dolly', 'orbit'],
        },
      },
    },
    pricing: { perSecond: 0.035, currency: 'USD' },
  },

  // ======================== Runway ========================

  'gen-3-alpha': {
    name: 'gen-3-alpha',
    displayName: 'Runway Gen-3 Alpha',
    provider: Vendor.Custom,
    description: "Runway's most advanced video generation model",
    isActive: true,
    releaseDate: '2024-06-17',
    sources: {
      documentation: 'https://docs.runwayml.com/',
      pricing: 'https://runwayml.com/pricing/',
      lastVerified: '2026-01-24',
    },
    capabilities: {
      inputModes: {
        textToVideo: true,
        imageToVideo: true,
        videoToVideo: true,
        keyframeToVideo: true,
        multiImageToVideo: true,
      },
      aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
      resolutions: ['720p', '1080p', '4k'],
      styles: ['realistic', 'cinematic', 'animated', 'artistic'],
      duration: { min: 5, max: 10, step: 5 },
      frameRates: [24, 30],
      features: {
        negativePrompt: false,
        seed: true,
        audioTrack: false,
        cameraControl: true,
      },
      vendorOptions: {
        motion_score: {
          type: 'number',
          description: 'Amount of motion (1-10)',
          min: 1,
          max: 10,
          default: 5,
        },
        upscale_4k: {
          type: 'boolean',
          description: 'Upscale output to 4K',
          default: false,
        },
      },
    },
    pricing: { perSecond: 0.05, currency: 'USD' },
  },

  // ======================== Luma Labs ========================

  'ray-3': {
    name: 'ray-3',
    displayName: 'Luma Ray 3',
    provider: Vendor.Custom,
    description: "Luma AI's latest model with HDR and extended duration",
    isActive: true,
    releaseDate: '2025-09-01',
    sources: {
      documentation: 'https://docs.lumalabs.ai/',
      pricing: 'https://lumalabs.ai/pricing',
      lastVerified: '2026-01-24',
    },
    capabilities: {
      inputModes: {
        textToVideo: true,
        imageToVideo: true,
        videoToVideo: false,
        keyframeToVideo: true,
        multiImageToVideo: true,
      },
      aspectRatios: ['16:9', '9:16', '1:1', '4:3', '21:9'],
      resolutions: ['720p', '1080p'],
      styles: ['realistic', 'cinematic', 'artistic', 'animated'],
      duration: { min: 5, max: 30 },
      frameRates: [24, 30],
      features: {
        negativePrompt: false,
        seed: true,
        audioTrack: false,
        cameraControl: true,
        hdr: true,
        motionBrush: true,
      },
      vendorOptions: {
        loop: {
          type: 'boolean',
          description: 'Create seamless looping video',
          default: false,
        },
        hdr: {
          type: 'boolean',
          description: 'Output in HDR format',
          default: false,
        },
      },
    },
    pricing: { perSecond: 0.032, currency: 'USD' },
  },

  'ray-2': {
    name: 'ray-2',
    displayName: 'Luma Ray 2',
    provider: Vendor.Custom,
    description: 'Luma AI high-quality video generation',
    isActive: true,
    releaseDate: '2025-02-01',
    sources: {
      documentation: 'https://docs.lumalabs.ai/',
      pricing: 'https://lumalabs.ai/pricing',
      lastVerified: '2026-01-24',
    },
    capabilities: {
      inputModes: {
        textToVideo: true,
        imageToVideo: true,
        videoToVideo: false,
        keyframeToVideo: true,
        multiImageToVideo: true,
      },
      aspectRatios: ['16:9', '9:16', '1:1'],
      resolutions: ['720p', '1080p'],
      styles: ['realistic', 'cinematic', 'artistic', 'animated'],
      duration: { min: 5, max: 20 },
      frameRates: [24],
      features: {
        negativePrompt: false,
        seed: true,
        audioTrack: false,
        cameraControl: true,
      },
      vendorOptions: {
        loop: {
          type: 'boolean',
          description: 'Create seamless looping video',
          default: false,
        },
      },
    },
    pricing: { perSecond: 0.025, currency: 'USD' },
  },
};

// =============================================================================
// Helper Functions
// =============================================================================

const helpers = createRegistryHelpers(VIDEO_MODEL_REGISTRY);

export const getVideoModelInfo = helpers.getInfo;
export const getVideoModelsByVendor = helpers.getByVendor;
export const getActiveVideoModels = helpers.getActive;

export function getVideoModelsWithInputMode(
  mode: keyof VideoInputModes
): IVideoModelDescription[] {
  return Object.values(VIDEO_MODEL_REGISTRY).filter(
    (m) => m.isActive && m.capabilities.inputModes[mode]
  );
}

export function calculateVideoCost(
  modelName: string,
  durationSeconds: number,
  resolution?: VideoResolution
): number | null {
  const model = getVideoModelInfo(modelName);
  if (!model?.pricing) return null;

  if (model.pricing.perSecond) {
    return durationSeconds * model.pricing.perSecond;
  }

  if (model.pricing.tiers && resolution) {
    const tier = model.pricing.tiers.find(
      (t) => t.resolution === resolution && t.duration >= durationSeconds
    );
    if (tier) return tier.price;
  }

  return null;
}
```

---

## Capability Classes

### 1. ImageGenerator (`src/core/ImageGenerator.ts`)

```typescript
import { Connector } from './Connector.js';
import { createImageProvider } from './createImageProvider.js';
import type { IImageProvider, ImageGenerateOptions, ImageEditOptions, ImageResponse } from '../domain/interfaces/IImageProvider.js';
import { getImageModelInfo, getImageModelsByVendor, type IImageModelDescription } from '../domain/entities/ImageModel.js';
import { ImageOptionsValidator, type ValidationResult } from '../capabilities/validation/ImageOptionsValidator.js';

export interface ImageGeneratorConfig {
  connector: string | Connector;
  model?: string;
  defaultAspectRatio?: AspectRatio;
  defaultQuality?: QualityLevel;
  defaultStyle?: ImageStyle;
}

export class ImageGenerator {
  private provider: IImageProvider;
  private config: ImageGeneratorConfig;
  private validator = new ImageOptionsValidator();

  static create(config: ImageGeneratorConfig): ImageGenerator {
    return new ImageGenerator(config);
  }

  private constructor(config: ImageGeneratorConfig) {
    const connector = typeof config.connector === 'string'
      ? Connector.get(config.connector)
      : config.connector;

    this.provider = createImageProvider(connector);
    this.config = config;
  }

  // ======================== Generation ========================

  async generate(
    prompt: string,
    options?: Partial<Omit<ImageGenerateOptions, 'model' | 'prompt'>>
  ): Promise<ImageResponse> {
    const fullOptions: ImageGenerateOptions = {
      model: options?.model ?? this.config.model ?? this.getDefaultModel(),
      prompt,
      aspectRatio: options?.aspectRatio ?? this.config.defaultAspectRatio,
      quality: options?.quality ?? this.config.defaultQuality,
      style: options?.style ?? this.config.defaultStyle,
      ...options,
    };

    return this.provider.generateImage(fullOptions);
  }

  async edit(
    image: Buffer | string,
    prompt: string,
    options?: Partial<Omit<ImageEditOptions, 'model' | 'image' | 'prompt'>>
  ): Promise<ImageResponse> {
    if (!this.provider.editImage) {
      throw new Error('Image editing not supported by this provider');
    }
    return this.provider.editImage({
      model: options?.model ?? this.config.model ?? this.getDefaultModel(),
      image,
      prompt,
      ...options,
    });
  }

  async createVariation(
    image: Buffer | string,
    options?: { model?: string; count?: number }
  ): Promise<ImageResponse> {
    if (!this.provider.createVariation) {
      throw new Error('Image variations not supported by this provider');
    }
    return this.provider.createVariation({
      model: options?.model ?? this.config.model ?? this.getDefaultModel(),
      image,
      count: options?.count,
    });
  }

  // ======================== Introspection ========================

  getModelCapabilities(model?: string) {
    const targetModel = model ?? this.config.model ?? this.getDefaultModel();
    const info = getImageModelInfo(targetModel);
    if (!info) throw new Error(`Unknown model: ${targetModel}`);
    return info.capabilities;
  }

  getModelInfo(model?: string): IImageModelDescription {
    const targetModel = model ?? this.config.model ?? this.getDefaultModel();
    const info = getImageModelInfo(targetModel);
    if (!info) throw new Error(`Unknown model: ${targetModel}`);
    return info;
  }

  listAvailableModels(): IImageModelDescription[] {
    return getImageModelsByVendor(this.provider.vendor);
  }

  validateOptions(options: ImageGenerateOptions): ValidationResult {
    return this.validator.validate(options);
  }

  supportsFeature(feature: string, model?: string): boolean {
    const caps = this.getModelCapabilities(model);
    return Boolean(caps.features[feature as keyof typeof caps.features]);
  }

  private getDefaultModel(): string {
    const models = this.listAvailableModels();
    if (models.length === 0) throw new Error('No models available');
    return models[0].name;
  }
}
```

### 2. TextToSpeech (`src/core/TextToSpeech.ts`)

```typescript
import { Connector } from './Connector.js';
import { createTTSProvider } from './createAudioProvider.js';
import type { ITextToSpeechProvider, TTSOptions, TTSResponse } from '../domain/interfaces/IAudioProvider.js';
import { getTTSModelInfo, getTTSModelsByVendor, type ITTSModelDescription, type IVoiceInfo } from '../domain/entities/TTSModel.js';
import type { AudioFormat } from '../domain/types/SharedTypes.js';
import * as fs from 'fs/promises';

export interface TextToSpeechConfig {
  connector: string | Connector;
  model?: string;
  voice?: string;
  format?: AudioFormat;
}

export class TextToSpeech {
  private provider: ITextToSpeechProvider;
  private config: TextToSpeechConfig;

  static create(config: TextToSpeechConfig): TextToSpeech {
    return new TextToSpeech(config);
  }

  private constructor(config: TextToSpeechConfig) {
    const connector = typeof config.connector === 'string'
      ? Connector.get(config.connector)
      : config.connector;

    this.provider = createTTSProvider(connector);
    this.config = config;
  }

  // ======================== Synthesis ========================

  async synthesize(
    text: string,
    options?: Partial<Omit<TTSOptions, 'model' | 'input'>>
  ): Promise<TTSResponse> {
    return this.provider.synthesize({
      model: options?.model ?? this.config.model ?? this.getDefaultModel(),
      input: text,
      voice: options?.voice ?? this.config.voice ?? this.getDefaultVoice(),
      format: options?.format ?? this.config.format,
      ...options,
    });
  }

  async *stream(
    text: string,
    options?: Partial<Omit<TTSOptions, 'model' | 'input'>>
  ): AsyncIterableIterator<Buffer> {
    if (!this.provider.synthesizeStream) {
      const response = await this.synthesize(text, options);
      yield response.audio;
      return;
    }

    for await (const event of this.provider.synthesizeStream({
      model: options?.model ?? this.config.model ?? this.getDefaultModel(),
      input: text,
      voice: options?.voice ?? this.config.voice ?? this.getDefaultVoice(),
      ...options,
    })) {
      if (event.type === 'audio_chunk' && event.chunk) {
        yield event.chunk;
      } else if (event.type === 'error') {
        throw event.error;
      }
    }
  }

  async toFile(
    text: string,
    filePath: string,
    options?: Partial<Omit<TTSOptions, 'model' | 'input'>>
  ): Promise<void> {
    const response = await this.synthesize(text, options);
    await fs.writeFile(filePath, response.audio);
  }

  // ======================== Introspection ========================

  getModelInfo(model?: string): ITTSModelDescription {
    const targetModel = model ?? this.config.model ?? this.getDefaultModel();
    const info = getTTSModelInfo(targetModel);
    if (!info) throw new Error(`Unknown model: ${targetModel}`);
    return info;
  }

  async listVoices(): Promise<IVoiceInfo[]> {
    if (this.provider.listVoices) {
      return this.provider.listVoices();
    }
    return this.getModelInfo().capabilities.voices;
  }

  listAvailableModels(): ITTSModelDescription[] {
    return getTTSModelsByVendor(this.provider.vendor);
  }

  private getDefaultModel(): string {
    const models = this.listAvailableModels();
    if (models.length === 0) throw new Error('No models available');
    return models[0].name;
  }

  private getDefaultVoice(): string {
    const caps = this.getModelInfo().capabilities;
    const defaultVoice = caps.voices.find((v) => v.isDefault);
    return defaultVoice?.id ?? caps.voices[0]?.id ?? 'alloy';
  }
}
```

### 3. SpeechToText (`src/core/SpeechToText.ts`)

```typescript
import { Connector } from './Connector.js';
import { createSTTProvider } from './createAudioProvider.js';
import type { ISpeechToTextProvider, STTOptions, STTResponse } from '../domain/interfaces/IAudioProvider.js';
import { getSTTModelInfo, getSTTModelsByVendor, type ISTTModelDescription } from '../domain/entities/STTModel.js';
import * as fs from 'fs/promises';

export interface SpeechToTextConfig {
  connector: string | Connector;
  model?: string;
  language?: string;
}

export class SpeechToText {
  private provider: ISpeechToTextProvider;
  private config: SpeechToTextConfig;

  static create(config: SpeechToTextConfig): SpeechToText {
    return new SpeechToText(config);
  }

  private constructor(config: SpeechToTextConfig) {
    const connector = typeof config.connector === 'string'
      ? Connector.get(config.connector)
      : config.connector;

    this.provider = createSTTProvider(connector);
    this.config = config;
  }

  // ======================== Transcription ========================

  async transcribe(
    audio: Buffer | string,
    options?: Partial<Omit<STTOptions, 'model' | 'audio'>>
  ): Promise<STTResponse> {
    return this.provider.transcribe({
      model: options?.model ?? this.config.model ?? this.getDefaultModel(),
      audio,
      language: options?.language ?? this.config.language,
      ...options,
    });
  }

  async transcribeFile(
    filePath: string,
    options?: Partial<Omit<STTOptions, 'model' | 'audio'>>
  ): Promise<STTResponse> {
    const audio = await fs.readFile(filePath);
    return this.transcribe(audio, options);
  }

  async translate(
    audio: Buffer | string,
    options?: Partial<Omit<STTOptions, 'model' | 'audio'>>
  ): Promise<STTResponse> {
    if (!this.provider.translate) {
      throw new Error('Translation not supported by this provider');
    }
    return this.provider.translate({
      model: options?.model ?? this.config.model ?? this.getDefaultModel(),
      audio,
      ...options,
    });
  }

  async transcribeWithTimestamps(
    audio: Buffer | string,
    granularity: 'word' | 'segment' = 'segment'
  ): Promise<STTResponse> {
    return this.transcribe(audio, {
      outputFormat: 'verbose_json',
      includeTimestamps: true,
      timestampGranularity: granularity,
    });
  }

  // ======================== Introspection ========================

  getModelInfo(model?: string): ISTTModelDescription {
    const targetModel = model ?? this.config.model ?? this.getDefaultModel();
    const info = getSTTModelInfo(targetModel);
    if (!info) throw new Error(`Unknown model: ${targetModel}`);
    return info;
  }

  listAvailableModels(): ISTTModelDescription[] {
    return getSTTModelsByVendor(this.provider.vendor);
  }

  private getDefaultModel(): string {
    const models = this.listAvailableModels();
    if (models.length === 0) throw new Error('No models available');
    return models[0].name;
  }
}
```

### 4. VideoGenerator (`src/core/VideoGenerator.ts`)

```typescript
import { Connector } from './Connector.js';
import { createVideoProvider } from './createVideoProvider.js';
import type { IVideoProvider, VideoGenerateOptions, VideoResponse, VideoProgressEvent } from '../domain/interfaces/IVideoProvider.js';
import { getVideoModelInfo, getVideoModelsByVendor, type IVideoModelDescription } from '../domain/entities/VideoModel.js';

export interface VideoGeneratorConfig {
  connector: string | Connector;
  model?: string;
}

export class VideoGenerator {
  private provider: IVideoProvider;
  private config: VideoGeneratorConfig;

  static create(config: VideoGeneratorConfig): VideoGenerator {
    return new VideoGenerator(config);
  }

  private constructor(config: VideoGeneratorConfig) {
    const connector = typeof config.connector === 'string'
      ? Connector.get(config.connector)
      : config.connector;

    this.provider = createVideoProvider(connector);
    this.config = config;
  }

  // ======================== Generation ========================

  async generate(
    prompt: string,
    options?: Partial<Omit<VideoGenerateOptions, 'model' | 'prompt'>>
  ): Promise<VideoResponse> {
    return this.provider.generateVideo({
      model: options?.model ?? this.config.model ?? this.getDefaultModel(),
      prompt,
      ...options,
    });
  }

  async *generateWithProgress(
    prompt: string,
    options?: Partial<Omit<VideoGenerateOptions, 'model' | 'prompt'>>
  ): AsyncIterableIterator<VideoProgressEvent> {
    if (!this.provider.generateVideoWithProgress) {
      const response = await this.generate(prompt, options);
      yield { type: 'queued' };

      while (response.status === 'pending' || response.status === 'processing') {
        await new Promise((r) => setTimeout(r, 5000));
        const status = await this.getStatus(response.id);
        yield {
          type: status.status === 'completed' ? 'completed' : 'processing',
          video: status,
        };
        if (status.status === 'completed' || status.status === 'failed') break;
      }
      return;
    }

    yield* this.provider.generateVideoWithProgress({
      model: options?.model ?? this.config.model ?? this.getDefaultModel(),
      prompt,
      ...options,
    });
  }

  async fromImage(
    image: Buffer | string,
    prompt: string,
    options?: Partial<Omit<VideoGenerateOptions, 'model' | 'prompt' | 'sourceImage'>>
  ): Promise<VideoResponse> {
    return this.generate(prompt, { ...options, sourceImage: image });
  }

  async getStatus(id: string): Promise<VideoResponse> {
    if (!this.provider.getVideoStatus) {
      throw new Error('Status checking not supported');
    }
    return this.provider.getVideoStatus(id);
  }

  async cancel(id: string): Promise<void> {
    if (!this.provider.cancelVideo) {
      throw new Error('Cancellation not supported');
    }
    return this.provider.cancelVideo(id);
  }

  // ======================== Introspection ========================

  getModelInfo(model?: string): IVideoModelDescription {
    const targetModel = model ?? this.config.model ?? this.getDefaultModel();
    const info = getVideoModelInfo(targetModel);
    if (!info) throw new Error(`Unknown model: ${targetModel}`);
    return info;
  }

  listAvailableModels(): IVideoModelDescription[] {
    return getVideoModelsByVendor(this.provider.vendor);
  }

  private getDefaultModel(): string {
    const models = this.listAvailableModels();
    if (models.length === 0) throw new Error('No models available');
    return models[0].name;
  }
}
```

---

## Validation Layer

### Base Validator (`src/domain/validation/BaseOptionsValidator.ts`)

```typescript
import type { IBaseModelDescription, QualityLevel } from '../types/SharedTypes.js';

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: string[];
  normalizedOptions: Record<string, unknown>;
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class UnsupportedOptionError extends ValidationError {
  constructor(
    public readonly option: string,
    public readonly value: unknown,
    public readonly supportedValues: unknown[]
  ) {
    super(
      `Option '${option}' value '${value}' not supported. ` +
      `Available: ${supportedValues.join(', ')}`
    );
    this.name = 'UnsupportedOptionError';
  }
}

export class OptionOutOfRangeError extends ValidationError {
  constructor(
    public readonly option: string,
    public readonly value: number,
    public readonly min: number,
    public readonly max: number
  ) {
    super(`Option '${option}' value ${value} out of range. Must be between ${min} and ${max}`);
    this.name = 'OptionOutOfRangeError';
  }
}

/**
 * Base validator with shared utilities
 */
export abstract class BaseOptionsValidator<TOptions, TModel extends IBaseModelDescription> {
  protected abstract getRegistry(): Record<string, TModel>;

  protected getModelInfo(modelName: string): TModel | undefined {
    return this.getRegistry()[modelName];
  }

  protected validateEnum<T>(
    value: T | undefined,
    allowed: readonly T[] | T[],
    optionName: string,
    errors: ValidationError[],
    warnings: string[],
    normalized: Record<string, unknown>
  ): void {
    if (value === undefined) return;

    if (!allowed.includes(value)) {
      errors.push(new UnsupportedOptionError(optionName, value, allowed as unknown[]));
    }
  }

  protected validateRange(
    value: number | undefined,
    min: number,
    max: number,
    optionName: string,
    errors: ValidationError[]
  ): void {
    if (value === undefined) return;

    if (value < min || value > max) {
      errors.push(new OptionOutOfRangeError(optionName, value, min, max));
    }
  }

  protected findClosestQuality(
    requested: QualityLevel,
    available: QualityLevel[]
  ): QualityLevel {
    const order: QualityLevel[] = ['draft', 'standard', 'high', 'ultra'];
    const requestedIndex = order.indexOf(requested);

    for (let i = requestedIndex; i >= 0; i--) {
      if (available.includes(order[i])) return order[i];
    }
    for (let i = requestedIndex + 1; i < order.length; i++) {
      if (available.includes(order[i])) return order[i];
    }

    return available[0];
  }
}
```

### Image Options Validator (`src/domain/validation/ImageOptionsValidator.ts`)

```typescript
import { BaseOptionsValidator, ValidationResult, ValidationError, UnsupportedOptionError } from './BaseOptionsValidator.js';
import { IMAGE_MODEL_REGISTRY, type IImageModelDescription } from '../entities/ImageModel.js';
import type { ImageGenerateOptions } from '../interfaces/IImageProvider.js';

export class ImageOptionsValidator extends BaseOptionsValidator<ImageGenerateOptions, IImageModelDescription> {
  protected getRegistry() {
    return IMAGE_MODEL_REGISTRY;
  }

  validate(options: ImageGenerateOptions): ValidationResult {
    const modelInfo = this.getModelInfo(options.model);

    if (!modelInfo) {
      return {
        valid: false,
        errors: [new ValidationError(`Unknown model: ${options.model}`)],
        warnings: [],
        normalizedOptions: {},
      };
    }

    const caps = modelInfo.capabilities;
    const errors: ValidationError[] = [];
    const warnings: string[] = [];
    const normalized: Record<string, unknown> = { ...options };

    // Validate aspect ratio
    this.validateEnum(options.aspectRatio, caps.aspectRatios, 'aspectRatio', errors, warnings, normalized);

    // Validate quality with fallback
    if (options.quality && !caps.qualities.includes(options.quality)) {
      const fallback = this.findClosestQuality(options.quality, caps.qualities);
      warnings.push(`Quality '${options.quality}' not supported. Using '${fallback}'.`);
      normalized.quality = fallback;
    }

    // Validate style
    if (options.style) {
      if (caps.styles.length === 0) {
        warnings.push(`Style not supported by ${options.model}. Ignoring.`);
        delete normalized.style;
      } else if (!caps.styles.includes(options.style)) {
        warnings.push(`Style '${options.style}' not supported. Ignoring.`);
        delete normalized.style;
      }
    }

    // Validate count
    if (options.count !== undefined && options.count > caps.maxImagesPerRequest) {
      errors.push(new UnsupportedOptionError('count', options.count, [1, caps.maxImagesPerRequest]));
    }

    // Validate unsupported features
    if (options.negativePrompt && !caps.features.negativePrompt) {
      warnings.push(`Negative prompts not supported. Ignoring.`);
      delete normalized.negativePrompt;
    }

    if (options.seed !== undefined && !caps.features.seed) {
      warnings.push(`Seed not supported. Ignoring.`);
      delete normalized.seed;
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      normalizedOptions: normalized,
    };
  }
}

export type { ValidationResult };
```

---

## Vendor Capabilities Matrix

```typescript
// src/core/VendorCapabilities.ts

import { Vendor } from './Vendor.js';
import type { ProviderCapabilities } from '../domain/interfaces/IProvider.js';

export const VENDOR_CAPABILITIES: Record<string, ProviderCapabilities> = {
  [Vendor.OpenAI]: {
    text: true,
    images: true,
    videos: false,
    audio: true,
    features: {
      imageGeneration: true,
      imageEdit: true,
      imageVariation: true,
      imageAnalysis: true,
      textToSpeech: true,
      speechToText: true,
    },
  },

  [Vendor.Anthropic]: {
    text: true,
    images: false,
    videos: false,
    audio: false,
    features: {
      imageAnalysis: true,
    },
  },

  [Vendor.Google]: {
    text: true,
    images: true,
    videos: true,
    audio: true,
    features: {
      imageGeneration: true,
      imageEdit: true,
      imageAnalysis: true,
      textToSpeech: true,
      speechToText: true,
      videoGeneration: true,
    },
  },

  [Vendor.Groq]: {
    text: true,
    images: false,
    videos: false,
    audio: true,
    features: {
      speechToText: true,
    },
  },
};

export function vendorSupports(
  vendor: string,
  capability: keyof ProviderCapabilities | keyof ProviderCapabilities['features']
): boolean {
  const caps = VENDOR_CAPABILITIES[vendor];
  if (!caps) return false;

  if (capability in caps) {
    return Boolean(caps[capability as keyof ProviderCapabilities]);
  }

  return Boolean(caps.features?.[capability as keyof ProviderCapabilities['features']]);
}

export function vendorsWithCapability(capability: string): string[] {
  return Object.entries(VENDOR_CAPABILITIES)
    .filter(([_, caps]) => vendorSupports(_, capability as any))
    .map(([vendor]) => vendor);
}
```

---

## File Structure

```
src/
├── core/
│   ├── index.ts
│   ├── Vendor.ts                       # (existing)
│   ├── Connector.ts                    # (existing)
│   ├── Agent.ts                        # (existing - text only)
│   │
│   │ # NEW CAPABILITY CLASSES
│   ├── ImageGenerator.ts
│   ├── VideoGenerator.ts
│   ├── TextToSpeech.ts
│   ├── SpeechToText.ts
│   │
│   │ # NEW FACTORIES
│   ├── createProvider.ts              # (existing - text)
│   ├── createImageProvider.ts
│   ├── createVideoProvider.ts
│   ├── createAudioProvider.ts         # TTS + STT
│   │
│   └── VendorCapabilities.ts
│
├── domain/
│   ├── types/
│   │   └── SharedTypes.ts              # NEW: Base types, VendorOptionSchema
│   │
│   ├── entities/
│   │   ├── Model.ts                    # (existing - LLMs)
│   │   ├── RegistryUtils.ts            # NEW: Generic helpers
│   │   ├── SharedVoices.ts             # NEW: Voice/language constants
│   │   ├── ImageModel.ts               # NEW
│   │   ├── TTSModel.ts                 # NEW
│   │   ├── STTModel.ts                 # NEW
│   │   ├── VideoModel.ts               # NEW
│   │   └── index.ts                    # Re-exports all
│   │
│   ├── interfaces/
│   │   ├── IProvider.ts                # (extend capabilities)
│   │   ├── ITextProvider.ts            # (existing)
│   │   ├── IImageProvider.ts           # NEW
│   │   ├── IAudioProvider.ts           # NEW: TTS + STT
│   │   └── IVideoProvider.ts           # NEW
│   │
│   └── validation/
│       ├── BaseOptionsValidator.ts     # NEW: Shared validation
│       └── ImageOptionsValidator.ts    # NEW
│
├── infrastructure/
│   └── providers/
│       ├── base/
│       │   ├── BaseTextProvider.ts     # (existing)
│       │   └── BaseMediaProvider.ts    # NEW: Shared media base
│       │
│       ├── openai/
│       │   ├── OpenAITextProvider.ts   # (existing)
│       │   ├── OpenAIImageProvider.ts  # NEW
│       │   ├── OpenAITTSProvider.ts    # NEW
│       │   └── OpenAISTTProvider.ts    # NEW
│       │
│       ├── google/
│       │   ├── GoogleTextProvider.ts   # (existing)
│       │   ├── GoogleImageProvider.ts  # NEW
│       │   ├── GoogleVideoProvider.ts  # NEW
│       │   ├── GoogleTTSProvider.ts    # NEW
│       │   └── GoogleSTTProvider.ts    # NEW
│       │
│       └── elevenlabs/
│           └── ElevenLabsTTSProvider.ts # NEW
│
└── index.ts                            # Add new exports
```

---

## Implementation Phases

### Phase 1: Foundation (Week 1)
- [ ] Create `SharedTypes.ts` with base interfaces
- [ ] Create `RegistryUtils.ts` with generic helpers
- [ ] Create `SharedVoices.ts` with consolidated voice/language data
- [ ] Create `BaseMediaProvider.ts`
- [ ] Create `VendorCapabilities.ts`
- [ ] Create base validation classes

### Phase 2: Audio - OpenAI (Week 2)
- [ ] Implement `IAudioProvider` interfaces
- [ ] Implement `TTSModel.ts` registry
- [ ] Implement `STTModel.ts` registry
- [ ] Implement `OpenAITTSProvider`
- [ ] Implement `OpenAISTTProvider`
- [ ] Create `TextToSpeech` capability class
- [ ] Create `SpeechToText` capability class
- [ ] Add tests

### Phase 3: Images (Week 3)
- [ ] Implement `IImageProvider` interface
- [ ] Implement `ImageModel.ts` registry
- [ ] Implement `OpenAIImageProvider`
- [ ] Create `ImageGenerator` capability class
- [ ] Implement `ImageOptionsValidator`
- [ ] Add tests

### Phase 4: Google Multi-Modal (Week 4)
- [ ] Implement `GoogleImageProvider` (Imagen)
- [ ] Implement `GoogleTTSProvider`
- [ ] Implement `GoogleSTTProvider`
- [ ] Implement `VideoModel.ts` registry
- [ ] Implement `GoogleVideoProvider` (Veo)
- [ ] Create `VideoGenerator` capability class
- [ ] Add tests

### Phase 5: Specialty Providers (Week 5)
- [ ] ElevenLabs TTS
- [ ] AssemblyAI STT
- [ ] Groq STT (Whisper)
- [ ] Stability AI images
- [ ] Runway video
- [ ] Luma video

### Phase 6: Polish (Week 6)
- [ ] Documentation
- [ ] Examples
- [ ] Integration tests
- [ ] Performance optimization

---

## Key Design Decisions Summary

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Agent vs separate classes | Separate classes | SRP, tree-shaking, cleaner types |
| Interface per capability | Yes | Type safety, optional methods |
| Base model interface | `IBaseModelDescription` | DRY, consistent structure |
| Registry helpers | Generic factory | Eliminates code duplication |
| Voice/language data | Centralized constants | Single source of truth |
| Capability checking | Static matrix + runtime | Fast lookups, graceful errors |
| Base providers | `BaseMediaProvider` | Shared circuit breaker, logging |
| Validation | Domain layer + inheritance | Reusable, testable |
| Streaming support | AsyncIterator | Consistent with text |
| Vendor options | `vendorOptions` passthrough | Power user escape hatch |

---

## Usage Examples

### Multi-Modal Pipeline

```typescript
import { Connector, Agent, ImageGenerator, TextToSpeech, SpeechToText, Vendor } from 'oneringai';

// Single connector for all capabilities
Connector.create({
  name: 'openai',
  vendor: Vendor.OpenAI,
  auth: { type: 'api_key', apiKey: process.env.OPENAI_API_KEY! },
});

// Voice assistant pipeline
const stt = SpeechToText.create({ connector: 'openai' });
const agent = Agent.create({ connector: 'openai', model: 'gpt-4' });
const tts = TextToSpeech.create({ connector: 'openai', voice: 'nova' });

const transcription = await stt.transcribe(userAudio);
const response = await agent.run(transcription.text);
const audio = await tts.synthesize(response.output_text);

// Image generation with validation
const imageGen = ImageGenerator.create({ connector: 'openai', model: 'gpt-image-1' });

const validation = imageGen.validateOptions({
  model: 'gpt-image-1',
  prompt: 'A sunset',
  aspectRatio: '21:9',  // Not supported - will error
});

if (!validation.valid) {
  console.log(validation.errors[0].message);
}

// Generate with supported options
const image = await imageGen.generate('A serene Japanese garden', {
  aspectRatio: '16:9',
  quality: 'high',
  style: 'photographic',
});
```

---

## Open Questions

1. **Unified MediaProcessor?** - Consider fluent pipeline API for v2
2. **Caching?** - Strategy for expensive operations
3. **Real-time audio?** - WebSocket support for live transcription
4. **Dynamic capability fetch?** - Fetch voice lists from APIs at runtime
5. **Cost tracking?** - Integration with billing/usage monitoring

---

## Conclusion

This architecture:

1. **Preserves backward compatibility** - Agent class unchanged
2. **Follows DRY principles** - Shared base types, utilities, and constants
3. **Maintains consistency** - All registries use same structure
4. **Enables tree-shaking** - Import only what you use
5. **Provides clear capability checking** - Know upfront what works
6. **Supports streaming** - For real-time TTS/STT
7. **Handles async operations** - Video generation with progress
8. **Is extensible** - Easy to add new vendors/capabilities
9. **Validates gracefully** - Errors for invalid, warnings for adjusted
10. **Provides escape hatches** - `vendorOptions` for power users

**Lines of code reduction: ~60%** through:
- Shared base interfaces (~200 lines saved)
- Generic registry helpers (~150 lines saved)
- Consolidated voice/language data (~400 lines saved)
- Shared capability presets (~200 lines saved)
- Base validation classes (~100 lines saved)
