/**
 * Anthropic (Claude) text provider
 */

import Anthropic from '@anthropic-ai/sdk';
import { BaseTextProvider } from '../base/BaseTextProvider.js';
import { TextGenerateOptions, ModelCapabilities } from '../../../domain/interfaces/ITextProvider.js';
import { LLMResponse } from '../../../domain/entities/Response.js';
import { ProviderCapabilities } from '../../../domain/interfaces/IProvider.js';
import { AnthropicConfig } from '../../../domain/types/ProviderConfig.js';
import { AnthropicConverter } from './AnthropicConverter.js';
import { AnthropicStreamConverter } from './AnthropicStreamConverter.js';
import { StreamEvent } from '../../../domain/entities/StreamEvent.js';
import { resolveModelCapabilities } from '../base/ModelCapabilityResolver.js';
import { ProviderErrorMapper } from '../base/ProviderErrorMapper.js';

export class AnthropicTextProvider extends BaseTextProvider {
  readonly name = 'anthropic';
  readonly capabilities: ProviderCapabilities = {
    text: true,
    images: true, // Claude 3+ supports vision
    videos: false,
    audio: false,
  };

  private client: Anthropic;
  private converter: AnthropicConverter;
  private streamConverter: AnthropicStreamConverter;

  constructor(config: AnthropicConfig) {
    super(config);

    this.client = new Anthropic({
      apiKey: this.getApiKey(),
      baseURL: this.getBaseURL(),
      maxRetries: this.getMaxRetries(),
    });
    this.converter = new AnthropicConverter();
    this.streamConverter = new AnthropicStreamConverter();
  }

  /**
   * Generate response using Anthropic Messages API.
   *
   * Transport is always streaming (via `client.messages.stream(...)` +
   * `.finalMessage()`), even though the public signature is non-streaming.
   * The SDK aggregates server-sent events into the same `Message` object the
   * non-streaming endpoint returns, and our converter treats it identically.
   *
   * Why streaming transport: the Anthropic SDK refuses non-streaming requests
   * whose estimated duration exceeds 10 minutes with
   * "Streaming is required for operations that may take longer than 10 minutes".
   * Long profile regenerations and large-context single-shot calls hit that
   * guardrail. Streaming transport avoids it without changing any caller.
   */
  async generate(options: TextGenerateOptions): Promise<LLMResponse> {
    options = this.applyContextLimitGuardrail(options);
    return this.executeWithCircuitBreaker(async () => {
      let streamRef: any;
      try {
        // Convert our format → Anthropic Messages API format
        const anthropicRequest = this.converter.convertRequest(options);

        this.logger.debug(
          { model: options.model, messageCount: anthropicRequest.messages?.length ?? 0, toolCount: anthropicRequest.tools?.length ?? 0 },
          'generate: calling Anthropic API (streaming transport)',
        );
        const genStartTime = Date.now();

        // Use SDK's streaming helper — identical final shape to non-streaming
        // create(), but bypasses the 10-minute non-streaming guardrail.
        const stream = this.client.messages.stream(anthropicRequest);
        streamRef = stream;
        const anthropicResponse = await stream.finalMessage();

        this.logger.debug(
          { model: options.model, duration: Date.now() - genStartTime },
          'generate: response received',
        );

        // Convert Anthropic response → our format
        return this.converter.convertResponse(anthropicResponse);
      } catch (error: any) {
        this.logger.error({ model: options.model, ...ProviderErrorMapper.extractErrorDetails(error) }, 'generate error');
        this.handleError(error, options.model);
        throw error; // TypeScript needs this
      } finally {
        // Abort the underlying SSE connection if we exited via throw before
        // finalMessage() settled (circuit-breaker cancel, upstream abort, etc.).
        if (streamRef) {
          if (typeof streamRef.controller?.abort === 'function') {
            try { streamRef.controller.abort(); } catch { /* ignore */ }
          } else if (typeof streamRef.abort === 'function') {
            try { streamRef.abort(); } catch { /* ignore */ }
          }
        }
      }
    }, options.model);
  }

  /**
   * Stream response using Anthropic Messages API
   */
  async *streamGenerate(options: TextGenerateOptions): AsyncIterableIterator<StreamEvent> {
    options = this.applyContextLimitGuardrail(options);
    // streamGenerate doesn't go through executeWithCircuitBreaker, so logger
    // would otherwise stay bound to provider="unknown" until first generate().
    this.ensureObservabilityInitialized();
    let streamRef: any;
    try {
      // Convert our format → Anthropic Messages API format
      const anthropicRequest = this.converter.convertRequest(options);

      this.logger.debug(
        { model: options.model, messageCount: anthropicRequest.messages?.length ?? 0, toolCount: anthropicRequest.tools?.length ?? 0 },
        'streamGenerate: calling Anthropic API',
      );
      const streamStartTime = Date.now();

      // Create stream
      const stream = await this.client.messages.create({
        ...anthropicRequest,
        stream: true,
      });
      streamRef = stream;
      this.logger.debug(
        { model: options.model, duration: Date.now() - streamStartTime },
        'streamGenerate: Anthropic stream opened',
      );

      // Reset stream converter for reuse
      this.streamConverter.reset();

      // Convert Anthropic events → our StreamEvent format
      let chunkCount = 0;
      for await (const event of this.streamConverter.convertStream(stream, options.model)) {
        chunkCount++;
        yield event;
      }
      this.logger.debug(
        { events: chunkCount, duration: Date.now() - streamStartTime },
        'streamGenerate: stream complete',
      );
    } catch (error: any) {
      this.logger.error(
        { model: options.model, ...ProviderErrorMapper.extractErrorDetails(error) },
        'streamGenerate error',
      );
      this.handleError(error, options.model);
      throw error;
    } finally {
      // ALWAYS clear stream converter to prevent memory leaks
      this.streamConverter.clear();
      // Abort underlying stream if consumer broke iteration early
      if (streamRef) {
        if (typeof streamRef.controller?.abort === 'function') {
          try { streamRef.controller.abort(); } catch { /* ignore */ }
        } else if (typeof streamRef.abort === 'function') {
          try { streamRef.abort(); } catch { /* ignore */ }
        }
      }
    }
  }

  /**
   * Get model capabilities (registry-driven with Anthropic vendor defaults)
   */
  getModelCapabilities(model: string): ModelCapabilities {
    const caps = resolveModelCapabilities(model, {
      supportsTools: true,
      supportsVision: true,
      supportsJSON: true,
      supportsJSONSchema: false,
      maxTokens: 200000,
      maxInputTokens: 200000,
      maxOutputTokens: 8192,
    });
    // Anthropic doesn't support JSON schema mode even though registry has structuredOutput: true
    caps.supportsJSONSchema = false;
    return caps;
  }

  /**
   * List available models from the Anthropic API
   */
  async listModels(): Promise<string[]> {
    const models: string[] = [];
    for await (const model of this.client.models.list()) {
      models.push(model.id);
    }
    return models.sort();
  }

  /**
   * Handle Anthropic-specific errors via unified mapper
   */
  private handleError(error: any, model?: string): never {
    throw ProviderErrorMapper.mapError(error, { providerName: this.name, model });
  }
}
