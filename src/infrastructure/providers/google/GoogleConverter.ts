/**
 * Google Gemini converter - Converts between our Responses API format and Google Gemini API
 * Works with both @google/genai SDK (for Gemini API and Vertex AI)
 */

// Import types - the new SDK may have different type names
import type {
  Content as GeminiContent,
  Part,
  FunctionDeclaration,
} from '@google/genai';
import { TextGenerateOptions } from '../../../domain/interfaces/ITextProvider.js';
import { LLMResponse } from '../../../domain/entities/Response.js';
import { InputItem, MessageRole } from '../../../domain/entities/Message.js';
import { convertToolsToStandardFormat } from '../shared/ToolConversionUtils.js';
import { validateThinkingConfig } from '../shared/validateThinkingConfig.js';
import { Content, ContentType, ToolUseContent } from '../../../domain/entities/Content.js';
import { Tool } from '../../../domain/entities/Tool.js';
import { fetchImageAsBase64 } from '../../../utils/imageUtils.js';
import { InvalidToolArgumentsError } from '../../../domain/errors/AIErrors.js';
import {
  buildLLMResponse,
  createTextContent,
  createToolUseContent,
  mapGoogleStatus,
  generateToolCallId,
} from '../shared/ResponseBuilder.js';

export class GoogleConverter {
  // Track tool call ID → tool name mapping for tool results
  private toolCallMapping: Map<string, string> = new Map();
  // Track tool call ID → thought signature for Gemini 3+
  // NOTE: This map is shared with GoogleStreamConverter for streaming responses
  private thoughtSignatures: Map<string, string> = new Map();

  /**
   * Get the thought signatures storage map
   * Used by GoogleStreamConverter to store signatures from streaming responses
   */
  getThoughtSignatureStorage(): Map<string, string> {
    return this.thoughtSignatures;
  }

  /**
   * Get the tool call mapping storage
   * Used by GoogleStreamConverter to store tool name mappings from streaming responses
   */
  getToolCallMappingStorage(): Map<string, string> {
    return this.toolCallMapping;
  }

  /**
   * Convert our format → Google Gemini format
   */
  async convertRequest(options: TextGenerateOptions): Promise<any> {
    // Debug input messages
    if (process.env.DEBUG_GOOGLE && Array.isArray(options.input)) {
      console.error('[DEBUG] Input messages:', JSON.stringify(options.input.map((msg: any) => ({
        type: msg.type,
        role: msg.role,
        contentTypes: msg.content?.map((c: any) => c.type),
      })), null, 2));
    }

    const contents = await this.convertMessages(options.input);
    const tools = this.convertTools(options.tools);

    // Debug: Check final contents
    if (process.env.DEBUG_GOOGLE) {
      console.error('[DEBUG] Final contents array length:', contents.length);
    }

    const request: any = {
      contents,
    };

    // Add system instruction if provided
    if (options.instructions) {
      request.systemInstruction = { parts: [{ text: options.instructions }] };
    }

    // Add tools if provided
    if (tools && tools.length > 0) {
      request.tools = [{ functionDeclarations: tools }];

      // Add tool config to encourage tool use
      request.toolConfig = {
        functionCallingConfig: {
          mode: options.tool_choice === 'required' ? 'ANY' : 'AUTO',
        },
      };
    }

    // Add generation config
    request.generationConfig = {
      temperature: options.temperature,
      maxOutputTokens: options.max_output_tokens,
    };

    // Add thinking config for Gemini 3+ reasoning models
    if (options.vendorOptions?.thinkingLevel) {
      request.generationConfig.thinkingConfig = {
        thinkingLevel: options.vendorOptions.thinkingLevel,
      };
    } else if (options.thinking?.enabled) {
      validateThinkingConfig(options.thinking);
      // Unified thinking API: set thinkingBudget from thinking.budgetTokens
      request.generationConfig.thinkingConfig = {
        thinkingBudget: options.thinking.budgetTokens || 8192,
      };
    }

    // Disable Google's code execution if we have function tools
    // (prevents model from generating code instead of calling tools)
    if (tools && tools.length > 0) {
      request.generationConfig.allowCodeExecution = false;
    }

    // Handle JSON output
    if (options.response_format) {
      if (options.response_format.type === 'json_object') {
        request.generationConfig.responseMimeType = 'application/json';
      } else if (options.response_format.type === 'json_schema') {
        request.generationConfig.responseMimeType = 'application/json';
        // Google doesn't support full JSON schema - would need to add to system instruction
      }
    }

    return request;
  }

  /**
   * Convert our InputItem[] → Google contents
   */
  private async convertMessages(input: string | InputItem[]): Promise<GeminiContent[]> {
    if (typeof input === 'string') {
      return [
        {
          role: 'user',
          parts: [{ text: input }],
        },
      ];
    }

    const contents: GeminiContent[] = [];

    for (const item of input) {
      if (item.type === 'message') {
        // Map roles
        const role = item.role === MessageRole.USER || item.role === MessageRole.DEVELOPER ? 'user' : 'model';

        // Convert content to parts
        const parts = await this.convertContentToParts(item.content);

        // Debug logging
        if (process.env.DEBUG_GOOGLE) {
          console.error(`[DEBUG] Converting message - role: ${item.role} → ${role}, parts: ${parts.length}`,
            parts.map((p: any) => Object.keys(p)));
        }

        if (parts.length > 0) {
          contents.push({
            role,
            parts,
          });
        }
      }
    }

    return contents;
  }

  /**
   * Convert our Content[] → Google parts
   */
  private async convertContentToParts(content: Content[]): Promise<Part[]> {
    const parts: Part[] = [];

    for (const c of content) {
      switch (c.type) {
        case ContentType.INPUT_TEXT:
        case ContentType.OUTPUT_TEXT:
          parts.push({ text: c.text });
          break;

        case ContentType.INPUT_IMAGE_URL:
          // Google requires inline data (base64), not URLs
          try {
            const imageData = await fetchImageAsBase64(c.image_url.url);
            parts.push({
              inlineData: {
                mimeType: imageData.mimeType,
                data: imageData.base64Data,
              },
            });
          } catch (error: any) {
            // If image fetch fails, skip it and add error as text
            console.error(`Failed to fetch image: ${error.message}`);
            parts.push({
              text: `[Error: Could not load image from ${c.image_url.url}]`,
            });
          }
          break;

        case ContentType.TOOL_USE:
          // Store tool call ID → name mapping for later use
          this.toolCallMapping.set(c.id, c.name);

          // Safe JSON parse with error handling
          let parsedArgs: unknown;
          try {
            parsedArgs = JSON.parse(c.arguments);
          } catch (parseError) {
            throw new InvalidToolArgumentsError(
              c.name,
              c.arguments,
              parseError instanceof Error ? parseError : new Error(String(parseError))
            );
          }

          // Google uses functionCall
          const functionCallPart: any = {
            functionCall: {
              name: c.name,
              args: parsedArgs,
            },
          };

          // Add thought signature (required for Gemini 3+)
          // Priority: Content object (survives serialization) > in-memory Map > bypass fallback
          const signature = (c as ToolUseContent).thoughtSignature
            || this.thoughtSignatures.get(c.id)
            || 'context_engineering_is_the_way_to_go';

          if (process.env.DEBUG_GOOGLE) {
            console.error(`[DEBUG] Looking up signature for tool ID: ${c.id}`);
            console.error(`[DEBUG] Source:`, (c as ToolUseContent).thoughtSignature ? 'Content' : this.thoughtSignatures.has(c.id) ? 'Map' : 'bypass');
          }

          functionCallPart.thoughtSignature = signature;

          parts.push(functionCallPart);
          break;

        case ContentType.TOOL_RESULT: {
          // Google uses functionResponse - look up the actual function name
          const functionName = this.toolCallMapping.get(c.tool_use_id) || this.extractToolName(c.tool_use_id);

          // Read images from Content object first (set by addToolResults),
          // fall back to JSON extraction for backward compat
          const contentImages = (c as any).__images as Array<{ base64: string; mediaType: string }> | undefined;
          let resultText: string;
          let resultImages: Array<{ base64: string; mediaType: string }>;

          if (contentImages?.length) {
            // Images already extracted at context layer
            resultText = typeof c.content === 'string' ? c.content : JSON.stringify(c.content);
            resultImages = contentImages;
          } else {
            // Fallback: try extracting from raw JSON
            const resultStr = typeof c.content === 'string' ? c.content : JSON.stringify(c.content);
            const extracted = this.extractImagesFromResult(resultStr);
            resultText = extracted.text;
            resultImages = extracted.images;
          }

          parts.push({
            functionResponse: {
              name: functionName,
              response: {
                result: resultText,
              },
            },
          });

          // Add images as inline data parts after the function response
          for (const img of resultImages) {
            parts.push({
              inlineData: {
                mimeType: img.mediaType || 'image/png',
                data: img.base64,
              },
            } as any);
          }
          break;
        }
      }
    }

    return parts;
  }

  /**
   * Convert our Tool[] → Google function declarations
   */
  private convertTools(tools?: Tool[]): FunctionDeclaration[] | undefined {
    if (!tools || tools.length === 0) {
      return undefined;
    }

    // Use shared conversion utilities (DRY)
    const standardTools = convertToolsToStandardFormat(tools);
    return standardTools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: this.convertParametersSchema(tool.parameters),
    }));
  }

  /**
   * Convert JSON Schema parameters to Google's format
   */
  private convertParametersSchema(schema: any): any {
    if (!schema) return undefined;

    const converted: any = {
      type: 'OBJECT', // Google uses uppercase 'OBJECT'
      properties: {},
    };

    // Convert property types to uppercase
    if (schema.properties) {
      for (const [key, value] of Object.entries(schema.properties)) {
        const prop = value as any;
        converted.properties[key] = {
          type: prop.type?.toUpperCase() || 'STRING',
          description: prop.description,
        };

        // Handle enums
        if (prop.enum) {
          converted.properties[key].enum = prop.enum;
        }

        // Handle nested objects/arrays
        if (prop.type === 'object' && prop.properties) {
          converted.properties[key] = this.convertParametersSchema(prop);
        }
        if (prop.type === 'array' && prop.items) {
          converted.properties[key].items = this.convertParametersSchema(prop.items);
        }
      }
    }

    // Add required fields
    if (schema.required) {
      converted.required = schema.required;
    }

    return converted;
  }

  /**
   * Convert Google response → our LLMResponse format
   */
  convertResponse(response: any): LLMResponse {
    const candidate = response.candidates?.[0];
    const geminiContent = candidate?.content;

    // Convert Google parts to our content
    const content = this.convertGeminiPartsToContent(geminiContent?.parts || []);

    // Debug output
    if (process.env.DEBUG_GOOGLE) {
      console.error('[DEBUG] Content array:', JSON.stringify(content, null, 2));
      console.error('[DEBUG] Raw parts:', JSON.stringify(geminiContent?.parts, null, 2));
    }

    return buildLLMResponse({
      provider: 'google',
      model: response.modelVersion || 'gemini',
      status: mapGoogleStatus(candidate?.finishReason),
      content,
      messageId: response.id,
      usage: {
        inputTokens: response.usageMetadata?.promptTokenCount || 0,
        outputTokens: response.usageMetadata?.candidatesTokenCount || 0,
        totalTokens: response.usageMetadata?.totalTokenCount || 0,
      },
    });
  }

  /**
   * Convert Google parts → our Content[]
   */
  private convertGeminiPartsToContent(parts: Part[]): Content[] {
    const content: Content[] = [];

    for (const part of parts) {
      // Check for thought/thinking parts (Gemini 3+ with thinking enabled)
      if ('thought' in part && (part as any).thought === true && 'text' in part && part.text) {
        content.push({
          type: ContentType.THINKING,
          thinking: part.text,
          persistInHistory: false,
        });
      } else if ('text' in part && part.text) {
        content.push(createTextContent(part.text));
      } else if ('functionCall' in part && part.functionCall) {
        const toolId = generateToolCallId('google');
        const functionName = part.functionCall.name || '';

        // Capture thought signature (required for Gemini 3+)
        let sig: string | undefined;
        if ('thoughtSignature' in part && part.thoughtSignature) {
          sig = part.thoughtSignature as string;
          this.thoughtSignatures.set(toolId, sig);

          if (process.env.DEBUG_GOOGLE) {
            console.error(`[DEBUG] Captured thought signature for tool ID: ${toolId}`);
            console.error(`[DEBUG] Signature length:`, sig.length);
          }
        } else if (process.env.DEBUG_GOOGLE) {
          console.error(`[DEBUG] NO thought signature in part for ${functionName}`);
          console.error(`[DEBUG] Part keys:`, Object.keys(part));
        }

        // Persist signature on Content object so it survives serialization
        content.push(createToolUseContent(toolId, functionName, part.functionCall.args || {}, sig));
      }
    }

    return content;
  }

  /**
   * Extract tool name from tool_use_id using tracked mapping
   */
  private extractToolName(toolUseId: string): string {
    const name = this.toolCallMapping.get(toolUseId);
    if (name) {
      return name;
    }
    // Fallback - log warning and return placeholder
    console.warn(`[GoogleConverter] Tool name not found for ID: ${toolUseId}`);
    return 'unknown_tool';
  }

  /**
   * Check if content array has tool calls requiring follow-up
   * Used to determine when to clear thought signatures (must persist across tool execution)
   */
  hasToolCalls(content: Content[]): boolean {
    return content.some(c => c.type === ContentType.TOOL_USE);
  }

  /**
   * Clear all internal mappings
   * Should be called after each request/response cycle to prevent memory leaks
   */
  clearMappings(): void {
    this.toolCallMapping.clear();
    this.thoughtSignatures.clear();
  }

  /**
   * Reset converter state for a new request
   * Alias for clearMappings()
   */
  reset(): void {
    this.clearMappings();
  }

  /**
   * Extract __images from a JSON tool result and return cleaned text + images.
   * Used by the __images convention for multimodal tool results.
   */
  private extractImagesFromResult(content: string): {
    text: string;
    images: Array<{ base64: string; mediaType: string }>;
  } {
    try {
      const parsed = JSON.parse(content);
      if (parsed && Array.isArray(parsed.__images) && parsed.__images.length > 0) {
        const images = parsed.__images;
        const { __images: _, base64: __, ...rest } = parsed;
        return { text: JSON.stringify(rest), images };
      }
    } catch {
      // Not JSON or no __images
    }
    return { text: content, images: [] };
  }
}
