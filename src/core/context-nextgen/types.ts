/**
 * AgentContextNextGen - Type Definitions
 *
 * Clean, minimal type definitions for the next-generation context manager.
 */

import type { InputItem } from '../../domain/entities/Message.js';
import type { ToolFunction } from '../../domain/entities/Tool.js';
import type { ToolContext } from '../../domain/entities/Tool.js';
import type { IContextStorage as IContextStorageFromDomain } from '../../domain/interfaces/IContextStorage.js';
import type { ToolCategoryScope } from '../ToolCatalogRegistry.js';

// ============================================================================
// Auth Identity
// ============================================================================

/**
 * A single auth identity: connector + optional account alias.
 *
 * Used to scope agents to specific OAuth accounts. When `accountId` is set,
 * the identity represents a specific multi-account OAuth session (e.g., 'work'
 * or 'personal' Microsoft account). When omitted, uses the connector's default account.
 */
export interface AuthIdentity {
  /** Name of the registered connector */
  connector: string;

  /** Optional account alias for multi-account OAuth (e.g., 'work', 'personal') */
  accountId?: string;

  /**
   * Optional: restrict which tools are generated for this identity.
   * Each entry is matched against the tool's base name (the part after the
   * connector prefix, e.g., 'send_email' from 'microsoft_work_send_email').
   *
   * When set, only tools whose name ends with `_<suffix>` or equals `<suffix>` are generated.
   * When absent, ALL tools for this connector are generated.
   */
  toolFilter?: string[];
}

// ============================================================================
// Token Estimation
// ============================================================================

/**
 * Token estimator interface - used for conversation and input estimation
 * Plugins handle their own token estimation internally.
 */
export interface ITokenEstimator {
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

// ============================================================================
// Plugin Interface
// ============================================================================

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
 * - WorkingMemory: `## Notes (N entries)`
 * - InContextMemory: `## Whiteboard (N entries)`
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
export interface IContextPluginNextGen {
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

  /**
   * Called at the top of `AgentContextNextGen.prepare()` — BEFORE system
   * message assembly, token budgeting, and compaction. Purpose: give
   * side-effect plugins (e.g. session-learning ingestors) a chance to
   * observe the accumulated conversation before compaction potentially
   * evicts messages.
   *
   * The plugin receives a SNAPSHOT of the conversation messages and current
   * input at the time prepare() fires. Implementers should synchronously
   * capture what they need from the snapshot and kick off any async work —
   * this method is NOT awaited by `prepare()`, and the caller of `prepare()`
   * will proceed regardless. Throwing from this method is swallowed (logged)
   * so a failing side-effect plugin cannot break context preparation.
   *
   * Default: no-op (most plugins don't need this).
   *
   * @param snapshot - Read-only snapshot of conversation + current input.
   */
  onBeforePrepare?(snapshot: PluginPrepareSnapshot): void;
}

/**
 * Snapshot handed to `onBeforePrepare` plugin hooks. Fields are read-only
 * references — do not mutate.
 */
export interface PluginPrepareSnapshot {
  /** The full conversation history at this point. */
  readonly messages: ReadonlyArray<unknown>;
  /** The current turn's user input (not yet merged into conversation). */
  readonly currentInput: ReadonlyArray<unknown>;
}

// ============================================================================
// Store Handler Interface (Unified CRUD for Plugins)
// ============================================================================

/**
 * Describes a store's schema for dynamic tool description generation.
 * The `descriptionFactory` on each store tool uses this to build
 * a comparison table so the LLM knows which store to use.
 */
export interface StoreEntrySchema {
  /** Short identifier used as the `store` parameter value (e.g., "notes", "whiteboard") */
  storeId: string;

  /** Human-readable store name (e.g., "Notes", "Whiteboard") */
  displayName: string;

  /** One-line description of what this store holds */
  description: string;

  /**
   * "Use for:" guidance — tells the LLM when to pick this store.
   * Should include explicit "NOT for:" guidance referencing other stores.
   */
  usageHint: string;

  /**
   * Human-readable description of the data fields accepted by storeSet.
   * Shown in the store_set tool description. One line per field.
   * Example: "description (required): Brief description of the data"
   */
  setDataFields: string;

  /**
   * Available actions for store_action, keyed by action name.
   * If undefined or empty, this store has no actions.
   */
  actions?: Record<string, {
    /** What this action does */
    description: string;
    /** Human-readable params description */
    paramsDescription?: string;
    /** If true, requires confirm: true parameter */
    destructive?: boolean;
  }>;
}

/**
 * Result types for store operations.
 * These are intentionally loose (Record-based) to accommodate
 * store-specific fields in responses.
 */
export interface StoreGetResult {
  found: boolean;
  key?: string;
  /** Single entry data (when key provided) */
  entry?: Record<string, unknown>;
  /** All entries (when no key provided) */
  entries?: Array<Record<string, unknown>>;
}

export interface StoreSetResult {
  success: boolean;
  key: string;
  message?: string;
  [k: string]: unknown;
}

export interface StoreDeleteResult {
  deleted: boolean;
  key: string;
}

export interface StoreListResult {
  entries: Array<Record<string, unknown>>;
  total?: number;
}

export interface StoreActionResult {
  success: boolean;
  action: string;
  [k: string]: unknown;
}

/**
 * Interface for plugins that provide CRUD storage.
 *
 * When a plugin implements both `IContextPluginNextGen` and `IStoreHandler`,
 * it automatically gets the 5 generic `store_*` tools — no tool creation needed.
 *
 * ## How to implement a custom CRUD plugin
 *
 * 1. Create a class that extends `BasePluginNextGen` and implements `IStoreHandler`
 * 2. Implement `getStoreSchema()` — describes your store for tool descriptions
 * 3. Implement the 5 handler methods (storeGet, storeSet, storeDelete, storeList)
 * 4. Optionally implement `storeAction()` for non-CRUD operations
 * 5. Write `getInstructions()` — explains when to use YOUR store vs others
 * 6. Register with `ctx.registerPlugin(yourPlugin)` — store tools auto-include it
 *
 * Your plugin does NOT need to define any tools via `getTools()`.
 * The `StoreToolsManager` creates the 5 `store_*` tools once and routes
 * calls to the correct handler based on the `store` parameter.
 *
 * @example
 * ```typescript
 * class NotesPlugin extends BasePluginNextGen implements IStoreHandler {
 *   readonly name = 'notes';
 *   private notes = new Map<string, { text: string; tag?: string }>();
 *
 *   getStoreSchema(): StoreEntrySchema {
 *     return {
 *       storeId: 'notes',
 *       displayName: 'Notes',
 *       description: 'Simple text notes with optional tags',
 *       usageHint: 'Use for: quick notes. NOT for structured data (use "memory").',
 *       setDataFields: 'text (required): Note content\ntag?: Optional category tag',
 *     };
 *   }
 *
 *   async storeGet(key?: string) { ... }
 *   async storeSet(key: string, data: Record<string, unknown>) { ... }
 *   async storeDelete(key: string) { ... }
 *   async storeList(filter?: Record<string, unknown>) { ... }
 *
 *   getInstructions() {
 *     return 'Store name: "notes". Use store_set("notes", key, { text, tag? }).';
 *   }
 *   async getContent() { ... }
 *   getContents() { return Object.fromEntries(this.notes); }
 * }
 * ```
 */
export interface IStoreHandler {
  /** Return the store's schema for dynamic tool descriptions */
  getStoreSchema(): StoreEntrySchema;

  /** Get one entry by key, or all entries if key is undefined */
  storeGet(key?: string, context?: ToolContext): Promise<StoreGetResult>;

  /** Create or update an entry */
  storeSet(key: string, data: Record<string, unknown>, context?: ToolContext): Promise<StoreSetResult>;

  /** Delete an entry by key */
  storeDelete(key: string, context?: ToolContext): Promise<StoreDeleteResult>;

  /** List entries with optional filter */
  storeList(filter?: Record<string, unknown>, context?: ToolContext): Promise<StoreListResult>;

  /** Execute a store-specific action (optional — only needed if store has actions) */
  storeAction?(action: string, params?: Record<string, unknown>, context?: ToolContext): Promise<StoreActionResult>;
}

/**
 * Type guard to check if a plugin implements IStoreHandler.
 */
export function isStoreHandler(plugin: IContextPluginNextGen): plugin is IContextPluginNextGen & IStoreHandler {
  return (
    'getStoreSchema' in plugin &&
    'storeGet' in plugin &&
    'storeSet' in plugin &&
    'storeDelete' in plugin &&
    'storeList' in plugin &&
    typeof (plugin as IStoreHandler).getStoreSchema === 'function'
  );
}

// ============================================================================
// Compaction Strategy
// ============================================================================

// ============================================================================
// Context Budget
// ============================================================================

/**
 * Token budget breakdown - clear and simple
 */
export interface ContextBudget {
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

// ============================================================================
// Prepared Context
// ============================================================================

/**
 * Result of prepare() - ready for LLM call
 */
export interface PreparedContext {
  /** Final input items array for LLM */
  input: InputItem[];

  /** Token budget breakdown */
  budget: ContextBudget;

  /** Whether compaction was performed */
  compacted: boolean;

  /** Log of compaction actions taken */
  compactionLog: string[];
}

// ============================================================================
// Current Input Handling
// ============================================================================

/**
 * Result of handling oversized current input
 */
export interface OversizedInputResult {
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

// ============================================================================
// Configuration
// ============================================================================

/**
 * Feature flags for enabling/disabling plugins
 */
/**
 * Known feature flags for built-in plugins (provides autocomplete/docs).
 * External plugins register via PluginRegistry and use arbitrary string keys.
 */
export interface KnownContextFeatures {
  /** Enable WorkingMemory plugin (default: true) */
  workingMemory?: boolean;

  /** Enable InContextMemory plugin (default: false) */
  inContextMemory?: boolean;

  /** Enable PersistentInstructions plugin (default: false). @deprecated prefer the `memory` feature. */
  persistentInstructions?: boolean;

  /** Enable UserInfo plugin (default: false). @deprecated prefer the `memory` feature. */
  userInfo?: boolean;

  /** Enable ToolCatalog plugin for dynamic tool loading/unloading (default: false) */
  toolCatalog?: boolean;

  /** Enable SharedWorkspace plugin for multi-agent coordination (default: false) */
  sharedWorkspace?: boolean;

  /** Enable Memory plugin for self-learning knowledge store (default: false, READ-ONLY tools). Requires `plugins.memory.memory: MemorySystem` in config. */
  memory?: boolean;

  /** Enable Memory-write sidecar (default: false). Adds the 6 write tools (remember/link/forget/restore/upsert_entity/set_agent_rule). Requires `memory: true`. */
  memoryWrite?: boolean;
}

/**
 * Feature flags for enabling/disabling plugins.
 * Known keys provide autocomplete; arbitrary string keys are also accepted
 * for externally registered plugins (via PluginRegistry).
 */
export type ContextFeatures = KnownContextFeatures & { [key: string]: boolean | undefined };

/**
 * Resolved features — all known keys guaranteed present, plus any extras.
 * Used internally after merging with DEFAULT_FEATURES.
 */
export type ResolvedContextFeatures = Required<KnownContextFeatures> & Record<string, boolean>;

/**
 * Default feature configuration for built-in plugins.
 */
export const DEFAULT_FEATURES: Required<KnownContextFeatures> = {
  workingMemory: true,
  inContextMemory: true,
  persistentInstructions: false,
  userInfo: false,
  toolCatalog: false,
  sharedWorkspace: false,
  memory: false,
  memoryWrite: false,
};

// ============================================================================
// Plugin Configurations (for auto-initialization)
// ============================================================================

/**
 * Plugin configurations for auto-initialization.
 * When features are enabled, plugins are created with these configs.
 * The config shapes match each plugin's constructor parameter.
 */
/**
 * Known plugin configurations for built-in plugins (provides autocomplete/docs).
 */
export interface KnownPluginConfigs {
  /** Working memory plugin config. See WorkingMemoryPluginConfig. */
  workingMemory?: Record<string, unknown>;
  /** In-context memory plugin config. See InContextMemoryConfig. */
  inContextMemory?: Record<string, unknown>;
  /** Persistent instructions plugin config. See PersistentInstructionsConfig. Note: agentId auto-filled. */
  persistentInstructions?: Record<string, unknown>;
  /** User info plugin config. See UserInfoPluginConfig. */
  userInfo?: Record<string, unknown>;
  /** Tool catalog plugin config. See ToolCatalogPluginConfig. */
  toolCatalog?: Record<string, unknown>;
  /** Shared workspace plugin config. See SharedWorkspaceConfig. */
  sharedWorkspace?: Record<string, unknown>;
  /** Memory plugin config. See MemoryPluginConfig. `agentId` auto-filled from context. `userId` auto-filled from context if unset. Requires `memory: MemorySystem`. */
  memory?: Record<string, unknown>;
  /** Memory-write plugin config. See MemoryWritePluginConfig. Shares `memory` / `agentId` / `userId` with the memory plugin when unset. */
  memoryWrite?: Record<string, unknown>;
}

/**
 * Plugin configurations for auto-initialization.
 * Known keys provide autocomplete; arbitrary string keys accepted
 * for externally registered plugins (via PluginRegistry).
 */
export type PluginConfigs = KnownPluginConfigs & { [key: string]: Record<string, unknown> | undefined };

/**
 * AgentContextNextGen configuration
 */
export interface AgentContextNextGenConfig {
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
  storage?: IContextStorageFromDomain;

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

  /**
   * Filter which message types are written to the history journal.
   * When set, only entries matching these types are appended.
   * Default: undefined (all types journaled).
   * Example: ['user', 'assistant'] to exclude tool_result entries.
   */
  journalFilter?: import('../../domain/interfaces/IHistoryJournal.js').HistoryEntryType[];
}

/**
 * Default configuration values
 */
export const DEFAULT_CONFIG = {
  responseReserve: 4096,
  strategy: 'algorithmic',
};

// ============================================================================
// Storage Interface (re-exported from domain for convenience)
// ============================================================================

/**
 * Re-export storage types from domain layer.
 * Domain is the single source of truth for these interfaces.
 */
export type {
  IContextStorage,
  SerializedContextState,
  StoredContextSession,
  ContextSessionMetadata,
} from '../../domain/interfaces/IContextStorage.js';

// ============================================================================
// Events
// ============================================================================

/**
 * Events emitted by AgentContextNextGen
 */
export interface ContextEvents {
  /** Emitted when context is prepared */
  'context:prepared': { budget: ContextBudget; compacted: boolean };

  /** Emitted when compaction is performed */
  'context:compacted': { tokensFreed: number; log: string[] };

  /** Emitted right after budget is calculated in prepare() - for reactive monitoring */
  'budget:updated': { budget: ContextBudget; timestamp: number };

  /** Emitted when budget reaches warning threshold (>70%) */
  'budget:warning': { budget: ContextBudget };

  /** Emitted when budget reaches critical threshold (>90%) */
  'budget:critical': { budget: ContextBudget };

  /** Emitted when compaction is about to start */
  'compaction:starting': {
    budget: ContextBudget;
    targetTokensToFree: number;
    timestamp: number;
  };

  /** Emitted when current input is too large */
  'input:oversized': { result: OversizedInputResult };

  /** Emitted when a message is added */
  'message:added': { role: string; index: number };

  /** Emitted when conversation is cleared */
  'conversation:cleared': { reason?: string };
}

/**
 * Callback type for beforeCompaction hook.
 * Called before compaction starts, allowing agents to save important data.
 */
export type BeforeCompactionCallback = (info: {
  budget: ContextBudget;
  targetTokensToFree: number;
  strategy: string;
}) => Promise<void>;

// ============================================================================
// Compaction Strategy Interface (Pluggable)
// ============================================================================

/**
 * Result of compact() operation.
 */
export interface CompactionResult {
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
export interface ConsolidationResult {
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
export interface CompactionContext {
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
   * Describe a tool call using the tool's describeCall function.
   * Returns a human-readable summary of the tool call args (e.g., "src/core/Agent.ts [lines 100-200]").
   * Returns undefined if the tool is not found or has no describeCall.
   */
  describeToolCall?(toolName: string, toolArgs: unknown): string | undefined;

  // === Methods for strategy to modify state (controlled access) ===

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
export interface ICompactionStrategy {
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
