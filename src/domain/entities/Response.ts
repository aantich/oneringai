/**
 * LLM Response entity based on OpenAI Responses API format
 */

import { OutputItem } from './Message.js';

// Re-export OutputItem for convenience
export type { OutputItem } from './Message.js';

/**
 * Token usage statistics
 */
export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  output_tokens_details?: {
    reasoning_tokens: number;
  };
  /** Input tokens served from a provider prompt/context cache. */
  cached_input_tokens?: number;
  /** Input tokens written into a provider prompt/context cache. */
  cache_creation_input_tokens?: number;
  cache_creation_details?: {
    short_ttl_input_tokens?: number;
    extended_ttl_input_tokens?: number;
  };
  /** Provider-hosted tool usage that may be billed separately. */
  native_tool_calls?: Record<string, number | undefined>;
  processing_mode?: import('./Model.js').ProcessingMode;
  service_tier?: string;
  /** Provider-reported inference speed, currently Anthropic `standard`/`fast`. */
  speed?: string;
  /** xAI provider-reported total cost in one-billionth USD ticks. */
  cost_usd_ticks?: number;
}

export interface NativeToolEvent {
  capability: string;
  id?: string;
  /** Stable call identifier to use when the host must return a tool result. */
  call_id?: string;
  status?: string;
  /** Whether this item requests execution or reports its result. */
  phase?: 'call' | 'output';
  /** Provider-native call payload. Required for host-executed native tools. */
  details?: unknown;
  error?: { code?: string; message: string; details?: unknown };
}

/**
 * Structured stop detail from a provider. Currently populated for Anthropic
 * refusals (`{ type: 'refusal', category, explanation }`) — `category` names
 * which safety classifier fired (e.g. 'cyber', 'bio'). Surfaced so a refusal is
 * diagnosable rather than an opaque empty/failed response.
 */
export interface ProviderStopDetails {
  /** Discriminator, e.g. 'refusal'. */
  type?: string;
  /** Which classifier/category triggered the stop (e.g. 'cyber', 'bio'), or null. */
  category?: string | null;
  /** Human-readable explanation from the provider, when present. */
  explanation?: string | null;
}

export interface LLMResponse {
  id: string;
  object: 'response';
  created_at: number;
  /**
   * Response status:
   * - `completed` — Generation finished successfully
   * - `failed` — Generation failed with an error
   * - `incomplete` — Generation stopped early (e.g. max tokens reached)
   * - `cancelled` — Generation was cancelled by the caller
   * - `in_progress` — Async/streaming generation still running (used by StreamState, video generation)
   * - `queued` — Queued for processing (used by async video generation via Sora)
   * - `suspended` — Agent loop suspended waiting for external input (via SuspendSignal)
   */
  status: 'completed' | 'failed' | 'in_progress' | 'cancelled' | 'queued' | 'incomplete' | 'suspended';
  model: string;
  output: OutputItem[];
  output_text?: string; // Aggregated text output (SDK convenience)
  thinking?: string;   // Aggregated thinking/reasoning text (convenience, parallel to output_text)
  /**
   * Parsed structured output — populated when the request specified a
   * `responseFormat` (JSON). The library parses/repairs `output_text` into a
   * JSON value and attaches it here. Undefined when no format was requested.
   * See `src/core/StructuredOutput.ts`.
   */
  output_parsed?: unknown;
  usage: TokenUsage;
  error?: {
    type: string;
    message: string;
  };
  metadata?: Record<string, string>;
  /** How a requested structured response was enforced. */
  structured_output_enforcement?: 'native' | 'prompt' | 'repair';
  /** Provider-hosted tool lifecycle/error details, when the provider returns them. */
  native_tool_events?: NativeToolEvent[];
  /** Raw provider stop reason (e.g. 'end_turn', 'max_tokens', 'refusal'), when known. */
  stop_reason?: string;
  /** Opaque provider token used to resume an incomplete long decode. */
  continuation_token?: string;
  /**
   * Structured stop detail accompanying a terminal stop reason. Anthropic
   * populates this for refusals — names which safety classifier fired. Undefined
   * for ordinary completions.
   */
  stop_details?: ProviderStopDetails;
  /** Non-empty when async tools are still executing in the background */
  pendingAsyncTools?: Array<{ toolCallId: string; toolName: string; startTime: number; status: import('./Tool.js').PendingAsyncToolStatus }>;

  /** Present when status is 'suspended' — contains info needed to resume the session */
  suspension?: {
    /** Correlation ID for routing external events back to this session */
    correlationId: string;
    /** Session ID where the agent state is persisted */
    sessionId: string;
    /** Agent ID for reconstructing the agent via Agent.hydrate() */
    agentId: string;
    /** How the external response should be injected on resume */
    resumeAs: 'user_message' | 'tool_result';
    /** ISO timestamp when this suspension expires */
    expiresAt: string;
    /** Application-specific metadata from the SuspendSignal */
    metadata?: Record<string, unknown>;
  };
}

export type AgentResponse = LLMResponse;
