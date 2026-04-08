/**
 * Google Gemini stream converter - converts Google streaming responses to our unified StreamEvent format
 */

import { randomUUID } from 'crypto';
import { GenerateContentResponse } from '@google/genai';
import { StreamEvent, StreamEventType, ReasoningDeltaEvent, ReasoningDoneEvent } from '../../../domain/entities/StreamEvent.js';
import { mapGoogleStatus } from '../shared/ResponseBuilder.js';

/**
 * Converts Google Gemini streaming responses to our unified StreamEvent format
 */
export class GoogleStreamConverter {
  private responseId: string = '';
  private model: string = '';
  private sequenceNumber: number = 0;
  private isFirst: boolean = true;
  private toolCallBuffers: Map<string, { name: string; args: string; signature?: string }> = new Map();
  private hadToolCalls: boolean = false;
  private toolCallCounter: number = 0;
  private reasoningBuffer: string = '';
  private wasThinking: boolean = false;
  private lastFinishReason: string | undefined = undefined;

  // External storage for thought signatures (shared with GoogleConverter)
  private thoughtSignatureStorage: Map<string, string> | null = null;
  // External storage for tool call ID → name mapping (shared with GoogleConverter)
  private toolCallMappingStorage: Map<string, string> | null = null;

  /**
   * Set external storage for thought signatures
   * This allows sharing signatures with GoogleConverter for multi-turn conversations
   */
  setThoughtSignatureStorage(storage: Map<string, string>): void {
    this.thoughtSignatureStorage = storage;
  }

  /**
   * Set external storage for tool call mappings
   * This allows sharing tool name lookups with GoogleConverter
   */
  setToolCallMappingStorage(storage: Map<string, string>): void {
    this.toolCallMappingStorage = storage;
  }

  /**
   * Convert Google stream to our StreamEvent format
   */
  async *convertStream(
    googleStream: AsyncIterable<GenerateContentResponse>,
    model: string
  ): AsyncIterableIterator<StreamEvent> {
    this.model = model;
    this.sequenceNumber = 0;
    this.isFirst = true;
    this.toolCallBuffers.clear();
    this.hadToolCalls = false;
    this.reasoningBuffer = '';
    this.wasThinking = false;
    this.lastFinishReason = undefined;

    let lastUsage: { input_tokens: number; output_tokens: number; total_tokens: number } = {
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
    };

    for await (const chunk of googleStream) {
      if (this.isFirst) {
        this.responseId = this.generateResponseId();
        yield {
          type: StreamEventType.RESPONSE_CREATED,
          response_id: this.responseId,
          model: this.model,
          created_at: Date.now(),
        };
        this.isFirst = false;
      }

      // Extract usage from chunk (Google includes it in every chunk)
      const usage = this.extractUsage(chunk);
      if (usage) {
        lastUsage = usage;
      }

      const events = this.convertChunk(chunk);
      for (const event of events) {
        yield event;
      }
    }

    // Emit reasoning done if we were still in thinking mode
    if (this.wasThinking && this.reasoningBuffer) {
      yield {
        type: StreamEventType.REASONING_DONE,
        response_id: this.responseId,
        item_id: `thinking_${this.responseId}`,
        thinking: this.reasoningBuffer,
      } as ReasoningDoneEvent;
      this.reasoningBuffer = '';
      this.wasThinking = false;
    }

    // Emit completion for any pending tool calls
    if (this.toolCallBuffers.size > 0) {
      for (const [toolCallId, buffer] of this.toolCallBuffers) {
        yield {
          type: StreamEventType.TOOL_CALL_ARGUMENTS_DONE,
          response_id: this.responseId,
          tool_call_id: toolCallId,
          tool_name: buffer.name,
          arguments: buffer.args,
        };
      }
    }

    // Final completion event with actual usage and proper status from finishReason
    const rawStatus = mapGoogleStatus(this.lastFinishReason);
    const finalStatus: 'completed' | 'failed' | 'incomplete' =
      rawStatus === 'completed' ? 'completed' : rawStatus === 'failed' ? 'failed' : 'incomplete';
    yield {
      type: StreamEventType.RESPONSE_COMPLETE,
      response_id: this.responseId,
      status: finalStatus,
      usage: lastUsage,
      iterations: 1,
      stop_reason: this.lastFinishReason,
    };
  }

  /**
   * Extract usage from Google chunk
   */
  private extractUsage(chunk: GenerateContentResponse): { input_tokens: number; output_tokens: number; total_tokens: number } | null {
    const usage = chunk.usageMetadata;
    if (!usage) return null;

    return {
      input_tokens: usage.promptTokenCount || 0,
      output_tokens: usage.candidatesTokenCount || 0,
      total_tokens: usage.totalTokenCount || 0,
    };
  }

  /**
   * Convert single Google chunk to our event(s)
   */
  private convertChunk(chunk: GenerateContentResponse): StreamEvent[] {
    const events: StreamEvent[] = [];

    const candidate = chunk.candidates?.[0];
    if (candidate?.finishReason) {
      this.lastFinishReason = candidate.finishReason as string;
    }
    if (!candidate?.content?.parts) return events;

    for (const part of candidate.content.parts) {
      const isThought = 'thought' in part && (part as any).thought === true;

      if (isThought && part.text) {
        // Thought/thinking delta from Gemini
        // If we were not thinking before, this is a new thinking block
        this.wasThinking = true;
        this.reasoningBuffer += part.text;

        events.push({
          type: StreamEventType.REASONING_DELTA,
          response_id: this.responseId,
          item_id: `thinking_${this.responseId}`,
          delta: part.text,
          sequence_number: this.sequenceNumber++,
        } as ReasoningDeltaEvent);
      } else if (part.text) {
        // If we were thinking and now we're not, emit reasoning done
        if (this.wasThinking) {
          this.wasThinking = false;
          events.push({
            type: StreamEventType.REASONING_DONE,
            response_id: this.responseId,
            item_id: `thinking_${this.responseId}`,
            thinking: this.reasoningBuffer,
          } as ReasoningDoneEvent);
          this.reasoningBuffer = '';
        }

        // Text delta
        events.push({
          type: StreamEventType.OUTPUT_TEXT_DELTA,
          response_id: this.responseId,
          item_id: `msg_${this.responseId}`,
          output_index: 0,
          content_index: 0,
          delta: part.text,
          sequence_number: this.sequenceNumber++,
        });
      } else if (part.functionCall) {
        // Function call (tool use)
        const functionCall = part.functionCall;
        const toolName = functionCall.name || 'unknown';
        const toolCallId = `call_${this.responseId}_${this.toolCallCounter++}_${toolName}`;

        // Extract thought signature if present (required for Gemini 3+)
        const thoughtSignature = 'thoughtSignature' in part ? (part.thoughtSignature as string) : undefined;

        // Check if this is a new tool call
        if (!this.toolCallBuffers.has(toolCallId)) {
          this.hadToolCalls = true;
          this.toolCallBuffers.set(toolCallId, {
            name: toolName,
            args: '',
            signature: thoughtSignature,
          });

          // Store tool call ID → name mapping for tool result conversion
          if (this.toolCallMappingStorage) {
            this.toolCallMappingStorage.set(toolCallId, toolName);
          }

          // Store signature in external storage for use in next request
          if (thoughtSignature && this.thoughtSignatureStorage) {
            this.thoughtSignatureStorage.set(toolCallId, thoughtSignature);
            if (process.env.DEBUG_GOOGLE) {
              console.error(`[DEBUG] Stream: Captured thought signature for tool ID: ${toolCallId}`);
            }
          } else if (process.env.DEBUG_GOOGLE && !thoughtSignature) {
            console.error(`[DEBUG] Stream: NO thought signature in part for ${toolName}`);
          }

          events.push({
            type: StreamEventType.TOOL_CALL_START,
            response_id: this.responseId,
            item_id: `msg_${this.responseId}`,
            tool_call_id: toolCallId,
            tool_name: toolName,
            thought_signature: thoughtSignature,
          });
        } else if (thoughtSignature) {
          // Update signature if we get it in a later chunk
          const buffer = this.toolCallBuffers.get(toolCallId)!;
          if (!buffer.signature) {
            buffer.signature = thoughtSignature;
            if (this.thoughtSignatureStorage) {
              this.thoughtSignatureStorage.set(toolCallId, thoughtSignature);
              if (process.env.DEBUG_GOOGLE) {
                console.error(`[DEBUG] Stream: Updated thought signature for tool ID: ${toolCallId}`);
              }
            }
          }
        }

        // Convert args object to JSON string
        if (functionCall.args) {
          const argsJson = JSON.stringify(functionCall.args);
          const buffer = this.toolCallBuffers.get(toolCallId)!;

          // Check if this is new content (Google sends complete args each time)
          if (argsJson !== buffer.args) {
            const delta = argsJson.slice(buffer.args.length);
            buffer.args = argsJson;

            if (delta) {
              events.push({
                type: StreamEventType.TOOL_CALL_ARGUMENTS_DELTA,
                response_id: this.responseId,
                item_id: `msg_${this.responseId}`,
                tool_call_id: toolCallId,
                tool_name: toolName,
                delta,
                sequence_number: this.sequenceNumber++,
              });
            }
          }
        }
      }
    }

    return events;
  }

  /**
   * Generate unique response ID using cryptographically secure UUID
   */
  private generateResponseId(): string {
    return `resp_google_${randomUUID()}`;
  }

  /**
   * Check if the stream had tool calls
   * Used to determine when to clear thought signatures (must persist across tool execution)
   */
  hasToolCalls(): boolean {
    return this.hadToolCalls;
  }

  /**
   * Clear all internal state
   * Should be called after each stream completes to prevent memory leaks
   */
  clear(): void {
    this.responseId = '';
    this.model = '';
    this.sequenceNumber = 0;
    this.isFirst = true;
    this.toolCallBuffers.clear();
    this.hadToolCalls = false;
    this.toolCallCounter = 0;
    this.reasoningBuffer = '';
    this.wasThinking = false;
    this.lastFinishReason = undefined;
  }

  /**
   * Reset converter state for a new stream
   * Alias for clear()
   */
  reset(): void {
    this.clear();
  }
}
