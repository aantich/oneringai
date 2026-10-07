/**
 * Stream helper utilities for consuming and processing streaming events
 */

import {
  StreamEvent,
  StreamEventType,
  isOutputTextDelta,
  isReasoningDelta,
} from '../../domain/entities/StreamEvent.js';
import { StreamState } from '../../domain/entities/StreamState.js';
import { LLMResponse, OutputItem } from '../../domain/entities/Response.js';
import { MessageRole } from '../../domain/entities/Message.js';
import { ContentType } from '../../domain/entities/Content.js';

/**
 * Helper class for consuming and processing streams
 */
export class StreamHelpers {
  /**
   * Collect complete response from stream
   * Accumulates all events and reconstructs final LLMResponse
   */
  static async collectResponse(
    stream: AsyncIterableIterator<StreamEvent>
  ): Promise<LLMResponse> {
    let state: StreamState | null = null;

    for await (const event of stream) {
      // Initialize state on first event
      if (!state && event.type === StreamEventType.RESPONSE_CREATED) {
        state = new StreamState(event.response_id, event.model, event.created_at);
      }

      if (!state) continue;

      // Update state from events
      this.updateStateFromEvent(state, event);
    }

    if (!state) {
      throw new Error('No stream events received');
    }

    return this.reconstructLLMResponse(state);
  }

  /**
   * Get only text deltas from stream (for simple text streaming)
   * Filters out all other event types
   */
  static async *textOnly(
    stream: AsyncIterableIterator<StreamEvent>
  ): AsyncIterableIterator<string> {
    for await (const event of stream) {
      if (isOutputTextDelta(event)) {
        yield event.delta;
      }
    }
  }

  /**
   * Filter stream events by type
   */
  static async *filterByType<T extends StreamEvent>(
    stream: AsyncIterableIterator<StreamEvent>,
    eventType: StreamEventType
  ): AsyncIterableIterator<T> {
    for await (const event of stream) {
      if (event.type === eventType) {
        yield event as T;
      }
    }
  }

  /**
   * Accumulate text from stream into a single string
   */
  static async accumulateText(
    stream: AsyncIterableIterator<StreamEvent>
  ): Promise<string> {
    const chunks: string[] = [];

    for await (const event of stream) {
      if (isOutputTextDelta(event)) {
        chunks.push(event.delta);
      }
    }

    return chunks.join('');
  }

  /**
   * Get only reasoning/thinking deltas from stream
   * Filters out all other event types
   */
  static async *thinkingOnly(
    stream: AsyncIterableIterator<StreamEvent>
  ): AsyncIterableIterator<string> {
    for await (const event of stream) {
      if (isReasoningDelta(event)) {
        yield event.delta;
      }
    }
  }

  /**
   * Get both text and thinking deltas from stream
   * Yields tagged objects so consumers can distinguish them
   */
  static async *textAndThinking(
    stream: AsyncIterableIterator<StreamEvent>
  ): AsyncIterableIterator<{ type: 'text' | 'thinking'; delta: string }> {
    for await (const event of stream) {
      if (isOutputTextDelta(event)) {
        yield { type: 'text', delta: event.delta };
      } else if (isReasoningDelta(event)) {
        yield { type: 'thinking', delta: event.delta };
      }
    }
  }

  /**
   * Accumulate all thinking/reasoning content from stream into a single string
   */
  static async accumulateThinking(
    stream: AsyncIterableIterator<StreamEvent>
  ): Promise<string> {
    const chunks: string[] = [];

    for await (const event of stream) {
      if (isReasoningDelta(event)) {
        chunks.push(event.delta);
      }
    }

    return chunks.join('');
  }

  /**
   * Buffer stream events into batches
   */
  static async *bufferEvents(
    stream: AsyncIterableIterator<StreamEvent>,
    batchSize: number
  ): AsyncIterableIterator<StreamEvent[]> {
    let buffer: StreamEvent[] = [];

    for await (const event of stream) {
      buffer.push(event);

      if (buffer.length >= batchSize) {
        yield buffer;
        buffer = [];
      }
    }

    // Yield remaining events
    if (buffer.length > 0) {
      yield buffer;
    }
  }

  /**
   * Tap into stream without consuming it
   * Useful for logging or side effects
   */
  static async *tap(
    stream: AsyncIterableIterator<StreamEvent>,
    callback: (event: StreamEvent) => void | Promise<void>
  ): AsyncIterableIterator<StreamEvent> {
    for await (const event of stream) {
      await callback(event);
      yield event;
    }
  }

  /**
   * Take first N events from stream
   */
  static async *take(
    stream: AsyncIterableIterator<StreamEvent>,
    count: number
  ): AsyncIterableIterator<StreamEvent> {
    let taken = 0;

    for await (const event of stream) {
      if (taken >= count) break;
      yield event;
      taken++;
    }
  }

  /**
   * Skip first N events from stream
   */
  static async *skip(
    stream: AsyncIterableIterator<StreamEvent>,
    count: number
  ): AsyncIterableIterator<StreamEvent> {
    let skipped = 0;

    for await (const event of stream) {
      if (skipped < count) {
        skipped++;
        continue;
      }
      yield event;
    }
  }

  /**
   * Update StreamState from event
   * @private
   */
  private static updateStateFromEvent(state: StreamState, event: StreamEvent): void {
    switch (event.type) {
      case StreamEventType.OUTPUT_TEXT_DELTA:
        state.accumulateTextDelta(event.item_id, event.delta, {
          outputIndex: event.output_index,
          contentIndex: event.content_index,
          sequenceNumber: event.sequence_number,
        });
        break;

      case StreamEventType.REASONING_DELTA:
        state.accumulateReasoningDelta(event.item_id, event.delta, {
          outputIndex: event.output_index,
          contentIndex: event.content_index,
          sequenceNumber: event.sequence_number,
        });
        break;

      case StreamEventType.REASONING_DONE:
        state.completeReasoning(event.item_id, {
          signature: event.signature,
          encryptedContent: event.encrypted_content,
          effort: event.effort,
        }, {
          outputIndex: event.output_index,
          sequenceNumber: event.sequence_number,
        });
        break;

      case StreamEventType.COMPACTION:
        state.accumulateCompaction({
          type: 'compaction',
          id: event.item_id,
          encrypted_content: event.encrypted_content,
          content: event.content,
          signature: event.signature,
          ...(event.provider_metadata ? { providerMetadata: event.provider_metadata } : {}),
        }, {
          outputIndex: event.output_index,
          sequenceNumber: event.sequence_number,
        });
        break;

      case StreamEventType.PROVIDER_STATE:
        state.accumulateProviderState(event.item_id, {
          type: ContentType.PROVIDER_STATE,
          provider: event.provider,
          data: event.data,
        }, {
          outputIndex: event.output_index,
          sequenceNumber: event.sequence_number,
        });
        break;

      case StreamEventType.TOOL_CALL_START:
        state.startToolCall(event.tool_call_id, event.tool_name, event.item_id, {
          outputIndex: event.output_index,
          sequenceNumber: event.sequence_number,
        }, {
          toolType: event.tool_type,
          async: event.async,
        });
        break;

      case StreamEventType.TOOL_CALL_ARGUMENTS_DELTA:
        state.accumulateToolArguments(event.tool_call_id, event.delta);
        break;

      case StreamEventType.TOOL_CALL_ARGUMENTS_DONE:
        state.completeToolCall(event.tool_call_id);
        break;

      case StreamEventType.TOOL_EXECUTION_DONE:
        state.setToolResult(event.tool_call_id, event.result);
        break;

      case StreamEventType.ITERATION_COMPLETE:
        state.incrementIteration();
        break;

      case StreamEventType.RESPONSE_COMPLETE:
        // Debug: Log usage when received
        if (process.env.DEBUG_STREAMING) {
          console.error('[DEBUG] RESPONSE_COMPLETE event:', event.usage);
        }
        state.updateUsage(event.usage);
        state.providerStatus = event.status;
        state.stopReason = event.stop_reason;
        state.stopDetails = event.stop_details;
        state.continuationToken = event.continuation_token;
        state.markComplete(event.status);
        break;
    }
  }

  /**
   * Reconstruct LLMResponse from StreamState
   * @private
   */
  private static reconstructLLMResponse(state: StreamState): LLMResponse {
    const output: OutputItem[] = [];
    let contentParts: any[] = [];
    const thinkingTexts: string[] = [];
    const flushContent = (): void => {
      if (contentParts.length === 0) return;
      output.push({
        type: 'message',
        role: MessageRole.ASSISTANT,
        content: contentParts,
      });
      contentParts = [];
    };

    for (const entry of state.getOrderedOutputEntries()) {
      if (entry.kind === 'compaction') {
        flushContent();
        output.push(entry.item);
      } else if (entry.kind === 'reasoning') {
        if (entry.thinking) thinkingTexts.push(entry.thinking);
        if (entry.encryptedContent) {
          flushContent();
          output.push({
            type: 'reasoning',
            id: entry.itemId,
            ...(entry.effort ? { effort: entry.effort } : {}),
            ...(entry.thinking ? { summary: entry.thinking } : {}),
            encrypted_content: entry.encryptedContent,
          });
        } else if (entry.thinking || entry.signature) {
          contentParts.push({
            type: ContentType.THINKING,
            thinking: entry.thinking,
            providerItemId: entry.itemId,
            ...(entry.signature ? { signature: entry.signature } : {}),
            persistInHistory: Boolean(entry.signature),
          });
        }
      } else if (entry.kind === 'text') {
        if (entry.text) contentParts.push({ type: ContentType.OUTPUT_TEXT, text: entry.text });
      } else if (entry.kind === 'provider_state') {
        contentParts.push(entry.state);
      } else if (entry.toolType === 'custom') {
        contentParts.push({
          type: ContentType.CUSTOM_TOOL_USE,
          id: entry.toolCallId,
          name: entry.toolName,
          input: entry.arguments,
          ...(entry.async !== undefined ? { async: entry.async } : {}),
        });
      } else {
        contentParts.push({
          type: ContentType.TOOL_USE,
          id: entry.toolCallId,
          name: entry.toolName,
          arguments: entry.arguments,
          ...(entry.async !== undefined ? { async: entry.async } : {}),
        });
      }
    }
    flushContent();

    const outputText = state.getAllText();
    const thinkingText = thinkingTexts.length > 0 ? thinkingTexts.join('\n') : undefined;

    return {
      id: state.responseId,
      object: 'response',
      created_at: state.createdAt,
      status: state.status,
      model: state.model,
      output,
      output_text: outputText,
      thinking: thinkingText,
      usage: state.usage,
      ...(state.stopReason ? { stop_reason: state.stopReason } : {}),
      ...(state.stopDetails ? { stop_details: state.stopDetails } : {}),
      ...(state.continuationToken ? { continuation_token: state.continuationToken } : {}),
    };
  }

}
