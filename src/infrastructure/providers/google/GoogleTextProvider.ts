/**
 * Google Gemini text provider (using new unified SDK)
 */

import { GoogleGenAI, type BatchJob, type Interactions } from '@google/genai';
import { BaseTextProvider } from '../base/BaseTextProvider.js';
import { TextGenerateOptions, ModelCapabilities } from '../../../domain/interfaces/ITextProvider.js';
import { LLMResponse } from '../../../domain/entities/Response.js';
import { ProviderCapabilities } from '../../../domain/interfaces/IProvider.js';
import { GoogleConfig } from '../../../domain/types/ProviderConfig.js';
import { GoogleConverter } from './GoogleConverter.js';
import { GoogleStreamConverter } from './GoogleStreamConverter.js';
import { GoogleInteractionsConverter } from './GoogleInteractionsConverter.js';
import { StreamEvent } from '../../../domain/entities/StreamEvent.js';
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

const GOOGLE_SERVER_TOOL_MODELS = /^gemini-(?:2\.5|3(?:\.|-|$))/;
const GOOGLE_STRUCTURED_WITH_TOOLS_MODELS = /^gemini-3(?:\.|-|$)/;
const GOOGLE_NON_TEXT_VARIANTS = /(?:image|live)/;
const GOOGLE_INTERACTIONS_DEFAULT_MODELS = /^gemini-3\.(?:5|6|7|8)(?:-|$)/;

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
  private interactionsConverter: GoogleInteractionsConverter;
  readonly batch: IAsyncTextBatchProvider<TextGenerateOptions, LLMResponse> = this;

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
    this.interactionsConverter = new GoogleInteractionsConverter();

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
    options = this.applyContextLimitGuardrail(options);
    options = await this.resolveAdvancedCredentials(options);
    return this.executeWithCircuitBreaker(async () => {
      try {
        if (this.usesInteractions(options)) {
          const request = await this.interactionsConverter.convertRequest(options);
          this.logger.debug({ model: options.model }, 'generate: calling Google Interactions API');
          const result = await this.client.interactions.create(request as any);
          return this.interactionsConverter.convertResponse(result, options.model);
        }

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
        const outputContent = firstOutput?.type === 'message' ? firstOutput.content : [];
        const hasToolCalls = this.converter.hasToolCalls(outputContent);
        if (!hasToolCalls) {
          this.converter.clearMappings();
        }

        return response;
      } catch (error: any) {
        this.logger.error({ model: options.model, ...ProviderErrorMapper.extractErrorDetails(error) }, 'generate error');
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
    options = this.applyContextLimitGuardrail(options);
    options = await this.resolveAdvancedCredentials(options);
    this.ensureObservabilityInitialized();
    try {
      if (this.usesInteractions(options)) {
        const request = await this.interactionsConverter.convertRequest(options);
        this.logger.debug({ model: options.model }, 'streamGenerate: calling Google Interactions API');
        const stream = await this.client.interactions.create({ ...request, stream: true } as any);
        yield* this.interactionsConverter.convertStream(
          stream as unknown as AsyncIterable<Interactions.InteractionSSEEvent>,
          options.model,
        );
        return;
      }

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
        { model: options.model, ...ProviderErrorMapper.extractErrorDetails(error) },
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

  override getAdvancedCapabilities(model: string): AdvancedTextCapabilities {
    const info = getModelInfo(model);
    const supportsPromptCaching = info?.features.promptCaching === true;
    const supportsBatch = info?.features.batchAPI === true;
    const supportsStructuredOutput = info?.features.structuredOutput === true;
    const nativeTools: AdvancedTextCapabilities['nativeTools'] =
      info && GOOGLE_SERVER_TOOL_MODELS.test(model) && !GOOGLE_NON_TEXT_VARIANTS.test(model)
        ? [
            'web_search',
            'web_fetch',
            'code_execution',
            ...(/^gemini-3\.8(?:-|$)/.test(model)
              ? (['file_search', 'computer_use'] as const)
              : []),
          ]
        : [];
    return {
      promptCaching: {
        mode: supportsPromptCaching ? 'implicit' : 'unsupported',
        ttlModes: [],
        reportsCacheUsage: supportsPromptCaching,
      },
      batch: {
        supported: supportsBatch,
        cancellable: true,
        completionWindow: '24h',
      },
      structuredOutput: {
        jsonObject: supportsStructuredOutput ? 'native' : 'prompt',
        jsonSchema: supportsStructuredOutput ? 'native' : 'prompt',
        nativeWithTools:
          supportsStructuredOutput &&
          GOOGLE_STRUCTURED_WITH_TOOLS_MODELS.test(model) &&
          !GOOGLE_NON_TEXT_VARIANTS.test(model),
      },
      nativeTools,
      nativeToolOptions: { remoteMcpApproval: false },
      dataHandling: {
        promptCaching: supportsPromptCaching ? 'provider_managed' : 'none',
        batch: supportsBatch ? 'provider_retained' : 'none',
        remoteMcp: 'none',
      },
    };
  }

  async submitBatch(
    requests: Array<BatchTextRequest<TextGenerateOptions>>,
    options?: BatchSubmitOptions,
  ): Promise<BatchHandle> {
    this.validateBatchRequests(requests);
    for (const model of new Set(requests.map((request) => request.options.model))) {
      if (!this.getAdvancedCapabilities(model).batch.supported) {
        throw new ProviderCapabilityNotSupportedError(this.name, model, 'batch');
      }
    }
    if (options?.completionWindow && options.completionWindow !== '24h') {
      throw new ProviderCapabilityNotSupportedError(
        this.name,
        requests[0]!.options.model,
        `batch_completion_window:${options.completionWindow}`,
      );
    }
    if (options?.dataHandling?.allowBatchRetention !== true) {
      throw new ProviderCapabilityNotSupportedError(
        this.name,
        requests[0]!.options.model,
        'batch_blocked_by_data_policy',
      );
    }
    const model = requests[0]!.options.model;
    if (requests.some((request) => request.options.model !== model)) {
      throw new Error('Google inline batch requires one model per batch');
    }
    const src = await Promise.all(
      requests.map(async (request) => {
        const normalized = this.applyContextLimitGuardrail(request.options);
        const resolved = await this.resolveAdvancedCredentials(normalized);
        const converted = await this.converter.convertRequest(
          resolved,
        );
        return {
          model,
          contents: converted.contents,
          config: {
            systemInstruction: converted.systemInstruction,
            tools: converted.tools,
            toolConfig: converted.toolConfig,
            ...converted.generationConfig,
          },
          metadata: { customId: request.customId },
        };
      }),
    );
    try {
      const job = await this.client.batches.create({
        model,
        src,
        config: {
          ...(options?.metadata?.name ? { displayName: options.metadata.name } : {}),
        },
      });
      return this.mapBatch(job, requests.length, options?.metadata);
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status === undefined || status >= 500) {
        throw new ProviderAmbiguousOperationError(
          this.name,
          'batch submission',
          { customIds: requests.map((request) => request.customId), model },
          error as Error,
        );
      }
      throw ProviderErrorMapper.mapError(error, { providerName: this.name, model });
    }
  }

  async getBatch(id: string): Promise<BatchHandle> {
    return this.mapBatch(await this.client.batches.get({ name: id }));
  }

  async cancelBatch(id: string): Promise<BatchHandle> {
    await this.client.batches.cancel({ name: id });
    return this.getBatch(id);
  }

  async *getBatchResults(id: string): AsyncIterable<BatchTextResult<LLMResponse>> {
    const job = await this.client.batches.get({ name: id });
    const results = job.dest?.inlinedResponses;
    if (!results) {
      if (this.mapGoogleBatchState(job.state) === 'completed') return;
      throw new Error(`Google batch ${id} has no inline results while ${job.state}`);
    }
    for (const [index, item] of results.entries()) {
      const customId = item.metadata?.customId ?? String(index);
      if (item.response) {
        const response = this.converter.convertResponse(item.response);
        response.usage.processing_mode = 'batch';
        yield { customId, response, providerRequestId: item.response.responseId };
      } else {
        yield {
          customId,
          error: {
            code: item.error?.code ? String(item.error.code) : undefined,
            message: item.error?.message ?? 'Google batch item failed',
            details: item.error,
          },
        };
      }
    }
  }

  private validateBatchRequests(requests: Array<BatchTextRequest<TextGenerateOptions>>): void {
    if (requests.length === 0) throw new Error('Batch requires at least one request');
    const ids = new Set<string>();
    for (const request of requests) {
      if (!request.customId || ids.has(request.customId)) {
        throw new Error(`Batch customId must be non-empty and unique: ${request.customId}`);
      }
      ids.add(request.customId);
    }
  }

  /**
   * Gemini 3.5+ uses the GA Interactions API by default. Callers can retain the
   * legacy generateContent wire contract with `vendorOptions.api = 'generateContent'`.
   */
  private usesInteractions(options: TextGenerateOptions): boolean {
    const requested = options.vendorOptions?.api;
    if (requested === 'generateContent') return false;
    if (requested === 'interactions') return true;
    return GOOGLE_INTERACTIONS_DEFAULT_MODELS.test(options.model);
  }

  private mapGoogleBatchState(state?: string): BatchHandle['state'] {
    switch (state) {
      case 'JOB_STATE_QUEUED':
      case 'JOB_STATE_PENDING':
        return 'queued';
      case 'JOB_STATE_RUNNING':
      case 'JOB_STATE_UPDATING':
      case 'JOB_STATE_PAUSED':
        return 'in_progress';
      case 'JOB_STATE_SUCCEEDED':
      case 'JOB_STATE_PARTIALLY_SUCCEEDED':
        return 'completed';
      case 'JOB_STATE_CANCELLING':
        return 'cancelling';
      case 'JOB_STATE_CANCELLED':
        return 'cancelled';
      case 'JOB_STATE_EXPIRED':
        return 'expired';
      default:
        return 'failed';
    }
  }

  private mapBatch(
    job: BatchJob,
    total?: number,
    metadata?: Record<string, string>,
  ): BatchHandle {
    const succeeded = Number(job.completionStats?.successfulCount ?? 0);
    const failed = Number(job.completionStats?.failedCount ?? 0);
    const incomplete = Number(job.completionStats?.incompleteCount ?? 0);
    return {
      id: job.name ?? '',
      provider: this.name,
      state: this.mapGoogleBatchState(job.state),
      rawStatus: job.state,
      ...(job.createTime ? { createdAt: new Date(job.createTime) } : {}),
      ...(metadata ? { metadata } : {}),
      ...((total !== undefined || job.completionStats)
        ? {
            requestCounts: {
              total: total ?? succeeded + failed + Math.max(0, incomplete),
              succeeded,
              failed,
              processing: Math.max(0, incomplete),
            },
          }
        : {}),
    };
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
   * Handle Google-specific errors via unified mapper
   */
  private handleError(error: any, model?: string): never {
    throw ProviderErrorMapper.mapError(error, { providerName: this.name, model });
  }
}
