/**
 * BaseAgent - Abstract base class for all agent types
 *
 * Provides shared functionality for:
 * - Connector resolution
 * - Tool manager initialization
 * - Permission manager initialization
 * - Session management (via AgentContextNextGen)
 * - Lifecycle/cleanup
 *
 * This is an INTERNAL class - not exported in the public API.
 * Use Agent instead.
 */

import { randomUUID } from 'crypto';
import { EventEmitter } from 'eventemitter3';
import { Connector } from './Connector.js';
import { ToolManager } from './ToolManager.js';
import type { ToolOptions } from './ToolManager.js';
import { ToolPermissionManager } from './permissions/ToolPermissionManager.js';
import { PermissionPolicyManager } from './permissions/PermissionPolicyManager.js';
import type { AgentPermissionsConfig, AgentPolicyConfig } from './permissions/types.js';
import type { Tool, ToolFunction } from '../domain/entities/Tool.js';
import { logger, FrameworkLogger } from '../infrastructure/observability/Logger.js';
import { AgentContextNextGen } from './context-nextgen/AgentContextNextGen.js';
import type { AgentContextNextGenConfig, AuthIdentity, SerializedContextState } from './context-nextgen/types.js';
import { createProvider } from './createProvider.js';
import type { ITextProvider, TextGenerateOptions, ThinkingConfig } from '../domain/interfaces/ITextProvider.js';
import type {
  AdvancedTextCapabilities,
  DataHandlingPolicy,
  IAsyncTextBatchProvider,
  NativeToolRequest,
  PromptCachePolicy,
} from '../domain/interfaces/IAdvancedInference.js';
import type { LLMResponse } from '../domain/entities/Response.js';
import {
  type ResponseFormat,
  resolveStructuredStrategy,
  toProviderResponseFormat,
  buildStructuredInstructionSuffix,
  buildStructuredRepairInstruction,
  parseStructuredOutput,
  StructuredOutputError,
  STRUCTURED_OUTPUT_MAX_REPAIR_ATTEMPTS,
} from './StructuredOutput.js';
import type { InputItem } from '../domain/entities/Message.js';
import type { StreamEvent } from '../domain/entities/StreamEvent.js';
import type { IContextStorage, ContextSessionMetadata } from '../domain/interfaces/IContextStorage.js';
import type { IConnectorRegistry } from '../domain/interfaces/IConnectorRegistry.js';
import { StorageRegistry } from './StorageRegistry.js';
import { ConnectorTools } from '../tools/connector/ConnectorTools.js';

/**
 * Options for tool registration
 */
export interface ToolRegistrationOptions {
  /** Namespace for the tool (e.g., 'user', '_meta', 'mcp:fs') */
  namespace?: string;
  /** Whether the tool is enabled by default */
  enabled?: boolean;
}

/**
 * Session configuration using AgentContext persistence
 */
export interface BaseSessionConfig {
  /** Storage backend for context sessions */
  storage: IContextStorage;
  /** Resume existing session by ID */
  id?: string;
  /** Auto-save session after each interaction */
  autoSave?: boolean;
  /** Auto-save interval in milliseconds */
  autoSaveIntervalMs?: number;
}

/**
 * Tool execution context passed to lifecycle hooks
 */
export interface ToolExecutionHookContext {
  /** Name of the tool being executed */
  toolName: string;
  /** Arguments passed to the tool */
  args: Record<string, unknown>;
  /** Agent ID */
  agentId: string;
  /** Task ID (if running in TaskAgent) */
  taskId?: string;
}

/**
 * Tool execution result passed to afterToolExecution hook
 */
export interface ToolExecutionResult {
  /** Name of the tool that was executed */
  toolName: string;
  /** Result returned by the tool */
  result: unknown;
  /** Execution duration in milliseconds */
  durationMs: number;
  /** Whether the execution was successful */
  success: boolean;
  /** Error if execution failed */
  error?: Error;
}

/**
 * Context passed to beforeCompaction hook
 */
export interface BeforeCompactionContext {
  /** Agent identifier */
  agentId: string;
  /** Current context budget info */
  currentBudget: {
    total: number;
    used: number;
    available: number;
    utilizationPercent: number;
    status: 'ok' | 'warning' | 'critical';
  };
  /** Compaction strategy being used */
  strategy: string;
  /** Current context components (read-only) */
  components: ReadonlyArray<{
    name: string;
    priority: number;
    compactable: boolean;
  }>;
  /** Estimated tokens to be freed */
  estimatedTokensToFree: number;
}

/**
 * Agent lifecycle hooks for customization.
 * These hooks allow external code to observe and modify agent behavior
 * at key points in the execution lifecycle.
 */
export interface AgentLifecycleHooks {
  /**
   * Called before a tool is executed.
   * Can be used for logging, validation, or rate limiting.
   * Throw an error to prevent tool execution.
   *
   * @param context - Tool execution context
   * @returns Promise that resolves when hook completes
   */
  beforeToolExecution?: (context: ToolExecutionHookContext) => Promise<void>;

  /**
   * Called after a tool execution completes (success or failure).
   * Can be used for logging, metrics, or cleanup.
   *
   * @param result - Tool execution result
   * @returns Promise that resolves when hook completes
   */
  afterToolExecution?: (result: ToolExecutionResult) => Promise<void>;

  /**
   * Called before context is prepared for LLM call.
   * Can be used to inject additional context or modify components.
   *
   * @param agentId - Agent identifier
   * @returns Promise that resolves when hook completes
   */
  beforeContextPrepare?: (agentId: string) => Promise<void>;

  /**
   * Called before context compaction occurs.
   * Use this hook to save important data to working memory before it's compacted.
   * This is your last chance to preserve critical information from tool outputs
   * or conversation history that would otherwise be lost.
   *
   * @param context - Compaction context with budget info and components
   * @returns Promise that resolves when hook completes
   */
  beforeCompaction?: (context: BeforeCompactionContext) => Promise<void>;

  /**
   * Called after context compaction occurs.
   * Can be used for logging or monitoring context management.
   *
   * @param log - Compaction log messages
   * @param tokensFreed - Number of tokens freed
   * @returns Promise that resolves when hook completes
   */
  afterCompaction?: (log: string[], tokensFreed: number) => Promise<void>;

  /**
   * Called when agent encounters an error.
   * Can be used for custom error handling or recovery logic.
   *
   * @param error - The error that occurred
   * @param context - Additional context about where the error occurred
   * @returns Promise that resolves when hook completes
   */
  onError?: (error: Error, context: { phase: string; agentId: string }) => Promise<void>;
}

/**
 * Base configuration shared by all agent types
 */
export interface BaseAgentConfig {
  /** Connector name or instance */
  connector: string | Connector;

  /** Model identifier */
  model: string;

  /** Optional scoped connector registry for access-controlled lookup */
  registry?: IConnectorRegistry;

  /** Agent name (optional, auto-generated if not provided) */
  name?: string;

  /** User ID for multi-user scenarios. Flows to ToolContext automatically for all tool executions. */
  userId?: string;

  /**
   * Restrict this agent to specific auth identities (connector + optional account alias).
   * Each identity produces its own tool set (e.g., microsoft_work_api, microsoft_personal_api).
   * When not set, all connectors visible to the current userId are available.
   */
  identities?: AuthIdentity[];

  /** Tools available to the agent */
  tools?: ToolFunction[];

  /** Provide a pre-configured ToolManager (advanced) */
  toolManager?: ToolManager;

  /** Session configuration (uses AgentContext persistence) */
  session?: BaseSessionConfig;

  /** Permission configuration (legacy or policy-based) */
  permissions?: AgentPermissionsConfig | AgentPolicyConfig;

  /** User roles for permission policy evaluation */
  userRoles?: string[];

  /** Lifecycle hooks for customization */
  lifecycleHooks?: AgentLifecycleHooks;

  /** Parent agent's registryId (for tracking agent hierarchies) */
  parentAgentId?: string;

  /**
   * Hard timeout in milliseconds for any single tool execution.
   * Acts as a safety net at the ToolManager level: if a tool's own timeout
   * mechanism fails, this will force-reject with an error.
   * Default: 0 (disabled - relies on each tool's own timeout).
   */
  toolExecutionTimeout?: number;

  /**
   * Optional AgentContextNextGen configuration.
   * If provided as AgentContextNextGen instance, it will be used directly.
   * If provided as config object, a new AgentContextNextGen will be created.
   * If not provided, a default AgentContextNextGen will be created.
   */
  context?: AgentContextNextGen | AgentContextNextGenConfig;
}

/**
 * Base events emitted by all agent types.
 * Agent subclasses typically extend their own event interfaces.
 */
export interface BaseAgentEvents {
  'session:saved': { sessionId: string };
  'session:loaded': { sessionId: string };
  destroyed: void;
}

/**
 * Options for direct LLM calls (bypassing AgentContext).
 */
export interface DirectCallOptions {
  /** System instructions (optional) */
  instructions?: string;

  /** Include registered tools in the call. Default: false */
  includeTools?: boolean;

  /**
   * Explicit provider tool definitions for this direct call. This is useful for
   * protocol-managed function/custom tools whose outputs the caller will return
   * manually. When set, it takes precedence over `includeTools`.
   */
  tools?: Tool[];

  /** Tool selection for explicit direct-call tools. */
  toolChoice?: TextGenerateOptions['tool_choice'];

  /** Temperature for generation */
  temperature?: number;

  /** Maximum output tokens */
  maxOutputTokens?: number;

  /** Continue a provider-stored response/interaction without resending its history. */
  previousResponseId?: string;

  /** Resume an incomplete provider decode using the token returned by the prior call. */
  continuationToken?: string;

  /**
   * Vendor-agnostic structured (JSON) output. When set, the response is
   * constrained to JSON — via the vendor's native mechanism where supported,
   * otherwise a strict prompt instruction — and parsed into
   * `response.output_parsed`. See `src/core/StructuredOutput.ts`.
   */
  responseFormat?: ResponseFormat;

  /** Vendor-agnostic thinking/reasoning configuration */
  thinking?: ThinkingConfig;

  /** Vendor-specific options */
  vendorOptions?: Record<string, unknown>;

  /** Provider-neutral prompt caching policy. */
  promptCache?: PromptCachePolicy;

  /** Provider-hosted tools, separate from client-executed ToolFunctions. */
  nativeTools?: NativeToolRequest[];
  dataHandling?: DataHandlingPolicy;

  /** Skip pre-flight context limit check. Default: false (check is ON) */
  skipContextLimitCheck?: boolean;
}

/**
 * Abstract base class for all agent types.
 *
 * @internal This class is not exported in the public API.
 *
 * Note: TEvents is not constrained to BaseAgentEvents to allow subclasses
 * to define their own event interfaces (e.g., AgentEvents for Agent).
 */
export abstract class BaseAgent<
  TConfig extends BaseAgentConfig = BaseAgentConfig,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  TEvents extends Record<string, any> = BaseAgentEvents,
> extends EventEmitter<TEvents> {
  // ===== Core Properties =====
  readonly registryId: string;
  readonly name: string;
  readonly connector: Connector;
  readonly model: string;
  readonly parentAgentId: string | undefined;

  // ===== Protected State =====
  protected _config: TConfig;
  protected _agentContext: AgentContextNextGen;  // SINGLE SOURCE OF TRUTH for tools and sessions
  protected _permissionManager: ToolPermissionManager;
  protected _policyManager: PermissionPolicyManager;
  protected _ownsContext = true;
  protected _isDestroyed = false;
  protected _cleanupCallbacks: Array<() => void | Promise<void>> = [];
  protected _logger: FrameworkLogger;
  protected _lifecycleHooks: AgentLifecycleHooks;

  // Session state
  protected _sessionConfig: BaseSessionConfig | null = null;
  protected _autoSaveInterval: ReturnType<typeof setInterval> | null = null;
  protected _pendingSessionLoad: Promise<boolean> | null = null;

  /** Whether caller provided explicit instructions/systemPrompt (takes precedence over saved session) */
  protected _hasExplicitInstructions = false;

  // Provider for LLM calls - single instance shared by all methods
  protected _provider: ITextProvider;

  // ===== Constructor =====

  constructor(config: TConfig, loggerComponent: string) {
    super();
    this._config = config;

    // Set registry ID (unique across all agents)
    this.registryId = randomUUID();

    // Resolve connector
    this.connector = this.resolveConnector(config.connector);

    // Set name
    this.name = config.name ?? `${this.getAgentType()}-${Date.now()}`;
    this.model = config.model;

    // Parent agent tracking (for agent hierarchies)
    this.parentAgentId = config.parentAgentId;

    // Create logger
    this._logger = logger.child({
      component: loggerComponent,
      agentName: this.name,
      model: this.model,
      connector: this.connector.name,
    });

    // Initialize AgentContext FIRST (single source of truth for tools and sessions)
    this._agentContext = this.initializeAgentContext(config);

    // Register tools with AgentContext if provided
    if (config.tools) {
      for (const tool of config.tools) {
        this._agentContext.tools.register(tool);
      }
    }

    // Auto-generate and register connector tools from identities.
    // Each identity produces account-prefixed tools with 'connector:name[:accountId]' source
    // metadata, enabling identity filtering in getEnabledToolDefinitions().
    if (config.identities?.length) {
      this.registerIdentityTools(config.identities, config.userId, config.registry);
    }

    // Initialize permission managers (legacy + policy-based)
    this._permissionManager = this.initializePermissionManager(config.permissions, config.tools);
    this._policyManager = this.initializePolicyManager(config);

    // Wire policy manager into ToolManager pipeline for enforcement
    this._agentContext.tools.setPermissionManager(this._policyManager);

    // Thread roles into tool context
    if (config.userRoles) {
      const existing = this._agentContext.tools.getToolContext();
      this._agentContext.tools.setToolContext({
        ...existing,
        roles: config.userRoles,
      });
    }

    // Initialize lifecycle hooks
    this._lifecycleHooks = config.lifecycleHooks ?? {};

    // Create provider from connector (single instance for all LLM calls)
    this._provider = createProvider(this.connector);
  }

  // ===== Abstract Methods =====

  /**
   * Get the agent type identifier
   */
  protected abstract getAgentType(): 'agent' | 'task-agent' | 'universal-agent';

  // ===== Protected Initialization Helpers =====

  /**
   * Resolve connector from string name or instance
   */
  protected resolveConnector(ref: string | Connector): Connector {
    if (typeof ref === 'string') {
      return this._config.registry
        ? this._config.registry.get(ref)
        : Connector.get(ref);
    }
    return ref;
  }

  /**
   * Initialize AgentContextNextGen (single source of truth for tools and sessions).
   * If AgentContextNextGen is provided, use it directly.
   * Otherwise, create a new one with the provided configuration.
   */
  protected initializeAgentContext(config: TConfig): AgentContextNextGen {
    // If AgentContextNextGen instance is provided, use it directly (caller owns it)
    if (config.context instanceof AgentContextNextGen) {
      this._ownsContext = false;
      return config.context;
    }
    this._ownsContext = true;

    // Create new AgentContextNextGen with merged config
    // NOTE: Don't pass tools here - they're registered separately after creation
    // to allow subclasses to wrap or modify tools before registration
    const contextConfig: AgentContextNextGenConfig = {
      model: config.model,
      agentId: config.name,
      userId: config.userId,
      identities: config.identities,
      // Include storage and sessionId if session config is provided
      storage: config.session?.storage,
      // Thread tool execution timeout to ToolManager
      toolExecutionTimeout: config.toolExecutionTimeout,
      // Subclasses can add systemPrompt via their config
      // Note: context-level toolExecutionTimeout overrides agent-level if both set
      ...(typeof config.context === 'object' && config.context !== null ? config.context : {}),
    };

    return AgentContextNextGen.create(contextConfig);
  }

  /**
   * Initialize legacy permission manager (backward compat)
   */
  protected initializePermissionManager(
    config?: AgentPermissionsConfig,
    tools?: ToolFunction[]
  ): ToolPermissionManager {
    const manager = new ToolPermissionManager(config);

    // Register tool permission configs
    if (tools) {
      for (const tool of tools) {
        if (tool.permission) {
          manager.setToolConfig(tool.definition.function.name, tool.permission);
        }
      }
    }

    return manager;
  }

  /**
   * Initialize policy-based permission manager.
   * If config includes `policies` field, uses AgentPolicyConfig path.
   * Otherwise, translates legacy AgentPermissionsConfig to policies.
   */
  protected initializePolicyManager(config: TConfig): PermissionPolicyManager {
    const permsConfig = config.permissions ?? {};

    // Resolve user rules storage: explicit config > StorageRegistry > undefined
    const registryRulesStorage = StorageRegistry.get('permissionRules');

    // Always route through fromConfig (handles both legacy and policy-based paths)
    const policyConfig: AgentPolicyConfig = {
      ...permsConfig,
      userRulesStorage: (permsConfig as AgentPolicyConfig).userRulesStorage ?? registryRulesStorage,
    };

    return PermissionPolicyManager.fromConfig(policyConfig);
  }

  /**
   * Auto-generate connector tools from identities and register them
   * with proper 'connector:name[:accountId]' source metadata.
   *
   * For each identity:
   * 1. Calls ConnectorTools.for(connector, userId, { accountId }) to generate tools
   * 2. Applies toolFilter if set (keeps only matching tools)
   * 3. Registers via registerConnectorTools() which sets the source tag
   *
   * This makes Agent.create({ identities }) produce connector tools without
   * requiring features: { toolCatalog: true }.
   */
  protected registerIdentityTools(
    identities: AuthIdentity[],
    userId?: string,
    registry?: IConnectorRegistry,
  ): void {
    for (const identity of identities) {
      try {
        let tools = ConnectorTools.for(
          identity.connector,
          userId,
          { registry, accountId: identity.accountId },
        );

        // Apply toolFilter: only keep tools whose base name matches
        if (identity.toolFilter?.length) {
          tools = tools.filter(t => {
            const name = t.definition.function.name;
            return identity.toolFilter!.some(suffix =>
              name.endsWith(`_${suffix}`) || name === suffix
            );
          });
        }

        if (tools.length > 0) {
          this._agentContext.tools.registerConnectorTools(
            identity.connector,
            tools,
            { accountId: identity.accountId },
          );
        }
      } catch (err) {
        // Non-fatal: connector may not be registered or have no service tools
        this._logger.warn(
          { connector: identity.connector, error: (err as Error).message },
          'Failed to generate identity connector tools',
        );
      }
    }
  }

  /**
   * Initialize session management (call from subclass constructor after other setup)
   * Now uses AgentContext.save()/load() for persistence.
   */
  protected initializeSession(sessionConfig?: BaseSessionConfig): void {
    if (!sessionConfig) {
      return;
    }

    this._sessionConfig = sessionConfig;

    if (sessionConfig.id) {
      // Resume existing session (async)
      this._pendingSessionLoad = this.loadSession(sessionConfig.id);
    }

    // Setup auto-save if configured
    if (sessionConfig.autoSave) {
      const interval = sessionConfig.autoSaveIntervalMs ?? 30000;
      this._autoSaveInterval = setInterval(async () => {
        if (this._isDestroyed || this._agentContext.isDestroyed) return;
        try {
          if (this._agentContext.sessionId) {
            await this._agentContext.save();
            if (!this._isDestroyed) {
              this._logger.debug({ sessionId: this._agentContext.sessionId }, 'Auto-saved session');
            }
          }
        } catch (error) {
          if (!this._isDestroyed) {
            this._logger.error({ error: (error as Error).message }, 'Auto-save failed');
          }
        }
      }, interval);
    }
  }

  /**
   * Ensure any pending session load is complete
   */
  protected async ensureSessionLoaded(): Promise<void> {
    if (this._pendingSessionLoad) {
      await this._pendingSessionLoad;
      this._pendingSessionLoad = null;
    }
  }

  // ===== Public Session API =====

  /**
   * Get the current session ID (if session is enabled)
   * Delegates to AgentContext.
   */
  getSessionId(): string | null {
    return this._agentContext.sessionId;
  }

  /**
   * Check if this agent has session support enabled
   */
  hasSession(): boolean {
    return this._agentContext.storage !== null;
  }

  /**
   * Save the current session to storage.
   * Uses getContextState() to get state, allowing subclasses to inject agent-level state.
   *
   * @param sessionId - Optional session ID (uses current or generates new)
   * @param metadata - Optional session metadata
   * @throws Error if storage is not configured
   */
  async saveSession(sessionId?: string, metadata?: ContextSessionMetadata): Promise<void> {
    await this.ensureSessionLoaded();
    // Get state via overridable method (allows agents to inject agentState)
    const state = await this.getContextState();
    await this._agentContext.save(sessionId, metadata, state);
    this._logger.debug({ sessionId: this._agentContext.sessionId }, 'Session saved');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this.emit as any)('session:saved', { sessionId: this._agentContext.sessionId });
  }

  /**
   * Load a session from storage.
   * Uses restoreContextState() to restore state, allowing subclasses to restore agent-level state.
   *
   * @param sessionId - Session ID to load
   * @returns true if session was found and loaded, false if not found
   * @throws Error if storage is not configured
   */
  async loadSession(sessionId: string): Promise<boolean> {
    // Load raw state (doesn't restore yet)
    const result = await this._agentContext.loadRaw(sessionId);
    if (!result) {
      this._logger.warn({ sessionId }, 'Session not found');
      return false;
    }
    // Restore via overridable method (allows agents to restore agentState)
    await this.restoreContextState(result.state);
    this._logger.info({ sessionId }, 'Session loaded');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this.emit as any)('session:loaded', { sessionId });
    return true;
  }

  /**
   * Check if a session exists in storage.
   * Delegates to AgentContext.sessionExists().
   */
  async sessionExists(sessionId: string): Promise<boolean> {
    return this._agentContext.sessionExists(sessionId);
  }

  /**
   * Delete a session from storage.
   * Delegates to AgentContext.deleteSession().
   */
  async deleteSession(sessionId?: string): Promise<void> {
    await this._agentContext.deleteSession(sessionId);
    this._logger.debug({ sessionId }, 'Session deleted');
  }

  /**
   * Get context state for session persistence.
   * Override in subclasses to include agent-specific state in agentState field.
   */
  async getContextState(): Promise<SerializedContextState> {
    return this._agentContext.getState();
  }

  /**
   * Restore context from saved state.
   * Override in subclasses to restore agent-specific state from agentState field.
   * Preserves explicit instructions if caller provided them at construction time.
   */
  async restoreContextState(state: SerializedContextState): Promise<void> {
    // Preserve caller-provided instructions over saved session's systemPrompt
    const explicitPrompt = this._hasExplicitInstructions ? this._agentContext.systemPrompt : undefined;
    this._agentContext.restoreState(state);
    if (this._hasExplicitInstructions && explicitPrompt !== undefined) {
      this._agentContext.systemPrompt = explicitPrompt;
    }
  }

  // ===== Public Permission API =====

  /**
   * Advanced tool management. Returns ToolManager for fine-grained control.
   * This is delegated to AgentContextNextGen.tools (single source of truth).
   */
  get tools(): ToolManager {
    return this._agentContext.tools;
  }

  /**
   * Slim catalog of every enabled tool on this agent — name + description only,
   * no parameter schemas. Passthrough to `tools.listCompact()`.
   *
   * Intended use: a "superagent" carrying every possible tool exposes this list
   * to a routine builder, which picks names and commits them into
   * `RoutineDefinition.requiredTools`. The routine executor then resolves those
   * names back to the same tool instances via `agent.scopedTo(...)`.
   */
  listToolsCompact() {
    return this.tools.listCompact();
  }

  /**
   * Get the AgentContextNextGen (unified context management).
   * This is the primary way to access tools, memory, and history.
   */
  get context(): AgentContextNextGen {
    return this._agentContext;
  }

  /**
   * Get the current user ID. Delegates to AgentContextNextGen.
   */
  get userId(): string | undefined {
    return this._agentContext.userId;
  }

  /**
   * Set user ID at runtime. Automatically updates ToolContext for all tool executions.
   */
  set userId(value: string | undefined) {
    this._agentContext.userId = value;
  }

  /**
   * Get the auth identities this agent is scoped to (undefined = all visible connectors).
   */
  get identities(): AuthIdentity[] | undefined {
    return this._agentContext.identities;
  }

  /**
   * Set auth identities at runtime. Updates ToolContext.connectorRegistry and tool descriptions.
   */
  set identities(value: AuthIdentity[] | undefined) {
    this._agentContext.identities = value;
  }

  /**
   * Permission management. Returns ToolPermissionManager for approval control.
   * @deprecated Use `policyManager` for the new policy-based system.
   */
  get permissions(): ToolPermissionManager {
    return this._permissionManager;
  }

  /**
   * Policy-based permission manager.
   * Provides composable policies, argument inspection, role-based access,
   * centralized audit, and enforcement at the ToolManager pipeline level.
   */
  get policyManager(): PermissionPolicyManager {
    return this._policyManager;
  }

  // ===== Tool Management =====

  /**
   * Add a tool to the agent.
   * Tools are registered with AgentContext (single source of truth).
   *
   * @param tool - The tool function to register
   * @param options - Optional registration options (namespace, source, priority, etc.)
   */
  addTool(tool: ToolFunction, options?: ToolOptions): void {
    this._agentContext.tools.register(tool, options);

    // Sync permission config if tool has one
    if (tool.permission) {
      this._permissionManager.setToolConfig(tool.definition.function.name, tool.permission);
    }
  }

  /**
   * Remove a tool from the agent.
   * Tools are unregistered from AgentContext (single source of truth).
   */
  removeTool(toolName: string): void {
    this._agentContext.tools.unregister(toolName);
  }

  /**
   * List registered tools (returns enabled tool names)
   */
  listTools(): string[] {
    return this._agentContext.tools.listEnabled();
  }

  /**
   * Replace all tools with a new array
   */
  setTools(tools: ToolFunction[]): void {
    this._agentContext.tools.clear();
    for (const tool of tools) {
      this._agentContext.tools.register(tool);
      if (tool.permission) {
        this._permissionManager.setToolConfig(tool.definition.function.name, tool.permission);
      }
    }
  }

  /**
   * Get enabled tool definitions (for passing to LLM).
   * This is a helper that extracts definitions from enabled tools.
   *
   * If a tool has a `descriptionFactory`, it's called to generate a dynamic description
   * that reflects current state (e.g., available connectors). This ensures the LLM
   * always sees up-to-date tool descriptions.
   */
  protected getEnabledToolDefinitions(): import('../domain/entities/Tool.js').FunctionToolDefinition[] {
    const toolContext = this._agentContext.tools.getToolContext();
    const identities = this._agentContext.identities;

    // Build allowed source set from identities
    // { connector: 'microsoft', accountId: 'work' } → allows 'connector:microsoft:work'
    // { connector: 'github' } (no accountId) → allows 'connector:github' and 'connector:github:*'
    let allowedSources: Set<string> | undefined;
    let allowedConnectorNames: Set<string> | undefined;
    if (identities) {
      allowedSources = new Set<string>();
      allowedConnectorNames = new Set<string>();
      for (const id of identities) {
        allowedConnectorNames.add(id.connector);
        if (id.accountId) {
          allowedSources.add(`connector:${id.connector}:${id.accountId}`);
        } else {
          // No accountId → allow the base connector source and any account-specific ones
          allowedSources.add(`connector:${id.connector}`);
          allowedConnectorNames.add(id.connector); // used for wildcard matching below
        }
      }
    }

    return this._agentContext.tools.getEnabledRegistrations()
      .filter((reg) => {
        // No identity restriction → show all tools
        if (!allowedSources) return true;
        // Non-connector tools (built-in, custom, mcp, etc.) always pass
        if (!reg.source?.startsWith('connector:')) return true;
        // Exact match
        if (allowedSources.has(reg.source)) return true;
        // Wildcard: identity without accountId allows any account for that connector
        const sourceParts = reg.source.slice('connector:'.length).split(':');
        const connectorName = sourceParts[0]!;
        // Check if there's an identity without accountId for this connector (wildcard)
        if (allowedConnectorNames!.has(connectorName) && allowedSources.has(`connector:${connectorName}`)) {
          return true;
        }
        return false;
      })
      .map((reg) => {
        const tool = reg.tool;
        // If tool has a descriptionFactory, use it to generate dynamic description
        // Pass current ToolContext so descriptions can scope by userId, etc.
        if (tool.descriptionFactory) {
          const dynamicDescription = tool.descriptionFactory(toolContext);
          return {
            ...tool.definition,
            function: {
              ...tool.definition.function,
              description: dynamicDescription,
            },
          };
        }
        // Otherwise, use the static definition as-is
        return tool.definition;
      });
  }

  // ===== Model Discovery =====

  /**
   * List available models from the provider's API.
   * Useful for discovering models dynamically (e.g., Ollama local models).
   */
  async listModels(): Promise<string[]> {
    return this._provider.listModels();
  }

  /** Executable advanced capabilities for this agent's concrete model. */
  getAdvancedCapabilities(): AdvancedTextCapabilities {
    return this._provider.getAdvancedCapabilities?.(this.model) ?? {
      promptCaching: { mode: 'unsupported', ttlModes: [], reportsCacheUsage: false },
      batch: { supported: false, cancellable: false },
      structuredOutput: { jsonObject: 'prompt', jsonSchema: 'prompt', nativeWithTools: false },
      nativeTools: [],
      nativeToolOptions: { remoteMcpApproval: false },
      dataHandling: { promptCaching: 'none', batch: 'none', remoteMcp: 'none' },
    };
  }

  /** Optional provider batch surface. The host owns durable handles and polling. */
  getBatchProvider(): IAsyncTextBatchProvider<TextGenerateOptions, LLMResponse> | undefined {
    const batch = this._provider.batch;
    if (!batch) return undefined;

    // Bind submissions to the same identity boundary as run()/runDirect().
    // Returning the provider object directly would let remote-MCP credential
    // resolution fall back to the global Connector registry with no userId.
    return {
      submitBatch: (requests, options) =>
        batch.submitBatch(
          requests.map((request) => ({
            ...request,
            options: {
              ...request.options,
              credential_context: {
                userId: this.userId,
                connectorRegistry: this._config.registry,
              },
            },
          })),
          options,
        ),
      getBatch: (id) => batch.getBatch(id),
      cancelBatch: (id) => batch.cancelBatch(id),
      getBatchResults: (id) => batch.getBatchResults(id),
    };
  }

  // ===== Snapshot / Inspection =====

  /**
   * Get a complete, serializable snapshot of the agent's context state.
   *
   * Convenience method that auto-wires tool usage stats from ToolManager.
   * Used by UI "Look Inside" panels.
   */
  async getSnapshot(): Promise<import('./context-nextgen/snapshot.js').IContextSnapshot> {
    const stats = this._agentContext.tools.getStats();
    return this._agentContext.getSnapshot({ mostUsed: stats.mostUsed });
  }

  /**
   * Get a human-readable breakdown of the prepared context.
   *
   * Convenience method that delegates to AgentContextNextGen.
   * Used by "View Full Context" UI panels.
   */
  async getViewContext(): Promise<import('./context-nextgen/snapshot.js').IViewContextData> {
    return this._agentContext.getViewContext();
  }

  // ===== Direct LLM Access (Bypasses AgentContext) =====

  /**
   * Get the provider for LLM calls.
   * Returns the single shared provider instance.
   */
  protected getProvider(): ITextProvider {
    return this._provider;
  }

  /**
   * Make a direct LLM call bypassing all context management.
   *
   * This method:
   * - Does NOT track messages in history
   * - Does NOT use AgentContext features (memory, cache, etc.)
   * - Does NOT prepare context or run compaction
   * - Does NOT go through the agentic loop (no tool execution)
   *
   * Use this for simple, stateless interactions where you want raw LLM access
   * without the overhead of context management.
   *
   * @param input - Text string or array of InputItems (supports multimodal: text + images)
   * @param options - Optional configuration for the call
   * @returns Raw LLM response
   *
   * @example
   * ```typescript
   * // Simple text call
   * const response = await agent.runDirect('What is 2 + 2?');
   * console.log(response.output_text);
   *
   * // With options
   * const response = await agent.runDirect('Summarize this', {
   *   instructions: 'Be concise',
   *   temperature: 0.5,
   * });
   *
   * // Multimodal (text + image)
   * const response = await agent.runDirect([
   *   { type: 'message', role: 'user', content: [
   *     { type: 'input_text', text: 'What is in this image?' },
   *     { type: 'input_image', image_url: 'https://...' }
   *   ]}
   * ]);
   *
   * // With tools (single call, no loop)
   * const response = await agent.runDirect('Get the weather', {
   *   includeTools: true,
   * });
   * // Note: If the LLM returns a tool call, you must handle it yourself
   * ```
   */
  async runDirect(
    input: string | InputItem[],
    options: DirectCallOptions = {}
  ): Promise<LLMResponse> {
    if (this._isDestroyed) {
      throw new Error('Agent has been destroyed');
    }

    const provider = this.getProvider();

    const generateOptions: TextGenerateOptions = {
      model: this.model,
      input,
      instructions: options.instructions,
      tools: options.tools ?? (options.includeTools ? this.getEnabledToolDefinitions() : undefined),
      tool_choice: options.toolChoice,
      temperature: options.temperature,
      max_output_tokens: options.maxOutputTokens,
      previous_response_id: options.previousResponseId,
      continuation_token: options.continuationToken,
      thinking: options.thinking,
      vendorOptions: options.vendorOptions,
      prompt_cache: options.promptCache,
      native_tools: options.nativeTools,
      data_handling: options.dataHandling,
      credential_context: { userId: this.userId, connectorRegistry: this._config.registry },
      skipContextLimitCheck: options.skipContextLimitCheck,
    };

    // Apply structured-output constraint (native or prompt fallback).
    this.applyDirectResponseFormat(generateOptions, options.responseFormat);

    this._logger.debug({ inputType: typeof input }, 'runDirect called');

    try {
      const response = await provider.generate(generateOptions);
      if (options.responseFormat) {
        const enforcement = resolveStructuredStrategy(
          options.responseFormat,
          provider.getModelCapabilities(this.model),
          this.connector.vendor,
          (generateOptions.tools?.length ?? 0) + (generateOptions.native_tools?.length ?? 0) > 0,
          provider.getAdvancedCapabilities?.(this.model),
        );
        const before = response.output_text;
        // Re-ask tool-free, reusing the same (format-applied) options with a
        // repair prompt as the input.
        await this.coerceStructuredOutput(response, options.responseFormat, (repairInput) =>
          provider.generate({
            ...generateOptions,
            input: repairInput,
            tools: undefined,
            native_tools: undefined,
            tool_choice: undefined,
          }),
        );
        response.structured_output_enforcement =
          response.output_text === before ? enforcement : 'repair';
      }
      this._logger.debug({ outputLength: response.output_text?.length }, 'runDirect completed');
      return response;
    } catch (error) {
      this._logger.error({ error: (error as Error).message }, 'runDirect failed');
      throw error;
    }
  }

  /**
   * Stream a direct LLM call bypassing all context management.
   *
   * Same as runDirect but returns a stream of events instead of waiting
   * for the complete response. Useful for real-time output display.
   *
   * @param input - Text string or array of InputItems (supports multimodal)
   * @param options - Optional configuration for the call
   * @returns Async iterator of stream events
   *
   * @example
   * ```typescript
   * for await (const event of agent.streamDirect('Tell me a story')) {
   *   if (event.type === 'output_text_delta') {
   *     process.stdout.write(event.delta);
   *   }
   * }
   * ```
   */
  async *streamDirect(
    input: string | InputItem[],
    options: DirectCallOptions = {}
  ): AsyncIterableIterator<StreamEvent> {
    if (this._isDestroyed) {
      throw new Error('Agent has been destroyed');
    }

    const provider = this.getProvider();

    const generateOptions: TextGenerateOptions = {
      model: this.model,
      input,
      instructions: options.instructions,
      tools: options.tools ?? (options.includeTools ? this.getEnabledToolDefinitions() : undefined),
      tool_choice: options.toolChoice,
      temperature: options.temperature,
      max_output_tokens: options.maxOutputTokens,
      previous_response_id: options.previousResponseId,
      continuation_token: options.continuationToken,
      thinking: options.thinking,
      vendorOptions: options.vendorOptions,
      prompt_cache: options.promptCache,
      native_tools: options.nativeTools,
      data_handling: options.dataHandling,
      credential_context: { userId: this.userId, connectorRegistry: this._config.registry },
      skipContextLimitCheck: options.skipContextLimitCheck,
    };

    // Apply structured-output constraint (native or prompt fallback). The
    // streamed text is JSON; callers parse the accumulated output themselves
    // (`output_parsed` is only attached on the non-streaming runDirect).
    this.applyDirectResponseFormat(generateOptions, options.responseFormat);

    this._logger.debug({ inputType: typeof input }, 'streamDirect called');

    try {
      yield* provider.streamGenerate(generateOptions);
      this._logger.debug('streamDirect completed');
    } catch (error) {
      this._logger.error({ error: (error as Error).message }, 'streamDirect failed');
      throw error;
    }
  }

  // ===== Structured Output (direct calls) =====

  /**
   * Apply a structured-output constraint to direct-call generate options,
   * in-place. Uses the vendor's native mechanism when supported; otherwise
   * injects the strict JSON prompt fallback. For single-shot direct calls the
   * fallback is safe to inject even alongside tools.
   */
  protected applyDirectResponseFormat(
    generateOptions: TextGenerateOptions,
    format: ResponseFormat | undefined,
  ): void {
    if (!format) return;
    const caps = this.getProvider().getModelCapabilities(this.model);
    const hasTools =
      (generateOptions.tools?.length ?? 0) + (generateOptions.native_tools?.length ?? 0) > 0;
    const strategy = resolveStructuredStrategy(
      format,
      caps,
      this.connector.vendor,
      hasTools,
      this.getProvider().getAdvancedCapabilities?.(this.model),
    );
    if (strategy === 'native') {
      generateOptions.response_format = toProviderResponseFormat(
        format,
      ) as TextGenerateOptions['response_format'];
    } else {
      generateOptions.instructions =
        (generateOptions.instructions ?? '') + buildStructuredInstructionSuffix(format);
    }
  }

  /**
   * Coerce a candidate response into the requested JSON shape and attach
   * `output_parsed`, mutating `candidate` in place. If its text doesn't parse,
   * re-asks (tool-free) up to `STRUCTURED_OUTPUT_MAX_REPAIR_ATTEMPTS` times via
   * the `reask` callback, folding each re-ask's output + usage into `candidate`.
   * Throws {@link StructuredOutputError} (with full context, logged) if it still
   * can't produce valid JSON — never a silent failure.
   *
   * Shared by `runDirect()` (candidate = the direct response) and `Agent.run()`
   * (candidate = the agentic loop's final answer) so both paths have identical
   * re-ask semantics and counts.
   */
  protected async coerceStructuredOutput(
    candidate: LLMResponse,
    format: ResponseFormat,
    reask: (repairInput: string) => Promise<LLMResponse>,
  ): Promise<LLMResponse> {
    let reasks = 0;
    for (;;) {
      const parsed = parseStructuredOutput(candidate.output_text ?? '', format);
      if (parsed.ok) {
        candidate.output_parsed = parsed.value;
        if (reasks > 0) {
          this._logger.info({ reasks }, 'Structured output recovered after re-ask');
        }
        return candidate;
      }

      if (reasks >= STRUCTURED_OUTPUT_MAX_REPAIR_ATTEMPTS) {
        this._logger.error(
          { reasks, error: parsed.error.message, rawOutput: candidate.output_text },
          'Structured output could not be parsed as valid JSON',
        );
        throw new StructuredOutputError(
          `Model output could not be parsed as valid JSON after ${reasks} re-ask(s): ${parsed.error.message}`,
          candidate.output_text ?? '',
          format,
          parsed.error,
        );
      }

      reasks += 1;
      this._logger.warn(
        { reask: reasks, error: parsed.error.message },
        'Structured output did not parse; re-asking',
      );
      const fresh = await reask(
        buildStructuredRepairInstruction(format, candidate.output_text ?? '', parsed.error),
      );
      candidate.output = fresh.output;
      candidate.output_text = fresh.output_text;
      this.mergeStructuredUsage(candidate, fresh);
    }
  }

  /** Fold the token usage of an auxiliary generation into the primary response. */
  protected mergeStructuredUsage(target: LLMResponse, extra: LLMResponse): void {
    if (!extra.usage) return;
    if (!target.usage) {
      target.usage = { ...extra.usage };
      return;
    }
    target.usage.input_tokens += extra.usage.input_tokens ?? 0;
    target.usage.output_tokens += extra.usage.output_tokens ?? 0;
    target.usage.total_tokens += extra.usage.total_tokens ?? 0;
    target.usage.cached_input_tokens =
      (target.usage.cached_input_tokens ?? 0) + (extra.usage.cached_input_tokens ?? 0);
    target.usage.cache_creation_input_tokens =
      (target.usage.cache_creation_input_tokens ?? 0) +
      (extra.usage.cache_creation_input_tokens ?? 0);
    if (extra.usage.cache_creation_details) {
      target.usage.cache_creation_details ??= {};
      target.usage.cache_creation_details.short_ttl_input_tokens =
        (target.usage.cache_creation_details.short_ttl_input_tokens ?? 0) +
        (extra.usage.cache_creation_details.short_ttl_input_tokens ?? 0);
      target.usage.cache_creation_details.extended_ttl_input_tokens =
        (target.usage.cache_creation_details.extended_ttl_input_tokens ?? 0) +
        (extra.usage.cache_creation_details.extended_ttl_input_tokens ?? 0);
    }
    if (extra.usage.output_tokens_details?.reasoning_tokens !== undefined) {
      target.usage.output_tokens_details = {
        reasoning_tokens:
          (target.usage.output_tokens_details?.reasoning_tokens ?? 0) +
          extra.usage.output_tokens_details.reasoning_tokens,
      };
    }
    for (const [tool, count] of Object.entries(extra.usage.native_tool_calls ?? {})) {
      target.usage.native_tool_calls ??= {};
      const key = tool as keyof NonNullable<typeof target.usage.native_tool_calls>;
      target.usage.native_tool_calls[key] =
        (target.usage.native_tool_calls[key] ?? 0) + (count ?? 0);
    }
    if (extra.usage.processing_mode === 'batch') target.usage.processing_mode = 'batch';
    target.usage.service_tier = extra.usage.service_tier ?? target.usage.service_tier;
  }

  // ===== Lifecycle Hooks =====

  /**
   * Get the current lifecycle hooks configuration
   */
  get lifecycleHooks(): AgentLifecycleHooks {
    return this._lifecycleHooks;
  }

  /**
   * Set or update lifecycle hooks at runtime
   */
  setLifecycleHooks(hooks: Partial<AgentLifecycleHooks>): void {
    this._lifecycleHooks = { ...this._lifecycleHooks, ...hooks };
  }

  /**
   * Invoke beforeToolExecution hook if defined.
   * Call this before executing a tool.
   *
   * @throws Error if hook throws (prevents tool execution)
   */
  protected async invokeBeforeToolExecution(context: ToolExecutionHookContext): Promise<void> {
    if (this._lifecycleHooks.beforeToolExecution) {
      try {
        await this._lifecycleHooks.beforeToolExecution(context);
      } catch (error) {
        this._logger.error(
          { error: (error as Error).message, toolName: context.toolName },
          'beforeToolExecution hook failed'
        );
        throw error; // Re-throw to prevent tool execution
      }
    }
  }

  /**
   * Invoke afterToolExecution hook if defined.
   * Call this after tool execution completes (success or failure).
   */
  protected async invokeAfterToolExecution(result: ToolExecutionResult): Promise<void> {
    if (this._lifecycleHooks.afterToolExecution) {
      try {
        await this._lifecycleHooks.afterToolExecution(result);
      } catch (error) {
        this._logger.error(
          { error: (error as Error).message, toolName: result.toolName },
          'afterToolExecution hook failed'
        );
        // Don't re-throw - hook failure shouldn't affect main flow after execution
      }
    }
  }

  /**
   * Invoke beforeContextPrepare hook if defined.
   * Call this before preparing context for LLM.
   */
  protected async invokeBeforeContextPrepare(): Promise<void> {
    if (this._lifecycleHooks.beforeContextPrepare) {
      try {
        await this._lifecycleHooks.beforeContextPrepare(this.name);
      } catch (error) {
        this._logger.error(
          { error: (error as Error).message },
          'beforeContextPrepare hook failed'
        );
        // Don't re-throw - allow context preparation to continue
      }
    }
  }

  /**
   * Invoke beforeCompaction hook if defined.
   * Call this before context compaction occurs.
   * Gives the agent a chance to save important data to memory.
   */
  protected async invokeBeforeCompaction(context: BeforeCompactionContext): Promise<void> {
    if (this._lifecycleHooks.beforeCompaction) {
      try {
        await this._lifecycleHooks.beforeCompaction(context);
      } catch (error) {
        this._logger.error(
          {
            error: (error as Error).message,
            strategy: context.strategy,
            estimatedTokensToFree: context.estimatedTokensToFree,
          },
          'beforeCompaction hook failed'
        );
        // Don't re-throw - allow compaction to continue
      }
    }
  }

  /**
   * Invoke afterCompaction hook if defined.
   * Call this after context compaction occurs.
   */
  protected async invokeAfterCompaction(log: string[], tokensFreed: number): Promise<void> {
    if (this._lifecycleHooks.afterCompaction) {
      try {
        await this._lifecycleHooks.afterCompaction(log, tokensFreed);
      } catch (error) {
        this._logger.error(
          { error: (error as Error).message, tokensFreed },
          'afterCompaction hook failed'
        );
        // Don't re-throw - allow execution to continue
      }
    }
  }

  /**
   * Invoke onError hook if defined.
   * Call this when the agent encounters an error.
   */
  protected async invokeOnError(error: Error, phase: string): Promise<void> {
    if (this._lifecycleHooks.onError) {
      try {
        await this._lifecycleHooks.onError(error, { phase, agentId: this.name });
      } catch (hookError) {
        this._logger.error(
          { error: (hookError as Error).message, originalError: error.message, phase },
          'onError hook failed'
        );
        // Don't re-throw - hook failure shouldn't mask original error
      }
    }
  }

  // ===== Lifecycle =====

  get isDestroyed(): boolean {
    return this._isDestroyed;
  }

  /**
   * Register a cleanup callback
   */
  onCleanup(callback: () => void | Promise<void>): void {
    this._cleanupCallbacks.push(callback);
  }

  /**
   * Base cleanup for session and listeners.
   * Subclasses should call super.baseDestroy() in their destroy() method.
   */
  protected baseDestroy(): void {
    if (this._isDestroyed) {
      return;
    }
    this._isDestroyed = true;

    this._logger.debug('Agent destroy started');

    // Stop auto-save interval
    if (this._autoSaveInterval) {
      clearInterval(this._autoSaveInterval);
      this._autoSaveInterval = null;
    }

    // Await any pending session load to prevent abandoned promises
    if (this._pendingSessionLoad) {
      this._pendingSessionLoad.catch(() => {});
      this._pendingSessionLoad = null;
    }

    // Cleanup AgentContext only if we own it (not shared with other agents)
    if (this._ownsContext) {
      this._agentContext.destroy();
    }

    // Cleanup permission managers
    this._permissionManager.removeAllListeners();
    this._policyManager.destroy();

    // Remove all event listeners
    this.removeAllListeners();

    // Emit destroyed event (before removing listeners)
    // Note: This won't be received since we removed listeners above
    // but subclasses can emit before calling baseDestroy if needed
  }

  /**
   * Run cleanup callbacks
   */
  protected async runCleanupCallbacks(): Promise<void> {
    for (const callback of this._cleanupCallbacks) {
      try {
        await callback();
      } catch (error) {
        this._logger.error({ error: (error as Error).message }, 'Cleanup callback error');
      }
    }
    this._cleanupCallbacks = [];
  }
}
