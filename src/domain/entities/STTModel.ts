/**
 * Speech-to-Text model registry with comprehensive metadata
 */

import { Vendor } from '../../core/Vendor.js';
import type { IBaseModelDescription, VendorOptionSchema } from '../types/SharedTypes.js';
import { assertNoRegistryAliasCollisions, createRegistryHelpers } from './RegistryUtils.js';
import { AUDIO_FORMATS } from './SharedVoices.js';

// =============================================================================
// Types
// =============================================================================

/**
 * STT output format types
 */
export type STTOutputFormat = 'json' | 'text' | 'srt' | 'vtt' | 'verbose_json';

/**
 * STT model capabilities
 */
export interface STTModelCapabilities {
  /** Supported input audio formats */
  inputFormats: readonly string[] | string[];

  /** Supported output formats */
  outputFormats: STTOutputFormat[];

  /** Supported languages (empty = auto-detect all) */
  languages: string[];

  /** Timestamp support */
  timestamps: {
    supported: boolean;
    granularities?: ('word' | 'segment')[];
  };

  /** Feature support flags */
  features: {
    /** Translation to English */
    translation: boolean;
    /** Speaker identification */
    diarization: boolean;
    /** Real-time streaming */
    streaming: boolean;
    /** Automatic punctuation */
    punctuation: boolean;
    /** Profanity filtering */
    profanityFilter: boolean;
  };

  /** Model limits */
  limits: {
    /** Maximum file size in MB */
    maxFileSizeMB: number;
    /** Maximum duration in seconds */
    maxDurationSeconds?: number;
  };

  /** Vendor-specific options schema */
  vendorOptions?: Record<string, VendorOptionSchema>;
}

/**
 * STT model pricing
 */
export interface STTModelPricing {
  /** Cost per minute of audio */
  perMinute?: number;
  /** Streaming WebSocket price per minute when it differs from batch/file transcription. */
  streamingPerMinute?: number;
  /** Audio-input token price for general multimodal models. */
  perMInputTokens?: number;
  currency: 'USD';
}

/**
 * Complete STT model description
 */
export interface ISTTModelDescription extends IBaseModelDescription {
  capabilities: STTModelCapabilities;
  pricing?: STTModelPricing;
}

// =============================================================================
// Model Constants
// =============================================================================

export const STT_MODELS = {
  [Vendor.OpenAI]: {
    /** Current file transcription model. */
    GPT_TRANSCRIBE: 'gpt-transcribe',
    /** Cost-efficient GPT-4o transcription model. */
    GPT_4O_MINI_TRANSCRIBE: 'gpt-4o-mini-transcribe',
    /** Recommended low-latency streaming transcription model */
    GPT_LIVE_TRANSCRIBE: 'gpt-live-transcribe',
    /** Streaming transcription over the Realtime API */
    GPT_REALTIME_WHISPER: 'gpt-realtime-whisper',
    /** NEW: GPT-4o based transcription */
    GPT_4O_TRANSCRIBE: 'gpt-4o-transcribe',
    /** NEW: GPT-4o with speaker diarization */
    GPT_4O_TRANSCRIBE_DIARIZE: 'gpt-4o-transcribe-diarize',
    /** Classic Whisper */
    WHISPER_1: 'whisper-1',
  },
  [Vendor.Google]: {
    /** Dedicated file-transcription model with diarization and word timestamps. */
    GEMINI_3_5_TRANSCRIBE: 'gemini-3.5-transcribe',
    /** Dedicated bidirectional streaming transcription model. */
    GEMINI_3_5_TRANSCRIBE_LIVE: 'gemini-3.5-transcribe-live',
    /** Current Gemini model used for general audio transcription. */
    GEMINI_3_6_FLASH: 'gemini-3.6-flash',
  },
  [Vendor.Grok]: {
    /** Current xAI file and streaming transcription model. */
    GROK_VOICE_TRANSCRIBE_2: 'grok-voice-transcribe-2.0',
    /** Legacy library alias retained for compatibility. */
    XAI_STT: 'xai-stt',
  },
  [Vendor.Groq]: {
    /** Ultra-fast Whisper on Groq LPUs */
    WHISPER_LARGE_V3: 'whisper-large-v3',
    /** Current cost-optimized multilingual Whisper variant. */
    WHISPER_LARGE_V3_TURBO: 'whisper-large-v3-turbo',
    /** Faster English-only variant */
    DISTIL_WHISPER: 'distil-whisper-large-v3-en',
  },
} as const;

// =============================================================================
// Shared Capability Presets (DRY)
// =============================================================================

/**
 * Base Whisper capabilities (shared across OpenAI/Groq models)
 */
const WHISPER_BASE_CAPABILITIES: Omit<STTModelCapabilities, 'features' | 'limits'> = {
  inputFormats: AUDIO_FORMATS.STT_INPUT,
  outputFormats: ['json', 'text', 'srt', 'vtt', 'verbose_json'],
  languages: [], // Auto-detect, 50+ languages
  timestamps: { supported: true, granularities: ['word', 'segment'] },
};

// =============================================================================
// Registry
// =============================================================================

/**
 * Complete STT model registry
 * Last full audit: October 2026
 */
export const STT_MODEL_REGISTRY: Record<string, ISTTModelDescription> = {
  // ======================== OpenAI ========================

  'gpt-transcribe': {
    name: 'gpt-transcribe',
    displayName: 'GPT Transcribe',
    provider: Vendor.OpenAI,
    description: 'Current accurate file-transcription model for multilingual audio',
    isActive: true,
    lifecycle: 'active',
    availability: 'public',
    preferred: true,
    endpoints: ['audio_transcription'],
    releaseDate: '2026-07-09',
    sources: {
      documentation: 'https://developers.openai.com/api/docs/models/gpt-transcribe',
      pricing: 'https://developers.openai.com/api/docs/pricing',
      lastVerified: '2026-08-30',
    },
    capabilities: {
      ...WHISPER_BASE_CAPABILITIES,
      outputFormats: ['json', 'text'],
      features: { translation: false, diarization: false, streaming: false, punctuation: true, profanityFilter: false },
      limits: { maxFileSizeMB: 25, maxDurationSeconds: 7200 },
    },
    pricing: { perMinute: 0.0045, currency: 'USD' },
  },

  'gpt-4o-mini-transcribe': {
    name: 'gpt-4o-mini-transcribe',
    displayName: 'GPT-4o Mini Transcribe',
    provider: Vendor.OpenAI,
    description: 'Cost-efficient GPT-4o transcription for high-volume workloads',
    isActive: true,
    lifecycle: 'active',
    availability: 'public',
    endpoints: ['audio_transcription'],
    releaseDate: '2025-03-20',
    sources: {
      documentation: 'https://developers.openai.com/api/docs/models/gpt-4o-mini-transcribe',
      pricing: 'https://developers.openai.com/api/docs/pricing',
      lastVerified: '2026-08-30',
    },
    capabilities: {
      ...WHISPER_BASE_CAPABILITIES,
      outputFormats: ['json', 'text'],
      features: { translation: false, diarization: false, streaming: false, punctuation: true, profanityFilter: false },
      limits: { maxFileSizeMB: 25, maxDurationSeconds: 7200 },
    },
    pricing: { perMinute: 0.003, currency: 'USD' },
  },

  'gpt-live-transcribe': {
    name: 'gpt-live-transcribe',
    displayName: 'GPT Live Transcribe',
    provider: Vendor.OpenAI,
    description: 'Recommended streaming speech-to-text model with incremental transcript deltas, vocabulary hints, multilingual hints, and tunable latency',
    isActive: true,
    sources: {
      documentation: 'https://developers.openai.com/api/docs/models/gpt-live-transcribe',
      pricing: 'https://developers.openai.com/api/docs/pricing',
      lastVerified: '2026-08-30',
    },
    capabilities: {
      ...WHISPER_BASE_CAPABILITIES,
      outputFormats: ['json', 'text'],
      features: {
        translation: false,
        diarization: false,
        streaming: true,
        punctuation: true,
        profanityFilter: false,
      },
      limits: { maxFileSizeMB: 0 },
      vendorOptions: {
        delay: {
          type: 'string',
          description: 'Streaming transcript latency/accuracy tradeoff',
          default: 'low',
        },
        keywords: {
          type: 'array',
          description: 'Literal vocabulary hints such as product names and acronyms',
        },
        languages: {
          type: 'array',
          description: 'Expected ISO language codes; do not combine with language',
        },
      },
    },
    pricing: { perMinute: 0.017, currency: 'USD' },
  },

  'gpt-realtime-whisper': {
    name: 'gpt-realtime-whisper',
    displayName: 'GPT Realtime Whisper',
    provider: Vendor.OpenAI,
    description: 'Low-latency streaming speech-to-text model for realtime transcription',
    isActive: true,
    sources: {
      documentation: 'https://developers.openai.com/api/docs/models/gpt-realtime-whisper',
      pricing: 'https://developers.openai.com/api/docs/pricing',
      lastVerified: '2026-08-30',
    },
    capabilities: {
      ...WHISPER_BASE_CAPABILITIES,
      outputFormats: ['json', 'text'],
      features: {
        translation: false,
        diarization: false,
        streaming: true,
        punctuation: true,
        profanityFilter: false,
      },
      limits: { maxFileSizeMB: 0 },
    },
    pricing: { perMinute: 0.017, currency: 'USD' },
  },

  'gpt-4o-transcribe': {
    name: 'gpt-4o-transcribe',
    displayName: 'GPT-4o Transcribe',
    provider: Vendor.OpenAI,
    description: 'GPT-4o based transcription with superior accuracy and context understanding',
    isActive: true,
    releaseDate: '2025-04-01',
    sources: {
      documentation: 'https://platform.openai.com/docs/guides/speech-to-text',
      pricing: 'https://openai.com/pricing',
      lastVerified: '2026-08-30',
    },
    capabilities: {
      ...WHISPER_BASE_CAPABILITIES,
      features: {
        translation: true,
        diarization: false,
        streaming: false, // Not implementing streaming in v1
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
      lastVerified: '2026-08-30',
    },
    capabilities: {
      ...WHISPER_BASE_CAPABILITIES,
      outputFormats: ['json', 'verbose_json'],
      features: {
        translation: true,
        diarization: true, // Built-in speaker identification
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
    pricing: { perMinute: 0.012, currency: 'USD' }, // 2x for diarization
  },

  'whisper-1': {
    name: 'whisper-1',
    displayName: 'Whisper',
    provider: Vendor.OpenAI,
    description: "OpenAI's general-purpose speech recognition model",
    isActive: true,
    releaseDate: '2023-03-01',
    sources: {
      documentation: 'https://platform.openai.com/docs/guides/speech-to-text',
      pricing: 'https://openai.com/pricing',
      lastVerified: '2026-08-30',
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

  // ======================== Google ========================

  'gemini-3.5-transcribe': {
    name: 'gemini-3.5-transcribe',
    displayName: 'Gemini 3.5 Transcribe',
    provider: Vendor.Google,
    description: 'Dedicated file transcription with automatic language detection, diarization, word timestamps, and custom vocabulary',
    isActive: true,
    lifecycle: 'active',
    availability: 'public',
    preferred: true,
    endpoints: ['interactions'],
    releaseDate: '2026-08-26',
    sources: {
      documentation: 'https://ai.google.dev/gemini-api/docs/transcribe',
      pricing: 'https://ai.google.dev/gemini-api/docs/pricing',
      lastVerified: '2026-08-30',
    },
    capabilities: {
      ...WHISPER_BASE_CAPABILITIES,
      inputFormats: ['wav', 'mp3', 'aiff', 'aac', 'ogg', 'flac'],
      outputFormats: ['text'],
      timestamps: { supported: true, granularities: ['word', 'segment'] },
      features: { translation: false, diarization: true, streaming: false, punctuation: true, profanityFilter: false },
      limits: { maxFileSizeMB: 20, maxDurationSeconds: 34_200 },
      vendorOptions: {
        customVocabulary: { type: 'array', description: 'Up to 1,000 phrases to bias recognition toward' },
        diarizationMode: { type: 'string', description: 'Set to speaker to identify up to eight speakers' },
        transcriptionConfig: { type: 'object', description: 'Additional Gemini Interactions transcription_config fields' },
      },
    },
    pricing: { perMinute: 0.005, perMInputTokens: 2, currency: 'USD' },
  },

  'gemini-3.5-transcribe-live': {
    name: 'gemini-3.5-transcribe-live',
    displayName: 'Gemini 3.5 Transcribe Live',
    provider: Vendor.Google,
    description: 'Low-latency bidirectional WebSocket audio transcription',
    isActive: true,
    lifecycle: 'active',
    availability: 'public',
    endpoints: ['realtime'],
    releaseDate: '2026-08-26',
    sources: {
      documentation: 'https://ai.google.dev/gemini-api/docs/transcribe',
      pricing: 'https://ai.google.dev/gemini-api/docs/pricing',
      lastVerified: '2026-08-30',
    },
    capabilities: {
      ...WHISPER_BASE_CAPABILITIES,
      inputFormats: ['pcm', 'wav'],
      outputFormats: ['text'],
      timestamps: { supported: true, granularities: ['word', 'segment'] },
      features: { translation: false, diarization: true, streaming: true, punctuation: true, profanityFilter: false },
      limits: { maxFileSizeMB: 0 },
    },
    pricing: { perMinute: 0.009, streamingPerMinute: 0.009, perMInputTokens: 3.5, currency: 'USD' },
  },

  'gemini-3.6-flash': {
    name: 'gemini-3.6-flash',
    displayName: 'Gemini 3.6 Flash Audio Transcription',
    provider: Vendor.Google,
    description: 'Gemini Interactions transcription with language hints, normalized timestamps, diarization, and custom vocabulary',
    isActive: true,
    lifecycle: 'active',
    availability: 'public',
    endpoints: ['interactions'],
    releaseDate: '2026-07-21',
    sources: {
      documentation: 'https://ai.google.dev/gemini-api/docs/audio',
      pricing: 'https://ai.google.dev/gemini-api/docs/pricing',
      lastVerified: '2026-08-30',
    },
    capabilities: {
      ...WHISPER_BASE_CAPABILITIES,
      inputFormats: ['wav', 'mp3', 'aiff', 'aac', 'ogg', 'flac'],
      outputFormats: ['text'],
      timestamps: { supported: true, granularities: ['segment'] },
      features: { translation: true, diarization: true, streaming: false, punctuation: true, profanityFilter: false },
      limits: { maxFileSizeMB: 20, maxDurationSeconds: 34200 },
      vendorOptions: {
        instructions: { type: 'string', description: 'Custom transcription, translation, or extraction instructions' },
        customVocabulary: { type: 'array', description: 'Phrases to bias native speech recognition toward' },
        diarizationMode: { type: 'string', description: 'Set to speaker to include speaker labels on words' },
        transcriptionConfig: { type: 'object', description: 'Additional Gemini Interactions transcription_config fields' },
      },
    },
    pricing: { perMInputTokens: 1.5, currency: 'USD' },
  },

  // ======================== xAI ========================

  'grok-voice-transcribe-2.0': {
    name: 'grok-voice-transcribe-2.0',
    displayName: 'Grok Voice Transcribe 2.0',
    provider: Vendor.Grok,
    description: 'Current xAI file and streaming transcription model with timestamps, diarization, and multichannel support',
    isActive: true,
    lifecycle: 'active',
    availability: 'region_limited',
    preferred: true,
    endpoints: ['audio_transcription', 'realtime'],
    releaseDate: '2026-09-17',
    sources: { documentation: 'https://docs.x.ai/developers/model-capabilities/audio/speech-to-text', pricing: 'https://docs.x.ai/developers/models/speech-to-text', lastVerified: '2026-10-07' },
    capabilities: {
      ...WHISPER_BASE_CAPABILITIES,
      outputFormats: ['json', 'text', 'verbose_json'],
      features: { translation: false, diarization: true, streaming: true, punctuation: true, profanityFilter: false },
      limits: { maxFileSizeMB: 500 },
      vendorOptions: {
        format: { type: 'boolean', description: 'Apply automatic transcript formatting', default: false },
        multichannel: { type: 'boolean', description: 'Transcribe channels independently', default: false },
        channels: { type: 'number', description: 'Number of channels in raw audio', min: 2, max: 8 },
        diarize: { type: 'boolean', description: 'Identify distinct speakers', default: false },
        keyterm: { type: 'array', description: 'Terms whose recognition should be boosted' },
        filler_words: { type: 'boolean', description: 'Retain filler words in the transcript', default: false },
        vad_threshold: { type: 'number', description: 'Voice-activity detection threshold', min: 0, max: 1, default: 0.08 },
      },
    },
    pricing: { perMinute: 0.0016666667, streamingPerMinute: 0.0033333333, currency: 'USD' },
  },

  'xai-stt': {
    name: 'xai-stt',
    displayName: 'xAI Speech to Text',
    provider: Vendor.Grok,
    description: 'Low-cost xAI file and streaming transcription with timestamps, diarization, and multichannel support',
    isActive: true,
    lifecycle: 'legacy',
    availability: 'region_limited',
    replacementModel: 'grok-voice-transcribe-2.0',
    endpoints: ['audio_transcription', 'realtime'],
    releaseDate: '2026-07-23',
    sources: {
      documentation: 'https://docs.x.ai/developers/model-capabilities/audio/speech-to-text',
      pricing: 'https://docs.x.ai/developers/models/speech-to-text',
      lastVerified: '2026-08-30',
    },
    capabilities: {
      ...WHISPER_BASE_CAPABILITIES,
      outputFormats: ['json', 'text', 'verbose_json'],
      features: { translation: false, diarization: true, streaming: true, punctuation: true, profanityFilter: false },
      limits: { maxFileSizeMB: 500 },
      vendorOptions: {
        format: { type: 'boolean', description: 'Apply automatic transcript formatting', default: false },
        multichannel: { type: 'boolean', description: 'Transcribe channels independently', default: false },
        channels: { type: 'number', description: 'Number of channels in raw audio', min: 2, max: 8 },
        diarize: { type: 'boolean', description: 'Identify distinct speakers', default: false },
        keyterm: { type: 'array', description: 'Terms whose recognition should be boosted' },
        filler_words: { type: 'boolean', description: 'Retain filler words in the transcript', default: false },
        vad_threshold: { type: 'number', description: 'Voice-activity detection threshold', min: 0, max: 1, default: 0.08 },
      },
    },
    pricing: { perMinute: 0.0016666667, streamingPerMinute: 0.0033333333, currency: 'USD' },
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
      documentation: 'https://console.groq.com/docs/speech-to-text',
      pricing: 'https://console.groq.com/docs/speech-to-text',
      lastVerified: '2026-08-30',
    },
    capabilities: {
      ...WHISPER_BASE_CAPABILITIES,
      timestamps: { supported: true, granularities: ['word', 'segment'] },
      outputFormats: ['json', 'text', 'verbose_json'],
      features: {
        translation: true,
        diarization: false,
        streaming: false,
        punctuation: true,
        profanityFilter: false,
      },
      limits: { maxFileSizeMB: 100 },
    },
    pricing: { perMinute: 0.00185, currency: 'USD' },
  },

  'whisper-large-v3-turbo': {
    name: 'whisper-large-v3-turbo',
    displayName: 'Whisper Large v3 Turbo (Groq)',
    provider: Vendor.Groq,
    description: 'Cost-optimized multilingual Whisper transcription on Groq LPUs',
    isActive: true,
    lifecycle: 'active',
    availability: 'public',
    preferred: true,
    releaseDate: '2024-09-18',
    sources: {
      documentation: 'https://console.groq.com/docs/speech-to-text',
      pricing: 'https://console.groq.com/docs/speech-to-text',
      lastVerified: '2026-08-30',
    },
    capabilities: {
      ...WHISPER_BASE_CAPABILITIES,
      outputFormats: ['json', 'text', 'verbose_json'],
      timestamps: { supported: true, granularities: ['word', 'segment'] },
      features: { translation: true, diarization: false, streaming: false, punctuation: true, profanityFilter: false },
      limits: { maxFileSizeMB: 100 },
    },
    pricing: { perMinute: 0.0006666667, currency: 'USD' },
  },

  'distil-whisper-large-v3-en': {
    name: 'distil-whisper-large-v3-en',
    displayName: 'Distil Whisper (Groq)',
    provider: Vendor.Groq,
    description: 'Faster English-only Whisper variant on Groq',
    isActive: false,
    lifecycle: 'retired',
    retirementDate: '2025-08-23',
    replacementModel: 'whisper-large-v3-turbo',
    releaseDate: '2024-04-01',
    sources: {
      documentation: 'https://console.groq.com/docs/speech-to-text',
      pricing: 'https://console.groq.com/docs/speech-to-text',
      lastVerified: '2026-08-30',
    },
    capabilities: {
      inputFormats: AUDIO_FORMATS.STT_INPUT,
      outputFormats: ['json', 'text', 'verbose_json'],
      languages: ['en'], // English only
      timestamps: { supported: true, granularities: ['segment'] },
      features: {
        translation: false,
        diarization: false,
        streaming: false,
        punctuation: true,
        profanityFilter: false,
      },
      limits: { maxFileSizeMB: 25 },
    },
    pricing: { perMinute: 0.00033, currency: 'USD' },
  },
};

// =============================================================================
// Helper Functions (using shared utilities)
// =============================================================================

assertNoRegistryAliasCollisions(STT_MODEL_REGISTRY, 'STT_MODEL_REGISTRY');
const helpers = createRegistryHelpers(STT_MODEL_REGISTRY);

export const getSTTModelInfo = helpers.getInfo;
export const getSTTModelsByVendor = helpers.getByVendor;
export const getActiveSTTModels = helpers.getActive;
/** Get active STT models with a published deprecation notice. */
export const getDeprecatedSTTModels = helpers.getDeprecated;

/**
 * Get STT models that support a specific feature
 */
export function getSTTModelsWithFeature(
  feature: keyof ISTTModelDescription['capabilities']['features']
): ISTTModelDescription[] {
  return Object.values(STT_MODEL_REGISTRY).filter(
    (model) => model.isActive && model.capabilities.features[feature]
  );
}

/**
 * Calculate estimated cost for STT
 */
export function calculateSTTCost(
  modelName: string,
  durationSeconds: number,
  options?: { inputTokens?: number; streaming?: boolean }
): number | null {
  const model = getSTTModelInfo(modelName);
  if (!model?.pricing) return null;
  if (options?.streaming && model.pricing.streamingPerMinute !== undefined) {
    return (durationSeconds / 60) * model.pricing.streamingPerMinute;
  }
  if (model.pricing.perMinute !== undefined) {
    return (durationSeconds / 60) * model.pricing.perMinute;
  }
  if (model.pricing.perMInputTokens !== undefined && options?.inputTokens !== undefined) {
    return (options.inputTokens / 1_000_000) * model.pricing.perMInputTokens;
  }
  return null;
}
