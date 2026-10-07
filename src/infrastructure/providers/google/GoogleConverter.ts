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
import { TextGenerateOptions, type ReasoningEffort } from '../../../domain/interfaces/ITextProvider.js';
import { LLMResponse } from '../../../domain/entities/Response.js';
import { InputItem, MessageRole } from '../../../domain/entities/Message.js';
import { getModelInfo } from '../../../domain/entities/Model.js';
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
      const namedToolChoice = typeof options.tool_choice === 'object'
        ? options.tool_choice.function.name
        : undefined;
      request.toolConfig = {
        functionCallingConfig: {
          mode: options.tool_choice === 'required' || namedToolChoice ? 'ANY' : 'AUTO',
          ...(namedToolChoice && { allowedFunctionNames: [namedToolChoice] }),
        },
      };
    }

    const nativeTools = this.convertNativeTools(options);
    if (nativeTools.length > 0) {
      request.tools = [...(request.tools ?? []), ...nativeTools];
    }

    // Add generation config — drop temperature for models that don't accept it
    const supportsTemperature =
      getModelInfo(options.model)?.features.parameters?.temperature !== false;
    request.generationConfig = {
      ...((options.vendorOptions?.generationConfig as Record<string, unknown> | undefined) ?? {}),
      ...(options.temperature !== undefined && supportsTemperature && {
        temperature: options.temperature,
      }),
      maxOutputTokens: options.max_output_tokens,
    };
    const serviceTier = options.vendorOptions?.serviceTier ?? options.vendorOptions?.service_tier;
    if (serviceTier !== undefined) request.generationConfig.serviceTier = serviceTier;

    // Gemini 3 uses thinking levels; Gemini 2.x retains token budgets.
    if (/^gemini-3(?:\.|-|$)/.test(options.model) && options.thinking?.enabled) {
      validateThinkingConfig(options.thinking);
      request.generationConfig.thinkingConfig = {
        thinkingLevel: this.resolveThinkingLevel(
          (options.vendorOptions?.thinkingLevel as ReasoningEffort | undefined)
            ?? options.thinking.effort,
          options.thinking.budgetTokens,
        ),
      };
    } else if (options.vendorOptions?.thinkingLevel) {
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

    // Handle JSON output. Gemini's `responseJsonSchema` accepts a standard JSON
    // Schema (superset of the older OpenAPI-subset `responseSchema`), so we pass
    // the caller's schema straight through for schema-constrained output.
    if (options.response_format) {
      if (options.response_format.type === 'json_object') {
        request.generationConfig.responseMimeType = 'application/json';
      } else if (options.response_format.type === 'json_schema') {
        request.generationConfig.responseMimeType = 'application/json';
        const js = options.response_format.json_schema;
        const schema =
          js && typeof js === 'object' && 'schema' in js ? (js as { schema?: unknown }).schema : js;
        if (schema && typeof schema === 'object') {
          request.generationConfig.responseJsonSchema = schema;
        }
      }
    }

    return request;
  }

  private resolveThinkingLevel(
    effort?: ReasoningEffort,
    budgetTokens?: number,
  ): 'MINIMAL' | 'LOW' | 'MEDIUM' | 'HIGH' {
    if (effort === 'none' || effort === 'minimal') return 'MINIMAL';
    if (effort === 'low') return 'LOW';
    if (effort === 'high' || effort === 'xhigh' || effort === 'max') return 'HIGH';
    if (effort === 'medium') return 'MEDIUM';
    if (budgetTokens !== undefined) {
      if (budgetTokens < 2048) return 'MINIMAL';
      if (budgetTokens < 8192) return 'LOW';
      if (budgetTokens < 24576) return 'MEDIUM';
      return 'HIGH';
    }
    return 'MEDIUM';
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
   * Convert JSON Schema parameters to Google's format.
   *
   * Google Gemini expects uppercase types (STRING, OBJECT, NUMBER, etc.)
   * and supports a subset of JSON Schema. We preserve as much as possible
   * including `additionalProperties`, `nullable`, `format`, and `default`.
   */
  private convertParametersSchema(schema: any): any {
    if (!schema) return undefined;

    const converted: any = {
      type: (schema.type || 'object').toUpperCase(),
      properties: {},
    };

    // Preserve description at schema level
    if (schema.description) {
      converted.description = schema.description;
    }

    // Convert property types to uppercase and recurse into nested schemas
    if (schema.properties) {
      for (const [key, value] of Object.entries(schema.properties)) {
        converted.properties[key] = this.convertPropertySchema(value);
      }
    }

    // Preserve required fields
    if (schema.required) {
      converted.required = schema.required;
    }

    // Preserve additionalProperties — critical for free-form object params
    if (schema.additionalProperties !== undefined) {
      converted.additionalProperties = schema.additionalProperties;
    }

    // Preserve nullable
    if (schema.nullable !== undefined) {
      converted.nullable = schema.nullable;
    }

    return converted;
  }

  /**
   * Convert a single property schema to Google's format (recursive).
   */
  private convertPropertySchema(value: any): any {
    if (!value) return { type: 'STRING' };

    const type = value.type || 'string';

    // Nested objects — recurse
    if (type === 'object') {
      return this.convertParametersSchema(value);
    }

    // Arrays — recurse into items
    if (type === 'array') {
      const arr: any = {
        type: 'ARRAY',
        description: value.description,
      };
      if (value.items) {
        arr.items = this.convertPropertySchema(value.items);
      }
      return arr;
    }

    // Scalar types
    const prop: any = {
      type: type.toUpperCase(),
      description: value.description,
    };

    if (value.enum) {
      prop.enum = value.enum;
    }
    if (value.format) {
      prop.format = value.format;
    }
    if (value.nullable !== undefined) {
      prop.nullable = value.nullable;
    }
    if (value.default !== undefined) {
      prop.default = value.default;
    }

    return prop;
  }

  /**
   * Convert Google response → our LLMResponse format
   */
  convertResponse(response: any): LLMResponse {
    const candidate = response.candidates?.[0];
    const geminiContent = candidate?.content;

    // Convert Google parts to our content
    const content = this.convertGeminiPartsToContent(geminiContent?.parts || []);
    const groundingChunks = candidate?.groundingMetadata?.groundingChunks ?? [];
    const parts = geminiContent?.parts ?? [];
    this.attachGroundingCitations(content, parts, candidate?.groundingMetadata, groundingChunks);
    const codeExecutions = parts.filter((part: any) => part.executableCode).length;
    const urlMetadata = candidate?.urlContextMetadata?.urlMetadata ?? [];
    const webFetchCalls = urlMetadata.length > 0 ? 1 : 0;

    // Debug output
    if (process.env.DEBUG_GOOGLE) {
      console.error('[DEBUG] Content array:', JSON.stringify(content, null, 2));
      console.error('[DEBUG] Raw parts:', JSON.stringify(geminiContent?.parts, null, 2));
    }

    const built = buildLLMResponse({
      provider: 'google',
      model: response.modelVersion || 'gemini',
      status: mapGoogleStatus(candidate?.finishReason),
      content,
      messageId: response.id,
      usage: {
        inputTokens: response.usageMetadata?.promptTokenCount || 0,
        outputTokens: response.usageMetadata?.candidatesTokenCount || 0,
        totalTokens: response.usageMetadata?.totalTokenCount || 0,
        cachedInputTokens: response.usageMetadata?.cachedContentTokenCount ?? undefined,
        reasoningTokens: response.usageMetadata?.thoughtsTokenCount ?? undefined,
        nativeToolCalls:
          candidate?.groundingMetadata?.webSearchQueries?.length ||
          codeExecutions ||
          webFetchCalls
            ? {
                ...(candidate?.groundingMetadata?.webSearchQueries?.length
                  ? { web_search: candidate.groundingMetadata.webSearchQueries.length }
                  : {}),
                ...(codeExecutions ? { code_execution: codeExecutions } : {}),
                ...(webFetchCalls ? { web_fetch: webFetchCalls } : {}),
              }
            : undefined,
      },
    });
    const nativeToolEvents: NonNullable<LLMResponse['native_tool_events']> = [];
    if (candidate?.groundingMetadata?.webSearchQueries?.length) {
      nativeToolEvents.push({ capability: 'web_search', status: 'completed' });
    }
    if (webFetchCalls) {
      const failed = urlMetadata.some(
        (metadata: any) =>
          metadata.urlRetrievalStatus &&
          metadata.urlRetrievalStatus !== 'URL_RETRIEVAL_STATUS_SUCCESS',
      );
      nativeToolEvents.push({
        capability: 'web_fetch',
        status: failed ? 'failed' : 'completed',
        ...(failed
          ? {
              error: {
                message: 'One or more Google URL Context fetches failed',
                details: urlMetadata,
              },
            }
          : {}),
      });
    }
    for (const part of parts as Array<Record<string, unknown>>) {
      if (part.executableCode) {
        nativeToolEvents.push({ capability: 'code_execution', status: 'in_progress' });
      }
      if (part.codeExecutionResult) {
        const result = part.codeExecutionResult as Record<string, unknown>;
        const failed = result.outcome === 'OUTCOME_FAILED';
        nativeToolEvents.push({
          capability: 'code_execution',
          status: failed ? 'failed' : 'completed',
          ...(failed
            ? {
                error: {
                  message: String(result.output ?? 'Google code execution failed'),
                  details: result,
                },
              }
            : {}),
        });
      }
    }
    if (nativeToolEvents.length > 0) built.native_tool_events = nativeToolEvents;
    return built;
  }

  private attachGroundingCitations(
    content: Content[],
    parts: Array<Record<string, unknown>>,
    groundingMetadata: any,
    groundingChunks: any[],
  ): void {
    const supports = groundingMetadata?.groundingSupports ?? [];
    const annotationsByPart = new Map<number, unknown[]>();
    for (const support of supports) {
      const partIndex = support.segment?.partIndex ?? 0;
      const annotations = annotationsByPart.get(partIndex) ?? [];
      for (const chunkIndex of support.groundingChunkIndices ?? []) {
        const web = groundingChunks[chunkIndex]?.web;
        if (!web?.uri) continue;
        annotations.push({
          type: 'url_citation',
          url: web.uri,
          title: web.title,
          start_index: support.segment?.startIndex,
          end_index: support.segment?.endIndex,
        });
      }
      annotationsByPart.set(partIndex, annotations);
    }

    let contentIndex = 0;
    for (let partIndex = 0; partIndex < parts.length; partIndex++) {
      const part = parts[partIndex]!;
      const producesContent =
        (typeof part.text === 'string' && part.text.length > 0) || Boolean(part.functionCall);
      if (!producesContent) continue;
      const item = content[contentIndex++];
      if (item?.type !== ContentType.OUTPUT_TEXT) continue;
      const annotations = annotationsByPart.get(partIndex);
      if (annotations?.length) item.annotations = annotations;
    }

    // Older responses may omit groundingSupports. Preserve the citations, but
    // attach them once rather than claiming every text block used every source.
    if (supports.length === 0) {
      const fallback = groundingChunks
        .map((chunk: any) => chunk.web)
        .filter((web: any) => web?.uri)
        .map((web: any) => ({ type: 'url_citation', url: web.uri, title: web.title }));
      const firstText = content.find((item) => item.type === ContentType.OUTPUT_TEXT);
      if (firstText?.type === ContentType.OUTPUT_TEXT && fallback.length > 0) {
        firstText.annotations = fallback;
      }
    }
  }

  private convertNativeTools(options: TextGenerateOptions): unknown[] {
    return (options.native_tools ?? []).map((tool) => {
      switch (tool.capability) {
        case 'web_search':
          return { googleSearch: tool.options ?? {} };
        case 'web_fetch':
          return { urlContext: tool.options ?? {} };
        case 'code_execution':
          return { codeExecution: tool.options ?? {} };
        case 'file_search': {
          const { vectorStoreIds, ...providerOptions } = tool.options;
          return {
            fileSearch: {
              ...providerOptions,
              fileSearchStoreNames: vectorStoreIds,
            },
          };
        }
        case 'computer_use':
          return { computerUse: tool.options ?? {} };
        default:
          return tool.options ?? {};
      }
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
