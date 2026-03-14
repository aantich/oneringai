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
   */
  status: 'completed' | 'failed' | 'in_progress' | 'cancelled' | 'queued' | 'incomplete';
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
}

export type AgentResponse = LLMResponse;
