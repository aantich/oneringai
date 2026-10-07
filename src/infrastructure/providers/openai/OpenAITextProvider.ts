/**
 * OpenAI text provider using Responses API
 */

import OpenAI, { toFile } from 'openai';
import { createValidatedOpenAIAPIKeyProvider } from './OpenAIAuth.js';
import { BaseTextProvider } from '../base/BaseTextProvider.js';
import { TextGenerateOptions, ModelCapabilities } from '../../../domain/interfaces/ITextProvider.js';
import { LLMResponse } from '../../../domain/entities/Response.js';
import { ProviderCapabilities } from '../../../domain/interfaces/IProvider.js';
import { OpenAIConfig } from '../../../domain/types/ProviderConfig.js';
import { StreamEvent } from '../../../domain/entities/StreamEvent.js';
import { OpenAIResponsesConverter } from './OpenAIResponsesConverter.js';
import { OpenAIResponsesStreamConverter } from './OpenAIResponsesStreamConverter.js';
import { validateOpenAIResponsesRequest } from './OpenAIRequestValidator.js';
import * as ResponsesAPI from 'openai/resources/responses/responses.js';
import { getModelInfo } from '../../../domain/entities/Model.js';
import { resolveModelCapabilities } from '../base/ModelCapabilityResolver.js';
import { validateThinkingConfig } from '../shared/validateThinkingConfig.js';
import { ProviderErrorMapper } from '../base/ProviderErrorMapper.js';
import type { AdvancedTextCapabilities } from '../../../domain/interfaces/IAdvancedInference.js';
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

const OPENAI_EXTENDED_PROMPT_CACHE_MODELS = /^gpt-(?:5\.(?:4|5|6)|(?:[6-9]|\d{2,})(?:\.\d+)?)(?:-|$)/;
const OPENAI_EXPLICIT_PROMPT_CACHE_MODELS = /^gpt-(?:5\.(?:6|[7-9]|\d{2,})|(?:[6-9]|\d{2,})(?:\.\d+)?)(?:-|$)/;
const OPENAI_RESPONSES_TOOL_MODELS = /^(?:gpt-(?:4\.1|4o|(?:[5-9]|\d{2,})(?:\.\d+)?)(?:-|$)|o[134](?:-|$))/;
const OPENAI_SHELL_AND_PATCH_MODELS = /^gpt-(?:5\.(?:[1-9]|\d{2,})|(?:[6-9]|\d{2,})(?:\.\d+)?)(?:-|$)/;
const OPENAI_TOOL_SEARCH_AND_COMPUTER_MODELS = /^gpt-(?:5\.(?:[4-9]|\d{2,})|(?:[6-9]|\d{2,})(?:\.\d+)?)(?:-|$)/;

function getOpenAINativeTools(model: string): AdvancedTextCapabilities['nativeTools'] {
  if (!OPENAI_RESPONSES_TOOL_MODELS.test(model)) return [];
  const tools: AdvancedTextCapabilities['nativeTools'] = [
    'web_search', 'code_execution', 'file_search', 'remote_mcp', 'image_generation',
  ];
  if (OPENAI_SHELL_AND_PATCH_MODELS.test(model)) {
    tools.push('hosted_shell', 'apply_patch');
  }
  if (OPENAI_TOOL_SEARCH_AND_COMPUTER_MODELS.test(model)) {
    tools.push('computer_use', 'tool_search');
  }
  return tools;
}

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
  protected readonly nativeToolVendor: 'openai' | 'grok' = 'openai';
  readonly batch: IAsyncTextBatchProvider<TextGenerateOptions, LLMResponse> = this;

  constructor(config: OpenAIConfig) {
    super(config);

    this.client = new OpenAI({
      apiKey: config.apiKeyProvider
        ? createValidatedOpenAIAPIKeyProvider(config.apiKeyProvider)
        : this.getApiKey(),
      baseURL: this.getBaseURL(),
      organization: config.organization,
      project: config.project,
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
    // GPT-6 Sol/Luna support sampling when reasoning.effort is `none`. Keep
    // temperature in the request here and let the effort-aware validator
    // accept or reject the concrete combination instead of silently dropping it.
    if (/^(?:gpt-6-astra|gpt-6\.1-sol|gpt-6-sol|gpt-6-luna)(?:-|$)/.test(model)
      && (parameter === 'temperature' || parameter === 'topP')) {
      return true;
    }
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
    options = this.applyContextLimitGuardrail(options);
    options = await this.resolveAdvancedCredentials(options);
    // Execute with circuit breaker protection and observability
    return this.executeWithCircuitBreaker(async () => {
      try {
        // Convert to Responses API format
        const { input, instructions } = this.converter.convertInput(
          options.input,
          options.instructions,
          this.allowsPromptCacheBreakpoints(options),
        );

        // Build request parameters
        const params: Record<string, unknown> = {
          ...this.getVendorRequestOptions(options),
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
        if (options.native_tools?.length) {
          params.tools = [
            ...((params.tools as ResponsesAPI.Tool[] | undefined) ?? []),
            ...this.converter.convertNativeTools(options.native_tools, this.nativeToolVendor),
          ];
        }
        this.applyPromptCacheConfig(params, options);

        // Add reasoning config from unified thinking option
        this.applyReasoningConfig(params, options);
        validateOpenAIResponsesRequest(options, params, this.getBaseURL());

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

        if (response.error?.code === 'misalignment_policy_violation') {
          throw Object.assign(new Error(response.error.message), {
            code: response.error.code,
            status: 403,
            response_id: response.id,
            error: response.error,
          });
        }

        // Convert response to our format
        return this.converter.convertResponse(response);
      } catch (error: any) {
        this.logger.error({ model: options.model, ...ProviderErrorMapper.extractErrorDetails(error) }, 'generate error');
        this.handleError(error, options.model);
        throw error; // TypeScript needs this
      }
    }, options.model);
  }

  /**
   * Stream response using OpenAI Responses API
   */
  async *streamGenerate(options: TextGenerateOptions): AsyncIterableIterator<StreamEvent> {
    options = this.applyContextLimitGuardrail(options);
    options = await this.resolveAdvancedCredentials(options);
    this.ensureObservabilityInitialized();
    try {
      // Convert to Responses API format
      const { input, instructions } = this.converter.convertInput(
        options.input,
        options.instructions,
        this.allowsPromptCacheBreakpoints(options),
      );

      // Build request parameters
      const params: Record<string, unknown> = {
        ...this.getVendorRequestOptions(options),
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
      if (options.native_tools?.length) {
        params.tools = [
          ...((params.tools as ResponsesAPI.Tool[] | undefined) ?? []),
          ...this.converter.convertNativeTools(options.native_tools, this.nativeToolVendor),
        ];
      }
      this.applyPromptCacheConfig(params, options);

      // Add reasoning config from unified thinking option
      this.applyReasoningConfig(params, options);
      validateOpenAIResponsesRequest(options, params, this.getBaseURL());

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
        { model: options.model, ...ProviderErrorMapper.extractErrorDetails(error) },
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

  override getAdvancedCapabilities(model: string): AdvancedTextCapabilities {
    const info = getModelInfo(model);
    const supportsPromptCaching = info?.features.promptCaching === true;
    const supportsBatch = info?.features.batchAPI === true;
    const supportsStructuredOutput = info?.features.structuredOutput === true;
    const supportsExtendedPromptCaching = OPENAI_EXTENDED_PROMPT_CACHE_MODELS.test(model);
    const nativeTools = info ? getOpenAINativeTools(model) : [];
    return {
      promptCaching: {
        mode: supportsPromptCaching ? 'implicit' : 'unsupported',
        ttlModes: supportsPromptCaching
          ? supportsExtendedPromptCaching
            ? ['short', 'extended']
            : ['short']
          : [],
        reportsCacheUsage: supportsPromptCaching,
        explicitBreakpoints: OPENAI_EXPLICIT_PROMPT_CACHE_MODELS.test(model),
      },
      batch: {
        supported: supportsBatch,
        cancellable: true,
        maxRequests: 50_000,
        completionWindow: '24h',
      },
      structuredOutput: {
        jsonObject: supportsStructuredOutput ? 'native' : 'prompt',
        jsonSchema: supportsStructuredOutput ? 'native' : 'prompt',
        nativeWithTools: supportsStructuredOutput,
      },
      nativeTools,
      responsesExtensions: {
        asyncToolCalling: info?.features.asyncToolCalling === true,
        midTurnSteering: info?.features.midTurnSteering === true,
        configurationUpdates: info?.features.configurationUpdates === true,
        misalignmentMonitoring: info?.features.misalignmentMonitoring === true,
      },
      // The Responses API can request host approval, but OneRingAI does not yet
      // expose the mcp_approval_response continuation item. Only the normalized
      // no-approval execution path is currently executable end-to-end.
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
    const lines = await Promise.all(
      requests.map(async (request) =>
        JSON.stringify({
          custom_id: request.customId,
          method: 'POST',
          url: '/v1/responses',
          body: this.buildBatchBody(
            await this.resolveAdvancedCredentials(
              this.applyContextLimitGuardrail(request.options),
            ),
          ),
        }),
      ),
    );
    let inputFileId: string;
    try {
      const file = await this.client.files.create({
        file: await toFile(new TextEncoder().encode(lines.join('\n')), 'oneringai-batch.jsonl'),
        purpose: 'batch',
        expires_after: { anchor: 'created_at', seconds: 86_400 },
      });
      inputFileId = file.id;
    } catch (error) {
      // A failed input-file upload cannot have created an inference batch.
      // Surface the ordinary provider error; only the create-batch boundary is
      // treated as an ambiguous paid submission.
      throw ProviderErrorMapper.mapError(error, { providerName: this.name });
    }
    try {
      const batch = await this.client.batches.create(
        {
          input_file_id: inputFileId,
          endpoint: '/v1/responses',
          completion_window: '24h',
          ...(options?.metadata ? { metadata: options.metadata } : {}),
        },
        { maxRetries: 0 },
      );
      return this.mapBatch(batch);
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status === undefined || status >= 500) {
        throw new ProviderAmbiguousOperationError(
          this.name,
          'batch submission',
          { inputFileId, customIds: requests.map((request) => request.customId) },
          error as Error,
        );
      }
      throw ProviderErrorMapper.mapError(error, { providerName: this.name });
    }
  }

  async getBatch(id: string): Promise<BatchHandle> {
    return this.mapBatch(await this.client.batches.retrieve(id));
  }

  async cancelBatch(id: string): Promise<BatchHandle> {
    return this.mapBatch(await this.client.batches.cancel(id));
  }

  async *getBatchResults(id: string): AsyncIterable<BatchTextResult<LLMResponse>> {
    const batch = await this.client.batches.retrieve(id);
    const resultFileIds = [batch.output_file_id, batch.error_file_id].filter(
      (fileId): fileId is string => Boolean(fileId),
    );
    if (resultFileIds.length === 0) {
      const terminal = ['completed', 'cancelled', 'expired', 'failed'].includes(batch.status);
      if (terminal && (batch.request_counts?.total ?? 0) === 0) return;
      throw new Error(`OpenAI batch ${id} has no result files while ${batch.status}`);
    }
    for (const fileId of resultFileIds) {
      const file = await this.client.files.content(fileId);
      const text = await file.text();
      for (const line of text.split('\n').filter(Boolean)) {
        const item = JSON.parse(line) as {
          custom_id: string;
          response?: { status_code?: number; request_id?: string; body?: ResponsesAPI.Response };
          error?: { code?: string; message?: string };
        };
        if (item.response?.body && (item.response.status_code ?? 500) < 400) {
          const response = this.converter.convertResponse(item.response.body);
          response.usage.processing_mode = 'batch';
          yield {
            customId: item.custom_id,
            response,
            providerRequestId: item.response.request_id,
          };
        } else {
          yield {
            customId: item.custom_id,
            error: {
              code: item.error?.code,
              message:
                item.error?.message ?? `Batch request failed (${item.response?.status_code})`,
              statusCode: item.response?.status_code,
              details: item.error ?? item.response,
            },
          };
        }
      }
    }
  }

  private buildBatchBody(options: TextGenerateOptions): Record<string, unknown> {
    const { input, instructions } = this.converter.convertInput(
      options.input,
      options.instructions,
      this.allowsPromptCacheBreakpoints(options),
    );
    const body: Record<string, unknown> = {
      ...this.getVendorRequestOptions(options),
      model: options.model,
      input,
      ...(instructions ? { instructions } : {}),
      ...(options.tools?.length ? { tools: this.converter.convertTools(options.tools) } : {}),
      ...(options.tool_choice
        ? { tool_choice: this.converter.convertToolChoice(options.tool_choice) }
        : {}),
      ...(options.temperature !== undefined &&
        this.supportsParameter(options.model, 'temperature')
        ? { temperature: options.temperature }
        : {}),
      ...(options.native_tools?.length
        ? { nativeTools: this.converter.convertNativeTools(options.native_tools, this.nativeToolVendor) }
        : {}),
      ...(options.max_output_tokens ? { max_output_tokens: options.max_output_tokens } : {}),
      ...(options.response_format
        ? { text: this.converter.convertResponseFormat(options.response_format) }
        : {}),
      ...(options.metadata ? { metadata: options.metadata } : {}),
      ...(options.parallel_tool_calls !== undefined
        ? { parallel_tool_calls: options.parallel_tool_calls }
        : {}),
      ...(options.previous_response_id
        ? { previous_response_id: options.previous_response_id }
        : {}),
    };
    if (body.nativeTools) {
      body.tools = [
        ...((body.tools as ResponsesAPI.Tool[] | undefined) ?? []),
        ...(body.nativeTools as ResponsesAPI.Tool[]),
      ];
      delete body.nativeTools;
    }
    this.applyPromptCacheConfig(body, options);
    this.applyReasoningConfig(body, options);
    validateOpenAIResponsesRequest(options, body, this.getBaseURL());
    return body;
  }

  private validateBatchRequests(requests: Array<BatchTextRequest<TextGenerateOptions>>): void {
    if (requests.length === 0) throw new Error('Batch requires at least one request');
    if (requests.length > 50_000) throw new Error('OpenAI batch cannot exceed 50,000 requests');
    const ids = new Set<string>();
    for (const request of requests) {
      if (!request.customId || ids.has(request.customId)) {
        throw new Error(`Batch customId must be non-empty and unique: ${request.customId}`);
      }
      ids.add(request.customId);
    }
  }

  private mapBatch(batch: OpenAI.Batches.Batch): BatchHandle {
    const state =
      batch.status === 'validating'
        ? 'queued'
        : batch.status === 'finalizing'
          ? 'in_progress'
          : batch.status;
    return {
      id: batch.id,
      provider: this.name,
      state,
      rawStatus: batch.status,
      createdAt: new Date(batch.created_at * 1000),
      ...(batch.expires_at ? { expiresAt: new Date(batch.expires_at * 1000) } : {}),
      ...(batch.metadata ? { metadata: batch.metadata as Record<string, string> } : {}),
      ...(batch.request_counts
        ? {
            requestCounts: {
              total: batch.request_counts.total,
              succeeded: batch.request_counts.completed,
              failed: batch.request_counts.failed,
              processing:
                batch.request_counts.total -
                batch.request_counts.completed -
                batch.request_counts.failed,
            },
          }
        : {}),
    };
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

  /** Preserve raw Responses API evolution through vendorOptions without allowing
   * callers to replace normalized model/input/stream fields. */
  private getVendorRequestOptions(options: TextGenerateOptions): Record<string, unknown> {
    const { serviceTier, ...raw } = options.vendorOptions ?? {};
    if (serviceTier !== undefined && raw.service_tier === undefined) {
      raw.service_tier = serviceTier;
    }
    return raw;
  }

  private applyPromptCacheConfig(
    params: Record<string, unknown>,
    options: TextGenerateOptions,
  ): void {
    if (options.prompt_cache?.mode !== 'auto') return;
    if (options.prompt_cache.key) params.prompt_cache_key = options.prompt_cache.key;
    if (
      OPENAI_EXPLICIT_PROMPT_CACHE_MODELS.test(options.model) &&
      (options.prompt_cache.breakpointMode || options.prompt_cache.ttl === 'short')
    ) {
      params.prompt_cache_options = {
        mode: options.prompt_cache.breakpointMode ?? 'implicit',
        ttl: '30m',
      };
    }
    if (options.prompt_cache.ttl === 'extended') {
      params.prompt_cache_retention = '24h';
    }
  }

  private allowsPromptCacheBreakpoints(options: TextGenerateOptions): boolean {
    return options.prompt_cache?.mode === 'auto'
      && OPENAI_EXPLICIT_PROMPT_CACHE_MODELS.test(options.model);
  }

  /**
   * Handle OpenAI-specific errors via unified mapper
   */
  private handleError(error: any, model?: string): never {
    throw ProviderErrorMapper.mapError(error, { providerName: this.name, model });
  }
}
