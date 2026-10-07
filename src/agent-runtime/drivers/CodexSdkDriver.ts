import { access, mkdtemp, realpath, rm } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type {
  Codex,
  CodexOptions,
  Input,
  ModelReasoningEffort,
  Thread,
  ThreadEvent,
  ThreadItem,
  ThreadOptions,
  Usage,
} from '@openai/codex-sdk';
import { Vendor } from '../../core/Vendor.js';
import { getModelInfo } from '../../domain/entities/Model.js';
import type {
  AgentDriver,
  DriverDescriptor,
  DriverEvent,
  DriverOpenSessionRequest,
  DriverRun,
  DriverRunRequest,
  DriverRunResult,
  DriverSession,
} from '../AgentDriver.js';
import {
  AgentDriverConfigurationError,
  AgentNativeExecutionError,
  AgentPolicyUnsupportedError,
  AgentRuntimeDependencyError,
  AgentStructuredOutputError,
  AgentWorkspaceError,
} from '../errors.js';
import { createDeferred, errorMessage, toJsonValue } from '../internal.js';
import { parseAndValidateStructuredOutput } from '../StructuredOutputValidator.js';
import type {
  AgentArtifact,
  AgentCapability,
  AgentRunErrorInfo,
  JsonObject,
  ResolvedAgentCapabilities,
  RuntimeAgentSpec,
  RuntimeReasoningConfig,
  RuntimeUsage,
} from '../types.js';

const DRIVER_ID = 'openai.codex.sdk';
const MAX_EVENT_TEXT_BYTES = 64 * 1024;
const IMAGE_EXTENSIONS = new Set(['.avif', '.gif', '.jpeg', '.jpg', '.png', '.webp']);
const REASONING_EFFORTS = new Set<ModelReasoningEffort>([
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'ultra',
]);
const MODEL_REASONING_EFFORTS: Readonly<Record<string, ReadonlySet<ModelReasoningEffort>>> = {
  'gpt-6-astra': new Set(['low', 'medium', 'high', 'xhigh', 'max', 'ultra']),
  'gpt-6.1-sol': new Set(['low', 'medium', 'high', 'xhigh', 'max', 'ultra']),
  'gpt-6-sol': new Set(['low', 'medium', 'high', 'xhigh', 'max', 'ultra']),
  'gpt-6-luna': new Set(['low', 'medium', 'high', 'xhigh', 'max']),
  'gpt-5.6-sol': new Set(['low', 'medium', 'high', 'xhigh', 'max', 'ultra']),
  'gpt-5.6-terra': new Set(['low', 'medium', 'high', 'xhigh', 'max', 'ultra']),
  'gpt-5.6-luna': new Set(['low', 'medium', 'high', 'xhigh', 'max']),
  'gpt-5.3-codex': new Set(['low', 'medium', 'high', 'xhigh']),
};

type CodexConstructor = new (options?: CodexOptions) => Codex;

export interface CodexSdkDriverOptions {
  /** Test/embedding seam. Ordinary applications should use the bundled SDK loader. */
  loadSdk?: () => Promise<{ Codex: CodexConstructor }>;
  /**
   * Verified model/effort combinations for models newer than the bundled map.
   * Explicit efforts fail closed when a model has no verified entry.
   */
  modelReasoningEfforts?: Readonly<Record<string, readonly ModelReasoningEffort[]>>;
}

interface ParsedCodexConfig {
  skipGitRepoCheck: boolean;
  allowProjectConfig: boolean;
}

export class CodexSdkDriver implements AgentDriver {
  readonly id = DRIVER_ID;
  private readonly modelReasoningEfforts: Readonly<Record<string, ReadonlySet<ModelReasoningEffort>>>;

  constructor(private readonly options: CodexSdkDriverOptions = {}) {
    this.modelReasoningEfforts = normalizeModelReasoningEfforts(options.modelReasoningEfforts);
  }

  async inspect(context: Parameters<AgentDriver['inspect']>[0]): Promise<DriverDescriptor> {
    validateSpec(context.spec);
    const config = parseDriverConfig(context.spec);
    validateCodexReasoning(context.spec.model!, context.spec.reasoning, this.modelReasoningEfforts);
    validatePolicy(context);
    validateConnectorAndModel(context);
    if (!context.workspace) {
      throw new AgentWorkspaceError('The local Codex SDK driver requires an explicit local-directory workspace');
    }
    const projectConfig = await findProjectConfig(context.workspace.root);
    if (projectConfig && !config.allowProjectConfig) {
      throw new AgentDriverConfigurationError(
        `Codex project configuration '${projectConfig}' is disabled by default; set driverConfig.allowProjectConfig only for a trusted workspace`,
      );
    }
    await this.loadSdk();
    return {
      capabilities: codexCapabilities(
        context.spec.model!,
        context.spec.reasoning,
        this.modelReasoningEfforts,
      ),
    };
  }

  async openSession(request: DriverOpenSessionRequest): Promise<DriverSession> {
    await this.inspect(request);
    const config = parseDriverConfig(request.spec);
    const { Codex: CodexClass } = await this.loadSdk();
    const connector = request.connectorRegistry.get(request.spec.connector!);
    const apiKey = await connector.getToken();
    const redact = createRedactor([apiKey]);
    const codexHome = await mkdtemp(path.join(tmpdir(), 'oneringai-codex-'));
    try {
      const codex = new CodexClass({
        apiKey,
        // Pin the built-in provider endpoint as a later CLI override so a
        // trusted project config cannot silently redirect connector secrets.
        baseUrl: connector.baseURL || 'https://api.openai.com/v1',
        env: isolatedCodexEnvironment(codexHome),
        config: {
          model_provider: 'openai',
          developer_instructions: request.spec.instructions ?? '',
          show_raw_agent_reasoning: false,
          allow_login_shell: false,
          agents: { enabled: false },
          features: {
            multi_agent: false,
            collab: false,
            memories: false,
          },
          shell_environment_policy: {
            inherit: 'core',
            ignore_default_excludes: false,
            exclude: ['*KEY*', '*SECRET*', '*TOKEN*'],
            include_only: [
              'PATH',
              'HOME',
              'TMPDIR',
              'TEMP',
              'TMP',
              'LANG',
              'LC_*',
              'SHELL',
              'USER',
              'LOGNAME',
            ],
            experimental_use_profile: false,
          },
        },
      });
      return new CodexDriverSession(
        codex,
        toThreadOptions(request, config),
        request.workspace!.root,
        codexHome,
        redact,
        [apiKey],
        config.allowProjectConfig,
        request.spec.reasoning,
        this.modelReasoningEfforts,
      );
    } catch (error) {
      await rm(codexHome, { recursive: true, force: true });
      throw new AgentDriverConfigurationError(`Failed to initialize Codex SDK: ${redact(errorMessage(error))}`);
    }
  }

  private async loadSdk(): Promise<{ Codex: CodexConstructor }> {
    try {
      const sdk = this.options.loadSdk
        ? await this.options.loadSdk()
        : await import('@openai/codex-sdk');
      if (typeof sdk.Codex !== 'function' || typeof sdk.Codex.prototype?.startThread !== 'function') {
        throw new Error('The module does not expose the supported Codex.startThread API');
      }
      return { Codex: sdk.Codex as CodexConstructor };
    } catch (error) {
      if (error instanceof AgentRuntimeDependencyError) throw error;
      throw new AgentRuntimeDependencyError(
        '@openai/codex-sdk',
        `Unable to load @openai/codex-sdk: ${errorMessage(error)}`,
        error instanceof Error ? error : undefined,
      );
    }
  }
}

class CodexDriverSession implements DriverSession {
  private _isDestroyed = false;
  private thread?: Thread;

  constructor(
    private readonly codex: Codex,
    private readonly baseThreadOptions: ThreadOptions,
    private readonly workspaceRoot: string,
    private readonly codexHome: string,
    private readonly redact: (text: string) => string,
    private readonly secrets: string[],
    private readonly allowProjectConfig: boolean,
    private readonly defaultReasoning?: RuntimeReasoningConfig,
    private readonly modelReasoningEfforts: Readonly<Record<string, ReadonlySet<ModelReasoningEffort>>> = MODEL_REASONING_EFFORTS,
  ) {}

  get nativeSessionId(): string | undefined {
    return this.thread?.id ?? undefined;
  }

  get isDestroyed(): boolean {
    return this._isDestroyed;
  }

  async run(request: DriverRunRequest): Promise<DriverRun> {
    if (this._isDestroyed) throw new Error('Codex SDK driver session has been destroyed');
    if (!this.allowProjectConfig) {
      const projectConfig = await findProjectConfig(this.workspaceRoot);
      if (projectConfig) {
        throw new AgentDriverConfigurationError(
          `Codex project configuration '${projectConfig}' appeared after session creation and is disabled`,
        );
      }
    }
    const input = await toCodexInput(request.input, this.workspaceRoot);
    const model = request.model ?? this.baseThreadOptions.model;
    if (!model) throw new AgentDriverConfigurationError('Codex run model is required');
    const reasoning = request.reasoning ?? this.defaultReasoning;
    validateCodexModel(model);
    validateCodexReasoning(model, reasoning, this.modelReasoningEfforts);
    const threadOptions: ThreadOptions = {
      ...this.baseThreadOptions,
      model,
      modelReasoningEffort: reasoning?.effort as ModelReasoningEffort | undefined,
    };
    this.thread = this.thread?.id
      ? this.codex.resumeThread(this.thread.id, threadOptions)
      : this.codex.startThread(threadOptions);
    const thread = this.thread;
    let streamed: Awaited<ReturnType<Thread['runStreamed']>>;
    try {
      if (!this.allowProjectConfig) {
        const projectConfig = await findProjectConfig(this.workspaceRoot);
        if (projectConfig) {
          throw new AgentDriverConfigurationError(
            `Codex project configuration '${projectConfig}' appeared before turn start and is disabled`,
          );
        }
      }
      streamed = await thread.runStreamed(input, {
        ...(request.responseFormat?.type === 'json_schema'
          ? { outputSchema: request.responseFormat.schema }
          : {}),
        signal: request.signal,
      });
    } catch (error) {
      throw new AgentNativeExecutionError(DRIVER_ID, this.redact(errorMessage(error)));
    }
    const deferred = createDeferred<DriverRunResult>();
    const workspaceRoot = this.workspaceRoot;
    const events = mapCodexEvents(
      streamed.events,
      request,
      thread,
      workspaceRoot,
      this.redact,
      this.secrets,
      { model, ...(reasoning ? { reasoning } : {}) },
      deferred.resolve,
    );
    return {
      events,
      result: deferred.promise,
      // Cancellation is delivered by the AbortSignal passed to runStreamed.
      cancel: async () => undefined,
    };
  }

  async cancelActiveRun(): Promise<void> {
    // The local backend owns the active run's AbortController.
  }

  async destroy(): Promise<void> {
    if (this._isDestroyed) return;
    this._isDestroyed = true;
    await rm(this.codexHome, { recursive: true, force: true });
  }
}

async function* mapCodexEvents(
  nativeEvents: AsyncIterable<ThreadEvent>,
  request: DriverRunRequest,
  thread: Thread,
  workspaceRoot: string,
  redact: (text: string) => string,
  secrets: string[],
  configuration: NonNullable<DriverRunResult['configuration']>,
  resolve: (result: DriverRunResult) => void,
): AsyncGenerator<DriverEvent> {
  const textStreams = new Map<string, IncrementalTextState>();
  const artifacts: AgentArtifact[] = [];
  let finalResponse = '';
  let usage: RuntimeUsage | undefined;
  let failure: AgentRunErrorInfo | undefined;
  let completed = false;

  try {
    for await (const event of nativeEvents) {
      switch (event.type) {
        case 'thread.started':
        case 'turn.started':
          break;
        case 'turn.completed':
          usage = mapUsage(event.usage);
          yield { type: 'usage.updated', data: usageData(usage) };
          completed = true;
          break;
        case 'turn.failed':
          failure = { code: 'CODEX_TURN_FAILED', message: redact(event.error.message), retryable: false };
          break;
        case 'error':
          failure = { code: 'CODEX_STREAM_ERROR', message: redact(event.message), retryable: false };
          break;
        case 'item.started': {
          const mapped = mapStartedItem(event.item, workspaceRoot, redact);
          for (const item of mapped) yield item;
          if (event.item.type === 'agent_message') {
            const delta = nextSafeDelta(event.item.id, event.item.text, textStreams, secrets);
            if (delta) yield { type: 'agent.message.delta', data: { text: delta, phase: 'unknown' } };
          } else if (event.item.type === 'reasoning') {
            const delta = nextSafeDelta(event.item.id, event.item.text, textStreams, secrets);
            if (delta) yield { type: 'reasoning.delta', data: { id: event.item.id, text: delta, kind: 'summary' } };
          } else if (event.item.type === 'command_execution') {
            const delta = nextSafeDelta(event.item.id, event.item.aggregated_output, textStreams, secrets);
            if (delta) yield { type: 'command.output.delta', data: { id: event.item.id, text: delta } };
          }
          break;
        }
        case 'item.updated': {
          if (event.item.type === 'agent_message') {
            const delta = nextSafeDelta(event.item.id, event.item.text, textStreams, secrets);
            if (delta) yield { type: 'agent.message.delta', data: { text: delta, phase: 'unknown' } };
          } else if (event.item.type === 'reasoning') {
            const delta = nextSafeDelta(event.item.id, event.item.text, textStreams, secrets);
            if (delta) yield { type: 'reasoning.delta', data: { id: event.item.id, text: delta, kind: 'summary' } };
          } else if (event.item.type === 'command_execution') {
            const delta = nextSafeDelta(event.item.id, event.item.aggregated_output, textStreams, secrets);
            if (delta) yield { type: 'command.output.delta', data: { id: event.item.id, text: delta } };
          } else if (event.item.type === 'todo_list') {
            yield planEvent(event.item, redact, false);
          }
          break;
        }
        case 'item.completed': {
          if (event.item.type === 'agent_message') {
            const safeText = redact(event.item.text);
            const delta = nextSafeDelta(event.item.id, event.item.text, textStreams, secrets, true);
            if (delta) yield { type: 'agent.message.delta', data: { text: delta, phase: 'unknown' } };
            finalResponse = safeText;
            yield { type: 'agent.message.completed', data: { text: boundEventText(safeText), phase: 'unknown' } };
          } else if (event.item.type === 'reasoning') {
            const delta = nextSafeDelta(event.item.id, event.item.text, textStreams, secrets, true);
            if (delta) yield { type: 'reasoning.delta', data: { id: event.item.id, text: delta, kind: 'summary' } };
            yield {
              type: 'reasoning.completed',
              data: { id: event.item.id, text: boundEventText(redact(event.item.text)), kind: 'summary' },
            };
          } else if (event.item.type === 'command_execution') {
            const delta = nextSafeDelta(
              event.item.id,
              event.item.aggregated_output,
              textStreams,
              secrets,
              true,
            );
            if (delta) yield { type: 'command.output.delta', data: { id: event.item.id, text: delta } };
            for (const item of mapCompletedItem(event.item, workspaceRoot, artifacts, redact)) yield item;
          } else {
            const mapped = mapCompletedItem(event.item, workspaceRoot, artifacts, redact);
            for (const item of mapped) yield item;
          }
          break;
        }
      }
    }

    if (failure) {
      resolve({
        status: request.signal.aborted ? 'cancelled' : 'failed',
        outputText: finalResponse,
        artifacts,
        usage,
        finishReason: request.signal.aborted ? 'cancelled' : 'native_error',
        error: request.signal.aborted ? undefined : failure,
        native: { threadId: thread.id ?? null },
        configuration,
      });
      return;
    }

    if (request.signal.aborted) {
      resolve({
        status: 'cancelled',
        outputText: finalResponse,
        artifacts,
        usage,
        finishReason: 'cancelled',
        native: { threadId: thread.id ?? null },
        configuration,
      });
      return;
    }

    if (!completed) {
      failure = { code: 'CODEX_STREAM_INCOMPLETE', message: 'Codex event stream ended without turn.completed' };
      resolve({
        status: 'failed',
        outputText: finalResponse,
        artifacts,
        usage,
        finishReason: 'stream_incomplete',
        error: failure,
        native: { threadId: thread.id ?? null },
        configuration,
      });
      return;
    }

    let outputParsed;
    try {
      if (request.responseFormat) {
        outputParsed = parseAndValidateStructuredOutput(finalResponse, request.responseFormat);
      }
    } catch (error) {
      const structuredError = error instanceof AgentStructuredOutputError
        ? error
        : new AgentStructuredOutputError(errorMessage(error), error instanceof Error ? error : undefined);
      resolve({
        status: 'failed',
        outputText: finalResponse,
        artifacts,
        usage,
        finishReason: 'structured_output_invalid',
        error: { code: structuredError.code, message: structuredError.message, retryable: false },
        enforcement: { structuredOutput: 'native' },
        native: { threadId: thread.id ?? null },
        configuration,
      });
      return;
    }

    resolve({
      status: 'completed',
      outputText: finalResponse,
      outputParsed,
      artifacts,
      usage,
      finishReason: 'completed',
      ...(request.responseFormat?.type === 'json_schema'
        ? { enforcement: { structuredOutput: 'native' as const } }
        : {}),
      native: { threadId: thread.id ?? null },
      configuration,
    });
  } catch (error) {
    const nativeError = new AgentNativeExecutionError(DRIVER_ID, redact(errorMessage(error)));
    resolve({ ...failedResult(nativeError, request.signal.aborted), configuration });
    throw error;
  }
}

function mapStartedItem(
  item: ThreadItem,
  workspaceRoot: string,
  redact: (text: string) => string,
): DriverEvent[] {
  switch (item.type) {
    case 'command_execution':
      return [{ type: 'command.started', data: { id: item.id, command: boundEventText(redact(item.command)) } }];
    case 'mcp_tool_call':
      return [{
        type: 'tool.started',
        data: { id: item.id, name: `${item.server}.${item.tool}`, arguments: redactJson(item.arguments, redact) },
      }];
    case 'web_search':
      return [{ type: 'tool.started', data: { id: item.id, name: 'web_search', arguments: { query: redact(item.query) } } }];
    case 'file_change':
      return item.changes.flatMap((change) => {
        const safePath = workspaceRelativePath(change.path, workspaceRoot);
        return safePath
          ? [{
              type: 'file.change.started' as const,
              data: { id: item.id, path: safePath, change: normalizeFileChange(change.kind) },
            }]
          : [];
      });
    case 'todo_list':
      return [planEvent(item, redact, false)];
    default:
      return [];
  }
}

function mapCompletedItem(
  item: ThreadItem,
  workspaceRoot: string,
  artifacts: AgentArtifact[],
  redact: (text: string) => string,
): DriverEvent[] {
  switch (item.type) {
    case 'command_execution':
      return [{
        type: 'command.completed',
        data: {
          id: item.id,
          command: boundEventText(redact(item.command)),
          output: boundEventText(redact(item.aggregated_output)),
          exitCode: item.exit_code ?? null,
          status: item.status,
        },
      }];
    case 'file_change': {
      const events: DriverEvent[] = [];
      for (const change of item.changes) {
        const safePath = workspaceRelativePath(change.path, workspaceRoot);
        if (!safePath) {
          events.push({
            type: 'diagnostic',
            data: { level: 'warning', code: 'FILE_CHANGE_OUTSIDE_WORKSPACE', message: 'Ignored a file-change path outside the workspace' },
          });
          continue;
        }
        const normalizedChange = normalizeFileChange(change.kind);
        artifacts.push({ type: 'workspace-change', path: safePath, change: normalizedChange });
        events.push({
          type: 'file.changed',
          data: { id: item.id, path: safePath, change: normalizedChange, status: item.status },
        });
      }
      return events;
    }
    case 'mcp_tool_call':
      return [{
        type: 'tool.completed',
        data: {
          id: item.id,
          name: `${item.server}.${item.tool}`,
          status: item.status,
          result: redactJson(item.result ?? null, redact),
          error: item.error ? redact(item.error.message) : null,
        },
      }];
    case 'web_search':
      return [{
        type: 'tool.completed',
        data: { id: item.id, name: 'web_search', status: 'completed', result: { query: redact(item.query) } },
      }];
    case 'todo_list':
      return [planEvent(item, redact, true)];
    case 'error':
      return [{
        type: 'diagnostic',
        data: { level: 'error', code: 'CODEX_ITEM_ERROR', message: boundEventText(redact(item.message)) },
      }];
    default:
      return [];
  }
}

function planEvent(
  item: Extract<ThreadItem, { type: 'todo_list' }>,
  redact: (text: string) => string,
  completed: boolean,
): DriverEvent {
  return {
    type: 'plan.updated',
    data: { id: item.id, items: redactJson(item.items, redact), completed },
  };
}

function normalizeFileChange(kind: 'add' | 'delete' | 'update'): 'created' | 'deleted' | 'modified' {
  return kind === 'add' ? 'created' : kind === 'delete' ? 'deleted' : 'modified';
}

function validateSpec(spec: Readonly<RuntimeAgentSpec>): void {
  if (!spec.connector?.trim()) throw new AgentDriverConfigurationError('Codex SDK agent spec connector is required');
  if (!spec.model?.trim()) throw new AgentDriverConfigurationError('Codex SDK agent spec model is required');
}

function validatePolicy(context: Parameters<AgentDriver['inspect']>[0]): void {
  const policy = context.policy;
  if (!policy) return;
  if (policy.filesystem === 'denied') {
    throw new AgentPolicyUnsupportedError('Codex requires at least read-only workspace access');
  }
  if (policy.commands === 'denied') {
    throw new AgentPolicyUnsupportedError('The Codex SDK does not provide an enforceable shell-disabled execution mode');
  }
  if (policy.approvals === 'interactive') {
    throw new AgentPolicyUnsupportedError('Interactive Codex approval requests are not supported by the local runtime PoC');
  }
}

function validateConnectorAndModel(context: Parameters<AgentDriver['inspect']>[0]): void {
  const connector = context.connectorRegistry.get(context.spec.connector!);
  if (connector.vendor !== Vendor.OpenAI) {
    throw new AgentDriverConfigurationError(`Codex SDK connector '${connector.name}' must declare Vendor.OpenAI`);
  }
  if (connector.config.auth.type !== 'api_key'
    && connector.config.auth.type !== 'api_key_provider') {
    throw new AgentDriverConfigurationError(
      `Codex SDK connector '${connector.name}' must use api_key or api_key_provider authentication`,
    );
  }
  if (connector.config.options?.organization || connector.config.options?.project) {
    throw new AgentDriverConfigurationError(
      `Codex SDK connector '${connector.name}' sets organization/project options that @openai/codex-sdk cannot forward`,
    );
  }
  validateCodexModel(context.spec.model!);
}

function validateCodexModel(modelName: string): void {
  const model = getModelInfo(modelName);
  if (!model) throw new AgentDriverConfigurationError(`Codex SDK model '${modelName}' is not in the model registry`);
  if (model.provider !== Vendor.OpenAI) {
    throw new AgentDriverConfigurationError(`Codex SDK model '${modelName}' must be an OpenAI model`);
  }
  if (!model.isActive) throw new AgentDriverConfigurationError(`Codex SDK model '${modelName}' is not active`);
}

function validateCodexReasoning(
  model: string,
  reasoning: RuntimeReasoningConfig | undefined,
  modelReasoningEfforts: Readonly<Record<string, ReadonlySet<ModelReasoningEffort>>>,
): void {
  if (!reasoning) return;
  if (reasoning.enabled === false) {
    throw new AgentDriverConfigurationError('The Codex SDK cannot disable model reasoning');
  }
  if (reasoning.budgetTokens !== undefined) {
    throw new AgentDriverConfigurationError('The Codex SDK does not support reasoning token budgets');
  }
  if (getModelInfo(model)?.features.reasoning === false) {
    throw new AgentDriverConfigurationError(`Codex model '${model}' does not support reasoning controls`);
  }
  if (!reasoning.effort) return;
  if (!REASONING_EFFORTS.has(reasoning.effort as ModelReasoningEffort)) {
    throw new AgentDriverConfigurationError(`Codex SDK reasoning effort '${reasoning.effort}' is not supported`);
  }
  const supported = modelReasoningEfforts[model];
  if (!supported) {
    throw new AgentDriverConfigurationError(
      `Codex model '${model}' has no verified reasoning-effort mapping; configure CodexSdkDriver.modelReasoningEfforts before selecting an explicit effort`,
    );
  }
  if (!supported.has(reasoning.effort as ModelReasoningEffort)) {
    throw new AgentDriverConfigurationError(
      `Codex model '${model}' does not support reasoning effort '${reasoning.effort}'; supported: ${[...supported].join(', ')}`,
    );
  }
}

function normalizeModelReasoningEfforts(
  custom?: Readonly<Record<string, readonly ModelReasoningEffort[]>>,
): Readonly<Record<string, ReadonlySet<ModelReasoningEffort>>> {
  const result: Record<string, ReadonlySet<ModelReasoningEffort>> = { ...MODEL_REASONING_EFFORTS };
  for (const [model, efforts] of Object.entries(custom ?? {})) {
    if (!model.trim() || !Array.isArray(efforts) || efforts.length === 0) {
      throw new AgentDriverConfigurationError('Codex modelReasoningEfforts entries require a model and at least one effort');
    }
    for (const effort of efforts) {
      if (!REASONING_EFFORTS.has(effort)) {
        throw new AgentDriverConfigurationError(
          `Codex modelReasoningEfforts for '${model}' contains unsupported effort '${effort}'`,
        );
      }
    }
    result[model] = new Set(efforts);
  }
  return Object.freeze(result);
}

function parseDriverConfig(spec: Readonly<RuntimeAgentSpec>): ParsedCodexConfig {
  const config = spec.driverConfig ?? {};
  const unknown = Object.keys(config).filter(
    (key) => !['skipGitRepoCheck', 'allowProjectConfig'].includes(key),
  );
  if (unknown.length) {
    throw new AgentDriverConfigurationError(`Unknown Codex SDK driverConfig field(s): ${unknown.join(', ')}`);
  }
  for (const key of ['skipGitRepoCheck', 'allowProjectConfig'] as const) {
    if (config[key] !== undefined && typeof config[key] !== 'boolean') {
      throw new AgentDriverConfigurationError(`Codex SDK driverConfig.${key} must be a boolean`);
    }
  }
  return {
    skipGitRepoCheck: config.skipGitRepoCheck === true,
    allowProjectConfig: config.allowProjectConfig === true,
  };
}

function toThreadOptions(request: DriverOpenSessionRequest, config: ParsedCodexConfig): ThreadOptions {
  return {
    model: request.spec.model,
    sandboxMode: request.policy.filesystem === 'read-only' ? 'read-only' : 'workspace-write',
    workingDirectory: request.workspace!.root,
    skipGitRepoCheck: config.skipGitRepoCheck,
    ...(request.spec.reasoning?.effort
      ? { modelReasoningEffort: request.spec.reasoning.effort as ModelReasoningEffort }
      : {}),
    networkAccessEnabled: request.policy.sandboxNetwork === 'allowed',
    webSearchMode: request.policy.providerWebSearch === 'allowed' ? 'live' : 'disabled',
    approvalPolicy: 'never',
  };
}

async function toCodexInput(input: DriverRunRequest['input'], workspaceRoot: string): Promise<Input> {
  if (typeof input === 'string') return input;
  const result: Input = [];
  for (const part of input.parts) {
    if (part.type === 'text') {
      result.push({ type: 'text', text: part.text });
      continue;
    }
    if (part.mediaType && !part.mediaType.toLowerCase().startsWith('image/')) {
      throw new AgentDriverConfigurationError(`Codex workspace-file input '${part.path}' is not an image`);
    }
    const resolved = await resolveWorkspaceFile(part.path, workspaceRoot);
    if (!part.mediaType && !IMAGE_EXTENSIONS.has(path.extname(resolved).toLowerCase())) {
      throw new AgentDriverConfigurationError(`Codex workspace-file input '${part.path}' has no supported image type`);
    }
    result.push({ type: 'local_image', path: resolved });
  }
  return result;
}

async function resolveWorkspaceFile(file: string, workspaceRoot: string): Promise<string> {
  const candidate = path.resolve(workspaceRoot, file);
  let resolved: string;
  try {
    resolved = await realpath(candidate);
    await access(resolved, fsConstants.R_OK);
  } catch (error) {
    throw new AgentWorkspaceError(`Cannot read workspace file '${file}': ${errorMessage(error)}`, error as Error);
  }
  if (!isInsideWorkspace(resolved, workspaceRoot)) {
    throw new AgentWorkspaceError(`Workspace file '${file}' resolves outside the workspace`);
  }
  return resolved;
}

async function findProjectConfig(workspaceRoot: string): Promise<string | undefined> {
  let current = workspaceRoot;
  for (;;) {
    const config = path.join(current, '.codex', 'config.toml');
    try {
      await access(config, fsConstants.R_OK);
      return config;
    } catch {
      // Continue to the repository boundary.
    }
    const gitMarker = path.join(current, '.git');
    try {
      await access(gitMarker, fsConstants.R_OK);
      return undefined;
    } catch {
      // Not the repository boundary.
    }
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function isolatedCodexEnvironment(codexHome: string): Record<string, string> {
  const environment: Record<string, string> = {
    HOME: codexHome,
    CODEX_HOME: codexHome,
  };
  const exact = [
    'PATH',
    'TMPDIR',
    'TEMP',
    'TMP',
    'LANG',
    'SSL_CERT_FILE',
    'SSL_CERT_DIR',
    'NODE_EXTRA_CA_CERTS',
    'HTTP_PROXY',
    'HTTPS_PROXY',
    'NO_PROXY',
    'ALL_PROXY',
    'http_proxy',
    'https_proxy',
    'no_proxy',
    'all_proxy',
  ];
  for (const key of exact) {
    const value = process.env[key];
    if (value !== undefined) environment[key] = value;
  }
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('LC_') && value !== undefined) environment[key] = value;
  }
  return environment;
}

function createRedactor(secrets: string[]): (text: string) => string {
  const activeSecrets = secrets.filter((secret) => secret.length > 0);
  return (text: string) => activeSecrets.reduce(
    (sanitized, secret) => sanitized.split(secret).join('[REDACTED]'),
    text,
  );
}

function redactJson(value: unknown, redact: (text: string) => string): ReturnType<typeof toJsonValue> {
  const converted = toJsonValue(value);
  if (typeof converted === 'string') return redact(converted);
  if (Array.isArray(converted)) return converted.map((item) => redactJson(item, redact));
  if (converted && typeof converted === 'object') {
    return Object.fromEntries(
      Object.entries(converted).map(([key, item]) => [key, redactJson(item, redact)]),
    );
  }
  return converted;
}

interface IncrementalTextState {
  raw: string;
  redactor: StreamingSecretRedactor;
}

function nextSafeDelta(
  id: string,
  text: string,
  states: Map<string, IncrementalTextState>,
  secrets: string[],
  final = false,
): string {
  let state = states.get(id);
  let prefix = '';
  if (!state || !text.startsWith(state.raw)) {
    prefix = state?.redactor.finish() ?? '';
    state = { raw: '', redactor: new StreamingSecretRedactor(secrets) };
    states.set(id, state);
  }
  const delta = text.slice(state.raw.length);
  state.raw = text;
  const output = `${prefix}${state.redactor.push(delta)}${final ? state.redactor.finish() : ''}`;
  if (final) states.delete(id);
  return boundEventText(output);
}

class StreamingSecretRedactor {
  private buffer = '';
  private readonly secrets: string[];

  constructor(secrets: string[]) {
    this.secrets = [...new Set(secrets.filter(Boolean))].sort((left, right) => right.length - left.length);
  }

  push(chunk: string): string {
    this.buffer += chunk;
    return this.drain(false);
  }

  finish(): string {
    return this.drain(true);
  }

  private drain(final: boolean): string {
    let output = '';
    while (this.buffer) {
      const complete = this.secrets.find((secret) => this.buffer.startsWith(secret));
      if (complete) {
        output += '[REDACTED]';
        this.buffer = this.buffer.slice(complete.length);
        continue;
      }
      const partial = this.secrets.some((secret) => secret.startsWith(this.buffer));
      if (partial && !final) break;
      if (partial && final) {
        output += '[REDACTED]';
        this.buffer = '';
        break;
      }
      output += this.buffer[0];
      this.buffer = this.buffer.slice(1);
    }
    return output;
  }
}

function workspaceRelativePath(file: string, workspaceRoot: string): string | undefined {
  const absolute = path.isAbsolute(file) ? path.resolve(file) : path.resolve(workspaceRoot, file);
  if (!isInsideWorkspace(absolute, workspaceRoot)) return undefined;
  const relative = path.relative(workspaceRoot, absolute);
  return relative || '.';
}

function isInsideWorkspace(file: string, workspaceRoot: string): boolean {
  const relative = path.relative(workspaceRoot, file);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function mapUsage(usage: Usage): RuntimeUsage {
  return {
    inputTokens: usage.input_tokens,
    cachedInputTokens: usage.cached_input_tokens,
    cacheWriteInputTokens: usage.cache_write_input_tokens,
    outputTokens: usage.output_tokens,
    reasoningTokens: usage.reasoning_output_tokens,
    totalTokens: usage.input_tokens + usage.output_tokens,
  };
}

function usageData(usage: RuntimeUsage): JsonObject {
  const result: JsonObject = {};
  if (usage.inputTokens !== undefined) result.inputTokens = usage.inputTokens;
  if (usage.cachedInputTokens !== undefined) result.cachedInputTokens = usage.cachedInputTokens;
  if (usage.cacheWriteInputTokens !== undefined) result.cacheWriteInputTokens = usage.cacheWriteInputTokens;
  if (usage.outputTokens !== undefined) result.outputTokens = usage.outputTokens;
  if (usage.reasoningTokens !== undefined) result.reasoningTokens = usage.reasoningTokens;
  if (usage.totalTokens !== undefined) result.totalTokens = usage.totalTokens;
  return result;
}

function boundEventText(text: string): string {
  if (Buffer.byteLength(text, 'utf8') <= MAX_EVENT_TEXT_BYTES) return text;
  const suffix = '\n[event text truncated by Agent Runtime]';
  return `${truncateUtf8(text, MAX_EVENT_TEXT_BYTES - Buffer.byteLength(suffix, 'utf8'))}${suffix}`;
}

function truncateUtf8(text: string, maxBytes: number): string {
  if (maxBytes <= 0) return '';
  let truncated = Buffer.from(text, 'utf8').subarray(0, maxBytes).toString('utf8');
  if (truncated.endsWith('\uFFFD')) truncated = truncated.slice(0, -1);
  return truncated;
}

function codexCapabilities(
  model: string,
  reasoning: RuntimeReasoningConfig | undefined,
  modelReasoningEfforts: Readonly<Record<string, ReadonlySet<ModelReasoningEffort>>>,
): ResolvedAgentCapabilities {
  const modelSupportsReasoning = getModelInfo(model)?.features.reasoning !== false;
  const verifiedEfforts = modelReasoningEfforts[model];
  const capabilities: AgentCapability[] = [
    capability('session.continue', 'native'),
    capability('session.restore', 'unsupported', 'Durable cross-process resume is deferred'),
    capability('run.cancel', 'native'),
    capability('run.structured_output', 'native'),
    capability('run.model_override', 'native'),
    capability('run.reasoning_override', 'native', undefined, {
      requiresReasoningModel: true,
      verifiedEfforts: verifiedEfforts ? [...verifiedEfforts] : [],
    }),
    capability('run.interaction', 'unsupported'),
    capability('run.approval', 'unsupported', 'Use the future openai.codex.app-server driver'),
    capability('run.user_input', 'unsupported', 'Use the future openai.codex.app-server driver'),
    capability('run.steer', 'unsupported'),
    capability('input.image', 'native'),
    capability('event.live', 'native'),
    capability('event.message', 'native', 'The TypeScript SDK does not distinguish commentary from final phases'),
    modelSupportsReasoning
      ? capability('event.reasoning', 'native', 'The TypeScript SDK exposes readable reasoning summaries')
      : capability('event.reasoning', 'unsupported', `Model '${model}' does not expose reasoning`),
    capability('event.plan', 'native'),
    capability('event.command', 'native'),
    capability('event.command_output', 'native'),
    capability('event.file_change', 'native'),
    capability('event.tool', 'native'),
    capability('event.tool_progress', 'emulated', 'The SDK exposes tool lifecycle but limited intermediate progress'),
    capability('isolation.workspace', 'native'),
    capability('isolation.tenant', 'unsupported', 'The local PoC is process-local, not a tenant isolation boundary'),
  ];
  return {
    driverId: DRIVER_ID,
    capabilities: Object.fromEntries(capabilities.map((item) => [item.id, item])),
    configuration: { model, ...(reasoning ? { reasoning } : {}) },
  };
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

function failedResult(error: AgentNativeExecutionError, cancelled: boolean): DriverRunResult {
  return {
    status: cancelled ? 'cancelled' : 'failed',
    outputText: '',
    error: cancelled ? undefined : { code: error.code, message: error.message, retryable: false },
    finishReason: cancelled ? 'cancelled' : 'native_error',
  };
}
