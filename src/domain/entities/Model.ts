import { Vendor } from '../../core/Vendor.js';
import type { Vendor as VendorType } from '../../core/Vendor.js';
import type { IVoiceInfo } from './SharedVoices.js';
import { OPENAI_REALTIME_VOICES } from './SharedVoices.js';

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

  /** Whether this model is a preferred/recommended choice for its vendor */
  preferred?: boolean;

  /** Release date (YYYY-MM-DD format) */
  releaseDate?: string;

  /** Knowledge cutoff date */
  knowledgeCutoff?: string;

  /** Built-in voices for realtime/audio models (undefined = no built-in voices) */
  voices?: IVoiceInfo[];

  /** Model capabilities and pricing */
  features: {
    /** Supports extended reasoning/thinking */
    reasoning?: boolean;

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

    /** Parameter support - indicates which sampling parameters are supported */
    parameters?: {
      /** Supports temperature parameter */
      temperature?: boolean;
      /** Supports top_p parameter */
      topP?: boolean;
      /** Supports frequency_penalty parameter */
      frequencyPenalty?: boolean;
      /** Supports presence_penalty parameter */
      presencePenalty?: boolean;
    };

    /** Input specifications */
    input: {
      /** Maximum input context window (in tokens) */
      tokens: number;

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
      tokens: number;

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

/**
 * Model name constants organized by vendor
 * Updated: March 2026 - Contains only verified, currently available models
 */
export const LLM_MODELS = {
  [Vendor.OpenAI]: {
    // GPT-5.5 Series (Current Flagship)
    GPT_5_5: 'gpt-5.5',
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
    // Claude 4.7 Series (Current flagship Opus — April 2026)
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
    // Grok 4.20 Series (Flagship, 2M context)
    GROK_4_20_0309_REASONING: 'grok-4.20-0309-reasoning',
    GROK_4_20_0309_NON_REASONING: 'grok-4.20-0309-non-reasoning',
    GROK_4_20_MULTI_AGENT_0309: 'grok-4.20-multi-agent-0309',
    // Grok 4.1 Series (2M context, fast)
    GROK_4_1_FAST_REASONING: 'grok-4-1-fast-reasoning',
    GROK_4_1_FAST_NON_REASONING: 'grok-4-1-fast-non-reasoning',
  },
} as const;

/**
 * Complete model registry with all model metadata
 * Updated: March 2026 - Verified from official vendor documentation
 */
export const MODEL_REGISTRY: Record<string, ILLMDescription> = {
  // ============================================================================
  // OpenAI Models (Verified from developers.openai.com - March 2026)
  // ============================================================================

  // GPT-5.5 Series (Current Flagship - April 2026)
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
    description: 'Latest GPT-5.3 chat model for general-purpose use',
    isActive: true,
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

  'gpt-5.2-chat-latest': {
    name: 'gpt-5.2-chat-latest',
    provider: Vendor.OpenAI,
    description: 'GPT-5.2 chat model for general-purpose use',
    isActive: true,
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

  'gpt-5.1-codex-max': {
    name: 'gpt-5.1-codex-max',
    provider: Vendor.OpenAI,
    description: 'GPT-5.1 codex max for maximum reasoning depth on coding tasks',
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

  'gpt-5.1-codex-mini': {
    name: 'gpt-5.1-codex-mini',
    provider: Vendor.OpenAI,
    description: 'GPT-5.1 codex mini for cost-efficient coding tasks',
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
    isActive: true,
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

  'gpt-5-chat-latest': {
    name: 'gpt-5-chat-latest',
    provider: Vendor.OpenAI,
    description: 'GPT-5 chat model for general-purpose use',
    isActive: true,
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
      realtime: true,
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
      realtime: true,
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

  // Realtime Models (New generation - replaces gpt-4o-realtime-*)
  'gpt-realtime-1.5': {
    name: 'gpt-realtime-1.5',
    provider: Vendor.OpenAI,
    description: 'Latest realtime model for voice/audio streaming. Text+audio+image input, text+audio output',
    isActive: true,
    preferred: true,
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
  // Anthropic Models (Verified from platform.claude.com - April 2026)
  // Source: https://platform.claude.com/docs/en/about-claude/models/overview
  // ============================================================================

  // Claude 4.7 Series (Current flagship — released 2026-04-16)
  'claude-opus-4-7': {
    name: 'claude-opus-4-7',
    provider: Vendor.Anthropic,
    description: 'Most capable model for complex reasoning and agentic coding. 1M context, 128K output, adaptive thinking with new xhigh effort level, high-resolution vision (2576px). New tokenizer. Does not accept `temperature`.',
    isActive: true,
    preferred: true,
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
    description: 'Best combination of speed and intelligence. Adaptive thinking, 1M context',
    isActive: true,
    preferred: true,
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
    isActive: true,
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
    isActive: true,
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
    isActive: true,
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
    isActive: true,
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
  // Google Models (Verified from ai.google.dev - March 2026)
  // ============================================================================

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
    isActive: true,
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
    isActive: true,
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
    releaseDate: '2026-03-01',
    knowledgeCutoff: '2025-01-01',
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
    isActive: true,
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
  // xAI Grok Models (Verified from docs.x.ai - April 2026)
  // ============================================================================

  // Grok 4.20 Series (Flagship, 2M context)
  'grok-4.20-0309-reasoning': {
    name: 'grok-4.20-0309-reasoning',
    provider: Vendor.Grok,
    description: 'Flagship Grok 4.20 with reasoning, 2M context, vision support',
    isActive: true,
    preferred: true,
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
        tokens: 2000000,
        text: true,
        image: true,
        cpm: 2.00,
      },
      output: {
        tokens: 65536,
        text: true,
        cpm: 6.00,
      },
    },
  },

  'grok-4.20-0309-non-reasoning': {
    name: 'grok-4.20-0309-non-reasoning',
    provider: Vendor.Grok,
    description: 'Flagship Grok 4.20 without reasoning, 2M context, vision support',
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
        tokens: 2000000,
        text: true,
        image: true,
        cpm: 2.00,
      },
      output: {
        tokens: 65536,
        text: true,
        cpm: 6.00,
      },
    },
  },

  'grok-4.20-multi-agent-0309': {
    name: 'grok-4.20-multi-agent-0309',
    provider: Vendor.Grok,
    description: 'Grok 4.20 optimized for multi-agent workflows, 2M context, vision + reasoning',
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
        tokens: 2000000,
        text: true,
        image: true,
        cpm: 2.00,
      },
      output: {
        tokens: 65536,
        text: true,
        cpm: 6.00,
      },
    },
  },

  // Grok 4.1 Series (2M context, fast, cost-efficient)
  'grok-4-1-fast-reasoning': {
    name: 'grok-4-1-fast-reasoning',
    provider: Vendor.Grok,
    description: 'Fast Grok 4.1 with reasoning, 2M context, vision support',
    isActive: true,
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
    isActive: true,
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
};

/**
 * Get model information by name
 * @param modelName The model identifier
 * @returns Model description or undefined if not found
 */
export function getModelInfo(modelName: string): ILLMDescription | undefined {
  return MODEL_REGISTRY[modelName];
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
  options?: { useCachedInput?: boolean }
): number | null {
  const modelInfo = getModelInfo(model);
  if (!modelInfo) {
    return null;
  }

  const inputCPM = options?.useCachedInput && modelInfo.features.input.cpmCached !== undefined
    ? modelInfo.features.input.cpmCached
    : modelInfo.features.input.cpm;

  const outputCPM = modelInfo.features.output.cpm;

  const inputCost = (inputTokens / 1_000_000) * inputCPM;
  const outputCost = (outputTokens / 1_000_000) * outputCPM;

  return inputCost + outputCost;
}
