/**
 * OpenAI text provider using Responses API
 */

import OpenAI from 'openai';
import { BaseTextProvider } from '../base/BaseTextProvider.js';
import { TextGenerateOptions, ModelCapabilities } from '../../../domain/interfaces/ITextProvider.js';
import { LLMResponse } from '../../../domain/entities/Response.js';
import { ProviderCapabilities } from '../../../domain/interfaces/IProvider.js';
import { OpenAIConfig } from '../../../domain/types/ProviderConfig.js';
import {
  ProviderAuthError,
  ProviderRateLimitError,
  ProviderContextLengthError,
} from '../../../domain/errors/AIErrors.js';
import { StreamEvent } from '../../../domain/entities/StreamEvent.js';
import { OpenAIResponsesConverter } from './OpenAIResponsesConverter.js';
import { OpenAIResponsesStreamConverter } from './OpenAIResponsesStreamConverter.js';
import * as ResponsesAPI from 'openai/resources/responses/responses.js';
import { getModelInfo } from '../../../domain/entities/Model.js';
import { resolveModelCapabilities, resolveMaxContextTokens } from '../base/ModelCapabilityResolver.js';
import { validateThinkingConfig } from '../shared/validateThinkingConfig.js';

export class OpenAITextProvider extends BaseTextProvider {
  readonly name: string = 'openai';
  readonly capabilities: ProviderCapabilities = {
    text: true,
    images: true,
    videos: false,
    audio: true,
  };

  private client: OpenAI;
  private converter: OpenAIResponsesConverter;
  private streamConverter: OpenAIResponsesStreamConverter;

  constructor(config: OpenAIConfig) {
    super(config);

    this.client = new OpenAI({
      apiKey: this.getApiKey(),
      baseURL: this.getBaseURL(),
      organization: config.organization,
      timeout: this.getTimeout(),
      maxRetries: this.getMaxRetries(),
    });

    this.converter = new OpenAIResponsesConverter();
    this.streamConverter = new OpenAIResponsesStreamConverter();
  }

  /**
   * Check if a parameter is supported by the model
   */
  private supportsParameter(model: string, parameter: 'temperature' | 'topP' | 'frequencyPenalty' | 'presencePenalty'): boolean {
    const modelInfo = getModelInfo(model);
    if (!modelInfo?.features.parameters) {
      // If no parameter info, assume supported (backward compatibility)
      return true;
    }
    return modelInfo.features.parameters[parameter] !== false;
  }

  /**
   * Generate response using OpenAI Responses API
   */
  async generate(options: TextGenerateOptions): Promise<LLMResponse> {
    // Execute with circuit breaker protection and observability
    return this.executeWithCircuitBreaker(async () => {
      try {
        // Convert to Responses API format
        const { input, instructions } = this.converter.convertInput(
          options.input,
          options.instructions
        );

        // Build request parameters
        const params: Record<string, unknown> = {
          model: options.model,
          input,
          ...(instructions && { instructions }),
          ...(options.tools && options.tools.length > 0 && {
            tools: this.converter.convertTools(options.tools),
          }),
          ...(options.tool_choice && {
            tool_choice: this.converter.convertToolChoice(options.tool_choice),
          }),
          ...(options.temperature !== undefined &&
              this.supportsParameter(options.model, 'temperature') &&
              { temperature: options.temperature }),
          ...(options.max_output_tokens && { max_output_tokens: options.max_output_tokens }),
          ...(options.response_format && {
            text: this.converter.convertResponseFormat(options.response_format),
          }),
          ...(options.parallel_tool_calls !== undefined && {
            parallel_tool_calls: options.parallel_tool_calls,
          }),
          ...(options.previous_response_id && {
            previous_response_id: options.previous_response_id,
          }),
          ...(options.metadata && { metadata: options.metadata }),
        };

        // Add reasoning config from unified thinking option
        this.applyReasoningConfig(params, options);

        this.logger.debug(
          { model: options.model, toolCount: (params.tools as unknown[])?.length ?? 0 },
          'generate: calling OpenAI API',
        );
        const genStartTime = Date.now();

        // Call Responses API
        const response = await this.client.responses.create(params as any);
        this.logger.debug(
          { model: options.model, duration: Date.now() - genStartTime },
          'generate: response received',
        );

        // Convert response to our format
        return this.converter.convertResponse(response);
      } catch (error: any) {
        this.logger.error({ model: options.model, error: error.message || error }, 'generate error');
        this.handleError(error, options.model);
        throw error; // TypeScript needs this
      }
    }, options.model);
  }

  /**
   * Stream response using OpenAI Responses API
   */
  async *streamGenerate(options: TextGenerateOptions): AsyncIterableIterator<StreamEvent> {
    try {
      // Convert to Responses API format
      const { input, instructions } = this.converter.convertInput(
        options.input,
        options.instructions
      );

      // Build request parameters
      const params: Record<string, unknown> = {
        model: options.model,
        input,
        ...(instructions && { instructions }),
        ...(options.tools && options.tools.length > 0 && {
          tools: this.converter.convertTools(options.tools),
        }),
        ...(options.tool_choice && {
          tool_choice: this.converter.convertToolChoice(options.tool_choice),
        }),
        ...(options.temperature !== undefined &&
            this.supportsParameter(options.model, 'temperature') &&
            { temperature: options.temperature }),
        ...(options.max_output_tokens && { max_output_tokens: options.max_output_tokens }),
        ...(options.response_format && {
          text: this.converter.convertResponseFormat(options.response_format),
        }),
        ...(options.parallel_tool_calls !== undefined && {
          parallel_tool_calls: options.parallel_tool_calls,
        }),
        ...(options.previous_response_id && {
          previous_response_id: options.previous_response_id,
        }),
        ...(options.metadata && { metadata: options.metadata }),
        stream: true,
      };

      // Add reasoning config from unified thinking option
      this.applyReasoningConfig(params, options);

      this.logger.debug(
        { model: options.model, toolCount: (params.tools as unknown[])?.length ?? 0 },
        'streamGenerate: calling OpenAI API',
      );
      const streamStartTime = Date.now();

      // Call Responses API with streaming
      let streamRef: any;
      const stream = await this.client.responses.create(params as any) as any;
      streamRef = stream;
      this.logger.debug(
        { model: options.model, duration: Date.now() - streamStartTime },
        'streamGenerate: OpenAI stream opened',
      );

      // Convert stream events using the stream converter
      let chunkCount = 0;
      try {
        for await (const event of this.streamConverter.convertStream(stream as AsyncIterable<ResponsesAPI.ResponseStreamEvent>)) {
          chunkCount++;
          yield event;
        }
      } finally {
        this.streamConverter.clear();
        // Abort underlying stream if consumer broke iteration early
        if (streamRef && typeof streamRef.abort === 'function') {
          try { streamRef.abort(); } catch { /* ignore */ }
        }
      }
      this.logger.debug(
        { events: chunkCount, duration: Date.now() - streamStartTime },
        'streamGenerate: stream complete',
      );
    } catch (error: any) {
      this.logger.error(
        { model: options.model, error: error.message || error },
        'streamGenerate error',
      );
      this.handleError(error, options.model);
      throw error;
    }
  }

  /**
   * Get model capabilities (registry-driven with OpenAI vendor defaults)
   */
  getModelCapabilities(model: string): ModelCapabilities {
    return resolveModelCapabilities(model, {
      supportsTools: true,
      supportsVision: true,
      supportsJSON: true,
      supportsJSONSchema: true,
      maxTokens: 128000,
      maxInputTokens: 128000,
      maxOutputTokens: 16384,
    });
  }


  /**
   * List available models from the OpenAI API
   */
  async listModels(): Promise<string[]> {
    const models: string[] = [];
    for await (const model of this.client.models.list()) {
      models.push(model.id);
    }
    return models.sort();
  }

  /**
   * Apply reasoning config from unified thinking option to request params
   */
  private applyReasoningConfig(params: Record<string, unknown>, options: TextGenerateOptions): void {
    if (options.thinking?.enabled) {
      validateThinkingConfig(options.thinking);
      params.reasoning = {
        effort: options.thinking.effort || 'medium',
      };
    }
  }

  /**
   * Handle OpenAI-specific errors
   */
  private handleError(error: any, model?: string): never {
    if (error.status === 401) {
      throw new ProviderAuthError('openai', 'Invalid API key');
    }

    if (error.status === 429) {
      const retryAfter = error.headers?.['retry-after'];
      throw new ProviderRateLimitError(
        'openai',
        retryAfter ? parseInt(retryAfter) * 1000 : undefined
      );
    }

    if (error.code === 'context_length_exceeded' || error.status === 413) {
      throw new ProviderContextLengthError('openai', resolveMaxContextTokens(model, 128000));
    }

    // Re-throw other errors
    throw error;
  }
}
