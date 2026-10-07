/**
 * Base Stream Converter - Abstract base class for streaming event conversion
 *
 * DRY principle: Provides common patterns for all stream converters:
 * - State management (response ID, sequence numbers)
 * - Tool call buffering (incremental argument accumulation)
 * - Usage tracking (input/output tokens)
 * - Lifecycle management (clear/reset)
 *
 * Provider-specific stream converters extend this and implement abstract methods.
 */

import { StreamEvent, StreamEventType, ProviderStopDetails } from '../../../domain/entities/StreamEvent.js';
import type { TokenUsage } from '../../../domain/entities/Response.js';

/**
 * Buffer for accumulating tool call arguments during streaming
 */
export interface ToolCallBuffer {
  id: string;
  name: string;
  args: string;
}

/**
 * Usage statistics tracked during streaming
 */
export interface StreamUsage extends Partial<TokenUsage> {
  inputTokens: number;
  outputTokens: number;
}

/**
 * Abstract base class for streaming event converters.
 *
 * Manages common state and provides helper methods for emitting events.
 *
 * @template TEvent - Provider-specific stream event type
 */
export abstract class BaseStreamConverter<TEvent = unknown> {
  // ==========================================================================
  // Protected State (shared across all stream converters)
  // ==========================================================================

  /** Current response ID */
  protected responseId: string = '';

  /** Model name */
  protected model: string = '';

  /** Event sequence number for ordering */
  protected sequenceNumber: number = 0;

  /** Usage statistics */
  protected usage: StreamUsage = { inputTokens: 0, outputTokens: 0 };

  /** Buffers for accumulating tool call arguments */
  protected toolCallBuffers: Map<string, ToolCallBuffer> = new Map();

  /** Buffer for accumulating reasoning/thinking content */
  protected reasoningBuffer: string = '';

  // ==========================================================================
  // Abstract Methods (must be implemented by subclasses)
  // ==========================================================================

  /**
   * Get the provider name (used for ID generation)
   */
  abstract readonly providerName: string;

  /**
   * Convert a single provider event to our StreamEvent(s)
   * May return empty array if event should be ignored
   */
  protected abstract convertEvent(event: TEvent): StreamEvent[];

  // ==========================================================================
  // Public API
  // ==========================================================================

  /**
   * Convert provider stream to our StreamEvent format
   *
   * @param stream - Provider-specific async stream
   * @param model - Model name (may not be available in all events)
   */
  async *convertStream(
    stream: AsyncIterable<TEvent>,
    model?: string
  ): AsyncIterableIterator<StreamEvent> {
    // Initialize/reset state for new stream
    this.reset();
    if (model) {
      this.model = model;
    }

    try {
      for await (const event of stream) {
        const converted = this.convertEvent(event);
        for (const evt of converted) {
          yield evt;
        }
      }
    } finally {
      // Note: Don't clear state here - response may need final events
      // Caller should call clear() when done processing
    }
  }

  /**
   * Clear all internal state
   * Should be called after stream is fully processed
   */
  clear(): void {
    this.responseId = '';
    this.model = '';
    this.sequenceNumber = 0;
    this.usage = { inputTokens: 0, outputTokens: 0 };
    this.toolCallBuffers.clear();
    this.reasoningBuffer = '';
  }

  /**
   * Reset converter state for a new stream
   * Alias for clear()
   */
  reset(): void {
    this.clear();
  }

  // ==========================================================================
  // Protected Helper Methods
  // ==========================================================================

  /**
   * Generate a response ID with provider prefix
   */
  protected generateResponseId(): string {
    const uuid = crypto.randomUUID();
    return `resp_${this.providerName}_${uuid}`;
  }

  /**
   * Get next sequence number (auto-increments)
   */
  protected nextSequence(): number {
    return this.sequenceNumber++;
  }

  /**
   * Create RESPONSE_CREATED event
   */
  protected emitResponseCreated(responseId?: string): StreamEvent {
    if (responseId) {
      this.responseId = responseId;
    } else if (!this.responseId) {
      this.responseId = this.generateResponseId();
    }

    return {
      type: StreamEventType.RESPONSE_CREATED,
      response_id: this.responseId,
      model: this.model,
      created_at: Date.now(),
    };
  }

  /**
   * Create OUTPUT_TEXT_DELTA event
   */
  protected emitTextDelta(
    delta: string,
    options?: { itemId?: string; outputIndex?: number; contentIndex?: number }
  ): StreamEvent {
    return {
      type: StreamEventType.OUTPUT_TEXT_DELTA,
      response_id: this.responseId,
      item_id: options?.itemId || `msg_${this.responseId}`,
      output_index: options?.outputIndex ?? 0,
      content_index: options?.contentIndex ?? 0,
      delta,
      sequence_number: this.nextSequence(),
    };
  }

  /**
   * Create REASONING_DELTA event and accumulate reasoning buffer
   */
  protected emitReasoningDelta(
    delta: string,
    itemId?: string,
    options?: { outputIndex?: number; contentIndex?: number },
  ): StreamEvent {
    this.reasoningBuffer += delta;
    return {
      type: StreamEventType.REASONING_DELTA,
      response_id: this.responseId,
      item_id: itemId || `reasoning_${this.responseId}`,
      ...(options?.outputIndex !== undefined ? { output_index: options.outputIndex } : {}),
      ...(options?.contentIndex !== undefined ? { content_index: options.contentIndex } : {}),
      delta,
      sequence_number: this.nextSequence(),
    };
  }

  /**
   * Create REASONING_DONE event with accumulated reasoning
   */
  protected emitReasoningDone(
    itemId?: string,
    metadata?: Pick<import('../../../domain/entities/StreamEvent.js').ReasoningDoneEvent, 'signature' | 'encrypted_content' | 'effort'>,
    options?: { outputIndex?: number },
  ): StreamEvent {
    const id = itemId || `reasoning_${this.responseId}`;
    const thinking = this.reasoningBuffer;
    this.reasoningBuffer = '';
    return {
      type: StreamEventType.REASONING_DONE,
      response_id: this.responseId,
      item_id: id,
      ...(options?.outputIndex !== undefined ? { output_index: options.outputIndex } : {}),
      sequence_number: this.nextSequence(),
      thinking,
      ...metadata,
    };
  }

  /**
   * Create TOOL_CALL_START event
   */
  protected emitToolCallStart(
    toolCallId: string,
    toolName: string,
    itemId?: string,
    options?: { outputIndex?: number },
  ): StreamEvent {
    // Initialize buffer for this tool call
    this.toolCallBuffers.set(toolCallId, {
      id: toolCallId,
      name: toolName,
      args: '',
    });

    return {
      type: StreamEventType.TOOL_CALL_START,
      response_id: this.responseId,
      item_id: itemId || `msg_${this.responseId}`,
      ...(options?.outputIndex !== undefined ? { output_index: options.outputIndex } : {}),
      sequence_number: this.nextSequence(),
      tool_call_id: toolCallId,
      tool_name: toolName,
    };
  }

  /**
   * Create TOOL_CALL_ARGUMENTS_DELTA event and accumulate args
   */
  protected emitToolCallArgsDelta(
    toolCallId: string,
    delta: string,
    toolName?: string
  ): StreamEvent {
    // Accumulate arguments
    const buffer = this.toolCallBuffers.get(toolCallId);
    if (buffer) {
      buffer.args += delta;
    }

    return {
      type: StreamEventType.TOOL_CALL_ARGUMENTS_DELTA,
      response_id: this.responseId,
      item_id: `msg_${this.responseId}`,
      tool_call_id: toolCallId,
      tool_name: toolName || buffer?.name || '',
      delta,
      sequence_number: this.nextSequence(),
    };
  }

  /**
   * Create TOOL_CALL_ARGUMENTS_DONE event with accumulated args
   */
  protected emitToolCallArgsDone(toolCallId: string, toolName?: string): StreamEvent {
    const buffer = this.toolCallBuffers.get(toolCallId);
    const args = buffer?.args || '{}';
    const name = toolName || buffer?.name || '';

    return {
      type: StreamEventType.TOOL_CALL_ARGUMENTS_DONE,
      response_id: this.responseId,
      tool_call_id: toolCallId,
      tool_name: name,
      arguments: args,
    };
  }

  /**
   * Create RESPONSE_COMPLETE event
   */
  protected emitResponseComplete(
    status: 'completed' | 'failed' | 'incomplete' = 'completed',
    stopReason?: string,
    stopDetails?: ProviderStopDetails
  ): StreamEvent {
    return {
      type: StreamEventType.RESPONSE_COMPLETE,
      response_id: this.responseId,
      status,
      usage: {
        input_tokens: this.usage.inputTokens,
        output_tokens: this.usage.outputTokens,
        total_tokens: this.usage.inputTokens + this.usage.outputTokens,
        ...(this.usage.cached_input_tokens !== undefined && {
          cached_input_tokens: this.usage.cached_input_tokens,
        }),
        ...(this.usage.cache_creation_input_tokens !== undefined && {
          cache_creation_input_tokens: this.usage.cache_creation_input_tokens,
        }),
        ...(this.usage.cache_creation_details && {
          cache_creation_details: this.usage.cache_creation_details,
        }),
        ...(this.usage.native_tool_calls && {
          native_tool_calls: this.usage.native_tool_calls,
        }),
        ...(this.usage.output_tokens_details && {
          output_tokens_details: this.usage.output_tokens_details,
        }),
        ...(this.usage.processing_mode && { processing_mode: this.usage.processing_mode }),
        ...(this.usage.service_tier && { service_tier: this.usage.service_tier }),
      },
      iterations: 1,
      stop_reason: stopReason,
      stop_details: stopDetails,
    };
  }

  /**
   * Update usage statistics
   */
  protected updateUsage(inputTokens?: number, outputTokens?: number): void {
    if (inputTokens !== undefined) {
      this.usage.inputTokens = inputTokens;
    }
    if (outputTokens !== undefined) {
      this.usage.outputTokens = outputTokens;
    }
  }

  protected updateDetailedUsage(usage: Partial<TokenUsage>): void {
    if (usage.cached_input_tokens !== undefined) {
      this.usage.cached_input_tokens = usage.cached_input_tokens;
    }
    if (usage.cache_creation_input_tokens !== undefined) {
      this.usage.cache_creation_input_tokens = usage.cache_creation_input_tokens;
    }
    if (usage.cache_creation_details !== undefined) {
      this.usage.cache_creation_details = usage.cache_creation_details;
    }
    if (usage.native_tool_calls !== undefined) {
      this.usage.native_tool_calls = usage.native_tool_calls;
    }
    if (usage.output_tokens_details !== undefined) {
      this.usage.output_tokens_details = usage.output_tokens_details;
    }
    if (usage.processing_mode !== undefined) {
      this.usage.processing_mode = usage.processing_mode;
    }
    if (usage.service_tier !== undefined) {
      this.usage.service_tier = usage.service_tier;
    }
  }

  /**
   * Get accumulated arguments for a tool call
   */
  protected getAccumulatedArgs(toolCallId: string): string {
    return this.toolCallBuffers.get(toolCallId)?.args || '{}';
  }

  /**
   * Check if we have buffered data for a tool call
   */
  protected hasToolCallBuffer(toolCallId: string): boolean {
    return this.toolCallBuffers.has(toolCallId);
  }
}
