import { Agent, type AgentConfig } from '../../core/Agent.js';
import { StorageRegistry } from '../../core/StorageRegistry.js';
import type { TokenUsage } from '../../domain/entities/Response.js';
import { StreamEventType, type StreamEvent } from '../../domain/entities/StreamEvent.js';
import { getModelInfo } from '../../domain/entities/Model.js';
import type { IAgentDefinitionStorage } from '../../domain/interfaces/IAgentDefinitionStorage.js';
import type { ThinkingConfig } from '../../domain/interfaces/ITextProvider.js';
import type { AgentDriver, DriverDescriptor, DriverEvent, DriverOpenSessionRequest, DriverRun, DriverRunRequest, DriverRunResult, DriverSession } from '../AgentDriver.js';
import {
  AgentDriverConfigurationError,
  AgentNativeExecutionError,
  AgentPolicyUnsupportedError,
  AgentStructuredOutputError,
} from '../errors.js';
import { createDeferred, errorMessage, toJsonObject, toJsonValue } from '../internal.js';
import { parseAndValidateStructuredOutput } from '../StructuredOutputValidator.js';
import type {
  AgentCapability,
  AgentRunErrorInfo,
  ResolvedAgentCapabilities,
  RuntimeAgentSpec,
  RuntimeReasoningConfig,
  RuntimeReasoningEffort,
  RuntimeUsage,
  TrustedRuntimeContext,
} from '../types.js';

const ONERING_REASONING_EFFORTS = new Set<RuntimeReasoningEffort>([
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
]);
const DEFAULT_MODEL_REASONING_CONTROLS: Readonly<Record<string, NormalizedReasoningControls>> = {
  'gpt-6-astra': reasoningControls(['low', 'medium', 'high', 'xhigh', 'max']),
  'gpt-6.1-sol': reasoningControls(['low', 'medium', 'high', 'xhigh', 'max']),
  'gpt-6-sol': reasoningControls(['none', 'low', 'medium', 'high', 'xhigh', 'max']),
  'gpt-6-luna': reasoningControls(['none', 'low', 'medium', 'high', 'xhigh', 'max']),
  'gpt-5.6-sol': reasoningControls(['none', 'low', 'medium', 'high', 'xhigh', 'max']),
  'gpt-5.6-terra': reasoningControls(['none', 'low', 'medium', 'high', 'xhigh', 'max']),
  'gpt-5.6-luna': reasoningControls(['none', 'low', 'medium', 'high', 'xhigh', 'max']),
  'gpt-5.6-cyber': reasoningControls(['none', 'low', 'medium', 'high', 'xhigh', 'max']),
  'claude-opus-5-5': reasoningControls(['low', 'medium', 'high', 'xhigh', 'max']),
  'claude-sonnet-5-5': reasoningControls(['low', 'medium', 'high', 'xhigh', 'max']),
  'gemini-3.8-flash': reasoningControls(['low', 'medium', 'high']),
  'grok-4.7': reasoningControls(['low', 'medium', 'high', 'xhigh']),
  'gpt-5.3-codex': reasoningControls(['low', 'medium', 'high', 'xhigh']),
};

export type OneRingAgentSource =
  | { type: 'stored-definition'; agentId: string }
  | { type: 'binding'; name: string }
  | { type: 'factory'; name: string };

export interface LocalAgentFactoryContext {
  spec: Readonly<RuntimeAgentSpec>;
  context: TrustedRuntimeContext;
  workspaceRoot?: string;
  policy: DriverOpenSessionRequest['policy'];
}

export interface OneRingAgentBinding {
  agent: Agent;
  ownership?: 'borrowed' | 'owned';
}

export interface OneRingModelReasoningControls {
  /** Verified model-specific effort values accepted by the underlying provider. */
  efforts?: readonly RuntimeReasoningEffort[];
  /** True only when `thinking.enabled: false` is natively enforceable. */
  supportsDisabled?: boolean;
  /** True only when a fixed reasoning-token budget is natively enforced. */
  supportsBudgetTokens?: boolean;
}

export interface OneRingAIDriverOptions {
  definitionStorage?: IAgentDefinitionStorage;
  bindings?: Record<string, OneRingAgentBinding>;
  factories?: Record<string, (context: LocalAgentFactoryContext) => Agent | Promise<Agent>>;
  /** Verified controls for models not covered by the bundled map. */
  modelReasoningControls?: Readonly<Record<string, OneRingModelReasoningControls>>;
  /**
   * Explicit host assertion that every supplied/stored agent's tools and
   * PermissionPolicyManager already enforce the runtime policy.
   */
  trustAgentPolicy?: boolean;
}

export class OneRingAIDriver implements AgentDriver {
  readonly id = 'oneringai.agent';
  private readonly activeBindings = new Set<string>();
  private readonly modelReasoningControls: Readonly<Record<string, NormalizedReasoningControls>>;

  constructor(private readonly options: OneRingAIDriverOptions = {}) {
    this.modelReasoningControls = normalizeModelReasoningControls(options.modelReasoningControls);
  }

  async inspect(context: Parameters<AgentDriver['inspect']>[0]): Promise<DriverDescriptor> {
    const source = parseSource(context.spec);
    rejectCommonOverrides(context.spec);
    validateReasoning(context.spec.reasoning);
    if (context.policy && !this.options.trustAgentPolicy) {
      throw new AgentPolicyUnsupportedError(
        'OneRingAI runtime policy enforcement requires OneRingAIDriver({ trustAgentPolicy: true }) and a host-configured agent permission pipeline',
      );
    }
    if (context.policy?.approvals === 'interactive') {
      throw new AgentPolicyUnsupportedError('The OneRingAI runtime adapter does not expose interactive approvals');
    }

    let resolvedModel = context.spec.model;
    if (source.type === 'stored-definition') {
      const storage = this.options.definitionStorage ?? StorageRegistry.get('agentDefinitions');
      if (!storage) throw new AgentDriverConfigurationError('No OneRingAI agent definition storage is configured');
      const definition = await storage.load(source.agentId);
      if (!definition) throw new AgentDriverConfigurationError(`OneRingAI agent definition '${source.agentId}' was not found`);
      const connector = context.connectorRegistry.get(definition.connector.name);
      resolvedModel ??= definition.connector.model;
      validateModel(resolvedModel, connector.vendor);
    } else if (source.type === 'binding') {
      const binding = this.options.bindings?.[source.name];
      if (!binding) throw new AgentDriverConfigurationError(`OneRingAI agent binding '${source.name}' is not registered`);
      assertBoundScope(binding.agent, context.context);
      resolvedModel ??= binding.agent.model;
      validateModel(resolvedModel, binding.agent.connector.vendor);
    } else if (!this.options.factories?.[source.name]) {
      throw new AgentDriverConfigurationError(`OneRingAI agent factory '${source.name}' is not registered`);
    } else if (resolvedModel) {
      validateModel(resolvedModel);
    }

    if (resolvedModel) {
      validateReasoningForModel(resolvedModel, context.spec.reasoning, this.modelReasoningControls);
    }
    return {
      capabilities: oneRingCapabilities(
        resolvedModel,
        context.spec.reasoning,
        this.modelReasoningControls,
      ),
    };
  }

  async openSession(request: DriverOpenSessionRequest): Promise<DriverSession> {
    await this.inspect(request);
    const source = parseSource(request.spec);
    let agent: Agent;
    let owned = true;
    let releaseBinding: (() => void) | undefined;

    if (source.type === 'stored-definition') {
      const overrides: Partial<AgentConfig> = {
        registry: request.connectorRegistry,
        ...(request.context.userId !== undefined ? { userId: request.context.userId } : {}),
      };
      const loaded = await Agent.fromStorage(source.agentId, this.options.definitionStorage, overrides);
      if (!loaded) throw new AgentDriverConfigurationError(`OneRingAI agent definition '${source.agentId}' was not found`);
      agent = loaded;
    } else if (source.type === 'binding') {
      if (this.activeBindings.has(source.name)) {
        throw new AgentDriverConfigurationError(`OneRingAI agent binding '${source.name}' already backs an active runtime session`);
      }
      const binding = this.options.bindings?.[source.name];
      if (!binding) throw new AgentDriverConfigurationError(`OneRingAI agent binding '${source.name}' is not registered`);
      assertBoundScope(binding.agent, request.context);
      this.activeBindings.add(source.name);
      releaseBinding = () => this.activeBindings.delete(source.name);
      agent = binding.agent;
      owned = binding.ownership === 'owned';
    } else {
      const factory = this.options.factories?.[source.name];
      if (!factory) throw new AgentDriverConfigurationError(`OneRingAI agent factory '${source.name}' is not registered`);
      agent = await factory({
        spec: request.spec,
        context: request.context,
        workspaceRoot: request.workspace?.root,
        policy: request.policy,
      });
      if (!(agent instanceof Agent)) {
        throw new AgentDriverConfigurationError(`OneRingAI factory '${source.name}' did not return an Agent`);
      }
      try {
        assertBoundScope(agent, request.context);
      } catch (error) {
        agent.destroy();
        throw error;
      }
    }

    const originalModel = agent.model;
    try {
      validateModel(request.spec.model ?? originalModel, agent.connector.vendor);
      validateReasoningForModel(
        request.spec.model ?? originalModel,
        request.spec.reasoning,
        this.modelReasoningControls,
      );
      if (request.spec.model) agent.setModel(request.spec.model);
      return new OneRingDriverSession(
        agent,
        owned,
        request.spec.reasoning,
        request.spec.model ?? originalModel,
        !owned && request.spec.model ? originalModel : undefined,
        releaseBinding,
        this.modelReasoningControls,
      );
    } catch (error) {
      try {
        if (!owned && agent.model !== originalModel) agent.setModel(originalModel);
        if (owned) agent.destroy();
      } finally {
        releaseBinding?.();
      }
      throw error;
    }
  }
}

class OneRingDriverSession implements DriverSession {
  private _isDestroyed = false;

  constructor(
    private readonly agent: Agent,
    private readonly owned: boolean,
    private readonly defaultReasoning: RuntimeReasoningConfig | undefined,
    private readonly sessionModel: string,
    private readonly restoreModel?: string,
    private readonly releaseBinding?: () => void,
    private readonly modelReasoningControls: Readonly<Record<string, NormalizedReasoningControls>> = DEFAULT_MODEL_REASONING_CONTROLS,
  ) {}

  get nativeSessionId(): string | undefined {
    return this.agent.getSessionId() ?? undefined;
  }

  get isDestroyed(): boolean {
    return this._isDestroyed;
  }

  async run(request: DriverRunRequest): Promise<DriverRun> {
    if (this._isDestroyed) throw new Error('OneRingAI driver session has been destroyed');
    const input = toOneRingInput(request.input);
    return this.runStreamed(input, request);
  }

  async cancelActiveRun(reason?: string): Promise<void> {
    this.agent.cancel(reason);
  }

  async destroy(): Promise<void> {
    if (this._isDestroyed) return;
    this._isDestroyed = true;
    try {
      if (this.restoreModel && !this.agent.isDestroyed) this.agent.setModel(this.restoreModel);
    } finally {
      try {
        if (this.owned) this.agent.destroy();
      } finally {
        this.releaseBinding?.();
      }
    }
  }

  private runStreamed(input: string, request: DriverRunRequest): DriverRun {
    const deferred = createDeferred<DriverRunResult>();
    const agent = this.agent;
    const model = request.model ?? this.sessionModel;
    validateModel(model, agent.connector.vendor);
    const reasoning = request.reasoning ?? this.defaultReasoning;
    validateReasoningForModel(model, reasoning, this.modelReasoningControls);
    const responseFormat = request.responseFormat?.type === 'json_schema'
      ? {
          type: 'json_schema' as const,
          name: request.responseFormat.name,
          schema: request.responseFormat.schema,
          strict: request.responseFormat.strict,
        }
      : undefined;
    const events: AsyncIterable<DriverEvent> = (async function* (): AsyncGenerator<DriverEvent> {
      let allDeltas = '';
      let finalMessage = '';
      let usage: RuntimeUsage | undefined;
      let status: DriverRunResult['status'] = 'completed';
      let finishReason: string | undefined;
      const previousModel = agent.model;
      agent.setModel(model);
      try {
        for await (const event of agent.stream(input, {
          thinking: toThinkingConfig(reasoning),
          ...(responseFormat ? { responseFormat } : {}),
        })) {
          if (request.signal.aborted) agent.cancel('Runtime abort signal');
          const mapped = mapOneRingEvent(event);
          if (event.type === StreamEventType.OUTPUT_TEXT_DELTA) allDeltas += event.delta;
          if (event.type === StreamEventType.OUTPUT_TEXT_DONE) finalMessage = event.text;
          if (event.type === StreamEventType.RESPONSE_COMPLETE) {
            usage = mapUsage(event.usage);
            status = event.status;
            finishReason = event.stop_reason;
          }
          if (mapped) yield mapped;
        }
        const finalStatus = request.signal.aborted ? 'cancelled' : status;
        const outputText = finalMessage || allDeltas;
        const outputParsed = finalStatus === 'completed' && request.responseFormat?.type === 'json_schema'
          ? parseAndValidateStructuredOutput(outputText, request.responseFormat)
          : undefined;
        deferred.resolve({
          status: finalStatus,
          outputText,
          outputParsed,
          usage,
          finishReason: request.signal.aborted ? 'cancelled' : finishReason,
          configuration: { model, ...(reasoning ? { reasoning } : {}) },
          ...(request.responseFormat?.type === 'json_schema'
            ? { enforcement: { structuredOutput: 'emulated' as const } }
            : {}),
        });
      } catch (error) {
        if (error instanceof AgentStructuredOutputError) {
          yield {
            type: 'diagnostic' as const,
            data: { level: 'error', code: error.code, message: error.message },
          };
          deferred.resolve({
            status: 'failed',
            outputText: finalMessage || allDeltas,
            error: { code: error.code, message: error.message, retryable: false },
            finishReason: 'structured_output_invalid',
            enforcement: { structuredOutput: 'emulated' },
            configuration: { model, ...(reasoning ? { reasoning } : {}) },
          });
          return;
        }
        const nativeError = new AgentNativeExecutionError('oneringai.agent', errorMessage(error), error as Error);
        deferred.resolve(failedResult(nativeError));
        throw error;
      } finally {
        agent.setModel(previousModel);
      }
    })();

    return {
      events,
      result: deferred.promise,
      cancel: async (reason?: string) => this.agent.cancel(reason),
    };
  }

}

function parseSource(spec: Readonly<RuntimeAgentSpec>): OneRingAgentSource {
  const source = spec.driverConfig?.source;
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    throw new AgentDriverConfigurationError('OneRingAI driverConfig.source is required');
  }
  const type = source.type;
  if (type === 'stored-definition' && typeof source.agentId === 'string' && source.agentId.trim()) {
    return { type, agentId: source.agentId };
  }
  if ((type === 'binding' || type === 'factory') && typeof source.name === 'string' && source.name.trim()) {
    return { type, name: source.name };
  }
  throw new AgentDriverConfigurationError('Invalid OneRingAI driverConfig.source');
}

function rejectCommonOverrides(spec: Readonly<RuntimeAgentSpec>): void {
  if (spec.connector !== undefined || spec.instructions !== undefined) {
    throw new AgentDriverConfigurationError(
      'OneRingAI stored/bound/factory sources own connector and instructions; runtime overrides are not supported',
    );
  }
}

function assertBoundScope(agent: Agent, context?: TrustedRuntimeContext): void {
  if (context?.userId !== undefined && agent.userId !== context.userId) {
    throw new AgentDriverConfigurationError(
      `Bound OneRingAI agent user scope does not match runtime user '${context.userId}'`,
    );
  }
}

function validateModel(model: string, expectedVendor?: string): void {
  const info = getModelInfo(model);
  if (!info) return;
  if (!info.isActive) {
    throw new AgentDriverConfigurationError(`OneRingAI agent model '${model}' is not active`);
  }
  if (expectedVendor !== undefined && info.provider !== expectedVendor) {
    throw new AgentDriverConfigurationError(
      `OneRingAI agent model '${model}' belongs to '${info.provider}', not connector vendor '${expectedVendor}'`,
    );
  }
}

function validateReasoning(reasoning?: RuntimeReasoningConfig): void {
  if (!reasoning) return;
  if (reasoning.enabled !== undefined && typeof reasoning.enabled !== 'boolean') {
    throw new AgentDriverConfigurationError('OneRingAI reasoning.enabled must be a boolean');
  }
  if (reasoning.budgetTokens !== undefined && (
    !Number.isSafeInteger(reasoning.budgetTokens) || reasoning.budgetTokens <= 0
  )) {
    throw new AgentDriverConfigurationError('OneRingAI reasoning.budgetTokens must be a positive safe integer');
  }
  if (reasoning.effort === 'ultra') {
    throw new AgentDriverConfigurationError("OneRingAI's provider-neutral reasoning API does not support effort 'ultra'");
  }
  if (reasoning.enabled === false && (reasoning.effort !== undefined || reasoning.budgetTokens !== undefined)) {
    throw new AgentDriverConfigurationError(
      'OneRingAI reasoning.enabled=false cannot be combined with effort or budgetTokens',
    );
  }
}

function validateReasoningForModel(
  model: string,
  reasoning: RuntimeReasoningConfig | undefined,
  modelReasoningControls: Readonly<Record<string, NormalizedReasoningControls>>,
): void {
  validateReasoning(reasoning);
  if (!reasoning) return;
  const info = getModelInfo(model);
  if (info?.features.reasoning === false) {
    throw new AgentDriverConfigurationError(
      `OneRingAI model '${model}' does not support reasoning controls`,
    );
  }
  const controls = modelReasoningControls[model];
  if (reasoning.enabled === false && !controls?.supportsDisabled) {
    throw new AgentDriverConfigurationError(
      `OneRingAI model '${model}' has no verified reasoning-disable mapping`,
    );
  }
  if (reasoning.budgetTokens !== undefined && !controls?.supportsBudgetTokens) {
    throw new AgentDriverConfigurationError(
      `OneRingAI model '${model}' has no verified reasoning-token-budget mapping`,
    );
  }
  if (reasoning.effort !== undefined) {
    if (!controls) {
      throw new AgentDriverConfigurationError(
        `OneRingAI model '${model}' has no verified reasoning-effort mapping; configure OneRingAIDriver.modelReasoningControls before selecting an explicit effort`,
      );
    }
    if (!controls.efforts.has(reasoning.effort)) {
      throw new AgentDriverConfigurationError(
        `OneRingAI model '${model}' does not support reasoning effort '${reasoning.effort}'; supported: ${[...controls.efforts].join(', ') || 'none'}`,
      );
    }
  }
}

function toThinkingConfig(reasoning?: RuntimeReasoningConfig): ThinkingConfig | undefined {
  if (!reasoning) return undefined;
  return {
    enabled: reasoning.enabled ?? true,
    ...(reasoning.effort ? { effort: reasoning.effort as ThinkingConfig['effort'] } : {}),
    ...(reasoning.budgetTokens !== undefined ? { budgetTokens: reasoning.budgetTokens } : {}),
  };
}

function oneRingCapabilities(
  model?: string,
  reasoning?: RuntimeReasoningConfig,
  modelReasoningControls: Readonly<Record<string, NormalizedReasoningControls>> = DEFAULT_MODEL_REASONING_CONTROLS,
): ResolvedAgentCapabilities {
  const modelSupportsReasoning = model ? getModelInfo(model)?.features.reasoning !== false : true;
  const controls = model ? modelReasoningControls[model] : undefined;
  const capabilities: AgentCapability[] = [
    capability('session.continue', 'native'),
    capability('session.restore', 'unsupported', 'Runtime-level durable restore is deferred'),
    capability('run.cancel', 'emulated', 'Cancellation is observed at OneRingAI agent-loop boundaries'),
    capability('run.structured_output', 'emulated'),
    capability('run.model_override', 'emulated', 'The selected model is applied to the native Agent for one run'),
    capability('run.reasoning_override', 'native', undefined, {
      requiresReasoningModel: true,
      verifiedEfforts: controls ? [...controls.efforts] : [],
      supportsDisabled: controls?.supportsDisabled ?? false,
      supportsBudgetTokens: controls?.supportsBudgetTokens ?? false,
    }),
    capability('run.interaction', 'unsupported'),
    capability('run.approval', 'unsupported', 'The local adapter has no bidirectional approval bridge'),
    capability('run.user_input', 'unsupported', 'The local adapter has no bidirectional user-input bridge'),
    capability('run.steer', 'unsupported'),
    capability('input.image', 'unsupported'),
    capability('event.live', 'native'),
    capability('event.message', 'native'),
    modelSupportsReasoning
      ? capability('event.reasoning', 'native', 'Visibility depends on the selected provider and model')
      : capability('event.reasoning', 'unsupported', `Model '${model}' does not expose reasoning`),
    capability('event.plan', 'unsupported'),
    capability('event.command', 'unsupported'),
    capability('event.command_output', 'unsupported'),
    capability('event.file_change', 'unsupported'),
    capability('event.tool', 'native'),
    capability('event.tool_progress', 'native'),
    capability('isolation.workspace', 'unsupported'),
    capability('isolation.tenant', 'unsupported'),
  ];
  return {
    driverId: 'oneringai.agent',
    capabilities: Object.fromEntries(capabilities.map((item) => [item.id, item])),
    configuration: {
      ...(model ? { model } : {}),
      ...(reasoning ? { reasoning } : {}),
    },
  };
}

interface NormalizedReasoningControls {
  efforts: ReadonlySet<RuntimeReasoningEffort>;
  supportsDisabled: boolean;
  supportsBudgetTokens: boolean;
}

function reasoningControls(
  efforts: readonly RuntimeReasoningEffort[],
  supportsDisabled = false,
  supportsBudgetTokens = false,
): NormalizedReasoningControls {
  return Object.freeze({
    efforts: new Set(efforts),
    supportsDisabled,
    supportsBudgetTokens,
  });
}

function normalizeModelReasoningControls(
  custom?: Readonly<Record<string, OneRingModelReasoningControls>>,
): Readonly<Record<string, NormalizedReasoningControls>> {
  const result: Record<string, NormalizedReasoningControls> = { ...DEFAULT_MODEL_REASONING_CONTROLS };
  for (const [model, controls] of Object.entries(custom ?? {})) {
    if (!model.trim() || !controls || typeof controls !== 'object' || Array.isArray(controls)) {
      throw new AgentDriverConfigurationError(
        'OneRingAI modelReasoningControls entries require a non-empty model and a controls object',
      );
    }
    const efforts = controls.efforts ?? [];
    if (!Array.isArray(efforts)) {
      throw new AgentDriverConfigurationError(
        `OneRingAI modelReasoningControls for '${model}' must provide an efforts array`,
      );
    }
    for (const effort of efforts) {
      if (!ONERING_REASONING_EFFORTS.has(effort)) {
        throw new AgentDriverConfigurationError(
          `OneRingAI modelReasoningControls for '${model}' contains unsupported effort '${effort}'`,
        );
      }
    }
    for (const [field, value] of [
      ['supportsDisabled', controls.supportsDisabled],
      ['supportsBudgetTokens', controls.supportsBudgetTokens],
    ] as const) {
      if (value !== undefined && typeof value !== 'boolean') {
        throw new AgentDriverConfigurationError(
          `OneRingAI modelReasoningControls for '${model}' field '${field}' must be a boolean`,
        );
      }
    }
    result[model] = reasoningControls(
      efforts,
      controls.supportsDisabled === true,
      controls.supportsBudgetTokens === true,
    );
  }
  return Object.freeze(result);
}

function capability(
  id: AgentCapability['id'],
  support: AgentCapability['support'],
  reason?: string,
  constraints?: AgentCapability['constraints'],
): AgentCapability {
  return {
    id,
    support,
    ...(reason ? { reason } : {}),
    ...(constraints ? { constraints } : {}),
  };
}

function toOneRingInput(input: DriverRunRequest['input']): string {
  if (typeof input === 'string') return input;
  const unsupported = input.parts.find((part) => part.type !== 'text');
  if (unsupported) throw new AgentDriverConfigurationError('The OneRingAI PoC driver accepts text input parts only');
  return input.parts.map((part) => part.type === 'text' ? part.text : '').join('\n\n');
}

function mapOneRingEvent(event: StreamEvent): DriverEvent | undefined {
  switch (event.type) {
    case StreamEventType.OUTPUT_TEXT_DELTA:
      return { type: 'agent.message.delta' as const, data: { text: event.delta, phase: 'unknown' } };
    case StreamEventType.OUTPUT_TEXT_DONE:
      return { type: 'agent.message.completed' as const, data: { text: event.text, phase: 'unknown' } };
    case StreamEventType.REASONING_DELTA:
      return { type: 'reasoning.delta' as const, data: { id: event.item_id, text: event.delta, kind: 'vendor' } };
    case StreamEventType.REASONING_DONE:
      return { type: 'reasoning.completed' as const, data: { id: event.item_id, text: event.thinking, kind: 'vendor' } };
    case StreamEventType.TOOL_CALL_START:
      return {
        type: 'tool.progress' as const,
        data: { id: event.tool_call_id, name: event.tool_name, stage: 'arguments-started' },
      };
    case StreamEventType.TOOL_CALL_ARGUMENTS_DELTA:
      return {
        type: 'tool.progress' as const,
        data: { id: event.tool_call_id, name: event.tool_name, stage: 'arguments', delta: event.delta },
      };
    case StreamEventType.TOOL_CALL_ARGUMENTS_DONE:
      return {
        type: 'tool.progress' as const,
        data: { id: event.tool_call_id, name: event.tool_name, stage: 'arguments-completed' },
      };
    case StreamEventType.TOOL_EXECUTION_START:
      return {
        type: 'tool.started' as const,
        data: { id: event.tool_call_id, name: event.tool_name, arguments: toJsonValue(event.arguments) },
      };
    case StreamEventType.TOOL_EXECUTION_DONE:
      return {
        type: 'tool.completed' as const,
        data: {
          id: event.tool_call_id,
          name: event.tool_name,
          result: toJsonValue(event.result),
          durationMs: event.execution_time_ms,
          error: event.error ?? null,
        },
      };
    case StreamEventType.RESPONSE_COMPLETE:
      return { type: 'usage.updated' as const, data: toJsonObject(mapUsage(event.usage)) };
    case StreamEventType.ITERATION_COMPLETE:
      return {
        type: 'agent.iteration.completed' as const,
        data: {
          iteration: event.iteration,
          toolCalls: event.tool_calls_count,
          hasMoreIterations: event.has_more_iterations,
        },
      };
    case StreamEventType.ERROR:
      return {
        type: 'diagnostic' as const,
        data: { level: 'error', code: event.error.code ?? event.error.type, message: event.error.message },
      };
    case StreamEventType.RETRY:
      return {
        type: 'diagnostic' as const,
        data: { level: 'warning', code: 'RETRY', attempt: event.attempt, reason: event.reason },
      };
    default:
      return undefined;
  }
}

function mapUsage(usage: TokenUsage): RuntimeUsage {
  return {
    inputTokens: usage.input_tokens,
    cachedInputTokens: usage.cached_input_tokens,
    cacheWriteInputTokens: usage.cache_creation_input_tokens,
    outputTokens: usage.output_tokens,
    reasoningTokens: usage.output_tokens_details?.reasoning_tokens,
    totalTokens: usage.total_tokens,
  };
}

function failedResult(error: AgentNativeExecutionError): DriverRunResult {
  const safeError: AgentRunErrorInfo = { code: error.code, message: error.message, retryable: false };
  return { status: 'failed', outputText: '', error: safeError, finishReason: 'native_error' };
}
