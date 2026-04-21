/**
 * Anthropic Converter - Converts between our Responses API format and Anthropic Messages API
 *
 * Extends BaseConverter for common patterns:
 * - Input normalization
 * - Tool conversion
 * - Response building
 * - Resource cleanup
 */

import Anthropic from '@anthropic-ai/sdk';
import { BaseConverter } from '../base/BaseConverter.js';
import { TextGenerateOptions } from '../../../domain/interfaces/ITextProvider.js';
import { LLMResponse } from '../../../domain/entities/Response.js';
import { InputItem } from '../../../domain/entities/Message.js';
import { Content, ContentType } from '../../../domain/entities/Content.js';
import { Tool } from '../../../domain/entities/Tool.js';
import { getModelInfo } from '../../../domain/entities/Model.js';
import { convertToolsToStandardFormat, transformForAnthropic, ProviderToolFormat } from '../shared/ToolConversionUtils.js';
import { mapAnthropicStatus, ResponseStatus } from '../shared/ResponseBuilder.js';
import { validateThinkingConfig } from '../shared/validateThinkingConfig.js';

export class AnthropicConverter extends BaseConverter<Anthropic.MessageCreateParams, Anthropic.Message> {
  readonly providerName = 'anthropic';

  /**
   * Convert our format -> Anthropic Messages API format
   */
  convertRequest(options: TextGenerateOptions): Anthropic.MessageCreateParams {
    const messages = this.convertMessages(options.input);
    const tools = this.convertAnthropicTools(options.tools);

    const params: Anthropic.MessageCreateParams = {
      model: options.model,
      max_tokens: options.max_output_tokens || 4096,
      messages,
    };

    // Add system instruction if provided
    if (options.instructions) {
      params.system = options.instructions;
    }

    // Add tools if provided
    if (tools && tools.length > 0) {
      params.tools = tools;
    }

    // Some models (e.g. claude-opus-4-7) deprecate the `temperature` parameter entirely.
    // Registry opt-out: features.parameters.temperature === false.
    // Default is supported — unknown / missing registry entries pass temperature through.
    const supportsTemperature =
      getModelInfo(options.model)?.features.parameters?.temperature !== false;

    // Add thinking/reasoning support
    if (options.thinking?.enabled) {
      validateThinkingConfig(options.thinking);
      const budgetTokens = options.thinking.budgetTokens || 10000;
      (params as any).thinking = {
        type: 'enabled',
        budget_tokens: budgetTokens,
      };
      // Anthropic requires temperature=1 when thinking is enabled — but only on models that accept it
      if (supportsTemperature) {
        params.temperature = 1;
      }
    } else if (options.temperature !== undefined && supportsTemperature) {
      // Only set temperature if thinking is not enabled and the model accepts it
      params.temperature = options.temperature;
    }

    return params;
  }

  /**
   * Convert Anthropic response -> our LLMResponse format
   */
  convertResponse(response: Anthropic.Message): LLMResponse {
    return this.buildResponse({
      rawId: response.id,
      model: response.model,
      status: this.mapProviderStatus(response.stop_reason),
      content: this.convertProviderContent(response.content),
      messageId: response.id,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    });
  }

  // ==========================================================================
  // BaseConverter Abstract Method Implementations
  // ==========================================================================

  /**
   * Transform standardized tool to Anthropic format
   */
  protected transformTool(tool: ProviderToolFormat): Anthropic.Tool {
    return {
      ...transformForAnthropic(tool),
      input_schema: {
        type: 'object',
        ...tool.parameters,
      } as Anthropic.Tool.InputSchema,
    };
  }

  /**
   * Convert Anthropic content blocks to our Content[]
   */
  protected convertProviderContent(blocks: unknown[]): Content[] {
    const content: Content[] = [];

    for (const block of blocks as Anthropic.ContentBlock[]) {
      if (block.type === 'text') {
        content.push(this.createText(block.text));
      } else if (block.type === 'tool_use') {
        content.push(this.createToolUse(block.id, block.name, block.input as Record<string, unknown>));
      } else if (block.type === 'thinking') {
        // Anthropic thinking block - must persist in history for round-tripping
        const thinkingBlock = block as { type: 'thinking'; thinking: string; signature: string };
        content.push({
          type: ContentType.THINKING,
          thinking: thinkingBlock.thinking || '',
          signature: thinkingBlock.signature,
          persistInHistory: true,
        });
      }
    }

    return content;
  }

  /**
   * Map Anthropic stop_reason to ResponseStatus
   */
  protected mapProviderStatus(status: unknown): ResponseStatus {
    return mapAnthropicStatus(status as string | null);
  }

  // ==========================================================================
  // Anthropic-Specific Conversion Methods
  // ==========================================================================

  /**
   * Convert our InputItem[] -> Anthropic messages
   */
  private convertMessages(input: string | InputItem[]): Anthropic.MessageParam[] {
    if (typeof input === 'string') {
      return [{ role: 'user', content: input }];
    }

    const messages: Anthropic.MessageParam[] = [];

    for (const item of input) {
      if (item.type === 'message') {
        // Map roles: 'developer' -> 'user' (Anthropic doesn't have developer role)
        const role = this.mapRole(item.role);

        // Convert content
        const content = this.convertContent(item.content);

        // Skip messages with empty content (Anthropic rejects these)
        if (!content || (Array.isArray(content) && content.length === 0) || content === '') {
          continue;
        }

        messages.push({
          role: role as 'user' | 'assistant',
          content,
        });
      }
    }

    // Safety net: Anthropic requires the conversation to end with a user message.
    // Some models (e.g., claude-opus-4-6) reject assistant prefill entirely.
    // If the last message is assistant (can happen after compaction or context bugs),
    // trim trailing assistant messages to prevent API errors.
    while (messages.length > 0 && messages[messages.length - 1]!.role === 'assistant') {
      messages.pop();
    }

    // If all messages were trimmed (shouldn't happen), add a minimal user message
    if (messages.length === 0) {
      messages.push({ role: 'user', content: 'Continue.' });
    }

    return messages;
  }

  /**
   * Convert our Content[] -> Anthropic content blocks
   */
  private convertContent(content: Content[]): Anthropic.MessageParam['content'] {
    const blocks: Array<Anthropic.TextBlockParam | Anthropic.ImageBlockParam | Anthropic.ToolUseBlockParam | Anthropic.ToolResultBlockParam> = [];

    for (const c of content) {
      switch (c.type) {
        case ContentType.INPUT_TEXT:
        case ContentType.OUTPUT_TEXT: {
          // Anthropic rejects empty text content blocks
          const textContent = (c as { text: string }).text;
          if (textContent && textContent.trim()) {
            blocks.push({
              type: 'text',
              text: textContent,
            });
          }
          break;
        }

        case ContentType.INPUT_IMAGE_URL: {
          const imgContent = c as { image_url: { url: string } };
          const block = this.convertImageToAnthropicBlock(imgContent.image_url.url);
          if (block) {
            blocks.push(block);
          }
          break;
        }

        case ContentType.TOOL_RESULT: {
          const resultContent = c as {
            tool_use_id: string;
            content: string | unknown;
            error?: string;
            __images?: Array<{ base64: string; mediaType: string }>;
          };
          blocks.push(this.convertToolResultToAnthropicBlock(resultContent));
          break;
        }

        case ContentType.TOOL_USE: {
          const toolContent = c as { id: string; name: string; arguments: string };
          const parsedInput = this.parseToolArguments(toolContent.name, toolContent.arguments);
          blocks.push({
            type: 'tool_use',
            id: toolContent.id,
            name: toolContent.name,
            input: parsedInput as Record<string, unknown>,
          });
          break;
        }

        case ContentType.THINKING: {
          // Round-trip thinking blocks back to Anthropic format.
          // Only include blocks that have a valid signature — Anthropic requires it.
          // Streaming-path thinking blocks lack signatures and cannot be round-tripped;
          // non-streaming responses (via convertResponse) always carry signatures.
          const thinkingContent = c as { thinking: string; signature?: string };
          if (thinkingContent.signature) {
            blocks.push({
              type: 'thinking',
              thinking: thinkingContent.thinking,
              signature: thinkingContent.signature,
            } as any);
          }
          break;
        }
      }
    }

    // If only one text block, return as string
    if (blocks.length === 1 && blocks[0]?.type === 'text') {
      return (blocks[0] as Anthropic.TextBlockParam).text;
    }

    return blocks;
  }

  /**
   * Convert image URL to Anthropic image block
   */
  private convertImageToAnthropicBlock(url: string): Anthropic.ImageBlockParam | null {
    const parsed = this.parseDataUri(url);

    if (parsed) {
      // Base64 data URI
      return {
        type: 'image',
        source: {
          type: 'base64',
          media_type: parsed.mediaType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
          data: parsed.data,
        },
      };
    } else {
      // URL (Claude 3.5+ supports this)
      return {
        type: 'image',
        source: {
          type: 'url',
          url,
        },
      };
    }
  }

  /**
   * Convert tool result to Anthropic block
   * Anthropic requires non-empty content when is_error is true
   * Supports __images convention: tool results with __images get multimodal content
   */
  private convertToolResultToAnthropicBlock(resultContent: {
    tool_use_id: string;
    content: string | unknown;
    error?: string;
    __images?: Array<{ base64: string; mediaType: string }>;
  }): Anthropic.ToolResultBlockParam {
    const isError = !!resultContent.error;
    let toolResultContent: string;

    if (typeof resultContent.content === 'string') {
      // For error cases with empty content, use the error message
      toolResultContent = resultContent.content || (isError ? resultContent.error! : '');
    } else {
      toolResultContent = JSON.stringify(resultContent.content);
    }

    // Anthropic API rejects empty content when is_error is true
    if (isError && !toolResultContent) {
      toolResultContent = resultContent.error || 'Tool execution failed';
    }

    // Read images from Content object first (set by addToolResults),
    // fall back to JSON extraction for backward compat
    const images = resultContent.__images?.length
      ? resultContent.__images
      : this.extractImages(toolResultContent);

    if (images) {
      // Strip __images and base64 from text to save tokens (needed for JSON fallback path)
      const textContent = resultContent.__images?.length
        ? toolResultContent  // Already stripped at context layer
        : this.stripImagesFromContent(toolResultContent);
      const contentBlocks: Array<Anthropic.TextBlockParam | Anthropic.ImageBlockParam> = [];

      if (textContent.trim()) {
        contentBlocks.push({ type: 'text', text: textContent });
      }

      for (const img of images) {
        contentBlocks.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: (img.mediaType || 'image/png') as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp',
            data: img.base64,
          },
        });
      }

      return {
        type: 'tool_result',
        tool_use_id: resultContent.tool_use_id,
        content: contentBlocks.length > 0 ? contentBlocks : textContent,
        is_error: isError,
      };
    }

    return {
      type: 'tool_result',
      tool_use_id: resultContent.tool_use_id,
      content: toolResultContent,
      is_error: isError,
    };
  }

  /**
   * Extract __images from a JSON-stringified tool result content.
   * Returns null if no images found.
   */
  private extractImages(content: string): Array<{ base64: string; mediaType: string }> | null {
    try {
      const parsed = JSON.parse(content);
      if (parsed && Array.isArray(parsed.__images) && parsed.__images.length > 0) {
        return parsed.__images;
      }
    } catch {
      // Not JSON or no __images
    }
    return null;
  }

  /**
   * Strip __images and base64 fields from JSON content to reduce token usage in text.
   */
  private stripImagesFromContent(content: string): string {
    try {
      const parsed = JSON.parse(content);
      const { __images: _, base64: __, ...rest } = parsed;
      return JSON.stringify(rest);
    } catch {
      return content;
    }
  }

  /**
   * Convert our Tool[] -> Anthropic tools
   * Uses shared conversion utilities (DRY)
   */
  private convertAnthropicTools(tools?: Tool[]): Anthropic.Tool[] | undefined {
    if (!tools || tools.length === 0) {
      return undefined;
    }

    const standardTools = convertToolsToStandardFormat(tools);
    return standardTools.map((tool) => this.transformTool(tool));
  }
}
