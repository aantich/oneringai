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
import { LLMResponse } from '../../../domain/entities/Response.js';
import { Tool } from '../../../domain/entities/Tool.js';
import { ContentType } from '../../../domain/entities/Content.js';
import * as ResponsesAPI from 'openai/resources/responses/responses.js';

type ResponsesAPIInputItem = ResponsesAPI.ResponseInputItem;
type ResponsesAPIResponse = ResponsesAPI.Response;

export class OpenAIResponsesConverter {
  /**
   * Convert our input format to Responses API format
   */
  convertInput(
    input: string | InputItem[],
    instructions?: string
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

    for (const item of input) {
      if (item.type === 'message') {
        // Convert message item
        const messageContent: any[] = [];

        // OpenAI Responses API requires specific content types based on role:
        // - user messages: input_text, input_image, input_audio, input_file
        // - assistant messages: output_text, refusal
        const isAssistant = item.role === 'assistant';

        for (const content of item.content) {
          switch (content.type) {
            case 'input_text':
            case 'output_text':
              // Map text content type based on message role
              messageContent.push({
                type: isAssistant ? 'output_text' : 'input_text',
                text: content.text,
              });
              break;

            case 'input_image_url':
              // Images are only valid for user messages
              if (!isAssistant) {
                messageContent.push({
                  type: 'input_image',
                  image_url: content.image_url.url,
                  ...(content.image_url.detail && { detail: content.image_url.detail }),
                });
              }
              break;

            case 'tool_use':
              // Tool use becomes a separate function_call item
              items.push({
                type: 'function_call',
                call_id: content.id,
                name: content.name,
                arguments: content.arguments,
              } as ResponsesAPI.ResponseFunctionToolCall);
              break;

            case 'tool_result': {
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
          }
        }

        // Only add message if it has content (tool_use/tool_result don't go in message)
        if (messageContent.length > 0) {
          items.push({
            type: 'message',
            role: item.role,
            content: messageContent,
            // Only include id if it's a valid OpenAI message ID (starts with msg_)
            // New messages shouldn't have id; previous outputs keep their original id
            ...(item.id?.startsWith('msg_') ? { id: item.id } : {}),
            status: 'completed' as const,
          } as ResponsesAPI.ResponseInputItem.Message);
        }
      } else if (item.type === 'compaction') {
        // Pass through compaction items
        items.push({
          type: 'compaction',
          id: item.id,
          encrypted_content: item.encrypted_content,
        } as ResponsesAPI.ResponseCompactionItemParam);
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
    const content: any[] = [];
    let outputText = '';
    let messageId: string | undefined;

    // Process all output items
    for (const item of response.output || []) {
      if (item.type === 'message') {
        // Extract message content
        const messageItem = item as ResponsesAPI.ResponseOutputMessage;

        // Extract message ID (first message item wins)
        if (!messageId && messageItem.id) {
          messageId = messageItem.id;
        }

        for (const contentItem of messageItem.content || []) {
          if (contentItem.type === 'output_text') {
            const textContent = contentItem as ResponsesAPI.ResponseOutputText;
            content.push({
              type: 'output_text',
              text: textContent.text,
              annotations: textContent.annotations || [],
            });
            outputText += textContent.text;
          }
        }
      } else if (item.type === 'function_call') {
        // Convert function_call to tool_use
        const functionCall = item as ResponsesAPI.ResponseFunctionToolCall;
        content.push({
          type: 'tool_use',
          id: functionCall.call_id,
          name: functionCall.name,
          arguments: functionCall.arguments,
        });
      } else if (item.type === 'reasoning') {
        // Extract reasoning summary as ThinkingContent (unified thinking API)
        const reasoning = item as ResponsesAPI.ResponseReasoningItem;
        if (reasoning.summary) {
          let summaryText: string;
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
          if (summaryText) {
            content.push({
              type: ContentType.THINKING,
              thinking: summaryText,
              persistInHistory: false,
            });
          }
        }
      }
    }

    // Use output_text helper from SDK
    if (!outputText) {
      outputText = response.output_text || '';
    }

    // IMPORTANT: Use the actual message ID from output items, not the response ID
    // Response IDs start with "resp_" but OpenAI expects message IDs starting with "msg_"
    // when we send them back in subsequent requests
    const finalMessageId = messageId || response.id;

    return {
      id: response.id,
      object: 'response',
      created_at: response.created_at,
      status: response.status || 'completed',
      model: response.model,
      output: [
        {
          type: 'message',
          id: finalMessageId,
          role: MessageRole.ASSISTANT,
          content,
        },
      ],
      output_text: outputText,
      // Extract thinking text from content for convenience field
      ...((() => {
        const thinkingTexts = content
          .filter((c: any) => c.type === ContentType.THINKING)
          .map((c: any) => c.thinking as string)
          .filter(Boolean);
        return thinkingTexts.length > 0 ? { thinking: thinkingTexts.join('\n') } : {};
      })()),
      usage: {
        input_tokens: response.usage?.input_tokens || 0,
        output_tokens: response.usage?.output_tokens || 0,
        total_tokens: response.usage?.total_tokens || 0,
        ...((response.usage as any)?.output_tokens_details?.reasoning_tokens != null && {
          output_tokens_details: {
            reasoning_tokens: (response.usage as any).output_tokens_details.reasoning_tokens,
          },
        }),
      },
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
        } as ResponsesAPI.FunctionTool;
      }

      // Built-in tools (web_search, file_search, etc.)
      return tool as ResponsesAPI.Tool;
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
