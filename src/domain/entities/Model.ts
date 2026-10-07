import { Vendor } from '../../core/Vendor.js';
import type { Vendor as VendorType } from '../../core/Vendor.js';
import type { IVoiceInfo } from './SharedVoices.js';
import { OPENAI_REALTIME_VOICES, XAI_VOICES } from './SharedVoices.js';
import type {
  ModelAvailability,
  ModelEndpoint,
  ModelLifecycleStatus,
  ISourceLinks,
} from '../types/SharedTypes.js';
import type { NativeToolCapability } from '../interfaces/IAdvancedInference.js';
import { assertNoRegistryAliasCollisions } from './RegistryUtils.js';

/**
 * Complete description of an LLM model including capabilities, pricing, and features
 */
export interface ILLMDescription {
  /** Model identifier (e.g., "gpt-5.2-instant") */
  name: string;

  /** Vendor/provider (Vendor.OpenAI, Vendor.Anthropic, etc.) */
  provider: string;

  /** Optional description of the model */
  description?: string;

  /** Whether the model is currently available for use */
  isActive: boolean;

  /** Vendor-published lifecycle. `isActive` is retained for compatibility. */
  lifecycle?: ModelLifecycleStatus;

  /** Access scope for limited or gated models. */
  availability?: ModelAvailability;

  /** Alternate model IDs accepted by the provider. */
  aliases?: readonly string[];

  /** Pinned versions represented by this registry entry. */
  snapshots?: readonly string[];

  /** Supported first-party API endpoints. */
  endpoints?: readonly ModelEndpoint[];

  /** Date the vendor announced deprecation (YYYY-MM-DD). */
  deprecationDate?: string;

  /** Final shutdown date (YYYY-MM-DD). */
  retirementDate?: string;

  /** Recommended migration target. */
  replacementModel?: string;

  /** Whether this model is a preferred/recommended choice for its vendor */
  preferred?: boolean;

  /** Release date (YYYY-MM-DD format) */
  releaseDate?: string;

  /** Knowledge cutoff date */
  knowledgeCutoff?: string;

  /** Official references used to verify this entry. Optional for legacy v1 records. */
  sources?: ISourceLinks;

  /** Built-in voices for realtime/audio models (undefined = no built-in voices) */
  voices?: IVoiceInfo[];

  /** Model capabilities and pricing */
  features: {
    /** Supports extended reasoning/thinking */
    reasoning?: boolean;

    /** Verified reasoning-effort values accepted by this model. */
    reasoningEfforts?: readonly ('none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max')[];

    /** Supports streaming responses */
    streaming: boolean;

    /** Supports structured output (JSON mode) */
    structuredOutput?: boolean;

    /** Supports function/tool calling */
    functionCalling?: boolean;

    /** Supports fine-tuning */
    fineTuning?: boolean;

    /** Supports predicted outputs */
    predictedOutputs?: boolean;

    /** Supports realtime API */
    realtime?: boolean;

    /** Supports image input (vision) */
    vision?: boolean;

    /** Supports audio input/output */
    audio?: boolean;

    /** Supports video input */
    video?: boolean;

    /** Supports extended thinking (Claude-specific) */
    extendedThinking?: boolean;

    /** Supports batch API */
    batchAPI?: boolean;

    /** Supports prompt caching */
    promptCaching?: boolean;

    /** Supports Responses async function/custom tool calls. */
    asyncToolCalling?: boolean;

    /** Supports Responses WebSocket mid-turn steering. */
    midTurnSteering?: boolean;

    /** Supports conversation-scoped `configuration_update` input items. */
    configurationUpdates?: boolean;

    /** Participates in OpenAI's asynchronous misalignment monitoring. */
    misalignmentMonitoring?: boolean;

    /** Provider-hosted tools verified for this exact model. */
    nativeTools?: readonly NativeToolCapability[];

    /** Modality-specific prices. Token prices are USD per million tokens. */
    pricing?: {
      text?: TokenPricing;
      audio?: TokenPricing;
      image?: TokenPricing;
      /** Used by duration-priced realtime translation models. */
      audioDurationPerMinute?: number;
      /** Used by realtime agents that bill text conversation events. */
      textInputPerMessage?: number;
      /** Provider processing-tier multipliers relative to standard pricing. */
      processingMultipliers?: Partial<Record<ProcessingMode, number>>;
    };

    /** Parameter support - indicates which sampling parameters are supported */
    parameters?: {
      /** Supports temperature parameter */
      temperature?: boolean;
      /** Supports top_p parameter */
      topP?: boolean;
      /** Supports top_k parameter */
      topK?: boolean;
      /** Supports frequency_penalty parameter */
      frequencyPenalty?: boolean;
      /** Supports presence_penalty parameter */
      presencePenalty?: boolean;
    };

    /** Accepted parameters that the vendor has announced as deprecated. */
    deprecatedParameters?: readonly ('temperature' | 'topP' | 'topK' | 'frequencyPenalty' | 'presencePenalty')[];

    /** Input specifications */
    input: {
      /** Maximum input context window (in tokens) */
      tokens: number | null;

      /** Supports text input */
      text: boolean;

      /** Supports image input */
      image?: boolean;

      /** Supports audio input */
      audio?: boolean;

      /** Supports video input */
      video?: boolean;

      /** Cost per million tokens (input) */
      cpm: number;

      /** Cost per million cached tokens (if prompt caching supported) */
      cpmCached?: number;
    };

    /** Output specifications */
    output: {
      /** Maximum output tokens */
      tokens: number | null;

      /** Supports text output */
      text: boolean;

      /** Supports image output */
      image?: boolean;

      /** Supports audio output */
      audio?: boolean;

      /** Cost per million tokens (output) */
      cpm: number;
    };
  };
}

export type ProcessingMode =
  | 'interactive'
  | 'standard'
  | 'batch'
  | 'flex'
  | 'fast'
  | 'ultrafast'
  | 'priority'
  | 'off_peak';

export interface LongContextTokenPricing {
  /** Apply this tier when total request input is at least this many tokens. */
  thresholdTokens: number;
  input: number;
  cachedInput?: number;
  cacheWrite?: number;
  output: number;
}

export interface TokenPricing {
  input: number;
  cachedInput?: number;
  /** Explicit cache population/write price per million tokens. */
  cacheWrite?: number;
  /** Output price. Omitted for input-only modalities such as images on realtime models. */
  output?: number;
  /** Optional all-token price tier for long-context requests. */
  longContext?: LongContextTokenPricing;
}

/**
 * Model name constants organized by vendor
 * Updated: October 2026 - Includes current, preview, and migration-relevant models
 */
export const LLM_MODELS = {
  [Vendor.OpenAI]: {
    // GPT-6 Series (Current Flagship)
    GPT_6_ASTRA: 'gpt-6-astra',
    GPT_6_1_SOL: 'gpt-6.1-sol',
    GPT_6_SOL: 'gpt-6-sol',
    GPT_6_LUNA: 'gpt-6-luna',
    // GPT-5.6 Series
    GPT_5_6: 'gpt-5.6',
    GPT_5_6_SOL: 'gpt-5.6-sol',
    GPT_5_6_TERRA: 'gpt-5.6-terra',
    GPT_5_6_LUNA: 'gpt-5.6-luna',
    GPT_5_6_CYBER: 'gpt-5.6-cyber',
    GPT_ROSALIND_RESEARCH: 'gpt-rosalind-research',
    // GPT-5.5 Series
    GPT_5_5: 'gpt-5.5',
    GPT_5_5_PRO: 'gpt-5.5-pro',
    // GPT-5.4 Series
    GPT_5_4: 'gpt-5.4',
    GPT_5_4_PRO: 'gpt-5.4-pro',
    GPT_5_4_MINI: 'gpt-5.4-mini',
    GPT_5_4_NANO: 'gpt-5.4-nano',
    // GPT-5.3 Series
    GPT_5_3_CODEX: 'gpt-5.3-codex',
    GPT_5_3_CHAT: 'gpt-5.3-chat-latest',
    // GPT-5.2 Series
    GPT_5_2: 'gpt-5.2',
    GPT_5_2_PRO: 'gpt-5.2-pro',
    GPT_5_2_CODEX: 'gpt-5.2-codex',
    GPT_5_2_CHAT: 'gpt-5.2-chat-latest',
    // GPT-5.1 Series
    GPT_5_1: 'gpt-5.1',
    GPT_5_1_CODEX: 'gpt-5.1-codex',
    GPT_5_1_CODEX_MAX: 'gpt-5.1-codex-max',
    GPT_5_1_CODEX_MINI: 'gpt-5.1-codex-mini',
    GPT_5_1_CHAT: 'gpt-5.1-chat-latest',
    // GPT-5 Series
    GPT_5: 'gpt-5',
    GPT_5_MINI: 'gpt-5-mini',
    GPT_5_NANO: 'gpt-5-nano',
    GPT_5_CODEX: 'gpt-5-codex',
    GPT_5_CHAT: 'gpt-5-chat-latest',
    // GPT-4.1 Series
    GPT_4_1: 'gpt-4.1',
    GPT_4_1_MINI: 'gpt-4.1-mini',
    GPT_4_1_NANO: 'gpt-4.1-nano',
    // GPT-4o Series (Legacy)
    GPT_4O: 'gpt-4o',
    GPT_4O_MINI: 'gpt-4o-mini',
    // Audio Models
    GPT_AUDIO_1_5: 'gpt-audio-1.5',
    GPT_AUDIO: 'gpt-audio',
    GPT_AUDIO_MINI: 'gpt-audio-mini',
    // Realtime Models
    GPT_LIVE_1: 'gpt-live-1',
    GPT_REALTIME_2_1: 'gpt-realtime-2.1',
    GPT_REALTIME_2_1_MINI: 'gpt-realtime-2.1-mini',
    GPT_REALTIME_2: 'gpt-realtime-2',
    GPT_REALTIME_TRANSLATE: 'gpt-realtime-translate',
    GPT_REALTIME_1_5: 'gpt-realtime-1.5',
    GPT_REALTIME: 'gpt-realtime',
    GPT_REALTIME_MINI: 'gpt-realtime-mini',
    // Reasoning Models (o-series)
    O3: 'o3',
    O4_MINI: 'o4-mini',
    O3_MINI: 'o3-mini',
    O3_DEEP_RESEARCH: 'o3-deep-research',
    O4_MINI_DEEP_RESEARCH: 'o4-mini-deep-research',
    O1: 'o1',
    // Open-Weight Models
    GPT_OSS_120B: 'gpt-oss-120b',
    GPT_OSS_20B: 'gpt-oss-20b',
  },
  [Vendor.Anthropic]: {
    // Claude 5 Series
    CLAUDE_OPUS_5_5: 'claude-opus-5-5',
    CLAUDE_SONNET_5_5: 'claude-sonnet-5-5',
    CLAUDE_FABLE_5_1: 'claude-fable-5-1',
    CLAUDE_MYTHOS_5_1: 'claude-mythos-5-1',
    CLAUDE_OPUS_5: 'claude-opus-5',
    CLAUDE_MYTHOS_5: 'claude-mythos-5',
    CLAUDE_OPUS_4_8: 'claude-opus-4-8',
    CLAUDE_SONNET_5: 'claude-sonnet-5',
    CLAUDE_FABLE_5: 'claude-fable-5',
    // Claude 4.7 Series (Legacy flagship Opus — April 2026)
    CLAUDE_OPUS_4_7: 'claude-opus-4-7',
    // Claude 4.6 Series (Current Sonnet, legacy Opus)
    CLAUDE_OPUS_4_6: 'claude-opus-4-6',
    CLAUDE_SONNET_4_6: 'claude-sonnet-4-6',
    // Claude 4.5 Series
    CLAUDE_OPUS_4_5: 'claude-opus-4-5-20251101',
    CLAUDE_SONNET_4_5: 'claude-sonnet-4-5-20250929',
    CLAUDE_HAIKU_4_5: 'claude-haiku-4-5-20251001',
    // Claude 4.x Legacy
    CLAUDE_OPUS_4_1: 'claude-opus-4-1-20250805',
    CLAUDE_OPUS_4: 'claude-opus-4-20250514',
    CLAUDE_SONNET_4: 'claude-sonnet-4-20250514',
    CLAUDE_SONNET_3_7: 'claude-3-7-sonnet-20250219',
  },
  [Vendor.Google]: {
    // Current Gemini 3.x production models
    GEMINI_3_8_LIVE: 'gemini-3.8-live',
    GEMINI_3_8_LIVE_EXTENDED_THINKING: 'gemini-3.8-live-extended-thinking',
    GEMINI_3_8_FLASH: 'gemini-3.8-flash',
    GEMINI_3_7_FLASH: 'gemini-3.7-flash',
    GEMINI_3_6_FLASH: 'gemini-3.6-flash',
    GEMINI_3_5_FLASH: 'gemini-3.5-flash',
    GEMINI_3_5_FLASH_LITE: 'gemini-3.5-flash-lite',
    GEMINI_3_1_FLASH_LITE: 'gemini-3.1-flash-lite',
    // Gemini 3.1 Series (Preview)
    GEMINI_3_1_PRO_PREVIEW: 'gemini-3.1-pro-preview',
    GEMINI_3_1_FLASH_LITE_PREVIEW: 'gemini-3.1-flash-lite-preview',
    GEMINI_3_1_FLASH_IMAGE_PREVIEW: 'gemini-3.1-flash-image-preview',
    GEMINI_3_1_FLASH_LIVE_PREVIEW: 'gemini-3.1-flash-live-preview',
    // Gemini 3 Series (Preview)
    GEMINI_3_FLASH_PREVIEW: 'gemini-3-flash-preview',
    GEMINI_3_PRO_IMAGE_PREVIEW: 'gemini-3-pro-image-preview',
    // Gemini 2.5 Series (Production)
    GEMINI_2_5_PRO: 'gemini-2.5-pro',
    GEMINI_2_5_FLASH: 'gemini-2.5-flash',
    GEMINI_2_5_FLASH_LITE: 'gemini-2.5-flash-lite',
    GEMINI_2_5_FLASH_IMAGE: 'gemini-2.5-flash-image',
  },
  [Vendor.Grok]: {
    // Current production models
    GROK_4_7: 'grok-4.7',
    GROK_4_6: 'grok-4.6',
    GROK_4_5: 'grok-4.5',
    GROK_4_3: 'grok-4.3',
    GROK_BUILD_0_1: 'grok-build-0.1',
    GROK_VOICE_LATEST: 'grok-voice-latest',
    GROK_VOICE_THINK_FAST_2: 'grok-voice-think-fast-2.0',
    GROK_VOICE_THINK_FAST_1: 'grok-voice-think-fast-1.0',
    GROK_VOICE_FAST_1: 'grok-voice-fast-1.0',
    // Grok 4.20 Series
    GROK_4_20_0309_REASONING: 'grok-4.20-0309-reasoning',
    GROK_4_20_0309_NON_REASONING: 'grok-4.20-0309-non-reasoning',
    GROK_4_20_MULTI_AGENT_0309: 'grok-4.20-multi-agent-0309',
    // Grok 4.1 Series (2M context, fast)
    GROK_4_1_FAST_REASONING: 'grok-4-1-fast-reasoning',
    GROK_4_1_FAST_NON_REASONING: 'grok-4-1-fast-non-reasoning',
  },
  [Vendor.DeepSeek]: {
    // Current first-party models
    DEEPSEEK_V4_FLASH: 'deepseek-v4-flash',
    DEEPSEEK_V4_PRO: 'deepseek-v4-pro',
    DEEPSEEK_V4_FLASH_VISION_EXP: 'deepseek-v4-flash-vision-exp',
    // Retired compatibility IDs (kept explicit; never silently remapped)
    DEEPSEEK_CHAT: 'deepseek-chat',
    DEEPSEEK_REASONER: 'deepseek-reasoner',
  },
} as const;

/**
 * Complete model registry with all model metadata
 * Registry schema v2. Last vendor model update: 2026-10-07.
 */
export const MODEL_REGISTRY: Record<string, ILLMDescription> = {
  // ============================================================================
  // OpenAI Models (Verified from developers.openai.com - October 2026)
  // ============================================================================

  // GPT-6 Series (current flagship - September 2026)
  'gpt-6-astra': {
    name: 'gpt-6-astra',
    provider: Vendor.OpenAI,
    description: 'OpenAI\'s most capable model for complex reasoning, coding, computer use, research, and document creation',
    isActive: true,
    lifecycle: 'active',
    availability: 'public',
    preferred: true,
    endpoints: ['responses', 'chat_completions', 'batch'],
    releaseDate: '2026-09-04',
    knowledgeCutoff: '2026-04-30',
    sources: { documentation: 'https://developers.openai.com/api/docs/models/gpt-6-astra', pricing: 'https://developers.openai.com/api/docs/pricing', lastVerified: '2026-10-07' },
    features: {
      reasoning: true, reasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
      streaming: true, structuredOutput: true, functionCalling: true,
      fineTuning: false, predictedOutputs: false, realtime: false, vision: true,
      audio: false, video: false, batchAPI: true, promptCaching: true,
      asyncToolCalling: true, midTurnSteering: true, configurationUpdates: true,
      misalignmentMonitoring: true,
      parameters: { temperature: false, topP: false, frequencyPenalty: false, presencePenalty: false },
      input: { tokens: 1_050_000, text: true, image: true, cpm: 10, cpmCached: 1 },
      output: { tokens: 128000, text: true, cpm: 50 },
      pricing: {
        text: {
          input: 10, cachedInput: 1, cacheWrite: 12.5, output: 50,
          longContext: { thresholdTokens: 272000, input: 20, cachedInput: 2, cacheWrite: 25, output: 75 },
        },
        processingMultipliers: { batch: 0.5, flex: 0.5, fast: 2 },
      },
    },
  },

  'gpt-6.1-sol': {
    name: 'gpt-6.1-sol',
    provider: Vendor.OpenAI,
    description: 'Latest GPT-6 workhorse for coding, professional work, and long-running agents',
    isActive: true,
    lifecycle: 'active',
    availability: 'public',
    preferred: true,
    endpoints: ['responses', 'chat_completions', 'batch'],
    releaseDate: '2026-09-29',
    knowledgeCutoff: '2026-04-30',
    sources: { documentation: 'https://developers.openai.com/api/docs/models/gpt-6.1-sol', pricing: 'https://developers.openai.com/api/docs/pricing', lastVerified: '2026-10-07' },
    features: {
      reasoning: true, reasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
      streaming: true, structuredOutput: true, functionCalling: true,
      fineTuning: false, predictedOutputs: false, realtime: false, vision: true,
      audio: false, video: false, batchAPI: true, promptCaching: true,
      asyncToolCalling: true, midTurnSteering: true, configurationUpdates: true,
      parameters: { temperature: false, topP: false, frequencyPenalty: false, presencePenalty: false },
      input: { tokens: 1_050_000, text: true, image: true, cpm: 2, cpmCached: 0.1 },
      output: { tokens: 128_000, text: true, cpm: 10 },
      pricing: {
        text: {
          input: 2, cachedInput: 0.1, cacheWrite: 2.5, output: 10,
          longContext: { thresholdTokens: 272_000, input: 4, cachedInput: 0.2, cacheWrite: 5, output: 15 },
        },
        processingMultipliers: { batch: 0.5, flex: 0.5, fast: 2 },
      },
    },
  },

  'gpt-6-sol': {
    name: 'gpt-6-sol',
    provider: Vendor.OpenAI,
    description: 'GPT-6 workhorse model for coding, professional work, and agentic workloads',
    isActive: true,
    lifecycle: 'active',
    availability: 'public',
    endpoints: ['responses', 'chat_completions', 'batch'],
    releaseDate: '2026-09-22',
    knowledgeCutoff: '2026-04-20',
    sources: { documentation: 'https://developers.openai.com/api/docs/models/gpt-6-sol', pricing: 'https://developers.openai.com/api/docs/pricing', lastVerified: '2026-10-07' },
    features: {
      reasoning: true, reasoningEfforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
      streaming: true, structuredOutput: true, functionCalling: true,
      fineTuning: false, predictedOutputs: false, realtime: false, vision: true,
      audio: false, video: false, batchAPI: true, promptCaching: true,
      asyncToolCalling: true, midTurnSteering: true, configurationUpdates: true,
      parameters: { temperature: false, topP: false, frequencyPenalty: false, presencePenalty: false },
      input: { tokens: 1_050_000, text: true, image: true, cpm: 2, cpmCached: 0.2 },
      output: { tokens: 128_000, text: true, cpm: 10 },
      pricing: {
        text: {
          input: 2, cachedInput: 0.2, cacheWrite: 2.5, output: 10,
          longContext: { thresholdTokens: 272_000, input: 4, cachedInput: 0.4, cacheWrite: 5, output: 15 },
        },
        processingMultipliers: { batch: 0.5, flex: 0.5, fast: 2 },
      },
    },
  },

  'gpt-6-luna': {
    name: 'gpt-6-luna',
    provider: Vendor.OpenAI,
    description: 'Fast, economical GPT-6 model for high-throughput workloads and Decisions API classification',
    isActive: true,
    lifecycle: 'active',
    availability: 'public',
    preferred: true,
    endpoints: ['responses', 'decisions', 'chat_completions', 'batch'],
    releaseDate: '2026-09-22',
    knowledgeCutoff: '2026-05-18',
    sources: { documentation: 'https://developers.openai.com/api/docs/models/gpt-6-luna', pricing: 'https://developers.openai.com/api/docs/pricing', lastVerified: '2026-10-07' },
    features: {
      reasoning: true, reasoningEfforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
      streaming: true, structuredOutput: true, functionCalling: true,
      fineTuning: false, predictedOutputs: false, realtime: false, vision: true,
      audio: false, video: false, batchAPI: true, promptCaching: true,
      asyncToolCalling: true, midTurnSteering: true, configurationUpdates: true,
      parameters: { temperature: false, topP: false, frequencyPenalty: false, presencePenalty: false },
      input: { tokens: 1_050_000, text: true, image: true, cpm: 0.1, cpmCached: 0.01 },
      output: { tokens: 128_000, text: true, cpm: 0.5 },
      pricing: {
        text: {
          input: 0.1, cachedInput: 0.01, cacheWrite: 0.125, output: 0.5,
          longContext: { thresholdTokens: 272_000, input: 0.2, cachedInput: 0.02, cacheWrite: 0.25, output: 0.75 },
        },
        processingMultipliers: { batch: 0.5, flex: 0.5, fast: 2 },
      },
    },
  },

  // GPT-5.6 Series (frontier family - July 2026)
  'gpt-5.6-sol': {
    name: 'gpt-5.6-sol',
    provider: Vendor.OpenAI,
    description: 'Highest-capability GPT-5.6 model for demanding professional work, coding, and long-horizon agents',
    isActive: true,
    lifecycle: 'active',
    availability: 'public',
    preferred: true,
    aliases: ['gpt-5.6', 'gpt-daybreak-blue-latest'],
    snapshots: ['gpt-5.6-sol-2026-07-09'],
    endpoints: ['responses', 'chat_completions', 'batch'],
    releaseDate: '2026-07-09',
    knowledgeCutoff: '2026-02-16',
    sources: { documentation: 'https://developers.openai.com/api/docs/models/gpt-5.6-sol', pricing: 'https://developers.openai.com/api/docs/pricing', lastVerified: '2026-08-30' },
    features: {
      reasoning: true, reasoningEfforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
      streaming: true, structuredOutput: true, functionCalling: true,
      fineTuning: false, predictedOutputs: false, realtime: false, vision: true,
      audio: false, video: false, batchAPI: true, promptCaching: true,
      parameters: { temperature: false, topP: false, frequencyPenalty: false, presencePenalty: false },
      input: { tokens: 1050000, text: true, image: true, cpm: 4, cpmCached: 0.4 },
      output: { tokens: 128000, text: true, cpm: 20 },
      pricing: {
        text: {
          input: 4, cachedInput: 0.4, cacheWrite: 5, output: 20,
          longContext: { thresholdTokens: 272000, input: 8, cachedInput: 0.8, cacheWrite: 10, output: 30 },
        },
        processingMultipliers: { batch: 0.5, fast: 2 },
      },
    },
  },

  'gpt-5.6-terra': {
    name: 'gpt-5.6-terra',
    provider: Vendor.OpenAI,
    description: 'Balanced GPT-5.6 model for production agents, coding, and high-volume professional workloads',
    isActive: true,
    lifecycle: 'active',
    availability: 'public',
    preferred: true,
    snapshots: ['gpt-5.6-terra-2026-07-09'],
    endpoints: ['responses', 'chat_completions', 'batch'],
    releaseDate: '2026-07-09',
    knowledgeCutoff: '2026-02-16',
    sources: { documentation: 'https://developers.openai.com/api/docs/models/gpt-5.6-terra', pricing: 'https://developers.openai.com/api/docs/pricing', lastVerified: '2026-08-30' },
    features: {
      reasoning: true, reasoningEfforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
      streaming: true, structuredOutput: true, functionCalling: true,
      fineTuning: false, predictedOutputs: false, realtime: false, vision: true,
      audio: false, video: false, batchAPI: true, promptCaching: true,
      parameters: { temperature: false, topP: false, frequencyPenalty: false, presencePenalty: false },
      input: { tokens: 1050000, text: true, image: true, cpm: 2, cpmCached: 0.2 },
      output: { tokens: 128000, text: true, cpm: 12 },
      pricing: {
        text: {
          input: 2, cachedInput: 0.2, cacheWrite: 2.5, output: 12,
          longContext: { thresholdTokens: 272000, input: 4, cachedInput: 0.4, cacheWrite: 5, output: 18 },
        },
        processingMultipliers: { batch: 0.5, fast: 2 },
      },
    },
  },

  'gpt-5.6-luna': {
    name: 'gpt-5.6-luna',
    provider: Vendor.OpenAI,
    description: 'Fast, economical GPT-5.6 model for latency-sensitive and high-throughput workloads',
    isActive: true,
    lifecycle: 'active',
    availability: 'public',
    snapshots: ['gpt-5.6-luna-2026-07-09'],
    endpoints: ['responses', 'chat_completions', 'batch'],
    releaseDate: '2026-07-09',
    knowledgeCutoff: '2026-02-16',
    sources: { documentation: 'https://developers.openai.com/api/docs/models/gpt-5.6-luna', pricing: 'https://developers.openai.com/api/docs/pricing', lastVerified: '2026-08-30' },
    features: {
      reasoning: true, reasoningEfforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
      streaming: true, structuredOutput: true, functionCalling: true,
      fineTuning: false, predictedOutputs: false, realtime: false, vision: true,
      audio: false, video: false, batchAPI: true, promptCaching: true,
      parameters: { temperature: false, topP: false, frequencyPenalty: false, presencePenalty: false },
      input: { tokens: 1050000, text: true, image: true, cpm: 0.2, cpmCached: 0.02 },
      output: { tokens: 128000, text: true, cpm: 1.2 },
      pricing: {
        text: {
          input: 0.2, cachedInput: 0.02, cacheWrite: 0.25, output: 1.2,
          longContext: { thresholdTokens: 272000, input: 0.4, cachedInput: 0.04, cacheWrite: 0.5, output: 1.8 },
        },
        processingMultipliers: { batch: 0.5, fast: 2 },
      },
    },
  },

  'gpt-5.6-cyber': {
    name: 'gpt-5.6-cyber',
    provider: Vendor.OpenAI,
    description: 'Purpose-trained cybersecurity model for approved defenders conducting authorized vulnerability research, exploit validation, and security testing',
    isActive: true,
    lifecycle: 'active',
    availability: 'limited',
    aliases: ['gpt-daybreak-red-latest'],
    endpoints: ['responses', 'chat_completions', 'batch'],
    knowledgeCutoff: '2026-02-16',
    sources: { documentation: 'https://developers.openai.com/api/docs/models/gpt-5.6-cyber', pricing: 'https://developers.openai.com/api/docs/pricing', lastVerified: '2026-10-07' },
    features: {
      reasoning: true, reasoningEfforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
      streaming: true, structuredOutput: true, functionCalling: true,
      fineTuning: false, predictedOutputs: false, realtime: false, vision: true,
      audio: false, video: false, batchAPI: true, promptCaching: true,
      parameters: { temperature: false, topP: false, frequencyPenalty: false, presencePenalty: false },
      input: { tokens: 400_000, text: true, image: true, cpm: 12.5, cpmCached: 1.25 },
      output: { tokens: 128_000, text: true, cpm: 75 },
      pricing: {
        text: { input: 12.5, cachedInput: 1.25, cacheWrite: 15.625, output: 75 },
        processingMultipliers: { batch: 0.5 },
      },
    },
  },

  'gpt-rosalind-research': {
    name: 'gpt-rosalind-research',
    provider: Vendor.OpenAI,
    description: 'Specialized GPT-Rosalind model for approved internal life-sciences research through OpenAI trusted access',
    isActive: true,
    lifecycle: 'active',
    availability: 'limited',
    endpoints: ['responses'],
    releaseDate: '2026-09-08',
    sources: { documentation: 'https://developers.openai.com/api/docs/changelog', pricing: 'https://developers.openai.com/api/docs/pricing', lastVerified: '2026-10-07' },
    features: {
      reasoning: true,
      streaming: true, structuredOutput: true, functionCalling: true,
      fineTuning: false, predictedOutputs: false, realtime: false, vision: true,
      audio: false, video: false, batchAPI: false, promptCaching: true,
      parameters: { temperature: false, topP: false, frequencyPenalty: false, presencePenalty: false },
      input: { tokens: null, text: true, image: true, cpm: 5, cpmCached: 0.5 },
      output: { tokens: null, text: true, cpm: 25 },
      pricing: { text: { input: 5, cachedInput: 0.5, output: 25 } },
    },
  },

  'gpt-5.5-pro': {
    name: 'gpt-5.5-pro',
    provider: Vendor.OpenAI,
    description: 'Higher-compute GPT-5.5 variant for difficult reasoning tasks',
    isActive: true,
    lifecycle: 'active',
    availability: 'public',
    endpoints: ['responses', 'batch'],
    releaseDate: '2026-04-25',
    knowledgeCutoff: '2025-12-01',
    sources: { documentation: 'https://developers.openai.com/api/docs/models/gpt-5.5-pro', pricing: 'https://developers.openai.com/api/docs/pricing', lastVerified: '2026-08-30' },
    features: {
      reasoning: true, streaming: true, structuredOutput: true, functionCalling: true,
      fineTuning: false, predictedOutputs: false, realtime: false, vision: true,
      audio: false, video: false, batchAPI: true, promptCaching: true,
      parameters: { temperature: false, topP: false, frequencyPenalty: false, presencePenalty: false },
      pricing: {
        text: {
          input: 30,
          cachedInput: 3,
          output: 180,
          longContext: { thresholdTokens: 272000, input: 60, cachedInput: 6, output: 270 },
        },
        processingMultipliers: { standard: 1, batch: 0.5 },
      },
      input: { tokens: 1050000, text: true, image: true, cpm: 30, cpmCached: 3 },
      output: { tokens: 128000, text: true, cpm: 180 },
    },
  },

  // GPT-5.5 Series (legacy flagship - April 2026)
  'gpt-5.5': {
    name: 'gpt-5.5',
    provider: Vendor.OpenAI,
    description: 'Newest frontier model for the most complex professional work and coding. 1M+ context. Reasoning.effort: none, low, medium (default), high, xhigh. >272K input tokens priced at 2x input / 1.5x output for the full session',
    isActive: true,
    preferred: true,
    releaseDate: '2026-04-25',
    knowledgeCutoff: '2025-12-01',
    features: {
      reasoning: true,
      streaming: true,
      structuredOutput: true,
      functionCalling: true,
      fineTuning: false,
      predictedOutputs: false,
      realtime: false,
      vision: true,
      audio: false,
      video: false,
      batchAPI: true,
      promptCaching: true,
      parameters: {
        temperature: false,
        topP: false,
        frequencyPenalty: false,
        presencePenalty: false,
      },
      input: {
        tokens: 1050000,
        text: true,
        image: true,
        cpm: 5,
        cpmCached: 0.5,
      },
      output: {
        tokens: 128000,
        text: true,
        cpm: 30,
      },
    },
  },

  // GPT-5.4 Series
  'gpt-5.4': {
    name: 'gpt-5.4',
    provider: Vendor.OpenAI,
    description: 'Flagship model with 1M+ context. Reasoning.effort: none, low, medium, high, xhigh. Computer use, MCP, tool search',
    isActive: true,
    releaseDate: '2026-03-05',
    knowledgeCutoff: '2025-08-31',
    features: {
      reasoning: true,
      streaming: true,
      structuredOutput: true,
      functionCalling: true,
      fineTuning: false,
      predictedOutputs: false,
      realtime: false,
      vision: true,
      audio: false,
      video: false,
      batchAPI: true,
      promptCaching: true,
      parameters: {
        temperature: false,
        topP: false,
        frequencyPenalty: false,
        presencePenalty: false,
      },
      input: {
        tokens: 1050000,
        text: true,
        image: true,
        cpm: 2.5,
        cpmCached: 0.25,
      },
      output: {
        tokens: 128000,
        text: true,
        cpm: 15,
      },
    },
  },

  'gpt-5.4-mini': {
    name: 'gpt-5.4-mini',
    provider: Vendor.OpenAI,
    description: 'Smaller, faster, cheaper sibling of gpt-5.4. 400K context. Text + vision in, text out. Reasoning.effort: none, low, medium, high, xhigh',
    isActive: true,
    releaseDate: '2026-03-17',
    knowledgeCutoff: '2025-08-31',
    features: {
      reasoning: true,
      streaming: true,
      structuredOutput: true,
      functionCalling: true,
      fineTuning: false,
      predictedOutputs: false,
      realtime: false,
      vision: true,
      audio: false,
      video: false,
      batchAPI: true,
      promptCaching: true,
      parameters: {
        temperature: false,
        topP: false,
        frequencyPenalty: false,
        presencePenalty: false,
      },
      input: {
        tokens: 400000,
        text: true,
        image: true,
        cpm: 0.75,
        cpmCached: 0.075,
      },
      output: {
        tokens: 128000,
        text: true,
        cpm: 4.5,
      },
    },
  },

  'gpt-5.4-nano': {
    name: 'gpt-5.4-nano',
    provider: Vendor.OpenAI,
    description: 'Smallest gpt-5.4 variant for high-volume, low-latency tasks. 400K context. Text + vision in, text out. Reasoning.effort: none, low, medium, high, xhigh',
    isActive: true,
    releaseDate: '2026-03-17',
    knowledgeCutoff: '2025-08-31',
    features: {
      reasoning: true,
      streaming: true,
      structuredOutput: true,
      functionCalling: true,
      fineTuning: false,
      predictedOutputs: false,
      realtime: false,
      vision: true,
      audio: false,
      video: false,
      batchAPI: true,
      promptCaching: true,
      parameters: {
        temperature: false,
        topP: false,
        frequencyPenalty: false,
        presencePenalty: false,
      },
      input: {
        tokens: 400000,
        text: true,
        image: true,
        cpm: 0.2,
        cpmCached: 0.02,
      },
      output: {
        tokens: 128000,
        text: true,
        cpm: 1.25,
      },
    },
  },

  'gpt-5.4-pro': {
    name: 'gpt-5.4-pro',
    provider: Vendor.OpenAI,
    description: 'GPT-5.4 pro for smarter, more precise responses. Reasoning.effort: medium, high, xhigh only',
    isActive: true,
    releaseDate: '2026-03-05',
    knowledgeCutoff: '2025-08-31',
    features: {
      reasoning: true,
      streaming: true,
      structuredOutput: false,
      functionCalling: true,
      fineTuning: false,
      predictedOutputs: false,
      realtime: false,
      vision: true,
      audio: false,
      video: false,
      batchAPI: true,
      promptCaching: false,
      parameters: {
        temperature: false,
        topP: false,
        frequencyPenalty: false,
        presencePenalty: false,
      },
      input: {
        tokens: 1050000,
        text: true,
        image: true,
        cpm: 30,
      },
      output: {
        tokens: 128000,
        text: true,
        cpm: 180,
      },
    },
  },

  // GPT-5.3 Series
  'gpt-5.3-codex': {
    name: 'gpt-5.3-codex',
    provider: Vendor.OpenAI,
    description: 'Latest codex model for coding and agentic tasks. Reasoning.effort: low, medium, high, xhigh',
    isActive: true,
    releaseDate: '2026-02-01',
    knowledgeCutoff: '2025-08-31',
    features: {
      reasoning: true,
      streaming: true,
      structuredOutput: true,
      functionCalling: true,
      fineTuning: false,
      predictedOutputs: false,
      realtime: false,
      vision: true,
      audio: false,
      video: false,
      batchAPI: true,
      promptCaching: true,
      parameters: {
        temperature: false,
        topP: false,
        frequencyPenalty: false,
        presencePenalty: false,
      },
      input: {
        tokens: 400000,
        text: true,
        image: true,
        cpm: 1.75,
        cpmCached: 0.175,
      },
      output: {
        tokens: 128000,
        text: true,
        cpm: 14,
      },
    },
  },

  'gpt-5.3-chat-latest': {
    name: 'gpt-5.3-chat-latest',
    provider: Vendor.OpenAI,
    description: 'Retired GPT-5.3 chat alias retained for migration metadata',
    isActive: false,
    lifecycle: 'retired',
    deprecationDate: '2026-05-08',
    retirementDate: '2026-08-10',
    replacementModel: 'gpt-5.6-sol',
    releaseDate: '2026-02-01',
    knowledgeCutoff: '2025-08-31',
    features: {
      reasoning: false,
      streaming: true,
      structuredOutput: true,
      functionCalling: true,
      fineTuning: false,
      predictedOutputs: false,
      realtime: false,
      vision: true,
      audio: false,
      video: false,
      batchAPI: true,
      promptCaching: true,
      parameters: {
        temperature: false,
      },
      input: {
        tokens: 128000,
        text: true,
        image: true,
        cpm: 1.75,
        cpmCached: 0.175,
      },
      output: {
        tokens: 16000,
        text: true,
        cpm: 14,
      },
    },
  },

  // GPT-5.2 Series
  'gpt-5.2': {
    name: 'gpt-5.2',
    provider: Vendor.OpenAI,
    description: 'Previous flagship model for coding and agentic tasks. Reasoning.effort: none, low, medium, high, xhigh',
    isActive: true,
    releaseDate: '2025-12-01',
    knowledgeCutoff: '2025-08-31',
    features: {
      reasoning: true,
      streaming: true,
      structuredOutput: true,
      functionCalling: true,
      fineTuning: false,
      predictedOutputs: false,
      realtime: false,
      vision: true,
      audio: false,
      video: false,
      batchAPI: true,
      promptCaching: true,
      parameters: {
        temperature: false,
        topP: false,
        frequencyPenalty: false,
        presencePenalty: false,
      },
      input: {
        tokens: 400000,
        text: true,
        image: true,
        cpm: 1.75,
        cpmCached: 0.175,
      },
      output: {
        tokens: 128000,
        text: true,
        cpm: 14,
      },
    },
  },

  'gpt-5.2-pro': {
    name: 'gpt-5.2-pro',
    provider: Vendor.OpenAI,
    description: 'GPT-5.2 pro produces smarter and more precise responses. Reasoning.effort: medium, high, xhigh',
    isActive: true,
    releaseDate: '2025-12-01',
    knowledgeCutoff: '2025-08-31',
    features: {
      reasoning: true,
      streaming: true,
      structuredOutput: false,
      functionCalling: true,
      fineTuning: false,
      predictedOutputs: false,
      realtime: false,
      vision: true,
      audio: false,
      video: false,
      batchAPI: true,
      promptCaching: true,
      parameters: {
        temperature: false,
        topP: false,
        frequencyPenalty: false,
        presencePenalty: false,
      },
      input: {
        tokens: 400000,
        text: true,
        image: true,
        cpm: 21,
      },
      output: {
        tokens: 128000,
        text: true,
        cpm: 168,
      },
    },
  },

  'gpt-5.2-codex': {
    name: 'gpt-5.2-codex',
    provider: Vendor.OpenAI,
    description: 'GPT-5.2 codex for coding and agentic tasks. Reasoning.effort: low, medium, high, xhigh',
    isActive: false,
    lifecycle: 'retired',
    deprecationDate: '2026-04-22',
    retirementDate: '2026-07-23',
    replacementModel: 'gpt-5.6-sol',
    releaseDate: '2025-12-01',
    knowledgeCutoff: '2025-08-31',
    features: {
      reasoning: true,
      streaming: true,
      structuredOutput: true,
      functionCalling: true,
      fineTuning: false,
      predictedOutputs: false,
      realtime: false,
      vision: true,
      audio: false,
      video: false,
      batchAPI: true,
      promptCaching: true,
      parameters: {
        temperature: false,
        topP: false,
        frequencyPenalty: false,
        presencePenalty: false,
      },
      input: {
        tokens: 400000,
        text: true,
        image: true,
        cpm: 1.75,
        cpmCached: 0.175,
      },
      output: {
        tokens: 128000,
        text: true,
        cpm: 14,
      },
    },
  },

  'gpt-5.2-chat-latest': {
    name: 'gpt-5.2-chat-latest',
    provider: Vendor.OpenAI,
    description: 'GPT-5.2 chat model for general-purpose use',
    isActive: false,
    lifecycle: 'retired',
    deprecationDate: '2026-05-08',
    retirementDate: '2026-08-10',
    replacementModel: 'gpt-5.6-sol',
    releaseDate: '2025-12-01',
    knowledgeCutoff: '2025-08-31',
    features: {
      reasoning: false,
      streaming: true,
      structuredOutput: true,
      functionCalling: true,
      fineTuning: false,
      predictedOutputs: false,
      realtime: false,
      vision: true,
      audio: false,
      video: false,
      batchAPI: true,
      promptCaching: true,
      input: {
        tokens: 128000,
        text: true,
        image: true,
        cpm: 1.75,
        cpmCached: 0.175,
      },
      output: {
        tokens: 16000,
        text: true,
        cpm: 14,
      },
    },
  },

  // GPT-5.1 Series
  'gpt-5.1': {
    name: 'gpt-5.1',
    provider: Vendor.OpenAI,
    description: 'Intelligent reasoning model for coding and agentic tasks. Reasoning.effort: none, low, medium, high',
    isActive: true,
    releaseDate: '2025-10-01',
    knowledgeCutoff: '2024-09-30',
    features: {
      reasoning: true,
      streaming: true,
      structuredOutput: true,
      functionCalling: true,
      fineTuning: false,
      predictedOutputs: false,
      realtime: false,
      vision: true,
      audio: false,
      video: false,
      batchAPI: true,
      promptCaching: true,
      parameters: {
        temperature: false,
        topP: false,
        frequencyPenalty: false,
        presencePenalty: false,
      },
      input: {
        tokens: 400000,
        text: true,
        image: true,
        cpm: 1.25,
        cpmCached: 0.125,
      },
      output: {
        tokens: 128000,
        text: true,
        cpm: 10,
      },
    },
  },

  'gpt-5.1-codex': {
    name: 'gpt-5.1-codex',
    provider: Vendor.OpenAI,
    description: 'GPT-5.1 codex for coding and agentic tasks with reasoning',
    isActive: false,
    lifecycle: 'retired',
    deprecationDate: '2026-04-22',
    retirementDate: '2026-07-23',
    replacementModel: 'gpt-5.6-sol',
    releaseDate: '2025-10-01',
    knowledgeCutoff: '2024-09-30',
    features: {
      reasoning: true,
      streaming: true,
      structuredOutput: true,
      functionCalling: true,
      fineTuning: false,
      predictedOutputs: false,
      realtime: false,
      vision: true,
      audio: false,
      video: false,
      batchAPI: true,
      promptCaching: true,
      parameters: {
        temperature: false,
        topP: false,
        frequencyPenalty: false,
        presencePenalty: false,
      },
      input: {
        tokens: 400000,
        text: true,
        image: true,
        cpm: 1.25,
        cpmCached: 0.125,
      },
      output: {
        tokens: 128000,
        text: true,
        cpm: 10,
      },
    },
  },

  'gpt-5.1-codex-max': {
    name: 'gpt-5.1-codex-max',
    provider: Vendor.OpenAI,
    description: 'GPT-5.1 codex max for maximum reasoning depth on coding tasks',
    isActive: false,
    lifecycle: 'retired',
    deprecationDate: '2026-04-22',
    retirementDate: '2026-07-23',
    replacementModel: 'gpt-5.6-sol',
    releaseDate: '2025-10-01',
    knowledgeCutoff: '2024-09-30',
    features: {
      reasoning: true,
      streaming: true,
      structuredOutput: true,
      functionCalling: true,
      fineTuning: false,
      predictedOutputs: false,
      realtime: false,
      vision: true,
      audio: false,
      video: false,
      batchAPI: true,
      promptCaching: true,
      parameters: {
        temperature: false,
        topP: false,
        frequencyPenalty: false,
        presencePenalty: false,
      },
      input: {
        tokens: 400000,
        text: true,
        image: true,
        cpm: 1.25,
        cpmCached: 0.125,
      },
      output: {
        tokens: 128000,
        text: true,
        cpm: 10,
      },
    },
  },

  'gpt-5.1-codex-mini': {
    name: 'gpt-5.1-codex-mini',
    provider: Vendor.OpenAI,
    description: 'GPT-5.1 codex mini for cost-efficient coding tasks',
    isActive: false,
    lifecycle: 'retired',
    deprecationDate: '2026-04-22',
    retirementDate: '2026-07-23',
    replacementModel: 'gpt-5.6-terra',
    releaseDate: '2025-10-01',
    knowledgeCutoff: '2024-09-30',
    features: {
      reasoning: true,
      streaming: true,
      structuredOutput: true,
      functionCalling: true,
      fineTuning: false,
      predictedOutputs: false,
      realtime: false,
      vision: true,
      audio: false,
      video: false,
      batchAPI: true,
      promptCaching: true,
      parameters: {
        temperature: false,
        topP: false,
        frequencyPenalty: false,
        presencePenalty: false,
      },
      input: {
        tokens: 400000,
        text: true,
        image: true,
        cpm: 0.25,
        cpmCached: 0.025,
      },
      output: {
        tokens: 128000,
        text: true,
        cpm: 2,
      },
    },
  },

  'gpt-5.1-chat-latest': {
    name: 'gpt-5.1-chat-latest',
    provider: Vendor.OpenAI,
    description: 'GPT-5.1 chat model for general-purpose use',
    isActive: false,
    lifecycle: 'retired',
    deprecationDate: '2026-04-22',
    retirementDate: '2026-07-23',
    replacementModel: 'gpt-5.6-sol',
    releaseDate: '2025-10-01',
    knowledgeCutoff: '2024-09-30',
    features: {
      reasoning: false,
      streaming: true,
      structuredOutput: true,
      functionCalling: true,
      fineTuning: false,
      predictedOutputs: false,
      realtime: false,
      vision: true,
      audio: false,
      video: false,
      batchAPI: true,
      promptCaching: true,
      input: {
        tokens: 128000,
        text: true,
        image: true,
        cpm: 1.25,
        cpmCached: 0.125,
      },
      output: {
        tokens: 16000,
        text: true,
        cpm: 10,
      },
    },
  },

  // GPT-5 Series
  'gpt-5': {
    name: 'gpt-5',
    provider: Vendor.OpenAI,
    description: 'Previous intelligent reasoning model for coding and agentic tasks. Reasoning.effort: minimal, low, medium, high',
    isActive: true,
    releaseDate: '2025-08-01',
    knowledgeCutoff: '2024-09-30',
    features: {
      reasoning: true,
      streaming: true,
      structuredOutput: true,
      functionCalling: true,
      fineTuning: false,
      predictedOutputs: false,
      realtime: false,
      vision: true,
      audio: false,
      video: false,
      batchAPI: true,
      promptCaching: true,
      parameters: {
        temperature: false,
        topP: false,
        frequencyPenalty: false,
        presencePenalty: false,
      },
      input: {
        tokens: 400000,
        text: true,
        image: true,
        cpm: 1.25,
        cpmCached: 0.125,
      },
      output: {
        tokens: 128000,
        text: true,
        cpm: 10,
      },
    },
  },

  'gpt-5-mini': {
    name: 'gpt-5-mini',
    provider: Vendor.OpenAI,
    description: 'Faster, cost-efficient version of GPT-5 for well-defined tasks and precise prompts',
    isActive: true,
    releaseDate: '2025-08-01',
    knowledgeCutoff: '2024-05-31',
    features: {
      reasoning: true,
      streaming: true,
      structuredOutput: true,
      functionCalling: true,
      fineTuning: false,
      predictedOutputs: false,
      realtime: false,
      vision: true,
      audio: false,
      video: false,
      batchAPI: true,
      promptCaching: true,
      parameters: {
        temperature: false,
        topP: false,
        frequencyPenalty: false,
        presencePenalty: false,
      },
      input: {
        tokens: 400000,
        text: true,
        image: true,
        cpm: 0.25,
        cpmCached: 0.025,
      },
      output: {
        tokens: 128000,
        text: true,
        cpm: 2,
      },
    },
  },

  'gpt-5-nano': {
    name: 'gpt-5-nano',
    provider: Vendor.OpenAI,
    description: 'Fastest, most cost-efficient GPT-5. Great for summarization and classification tasks',
    isActive: true,
    releaseDate: '2025-08-01',
    knowledgeCutoff: '2024-05-31',
    features: {
      reasoning: true,
      streaming: true,
      structuredOutput: true,
      functionCalling: true,
      fineTuning: false,
      predictedOutputs: false,
      realtime: false,
      vision: true,
      audio: false,
      video: false,
      batchAPI: true,
      promptCaching: true,
      parameters: {
        temperature: false,
        topP: false,
        frequencyPenalty: false,
        presencePenalty: false,
      },
      input: {
        tokens: 400000,
        text: true,
        image: true,
        cpm: 0.05,
        cpmCached: 0.005,
      },
      output: {
        tokens: 128000,
        text: true,
        cpm: 0.4,
      },
    },
  },

  'gpt-5-codex': {
    name: 'gpt-5-codex',
    provider: Vendor.OpenAI,
    description: 'GPT-5 codex for coding and agentic tasks with reasoning',
    isActive: false,
    lifecycle: 'retired',
    deprecationDate: '2026-04-22',
    retirementDate: '2026-07-23',
    replacementModel: 'gpt-5.6-sol',
    releaseDate: '2025-08-01',
    knowledgeCutoff: '2024-09-30',
    features: {
      reasoning: true,
      streaming: true,
      structuredOutput: true,
      functionCalling: true,
      fineTuning: false,
      predictedOutputs: false,
      realtime: false,
      vision: true,
      audio: false,
      video: false,
      batchAPI: true,
      promptCaching: true,
      parameters: {
        temperature: false,
        topP: false,
        frequencyPenalty: false,
        presencePenalty: false,
      },
      input: {
        tokens: 400000,
        text: true,
        image: true,
        cpm: 1.25,
        cpmCached: 0.125,
      },
      output: {
        tokens: 128000,
        text: true,
        cpm: 10,
      },
    },
  },

  'gpt-5-chat-latest': {
    name: 'gpt-5-chat-latest',
    provider: Vendor.OpenAI,
    description: 'GPT-5 chat model for general-purpose use',
    isActive: false,
    lifecycle: 'retired',
    deprecationDate: '2026-04-22',
    retirementDate: '2026-07-23',
    replacementModel: 'gpt-5.6-sol',
    releaseDate: '2025-08-01',
    knowledgeCutoff: '2024-09-30',
    features: {
      reasoning: false,
      streaming: true,
      structuredOutput: true,
      functionCalling: true,
      fineTuning: false,
      predictedOutputs: false,
      realtime: false,
      vision: true,
      audio: false,
      video: false,
      batchAPI: true,
      promptCaching: true,
      input: {
        tokens: 128000,
        text: true,
        image: true,
        cpm: 1.25,
        cpmCached: 0.125,
      },
      output: {
        tokens: 16000,
        text: true,
        cpm: 10,
      },
    },
  },

  // GPT-4.1 Series
  'gpt-4.1': {
    name: 'gpt-4.1',
    provider: Vendor.OpenAI,
    description: 'GPT-4.1 specialized for coding with 1M token context window',
    isActive: true,
    releaseDate: '2025-04-14',
    knowledgeCutoff: '2024-06-01',
    features: {
      reasoning: false,
      streaming: true,
      structuredOutput: true,
      functionCalling: true,
      fineTuning: false,
      predictedOutputs: false,
      realtime: false,
      vision: true,
      audio: false,
      video: false,
      batchAPI: true,
      promptCaching: true,
      input: {
        tokens: 1000000,
        text: true,
        image: true,
        cpm: 2,
        cpmCached: 0.50,
      },
      output: {
        tokens: 32768,
        text: true,
        cpm: 8,
      },
    },
  },

  'gpt-4.1-mini': {
    name: 'gpt-4.1-mini',
    provider: Vendor.OpenAI,
    description: 'Efficient GPT-4.1 model, beats GPT-4o in many benchmarks at 83% lower cost',
    isActive: true,
    releaseDate: '2025-04-14',
    knowledgeCutoff: '2024-06-01',
    features: {
      reasoning: false,
      streaming: true,
      structuredOutput: true,
      functionCalling: true,
      fineTuning: false,
      predictedOutputs: false,
      realtime: false,
      vision: true,
      audio: false,
      video: false,
      batchAPI: true,
      promptCaching: true,
      input: {
        tokens: 1000000,
        text: true,
        image: true,
        cpm: 0.4,
        cpmCached: 0.10,
      },
      output: {
        tokens: 16384,
        text: true,
        cpm: 1.6,
      },
    },
  },

  'gpt-4.1-nano': {
    name: 'gpt-4.1-nano',
    provider: Vendor.OpenAI,
    description: 'Fastest and cheapest model with 1M context. 80.1% MMLU, ideal for classification/autocompletion',
    isActive: true,
    lifecycle: 'deprecated',
    deprecationDate: '2026-04-22',
    retirementDate: '2026-10-23',
    replacementModel: 'gpt-5.6-luna',
    releaseDate: '2025-04-14',
    knowledgeCutoff: '2024-06-01',
    features: {
      reasoning: false,
      streaming: true,
      structuredOutput: true,
      functionCalling: true,
      fineTuning: false,
      predictedOutputs: false,
      realtime: false,
      vision: true,
      audio: false,
      video: false,
      batchAPI: true,
      promptCaching: true,
      input: {
        tokens: 1000000,
        text: true,
        image: true,
        cpm: 0.1,
        cpmCached: 0.025,
      },
      output: {
        tokens: 16384,
        text: true,
        cpm: 0.4,
      },
    },
  },

  // GPT-4o Series (Legacy)
  'gpt-4o': {
    name: 'gpt-4o',
    provider: Vendor.OpenAI,
    description: 'Versatile omni model. Legacy but still available',
    isActive: true,
    releaseDate: '2024-05-13',
    knowledgeCutoff: '2023-10-01',
    features: {
      reasoning: false,
      streaming: true,
      structuredOutput: true,
      functionCalling: true,
      fineTuning: false,
      predictedOutputs: true,
      realtime: false,
      vision: true,
      audio: false,
      video: false,
      batchAPI: true,
      promptCaching: true,
      input: {
        tokens: 128000,
        text: true,
        image: true,
        cpm: 2.5,
        cpmCached: 1.25,
      },
      output: {
        tokens: 16384,
        text: true,
        cpm: 10,
      },
    },
  },

  'gpt-4o-mini': {
    name: 'gpt-4o-mini',
    provider: Vendor.OpenAI,
    description: 'Fast, affordable omni model',
    isActive: true,
    releaseDate: '2024-07-18',
    knowledgeCutoff: '2023-10-01',
    features: {
      reasoning: false,
      streaming: true,
      structuredOutput: true,
      functionCalling: true,
      fineTuning: true,
      predictedOutputs: false,
      realtime: false,
      vision: true,
      audio: false,
      video: false,
      batchAPI: true,
      promptCaching: true,
      input: {
        tokens: 128000,
        text: true,
        image: true,
        cpm: 0.15,
        cpmCached: 0.075,
      },
      output: {
        tokens: 16384,
        text: true,
        cpm: 0.6,
      },
    },
  },

  // Audio Models (New generation - replaces gpt-4o-audio-*)
  'gpt-audio-1.5': {
    name: 'gpt-audio-1.5',
    provider: Vendor.OpenAI,
    description: 'Latest audio model with text+audio input/output. 128K context',
    isActive: true,
    preferred: true,
    releaseDate: '2025-12-01',
    knowledgeCutoff: '2024-09-30',
    features: {
      reasoning: false,
      streaming: true,
      structuredOutput: false,
      functionCalling: true,
      fineTuning: false,
      predictedOutputs: false,
      realtime: false,
      vision: false,
      audio: true,
      video: false,
      batchAPI: false,
      promptCaching: false,
      input: {
        tokens: 128000,
        text: true,
        audio: true,
        cpm: 2.5,
      },
      output: {
        tokens: 16384,
        text: true,
        audio: true,
        cpm: 10,
      },
    },
  },

  'gpt-audio': {
    name: 'gpt-audio',
    provider: Vendor.OpenAI,
    description: 'Audio model with text+audio input/output. 128K context',
    isActive: true,
    lifecycle: 'deprecated',
    deprecationDate: '2026-07-20',
    retirementDate: '2027-01-20',
    replacementModel: 'gpt-audio-1.5',
    releaseDate: '2025-06-01',
    knowledgeCutoff: '2023-10-01',
    features: {
      reasoning: false,
      streaming: true,
      structuredOutput: false,
      functionCalling: true,
      fineTuning: false,
      predictedOutputs: false,
      realtime: false,
      vision: false,
      audio: true,
      video: false,
      batchAPI: false,
      promptCaching: false,
      input: {
        tokens: 128000,
        text: true,
        audio: true,
        cpm: 2.5,
      },
      output: {
        tokens: 16384,
        text: true,
        audio: true,
        cpm: 10,
      },
    },
  },

  'gpt-audio-mini': {
    name: 'gpt-audio-mini',
    provider: Vendor.OpenAI,
    description: 'Cost-efficient audio model. 128K context',
    isActive: true,
    lifecycle: 'deprecated',
    deprecationDate: '2026-07-20',
    retirementDate: '2027-01-20',
    replacementModel: 'gpt-audio-1.5',
    releaseDate: '2025-06-01',
    knowledgeCutoff: '2023-10-01',
    features: {
      reasoning: false,
      streaming: true,
      structuredOutput: false,
      functionCalling: true,
      fineTuning: false,
      predictedOutputs: false,
      realtime: false,
      vision: false,
      audio: true,
      video: false,
      batchAPI: false,
      promptCaching: false,
      input: {
        tokens: 128000,
        text: true,
        audio: true,
        cpm: 0.6,
      },
      output: {
        tokens: 16384,
        text: true,
        audio: true,
        cpm: 2.4,
      },
    },
  },

  // Realtime Models
  'gpt-live-1': {
    name: 'gpt-live-1',
    provider: Vendor.OpenAI,
    description: 'Full-duplex voice model for natural conversations, smooth interruptions, and delegation to a backend Responses agent',
    isActive: true,
    lifecycle: 'active',
    availability: 'public',
    preferred: true,
    endpoints: ['live'],
    releaseDate: '2026-09-22',
    knowledgeCutoff: '2025-07-31',
    voices: OPENAI_REALTIME_VOICES,
    sources: { documentation: 'https://developers.openai.com/api/docs/models/gpt-live-1', pricing: 'https://developers.openai.com/api/docs/pricing', lastVerified: '2026-10-07' },
    features: {
      reasoning: false, streaming: true, structuredOutput: false, functionCalling: true,
      fineTuning: false, predictedOutputs: false, realtime: true, vision: false,
      audio: true, video: false, batchAPI: false, promptCaching: false,
      pricing: { audioDurationPerMinute: 0.05 },
      input: { tokens: 128_000, text: true, audio: true, cpm: 0 },
      output: { tokens: null, text: true, audio: true, cpm: 0 },
    },
  },

  'gpt-realtime-2.1': {
    name: 'gpt-realtime-2.1',
    provider: Vendor.OpenAI,
    description: 'Most capable realtime reasoning voice model, with improved alphanumeric recognition, silence/noise handling, interruptions, instruction following, and tool use',
    isActive: true,
    preferred: true,
    knowledgeCutoff: '2024-09-30',
    voices: OPENAI_REALTIME_VOICES,
    features: {
      reasoning: true,
      streaming: true,
      structuredOutput: false,
      functionCalling: true,
      fineTuning: false,
      predictedOutputs: false,
      realtime: true,
      vision: true,
      audio: true,
      video: false,
      batchAPI: false,
      promptCaching: true,
      pricing: {
        text: { input: 4, cachedInput: 0.4, output: 24 },
        audio: { input: 32, cachedInput: 0.4, output: 64 },
        image: { input: 5, cachedInput: 0.5 },
      },
      input: { tokens: 128000, text: true, image: true, audio: true, cpm: 4, cpmCached: 0.4 },
      output: { tokens: 32000, text: true, audio: true, cpm: 24 },
    },
  },

  'gpt-realtime-2.1-mini': {
    name: 'gpt-realtime-2.1-mini',
    provider: Vendor.OpenAI,
    description: 'Fast, lower-cost distilled realtime reasoning model with speech, tools, and improved alphanumeric recognition',
    isActive: true,
    knowledgeCutoff: '2024-09-30',
    voices: OPENAI_REALTIME_VOICES,
    features: {
      reasoning: true,
      streaming: true,
      structuredOutput: false,
      functionCalling: true,
      fineTuning: false,
      predictedOutputs: false,
      realtime: true,
      vision: true,
      audio: true,
      video: false,
      batchAPI: false,
      promptCaching: true,
      pricing: {
        text: { input: 0.6, cachedInput: 0.06, output: 2.4 },
        audio: { input: 10, cachedInput: 0.3, output: 20 },
        image: { input: 0.8, cachedInput: 0.08 },
      },
      input: { tokens: 128000, text: true, image: true, audio: true, cpm: 0.6, cpmCached: 0.06 },
      output: { tokens: 32000, text: true, audio: true, cpm: 2.4 },
    },
  },

  'gpt-realtime-2': {
    name: 'gpt-realtime-2',
    provider: Vendor.OpenAI,
    description: 'Realtime reasoning model with configurable effort and reliable tool use for complex voice-agent workflows',
    isActive: true,
    knowledgeCutoff: '2024-09-30',
    voices: OPENAI_REALTIME_VOICES,
    features: {
      reasoning: true,
      streaming: true,
      structuredOutput: false,
      functionCalling: true,
      fineTuning: false,
      predictedOutputs: false,
      realtime: true,
      vision: true,
      audio: true,
      video: false,
      batchAPI: false,
      promptCaching: true,
      pricing: {
        text: { input: 4, cachedInput: 0.4, output: 24 },
        audio: { input: 32, cachedInput: 0.4, output: 64 },
        image: { input: 5, cachedInput: 0.5 },
      },
      input: { tokens: 128000, text: true, image: true, audio: true, cpm: 4, cpmCached: 0.4 },
      output: { tokens: 32000, text: true, audio: true, cpm: 24 },
    },
  },

  'gpt-realtime-translate': {
    name: 'gpt-realtime-translate',
    provider: Vendor.OpenAI,
    description: 'Streaming speech-to-speech translation model using the dedicated realtime translations endpoint',
    isActive: true,
    knowledgeCutoff: '2024-09-30',
    voices: OPENAI_REALTIME_VOICES,
    features: {
      reasoning: false,
      streaming: true,
      structuredOutput: false,
      functionCalling: false,
      fineTuning: false,
      predictedOutputs: false,
      realtime: true,
      vision: false,
      audio: true,
      video: false,
      batchAPI: false,
      promptCaching: false,
      pricing: { audioDurationPerMinute: 0.034 },
      input: { tokens: 16000, text: false, audio: true, cpm: 0 },
      output: { tokens: 2000, text: true, audio: true, cpm: 0 },
    },
  },

  'gpt-realtime-1.5': {
    name: 'gpt-realtime-1.5',
    provider: Vendor.OpenAI,
    description: 'Latest realtime model for voice/audio streaming. Text+audio+image input, text+audio output',
    isActive: true,
    releaseDate: '2025-12-01',
    knowledgeCutoff: '2024-09-30',
    voices: OPENAI_REALTIME_VOICES,
    features: {
      reasoning: false,
      streaming: true,
      structuredOutput: false,
      functionCalling: true,
      fineTuning: false,
      predictedOutputs: false,
      realtime: true,
      vision: true,
      audio: true,
      video: false,
      batchAPI: false,
      promptCaching: false,
      pricing: {
        text: { input: 4, cachedInput: 0.4, output: 16 },
        audio: { input: 32, cachedInput: 0.4, output: 64 },
        image: { input: 5, cachedInput: 0.5 },
      },
      input: {
        tokens: 32000,
        text: true,
        image: true,
        audio: true,
        cpm: 4,
      },
      output: {
        tokens: 4096,
        text: true,
        audio: true,
        cpm: 16,
      },
    },
  },

  'gpt-realtime': {
    name: 'gpt-realtime',
    provider: Vendor.OpenAI,
    description: 'Realtime model for voice/audio streaming. Text+audio+image input, text+audio output',
    isActive: true,
    lifecycle: 'deprecated',
    deprecationDate: '2026-07-20',
    retirementDate: '2027-01-20',
    replacementModel: 'gpt-realtime-2.1',
    releaseDate: '2025-06-01',
    knowledgeCutoff: '2023-10-01',
    voices: OPENAI_REALTIME_VOICES,
    features: {
      reasoning: false,
      streaming: true,
      structuredOutput: false,
      functionCalling: true,
      fineTuning: false,
      predictedOutputs: false,
      realtime: true,
      vision: true,
      audio: true,
      video: false,
      batchAPI: false,
      promptCaching: false,
      pricing: {
        text: { input: 4, cachedInput: 0.4, output: 16 },
        audio: { input: 32, cachedInput: 0.4, output: 64 },
        image: { input: 5, cachedInput: 0.5 },
      },
      input: {
        tokens: 32000,
        text: true,
        image: true,
        audio: true,
        cpm: 4,
      },
      output: {
        tokens: 4096,
        text: true,
        audio: true,
        cpm: 16,
      },
    },
  },

  'gpt-realtime-mini': {
    name: 'gpt-realtime-mini',
    provider: Vendor.OpenAI,
    description: 'Cost-efficient realtime model for voice/audio streaming',
    isActive: true,
    lifecycle: 'deprecated',
    deprecationDate: '2026-07-20',
    retirementDate: '2027-01-20',
    replacementModel: 'gpt-realtime-2.1-mini',
    releaseDate: '2025-06-01',
    knowledgeCutoff: '2023-10-01',
    voices: OPENAI_REALTIME_VOICES,
    features: {
      reasoning: false,
      streaming: true,
      structuredOutput: false,
      functionCalling: true,
      fineTuning: false,
      predictedOutputs: false,
      realtime: true,
      vision: true,
      audio: true,
      video: false,
      batchAPI: false,
      promptCaching: false,
      pricing: {
        text: { input: 0.6, cachedInput: 0.06, output: 2.4 },
        audio: { input: 10, cachedInput: 0.3, output: 20 },
        image: { input: 0.8, cachedInput: 0.08 },
      },
      input: {
        tokens: 32000,
        text: true,
        image: true,
        audio: true,
        cpm: 0.6,
      },
      output: {
        tokens: 4096,
        text: true,
        audio: true,
        cpm: 2.4,
      },
    },
  },

  // Reasoning Models (o-series)
  'o3': {
    name: 'o3',
    provider: Vendor.OpenAI,
    description: 'Powerful reasoning model for coding, math, and science. 200K context',
    isActive: true,
    preferred: true,
    releaseDate: '2025-04-01',
    knowledgeCutoff: '2024-06-01',
    features: {
      reasoning: true,
      streaming: true,
      structuredOutput: true,
      functionCalling: true,
      fineTuning: false,
      predictedOutputs: false,
      realtime: false,
      vision: true,
      audio: false,
      video: false,
      batchAPI: true,
      promptCaching: true,
      parameters: {
        temperature: false,
        topP: false,
        frequencyPenalty: false,
        presencePenalty: false,
      },
      input: {
        tokens: 200000,
        text: true,
        image: true,
        cpm: 2,
        cpmCached: 0.5,
      },
      output: {
        tokens: 100000,
        text: true,
        cpm: 8,
      },
    },
  },

  'o4-mini': {
    name: 'o4-mini',
    provider: Vendor.OpenAI,
    description: 'Fast, cost-efficient reasoning model. 200K context',
    isActive: true,
    releaseDate: '2025-04-01',
    knowledgeCutoff: '2024-06-01',
    features: {
      reasoning: true,
      streaming: true,
      structuredOutput: true,
      functionCalling: true,
      fineTuning: false,
      predictedOutputs: false,
      realtime: false,
      vision: true,
      audio: false,
      video: false,
      batchAPI: true,
      promptCaching: true,
      parameters: {
        temperature: false,
        topP: false,
        frequencyPenalty: false,
        presencePenalty: false,
      },
      input: {
        tokens: 200000,
        text: true,
        image: true,
        cpm: 1.1,
        cpmCached: 0.275,
      },
      output: {
        tokens: 100000,
        text: true,
        cpm: 4.4,
      },
    },
  },

  'o3-mini': {
    name: 'o3-mini',
    provider: Vendor.OpenAI,
    description: 'Fast reasoning model tailored for coding, math, and science',
    isActive: true,
    releaseDate: '2025-01-31',
    knowledgeCutoff: '2023-10-01',
    features: {
      reasoning: true,
      streaming: true,
      structuredOutput: true,
      functionCalling: true,
      fineTuning: false,
      predictedOutputs: false,
      realtime: false,
      vision: false,
      audio: false,
      video: false,
      batchAPI: true,
      promptCaching: true,
      parameters: {
        temperature: false,
        topP: false,
        frequencyPenalty: false,
        presencePenalty: false,
      },
      input: {
        tokens: 200000,
        text: true,
        cpm: 1.1,
        cpmCached: 0.55,
      },
      output: {
        tokens: 100000,
        text: true,
        cpm: 4.4,
      },
    },
  },

  'o1': {
    name: 'o1',
    provider: Vendor.OpenAI,
    description: 'Advanced reasoning model for complex problems',
    isActive: true,
    releaseDate: '2024-12-17',
    knowledgeCutoff: '2023-10-01',
    features: {
      reasoning: true,
      streaming: true,
      structuredOutput: true,
      functionCalling: true,
      fineTuning: false,
      predictedOutputs: false,
      realtime: false,
      vision: true,
      audio: false,
      video: false,
      batchAPI: true,
      promptCaching: true,
      parameters: {
        temperature: false,
        topP: false,
        frequencyPenalty: false,
        presencePenalty: false,
      },
      input: {
        tokens: 200000,
        text: true,
        image: true,
        cpm: 15,
        cpmCached: 7.50,
      },
      output: {
        tokens: 100000,
        text: true,
        cpm: 60,
      },
    },
  },

  // Deep Research Models
  'o3-deep-research': {
    name: 'o3-deep-research',
    provider: Vendor.OpenAI,
    description: 'Deep research model for comprehensive web-based research. No function calling',
    isActive: true,
    releaseDate: '2025-06-01',
    knowledgeCutoff: '2024-06-01',
    features: {
      reasoning: true,
      streaming: true,
      structuredOutput: false,
      functionCalling: false,
      fineTuning: false,
      predictedOutputs: false,
      realtime: false,
      vision: false,
      audio: false,
      video: false,
      batchAPI: false,
      promptCaching: false,
      parameters: {
        temperature: false,
        topP: false,
        frequencyPenalty: false,
        presencePenalty: false,
      },
      input: {
        tokens: 200000,
        text: true,
        cpm: 10,
      },
      output: {
        tokens: 100000,
        text: true,
        cpm: 40,
      },
    },
  },

  'o4-mini-deep-research': {
    name: 'o4-mini-deep-research',
    provider: Vendor.OpenAI,
    description: 'Cost-efficient deep research model for web-based research. No function calling',
    isActive: true,
    releaseDate: '2025-06-01',
    knowledgeCutoff: '2024-06-01',
    features: {
      reasoning: true,
      streaming: true,
      structuredOutput: false,
      functionCalling: false,
      fineTuning: false,
      predictedOutputs: false,
      realtime: false,
      vision: false,
      audio: false,
      video: false,
      batchAPI: false,
      promptCaching: false,
      parameters: {
        temperature: false,
        topP: false,
        frequencyPenalty: false,
        presencePenalty: false,
      },
      input: {
        tokens: 200000,
        text: true,
        cpm: 2,
      },
      output: {
        tokens: 100000,
        text: true,
        cpm: 8,
      },
    },
  },

  // Open-Weight Models (Apache 2.0)
  'gpt-oss-120b': {
    name: 'gpt-oss-120b',
    provider: Vendor.OpenAI,
    description: 'Open-weight 117B param MoE model (5.1B active). Apache 2.0 license. Runs on single H100',
    isActive: true,
    releaseDate: '2025-10-01',
    knowledgeCutoff: '2024-06-01',
    features: {
      reasoning: true,
      streaming: true,
      structuredOutput: true,
      functionCalling: true,
      fineTuning: true,
      predictedOutputs: false,
      realtime: false,
      vision: false,
      audio: false,
      video: false,
      batchAPI: false,
      promptCaching: false,
      input: {
        tokens: 131072,
        text: true,
        cpm: 0,
      },
      output: {
        tokens: 131072,
        text: true,
        cpm: 0,
      },
    },
  },

  'gpt-oss-20b': {
    name: 'gpt-oss-20b',
    provider: Vendor.OpenAI,
    description: 'Open-weight 21B param MoE model (3.6B active). Apache 2.0 license',
    isActive: true,
    releaseDate: '2025-10-01',
    knowledgeCutoff: '2024-06-01',
    features: {
      reasoning: true,
      streaming: true,
      structuredOutput: true,
      functionCalling: true,
      fineTuning: true,
      predictedOutputs: false,
      realtime: false,
      vision: false,
      audio: false,
      video: false,
      batchAPI: false,
      promptCaching: false,
      input: {
        tokens: 131072,
        text: true,
        cpm: 0,
      },
      output: {
        tokens: 131072,
        text: true,
        cpm: 0,
      },
    },
  },

  // ============================================================================
  // Anthropic Models (Verified from platform.claude.com - October 2026)
  // Source: https://platform.claude.com/docs/en/models/overview
  // ============================================================================

  'claude-opus-5-5': {
    name: 'claude-opus-5-5',
    provider: Vendor.Anthropic,
    description: 'Anthropic flagship for the most demanding reasoning, coding, and long-horizon agentic work',
    isActive: true,
    lifecycle: 'active',
    availability: 'public',
    preferred: true,
    endpoints: ['messages', 'batch'],
    releaseDate: '2026-09-22',
    knowledgeCutoff: '2026-06-01',
    sources: { documentation: 'https://platform.claude.com/docs/en/models/opus-5-5/overview', pricing: 'https://platform.claude.com/docs/en/about-claude/pricing', lastVerified: '2026-10-07' },
    features: {
      reasoning: true, reasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
      streaming: true, structuredOutput: true, functionCalling: true,
      fineTuning: false, predictedOutputs: false, realtime: false, vision: true,
      audio: false, video: false, extendedThinking: true, batchAPI: true, promptCaching: true,
      parameters: { temperature: false, topP: false, topK: false, frequencyPenalty: false, presencePenalty: false },
      input: { tokens: 1_000_000, text: true, image: true, cpm: 4, cpmCached: 0.2 },
      output: { tokens: 128_000, text: true, cpm: 20 },
      pricing: {
        text: { input: 4, cachedInput: 0.2, cacheWrite: 5, output: 20 },
        processingMultipliers: { batch: 0.5 },
      },
    },
  },

  'claude-sonnet-5-5': {
    name: 'claude-sonnet-5-5',
    provider: Vendor.Anthropic,
    description: 'Latest balanced Claude model for coding, agents, and production knowledge work',
    isActive: true,
    lifecycle: 'active',
    availability: 'public',
    preferred: true,
    endpoints: ['messages', 'batch'],
    releaseDate: '2026-09-28',
    knowledgeCutoff: '2026-06-01',
    sources: { documentation: 'https://platform.claude.com/docs/en/models/sonnet-5-5/overview', pricing: 'https://platform.claude.com/docs/en/about-claude/pricing', lastVerified: '2026-10-07' },
    features: {
      reasoning: true, reasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
      streaming: true, structuredOutput: true, functionCalling: true,
      fineTuning: false, predictedOutputs: false, realtime: false, vision: true,
      audio: false, video: false, extendedThinking: true, batchAPI: true, promptCaching: true,
      parameters: { temperature: false, topP: false, topK: false, frequencyPenalty: false, presencePenalty: false },
      input: { tokens: 1_000_000, text: true, image: true, cpm: 2, cpmCached: 0.2 },
      output: { tokens: 128_000, text: true, cpm: 10 },
      pricing: {
        text: { input: 2, cachedInput: 0.2, cacheWrite: 2.5, output: 10 },
        processingMultipliers: { batch: 0.5 },
      },
    },
  },

  'claude-fable-5-1': {
    name: 'claude-fable-5-1',
    provider: Vendor.Anthropic,
    description: 'Anthropic\'s most capable public model for demanding reasoning and long-horizon agentic work; adaptive thinking is always on',
    isActive: true,
    lifecycle: 'active',
    availability: 'public',
    preferred: true,
    endpoints: ['messages', 'batch'],
    releaseDate: '2026-09-01',
    knowledgeCutoff: '2026-06-01',
    sources: { documentation: 'https://platform.claude.com/docs/en/models/fable-5-1/overview', pricing: 'https://platform.claude.com/docs/en/models/fable-5-1/overview', lastVerified: '2026-09-04' },
    features: {
      reasoning: true, reasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
      streaming: true, structuredOutput: true, functionCalling: true,
      fineTuning: false, predictedOutputs: false, realtime: false, vision: true,
      audio: false, video: false, extendedThinking: true, batchAPI: true, promptCaching: true,
      parameters: { temperature: false, topP: false, topK: false, frequencyPenalty: false, presencePenalty: false },
      input: { tokens: 1_000_000, text: true, image: true, cpm: 10, cpmCached: 0.25 },
      output: { tokens: 128_000, text: true, cpm: 50 },
      pricing: {
        text: { input: 10, cachedInput: 0.25, cacheWrite: 12.5, output: 50 },
        processingMultipliers: { batch: 0.5 },
      },
    },
  },

  'claude-mythos-5-1': {
    name: 'claude-mythos-5-1',
    provider: Vendor.Anthropic,
    description: 'Invite-only Project Glasswing counterpart to Claude Fable 5.1 with the same specifications, capabilities, and pricing',
    isActive: true,
    lifecycle: 'active',
    availability: 'invite_only',
    endpoints: ['messages', 'batch'],
    releaseDate: '2026-09-01',
    knowledgeCutoff: '2026-06-01',
    sources: { documentation: 'https://platform.claude.com/docs/en/models/mythos-5-1/overview', pricing: 'https://platform.claude.com/docs/en/models/mythos-5-1/overview', lastVerified: '2026-09-04' },
    features: {
      reasoning: true, reasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
      streaming: true, structuredOutput: true, functionCalling: true,
      fineTuning: false, predictedOutputs: false, realtime: false, vision: true,
      audio: false, video: false, extendedThinking: true, batchAPI: true, promptCaching: true,
      parameters: { temperature: false, topP: false, topK: false, frequencyPenalty: false, presencePenalty: false },
      input: { tokens: 1_000_000, text: true, image: true, cpm: 10, cpmCached: 0.25 },
      output: { tokens: 128_000, text: true, cpm: 50 },
      pricing: {
        text: { input: 10, cachedInput: 0.25, cacheWrite: 12.5, output: 50 },
        processingMultipliers: { batch: 0.5 },
      },
    },
  },

  'claude-opus-5': {
    name: 'claude-opus-5',
    provider: Vendor.Anthropic,
    description: 'Frontier Claude model for complex agentic coding and enterprise work; adaptive thinking is enabled by default',
    isActive: true,
    lifecycle: 'legacy',
    availability: 'public',
    replacementModel: 'claude-opus-5-5',
    endpoints: ['messages', 'batch'],
    releaseDate: '2026-07-24',
    knowledgeCutoff: '2026-05-01',
    sources: { documentation: 'https://platform.claude.com/docs/en/models/opus-5/overview', pricing: 'https://platform.claude.com/docs/en/models/opus-5/overview', lastVerified: '2026-09-04' },
    features: {
      reasoning: true, reasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
      streaming: true, structuredOutput: true, functionCalling: true,
      fineTuning: false, predictedOutputs: false, realtime: false, vision: true,
      audio: false, video: false, extendedThinking: true, batchAPI: true, promptCaching: true,
      parameters: { temperature: false, topP: false, frequencyPenalty: false, presencePenalty: false },
      input: { tokens: 1000000, text: true, image: true, cpm: 5, cpmCached: 0.5 },
      output: { tokens: 128000, text: true, cpm: 25 },
      pricing: {
        text: { input: 5, cachedInput: 0.5, cacheWrite: 6.25, output: 25 },
        processingMultipliers: { batch: 0.5, fast: 2 },
      },
    },
  },

  'claude-mythos-5': {
    name: 'claude-mythos-5',
    provider: Vendor.Anthropic,
    description: 'Limited-release counterpart to Claude Fable 5 without its safety classifiers; always-on adaptive thinking',
    isActive: true,
    lifecycle: 'legacy',
    availability: 'invite_only',
    replacementModel: 'claude-mythos-5-1',
    endpoints: ['messages', 'batch'],
    releaseDate: '2026-06-09',
    knowledgeCutoff: '2026-01-01',
    sources: { documentation: 'https://platform.claude.com/docs/en/models/mythos-5/overview', pricing: 'https://platform.claude.com/docs/en/models/mythos-5/overview', lastVerified: '2026-09-04' },
    features: {
      reasoning: true, reasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
      streaming: true, structuredOutput: true, functionCalling: true,
      fineTuning: false, predictedOutputs: false, realtime: false, vision: true,
      audio: false, video: false, extendedThinking: true, batchAPI: true, promptCaching: true,
      parameters: { temperature: false, topP: false, frequencyPenalty: false, presencePenalty: false },
      input: { tokens: 1000000, text: true, image: true, cpm: 10, cpmCached: 1 },
      output: { tokens: 128000, text: true, cpm: 50 },
      pricing: {
        text: { input: 10, cachedInput: 1, cacheWrite: 12.5, output: 50 },
        processingMultipliers: { batch: 0.5 },
      },
    },
  },

  // Claude 5 / Opus 4.8 Series
  // Adaptive-thinking only (no `budget_tokens`); sampling params (temperature/
  // top_p/top_k) removed → parameters.temperature: false. 1M context, 128K output.
  'claude-opus-4-8': {
    name: 'claude-opus-4-8',
    provider: Vendor.Anthropic,
    description: 'Previous-generation active Opus model for autonomous long-horizon agentic work, knowledge work, and memory. 1M context, 128K output, adaptive thinking (low/medium/high/xhigh/max effort), high-resolution vision. Does not accept `temperature`.',
    isActive: true,
    lifecycle: 'active',
    availability: 'public',
    endpoints: ['messages', 'batch'],
    releaseDate: '2026-05-01',
    knowledgeCutoff: '2026-01-01',
    features: {
      reasoning: true,
      streaming: true,
      structuredOutput: true,
      functionCalling: true,
      fineTuning: false,
      predictedOutputs: false,
      realtime: false,
      vision: true,
      audio: false,
      video: false,
      extendedThinking: true,
      batchAPI: true,
      promptCaching: true,
      parameters: {
        temperature: false,
      },
      input: {
        tokens: 1000000,
        text: true,
        image: true,
        cpm: 5,
        cpmCached: 0.5,
      },
      output: {
        tokens: 128000,
        text: true,
        cpm: 25,
      },
    },
  },

  'claude-sonnet-5': {
    name: 'claude-sonnet-5',
    provider: Vendor.Anthropic,
    description: 'Best combination of speed and intelligence; near-Opus quality on coding and agentic work. 1M context, 128K output, adaptive thinking on by default (low/medium/high/xhigh/max effort), high-resolution vision. New tokenizer. Does not accept `temperature`.',
    isActive: true,
    lifecycle: 'legacy',
    availability: 'public',
    endpoints: ['messages', 'batch'],
    replacementModel: 'claude-sonnet-5-5',
    releaseDate: '2026-06-30',
    knowledgeCutoff: '2026-01-01',
    sources: { documentation: 'https://platform.claude.com/docs/en/models/sonnet-5/overview', pricing: 'https://platform.claude.com/docs/en/models/sonnet-5/overview', lastVerified: '2026-09-04' },
    features: {
      reasoning: true,
      reasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
      streaming: true,
      structuredOutput: true,
      functionCalling: true,
      fineTuning: false,
      predictedOutputs: false,
      realtime: false,
      vision: true,
      audio: false,
      video: false,
      extendedThinking: true,
      batchAPI: true,
      promptCaching: true,
      parameters: {
        temperature: false,
      },
      input: {
        tokens: 1000000,
        text: true,
        image: true,
        cpm: 2,
        cpmCached: 0.2,
      },
      output: {
        tokens: 128000,
        text: true,
        cpm: 10,
      },
      pricing: {
        text: { input: 2, cachedInput: 0.2, cacheWrite: 2.5, output: 10 },
        processingMultipliers: { batch: 0.5 },
      },
    },
  },

  'claude-fable-5': {
    name: 'claude-fable-5',
    provider: Vendor.Anthropic,
    description: 'Legacy Fable model for demanding reasoning and long-horizon agentic work. 1M context, 128K output, thinking always on (raw chain of thought never returned). Does not accept `temperature`. Requires 30-day data retention.',
    isActive: true,
    lifecycle: 'legacy',
    availability: 'public',
    replacementModel: 'claude-fable-5-1',
    endpoints: ['messages', 'batch'],
    releaseDate: '2026-06-09',
    knowledgeCutoff: '2026-01-01',
    sources: { documentation: 'https://platform.claude.com/docs/en/models/fable-5/overview', pricing: 'https://platform.claude.com/docs/en/models/fable-5/overview', lastVerified: '2026-09-04' },
    features: {
      reasoning: true,
      reasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
      streaming: true,
      structuredOutput: true,
      functionCalling: true,
      fineTuning: false,
      predictedOutputs: false,
      realtime: false,
      vision: true,
      audio: false,
      video: false,
      extendedThinking: true,
      batchAPI: true,
      promptCaching: true,
      parameters: {
        temperature: false,
      },
      input: {
        tokens: 1000000,
        text: true,
        image: true,
        cpm: 10,
        cpmCached: 1,
      },
      output: {
        tokens: 128000,
        text: true,
        cpm: 50,
      },
    },
  },

  // Claude 4.7 Series (Legacy flagship — released 2026-04-16)
  'claude-opus-4-7': {
    name: 'claude-opus-4-7',
    provider: Vendor.Anthropic,
    description: 'Legacy Opus 4.7. Superseded by Opus 4.8. Complex reasoning and agentic coding. 1M context, 128K output, adaptive thinking with xhigh effort level, high-resolution vision (2576px). New tokenizer. Does not accept `temperature`.',
    isActive: true,
    releaseDate: '2026-04-16',
    knowledgeCutoff: '2026-01-01',
    features: {
      reasoning: false,
      streaming: true,
      structuredOutput: true,
      functionCalling: true,
      fineTuning: false,
      predictedOutputs: false,
      realtime: false,
      vision: true,
      audio: false,
      video: false,
      extendedThinking: false,
      batchAPI: true,
      promptCaching: true,
      parameters: {
        temperature: false,
      },
      input: {
        tokens: 1000000,
        text: true,
        image: true,
        cpm: 5,
        cpmCached: 0.5,
      },
      output: {
        tokens: 128000,
        text: true,
        cpm: 25,
      },
    },
  },

  // Claude 4.6 Series (Sonnet current, Opus legacy)
  'claude-opus-4-6': {
    name: 'claude-opus-4-6',
    provider: Vendor.Anthropic,
    description: 'Legacy Opus 4.6. Superseded by Opus 4.7. 128K output, adaptive thinking',
    isActive: true,
    releaseDate: '2026-02-01',
    knowledgeCutoff: '2025-05-01',
    features: {
      reasoning: false,
      streaming: true,
      structuredOutput: true,
      functionCalling: true,
      fineTuning: false,
      predictedOutputs: false,
      realtime: false,
      vision: true,
      audio: false,
      video: false,
      extendedThinking: true,
      batchAPI: true,
      promptCaching: true,
      input: {
        tokens: 1000000,
        text: true,
        image: true,
        cpm: 5,
        cpmCached: 0.5,
      },
      output: {
        tokens: 128000,
        text: true,
        cpm: 25,
      },
    },
  },

  'claude-sonnet-4-6': {
    name: 'claude-sonnet-4-6',
    provider: Vendor.Anthropic,
    description: 'Legacy Sonnet 4.6. Superseded by Sonnet 5. Adaptive thinking, 1M context',
    isActive: true,
    releaseDate: '2026-02-01',
    knowledgeCutoff: '2025-08-01',
    features: {
      reasoning: false,
      streaming: true,
      structuredOutput: true,
      functionCalling: true,
      fineTuning: false,
      predictedOutputs: false,
      realtime: false,
      vision: true,
      audio: false,
      video: false,
      extendedThinking: true,
      batchAPI: true,
      promptCaching: true,
      input: {
        tokens: 1000000,
        text: true,
        image: true,
        cpm: 3,
        cpmCached: 0.3,
      },
      output: {
        tokens: 64000,
        text: true,
        cpm: 15,
      },
    },
  },

  // Claude 4.5 Series
  'claude-opus-4-5-20251101': {
    name: 'claude-opus-4-5-20251101',
    provider: Vendor.Anthropic,
    description: 'Legacy Opus 4.5. Premium model combining maximum intelligence with practical performance',
    isActive: true,
    releaseDate: '2025-11-01',
    knowledgeCutoff: '2025-05-01',
    features: {
      reasoning: false,
      streaming: true,
      structuredOutput: true,
      functionCalling: true,
      fineTuning: false,
      predictedOutputs: false,
      realtime: false,
      vision: true,
      audio: false,
      video: false,
      extendedThinking: true,
      batchAPI: true,
      promptCaching: true,
      input: {
        tokens: 200000,
        text: true,
        image: true,
        cpm: 5,
        cpmCached: 0.5,
      },
      output: {
        tokens: 64000,
        text: true,
        cpm: 25,
      },
    },
  },

  'claude-sonnet-4-5-20250929': {
    name: 'claude-sonnet-4-5-20250929',
    provider: Vendor.Anthropic,
    description: 'Legacy Sonnet 4.5. Smart model for complex agents and coding',
    isActive: true,
    releaseDate: '2025-09-29',
    knowledgeCutoff: '2025-01-01',
    features: {
      reasoning: false,
      streaming: true,
      structuredOutput: true,
      functionCalling: true,
      fineTuning: false,
      predictedOutputs: false,
      realtime: false,
      vision: true,
      audio: false,
      video: false,
      extendedThinking: true,
      batchAPI: true,
      promptCaching: true,
      input: {
        tokens: 200000, // 1M with beta header
        text: true,
        image: true,
        cpm: 3,
        cpmCached: 0.3,
      },
      output: {
        tokens: 64000,
        text: true,
        cpm: 15,
      },
    },
  },

  'claude-haiku-4-5-20251001': {
    name: 'claude-haiku-4-5-20251001',
    provider: Vendor.Anthropic,
    description: 'Fastest model with near-frontier intelligence. Matches Sonnet 4 on coding',
    isActive: true,
    releaseDate: '2025-10-01',
    knowledgeCutoff: '2025-02-01',
    features: {
      reasoning: false,
      streaming: true,
      structuredOutput: true,
      functionCalling: true,
      fineTuning: false,
      predictedOutputs: false,
      realtime: false,
      vision: true,
      audio: false,
      video: false,
      extendedThinking: true,
      batchAPI: true,
      promptCaching: true,
      input: {
        tokens: 200000,
        text: true,
        image: true,
        cpm: 1,
        cpmCached: 0.1,
      },
      output: {
        tokens: 64000,
        text: true,
        cpm: 5,
      },
    },
  },

  // Claude 4.x Legacy
  'claude-opus-4-1-20250805': {
    name: 'claude-opus-4-1-20250805',
    provider: Vendor.Anthropic,
    description: 'Legacy Opus 4.1 focused on agentic tasks, real-world coding, and reasoning',
    isActive: false,
    lifecycle: 'retired',
    retirementDate: '2026-08-05',
    replacementModel: 'claude-opus-4-8',
    releaseDate: '2025-08-05',
    knowledgeCutoff: '2025-01-01',
    features: {
      reasoning: false,
      streaming: true,
      structuredOutput: true,
      functionCalling: true,
      fineTuning: false,
      predictedOutputs: false,
      realtime: false,
      vision: true,
      audio: false,
      video: false,
      extendedThinking: true,
      batchAPI: true,
      promptCaching: true,
      input: {
        tokens: 200000,
        text: true,
        image: true,
        cpm: 15,
        cpmCached: 1.5,
      },
      output: {
        tokens: 32000,
        text: true,
        cpm: 75,
      },
    },
  },

  'claude-opus-4-20250514': {
    name: 'claude-opus-4-20250514',
    provider: Vendor.Anthropic,
    description: 'Legacy Opus 4. Agentic tasks and reasoning',
    isActive: false,
    lifecycle: 'retired',
    retirementDate: '2026-06-15',
    replacementModel: 'claude-opus-4-8',
    releaseDate: '2025-05-14',
    knowledgeCutoff: '2025-01-01',
    features: {
      reasoning: false,
      streaming: true,
      structuredOutput: true,
      functionCalling: true,
      fineTuning: false,
      predictedOutputs: false,
      realtime: false,
      vision: true,
      audio: false,
      video: false,
      extendedThinking: true,
      batchAPI: true,
      promptCaching: true,
      input: {
        tokens: 200000,
        text: true,
        image: true,
        cpm: 15,
        cpmCached: 1.5,
      },
      output: {
        tokens: 32000,
        text: true,
        cpm: 75,
      },
    },
  },

  'claude-sonnet-4-20250514': {
    name: 'claude-sonnet-4-20250514',
    provider: Vendor.Anthropic,
    description: 'Legacy Sonnet 4. Supports 1M context beta',
    isActive: false,
    lifecycle: 'retired',
    retirementDate: '2026-06-15',
    replacementModel: 'claude-sonnet-4-6',
    releaseDate: '2025-05-14',
    knowledgeCutoff: '2025-01-01',
    features: {
      reasoning: false,
      streaming: true,
      structuredOutput: true,
      functionCalling: true,
      fineTuning: false,
      predictedOutputs: false,
      realtime: false,
      vision: true,
      audio: false,
      video: false,
      extendedThinking: true,
      batchAPI: true,
      promptCaching: true,
      input: {
        tokens: 200000, // 1M with beta header
        text: true,
        image: true,
        cpm: 3,
        cpmCached: 0.3,
      },
      output: {
        tokens: 64000,
        text: true,
        cpm: 15,
      },
    },
  },

  'claude-3-7-sonnet-20250219': {
    name: 'claude-3-7-sonnet-20250219',
    provider: Vendor.Anthropic,
    description: 'Deprecated. Claude 3.7 Sonnet with extended thinking',
    isActive: false,
    lifecycle: 'retired',
    retirementDate: '2026-02-19',
    replacementModel: 'claude-sonnet-4-6',
    releaseDate: '2025-02-19',
    knowledgeCutoff: '2024-10-01',
    features: {
      reasoning: false,
      streaming: true,
      structuredOutput: true,
      functionCalling: true,
      fineTuning: false,
      predictedOutputs: false,
      realtime: false,
      vision: true,
      audio: false,
      video: false,
      extendedThinking: true,
      batchAPI: true,
      promptCaching: true,
      input: {
        tokens: 200000,
        text: true,
        image: true,
        cpm: 3,
        cpmCached: 0.3,
      },
      output: {
        tokens: 64000,
        text: true,
        cpm: 15,
      },
    },
  },


  // ============================================================================
  // Google Models (Verified from ai.google.dev - October 2026)
  // ============================================================================

  'gemini-3.8-live': {
    name: 'gemini-3.8-live',
    provider: Vendor.Google,
    description: 'Default low-latency Gemini audio-to-audio model with interleaved reasoning and asynchronous function calling',
    isActive: true,
    lifecycle: 'active',
    availability: 'public',
    preferred: true,
    endpoints: ['live'],
    releaseDate: '2026-09-15',
    sources: { documentation: 'https://ai.google.dev/gemini-api/docs/models/gemini-3.8-live', pricing: 'https://ai.google.dev/gemini-api/docs/pricing', lastVerified: '2026-10-07' },
    features: {
      reasoning: true, streaming: true, structuredOutput: false, functionCalling: true,
      fineTuning: false, predictedOutputs: false, realtime: true, vision: true,
      audio: true, video: true, batchAPI: false, promptCaching: false,
      parameters: { temperature: true, topP: true, topK: true, frequencyPenalty: false, presencePenalty: false },
      input: { tokens: 131_072, text: true, image: true, audio: true, video: true, cpm: 0.75 },
      output: { tokens: 65_536, text: true, audio: true, cpm: 4.5 },
      pricing: {
        text: { input: 0.75, output: 4.5 },
        audio: { input: 3, output: 12 },
        image: { input: 1 },
      },
    },
  },

  'gemini-3.8-live-extended-thinking': {
    name: 'gemini-3.8-live-extended-thinking',
    provider: Vendor.Google,
    description: 'High-reasoning Gemini audio-to-audio model with background reasoning and asynchronous tool execution',
    isActive: true,
    lifecycle: 'active',
    availability: 'public',
    preferred: true,
    endpoints: ['live'],
    releaseDate: '2026-09-15',
    sources: { documentation: 'https://ai.google.dev/gemini-api/docs/models/gemini-3.8-live-extended-thinking', pricing: 'https://ai.google.dev/gemini-api/docs/pricing', lastVerified: '2026-10-07' },
    features: {
      reasoning: true, reasoningEfforts: ['low', 'medium', 'high'],
      streaming: true, structuredOutput: false, functionCalling: true,
      fineTuning: false, predictedOutputs: false, realtime: true, vision: true,
      audio: true, video: true, batchAPI: false, promptCaching: false,
      parameters: { temperature: true, topP: true, topK: true, frequencyPenalty: false, presencePenalty: false },
      input: { tokens: 131_072, text: true, image: true, audio: true, video: true, cpm: 0.75 },
      output: { tokens: 65_536, text: true, audio: true, cpm: 4.5 },
      pricing: {
        text: { input: 0.75, output: 4.5 },
        audio: { input: 3, output: 12 },
        image: { input: 1 },
      },
    },
  },

  'gemini-3.8-flash': {
    name: 'gemini-3.8-flash',
    provider: Vendor.Google,
    description: 'Google\'s most intelligent Flash model for long-horizon software engineering, autonomous agents, and complex enterprise workflows',
    isActive: true,
    lifecycle: 'active',
    availability: 'public',
    preferred: true,
    endpoints: ['generate_content', 'interactions', 'batch'],
    releaseDate: '2026-09-02',
    sources: { documentation: 'https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash', pricing: 'https://ai.google.dev/gemini-api/docs/pricing', lastVerified: '2026-09-04' },
    features: {
      reasoning: true, reasoningEfforts: ['low', 'medium', 'high'],
      streaming: true, structuredOutput: true, functionCalling: true,
      fineTuning: false, predictedOutputs: false, realtime: false, vision: true,
      audio: true, video: true, batchAPI: true, promptCaching: true,
      parameters: { temperature: true, topP: true, topK: true, frequencyPenalty: false, presencePenalty: false },
      deprecatedParameters: ['temperature', 'topP', 'topK'],
      input: { tokens: 1_048_576, text: true, image: true, audio: true, video: true, cpm: 0.75, cpmCached: 0.075 },
      output: { tokens: 65_536, text: true, cpm: 3.75 },
      pricing: {
        text: { input: 0.75, cachedInput: 0.075, output: 3.75 },
        processingMultipliers: { batch: 0.5, flex: 0.5, priority: 1.8 },
      },
    },
  },

  'gemini-3.7-flash': {
    name: 'gemini-3.7-flash',
    provider: Vendor.Google,
    description: 'Previous-generation production Gemini Flash model for agentic workflows and multimodal reasoning',
    isActive: true,
    lifecycle: 'active',
    availability: 'public',
    endpoints: ['generate_content', 'interactions', 'batch'],
    releaseDate: '2026-08-13',
    knowledgeCutoff: '2026-01-01',
    sources: { documentation: 'https://ai.google.dev/gemini-api/docs/models/gemini-3.7-flash', pricing: 'https://ai.google.dev/gemini-api/docs/pricing', lastVerified: '2026-09-04' },
    features: {
      reasoning: true, streaming: true, structuredOutput: true, functionCalling: true,
      fineTuning: false, predictedOutputs: false, realtime: false, vision: true,
      audio: true, video: true, batchAPI: true, promptCaching: true,
      parameters: { temperature: true, topP: true, topK: true, frequencyPenalty: false, presencePenalty: false },
      deprecatedParameters: ['temperature', 'topP', 'topK'],
      input: { tokens: 1_048_576, text: true, image: true, audio: true, video: true, cpm: 0.75, cpmCached: 0.075 },
      output: { tokens: 65_536, text: true, cpm: 3.75 },
      pricing: {
        text: { input: 0.75, cachedInput: 0.075, output: 3.75 },
        processingMultipliers: { batch: 0.5, flex: 0.5, priority: 1.8 },
      },
    },
  },

  'gemini-3.6-flash': {
    name: 'gemini-3.6-flash',
    provider: Vendor.Google,
    description: 'Current production Gemini Flash model for agentic, coding, spatial, and multimodal work',
    isActive: true,
    lifecycle: 'active',
    availability: 'public',
    endpoints: ['generate_content', 'interactions', 'batch'],
    releaseDate: '2026-07-21',
    knowledgeCutoff: '2026-01-01',
    sources: { documentation: 'https://ai.google.dev/gemini-api/docs/models/gemini-3.6-flash', pricing: 'https://ai.google.dev/gemini-api/docs/pricing', lastVerified: '2026-08-30' },
    features: {
      reasoning: true, streaming: true, structuredOutput: true, functionCalling: true,
      fineTuning: false, predictedOutputs: false, realtime: false, vision: true,
      audio: true, video: true, batchAPI: true, promptCaching: true,
      parameters: { temperature: true, topP: true, topK: true, frequencyPenalty: false, presencePenalty: false },
      deprecatedParameters: ['temperature', 'topP', 'topK'],
      input: { tokens: 1048576, text: true, image: true, audio: true, video: true, cpm: 1.5, cpmCached: 0.15 },
      output: { tokens: 65536, text: true, cpm: 7.5 },
      pricing: {
        text: { input: 1.5, cachedInput: 0.15, output: 7.5 },
        processingMultipliers: { batch: 0.5, flex: 0.5, priority: 1.8 },
      },
    },
  },

  'gemini-3.5-flash': {
    name: 'gemini-3.5-flash',
    provider: Vendor.Google,
    description: 'High-capability Gemini Flash model for multimodal and agentic production workloads',
    isActive: true,
    lifecycle: 'active',
    availability: 'public',
    aliases: ['gemini-flash-latest'],
    endpoints: ['generate_content', 'interactions', 'batch'],
    releaseDate: '2026-05-01',
    knowledgeCutoff: '2026-01-01',
    sources: { documentation: 'https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash', pricing: 'https://ai.google.dev/gemini-api/docs/pricing', lastVerified: '2026-08-30' },
    features: {
      reasoning: true, streaming: true, structuredOutput: true, functionCalling: true,
      fineTuning: false, predictedOutputs: false, realtime: false, vision: true,
      audio: true, video: true, batchAPI: true, promptCaching: true,
      parameters: { temperature: true, topP: true, topK: true, frequencyPenalty: false, presencePenalty: false },
      deprecatedParameters: ['temperature', 'topP', 'topK'],
      input: { tokens: 1048576, text: true, image: true, audio: true, video: true, cpm: 1.5, cpmCached: 0.15 },
      output: { tokens: 65536, text: true, cpm: 9 },
      pricing: {
        text: { input: 1.5, cachedInput: 0.15, output: 9 },
        processingMultipliers: { batch: 0.5, flex: 0.5, priority: 1.8 },
      },
    },
  },

  'gemini-3.5-flash-lite': {
    name: 'gemini-3.5-flash-lite',
    provider: Vendor.Google,
    description: 'Current low-latency production model for high-throughput subagents and extraction',
    isActive: true,
    lifecycle: 'active',
    availability: 'public',
    preferred: true,
    aliases: ['gemini-flash-lite-latest'],
    endpoints: ['generate_content', 'interactions', 'batch'],
    releaseDate: '2026-07-21',
    knowledgeCutoff: '2026-01-01',
    sources: { documentation: 'https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite', pricing: 'https://ai.google.dev/gemini-api/docs/pricing', lastVerified: '2026-08-30' },
    features: {
      reasoning: true, streaming: true, structuredOutput: true, functionCalling: true,
      fineTuning: false, predictedOutputs: false, realtime: false, vision: true,
      audio: true, video: true, batchAPI: true, promptCaching: true,
      parameters: { temperature: true, topP: true, topK: true, frequencyPenalty: false, presencePenalty: false },
      deprecatedParameters: ['temperature', 'topP', 'topK'],
      input: { tokens: 1048576, text: true, image: true, audio: true, video: true, cpm: 0.3, cpmCached: 0.03 },
      output: { tokens: 65536, text: true, cpm: 2.5 },
      pricing: {
        text: { input: 0.3, cachedInput: 0.03, output: 2.5 },
        processingMultipliers: { batch: 0.5, flex: 0.5, priority: 1.8 },
      },
    },
  },

  'gemini-3.1-flash-lite': {
    name: 'gemini-3.1-flash-lite',
    provider: Vendor.Google,
    description: 'Stable cost-efficient Gemini 3.1 model for high-volume multimodal workloads',
    isActive: true,
    lifecycle: 'deprecated',
    retirementDate: '2027-05-07',
    replacementModel: 'gemini-3.5-flash-lite',
    availability: 'public',
    endpoints: ['generate_content', 'interactions', 'batch'],
    releaseDate: '2026-05-25',
    knowledgeCutoff: '2025-12-01',
    sources: { documentation: 'https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite', pricing: 'https://ai.google.dev/gemini-api/docs/pricing', lastVerified: '2026-08-30' },
    features: {
      reasoning: true, streaming: true, structuredOutput: true, functionCalling: true,
      fineTuning: false, predictedOutputs: false, realtime: false, vision: true,
      audio: true, video: true, batchAPI: true, promptCaching: true,
      parameters: { temperature: true, topP: true, topK: true, frequencyPenalty: false, presencePenalty: false },
      deprecatedParameters: ['temperature', 'topP', 'topK'],
      input: { tokens: 1048576, text: true, image: true, audio: true, video: true, cpm: 0.25, cpmCached: 0.025 },
      output: { tokens: 65536, text: true, cpm: 1.5 },
      pricing: {
        text: { input: 0.25, cachedInput: 0.025, output: 1.5 },
        audio: { input: 0.5, cachedInput: 0.05, output: 1.5 },
        processingMultipliers: { batch: 0.5, flex: 0.5, priority: 1.8 },
      },
    },
  },

  // Gemini 3.1 Series (Preview)
  'gemini-3.1-pro-preview': {
    name: 'gemini-3.1-pro-preview',
    provider: Vendor.Google,
    description: 'Advanced intelligence with powerful agentic and coding capabilities. Replaces gemini-3-pro-preview',
    isActive: true,
    preferred: true,
    releaseDate: '2026-02-01',
    knowledgeCutoff: '2025-01-01',
    features: {
      reasoning: true,
      streaming: true,
      structuredOutput: true,
      functionCalling: true,
      fineTuning: false,
      predictedOutputs: false,
      realtime: false,
      vision: true,
      audio: true,
      video: true,
      batchAPI: true,
      promptCaching: true,
      input: {
        tokens: 1048576,
        text: true,
        image: true,
        audio: true,
        video: true,
        cpm: 2.00,
        cpmCached: 0.20,
      },
      output: {
        tokens: 65536,
        text: true,
        cpm: 12.00,
      },
    },
  },

  'gemini-3.1-flash-lite-preview': {
    name: 'gemini-3.1-flash-lite-preview',
    provider: Vendor.Google,
    description: 'High performance, budget-friendly for high-volume agentic tasks and data extraction',
    isActive: false,
    lifecycle: 'retired',
    retirementDate: '2026-05-25',
    replacementModel: 'gemini-3.5-flash-lite',
    releaseDate: '2026-03-01',
    knowledgeCutoff: '2025-01-01',
    features: {
      reasoning: true,
      streaming: true,
      structuredOutput: true,
      functionCalling: true,
      fineTuning: false,
      predictedOutputs: false,
      realtime: false,
      vision: true,
      audio: true,
      video: true,
      batchAPI: true,
      promptCaching: true,
      input: {
        tokens: 1048576,
        text: true,
        image: true,
        audio: true,
        video: true,
        cpm: 0.25,
      },
      output: {
        tokens: 65536,
        text: true,
        cpm: 1.50,
      },
    },
  },

  'gemini-3.1-flash-image-preview': {
    name: 'gemini-3.1-flash-image-preview',
    provider: Vendor.Google,
    description: 'High-efficiency image generation with up to 4K output, search grounding support',
    isActive: false,
    lifecycle: 'retired',
    retirementDate: '2026-06-25',
    replacementModel: 'gemini-3.1-flash-image',
    releaseDate: '2026-02-01',
    knowledgeCutoff: '2025-01-01',
    features: {
      reasoning: true,
      streaming: true,
      structuredOutput: false,
      functionCalling: false,
      fineTuning: false,
      predictedOutputs: false,
      realtime: false,
      vision: true,
      audio: false,
      video: false,
      batchAPI: true,
      promptCaching: false,
      input: {
        tokens: 131072,
        text: true,
        image: true,
        cpm: 0.25,
      },
      output: {
        tokens: 32768,
        text: true,
        image: true,
        cpm: 1.50,
      },
    },
  },

  'gemini-3.1-flash-live-preview': {
    name: 'gemini-3.1-flash-live-preview',
    provider: Vendor.Google,
    description: 'Low-latency Live API model for real-time audio dialogue with multimodal awareness',
    isActive: true,
    lifecycle: 'legacy',
    availability: 'public',
    replacementModel: 'gemini-3.8-live',
    endpoints: ['live'],
    releaseDate: '2026-03-01',
    knowledgeCutoff: '2025-01-01',
    sources: { documentation: 'https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-live-preview', pricing: 'https://ai.google.dev/gemini-api/docs/pricing', lastVerified: '2026-10-07' },
    features: {
      reasoning: true,
      streaming: true,
      structuredOutput: false,
      functionCalling: true,
      fineTuning: false,
      predictedOutputs: false,
      realtime: true,
      vision: true,
      audio: true,
      video: true,
      batchAPI: false,
      promptCaching: false,
      input: {
        tokens: 131072,
        text: true,
        image: true,
        audio: true,
        video: true,
        cpm: 0.75,
      },
      output: {
        tokens: 65536,
        text: true,
        audio: true,
        cpm: 4.50,
      },
    },
  },

  // Gemini 3 Series (Preview)
  'gemini-3-flash-preview': {
    name: 'gemini-3-flash-preview',
    provider: Vendor.Google,
    description: 'Most powerful agentic and coding model with frontier-class reasoning',
    isActive: true,
    preferred: true,
    releaseDate: '2025-12-01',
    knowledgeCutoff: '2025-01-01',
    features: {
      reasoning: true,
      streaming: true,
      structuredOutput: true,
      functionCalling: true,
      fineTuning: false,
      predictedOutputs: false,
      realtime: false,
      vision: true,
      audio: true,
      video: true,
      batchAPI: true,
      promptCaching: true,
      input: {
        tokens: 1048576,
        text: true,
        image: true,
        audio: true,
        video: true,
        cpm: 0.50,
        cpmCached: 0.05,
      },
      output: {
        tokens: 65536,
        text: true,
        cpm: 3.00,
      },
    },
  },

  'gemini-3-pro-image-preview': {
    name: 'gemini-3-pro-image-preview',
    provider: Vendor.Google,
    description: 'Nano Banana Pro — state-of-the-art native image generation and editing with reasoning',
    isActive: false,
    lifecycle: 'retired',
    retirementDate: '2026-06-25',
    replacementModel: 'gemini-3-pro-image',
    releaseDate: '2025-11-18',
    knowledgeCutoff: '2025-01-01',
    features: {
      reasoning: true,
      streaming: true,
      structuredOutput: true,
      functionCalling: false,
      fineTuning: false,
      predictedOutputs: false,
      realtime: false,
      vision: true,
      audio: false,
      video: false,
      batchAPI: true,
      promptCaching: false,
      input: {
        tokens: 65536,
        text: true,
        image: true,
        cpm: 1.25,
      },
      output: {
        tokens: 32768,
        text: true,
        image: true,
        cpm: 10,
      },
    },
  },

  // Gemini 2.5 Series (Production)
  'gemini-2.5-pro': {
    name: 'gemini-2.5-pro',
    provider: Vendor.Google,
    description: 'Most advanced model for complex tasks with deep reasoning and coding',
    isActive: true,
    releaseDate: '2025-03-01',
    knowledgeCutoff: '2025-01-01',
    features: {
      reasoning: true,
      streaming: true,
      structuredOutput: true,
      functionCalling: true,
      fineTuning: false,
      predictedOutputs: false,
      realtime: false,
      vision: true,
      audio: true,
      video: true,
      batchAPI: true,
      promptCaching: true,
      input: {
        tokens: 1048576,
        text: true,
        image: true,
        audio: true,
        video: true,
        cpm: 1.25,
        cpmCached: 0.125,
      },
      output: {
        tokens: 65536,
        text: true,
        cpm: 10,
      },
    },
  },

  'gemini-2.5-flash': {
    name: 'gemini-2.5-flash',
    provider: Vendor.Google,
    description: 'Best price-performance for low-latency, high-volume tasks with reasoning',
    isActive: true,
    releaseDate: '2025-06-17',
    knowledgeCutoff: '2025-01-01',
    features: {
      reasoning: true,
      streaming: true,
      structuredOutput: true,
      functionCalling: true,
      fineTuning: false,
      predictedOutputs: false,
      realtime: false,
      vision: true,
      audio: true,
      video: true,
      batchAPI: true,
      promptCaching: true,
      input: {
        tokens: 1048576,
        text: true,
        image: true,
        audio: true,
        video: true,
        cpm: 0.30,
        cpmCached: 0.03,
      },
      output: {
        tokens: 65536,
        text: true,
        cpm: 2.50,
      },
    },
  },

  'gemini-2.5-flash-lite': {
    name: 'gemini-2.5-flash-lite',
    provider: Vendor.Google,
    description: 'Fastest and most budget-friendly multimodal model in the 2.5 family',
    isActive: true,
    releaseDate: '2025-06-17',
    knowledgeCutoff: '2025-01-01',
    features: {
      reasoning: true,
      streaming: true,
      structuredOutput: true,
      functionCalling: true,
      fineTuning: false,
      predictedOutputs: false,
      realtime: false,
      vision: true,
      audio: true,
      video: true,
      batchAPI: true,
      promptCaching: true,
      input: {
        tokens: 1048576,
        text: true,
        image: true,
        audio: true,
        video: true,
        cpm: 0.10,
      },
      output: {
        tokens: 65536,
        text: true,
        cpm: 0.40,
      },
    },
  },

  'gemini-2.5-flash-image': {
    name: 'gemini-2.5-flash-image',
    provider: Vendor.Google,
    description: 'Fast native image generation and editing (Nano Banana)',
    isActive: true,
    releaseDate: '2025-10-01',
    knowledgeCutoff: '2025-06-01',
    features: {
      reasoning: false,
      streaming: true,
      structuredOutput: true,
      functionCalling: false,
      fineTuning: false,
      predictedOutputs: false,
      realtime: false,
      vision: true,
      audio: false,
      video: false,
      batchAPI: true,
      promptCaching: true,
      input: {
        tokens: 65536,
        text: true,
        image: true,
        cpm: 0.15,
      },
      output: {
        tokens: 32768,
        text: true,
        image: true,
        cpm: 0.6,
      },
    },
  },

  // ============================================================================
  // xAI Grok Models (Verified from docs.x.ai - October 2026)
  // ============================================================================

  'grok-4.7': {
    name: 'grok-4.7',
    provider: Vendor.Grok,
    description: 'Latest xAI frontier reasoning model with a 500K context window and native agent tools',
    isActive: true,
    lifecycle: 'active',
    availability: 'public',
    preferred: true,
    endpoints: ['responses'],
    releaseDate: '2026-09-21',
    knowledgeCutoff: '2026-05-01',
    sources: { documentation: 'https://docs.x.ai/developers/grok-4-7', pricing: 'https://docs.x.ai/developers/pricing', lastVerified: '2026-10-07' },
    features: {
      reasoning: true, reasoningEfforts: ['low', 'medium', 'high', 'xhigh'],
      streaming: true, structuredOutput: true, functionCalling: true,
      fineTuning: false, predictedOutputs: false, realtime: false, vision: true,
      audio: false, video: false, batchAPI: false, promptCaching: true,
      nativeTools: ['web_search', 'x_search', 'code_execution'],
      parameters: { temperature: true, topP: true, frequencyPenalty: true, presencePenalty: true },
      input: { tokens: 500_000, text: true, image: true, cpm: 2, cpmCached: 0.5 },
      output: { tokens: null, text: true, cpm: 6 },
      pricing: {
        text: {
          input: 2, cachedInput: 0.5, output: 6,
          longContext: { thresholdTokens: 200_000, input: 4, cachedInput: 1, output: 12 },
        },
      },
    },
  },

  'grok-4.6': {
    name: 'grok-4.6',
    provider: Vendor.Grok,
    description: 'Latest xAI frontier model for coding, agentic tasks, and knowledge work',
    isActive: true,
    lifecycle: 'active',
    availability: 'public',
    endpoints: ['responses', 'chat_completions'],
    releaseDate: '2026-08-12',
    knowledgeCutoff: '2026-02-01',
    sources: { documentation: 'https://docs.x.ai/developers/grok-4-6', pricing: 'https://docs.x.ai/developers/pricing', lastVerified: '2026-09-04' },
    features: {
      reasoning: true, reasoningEfforts: ['low', 'medium', 'high', 'xhigh'],
      streaming: true, structuredOutput: true, functionCalling: true,
      fineTuning: false, predictedOutputs: false, realtime: false, vision: true,
      audio: false, video: false, batchAPI: false, promptCaching: true,
      parameters: { temperature: true, topP: true, frequencyPenalty: true, presencePenalty: true },
      input: { tokens: 500_000, text: true, image: true, cpm: 2, cpmCached: 0.5 },
      output: { tokens: null, text: true, cpm: 6 },
      pricing: {
        text: {
          input: 2, cachedInput: 0.5, output: 6,
          longContext: { thresholdTokens: 200_000, input: 4, cachedInput: 1, output: 12 },
        },
      },
    },
  },

  'grok-4.5': {
    name: 'grok-4.5',
    provider: Vendor.Grok,
    description: 'Previous-generation xAI reasoning model for agents, coding, and multimodal tasks',
    isActive: true,
    lifecycle: 'active',
    availability: 'public',
    endpoints: ['responses', 'chat_completions', 'messages', 'completions'],
    releaseDate: '2026-06-01',
    knowledgeCutoff: '2026-02-01',
    sources: { documentation: 'https://docs.x.ai/developers/models/grok-4.5', pricing: 'https://docs.x.ai/developers/pricing', lastVerified: '2026-08-30' },
    features: {
      reasoning: true, streaming: true, structuredOutput: true, functionCalling: true,
      fineTuning: false, predictedOutputs: false, realtime: false, vision: true,
      audio: false, video: false, batchAPI: true, promptCaching: true,
      parameters: { temperature: true, topP: true, frequencyPenalty: true, presencePenalty: true },
      input: { tokens: 500000, text: true, image: true, cpm: 2, cpmCached: 0.3 },
      output: { tokens: 65536, text: true, cpm: 6 },
      pricing: {
        text: {
          input: 2, cachedInput: 0.3, output: 6,
          longContext: { thresholdTokens: 200000, input: 4, cachedInput: 0.6, output: 12 },
        },
      },
    },
  },

  'grok-4.3': {
    name: 'grok-4.3',
    provider: Vendor.Grok,
    description: 'Production xAI model with a 1M-token context window and native agent tools',
    isActive: true,
    lifecycle: 'active',
    availability: 'public',
    endpoints: ['responses', 'chat_completions', 'messages'],
    releaseDate: '2026-05-15',
    knowledgeCutoff: '2026-02-01',
    sources: { documentation: 'https://docs.x.ai/developers/models/grok-4.3', pricing: 'https://docs.x.ai/developers/pricing', lastVerified: '2026-08-30' },
    features: {
      reasoning: true, streaming: true, structuredOutput: true, functionCalling: true,
      fineTuning: false, predictedOutputs: false, realtime: false, vision: true,
      audio: false, video: false, batchAPI: true, promptCaching: true,
      parameters: { temperature: true, topP: true, frequencyPenalty: true, presencePenalty: true },
      input: { tokens: 1000000, text: true, image: true, cpm: 1.25, cpmCached: 0.2 },
      output: { tokens: 65536, text: true, cpm: 2.5 },
      pricing: {
        text: {
          input: 1.25, cachedInput: 0.2, output: 2.5,
          longContext: { thresholdTokens: 200000, input: 2.5, cachedInput: 0.4, output: 5 },
        },
      },
    },
  },

  'grok-build-0.1': {
    name: 'grok-build-0.1',
    provider: Vendor.Grok,
    description: 'Specialized xAI software-building model for repository-scale coding agents',
    isActive: true,
    lifecycle: 'active',
    availability: 'public',
    endpoints: ['responses'],
    releaseDate: '2026-05-01',
    knowledgeCutoff: '2026-02-01',
    sources: { documentation: 'https://docs.x.ai/developers/models/grok-build-0.1', pricing: 'https://docs.x.ai/developers/pricing', lastVerified: '2026-08-30' },
    features: {
      reasoning: true, streaming: true, structuredOutput: true, functionCalling: true,
      fineTuning: false, predictedOutputs: false, realtime: false, vision: true,
      audio: false, video: false, batchAPI: false, promptCaching: true,
      parameters: { temperature: false, topP: false, frequencyPenalty: false, presencePenalty: false },
      input: { tokens: 256000, text: true, image: true, cpm: 1, cpmCached: 0.2 },
      output: { tokens: 65536, text: true, cpm: 2 },
      pricing: {
        text: {
          input: 1, cachedInput: 0.2, output: 2,
          longContext: { thresholdTokens: 200000, input: 2, cachedInput: 0.4, output: 4 },
        },
      },
    },
  },

  'grok-voice-think-fast-2.0': {
    name: 'grok-voice-think-fast-2.0',
    provider: Vendor.Grok,
    description: 'Current xAI speech-to-speech reasoning model for low-latency voice agents',
    isActive: true,
    lifecycle: 'active',
    availability: 'public',
    preferred: true,
    aliases: ['grok-voice-latest'],
    endpoints: ['realtime'],
    releaseDate: '2026-07-29',
    sources: { documentation: 'https://docs.x.ai/developers/models/voice-agent-api', pricing: 'https://docs.x.ai/developers/pricing', lastVerified: '2026-08-30' },
    voices: XAI_VOICES,
    features: {
      reasoning: true, streaming: true, structuredOutput: false, functionCalling: true,
      fineTuning: false, predictedOutputs: false, realtime: true, vision: false,
      audio: true, video: false, batchAPI: false, promptCaching: false,
      parameters: { temperature: false, topP: false, topK: false, frequencyPenalty: false, presencePenalty: false },
      input: { tokens: null, text: true, audio: true, cpm: 0 },
      output: { tokens: null, text: true, audio: true, cpm: 0 },
      pricing: { audioDurationPerMinute: 0.05, textInputPerMessage: 0.004 },
    },
  },

  'grok-voice-think-fast-1.0': {
    name: 'grok-voice-think-fast-1.0',
    provider: Vendor.Grok,
    description: 'Deprecated first-generation xAI reasoning voice model',
    isActive: true,
    lifecycle: 'deprecated',
    availability: 'public',
    endpoints: ['realtime'],
    replacementModel: 'grok-voice-think-fast-2.0',
    voices: XAI_VOICES,
    features: {
      reasoning: true, streaming: true, structuredOutput: false, functionCalling: true,
      fineTuning: false, predictedOutputs: false, realtime: true, vision: false,
      audio: true, video: false, batchAPI: false, promptCaching: false,
      parameters: { temperature: false, topP: false, topK: false, frequencyPenalty: false, presencePenalty: false },
      input: { tokens: null, text: true, audio: true, cpm: 0 },
      output: { tokens: null, text: true, audio: true, cpm: 0 },
      pricing: { audioDurationPerMinute: 0.05, textInputPerMessage: 0.004 },
    },
  },

  'grok-voice-fast-1.0': {
    name: 'grok-voice-fast-1.0',
    provider: Vendor.Grok,
    description: 'Deprecated first-generation xAI voice-agent model',
    isActive: true,
    lifecycle: 'deprecated',
    availability: 'public',
    endpoints: ['realtime'],
    replacementModel: 'grok-voice-think-fast-2.0',
    voices: XAI_VOICES,
    features: {
      reasoning: false, streaming: true, structuredOutput: false, functionCalling: true,
      fineTuning: false, predictedOutputs: false, realtime: true, vision: false,
      audio: true, video: false, batchAPI: false, promptCaching: false,
      parameters: { temperature: false, topP: false, topK: false, frequencyPenalty: false, presencePenalty: false },
      input: { tokens: null, text: true, audio: true, cpm: 0 },
      output: { tokens: null, text: true, audio: true, cpm: 0 },
      pricing: { audioDurationPerMinute: 0.05, textInputPerMessage: 0.004 },
    },
  },

  // Grok 4.20 Series
  'grok-4.20-0309-reasoning': {
    name: 'grok-4.20-0309-reasoning',
    provider: Vendor.Grok,
    description: 'Grok 4.20 reasoning model with a 1M-token context window and vision support',
    isActive: true,
    releaseDate: '2026-03-09',
    knowledgeCutoff: '2024-11-01',
    features: {
      reasoning: true,
      streaming: true,
      structuredOutput: true,
      functionCalling: true,
      fineTuning: false,
      predictedOutputs: false,
      realtime: false,
      vision: true,
      audio: false,
      video: false,
      batchAPI: true,
      promptCaching: true,
      input: {
        tokens: 1000000,
        text: true,
        image: true,
        cpm: 1.25,
        cpmCached: 0.20,
      },
      output: {
        tokens: 65536,
        text: true,
        cpm: 2.50,
      },
      pricing: {
        text: {
          input: 1.25, cachedInput: 0.20, output: 2.50,
          longContext: { thresholdTokens: 200000, input: 2.50, cachedInput: 0.40, output: 5.00 },
        },
      },
    },
  },

  'grok-4.20-0309-non-reasoning': {
    name: 'grok-4.20-0309-non-reasoning',
    provider: Vendor.Grok,
    description: 'Grok 4.20 non-reasoning model with a 1M-token context window and vision support',
    isActive: true,
    releaseDate: '2026-03-09',
    knowledgeCutoff: '2024-11-01',
    features: {
      reasoning: false,
      streaming: true,
      structuredOutput: true,
      functionCalling: true,
      fineTuning: false,
      predictedOutputs: false,
      realtime: false,
      vision: true,
      audio: false,
      video: false,
      batchAPI: true,
      promptCaching: true,
      input: {
        tokens: 1000000,
        text: true,
        image: true,
        cpm: 1.25,
        cpmCached: 0.20,
      },
      output: {
        tokens: 65536,
        text: true,
        cpm: 2.50,
      },
      pricing: {
        text: {
          input: 1.25, cachedInput: 0.20, output: 2.50,
          longContext: { thresholdTokens: 200000, input: 2.50, cachedInput: 0.40, output: 5.00 },
        },
      },
    },
  },

  'grok-4.20-multi-agent-0309': {
    name: 'grok-4.20-multi-agent-0309',
    provider: Vendor.Grok,
    description: 'Grok 4.20 optimized for multi-agent workflows with a 1M-token context window',
    isActive: true,
    releaseDate: '2026-03-09',
    knowledgeCutoff: '2024-11-01',
    features: {
      reasoning: true,
      streaming: true,
      structuredOutput: true,
      functionCalling: true,
      fineTuning: false,
      predictedOutputs: false,
      realtime: false,
      vision: true,
      audio: false,
      video: false,
      batchAPI: true,
      promptCaching: true,
      input: {
        tokens: 1000000,
        text: true,
        image: true,
        cpm: 1.25,
        cpmCached: 0.20,
      },
      output: {
        tokens: 65536,
        text: true,
        cpm: 2.50,
      },
      pricing: {
        text: {
          input: 1.25, cachedInput: 0.20, output: 2.50,
          longContext: { thresholdTokens: 200000, input: 2.50, cachedInput: 0.40, output: 5.00 },
        },
      },
    },
  },

  // Grok 4.1 Series (2M context, fast, cost-efficient)
  'grok-4-1-fast-reasoning': {
    name: 'grok-4-1-fast-reasoning',
    provider: Vendor.Grok,
    description: 'Fast Grok 4.1 with reasoning, 2M context, vision support',
    isActive: false,
    lifecycle: 'retired',
    retirementDate: '2026-05-15',
    replacementModel: 'grok-4.3',
    releaseDate: '2025-11-01',
    knowledgeCutoff: '2024-11-01',
    features: {
      reasoning: true,
      streaming: true,
      structuredOutput: true,
      functionCalling: true,
      fineTuning: false,
      predictedOutputs: false,
      realtime: false,
      vision: true,
      audio: false,
      video: false,
      batchAPI: true,
      promptCaching: true,
      input: {
        tokens: 2000000,
        text: true,
        image: true,
        cpm: 0.20,
      },
      output: {
        tokens: 65536,
        text: true,
        cpm: 0.50,
      },
    },
  },

  'grok-4-1-fast-non-reasoning': {
    name: 'grok-4-1-fast-non-reasoning',
    provider: Vendor.Grok,
    description: 'Fast Grok 4.1 without reasoning, 2M context, vision support',
    isActive: false,
    lifecycle: 'retired',
    retirementDate: '2026-05-15',
    replacementModel: 'grok-4.3',
    releaseDate: '2025-11-01',
    knowledgeCutoff: '2024-11-01',
    features: {
      reasoning: false,
      streaming: true,
      structuredOutput: true,
      functionCalling: true,
      fineTuning: false,
      predictedOutputs: false,
      realtime: false,
      vision: true,
      audio: false,
      video: false,
      batchAPI: true,
      promptCaching: true,
      input: {
        tokens: 2000000,
        text: true,
        image: true,
        cpm: 0.20,
      },
      output: {
        tokens: 65536,
        text: true,
        cpm: 0.50,
      },
    },
  },

  // ============================================================================
  // DeepSeek Models (Verified from api-docs.deepseek.com - August 2026)
  // ============================================================================

  'deepseek-v4-flash': {
    name: 'deepseek-v4-flash',
    provider: Vendor.DeepSeek,
    description: 'DeepSeek V4 Flash reasoning model with first-party Responses and Chat Completions support',
    isActive: true,
    lifecycle: 'active',
    availability: 'public',
    preferred: true,
    endpoints: ['responses', 'chat_completions', 'messages'],
    releaseDate: '2026-04-24',
    sources: {
      documentation: 'https://api-docs.deepseek.com/quick_start/pricing/',
      pricing: 'https://api-docs.deepseek.com/quick_start/pricing/',
      lastVerified: '2026-08-30',
    },
    features: {
      reasoning: true,
      streaming: true,
      structuredOutput: true,
      functionCalling: true,
      fineTuning: false,
      predictedOutputs: false,
      realtime: false,
      vision: false,
      audio: false,
      video: false,
      batchAPI: false,
      promptCaching: true,
      parameters: {
        temperature: true,
        topP: true,
        frequencyPenalty: true,
        presencePenalty: true,
      },
      input: {
        tokens: 1_000_000,
        text: true,
        cpm: 0.44,
        cpmCached: 0.014,
      },
      output: {
        tokens: 384_000,
        text: true,
        cpm: 1.32,
      },
      pricing: {
        text: { input: 0.44, cachedInput: 0.014, output: 1.32 },
        processingMultipliers: { off_peak: 0.5 },
      },
    },
  },

  'deepseek-v4-pro': {
    name: 'deepseek-v4-pro',
    provider: Vendor.DeepSeek,
    description: 'Highest-capability DeepSeek V4 reasoning model with Responses, Chat Completions, and Messages support',
    isActive: true,
    lifecycle: 'active',
    availability: 'public',
    preferred: true,
    endpoints: ['responses', 'chat_completions', 'messages', 'completions'],
    releaseDate: '2026-04-24',
    sources: {
      documentation: 'https://api-docs.deepseek.com/quick_start/pricing/',
      pricing: 'https://api-docs.deepseek.com/quick_start/pricing/',
      lastVerified: '2026-08-30',
    },
    features: {
      reasoning: true,
      streaming: true,
      structuredOutput: true,
      functionCalling: true,
      fineTuning: false,
      predictedOutputs: false,
      realtime: false,
      vision: false,
      audio: false,
      video: false,
      batchAPI: false,
      promptCaching: true,
      parameters: {
        temperature: true,
        topP: true,
        frequencyPenalty: true,
        presencePenalty: true,
      },
      input: {
        tokens: 1_000_000,
        text: true,
        cpm: 1.32,
        cpmCached: 0.044,
      },
      output: {
        tokens: 384_000,
        text: true,
        cpm: 3.96,
      },
      pricing: {
        text: { input: 1.32, cachedInput: 0.044, output: 3.96 },
        processingMultipliers: { off_peak: 0.5 },
      },
    },
  },

  'deepseek-v4-flash-vision-exp': {
    name: 'deepseek-v4-flash-vision-exp',
    provider: Vendor.DeepSeek,
    description: 'Experimental DeepSeek V4 Flash variant with image understanding',
    isActive: true,
    lifecycle: 'preview',
    availability: 'public',
    endpoints: ['responses', 'chat_completions', 'messages'],
    releaseDate: '2026-08-21',
    sources: {
      documentation: 'https://api-docs.deepseek.com/guides/vision/',
      pricing: 'https://api-docs.deepseek.com/quick_start/pricing/',
      lastVerified: '2026-08-30',
    },
    features: {
      reasoning: true,
      streaming: true,
      structuredOutput: true,
      functionCalling: true,
      fineTuning: false,
      predictedOutputs: false,
      realtime: false,
      vision: true,
      audio: false,
      video: false,
      batchAPI: false,
      promptCaching: true,
      parameters: {
        temperature: true,
        topP: true,
        frequencyPenalty: true,
        presencePenalty: true,
      },
      input: {
        tokens: 1_000_000,
        text: true,
        image: true,
        cpm: 0.44,
        cpmCached: 0.014,
      },
      output: {
        tokens: 384_000,
        text: true,
        cpm: 1.32,
      },
      pricing: {
        text: { input: 0.44, cachedInput: 0.014, output: 1.32 },
        processingMultipliers: { off_peak: 0.5 },
      },
    },
  },

  'deepseek-chat': {
    name: 'deepseek-chat',
    provider: Vendor.DeepSeek,
    description: 'Retired DeepSeek compatibility model ID',
    isActive: false,
    lifecycle: 'retired',
    availability: 'public',
    retirementDate: '2026-07-24',
    replacementModel: 'deepseek-v4-flash',
    endpoints: ['chat_completions'],
    sources: {
      documentation: 'https://api-docs.deepseek.com/updates/',
      lastVerified: '2026-08-30',
    },
    features: {
      reasoning: false, streaming: true, structuredOutput: true, functionCalling: true,
      fineTuning: false, predictedOutputs: false, realtime: false, vision: false,
      audio: false, video: false, batchAPI: false, promptCaching: true,
      input: { tokens: 1_000_000, text: true, cpm: 0.14, cpmCached: 0.0028 },
      output: { tokens: 384_000, text: true, cpm: 0.28 },
    },
  },

  'deepseek-reasoner': {
    name: 'deepseek-reasoner',
    provider: Vendor.DeepSeek,
    description: 'Retired DeepSeek reasoning compatibility model ID',
    isActive: false,
    lifecycle: 'retired',
    availability: 'public',
    retirementDate: '2026-07-24',
    replacementModel: 'deepseek-v4-flash',
    endpoints: ['chat_completions'],
    sources: {
      documentation: 'https://api-docs.deepseek.com/updates/',
      lastVerified: '2026-08-30',
    },
    features: {
      reasoning: true, streaming: true, structuredOutput: true, functionCalling: true,
      fineTuning: false, predictedOutputs: false, realtime: false, vision: false,
      audio: false, video: false, batchAPI: false, promptCaching: true,
      input: { tokens: 1_000_000, text: true, cpm: 0.14, cpmCached: 0.0028 },
      output: { tokens: 384_000, text: true, cpm: 0.28 },
    },
  },
};

assertNoRegistryAliasCollisions(MODEL_REGISTRY, 'MODEL_REGISTRY');

/**
 * Get model information by name
 * @param modelName The model identifier
 * @returns Model description or undefined if not found
 */
export function getModelInfo(modelName: string): ILLMDescription | undefined {
  return MODEL_REGISTRY[modelName]
    ?? Object.values(MODEL_REGISTRY).find((model) => model.aliases?.includes(modelName));
}

/** Resolve a direct model ID or floating alias to the registry's canonical ID. */
export function resolveModelName(modelName: string): string | undefined {
  return getModelInfo(modelName)?.name;
}

/**
 * Get all models for a specific vendor
 * @param vendor The vendor to filter by
 * @returns Array of model descriptions for the vendor
 */
export function getModelsByVendor(vendor: VendorType): ILLMDescription[] {
  return Object.values(MODEL_REGISTRY).filter((model) => model.provider === vendor);
}

/**
 * Get all currently active models
 * @returns Array of active model descriptions
 */
export function getActiveModels(): ILLMDescription[] {
  return Object.values(MODEL_REGISTRY).filter((model) => model.isActive);
}

/** Get callable models carrying an explicit vendor deprecation notice. */
export function getDeprecatedModels(): ILLMDescription[] {
  return Object.values(MODEL_REGISTRY).filter(
    (model) => model.isActive && model.lifecycle === 'deprecated'
  );
}

/**
 * Calculate the cost for a given model and token usage
 * @param model Model name
 * @param inputTokens Number of input tokens
 * @param outputTokens Number of output tokens
 * @param options Optional calculation options
 * @returns Total cost in dollars, or null if model not found
 */
export function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  options?: {
    /** @deprecated Prefer cachedInputTokens for mixed cached/uncached requests. */
    useCachedInput?: boolean;
    cachedInputTokens?: number;
    cacheCreationInputTokens?: number;
    cacheCreationDetails?: {
      shortTtlInputTokens?: number;
      extendedTtlInputTokens?: number;
    };
    processingMode?: ProcessingMode;
    /** Override automatic long-context selection for estimates and quotes. */
    contextTier?: 'auto' | 'standard' | 'long';
    /** Price using the selected modality when the registry provides it. */
    modality?: 'text' | 'audio' | 'image';
    /** Duration for models billed per minute instead of per token. */
    audioMinutes?: number;
    /** Number of billable text-input events for event-priced realtime agents. */
    inputMessages?: number;
  }
): number | null {
  const modelInfo = getModelInfo(model);
  if (!modelInfo) {
    return null;
  }

  const audioDurationPrice = modelInfo.features.pricing?.audioDurationPerMinute;
  const messagePrice = modelInfo.features.pricing?.textInputPerMessage;
  if (audioDurationPrice !== undefined || messagePrice !== undefined) {
    if (options?.audioMinutes === undefined && options?.inputMessages === undefined) return null;
    return Math.max(options?.audioMinutes ?? 0, 0) * (audioDurationPrice ?? 0)
      + Math.max(options?.inputMessages ?? 0, 0) * (messagePrice ?? 0);
  }

  const normalizedInputTokens = Math.max(inputTokens, 0);
  const cachedInputTokens = Math.min(
    Math.max(options?.cachedInputTokens ?? (options?.useCachedInput ? inputTokens : 0), 0),
    normalizedInputTokens,
  );
  const describedCacheCreationTokens =
    (options?.cacheCreationDetails?.shortTtlInputTokens ?? 0) +
    (options?.cacheCreationDetails?.extendedTtlInputTokens ?? 0);
  const cacheCreationInputTokens = Math.min(
    Math.max(options?.cacheCreationInputTokens ?? describedCacheCreationTokens, 0),
    normalizedInputTokens - cachedInputTokens,
  );
  const uncachedInputTokens = Math.max(
    0,
    normalizedInputTokens - cachedInputTokens - cacheCreationInputTokens,
  );
  const modalityPricing = modelInfo.features.pricing?.[options?.modality ?? 'text'];
  if (options?.modality === 'image' && outputTokens > 0 && modalityPricing?.output === undefined) {
    return null;
  }
  const useLongContext = Boolean(
    modalityPricing?.longContext &&
      (options?.contextTier === 'long' ||
        (options?.contextTier !== 'standard' &&
          normalizedInputTokens >= modalityPricing.longContext.thresholdTokens))
  );
  const selectedPricing = useLongContext
    ? modalityPricing?.longContext
    : modalityPricing;
  const inputCPM = selectedPricing?.input ?? modelInfo.features.input.cpm;
  const cachedInputCPM = selectedPricing?.cachedInput
    ?? modelInfo.features.input.cpmCached
    ?? inputCPM;
  const outputCPM = selectedPricing?.output ?? modelInfo.features.output.cpm;

  let cacheCreationCost =
    (cacheCreationInputTokens / 1_000_000) *
    (selectedPricing?.cacheWrite ?? inputCPM);
  if (
    modelInfo.provider === Vendor.Anthropic &&
    cacheCreationInputTokens > 0 &&
    selectedPricing?.cacheWrite === undefined
  ) {
    const shortTokens = Math.min(
      Math.max(options?.cacheCreationDetails?.shortTtlInputTokens ?? 0, 0),
      cacheCreationInputTokens,
    );
    const extendedTokens = Math.min(
      Math.max(options?.cacheCreationDetails?.extendedTtlInputTokens ?? 0, 0),
      cacheCreationInputTokens - shortTokens,
    );
    // Anthropic's default cache write is the short (5 minute) tier. Treat any
    // unclassified creation tokens as short writes rather than underpricing.
    const unspecifiedTokens = cacheCreationInputTokens - shortTokens - extendedTokens;
    cacheCreationCost =
      ((shortTokens + unspecifiedTokens) / 1_000_000) *
        inputCPM *
        1.25 +
      (extendedTokens / 1_000_000) * inputCPM * 2;
  }

  const inputCost =
    (uncachedInputTokens / 1_000_000) * inputCPM +
    (cachedInputTokens / 1_000_000) * cachedInputCPM +
    cacheCreationCost;
  const outputCost = (outputTokens / 1_000_000) * outputCPM;
  let processingMultiplier = 1;
  const requestedMode = options?.processingMode;
  const explicitMultiplier = requestedMode
    ? modelInfo.features.pricing?.processingMultipliers?.[requestedMode]
    : undefined;
  if (explicitMultiplier !== undefined) {
    processingMultiplier = explicitMultiplier;
  } else if (requestedMode === 'batch') {
    if (!modelInfo.features.batchAPI) return null;
    // These normalized batch adapters have a documented 50% token-price
    // contract. Do not project that discount onto unrelated vendors merely
    // because their registry entry advertises some form of batch API.
    const discountedBatchProviders = new Set<string>([
      Vendor.OpenAI,
      Vendor.Anthropic,
      Vendor.Google,
    ]);
    if (!discountedBatchProviders.has(modelInfo.provider)) {
      return null;
    }
    processingMultiplier = 0.5;
  } else if (
    requestedMode &&
    requestedMode !== 'interactive' &&
    requestedMode !== 'standard'
  ) {
    // Do not invent Flex/Fast/Priority prices for models without registry data.
    return null;
  }

  return (inputCost + outputCost) * processingMultiplier;
}
