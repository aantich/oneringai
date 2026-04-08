/**
 * Shared Response Builder Utilities
 *
 * DRY principle: Response building logic shared across all providers.
 * Each provider has different raw response formats, but the final
 * LLMResponse structure is the same.
 */

import { randomUUID } from 'crypto';
import { LLMResponse } from '../../../domain/entities/Response.js';
import { OutputItem, MessageRole } from '../../../domain/entities/Message.js';
import { Content, ContentType } from '../../../domain/entities/Content.js';

/**
 * Response status type (matches LLMResponse.status)
 */
export type ResponseStatus = 'completed' | 'failed' | 'in_progress' | 'cancelled' | 'queued' | 'incomplete';

/**
 * Usage statistics for a response
 */
export interface UsageStats {
  inputTokens: number;
  outputTokens: number;
  totalTokens?: number;
}

/**
 * Options for building an LLMResponse
 */
export interface ResponseBuilderOptions {
  /** Provider name for ID prefix (e.g., 'anthropic', 'google') */
  provider: string;
  /** Raw response ID from the provider (optional) */
  rawId?: string;
  /** Model name/version */
  model: string;
  /** Response status */
  status: ResponseStatus;
  /** Content array for the assistant message */
  content: Content[];
  /** Usage statistics */
  usage: UsageStats;
  /** Optional message ID (separate from response ID) */
  messageId?: string;
  /** Timestamp (defaults to now) */
  createdAt?: number;
}

/**
 * Build a standardized LLMResponse object
 *
 * All providers should use this to ensure consistent response format.
 *
 * @param options - Response building options
 * @returns Standardized LLMResponse
 */
export function buildLLMResponse(options: ResponseBuilderOptions): LLMResponse {
  const {
    provider,
    rawId,
    model,
    status,
    content,
    usage,
    messageId,
    createdAt = Math.floor(Date.now() / 1000),
  } = options;

  // Generate IDs
  const responseId = rawId ? `resp_${provider}_${rawId}` : `resp_${provider}_${randomUUID()}`;
  const msgId = messageId || `msg_${provider}_${randomUUID()}`;

  // Build output array with assistant message
  const output: OutputItem[] = [
    {
      type: 'message',
      id: msgId,
      role: MessageRole.ASSISTANT,
      content,
    },
  ];

  // Extract text and thinking from content
  const outputText = extractTextFromContent(content);
  const thinking = extractThinkingFromContent(content);

  return {
    id: responseId,
    object: 'response',
    created_at: createdAt,
    status,
    model,
    output,
    output_text: outputText,
    ...(thinking && { thinking }),
    usage: {
      input_tokens: usage.inputTokens,
      output_tokens: usage.outputTokens,
      total_tokens: usage.totalTokens ?? (usage.inputTokens + usage.outputTokens),
    },
  };
}

/**
 * Extract text content from a Content array
 *
 * @param content - Content array to extract text from
 * @returns Concatenated text content
 */
export function extractTextFromContent(content: Content[]): string {
  return content
    .filter((c): c is Content & { type: typeof ContentType.OUTPUT_TEXT } =>
      c.type === ContentType.OUTPUT_TEXT
    )
    .map((c) => c.text)
    .join('\n');
}

/**
 * Extract thinking/reasoning content from a Content array
 *
 * @param content - Content array to extract thinking from
 * @returns Concatenated thinking text, or undefined if none
 */
export function extractThinkingFromContent(content: Content[]): string | undefined {
  const thinkingTexts = content
    .filter((c) => c.type === ContentType.THINKING)
    .map((c) => (c as any).thinking as string)
    .filter(Boolean);
  return thinkingTexts.length > 0 ? thinkingTexts.join('\n') : undefined;
}

/**
 * Create a text content item
 *
 * @param text - The text content
 * @returns Content object
 */
export function createTextContent(text: string): Content {
  return {
    type: ContentType.OUTPUT_TEXT,
    text,
    annotations: [],
  };
}

/**
 * Create a tool_use content item
 *
 * @param id - Tool call ID
 * @param name - Tool/function name
 * @param args - Arguments as JSON string or object
 * @returns Content object
 */
export function createToolUseContent(
  id: string,
  name: string,
  args: string | Record<string, unknown>,
  thoughtSignature?: string,
): Content {
  return {
    type: ContentType.TOOL_USE,
    id,
    name,
    arguments: typeof args === 'string' ? args : JSON.stringify(args),
    ...(thoughtSignature && { thoughtSignature }),
  };
}

/**
 * Mapping functions for provider-specific status to our ResponseStatus
 */

/**
 * Map OpenAI status to ResponseStatus
 */
export function mapOpenAIStatus(status?: string): ResponseStatus {
  switch (status) {
    case 'completed':
      return 'completed';
    case 'incomplete':
      return 'incomplete';
    case 'cancelled':
    case 'failed':
      return 'failed';
    default:
      return 'completed';
  }
}

/**
 * Map Anthropic stop_reason to ResponseStatus
 */
export function mapAnthropicStatus(stopReason: string | null): ResponseStatus {
  switch (stopReason) {
    case 'end_turn':
    case 'tool_use':
    case 'stop_sequence':
      return 'completed';
    case 'max_tokens':
      return 'incomplete';
    default:
      return 'incomplete';
  }
}

/**
 * Map Google finish_reason to ResponseStatus
 */
export function mapGoogleStatus(finishReason?: string): ResponseStatus {
  switch (finishReason) {
    case 'STOP':
      return 'completed';
    case 'MAX_TOKENS':
      return 'incomplete';
    case 'SAFETY':
    case 'RECITATION':
      return 'failed';
    case 'OTHER':
    default:
      return 'incomplete';
  }
}

/**
 * Generate a tool call ID with optional provider prefix
 *
 * @param provider - Provider name for prefix
 * @returns Generated tool call ID
 */
export function generateToolCallId(provider?: string): string {
  const uuid = randomUUID();
  return provider ? `${provider}_${uuid}` : uuid;
}
