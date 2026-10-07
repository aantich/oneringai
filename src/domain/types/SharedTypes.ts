/**
 * Shared types used across all multimodal capabilities
 * This file provides the foundation for Image, Audio, and Video model registries
 */

import type { Vendor as VendorType } from '../../core/Vendor.js';

/** Current public model-registry contract. Version 2 adds lifecycle, aliases, endpoints, sources, and modality-aware pricing. */
export const MODEL_REGISTRY_SCHEMA_VERSION = 2 as const;

/** Lifecycle state published by the model vendor. */
export type ModelLifecycleStatus =
  | 'preview'
  | 'active'
  | 'legacy'
  | 'deprecated'
  | 'retired';

/** Commercial/access scope for models that are not universally available. */
export type ModelAvailability =
  | 'public'
  | 'limited'
  | 'invite_only'
  | 'enterprise'
  | 'region_limited';

/** Normalized API surfaces used by the first-party provider adapters. */
export type ModelEndpoint =
  | 'responses'
  | 'decisions'
  | 'chat_completions'
  | 'completions'
  | 'messages'
  | 'generate_content'
  | 'interactions'
  | 'live'
  | 'realtime'
  | 'batch'
  | 'image_generation'
  | 'image_edit'
  | 'video_generation'
  | 'video_edit'
  | 'audio_speech'
  | 'audio_transcription'
  | 'embeddings';

// =============================================================================
// Semantic Types - Normalized across vendors
// =============================================================================

/**
 * Aspect ratios - normalized across all visual modalities (images, video)
 */
export type AspectRatio = '1:1' | '16:9' | '9:16' | '4:3' | '3:4' | '21:9' | '3:2' | '2:3';

/**
 * Quality levels - normalized across vendors
 * Providers map these to vendor-specific quality settings
 */
export type QualityLevel = 'draft' | 'standard' | 'high' | 'ultra';

/**
 * Audio output formats
 */
export type AudioFormat = 'mp3' | 'opus' | 'aac' | 'flac' | 'wav' | 'pcm' | 'ogg' | 'mulaw' | 'alaw';

/**
 * Output format preference for media
 */
export type OutputFormat = 'url' | 'base64' | 'buffer';

// =============================================================================
// Model Registry Base Types
// =============================================================================

/**
 * Source links for model documentation and maintenance
 * Used to track where information came from and when it was last verified
 */
export interface ISourceLinks {
  /** Official documentation URL */
  documentation: string;
  /** Pricing page URL */
  pricing?: string;
  /** API reference URL */
  apiReference?: string;
  /** Additional reference (e.g., blog post, announcement) */
  additional?: string;
  /** Last verified date (YYYY-MM-DD) */
  lastVerified: string;
}

/**
 * Vendor-specific option schema for validation and documentation
 * Used to describe vendor-specific options that fall outside semantic options
 */
export interface VendorOptionSchema {
  /** Data type of the option */
  type: 'string' | 'number' | 'boolean' | 'enum' | 'array' | 'object';
  /** Description of the option */
  description: string;
  /** Whether the option is required */
  required?: boolean;
  /** UI display label */
  label?: string;
  /** Valid values for enum/string types */
  enum?: string[];
  /** Default value */
  default?: unknown;
  /** Minimum value for numbers */
  min?: number;
  /** Maximum value for numbers */
  max?: number;
  /** Step value for number sliders */
  step?: number;
  /** UI control type hint */
  controlType?: 'select' | 'radio' | 'slider' | 'checkbox' | 'text' | 'textarea';
}

/**
 * Base model description - shared by all registries
 * Every model registry (Image, TTS, STT, Video) extends this
 */
export interface IBaseModelDescription {
  /** Model identifier (e.g., "gpt-image-2", "tts-1") */
  name: string;

  /** Display name for UI (e.g., "DALL-E 3", "TTS-1") */
  displayName: string;

  /** Vendor/provider */
  provider: VendorType;

  /** Model description */
  description?: string;

  /** Whether the model is currently available */
  isActive: boolean;

  /** Whether this is a vendor-recommended/default choice for its modality. */
  preferred?: boolean;

  /** Vendor-published lifecycle. `isActive` remains for backward compatibility. */
  lifecycle?: ModelLifecycleStatus;

  /** Access scope when the model is not generally available to every account. */
  availability?: ModelAvailability;

  /** Alternate model IDs accepted by the provider. */
  aliases?: readonly string[];

  /** Pinned versions behind this family entry. */
  snapshots?: readonly string[];

  /** Normalized API endpoints on which the model is supported. */
  endpoints?: readonly ModelEndpoint[];

  /** Release date (YYYY-MM-DD) */
  releaseDate?: string;

  /** Deprecation date if scheduled (YYYY-MM-DD) */
  deprecationDate?: string;

  /** Final shutdown date, after which requests fail or are redirected. */
  retirementDate?: string;

  /** Recommended migration target. */
  replacementModel?: string;

  /** Documentation/pricing links for maintenance */
  sources: ISourceLinks;
}
