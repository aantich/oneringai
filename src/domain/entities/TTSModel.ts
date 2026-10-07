/**
 * Text-to-Speech model registry with comprehensive metadata
 */

import { Vendor } from '../../core/Vendor.js';
import type { IBaseModelDescription, AudioFormat, VendorOptionSchema } from '../types/SharedTypes.js';
import { assertNoRegistryAliasCollisions, createRegistryHelpers } from './RegistryUtils.js';
import { OPENAI_VOICES, GEMINI_VOICES, XAI_VOICES, GEMINI_TTS_LANGUAGES, COMMON_LANGUAGES, AUDIO_FORMATS, type IVoiceInfo } from './SharedVoices.js';

// Re-export IVoiceInfo for public API
export type { IVoiceInfo } from './SharedVoices.js';

// =============================================================================
// Types
// =============================================================================

/**
 * TTS model capabilities
 */
export interface TTSModelCapabilities {
  /** Available voices (empty array means fetch dynamically via API) */
  voices: IVoiceInfo[];

  /** Supported output formats */
  formats: readonly AudioFormat[] | AudioFormat[];

  /** Supported languages (ISO-639-1 codes) */
  languages: readonly string[] | string[];

  /** Speed control support */
  speed: {
    supported: boolean;
    min?: number;
    max?: number;
    default?: number;
  };

  /** Feature support flags */
  features: {
    /** Real-time streaming support */
    streaming: boolean;
    /** SSML markup support */
    ssml: boolean;
    /** Emotion/style control */
    emotions: boolean;
    /** Custom voice cloning */
    voiceCloning: boolean;
    /** Word-level timestamps */
    wordTimestamps: boolean;
    /** Instruction steering (prompt-based style control) */
    instructionSteering?: boolean;
  };

  /** Model limits */
  limits: {
    /** Maximum input length in characters */
    maxInputLength: number;
    /** Rate limit (requests per minute) */
    maxRequestsPerMinute?: number;
  };

  /** Vendor-specific options schema */
  vendorOptions?: Record<string, VendorOptionSchema>;
}

/**
 * TTS model pricing
 */
export interface TTSModelPricing {
  /** Cost per 1,000 characters (OpenAI) */
  per1kCharacters?: number;
  /** Cost per 1M input tokens (Google) */
  perMInputTokens?: number;
  /** Cost per 1M output tokens (Google) */
  perMOutputTokens?: number;
  currency: 'USD';
}

/**
 * Complete TTS model description
 */
export interface ITTSModelDescription extends IBaseModelDescription {
  capabilities: TTSModelCapabilities;
  pricing?: TTSModelPricing;
}

// =============================================================================
// Model Constants
// =============================================================================

export const TTS_MODELS = {
  [Vendor.OpenAI]: {
    /** NEW: Instruction-steerable TTS with emotional control */
    GPT_4O_MINI_TTS: 'gpt-4o-mini-tts',
    /** Fast, low-latency TTS */
    TTS_1: 'tts-1',
    /** High-definition TTS */
    TTS_1_HD: 'tts-1-hd',
  },
  [Vendor.Google]: {
    /** Flagship creative TTS with voice design and replication. */
    GEMINI_3_8_FLASH_TTS: 'gemini-3.8-flash-tts',
    /** Cost-efficient, low-latency TTS with voice replication. */
    GEMINI_3_8_FLASH_LITE_TTS: 'gemini-3.8-flash-lite-tts',
    /** Current controllable low-latency Gemini TTS preview. */
    GEMINI_3_1_FLASH_TTS: 'gemini-3.1-flash-tts-preview',
    /** Gemini 2.5 Flash TTS (optimized for low latency) */
    GEMINI_2_5_FLASH_TTS: 'gemini-2.5-flash-preview-tts',
    /** Gemini 2.5 Pro TTS (optimized for quality) */
    GEMINI_2_5_PRO_TTS: 'gemini-2.5-pro-preview-tts',
  },
  [Vendor.Grok]: {
    /** xAI Text-to-Speech endpoint (the API does not require a model field). */
    XAI_TTS: 'xai-tts',
  },
} as const;

// =============================================================================
// Shared Capability Presets (DRY)
// =============================================================================

/**
 * Base OpenAI TTS capabilities (shared across models)
 */
const OPENAI_TTS_BASE: Omit<TTSModelCapabilities, 'features' | 'limits'> = {
  voices: OPENAI_VOICES,
  formats: AUDIO_FORMATS.OPENAI_TTS,
  languages: COMMON_LANGUAGES.OPENAI_TTS,
  speed: { supported: true, min: 0.25, max: 4.0, default: 1.0 },
};

// =============================================================================
// Registry
// =============================================================================

/**
 * Complete TTS model registry
 * Last full audit: October 2026
 */
export const TTS_MODEL_REGISTRY: Record<string, ITTSModelDescription> = {
  // ======================== OpenAI ========================

  'gpt-4o-mini-tts': {
    name: 'gpt-4o-mini-tts',
    displayName: 'GPT-4o Mini TTS',
    provider: Vendor.OpenAI,
    description: 'Instruction-steerable TTS with emotional control via prompts',
    isActive: true,
    releaseDate: '2025-03-01',
    sources: {
      documentation: 'https://platform.openai.com/docs/guides/text-to-speech',
      pricing: 'https://openai.com/pricing',
      lastVerified: '2026-08-30',
    },
    capabilities: {
      ...OPENAI_TTS_BASE,
      features: {
        streaming: false, // Not implementing streaming in v1
        ssml: false,
        emotions: true, // Via instruction steering
        voiceCloning: true,
        wordTimestamps: false,
        instructionSteering: true,
      },
      limits: { maxInputLength: 2000 },
      vendorOptions: {
        instructions: {
          type: 'string',
          description: 'Natural language instructions for voice style (e.g., "speak like a calm meditation guide")',
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
      lastVerified: '2026-08-30',
    },
    capabilities: {
      ...OPENAI_TTS_BASE,
      features: {
        streaming: false, // Not implementing streaming in v1
        ssml: false,
        emotions: false,
        voiceCloning: false,
        wordTimestamps: false,
      },
      limits: { maxInputLength: 4096 },
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
      lastVerified: '2026-08-30',
    },
    capabilities: {
      ...OPENAI_TTS_BASE,
      features: {
        streaming: false, // Not implementing streaming in v1
        ssml: false,
        emotions: false,
        voiceCloning: false,
        wordTimestamps: false,
      },
      limits: { maxInputLength: 4096 },
    },
    pricing: { per1kCharacters: 0.030, currency: 'USD' },
  },

  // ======================== Google ========================

  'gemini-3.8-flash-tts': {
    name: 'gemini-3.8-flash-tts',
    displayName: 'Gemini 3.8 Flash TTS',
    provider: Vendor.Google,
    description: 'Flagship creative TTS for studio-grade fidelity, expressive acting, regional dialects, voice design, and replication',
    isActive: true,
    lifecycle: 'active',
    availability: 'public',
    preferred: true,
    endpoints: ['audio_speech', 'generate_content', 'batch'],
    releaseDate: '2026-09-22',
    sources: { documentation: 'https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash-tts', pricing: 'https://ai.google.dev/gemini-api/docs/pricing', lastVerified: '2026-10-07' },
    capabilities: {
      voices: GEMINI_VOICES,
      formats: ['wav'],
      languages: [...GEMINI_TTS_LANGUAGES],
      speed: { supported: false },
      features: { streaming: false, ssml: false, emotions: true, voiceCloning: true, wordTimestamps: false, instructionSteering: true },
      limits: { maxInputLength: 8192 },
      vendorOptions: {
        stylePrompt: { type: 'string', description: 'Natural-language narration and delivery instructions' },
        voiceId: { type: 'string', description: 'Extended-library, designed, or replicated voice resource ID' },
      },
    },
    pricing: { perMInputTokens: 1, perMOutputTokens: 20, currency: 'USD' },
  },

  'gemini-3.8-flash-lite-tts': {
    name: 'gemini-3.8-flash-lite-tts',
    displayName: 'Gemini 3.8 Flash-Lite TTS',
    provider: Vendor.Google,
    description: 'Fast, cost-efficient TTS for high-throughput speech, voice-agent cascades, and voice replication',
    isActive: true,
    lifecycle: 'active',
    availability: 'public',
    preferred: true,
    endpoints: ['audio_speech', 'generate_content', 'batch'],
    releaseDate: '2026-09-22',
    sources: { documentation: 'https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash-lite-tts', pricing: 'https://ai.google.dev/gemini-api/docs/pricing', lastVerified: '2026-10-07' },
    capabilities: {
      voices: GEMINI_VOICES,
      formats: ['wav'],
      languages: [...GEMINI_TTS_LANGUAGES],
      speed: { supported: false },
      features: { streaming: false, ssml: false, emotions: true, voiceCloning: true, wordTimestamps: false, instructionSteering: true },
      limits: { maxInputLength: 8192 },
      vendorOptions: {
        stylePrompt: { type: 'string', description: 'Natural-language narration and delivery instructions' },
        voiceId: { type: 'string', description: 'Extended-library, designed, or replicated voice resource ID' },
      },
    },
    pricing: { perMInputTokens: 0.5, perMOutputTokens: 6, currency: 'USD' },
  },

  'gemini-3.1-flash-tts-preview': {
    name: 'gemini-3.1-flash-tts-preview',
    displayName: 'Gemini 3.1 Flash TTS Preview',
    provider: Vendor.Google,
    description: 'Current low-latency Gemini speech model with steerable prompts and expressive audio tags',
    isActive: true,
    lifecycle: 'legacy',
    availability: 'public',
    replacementModel: 'gemini-3.8-flash-lite-tts',
    endpoints: ['audio_speech', 'generate_content', 'batch'],
    releaseDate: '2026-04-01',
    sources: {
      documentation: 'https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-tts-preview',
      pricing: 'https://ai.google.dev/gemini-api/docs/pricing',
      lastVerified: '2026-08-30',
    },
    capabilities: {
      voices: GEMINI_VOICES,
      formats: ['wav'],
      languages: [...GEMINI_TTS_LANGUAGES],
      speed: { supported: false },
      features: {
        streaming: false, ssml: false, emotions: true, voiceCloning: false,
        wordTimestamps: false, instructionSteering: true,
      },
      limits: { maxInputLength: 8192 },
      vendorOptions: {
        stylePrompt: { type: 'string', description: 'Natural-language narration and delivery instructions' },
      },
    },
    pricing: { perMInputTokens: 1, perMOutputTokens: 20, currency: 'USD' },
  },

  'gemini-2.5-flash-preview-tts': {
    name: 'gemini-2.5-flash-preview-tts',
    displayName: 'Gemini 2.5 Flash TTS',
    provider: Vendor.Google,
    description: 'Google Gemini 2.5 Flash TTS - optimized for low latency, 30 voices, 70+ languages',
    isActive: true,
    lifecycle: 'deprecated',
    deprecationDate: '2026-09-22',
    retirementDate: '2026-11-17',
    replacementModel: 'gemini-3.8-flash-lite-tts',
    releaseDate: '2025-01-01',
    sources: {
      documentation: 'https://ai.google.dev/gemini-api/docs/speech-generation',
      pricing: 'https://ai.google.dev/pricing',
      lastVerified: '2026-08-30',
    },
    capabilities: {
      voices: GEMINI_VOICES,
      formats: ['wav'] as const, // PCM output, 24kHz 16-bit mono
      languages: [...GEMINI_TTS_LANGUAGES],
      speed: { supported: false }, // Speed not directly configurable
      features: {
        streaming: false, // Not implementing streaming in v1
        ssml: false,
        emotions: true, // Supports affective dialogue
        voiceCloning: false,
        wordTimestamps: false,
      },
      limits: { maxInputLength: 32000 }, // 32k token context window
    },
    pricing: {
      perMInputTokens: 0.50, // $0.50 per 1M input tokens
      perMOutputTokens: 10.00, // $10.00 per 1M output tokens
      currency: 'USD',
    },
  },

  'gemini-2.5-pro-preview-tts': {
    name: 'gemini-2.5-pro-preview-tts',
    displayName: 'Gemini 2.5 Pro TTS',
    provider: Vendor.Google,
    description: 'Google Gemini 2.5 Pro TTS - optimized for quality, 30 voices, 70+ languages',
    isActive: true,
    lifecycle: 'deprecated',
    deprecationDate: '2026-09-22',
    retirementDate: '2026-11-17',
    replacementModel: 'gemini-3.8-flash-tts',
    releaseDate: '2025-01-01',
    sources: {
      documentation: 'https://ai.google.dev/gemini-api/docs/speech-generation',
      pricing: 'https://ai.google.dev/pricing',
      lastVerified: '2026-08-30',
    },
    capabilities: {
      voices: GEMINI_VOICES,
      formats: ['wav'] as const, // PCM output, 24kHz 16-bit mono
      languages: [...GEMINI_TTS_LANGUAGES],
      speed: { supported: false }, // Speed not directly configurable
      features: {
        streaming: false, // Not implementing streaming in v1
        ssml: false,
        emotions: true, // Supports affective dialogue
        voiceCloning: false,
        wordTimestamps: false,
      },
      limits: { maxInputLength: 32000 }, // 32k token context window
    },
    pricing: {
      perMInputTokens: 1.00, // $1.00 per 1M input tokens
      perMOutputTokens: 20.00, // $20.00 per 1M output tokens
      currency: 'USD',
    },
  },

  // ======================== xAI ========================

  'xai-tts': {
    name: 'xai-tts',
    displayName: 'xAI Text to Speech',
    provider: Vendor.Grok,
    description: 'Expressive multilingual xAI speech synthesis with inline speech tags and telephony codecs',
    isActive: true,
    lifecycle: 'active',
    availability: 'public',
    preferred: true,
    endpoints: ['audio_speech'],
    releaseDate: '2026-07-23',
    sources: {
      documentation: 'https://docs.x.ai/developers/model-capabilities/audio/text-to-speech',
      pricing: 'https://docs.x.ai/developers/pricing',
      lastVerified: '2026-08-30',
    },
    capabilities: {
      voices: XAI_VOICES,
      formats: ['mp3', 'wav', 'pcm', 'mulaw', 'alaw'],
      languages: ['auto', ...COMMON_LANGUAGES.CORE],
      speed: { supported: true, min: 0.7, max: 1.5, default: 1 },
      features: {
        streaming: true, ssml: false, emotions: true, voiceCloning: true,
        wordTimestamps: true, instructionSteering: true,
      },
      limits: { maxInputLength: 15000 },
      vendorOptions: {
        language: { type: 'string', description: 'BCP-47 language code or automatic detection', default: 'auto' },
        output_format: { type: 'object', description: 'xAI codec, sample-rate, and bitrate configuration' },
        optimize_streaming_latency: { type: 'number', description: 'Latency optimization level', min: 0, max: 2, default: 0 },
        text_normalization: { type: 'boolean', description: 'Normalize numbers and symbols before synthesis', default: false },
        with_timestamps: { type: 'boolean', description: 'Return character-level timing metadata', default: false },
      },
    },
    pricing: { per1kCharacters: 0.015, currency: 'USD' },
  },
};

// =============================================================================
// Helper Functions (using shared utilities)
// =============================================================================

assertNoRegistryAliasCollisions(TTS_MODEL_REGISTRY, 'TTS_MODEL_REGISTRY');
const helpers = createRegistryHelpers(TTS_MODEL_REGISTRY);

export const getTTSModelInfo = helpers.getInfo;
export const getTTSModelsByVendor = helpers.getByVendor;
export const getActiveTTSModels = helpers.getActive;
/** Get active TTS models with a published deprecation notice. */
export const getDeprecatedTTSModels = helpers.getDeprecated;

/**
 * Get TTS models that support a specific feature
 */
export function getTTSModelsWithFeature(
  feature: keyof ITTSModelDescription['capabilities']['features']
): ITTSModelDescription[] {
  return Object.values(TTS_MODEL_REGISTRY).filter(
    (model) => model.isActive && model.capabilities.features[feature]
  );
}

/**
 * Calculate estimated cost for TTS
 * For OpenAI models: based on character count
 * For Google models: based on input/output token count
 */
export function calculateTTSCost(
  modelName: string,
  characterCount: number,
  options?: { inputTokens?: number; outputTokens?: number }
): number | null {
  const model = getTTSModelInfo(modelName);
  if (!model?.pricing) return null;

  // OpenAI character-based pricing
  if (model.pricing.per1kCharacters) {
    return (characterCount / 1000) * model.pricing.per1kCharacters;
  }

  // Google token-based pricing
  if (model.pricing.perMInputTokens && options?.inputTokens != null) {
    const inputCost = (options.inputTokens / 1_000_000) * model.pricing.perMInputTokens;
    const outputCost = options.outputTokens
      ? (options.outputTokens / 1_000_000) * (model.pricing.perMOutputTokens ?? 0)
      : 0;
    return inputCost + outputCost;
  }

  return null;
}
