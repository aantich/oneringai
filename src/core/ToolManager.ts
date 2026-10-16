import { ToolEvidenceMiddleware } from './evidence/ToolEvidenceMiddleware.js';
import type { ToolEvidenceDelivery } from './evidence/ToolEvidenceMiddleware.js';
import { containAsyncRejection } from './evidence/validation.js';
/**
 * ToolManager - Unified tool management and execution for agents
 *
 * Provides tool management capabilities:
 * - Enable/disable tools at runtime without removing them
 * - Namespace grouping for organizing related tools
 * - Priority-based selection
 * - Context-aware tool selection
 * - Usage statistics
 * - Circuit breaker protection for tool execution
 * - Implements IToolExecutor for use with Agent
 * - Implements IDisposable for proper lifecycle management
 *
 * This is a SIMPLE tool executor. It does NOT:
 * - Cache results (no idempotency cache)
 * - Access parent context (clean separation of concerns)
 *
 * Context (memory, agentId, etc.) is provided via setToolContext() before execution.
 */

import { EventEmitter } from 'eventemitter3';
import type { Tool, ToolFunction, ToolPermissionConfig } from '../domain/entities/Tool.js';
import type { IToolExecutor } from '../domain/interfaces/IToolExecutor.js';
import type { IDisposable } from '../domain/interfaces/IDisposable.js';
import type { ToolContext } from '../domain/interfaces/IToolContext.js';
import { CircuitBreaker } from '../infrastructure/resilience/CircuitBreaker.js';
import type { CircuitState, CircuitBreakerConfig } from '../infrastructure/resilience/CircuitBreaker.js';
import { ToolNotFoundError, ToolExecutionError, ToolTimeoutError } from '../domain/errors/AIErrors.js';
import { logger, FrameworkLogger } from '../infrastructure/observability/Logger.js';
import { metrics } from '../infrastructure/observability/Metrics.js';
import { ToolExecutionPipeline } from './tool-execution/ToolExecutionPipeline.js';
import { ResultNormalizerPlugin } from './tool-execution/plugins/ResultNormalizerPlugin.js';
import type { IToolExecutionPipeline } from './tool-execution/types.js';
import type { PipelineOutcome, ToolExecutionOptions, ToolExecutionOutcome, ToolExecutionReport } from './tool-execution/outcomes.js';
import { createExecutionSignal, withAbort } from './tool-execution/cancellation.js';
import { randomUUID } from 'node:crypto';
import { captureConnectorScope } from './tool-execution/connectorScope.js';
import type { PermissionPolicyManager } from './permissions/PermissionPolicyManager.js';
import { PermissionEnforcementPlugin } from './permissions/PermissionEnforcementPlugin.js';

// Re-export CircuitState for convenience
export type { CircuitState, CircuitBreakerConfig } from '../infrastructure/resilience/CircuitBreaker.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Source identifier for a registered tool
 */
export type ToolSource = 'built-in' | 'connector' | 'custom' | 'mcp' | string;

/**
 * Options for searching tools
 */
export interface ToolSearchOptions {
  /** Filter by tags (any match) */
  tags?: string[];
  /** Filter by category */
  category?: string;
  /** Only return enabled tools. Default: true */
  enabledOnly?: boolean;
  /** Filter by source */
  source?: ToolSource;
  /** Filter by namespace */
  namespace?: string;
  /** Maximum number of results */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
}

/**
 * Result from a tool search
 */
export interface ToolSearchResult {
  /** The tool function */
  tool: ToolFunction;
  /** Tool name */
  name: string;
  /** Tool description */
  description: string;
  /** Relevance score (higher = more relevant) */
  relevanceScore: number;
  /** Tags */
  tags?: string[];
  /** Category */
  category?: string;
  /** Source */
  source?: ToolSource;
  /** Namespace */
  namespace: string;
}

export interface ToolOptions {
  /** Whether the tool is enabled. Default: true */
  enabled?: boolean;
  /** Namespace for grouping related tools. Default: 'default' */
  namespace?: string;
  /** Priority for selection ordering. Higher = preferred. Default: 0 */
  priority?: number;
  /** Conditions for auto-enable/disable */
  conditions?: ToolCondition[];
  /** Permission configuration override. If not set, uses tool's config or defaults. */
  permission?: ToolPermissionConfig;
  /** Tags for categorization and search */
  tags?: string[];
  /** Category grouping */
  category?: string;
  /** Source identifier (built-in, connector, custom, mcp, etc.) */
  source?: ToolSource;
}

export interface ToolCondition {
  type: 'mode' | 'context' | 'custom';
  predicate: (context: ToolSelectionContext) => boolean;
}

export interface ToolSelectionContext {
  /** Current user input or task description */
  input?: string;
  /** Current agent mode (for UniversalAgent) */
  mode?: string;
  /** Current task name (for TaskAgent) */
  currentTask?: string;
  /** Recently used tools (to avoid repetition) */
  recentTools?: string[];
  /** Token budget for tool definitions */
  tokenBudget?: number;
  /** Custom context data */
  custom?: Record<string, unknown>;
}

export interface ToolRegistration {
  tool: ToolFunction;
  enabled: boolean;
  namespace: string;
  priority: number;
  conditions: ToolCondition[];
  metadata: ToolMetadata;
  /** Effective permission config (merged from tool.permission and options.permission) */
  permission?: ToolPermissionConfig;
  /** Circuit breaker configuration for this tool (uses shared CircuitBreakerConfig from resilience) */
  circuitBreakerConfig?: Partial<CircuitBreakerConfig>;
  /** Tags for categorization and search */
  tags?: string[];
  /** Category grouping */
  category?: string;
  /** Source identifier (built-in, connector, custom, mcp, etc.) */
  source?: ToolSource;
}

export interface ToolMetadata {
  registeredAt: Date;
  usageCount: number;
  lastUsed?: Date;
  totalExecutionMs: number;
  avgExecutionMs: number;
  successCount: number;
  failureCount: number;
}

export interface ToolManagerStats {
  totalTools: number;
  enabledTools: number;
  disabledTools: number;
  namespaces: string[];
  toolsByNamespace: Record<string, number>;
  mostUsed: Array<{ name: string; count: number }>;
  totalExecutions: number;
}

export interface SerializedToolState {
  enabled: Record<string, boolean>;
  namespaces: Record<string, string>;
  priorities: Record<string, number>;
  /** Permission configs by tool name */
  permissions?: Record<string, ToolPermissionConfig>;
  /** Tags by tool name */
  tags?: Record<string, string[]>;
  /** Categories by tool name */
  categories?: Record<string, string>;
  /** Sources by tool name */
  sources?: Record<string, ToolSource>;
}

export type ToolManagerEvent =
  | 'tool:registered'
  | 'tool:unregistered'
  | 'tool:enabled'
  | 'tool:disabled'
  | 'tool:executed'
  | 'tool:outcome'
  | 'tool:late-complete'
  | 'namespace:enabled'
  | 'namespace:disabled';

// ============================================================================
// ToolManager Class
// ============================================================================

/**
 * Compact descriptor for a registered tool — name + description (no schemas).
 *
 * Returned by ToolManager.listCompact(). Used by routine builders to discover
 * which tools are available without paying the token cost of full parameter
 * schemas. The LLM commits selected names into RoutineDefinition.requiredTools;
 * the routine executor then resolves those names against the source agent.
 */
export interface CompactToolDescriptor {
  name: string;
  description: string;
  category?: string;
  /** Connector instance name when the tool is connector-bound (e.g. 'msft-personal'). */
  connectorName?: string;
}

/**
 * Configuration for ToolManager
 */
export interface ToolManagerConfig {
  /**
   * Hard timeout in milliseconds for any single tool execution.
   * Acts as a safety net: if a tool's own timeout mechanism fails
   * (e.g. child process doesn't exit), this will force-resolve with an error.
   * Default: 0 (disabled - relies on tool's own timeout)
   */
  toolExecutionTimeout?: number;
}

export class ToolManager extends EventEmitter implements IToolExecutor, IDisposable {
  private registry: Map<string, ToolRegistration> = new Map();
  private namespaceIndex: Map<string, Set<string>> = new Map();
  private circuitBreakers: Map<string, CircuitBreaker> = new Map();
  private toolLogger: FrameworkLogger;
  private _isDestroyed = false;
  private pipeline: ToolExecutionPipeline;
  private activeExecutions = new Set<AbortController>();

  /** Optional tool context for execution (set by agent before runs) */
  private _toolContext: ToolContext | undefined;

  /** Hard timeout for tool execution (0 = disabled) */
  private _toolExecutionTimeout: number;

  constructor(config?: ToolManagerConfig) {
    super();
    this._toolExecutionTimeout = config?.toolExecutionTimeout ?? 0;
    // Initialize default namespace
    this.namespaceIndex.set('default', new Set());
    this.toolLogger = logger.child({ component: 'ToolManager' });
    // Initialize execution pipeline for plugin support
    this.pipeline = new ToolExecutionPipeline();
    // Register built-in result normalizer to guarantee valid tool results
    // Runs LAST in afterExecute (priority 0) to catch undefined/null returns
    this.pipeline.use(new ResultNormalizerPlugin());
  }

  /**
   * Get or set the hard tool execution timeout in milliseconds.
   * 0 = disabled (relies on tool's own timeout).
   */
  get toolExecutionTimeout(): number {
    return this._toolExecutionTimeout;
  }

  set toolExecutionTimeout(value: number) {
    this._toolExecutionTimeout = Math.max(0, value);
  }

  /**
   * Access the execution pipeline for plugin management.
   *
   * Use this to register plugins that intercept and extend tool execution.
   *
   * @example
   * ```typescript
   * // Add logging plugin
   * toolManager.executionPipeline.use(new LoggingPlugin());
   *
   * // Add custom plugin
   * toolManager.executionPipeline.use({
   *   name: 'my-plugin',
   *   async afterExecute(ctx, result) {
   *     console.log(`${ctx.toolName} returned:`, result);
   *     return result;
   *   },
   * });
   * ```
   */
  get executionPipeline(): IToolExecutionPipeline {
    return this.pipeline;
  }

  /** @internal Undo a rejected Agent binding without cloning executable host objects. */
  _captureAgentBindingRollback(): () => void {
    const registrations = new Map([...this.registry].map(([name, value]) => [name, { ...value }]));
    const namespaces = new Map([...this.namespaceIndex].map(([name, values]) => [name, new Set(values)]));
    const permission = this.pipeline.get('permission-enforcement');
    const toolContext = this._toolContext;
    return () => {
      if (this._isDestroyed) return;
      this.registry = registrations;
      this.namespaceIndex = namespaces;
      for (const [name, breaker] of this.circuitBreakers) {
        if (!registrations.has(name)) { breaker.removeAllListeners(); this.circuitBreakers.delete(name); }
      }
      this._toolContext = toolContext;
      this.pipeline.remove('permission-enforcement');
      if (permission) this.pipeline.use(permission);
    };
  }

  /**
   * Returns true if destroy() has been called.
   */
  get isDestroyed(): boolean {
    return this._isDestroyed;
  }

  /**
   * Releases all resources held by this ToolManager.
   * Cleans up circuit breaker listeners and removes all event listeners.
   * Safe to call multiple times (idempotent).
   */
  destroy(): void {
    if (this._isDestroyed) {
      return;
    }

    this._isDestroyed = true;
    for (const controller of this.activeExecutions) controller.abort(new DOMException('Tool manager destroyed', 'AbortError'));
    this.activeExecutions.clear();

    // Clean up circuit breakers and their event listeners
    for (const breaker of this.circuitBreakers.values()) {
      breaker.removeAllListeners();
    }
    this.circuitBreakers.clear();

    // Clear registry and namespaces
    this.registry.clear();
    this.namespaceIndex.clear();

    // Remove all event listeners from this ToolManager
    this.removeAllListeners();
  }

  /**
   * Set tool context for execution (called by agent before runs).
   * WARNING: This REPLACES the entire context. Prefer mergeToolContext() for partial updates.
   */
  setToolContext(context: ToolContext | undefined): void {
    this._toolContext = context;
  }

  /**
   * Merge partial updates into the existing tool context.
   * Unlike setToolContext(), this preserves fields not present in the partial update.
   * Use this when updating userId or connectorAccounts without wiping agentId, identities, etc.
   */
  mergeToolContext(partial: Partial<ToolContext>): void {
    this._toolContext = { ...this._toolContext, ...partial };
  }

  /**
   * Get current tool context
   */
  getToolContext(): ToolContext | undefined {
    return this._toolContext;
  }

  /**
   * Set permission policy manager for tool execution enforcement.
   *
   * Registers a PermissionEnforcementPlugin on the execution pipeline at priority 1.
   * This gates ALL tool execution through the policy chain — no bypasses.
   */
  setPermissionManager(manager: PermissionPolicyManager): void {
    // Remove existing enforcement plugin if present
    this.pipeline.remove('permission-enforcement');

    // Register enforcement plugin with closures over ToolManager internals
    this.pipeline.use(new PermissionEnforcementPlugin(
      manager,
      () => this._toolContext,
      (name: string) => {
        const reg = this.registry.get(name);
        if (!reg) return undefined;
        return {
          source: reg.source,
          category: reg.category,
          namespace: reg.namespace,
          tags: reg.tags,
          permission: reg.permission,
        };
      },
    ));
  }

  /**
   * Get the permission policy manager (if enforcement is active).
   */
  getPermissionManager(): PermissionPolicyManager | undefined {
    const plugin = this.pipeline.get('permission-enforcement') as PermissionEnforcementPlugin | undefined;
    return plugin?.policyManager;
  }

  /**
   * Check if permission enforcement is active on the execution pipeline.
   */
  hasPermissionEnforcement(): boolean {
    return this.pipeline.has('permission-enforcement');
  }

  // ==========================================================================
  // Registration
  // ==========================================================================

  /**
   * Register a tool with optional configuration
   */
  register(tool: ToolFunction, options: ToolOptions = {}): void {
    const name = this.getToolName(tool);

    if (this.registry.has(name)) {
      // Update existing registration
      const existing = this.registry.get(name)!;
      existing.tool = tool;
      if (options.enabled !== undefined) existing.enabled = options.enabled;
      if (options.namespace !== undefined) {
        this.moveToNamespace(name, existing.namespace, options.namespace);
        existing.namespace = options.namespace;
      }
      if (options.priority !== undefined) existing.priority = options.priority;
      if (options.conditions !== undefined) existing.conditions = options.conditions;
      if (options.permission !== undefined) existing.permission = options.permission;
      if (options.tags !== undefined) existing.tags = options.tags;
      if (options.category !== undefined) existing.category = options.category;
      if (options.source !== undefined) existing.source = options.source;
      return;
    }

    const namespace = options.namespace ?? 'default';

    // Merge permission config: options.permission > tool.permission > undefined
    const effectivePermission = options.permission ?? tool.permission;

    const registration: ToolRegistration = {
      tool,
      enabled: options.enabled ?? true,
      namespace,
      priority: options.priority ?? 0,
      conditions: options.conditions ?? [],
      metadata: {
        registeredAt: new Date(),
        usageCount: 0,
        totalExecutionMs: 0,
        avgExecutionMs: 0,
        successCount: 0,
        failureCount: 0,
      },
      permission: effectivePermission,
      tags: options.tags,
      category: options.category,
      source: options.source,
    };

    this.registry.set(name, registration);
    this.addToNamespace(name, namespace);

    this.emit('tool:registered', { name, namespace, enabled: registration.enabled });
  }

  /**
   * Register multiple tools at once
   */
  registerMany(tools: ToolFunction[], options: Omit<ToolOptions, 'conditions'> = {}): void {
    for (const tool of tools) {
      this.register(tool, options);
    }
  }

  /**
   * Register tools produced by a specific connector.
   * Sets `source: 'connector:<connectorName>'` (or `'connector:<name>:<accountId>'` for identity-bound tools)
   * so agent-level filtering can restrict which connector tools are visible to a given agent.
   */
  registerConnectorTools(connectorName: string, tools: ToolFunction[], options: Omit<ToolOptions, 'source'> & { accountId?: string } = {}): void {
    const { accountId, ...toolOptions } = options;
    const source = accountId
      ? `connector:${connectorName}:${accountId}`
      : `connector:${connectorName}`;
    for (const tool of tools) {
      this.register(tool, { ...toolOptions, source });
    }
  }

  /**
   * Unregister a tool by name
   */
  unregister(name: string): boolean {
    const registration = this.registry.get(name);
    if (!registration) return false;

    this.removeFromNamespace(name, registration.namespace);
    this.registry.delete(name);

    // Clean up circuit breaker and its listeners
    const breaker = this.circuitBreakers.get(name);
    if (breaker) {
      breaker.removeAllListeners();
      this.circuitBreakers.delete(name);
    }

    this.emit('tool:unregistered', { name });
    return true;
  }

  /**
   * Clear all tools and their circuit breakers.
   * Does NOT remove event listeners from this ToolManager (use destroy() for full cleanup).
   */
  clear(): void {
    this.registry.clear();
    this.namespaceIndex.clear();
    this.namespaceIndex.set('default', new Set());

    // Clean up circuit breaker listeners before clearing
    for (const breaker of this.circuitBreakers.values()) {
      breaker.removeAllListeners();
    }
    this.circuitBreakers.clear();
  }

  // ==========================================================================
  // Enable/Disable
  // ==========================================================================

  /**
   * Enable a tool by name
   */
  enable(name: string): boolean {
    const registration = this.registry.get(name);
    if (!registration) return false;

    if (!registration.enabled) {
      registration.enabled = true;
      this.emit('tool:enabled', { name });
    }
    return true;
  }

  /**
   * Disable a tool by name (keeps it registered but inactive)
   */
  disable(name: string): boolean {
    const registration = this.registry.get(name);
    if (!registration) return false;

    if (registration.enabled) {
      registration.enabled = false;
      this.emit('tool:disabled', { name });
    }
    return true;
  }

  /**
   * Toggle a tool's enabled state
   */
  toggle(name: string): boolean {
    const registration = this.registry.get(name);
    if (!registration) return false;

    registration.enabled = !registration.enabled;
    this.emit(registration.enabled ? 'tool:enabled' : 'tool:disabled', { name });
    return registration.enabled;
  }

  /**
   * Check if a tool is enabled
   */
  isEnabled(name: string): boolean {
    const registration = this.registry.get(name);
    return registration?.enabled ?? false;
  }

  /**
   * Set enabled state for multiple tools
   */
  setEnabled(names: string[], enabled: boolean): void {
    for (const name of names) {
      if (enabled) {
        this.enable(name);
      } else {
        this.disable(name);
      }
    }
  }

  // ==========================================================================
  // Namespaces
  // ==========================================================================

  /**
   * Set the namespace for a tool
   */
  setNamespace(toolName: string, namespace: string): boolean {
    const registration = this.registry.get(toolName);
    if (!registration) return false;

    const oldNamespace = registration.namespace;
    if (oldNamespace === namespace) return true;

    this.moveToNamespace(toolName, oldNamespace, namespace);
    registration.namespace = namespace;
    return true;
  }

  /**
   * Enable all tools in a namespace
   */
  enableNamespace(namespace: string): void {
    const tools = this.namespaceIndex.get(namespace);
    if (!tools) return;

    for (const name of tools) {
      this.enable(name);
    }
    this.emit('namespace:enabled', { namespace });
  }

  /**
   * Disable all tools in a namespace
   */
  disableNamespace(namespace: string): void {
    const tools = this.namespaceIndex.get(namespace);
    if (!tools) return;

    for (const name of tools) {
      this.disable(name);
    }
    this.emit('namespace:disabled', { namespace });
  }

  /**
   * Get all namespace names
   */
  getNamespaces(): string[] {
    return Array.from(this.namespaceIndex.keys());
  }

  /**
   * Create a namespace with tools
   */
  createNamespace(namespace: string, tools: ToolFunction[], options: Omit<ToolOptions, 'namespace'> = {}): void {
    for (const tool of tools) {
      this.register(tool, { ...options, namespace });
    }
  }

  // ==========================================================================
  // Priority
  // ==========================================================================

  /**
   * Set priority for a tool
   */
  setPriority(name: string, priority: number): boolean {
    const registration = this.registry.get(name);
    if (!registration) return false;

    registration.priority = priority;
    return true;
  }

  /**
   * Get priority for a tool
   */
  getPriority(name: string): number | undefined {
    return this.registry.get(name)?.priority;
  }

  /**
   * Get permission config for a tool
   */
  getPermission(name: string): ToolPermissionConfig | undefined {
    return this.registry.get(name)?.permission;
  }

  /**
   * Set permission config for a tool
   */
  setPermission(name: string, permission: ToolPermissionConfig): boolean {
    const registration = this.registry.get(name);
    if (!registration) return false;

    registration.permission = permission;
    return true;
  }

  // ==========================================================================
  // Query
  // ==========================================================================

  /**
   * Get a tool by name
   */
  get(name: string): ToolFunction | undefined {
    return this.registry.get(name)?.tool;
  }

  /**
   * Check if a tool exists
   */
  has(name: string): boolean {
    return this.registry.has(name);
  }

  /**
   * Get all enabled tools (sorted by priority)
   */
  getEnabled(): ToolFunction[] {
    return this.getSortedByPriority()
      .filter((reg) => reg.enabled)
      .map((reg) => reg.tool);
  }

  /**
   * Get all enabled registrations (sorted by priority).
   * Includes full registration metadata (source, namespace, etc.)
   * for use in connector-aware filtering.
   */
  getEnabledRegistrations(): ToolRegistration[] {
    return this.getSortedByPriority().filter((reg) => reg.enabled);
  }

  /**
   * Get all tools (enabled and disabled)
   */
  getAll(): ToolFunction[] {
    return Array.from(this.registry.values()).map((reg) => reg.tool);
  }

  /**
   * Get tools by namespace
   */
  getByNamespace(namespace: string): ToolFunction[] {
    const toolNames = this.namespaceIndex.get(namespace);
    if (!toolNames) return [];

    return Array.from(toolNames)
      .map((name) => this.registry.get(name)!)
      .filter((reg) => reg.enabled)
      .sort((a, b) => b.priority - a.priority)
      .map((reg) => reg.tool);
  }

  /**
   * Get all registered tool names in a category.
   * Used by ToolCatalogPlugin for bulk enable/disable.
   */
  getByCategory(category: string): string[] {
    const names: string[] = [];
    for (const [name, reg] of this.registry) {
      if (reg.category === category) names.push(name);
    }
    return names;
  }

  /**
   * Get tool registration info
   */
  getRegistration(name: string): ToolRegistration | undefined {
    return this.registry.get(name);
  }

  /**
   * List all tool names
   */
  list(): string[] {
    return Array.from(this.registry.keys());
  }

  /**
   * List enabled tool names
   */
  listEnabled(): string[] {
    return Array.from(this.registry.entries())
      .filter(([_, reg]) => reg.enabled)
      .map(([name]) => name);
  }

  /**
   * Get count of registered tools
   */
  get size(): number {
    return this.registry.size;
  }

  /**
   * Slim catalog of currently enabled tools — name + description, no parameter schemas.
   *
   * Used by routine builders to discover what's available on a superagent without
   * paying the token cost of full tool definitions. Each entry includes:
   * - `name`: the LLM-facing tool name (already connector-prefixed for connector tools,
   *   e.g. `msft-personal_send_email`)
   * - `description`: the tool's `definition.function.description`
   * - `category`: optional grouping
   * - `connectorName`: present for connector-bound tools (read from
   *   `tool.connectorName`, falling back to parsing the registration `source` like
   *   `'connector:msft-personal'` or `'connector:msft-personal:account-id'`)
   *
   * Disabled tools are excluded — they're not actually callable by the LLM, so listing
   * them would mislead a routine builder.
   */
  listCompact(): CompactToolDescriptor[] {
    const result: CompactToolDescriptor[] = [];
    for (const [name, reg] of this.registry) {
      if (!reg.enabled) continue;
      const def = reg.tool.definition.function;

      let connectorName: string | undefined = reg.tool.connectorName;
      if (!connectorName && reg.source?.startsWith('connector:')) {
        const rest = reg.source.slice('connector:'.length);
        connectorName = rest.split(':')[0] || undefined;
      }

      result.push({
        name,
        description: def.description ?? '',
        ...(reg.category ? { category: reg.category } : {}),
        ...(connectorName ? { connectorName } : {}),
      });
    }
    return result;
  }


  // ==========================================================================
  // Selection
  // ==========================================================================

  /**
   * Select tools based on context (uses conditions and smart filtering)
   */
  selectForContext(context: ToolSelectionContext): ToolFunction[] {
    const sorted = this.getSortedByPriority();
    const selected: ToolFunction[] = [];

    for (const reg of sorted) {
      // Skip disabled tools
      if (!reg.enabled) continue;

      // Check conditions
      if (reg.conditions.length > 0) {
        const allConditionsMet = reg.conditions.every((cond) => cond.predicate(context));
        if (!allConditionsMet) continue;
      }

      // Skip recently used if avoiding repetition
      if (context.recentTools?.includes(this.getToolName(reg.tool))) {
        continue;
      }

      selected.push(reg.tool);
    }

    // Apply token budget if specified
    if (context.tokenBudget !== undefined) {
      return this.filterByTokenBudget(selected, context.tokenBudget);
    }

    return selected;
  }

  /**
   * Select tools by matching capability description
   */
  selectByCapability(description: string): ToolFunction[] {
    const lowerDesc = description.toLowerCase();
    const keywords = lowerDesc.split(/\s+/);

    return this.getEnabled().filter((tool) => {
      const toolDesc = (tool.definition.function.description ?? '').toLowerCase();
      const toolName = tool.definition.function.name.toLowerCase();

      // Match if any keyword appears in tool name or description
      return keywords.some((kw) => toolDesc.includes(kw) || toolName.includes(kw));
    });
  }

  /**
   * Filter tools to fit within a token budget
   */
  selectWithinBudget(budget: number): ToolFunction[] {
    return this.filterByTokenBudget(this.getEnabled(), budget);
  }

  // ==========================================================================
  // Execution Tracking
  // ==========================================================================

  /**
   * Record tool execution (called by agent/loop)
   */
  recordExecution(
    name: string,
    executionMs: number,
    success: boolean
  ): void {
    const registration = this.registry.get(name);
    if (!registration) return;

    this.recordRegisteredExecution(name, registration, executionMs, success);
  }

  private recordRegisteredExecution(name: string, registration: ToolRegistration, executionMs: number, success: boolean): void {

    const meta = registration.metadata;
    meta.usageCount++;
    meta.lastUsed = new Date();
    meta.totalExecutionMs += executionMs;
    meta.avgExecutionMs = meta.totalExecutionMs / meta.usageCount;

    if (success) {
      meta.successCount++;
    } else {
      meta.failureCount++;
    }

    try {
      this.emit('tool:executed', { name, executionMs, success, totalUsage: meta.usageCount });
    } catch (error) {
      this.toolLogger.warn({ error: String(error) }, 'Tool execution listener failed');
    }
  }

  /**
   * Summarize tool result for logging (handles various result types)
   */
  private summarizeResult(result: unknown): Record<string, unknown> {
    if (result === null || result === undefined) {
      return { type: 'null' };
    }

    if (typeof result !== 'object') {
      return { type: typeof result, value: String(result).slice(0, 100) };
    }

    const obj = result as Record<string, unknown>;

    // Handle common result patterns
    if ('success' in obj) {
      const summary: Record<string, unknown> = {
        success: obj.success,
      };
      if ('error' in obj) summary.error = obj.error;
      if ('count' in obj) summary.count = obj.count;
      if ('results' in obj && Array.isArray(obj.results)) {
        summary.resultCount = obj.results.length;
      }
      if ('provider' in obj) summary.provider = obj.provider;
      return summary;
    }

    // Handle array results
    if (Array.isArray(result)) {
      return { type: 'array', length: result.length };
    }

    // Generic object summary
    const keys = Object.keys(obj);
    return {
      type: 'object',
      keys: keys.slice(0, 10),
      keyCount: keys.length,
    };
  }

  // ==========================================================================
  // Statistics
  // ==========================================================================

  /**
   * Get comprehensive statistics
   */
  getStats(): ToolManagerStats {
    const registrations = Array.from(this.registry.values());
    const enabledCount = registrations.filter((r) => r.enabled).length;

    const toolsByNamespace: Record<string, number> = {};
    for (const [ns, tools] of this.namespaceIndex) {
      toolsByNamespace[ns] = tools.size;
    }

    const mostUsed = registrations
      .filter((r) => r.metadata.usageCount > 0)
      .sort((a, b) => b.metadata.usageCount - a.metadata.usageCount)
      .slice(0, 10)
      .map((r) => ({
        name: this.getToolName(r.tool),
        count: r.metadata.usageCount,
      }));

    const totalExecutions = registrations.reduce((sum, r) => sum + r.metadata.usageCount, 0);

    return {
      totalTools: this.registry.size,
      enabledTools: enabledCount,
      disabledTools: this.registry.size - enabledCount,
      namespaces: this.getNamespaces(),
      toolsByNamespace,
      mostUsed,
      totalExecutions,
    };
  }

  // ==========================================================================
  // Execution (IToolExecutor implementation)
  // ==========================================================================

  private evidenceMiddleware?: ToolEvidenceMiddleware;

  /** Opt-in post-settlement evidence handling. Does not replace the execution pipeline. */
  setEvidenceMiddleware(middleware?: ToolEvidenceMiddleware): void { this.evidenceMiddleware = middleware; }

  /**
   * Execute a tool function with circuit breaker protection and plugin pipeline.
   * Implements IToolExecutor interface.
   *
   * Execution flow:
   * 1. Validate tool exists and is enabled
   * 2. Check circuit breaker state
   * 3. Run through plugin pipeline (beforeExecute -> execute -> afterExecute)
   * 4. Update metrics and circuit breaker state
   *
   * Simple execution - no caching, no parent context.
   * Context must be set via setToolContext() before calling.
   */
  async execute(toolName: string, args: any, options?: ToolExecutionOptions): Promise<any> {
    return (await this.executeWithOutcome(toolName, args, options)).result;
  }

  /** Execute with semantic metadata while retaining the legacy raw result contract. */
  async executeWithOutcome(toolName: string, args: any, options: ToolExecutionOptions = {}): Promise<ToolExecutionReport<any>> {
    options = { ...options };
    const registered = this.registry.get(toolName);
    if (!registered) throw new ToolNotFoundError(toolName);
    if (!registered.enabled) throw new ToolExecutionError(toolName, 'Tool is disabled');
    if (this._isDestroyed) throw new ToolExecutionError(toolName, 'Tool manager is destroyed');

    // Keep cumulative counters on this registration; all authority and dispatch data are local.
    const selectedTool = registered.tool;
    const selectedExecute = selectedTool.execute;
    const evidenceMiddleware = ['evidence_read', 'evidence_list'].includes(toolName) ? undefined : this.evidenceMiddleware;
    const registration: ToolRegistration = {
      ...registered,
      tool: { ...selectedTool, ...(evidenceMiddleware && selectedTool.output ? { output: { ...selectedTool.output } } : {}), definition: structuredClone(selectedTool.definition) },
      tags: registered.tags ? [...registered.tags] : undefined,
      permission: registered.permission ? structuredClone(registered.permission) : undefined,
    };
    const captureArgs = (value: unknown): unknown => evidenceMiddleware ? evidenceMiddleware._captureArguments(value) : value;
    let evidenceArgs = captureArgs(args);
    const executionId = randomUUID();
    const startTime = Date.now();
    // Capture trusted identity before any await; later context changes apply only to new calls.
    const shared = this._toolContext;
    const connectorRegistry = shared?.connectorRegistry ? captureConnectorScope(shared.connectorRegistry) : undefined;
    const scope = createExecutionSignal([shared?.signal, options.signal]);
    const signal = scope.controller.signal;
    const context: ToolContext = {
      ...shared,
      connectorRegistry,
      connectorAccounts: shared?.connectorAccounts ? { ...shared.connectorAccounts } : undefined,
      identities: shared?.identities?.map((identity) => ({ ...identity })),
      roles: shared?.roles ? [...shared.roles] : undefined,
      signal,
    };
    this.activeExecutions.add(scope.controller);
    const callDeadline = options.timeoutMs ?? 0;
    const usesCallDeadline = callDeadline > 0 && (this._toolExecutionTimeout <= 0 || callDeadline <= this._toolExecutionTimeout);
    const timeout = usesCallDeadline ? callDeadline : this._toolExecutionTimeout;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    let executionStarted = false;
    let pipelineOutcome: PipelineOutcome | undefined;
    let abandoned = false;
    let settled = false;
    let settledResult: { value: unknown } | undefined;
    const outcome = (status: ToolExecutionOutcome['status'], error?: Error, late = false): ToolExecutionOutcome => Object.freeze({
      executionId, toolName, callId: options.callId, runId: options.runId,
      ...(timedOut ? { timeoutMs: timeout } : pipelineOutcome?.error instanceof ToolTimeoutError ? { timeoutMs: pipelineOutcome.error.timeoutMs } : {}),
      status, startedAt: startTime, durationMs: Date.now() - startTime, executionStarted,
      completion: executionStarted ? (late || settled ? 'settled' : 'unknown') : 'not_started',
      cancellation: signal.aborted
        ? (pipelineOutcome?.error && (pipelineOutcome.error === signal.reason || pipelineOutcome.error.name === 'AbortError') ? 'acknowledged' : 'requested')
        : 'none',
      error: error?.message,
    });
    const notify = (event: 'tool:outcome' | 'tool:late-complete', value: ToolExecutionOutcome): void => {
      // Diagnostics must never turn a successful external operation into a retryable failure.
      if (event === 'tool:outcome') {
        try { options.onOutcome?.(value); } catch (error) {
          this.toolLogger.warn({ error: String(error) }, 'Tool outcome observer failed');
        }
      }
      try { this.emit(event, value); } catch (error) {
        this.toolLogger.warn({ error: String(error), event }, 'Tool outcome listener failed');
      }
    };
    const persist = async (value: ToolExecutionOutcome, result?: { value: unknown }, late = false): Promise<{ outcome: ToolExecutionOutcome; evidence?: ToolEvidenceDelivery }> => {
      if (!evidenceMiddleware) return { outcome: value };
      let evidence: ToolEvidenceDelivery;
      try { evidence = await evidenceMiddleware.record(registration.tool, evidenceArgs, context, value, result, late); }
      catch { evidence = { status: 'storage_failed', effect: registration.tool.output?.effect ?? 'unknown', errorCode: 'storage' }; }
      const { projection: _projection, ...receipt } = evidence;
      // Evidence completion is distinct from execution settlement, including on cancellation.
      const enriched = Object.freeze({ ...value, evidence: Object.freeze(receipt) });
      if (!late) { try { containAsyncRejection(options.onEvidence?.(evidence)); } catch { /* Observers do not own effects. */ } }
      return { outcome: enriched, evidence };
    };
    metrics.increment('tool.executed', 1, { tool: toolName });
    if (timeout > 0 && !signal.aborted) {
      timer = setTimeout(() => {
        timedOut = true;
        scope.controller.abort(usesCallDeadline
          ? new ToolTimeoutError(toolName, timeout)
          : new ToolExecutionError(toolName, `Tool execution hard timeout after ${timeout}ms (safety net - tool's own timeout may have failed)`));
      }, timeout);
    }
    try {
      signal.throwIfAborted();
      if (registration.source?.startsWith('connector:')) {
        const connName = registration.tool.connectorName ?? registration.source.slice('connector:'.length);
        if (context.connectorRegistry && !context.connectorRegistry.has(connName)) {
          throw new ToolExecutionError(toolName,
            `Connector '${connName}' is not available to this agent. This is a configuration error — do NOT retry this tool.`);
        }
      }
      const breaker = this.getOrCreateCircuitBreaker(toolName, registration);
      // Breaker continues to observe legacy promise settlement, not semantic classification.
      const promise = breaker.execute(() => this.pipeline.execute({
        ...registration.tool,
        execute: async (pipelineArgs: any) => {
          signal.throwIfAborted();
          executionStarted = true;
          evidenceArgs = captureArgs(pipelineArgs);
          return selectedExecute.call(selectedTool, pipelineArgs, shared || options.signal || timeout > 0 ? context : undefined);
        },
      }, args, { executionId, toolContext: context, registration, onOutcome: (value) => { pipelineOutcome = value; } }));
      // Observe eventual settlement independently; it must not enter context or count twice.
      void promise.then(async (result) => {
        settled = true;
        if (evidenceMiddleware) settledResult = { value: result };
        if (abandoned) {
          const late = await persist(outcome(pipelineOutcome?.status ?? 'succeeded', pipelineOutcome?.error, true), { value: result }, true);
          if (!this._isDestroyed) notify('tool:late-complete', late.outcome);
        }
      }, async (error: unknown) => {
        settled = true;
        if (abandoned) {
          const late = await persist(outcome(pipelineOutcome?.status ?? 'failed', error instanceof Error ? error : new Error(String(error)), true), undefined, true);
          if (!this._isDestroyed) notify('tool:late-complete', late.outcome);
        }
      }).catch(() => undefined);
      const result = await withAbort(promise, signal);
      // An abort during settlement still belongs to this execution, never to the next run.
      signal.throwIfAborted();
      const value = outcome(pipelineOutcome?.status ?? 'succeeded', pipelineOutcome?.error);
      this.recordRegisteredExecution(toolName, registration, value.durationMs, value.status === 'succeeded');
      metrics.timing('tool.duration', value.durationMs, { tool: toolName });
      metrics.increment(value.status === 'succeeded' ? 'tool.success' : 'tool.failed', 1, { tool: toolName });
      this.toolLogger.debug({ toolName, outcome: value, resultSummary: this.summarizeResult(result) }, 'Tool execution completed');
      clearTimeout(timer);
      const report = evidenceMiddleware ? await persist(value, { value: result }) : { outcome: value };
      notify('tool:outcome', report.outcome);
      return { result, ...report };
    } catch (error) {
      abandoned = !settled;
      const err = error instanceof Error ? error : new Error(String(error));
      const value = outcome(timedOut ? 'timed_out' : signal.aborted ? 'cancelled' : pipelineOutcome?.status ?? 'failed', err);
      this.recordRegisteredExecution(toolName, registration, value.durationMs, false);
      metrics.increment('tool.failed', 1, { tool: toolName, error: err.name });
      const wrapped = new ToolExecutionError(toolName, err.message, err);
      clearTimeout(timer);
      const report = evidenceMiddleware ? await persist(value, settledResult) : { outcome: value };
      wrapped.outcome = report.outcome;
      notify('tool:outcome', report.outcome);
      throw wrapped;
    } finally {
      clearTimeout(timer);
      scope.dispose();
      this.activeExecutions.delete(scope.controller);
    }
  }

  /**
   * Check if tool is available (IToolExecutor interface)
   */
  hasToolFunction(toolName: string): boolean {
    return this.registry.has(toolName);
  }

  /**
   * Get tool definition (IToolExecutor interface)
   */
  getToolDefinition(toolName: string): Tool | undefined {
    const registration = this.registry.get(toolName);
    return registration?.tool.definition;
  }

  /**
   * Register a tool (IToolExecutor interface - delegates to register())
   */
  registerTool(tool: ToolFunction): void {
    this.register(tool);
  }

  /**
   * Unregister a tool (IToolExecutor interface - delegates to unregister())
   */
  unregisterTool(toolName: string): void {
    this.unregister(toolName);
  }

  /**
   * List all registered tool names (IToolExecutor interface - delegates to list())
   */
  listTools(): string[] {
    return this.list();
  }

  // ==========================================================================
  // Circuit Breaker Management
  // ==========================================================================

  /**
   * Get or create circuit breaker for a tool
   */
  private getOrCreateCircuitBreaker(toolName: string, registration: ToolRegistration): CircuitBreaker {
    let breaker = this.circuitBreakers.get(toolName);

    if (!breaker) {
      // Use tool's config or defaults
      const config = registration.circuitBreakerConfig || {
        failureThreshold: 3,
        successThreshold: 2,
        resetTimeoutMs: 60000, // 1 minute
        windowMs: 300000, // 5 minutes
      };

      breaker = new CircuitBreaker(`tool:${toolName}`, config);

      // Forward circuit breaker events to logger and metrics
      breaker.on('opened', (data) => {
        this.toolLogger.warn(data, `Circuit breaker opened for tool: ${toolName}`);
        metrics.increment('circuit_breaker.opened', 1, {
          breaker: data.name,
          tool: toolName,
        });
      });

      breaker.on('closed', (data) => {
        this.toolLogger.info(data, `Circuit breaker closed for tool: ${toolName}`);
        metrics.increment('circuit_breaker.closed', 1, {
          breaker: data.name,
          tool: toolName,
        });
      });

      this.circuitBreakers.set(toolName, breaker);
    }

    return breaker;
  }

  /**
   * Get circuit breaker states for all tools
   */
  getCircuitBreakerStates(): Map<string, CircuitState> {
    const states = new Map<string, CircuitState>();
    for (const [toolName, breaker] of this.circuitBreakers.entries()) {
      states.set(toolName, breaker.getState());
    }
    return states;
  }

  /**
   * Get circuit breaker metrics for a specific tool
   */
  getToolCircuitBreakerMetrics(toolName: string) {
    const breaker = this.circuitBreakers.get(toolName);
    return breaker?.getMetrics();
  }

  /**
   * Manually reset a tool's circuit breaker
   */
  resetToolCircuitBreaker(toolName: string): void {
    const breaker = this.circuitBreakers.get(toolName);
    if (breaker) {
      breaker.reset();
      this.toolLogger.info({ toolName }, 'Tool circuit breaker manually reset');
    }
  }

  /**
   * Configure circuit breaker for a tool
   */
  setCircuitBreakerConfig(toolName: string, config: CircuitBreakerConfig): boolean {
    const registration = this.registry.get(toolName);
    if (!registration) return false;

    registration.circuitBreakerConfig = config;

    // If breaker already exists, clean up listeners and remove it
    const existingBreaker = this.circuitBreakers.get(toolName);
    if (existingBreaker) {
      existingBreaker.removeAllListeners();
      this.circuitBreakers.delete(toolName);
      // Will be recreated on next execution with new config
    }

    return true;
  }

  // ==========================================================================
  // Persistence
  // ==========================================================================

  /**
   * Get serializable state (for session persistence)
   */
  getState(): SerializedToolState {
    const enabled: Record<string, boolean> = {};
    const namespaces: Record<string, string> = {};
    const priorities: Record<string, number> = {};
    const permissions: Record<string, ToolPermissionConfig> = {};
    const tags: Record<string, string[]> = {};
    const categories: Record<string, string> = {};
    const sources: Record<string, ToolSource> = {};

    for (const [name, reg] of this.registry) {
      enabled[name] = reg.enabled;
      namespaces[name] = reg.namespace;
      priorities[name] = reg.priority;
      if (reg.permission) {
        permissions[name] = reg.permission;
      }
      if (reg.tags) {
        tags[name] = reg.tags;
      }
      if (reg.category) {
        categories[name] = reg.category;
      }
      if (reg.source) {
        sources[name] = reg.source;
      }
    }

    return { enabled, namespaces, priorities, permissions, tags, categories, sources };
  }

  /**
   * Load state (restores enabled/disabled, namespaces, priorities, permissions)
   * Note: Tools must be re-registered separately (they contain functions)
   */
  loadState(state: SerializedToolState): void {
    for (const [name, isEnabled] of Object.entries(state.enabled)) {
      const reg = this.registry.get(name);
      if (reg) {
        reg.enabled = isEnabled;
      }
    }

    for (const [name, namespace] of Object.entries(state.namespaces)) {
      this.setNamespace(name, namespace);
    }

    for (const [name, priority] of Object.entries(state.priorities)) {
      this.setPriority(name, priority);
    }

    // Restore permissions if present
    if (state.permissions) {
      for (const [name, permission] of Object.entries(state.permissions)) {
        this.setPermission(name, permission);
      }
    }

    // Restore tags if present
    if (state.tags) {
      for (const [name, toolTags] of Object.entries(state.tags)) {
        const reg = this.registry.get(name);
        if (reg) reg.tags = toolTags;
      }
    }

    // Restore categories if present
    if (state.categories) {
      for (const [name, category] of Object.entries(state.categories)) {
        const reg = this.registry.get(name);
        if (reg) reg.category = category;
      }
    }

    // Restore sources if present
    if (state.sources) {
      for (const [name, source] of Object.entries(state.sources)) {
        const reg = this.registry.get(name);
        if (reg) reg.source = source;
      }
    }
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  private getToolName(tool: ToolFunction): string {
    return tool.definition.function.name;
  }

  private getSortedByPriority(): ToolRegistration[] {
    return Array.from(this.registry.values()).sort((a, b) => b.priority - a.priority);
  }

  private addToNamespace(toolName: string, namespace: string): void {
    if (!this.namespaceIndex.has(namespace)) {
      this.namespaceIndex.set(namespace, new Set());
    }
    this.namespaceIndex.get(namespace)!.add(toolName);
  }

  private removeFromNamespace(toolName: string, namespace: string): void {
    this.namespaceIndex.get(namespace)?.delete(toolName);
  }

  private moveToNamespace(toolName: string, oldNamespace: string, newNamespace: string): void {
    this.removeFromNamespace(toolName, oldNamespace);
    this.addToNamespace(toolName, newNamespace);
  }

  private filterByTokenBudget(tools: ToolFunction[], budget: number): ToolFunction[] {
    const result: ToolFunction[] = [];
    let usedTokens = 0;

    for (const tool of tools) {
      const toolTokens = this.estimateToolTokens(tool);
      if (usedTokens + toolTokens <= budget) {
        result.push(tool);
        usedTokens += toolTokens;
      }
    }

    return result;
  }

  private estimateToolTokens(tool: ToolFunction): number {
    // Rough estimation: ~4 chars per token
    const def = tool.definition.function;
    const nameTokens = Math.ceil((def.name?.length ?? 0) / 4);
    const descTokens = Math.ceil((def.description?.length ?? 0) / 4);
    const paramTokens = def.parameters ? Math.ceil(JSON.stringify(def.parameters).length / 4) : 0;

    return nameTokens + descTokens + paramTokens + 20; // +20 for structure overhead
  }
}
