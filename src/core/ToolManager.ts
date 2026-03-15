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
import { ToolNotFoundError, ToolExecutionError } from '../domain/errors/AIErrors.js';
import { logger, FrameworkLogger } from '../infrastructure/observability/Logger.js';
import { metrics } from '../infrastructure/observability/Metrics.js';
import { ToolExecutionPipeline } from './tool-execution/ToolExecutionPipeline.js';
import { ResultNormalizerPlugin } from './tool-execution/plugins/ResultNormalizerPlugin.js';
import type { IToolExecutionPipeline } from './tool-execution/types.js';
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
  | 'namespace:enabled'
  | 'namespace:disabled';

// ============================================================================
// ToolManager Class
// ============================================================================

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
   * Set tool context for execution (called by agent before runs)
   */
  setToolContext(context: ToolContext | undefined): void {
    this._toolContext = context;
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

    this.emit('tool:executed', {
      name,
      executionMs,
      success,
      totalUsage: meta.usageCount,
    });
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
  async execute(toolName: string, args: any): Promise<any> {
    const registration = this.registry.get(toolName);
    if (!registration) {
      throw new ToolNotFoundError(toolName);
    }

    // Check if tool is enabled
    if (!registration.enabled) {
      throw new ToolExecutionError(toolName, 'Tool is disabled');
    }

    // Connector-scoped safety net: block execution if the connector is not in the agent's allowlist
    if (registration.source?.startsWith('connector:')) {
      const connName = registration.source.slice('connector:'.length);
      const registry = this._toolContext?.connectorRegistry;
      if (registry && !registry.has(connName)) {
        throw new ToolExecutionError(toolName, `Connector '${connName}' is not available to this agent`);
      }
    }

    // Get or create circuit breaker for this tool
    const breaker = this.getOrCreateCircuitBreaker(toolName, registration);

    this.toolLogger.debug({ toolName, args }, 'Tool execution started');

    const startTime = Date.now();
    metrics.increment('tool.executed', 1, { tool: toolName });

    try {
      // Build the core execution promise (circuit breaker + pipeline)
      const executionPromise = breaker.execute(async () => {
        // Create a wrapper tool that includes the tool context
        // This allows the pipeline to execute the tool with proper context
        const toolWithContext: ToolFunction = {
          ...registration.tool,
          execute: async (pipelineArgs: any) => {
            return await registration.tool.execute(pipelineArgs, this._toolContext);
          },
        };

        // Execute through the plugin pipeline
        return await this.pipeline.execute(toolWithContext, args);
      });

      // Wrap with hard timeout safety net if configured
      const result = this._toolExecutionTimeout > 0
        ? await this.withHardTimeout(executionPromise, toolName, this._toolExecutionTimeout)
        : await executionPromise;

      const duration = Date.now() - startTime;

      // Update metadata
      this.recordExecution(toolName, duration, true);

      // Log result summary (truncated for large results)
      const resultSummary = this.summarizeResult(result);
      this.toolLogger.debug({
        toolName,
        duration,
        resultSummary,
      }, 'Tool execution completed');

      metrics.timing('tool.duration', duration, { tool: toolName });
      metrics.increment('tool.success', 1, { tool: toolName });

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;

      // Update metadata
      this.recordExecution(toolName, duration, false);

      this.toolLogger.error({
        toolName,
        error: (error as Error).message,
        duration,
      }, 'Tool execution failed');

      metrics.increment('tool.failed', 1, {
        tool: toolName,
        error: (error as Error).name,
      });

      throw new ToolExecutionError(
        toolName,
        (error as Error).message,
        error as Error
      );
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
  // Hard Timeout
  // ==========================================================================

  /**
   * Wrap a promise with a hard timeout safety net.
   * If the promise doesn't resolve within the timeout, throws ToolExecutionError.
   */
  private async withHardTimeout<T>(promise: Promise<T>, toolName: string, timeoutMs: number): Promise<T> {
    let timeoutId: ReturnType<typeof setTimeout>;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new ToolExecutionError(
          toolName,
          `Tool execution hard timeout after ${timeoutMs}ms (safety net - tool's own timeout may have failed)`
        ));
      }, timeoutMs);
    });

    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      clearTimeout(timeoutId!);
    }
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
