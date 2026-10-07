import { randomUUID } from 'crypto';
import type { Interactions } from '@google/genai';
import type { TextGenerateOptions, ReasoningEffort } from '../../../domain/interfaces/ITextProvider.js';
import type { InputItem } from '../../../domain/entities/Message.js';
import { MessageRole } from '../../../domain/entities/Message.js';
import type { Content } from '../../../domain/entities/Content.js';
import { ContentType } from '../../../domain/entities/Content.js';
import type { LLMResponse, TokenUsage } from '../../../domain/entities/Response.js';
import type { StreamEvent } from '../../../domain/entities/StreamEvent.js';
import { StreamEventType } from '../../../domain/entities/StreamEvent.js';
import { buildLLMResponse } from '../shared/ResponseBuilder.js';
import { fetchImageAsBase64 } from '../../../utils/imageUtils.js';
import { InvalidToolArgumentsError } from '../../../domain/errors/AIErrors.js';

type InteractionStep = Record<string, any>;
type Interaction = Record<string, any>;
type NormalizedInteractionStatus = 'completed' | 'failed' | 'incomplete';

function normalizeInteractionStatus(status: unknown): NormalizedInteractionStatus {
  switch (status) {
    case 'completed':
    case 'requires_action':
      return 'completed';
    case 'failed':
    case 'cancelled':
      return 'failed';
    case 'incomplete':
    case 'budget_exceeded':
    case 'in_progress':
    case 'queued':
    default:
      return 'incomplete';
  }
}

/** Current (May 2026+) Gemini Interactions `steps` schema adapter. */
export class GoogleInteractionsConverter {
  async convertRequest(options: TextGenerateOptions): Promise<Record<string, unknown>> {
    const input = await this.convertInput(options.input);
    const vendor = options.vendorOptions ?? {};
    const request: Record<string, unknown> = {
      ...((vendor.interactions as Record<string, unknown> | undefined) ?? {}),
      model: options.model,
      input,
      store: vendor.store ?? true,
    };

    if (options.instructions) request.system_instruction = options.instructions;
    if (options.previous_response_id) {
      request.previous_interaction_id = options.previous_response_id.replace(/^resp_google_/, '');
    }
    if (options.continuation_token) request.continuation_token = options.continuation_token;
    if (options.metadata) request.labels = options.metadata;

    const serviceTier = vendor.serviceTier ?? vendor.service_tier;
    if (serviceTier) request.service_tier = serviceTier;

    const generationConfig: Record<string, unknown> = {
      ...((vendor.generationConfig as Record<string, unknown> | undefined) ?? {}),
    };
    if (options.max_output_tokens !== undefined) {
      generationConfig.max_output_tokens = options.max_output_tokens;
    }
    if (options.temperature !== undefined) generationConfig.temperature = options.temperature;
    if (options.tool_choice) {
      generationConfig.tool_choice = typeof options.tool_choice === 'object'
        ? {
            allowed_tools: {
              mode: 'any',
              tools: [options.tool_choice.function.name],
            },
          }
        : options.tool_choice === 'required' ? 'any' : options.tool_choice;
    }
    const thinkingLevel = this.resolveThinkingLevel(options);
    if (thinkingLevel) generationConfig.thinking_level = thinkingLevel;
    if (vendor.thinkingSummaries !== undefined) {
      generationConfig.thinking_summaries = vendor.thinkingSummaries;
    }
    if (Object.keys(generationConfig).length > 0) request.generation_config = generationConfig;

    const tools = this.convertTools(options);
    if (tools.length > 0) request.tools = tools;

    if (options.response_format?.type === 'json_schema') {
      const container = options.response_format.json_schema;
      const schema = container && typeof container === 'object' && 'schema' in container
        ? container.schema
        : container;
      request.response_format = { type: 'text', mime_type: 'application/json', schema };
    } else if (options.response_format?.type === 'json_object') {
      request.response_format = { type: 'text', mime_type: 'application/json' };
    }

    return request;
  }

  convertResponse(interaction: Interaction, model: string): LLMResponse {
    const content: Content[] = [];
    let pendingSignature: string | undefined;
    const nativeCalls: Record<string, number> = {};

    for (const step of interaction.steps ?? []) {
      switch (step.type) {
        case 'model_output':
          for (const block of step.content ?? []) {
            if (block.type === 'text' && block.text) {
              content.push({ type: ContentType.OUTPUT_TEXT, text: block.text, annotations: block.annotations ?? [] });
            }
          }
          break;
        case 'thought': {
          pendingSignature = step.signature;
          const thinking = (step.summary ?? [])
            .filter((block: any) => block.type === 'text')
            .map((block: any) => block.text)
            .join('\n');
          if (thinking) {
            content.push({
              type: ContentType.THINKING,
              thinking,
              signature: step.signature,
              persistInHistory: true,
            });
          }
          break;
        }
        case 'function_call':
          content.push({
            type: ContentType.TOOL_USE,
            id: step.id,
            name: step.name,
            arguments: JSON.stringify(step.arguments ?? {}),
            thoughtSignature: pendingSignature,
          });
          pendingSignature = undefined;
          break;
        case 'google_search_call':
          nativeCalls.web_search = (nativeCalls.web_search ?? 0) + 1;
          break;
        case 'url_context_call':
          nativeCalls.web_fetch = (nativeCalls.web_fetch ?? 0) + 1;
          break;
        case 'code_execution_call':
          nativeCalls.code_execution = (nativeCalls.code_execution ?? 0) + 1;
          break;
        case 'file_search_call':
          nativeCalls.file_search = (nativeCalls.file_search ?? 0) + 1;
          break;
      }
    }

    if (content.length === 0 && interaction.output_text) {
      content.push({ type: ContentType.OUTPUT_TEXT, text: interaction.output_text, annotations: [] });
    }
    const usage = this.convertUsage(interaction.usage, interaction.service_tier, nativeCalls);
    const status = normalizeInteractionStatus(interaction.status);
    const response = buildLLMResponse({
      provider: 'google',
      rawId: interaction.id,
      model: interaction.model ?? model,
      status,
      content,
      usage: {
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
        totalTokens: usage.total_tokens,
        cachedInputTokens: usage.cached_input_tokens,
        reasoningTokens: usage.output_tokens_details?.reasoning_tokens,
        nativeToolCalls: usage.native_tool_calls as Record<string, number> | undefined,
        processingMode: usage.processing_mode,
        serviceTier: usage.service_tier,
      },
    });
    response.stop_reason = interaction.status;
    if (typeof interaction.continuation_token === 'string') {
      response.continuation_token = interaction.continuation_token;
    }
    return response;
  }

  async *convertStream(
    stream: AsyncIterable<Interactions.InteractionSSEEvent>,
    model: string,
  ): AsyncIterableIterator<StreamEvent> {
    let responseId = `resp_google_${randomUUID()}`;
    let sequence = 0;
    let created = false;
    const textByStep = new Map<number, string>();
    const thinkingByStep = new Map<number, string>();
    const signatureByStep = new Map<number, string>();
    let usage: TokenUsage = { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
    // A stream that ends without a terminal provider event is not successful.
    let finalStatus: NormalizedInteractionStatus = 'incomplete';
    let finalStopReason: string | undefined;
    let continuationToken: string | undefined;
    let failureObserved = false;
    const toolBuffers = new Map<number, { id: string; name: string; arguments: string }>();

    for await (const event of stream) {
      if (event.event_type === 'step.delta' && event.metadata?.total_usage) {
        usage = this.convertUsage(event.metadata.total_usage);
      }

      if (event.event_type === 'interaction.created') {
        responseId = `resp_google_${event.interaction.id}`;
        if (typeof event.interaction.continuation_token === 'string') {
          continuationToken = event.interaction.continuation_token;
        }
        created = true;
        yield {
          type: StreamEventType.RESPONSE_CREATED,
          response_id: responseId,
          model: event.interaction.model ?? model,
          created_at: event.interaction.created
            ? Math.floor(Date.parse(event.interaction.created) / 1000)
            : Math.floor(Date.now() / 1000),
        };
        continue;
      }
      if (!created) {
        created = true;
        yield {
          type: StreamEventType.RESPONSE_CREATED,
          response_id: responseId,
          model,
          created_at: Math.floor(Date.now() / 1000),
        };
      }

      if (event.event_type === 'step.start' && event.step?.type === 'function_call') {
        const initialArguments = event.step.arguments;
        const serializedArguments = initialArguments === undefined || initialArguments === null
          || (typeof initialArguments === 'object' && Object.keys(initialArguments).length === 0)
          ? ''
          : JSON.stringify(initialArguments) ?? '';
        const buffer = {
          id: event.step.id,
          name: event.step.name,
          arguments: serializedArguments,
        };
        toolBuffers.set(event.index, buffer);
        yield {
          type: StreamEventType.TOOL_CALL_START,
          response_id: responseId,
          item_id: `tool_${responseId}_${event.index}`,
          output_index: event.index,
          sequence_number: sequence++,
          tool_call_id: buffer.id,
          tool_name: buffer.name,
        };
        if (buffer.arguments) {
          yield {
            type: StreamEventType.TOOL_CALL_ARGUMENTS_DELTA,
            response_id: responseId,
            item_id: `msg_${responseId}`,
            tool_call_id: buffer.id,
            tool_name: buffer.name,
            delta: buffer.arguments,
            sequence_number: sequence++,
          };
        }
      } else if (event.event_type === 'step.delta' && event.delta?.type === 'text') {
        const delta = event.delta.text ?? '';
        textByStep.set(event.index, `${textByStep.get(event.index) ?? ''}${delta}`);
        yield {
          type: StreamEventType.OUTPUT_TEXT_DELTA,
          response_id: responseId,
          item_id: `msg_${responseId}_${event.index}`,
          output_index: event.index,
          content_index: 0,
          delta,
          sequence_number: sequence++,
        };
      } else if (event.event_type === 'step.delta' && event.delta?.type === 'thought_summary') {
        const delta = event.delta.content?.type === 'text' ? event.delta.content.text : '';
        thinkingByStep.set(event.index, `${thinkingByStep.get(event.index) ?? ''}${delta}`);
        if (delta) {
          yield {
            type: StreamEventType.REASONING_DELTA,
            response_id: responseId,
            item_id: `thinking_${responseId}_${event.index}`,
            output_index: event.index,
            delta,
            sequence_number: sequence++,
          };
        }
      } else if (event.event_type === 'step.delta' && event.delta?.type === 'thought_signature') {
        const delta = event.delta.signature ?? '';
        if (delta) {
          signatureByStep.set(event.index, `${signatureByStep.get(event.index) ?? ''}${delta}`);
        }
      } else if (event.event_type === 'step.delta' && event.delta?.type === 'arguments_delta') {
        const buffer = toolBuffers.get(event.index);
        if (buffer) {
          const delta = event.delta.arguments ?? '';
          buffer.arguments += delta;
          yield {
            type: StreamEventType.TOOL_CALL_ARGUMENTS_DELTA,
            response_id: responseId,
            item_id: `msg_${responseId}`,
            tool_call_id: buffer.id,
            tool_name: buffer.name,
            delta,
            sequence_number: sequence++,
          };
        }
      } else if (event.event_type === 'step.stop') {
        const buffer = toolBuffers.get(event.index);
        if (buffer) {
          yield {
            type: StreamEventType.TOOL_CALL_ARGUMENTS_DONE,
            response_id: responseId,
            tool_call_id: buffer.id,
            tool_name: buffer.name,
            arguments: buffer.arguments || '{}',
          };
        }
        const accumulatedUsage = event.usage ?? event.step_usage;
        if (accumulatedUsage) {
          usage = this.convertUsage(accumulatedUsage);
        }
      } else if (event.event_type === 'interaction.status_update') {
        finalStopReason = typeof event.status === 'string' ? event.status : finalStopReason;
        const status = normalizeInteractionStatus(event.status);
        if (status === 'failed') failureObserved = true;
        if (!failureObserved || status === 'failed') finalStatus = status;
      } else if (event.event_type === 'interaction.completed') {
        const interactionStatus = event.interaction?.status;
        finalStopReason = typeof interactionStatus === 'string'
          ? interactionStatus
          : finalStopReason;
        const status = normalizeInteractionStatus(interactionStatus);
        if (status === 'failed') failureObserved = true;
        if (!failureObserved || status === 'failed') finalStatus = status;
        if (event.interaction?.usage) {
          usage = this.convertUsage(event.interaction.usage, event.interaction.service_tier);
        }
        if (typeof event.interaction?.continuation_token === 'string') {
          continuationToken = event.interaction.continuation_token;
        }
      } else if (event.event_type === 'error') {
        failureObserved = true;
        finalStatus = 'failed';
        finalStopReason = typeof event.error?.code === 'string' ? event.error.code : 'error';
        yield {
          type: StreamEventType.ERROR,
          response_id: responseId,
          error: {
            type: 'google_interactions_error',
            message: event.error?.message ?? 'Google Interactions stream failed',
            ...(event.error?.code === undefined ? {} : { code: String(event.error.code) }),
          },
          recoverable: false,
        };
      }
    }

    const reasoningIndexes = new Set([...thinkingByStep.keys(), ...signatureByStep.keys()]);
    for (const index of [...reasoningIndexes].sort((a, b) => a - b)) {
      const thinking = thinkingByStep.get(index) ?? '';
      const signature = signatureByStep.get(index);
      yield {
        type: StreamEventType.REASONING_DONE,
        response_id: responseId,
        item_id: `thinking_${responseId}_${index}`,
        output_index: index,
        thinking,
        ...(signature ? { signature } : {}),
        sequence_number: sequence++,
      };
    }
    for (const [index, text] of [...textByStep].sort(([a], [b]) => a - b)) {
      yield {
        type: StreamEventType.OUTPUT_TEXT_DONE,
        response_id: responseId,
        item_id: `msg_${responseId}_${index}`,
        output_index: index,
        text,
      };
    }
    yield {
      type: StreamEventType.RESPONSE_COMPLETE,
      response_id: responseId,
      status: finalStatus,
      usage,
      iterations: 1,
      ...(finalStopReason ? { stop_reason: finalStopReason } : {}),
      ...(continuationToken ? { continuation_token: continuationToken } : {}),
    };
  }

  private resolveThinkingLevel(options: TextGenerateOptions): 'minimal' | 'low' | 'medium' | 'high' | undefined {
    const explicit = options.vendorOptions?.thinkingLevel as ReasoningEffort | undefined;
    const effort = explicit ?? options.thinking?.effort;
    if (!options.thinking?.enabled && !explicit) return undefined;
    if (effort === 'none' || effort === 'minimal') return 'minimal';
    if (effort === 'xhigh' || effort === 'max') return 'high';
    if (effort) return effort;
    const budget = options.thinking?.budgetTokens;
    if (budget !== undefined) {
      if (budget < 2048) return 'minimal';
      if (budget < 8192) return 'low';
      if (budget < 24576) return 'medium';
      return 'high';
    }
    return 'medium';
  }

  private convertTools(options: TextGenerateOptions): Array<Record<string, unknown>> {
    const tools: Array<Record<string, unknown>> = [];
    for (const tool of options.tools ?? []) {
      if (tool.type === 'function') {
        tools.push({
          type: 'function',
          name: tool.function.name,
          description: tool.function.description,
          parameters: tool.function.parameters,
        });
      } else if (tool.type === 'web_search') {
        tools.push({ type: 'google_search', search_types: ['web_search'] });
      } else if (tool.type === 'code_interpreter') {
        tools.push({ type: 'code_execution' });
      }
    }
    for (const tool of options.native_tools ?? []) {
      if (tool.capability === 'web_search') {
        tools.push({ type: 'google_search', search_types: ['web_search'], ...tool.options });
      } else if (tool.capability === 'web_fetch') {
        tools.push({ type: 'url_context', ...tool.options });
      } else if (tool.capability === 'code_execution') {
        tools.push({ type: 'code_execution', ...tool.options });
      } else if (tool.capability === 'file_search') {
        const { vectorStoreIds, ...providerOptions } = tool.options;
        tools.push({
          type: 'file_search',
          ...providerOptions,
          file_search_store_names: vectorStoreIds,
        });
      } else if (tool.capability === 'computer_use') {
        tools.push({ type: 'computer_use', ...tool.options });
      }
    }
    return tools;
  }

  private async convertInput(input: string | InputItem[]): Promise<string | InteractionStep[]> {
    if (typeof input === 'string') return input;
    const steps: InteractionStep[] = [];
    const replayedThoughtSignatures = new Set<string>();
    for (const item of input) {
      if (item.type !== 'message') continue;
      let messageContent: InteractionStep[] = [];
      const flushMessageContent = (): void => {
        if (messageContent.length === 0) return;
        steps.push({
          type: item.role === MessageRole.ASSISTANT ? 'model_output' : 'user_input',
          content: messageContent,
        });
        messageContent = [];
      };
      for (const block of item.content) {
        if (block.type === ContentType.INPUT_TEXT || block.type === ContentType.OUTPUT_TEXT) {
          messageContent.push({ type: 'text', text: block.text });
        } else if (block.type === ContentType.INPUT_IMAGE_URL) {
          if (block.image_url.url.startsWith('data:')) {
            const image = await fetchImageAsBase64(block.image_url.url);
            messageContent.push({ type: 'image', data: image.base64Data, mime_type: image.mimeType });
          } else {
            messageContent.push({ type: 'image', uri: block.image_url.url });
          }
        } else if (block.type === ContentType.INPUT_FILE) {
          messageContent.push({ type: 'document', uri: block.file_id });
        } else if (block.type === ContentType.THINKING && block.signature) {
          flushMessageContent();
          if (!replayedThoughtSignatures.has(block.signature)) {
            steps.push({ type: 'thought', signature: block.signature });
            replayedThoughtSignatures.add(block.signature);
          }
        } else if (block.type === ContentType.TOOL_USE) {
          flushMessageContent();
          let args: Record<string, unknown>;
          try {
            args = JSON.parse(block.arguments) as Record<string, unknown>;
          } catch (error) {
            throw new InvalidToolArgumentsError(block.name, block.arguments, error as Error);
          }
          if (block.thoughtSignature && !replayedThoughtSignatures.has(block.thoughtSignature)) {
            steps.push({ type: 'thought', signature: block.thoughtSignature });
            replayedThoughtSignatures.add(block.thoughtSignature);
          }
          steps.push({ type: 'function_call', id: block.id, name: block.name, arguments: args });
        } else if (block.type === ContentType.TOOL_RESULT) {
          flushMessageContent();
          steps.push({
            type: 'function_result',
            call_id: block.tool_use_id,
            result: typeof block.content === 'string' ? block.content : block.content ?? {},
            is_error: Boolean(block.error),
          });
        }
      }
      flushMessageContent();
    }
    return steps;
  }

  private convertUsage(
    raw?: Record<string, any>,
    serviceTier?: string,
    nativeToolCalls?: Record<string, number>,
  ): TokenUsage {
    const input = raw?.total_input_tokens ?? raw?.prompt_tokens ?? 0;
    const output = raw?.total_output_tokens ?? raw?.completion_tokens ?? 0;
    return {
      input_tokens: input,
      output_tokens: output,
      total_tokens: raw?.total_tokens ?? input + output,
      ...(raw?.total_cached_tokens !== undefined && { cached_input_tokens: raw.total_cached_tokens }),
      ...(raw?.total_thought_tokens !== undefined && {
        output_tokens_details: { reasoning_tokens: raw.total_thought_tokens },
      }),
      ...(nativeToolCalls && Object.keys(nativeToolCalls).length > 0 && { native_tool_calls: nativeToolCalls }),
      processing_mode: serviceTier === 'flex' ? 'flex' : serviceTier === 'priority' ? 'priority' : 'interactive',
      ...(serviceTier && { service_tier: serviceTier }),
    };
  }
}
