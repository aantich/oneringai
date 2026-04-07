/**
 * Agent - AI assistant bound to a Connector
 *
 * This is the main public API for creating and using agents.
 * Extends BaseAgent for shared functionality.
 *
 * The agentic loop (tool calling, iterations) is implemented directly
 * in this class for clarity and simplicity.
 */

import { randomUUID } from 'crypto';
import { BaseAgent, BaseAgentConfig, BaseSessionConfig } from './BaseAgent.js';
import { ExecutionContext, HistoryMode } from '../capabilities/agents/ExecutionContext.js';
import { HookManager } from '../capabilities/agents/HookManager.js';
import { InputItem, MessageRole, OutputItem } from '../domain/entities/Message.js';
import { AgentResponse } from '../domain/entities/Response.js';
import { StreamEvent, StreamEventType, ResponseCompleteEvent, isToolCallArgumentsDone, isReasoningDelta } from '../domain/entities/StreamEvent.js';
import { StreamState } from '../domain/entities/StreamState.js';
import { Tool, ToolCall, ToolCallState, ToolResult, AsyncToolConfig, PendingAsyncTool } from '../domain/entities/Tool.js';
import { Content, ContentType } from '../domain/entities/Content.js';
import { ToolTimeoutError, ToolPermissionDeniedError } from '../domain/errors/AIErrors.js';
import type { HookConfig, HookName } from '../capabilities/agents/types/HookTypes.js';
import { AgentEvents } from '../capabilities/agents/types/EventTypes.js';
import { IDisposable, assertNotDestroyed } from '../domain/interfaces/IDisposable.js';
import { TextGenerateOptions } from '../domain/interfaces/ITextProvider.js';
import { Vendor } from './Vendor.js';
import type { IContextStorage } from '../domain/interfaces/IContextStorage.js';
import type { PermissionCheckContext } from './permissions/types.js';
import { metrics } from '../infrastructure/observability/Metrics.js';
import { AGENT_DEFAULTS, EMPTY_RESPONSE_RETRY } from './constants.js';
import { calculateBackoff, BackoffConfig } from '../infrastructure/resilience/BackoffStrategy.js';
import { AgentContextNextGen } from './context-nextgen/AgentContextNextGen.js';
import type { AgentContextNextGenConfig, ContextFeatures } from './context-nextgen/types.js';
import type {
  IAgentDefinitionStorage,
  StoredAgentDefinition,
  AgentDefinitionMetadata,
} from '../domain/interfaces/IAgentDefinitionStorage.js';
import { StorageRegistry } from './StorageRegistry.js';
import { AgentRegistry } from './AgentRegistry.js';
import { SuspendSignal } from './SuspendSignal.js';
import type { ICorrelationStorage, SessionRef } from '../domain/interfaces/ICorrelationStorage.js';
import { FileCorrelationStorage } from '../infrastructure/storage/FileCorrelationStorage.js';
import { ProviderErrorMapper } from '../infrastructure/providers/base/ProviderErrorMapper.js';

/**
 * Session configuration for Agent (same as BaseSessionConfig)
 */
export type AgentSessionConfig = BaseSessionConfig;

/**
 * Agent configuration - extends BaseAgentConfig with Agent-specific options
 */
export interface AgentConfig extends BaseAgentConfig {
  /** System instructions for the agent */
  instructions?: string;

  /** Temperature for generation */
  temperature?: number;

  /** Maximum iterations for tool calling loop */
  maxIterations?: number;

  /** Vendor-agnostic thinking/reasoning configuration */
  thinking?: {
    enabled: boolean;
    /** Budget in tokens for thinking (Anthropic & Google) */
    budgetTokens?: number;
    /** Reasoning effort level (OpenAI) */
    effort?: 'low' | 'medium' | 'high';
  };

  /** Vendor-specific options (e.g., Google's thinkingLevel: 'low' | 'high') */
  vendorOptions?: Record<string, unknown>;

  /**
   * Optional unified context management.
   * When provided (as AgentContextNextGen instance or config), Agent will:
   * - Track conversation history
   * - Provide unified memory access
   * - Support session persistence via context
   *
   * Pass an AgentContextNextGen instance or AgentContextNextGenConfig to enable.
   */
  context?: AgentContextNextGen | AgentContextNextGenConfig;

  /**
   * Hard timeout in milliseconds for any single tool execution.
   * Acts as a safety net: if a tool's own timeout mechanism fails
   * (e.g. a spawned child process doesn't exit), this will force-resolve
   * with an error. Default: 0 (disabled - relies on each tool's own timeout).
   *
   * Example: `toolExecutionTimeout: 300000` (5 minutes hard cap per tool call)
   */
  toolExecutionTimeout?: number;

  /**
   * @deprecated Use `toolExecutionTimeout` instead.
   */
  toolTimeout?: number;

  // Enterprise features
  hooks?: HookConfig;
  historyMode?: HistoryMode;
  limits?: {
    maxExecutionTime?: number;
    maxToolCalls?: number;
    maxContextSize?: number;
    maxInputMessages?: number;
  };
  errorHandling?: {
    hookFailureMode?: 'fail' | 'warn' | 'ignore';
    toolFailureMode?: 'fail' | 'continue';
    maxConsecutiveErrors?: number;
  };
  /** Configuration for async (non-blocking) tool execution */
  asyncTools?: AsyncToolConfig;

  /** Configuration for retrying empty/incomplete LLM responses */
  emptyResponseRetry?: {
    /** Enable retry for empty responses (default: true) */
    enabled?: boolean;
    /** Max retry attempts (default: 2) */
    maxRetries?: number;
    /** Initial backoff delay ms (default: 1000) */
    initialDelayMs?: number;
    /** Max backoff delay ms (default: 5000) */
    maxDelayMs?: number;
  };
}

/**
 * Per-call options for run() and stream().
 * These override the agent-level config for this single invocation.
 */
export interface RunOptions {
  /** Vendor-agnostic thinking/reasoning configuration */
  thinking?: {
    enabled: boolean;
    /** Budget in tokens for thinking (Anthropic & Google) */
    budgetTokens?: number;
    /** Reasoning effort level (OpenAI) */
    effort?: 'low' | 'medium' | 'high';
  };

  /** Temperature for generation */
  temperature?: number;

  /** Vendor-specific options */
  vendorOptions?: Record<string, unknown>;
}

/**
 * Execution setup information returned by _prepareExecution()
 */
interface ExecutionSetup {
  executionId: string;
  startTime: number;
  maxIterations: number;
}

/**
 * Result of iteration precondition checks
 */
interface IterationPreconditionResult {
  shouldExit: boolean;
  exitReason?: 'cancelled' | 'paused';
}

/**
 * Agent class - represents an AI assistant with tool calling capabilities
 *
 * Extends BaseAgent to inherit:
 * - Connector resolution
 * - Provider initialization
 * - Tool manager initialization
 * - Permission manager initialization
 * - Session management
 * - Lifecycle/cleanup
 */
export class Agent extends BaseAgent<AgentConfig, AgentEvents> implements IDisposable {
  // ===== Agent-specific State =====
  private hookManager: HookManager;
  private executionContext: ExecutionContext | null = null;
  private _toolRegisteredListener: ((event: { name: string }) => void) | null = null;

  // Pause/resume/cancel state
  private _paused = false;
  private _cancelled = false;
  private _pausePromise: Promise<void> | null = null;
  private _resumeCallback: (() => void) | null = null;
  private _pauseResumeMutex: Promise<void> = Promise.resolve();

  // Async tool state
  private _asyncToolTracker: Map<string, PendingAsyncTool> = new Map();
  private _asyncBatchTimer: ReturnType<typeof setTimeout> | null = null;
  private _asyncResultQueue: ToolResult[] = [];
  private _continuationInProgress = false;
  private _executionActive = false;

  // Per-call run options (set in run/stream, cleared in finally)
  private _runOptions: RunOptions | undefined;

  // Message injection queue (for orchestrator send_message)
  // M4: Use Message[] instead of InputItem[] for type safety (inject() only creates Messages)
  private _pendingInjections: import('../domain/entities/Message.js').Message[] = [];
  /** M3: Maximum injection queue size to prevent unbounded growth */
  private static readonly MAX_PENDING_INJECTIONS = 100;

  // ===== Static Factory =====

  /**
   * Create a new agent
   *
   * @example
   * ```typescript
   * const agent = Agent.create({
   *   connector: 'openai',  // or Connector instance
   *   model: 'gpt-4',
   *   userId: 'user-123',   // flows to all tool executions automatically
   *   instructions: 'You are a helpful assistant',
   *   tools: [myTool]
   * });
   * ```
   */
  static create(config: AgentConfig): Agent {
    return new Agent(config);
  }

  /**
   * Resume an agent from a saved session
   *
   * @example
   * ```typescript
   * const agent = await Agent.resume('session-123', {
   *   connector: 'openai',
   *   model: 'gpt-4',
   *   session: { storage: myStorage }
   * });
   * ```
   */
  static async resume(
    sessionId: string,
    config: Omit<AgentConfig, 'session'> & { session: { storage: IContextStorage } }
  ): Promise<Agent> {
    const agent = new Agent({
      ...config,
      session: {
        ...config.session,
        id: sessionId,
      },
    });

    // Wait for session to load
    await agent.ensureSessionLoaded();

    return agent;
  }

  /**
   * Create an agent from a stored definition
   *
   * Loads agent configuration from storage and creates a new Agent instance.
   * The connector must be registered at runtime before calling this method.
   *
   * @param agentId - Agent identifier to load
   * @param storage - Storage backend to load from
   * @param overrides - Optional config overrides
   * @returns Agent instance, or null if not found
   */
  static async fromStorage(
    agentId: string,
    storage?: IAgentDefinitionStorage,
    overrides?: Partial<AgentConfig>
  ): Promise<Agent | null> {
    const s = storage ?? StorageRegistry.get('agentDefinitions');
    if (!s) {
      throw new Error('No storage provided and no agentDefinitions configured in StorageRegistry');
    }
    const definition = await s.load(agentId);
    if (!definition) {
      return null;
    }

    // Build config from definition
    const contextConfig: AgentContextNextGenConfig = {
      model: definition.connector.model,
      agentId: definition.agentId,
      systemPrompt: definition.systemPrompt ?? definition.instructions,
    };
    if (definition.features) {
      contextConfig.features = definition.features as ContextFeatures;
    }

    const config: AgentConfig = {
      connector: definition.connector.name,
      model: definition.connector.model,
      instructions: definition.systemPrompt,
      context: contextConfig,
      ...definition.typeConfig,
      ...overrides,
    };

    return new Agent(config);
  }

  /**
   * Hydrate an agent from stored definition + saved session.
   *
   * Returns a fully reconstructed Agent with conversation history and plugin
   * states restored. The caller can customize the agent (add tools, hooks, etc.)
   * before calling `run()` to continue execution.
   *
   * This is the primary API for resuming suspended sessions.
   *
   * @param sessionId - Session ID to load
   * @param options - Agent ID and optional overrides
   * @returns Agent instance ready for customization and `run()`
   *
   * @example
   * ```typescript
   * // Reconstruct agent and load session
   * const agent = await Agent.hydrate('session-456', { agentId: 'my-agent' });
   *
   * // Customize (add hooks, tools, etc.)
   * agent.lifecycleHooks = { onError: myErrorHandler };
   * agent.tools.register(presentToUser(emailService));
   *
   * // Continue with user's reply
   * const result = await agent.run('Thanks, but also look at Q2 data');
   * ```
   */
  static async hydrate(
    sessionId: string,
    options: {
      /** Agent ID to load definition for */
      agentId: string;
      /** Optional definition storage override */
      definitionStorage?: IAgentDefinitionStorage;
      /** Optional config overrides (e.g., connector, model) */
      overrides?: Partial<AgentConfig>;
    }
  ): Promise<Agent> {
    const agent = await Agent.fromStorage(
      options.agentId,
      options.definitionStorage,
      options.overrides,
    );
    if (!agent) {
      throw new Error(`Agent definition not found: ${options.agentId}`);
    }

    // Load session state (conversation + plugin states)
    const loaded = await agent.loadSession(sessionId);
    if (!loaded) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    // Clean up correlations for this session
    const correlationStorage = StorageRegistry.get('correlations') as ICorrelationStorage | undefined;
    if (correlationStorage) {
      const correlationIds = await correlationStorage.listBySession(sessionId);
      for (const id of correlationIds) {
        await correlationStorage.delete(id);
      }
    }

    return agent;
  }

  // ===== Constructor =====

  private constructor(config: AgentConfig) {
    super(config, 'Agent');

    this._logger.debug({ model: this.model, connector: this.connector.name }, 'Agent created');
    metrics.increment('agent.created', 1, {
      model: this.model,
      connector: this.connector.name,
    });

    // Provider is inherited from BaseAgent (this._provider)

    // Set system prompt on inherited AgentContext if instructions provided
    if (config.instructions) {
      this._agentContext.systemPrompt = config.instructions;
      this._hasExplicitInstructions = true;
    }

    // Sync tool permission configs from ToolManager (via AgentContext) to PermissionManager
    this._toolRegisteredListener = ({ name }: { name: string }) => {
      const permission = this._agentContext.tools.getPermission(name);
      if (permission) {
        this._permissionManager.setToolConfig(name, permission);
      }
    };
    this._agentContext.tools.on('tool:registered', this._toolRegisteredListener);

    // Create hook manager
    this.hookManager = new HookManager(
      config.hooks || {},
      this,
      config.errorHandling
    );

    // Wire up beforeCompaction callback to invoke lifecycle hooks
    this._agentContext.setBeforeCompactionCallback(async (info) => {
      // Build BeforeCompactionContext for lifecycle hook
      const status = info.budget.utilizationPercent >= 90 ? 'critical'
        : info.budget.utilizationPercent >= 70 ? 'warning'
        : 'ok';

      // Build components list from plugins
      const components: Array<{ name: string; priority: number; compactable: boolean }> = [];
      for (const plugin of this._agentContext.getPlugins()) {
        const order: Record<string, number> = {
          'in_context_memory': 1,
          'working_memory': 2,
        };
        components.push({
          name: plugin.name,
          priority: order[plugin.name] ?? 10,
          compactable: plugin.isCompactable(),
        });
      }

      await this.invokeBeforeCompaction({
        agentId: this.name,
        currentBudget: {
          total: info.budget.maxTokens,
          used: info.budget.totalUsed,
          available: info.budget.available,
          utilizationPercent: info.budget.utilizationPercent,
          status,
        },
        strategy: info.strategy,
        components,
        estimatedTokensToFree: info.targetTokensToFree,
      });
    });

    // Initialize session (from BaseAgent)
    this.initializeSession(config.session);

    // Auto-register with AgentRegistry for global tracking/observability
    AgentRegistry.register(this);
  }

  // ===== Abstract Method Implementations =====

  protected getAgentType(): 'agent' | 'task-agent' | 'universal-agent' {
    return 'agent';
  }

  // ===== Context Access =====

  // Note: `context` getter is inherited from BaseAgent (returns _agentContext)

  /**
   * Check if context management is enabled.
   * Always returns true since AgentContext is always created by BaseAgent.
   */
  hasContext(): boolean {
    return true;
  }

  // getContextState() and restoreContextState() are inherited from BaseAgent

  // ===== Shared Execution Helpers =====

  /**
   * Prepare execution - shared setup for run() and stream()
   */
  private async _prepareExecution(
    input: string | InputItem[],
    methodName: 'run' | 'stream'
  ): Promise<ExecutionSetup> {
    assertNotDestroyed(this, `${methodName} agent`);

    // Ensure any pending session load is complete
    await this.ensureSessionLoaded();

    const inputPreview = typeof input === 'string'
      ? input.substring(0, 100)
      : `${input.length} messages`;

    this._logger.info({ inputPreview, toolCount: this._config.tools?.length || 0 }, `Agent ${methodName} started`);
    metrics.increment(`agent.${methodName}.started`, 1, { model: this.model, connector: this.connector.name });

    const startTime = Date.now();

    // Generate execution ID and create execution context
    const executionId = `exec_${randomUUID()}`;
    this.executionContext = new ExecutionContext(executionId, {
      maxHistorySize: 10,
      historyMode: this._config.historyMode || 'summary',
      maxAuditTrailSize: 1000,
    });

    // Reset control state
    this._paused = false;
    this._cancelled = false;
    if (methodName === 'stream') {
      this._pausePromise = null;
      this._resumeCallback = null;
    }

    // Add user message to AgentContext
    // NOTE: setCurrentInput() also calls addUserMessage() internally, so we use it
    // for string input to handle both task-type detection and journaling in one call.
    // For InputItem[] input, use addInputItems() which doesn't journal (history seeding).
    if (typeof input === 'string') {
      this._agentContext.setCurrentInput(input);
    } else {
      this._agentContext.addInputItems(input);
    }

    // Emit execution start
    this.emit('execution:start', {
      executionId,
      config: { model: this.model, maxIterations: this._config.maxIterations || 10 },
      timestamp: new Date(),
    });

    // Execute before:execution hook
    await this.hookManager.executeHooks('before:execution', {
      executionId,
      config: { model: this.model },
      timestamp: new Date(),
    }, undefined);

    this._executionActive = true;

    return {
      executionId,
      startTime,
      maxIterations: this._config.maxIterations || AGENT_DEFAULTS.MAX_ITERATIONS,
    };
  }

  /**
   * Check iteration preconditions - pause, cancel, limits, hooks
   */
  private async _checkIterationPreconditions(
    executionId: string,
    iteration: number
  ): Promise<IterationPreconditionResult> {
    // Check pause
    await this.checkPause();

    // Check if cancelled
    if (this._cancelled) {
      return { shouldExit: true, exitReason: 'cancelled' };
    }

    // Check resource limits
    if (this.executionContext) {
      this.executionContext.checkLimits(this._config.limits);
    }

    // Check pause hook
    const pauseCheck = await this.hookManager.executeHooks('pause:check', {
      executionId,
      iteration,
      context: this.executionContext!,
      timestamp: new Date(),
    }, { shouldPause: false });

    if (pauseCheck.shouldPause) {
      this.pause(pauseCheck.reason || 'Hook requested pause');
      await this.checkPause();
    }

    // Update iteration
    if (this.executionContext) {
      this.executionContext.iteration = iteration;
    }

    // Emit iteration start
    this.emit('iteration:start', { executionId, iteration, timestamp: new Date() });

    return { shouldExit: false };
  }

  /**
   * Record iteration metrics and store iteration record
   */
  private _recordIterationMetrics(
    iteration: number,
    iterationStartTime: number,
    response: AgentResponse,
    toolCalls: ToolCall[],
    toolResults: ToolResult[],
    prepared: { input: InputItem[] }
  ): void {
    if (!this.executionContext) return;

    // Store iteration record
    this.executionContext.addIteration({
      iteration,
      request: {
        model: this.model,
        input: prepared.input,
        instructions: this._config.instructions,
        tools: this.getEnabledToolDefinitions(),
        temperature: this._config.temperature,
      },
      response,
      toolCalls,
      toolResults,
      startTime: new Date(iterationStartTime),
      endTime: new Date(),
    });

    // Update metrics
    this.executionContext.updateMetrics({
      iterationCount: iteration + 1,
      inputTokens: this.executionContext.metrics.inputTokens + (response.usage?.input_tokens || 0),
      outputTokens: this.executionContext.metrics.outputTokens + (response.usage?.output_tokens || 0),
      totalTokens: this.executionContext.metrics.totalTokens + (response.usage?.total_tokens || 0),
    });
  }

  /**
   * Finalize successful execution - hooks, events, metrics
   */
  private async _finalizeExecution(
    executionId: string,
    startTime: number,
    response: AgentResponse,
    methodName: 'run' | 'stream'
  ): Promise<void> {
    // Calculate total duration
    const totalDuration = this.executionContext
      ? Date.now() - this.executionContext.startTime.getTime()
      : Date.now() - startTime;

    if (this.executionContext) {
      this.executionContext.updateMetrics({ totalDuration });
    }

    // Execute after:execution hook
    await this.hookManager.executeHooks('after:execution', {
      executionId,
      response,
      context: this.executionContext!,
      input: this._agentContext.getOriginalUserInput(),
      timestamp: new Date(),
      duration: totalDuration,
    }, undefined);

    // Emit execution complete
    this.emit('execution:complete', {
      executionId,
      response,
      timestamp: new Date(),
      duration: totalDuration,
    });

    // Detect zero text output (model completed but produced no user-facing text)
    const hasTextOutput = response.output_text?.trim() ||
      response.output?.some((item: OutputItem) =>
        'content' in item && Array.isArray((item as any).content) &&
        (item as any).content.some((c: Content) => c.type === ContentType.OUTPUT_TEXT && (c as any).text?.trim())
      );
    if (!hasTextOutput) {
      const hadToolCalls = response.output?.some((item: OutputItem) =>
        'content' in item && Array.isArray((item as any).content) &&
        (item as any).content.some((c: Content) => c.type === ContentType.TOOL_USE)
      ) ?? false;
      console.warn(
        `[Agent] WARNING: ${methodName} completed with zero text output ` +
        `(status=${response.status}, executionId=${executionId}, ` +
        `iterations=${this.executionContext?.metrics.iterationCount ?? '?'}, ` +
        `tokens=${response.usage?.total_tokens ?? 0}, ` +
        `hadToolCalls=${hadToolCalls}` +
        (response.error ? `, error=${response.error.type}: ${response.error.message}` : '') +
        `)`,
      );
      this.emit('execution:empty_output', {
        executionId,
        timestamp: new Date(),
        duration: totalDuration,
        usage: response.usage,
      });
    }

    const duration = Date.now() - startTime;
    this._logger.info({ duration }, `Agent ${methodName} completed`);
    metrics.timing(`agent.${methodName}.duration`, duration, { model: this.model, connector: this.connector.name });
    metrics.increment(`agent.${methodName}.completed`, 1, { model: this.model, connector: this.connector.name, status: 'success' });
  }

  /**
   * Handle execution error - events, metrics, logging
   */
  private _handleExecutionError(
    executionId: string,
    error: Error,
    startTime: number,
    methodName: 'run' | 'stream'
  ): void {
    // Emit execution error
    this.emit('execution:error', { executionId, error, timestamp: new Date() });

    // Record error in metrics
    this.executionContext?.metrics.errors.push({
      type: 'execution_error',
      message: error.message,
      timestamp: new Date(),
    });

    const duration = Date.now() - startTime;
    this._logger.error({ ...ProviderErrorMapper.extractErrorDetails(error), duration }, `Agent ${methodName} failed`);
    metrics.increment(`agent.${methodName}.completed`, 1, { model: this.model, connector: this.connector.name, status: 'error' });
  }

  /**
   * Cleanup execution resources
   */
  private _cleanupExecution(streamState?: StreamState): void {
    streamState?.clear();
    this.executionContext?.cleanup();
  }

  /**
   * Emit iteration complete event (helper for run loop)
   */
  private _emitIterationComplete(
    executionId: string,
    iteration: number,
    response: AgentResponse,
    iterationStartTime: number
  ): void {
    this.emit('iteration:complete', {
      executionId,
      iteration,
      response,
      timestamp: new Date(),
      duration: Date.now() - iterationStartTime,
    });
  }

  // ===== Main API =====

  /**
   * Run the agent with input
   */
  async run(input: string | InputItem[], options?: RunOptions): Promise<AgentResponse> {
    this._runOptions = options;
    const { executionId, startTime, maxIterations } = await this._prepareExecution(input, 'run');

    try {
      const finalResponse = await this._runAgenticLoop(executionId, startTime, maxIterations);

      await this._finalizeExecution(executionId, startTime, finalResponse, 'run');
      return finalResponse;
    } catch (error) {
      this._handleExecutionError(executionId, error as Error, startTime, 'run');
      throw error;
    } finally {
      this._runOptions = undefined;
      this._executionActive = false;
      this._cleanupExecution();

      // If async results arrived while we were running, schedule a flush
      if (this._asyncResultQueue.length > 0 && (this._config.asyncTools?.autoContinue !== false)) {
        setTimeout(() => {
          if (this._isDestroyed) return;
          try {
            this._flushAsyncResults();
          } catch (err) {
            this._logger.error({ error: (err as Error).message }, 'Error flushing async results');
          }
        }, 0);
      }
    }
  }

  /**
   * Shared agentic loop used by both run() and continueWithAsyncResults().
   * Includes: iteration loop, empty response retry, context budget logging,
   * tool execution, max-iterations wrap-up, consolidation, pendingAsyncTools attachment.
   */
  private async _runAgenticLoop(
    executionId: string,
    _startTime: number,
    maxIterations: number
  ): Promise<AgentResponse> {
    let iteration = 0;
    let finalResponse: AgentResponse | null = null;

    // Empty response retry config
    const retryConfig = {
      enabled: this._config.emptyResponseRetry?.enabled ?? EMPTY_RESPONSE_RETRY.ENABLED,
      maxRetries: this._config.emptyResponseRetry?.maxRetries ?? EMPTY_RESPONSE_RETRY.MAX_RETRIES,
      initialDelayMs: this._config.emptyResponseRetry?.initialDelayMs ?? EMPTY_RESPONSE_RETRY.INITIAL_DELAY_MS,
      maxDelayMs: this._config.emptyResponseRetry?.maxDelayMs ?? EMPTY_RESPONSE_RETRY.MAX_DELAY_MS,
    };
    const retryBackoffConfig: BackoffConfig = {
      strategy: 'exponential',
      initialDelayMs: retryConfig.initialDelayMs,
      maxDelayMs: retryConfig.maxDelayMs,
      jitter: true,
    };
    let emptyRetryCount = 0;

    while (iteration < maxIterations) {
      const { shouldExit } = await this._checkIterationPreconditions(executionId, iteration);
      if (shouldExit) {
        throw new Error('Execution cancelled');
      }

      const iterationStartTime = Date.now();

      // Prepare context (handles compaction)
      const prepared = await this._agentContext.prepare();
      const b1 = prepared.budget;
      const bd1 = b1.breakdown;
      const bp1 = [
        `sysPrompt=${bd1.systemPrompt}`,
        `PI=${bd1.persistentInstructions}`,
        bd1.pluginInstructions ? `pluginInstr=${bd1.pluginInstructions}` : '',
        ...Object.entries(bd1.pluginContents || {}).map(([k, v]) => `plugin:${k}=${v}`),
      ].filter(Boolean).join(' ');
      console.log(
        `[Agent] [Context] iteration=${iteration} tokens: ${b1.totalUsed}/${b1.maxTokens} (${b1.utilizationPercent.toFixed(1)}%) ` +
        `tools=${b1.toolsTokens} conversation=${b1.conversationTokens} system=${b1.systemMessageTokens} input=${b1.currentInputTokens}` +
        (bp1 ? ` | ${bp1}` : '') +
        (prepared.compacted ? ` COMPACTED: ${prepared.compactionLog.join('; ')}` : ''),
      );

      // Generate LLM response
      const response = await this.generateWithHooks(prepared.input, iteration, executionId);

      if (!response || !response.output) {
        this._logger.warn({ executionId, iteration }, 'Empty or malformed response from LLM');
        break;
      }

      // Extract tool calls
      const toolCalls = this.extractToolCalls(response.output);

      // If no tool calls, check for empty response retry before committing to context
      if (toolCalls.length === 0) {
        const hasText = !!(response.output_text?.trim());
        const shouldRetry = !hasText &&
          response.status !== 'failed' &&
          retryConfig.enabled &&
          emptyRetryCount < retryConfig.maxRetries;

        if (shouldRetry) {
          emptyRetryCount++;
          const delay = calculateBackoff(emptyRetryCount, retryBackoffConfig);
          this._logger.warn(
            { attempt: emptyRetryCount, maxAttempts: retryConfig.maxRetries, status: response.status },
            'Empty LLM response in run(), retrying...',
          );
          this.emit('execution:retry', {
            executionId,
            attempt: emptyRetryCount,
            maxAttempts: retryConfig.maxRetries,
            reason: `Empty response (status: ${response.status})`,
            delayMs: delay,
            timestamp: new Date(),
          });
          await new Promise(resolve => setTimeout(resolve, delay));
          // Don't add empty response to context, don't increment iteration — just retry
          continue;
        }

        // Accept the response
        emptyRetryCount = 0;
        this._agentContext.addAssistantResponse(response.output);
        this._emitIterationComplete(executionId, iteration, response, iterationStartTime);
        finalResponse = response;
        break;
      }

      // Add assistant response to AgentContext (has tool calls, always accept)
      this._agentContext.addAssistantResponse(response.output);

      // Emit tool detection
      if (toolCalls.length > 0) {
        this.emit('tool:detected', { executionId, iteration, toolCalls, timestamp: new Date() });
      }

      // Execute tools with hooks
      const toolResults = await this.executeToolsWithHooks(toolCalls, iteration, executionId);

      // Check for SuspendSignal in tool results
      let suspendSignal: SuspendSignal | null = null;
      for (const result of toolResults) {
        if (SuspendSignal.is(result.content)) {
          suspendSignal = result.content;
          // Replace SuspendSignal with its display result for the LLM
          result.content = suspendSignal.result;
          break;
        }
      }

      // Add tool results to AgentContext
      this._agentContext.addToolResults(toolResults);

      // If a tool signaled suspension, do final wrap-up and return
      if (suspendSignal) {
        this._logger.info(
          { correlationId: suspendSignal.correlationId },
          'SuspendSignal detected, suspending agent loop',
        );

        // Final LLM call WITHOUT tools (mirrors max-iterations wrap-up)
        const suspendPrepared = await this._agentContext.prepare();
        const suspendResponse = await this._provider.generate({
          model: this.model,
          input: suspendPrepared.input,
          instructions: this._config.instructions,
          tools: [], // No tools — force text-only wrap-up
          temperature: this._config.temperature,
          vendorOptions: this._config.vendorOptions,
        });
        this._agentContext.addAssistantResponse(suspendResponse.output);

        // Generate session ID if not already set
        const sessionId = this._agentContext.sessionId ?? `suspended-${randomUUID()}`;

        // Save session state
        await this.saveSession(sessionId);

        // Save correlation mapping
        const now = new Date();
        const expiresAt = new Date(now.getTime() + suspendSignal.ttl);
        const correlationRef: SessionRef = {
          agentId: this._agentContext.agentId,
          sessionId,
          suspendedAt: now.toISOString(),
          expiresAt: expiresAt.toISOString(),
          resumeAs: suspendSignal.resumeAs,
          metadata: suspendSignal.metadata,
        };

        const correlationStorage = StorageRegistry.resolve(
          'correlations' as keyof import('./StorageRegistry.js').StorageConfig,
          () => new FileCorrelationStorage(),
        ) as ICorrelationStorage;
        await correlationStorage.save(suspendSignal.correlationId, correlationRef);

        // Set response status to suspended
        suspendResponse.status = 'suspended';
        suspendResponse.suspension = {
          correlationId: suspendSignal.correlationId,
          sessionId,
          agentId: this._agentContext.agentId,
          resumeAs: suspendSignal.resumeAs,
          expiresAt: expiresAt.toISOString(),
          metadata: suspendSignal.metadata,
        };

        // Emit suspension event
        this.emit('execution:suspended' as any, {
          executionId,
          sessionId,
          correlationId: suspendSignal.correlationId,
          expiresAt: expiresAt.toISOString(),
          timestamp: now,
        });

        finalResponse = suspendResponse;
        break;
      }

      // Record iteration metrics
      this._recordIterationMetrics(iteration, iterationStartTime, response, toolCalls, toolResults, prepared);

      // Emit iteration complete
      this._emitIterationComplete(executionId, iteration, response, iterationStartTime);

      iteration++;
    }

    // Check if we exited normally or hit max iterations
    if (iteration >= maxIterations && !finalResponse) {
      // Do a final LLM call WITHOUT tools to let the agent wrap up gracefully
      this._logger.info({ maxIterations }, 'Max iterations reached, generating wrap-up response');

      // Add a user message prompting the wrap-up
      this._agentContext.addUserMessage(AGENT_DEFAULTS.MAX_ITERATIONS_MESSAGE);

      // Prepare context and generate final response WITHOUT tools
      const prepared = await this._agentContext.prepare();
      const wrapUpResponse = await this._provider.generate({
        model: this.model,
        input: prepared.input,
        instructions: this._config.instructions,
        tools: [], // No tools - force text-only response
        temperature: this._config.temperature,
        vendorOptions: this._config.vendorOptions,
      });

      // Add the wrap-up response to context
      this._agentContext.addAssistantResponse(wrapUpResponse.output);

      // Emit event for max iterations reached
      this.emit('execution:maxIterations', {
        executionId,
        iteration,
        maxIterations,
        timestamp: new Date(),
      });

      finalResponse = wrapUpResponse;
    }

    // Run post-cycle consolidation (summarization, memory optimization, etc.)
    await this._agentContext.consolidate();

    // Attach pending async tools info to response
    if (this._asyncToolTracker.size > 0) {
      finalResponse!.pendingAsyncTools = Array.from(this._asyncToolTracker.values()).map(p => ({
        toolCallId: p.toolCallId,
        toolName: p.toolName,
        startTime: p.startTime,
        status: p.status,
      }));
    }

    return finalResponse!;
  }

  // ===== Stream-Specific Helpers =====

  /**
   * Build tool calls array from accumulated map
   */
  private _buildToolCallsFromMap(
    toolCallsMap: Map<string, { name: string; args: string }>
  ): ToolCall[] {
    const toolCalls: ToolCall[] = [];
    const toolDefinitions = this.getEnabledToolDefinitions();
    const toolDefMap = new Map<string, Tool>();
    for (const tool of toolDefinitions) {
      if (tool.type === 'function') {
        toolDefMap.set(tool.function.name, tool);
      }
    }
    for (const [toolCallId, buffer] of toolCallsMap) {
      const toolDef = toolDefMap.get(buffer.name);
      const isBlocking = toolDef?.blocking !== false;
      toolCalls.push({
        id: toolCallId,
        type: 'function',
        function: {
          name: buffer.name,
          arguments: buffer.args,
        },
        blocking: isBlocking,
        state: ToolCallState.PENDING,
      });
    }
    return toolCalls;
  }

  /**
   * Build and add streaming assistant message to context
   */
  private _addStreamingAssistantMessage(
    streamState: StreamState,
    toolCalls: ToolCall[]
  ): void {
    const assistantText = streamState.getAllText();
    const assistantContent: Content[] = [];

    // Add thinking content if reasoning was accumulated
    if (streamState.hasReasoning()) {
      const reasoning = streamState.getAllReasoning();
      if (reasoning) {
        // Use actual connector vendor for reliable detection
        const isAnthropic = this.connector.vendor === Vendor.Anthropic;
        assistantContent.push({
          type: ContentType.THINKING,
          thinking: reasoning,
          // Streaming doesn't carry Anthropic signatures, so signature is undefined here.
          // Non-streaming responses (via convertResponse) capture signatures correctly.
          signature: undefined,
          persistInHistory: isAnthropic,
        });
      }
    }

    if (assistantText && assistantText.trim()) {
      assistantContent.push({
        type: ContentType.OUTPUT_TEXT,
        text: assistantText,
      });
    }

    // Add tool use blocks
    for (const tc of toolCalls) {
      assistantContent.push({
        type: ContentType.TOOL_USE,
        id: tc.id,
        name: tc.function.name,
        arguments: tc.function.arguments,
      });
    }

    // Build output format for addAssistantResponse (which properly moves _currentInput to _conversation)
    const outputItem: OutputItem = {
      type: 'message',
      role: MessageRole.ASSISTANT,
      content: assistantContent,
    };

    // Use addAssistantResponse instead of addInputItems to ensure user message
    // in _currentInput is moved to _conversation first (critical for history preservation)
    this._agentContext.addAssistantResponse([outputItem]);
  }

  /**
   * Build placeholder response for streaming finalization
   */
  private _buildPlaceholderResponse(
    executionId: string,
    startTime: number,
    streamState: StreamState
  ): AgentResponse {
    // Include actual text output from stream (previously discarded as empty [])
    const outputText = streamState.getAllText();
    const output: OutputItem[] = [];
    if (outputText && outputText.trim()) {
      output.push({
        type: 'message',
        role: MessageRole.ASSISTANT,
        content: [{ type: ContentType.OUTPUT_TEXT, text: outputText }],
      });
    }
    return {
      id: executionId,
      object: 'response',
      created_at: Math.floor(startTime / 1000),
      status: streamState.providerStatus || 'completed',
      model: this.model,
      output,
      output_text: outputText || undefined,
      usage: streamState.usage,
    };
  }

  /**
   * Stream response from the agent
   */
  async *stream(input: string | InputItem[], options?: RunOptions): AsyncIterableIterator<StreamEvent> {
    this._runOptions = options;
    const { executionId, startTime, maxIterations } = await this._prepareExecution(input, 'stream');

    // Create a single StreamState for the entire execution (tracks usage across iterations)
    const globalStreamState = new StreamState(executionId, this.model);
    let iteration = 0;

    // Empty response retry config
    const retryConfig = {
      enabled: this._config.emptyResponseRetry?.enabled ?? EMPTY_RESPONSE_RETRY.ENABLED,
      maxRetries: this._config.emptyResponseRetry?.maxRetries ?? EMPTY_RESPONSE_RETRY.MAX_RETRIES,
      initialDelayMs: this._config.emptyResponseRetry?.initialDelayMs ?? EMPTY_RESPONSE_RETRY.INITIAL_DELAY_MS,
      maxDelayMs: this._config.emptyResponseRetry?.maxDelayMs ?? EMPTY_RESPONSE_RETRY.MAX_DELAY_MS,
    };
    const retryBackoffConfig: BackoffConfig = {
      strategy: 'exponential',
      initialDelayMs: retryConfig.initialDelayMs,
      maxDelayMs: retryConfig.maxDelayMs,
      jitter: true,
    };
    let emptyRetryCount = 0;

    try {
      // Main agentic loop
      while (iteration < maxIterations) {
        iteration++;

        // Check preconditions (pause, cancel, limits)
        const { shouldExit } = await this._checkIterationPreconditions(executionId, iteration);
        if (shouldExit) {
          this.emit('execution:cancelled', { executionId, iteration, timestamp: new Date() });
          break;
        }

        // Drain any injected messages (from orchestrator send_message or external callers)
        // M4: _pendingInjections is now typed as Message[] — no unsafe cast needed
        if (this._pendingInjections.length > 0) {
          const injections = this._pendingInjections.splice(0);
          for (const msg of injections) {
            this._agentContext.addUserMessage(
              msg.content
                .map(c => 'text' in c ? (c as { text: string }).text : '')
                .filter(Boolean)
                .join('\n')
            );
          }
        }

        // Prepare context (handles compaction)
        // Note: instructions are set in systemPrompt during context creation
        const prepared = await this._agentContext.prepare();
        const b2 = prepared.budget;
        const bd2 = b2.breakdown;
        const bp2 = [
          `sysPrompt=${bd2.systemPrompt}`,
          `PI=${bd2.persistentInstructions}`,
          bd2.pluginInstructions ? `pluginInstr=${bd2.pluginInstructions}` : '',
          ...Object.entries(bd2.pluginContents || {}).map(([k, v]) => `plugin:${k}=${v}`),
        ].filter(Boolean).join(' ');
        console.log(
          `[Agent] [Context] iteration=${iteration} tokens: ${b2.totalUsed}/${b2.maxTokens} (${b2.utilizationPercent.toFixed(1)}%) ` +
          `tools=${b2.toolsTokens} conversation=${b2.conversationTokens} system=${b2.systemMessageTokens} input=${b2.currentInputTokens}` +
          (bp2 ? ` | ${bp2}` : '') +
          (prepared.compacted ? ` COMPACTED: ${prepared.compactionLog.join('; ')}` : ''),
        );

        // Stream LLM response and accumulate state (per-iteration state)
        const iterationStreamState = new StreamState(executionId, this.model);
        const toolCallsMap = new Map<string, { name: string; args: string }>();

        // Stream from provider with hooks
        yield* this.streamGenerateWithHooks(
          prepared.input,
          iteration,
          executionId,
          iterationStreamState,
          toolCallsMap
        );

        // Accumulate text, reasoning, usage from this iteration into global state
        globalStreamState.accumulateFrom(iterationStreamState);
        globalStreamState.accumulateUsage(iterationStreamState.usage);

        // Build tool calls from accumulated map
        const toolCalls = this._buildToolCallsFromMap(toolCallsMap);

        // No tool calls? Check if we should retry or finish
        if (toolCalls.length === 0) {
          const hasText = iterationStreamState.hasText();
          const hasReasoning = iterationStreamState.hasReasoning();
          const providerStatus = iterationStreamState.providerStatus;

          // Retry logic: empty response (no text, no reasoning) that isn't a hard failure
          const shouldRetry = !hasText && !hasReasoning &&
            providerStatus !== 'failed' &&
            retryConfig.enabled &&
            emptyRetryCount < retryConfig.maxRetries;

          if (shouldRetry) {
            emptyRetryCount++;
            const delay = calculateBackoff(emptyRetryCount, retryBackoffConfig);

            this._logger.warn(
              { attempt: emptyRetryCount, maxAttempts: retryConfig.maxRetries, status: providerStatus, stopReason: iterationStreamState.stopReason },
              'Empty LLM response, retrying...',
            );

            // Emit retry event so UI can show "Retrying..."
            yield {
              type: StreamEventType.RETRY,
              response_id: executionId,
              attempt: emptyRetryCount,
              max_attempts: retryConfig.maxRetries,
              reason: `Empty response from provider (status: ${providerStatus}, stop_reason: ${iterationStreamState.stopReason ?? 'none'})`,
              delay_ms: delay,
            };
            this.emit('execution:retry', {
              executionId,
              attempt: emptyRetryCount,
              maxAttempts: retryConfig.maxRetries,
              reason: `Empty response (status: ${providerStatus})`,
              delayMs: delay,
              timestamp: new Date(),
            });

            // Wait before retry
            await new Promise(resolve => setTimeout(resolve, delay));

            // Clear iteration state and retry (don't increment iteration, don't add to context)
            iterationStreamState.clear();
            toolCallsMap.clear();
            continue;
          }

          // Accept the response (even if empty/incomplete) — we tried our best
          emptyRetryCount = 0;

          // Update global status from the final iteration
          globalStreamState.providerStatus = providerStatus;
          globalStreamState.stopReason = iterationStreamState.stopReason;

          // Add the final assistant response to conversation history
          this._addStreamingAssistantMessage(iterationStreamState, []);

          yield {
            type: StreamEventType.ITERATION_COMPLETE,
            response_id: executionId,
            iteration,
            tool_calls_count: 0,
            has_more_iterations: false,
          };

          yield {
            type: StreamEventType.RESPONSE_COMPLETE,
            response_id: executionId,
            status: providerStatus,
            usage: globalStreamState.usage,
            iterations: iteration,
            duration_ms: Date.now() - startTime,
            stop_reason: iterationStreamState.stopReason,
          };

          break;
        }

        // Execute tools and yield execution events
        const toolResults: ToolResult[] = [];

        for (const toolCall of toolCalls) {
          // Parse and validate arguments
          let parsedArgs: Record<string, unknown>;
          try {
            parsedArgs = JSON.parse(toolCall.function.arguments);
          } catch (error) {
            const errorMessage = `Invalid tool arguments JSON: ${(error as Error).message}`;
            // CRITICAL: Add a ToolResult for the failed parse to ensure TOOL_USE has a matching TOOL_RESULT
            // Without this, subsequent API calls fail with "No tool output found for function call"
            const failedResult: ToolResult = {
              tool_use_id: toolCall.id,
              tool_name: toolCall.function.name,
              tool_args: {},
              content: { success: false, error: errorMessage },
              state: ToolCallState.FAILED,
              error: errorMessage,
            };
            toolResults.push(failedResult);

            yield {
              type: StreamEventType.TOOL_EXECUTION_DONE,
              response_id: executionId,
              tool_call_id: toolCall.id,
              tool_name: toolCall.function.name,
              result: failedResult.content,
              execution_time_ms: 0,
              error: errorMessage,
            };
            continue;
          }

          yield {
            type: StreamEventType.TOOL_EXECUTION_START,
            response_id: executionId,
            tool_call_id: toolCall.id,
            tool_name: toolCall.function.name,
            arguments: parsedArgs,
          };

          const toolStartTime = Date.now();

          try {
            const result = await this.executeToolWithHooks(toolCall, iteration, executionId);
            toolResults.push(result);

            yield {
              type: StreamEventType.TOOL_EXECUTION_DONE,
              response_id: executionId,
              tool_call_id: toolCall.id,
              tool_name: toolCall.function.name,
              result: result.content,
              execution_time_ms: Date.now() - toolStartTime,
            };
          } catch (error) {
            yield {
              type: StreamEventType.TOOL_EXECUTION_DONE,
              response_id: executionId,
              tool_call_id: toolCall.id,
              tool_name: toolCall.function.name,
              result: null,
              execution_time_ms: Date.now() - toolStartTime,
              error: (error as Error).message,
            };

            const failureMode = this._config.errorHandling?.toolFailureMode || 'continue';
            if (failureMode === 'fail') {
              throw error;
            }

            toolResults.push({
              tool_use_id: toolCall.id,
              tool_name: toolCall.function.name,
              tool_args: parsedArgs,
              content: '',
              error: (error as Error).message,
              state: ToolCallState.FAILED,
            });
          }
        }

        // Build and add assistant message to context
        this._addStreamingAssistantMessage(iterationStreamState, toolCalls);
        this._agentContext.addToolResults(toolResults);

        yield {
          type: StreamEventType.ITERATION_COMPLETE,
          response_id: executionId,
          iteration,
          tool_calls_count: toolCalls.length,
          has_more_iterations: true,
        };

        globalStreamState.incrementIteration();
        iterationStreamState.clear();
        toolCallsMap.clear();
      }

      // If loop ended due to max iterations, generate wrap-up response
      if (iteration >= maxIterations) {
        this._logger.info({ maxIterations }, 'Max iterations reached, streaming wrap-up response');

        // Add a user message prompting the wrap-up
        this._agentContext.addUserMessage(AGENT_DEFAULTS.MAX_ITERATIONS_MESSAGE);

        // Prepare context and stream final response WITHOUT tools
        const prepared = await this._agentContext.prepare();
        const wrapUpStreamState = new StreamState(executionId, this.model);

        // Stream the wrap-up response
        for await (const event of this._provider.streamGenerate({
          model: this.model,
          input: prepared.input,
          instructions: this._config.instructions,
          tools: [], // No tools - force text-only response
          temperature: this._config.temperature,
          vendorOptions: this._config.vendorOptions,
        })) {
          // Update stream state
          if (event.type === StreamEventType.OUTPUT_TEXT_DELTA) {
            wrapUpStreamState.accumulateTextDelta(event.item_id, event.delta);
          } else if (event.type === StreamEventType.RESPONSE_COMPLETE) {
            wrapUpStreamState.updateUsage(event.usage);
            continue; // Don't yield provider's RESPONSE_COMPLETE
          }
          yield event;
        }

        // Add wrap-up response to context
        this._addStreamingAssistantMessage(wrapUpStreamState, []);
        globalStreamState.accumulateUsage(wrapUpStreamState.usage);

        // Emit event for max iterations reached
        this.emit('execution:maxIterations', {
          executionId,
          iteration,
          maxIterations,
          timestamp: new Date(),
        });

        yield {
          type: StreamEventType.RESPONSE_COMPLETE,
          response_id: executionId,
          status: 'completed', // Now completed with wrap-up message
          usage: globalStreamState.usage,
          iterations: iteration + 1, // Include wrap-up iteration
          duration_ms: Date.now() - startTime,
        };

        wrapUpStreamState.clear();
      }

      // Run post-cycle consolidation (summarization, memory optimization, etc.)
      await this._agentContext.consolidate();

      // Finalize execution
      const placeholderResponse = this._buildPlaceholderResponse(executionId, startTime, globalStreamState);
      await this._finalizeExecution(executionId, startTime, placeholderResponse, 'stream');
    } catch (error) {
      this._handleExecutionError(executionId, error as Error, startTime, 'stream');

      yield {
        type: StreamEventType.ERROR,
        response_id: executionId,
        error: {
          type: 'execution_error',
          message: (error as Error).message,
        },
        recoverable: false,
      };

      throw error;
    } finally {
      this._runOptions = undefined;
      this._executionActive = false;
      this._cleanupExecution(globalStreamState);

      // If async results arrived while we were streaming, schedule a flush
      if (this._asyncResultQueue.length > 0 && (this._config.asyncTools?.autoContinue !== false)) {
        setTimeout(() => this._flushAsyncResults(), 0);
      }
    }
  }

  // ===== LLM Generation with Hooks =====

  /**
   * Generate LLM response with hooks
   */
  private async generateWithHooks(
    input: InputItem[],
    iteration: number,
    executionId: string
  ): Promise<AgentResponse> {
    const llmStartTime = Date.now();

    // Prepare options (per-call RunOptions override agent-level config)
    const ro = this._runOptions;
    let generateOptions: TextGenerateOptions = {
      model: this.model,
      input,
      instructions: this._config.instructions,
      tools: this.getEnabledToolDefinitions(),
      tool_choice: 'auto',
      temperature: ro?.temperature ?? this._config.temperature,
      thinking: ro?.thinking ?? this._config.thinking,
      vendorOptions: ro?.vendorOptions
        ? { ...this._config.vendorOptions, ...ro.vendorOptions }
        : this._config.vendorOptions,
    };

    // Execute before:llm hook
    const beforeLLM = await this.hookManager.executeHooks('before:llm', {
      executionId,
      iteration,
      options: generateOptions,
      context: this.executionContext!,
      timestamp: new Date(),
    }, {});

    // Apply modifications
    if (beforeLLM.modified) {
      generateOptions = { ...generateOptions, ...beforeLLM.modified };
    }

    // Skip if requested
    if (beforeLLM.skip) {
      throw new Error('LLM call skipped by hook');
    }

    // Emit LLM request
    this.emit('llm:request', {
      executionId,
      iteration,
      options: generateOptions,
      timestamp: new Date(),
    });

    try {
      // Call provider
      const response = await this._provider.generate(generateOptions);

      const llmDuration = Date.now() - llmStartTime;

      // Update metrics
      this.executionContext?.updateMetrics({
        llmDuration: (this.executionContext.metrics.llmDuration || 0) + llmDuration,
      });

      // Emit LLM response
      this.emit('llm:response', {
        executionId,
        iteration,
        response,
        timestamp: new Date(),
        duration: llmDuration,
      });

      // Execute after:llm hook
      await this.hookManager.executeHooks('after:llm', {
        executionId,
        iteration,
        response,
        context: this.executionContext!,
        timestamp: new Date(),
        duration: llmDuration,
      }, {});

      return response;
    } catch (error) {
      // Emit LLM error
      this.emit('llm:error', {
        executionId,
        iteration,
        error: error as Error,
        timestamp: new Date(),
      });

      throw error;
    }
  }

  /**
   * Stream LLM response with hooks
   */
  private async *streamGenerateWithHooks(
    input: InputItem[],
    iteration: number,
    executionId: string,
    streamState: StreamState,
    toolCallsMap: Map<string, { name: string; args: string }>
  ): AsyncIterableIterator<StreamEvent> {
    const llmStartTime = Date.now();

    // Prepare options (per-call RunOptions override agent-level config)
    const sro = this._runOptions;
    const generateOptions: TextGenerateOptions = {
      model: this.model,
      input,
      instructions: this._config.instructions,
      tools: this.getEnabledToolDefinitions(),
      tool_choice: 'auto',
      temperature: sro?.temperature ?? this._config.temperature,
      thinking: sro?.thinking ?? this._config.thinking,
      vendorOptions: sro?.vendorOptions
        ? { ...this._config.vendorOptions, ...sro.vendorOptions }
        : this._config.vendorOptions,
    };

    // Execute before:llm hook
    await this.hookManager.executeHooks('before:llm', {
      executionId,
      iteration,
      options: generateOptions,
      context: this.executionContext!,
      timestamp: new Date(),
    }, {});

    // Emit LLM request event
    this.emit('llm:request', {
      executionId,
      iteration,
      model: this.model,
      timestamp: new Date(),
    });

    try {
      // Stream from provider
      for await (const event of this._provider.streamGenerate(generateOptions)) {
        // Update stream state based on event
        if (isReasoningDelta(event)) {
          streamState.accumulateReasoningDelta(event.item_id, event.delta);
        } else if (event.type === StreamEventType.OUTPUT_TEXT_DELTA) {
          streamState.accumulateTextDelta(event.item_id, event.delta);
        } else if (event.type === StreamEventType.TOOL_CALL_START) {
          streamState.startToolCall(event.tool_call_id, event.tool_name);
          toolCallsMap.set(event.tool_call_id, { name: event.tool_name, args: '' });
        } else if (event.type === StreamEventType.TOOL_CALL_ARGUMENTS_DELTA) {
          streamState.accumulateToolArguments(event.tool_call_id, event.delta);
          const buffer = toolCallsMap.get(event.tool_call_id);
          if (buffer) {
            buffer.args += event.delta;
          }
        } else if (isToolCallArgumentsDone(event)) {
          streamState.completeToolCall(event.tool_call_id);
          const buffer = toolCallsMap.get(event.tool_call_id);
          if (buffer) {
            buffer.args = event.arguments;
          }
        } else if (event.type === StreamEventType.RESPONSE_COMPLETE) {
          const completeEvent = event as ResponseCompleteEvent;
          streamState.updateUsage(completeEvent.usage);
          streamState.providerStatus = completeEvent.status;
          streamState.stopReason = completeEvent.stop_reason;
          // Don't yield provider's RESPONSE_COMPLETE - we emit our own at the end
          continue;
        }

        // Yield event to caller
        yield event;
      }

      // Update metrics
      if (this.executionContext) {
        this.executionContext.metrics.llmDuration += Date.now() - llmStartTime;
        this.executionContext.metrics.inputTokens += streamState.usage.input_tokens;
        this.executionContext.metrics.outputTokens += streamState.usage.output_tokens;
        this.executionContext.metrics.totalTokens += streamState.usage.total_tokens;
      }

      // Execute after:llm hook with a placeholder response for streaming
      const llmPlaceholderResponse: AgentResponse = {
        id: executionId,
        object: 'response',
        created_at: Math.floor(llmStartTime / 1000),
        status: 'completed',
        model: this.model,
        output: [],
        usage: streamState.usage,
      };
      await this.hookManager.executeHooks('after:llm', {
        executionId,
        iteration,
        response: llmPlaceholderResponse,
        context: this.executionContext!,
        timestamp: new Date(),
        duration: Date.now() - llmStartTime,
      }, {});

      // Emit LLM response event
      this.emit('llm:response', {
        executionId,
        iteration,
        timestamp: new Date(),
      });
    } catch (error) {
      this.emit('llm:error', {
        executionId,
        iteration,
        error: error as Error,
        timestamp: new Date(),
      });
      throw error;
    }
  }

  // ===== Tool Execution =====

  /**
   * Extract tool calls from response output
   */
  private extractToolCalls(output: OutputItem[]): ToolCall[] {
    const toolCalls: ToolCall[] = [];
    const toolDefinitions = this.getEnabledToolDefinitions();

    // Create tool map for quick lookup
    const toolMap = new Map<string, Tool>();
    for (const tool of toolDefinitions) {
      if (tool.type === 'function') {
        toolMap.set(tool.function.name, tool);
      }
    }

    // Extract tool calls from output
    for (const item of output) {
      if (item.type === 'message' && item.role === MessageRole.ASSISTANT) {
        for (const content of item.content) {
          if (content.type === ContentType.TOOL_USE) {
            const toolDef = toolMap.get(content.name);
            const isBlocking = toolDef?.blocking !== false;

            const toolCall: ToolCall = {
              id: content.id,
              type: 'function',
              function: {
                name: content.name,
                arguments: content.arguments,
              },
              blocking: isBlocking,
              state: ToolCallState.PENDING,
            };

            toolCalls.push(toolCall);
          }
        }
      }
    }

    return toolCalls;
  }

  /**
   * Execute tools with hooks.
   * Blocking tools (blocking !== false) are executed sequentially as before.
   * Async tools (blocking === false) return a placeholder result immediately
   * and execute in the background.
   */
  private async executeToolsWithHooks(
    toolCalls: ToolCall[],
    iteration: number,
    executionId: string
  ): Promise<ToolResult[]> {
    const results: ToolResult[] = [];

    for (const toolCall of toolCalls) {
      // Add to context
      this.executionContext?.addToolCall(toolCall);

      // Check pause before each tool
      await this.checkPause();

      // Execute before:tool hook
      const beforeTool = await this.hookManager.executeHooks('before:tool', {
        executionId,
        iteration,
        toolCall,
        context: this.executionContext!,
        timestamp: new Date(),
      }, {});

      // Check if tool should be skipped
      if (beforeTool.skip) {
        this.executionContext?.audit('tool_skipped', { toolCall }, undefined, toolCall.function.name);

        // Parse args for tracking
        let parsedArgs: Record<string, unknown> = {};
        try {
          parsedArgs = JSON.parse(toolCall.function.arguments);
        } catch (parseErr) {
          this._logger.debug({ tool: toolCall.function.name, error: (parseErr as Error).message }, 'Failed to parse tool arguments for tracking');
        }

        const mockResult: ToolResult = {
          tool_use_id: toolCall.id,
          tool_name: toolCall.function.name,
          tool_args: parsedArgs,
          content: beforeTool.mockResult || '',
          state: ToolCallState.COMPLETED,
          executionTime: 0,
        };

        results.push(mockResult);
        this.executionContext?.addToolResult(mockResult);
        continue;
      }

      // Apply modifications if any
      if (beforeTool.modified) {
        Object.assign(toolCall, beforeTool.modified);
        this.executionContext?.audit('tool_modified', { modifications: beforeTool.modified }, undefined, toolCall.function.name);
      }

      // Async tool: return placeholder, execute in background
      if (!toolCall.blocking) {
        const placeholderResult = this._startAsyncExecution(toolCall, executionId);
        results.push(placeholderResult);
        this.executionContext?.addToolResult(placeholderResult);
        continue;
      }

      // Blocking tool: execute synchronously as before
      try {
        const result = await this.executeToolWithHooks(toolCall, iteration, executionId);
        results.push(result);
        this.executionContext?.addToolResult(result);
      } catch (error) {
        // Parse args for tracking (even on error)
        let parsedArgs: Record<string, unknown> = {};
        try {
          parsedArgs = JSON.parse(toolCall.function.arguments);
        } catch (parseErr) {
          this._logger.debug({ tool: toolCall.function.name, error: (parseErr as Error).message }, 'Failed to parse tool arguments for tracking');
        }

        const toolResult: ToolResult = {
          tool_use_id: toolCall.id,
          tool_name: toolCall.function.name,
          tool_args: parsedArgs,
          content: '',
          error: (error as Error).message,
          state: ToolCallState.FAILED,
        };

        results.push(toolResult);
        this.executionContext?.addToolResult(toolResult);

        // Check tool failure mode
        const failureMode = this._config.errorHandling?.toolFailureMode || 'continue';
        if (failureMode === 'fail') {
          throw error;
        }
      }
    }

    return results;
  }

  /**
   * Execute single tool with hooks
   */
  private async executeToolWithHooks(
    toolCall: ToolCall,
    iteration: number,
    executionId: string
  ): Promise<ToolResult> {
    const toolStartTime = Date.now();

    toolCall.state = ToolCallState.EXECUTING;
    toolCall.startTime = new Date();

    // Permission check
    const permissionApproved = await this.checkToolPermission(toolCall, iteration, executionId);

    // Execute approve:tool hook if needed
    if (!permissionApproved || this.hookManager.hasHooks('approve:tool')) {
      const approval = await this.hookManager.executeHooks('approve:tool', {
        executionId,
        iteration,
        toolCall,
        context: this.executionContext!,
        timestamp: new Date(),
      }, { approved: permissionApproved });

      if (!approval.approved) {
        throw new Error(`Tool execution rejected: ${approval.reason || 'No reason provided'}`);
      }
    }

    // Emit tool start
    this.emit('tool:start', { executionId, iteration, toolCall, timestamp: new Date() });

    try {
      // Execute tool (timeout is handled by ToolManager per-tool)
      let args: Record<string, unknown>;
      try {
        args = JSON.parse(toolCall.function.arguments);
      } catch (parseError) {
        throw new Error(`Failed to parse tool arguments for ${toolCall.function.name}: ${(parseError as Error).message}`);
      }
      const result = await this._agentContext.tools.execute(toolCall.function.name, args);

      toolCall.state = ToolCallState.COMPLETED;
      toolCall.endTime = new Date();

      let toolResult: ToolResult = {
        tool_use_id: toolCall.id,
        tool_name: toolCall.function.name,
        tool_args: args,
        content: result,
        state: ToolCallState.COMPLETED,
        executionTime: Date.now() - toolStartTime,
      };

      // Execute after:tool hook
      const afterTool = await this.hookManager.executeHooks('after:tool', {
        executionId,
        iteration,
        toolCall,
        result: toolResult,
        context: this.executionContext!,
        timestamp: new Date(),
      }, {});

      // Apply result modifications
      if (afterTool.modified) {
        toolResult = { ...toolResult, ...afterTool.modified };
      }

      // Update metrics
      if (this.executionContext) {
        this.executionContext.metrics.toolCallCount++;
        this.executionContext.metrics.toolSuccessCount++;
        this.executionContext.metrics.toolDuration += toolResult.executionTime || 0;
      }

      // Emit tool complete
      this.emit('tool:complete', { executionId, iteration, toolCall, result: toolResult, timestamp: new Date() });

      return toolResult;
    } catch (error) {
      toolCall.state = ToolCallState.FAILED;
      toolCall.endTime = new Date();
      toolCall.error = (error as Error).message;

      // Update metrics
      if (this.executionContext) {
        this.executionContext.metrics.toolFailureCount++;
      }

      // Handle permission denied — return as tool result instead of throwing
      // so the LLM loop gets informed and can adjust
      if (error instanceof ToolPermissionDeniedError) {
        this.emit('tool:error', { executionId, iteration, toolCall, error, timestamp: new Date() });

        // Build an informative message so the LLM understands and adjusts behavior
        const policyInfo = error.details?.policyName ? ` (policy: ${error.details.policyName})` : '';
        const approvalHint = error.details?.approvalRequired
          ? ' The user was asked for permission and denied it.'
          : ' This tool is blocked by a permission policy.';

        return {
          tool_use_id: toolCall.id,
          tool_name: toolCall.function.name,
          tool_args: {},
          content: `PERMISSION DENIED for tool '${toolCall.function.name}': ${error.reason}${policyInfo}.${approvalHint}\n\n`
            + 'Do NOT retry this exact tool call — the user has explicitly denied permission. '
            + 'Inform the user that the operation was blocked and ask how they would like to proceed, '
            + 'or try an alternative approach that does not require this tool.',
          state: ToolCallState.FAILED,
          executionTime: Date.now() - toolStartTime,
        };
      }

      // Emit tool error or timeout
      if (error instanceof ToolTimeoutError) {
        this.emit('tool:timeout', {
          executionId,
          iteration,
          toolCall,
          timeout: error.timeoutMs,
          timestamp: new Date(),
        });
      } else {
        this.emit('tool:error', { executionId, iteration, toolCall, error: error as Error, timestamp: new Date() });
      }

      throw error;
    }
  }

  /**
   * Check tool permission before execution.
   *
   * When the PermissionEnforcementPlugin is active on the ToolManager pipeline,
   * this becomes a no-op — the pipeline handles enforcement for ALL paths.
   * This legacy path is kept for backward compatibility when pipeline enforcement
   * is not active.
   */
  private async checkToolPermission(
    toolCall: ToolCall,
    iteration: number,
    executionId: string
  ): Promise<boolean> {
    // If pipeline enforcement is active, skip legacy check to avoid double-checking
    if (this._agentContext.tools.hasPermissionEnforcement()) {
      return true;
    }

    // Legacy path: check via ToolPermissionManager
    // Check if blocked first
    if (this._permissionManager.isBlocked(toolCall.function.name)) {
      this.executionContext?.audit('tool_blocked', { reason: 'Tool is blocklisted' }, undefined, toolCall.function.name);
      throw new Error(`Tool "${toolCall.function.name}" is blocked and cannot be executed`);
    }

    // Check if already approved
    if (this._permissionManager.isApproved(toolCall.function.name)) {
      return true;
    }

    // Check if needs approval
    const checkResult = this._permissionManager.checkPermission(toolCall.function.name);
    if (!checkResult.needsApproval) {
      return true;
    }

    // Parse arguments for context
    let parsedArgs: Record<string, unknown> = {};
    try {
      parsedArgs = JSON.parse(toolCall.function.arguments);
    } catch {
      // Use empty args if parsing fails
    }

    // Build permission context
    const context: PermissionCheckContext = {
      toolCall,
      parsedArgs,
      config: checkResult.config || {},
      executionId,
      iteration,
      agentType: 'agent',
    };

    // Request approval via permission manager's callback
    const decision = await this._permissionManager.requestApproval(context);

    if (decision.approved) {
      this.executionContext?.audit('tool_permission_approved', {
        scope: decision.scope,
        approvedBy: decision.approvedBy,
      }, undefined, toolCall.function.name);
      return true;
    }

    return false;
  }

  // ===== Async Tool Execution =====

  /**
   * Start async (non-blocking) tool execution.
   * Returns a placeholder ToolResult immediately.
   * The tool executes in the background and results are delivered
   * as a new user message when complete.
   */
  private _startAsyncExecution(toolCall: ToolCall, executionId: string): ToolResult {
    let parsedArgs: Record<string, unknown> = {};
    try {
      parsedArgs = JSON.parse(toolCall.function.arguments);
    } catch { /* ignore parse errors */ }

    const asyncConfig = this._config.asyncTools ?? {};
    const timeout = asyncConfig.asyncTimeout ?? 300000; // 5 min default

    // Track the pending async tool
    const pending: PendingAsyncTool = {
      toolCallId: toolCall.id,
      toolName: toolCall.function.name,
      args: parsedArgs,
      startTime: Date.now(),
      status: 'running',
    };
    this._asyncToolTracker.set(toolCall.id, pending);

    // Emit async:tool:started
    this.emit('async:tool:started', {
      executionId,
      toolCallId: toolCall.id,
      toolName: toolCall.function.name,
      args: parsedArgs,
      timestamp: new Date(),
    });

    // Fire-and-forget execution with timeout
    const executionPromise = this._agentContext.tools.execute(toolCall.function.name, parsedArgs);
    let timeoutId: ReturnType<typeof setTimeout>;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new ToolTimeoutError(toolCall.function.name, timeout)), timeout);
    });

    Promise.race([executionPromise, timeoutPromise])
      .then((result) => {
        clearTimeout(timeoutId);
        if (this._isDestroyed) return; // agent destroyed
        if (!this._asyncToolTracker.has(toolCall.id)) return; // cancelled
        pending.status = 'completed';
        const toolResult: ToolResult = {
          tool_use_id: toolCall.id,
          tool_name: toolCall.function.name,
          tool_args: parsedArgs,
          content: result,
          state: ToolCallState.COMPLETED,
          executionTime: Date.now() - pending.startTime,
        };
        pending.result = toolResult;
        this.emit('async:tool:complete', {
          executionId,
          toolCallId: toolCall.id,
          toolName: toolCall.function.name,
          result: toolResult,
          duration: toolResult.executionTime!,
          timestamp: new Date(),
        });
        this._onAsyncComplete(toolCall.id, toolResult);
      })
      .catch((error: Error) => {
        clearTimeout(timeoutId);
        if (this._isDestroyed) return; // agent destroyed
        if (!this._asyncToolTracker.has(toolCall.id)) return; // cancelled
        const isTimeout = error instanceof ToolTimeoutError;
        pending.status = isTimeout ? 'timeout' : 'failed';
        pending.error = error;
        const toolResult: ToolResult = {
          tool_use_id: toolCall.id,
          tool_name: toolCall.function.name,
          tool_args: parsedArgs,
          content: '',
          error: error.message,
          state: isTimeout ? ToolCallState.TIMEOUT : ToolCallState.FAILED,
          executionTime: Date.now() - pending.startTime,
        };
        pending.result = toolResult;
        if (isTimeout) {
          this.emit('async:tool:timeout', {
            executionId,
            toolCallId: toolCall.id,
            toolName: toolCall.function.name,
            timeout,
            timestamp: new Date(),
          });
        } else {
          this.emit('async:tool:error', {
            executionId,
            toolCallId: toolCall.id,
            toolName: toolCall.function.name,
            error,
            duration: Date.now() - pending.startTime,
            timestamp: new Date(),
          });
        }
        this._onAsyncComplete(toolCall.id, toolResult);
      });

    // Return placeholder result immediately
    return {
      tool_use_id: toolCall.id,
      tool_name: toolCall.function.name,
      tool_args: parsedArgs,
      content: `Tool "${toolCall.function.name}" is executing asynchronously. The result will be delivered in a follow-up message. Continue with other work in the meantime.`,
      state: ToolCallState.COMPLETED,
      executionTime: 0,
    };
  }

  /**
   * Called when an async tool completes (success or failure).
   * Queues the result and schedules batch delivery.
   */
  private _onAsyncComplete(toolCallId: string, result: ToolResult): void {
    if (!this._asyncToolTracker.has(toolCallId)) return; // already cancelled/removed

    this._asyncResultQueue.push(result);
    this._asyncToolTracker.delete(toolCallId);

    const asyncConfig = this._config.asyncTools ?? {};
    const batchWindowMs = asyncConfig.batchWindowMs ?? 500;
    const autoContinue = asyncConfig.autoContinue !== false; // default true

    // If all pending are done, flush immediately
    if (this._asyncToolTracker.size === 0) {
      if (this._asyncBatchTimer) {
        clearTimeout(this._asyncBatchTimer);
        this._asyncBatchTimer = null;
      }
      if (autoContinue) {
        this._flushAsyncResults();
      }
      return;
    }

    // Otherwise batch: start/reset timer
    if (this._asyncBatchTimer) {
      clearTimeout(this._asyncBatchTimer);
    }
    if (autoContinue) {
      this._asyncBatchTimer = setTimeout(() => {
        this._asyncBatchTimer = null;
        this._flushAsyncResults();
      }, batchWindowMs);
    }
  }

  /**
   * Flush queued async results by triggering a continuation.
   */
  private _flushAsyncResults(): void {
    if (this._isDestroyed) return;
    if (this._asyncResultQueue.length === 0) return;
    if (this._continuationInProgress) return; // wait for current continuation to finish
    if (this._executionActive) return; // results stay queued, flushed after run/stream ends

    // Fire and forget — errors logged internally
    this.continueWithAsyncResults().catch((err) => {
      this._logger.error({ error: (err as Error).message }, 'Auto-continuation failed');
    });
  }

  /**
   * Continue the agentic loop with async tool results.
   * Can be called automatically (autoContinue) or manually by the caller.
   *
   * Injects results as a user message and re-enters the agentic loop.
   */
  async continueWithAsyncResults(results?: ToolResult[]): Promise<AgentResponse> {
    assertNotDestroyed(this, 'continue with async results');

    if (this._continuationInProgress) {
      throw new Error('A continuation is already in progress');
    }

    this._continuationInProgress = true;
    this._executionActive = true;

    try {
      // Drain queue if no explicit results provided
      const toDeliver = results ?? this._asyncResultQueue.splice(0, this._asyncResultQueue.length);
      if (toDeliver.length === 0) {
        throw new Error('No async results to deliver');
      }

      // Build user message with results
      const parts: string[] = ['[Async Tool Results]'];
      for (const result of toDeliver) {
        const toolName = result.tool_name || 'unknown';
        const toolCallId = result.tool_use_id;
        if (result.error) {
          parts.push(`\nTool "${toolName}" (${toolCallId}) failed:\nError: ${result.error}`);
        } else {
          const content = typeof result.content === 'string'
            ? result.content
            : JSON.stringify(result.content, null, 2);
          parts.push(`\nTool "${toolName}" (${toolCallId}) completed:\n${content}`);
        }
      }
      parts.push('\nProcess these results and continue.');

      const executionId = `exec_async_${randomUUID()}`;
      const startTime = Date.now();
      const maxIterations = this._config.maxIterations || AGENT_DEFAULTS.MAX_ITERATIONS;

      // Emit continuation start
      this.emit('async:continuation:start', {
        executionId,
        results: toDeliver.map(r => ({ toolCallId: r.tool_use_id, toolName: r.tool_name || 'unknown' })),
        timestamp: new Date(),
      });

      // Set current input for task type detection
      this._agentContext.setCurrentInput(parts.join('\n'));

      // Inject as user message
      this._agentContext.addUserMessage(parts.join('\n'));

      // Create execution context for this continuation
      this.executionContext = new ExecutionContext(executionId, {
        maxHistorySize: 10,
        historyMode: this._config.historyMode || 'summary',
        maxAuditTrailSize: 1000,
      });

      // Reset control state
      this._paused = false;
      this._cancelled = false;

      this.emit('execution:start', {
        executionId,
        config: { model: this.model, maxIterations },
        timestamp: new Date(),
      });

      // Use shared agentic loop
      const finalResponse = await this._runAgenticLoop(executionId, startTime, maxIterations);

      await this._finalizeExecution(executionId, startTime, finalResponse, 'run');
      return finalResponse;
    } finally {
      this._continuationInProgress = false;
      this._executionActive = false;
      this._cleanupExecution();

      // If async results arrived during continuation, schedule a flush
      if (this._asyncResultQueue.length > 0 && (this._config.asyncTools?.autoContinue !== false)) {
        setTimeout(() => this._flushAsyncResults(), 0);
      }
    }
  }

  // ===== Async Tool Public Accessors =====

  /**
   * Check if there are any pending async tools
   */
  hasPendingAsyncTools(): boolean {
    return this._asyncToolTracker.size > 0;
  }

  /**
   * Get info about pending async tools
   */
  getPendingAsyncTools(): PendingAsyncTool[] {
    return Array.from(this._asyncToolTracker.values());
  }

  /**
   * Cancel a specific async tool by toolCallId
   */
  cancelAsyncTool(toolCallId: string): void {
    const pending = this._asyncToolTracker.get(toolCallId);
    if (pending) {
      pending.status = 'cancelled';
      this._asyncToolTracker.delete(toolCallId);
    }
  }

  /**
   * Cancel all pending async tools
   */
  cancelAllAsyncTools(): void {
    for (const pending of this._asyncToolTracker.values()) {
      pending.status = 'cancelled';
    }
    this._asyncToolTracker.clear();
    this._asyncResultQueue = [];
    this._pendingInjections = [];
    if (this._asyncBatchTimer) {
      clearTimeout(this._asyncBatchTimer);
      this._asyncBatchTimer = null;
    }
  }

  // ===== Pause/Resume/Cancel =====

  /**
   * Pause execution
   */
  pause(reason?: string): void {
    this._pauseResumeMutex = this._pauseResumeMutex.then(() => {
      if (this._paused) return;

      this._paused = true;
      this._pausePromise = new Promise((resolve) => {
        this._resumeCallback = resolve;
      });

      if (this.executionContext) {
        this.executionContext.paused = true;
        this.executionContext.pauseReason = reason;
        this.executionContext.audit('execution_paused', { reason });
      }

      this.emit('execution:paused', {
        executionId: this.executionContext?.executionId || 'unknown',
        reason: reason || 'Manual pause',
        timestamp: new Date(),
      });
    });
  }

  /**
   * Resume execution
   */
  resume(): void {
    this._pauseResumeMutex = this._pauseResumeMutex.then(() => {
      if (!this._paused) return;

      this._paused = false;

      if (this.executionContext) {
        this.executionContext.paused = false;
        this.executionContext.pauseReason = undefined;
        this.executionContext.audit('execution_resumed', {});
      }

      if (this._resumeCallback) {
        this._resumeCallback();
        this._resumeCallback = null;
      }

      this._pausePromise = null;

      this.emit('execution:resumed', {
        executionId: this.executionContext?.executionId || 'unknown',
        timestamp: new Date(),
      });
    });
  }

  /**
   * Cancel execution
   */
  cancel(reason?: string): void {
    this._cancelled = true;

    if (this.executionContext) {
      this.executionContext.cancelled = true;
      this.executionContext.cancelReason = reason;
    }

    // Resume if paused (to allow cancellation to proceed)
    if (this._paused) {
      this._paused = false;
      if (this._resumeCallback) {
        this._resumeCallback();
        this._resumeCallback = null;
      }
      this._pausePromise = null;
    }

    this.emit('execution:cancelled', {
      executionId: this.executionContext?.executionId || 'unknown',
      reason: reason || 'Manual cancellation',
      timestamp: new Date(),
    });
  }

  /**
   * Inject a message into this agent's context, to be processed on the next
   * agentic loop iteration. Safe to call while the agent is running.
   *
   * Used by orchestrator tools (send_message) to communicate with workers
   * during or between turns.
   *
   * @param message - Text message to inject
   * @param role - Message role: 'user' (default) or 'developer'
   */
  inject(message: string, role: 'user' | 'developer' = 'user'): void {
    // M3: Drop oldest injections if queue is full
    if (this._pendingInjections.length >= Agent.MAX_PENDING_INJECTIONS) {
      this._pendingInjections.shift();
    }
    this._pendingInjections.push({
      type: 'message',
      role: role === 'developer' ? MessageRole.DEVELOPER : MessageRole.USER,
      content: [{ type: ContentType.INPUT_TEXT, text: message }],
    });
  }

  /**
   * Check if paused and wait
   */
  private async checkPause(): Promise<void> {
    if (this._paused && this._pausePromise) {
      await this._pausePromise;
    }
  }

  // ===== Tool Management =====
  // Note: addTool, removeTool, listTools, setTools are inherited from BaseAgent

  // ===== Permission Convenience Methods =====

  approveToolForSession(toolName: string): void {
    this._permissionManager.approveForSession(toolName);
  }

  revokeToolApproval(toolName: string): void {
    this._permissionManager.revoke(toolName);
  }

  getApprovedTools(): string[] {
    return this._permissionManager.getApprovedTools();
  }

  toolNeedsApproval(toolName: string): boolean {
    return this._permissionManager.checkPermission(toolName).needsApproval;
  }

  toolIsBlocked(toolName: string): boolean {
    return this._permissionManager.isBlocked(toolName);
  }

  allowlistTool(toolName: string): void {
    this._permissionManager.allowlistAdd(toolName);
  }

  blocklistTool(toolName: string): void {
    this._permissionManager.blocklistAdd(toolName);
  }

  // ===== Configuration Methods =====

  setModel(model: string): void {
    (this as { model: string }).model = model;
    this._config.model = model;
  }

  getTemperature(): number | undefined {
    return this._config.temperature;
  }

  setTemperature(temperature: number): void {
    this._config.temperature = temperature;
  }

  // ===== Definition Persistence =====

  async saveDefinition(
    storage?: IAgentDefinitionStorage,
    metadata?: AgentDefinitionMetadata
  ): Promise<void> {
    const s = storage ?? StorageRegistry.get('agentDefinitions');
    if (!s) {
      throw new Error('No storage provided and no agentDefinitions configured in StorageRegistry');
    }
    const now = new Date().toISOString();

    const definition: StoredAgentDefinition = {
      version: 1,
      agentId: this._agentContext.agentId,
      name: this._agentContext.agentId,
      agentType: 'agent',
      createdAt: now,
      updatedAt: now,
      connector: {
        name: this.connector.name,
        model: this.model,
      },
      systemPrompt: this._agentContext.systemPrompt,
      instructions: this._config.instructions,
      features: this._agentContext.features,
      metadata,
      typeConfig: {
        temperature: this._config.temperature,
        maxIterations: this._config.maxIterations,
        vendorOptions: this._config.vendorOptions,
      },
    };

    await s.save(definition);
  }

  // ===== Introspection =====

  getExecutionContext(): ExecutionContext | null {
    return this.executionContext;
  }

  /**
   * Alias for getExecutionContext() for backward compatibility
   */
  getContext(): ExecutionContext | null {
    return this.executionContext;
  }

  getMetrics() {
    return this.executionContext?.metrics || null;
  }

  getSummary() {
    return this.executionContext?.getSummary() || null;
  }

  getAuditTrail() {
    return this.executionContext?.getAuditTrail() || [];
  }

  getProviderCircuitBreakerMetrics() {
    if ('getCircuitBreakerMetrics' in this._provider) {
      return (this._provider as { getCircuitBreakerMetrics: () => unknown }).getCircuitBreakerMetrics();
    }
    return null;
  }

  getToolCircuitBreakerStates() {
    return this._agentContext.tools.getCircuitBreakerStates();
  }

  getToolCircuitBreakerMetrics(toolName: string) {
    return this._agentContext.tools.getToolCircuitBreakerMetrics(toolName);
  }

  resetToolCircuitBreaker(toolName: string): void {
    this._agentContext.tools.resetToolCircuitBreaker(toolName);
    this._logger.info({ toolName }, 'Tool circuit breaker reset by user');
  }

  isRunning(): boolean {
    return this.executionContext !== null && !this._cancelled;
  }

  isPaused(): boolean {
    return this._paused;
  }

  isCancelled(): boolean {
    return this._cancelled;
  }

  /**
   * Clear conversation history, resetting the context for a fresh interaction.
   * Plugins (working memory, in-context memory, etc.) are NOT affected.
   */
  clearConversation(reason?: string): void {
    this._agentContext.clearConversation(reason);
    this._logger.info({ reason }, 'Conversation cleared');
  }

  // ===== Hook Management =====

  /**
   * Register a hook on the agent. Can be called after creation.
   */
  registerHook(name: HookName, hook: Function): void {
    this.hookManager.register(name, hook as any);
  }

  /**
   * Unregister a previously registered hook by reference.
   */
  unregisterHook(name: HookName, hook: Function): boolean {
    return this.hookManager.unregister(name, hook as any);
  }

  // ===== Cleanup =====

  destroy(): void {
    if (this._isDestroyed) {
      return;
    }

    this._logger.debug('Agent destroy started');

    // Cancel any ongoing execution
    try {
      this.cancel('Agent destroyed');
    } catch {
      // Ignore errors during cancel
    }

    // Cancel all pending async tools
    this.cancelAllAsyncTools();
    if (this._asyncBatchTimer) {
      clearTimeout(this._asyncBatchTimer);
      this._asyncBatchTimer = null;
    }
    this._continuationInProgress = false;
    this._executionActive = false;

    // Remove ToolManager listener before context is destroyed
    if (this._toolRegisteredListener) {
      this._agentContext.tools.off('tool:registered', this._toolRegisteredListener);
      this._toolRegisteredListener = null;
    }

    // Cleanup hook manager
    this.hookManager.destroy();

    // Cleanup execution context
    this.executionContext?.cleanup();
    this.executionContext = null;

    // Note: AgentContext cleanup is handled by baseDestroy() in BaseAgent

    // Run cleanup callbacks
    for (const callback of this._cleanupCallbacks) {
      try {
        callback();
      } catch (error) {
        this._logger.error({ error: (error as Error).message }, 'Cleanup callback error');
      }
    }
    this._cleanupCallbacks = [];

    // Unregister from AgentRegistry
    AgentRegistry.unregister(this.registryId, 'destroyed');

    // Call base destroy (handles session, tool manager, permission manager cleanup)
    this.baseDestroy();

    metrics.increment('agent.destroyed', 1, {
      model: this.model,
      connector: this.connector.name,
    });

    this._logger.debug('Agent destroyed');
  }
}
