/**
 * Google Gemini text provider (using new unified SDK)
 */

import { GoogleGenAI } from '@google/genai';
import { BaseTextProvider } from '../base/BaseTextProvider.js';
import { TextGenerateOptions, ModelCapabilities } from '../../../domain/interfaces/ITextProvider.js';
import { LLMResponse } from '../../../domain/entities/Response.js';
import { ProviderCapabilities } from '../../../domain/interfaces/IProvider.js';
import { GoogleConfig } from '../../../domain/types/ProviderConfig.js';
import {
  ProviderAuthError,
  ProviderRateLimitError,
  ProviderContextLengthError,
} from '../../../domain/errors/AIErrors.js';
import { GoogleConverter } from './GoogleConverter.js';
import { GoogleStreamConverter } from './GoogleStreamConverter.js';
import { StreamEvent } from '../../../domain/entities/StreamEvent.js';
import { resolveModelCapabilities, resolveMaxContextTokens } from '../base/ModelCapabilityResolver.js';

export class GoogleTextProvider extends BaseTextProvider {
  readonly name = 'google';
  readonly capabilities: ProviderCapabilities = {
    text: true,
    images: true, // Gemini supports vision
    videos: false,
    audio: false,
  };

  private client: GoogleGenAI;
  private converter: GoogleConverter;
  private streamConverter: GoogleStreamConverter;

  constructor(config: GoogleConfig) {
    super(config);

    // New SDK uses object config
    this.client = new GoogleGenAI({
      apiKey: this.getApiKey(),
      // Pass custom baseURL for proxy support (e.g. when routing through EW proxy)
      ...(config.baseURL ? { httpOptions: { baseUrl: config.baseURL } } : {}),
    });
    this.converter = new GoogleConverter();
    this.streamConverter = new GoogleStreamConverter();

    // Share storage between converters for multi-turn conversations
    // This allows streaming responses to store signatures and mappings that the
    // regular converter can use when preparing the next request
    this.streamConverter.setThoughtSignatureStorage(this.converter.getThoughtSignatureStorage());
    this.streamConverter.setToolCallMappingStorage(this.converter.getToolCallMappingStorage());
  }

  /**
   * Generate response using Google Gemini API
   */
  async generate(options: TextGenerateOptions): Promise<LLMResponse> {
    return this.executeWithCircuitBreaker(async () => {
      try {
        // Convert our format → Google format
        const googleRequest = await this.converter.convertRequest(options);

        // Debug logging
        if (process.env.DEBUG_GOOGLE) {
          console.error('[DEBUG] Google Request:', JSON.stringify({
            model: options.model,
            tools: googleRequest.tools,
            toolConfig: googleRequest.toolConfig,
            generationConfig: googleRequest.generationConfig,
            contents: googleRequest.contents?.slice(0, 1), // First message only
          }, null, 2));
        }

        this.logger.debug(
          { model: options.model, contentCount: googleRequest.contents?.length ?? 0, toolCount: googleRequest.tools?.[0]?.functionDeclarations?.length ?? 0 },
          'generate: calling Google API',
        );
        const genStartTime = Date.now();

        // Call Google API using new SDK structure
        // Note: contents goes at top level, generation config properties go directly in config
        const result = await this.client.models.generateContent({
          model: options.model,
          contents: googleRequest.contents,
          config: {
            systemInstruction: googleRequest.systemInstruction,
            tools: googleRequest.tools,
            toolConfig: googleRequest.toolConfig,
            ...googleRequest.generationConfig,
          },
        });
        this.logger.debug(
          { model: options.model, duration: Date.now() - genStartTime },
          'generate: response received',
        );

        // Debug logging for response
        if (process.env.DEBUG_GOOGLE) {
          console.error('[DEBUG] Google Response:', JSON.stringify({
            candidates: result.candidates?.map((c: any) => ({
              finishReason: c.finishReason,
              content: c.content,
            })),
            usageMetadata: result.usageMetadata,
          }, null, 2));
        }

        // Convert Google response → our format
        const response = this.converter.convertResponse(result);

        // Only clear mappings when conversation is complete (no pending tool calls)
        // For Gemini 3+, thought signatures must persist across tool execution rounds
        const firstOutput = response.output?.[0];
        const outputContent = firstOutput && 'content' in firstOutput ? firstOutput.content : [];
        const hasToolCalls = this.converter.hasToolCalls(outputContent);
        if (!hasToolCalls) {
          this.converter.clearMappings();
        }

        return response;
      } catch (error: any) {
        this.logger.error({ model: options.model, error: error.message || error }, 'generate error');
        // Clear mappings on error to prevent stale state
        this.converter.clearMappings();
        this.handleError(error, options.model);
        throw error; // TypeScript needs this
      }
    }, options.model);
  }

  /**
   * Stream response using Google Gemini API
   */
  async *streamGenerate(options: TextGenerateOptions): AsyncIterableIterator<StreamEvent> {
    try {
      // Convert our format → Google format
      const googleRequest = await this.converter.convertRequest(options);

      // Create stream using new SDK
      // Note: contents goes at top level, generation config properties go directly in config
      this.logger.debug(
        { model: options.model, contentCount: googleRequest.contents?.length ?? 0, toolCount: googleRequest.tools?.[0]?.functionDeclarations?.length ?? 0 },
        'streamGenerate: calling Google API',
      );
      const streamStartTime = Date.now();
      const stream = await this.client.models.generateContentStream({
        model: options.model,
        contents: googleRequest.contents,
        config: {
          systemInstruction: googleRequest.systemInstruction,
          tools: googleRequest.tools,
          toolConfig: googleRequest.toolConfig,
          ...googleRequest.generationConfig,
        },
      });
      this.logger.debug(
        { model: options.model, duration: Date.now() - streamStartTime },
        'streamGenerate: Google stream opened',
      );

      // Reset stream converter for reuse
      this.streamConverter.reset();

      // Convert Google stream → our StreamEvent format
      let chunkCount = 0;
      for await (const event of this.streamConverter.convertStream(stream, options.model)) {
        chunkCount++;
        yield event;
      }
      this.logger.debug(
        { events: chunkCount, duration: Date.now() - streamStartTime },
        'streamGenerate: stream complete',
      );

      // Only clear mappings when conversation is complete (no pending tool calls)
      // For Gemini 3+, thought signatures must persist across tool execution rounds
      if (!this.streamConverter.hasToolCalls()) {
        this.converter.clearMappings();
        this.streamConverter.clear();
      }
    } catch (error: any) {
      // Clear converters on error to prevent stale state
      this.logger.error(
        { model: options.model, error: error.message || error },
        'streamGenerate error',
      );
      this.converter.clearMappings();
      this.streamConverter.clear();
      this.handleError(error, options.model);
      throw error;
    }
  }

  /**
   * Get model capabilities (registry-driven with Google vendor defaults)
   */
  getModelCapabilities(model: string): ModelCapabilities {
    return resolveModelCapabilities(model, {
      supportsTools: true,
      supportsVision: true,
      supportsJSON: true,
      supportsJSONSchema: false,
      maxTokens: 1048576,
      maxInputTokens: 1048576,
      maxOutputTokens: 65536,
    });
  }

  /**
   * List available models from the Google Gemini API
   */
  async listModels(): Promise<string[]> {
    const models: string[] = [];
    const pager = await this.client.models.list();
    for await (const model of pager) {
      // Google model names are like "models/gemini-2.0-flash" — strip the prefix
      const name = model.name?.replace(/^models\//, '') ?? '';
      if (name) models.push(name);
    }
    return models.sort();
  }

  /**
   * Handle Google-specific errors
   */
  private handleError(error: any, model?: string): never {
    const errorMessage = error.message || '';

    if (error.status === 401 || errorMessage.includes('API key not valid')) {
      throw new ProviderAuthError('google', 'Invalid API key');
    }

    if (error.status === 429 || errorMessage.includes('Resource exhausted')) {
      throw new ProviderRateLimitError('google');
    }

    if (errorMessage.includes('context length') || errorMessage.includes('too long')) {
      throw new ProviderContextLengthError('google', resolveMaxContextTokens(model, 1048576));
    }

    // Re-throw other errors
    throw error;
  }
}
