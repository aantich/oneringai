/**
 * AgentContextNextGen - Clean, Simple Context Manager
 *
 * Design Principles:
 * 1. Single system message with ALL context (prompt, instructions, plugin contents)
 * 2. Clear separation: system message | conversation | current input
 * 3. Compaction happens ONCE, right before LLM call
 * 4. Each plugin manages its own token tracking
 * 5. Tool pairs (tool_use + tool_result) always removed together
 *
 * Context Structure:
 * ```
 * [Developer Message - All glued together]
 *   # System Prompt
 *   # Persistent Instructions (if plugin enabled)
 *   # Plugin Instructions (for enabled plugins)
 *   # In-Context Memory (if plugin enabled)
 *   # Working Memory Index (if plugin enabled)
 *
 * [Conversation History]
 *   ... messages including tool_use/tool_result pairs ...
 *
 * [Current Input]
 *   User message OR tool results (newest, never compacted)
 * ```
 */

import { EventEmitter } from 'eventemitter3';
import { ToolManager } from '../ToolManager.js';
import { logger } from '../../infrastructure/observability/Logger.js';
import { getModelInfo } from '../../domain/entities/Model.js';
import type { InputItem, Message } from '../../domain/entities/Message.js';
import { MessageRole } from '../../domain/entities/Message.js';
import type { Content } from '../../domain/entities/Content.js';
import { ContentType } from '../../domain/entities/Content.js';
import type { ToolResult } from '../../domain/entities/Tool.js';
import type { OutputItem } from '../../domain/entities/Message.js';
import { simpleTokenEstimator } from './BasePluginNextGen.js';
import { PluginRegistry } from './PluginRegistry.js';
import type { PluginFactoryContext } from './PluginRegistry.js';

import type {
  AuthIdentity,
  IContextPluginNextGen,
  ITokenEstimator,
  AgentContextNextGenConfig,
  ResolvedContextFeatures,
  ContextBudget,
  PreparedContext,
  OversizedInputResult,
  SerializedContextState,
  ContextEvents,
  PluginConfigs,
  BeforeCompactionCallback,
  ICompactionStrategy,
  CompactionContext,
  ConsolidationResult,
  ContextRolloverOptions,
  ContextRolloverResult,
} from './types.js';
import type { ToolCategoryScope } from '../ToolCatalogRegistry.js';
import type {
  IContextSnapshot,
  IPluginSnapshot,
  IToolSnapshot,
  IViewContextData,
  IViewContextComponent,
} from './snapshot.js';
import { formatPluginDisplayName } from './snapshot.js';
import type { IContextStorage, StoredContextSession } from '../../domain/interfaces/IContextStorage.js';
import type { IHistoryJournal, HistoryEntry, HistoryEntryType } from '../../domain/interfaces/IHistoryJournal.js';
import type { IConnectorRegistry } from '../../domain/interfaces/IConnectorRegistry.js';
import { Connector } from '../Connector.js';
import { ConnectorNotFoundError } from '../../domain/errors/AIErrors.js';

// Plugin imports for auto-initialization
import {
  WorkingMemoryPluginNextGen,
  InContextMemoryPluginNextGen,
  PersistentInstructionsPluginNextGen,
  UserInfoPluginNextGen,
  ToolCatalogPluginNextGen,
  SharedWorkspacePluginNextGen,
  MemoryPluginNextGen,
  MemoryWritePluginNextGen,
} from './plugins/index.js';
import { StorageRegistry } from '../StorageRegistry.js';
import type {
  WorkingMemoryPluginConfig,
  InContextMemoryConfig,
  PersistentInstructionsConfig,
  UserInfoPluginConfig,
  ToolCatalogPluginConfig,
  SharedWorkspaceConfig,
  MemoryPluginConfig,
  MemoryWritePluginConfig,
} from './plugins/index.js';

// Strategy imports
import { StrategyRegistry } from './strategies/index.js';

import {
  DEFAULT_FEATURES,
  DEFAULT_CONFIG,
  isStoreHandler,
} from './types.js';
import { StoreToolsManager } from './store-tools.js';
import { TemplateEngine } from '../TemplateEngine.js';

// ============================================================================
// AgentContextNextGen
// ============================================================================

/**
 * Next-generation context manager for AI agents.
 *
 * Usage:
 * ```typescript
 * const ctx = AgentContextNextGen.create({
 *   model: 'gpt-4',
 *   systemPrompt: 'You are a helpful assistant.',
 *   features: { workingMemory: true },
 * });
 *
 * // Add user message
 * ctx.addUserMessage('Hello!');
 *
 * // Prepare for LLM call (handles compaction if needed)
 * const { input, budget } = await ctx.prepare();
 *
 * // Call LLM with input...
 *
 * // Add assistant response
 * ctx.addAssistantResponse(response.output);
 * ```
 */
export class AgentContextNextGen extends EventEmitter<ContextEvents> {
  // ============================================================================
  // Private State
  // ============================================================================

  /** Configuration */
  private readonly _config: Required<Omit<AgentContextNextGenConfig, 'tools' | 'storage' | 'features' | 'systemPrompt' | 'plugins' | 'compactionStrategy' | 'toolExecutionTimeout' | 'userId' | 'timezone' | 'identities' | 'toolCategories' | 'journalFilter'>> & {
    features: ResolvedContextFeatures;
    storage?: IContextStorage;
    systemPrompt?: string;
    toolCategories?: ToolCategoryScope;
  };

  /** Maximum context tokens for the model */
  private _maxContextTokens: number;
  private readonly _usesModelContextLimit: boolean;

  /** Compaction strategy */
  private _compactionStrategy: ICompactionStrategy;

  /** System prompt (user-provided) */
  private _systemPrompt: string | undefined;

  /** Conversation history (excludes current input) */
  private _conversation: InputItem[] = [];

  /** Current input (pending, will be added to conversation after LLM response) */
  private _currentInput: InputItem[] = [];

  /** Original user input captured at the start of each execution.
   *  Unlike _currentInput which changes during the agentic loop (tool results
   *  replace user message), this preserves the input that started the execution. */
  private _originalUserInput: ReadonlyArray<InputItem> = [];

  /** Registered plugins */
  private readonly _plugins: Map<string, IContextPluginNextGen> = new Map();

  /** Tool manager */
  private readonly _tools: ToolManager;

  /** Token estimator for conversation/input */
  private readonly _estimator: ITokenEstimator = simpleTokenEstimator;

  /** Session ID (if loaded/saved) */
  private _sessionId: string | null = null;

  /** Agent ID */
  private readonly _agentId: string;

  /** User ID for multi-user scenarios */
  private _userId: string | undefined;

  /** Viewer's IANA timezone — flows to ToolContext + memory plugin for local rendering. */
  private readonly _timezone: string | undefined;

  /** Auth identities this agent is scoped to (connector + optional accountId) */
  private _identities: AuthIdentity[] | undefined;

  /** Storage backend */
  private readonly _storage?: IContextStorage;

  /** Destroyed flag */
  private _destroyed = false;

  /** Last thinking/reasoning content from the most recent assistant response */
  private _lastThinking: string | null = null;

  /** Cached budget from last prepare() call */
  private _cachedBudget: ContextBudget | null = null;

  /** Callback for beforeCompaction hook (set by Agent) */
  private _beforeCompactionCallback: BeforeCompactionCallback | null = null;

  /** Prevent overlapping async rollover summaries from racing each other. */
  private _rolloverInProgress = false;

  /**
   * Monotonically increasing turn counter for history journal.
   * A "turn" increments on each user message.
   */
  private _turnIndex = 0;

  /**
   * Pre-sessionId history buffer.
   * Entries are buffered here until the first save() establishes a sessionId,
   * at which point the buffer is flushed to the journal.
   * No extra memory cost — these items are already in _conversation.
   */
  private _historyBuffer: HistoryEntry[] = [];

  /** Serializes fire-and-forget journal writes so same-turn replacements cannot race appends. */
  private _journalWriteQueue: Promise<void> = Promise.resolve();

  /** Filter for journal entry types. When set, only matching types are journaled. */
  private readonly _journalFilter: HistoryEntryType[] | undefined;

  /** Unified store tools manager — routes store_* tools to IStoreHandler plugins */
  private readonly _storeToolsManager = new StoreToolsManager();

  /** Whether the 5 generic store_* tools have been registered with ToolManager */
  private _storeToolsRegistered = false;
  /** Tool names whose executable implementations are owned by context plugins. */
  private readonly _contextToolNames = new Set<string>();
  /** Plugins that should NOT be destroyed when this context is destroyed (shared across agents) */
  private _skipDestroyPlugins = new Set<string>();

  // ============================================================================
  // Static Factory
  // ============================================================================

  /**
   * Create a new AgentContextNextGen instance.
   */
  static create(config: AgentContextNextGenConfig): AgentContextNextGen {
    return new AgentContextNextGen(config);
  }

  // ============================================================================
  // Constructor
  // ============================================================================

  private constructor(config: AgentContextNextGenConfig) {
    super();

    // Resolve max context tokens from model
    const modelInfo = getModelInfo(config.model);
    this._usesModelContextLimit = config.maxContextTokens === undefined;
    this._maxContextTokens = config.maxContextTokens ?? modelInfo?.features?.input?.tokens ?? 128000;

    // Build full config
    this._config = {
      model: config.model,
      maxContextTokens: this._maxContextTokens,
      responseReserve: config.responseReserve ?? DEFAULT_CONFIG.responseReserve,
      criticalCompactionThreshold:
        config.criticalCompactionThreshold ?? DEFAULT_CONFIG.criticalCompactionThreshold,
      systemPrompt: config.systemPrompt,
      strategy: config.strategy ?? DEFAULT_CONFIG.strategy,
      features: { ...DEFAULT_FEATURES, ...config.features },
      agentId: config.agentId ?? this.generateId(),
      toolCategories: config.toolCategories,
      storage: config.storage,
    };

    this._systemPrompt = config.systemPrompt;
    this._agentId = this._config.agentId;
    this._userId = config.userId;
    // Collapse '' → undefined here so every downstream consumer (the
    // current-time `??` fallback, the memory-plugin forward, ToolContext)
    // treats a blank timezone as "not set" consistently.
    this._timezone = config.timezone || undefined;
    this._identities = config.identities;
    this._journalFilter = config.journalFilter;

    // Resolve session storage: explicit config > StorageRegistry factory > undefined
    const sessionFactory = StorageRegistry.get('sessions');
    const storageCtx = StorageRegistry.getContext() ?? (config.userId ? { userId: config.userId } : undefined);
    this._storage = config.storage ?? (sessionFactory ? sessionFactory(this._agentId, storageCtx) : undefined);

    // Initialize compaction strategy
    // Use custom strategy if provided, otherwise create from registry
    this._compactionStrategy = config.compactionStrategy ?? StrategyRegistry.create(this._config.strategy);

    // Create tool manager (with optional hard execution timeout)
    this._tools = new ToolManager(
      config.toolExecutionTimeout ? { toolExecutionTimeout: config.toolExecutionTimeout } : undefined,
    );

    // Register initial tools
    if (config.tools) {
      for (const tool of config.tools) {
        this._tools.register(tool);
      }
    }

    // Auto-initialize plugins based on features config
    this.initializePlugins(config.plugins);

    // Auto-populate ToolContext with identity fields (agentId, userId)
    this.syncToolContext();
  }

  /**
   * Initialize plugins based on feature flags.
   * Called automatically in constructor.
   */
  private initializePlugins(pluginConfigs?: PluginConfigs): void {
    const features = this._config.features;
    const configs = pluginConfigs ?? {};

    // 1. Working Memory (default: enabled)
    if (features.workingMemory) {
      this.registerPlugin(new WorkingMemoryPluginNextGen(
        configs.workingMemory as WorkingMemoryPluginConfig | undefined
      ));
    }

    // 2. In-Context Memory (default: disabled)
    if (features.inContextMemory) {
      this.registerPlugin(new InContextMemoryPluginNextGen(
        configs.inContextMemory as InContextMemoryConfig | undefined
      ));
    }

    // 3. Persistent Instructions (default: disabled, requires agentId)
    if (features.persistentInstructions) {
      if (!this._agentId) {
        throw new Error('persistentInstructions feature requires agentId to be set');
      }
      const piConfig = configs.persistentInstructions as Partial<PersistentInstructionsConfig> | undefined;
      this.registerPlugin(new PersistentInstructionsPluginNextGen({
        agentId: this._agentId,
        ...piConfig,
      }));
    }

    // 4. User Info (default: disabled)
    if (features.userInfo) {
      const uiConfig = configs.userInfo as Partial<UserInfoPluginConfig> | undefined;
      this.registerPlugin(new UserInfoPluginNextGen({
        userId: this._userId,
        ...uiConfig,
      }));
    }

    // 5. Tool Catalog (default: disabled)
    if (features.toolCatalog) {
      const tcConfig = configs.toolCatalog as Partial<ToolCatalogPluginConfig> | undefined;
      const plugin = new ToolCatalogPluginNextGen({
        categoryScope: this._config.toolCategories,
        identities: this._identities,
        ...tcConfig,
      });
      this.registerPlugin(plugin);
      plugin.setToolManager(this._tools);
    }

    // 6. Shared Workspace (default: disabled)
    if (features.sharedWorkspace) {
      const swConfig = configs.sharedWorkspace as Partial<SharedWorkspaceConfig> | undefined;
      this.registerPlugin(new SharedWorkspacePluginNextGen(swConfig));
    }

    // 7. Memory plugin — self-learning knowledge store. Requires a MemorySystem
    // in config because the library cannot auto-construct one (it needs an
    // adapter + optionally embedder + profile generator).
    if (features.memory) {
      if (!this._agentId) {
        throw new Error('memory feature requires agentId to be set');
      }
      const memConfig = configs.memory as Partial<MemoryPluginConfig> | undefined;
      if (!memConfig?.memory) {
        throw new Error(
          "memory feature is enabled but plugins.memory.memory (MemorySystem instance) is missing — " +
          "construct a MemorySystem with your chosen adapter and pass it in plugins config",
        );
      }
      const resolvedUserId = memConfig.userId ?? this._userId;
      if (!resolvedUserId) {
        throw new Error(
          'memory feature requires userId — set it on AgentContextNextGen config ' +
          'or pass plugins.memory.userId explicitly',
        );
      }
      this.registerPlugin(new MemoryPluginNextGen({
        ...memConfig,
        agentId: this._agentId,
        userId: resolvedUserId,
        memory: memConfig.memory,
        timezone: memConfig.timezone ?? this._timezone,
      } as MemoryPluginConfig));
    }

    // 8. Memory-write sidecar — opt-in via `memoryWrite: true`. Ships write
    // tools only (memory_remember / _link / _forget / _restore / _upsert_entity)
    // with no system-message content. Requires `memory` feature to be enabled
    // so the user/agent entities are bootstrapped by MemoryPluginNextGen.
    if (features.memoryWrite) {
      if (!features.memory) {
        throw new Error(
          "memoryWrite feature requires the 'memory' feature to be enabled — " +
          "MemoryPluginNextGen owns entity bootstrap + profile injection; " +
          "MemoryWritePluginNextGen only adds write tools on top of it",
        );
      }
      if (!this._agentId) {
        throw new Error('memoryWrite feature requires agentId to be set');
      }
      const writeConfig = configs.memoryWrite as Partial<MemoryWritePluginConfig> | undefined;
      const readMemConfig = configs.memory as Partial<MemoryPluginConfig> | undefined;
      const sharedMemory = writeConfig?.memory ?? readMemConfig?.memory;
      if (!sharedMemory) {
        throw new Error(
          "memoryWrite feature is enabled but no MemorySystem instance is available — " +
          "set plugins.memory.memory or plugins.memoryWrite.memory",
        );
      }
      const resolvedUserIdWrite = writeConfig?.userId ?? readMemConfig?.userId ?? this._userId;
      if (!resolvedUserIdWrite) {
        throw new Error('memoryWrite feature requires userId');
      }
      const readPluginRaw = this._plugins.get('memory');
      const readPlugin =
        readPluginRaw instanceof MemoryPluginNextGen ? readPluginRaw : undefined;
      this.registerPlugin(new MemoryWritePluginNextGen({
        ...writeConfig,
        agentId: this._agentId,
        userId: resolvedUserIdWrite,
        memory: sharedMemory,
        // Persona-aware: when the read plugin has a `personaEntityId`,
        // `getOwnSubjectIds()` reports the persona as the agent subject so
        // `memory_set_agent_rule` (and any 'this_agent' token in writes) lands
        // on the shared persona. Falls back to the bootstrapped variant id
        // when no persona is configured. Use `getBootstrappedIds()` only for
        // "what was actually bootstrapped" — not for tool subject resolution.
        getOwnSubjectIds:
          writeConfig?.getOwnSubjectIds ??
          (readPlugin ? () => readPlugin.getOwnSubjectIds() : undefined),
      } as MemoryWritePluginConfig));
    }

    // 9. External plugins from PluginRegistry
    const registeredPlugins = PluginRegistry.getAll();
    if (registeredPlugins.size > 0) {
      const factoryContext: PluginFactoryContext = {
        agentId: this._agentId,
        userId: this._userId,
        features: features as Record<string, boolean | undefined>,
      };

      for (const [featureKey, entry] of registeredPlugins) {
        if (!features[featureKey]) continue; // Feature not enabled

        // Validate dependencies
        if (entry.dependencies?.length) {
          const missingDeps = entry.dependencies.filter(dep => !features[dep]);
          if (missingDeps.length > 0) {
            throw new Error(
              `Plugin '${entry.pluginName}' requires features: ${missingDeps.join(', ')}. ` +
              `Enable them in features configuration.`,
            );
          }
        }

        // Skip if already manually registered (manual takes precedence)
        if (this._plugins.has(entry.pluginName)) {
          logger.debug(
            { plugin: entry.pluginName },
            `Plugin '${entry.pluginName}' already registered, skipping auto-init from PluginRegistry`,
          );
          continue;
        }

        const pluginConfig = configs[featureKey] as Record<string, unknown> | undefined;
        const plugin = entry.factory(pluginConfig, factoryContext);
        this.registerPlugin(plugin);

        logger.debug(
          { plugin: entry.pluginName, featureKey },
          `Auto-initialized external plugin '${entry.pluginName}' from PluginRegistry`,
        );
      }
    }

    // Validate strategy dependencies now that plugins are initialized
    this.validateStrategyDependencies(this._compactionStrategy);
  }

  /**
   * Validate that a strategy's required plugins are registered.
   * Logs a warning if required plugins are missing — the strategy should degrade gracefully.
   */
  private validateStrategyDependencies(strategy: ICompactionStrategy): void {
    if (!strategy.requiredPlugins?.length) return;

    const availablePlugins = new Set(this._plugins.keys());
    const missing = strategy.requiredPlugins.filter(name => !availablePlugins.has(name));

    if (missing.length > 0) {
      logger.warn(
        { strategy: strategy.name, missing, available: Array.from(availablePlugins) },
        `Strategy '${strategy.name}' recommends plugins that are not registered: ${missing.join(', ')}. ` +
        `Strategy will degrade gracefully.`
      );
    }
  }

  /**
   * Sync identity fields and connector registry to ToolContext.
   * Merges with existing ToolContext to preserve other fields (memory, signal, taskId).
   *
   * Connector registry resolution order:
   * 1. If `identities` OR `connectorAccounts` is non-empty → filtered view
   *    showing union of identity connectors + connectorAccounts keys
   * 2. If access policy + userId → scoped view via Connector.scoped()
   * 3. Otherwise → full global registry
   */
  private syncToolContext(): void {
    const existing = this._tools.getToolContext();

    // Auto-build connectorAccounts from single-account identities.
    // For connectors with exactly one accountId in identities, set the binding
    // so withAccountBinding() resolves it from context.connectorAccounts[connectorName]
    // without the host app needing to call mergeToolContext() manually.
    // Multi-account connectors (2+ accountIds for same connector) use explicit
    // per-tool binding — do NOT set connectorAccounts for those.
    let connectorAccounts = existing?.connectorAccounts;
    if (this._identities?.length) {
      const byConnector = new Map<string, string[]>();
      for (const id of this._identities) {
        if (id.accountId) {
          const list = byConnector.get(id.connector) ?? [];
          list.push(id.accountId);
          byConnector.set(id.connector, list);
        }
      }
      connectorAccounts = { ...connectorAccounts };
      for (const [connector, accounts] of byConnector) {
        // Only auto-set for single-account connectors; preserve host-app overrides
        if (accounts.length === 1 && !connectorAccounts[connector]) {
          connectorAccounts[connector] = accounts[0]!;
        }
      }
    }

    this._tools.setToolContext({
      ...existing,
      agentId: this._agentId,
      userId: this._userId,
      timeZone: this._timezone,
      identities: this._identities,
      connectorAccounts,
      connectorRegistry: this.buildConnectorRegistry(),
    });
  }

  /**
   * Build the connector registry appropriate for this agent's config.
   *
   * The filtered view's `allowed` set is computed at CALL time (not snapshot at
   * build time) so it stays correct when host apps add single-account bindings
   * via `mergeToolContext({ connectorAccounts })` AFTER agent construction.
   * v25's `OneRingAgentExecutor` does exactly that: `Agent.create({ identities })`
   * first, then `agent.tools.mergeToolContext({ connectorAccounts })`. Snapshotting
   * at build time would freeze `allowed` to identities-only and reject any
   * connector that's only bound via connectorAccounts — even though the agent
   * legitimately has access to it.
   */
  private buildConnectorRegistry(): IConnectorRegistry {
    // Compute the allowed-connector set on every call so late-bound
    // connectorAccounts entries (added via mergeToolContext after construction)
    // are honored. A connector is reachable from this agent if it is named in
    // identities OR in connectorAccounts.
    const computeAllowed = (): Set<string> | null => {
      const ctx = this._tools.getToolContext();
      const fromIdentities = (this._identities ?? []).map(id => id.connector);
      const fromAccounts = Object.keys(ctx?.connectorAccounts ?? {});
      if (fromIdentities.length === 0 && fromAccounts.length === 0) return null;
      return new Set<string>([...fromIdentities, ...fromAccounts]);
    };

    // Resolve the base registry on each call too — host apps (e.g. v25) install
    // their own custom registry whose visibility depends on ambient context, so
    // we can't snapshot it at construction time either.
    const resolveBase = (): IConnectorRegistry =>
      this._userId && Connector.getAccessPolicy()
        ? Connector.scoped({ userId: this._userId })
        : Connector.asRegistry();

    return {
      get: (name) => {
        const base = resolveBase();
        const allowed = computeAllowed();
        if (!allowed) return base.get(name);
        if (!allowed.has(name)) {
          const available = [...allowed].filter(n => base.has(n)).join(', ') || 'none';
          throw new ConnectorNotFoundError(`Connector '${name}' not found. Available: ${available}`);
        }
        return base.get(name);
      },
      has: (name) => {
        const base = resolveBase();
        const allowed = computeAllowed();
        if (!allowed) return base.has(name);
        return allowed.has(name) && base.has(name);
      },
      list: () => {
        const base = resolveBase();
        const allowed = computeAllowed();
        if (!allowed) return base.list();
        return base.list().filter(n => allowed.has(n));
      },
      listAll: () => {
        const base = resolveBase();
        const allowed = computeAllowed();
        if (!allowed) return base.listAll();
        return base.listAll().filter(c => allowed.has(c.name));
      },
      size: () => {
        const base = resolveBase();
        const allowed = computeAllowed();
        if (!allowed) return base.size();
        return base.listAll().filter(c => allowed.has(c.name)).length;
      },
      getDescriptionsForTools: () => {
        const base = resolveBase();
        const allowed = computeAllowed();
        const connectors = allowed ? base.listAll().filter(c => allowed.has(c.name)) : base.listAll();
        if (connectors.length === 0) return 'No connectors registered yet.';
        return connectors
          .map(c => `  - "${c.name}": ${c.displayName} - ${c.config.description || 'No description'}`)
          .join('\n');
      },
      getInfo: () => {
        const base = resolveBase();
        const allowed = computeAllowed();
        const connectors = allowed ? base.listAll().filter(c => allowed.has(c.name)) : base.listAll();
        const info: Record<string, { displayName: string; description: string; baseURL: string }> = {};
        for (const c of connectors) {
          info[c.name] = {
            displayName: c.displayName,
            description: c.config.description || '',
            baseURL: c.baseURL,
          };
        }
        return info;
      },
    };
  }

  // ============================================================================
  // Public Properties
  // ============================================================================

  /** Get the tool manager */
  get tools(): ToolManager {
    return this._tools;
  }

  /** Get the model name */
  get model(): string {
    return this._config.model;
  }

  /**
   * Keep managed-context model metadata synchronized with the owning Agent.
   * Explicit maxContextTokens overrides remain fixed across model changes.
   */
  setModel(model: string): void {
    this.assertNotDestroyed();
    this._config.model = model;
    if (this._usesModelContextLimit) {
      this._maxContextTokens = getModelInfo(model)?.features?.input?.tokens ?? 128000;
      this._config.maxContextTokens = this._maxContextTokens;
    }
    this._cachedBudget = null;
  }

  /** Get the agent ID */
  get agentId(): string {
    return this._agentId;
  }

  /** Get the current user ID */
  get userId(): string | undefined {
    return this._userId;
  }

  /** Set user ID. Automatically updates ToolContext for all tool executions. */
  set userId(value: string | undefined) {
    this._userId = value;
    this.syncToolContext();
  }

  /** Get the auth identities this agent is scoped to (undefined = all visible connectors) */
  get identities(): AuthIdentity[] | undefined {
    return this._identities;
  }

  /** Set auth identities. Updates ToolContext.connectorRegistry and identity-aware descriptions. */
  set identities(value: AuthIdentity[] | undefined) {
    this._identities = value;
    this.syncToolContext();
  }

  /** Get/set system prompt */
  get systemPrompt(): string | undefined {
    return this._systemPrompt;
  }

  set systemPrompt(value: string | undefined) {
    this._systemPrompt = value;
  }

  /** Get feature configuration */
  get features(): ResolvedContextFeatures {
    return this._config.features;
  }

  /** Check if destroyed */
  get isDestroyed(): boolean {
    return this._destroyed;
  }

  /** Get current session ID */
  get sessionId(): string | null {
    return this._sessionId;
  }

  /** Get storage (null if not configured) */
  get storage(): IContextStorage | null {
    return this._storage ?? null;
  }

  /**
   * Get the last thinking/reasoning content from the most recent assistant response.
   * Updated on every assistant response, always available regardless of persistence setting.
   */
  get lastThinking(): string | null {
    return this._lastThinking;
  }

  /** Get max context tokens */
  get maxContextTokens(): number {
    return this._maxContextTokens;
  }

  /** Get response reserve tokens */
  get responseReserve(): number {
    return this._config.responseReserve;
  }

  /** Get current tools token usage (useful for debugging) */
  get toolsTokens(): number {
    return this.calculateToolsTokens();
  }

  /**
   * Get the cached budget from the last prepare() call.
   * Returns null if prepare() hasn't been called yet.
   */
  get lastBudget(): ContextBudget | null {
    return this._cachedBudget;
  }

  /**
   * Get the current compaction strategy.
   */
  get compactionStrategy(): ICompactionStrategy {
    return this._compactionStrategy;
  }

  /**
   * Set the compaction strategy.
   * Can be changed at runtime to switch compaction behavior.
   */
  setCompactionStrategy(strategy: ICompactionStrategy): void {
    this.assertNotDestroyed();
    this.validateStrategyDependencies(strategy);
    this._compactionStrategy = strategy;
  }

  /**
   * Set the beforeCompaction callback.
   * Called by Agent to wire up lifecycle hooks.
   */
  setBeforeCompactionCallback(callback: BeforeCompactionCallback | null): void {
    this._beforeCompactionCallback = callback;
  }

  // ============================================================================
  // Compatibility / Migration Helpers
  // ============================================================================

  /**
   * Get working memory plugin (if registered).
   * This is a compatibility accessor for code expecting ctx.memory
   */
  get memory(): import('./plugins/WorkingMemoryPluginNextGen.js').WorkingMemoryPluginNextGen | null {
    const plugin = this._plugins.get('working_memory');
    return plugin as import('./plugins/WorkingMemoryPluginNextGen.js').WorkingMemoryPluginNextGen | null;
  }

  /**
   * Get the last message (most recent user message or tool results).
   * Used for compatibility with old code that expected a single item.
   */
  getLastUserMessage(): InputItem | null {
    if (this._conversation.length === 0) return null;
    const last = this._conversation[this._conversation.length - 1];
    if (!last) return null;
    // Return if it's user message (check for role property and USER role)
    if ('role' in last && last.role === MessageRole.USER) return last;
    return null;
  }

  /**
   * Set current input (user message).
   * Adds a user message to the conversation and sets it as the current input for prepare().
   */
  setCurrentInput(content: string | Content[]): void {
    this.assertNotDestroyed();
    // Clear existing current input array and set new user message as current input.
    // addUserMessage() sets _currentInput = [message] without pushing to _conversation.
    // The user message moves to _conversation later when addAssistantResponse() is called.
    this._currentInput = [];
    this.addUserMessage(content);
    // Capture original user input — setCurrentInput is called once per execution
    // via _prepareExecution(). This snapshot survives the agentic loop where
    // _currentInput gets overwritten with tool results.
    this._originalUserInput = [...this._currentInput];
  }

  /**
   * Add multiple input items to conversation (legacy compatibility).
   */
  addInputItems(items: InputItem[]): void {
    this.assertNotDestroyed();
    for (const item of items) {
      this._conversation.push(item);
    }
    // Capture original user input from the seeded items
    this._originalUserInput = items.filter(
      item => item.type === 'message' && (item as any).role === MessageRole.USER
    );
  }

  /**
   * Legacy alias for prepare() - returns prepared context.
   */
  async prepareConversation(): Promise<PreparedContext> {
    return this.prepare();
  }

  /**
   * Add a message (legacy compatibility).
   * For user messages, use addUserMessage instead.
   * For assistant messages, use addAssistantResponse instead.
   */
  addMessage(role: 'user' | 'assistant', content: string | Content[]): string {
    this.assertNotDestroyed();
    if (role === 'user') {
      return this.addUserMessage(content);
    }
    // For assistant, we need to convert to OutputItem format
    const outputItem: OutputItem = {
      type: 'message' as const,
      role: MessageRole.ASSISTANT,
      content: [{
        type: ContentType.OUTPUT_TEXT,
        text: typeof content === 'string' ? content : JSON.stringify(content),
      }],
    };
    return this.addAssistantResponse([outputItem]);
  }

  // ============================================================================
  // Plugin Management
  // ============================================================================

  /**
   * Register a plugin.
   * Plugin's tools are automatically registered with ToolManager.
   */
  registerPlugin(plugin: IContextPluginNextGen, options?: { skipDestroyOnContextDestroy?: boolean }): void {
    this.assertNotDestroyed();

    if (this._plugins.has(plugin.name)) {
      throw new Error(`Plugin '${plugin.name}' is already registered`);
    }

    this._plugins.set(plugin.name, plugin);

    if (options?.skipDestroyOnContextDestroy) {
      this._skipDestroyPlugins.add(plugin.name);
    }

    // Register plugin's own tools (non-store tools like todo_*)
    const tools = plugin.getTools();
    for (const tool of tools) {
      this._tools.register(tool);
      this._contextToolNames.add(tool.definition.function.name);
    }

    // If plugin implements IStoreHandler, register with unified store tools
    if (isStoreHandler(plugin)) {
      this._storeToolsManager.registerHandler(plugin);

      // Register the 5 generic store_* tools on first IStoreHandler
      if (!this._storeToolsRegistered) {
        const storeTools = this._storeToolsManager.getTools();
        for (const tool of storeTools) {
          this._tools.register(tool);
          this._contextToolNames.add(tool.definition.function.name);
        }
        this._storeToolsRegistered = true;
      }
    }
  }

  /**
   * Get a plugin by name.
   */
  getPlugin<T extends IContextPluginNextGen>(name: string): T | null {
    return (this._plugins.get(name) as T) ?? null;
  }

  /**
   * Check if a plugin is registered.
   */
  hasPlugin(name: string): boolean {
    return this._plugins.has(name);
  }

  /**
   * Get all registered plugins.
   */
  getPlugins(): IContextPluginNextGen[] {
    return Array.from(this._plugins.values());
  }

  /**
   * Return executable tool names recreated by this context's plugin set.
   * Portable runtimes use this to avoid replacing restored plugin tools with
   * remote proxies that would operate on a different context instance.
   */
  getContextToolNames(): string[] {
    return Array.from(this._contextToolNames);
  }

  // ============================================================================
  // Conversation Management
  // ============================================================================

  /**
   * Add a user message.
   * Returns the message ID.
   */
  addUserMessage(content: string | Content[]): string {
    this.assertNotDestroyed();

    const id = this.generateId();
    const contentArray: Content[] = typeof content === 'string'
      ? [{ type: ContentType.INPUT_TEXT, text: content }]
      : content;

    const message: Message = {
      type: 'message',
      id,
      role: MessageRole.USER,
      content: contentArray,
    };

    // User message becomes current input
    this._currentInput = [message];

    // Journal: append user message and increment turn
    this._turnIndex++;
    this._journalAppend('user', [message]);

    this.emit('message:added', { role: 'user', index: this._conversation.length });

    return id;
  }

  /**
   * Add assistant response (from LLM output).
   * Also moves current input to conversation history.
   * Returns the message ID.
   */
  addAssistantResponse(output: OutputItem[]): string {
    this.assertNotDestroyed();

    // First, move current input to conversation
    if (this._currentInput.length > 0) {
      this._conversation.push(...this._currentInput);
      this._currentInput = [];
    }

    // Build assistant message
    const id = this.generateId();
    const { content: contentArray, thinkingText } = this.buildAssistantContent(output);

    // Always update lastThinking (available for inspection via property)
    this._lastThinking = thinkingText;

    // Only add if there's content
    if (contentArray.length > 0) {
      const message: Message = {
        type: 'message',
        id,
        role: MessageRole.ASSISTANT,
        content: contentArray,
      };

      this._conversation.push(message);

      // Journal: append assistant message (same turn as the user message)
      this._journalAppend('assistant', [message]);

      this.emit('message:added', { role: 'assistant', index: this._conversation.length - 1 });
    }

    return id;
  }

  /**
   * Rebuild assistant message content (text + tool_use, plus thinking when the
   * vendor requires persistence) from raw provider output items. Shared by
   * {@link addAssistantResponse} and {@link replaceLastAssistantResponse}.
   */
  private buildAssistantContent(output: OutputItem[]): { content: Content[]; thinkingText: string | null } {
    const contentArray: Content[] = [];
    let thinkingText: string | null = null;

    for (const item of output) {
      if (item.type === 'message' && 'content' in item) {
        // Text content
        const msg = item as Message;
        for (const c of msg.content) {
          if (c.type === ContentType.OUTPUT_TEXT || c.type === ContentType.INPUT_TEXT) {
            contentArray.push({
              type: ContentType.OUTPUT_TEXT,
              text: (c as any).text || '',
            });
          } else if (c.type === ContentType.TOOL_USE) {
            contentArray.push(c);
          } else if (c.type === ContentType.THINKING) {
            // Capture thinking text regardless of persistence
            const thinking = c as import('../../domain/entities/Content.js').ThinkingContent;
            thinkingText = thinking.thinking;
            // Only persist in history when the vendor requires it (e.g., Anthropic)
            if (thinking.persistInHistory) {
              contentArray.push(c);
            }
          }
        }
      } else if (item.type === 'compaction' || item.type === 'reasoning') {
        // Skip compaction and reasoning items for now
        continue;
      }
    }

    return { content: contentArray, thinkingText };
  }

  /**
   * Replace the content of the most recent assistant message in the conversation
   * with `output` (rebuilt the same way as {@link addAssistantResponse}). Used
   * when the final answer is transformed after it was already committed — e.g.
   * the structured-output reformat pass in `Agent.run()` — so the persisted
   * history, session save/load, continuation, and the history journal all
   * reflect the same answer the caller received rather than the pre-reformat
   * text.
   */
  replaceLastAssistantResponse(output: OutputItem[]): boolean {
    this.assertNotDestroyed();

    const { content, thinkingText } = this.buildAssistantContent(output);
    if (content.length === 0) return false;

    for (let i = this._conversation.length - 1; i >= 0; i--) {
      const item = this._conversation[i];
      if (item && item.type === 'message' && (item as Message).role === MessageRole.ASSISTANT) {
        const updated: Message = { ...(item as Message), content };
        this._conversation[i] = updated;
        this._lastThinking = thinkingText;
        this._journalReplaceLast('assistant', updated);
        return true;
      }
    }
    return false;
  }

  /**
   * Add tool results.
   * Returns the message ID.
   */
  addToolResults(results: ToolResult[]): string {
    this.assertNotDestroyed();

    if (results.length === 0) {
      return '';
    }

    const id = this.generateId();
    const contentArray: Content[] = results.map(r => {
      let contentStr: string;
      let images: Array<{ base64: string; mediaType: string }> | undefined;

      if (typeof r.content === 'string') {
        contentStr = r.content;
      } else if (r.content && Array.isArray(r.content.__images) && r.content.__images.length > 0) {
        // __images convention: separate images from text content.
        // Images are stored on the Content object and handled natively by provider converters.
        // This prevents base64 data from inflating text-based token counts.
        images = r.content.__images;
        const { __images: _, base64: __, ...rest } = r.content;
        contentStr = JSON.stringify(rest);
      } else {
        contentStr = JSON.stringify(r.content);
      }

      return {
        type: ContentType.TOOL_RESULT,
        tool_use_id: r.tool_use_id,
        content: contentStr,
        error: r.error,
        ...(images ? { __images: images } : {}),
      } as Content;
    });

    const message: Message = {
      type: 'message',
      id,
      role: MessageRole.USER, // Tool results are user role in most APIs
      content: contentArray,
    };

    // Tool results become current input
    this._currentInput = [message];

    // Journal: append tool results (same turn as the preceding assistant tool_use)
    this._journalAppend('tool_result', [message]);

    this.emit('message:added', { role: 'tool', index: this._conversation.length });

    return id;
  }

  /**
   * Get conversation history (read-only).
   */
  getConversation(): ReadonlyArray<InputItem> {
    return this._conversation;
  }

  /**
   * Get current input (read-only).
   * NOTE: This changes during the agentic loop — after tool execution it
   * contains tool results, not the original user message.
   */
  getCurrentInput(): ReadonlyArray<InputItem> {
    return this._currentInput;
  }

  /**
   * Get the original user input from the start of execution.
   * Unlike getCurrentInput() which changes during the agentic loop
   * (tool results replace user message), this always returns the
   * input that started the current execution.
   */
  getOriginalUserInput(): ReadonlyArray<InputItem> {
    return this._originalUserInput;
  }

  /**
   * Get the history journal (if storage supports it).
   *
   * The journal provides read access to full conversation history,
   * independent of context compaction. Returns null if storage is not
   * configured or doesn't support journaling.
   */
  get journal(): IHistoryJournal | null {
    return this._storage?.journal ?? null;
  }

  /**
   * Get conversation length.
   */
  getConversationLength(): number {
    return this._conversation.length;
  }

  /**
   * Clear conversation history.
   */
  clearConversation(reason?: string): void {
    this.assertNotDestroyed();
    this._conversation = [];
    this._currentInput = [];
    this.emit('conversation:cleared', { reason });
  }

  // ============================================================================
  // Context Preparation (THE main method)
  // ============================================================================

  /**
   * Prepare context for LLM call.
   *
   * This method:
   * 1. Calculates tool definition tokens (never compacted)
   * 2. Builds the system message from all components
   * 3. Calculates token budget
   * 4. Handles oversized current input if needed
   * 5. Runs compaction if needed
   * 6. Returns final InputItem[] ready for LLM
   *
   * IMPORTANT: Call this ONCE right before each LLM call!
   */
  async prepare(): Promise<PreparedContext> {
    this.assertNotDestroyed();

    // Reset lastThinking at start of each turn to prevent stale data
    this._lastThinking = null;

    // Fire onBeforePrepare hooks on plugins that implement it. Intended for
    // side-effect plugins (e.g. session-learning ingestors) that need to
    // observe the conversation before compaction potentially evicts messages.
    // Hooks are fire-and-forget: we do NOT await them, so a slow ingestion
    // job cannot block the turn. Throws are caught + logged so a buggy plugin
    // cannot break context preparation.
    const prepareSnapshot = {
      messages: this._conversation as ReadonlyArray<unknown>,
      currentInput: this._currentInput as ReadonlyArray<unknown>,
    };
    for (const plugin of this._plugins.values()) {
      if (typeof plugin.onBeforePrepare === 'function') {
        try {
          // The hook signature is `void`, but TS allows `async` implementations
          // whose rejections would otherwise be unhandled promise rejections.
          // Capture a thenable return and attach a .catch so async throws get
          // the same logging treatment as sync ones.
          const ret: unknown = plugin.onBeforePrepare(prepareSnapshot);
          if (ret && typeof (ret as { catch?: unknown }).catch === 'function') {
            (ret as Promise<unknown>).catch((err) => {
              // eslint-disable-next-line no-console
              console.warn(
                `AgentContextNextGen: plugin '${plugin.name}' onBeforePrepare rejected asynchronously:`,
                err,
              );
            });
          }
        } catch (err) {
          // Swallow — a side-effect plugin must never break prepare().
          // eslint-disable-next-line no-console
          console.warn(
            `AgentContextNextGen: plugin '${plugin.name}' onBeforePrepare threw:`,
            err,
          );
        }
      }
    }

    const compactionLog: string[] = [];

    // Step 1: Calculate tool tokens (NEVER compacted - must fit!)
    const toolsTokens = this.calculateToolsTokens();

    // Available = maxTokens - responseReserve - toolsTokens
    const availableForContent = this._maxContextTokens - this._config.responseReserve - toolsTokens;

    if (availableForContent <= 0) {
      throw new Error(
        `Too many tools registered: tools use ${toolsTokens} tokens, ` +
        `only ${this._maxContextTokens - this._config.responseReserve} available. ` +
        `Consider reducing the number of tools or their descriptions.`
      );
    }

    // Step 2: Build system message and calculate its tokens
    const { systemMessage, systemTokens, breakdown } = await this.buildSystemMessage();

    // Step 3: Calculate current input tokens
    let currentInputTokens = this.calculateInputTokens(this._currentInput);

    // Step 4: Check if current input is too large
    const systemPlusInput = systemTokens + currentInputTokens;
    if (systemPlusInput > availableForContent) {
      // Current input too large - handle it
      const result = await this.handleOversizedInput(
        availableForContent - systemTokens
      );
      this.emit('input:oversized', { result });

      if (!result.accepted) {
        throw new Error(result.error || 'Current input is too large for context');
      }

      // Recalculate current input tokens after truncation
      currentInputTokens = this.calculateInputTokens(this._currentInput);
    }

    // Step 5: Calculate conversation tokens
    let conversationTokens = this.calculateConversationTokens();
    let totalUsed = systemTokens + conversationTokens + currentInputTokens;

    // Step 6: Check if compaction needed.
    //
    // Compaction is gated on the CRITICAL threshold, not the strategy's own
    // threshold. Below critical, nothing is compacted — every message,
    // including all tool results, stays verbatim in the input array for the
    // whole agentic loop. This is the guarantee tool-heavy agents rely on:
    // file reads / API responses are never spilled to working memory (or
    // dropped) mid-run just because we crossed 75%.
    //
    // The strategy's `threshold` is now only the reclaim FLOOR: once we're
    // over critical, we free enough to bring utilization back down to
    // (strategyThreshold - 0.1), giving hysteresis so we don't re-trigger
    // every turn. We clamp that floor below critical so a misconfigured
    // strategy threshold (>= critical) can never produce a no-op compaction.
    let compacted = false;
    const strategyThreshold = this._compactionStrategy.threshold;
    const criticalThreshold = this._config.criticalCompactionThreshold;
    const utilization = totalUsed / availableForContent;
    if (utilization > criticalThreshold) {
      const reclaimTo = Math.min(strategyThreshold - 0.1, criticalThreshold - 0.1);
      const targetToFree = totalUsed - Math.floor(availableForContent * reclaimTo);

      logger.info(
        {
          component: 'AgentContextNextGen',
          utilizationPercent: Math.round(utilization * 100),
          criticalPercent: Math.round(criticalThreshold * 100),
          reclaimToPercent: Math.round(reclaimTo * 100),
          targetToFree,
          strategy: this._compactionStrategy.name,
        },
        'critical compaction threshold crossed — running compaction (tool results kept inline until now)',
      );

      const freed = await this.runCompaction(targetToFree, compactionLog);
      compacted = freed > 0;

      // Recalculate after compaction
      conversationTokens = this.calculateConversationTokens();
      totalUsed = systemTokens + conversationTokens + currentInputTokens;
    }

    // Step 7: Build final budget (include tools in totalUsed for accurate reporting)
    const totalUsedWithTools = totalUsed + toolsTokens;
    const budget: ContextBudget = {
      maxTokens: this._maxContextTokens,
      responseReserve: this._config.responseReserve,
      systemMessageTokens: systemTokens,
      toolsTokens,
      conversationTokens,
      currentInputTokens,
      totalUsed: totalUsedWithTools,
      available: this._maxContextTokens - this._config.responseReserve - totalUsedWithTools,
      utilizationPercent: (totalUsedWithTools / (this._maxContextTokens - this._config.responseReserve)) * 100,
      breakdown: {
        ...breakdown,
        tools: toolsTokens,
        conversation: conversationTokens,
        currentInput: currentInputTokens,
      },
    };

    // Cache the budget for inspection via lastBudget getter
    this._cachedBudget = budget;

    // Emit budget:updated event for reactive monitoring
    this.emit('budget:updated', { budget, timestamp: Date.now() });

    // Step 8: Emit budget warnings
    if (budget.utilizationPercent >= 90) {
      this.emit('budget:critical', { budget });
    } else if (budget.utilizationPercent >= 70) {
      this.emit('budget:warning', { budget });
    }

    // Step 9: Build final input array
    let input: InputItem[] = [
      systemMessage,
      ...this._conversation,
      ...this._currentInput,
    ];

    // Step 10: CRITICAL - Sanitize tool pairs before LLM call
    // Ensures every TOOL_USE has matching TOOL_RESULT and vice versa
    input = this.sanitizeToolPairs(input);

    this.emit('context:prepared', { budget, compacted });

    return {
      input,
      budget,
      compacted,
      compactionLog,
    };
  }

  // ============================================================================
  // System Message Building
  // ============================================================================

  /**
   * Build the system message containing all context components.
   */
  private async buildSystemMessage(): Promise<{
    systemMessage: Message;
    systemTokens: number;
    breakdown: {
      systemPrompt: number;
      persistentInstructions: number;
      pluginInstructions: number;
      pluginContents: Record<string, number>;
    };
  }> {
    const parts: string[] = [];
    const breakdown = {
      systemPrompt: 0,
      persistentInstructions: 0,
      pluginInstructions: 0,
      pluginContents: {} as Record<string, number>,
    };

    // 1. System Prompt (user-provided) — run dynamic template pass
    if (this._systemPrompt) {
      const resolvedPrompt = await TemplateEngine.process(this._systemPrompt, {
        agentId: this._agentId,
        model: this._config.model,
        userId: this._userId,
      }, { phase: 'dynamic' });
      parts.push(`# System Prompt\n\n${resolvedPrompt}`);
      breakdown.systemPrompt = this._estimator.estimateTokens(resolvedPrompt);
    }

    // 2. Persistent Instructions (from plugin, if enabled)
    const persistentPlugin = this._plugins.get('persistent_instructions');
    if (persistentPlugin) {
      const content = await persistentPlugin.getContent();
      if (content) {
        parts.push(`# Persistent Instructions\n\n${content}`);
        breakdown.persistentInstructions = persistentPlugin.getTokenSize();
      }
    }

    // 3. Store System Overview + Plugin Instructions
    const instructionParts: string[] = [];
    let totalInstructionTokens = 0;

    // If any CRUD stores are registered, add a unified overview block first
    const storeSchemas = this._storeToolsManager.getSchemas();
    if (storeSchemas.length > 0) {
      const overview = this._storeToolsManager.buildOverview();
      instructionParts.push(overview);
      totalInstructionTokens += this._estimator.estimateTokens(overview);
    }

    // Per-plugin instructions (behavior, rules, workflows — NOT tool listing)
    for (const plugin of this._plugins.values()) {
      const instructions = plugin.getInstructions();
      if (instructions) {
        instructionParts.push(`## ${this.pluginSectionTitle(plugin)}\n\n${instructions}`);
        totalInstructionTokens += plugin.getInstructionsTokenSize();
      }
    }

    if (instructionParts.length > 0) {
      parts.push(`# Instructions for Context Plugins\n\n${instructionParts.join('\n\n')}`);
      breakdown.pluginInstructions = totalInstructionTokens;
    }

    // 4. Plugin Contents (actual data from each plugin, except persistent instructions)
    for (const plugin of this._plugins.values()) {
      if (plugin.name === 'persistent_instructions') continue; // Already handled above

      const content = await plugin.getContent();
      if (content) {
        const sectionTitle = this.pluginSectionTitle(plugin);
        parts.push(`# ${sectionTitle}\n\n${content}`);
        breakdown.pluginContents[plugin.name] = plugin.getTokenSize();
      }
    }

    // 5. Current date and time (always injected). Render in the viewer's
    // timezone when the host supplied one (config.timezone); otherwise fall
    // back to the host machine's zone (prior behavior). Guard against an
    // invalid IANA string so a bad zone degrades to ISO instead of throwing.
    const now = new Date();
    const displayZone = this._timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    let currentDateTime: string;
    try {
      currentDateTime = now.toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'long', timeZone: displayZone });
    } catch {
      currentDateTime = `${now.toISOString()} (UTC)`;
    }
    parts.push(`CURRENT DATE AND TIME: ${currentDateTime}`);

    // Build final system message
    const systemText = parts.join('\n\n---\n\n');
    const systemTokens = this._estimator.estimateTokens(systemText);

    const systemMessage: Message = {
      type: 'message',
      role: MessageRole.DEVELOPER,
      content: [{ type: ContentType.INPUT_TEXT, text: systemText }],
    };

    return { systemMessage, systemTokens, breakdown };
  }

  /**
   * Resolve the LLM-visible section title for a plugin.
   * For IStoreHandler plugins, prefer the schema's `displayName` (the same
   * label the LLM sees in the `## Data Stores` overview), so the per-plugin
   * section header stays consistent with the storeId it documents. Falls back
   * to `formatPluginName(plugin.name)` for plugins without a schema.
   */
  private pluginSectionTitle(plugin: IContextPluginNextGen): string {
    if (isStoreHandler(plugin)) {
      const displayName = plugin.getStoreSchema().displayName;
      if (displayName) return displayName;
    }
    return this.formatPluginName(plugin.name);
  }

  /**
   * Format plugin name for display (e.g., 'working_memory' -> 'Working Memory')
   */
  private formatPluginName(name: string): string {
    return name
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  // ============================================================================
  // Token Calculations
  // ============================================================================

  /**
   * Calculate tokens used by tool definitions.
   * Tools are sent separately to the LLM and take up context space.
   */
  private calculateToolsTokens(): number {
    const enabledTools = this._tools.getEnabled();
    if (enabledTools.length === 0) return 0;

    let total = 0;

    for (const tool of enabledTools) {
      // Each tool has: name, description, parameters schema
      const fn = tool.definition.function;

      // Name: ~2-5 tokens
      total += this._estimator.estimateTokens(fn.name);

      // Description: varies widely, typically 20-100 tokens
      if (fn.description) {
        total += this._estimator.estimateTokens(fn.description);
      }

      // Parameters schema: JSON schema can be large
      if (fn.parameters) {
        total += this._estimator.estimateDataTokens(fn.parameters);
      }

      // Per-tool overhead (JSON structure, type field, etc.)
      total += 10;
    }

    // Overall tools array overhead
    total += 20;

    return total;
  }

  /**
   * Calculate tokens for conversation history.
   */
  private calculateConversationTokens(): number {
    let total = 0;
    for (const item of this._conversation) {
      total += this.estimateItemTokens(item);
    }
    return total;
  }

  /**
   * Calculate tokens for current input.
   */
  private calculateInputTokens(items: InputItem[]): number {
    let total = 0;
    for (const item of items) {
      total += this.estimateItemTokens(item);
    }
    return total;
  }

  /**
   * Estimate tokens for a single InputItem.
   */
  private estimateItemTokens(item: InputItem): number {
    if (item.type !== 'message') return 50; // Default for unknown types

    const msg = item as Message;
    let total = 4; // Message overhead

    for (const c of msg.content) {
      if (c.type === ContentType.INPUT_TEXT || c.type === ContentType.OUTPUT_TEXT) {
        total += this._estimator.estimateTokens((c as any).text || '');
      } else if (c.type === ContentType.TOOL_USE) {
        total += this._estimator.estimateTokens((c as any).name || '');
        total += this._estimator.estimateDataTokens((c as any).input || {});
      } else if (c.type === ContentType.TOOL_RESULT) {
        // Count text content tokens (images already stripped from content string)
        total += this._estimator.estimateTokens((c as any).content || '');
        // Count attached images separately using image-aware estimation
        const images = (c as any).__images as Array<{ base64: string; mediaType: string }> | undefined;
        if (images?.length) {
          for (const _img of images) {
            total += this._estimateImageTokens();
          }
        }
      } else if (c.type === ContentType.THINKING) {
        total += this._estimator.estimateTokens((c as any).thinking || '');
      } else if (c.type === ContentType.INPUT_IMAGE_URL) {
        const imgContent = c as any;
        const detail = imgContent.image_url?.detail;
        total += this._estimateImageTokens(undefined, undefined, detail);
      }
    }

    return total;
  }

  /**
   * Estimate tokens for a single image, using the estimator's image method if available.
   */
  private _estimateImageTokens(width?: number, height?: number, detail?: string): number {
    if (this._estimator.estimateImageTokens) {
      return this._estimator.estimateImageTokens(width, height, detail);
    }
    // Fallback for estimators that don't implement estimateImageTokens
    return 1000;
  }

  // ============================================================================
  // Compaction
  // ============================================================================

  /**
   * Run compaction to free up tokens.
   * Delegates to the current compaction strategy.
   * Returns total tokens freed.
   */
  private async runCompaction(targetToFree: number, log: string[]): Promise<number> {
    const timestamp = Date.now();

    // Emit compaction:starting event BEFORE any compaction occurs
    if (this._cachedBudget) {
      this.emit('compaction:starting', {
        budget: this._cachedBudget,
        targetTokensToFree: targetToFree,
        timestamp,
      });
    }

    // Call beforeCompaction callback if set (allows Agent to invoke lifecycle hooks)
    if (this._beforeCompactionCallback && this._cachedBudget) {
      try {
        await this._beforeCompactionCallback({
          budget: this._cachedBudget,
          targetTokensToFree: targetToFree,
          strategy: this._compactionStrategy.name,
        });
      } catch (error) {
        // Log but don't block compaction
        log.push(`beforeCompaction callback error: ${(error as Error).message}`);
      }
    }

    // Build CompactionContext for strategy
    const context = this.buildCompactionContext();

    // Delegate to strategy
    const result = await this._compactionStrategy.compact(context, targetToFree);

    // Merge strategy log with our log
    log.push(...result.log);

    if (result.tokensFreed > 0) {
      this.emit('context:compacted', { tokensFreed: result.tokensFreed, log });
    }

    return result.tokensFreed;
  }

  /**
   * Run post-cycle consolidation.
   * Called by Agent after agentic cycle completes (before session save).
   *
   * Delegates to the current compaction strategy's consolidate() method.
   * Use for more expensive operations like summarization.
   */
  async consolidate(): Promise<ConsolidationResult> {
    this.assertNotDestroyed();

    // Post-cycle consolidation spills large tool results to working memory
    // (and drops aged tool pairs). Gate it on the SAME critical threshold as
    // in-loop compaction: while there's ample room, tool results stay verbatim
    // in the conversation — never evicted between turns just because a run
    // finished. Only once the persisted context is genuinely near-full do we
    // let the strategy reclaim space.
    const utilization = this.estimateUtilization();
    const criticalThreshold = this._config.criticalCompactionThreshold;
    if (utilization <= criticalThreshold) {
      return {
        performed: false,
        tokensChanged: 0,
        actions: [
          `Consolidation skipped: utilization ${Math.round(utilization * 100)}% ` +
            `is at or below critical threshold ${Math.round(criticalThreshold * 100)}% ` +
            `— tool results kept inline.`,
        ],
      };
    }

    logger.info(
      {
        component: 'AgentContextNextGen',
        utilizationPercent: Math.round(utilization * 100),
        criticalPercent: Math.round(criticalThreshold * 100),
        strategy: this._compactionStrategy.name,
      },
      'post-cycle consolidation running — over critical threshold, reclaiming space',
    );

    const context = this.buildCompactionContext();
    return this._compactionStrategy.consolidate(context);
  }

  /**
   * Force a semantic context rollover, independently of token thresholds.
   *
   * The older conversation prefix is summarized by the caller, while recent
   * user turns and provider-opaque compaction items remain exact. Plugin state
   * is never compacted by this operation, and the append-only history journal
   * is untouched. The live conversation changes only after the summarizer has
   * returned a non-empty result and only if no concurrent context mutation was
   * observed.
   *
   * This is intended for provider-session boundaries (for example, a Realtime
   * session approaching its hard lifetime), not emergency token compaction.
   * Call it only between agent executions, when there is no pending input.
   */
  async rollover(options: ContextRolloverOptions): Promise<ContextRolloverResult> {
    this.assertNotDestroyed();

    if (!options || typeof options.summarize !== 'function') {
      throw new TypeError('rollover() requires a summarize callback');
    }
    const preserveRecentTurns = options.preserveRecentTurns ?? 8;
    if (!Number.isInteger(preserveRecentTurns) || preserveRecentTurns < 0) {
      throw new RangeError('preserveRecentTurns must be a non-negative integer');
    }
    if (options.reason !== undefined && typeof options.reason !== 'string') {
      throw new TypeError('reason must be a string when provided');
    }
    if (this._currentInput.length > 0) {
      throw new Error('Cannot roll over context while input is pending; finish the active turn first');
    }
    if (this._rolloverInProgress) {
      throw new Error('A context rollover is already in progress');
    }

    const beforeTokens = this.calculateConversationTokens();
    const turnStarts = this.findUserTurnStarts(this._conversation);
    const retainedTurns = Math.min(preserveRecentTurns, turnStarts.length);
    let cutoff = preserveRecentTurns === 0
      ? this._conversation.length
      : turnStarts.length > preserveRecentTurns
        ? turnStarts[turnStarts.length - preserveRecentTurns]!
        : 0;
    cutoff = this.adjustRolloverBoundaryForToolPairs(cutoff);

    if (cutoff === 0) {
      return {
        performed: false,
        beforeTokens,
        afterTokens: beforeTokens,
        tokensFreed: 0,
        itemsSummarized: 0,
        itemsRetained: this._conversation.length,
        retainedTurns,
        summaryTokens: 0,
        ...(options.reason === undefined ? {} : { reason: options.reason }),
      };
    }

    const conversationSnapshot = [...this._conversation];
    const currentInputSnapshot = [...this._currentInput];
    const olderPrefix = conversationSnapshot.slice(0, cutoff);
    const opaqueItems = olderPrefix.filter((item) => item.type === 'compaction');
    const summarizableItems = olderPrefix.filter((item) => item.type === 'message');

    if (summarizableItems.length === 0) {
      return {
        performed: false,
        beforeTokens,
        afterTokens: beforeTokens,
        tokensFreed: 0,
        itemsSummarized: 0,
        itemsRetained: this._conversation.length,
        retainedTurns,
        summaryTokens: 0,
        ...(options.reason === undefined ? {} : { reason: options.reason }),
      };
    }

    this._rolloverInProgress = true;
    try {
      const detachedItems = structuredClone(summarizableItems) as InputItem[];
      const estimatedTokens = summarizableItems.reduce(
        (total, item) => total + this.estimateItemTokens(item),
        0,
      );
      const summaryValue = await options.summarize({
        items: detachedItems,
        estimatedTokens,
        preservedRecentTurns: retainedTurns,
        ...(options.reason === undefined ? {} : { reason: options.reason }),
      });
      if (typeof summaryValue !== 'string') {
        throw new TypeError('Context rollover summarizer must return a string');
      }
      const summary = summaryValue.trim();

      if (!summary) {
        throw new Error('Context rollover summarizer returned an empty summary');
      }
      this.assertNotDestroyed();

      const conversationUnchanged =
        this._conversation.length === conversationSnapshot.length
        && this._conversation.every((item, index) => item === conversationSnapshot[index]);
      const currentInputUnchanged =
        this._currentInput.length === currentInputSnapshot.length
        && this._currentInput.every((item, index) => item === currentInputSnapshot[index]);
      if (!conversationUnchanged || !currentInputUnchanged) {
        throw new Error('Context changed while rollover summary was being generated');
      }

      const capsule: Message = {
        type: 'message',
        id: `context_rollover_${this.generateId()}`,
        role: MessageRole.DEVELOPER,
        content: [{
          type: ContentType.INPUT_TEXT,
          text:
            '# Prior Conversation Continuity Brief\n\n'
            + 'This is a compact record of earlier conversation context. Preserve its facts, '
            + 'decisions, commitments, unresolved work, and user preferences when continuing.\n\n'
            + summary,
        }],
      };
      const exactTail = conversationSnapshot.slice(cutoff);
      this._conversation = [capsule, ...opaqueItems, ...exactTail];
      this._cachedBudget = null;

      const afterTokens = this.calculateConversationTokens();
      const result: ContextRolloverResult = {
        performed: true,
        beforeTokens,
        afterTokens,
        tokensFreed: beforeTokens - afterTokens,
        itemsSummarized: summarizableItems.length,
        itemsRetained: opaqueItems.length + exactTail.length,
        retainedTurns,
        summaryTokens: this.estimateItemTokens(capsule),
        ...(options.reason === undefined ? {} : { reason: options.reason }),
      };

      logger.info(
        {
          component: 'AgentContextNextGen',
          beforeTokens,
          afterTokens,
          tokensFreed: result.tokensFreed,
          itemsSummarized: result.itemsSummarized,
          retainedTurns,
        },
        'context rollover completed',
      );
      this.emit('context:rolled_over', { result, timestamp: Date.now() });
      return result;
    } finally {
      this._rolloverInProgress = false;
    }
  }

  /** Return indices of real user-turn starts (tool-result messages do not start turns). */
  private findUserTurnStarts(items: ReadonlyArray<InputItem>): number[] {
    const starts: number[] = [];
    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      if (item?.type !== 'message' || item.role !== MessageRole.USER) continue;
      if (item.content.some((content) => content.type !== ContentType.TOOL_RESULT)) {
        starts.push(index);
      }
    }
    return starts;
  }

  /** Move a rollover boundary left if unusual seeded history would split a tool pair. */
  private adjustRolloverBoundaryForToolPairs(initialCutoff: number): number {
    if (initialCutoff <= 0 || initialCutoff >= this._conversation.length) return initialCutoff;

    const positions = new Map<string, number[]>();
    for (let index = 0; index < this._conversation.length; index++) {
      const item = this._conversation[index];
      if (item?.type !== 'message') continue;
      for (const content of item.content) {
        const id = content.type === ContentType.TOOL_USE
          ? content.id
          : content.type === ContentType.TOOL_RESULT
            ? content.tool_use_id
            : undefined;
        if (!id) continue;
        const indices = positions.get(id) ?? [];
        indices.push(index);
        positions.set(id, indices);
      }
    }

    let cutoff = initialCutoff;
    let changed = true;
    while (changed) {
      changed = false;
      for (const indices of positions.values()) {
        if (indices.some((index) => index < cutoff) && indices.some((index) => index >= cutoff)) {
          const adjusted = Math.min(cutoff, ...indices);
          if (adjusted < cutoff) {
            cutoff = adjusted;
            changed = true;
          }
        }
      }
    }
    return cutoff;
  }

  /**
   * Estimate current context utilization as a ratio of the available content
   * budget (0..1), consistent with the compaction gate in prepare(). Reuses
   * the last computed system-message token count from the cached budget to
   * avoid rebuilding the (async) system message; falls back to 0 for the
   * system portion if prepare() hasn't run yet this session.
   */
  private estimateUtilization(): number {
    const toolsTokens = this.calculateToolsTokens();
    const availableForContent =
      this._maxContextTokens - this._config.responseReserve - toolsTokens;
    if (availableForContent <= 0) return 1;

    const systemTokens = this._cachedBudget?.systemMessageTokens ?? 0;
    const conversationTokens = this.calculateConversationTokens();
    const currentInputTokens = this.calculateInputTokens(this._currentInput);
    const totalUsed = systemTokens + conversationTokens + currentInputTokens;

    return totalUsed / availableForContent;
  }

  /**
   * Build CompactionContext for strategy.
   * Provides controlled access to context state.
   */
  private buildCompactionContext(): CompactionContext {
    const self = this;

    return {
      get budget(): ContextBudget {
        // Return cached budget or calculate fresh
        return self._cachedBudget ?? {
          maxTokens: self._maxContextTokens,
          responseReserve: self._config.responseReserve,
          systemMessageTokens: 0,
          toolsTokens: 0,
          conversationTokens: 0,
          currentInputTokens: 0,
          totalUsed: 0,
          available: self._maxContextTokens - self._config.responseReserve,
          utilizationPercent: 0,
          breakdown: {
            systemPrompt: 0,
            persistentInstructions: 0,
            pluginInstructions: 0,
            pluginContents: {},
            tools: 0,
            conversation: 0,
            currentInput: 0,
          },
        };
      },

      get conversation(): ReadonlyArray<InputItem> {
        return self._conversation;
      },

      get currentInput(): ReadonlyArray<InputItem> {
        return self._currentInput;
      },

      get plugins(): ReadonlyArray<IContextPluginNextGen> {
        return Array.from(self._plugins.values());
      },

      get strategyName(): string {
        return self._compactionStrategy.name;
      },

      async removeMessages(indices: number[]): Promise<number> {
        return self.removeMessagesByIndices(indices);
      },

      async compactPlugin(pluginName: string, targetTokens: number): Promise<number> {
        const plugin = self._plugins.get(pluginName);
        if (!plugin || !plugin.isCompactable()) {
          return 0;
        }
        return plugin.compact(targetTokens);
      },

      estimateTokens(item: InputItem): number {
        return self.estimateItemTokens(item);
      },

      describeToolCall(toolName: string, toolArgs: unknown): string | undefined {
        const reg = self._tools.getRegistration(toolName);
        if (!reg?.tool.describeCall) return undefined;
        try {
          return reg.tool.describeCall(toolArgs as Record<string, unknown>);
        } catch {
          return undefined;
        }
      },
    };
  }

  /**
   * Remove messages by indices.
   * Handles tool pair preservation internally.
   * Used by CompactionContext.removeMessages().
   */
  private removeMessagesByIndices(indices: number[]): number {
    if (indices.length === 0 || this._conversation.length === 0) {
      return 0;
    }

    // Calculate tokens being freed
    let tokensFreed = 0;
    const indicesToRemove = new Set(indices);

    for (const idx of indicesToRemove) {
      const item = this._conversation[idx];
      if (item) {
        tokensFreed += this.estimateItemTokens(item);
      }
    }

    // Build new conversation without removed messages
    this._conversation = this._conversation.filter((_, i) => !indicesToRemove.has(i));

    return tokensFreed;
  }

  /**
   * Sanitize tool pairs in the input array.
   * Removes orphan TOOL_USE (no matching TOOL_RESULT) and
   * orphan TOOL_RESULT (no matching TOOL_USE).
   *
   * This is CRITICAL - LLM APIs require matching pairs.
   */
  private sanitizeToolPairs(items: InputItem[]): InputItem[] {
    // Collect all TOOL_USE IDs and TOOL_RESULT tool_use_ids
    const toolUseIds = new Set<string>();
    const toolResultIds = new Set<string>();

    for (const item of items) {
      if (item.type !== 'message') continue;
      const msg = item as Message;
      for (const c of msg.content) {
        if (c.type === ContentType.TOOL_USE) {
          toolUseIds.add((c as any).id);
        } else if (c.type === ContentType.TOOL_RESULT) {
          toolResultIds.add((c as any).tool_use_id);
        }
      }
    }

    // Find orphans: TOOL_USE without TOOL_RESULT, TOOL_RESULT without TOOL_USE
    const orphanToolUseIds = new Set<string>();
    const orphanToolResultIds = new Set<string>();

    for (const id of toolUseIds) {
      if (!toolResultIds.has(id)) {
        orphanToolUseIds.add(id);
      }
    }

    for (const id of toolResultIds) {
      if (!toolUseIds.has(id)) {
        orphanToolResultIds.add(id);
      }
    }

    // If no orphans, return as-is
    if (orphanToolUseIds.size === 0 && orphanToolResultIds.size === 0) {
      return items;
    }

    // Remove orphan content from messages
    const result: InputItem[] = [];

    for (const item of items) {
      if (item.type !== 'message') {
        result.push(item);
        continue;
      }

      const msg = item as Message;
      const filteredContent: Content[] = [];

      for (const c of msg.content) {
        if (c.type === ContentType.TOOL_USE) {
          const id = (c as any).id;
          if (!orphanToolUseIds.has(id)) {
            filteredContent.push(c);
          }
        } else if (c.type === ContentType.TOOL_RESULT) {
          const id = (c as any).tool_use_id;
          if (!orphanToolResultIds.has(id)) {
            filteredContent.push(c);
          }
        } else {
          filteredContent.push(c);
        }
      }

      // Only include message if it has content left
      if (filteredContent.length > 0) {
        result.push({
          ...msg,
          content: filteredContent,
        } as Message);
      }
    }

    return result;
  }

  // ============================================================================
  // Oversized Input Handling
  // ============================================================================

  /**
   * Handle oversized current input.
   */
  private async handleOversizedInput(maxTokens: number): Promise<OversizedInputResult> {
    if (this._currentInput.length === 0) {
      return { accepted: true, content: '', originalSize: 0, finalSize: 0 };
    }

    const input = this._currentInput[0];
    if (input?.type !== 'message') {
      return { accepted: false, content: '', error: 'Invalid input type', originalSize: 0, finalSize: 0 };
    }

    const msg = input as Message;

    // Check if this is user input or tool results
    const hasToolResult = msg.content.some(c => c.type === ContentType.TOOL_RESULT);

    if (!hasToolResult) {
      // User input - reject with clear error
      const originalSize = this.estimateItemTokens(input);
      return {
        accepted: false,
        content: '',
        error: `User input is too large (${originalSize} tokens) for available context (${maxTokens} tokens). Please provide shorter input.`,
        originalSize,
        finalSize: 0,
      };
    }

    // Tool results - attempt truncation
    return this.emergencyToolResultsTruncation(msg, maxTokens);
  }

  /**
   * Emergency truncation of tool results to fit in context.
   */
  private emergencyToolResultsTruncation(msg: Message, maxTokens: number): OversizedInputResult {
    const originalSize = this.estimateItemTokens(msg);
    const truncatedContent: Content[] = [];

    // Calculate max chars we can keep (rough: tokens * 3.5)
    const maxChars = Math.floor(maxTokens * 3.5);
    let totalCharsUsed = 0;

    for (const c of msg.content) {
      if (c.type === ContentType.TOOL_RESULT) {
        const toolResult = c as any;
        const content = toolResult.content || '';
        const images = toolResult.__images as Array<{ base64: string; mediaType: string }> | undefined;

        // Check if content is binary (base64, etc.)
        // Skip this check if images are already extracted via __images convention
        if (!images?.length && this.isBinaryContent(content)) {
          // Reject binary content
          truncatedContent.push({
            type: ContentType.TOOL_RESULT,
            tool_use_id: toolResult.tool_use_id,
            content: '[Binary content too large - rejected. Please try a different approach or request smaller output.]',
            error: 'Binary content too large',
          });
          totalCharsUsed += 100;
        } else {
          // Truncate text/JSON content (images are stored separately and don't count as chars)
          const availableChars = maxChars - totalCharsUsed - 200; // Reserve for warning
          if (content.length > availableChars && availableChars > 0) {
            const truncated = content.slice(0, availableChars);
            truncatedContent.push({
              type: ContentType.TOOL_RESULT,
              tool_use_id: toolResult.tool_use_id,
              content: `${truncated}\n\n[TRUNCATED: Original output was ${Math.round(content.length / 1024)}KB. Only first ${Math.round(availableChars / 1024)}KB shown. Consider using more targeted queries.]`,
              // Preserve images even when text is truncated — they're handled natively by providers
              ...(images ? { __images: images } : {}),
            });
            totalCharsUsed += truncated.length + 150;
          } else if (availableChars > 0) {
            truncatedContent.push(c);
            totalCharsUsed += content.length;
          } else {
            // No space left for text, but still preserve images if present
            truncatedContent.push({
              type: ContentType.TOOL_RESULT,
              tool_use_id: toolResult.tool_use_id,
              content: '[Output too large - skipped due to context limits. Try a more targeted query.]',
              error: 'Output too large',
              // Preserve images even when text is dropped
              ...(images ? { __images: images } : {}),
            });
            totalCharsUsed += 100;
          }
        }
      } else {
        truncatedContent.push(c);
      }
    }

    // Update message with truncated content
    msg.content = truncatedContent;
    const finalSize = this.estimateItemTokens(msg);

    // Emergency guardrail fired — surface in logs too (not just via the
    // returned `warning` field, which only hosts that wire the
    // `input:oversized` event or read the return value will see).
    logger.warn(
      {
        component: 'AgentContextNextGen',
        originalTokens: originalSize,
        finalTokens: finalSize,
        maxTokens,
        droppedTokens: originalSize - finalSize,
      },
      'emergency tool-result truncation: tool output exceeded the model context window and was clipped. Consider narrower tool queries or a larger-context model.',
    );

    return {
      accepted: true,
      content: JSON.stringify(truncatedContent),
      warning: `Tool results truncated from ${originalSize} to ${finalSize} tokens to fit in context.`,
      originalSize,
      finalSize,
    };
  }

  /**
   * Check if content appears to be binary (base64, etc.)
   */
  private isBinaryContent(content: string): boolean {
    if (!content || content.length < 100) return false;

    // Check for base64 patterns
    const base64Ratio = (content.match(/[A-Za-z0-9+/=]/g)?.length ?? 0) / content.length;
    if (base64Ratio > 0.95 && content.length > 1000) {
      return true;
    }

    // Check for binary-looking patterns
    if (/^[A-Za-z0-9+/]{50,}={0,2}$/.test(content.slice(0, 100))) {
      return true;
    }

    return false;
  }

  // ============================================================================
  // Session Persistence
  // ============================================================================

  /**
   * Save context state to storage.
   *
   * @param sessionId - Optional session ID (uses current or generates new)
   * @param metadata - Optional additional metadata to merge
   * @param stateOverride - Optional state override (for agent-level state injection)
   */
  async save(
    sessionId?: string,
    metadata?: Record<string, unknown>,
    stateOverride?: SerializedContextState
  ): Promise<void> {
    this.assertNotDestroyed();

    if (!this._storage) {
      throw new Error('No storage configured');
    }

    const targetSessionId = sessionId ?? this._sessionId ?? this.generateId();

    // Flush history buffer on first save (entries buffered before sessionId was set)
    const journal = this._storage.journal;
    if (this._historyBuffer.length > 0 && journal) {
      try {
        await journal.append(targetSessionId, this._historyBuffer);
      } catch (err) {
        logger.warn({ err: (err as Error).message }, 'History journal buffer flush failed');
      }
      this._historyBuffer = [];
    }

    // Use provided state override or build from current state
    const state: SerializedContextState = stateOverride ?? this.getState();

    // Merge additional metadata if provided
    if (metadata) {
      state.metadata = { ...state.metadata, ...metadata };
    }

    await this._storage.save(targetSessionId, state);
    this._sessionId = targetSessionId;
  }

  /**
   * Load context state from storage.
   */
  async load(sessionId: string): Promise<boolean> {
    this.assertNotDestroyed();

    if (!this._storage) {
      throw new Error('No storage configured');
    }

    const stored = await this._storage.load(sessionId);
    if (!stored) {
      return false;
    }

    // Extract state from StoredContextSession wrapper
    const state = stored.state;

    // Restore conversation
    this._conversation = state.conversation;
    this._systemPrompt = state.systemPrompt;

    // Restore plugin states
    for (const [name, pluginState] of Object.entries(state.pluginStates)) {
      const plugin = this._plugins.get(name);
      if (plugin) {
        plugin.restoreState(pluginState);
      }
    }

    this._sessionId = sessionId;

    // Restore turn index from journal (if available) so new entries continue the sequence
    const journal = this._storage.journal;
    if (journal) {
      try {
        const count = await journal.count(sessionId);
        if (count > 0) {
          // Read the last entry to get the highest turnIndex
          const lastEntries = await journal.read(sessionId, { offset: count - 1, limit: 1 });
          const lastEntry = lastEntries[0];
          if (lastEntry) {
            this._turnIndex = lastEntry.turnIndex + 1;
          }
        }
      } catch {
        // Non-critical — turnIndex will start from 0 if journal is unavailable
      }
    }

    // Clear any stale buffer (we're loading a saved session, not continuing a new one)
    this._historyBuffer = [];

    return true;
  }

  /**
   * Load raw state from storage without restoring.
   * Used by BaseAgent for custom state restoration.
   */
  async loadRaw(sessionId: string): Promise<{ state: SerializedContextState; stored: StoredContextSession } | null> {
    this.assertNotDestroyed();

    if (!this._storage) {
      throw new Error('No storage configured');
    }

    const stored = await this._storage.load(sessionId);
    if (!stored) {
      return null;
    }

    this._sessionId = sessionId;
    return { state: stored.state, stored };
  }

  /**
   * Check if session exists in storage.
   */
  async sessionExists(sessionId: string): Promise<boolean> {
    if (!this._storage) {
      return false;
    }
    return this._storage.exists(sessionId);
  }

  /**
   * Delete a session from storage.
   */
  async deleteSession(sessionId?: string): Promise<void> {
    if (!this._storage) {
      throw new Error('No storage configured');
    }

    const targetSessionId = sessionId ?? this._sessionId;
    if (!targetSessionId) {
      throw new Error('No session ID provided or loaded');
    }

    await this._storage.delete(targetSessionId);

    // Clear session ID if deleting current session
    if (targetSessionId === this._sessionId) {
      this._sessionId = null;
    }
  }

  /**
   * Get serialized state for persistence.
   * Used by BaseAgent to inject agent-level state.
   */
  getState(): SerializedContextState {
    this.assertNotDestroyed();

    const pluginStates: Record<string, unknown> = {};
    for (const [name, plugin] of this._plugins) {
      pluginStates[name] = plugin.getState();
    }

    return {
      conversation: this._conversation,
      pluginStates,
      systemPrompt: this._systemPrompt,
      metadata: {
        savedAt: Date.now(),
        agentId: this._agentId,
        userId: this._userId,
        model: this._config.model,
      },
    };
  }

  /**
   * Restore state from serialized form.
   * Used by BaseAgent for custom state restoration.
   */
  restoreState(state: SerializedContextState): void {
    this.assertNotDestroyed();

    this._conversation = state.conversation ?? [];
    this._systemPrompt = state.systemPrompt;

    // Restore plugin states (guard against null/undefined)
    if (state.pluginStates) {
      for (const [name, pluginState] of Object.entries(state.pluginStates)) {
        const plugin = this._plugins.get(name);
        if (plugin) {
          plugin.restoreState(pluginState);
        }
      }
    }
  }

  // ============================================================================
  // Inspection / Monitoring
  // ============================================================================

  /**
   * Get the current token budget.
   *
   * Returns the cached budget from the last prepare() call if available.
   * If prepare() hasn't been called yet, calculates a fresh budget.
   *
   * For monitoring purposes, prefer using the `lastBudget` getter or
   * subscribing to the `budget:updated` event for reactive updates.
   *
   * @returns Current token budget breakdown
   */
  async calculateBudget(): Promise<ContextBudget> {
    this.assertNotDestroyed();

    // Return cached budget if available (from last prepare() call)
    if (this._cachedBudget) {
      return this._cachedBudget;
    }

    // No cached budget yet - calculate fresh (this happens before first prepare() call)
    const toolsTokens = this.calculateToolsTokens();
    const { systemTokens, breakdown } = await this.buildSystemMessage();
    const conversationTokens = this.calculateConversationTokens();
    const currentInputTokens = this.calculateInputTokens(this._currentInput);
    const totalUsed = systemTokens + conversationTokens + currentInputTokens + toolsTokens;
    const availableForContent = this._maxContextTokens - this._config.responseReserve;

    return {
      maxTokens: this._maxContextTokens,
      responseReserve: this._config.responseReserve,
      systemMessageTokens: systemTokens,
      toolsTokens,
      conversationTokens,
      currentInputTokens,
      totalUsed,
      available: availableForContent - totalUsed,
      utilizationPercent: (totalUsed / availableForContent) * 100,
      breakdown: {
        ...breakdown,
        tools: toolsTokens,
        conversation: conversationTokens,
        currentInput: currentInputTokens,
      },
    };
  }

  /**
   * Get the current strategy threshold (percentage at which compaction triggers).
   */
  get strategyThreshold(): number {
    return this._compactionStrategy.threshold;
  }

  /**
   * Get the current strategy name.
   */
  get strategy(): string {
    return this._compactionStrategy.name;
  }

  /**
   * Get a complete, serializable snapshot of the context state.
   *
   * Returns all data needed by UI "Look Inside" panels without reaching
   * into plugin internals. Plugin data is auto-discovered from the plugin
   * registry — new/custom plugins appear automatically.
   *
   * @param toolStats - Optional tool usage stats (from ToolManager.getStats())
   * @returns Serializable context snapshot
   */
  async getSnapshot(toolStats?: { mostUsed?: Array<{ name: string; count: number }> }): Promise<IContextSnapshot> {
    // Helper to ensure plugin contents are JSON-serializable (Maps → arrays, await Promises)
    const resolveContents = async (raw: unknown): Promise<unknown> => {
      // Await if getContents() returned a Promise (e.g., WorkingMemory)
      const resolved = raw instanceof Promise ? await raw : raw;
      // Convert Maps to arrays for JSON transport (Meteor DDP, etc.)
      if (resolved instanceof Map) return Array.from(resolved.values());
      return resolved;
    };
    if (this._destroyed) {
      const emptyBudget: ContextBudget = this._cachedBudget ?? {
        maxTokens: this._maxContextTokens,
        responseReserve: this._config.responseReserve,
        systemMessageTokens: 0,
        toolsTokens: 0,
        conversationTokens: 0,
        currentInputTokens: 0,
        totalUsed: 0,
        available: this._maxContextTokens - this._config.responseReserve,
        utilizationPercent: 0,
        breakdown: {
          systemPrompt: 0,
          persistentInstructions: 0,
          pluginInstructions: 0,
          pluginContents: {},
          tools: 0,
          conversation: 0,
          currentInput: 0,
        },
      };
      return {
        available: false,
        agentId: this._agentId,
        model: this._config.model,
        features: this._config.features,
        budget: emptyBudget,
        strategy: this._compactionStrategy.name,
        messagesCount: 0,
        toolCallsCount: 0,
        systemPrompt: null,
        plugins: [],
        tools: [],
      };
    }

    const budget = await this.calculateBudget();

    // Build plugin snapshots from registry (auto-discovery)
    const plugins: IPluginSnapshot[] = [];
    for (const plugin of this._plugins.values()) {
      let formattedContent: string | null = null;
      try {
        formattedContent = await plugin.getContent();
      } catch {
        // Plugin content may fail — don't break snapshot
      }

      plugins.push({
        name: plugin.name,
        displayName: formatPluginDisplayName(plugin.name),
        enabled: true,
        tokenSize: plugin.getTokenSize(),
        instructionsTokenSize: plugin.getInstructionsTokenSize(),
        compactable: plugin.isCompactable(),
        contents: await resolveContents(plugin.getContents()),
        formattedContent,
      });
    }

    // Build tool snapshots
    const usageCounts = new Map<string, number>();
    if (toolStats?.mostUsed) {
      for (const { name, count } of toolStats.mostUsed) {
        usageCounts.set(name, count);
      }
    }

    const tools: IToolSnapshot[] = [];
    for (const toolName of this._tools.list()) {
      const reg = this._tools.getRegistration(toolName);
      if (!reg) continue;

      tools.push({
        name: toolName,
        description: reg.tool.definition.function.description || '',
        enabled: reg.enabled,
        callCount: reg.metadata.usageCount ?? usageCounts.get(toolName) ?? 0,
        namespace: reg.namespace || undefined,
      });
    }

    // Count tool calls in conversation
    let toolCallsCount = 0;
    for (const item of this._conversation) {
      if (item.type === 'message' && item.role === MessageRole.ASSISTANT) {
        for (const c of item.content) {
          if (c.type === ContentType.TOOL_USE) toolCallsCount++;
        }
      }
    }

    return {
      available: true,
      agentId: this._agentId,
      model: this._config.model,
      features: this._config.features,
      budget,
      strategy: this._compactionStrategy.name,
      messagesCount: this._conversation.length,
      toolCallsCount,
      systemPrompt: this._systemPrompt ?? null,
      plugins,
      tools,
    };
  }

  /**
   * Get a human-readable breakdown of the prepared context.
   *
   * Calls `prepare()` internally, then maps each InputItem to a named
   * component with content text and token estimate. Used by "View Full Context" UIs.
   *
   * @returns View context data with components and raw text for "Copy All"
   */
  async getViewContext(): Promise<IViewContextData> {
    if (this._destroyed) {
      return { available: false, components: [], totalTokens: 0, rawContext: '' };
    }

    const { input, budget } = await this.prepare();

    const components: IViewContextComponent[] = [];
    let rawParts: string[] = [];

    for (const item of input) {
      if (item.type === 'compaction') {
        components.push({
          name: 'Compaction Block',
          content: '[Compacted content]',
          tokenEstimate: 0,
        });
        continue;
      }

      if (item.type !== 'message') {
        components.push({
          name: `Provider Input: ${item.type}`,
          content: JSON.stringify(item),
          tokenEstimate: 0,
        });
        continue;
      }

      // item.type === 'message'
      const msg = item;
      const roleName = msg.role === MessageRole.DEVELOPER
        ? 'System Message'
        : msg.role === MessageRole.USER
          ? 'User Message'
          : 'Assistant Message';

      // Process each content block
      for (const block of msg.content) {
        let name = roleName;
        let text = '';

        switch (block.type) {
          case ContentType.INPUT_TEXT:
            text = block.text;
            break;
          case ContentType.OUTPUT_TEXT:
            text = block.text;
            break;
          case ContentType.TOOL_USE:
            name = `Tool Call: ${block.name}`;
            text = `${block.name}(${block.arguments})`;
            break;
          case ContentType.TOOL_RESULT:
            name = `Tool Result: ${block.tool_use_id}`;
            text = typeof block.content === 'string'
              ? block.content
              : JSON.stringify(block.content, null, 2);
            if (block.error) text = `[Error] ${block.error}\n${text}`;
            break;
          case ContentType.INPUT_IMAGE_URL:
            name = 'Image Input';
            text = `[Image: ${block.image_url.url.substring(0, 100)}...]`;
            break;
          case ContentType.INPUT_FILE:
            name = 'File Input';
            text = `[File: ${block.file_id}]`;
            break;
          case ContentType.THINKING:
            name = 'Thinking';
            text = (block as any).thinking || '';
            break;
        }

        const tokenEstimate = this._estimator.estimateTokens(text);
        components.push({ name, content: text, tokenEstimate });
        rawParts.push(`--- ${name} ---\n${text}`);
      }
    }

    return {
      available: true,
      components,
      totalTokens: budget.totalUsed,
      rawContext: rawParts.join('\n\n'),
    };
  }

  // ============================================================================
  // Utilities
  // ============================================================================

  /**
   * Generate unique ID.
   */
  /**
   * Append items to the history journal.
   *
   * If a sessionId is established and storage supports journaling,
   * appends directly (fire-and-forget, non-blocking).
   * Otherwise, buffers entries until the first save().
   *
   * No extra memory cost for the buffer — items are already in _conversation.
   */
  private buildHistoryEntries(type: HistoryEntryType, items: InputItem[]): HistoryEntry[] {
    // Apply journal filter — skip entry types not in the allowlist
    if (this._journalFilter && !this._journalFilter.includes(type)) {
      return [];
    }

    return items.map(item => ({
      timestamp: Date.now(),
      type,
      item,
      turnIndex: this._turnIndex,
    }));
  }

  private _journalAppend(type: HistoryEntryType, items: InputItem[]): void {
    const journal = this._storage?.journal;
    if (!journal && !this._storage) {
      // No storage at all — skip entirely (no buffering for throwaway conversations)
      return;
    }

    const entries = this.buildHistoryEntries(type, items);
    if (entries.length === 0) return;

    if (this._sessionId && journal) {
      // Session established and journal available — append directly
      const sessionId = this._sessionId;
      this.enqueueJournalWrite(() => journal.append(sessionId, entries));
    } else {
      // No session yet, or storage doesn't support journal — buffer
      // Buffer will be flushed on first save() if journal is available
      this._historyBuffer.push(...entries);
    }
  }

  private _journalReplaceLast(type: HistoryEntryType, item: InputItem): void {
    const journal = this._storage?.journal;
    if (!journal && !this._storage) {
      return;
    }

    const [entry] = this.buildHistoryEntries(type, [item]);
    if (!entry) return;

    const sessionId = this._sessionId;
    const turnIndex = this._turnIndex;
    if (sessionId && journal?.replaceLast) {
      this.enqueueJournalWrite(async () => {
        const replaced = await journal.replaceLast!(sessionId, type, turnIndex, entry);
        if (!replaced) {
          await journal.append(sessionId, [entry]);
        }
      });
      return;
    }

    if (sessionId && journal) {
      this.enqueueJournalWrite(() => journal.append(sessionId, [entry]));
      return;
    }

    for (let i = this._historyBuffer.length - 1; i >= 0; i--) {
      const current = this._historyBuffer[i];
      if (current?.type === type && current.turnIndex === this._turnIndex) {
        this._historyBuffer[i] = entry;
        return;
      }
    }
    this._historyBuffer.push(entry);
  }

  private enqueueJournalWrite(work: () => Promise<void>): void {
    this._journalWriteQueue = this._journalWriteQueue
      .then(work)
      .catch(err => {
        logger.warn({ err: (err as Error).message }, 'History journal write failed');
      });
  }

  private generateId(): string {
    return `${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Assert context is not destroyed.
   */
  private assertNotDestroyed(): void {
    if (this._destroyed) {
      throw new Error('AgentContextNextGen is destroyed');
    }
  }

  // ============================================================================
  // Cleanup
  // ============================================================================

  /**
   * Destroy context and release resources.
   */
  destroy(): void {
    if (this._destroyed) return;

    // Destroy plugins (skip shared ones that are owned by another context)
    for (const [name, plugin] of this._plugins) {
      if (!this._skipDestroyPlugins.has(name)) {
        plugin.destroy();
      }
    }
    this._plugins.clear();
    this._contextToolNames.clear();
    this._skipDestroyPlugins.clear();

    // Destroy store tools manager
    this._storeToolsManager.destroy();

    // Destroy tool manager
    this._tools.destroy();

    // Clear state
    this._conversation = [];
    this._currentInput = [];
    this._beforeCompactionCallback = null;

    this.removeAllListeners();
    this._destroyed = true;
  }
}
