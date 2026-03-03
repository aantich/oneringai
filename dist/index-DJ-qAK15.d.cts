import { I as IConnectorRegistry, e as IProvider } from './IProvider-B8sqUzJG.cjs';
import { EventEmitter } from 'eventemitter3';

/**
 * Content types based on OpenAI Responses API format
 */
declare enum ContentType {
    INPUT_TEXT = "input_text",
    INPUT_IMAGE_URL = "input_image_url",
    INPUT_FILE = "input_file",
    OUTPUT_TEXT = "output_text",
    TOOL_USE = "tool_use",
    TOOL_RESULT = "tool_result",
    THINKING = "thinking"
}
interface BaseContent {
    type: ContentType;
}
interface InputTextContent extends BaseContent {
    type: ContentType.INPUT_TEXT;
    text: string;
}
interface InputImageContent extends BaseContent {
    type: ContentType.INPUT_IMAGE_URL;
    image_url: {
        url: string;
        detail?: 'auto' | 'low' | 'high';
    };
}
interface InputFileContent extends BaseContent {
    type: ContentType.INPUT_FILE;
    file_id: string;
}
interface OutputTextContent extends BaseContent {
    type: ContentType.OUTPUT_TEXT;
    text: string;
    annotations?: any[];
}
interface ToolUseContent extends BaseContent {
    type: ContentType.TOOL_USE;
    id: string;
    name: string;
    arguments: string;
}
interface ToolResultContent extends BaseContent {
    type: ContentType.TOOL_RESULT;
    tool_use_id: string;
    content: string | any;
    error?: string;
    /**
     * Images extracted from tool results via the __images convention.
     * Stored separately from `content` so they don't inflate text-based token counts.
     * Provider converters read this field to inject native multimodal image blocks.
     */
    __images?: Array<{
        base64: string;
        mediaType: string;
    }>;
}
interface ThinkingContent extends BaseContent {
    type: ContentType.THINKING;
    thinking: string;
    /** Anthropic's opaque signature for round-tripping thinking blocks */
    signature?: string;
    /** Whether this thinking block should be persisted in conversation history.
     *  Anthropic requires it (true), OpenAI/Google do not (false). */
    persistInHistory: boolean;
}
type Content = InputTextContent | InputImageContent | InputFileContent | OutputTextContent | ToolUseContent | ToolResultContent | ThinkingContent;

/**
 * Message entity based on OpenAI Responses API format
 */

declare enum MessageRole {
    USER = "user",
    ASSISTANT = "assistant",
    DEVELOPER = "developer"
}
interface Message {
    type: 'message';
    id?: string;
    role: MessageRole;
    content: Content[];
}
interface CompactionItem {
    type: 'compaction';
    id: string;
    encrypted_content: string;
}
interface ReasoningItem {
    type: 'reasoning';
    id: string;
    effort?: 'low' | 'medium' | 'high';
    summary?: string;
    encrypted_content?: string;
}
type InputItem = Message | CompactionItem;
type OutputItem = Message | CompactionItem | ReasoningItem;

/**
 * Memory entities for WorkingMemory
 *
 * This module provides a GENERIC memory system that works across all agent types:
 * - Basic Agent: Simple session/persistent scoping with static priority
 * - TaskAgent: Task-aware scoping with dynamic priority based on task states
 * - UniversalAgent: Mode-aware, switches strategy based on current mode
 *
 * The key abstraction is PriorityCalculator - a pluggable strategy that
 * determines entry priority for eviction decisions.
 */
/**
 * Simple scope for basic agents - just a lifecycle label
 */
type SimpleScope = 'session' | 'persistent';
/**
 * Task-aware scope for TaskAgent/UniversalAgent
 */
type TaskAwareScope = {
    type: 'task';
    taskIds: string[];
} | {
    type: 'plan';
} | {
    type: 'persistent';
};
/**
 * Union type - memory system accepts both
 */
type MemoryScope = SimpleScope | TaskAwareScope;
/**
 * Type guard: is this a task-aware scope?
 */
declare function isTaskAwareScope(scope: MemoryScope): scope is TaskAwareScope;
/**
 * Type guard: is this a simple scope?
 */
declare function isSimpleScope(scope: MemoryScope): scope is SimpleScope;
/**
 * Compare two scopes for equality
 * Handles both simple scopes (string comparison) and task-aware scopes (deep comparison)
 */
declare function scopeEquals(a: MemoryScope, b: MemoryScope): boolean;
/**
 * Check if a scope matches a filter scope
 * More flexible than scopeEquals - supports partial matching for task scopes
 */
declare function scopeMatches(entryScope: MemoryScope, filterScope: MemoryScope): boolean;
/**
 * Priority determines eviction order (lower priority evicted first)
 *
 * - critical: Never evicted (pinned, or actively in use)
 * - high: Important data, evicted only when necessary
 * - normal: Default priority
 * - low: Candidate for eviction (stale data, completed task data)
 */
type MemoryPriority = 'critical' | 'high' | 'normal' | 'low';
/**
 * Priority values for comparison (higher = more important, less likely to evict)
 */
declare const MEMORY_PRIORITY_VALUES: Record<MemoryPriority, number>;
/**
 * Memory tier for hierarchical data management
 *
 * The tier system provides a structured approach to managing research/analysis data:
 * - raw: Original data, low priority, first to be evicted
 * - summary: Processed summaries, normal priority
 * - findings: Final conclusions/insights, high priority, kept longest
 *
 * Workflow: raw → summary → findings (data gets more refined, priority increases)
 */
type MemoryTier = 'raw' | 'summary' | 'findings';
/**
 * Context passed to priority calculator - varies by agent type
 */
interface PriorityContext {
    /** For TaskAgent: map of taskId → current status */
    taskStates?: Map<string, TaskStatusForMemory>;
    /** For UniversalAgent: current mode */
    mode?: 'interactive' | 'planning' | 'executing';
    /** Custom context for extensions */
    [key: string]: unknown;
}
/**
 * Task status values for priority calculation
 */
type TaskStatusForMemory = 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped' | 'cancelled';
/**
 * Check if a task status is terminal (task will not progress further)
 */
declare function isTerminalMemoryStatus(status: TaskStatusForMemory): boolean;
/**
 * Priority calculator function type.
 * Given an entry and optional context, returns the effective priority.
 */
type PriorityCalculator = (entry: MemoryEntry, context?: PriorityContext) => MemoryPriority;
/**
 * Reason why an entry became stale
 */
type StaleReason = 'task_completed' | 'task_failed' | 'unused' | 'scope_cleared';
/**
 * Information about a stale entry for LLM notification
 */
interface StaleEntryInfo {
    key: string;
    description: string;
    reason: StaleReason;
    previousPriority: MemoryPriority;
    newPriority: MemoryPriority;
    taskIds?: string[];
}
/**
 * Single memory entry stored in working memory
 */
interface MemoryEntry {
    key: string;
    description: string;
    value: unknown;
    sizeBytes: number;
    scope: MemoryScope;
    basePriority: MemoryPriority;
    pinned: boolean;
    createdAt: number;
    lastAccessedAt: number;
    accessCount: number;
}
/**
 * Index entry (lightweight, always in context)
 */
interface MemoryIndexEntry {
    key: string;
    description: string;
    size: string;
    scope: MemoryScope;
    effectivePriority: MemoryPriority;
    pinned: boolean;
}
/**
 * Full memory index with metadata
 */
interface MemoryIndex {
    entries: MemoryIndexEntry[];
    totalSizeBytes: number;
    totalSizeHuman: string;
    limitBytes: number;
    limitHuman: string;
    utilizationPercent: number;
    /** Total entry count (before any truncation for display) */
    totalEntryCount: number;
    /** Number of entries omitted from display due to maxIndexEntries limit */
    omittedCount: number;
}
/**
 * Configuration for working memory
 */
interface WorkingMemoryConfig {
    /** Max memory size in bytes. If not set, calculated from model context */
    maxSizeBytes?: number;
    /** Max number of entries in the memory index. Excess entries are auto-evicted via LRU. Default: 30 */
    maxIndexEntries?: number;
    /** Max description length */
    descriptionMaxLength: number;
    /** Percentage at which to warn agent */
    softLimitPercent: number;
    /** Percentage of model context to allocate to memory */
    contextAllocationPercent: number;
}
/**
 * Input for creating a memory entry
 */
interface MemoryEntryInput {
    key: string;
    description: string;
    value: unknown;
    /** Scope - defaults to 'session' for basic agents */
    scope?: MemoryScope;
    /** Base priority - may be overridden by dynamic calculation */
    priority?: MemoryPriority;
    /** If true, entry is never evicted */
    pinned?: boolean;
}
/**
 * Create a task-scoped memory entry input
 */
declare function forTasks(key: string, description: string, value: unknown, taskIds: string[], options?: {
    priority?: MemoryPriority;
    pinned?: boolean;
}): MemoryEntryInput;
/**
 * Create a plan-scoped memory entry input
 */
declare function forPlan(key: string, description: string, value: unknown, options?: {
    priority?: MemoryPriority;
    pinned?: boolean;
}): MemoryEntryInput;
/**
 * Default configuration values
 */
declare const DEFAULT_MEMORY_CONFIG: WorkingMemoryConfig;
/**
 * Calculate the size of a value in bytes (JSON serialization)
 * Uses Buffer.byteLength for accurate UTF-8 byte count
 */
declare function calculateEntrySize(value: unknown): number;

/**
 * Tool context interface - passed to tools during execution
 *
 * This is a SIMPLE interface. Tools receive only what they need:
 * - agentId: For logging/tracing
 * - taskId: For task-aware operations
 * - memory: For storing/retrieving data
 * - signal: For cancellation
 *
 * Plugins and context management are NOT exposed to tools.
 * Tools should be self-contained and not depend on framework internals.
 */

/**
 * Limited memory access for tools
 *
 * This interface is designed to work with all agent types:
 * - Basic agents: Use simple scopes ('session', 'persistent')
 * - TaskAgent: Use task-aware scopes ({ type: 'task', taskIds: [...] })
 * - UniversalAgent: Switches between simple and task-aware based on mode
 */
interface WorkingMemoryAccess {
    get(key: string): Promise<unknown>;
    /**
     * Store a value in memory
     *
     * @param key - Unique key for the entry
     * @param description - Short description (max 150 chars)
     * @param value - Data to store
     * @param options - Optional scope, priority, and pinning
     */
    set(key: string, description: string, value: unknown, options?: {
        /** Scope determines lifecycle - defaults to 'session' */
        scope?: MemoryScope;
        /** Base priority for eviction ordering */
        priority?: MemoryPriority;
        /** If true, entry is never evicted */
        pinned?: boolean;
    }): Promise<void>;
    delete(key: string): Promise<void>;
    has(key: string): Promise<boolean>;
    /**
     * List all memory entries
     * Returns key, description, and computed priority info
     */
    list(): Promise<Array<{
        key: string;
        description: string;
        effectivePriority?: MemoryPriority;
        pinned?: boolean;
    }>>;
}
/**
 * Context passed to tool execute function
 *
 * Simple and clean - only what tools actually need.
 */
interface ToolContext {
    /** Agent ID (for logging/tracing) */
    agentId?: string;
    /** Task ID (if running in TaskAgent) */
    taskId?: string;
    /** User ID — auto-populated from Agent config (userId). Also settable manually via agent.tools.setToolContext(). */
    userId?: string;
    /** Account alias for multi-account OAuth — auto-populated from Agent config (accountId). Allows one user to auth multiple external accounts on the same connector (e.g., 'work', 'personal'). */
    accountId?: string;
    /** Auth identities this agent is scoped to (for identity-aware tool descriptions) */
    identities?: AuthIdentity[];
    /** Connector registry scoped to this agent's allowed connectors and userId */
    connectorRegistry?: IConnectorRegistry;
    /** Working memory access (if agent has memory feature enabled) */
    memory?: WorkingMemoryAccess;
    /** Abort signal for cancellation */
    signal?: AbortSignal;
}

/**
 * Tool entities with blocking/non-blocking execution support
 */

interface JSONSchema {
    type: string;
    properties?: Record<string, any>;
    required?: string[];
    [key: string]: any;
}
interface FunctionToolDefinition {
    type: 'function';
    function: {
        name: string;
        description?: string;
        parameters?: JSONSchema;
        strict?: boolean;
    };
    blocking?: boolean;
    timeout?: number;
}
interface BuiltInTool {
    type: 'web_search' | 'file_search' | 'computer_use' | 'code_interpreter';
    blocking?: boolean;
}
type Tool = FunctionToolDefinition | BuiltInTool;
declare enum ToolCallState {
    PENDING = "pending",// Tool call identified, not yet executed
    EXECUTING = "executing",// Currently executing
    COMPLETED = "completed",// Successfully completed
    FAILED = "failed",// Execution failed
    TIMEOUT = "timeout"
}
interface ToolCall {
    id: string;
    type: 'function';
    function: {
        name: string;
        arguments: string;
    };
    blocking: boolean;
    state: ToolCallState;
    startTime?: Date;
    endTime?: Date;
    error?: string;
}
interface ToolResult {
    tool_use_id: string;
    tool_name?: string;
    tool_args?: Record<string, unknown>;
    content: any;
    error?: string;
    executionTime?: number;
    state: ToolCallState;
}
/**
 * Tool execution context - tracks all tool calls in a generation
 */
interface ToolExecutionContext {
    executionId: string;
    toolCalls: Map<string, ToolCall>;
    pendingNonBlocking: Set<string>;
    completedResults: Map<string, ToolResult>;
}
/**
 * Output handling hints for context management
 */
interface ToolOutputHints {
    expectedSize?: 'small' | 'medium' | 'large' | 'variable';
    summarize?: (output: unknown) => string;
}
/**
 * Idempotency configuration for tool caching
 */
interface ToolIdempotency {
    /**
     * @deprecated Use 'cacheable' instead. Will be removed in a future version.
     * If true, tool is naturally idempotent (e.g., read-only) and doesn't need caching.
     * If false, tool results should be cached based on arguments.
     */
    safe?: boolean;
    /**
     * If true, tool results can be cached based on arguments.
     * Use this for tools that return deterministic results for the same inputs.
     * Takes precedence over the deprecated 'safe' field.
     * @default false
     */
    cacheable?: boolean;
    keyFn?: (args: Record<string, unknown>) => string;
    ttlMs?: number;
}
/**
 * Permission configuration for a tool
 *
 * Controls when approval is required for tool execution.
 * Used by the ToolPermissionManager.
 */
interface ToolPermissionConfig {
    /**
     * When approval is required.
     * - 'once' - Require approval for each call
     * - 'session' - Approve once per session
     * - 'always' - Auto-approve (no prompts)
     * - 'never' - Always blocked
     * @default 'once'
     */
    scope?: 'once' | 'session' | 'always' | 'never';
    /**
     * Risk level classification.
     * @default 'low'
     */
    riskLevel?: 'low' | 'medium' | 'high' | 'critical';
    /**
     * Custom message shown in approval UI.
     */
    approvalMessage?: string;
    /**
     * Argument names that should be highlighted as sensitive.
     */
    sensitiveArgs?: string[];
    /**
     * TTL for session approvals (milliseconds).
     */
    sessionTTLMs?: number;
}
/**
 * User-provided tool function
 */
interface ToolFunction<TArgs = any, TResult = any> {
    definition: FunctionToolDefinition;
    execute: (args: TArgs, context?: ToolContext) => Promise<TResult>;
    idempotency?: ToolIdempotency;
    output?: ToolOutputHints;
    /** Permission settings for this tool. If not set, defaults are used. */
    permission?: ToolPermissionConfig;
    /**
     * Dynamic description generator for the tool.
     * If provided, this function is called when tool definitions are serialized for the LLM,
     * allowing the description to reflect current state (e.g., available connectors).
     *
     * The returned string replaces definition.function.description when sending to LLM.
     * The static description in definition.function.description serves as a fallback.
     *
     * @param context - Current ToolContext (includes userId, agentId, etc.)
     * @returns The current tool description
     *
     * @example
     * // Tool with dynamic connector list scoped to current user:
     * descriptionFactory: (context) => {
     *   const connectors = getConnectorsForUser(context?.userId);
     *   return `Execute API calls. Available connectors: ${connectors.map(c => c.name).join(', ')}`;
     * }
     */
    descriptionFactory?: (context?: ToolContext) => string;
    /**
     * Returns a human-readable description of a tool call.
     * Used for logging, UI display, and debugging.
     *
     * @param args - The arguments passed to the tool
     * @returns A concise description (e.g., "reading /path/to/file.ts")
     *
     * If not implemented, use `defaultDescribeCall()` as a fallback.
     *
     * @example
     * // For read_file tool:
     * describeCall: (args) => args.file_path
     *
     * @example
     * // For bash tool:
     * describeCall: (args) => args.command.length > 50
     *   ? args.command.slice(0, 47) + '...'
     *   : args.command
     */
    describeCall?: (args: TArgs) => string;
}
/**
 * Default implementation for describeCall.
 * Shows the first meaningful argument value.
 *
 * @param args - Tool arguments object
 * @param maxLength - Maximum length before truncation (default: 60)
 * @returns Human-readable description
 *
 * @example
 * defaultDescribeCall({ file_path: '/path/to/file.ts' })
 * // Returns: '/path/to/file.ts'
 *
 * @example
 * defaultDescribeCall({ query: 'search term', limit: 10 })
 * // Returns: 'search term'
 */
declare function defaultDescribeCall(args: Record<string, unknown>, maxLength?: number): string;
/**
 * Get a human-readable description of a tool call.
 * Uses the tool's describeCall method if available, otherwise falls back to default.
 *
 * @param tool - The tool function
 * @param args - The arguments passed to the tool
 * @returns Human-readable description
 */
declare function getToolCallDescription<TArgs>(tool: ToolFunction<TArgs>, args: TArgs): string;

/**
 * IContextStorage - Storage interface for AgentContext persistence
 *
 * Provides persistence operations for AgentContext sessions.
 * Implementations can use filesystem, database, cloud storage, etc.
 *
 * This follows Clean Architecture - the interface is in domain layer,
 * implementations are in infrastructure layer.
 */

/**
 * Serialized context state for persistence.
 * This is the canonical definition - core layer re-exports this type.
 */
interface SerializedContextState {
    /** Conversation history */
    conversation: InputItem[];
    /** Plugin states (keyed by plugin name) */
    pluginStates: Record<string, unknown>;
    /** System prompt */
    systemPrompt?: string;
    /** Metadata */
    metadata: {
        savedAt: number;
        agentId?: string;
        userId?: string;
        model: string;
    };
    /** Agent-specific state (for TaskAgent, UniversalAgent, etc.) */
    agentState?: Record<string, unknown>;
}
/**
 * Session summary for listing (lightweight, no full state)
 */
interface ContextSessionSummary {
    /** Session identifier */
    sessionId: string;
    /** When the session was created */
    createdAt: Date;
    /** When the session was last saved */
    lastSavedAt: Date;
    /** Number of messages in history */
    messageCount: number;
    /** Number of memory entries */
    memoryEntryCount: number;
    /** Optional metadata */
    metadata?: ContextSessionMetadata;
}
/**
 * Session metadata (stored with session)
 */
interface ContextSessionMetadata {
    /** Human-readable title */
    title?: string;
    /** Auto-generated or user-provided description */
    description?: string;
    /** Tags for filtering */
    tags?: string[];
    /** Custom key-value data */
    [key: string]: unknown;
}
/**
 * Full session state wrapper (includes metadata)
 */
interface StoredContextSession {
    /** Format version for migration support */
    version: number;
    /** Session identifier */
    sessionId: string;
    /** When the session was created */
    createdAt: string;
    /** When the session was last saved */
    lastSavedAt: string;
    /** The serialized AgentContext state */
    state: SerializedContextState;
    /** Session metadata */
    metadata: ContextSessionMetadata;
}
/**
 * Current format version for stored sessions
 */
declare const CONTEXT_SESSION_FORMAT_VERSION = 1;
/**
 * Storage interface for AgentContext persistence
 *
 * Implementations:
 * - FileContextStorage: File-based storage at ~/.oneringai/agents/<agentId>/sessions/
 * - (Future) RedisContextStorage, PostgresContextStorage, S3ContextStorage, etc.
 */
interface IContextStorage {
    /**
     * Save context state to a session
     *
     * @param sessionId - Unique session identifier
     * @param state - Serialized AgentContext state
     * @param metadata - Optional session metadata
     */
    save(sessionId: string, state: SerializedContextState, metadata?: ContextSessionMetadata): Promise<void>;
    /**
     * Load context state from a session
     *
     * @param sessionId - Session identifier to load
     * @returns The stored session, or null if not found
     */
    load(sessionId: string): Promise<StoredContextSession | null>;
    /**
     * Delete a session
     *
     * @param sessionId - Session identifier to delete
     */
    delete(sessionId: string): Promise<void>;
    /**
     * Check if a session exists
     *
     * @param sessionId - Session identifier to check
     */
    exists(sessionId: string): Promise<boolean>;
    /**
     * List all sessions (summaries only, not full state)
     *
     * @param options - Optional filtering and pagination
     * @returns Array of session summaries, sorted by lastSavedAt descending
     */
    list(options?: ContextStorageListOptions): Promise<ContextSessionSummary[]>;
    /**
     * Update session metadata without loading full state
     *
     * @param sessionId - Session identifier
     * @param metadata - Metadata to merge (existing keys preserved unless overwritten)
     */
    updateMetadata?(sessionId: string, metadata: Partial<ContextSessionMetadata>): Promise<void>;
    /**
     * Get the storage path (for display/debugging)
     * @deprecated Use getLocation() instead - getPath() assumes filesystem storage
     */
    getPath(): string;
    /**
     * Get a human-readable storage location string (for display/debugging).
     * Examples: file path, MongoDB URI, Redis key prefix, S3 bucket, etc.
     * Falls back to getPath() if not implemented.
     */
    getLocation?(): string;
}
/**
 * Options for listing sessions
 */
interface ContextStorageListOptions {
    /** Filter by tags (any match) */
    tags?: string[];
    /** Filter by creation date range */
    createdAfter?: Date;
    createdBefore?: Date;
    /** Filter by last saved date range */
    savedAfter?: Date;
    savedBefore?: Date;
    /** Maximum number of results */
    limit?: number;
    /** Offset for pagination */
    offset?: number;
}

/**
 * ToolCatalogRegistry - Static Global Registry for Tool Categories
 *
 * The single source of truth for all tool categories and their tools.
 * Library users register their own categories and tools at app startup.
 *
 * Built-in tools are auto-registered from registry.generated.ts on first access.
 *
 * @example
 * ```typescript
 * // Register custom category
 * ToolCatalogRegistry.registerCategory({
 *   name: 'knowledge',
 *   displayName: 'Knowledge Graph',
 *   description: 'Search entities, get facts, manage references',
 * });
 *
 * // Register tools in category
 * ToolCatalogRegistry.registerTools('knowledge', [
 *   { name: 'entity_search', displayName: 'Entity Search', description: 'Search people/orgs', tool: entitySearch, safeByDefault: true },
 * ]);
 *
 * // Query
 * const categories = ToolCatalogRegistry.getCategories();
 * const tools = ToolCatalogRegistry.getToolsInCategory('knowledge');
 * const found = ToolCatalogRegistry.findTool('entity_search');
 * ```
 */

/**
 * Definition of a tool category in the catalog.
 */
interface ToolCategoryDefinition {
    /** Unique category name (e.g., 'filesystem', 'knowledge', 'connector:github') */
    name: string;
    /** Human-readable display name (e.g., 'File System') */
    displayName: string;
    /** Description shown in catalog metatool display */
    description: string;
}
/**
 * A single tool entry in the catalog.
 */
interface CatalogToolEntry {
    /** The actual tool function (optional when createTool factory is provided) */
    tool?: ToolFunction;
    /** Tool name (matches definition.function.name) */
    name: string;
    /** Human-readable display name */
    displayName: string;
    /** Brief description */
    description: string;
    /** Whether this tool is safe to execute without user approval */
    safeByDefault: boolean;
    /** Whether this tool requires a connector to function */
    requiresConnector?: boolean;
    /** Factory for runtime tool creation (e.g., browser tools needing context) */
    createTool?: (ctx: Record<string, unknown>) => ToolFunction;
    /** Source identifier (e.g., 'oneringai', 'hosea', 'custom') */
    source?: string;
    /** Connector name (for connector-originated tools) */
    connectorName?: string;
    /** Service type (e.g., 'github', 'slack') */
    serviceType?: string;
    /** Supported connector service types */
    connectorServiceTypes?: string[];
}
/**
 * Entry format from the generated tool registry (registry.generated.ts).
 * Used by initializeFromRegistry() and registerFromToolRegistry().
 */
interface ToolRegistryEntry {
    name: string;
    displayName: string;
    category: string;
    description: string;
    tool: ToolFunction;
    safeByDefault: boolean;
    requiresConnector?: boolean;
}
/**
 * Scope for filtering which categories are visible/allowed.
 *
 * - `string[]` — shorthand allowlist (only these categories)
 * - `{ include: string[] }` — explicit allowlist
 * - `{ exclude: string[] }` — blocklist (all except these)
 * - `undefined` — all categories allowed
 */
type ToolCategoryScope = string[] | {
    include: string[];
} | {
    exclude: string[];
};
/**
 * Connector category metadata returned by discoverConnectorCategories().
 */
interface ConnectorCategoryInfo {
    /** Category name in 'connector:<name>' format */
    name: string;
    /** Human-readable display name */
    displayName: string;
    /** Description */
    description: string;
    /** Number of tools */
    toolCount: number;
    /** Resolved tools */
    tools: ToolFunction[];
}
/**
 * Static global registry for tool categories and their tools.
 *
 * Like Connector and StorageRegistry, this is a static class that acts
 * as a single source of truth. App code registers categories at startup,
 * and plugins/agents query them at runtime.
 */
declare class ToolCatalogRegistry {
    /** Category definitions: name → definition */
    private static _categories;
    /** Tools per category: category name → tool entries */
    private static _tools;
    /** Whether built-in tools have been registered */
    private static _initialized;
    /** Lazy-loaded ConnectorTools module. null = not attempted, false = failed */
    private static _connectorToolsModule;
    private static readonly BUILTIN_DESCRIPTIONS;
    /**
     * Convert a hyphenated or plain name to a display name.
     * E.g., 'custom-tools' → 'Custom Tools', 'filesystem' → 'Filesystem'
     */
    static toDisplayName(name: string): string;
    /**
     * Parse a connector category name, returning the connector name or null.
     * E.g., 'connector:github' → 'github', 'filesystem' → null
     */
    static parseConnectorCategory(category: string): string | null;
    /**
     * Get the ConnectorTools module (lazy-loaded, cached).
     * Returns null if ConnectorTools is not available.
     * Uses false sentinel to prevent retrying after first failure.
     *
     * NOTE: The dynamic require() path fails in bundled environments (Meteor, Webpack).
     * Call setConnectorToolsModule() at app startup to inject the module explicitly.
     */
    static getConnectorToolsModule(): {
        ConnectorTools: any;
    } | null;
    /**
     * Explicitly set the ConnectorTools module reference.
     *
     * Use this in bundled environments (Meteor, Webpack, etc.) where the lazy
     * require('../../tools/connector/ConnectorTools.js') fails due to path resolution.
     *
     * @example
     * ```typescript
     * import { ToolCatalogRegistry, ConnectorTools } from '@everworker/oneringai';
     * ToolCatalogRegistry.setConnectorToolsModule({ ConnectorTools });
     * ```
     */
    static setConnectorToolsModule(mod: {
        ConnectorTools: any;
    }): void;
    /**
     * Register a tool category.
     * If the category already exists, updates its metadata.
     * @throws Error if name is empty or whitespace
     */
    static registerCategory(def: ToolCategoryDefinition): void;
    /**
     * Register multiple tools in a category.
     * The category is auto-created if it doesn't exist (with a generic description).
     * @throws Error if category name is empty or whitespace
     */
    static registerTools(category: string, tools: CatalogToolEntry[]): void;
    /**
     * Register a single tool in a category.
     */
    static registerTool(category: string, tool: CatalogToolEntry): void;
    /**
     * Unregister a category and all its tools.
     */
    static unregisterCategory(category: string): boolean;
    /**
     * Unregister a single tool from a category.
     */
    static unregisterTool(category: string, toolName: string): boolean;
    /**
     * Get all registered categories.
     */
    static getCategories(): ToolCategoryDefinition[];
    /**
     * Get a single category by name.
     */
    static getCategory(name: string): ToolCategoryDefinition | undefined;
    /**
     * Check if a category exists.
     */
    static hasCategory(name: string): boolean;
    /**
     * Get all tools in a category.
     */
    static getToolsInCategory(category: string): CatalogToolEntry[];
    /**
     * Get all catalog tools across all categories.
     */
    static getAllCatalogTools(): CatalogToolEntry[];
    /**
     * Find a tool by name across all categories.
     */
    static findTool(name: string): {
        category: string;
        entry: CatalogToolEntry;
    } | undefined;
    /**
     * Filter categories by scope.
     */
    static filterCategories(scope?: ToolCategoryScope): ToolCategoryDefinition[];
    /**
     * Check if a category is allowed by a scope.
     */
    static isCategoryAllowed(name: string, scope?: ToolCategoryScope): boolean;
    /**
     * Discover all connector categories with their tools.
     * Calls ConnectorTools.discoverAll() and filters by scope/identities.
     *
     * @param options - Optional filtering
     * @returns Array of connector category info
     */
    static discoverConnectorCategories(options?: {
        scope?: ToolCategoryScope;
        identities?: Array<{
            connector: string;
        }>;
    }): ConnectorCategoryInfo[];
    /**
     * Resolve tools for a specific connector category.
     *
     * @param category - Category name in 'connector:<name>' format
     * @returns Array of resolved tools with names
     */
    static resolveConnectorCategoryTools(category: string): Array<{
        tool: ToolFunction;
        name: string;
    }>;
    /**
     * Resolve tool names to ToolFunction[].
     *
     * Searches registered categories and (optionally) connector tools.
     * Used by app-level executors (e.g., V25's OneRingAgentExecutor).
     *
     * @param toolNames - Array of tool names to resolve
     * @param options - Resolution options
     * @returns Resolved tool functions (skips unresolvable names with warning)
     */
    static resolveTools(toolNames: string[], options?: {
        includeConnectors?: boolean;
        userId?: string;
        context?: Record<string, unknown>;
    }): ToolFunction[];
    /**
     * Resolve tools grouped by connector name.
     *
     * Tools with a `connectorName` go into `byConnector`; all others go into `plain`.
     * Supports factory-based tool creation via `createTool` when context is provided.
     *
     * @param toolNames - Array of tool names to resolve
     * @param context - Optional context passed to createTool factories
     * @param options - Resolution options
     * @returns Grouped tools: plain + byConnector map
     */
    static resolveToolsGrouped(toolNames: string[], context?: Record<string, unknown>, options?: {
        includeConnectors?: boolean;
    }): {
        plain: ToolFunction[];
        byConnector: Map<string, ToolFunction[]>;
    };
    /**
     * Resolve a tool from a CatalogToolEntry, using factory if available.
     * Returns null if neither tool nor createTool is available.
     */
    private static resolveEntryTool;
    /**
     * Search connector tools by name (uses lazy accessor).
     */
    private static findConnectorTool;
    /**
     * Ensure built-in tools from registry.generated.ts are registered.
     * Called lazily on first query.
     *
     * In ESM environments, call `initializeFromRegistry(toolRegistry)` explicitly
     * from your app startup instead of relying on auto-initialization.
     */
    static ensureInitialized(): void;
    /**
     * Explicitly initialize from the generated tool registry.
     * Call this at app startup in ESM environments where lazy require() doesn't work.
     *
     * @example
     * ```typescript
     * import { toolRegistry } from './tools/registry.generated.js';
     * ToolCatalogRegistry.initializeFromRegistry(toolRegistry);
     * ```
     */
    static initializeFromRegistry(registry: ToolRegistryEntry[]): void;
    /**
     * Internal: register tools from a tool registry array.
     */
    private static registerFromToolRegistry;
    /**
     * Reset the registry. Primarily for testing.
     */
    static reset(): void;
}

/**
 * AgentContextNextGen - Type Definitions
 *
 * Clean, minimal type definitions for the next-generation context manager.
 */

/**
 * A single auth identity: connector + optional account alias.
 *
 * Used to scope agents to specific OAuth accounts. When `accountId` is set,
 * the identity represents a specific multi-account OAuth session (e.g., 'work'
 * or 'personal' Microsoft account). When omitted, uses the connector's default account.
 */
interface AuthIdentity {
    /** Name of the registered connector */
    connector: string;
    /** Optional account alias for multi-account OAuth (e.g., 'work', 'personal') */
    accountId?: string;
}
/**
 * Token estimator interface - used for conversation and input estimation
 * Plugins handle their own token estimation internally.
 */
interface ITokenEstimator {
    /** Estimate tokens for a string */
    estimateTokens(text: string): number;
    /** Estimate tokens for arbitrary data (will be JSON stringified) */
    estimateDataTokens(data: unknown): number;
    /**
     * Estimate tokens for an image. Provider-specific implementations can override.
     *
     * Default heuristic (matches OpenAI's image token pricing):
     * - detail='low': 85 tokens
     * - detail='high' with known dimensions: 85 + 170 * ceil(w/512) * ceil(h/512)
     * - Unknown dimensions: ~1000 tokens (conservative default)
     *
     * @param width - Image width in pixels (if known)
     * @param height - Image height in pixels (if known)
     * @param detail - Image detail level: 'low', 'high', or 'auto' (default 'auto')
     */
    estimateImageTokens?(width?: number, height?: number, detail?: string): number;
}
/**
 * Context plugin interface for NextGen context management.
 *
 * ## Implementing a Custom Plugin
 *
 * 1. **Extend BasePluginNextGen** - provides token caching helpers
 * 2. **Implement getInstructions()** - return LLM usage guide (static, cached)
 * 3. **Implement getContent()** - return formatted content (Markdown with `##` header)
 * 4. **Call updateTokenCache()** - after any state change that affects content
 * 5. **Implement getTools()** - return tools with `<plugin_prefix>_*` naming
 *
 * ## Plugin Contributions
 *
 * Plugins provide three types of content to the system message:
 * 1. **Instructions** - static usage guide for the LLM (NEVER compacted)
 * 2. **Content** - dynamic plugin data/state (may be compacted)
 * 3. **Tools** - registered with ToolManager (NEVER compacted)
 *
 * ## Token Cache Lifecycle
 *
 * Plugins must track their own token size for budget calculation. The pattern:
 *
 * ```typescript
 * // When state changes:
 * this._entries.set(key, value);
 * this.invalidateTokenCache();  // Clear cached size
 *
 * // In getContent():
 * const content = this.formatContent();
 * this.updateTokenCache(this.estimator.estimateTokens(content));  // Update cache
 * return content;
 * ```
 *
 * ## Content Format
 *
 * `getContent()` should return Markdown with a descriptive header:
 *
 * ```markdown
 * ## Plugin Display Name (optional stats)
 *
 * Formatted content here...
 * - Entry 1: value
 * - Entry 2: value
 * ```
 *
 * Built-in plugins use these headers:
 * - WorkingMemory: `## Working Memory (N entries)`
 * - InContextMemory: `## Live Context (N entries)`
 * - PersistentInstructions: No header (user's raw instructions)
 *
 * ## Tool Naming Convention
 *
 * Use a consistent prefix based on plugin name:
 * - `working_memory` plugin → `memory_store`, `memory_retrieve`, `memory_delete`, `memory_list`
 * - `in_context_memory` plugin → `context_set`, `context_delete`, `context_list`
 * - `persistent_instructions` plugin → `instructions_set`, `instructions_remove`, `instructions_list`, `instructions_clear`
 *
 * ## State Serialization
 *
 * `getState()` and `restoreState()` are **synchronous** for simplicity.
 * If your plugin has async data, consider:
 * - Storing only references/keys in state
 * - Using a separate async initialization method
 *
 * @example
 * ```typescript
 * class MyPlugin extends BasePluginNextGen {
 *   readonly name = 'my_plugin';
 *   private _data = new Map<string, string>();
 *
 *   getInstructions(): string {
 *     return '## My Plugin\n\nUse my_plugin_set to store data...';
 *   }
 *
 *   async getContent(): Promise<string | null> {
 *     if (this._data.size === 0) return null;
 *     const lines = [...this._data].map(([k, v]) => `- ${k}: ${v}`);
 *     const content = `## My Plugin (${this._data.size} entries)\n\n${lines.join('\n')}`;
 *     this.updateTokenCache(this.estimator.estimateTokens(content));
 *     return content;
 *   }
 *
 *   getTools(): ToolFunction[] {
 *     return [myPluginSetTool, myPluginGetTool];
 *   }
 *
 *   getState(): unknown {
 *     return { data: Object.fromEntries(this._data) };
 *   }
 *
 *   restoreState(state: unknown): void {
 *     const s = state as { data: Record<string, string> };
 *     this._data = new Map(Object.entries(s.data || {}));
 *     this.invalidateTokenCache();
 *   }
 * }
 * ```
 */
interface IContextPluginNextGen {
    /** Unique plugin name (used for lookup and tool prefixing) */
    readonly name: string;
    /**
     * Get usage instructions for the LLM.
     *
     * Returns static text explaining how to use this plugin's tools
     * and data. This is placed in the system message and is NEVER
     * compacted - it persists throughout the conversation.
     *
     * Instructions should include:
     * - What the plugin does
     * - How to use available tools
     * - Best practices and conventions
     *
     * @returns Instructions string or null if no instructions needed
     *
     * @example
     * ```typescript
     * getInstructions(): string {
     *   return `## Working Memory
     *
     * Use memory_store to save important data for later retrieval.
     * Use memory_retrieve to recall previously stored data.
     *
     * Best practices:
     * - Use descriptive keys like 'user_preferences' not 'data1'
     * - Store intermediate results that may be needed later`;
     * }
     * ```
     */
    getInstructions(): string | null;
    /**
     * Get formatted content to include in system message.
     *
     * Returns the plugin's current state formatted for LLM consumption.
     * Should be Markdown with a `## Header`. This content CAN be compacted
     * if `isCompactable()` returns true.
     *
     * **IMPORTANT:** Call `updateTokenCache()` with the content's token size
     * before returning to keep budget calculations accurate.
     *
     * @returns Formatted content string or null if empty
     *
     * @example
     * ```typescript
     * async getContent(): Promise<string | null> {
     *   if (this._entries.size === 0) return null;
     *
     *   const lines = this._entries.map(e => `- ${e.key}: ${e.value}`);
     *   const content = `## My Plugin (${this._entries.size} entries)\n\n${lines.join('\n')}`;
     *
     *   // IMPORTANT: Update token cache before returning
     *   this.updateTokenCache(this.estimator.estimateTokens(content));
     *   return content;
     * }
     * ```
     */
    getContent(): Promise<string | null>;
    /**
     * Get the full raw contents of this plugin for inspection.
     *
     * Used by library clients to programmatically inspect plugin state.
     * Returns the actual data structure, not the formatted string.
     *
     * @returns Raw plugin data (entries map, array, etc.)
     */
    getContents(): unknown;
    /**
     * Get current token size of plugin content.
     *
     * Returns the cached token count from the last `updateTokenCache()` call.
     * This is used for budget calculation in `prepare()`.
     *
     * The cache should be updated via `updateTokenCache()` whenever content
     * changes. If cache is null, returns 0.
     *
     * @returns Current token count (0 if no content or cache not set)
     */
    getTokenSize(): number;
    /**
     * Get token size of instructions (cached after first call).
     *
     * Instructions are static, so this is computed once and cached.
     * Used for budget calculation.
     *
     * @returns Token count for instructions (0 if no instructions)
     */
    getInstructionsTokenSize(): number;
    /**
     * Whether this plugin's content can be compacted when context is tight.
     *
     * Return true if the plugin can reduce its content size when requested.
     * Examples: evicting low-priority entries, summarizing, removing old data.
     *
     * Return false if content cannot be reduced (e.g., critical state).
     *
     * @returns true if compact() can free tokens
     */
    isCompactable(): boolean;
    /**
     * Compact plugin content to free tokens.
     *
     * Called by compaction strategies when context is too full.
     * Should attempt to free **approximately** `targetTokensToFree` tokens.
     *
     * This is a **best effort** operation:
     * - May free more or less than requested
     * - May return 0 if nothing can be compacted (e.g., all entries are critical)
     * - Should prioritize removing lowest-priority/oldest data first
     *
     * Strategies may include:
     * - Evicting low-priority entries
     * - Summarizing verbose content
     * - Removing oldest data
     * - Truncating large values
     *
     * **IMPORTANT:** Call `invalidateTokenCache()` or `updateTokenCache()`
     * after modifying content.
     *
     * @param targetTokensToFree - Approximate tokens to free (best effort)
     * @returns Actual tokens freed (may be 0 if nothing can be compacted)
     *
     * @example
     * ```typescript
     * async compact(targetTokensToFree: number): Promise<number> {
     *   const before = this.getTokenSize();
     *   let freed = 0;
     *
     *   // Remove low-priority entries until target reached
     *   const sorted = [...this._entries].sort(byPriority);
     *   for (const entry of sorted) {
     *     if (entry.priority === 'critical') continue; // Never remove critical
     *     if (freed >= targetTokensToFree) break;
     *
     *     freed += entry.tokens;
     *     this._entries.delete(entry.key);
     *   }
     *
     *   this.invalidateTokenCache();
     *   return freed;
     * }
     * ```
     */
    compact(targetTokensToFree: number): Promise<number>;
    /**
     * Get tools provided by this plugin.
     *
     * Tools are automatically registered with ToolManager when the plugin
     * is added to the context. Use a consistent naming convention:
     * `<prefix>_<action>` (e.g., `memory_store`, `context_set`).
     *
     * @returns Array of tool definitions (empty array if no tools)
     */
    getTools(): ToolFunction[];
    /**
     * Cleanup resources when context is destroyed.
     *
     * Called when AgentContextNextGen.destroy() is invoked.
     * Use for releasing resources, closing connections, etc.
     */
    destroy(): void;
    /**
     * Serialize plugin state for session persistence.
     *
     * **MUST be synchronous.** Return a JSON-serializable object representing
     * the plugin's current state. This is called when saving a session.
     *
     * For plugins with async data (e.g., external storage), return only
     * references/keys here and handle async restoration separately.
     *
     * @returns Serializable state object
     *
     * @example
     * ```typescript
     * getState(): unknown {
     *   return {
     *     entries: [...this._entries].map(([k, v]) => ({ key: k, ...v })),
     *     version: 1,  // Include version for future migrations
     *   };
     * }
     * ```
     */
    getState(): unknown;
    /**
     * Restore plugin state from serialized data.
     *
     * Called when loading a saved session. The state comes from a previous
     * `getState()` call on the same plugin type.
     *
     * **IMPORTANT:** Call `invalidateTokenCache()` after restoring state
     * to ensure token counts are recalculated.
     *
     * @param state - Previously serialized state from getState()
     *
     * @example
     * ```typescript
     * restoreState(state: unknown): void {
     *   const s = state as { entries: Array<{ key: string; value: unknown }> };
     *   this._entries.clear();
     *   for (const entry of s.entries || []) {
     *     this._entries.set(entry.key, entry);
     *   }
     *   this.invalidateTokenCache(); // IMPORTANT: refresh token cache
     * }
     * ```
     */
    restoreState(state: unknown): void;
}
/**
 * Token budget breakdown - clear and simple
 */
interface ContextBudget {
    /** Maximum context tokens for the model */
    maxTokens: number;
    /** Tokens reserved for LLM response */
    responseReserve: number;
    /** Tokens used by system message (prompt + instructions + plugin content) */
    systemMessageTokens: number;
    /** Tokens used by tool definitions (NEVER compacted) */
    toolsTokens: number;
    /** Tokens used by conversation history */
    conversationTokens: number;
    /** Tokens used by current input (user message or tool results) */
    currentInputTokens: number;
    /** Total tokens used */
    totalUsed: number;
    /** Available tokens (maxTokens - responseReserve - totalUsed) */
    available: number;
    /** Usage percentage (totalUsed / (maxTokens - responseReserve)) */
    utilizationPercent: number;
    /** Breakdown by component for debugging */
    breakdown: {
        systemPrompt: number;
        persistentInstructions: number;
        pluginInstructions: number;
        pluginContents: Record<string, number>;
        tools: number;
        conversation: number;
        currentInput: number;
    };
}
/**
 * Result of prepare() - ready for LLM call
 */
interface PreparedContext {
    /** Final input items array for LLM */
    input: InputItem[];
    /** Token budget breakdown */
    budget: ContextBudget;
    /** Whether compaction was performed */
    compacted: boolean;
    /** Log of compaction actions taken */
    compactionLog: string[];
}
/**
 * Result of handling oversized current input
 */
interface OversizedInputResult {
    /** Whether the input was accepted (possibly truncated) */
    accepted: boolean;
    /** Processed content (truncated if needed) */
    content: string;
    /** Error message if rejected */
    error?: string;
    /** Warning message if truncated */
    warning?: string;
    /** Original size in bytes */
    originalSize: number;
    /** Final size in bytes */
    finalSize: number;
}
/**
 * Feature flags for enabling/disabling plugins
 */
interface ContextFeatures {
    /** Enable WorkingMemory plugin (default: true) */
    workingMemory?: boolean;
    /** Enable InContextMemory plugin (default: false) */
    inContextMemory?: boolean;
    /** Enable PersistentInstructions plugin (default: false) */
    persistentInstructions?: boolean;
    /** Enable UserInfo plugin (default: false) */
    userInfo?: boolean;
    /** Enable ToolCatalog plugin for dynamic tool loading/unloading (default: false) */
    toolCatalog?: boolean;
}
/**
 * Default feature configuration
 */
declare const DEFAULT_FEATURES: Required<ContextFeatures>;
/**
 * Plugin configurations for auto-initialization.
 * When features are enabled, plugins are created with these configs.
 * The config shapes match each plugin's constructor parameter.
 */
interface PluginConfigs {
    /**
     * Working memory plugin config (used when features.workingMemory=true).
     * See WorkingMemoryPluginConfig for full options.
     */
    workingMemory?: Record<string, unknown>;
    /**
     * In-context memory plugin config (used when features.inContextMemory=true).
     * See InContextMemoryConfig for full options.
     */
    inContextMemory?: Record<string, unknown>;
    /**
     * Persistent instructions plugin config (used when features.persistentInstructions=true).
     * Note: agentId is auto-filled from context config if not provided.
     * See PersistentInstructionsConfig for full options.
     */
    persistentInstructions?: Record<string, unknown>;
    /**
     * User info plugin config (used when features.userInfo=true).
     * See UserInfoPluginConfig for full options.
     */
    userInfo?: Record<string, unknown>;
    /**
     * Tool catalog plugin config (used when features.toolCatalog=true).
     * See ToolCatalogPluginConfig for full options.
     */
    toolCatalog?: Record<string, unknown>;
}
/**
 * AgentContextNextGen configuration
 */
interface AgentContextNextGenConfig {
    /** Model name (used for context window lookup) */
    model: string;
    /** Maximum context tokens (auto-detected from model if not provided) */
    maxContextTokens?: number;
    /** Tokens to reserve for response (default: 4096) */
    responseReserve?: number;
    /** System prompt provided by user */
    systemPrompt?: string;
    /**
     * Compaction strategy name (default: 'default').
     * Used to create strategy from StrategyRegistry if compactionStrategy not provided.
     */
    strategy?: string;
    /**
     * Custom compaction strategy instance.
     * If provided, overrides the `strategy` option.
     */
    compactionStrategy?: ICompactionStrategy;
    /** Feature flags */
    features?: ContextFeatures;
    /** Agent ID (required for PersistentInstructions) */
    agentId?: string;
    /** User ID for multi-user scenarios. Automatically flows to ToolContext for all tool executions. */
    userId?: string;
    /**
     * Restrict this agent to specific auth identities (connector + optional account alias).
     * When set, only these identities are visible in ToolContext and tool descriptions.
     * Each identity produces its own tool set (e.g., microsoft_work_api, microsoft_personal_api).
     * When not set, all connectors visible to the current userId are available.
     */
    identities?: AuthIdentity[];
    /** Initial tools to register */
    tools?: ToolFunction[];
    /** Storage for session persistence */
    storage?: IContextStorage;
    /** Restrict tool catalog to specific categories */
    toolCategories?: ToolCategoryScope;
    /** Plugin-specific configurations (used with features flags) */
    plugins?: PluginConfigs;
    /**
     * Hard timeout in milliseconds for any single tool execution.
     * Acts as a safety net: if a tool's own timeout mechanism fails
     * (e.g. a child process doesn't exit), this will force-resolve with an error.
     * Default: 0 (disabled - relies on each tool's own timeout)
     */
    toolExecutionTimeout?: number;
}
/**
 * Default configuration values
 */
declare const DEFAULT_CONFIG: {
    responseReserve: number;
    strategy: string;
};

/**
 * Events emitted by AgentContextNextGen
 */
interface ContextEvents {
    /** Emitted when context is prepared */
    'context:prepared': {
        budget: ContextBudget;
        compacted: boolean;
    };
    /** Emitted when compaction is performed */
    'context:compacted': {
        tokensFreed: number;
        log: string[];
    };
    /** Emitted right after budget is calculated in prepare() - for reactive monitoring */
    'budget:updated': {
        budget: ContextBudget;
        timestamp: number;
    };
    /** Emitted when budget reaches warning threshold (>70%) */
    'budget:warning': {
        budget: ContextBudget;
    };
    /** Emitted when budget reaches critical threshold (>90%) */
    'budget:critical': {
        budget: ContextBudget;
    };
    /** Emitted when compaction is about to start */
    'compaction:starting': {
        budget: ContextBudget;
        targetTokensToFree: number;
        timestamp: number;
    };
    /** Emitted when current input is too large */
    'input:oversized': {
        result: OversizedInputResult;
    };
    /** Emitted when a message is added */
    'message:added': {
        role: string;
        index: number;
    };
    /** Emitted when conversation is cleared */
    'conversation:cleared': {
        reason?: string;
    };
}
/**
 * Callback type for beforeCompaction hook.
 * Called before compaction starts, allowing agents to save important data.
 */
type BeforeCompactionCallback = (info: {
    budget: ContextBudget;
    targetTokensToFree: number;
    strategy: string;
}) => Promise<void>;
/**
 * Result of compact() operation.
 */
interface CompactionResult {
    /** Tokens actually freed by compaction */
    tokensFreed: number;
    /** Number of messages removed from conversation */
    messagesRemoved: number;
    /** Names of plugins that were compacted */
    pluginsCompacted: string[];
    /** Log of actions taken during compaction */
    log: string[];
}
/**
 * Result of consolidate() operation.
 */
interface ConsolidationResult {
    /** Whether any consolidation was performed */
    performed: boolean;
    /** Net token change (negative = freed, positive = added, e.g., summaries) */
    tokensChanged: number;
    /** Description of actions taken */
    actions: string[];
}
/**
 * Read-only context passed to compaction strategies.
 * Provides access to data needed for compaction decisions and
 * controlled methods to modify state.
 */
interface CompactionContext {
    /** Current budget (from prepare) */
    readonly budget: ContextBudget;
    /** Current conversation history (read-only) */
    readonly conversation: ReadonlyArray<InputItem>;
    /** Current input (read-only) */
    readonly currentInput: ReadonlyArray<InputItem>;
    /** Registered plugins (for querying state) */
    readonly plugins: ReadonlyArray<IContextPluginNextGen>;
    /** Strategy name for logging */
    readonly strategyName: string;
    /**
     * Remove messages by indices.
     * Handles tool pair preservation internally.
     *
     * @param indices - Array of message indices to remove
     * @returns Tokens actually freed
     */
    removeMessages(indices: number[]): Promise<number>;
    /**
     * Compact a specific plugin.
     *
     * @param pluginName - Name of the plugin to compact
     * @param targetTokens - Approximate tokens to free
     * @returns Tokens actually freed
     */
    compactPlugin(pluginName: string, targetTokens: number): Promise<number>;
    /**
     * Estimate tokens for an item.
     *
     * @param item - Input item to estimate
     * @returns Estimated token count
     */
    estimateTokens(item: InputItem): number;
}
/**
 * Compaction strategy interface.
 *
 * Strategies implement two methods:
 * - `compact()`: Emergency compaction when thresholds exceeded (called from prepare())
 * - `consolidate()`: Post-cycle cleanup and optimization (called after agentic loop)
 *
 * Use `compact()` for quick, threshold-based token reduction.
 * Use `consolidate()` for more expensive operations like summarization.
 */
interface ICompactionStrategy {
    /** Strategy name (unique identifier) for identification and logging */
    readonly name: string;
    /** Human-readable display name for UI */
    readonly displayName: string;
    /** Description explaining the strategy behavior */
    readonly description: string;
    /** Threshold percentage (0-1) at which compact() is triggered */
    readonly threshold: number;
    /**
     * Plugin names this strategy requires to function.
     * Validation is performed when strategy is assigned to context.
     * If any required plugin is missing, an error is thrown.
     *
     * @example
     * ```typescript
     * readonly requiredPlugins = ['working_memory'] as const;
     * ```
     */
    readonly requiredPlugins?: readonly string[];
    /**
     * Emergency compaction - triggered when context usage exceeds threshold.
     * Called from prepare() when utilization > threshold.
     *
     * Should be fast and focus on freeing tokens quickly.
     *
     * @param context - Compaction context with controlled access to state
     * @param targetToFree - Approximate tokens to free
     * @returns Result describing what was done
     */
    compact(context: CompactionContext, targetToFree: number): Promise<CompactionResult>;
    /**
     * Post-cycle consolidation - run after agentic cycle completes.
     * Called from Agent after run()/stream() finishes (before session save).
     *
     * Use for more expensive operations:
     * - Summarizing long conversations
     * - Memory optimization and deduplication
     * - Promoting important data to persistent storage
     *
     * @param context - Compaction context with controlled access to state
     * @returns Result describing what was done
     */
    consolidate(context: CompactionContext): Promise<ConsolidationResult>;
}

/**
 * LLM Response entity based on OpenAI Responses API format
 */

/**
 * Token usage statistics
 */
interface TokenUsage {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    output_tokens_details?: {
        reasoning_tokens: number;
    };
}
interface LLMResponse {
    id: string;
    object: 'response';
    created_at: number;
    status: 'completed' | 'failed' | 'in_progress' | 'cancelled' | 'queued' | 'incomplete';
    model: string;
    output: OutputItem[];
    output_text?: string;
    thinking?: string;
    usage: TokenUsage;
    error?: {
        type: string;
        message: string;
    };
    metadata?: Record<string, string>;
}
type AgentResponse = LLMResponse;

/**
 * Streaming event types for real-time LLM responses
 * Based on OpenAI Responses API event format as the internal standard
 */

/**
 * Stream event type enum
 */
declare enum StreamEventType {
    RESPONSE_CREATED = "response.created",
    RESPONSE_IN_PROGRESS = "response.in_progress",
    OUTPUT_TEXT_DELTA = "response.output_text.delta",
    OUTPUT_TEXT_DONE = "response.output_text.done",
    TOOL_CALL_START = "response.tool_call.start",
    TOOL_CALL_ARGUMENTS_DELTA = "response.tool_call_arguments.delta",
    TOOL_CALL_ARGUMENTS_DONE = "response.tool_call_arguments.done",
    TOOL_EXECUTION_START = "response.tool_execution.start",
    TOOL_EXECUTION_DONE = "response.tool_execution.done",
    ITERATION_COMPLETE = "response.iteration.complete",
    REASONING_DELTA = "response.reasoning.delta",
    REASONING_DONE = "response.reasoning.done",
    RESPONSE_COMPLETE = "response.complete",
    ERROR = "response.error"
}
/**
 * Base interface for all stream events
 */
interface BaseStreamEvent {
    type: StreamEventType;
    response_id: string;
}
/**
 * Response created - first event in stream
 */
interface ResponseCreatedEvent extends BaseStreamEvent {
    type: StreamEventType.RESPONSE_CREATED;
    model: string;
    created_at: number;
}
/**
 * Response in progress
 */
interface ResponseInProgressEvent extends BaseStreamEvent {
    type: StreamEventType.RESPONSE_IN_PROGRESS;
}
/**
 * Text delta - incremental text output
 */
interface OutputTextDeltaEvent extends BaseStreamEvent {
    type: StreamEventType.OUTPUT_TEXT_DELTA;
    item_id: string;
    output_index: number;
    content_index: number;
    delta: string;
    sequence_number: number;
}
/**
 * Text output complete for this item
 */
interface OutputTextDoneEvent extends BaseStreamEvent {
    type: StreamEventType.OUTPUT_TEXT_DONE;
    item_id: string;
    output_index: number;
    text: string;
}
/**
 * Tool call detected and starting
 */
interface ToolCallStartEvent extends BaseStreamEvent {
    type: StreamEventType.TOOL_CALL_START;
    item_id: string;
    tool_call_id: string;
    tool_name: string;
}
/**
 * Tool call arguments delta - incremental JSON
 */
interface ToolCallArgumentsDeltaEvent extends BaseStreamEvent {
    type: StreamEventType.TOOL_CALL_ARGUMENTS_DELTA;
    item_id: string;
    tool_call_id: string;
    tool_name: string;
    delta: string;
    sequence_number: number;
}
/**
 * Tool call arguments complete
 */
interface ToolCallArgumentsDoneEvent extends BaseStreamEvent {
    type: StreamEventType.TOOL_CALL_ARGUMENTS_DONE;
    tool_call_id: string;
    tool_name: string;
    arguments: string;
    incomplete?: boolean;
}
/**
 * Tool execution starting
 */
interface ToolExecutionStartEvent extends BaseStreamEvent {
    type: StreamEventType.TOOL_EXECUTION_START;
    tool_call_id: string;
    tool_name: string;
    arguments: any;
}
/**
 * Tool execution complete
 */
interface ToolExecutionDoneEvent extends BaseStreamEvent {
    type: StreamEventType.TOOL_EXECUTION_DONE;
    tool_call_id: string;
    tool_name: string;
    result: any;
    execution_time_ms: number;
    error?: string;
}
/**
 * Iteration complete - end of agentic loop iteration
 */
interface IterationCompleteEvent$1 extends BaseStreamEvent {
    type: StreamEventType.ITERATION_COMPLETE;
    iteration: number;
    tool_calls_count: number;
    has_more_iterations: boolean;
}
/**
 * Response complete - final event
 */
interface ResponseCompleteEvent extends BaseStreamEvent {
    type: StreamEventType.RESPONSE_COMPLETE;
    status: 'completed' | 'incomplete' | 'failed';
    usage: TokenUsage;
    iterations: number;
    duration_ms?: number;
}
/**
 * Reasoning/thinking delta - incremental reasoning output
 */
interface ReasoningDeltaEvent extends BaseStreamEvent {
    type: StreamEventType.REASONING_DELTA;
    item_id: string;
    delta: string;
    sequence_number: number;
}
/**
 * Reasoning/thinking complete for this item
 */
interface ReasoningDoneEvent extends BaseStreamEvent {
    type: StreamEventType.REASONING_DONE;
    item_id: string;
    thinking: string;
}
/**
 * Error event
 */
interface ErrorEvent extends BaseStreamEvent {
    type: StreamEventType.ERROR;
    error: {
        type: string;
        message: string;
        code?: string;
    };
    recoverable: boolean;
}
/**
 * Union type of all stream events
 * Discriminated by 'type' field for type narrowing
 */
type StreamEvent = ResponseCreatedEvent | ResponseInProgressEvent | OutputTextDeltaEvent | OutputTextDoneEvent | ReasoningDeltaEvent | ReasoningDoneEvent | ToolCallStartEvent | ToolCallArgumentsDeltaEvent | ToolCallArgumentsDoneEvent | ToolExecutionStartEvent | ToolExecutionDoneEvent | IterationCompleteEvent$1 | ResponseCompleteEvent | ErrorEvent;
/**
 * Type guard to check if event is a specific type
 */
declare function isStreamEvent<T extends StreamEvent>(event: StreamEvent, type: StreamEventType): event is T;
/**
 * Type guards for specific events
 */
declare function isOutputTextDelta(event: StreamEvent): event is OutputTextDeltaEvent;
declare function isToolCallStart(event: StreamEvent): event is ToolCallStartEvent;
declare function isToolCallArgumentsDelta(event: StreamEvent): event is ToolCallArgumentsDeltaEvent;
declare function isToolCallArgumentsDone(event: StreamEvent): event is ToolCallArgumentsDoneEvent;
declare function isReasoningDelta(event: StreamEvent): event is ReasoningDeltaEvent;
declare function isReasoningDone(event: StreamEvent): event is ReasoningDoneEvent;
declare function isResponseComplete(event: StreamEvent): event is ResponseCompleteEvent;
declare function isErrorEvent(event: StreamEvent): event is ErrorEvent;

/**
 * Text generation provider interface
 */

interface TextGenerateOptions {
    model: string;
    input: string | InputItem[];
    instructions?: string;
    tools?: Tool[];
    tool_choice?: 'auto' | 'required' | {
        type: 'function';
        function: {
            name: string;
        };
    };
    temperature?: number;
    max_output_tokens?: number;
    response_format?: {
        type: 'text' | 'json_object' | 'json_schema';
        json_schema?: any;
    };
    parallel_tool_calls?: boolean;
    previous_response_id?: string;
    metadata?: Record<string, string>;
    /** Vendor-agnostic thinking/reasoning configuration */
    thinking?: {
        enabled: boolean;
        /** Budget in tokens for thinking (Anthropic & Google) */
        budgetTokens?: number;
        /** Reasoning effort level (OpenAI) */
        effort?: 'low' | 'medium' | 'high';
    };
    /** Vendor-specific options (e.g., Google's thinkingLevel, OpenAI's reasoning_effort) */
    vendorOptions?: Record<string, any>;
}
interface ModelCapabilities {
    supportsTools: boolean;
    supportsVision: boolean;
    supportsJSON: boolean;
    supportsJSONSchema: boolean;
    maxTokens: number;
    maxInputTokens?: number;
    maxOutputTokens?: number;
}
interface ITextProvider extends IProvider {
    /**
     * Generate text response
     */
    generate(options: TextGenerateOptions): Promise<LLMResponse>;
    /**
     * Stream text response with real-time events
     * Returns an async iterator of streaming events
     */
    streamGenerate(options: TextGenerateOptions): AsyncIterableIterator<StreamEvent>;
    /**
     * Get model capabilities
     */
    getModelCapabilities(model: string): ModelCapabilities;
    /**
     * List available models from the provider's API
     */
    listModels(): Promise<string[]>;
}

/**
 * Execution context - tracks state, metrics, and history for agent execution
 * Includes memory safety (circular buffers) and resource limits
 */

type HistoryMode = 'none' | 'summary' | 'full';
interface ExecutionContextConfig {
    maxHistorySize?: number;
    historyMode?: HistoryMode;
    maxAuditTrailSize?: number;
}
interface IterationRecord {
    iteration: number;
    request: TextGenerateOptions;
    response: AgentResponse;
    toolCalls: ToolCall[];
    toolResults: ToolResult[];
    startTime: Date;
    endTime: Date;
}
interface IterationSummary {
    iteration: number;
    tokens: number;
    toolCount: number;
    duration: number;
    timestamp: Date;
}
interface ExecutionMetrics {
    totalDuration: number;
    llmDuration: number;
    toolDuration: number;
    hookDuration: number;
    iterationCount: number;
    toolCallCount: number;
    toolSuccessCount: number;
    toolFailureCount: number;
    toolTimeoutCount: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    errors: Array<{
        type: string;
        message: string;
        timestamp: Date;
    }>;
}
interface AuditEntry {
    timestamp: Date;
    type: 'hook_executed' | 'tool_modified' | 'tool_skipped' | 'execution_paused' | 'execution_resumed' | 'tool_approved' | 'tool_rejected' | 'tool_blocked' | 'tool_permission_approved';
    hookName?: string;
    toolName?: string;
    details: any;
}
declare class ExecutionContext {
    readonly executionId: string;
    readonly startTime: Date;
    iteration: number;
    readonly toolCalls: Map<string, ToolCall>;
    readonly toolResults: Map<string, ToolResult>;
    paused: boolean;
    pauseReason?: string;
    cancelled: boolean;
    cancelReason?: string;
    readonly metadata: Map<string, any>;
    private readonly config;
    private readonly iterations;
    private readonly iterationSummaries;
    readonly metrics: ExecutionMetrics;
    private readonly auditTrail;
    constructor(executionId: string, config?: ExecutionContextConfig);
    /**
     * Add iteration to history (memory-safe)
     */
    addIteration(record: IterationRecord): void;
    /**
     * Get iteration history
     */
    getHistory(): IterationRecord[] | IterationSummary[];
    /**
     * Add audit entry
     */
    audit(type: AuditEntry['type'], details: any, hookName?: string, toolName?: string): void;
    /**
     * Get audit trail
     */
    getAuditTrail(): readonly AuditEntry[];
    /**
     * Update metrics
     */
    updateMetrics(update: Partial<ExecutionMetrics>): void;
    /**
     * Add tool call to tracking
     */
    addToolCall(toolCall: ToolCall): void;
    /**
     * Add tool result to tracking
     */
    addToolResult(result: ToolResult): void;
    /**
     * Check resource limits
     */
    checkLimits(limits?: {
        maxExecutionTime?: number;
        maxToolCalls?: number;
        maxContextSize?: number;
    }): void;
    /**
     * Estimate memory usage (rough approximation)
     */
    private estimateSize;
    /**
     * Cleanup resources and release memory
     * Clears all internal arrays and maps to allow garbage collection
     */
    cleanup(): void;
    /**
     * Get execution summary
     */
    getSummary(): {
        executionId: string;
        startTime: Date;
        currentIteration: number;
        paused: boolean;
        cancelled: boolean;
        metrics: {
            totalDuration: number;
            llmDuration: number;
            toolDuration: number;
            hookDuration: number;
            iterationCount: number;
            toolCallCount: number;
            toolSuccessCount: number;
            toolFailureCount: number;
            toolTimeoutCount: number;
            inputTokens: number;
            outputTokens: number;
            totalTokens: number;
            errors: Array<{
                type: string;
                message: string;
                timestamp: Date;
            }>;
        };
        totalDuration: number;
    };
}

/**
 * Minimal config type for execution start events.
 * This captures the essential info without importing full AgentConfig.
 */
interface ExecutionConfig {
    model: string;
    instructions?: string;
    temperature?: number;
    maxIterations?: number;
}
interface ExecutionStartEvent {
    executionId: string;
    config: ExecutionConfig;
    timestamp: Date;
}
interface ExecutionCompleteEvent {
    executionId: string;
    response: AgentResponse;
    timestamp: Date;
    duration: number;
}
interface ExecutionErrorEvent {
    executionId: string;
    error: Error;
    timestamp: Date;
}
interface ExecutionPausedEvent {
    executionId: string;
    reason?: string;
    timestamp: Date;
}
interface ExecutionResumedEvent {
    executionId: string;
    timestamp: Date;
}
interface ExecutionCancelledEvent {
    executionId: string;
    reason?: string;
    timestamp: Date;
}
interface ExecutionEmptyOutputEvent {
    executionId: string;
    timestamp: Date;
    duration: number;
    usage?: TokenUsage;
}
interface ExecutionMaxIterationsEvent {
    executionId: string;
    iteration: number;
    maxIterations: number;
    timestamp: Date;
}
interface IterationStartEvent {
    executionId: string;
    iteration: number;
    timestamp: Date;
}
interface IterationCompleteEvent {
    executionId: string;
    iteration: number;
    response: AgentResponse;
    timestamp: Date;
    duration: number;
}
interface LLMRequestEvent {
    executionId: string;
    iteration: number;
    options: TextGenerateOptions;
    timestamp: Date;
}
interface LLMResponseEvent {
    executionId: string;
    iteration: number;
    response: AgentResponse;
    timestamp: Date;
    duration: number;
}
interface LLMErrorEvent {
    executionId: string;
    iteration: number;
    error: Error;
    timestamp: Date;
}
interface ToolDetectedEvent {
    executionId: string;
    iteration: number;
    toolCalls: ToolCall[];
    timestamp: Date;
}
interface ToolStartEvent {
    executionId: string;
    iteration: number;
    toolCall: ToolCall;
    timestamp: Date;
}
interface ToolCompleteEvent {
    executionId: string;
    iteration: number;
    toolCall: ToolCall;
    result: ToolResult;
    timestamp: Date;
}
interface ToolErrorEvent {
    executionId: string;
    iteration: number;
    toolCall: ToolCall;
    error: Error;
    timestamp: Date;
}
interface ToolTimeoutEvent {
    executionId: string;
    iteration: number;
    toolCall: ToolCall;
    timeout: number;
    timestamp: Date;
}
interface HookErrorEvent {
    executionId: string;
    hookName: string;
    error: Error;
    timestamp: Date;
}
interface CircuitOpenedEvent {
    executionId: string;
    breakerName: string;
    failureCount: number;
    lastError: string;
    nextRetryTime: number;
    timestamp: Date;
}
interface CircuitHalfOpenEvent {
    executionId: string;
    breakerName: string;
    timestamp: Date;
}
interface CircuitClosedEvent {
    executionId: string;
    breakerName: string;
    successCount: number;
    timestamp: Date;
}
/**
 * Map of all event names to their payload types
 */
interface AgenticLoopEvents {
    'execution:start': ExecutionStartEvent;
    'execution:complete': ExecutionCompleteEvent;
    'execution:error': ExecutionErrorEvent;
    'execution:paused': ExecutionPausedEvent;
    'execution:resumed': ExecutionResumedEvent;
    'execution:cancelled': ExecutionCancelledEvent;
    'execution:maxIterations': ExecutionMaxIterationsEvent;
    'iteration:start': IterationStartEvent;
    'iteration:complete': IterationCompleteEvent;
    'llm:request': LLMRequestEvent;
    'llm:response': LLMResponseEvent;
    'llm:error': LLMErrorEvent;
    'tool:detected': ToolDetectedEvent;
    'tool:start': ToolStartEvent;
    'tool:complete': ToolCompleteEvent;
    'tool:error': ToolErrorEvent;
    'tool:timeout': ToolTimeoutEvent;
    'hook:error': HookErrorEvent;
    'execution:empty_output': ExecutionEmptyOutputEvent;
    'circuit:opened': CircuitOpenedEvent;
    'circuit:half-open': CircuitHalfOpenEvent;
    'circuit:closed': CircuitClosedEvent;
}
type AgenticLoopEventName = keyof AgenticLoopEvents;
/**
 * Agent events - alias for AgenticLoopEvents for cleaner API
 * This is the preferred export name going forward.
 */
type AgentEvents = AgenticLoopEvents;
type AgentEventName = AgenticLoopEventName;

/**
 * Hook types for agent execution
 * Hooks can modify execution flow synchronously or asynchronously
 */

/**
 * Base hook function type
 */
type Hook<TContext, TResult = any> = (context: TContext) => TResult | Promise<TResult>;
/**
 * Hook that can modify data
 */
type ModifyingHook<TContext, TModification> = Hook<TContext, TModification>;
interface BeforeExecutionContext {
    executionId: string;
    config: ExecutionConfig;
    timestamp: Date;
}
interface AfterExecutionContext {
    executionId: string;
    response: AgentResponse;
    context: ExecutionContext;
    timestamp: Date;
    duration: number;
}
interface BeforeLLMContext {
    executionId: string;
    iteration: number;
    options: TextGenerateOptions;
    context: ExecutionContext;
    timestamp: Date;
}
interface AfterLLMContext {
    executionId: string;
    iteration: number;
    response: AgentResponse;
    context: ExecutionContext;
    timestamp: Date;
    duration: number;
}
interface BeforeToolContext {
    executionId: string;
    iteration: number;
    toolCall: ToolCall;
    context: ExecutionContext;
    timestamp: Date;
}
interface AfterToolContext {
    executionId: string;
    iteration: number;
    toolCall: ToolCall;
    result: ToolResult;
    context: ExecutionContext;
    timestamp: Date;
}
interface ApproveToolContext {
    executionId: string;
    iteration: number;
    toolCall: ToolCall;
    context: ExecutionContext;
    timestamp: Date;
}
interface PauseCheckContext {
    executionId: string;
    iteration: number;
    context: ExecutionContext;
    timestamp: Date;
}
interface LLMModification {
    modified?: Partial<TextGenerateOptions>;
    skip?: boolean;
    reason?: string;
}
interface ToolModification {
    modified?: Partial<ToolCall>;
    skip?: boolean;
    mockResult?: any;
    reason?: string;
}
interface ToolResultModification {
    modified?: Partial<ToolResult>;
    retry?: boolean;
    reason?: string;
}
interface ApprovalResult {
    approved: boolean;
    reason?: string;
    modifiedArgs?: any;
}
interface PauseDecision {
    shouldPause: boolean;
    reason?: string;
}
interface HookConfig {
    'before:execution'?: Hook<BeforeExecutionContext, void>;
    'after:execution'?: Hook<AfterExecutionContext, void>;
    'before:llm'?: ModifyingHook<BeforeLLMContext, LLMModification>;
    'after:llm'?: ModifyingHook<AfterLLMContext, {}>;
    'before:tool'?: ModifyingHook<BeforeToolContext, ToolModification>;
    'after:tool'?: ModifyingHook<AfterToolContext, ToolResultModification>;
    'approve:tool'?: Hook<ApproveToolContext, ApprovalResult>;
    'pause:check'?: Hook<PauseCheckContext, PauseDecision>;
    hookTimeout?: number;
    parallelHooks?: boolean;
}
type HookName = keyof Omit<HookConfig, 'hookTimeout' | 'parallelHooks'>;
/**
 * Map of hook names to their context and result types
 */
interface HookSignatures {
    'before:execution': {
        context: BeforeExecutionContext;
        result: void;
    };
    'after:execution': {
        context: AfterExecutionContext;
        result: void;
    };
    'before:llm': {
        context: BeforeLLMContext;
        result: LLMModification;
    };
    'after:llm': {
        context: AfterLLMContext;
        result: {};
    };
    'before:tool': {
        context: BeforeToolContext;
        result: ToolModification;
    };
    'after:tool': {
        context: AfterToolContext;
        result: ToolResultModification;
    };
    'approve:tool': {
        context: ApproveToolContext;
        result: ApprovalResult;
    };
    'pause:check': {
        context: PauseCheckContext;
        result: PauseDecision;
    };
}

/**
 * Hook manager - handles hook registration and execution
 * Includes error isolation, timeouts, and optional parallel execution
 */

declare class HookManager {
    private hooks;
    private timeout;
    private parallel;
    private hookErrorCounts;
    private disabledHooks;
    private maxConsecutiveErrors;
    private emitter;
    constructor(config: HookConfig | undefined, emitter: EventEmitter, errorHandling?: {
        maxConsecutiveErrors?: number;
    });
    /**
     * Register hooks from configuration
     */
    private registerFromConfig;
    /**
     * Register a hook
     */
    register(name: HookName, hook: Hook<any, any>): void;
    /**
     * Unregister a specific hook function by reference.
     * Returns true if the hook was found and removed.
     */
    unregister(name: HookName, hook: Hook<any, any>): boolean;
    /**
     * Execute hooks for a given name
     */
    executeHooks<K extends HookName>(name: K, context: HookSignatures[K]['context'], defaultResult: HookSignatures[K]['result']): Promise<HookSignatures[K]['result']>;
    /**
     * Execute hooks sequentially
     */
    private executeHooksSequential;
    /**
     * Execute hooks in parallel
     */
    private executeHooksParallel;
    /**
     * Generate unique key for a hook
     */
    private getHookKey;
    /**
     * Execute single hook with error isolation and timeout (with per-hook error tracking)
     */
    private executeHookSafely;
    /**
     * Check if there are any hooks registered
     */
    hasHooks(name: HookName): boolean;
    /**
     * Get hook count
     */
    getHookCount(name?: HookName): number;
    /**
     * Clear all hooks and reset error tracking
     */
    clear(): void;
    /**
     * Re-enable a disabled hook
     */
    enableHook(hookKey: string): void;
    /**
     * Get list of disabled hooks
     */
    getDisabledHooks(): string[];
}

export { StreamEventType as $, type AgentContextNextGenConfig as A, type BeforeCompactionCallback as B, type ContextFeatures as C, type HookName as D, ExecutionContext as E, type FunctionToolDefinition as F, type ITokenEstimator as G, type HookConfig as H, type IContextStorage as I, type ToolCategoryScope as J, type CompactionContext as K, type LLMResponse as L, type MemoryEntry as M, type CompactionResult as N, type OutputItem as O, type PriorityCalculator as P, type StaleEntryInfo as Q, type PriorityContext as R, type SerializedContextState as S, type Tool as T, type MemoryIndex as U, type TaskStatusForMemory as V, type WorkingMemoryConfig as W, type WorkingMemoryAccess as X, type ContextStorageListOptions as Y, type ContextSessionSummary as Z, type TokenUsage as _, type MemoryScope as a, getToolCallDescription as a$, type TextGenerateOptions as a0, type ModelCapabilities as a1, MessageRole as a2, type AfterToolContext as a3, type AgentEventName as a4, type AgenticLoopEventName as a5, type AgenticLoopEvents as a6, type ApprovalResult as a7, type ApproveToolContext as a8, type BeforeToolContext as a9, type OversizedInputResult as aA, type PluginConfigs as aB, type ReasoningDeltaEvent as aC, type ReasoningDoneEvent as aD, type ReasoningItem as aE, type ResponseCompleteEvent as aF, type ResponseCreatedEvent as aG, type ResponseInProgressEvent as aH, type SimpleScope as aI, type TaskAwareScope as aJ, type ThinkingContent as aK, type ToolCallArgumentsDeltaEvent as aL, type ToolCallArgumentsDoneEvent as aM, type ToolCallStartEvent as aN, ToolCallState as aO, ToolCatalogRegistry as aP, type ToolCategoryDefinition as aQ, type ToolExecutionContext as aR, type ToolExecutionDoneEvent as aS, type ToolExecutionStartEvent as aT, type ToolModification as aU, type ToolResultContent as aV, type ToolUseContent as aW, calculateEntrySize as aX, defaultDescribeCall as aY, forPlan as aZ, forTasks as a_, type BuiltInTool as aa, CONTEXT_SESSION_FORMAT_VERSION as ab, type ToolRegistryEntry as ac, type CatalogToolEntry as ad, type CompactionItem as ae, type ConnectorCategoryInfo as af, ContentType as ag, DEFAULT_CONFIG as ah, DEFAULT_FEATURES as ai, DEFAULT_MEMORY_CONFIG as aj, type ErrorEvent as ak, type ExecutionConfig as al, type Hook as am, HookManager as an, type InputImageContent as ao, type InputTextContent as ap, type IterationCompleteEvent$1 as aq, type JSONSchema as ar, MEMORY_PRIORITY_VALUES as as, type MemoryEntryInput as at, type MemoryIndexEntry as au, type Message as av, type ModifyingHook as aw, type OutputTextContent as ax, type OutputTextDeltaEvent as ay, type OutputTextDoneEvent as az, type ToolFunction as b, isErrorEvent as b0, isOutputTextDelta as b1, isReasoningDelta as b2, isReasoningDone as b3, isResponseComplete as b4, isSimpleScope as b5, isStreamEvent as b6, isTaskAwareScope as b7, isTerminalMemoryStatus as b8, isToolCallArgumentsDelta as b9, isToolCallArgumentsDone as ba, isToolCallStart as bb, scopeEquals as bc, scopeMatches as bd, type ExecutionCompleteEvent as be, type ExecutionStartEvent as bf, type LLMRequestEvent as bg, type LLMResponseEvent as bh, type ToolCompleteEvent as bi, type ToolStartEvent as bj, type ToolContext as c, type ToolPermissionConfig as d, type ContextBudget as e, type ToolCall as f, type IContextPluginNextGen as g, type MemoryPriority as h, type MemoryTier as i, type ContextEvents as j, type AuthIdentity as k, type ICompactionStrategy as l, type InputItem as m, type Content as n, type PreparedContext as o, type ToolResult as p, type ConsolidationResult as q, type StoredContextSession as r, type ITextProvider as s, type ContextSessionMetadata as t, type StreamEvent as u, type HistoryMode as v, type AgentEvents as w, type AgentResponse as x, type ExecutionMetrics as y, type AuditEntry as z };
