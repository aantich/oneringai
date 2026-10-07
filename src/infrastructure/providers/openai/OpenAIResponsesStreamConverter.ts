/**
 * OpenAI Responses API Streaming Converter
 *
 * Converts streaming events from OpenAI's Responses API to our internal StreamEvent format.
 *
 * Responses API streaming events:
 * - response.created
 * - response.output_item.added
 * - response.output_item.content.added
 * - response.output_item.content.delta (text/arguments)
 * - response.output_item.done
 * - response.reasoning_text.delta / response.reasoning_text.done
 * - response.reasoning_summary_text.delta / response.reasoning_summary_text.done
 * - response.done
 */

import * as ResponsesAPI from 'openai/resources/responses/responses.js';
import { openAINativeToolCapabilityForOutputType } from './OpenAIResponsesConverter.js';
import { StreamEvent, StreamEventType, ReasoningDeltaEvent, ReasoningDoneEvent } from '../../../domain/entities/StreamEvent.js';

type ResponseStreamEvent = ResponsesAPI.ResponseStreamEvent;

export class OpenAIResponsesStreamConverter {
  // Internal state for the current stream conversion
  private activeItems = new Map<string, { type: string; toolCallId?: string; toolName?: string }>();
  private toolCallBuffers = new Map<string, {
    id: string;
    name: string;
    args: string;
    type: 'function' | 'custom';
    async?: boolean;
  }>();
  private reasoningBuffers = new Map<string, string[]>();
  private reasoningDoneEmitted = new Set<string>();

  /**
   * Check if there are any pending tool calls in the current stream
   */
  hasToolCalls(): boolean {
    return this.toolCallBuffers.size > 0;
  }

  /**
   * Reset internal state (call between stream conversions)
   */
  reset(): void {
    this.activeItems.clear();
    this.toolCallBuffers.clear();
    this.reasoningBuffers.clear();
    this.reasoningDoneEmitted.clear();
  }

  /**
   * Clear all internal buffers and release references
   */
  clear(): void {
    this.reset();
  }

  /**
   * Convert Responses API stream to our StreamEvent format
   */
  async *convertStream(
    stream: AsyncIterable<ResponseStreamEvent>
  ): AsyncIterableIterator<StreamEvent> {
    let responseId = '';
    let sequenceNumber = 0;

    // Reset state for new stream
    this.reset();

    try {
    for await (const event of stream) {
      // Debug logging
      if (process.env.DEBUG_OPENAI) {
        console.error('[DEBUG] Responses API event:', event.type);
      }

      switch (event.type) {
        case 'response.created': {
          responseId = event.response.id;
          yield {
            type: StreamEventType.RESPONSE_CREATED,
            response_id: responseId,
            model: event.response.model,
            created_at: event.response.created_at,
          };
          break;
        }

        case 'response.output_item.added': {
          const addedEvent = event as ResponsesAPI.ResponseOutputItemAddedEvent;
          const item = addedEvent.item;
          this.activeItems.set(addedEvent.output_index.toString(), {
            type: item.type,
          });

          // If it's a reasoning item, track it
          if (item.type === 'reasoning') {
            this.activeItems.set(addedEvent.output_index.toString(), {
              type: 'reasoning',
            });
            this.reasoningBuffers.set(addedEvent.output_index.toString(), []);
          }

          // If it's a function call, track it
          if (item.type === 'function_call') {
            const functionCall = item as ResponsesAPI.ResponseFunctionToolCall;
            const toolCallId = functionCall.call_id;
            const toolName = functionCall.name;

            this.activeItems.set(addedEvent.output_index.toString(), {
              type: 'function_call',
              toolCallId,
              toolName,
            });

            this.toolCallBuffers.set(toolCallId, {
              id: toolCallId,
              name: toolName,
              args: '',
              type: 'function',
              ...(functionCall.async !== undefined ? { async: functionCall.async } : {}),
            });

            yield {
              type: StreamEventType.TOOL_CALL_START,
              response_id: responseId,
              item_id: `item_${addedEvent.output_index}`,
              output_index: addedEvent.output_index,
              sequence_number: sequenceNumber++,
              tool_call_id: toolCallId,
              tool_name: toolName,
              tool_type: 'function',
              ...(functionCall.async !== undefined ? { async: functionCall.async } : {}),
            };
          }

          if (item.type === 'custom_tool_call') {
            const customCall = item as ResponsesAPI.ResponseCustomToolCall;
            this.activeItems.set(addedEvent.output_index.toString(), {
              type: 'custom_tool_call',
              toolCallId: customCall.call_id,
              toolName: customCall.name,
            });
            this.toolCallBuffers.set(customCall.call_id, {
              id: customCall.call_id,
              name: customCall.name,
              args: '',
              type: 'custom',
              ...(customCall.async !== undefined ? { async: customCall.async } : {}),
            });
            yield {
              type: StreamEventType.TOOL_CALL_START,
              response_id: responseId,
              item_id: customCall.id ?? `item_${addedEvent.output_index}`,
              output_index: addedEvent.output_index,
              sequence_number: sequenceNumber++,
              tool_call_id: customCall.call_id,
              tool_name: customCall.name,
              tool_type: 'custom',
              ...(customCall.async !== undefined ? { async: customCall.async } : {}),
            };
          }
          break;
        }

        case 'response.output_text.delta': {
          const textEvent = event as ResponsesAPI.ResponseTextDeltaEvent;
          yield {
            type: StreamEventType.OUTPUT_TEXT_DELTA,
            response_id: responseId,
            item_id: textEvent.item_id,
            output_index: textEvent.output_index,
            content_index: textEvent.content_index,
            delta: textEvent.delta || '',
            sequence_number: sequenceNumber++,
          };
          break;
        }

        case 'response.function_call_arguments.delta': {
          const argsEvent = event as ResponsesAPI.ResponseFunctionCallArgumentsDeltaEvent;
          const itemInfo = this.activeItems.get(argsEvent.output_index.toString());

          if (itemInfo?.toolCallId) {
            const buffer = this.toolCallBuffers.get(itemInfo.toolCallId);
            if (buffer) {
              buffer.args += argsEvent.delta || '';

              yield {
                type: StreamEventType.TOOL_CALL_ARGUMENTS_DELTA,
                response_id: responseId,
                item_id: argsEvent.item_id,
                tool_call_id: buffer.id,
                tool_name: buffer.name,
                delta: argsEvent.delta || '',
                sequence_number: sequenceNumber++,
              };
            }
          }
          break;
        }

        case 'response.custom_tool_call_input.delta': {
          const inputEvent = event as ResponsesAPI.ResponseCustomToolCallInputDeltaEvent;
          const itemInfo = this.activeItems.get(inputEvent.output_index.toString());
          if (itemInfo?.toolCallId) {
            const buffer = this.toolCallBuffers.get(itemInfo.toolCallId);
            if (buffer) {
              buffer.args += inputEvent.delta || '';
              yield {
                type: StreamEventType.TOOL_CALL_ARGUMENTS_DELTA,
                response_id: responseId,
                item_id: inputEvent.item_id,
                tool_call_id: buffer.id,
                tool_name: buffer.name,
                delta: inputEvent.delta || '',
                sequence_number: sequenceNumber++,
              };
            }
          }
          break;
        }

        case 'response.custom_tool_call_input.done': {
          const inputEvent = event as ResponsesAPI.ResponseCustomToolCallInputDoneEvent;
          const itemInfo = this.activeItems.get(inputEvent.output_index.toString());
          const buffer = itemInfo?.toolCallId
            ? this.toolCallBuffers.get(itemInfo.toolCallId)
            : undefined;
          if (buffer) {
            buffer.args = inputEvent.input;
          }
          break;
        }

        case 'response.reasoning_summary_text.delta':
        case 'response.reasoning_text.delta': {
          // Reasoning delta from OpenAI (both full reasoning text and summary)
          const reasoningEvent = event as {
            type: string;
            output_index?: number;
            item_id?: string;
            delta?: string;
          };
          const outputIdx = reasoningEvent.output_index?.toString();
          const buffer = outputIdx ? this.reasoningBuffers.get(outputIdx) : undefined;
          if (buffer) {
            buffer.push(reasoningEvent.delta || '');
          }

          yield {
            type: StreamEventType.REASONING_DELTA,
            response_id: responseId,
            item_id: reasoningEvent.item_id || `reasoning_${responseId}`,
            ...(reasoningEvent.output_index !== undefined
              ? { output_index: reasoningEvent.output_index }
              : {}),
            delta: reasoningEvent.delta || '',
            sequence_number: sequenceNumber++,
          } as ReasoningDeltaEvent;
          break;
        }

        case 'response.reasoning_text.done': {
          // The text part is complete, but the corresponding output item may
          // still add replay metadata such as encrypted_content. Keep the
          // finalized text and emit one terminal reasoning event when the item
          // itself is done.
          const doneEvent = event as ResponsesAPI.ResponseReasoningTextDoneEvent;
          const outputIdx = doneEvent.output_index.toString();
          const rBuf = this.reasoningBuffers.get(outputIdx);
          if (!rBuf || rBuf.length === 0) {
            this.reasoningBuffers.set(outputIdx, [doneEvent.text || '']);
          }
          break;
        }

        case 'response.output_item.done': {
          const doneEvent = event as ResponsesAPI.ResponseOutputItemDoneEvent;
          const item = doneEvent.item;

          // The completed output item is authoritative for replay metadata.
          // Emit exactly one terminal reasoning event for this output index.
          if (item.type === 'reasoning') {
            const outputIdx = doneEvent.output_index.toString();
            const encryptedContent = typeof (item as any).encrypted_content === 'string'
              ? (item as any).encrypted_content
              : undefined;
            if (!this.reasoningDoneEmitted.has(outputIdx)) {
              const rBuf = this.reasoningBuffers.get(outputIdx);
              const thinkingText = rBuf ? rBuf.join('') : '';
              this.reasoningDoneEmitted.add(outputIdx);

              yield {
                type: StreamEventType.REASONING_DONE,
                response_id: responseId,
                item_id: (item as any).id || `reasoning_${responseId}`,
                output_index: doneEvent.output_index,
                sequence_number: sequenceNumber++,
                thinking: thinkingText,
                ...(encryptedContent ? { encrypted_content: encryptedContent } : {}),
                ...(typeof (item as any).effort === 'string' ? { effort: (item as any).effort } : {}),
              } as ReasoningDoneEvent;
            }
          }

          if (item.type === 'compaction') {
            const compaction = item as ResponsesAPI.ResponseCompactionItem;
            yield {
              type: StreamEventType.COMPACTION,
              response_id: responseId,
              item_id: compaction.id,
              output_index: doneEvent.output_index,
              encrypted_content: compaction.encrypted_content,
              sequence_number: sequenceNumber++,
            };
          }

          // If function call is done, emit arguments complete
          if (item.type === 'function_call') {
            const functionCall = item as ResponsesAPI.ResponseFunctionToolCall;
            const buffer = this.toolCallBuffers.get(functionCall.call_id);

            if (buffer) {
              yield {
                type: StreamEventType.TOOL_CALL_ARGUMENTS_DONE,
                response_id: responseId,
                tool_call_id: buffer.id,
                tool_name: buffer.name,
                arguments: buffer.args || functionCall.arguments,
                tool_type: buffer.type,
                ...(buffer.async !== undefined ? { async: buffer.async } : {}),
              };
            }
          }

          if (item.type === 'custom_tool_call') {
            const customCall = item as ResponsesAPI.ResponseCustomToolCall;
            const buffer = this.toolCallBuffers.get(customCall.call_id);
            if (buffer) {
              yield {
                type: StreamEventType.TOOL_CALL_ARGUMENTS_DONE,
                response_id: responseId,
                tool_call_id: buffer.id,
                tool_name: buffer.name,
                arguments: buffer.args || customCall.input,
                tool_type: buffer.type,
                ...(buffer.async !== undefined ? { async: buffer.async } : {}),
              };
            }
          }
          break;
        }

        case 'response.completed': {
          const completedEvent = event as ResponsesAPI.ResponseCompletedEvent;
          const response = completedEvent.response;
          const nativeToolCalls: Record<string, number> = {};
          for (const item of response.output ?? []) {
            const capability = openAINativeToolCapabilityForOutputType(item.type);
            if (capability) nativeToolCalls[capability] = (nativeToolCalls[capability] ?? 0) + 1;
          }

          // Map ResponseStatus to our status type
          let status: 'completed' | 'failed' | 'incomplete' = 'completed';
          if (response.status === 'failed') {
            status = 'failed';
          } else if (response.status === 'incomplete') {
            status = 'incomplete';
          }

          yield {
            type: StreamEventType.RESPONSE_COMPLETE,
            response_id: responseId,
            status,
            usage: {
              input_tokens: response.usage?.input_tokens || 0,
              output_tokens: response.usage?.output_tokens || 0,
              total_tokens: response.usage?.total_tokens || 0,
              ...((response.usage as any)?.input_tokens_details?.cached_tokens != null && {
                cached_input_tokens: (response.usage as any).input_tokens_details.cached_tokens,
              }),
              ...((response.usage as any)?.output_tokens_details?.reasoning_tokens != null && {
                output_tokens_details: {
                  reasoning_tokens: (response.usage as any).output_tokens_details.reasoning_tokens,
                },
              }),
              ...(Object.keys(nativeToolCalls).length > 0 && {
                native_tool_calls: nativeToolCalls,
              }),
              ...(response.service_tier ? { service_tier: response.service_tier } : {}),
              ...(Number.isFinite(Number((response.usage as any)?.cost_in_usd_ticks)) && {
                cost_usd_ticks: Number((response.usage as any).cost_in_usd_ticks),
              }),
            },
            iterations: 1,
          };
          break;
        }

        case 'response.incomplete': {
          const response = (event as ResponsesAPI.ResponseIncompleteEvent).response;
          yield {
            type: StreamEventType.RESPONSE_COMPLETE,
            response_id: response.id || responseId,
            status: 'incomplete',
            usage: {
              input_tokens: response.usage?.input_tokens || 0,
              output_tokens: response.usage?.output_tokens || 0,
              total_tokens: response.usage?.total_tokens || 0,
              ...(response.service_tier ? { service_tier: response.service_tier } : {}),
              ...(Number.isFinite(Number((response.usage as any)?.cost_in_usd_ticks)) && {
                cost_usd_ticks: Number((response.usage as any).cost_in_usd_ticks),
              }),
            },
            iterations: 1,
            ...(response.incomplete_details?.reason
              ? { stop_reason: response.incomplete_details.reason }
              : {}),
          };
          break;
        }

        case 'response.failed': {
          const response = (event as ResponsesAPI.ResponseFailedEvent).response;
          throw this.toProviderError(
            response.error?.message ?? 'OpenAI response failed',
            response.error?.code,
            response.id,
            response.error,
          );
        }

        case 'error': {
          const errorEvent = event as ResponsesAPI.ResponseErrorEvent;
          throw this.toProviderError(
            errorEvent.message,
            errorEvent.code ?? undefined,
            responseId,
            errorEvent,
          );
        }

        // Handle other event types if needed
        default:
          if (process.env.DEBUG_OPENAI) {
            console.error('[DEBUG] Unhandled Responses API event type:', (event as any).type);
          }
      }
    }
    } finally {
      // Always clean up internal buffers when stream ends (normal or error)
      this.clear();
    }
  }

  private toProviderError(
    message: string,
    code?: string,
    responseId?: string,
    body?: unknown,
  ): Error {
    const error = new Error(message) as Error & {
      code?: string;
      status?: number;
      response_id?: string;
      error?: unknown;
    };
    error.name = 'OpenAIResponsesStreamError';
    if (code) error.code = code;
    if (code === 'misalignment_policy_violation') error.status = 403;
    if (responseId) error.response_id = responseId;
    error.error = body;
    return error;
  }
}
