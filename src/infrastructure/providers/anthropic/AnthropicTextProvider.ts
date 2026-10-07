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
import { StreamEvent, StreamEventType } from '../../../domain/entities/StreamEvent.js';
import type { TokenUsage } from '../../../domain/entities/Response.js';
import { resolveModelCapabilities } from '../base/ModelCapabilityResolver.js';
import { ProviderErrorMapper } from '../base/ProviderErrorMapper.js';
import type { AdvancedTextCapabilities } from '../../../domain/interfaces/IAdvancedInference.js';
import { getModelInfo } from '../../../domain/entities/Model.js';
import type {
  BatchHandle,
  BatchSubmitOptions,
  BatchTextRequest,
  BatchTextResult,
  IAsyncTextBatchProvider,
} from '../../../domain/interfaces/IAdvancedInference.js';
import {
  ProviderAmbiguousOperationError,
  ProviderCapabilityNotSupportedError,
} from '../../../domain/errors/AIErrors.js';

const NATIVE_STRUCTURED_OUTPUT_MODELS = [
  /^claude-(?:opus-5|mythos-5)(?:-|$)/,
  /^claude-opus-4-8(?:-|$)/,
  /^claude-sonnet-5(?:-|$)/,
  /^claude-fable-5(?:-|$)/,
  /^claude-opus-4-7(?:-|$)/,
  /^claude-opus-4-6(?:-|$)/,
  /^claude-sonnet-4-6(?:-|$)/,
  /^claude-opus-4-5(?:-|$)/,
  /^claude-sonnet-4-5(?:-|$)/,
  /^claude-haiku-4-5(?:-|$)/,
] as const;
const MAX_SERVER_TOOL_CONTINUATIONS = 8;
const ANTHROPIC_SERVER_TOOL_MODELS = [
  /^claude-(?:opus-5|mythos-5)(?:-|$)/,
  /^claude-opus-4-8(?:-|$)/,
  /^claude-sonnet-5(?:-|$)/,
  /^claude-fable-5(?:-|$)/,
  /^claude-opus-4-[67](?:-|$)/,
  /^claude-sonnet-4-6(?:-|$)/,
] as const;

function getAnthropicNativeTools(model: string): AdvancedTextCapabilities['nativeTools'] {
  if (!ANTHROPIC_SERVER_TOOL_MODELS.some((pattern) => pattern.test(model))) return [];
  return ['web_search', 'web_fetch', 'code_execution', 'tool_search', 'remote_mcp'];
}

export function supportsAnthropicNativeStructuredOutput(model: string): boolean {
  return NATIVE_STRUCTURED_OUTPUT_MODELS.some((pattern) => pattern.test(model));
}

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
  readonly batch: IAsyncTextBatchProvider<TextGenerateOptions, LLMResponse> = this;

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
    options = await this.resolveAdvancedCredentials(options);
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
        const usesRemoteMcp = options.native_tools?.some(
          (tool) => tool.capability === 'remote_mcp',
        );
        let request = anthropicRequest as any;
        const usesBeta = usesRemoteMcp || Array.isArray(request.betas);
        let anthropicResponse: Anthropic.Message | undefined;
        const aggregate = this.emptyAnthropicUsage();
        for (let continuation = 0; continuation <= MAX_SERVER_TOOL_CONTINUATIONS; continuation++) {
          const stream = usesBeta
            ? this.client.beta.messages.stream(request)
            : this.client.messages.stream(request);
          streamRef = stream;
          anthropicResponse = (await stream.finalMessage()) as unknown as Anthropic.Message;
          this.accumulateAnthropicUsage(aggregate, anthropicResponse.usage);
          if (anthropicResponse.stop_reason !== 'pause_turn') break;
          if (continuation === MAX_SERVER_TOOL_CONTINUATIONS) break;
          request = {
            ...request,
            messages: [
              ...request.messages,
              { role: 'assistant', content: anthropicResponse.content },
            ],
          };
        }
        if (!anthropicResponse) throw new Error('Anthropic returned no response');
        (anthropicResponse as any).usage = aggregate;

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
    options = await this.resolveAdvancedCredentials(options);
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
      const usesRemoteMcp = options.native_tools?.some(
        (tool) => tool.capability === 'remote_mcp',
      );
      let request = anthropicRequest as any;
      const usesBeta = usesRemoteMcp || Array.isArray(request.betas);
      let chunkCount = 0;
      const aggregateUsage: TokenUsage = { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
      for (let continuation = 0; continuation <= MAX_SERVER_TOOL_CONTINUATIONS; continuation++) {
        // Standard and beta Messages expose equivalent streaming operations,
        // but the SDK models them as incompatible overload unions.
        const messagesApi: any = usesBeta
          ? this.client.beta.messages
          : this.client.messages;
        const hasStreamHelper =
          Boolean(options.native_tools?.length) && typeof messagesApi.stream === 'function';
        const stream = hasStreamHelper
          ? messagesApi.stream(request)
          : await messagesApi.create({ ...request, stream: true } as any);
        streamRef = stream;
        this.logger.debug(
          { model: options.model, duration: Date.now() - streamStartTime, continuation },
          'streamGenerate: Anthropic stream opened',
        );
        let terminalEvent: StreamEvent | undefined;
        for await (const event of this.streamConverter.convertStream(
          stream as unknown as AsyncIterable<Anthropic.MessageStreamEvent>,
          options.model,
        )) {
          chunkCount++;
          if (event.type === StreamEventType.RESPONSE_COMPLETE) {
            this.accumulateTokenUsage(aggregateUsage, event.usage);
            terminalEvent = { ...event, usage: { ...aggregateUsage } };
          } else {
            yield event;
          }
        }
        if (!hasStreamHelper || typeof (stream as any).finalMessage !== 'function') {
          if (terminalEvent) yield terminalEvent;
          break;
        }
        const message = (await (stream as any).finalMessage()) as Anthropic.Message;
        if (message.stop_reason !== 'pause_turn' || continuation === MAX_SERVER_TOOL_CONTINUATIONS) {
          if (terminalEvent) yield terminalEvent;
          break;
        }
        request = {
          ...request,
          messages: [...request.messages, { role: 'assistant', content: message.content }],
        };
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
    // Anthropic's output_config.format is model-gated. Keep older models on the
    // vendor-neutral prompt/repair path instead of risking a provider 400.
    caps.supportsJSONSchema = supportsAnthropicNativeStructuredOutput(model);
    return caps;
  }

  override getAdvancedCapabilities(model: string): AdvancedTextCapabilities {
    const info = getModelInfo(model);
    const supportsPromptCaching = info?.features.promptCaching === true;
    const supportsBatch = info?.features.batchAPI === true;
    const supportsNativeSchema = supportsAnthropicNativeStructuredOutput(model);
    const nativeTools = info ? getAnthropicNativeTools(model) : [];
    return {
      reasoningHistory: 'always',
      promptCaching: {
        mode: supportsPromptCaching ? 'request_controlled' : 'unsupported',
        ttlModes: supportsPromptCaching ? ['short', 'extended'] : [],
        reportsCacheUsage: supportsPromptCaching,
      },
      batch: {
        supported: supportsBatch,
        cancellable: true,
        maxRequests: 100_000,
        completionWindow: '24h',
      },
      structuredOutput: {
        jsonObject: 'prompt',
        jsonSchema: supportsNativeSchema ? 'native' : 'prompt',
        // Citation-producing server tools are incompatible with Anthropic JSON
        // outputs. Until the capability contract is tool-specific, use the
        // conservative tool-free final formatting pass for every tool mix.
        nativeWithTools: false,
      },
      nativeTools,
      nativeToolOptions: { remoteMcpApproval: false },
      dataHandling: {
        promptCaching: supportsPromptCaching ? 'provider_managed' : 'none',
        batch: supportsBatch ? 'provider_retained' : 'none',
        remoteMcp: nativeTools.includes('remote_mcp') ? 'third_party' : 'none',
      },
    };
  }

  async submitBatch(
    requests: Array<BatchTextRequest<TextGenerateOptions>>,
    _options?: BatchSubmitOptions,
  ): Promise<BatchHandle> {
    this.validateBatchRequests(requests);
    for (const model of new Set(requests.map((request) => request.options.model))) {
      if (!this.getAdvancedCapabilities(model).batch.supported) {
        throw new ProviderCapabilityNotSupportedError(this.name, model, 'batch');
      }
    }
    if (_options?.completionWindow && _options.completionWindow !== '24h') {
      throw new ProviderCapabilityNotSupportedError(
        this.name,
        requests[0]!.options.model,
        `batch_completion_window:${_options.completionWindow}`,
      );
    }
    if (_options?.dataHandling?.allowBatchRetention !== true) {
      throw new ProviderCapabilityNotSupportedError(
        this.name,
        requests[0]!.options.model,
        'batch_blocked_by_data_policy',
      );
    }
    // Complete all local conversion before entering the ambiguous external
    // mutation boundary. A local schema/conversion error cannot have created a
    // provider batch and must not be mislabeled as an uncertain submission.
    const batchRequests = await Promise.all(
      requests.map(async (request) => {
        const converted = this.converter.convertRequest({
          ...(await this.resolveAdvancedCredentials(
            this.applyContextLimitGuardrail(request.options),
          )),
        }) as Anthropic.MessageCreateParamsNonStreaming & { betas?: string[] };
        // `betas` is a header parameter on the outer beta batch request, not a
        // valid field inside each Messages request body.
        const { betas: _betas, ...params } = converted;
        return { custom_id: request.customId, params };
      }),
    );
    try {
      // Use the beta batch surface consistently so remote-MCP batches remain
      // retrievable after process restarts without an in-memory id registry.
      const created = await this.client.beta.messages.batches.create(
        {
          requests: batchRequests,
          betas: ['mcp-client-2025-11-20'],
        },
        { maxRetries: 0 },
      );
      return this.mapBatch(created as unknown as Anthropic.Messages.MessageBatch);
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status === undefined || status >= 500) {
        throw new ProviderAmbiguousOperationError(
          this.name,
          'message batch submission',
          { customIds: requests.map((request) => request.customId) },
          error as Error,
        );
      }
      throw ProviderErrorMapper.mapError(error, { providerName: this.name });
    }
  }

  async getBatch(id: string): Promise<BatchHandle> {
    const batch = await this.client.beta.messages.batches.retrieve(id, {
      betas: ['mcp-client-2025-11-20'],
    });
    return this.mapBatch(batch as unknown as Anthropic.Messages.MessageBatch);
  }

  async cancelBatch(id: string): Promise<BatchHandle> {
    const batch = await this.client.beta.messages.batches.cancel(id, {
      betas: ['mcp-client-2025-11-20'],
    });
    return this.mapBatch(batch as unknown as Anthropic.Messages.MessageBatch);
  }

  async *getBatchResults(
    id: string,
  ): AsyncIterable<BatchTextResult<LLMResponse>> {
    const results = await this.client.beta.messages.batches.results(id, {
      betas: ['mcp-client-2025-11-20'],
    });
    for await (const item of results) {
      if (item.result.type === 'succeeded') {
        const response = this.converter.convertResponse(
          item.result.message as unknown as Anthropic.Message,
        );
        response.usage.processing_mode = 'batch';
        yield { customId: item.custom_id, response, providerRequestId: item.result.message.id };
      } else if (item.result.type === 'errored') {
        yield {
          customId: item.custom_id,
          error: {
            code: item.result.error.error.type,
            message: item.result.error.error.message,
            details: item.result.error,
          },
        };
      } else {
        yield {
          customId: item.custom_id,
          error: {
            code: item.result.type,
            message: `Batch item ${item.result.type}`,
            details: item.result,
          },
        };
      }
    }
  }

  private validateBatchRequests(
    requests: Array<BatchTextRequest<TextGenerateOptions>>,
  ): void {
    if (requests.length === 0) throw new Error('Batch requires at least one request');
    if (requests.length > 100_000) {
      throw new Error('Anthropic batch cannot exceed 100,000 requests');
    }
    const ids = new Set<string>();
    for (const request of requests) {
      if (!request.customId || ids.has(request.customId)) {
        throw new Error(`Batch customId must be non-empty and unique: ${request.customId}`);
      }
      ids.add(request.customId);
    }
  }

  private mapBatch(batch: Anthropic.Messages.MessageBatch): BatchHandle {
    const counts = batch.request_counts;
    const total =
      counts.processing + counts.succeeded + counts.errored + counts.canceled + counts.expired;
    const state =
      batch.processing_status === 'in_progress'
        ? 'in_progress'
        : batch.processing_status === 'canceling'
          ? 'cancelling'
          : counts.errored > 0 && counts.succeeded === 0
            ? 'failed'
            : counts.expired > 0 && counts.succeeded === 0
              ? 'expired'
              : counts.canceled > 0 && counts.succeeded === 0
                ? 'cancelled'
                : 'completed';
    return {
      id: batch.id,
      provider: this.name,
      state,
      rawStatus: batch.processing_status,
      createdAt: new Date(batch.created_at),
      expiresAt: new Date(batch.expires_at),
      requestCounts: {
        total,
        processing: counts.processing,
        succeeded: counts.succeeded,
        failed: counts.errored,
        cancelled: counts.canceled,
        expired: counts.expired,
      },
    };
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

  private emptyAnthropicUsage(): Anthropic.Usage {
    return {
      input_tokens: 0,
      output_tokens: 0,
      output_tokens_details: null,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation: {
        ephemeral_5m_input_tokens: 0,
        ephemeral_1h_input_tokens: 0,
      },
      server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 },
      service_tier: null,
      inference_geo: null,
    };
  }

  private accumulateAnthropicUsage(target: Anthropic.Usage, next: Anthropic.Usage): void {
    target.input_tokens += next.input_tokens;
    target.output_tokens += next.output_tokens;
    target.cache_creation_input_tokens =
      (target.cache_creation_input_tokens ?? 0) + (next.cache_creation_input_tokens ?? 0);
    target.cache_read_input_tokens =
      (target.cache_read_input_tokens ?? 0) + (next.cache_read_input_tokens ?? 0);
    if (target.cache_creation && next.cache_creation) {
      target.cache_creation.ephemeral_5m_input_tokens +=
        next.cache_creation.ephemeral_5m_input_tokens;
      target.cache_creation.ephemeral_1h_input_tokens +=
        next.cache_creation.ephemeral_1h_input_tokens;
    }
    if (target.server_tool_use && next.server_tool_use) {
      target.server_tool_use.web_search_requests += next.server_tool_use.web_search_requests;
      target.server_tool_use.web_fetch_requests += next.server_tool_use.web_fetch_requests;
    }
    target.service_tier = next.service_tier ?? target.service_tier;
    target.inference_geo = next.inference_geo ?? target.inference_geo;
    const targetSpeed = target as Anthropic.Usage & { speed?: string | null };
    const nextSpeed = next as Anthropic.Usage & { speed?: string | null };
    targetSpeed.speed = nextSpeed.speed ?? targetSpeed.speed;
    const targetWithDetails = target as Anthropic.Usage & {
      output_tokens_details?: { thinking_tokens: number };
    };
    const nextDetails = (next as Anthropic.Usage & {
      output_tokens_details?: { thinking_tokens?: number } | null;
    }).output_tokens_details;
    if (nextDetails?.thinking_tokens !== undefined) {
      targetWithDetails.output_tokens_details = {
        thinking_tokens:
          (targetWithDetails.output_tokens_details?.thinking_tokens ?? 0) +
          nextDetails.thinking_tokens,
      };
    }
  }

  private accumulateTokenUsage(target: TokenUsage, next: TokenUsage): void {
    target.input_tokens += next.input_tokens;
    target.output_tokens += next.output_tokens;
    target.total_tokens += next.total_tokens;
    target.cached_input_tokens =
      (target.cached_input_tokens ?? 0) + (next.cached_input_tokens ?? 0);
    target.cache_creation_input_tokens =
      (target.cache_creation_input_tokens ?? 0) +
      (next.cache_creation_input_tokens ?? 0);
    if (next.cache_creation_details) {
      target.cache_creation_details ??= {};
      target.cache_creation_details.short_ttl_input_tokens =
        (target.cache_creation_details.short_ttl_input_tokens ?? 0) +
        (next.cache_creation_details.short_ttl_input_tokens ?? 0);
      target.cache_creation_details.extended_ttl_input_tokens =
        (target.cache_creation_details.extended_ttl_input_tokens ?? 0) +
        (next.cache_creation_details.extended_ttl_input_tokens ?? 0);
    }
    if (next.output_tokens_details?.reasoning_tokens !== undefined) {
      target.output_tokens_details = {
        reasoning_tokens:
          (target.output_tokens_details?.reasoning_tokens ?? 0) +
          next.output_tokens_details.reasoning_tokens,
      };
    }
    for (const [name, count] of Object.entries(next.native_tool_calls ?? {})) {
      target.native_tool_calls ??= {};
      const key = name as keyof NonNullable<TokenUsage['native_tool_calls']>;
      target.native_tool_calls[key] = (target.native_tool_calls[key] ?? 0) + (count ?? 0);
    }
    target.processing_mode = next.processing_mode ?? target.processing_mode;
    target.service_tier = next.service_tier ?? target.service_tier;
    target.speed = next.speed ?? target.speed;
  }
}
