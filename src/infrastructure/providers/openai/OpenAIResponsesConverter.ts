/**
 * OpenAI Responses API Converter
 *
 * Converts between our internal format and OpenAI's Responses API format.
 * The Responses API is the successor to Chat Completions API and is required
 * for GPT-5.2 Pro, GPT-5.2 Codex, and other advanced models.
 *
 * Key differences from Chat Completions:
 * - Uses `input` (Items array) instead of `messages`
 * - Uses `instructions` (top-level) instead of system message
 * - Tool definitions are internally-tagged (no nested `function` object)
 * - Responses contain Items array with different types
 */

import { InputItem, MessageRole } from '../../../domain/entities/Message.js';
import type { OutputItem } from '../../../domain/entities/Message.js';
import { LLMResponse } from '../../../domain/entities/Response.js';
import { Tool } from '../../../domain/entities/Tool.js';
import { ContentType } from '../../../domain/entities/Content.js';
import { InvalidConfigError } from '../../../domain/errors/AIErrors.js';
import * as ResponsesAPI from 'openai/resources/responses/responses.js';

type ResponsesAPIInputItem = ResponsesAPI.ResponseInputItem;
type ResponsesAPIResponse = ResponsesAPI.Response;

export function openAINativeToolCapabilityForOutputType(type: string): string | undefined {
  switch (type) {
    case 'web_search_call': return 'web_search';
    case 'x_search_call': return 'x_search';
    case 'file_search_call': return 'file_search';
    case 'code_interpreter_call':
    case 'code_execution_call': return 'code_execution';
    case 'mcp_call': return 'remote_mcp';
    case 'computer_call': return 'computer_use';
    case 'shell_call':
    case 'local_shell_call': return 'hosted_shell';
    case 'apply_patch_call': return 'apply_patch';
    case 'tool_search_call': return 'tool_search';
    case 'image_generation_call': return 'image_generation';
    default: return undefined;
  }
}

function openAINativeToolCapabilityForResultType(type: string): string | undefined {
  switch (type) {
    case 'computer_call_output': return 'computer_use';
    case 'shell_call_output':
    case 'local_shell_call_output': return 'hosted_shell';
    case 'apply_patch_call_output': return 'apply_patch';
    case 'tool_search_output': return 'tool_search';
    default: return undefined;
  }
}

export class OpenAIResponsesConverter {
  /**
   * Convert our input format to Responses API format
   */
  convertInput(
    input: string | InputItem[],
    instructions?: string,
    allowPromptCacheBreakpoints = false,
  ): { input: string | ResponsesAPIInputItem[]; instructions?: string } {
    // Simple string input
    if (typeof input === 'string') {
      return {
        input,
        instructions,
      };
    }

    // Convert InputItem[] to Responses API Items
    const items: ResponsesAPIInputItem[] = [];

    this.validateInputItems(input);

    for (const item of input) {
      if (item.type === 'message') {
        // Convert message item
        let messageContent: any[] = [];
        let messageSegment = 0;

        // OpenAI Responses API requires specific content types based on role:
        // - user messages: input_text, input_image, input_audio, input_file
        // - assistant messages: output_text, refusal
        const isAssistant = item.role === 'assistant';
        const flushMessageContent = (): void => {
          if (messageContent.length === 0) return;
          items.push({
            type: 'message',
            role: item.role,
            content: messageContent,
            // A provider message ID identifies one output item. When internal
            // content is split around top-level tool/reasoning items, attach it
            // only to the first message segment.
            ...(messageSegment === 0 && item.id?.startsWith('msg_') ? { id: item.id } : {}),
            status: 'completed' as const,
          } as ResponsesAPI.ResponseInputItem.Message);
          messageContent = [];
          messageSegment++;
        };

        for (const content of item.content) {
          switch (content.type) {
            case 'input_text':
            case 'output_text':
              // Map text content type based on message role
              messageContent.push({
                type: isAssistant ? 'output_text' : 'input_text',
                text: content.text,
                ...(allowPromptCacheBreakpoints && content.promptCacheBreakpoint && {
                  prompt_cache_breakpoint: { mode: 'explicit' },
                }),
              });
              break;

            case 'input_image_url':
              // Images are only valid for user messages
              if (!isAssistant) {
                messageContent.push({
                  type: 'input_image',
                  image_url: content.image_url.url,
                  ...(content.image_url.detail && { detail: content.image_url.detail }),
                  ...(allowPromptCacheBreakpoints && content.promptCacheBreakpoint && {
                    prompt_cache_breakpoint: { mode: 'explicit' },
                  }),
                });
              }
              break;

            case 'input_file':
              if (!isAssistant) {
                messageContent.push({
                  type: 'input_file',
                  file_id: content.file_id,
                  ...(allowPromptCacheBreakpoints && content.promptCacheBreakpoint && {
                    prompt_cache_breakpoint: { mode: 'explicit' },
                  }),
                });
              }
              break;

            case 'tool_use':
              // Tool use becomes a separate function_call item
              flushMessageContent();
              items.push({
                type: 'function_call',
                call_id: content.id,
                name: content.name,
                arguments: content.arguments,
                ...(content.async !== undefined ? { async: content.async } : {}),
              } as ResponsesAPI.ResponseFunctionToolCall);
              break;

            case 'tool_result': {
              flushMessageContent();
              // Read images from Content object first (set by addToolResults),
              // fall back to JSON extraction for backward compat
              const contentImages = (content as any).__images as Array<{ base64: string; mediaType: string }> | undefined;

              let outputText: string;
              let images: Array<{ base64: string; mediaType: string }>;

              if (contentImages?.length) {
                // Images already extracted at context layer — use text content as-is
                outputText = typeof content.content === 'string'
                  ? content.content
                  : JSON.stringify(content.content);
                images = contentImages;
              } else {
                // Fallback: try extracting from raw JSON output
                const rawOutput = typeof content.content === 'string'
                  ? content.content
                  : JSON.stringify(content.content);
                const extracted = this.extractImagesFromOutput(rawOutput);
                outputText = extracted.text;
                images = extracted.images;
              }

              items.push({
                type: 'function_call_output',
                call_id: content.tool_use_id,
                output: outputText,
              } as any);

              // OpenAI function_call_output only supports text.
              // Inject a follow-up user message with the image(s) so the model can see them.
              if (images.length > 0) {
                const imageContent: any[] = images.map((img) => ({
                  type: 'input_image',
                  image_url: `data:${img.mediaType};base64,${img.base64}`,
                }));
                items.push({
                  type: 'message',
                  role: 'user',
                  content: [
                    { type: 'input_text', text: '[Screenshot from tool result]' },
                    ...imageContent,
                  ],
                  status: 'completed' as const,
                } as any);
              }
              break;
            }

            case 'custom_tool_use':
              flushMessageContent();
              items.push({
                type: 'custom_tool_call',
                call_id: content.id,
                name: content.name,
                input: content.input,
                ...(content.async !== undefined ? { async: content.async } : {}),
              } as ResponsesAPI.ResponseCustomToolCall);
              break;

            case 'custom_tool_result':
              flushMessageContent();
              items.push({
                type: 'custom_tool_call_output',
                call_id: content.tool_use_id,
                output: typeof content.content === 'string'
                  ? content.content
                  : JSON.stringify(content.content),
              } as ResponsesAPI.ResponseCustomToolCallOutput);
              break;

            case 'thinking': {
              const encryptedContent = content.providerMetadata?.encrypted_content;
              if (content.providerItemId && typeof encryptedContent === 'string') {
                flushMessageContent();
                items.push({
                  type: 'reasoning',
                  id: content.providerItemId,
                  ...(content.thinking
                    ? { summary: [{ type: 'summary_text', text: content.thinking }] }
                    : {}),
                  encrypted_content: encryptedContent,
                } as unknown as ResponsesAPIInputItem);
              }
              break;
            }
          }
        }

        // Only add message segments with content; tool/reasoning items remain
        // separate Responses items in their original relative positions.
        flushMessageContent();
      } else if (item.type === 'compaction') {
        // Pass through compaction items
        items.push({
          type: 'compaction',
          id: item.id,
          encrypted_content: item.encrypted_content,
        } as ResponsesAPI.ResponseCompactionItemParam);
      } else if (item.type === 'reasoning') {
        items.push({
          type: 'reasoning',
          id: item.id,
          ...(item.effort ? { effort: item.effort } : {}),
          ...(item.summary
            ? { summary: [{ type: 'summary_text', text: item.summary }] }
            : {}),
          ...(item.encrypted_content ? { encrypted_content: item.encrypted_content } : {}),
        } as unknown as ResponsesAPIInputItem);
      } else if (item.type === 'configuration_update') {
        items.push({
          type: 'configuration_update',
          ...(item.id ? { id: item.id } : {}),
          reasoning: { effort: item.reasoning.effort },
        } as ResponsesAPI.ResponseConfigurationUpdateItemParam);
      } else if (item.type === 'compaction_trigger') {
        items.push({ type: 'compaction_trigger' } as ResponsesAPI.ResponseInputItem.CompactionTrigger);
      } else if (item.type === 'function_call_output') {
        items.push({
          type: 'function_call_output',
          call_id: item.call_id,
          output: this.convertToolCallOutput(item.output),
        } as ResponsesAPI.ResponseInputItem.FunctionCallOutput);
      } else if (item.type === 'custom_tool_call_output') {
        items.push({
          type: 'custom_tool_call_output',
          call_id: item.call_id,
          output: this.convertToolCallOutput(item.output),
        } as ResponsesAPI.ResponseCustomToolCallOutput);
      } else if (
        item.type === 'computer_call_output'
        || item.type === 'shell_call_output'
        || item.type === 'apply_patch_call_output'
        || item.type === 'tool_search_output'
      ) {
        items.push(item as unknown as ResponsesAPIInputItem);
      }
    }

    return {
      input: items,
      instructions,
    };
  }

  /**
   * Convert Responses API response to our LLMResponse format
   */
  convertResponse(response: ResponsesAPIResponse): LLMResponse {
    const output: OutputItem[] = [];
    let content: any[] = [];
    const allContent: any[] = [];
    let outputText = '';
    let messageId: string | undefined;
    const nativeToolCalls: Record<string, number> = {};
    const nativeToolEvents: NonNullable<LLMResponse['native_tool_events']> = [];
    const appendContent = (part: any): void => {
      content.push(part);
      allContent.push(part);
    };
    const flushContent = (): void => {
      if (content.length === 0) return;
      output.push({
        type: 'message',
        id: messageId || response.id,
        role: MessageRole.ASSISTANT,
        content,
      });
      content = [];
      messageId = undefined;
    };

    // Process all output items
    for (const item of response.output || []) {
      if (item.type === 'message') {
        // Extract message content
        const messageItem = item as ResponsesAPI.ResponseOutputMessage;

        // Keep separate provider messages separate while allowing preceding
        // reasoning/tool items to remain attached to the following message.
        if (messageId && messageItem.id && messageId !== messageItem.id) {
          flushContent();
        }
        if (messageItem.id) {
          messageId = messageItem.id;
        }

        for (const contentItem of messageItem.content || []) {
          if (contentItem.type === 'output_text') {
            const textContent = contentItem as ResponsesAPI.ResponseOutputText;
            appendContent({
              type: 'output_text',
              text: textContent.text,
              annotations: textContent.annotations || [],
            });
            outputText += textContent.text;
          }
        }
      } else if (item.type === 'compaction') {
        // Compaction items are canonical continuation state. Preserve their
        // position relative to normalized message/tool content so stateless
        // callers can replay response.output without losing context.
        flushContent();
        const compaction = item as ResponsesAPI.ResponseCompactionItem;
        output.push({
          type: 'compaction',
          id: compaction.id,
          encrypted_content: compaction.encrypted_content,
        });
      } else if (item.type === 'function_call') {
        // Convert function_call to tool_use
        const functionCall = item as ResponsesAPI.ResponseFunctionToolCall;
        appendContent({
          type: 'tool_use',
          id: functionCall.call_id,
          name: functionCall.name,
          arguments: functionCall.arguments,
          ...(functionCall.async !== undefined ? { async: functionCall.async } : {}),
        });
      } else if (item.type === 'custom_tool_call') {
        const customCall = item as ResponsesAPI.ResponseCustomToolCall;
        appendContent({
          type: ContentType.CUSTOM_TOOL_USE,
          id: customCall.call_id,
          name: customCall.name,
          input: customCall.input,
          ...(customCall.async !== undefined ? { async: customCall.async } : {}),
        });
      } else if (item.type === 'reasoning') {
        // Preserve encrypted reasoning as a top-level item for stateless
        // continuation. Summary-only reasoning retains the historical
        // ThinkingContent shape because it carries no replayable opaque state.
        const reasoning = item as ResponsesAPI.ResponseReasoningItem;
        let summaryText = '';
        if (reasoning.summary) {
          if (typeof reasoning.summary === 'string') {
            summaryText = reasoning.summary;
          } else if (Array.isArray(reasoning.summary)) {
            summaryText = reasoning.summary
              .map((s: any) => s.text || '')
              .filter(Boolean)
              .join('\n');
          } else {
            summaryText = '';
          }
        }
        const encryptedContent = typeof reasoning.encrypted_content === 'string'
          ? reasoning.encrypted_content
          : undefined;
        if (encryptedContent) {
          flushContent();
          output.push({
            type: 'reasoning',
            id: reasoning.id,
            ...(typeof (reasoning as any).effort === 'string'
              ? { effort: (reasoning as any).effort }
              : {}),
            ...(summaryText ? { summary: summaryText } : {}),
            encrypted_content: encryptedContent,
          });
        }
        if (summaryText) {
          const thinkingContent = {
            type: ContentType.THINKING,
            thinking: summaryText,
            providerItemId: reasoning.id,
            ...(encryptedContent
              ? { providerMetadata: { encrypted_content: encryptedContent } }
              : {}),
            persistInHistory: false,
          };
          if (encryptedContent) allContent.push(thinkingContent);
          else appendContent(thinkingContent);
        }
      } else {
        const nativeCapability = openAINativeToolCapabilityForOutputType(item.type);
        if (nativeCapability) {
          nativeToolCalls[nativeCapability] = (nativeToolCalls[nativeCapability] ?? 0) + 1;
          const includeDetails = ![
            'web_search_call',
            'file_search_call',
            'code_interpreter_call',
            'mcp_call',
          ].includes(item.type);
          nativeToolEvents.push(this.toNativeToolEvent(
            nativeCapability,
            item,
            includeDetails,
            includeDetails ? 'call' : undefined,
          ));
        } else {
          const resultCapability = openAINativeToolCapabilityForResultType(item.type);
          if (resultCapability) {
            nativeToolEvents.push(this.toNativeToolEvent(
              resultCapability,
              item,
              true,
              'output',
            ));
          }
        }
      }
    }
    flushContent();

    // Keep the historical empty assistant message fallback for providers that
    // return no normalized output at all. A compaction-only response is already
    // complete continuation state and must remain compaction-only.
    if (output.length === 0) {
      output.push({
        type: 'message',
        id: response.id,
        role: MessageRole.ASSISTANT,
        content: [],
      });
    }

    // Use output_text helper from SDK
    if (!outputText) {
      outputText = response.output_text || '';
    }

    return {
      id: response.id,
      object: 'response',
      created_at: response.created_at,
      status: response.status || 'completed',
      model: response.model,
      output,
      output_text: outputText,
      // Extract thinking text from content for convenience field
      ...((() => {
        const thinkingTexts = allContent
          .filter((c: any) => c.type === ContentType.THINKING)
          .map((c: any) => c.thinking as string)
          .filter(Boolean);
        return thinkingTexts.length > 0 ? { thinking: thinkingTexts.join('\n') } : {};
      })()),
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
      ...(nativeToolEvents.length > 0 && { native_tool_events: nativeToolEvents }),
      ...(response.error
        ? { error: { type: response.error.code, message: response.error.message } }
        : {}),
      ...((response as ResponsesAPI.Response & { incomplete_details?: { reason?: string | null } })
        .incomplete_details?.reason
        ? { stop_reason: (response as ResponsesAPI.Response & { incomplete_details?: { reason?: string } }).incomplete_details!.reason }
        : {}),
    };
  }

  private validateInputItems(input: InputItem[]): void {
    for (let index = 0; index < input.length; index++) {
      const item = input[index]!;
      if (item.type === 'configuration_update' && input[index - 1]?.type === 'configuration_update') {
        throw new InvalidConfigError(
          'OpenAI Responses rejects adjacent configuration_update input items',
        );
      }
      if (item.type === 'compaction_trigger' && index !== input.length - 1) {
        throw new InvalidConfigError(
          'OpenAI Responses requires compaction_trigger to be the final input item',
        );
      }
    }
  }

  private convertToolCallOutput(
    output: Extract<InputItem, { type: 'function_call_output' }>['output'],
  ): string | Array<ResponsesAPI.ResponseInputText | ResponsesAPI.ResponseInputImage | ResponsesAPI.ResponseInputFile> {
    if (typeof output === 'string') return output;
    return output.map((content) => {
      if (content.type === ContentType.INPUT_TEXT) {
        return { type: 'input_text', text: content.text } as ResponsesAPI.ResponseInputText;
      }
      if (content.type === ContentType.INPUT_IMAGE_URL) {
        return {
          type: 'input_image',
          image_url: content.image_url.url,
          ...(content.image_url.detail ? { detail: content.image_url.detail } : {}),
        } as ResponsesAPI.ResponseInputImage;
      }
      return { type: 'input_file', file_id: content.file_id } as ResponsesAPI.ResponseInputFile;
    });
  }

  private toNativeToolEvent(
    capability: string,
    item: unknown,
    includeDetails = false,
    phase?: 'call' | 'output',
  ): NonNullable<LLMResponse['native_tool_events']>[number] {
    const raw = item as Record<string, unknown>;
    const error = raw.error;
    return {
      capability,
      ...(typeof raw.id === 'string' ? { id: raw.id } : {}),
      ...(typeof raw.call_id === 'string' ? { call_id: raw.call_id } : {}),
      ...(typeof raw.status === 'string' ? { status: raw.status } : {}),
      ...(phase ? { phase } : {}),
      ...(includeDetails ? { details: item } : {}),
      ...(error
        ? {
            error: {
              code:
                typeof error === 'object' && error && 'code' in error
                  ? String((error as { code?: unknown }).code)
                  : undefined,
              message:
                typeof error === 'object' && error && 'message' in error
                  ? String((error as { message?: unknown }).message)
                  : String(error),
              details: error,
            },
          }
        : {}),
    };
  }

  /**
   * Convert our tool definitions to Responses API format
   *
   * Key difference: Responses API uses internally-tagged format
   * (no nested `function` object) and strict mode requires proper schemas
   */
  convertTools(tools: Tool[]): ResponsesAPI.Tool[] {
    return tools.map((tool) => {
      if (tool.type === 'function') {
        // Remove the nested `function` wrapper
        const funcDef = tool.function;

        // IMPORTANT: Only enable strict mode if explicitly requested (backward compatible)
        // Strict mode requires all object schemas to have "additionalProperties": false
        // Default to false for backward compatibility with existing tools
        const useStrict = funcDef.strict === true;

        return {
          type: 'function',
          name: funcDef.name,
          description: funcDef.description || '',
          parameters: funcDef.parameters || null,
          strict: useStrict,
          ...(tool.async !== undefined ? { async: tool.async } : {}),
          ...(tool.allowedCallers ? { allowed_callers: tool.allowedCallers } : {}),
          ...(tool.deferLoading !== undefined ? { defer_loading: tool.deferLoading } : {}),
          ...(tool.outputSchema ? { output_schema: tool.outputSchema } : {}),
        } as ResponsesAPI.FunctionTool;
      }

      if (tool.type === 'custom') {
        return {
          type: 'custom',
          name: tool.name,
          ...(tool.description ? { description: tool.description } : {}),
          ...(tool.format ? { format: tool.format } : {}),
          ...(tool.async !== undefined ? { async: tool.async } : {}),
          ...(tool.allowedCallers ? { allowed_callers: tool.allowedCallers } : {}),
          ...(tool.deferLoading !== undefined ? { defer_loading: tool.deferLoading } : {}),
        } as ResponsesAPI.CustomTool;
      }

      // Built-in tools (web_search, file_search, etc.)
      return tool as ResponsesAPI.Tool;
    });
  }

  convertNativeTools(
    tools: import('../../../domain/interfaces/IAdvancedInference.js').NativeToolRequest[],
    vendor: 'openai' | 'grok' = 'openai',
  ): ResponsesAPI.Tool[] {
    return tools.map((tool) => {
      const extra = tool.options ?? {};
      switch (tool.capability) {
        case 'web_search':
          return { ...extra, type: 'web_search' } as ResponsesAPI.Tool;
        case 'x_search':
          if (vendor !== 'grok') throw new Error('OpenAI has no native x_search tool');
          return { ...extra, type: 'x_search' } as unknown as ResponsesAPI.Tool;
        case 'file_search':
          {
            const { vectorStoreIds, ...providerOptions } = extra as Record<string, unknown> & {
              vectorStoreIds?: string[];
            };
            return {
              ...providerOptions,
              type: 'file_search',
              ...(vectorStoreIds ? { vector_store_ids: vectorStoreIds } : {}),
            } as ResponsesAPI.Tool;
          }
        case 'code_execution':
          if (vendor === 'grok') {
            return { ...extra, type: 'code_execution' } as unknown as ResponsesAPI.Tool;
          }
          return {
            ...extra,
            type: 'code_interpreter',
            container: { type: 'auto' },
          } as ResponsesAPI.Tool;
        case 'remote_mcp': {
          const resolvedToken = (
            tool.server as typeof tool.server & { resolvedAuthorizationToken?: string }
          ).resolvedAuthorizationToken;
          return {
            ...extra,
            type: 'mcp',
            server_label: tool.server.name,
            server_url: tool.server.url,
            ...(resolvedToken ? { authorization: resolvedToken } : {}),
            ...(tool.server.allowedTools ? { allowed_tools: tool.server.allowedTools } : {}),
            // OpenAI otherwise defaults remote MCP to approval-required. The
            // normalized adapter cannot resume an approval request yet, so an
            // omitted policy uses the only executable end-to-end mode.
            require_approval: tool.server.requireApproval ?? 'never',
          } as ResponsesAPI.Tool;
        }
        case 'web_fetch':
          throw new Error('OpenAI has no standalone native web_fetch tool');
        case 'computer_use':
          if (vendor === 'grok') throw new Error('xAI has no normalized native computer-use tool');
          return { ...extra, type: 'computer' } as ResponsesAPI.Tool;
        case 'hosted_shell':
          if (vendor === 'grok') throw new Error('xAI has no normalized hosted-shell tool');
          return {
            ...extra,
            type: 'shell',
            environment: extra.environment ?? { type: 'container_auto' },
          } as ResponsesAPI.Tool;
        case 'apply_patch':
          if (vendor === 'grok') throw new Error('xAI has no normalized apply_patch tool');
          return { ...extra, type: 'apply_patch' } as ResponsesAPI.Tool;
        case 'tool_search':
          if (vendor === 'grok') throw new Error('xAI has no normalized tool-search tool');
          return { ...extra, type: 'tool_search' } as ResponsesAPI.Tool;
        case 'image_generation':
          if (vendor === 'grok') throw new Error('xAI has no normalized Responses image-generation tool');
          return { ...extra, type: 'image_generation' } as ResponsesAPI.Tool;
      }
    });
  }

  /**
   * Convert tool_choice option to Responses API format
   */
  convertToolChoice(
    toolChoice?: 'auto' | 'required' | { type: 'function'; function: { name: string } }
  ): ResponsesAPI.ResponseCreateParams['tool_choice'] {
    if (!toolChoice || toolChoice === 'auto') {
      return 'auto';
    }

    if (toolChoice === 'required') {
      return 'required';
    }

    // Specific function
    return {
      type: 'function',
      name: toolChoice.function.name,
    } as ResponsesAPI.ToolChoiceFunction;
  }

  /**
   * Convert response_format option to Responses API format (modalities)
   */
  convertResponseFormat(
    responseFormat?: {
      type: 'text' | 'json_object' | 'json_schema';
      json_schema?: any;
    }
  ): ResponsesAPI.ResponseTextConfig | undefined {
    if (!responseFormat) {
      return undefined;
    }

    // ResponseTextConfig = { format?: ResponseFormatTextConfig }
    // ResponseFormatTextConfig = { type: 'text' } | { type: 'json_object' } | { type: 'json_schema', ... }

    if (responseFormat.type === 'json_schema' && responseFormat.json_schema) {
      return {
        format: {
          type: 'json_schema',
          name: responseFormat.json_schema.name || 'response',
          schema: responseFormat.json_schema.schema || responseFormat.json_schema,
          description: responseFormat.json_schema.description,
          strict: responseFormat.json_schema.strict !== false,
        },
      } as ResponsesAPI.ResponseTextConfig;
    }

    if (responseFormat.type === 'json_object') {
      return {
        format: {
          type: 'json_object',
        },
      } as ResponsesAPI.ResponseTextConfig;
    }

    // Default: plain text — no format needed (it's the default)
    return undefined;
  }

  /**
   * Extract __images from a JSON tool result and return cleaned text + images.
   * Used by the __images convention for multimodal tool results.
   */
  private extractImagesFromOutput(output: string): {
    text: string;
    images: Array<{ base64: string; mediaType: string }>;
  } {
    try {
      const parsed = JSON.parse(output);
      if (parsed && Array.isArray(parsed.__images) && parsed.__images.length > 0) {
        const images = parsed.__images;
        const { __images: _, base64: __, ...rest } = parsed;
        return { text: JSON.stringify(rest), images };
      }
    } catch {
      // Not JSON or no __images
    }
    return { text: output, images: [] };
  }
}
