import { createHash } from 'crypto';
import OpenAI from 'openai';
import { modelExecutionFetch, modelRequestOptions, registerModelTransport } from '../../../core/model-execution/ModelTask.js';
import type { ProviderCapabilities } from '../../../domain/interfaces/IProvider.js';
import type {
  ModelCapabilities,
  TextGenerateOptions,
} from '../../../domain/interfaces/ITextProvider.js';
import type { AdvancedTextCapabilities } from '../../../domain/interfaces/IAdvancedInference.js';
import type { LLMResponse } from '../../../domain/entities/Response.js';
import type { StreamEvent } from '../../../domain/entities/StreamEvent.js';
import { ProviderCapabilityNotSupportedError } from '../../../domain/errors/AIErrors.js';
import type { BaseProviderConfig } from '../../../domain/types/ProviderConfig.js';
import { BaseTextProvider } from '../base/BaseTextProvider.js';
import { ProviderErrorMapper } from '../base/ProviderErrorMapper.js';
import { resolveModelCapabilities } from '../base/ModelCapabilityResolver.js';
import { OpenAIResponsesStreamConverter } from '../openai/OpenAIResponsesStreamConverter.js';
import { DeepSeekConverter } from './DeepSeekConverter.js';
import { DeepSeekChatStreamConverter } from './DeepSeekChatStreamConverter.js';
import {
  resolveDeepSeekHost,
  resolveDeepSeekModel,
  type DeepSeekHost,
  type DeepSeekTransport,
  type ResolvedDeepSeekHost,
} from './DeepSeekHostRegistry.js';

export interface DeepSeekConfig extends BaseProviderConfig {
  connectorName?: string;
  host?: DeepSeekHost;
  transport?: DeepSeekTransport;
}

export interface DeepSeekFimRequest {
  model: string;
  prompt: string;
  suffix?: string;
  maxTokens?: number;
  temperature?: number;
  stop?: string | string[];
}

export interface DeepSeekBalance {
  is_available: boolean;
  balance_infos: Array<{
    currency: string;
    total_balance: string;
    granted_balance: string;
    topped_up_balance: string;
  }>;
}

export interface DeepSeekFimResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    text: string;
    finish_reason: string | null;
    logprobs?: unknown;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export class DeepSeekTextProvider extends BaseTextProvider {
  readonly name = 'deepseek';
  readonly capabilities: ProviderCapabilities = {
    text: true,
    images: false,
    videos: false,
    audio: false,
  };

  readonly host: ResolvedDeepSeekHost;
  private readonly client: OpenAI;
  private readonly betaClient?: OpenAI;
  private readonly converter = new DeepSeekConverter();
  private readonly connectorName: string;

  constructor(config: DeepSeekConfig) {
    const host = resolveDeepSeekHost({
      host: config.host,
      baseURL: config.baseURL,
      transport: config.transport,
    });
    super({ ...config, baseURL: host.baseURL });
    this.host = host;
    this.connectorName = config.connectorName ?? 'deepseek';
    this.client = new OpenAI({
      apiKey: this.getApiKey(),
      baseURL: host.baseURL,
      timeout: this.getTimeout(),
      maxRetries: this.getMaxRetries(),
      fetch: modelExecutionFetch,
    });
    if (host.profile.id === 'official') {
      this.betaClient = new OpenAI({
        apiKey: this.getApiKey(),
        baseURL: 'https://api.deepseek.com/beta',
        timeout: this.getTimeout(),
        maxRetries: this.getMaxRetries(),
        fetch: modelExecutionFetch,
      });
    }
    registerModelTransport(this);
  }

  async generate(options: TextGenerateOptions): Promise<LLMResponse> {
    options = this.prepareOptions(this.applyContextLimitGuardrail(options));
    this.assertStatelessOptions(options);
    const model = resolveDeepSeekModel(options.model, this.host);
    const persistReasoning = (options.tools?.length ?? 0) > 0;

    return this.executeWithCircuitBreaker(async () => {
      try {
        if (model.transport === 'responses') {
          const params = this.converter.convertResponsesRequest(options, model);
          const response = await this.client.responses.create(params as never, ...modelRequestOptions(options));
          return this.converter.convertResponsesResponse(
            response as unknown as Record<string, any>,
            options.model,
            persistReasoning,
          );
        }
        const params = this.converter.convertChatRequest(options, model, this.host);
        const response = await this.getChatClient(options).chat.completions.create(params as never, ...modelRequestOptions(options));
        return this.converter.convertChatResponse(
          response as unknown as Record<string, any>,
          options.model,
          persistReasoning,
        );
      } catch (error) {
        throw ProviderErrorMapper.mapError(error, {
          providerName: this.name,
          model: options.model,
        });
      }
    }, options.model);
  }

  async *streamGenerate(options: TextGenerateOptions): AsyncIterableIterator<StreamEvent> {
    options = this.prepareOptions(this.applyContextLimitGuardrail(options));
    this.assertStatelessOptions(options);
    this.ensureObservabilityInitialized();
    const model = resolveDeepSeekModel(options.model, this.host);
    let stream: any;
    try {
      if (model.transport === 'responses') {
        const params = {
          ...this.converter.convertResponsesRequest(options, model),
          stream: true,
        };
        stream = await this.client.responses.create(params as never, ...modelRequestOptions(options));
        const streamConverter = new OpenAIResponsesStreamConverter();
        yield* streamConverter.convertStream(stream);
      } else {
        const params = {
          ...this.converter.convertChatRequest(options, model, this.host),
          stream: true,
          stream_options: { include_usage: true },
        };
        stream = await this.getChatClient(options).chat.completions.create(params as never, ...modelRequestOptions(options));
        yield* new DeepSeekChatStreamConverter().convertStream(stream, options.model);
      }
    } catch (error) {
      throw ProviderErrorMapper.mapError(error, {
        providerName: this.name,
        model: options.model,
      });
    } finally {
      if (typeof stream?.abort === 'function') {
        try { stream.abort(); } catch { /* best-effort SDK cleanup */ }
      }
    }
  }

  getModelCapabilities(model: string): ModelCapabilities {
    const resolved = resolveDeepSeekModel(model, this.host);
    const canonical = resolved.canonicalModel ?? this.findCanonicalModel(resolved.apiModel) ?? model;
    const capabilities = resolveModelCapabilities(canonical, {
      supportsTools: true,
      supportsVision: false,
      supportsJSON: true,
      supportsJSONSchema: resolved.transport === 'responses',
      maxTokens: 1_000_000,
      maxInputTokens: 1_000_000,
      maxOutputTokens: 384_000,
    });
    if (resolved.inputTokens !== undefined) {
      capabilities.maxTokens = resolved.inputTokens;
      capabilities.maxInputTokens = resolved.inputTokens;
    }
    if (resolved.outputTokens !== undefined) {
      capabilities.maxOutputTokens = resolved.outputTokens;
    }
    capabilities.supportsJSONSchema = resolved.transport === 'responses';
    return capabilities;
  }

  override getAdvancedCapabilities(model: string): AdvancedTextCapabilities {
    const resolved = resolveDeepSeekModel(model, this.host);
    const isOfficialResponses =
      this.host.profile.id === 'official' && resolved.transport === 'responses';
    return {
      reasoningHistory: 'when_tools_configured',
      promptCaching: {
        mode: this.host.profile.promptCaching.mode,
        ttlModes: [],
        reportsCacheUsage: this.host.profile.promptCaching.reportsCacheUsage,
      },
      batch: { supported: false, cancellable: false },
      structuredOutput: {
        jsonObject: 'native',
        jsonSchema: resolved.transport === 'responses' ? 'native' : 'prompt',
        nativeWithTools: resolved.transport === 'responses',
      },
      nativeTools: isOfficialResponses ? ['web_search'] : [],
      nativeToolOptions: { remoteMcpApproval: false },
      dataHandling: {
        promptCaching:
          this.host.profile.promptCaching.mode === 'implicit'
            ? 'provider_managed'
            : 'none',
        batch: 'none',
        remoteMcp: 'none',
      },
    };
  }

  async listModels(): Promise<string[]> {
    try {
      const page = await this.client.models.list();
      const models: string[] = [];
      for await (const model of page) models.push(model.id);
      return models;
    } catch (error) {
      this.logger.debug(
        { error: (error as Error).message },
        'DeepSeek host does not expose a models endpoint',
      );
      return [];
    }
  }

  /** First-party beta fill-in-the-middle completion API. */
  async createFimCompletion(request: DeepSeekFimRequest): Promise<DeepSeekFimResponse> {
    this.assertFirstPartyAccountAPI('fim_completion');
    const model = resolveDeepSeekModel(request.model, this.host);
    return this.betaClient!.completions.create({
      model: model.apiModel,
      prompt: request.prompt,
      ...(request.suffix !== undefined && { suffix: request.suffix }),
      ...(request.maxTokens !== undefined && { max_tokens: request.maxTokens }),
      ...(request.temperature !== undefined && { temperature: request.temperature }),
      ...(request.stop !== undefined && { stop: request.stop }),
    }) as unknown as Promise<DeepSeekFimResponse>;
  }

  /** First-party account balance API. */
  async getBalance(): Promise<DeepSeekBalance> {
    this.assertFirstPartyAccountAPI('balance');
    return this.client.get('https://api.deepseek.com/user/balance') as Promise<DeepSeekBalance>;
  }

  private prepareOptions(options: TextGenerateOptions): TextGenerateOptions {
    const userId = options.credential_context?.userId;
    const vendorOptions = { ...options.vendorOptions };
    delete vendorOptions.deepseek_user_id;
    if (!userId) return { ...options, vendorOptions };
    const opaqueUserId = createHash('sha256')
      .update(`${this.connectorName}:${userId}`)
      .digest('base64url');
    return {
      ...options,
      vendorOptions: { ...vendorOptions, deepseek_user_id: opaqueUserId },
    };
  }

  private assertStatelessOptions(options: TextGenerateOptions): void {
    if (options.previous_response_id) {
      throw new ProviderCapabilityNotSupportedError(
        this.name,
        options.model,
        'previous_response_id (DeepSeek Responses is stateless)',
      );
    }
    if (Array.isArray(options.input)) {
      const unsupported = options.input.some((item) =>
        item.type === 'message' && item.content.some((part) =>
          part.type === 'input_image_url' || part.type === 'input_file'
        )
      );
      if (unsupported) {
        throw new ProviderCapabilityNotSupportedError(
          this.name,
          options.model,
          'vision_or_file_input',
        );
      }
    }
  }

  private assertFirstPartyAccountAPI(capability: string): void {
    if (this.host.profile.id !== 'official') {
      throw new ProviderCapabilityNotSupportedError(this.name, 'account', capability);
    }
  }

  private getChatClient(options: TextGenerateOptions): OpenAI {
    const requiresStrictBeta = this.host.profile.id === 'official' &&
      options.tools?.some((tool) =>
        tool.type === 'function' && tool.function.strict === true
      );
    return requiresStrictBeta ? this.betaClient! : this.client;
  }

  private findCanonicalModel(apiModel: string): string | undefined {
    return Object.entries(this.host.profile.modelIds)
      .find(([, hostModel]) => hostModel === apiModel)?.[0];
  }
}
