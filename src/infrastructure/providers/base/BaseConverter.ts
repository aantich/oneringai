/**
 * Base Converter - Abstract base class for provider-specific message conversion
 *
 * DRY principle: Provides common patterns for all provider converters:
 * - Input normalization (string | InputItem[] → provider format)
 * - Content type conversion (ContentType → provider content blocks)
 * - Tool schema conversion (Tool[] → provider tool format)
 * - Response extraction (provider response → LLMResponse)
 * - Error mapping (provider error → standard error)
 * - Resource cleanup lifecycle
 *
 * Provider-specific converters extend this and implement abstract methods.
 */

import { TextGenerateOptions } from '../../../domain/interfaces/ITextProvider.js';
import { LLMResponse } from '../../../domain/entities/Response.js';
import { InputItem, MessageRole } from '../../../domain/entities/Message.js';
import { Content, ContentType } from '../../../domain/entities/Content.js';
import { Tool } from '../../../domain/entities/Tool.js';
import { InvalidConfigError, InvalidToolArgumentsError } from '../../../domain/errors/AIErrors.js';
import {
  buildLLMResponse,
  createTextContent,
  createToolUseContent,
  ResponseStatus,
  UsageStats,
} from '../shared/ResponseBuilder.js';
import { convertToolsToStandardFormat, ProviderToolFormat } from '../shared/ToolConversionUtils.js';

/**
 * Image data parsed from a data URI
 */
export interface ParsedImageData {
  mediaType: string;
  data: string;
  format: string;
}

/**
 * Provider-specific request format (abstract, defined by subclass)
 * Using Record<string, unknown> would be too restrictive -
 * providers have their own typed request formats
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ProviderRequest {}

/**
 * Provider-specific response format (abstract, defined by subclass)
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ProviderResponse {}

/**
 * Abstract base converter for all LLM providers.
 *
 * Subclasses implement provider-specific conversion logic while inheriting
 * common patterns for input normalization, tool conversion, and response building.
 *
 * @template TRequest - Provider-specific request type
 * @template TResponse - Provider-specific response type
 */
export abstract class BaseConverter<
  TRequest extends ProviderRequest = ProviderRequest,
  TResponse extends ProviderResponse = ProviderResponse,
> {
  // ==========================================================================
  // Abstract Methods (must be implemented by subclasses)
  // ==========================================================================

  /**
   * Get the provider name (used for error messages and IDs)
   */
  abstract readonly providerName: string;

  /**
   * Convert our TextGenerateOptions to provider-specific request format
   */
  abstract convertRequest(options: TextGenerateOptions): TRequest | Promise<TRequest>;

  /**
   * Convert provider response to our LLMResponse format
   */
  abstract convertResponse(response: TResponse): LLMResponse;

  /**
   * Transform a standardized tool to provider-specific format
   */
  protected abstract transformTool(tool: ProviderToolFormat): unknown;

  /**
   * Convert provider-specific content blocks to our Content[]
   */
  protected abstract convertProviderContent(blocks: unknown[]): Content[];

  /**
   * Map provider status to our ResponseStatus
   */
  protected abstract mapProviderStatus(status: unknown): ResponseStatus;

  // ==========================================================================
  // Protected Helper Methods (shared by all providers)
  // ==========================================================================

  /**
   * Convert InputItem array to provider messages
   * @param input - String or InputItem array
   * @returns Normalized input ready for provider conversion
   */
  protected normalizeInput(input: string | InputItem[]): InputItem[] {
    if (typeof input === 'string') {
      return [
        {
          type: 'message',
          role: MessageRole.USER,
          content: [{ type: ContentType.INPUT_TEXT, text: input }],
        },
      ];
    }
    return input;
  }

  /**
   * Map our role to provider-specific role
   * Override in subclass if provider uses different role names
   */
  protected mapRole(role: MessageRole): string {
    // A missing native developer role must never silently downgrade authority.
    // Extract instruction messages into the provider's dedicated field first.
    if (role === MessageRole.DEVELOPER) {
      throw new InvalidConfigError('Extract developer instructions before converting conversation roles');
    }
    return role;
  }

  /**
   * Convert our Tool[] to provider-specific tool format
   */
  protected convertTools(tools?: Tool[]): unknown[] | undefined {
    if (!tools || tools.length === 0) {
      return undefined;
    }

    const standardTools = convertToolsToStandardFormat(tools);
    return standardTools.map((tool) => this.transformTool(tool));
  }

  /**
   * Parse tool arguments from JSON string
   * Throws InvalidToolArgumentsError on parse failure
   */
  protected parseToolArguments(name: string, argsString: string): unknown {
    try {
      return JSON.parse(argsString);
    } catch (parseError) {
      throw new InvalidToolArgumentsError(
        name,
        argsString,
        parseError instanceof Error ? parseError : new Error(String(parseError))
      );
    }
  }

  /**
   * Parse a data URI into components
   * @returns Parsed image data or null if not a data URI
   */
  protected parseDataUri(url: string): ParsedImageData | null {
    const matches = url.match(/^data:image\/(\w+);base64,(.+)$/);
    if (!matches || matches.length < 3) {
      return null;
    }

    const format = matches[1]!;
    const data = matches[2]!;

    return {
      format,
      mediaType: `image/${format}`,
      data,
    };
  }

  /**
   * Check if URL is a data URI
   */
  protected isDataUri(url: string): boolean {
    return url.startsWith('data:');
  }

  /**
   * Build standardized LLMResponse using shared utility
   */
  protected buildResponse(options: {
    rawId?: string;
    model: string;
    status: ResponseStatus;
    content: Content[];
    usage: UsageStats;
    messageId?: string;
  }): LLMResponse {
    return buildLLMResponse({
      provider: this.providerName,
      ...options,
    });
  }

  /**
   * Create a text content block
   */
  protected createText(text: string): Content {
    return createTextContent(text);
  }

  /**
   * Create a tool_use content block
   */
  protected createToolUse(id: string, name: string, args: string | Record<string, unknown>): Content {
    return createToolUseContent(id, name, args);
  }

  /**
   * Extract text from Content array
   */
  protected extractText(content: Content[]): string {
    return content
      .filter((c) => c.type === ContentType.OUTPUT_TEXT)
      .map((c) => (c as { text: string }).text)
      .join('\n');
  }

  /**
   * Handle content conversion for common content types
   * Can be used as a starting point in subclass convertContent methods
   */
  protected handleCommonContent(
    content: Content,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _handlers: {
      onText?: (text: string) => void;
      onImage?: (url: string, parsed: ParsedImageData | null) => void;
      onToolUse?: (id: string, name: string, args: unknown) => void;
      onToolResult?: (
        toolUseId: string,
        result: string | unknown,
        isError: boolean,
        errorMessage?: string
      ) => void;
    }
  ): boolean {
    const handlers = _handlers;

    switch (content.type) {
      case ContentType.INPUT_TEXT:
      case ContentType.OUTPUT_TEXT:
        handlers.onText?.((content as { text: string }).text);
        return true;

      case ContentType.INPUT_IMAGE_URL: {
        const imgContent = content as { image_url: { url: string } };
        const parsed = this.parseDataUri(imgContent.image_url.url);
        handlers.onImage?.(imgContent.image_url.url, parsed);
        return true;
      }

      case ContentType.TOOL_USE: {
        const toolContent = content as { id: string; name: string; arguments: string };
        const parsedArgs = this.parseToolArguments(toolContent.name, toolContent.arguments);
        handlers.onToolUse?.(toolContent.id, toolContent.name, parsedArgs);
        return true;
      }

      case ContentType.TOOL_RESULT: {
        const resultContent = content as {
          tool_use_id: string;
          content: string | unknown;
          error?: string;
        };
        const isError = !!resultContent.error;
        handlers.onToolResult?.(
          resultContent.tool_use_id,
          resultContent.content,
          isError,
          resultContent.error
        );
        return true;
      }

      default:
        return false;
    }
  }

  // ==========================================================================
  // Resource Cleanup (required lifecycle method)
  // ==========================================================================

  /**
   * Clean up any internal state/caches
   * Should be called after each request/response cycle to prevent memory leaks
   *
   * Default implementation does nothing - override if subclass maintains state
   */
  clear(): void {
    // Default: no state to clear
    // Subclasses override if they maintain Maps, caches, etc.
  }

  /**
   * Alias for clear() - reset converter state
   */
  reset(): void {
    this.clear();
  }
}

/**
 * Type guard for checking if converter has async request conversion
 */
export function hasAsyncConvert(
  _converter: BaseConverter
): _converter is BaseConverter & { convertRequest: (options: TextGenerateOptions) => Promise<ProviderRequest> } {
  // All converters may be async (convertRequest can return Promise)
  return true;
}
