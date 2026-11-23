import { InvalidConfigError, ProviderCapabilityNotSupportedError } from '../../../domain/errors/AIErrors.js';
import { ContentType } from '../../../domain/entities/Content.js';
import type { ConnectorConfig } from '../../../domain/entities/Connector.js';
import type { AdvancedTextCapabilities } from '../../../domain/interfaces/IAdvancedInference.js';
import type { ITextProvider, ModelCapabilities, TextGenerateOptions } from '../../../domain/interfaces/ITextProvider.js';
import { registerModelTransport } from '../../../core/model-execution/ModelTask.js';
import { GenericOpenAIProvider, type GenericOpenAIConfig } from '../generic/GenericOpenAIProvider.js';

type ModelProfiles = NonNullable<NonNullable<ConnectorConfig['options']>['omlxModels']>;
type CatalogModel = { id: string; model_type?: string; max_model_len?: number };

class OMLXResponsesTransport extends GenericOpenAIProvider {
  async discover(signal?: AbortSignal): Promise<CatalogModel[]> {
    const payload = await this.listResponseModels<{ data?: unknown }>(signal);
    if (!Array.isArray(payload.data)) throw new InvalidConfigError('Invalid oMLX model catalog');
    return payload.data.filter((entry): entry is CatalogModel =>
      entry && typeof entry.id === 'string' && (entry.model_type === 'llm' || entry.model_type === 'vlm'));
  }
}

/** Local inference over Responses. The application retains conversation and tool execution ownership. */
export class OMLXTextProvider implements ITextProvider {
  readonly vendor = 'omlx';
  readonly capabilities = { text: true, images: true, videos: false, audio: false };
  private readonly transport: OMLXResponsesTransport;
  private readonly profiles: ModelProfiles;
  private catalog = new Map<string, CatalogModel>();

  constructor(readonly name: string, config: GenericOpenAIConfig, profiles: ModelProfiles = {}) {
    this.transport = new OMLXResponsesTransport(name, config, this.capabilities);
    this.profiles = Object.fromEntries(Object.entries(profiles).map(([id, profile]) => [id, { ...profile }]));
    registerModelTransport(this);
  }

  validateConfig(): Promise<boolean> {
    return this.transport.validateConfig();
  }

  destroy(): void {
    this.transport.destroy();
  }

  async listModels(): Promise<string[]> {
    await this.refreshCatalog();
    return [...this.catalog.keys()].sort();
  }

  async prepareModel(model: string, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    await this.refreshCatalog(signal);
    if (!this.catalog.has(model)) throw new InvalidConfigError(`oMLX text or vision model "${model}" is not installed on ${this.name}`);
  }

  private async refreshCatalog(signal?: AbortSignal): Promise<void> {
    const models = await this.transport.discover(signal);
    this.catalog = new Map(models.map(model => [model.id, model]));
  }

  getModelCapabilities(model: string): ModelCapabilities {
    const entry = this.catalog.get(model);
    const profile = Object.hasOwn(this.profiles, model) ? this.profiles[model] : undefined;
    const inkling = entry?.model_type === 'vlm' && /^(?:inkling-2-mini|inkling-2-mini-oq4e-mtp)$/i.test(model);
    const maxModelLen = entry?.max_model_len;
    const contextLimit = typeof maxModelLen === 'number' && Number.isSafeInteger(maxModelLen) && maxModelLen > 0
      ? maxModelLen : 32_000;
    const jsonSchema = profile?.jsonSchema ?? inkling;
    return {
      supportsTools: profile?.tools ?? inkling,
      supportsVision: entry?.model_type === 'vlm',
      supportsJSON: jsonSchema,
      supportsJSONSchema: jsonSchema,
      maxTokens: contextLimit,
      maxInputTokens: contextLimit,
    };
  }

  getAdvancedCapabilities(model: string): AdvancedTextCapabilities {
    const format = this.getModelCapabilities(model).supportsJSONSchema ? 'native' : 'prompt';
    return {
      nativeCompaction: { onDemand: 'unsupported', inputTokenCounting: 'unavailable' },
      promptCaching: { mode: 'implicit', ttlModes: [], reportsCacheUsage: false },
      batch: { supported: false, cancellable: false },
      structuredOutput: { jsonObject: format, jsonSchema: format, nativeWithTools: false },
      nativeTools: [],
      nativeToolOptions: { remoteMcpApproval: false },
      dataHandling: { promptCaching: 'provider_managed', batch: 'none', remoteMcp: 'none' },
    };
  }

  async generate(options: TextGenerateOptions) {
    if (!this.catalog.has(options.model)) await this.prepareModel(options.model, options.signal);
    return this.transport.generate(this.normalize(options));
  }

  async *streamGenerate(options: TextGenerateOptions) {
    if (!this.catalog.has(options.model)) await this.prepareModel(options.model, options.signal);
    yield* this.transport.streamGenerate(this.normalize(options));
  }

  private normalize(options: TextGenerateOptions): TextGenerateOptions {
    const { model, tools, thinking, vendorOptions = {} } = options;
    const capabilities = this.getModelCapabilities(model);
    const reject = (feature: string): never => {
      throw new ProviderCapabilityNotSupportedError(this.name, model, feature);
    };
    if (options.native_tools?.length) reject('provider-hosted tools');
    if (options.previous_response_id || options.continuation_token || options.nativeContext) reject('provider-managed conversation state');
    if (options.tool_choice && options.tool_choice !== 'auto') reject('forced tool choice');
    if (options.parallel_tool_calls !== undefined) reject('parallel tool-call control');
    if (thinking?.budgetTokens !== undefined || (thinking?.mode && thinking.mode !== 'enabled' && thinking.mode !== 'disabled')) reject('reasoning mode or token budget');
    if (options.prompt_cache?.mode === 'auto' && options.prompt_cache.strict) reject('explicit prompt-cache control');
    if (tools?.length && !capabilities.supportsTools) reject('function tools for this checkpoint');
    if (Array.isArray(options.input) && !capabilities.supportsVision && options.input.some(item =>
      item.type === 'message' && item.content?.some(block => block.type === ContentType.INPUT_IMAGE_URL))) reject('image input');
    if (options.response_format && options.response_format.type !== 'text' && (!capabilities.supportsJSONSchema || tools?.length)) reject('native structured output for this request');
    for (const key of Object.keys(vendorOptions)) {
      if (key !== 'seed' && key !== 'top_p' && !(key === 'store' && vendorOptions.store === false)) reject(`request option "${key}"`);
    }

    return {
      ...options,
      ...(thinking?.mode === 'disabled' ? { thinking: { enabled: false } } : {}),
      prompt_cache: undefined,
      vendorOptions: {
        ...vendorOptions,
        store: false,
        ...(thinking && (!thinking.enabled || thinking.mode === 'disabled') ? { reasoning: { effort: 'none' } } : {}),
      },
    };
  }
}
