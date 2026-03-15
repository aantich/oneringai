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
  usage: TokenUsage;
  error?: {
    type: string;
    message: string;
  };
  metadata?: Record<string, string>;
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
