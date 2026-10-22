/**
 * AgentContextNextGen - Type Definitions
 *
 * Clean, minimal type definitions for the next-generation context manager.
 */

import type { InputItem } from '../../domain/entities/Message.js';
import type { FunctionToolDefinition, ToolFunction } from '../../domain/entities/Tool.js';
import type { ToolContext } from '../../domain/entities/Tool.js';
import type { IContextStorage as IContextStorageFromDomain } from '../../domain/interfaces/IContextStorage.js';
import type { ToolCategoryScope } from '../ToolCatalogRegistry.js';
import type { TextGenerateOptions } from '../../domain/interfaces/ITextProvider.js';

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

  /**
   * Lock the on-behalf-of user identity for this identity's tool instances
   * (Microsoft Graph `/users/{id}`, Google API `userId`). Set ONCE here and
   * the LLM cannot override it at call time.
   *
   * - When set: the per-tool `targetUser` schema parameter is OMITTED and this
   *   value is always used.
   * - When unset: existing behavior (LLM supplies `targetUser` for app-only auth).
   * - Silently ignored for delegated connectors (identity already bound by token).
   */
  actAs?: string;
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
 * Plugins implementing IStoreHandler share the unified `store_*` tools, routed
 * by store ID: `notes`, `whiteboard`, or `instructions`. Other plugins use their
 * own consistent tool prefix.
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
   * Use store_set with store="notes" to save data for later retrieval.
   * Use store_get with store="notes" and an exact key to read stored values.
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
   * Force any lazy initialization to complete.
   *
   * Called by the routine runner before deterministic pre-steps execute, so
   * tools the plugin contributes can rely on the plugin's bootstrapped state
   * (e.g. `MemoryPluginNextGen.userEntityId`, which resolves the `me` subject
   * token). Without this, pre-steps that invoke a plugin's tools BEFORE the
   * first `getContent()` call would see uninitialised state.
   *
   * Implementations must be idempotent — `prepare()` may be called multiple
   * times across an agent's lifetime; each call after the first should be a
   * no-op (or return the same in-flight promise).
   *
   * Optional: plugins with no lazy state need not implement it.
   *
   * @returns Resolves when the plugin is ready to be queried.
   */
  prepare?(): Promise<void>;

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

  /** Description of the store and its retrieval behavior, included in store_get guidance. */
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
  /** Store-specific default view without a key; may contain only index metadata. */
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

/** Optional request contributions, resolved again after compaction. */
export interface ContextPrepareOptions {
  /** Optional bounded pre-call compaction cancellation. */
  signal?: AbortSignal;
  /** Host-owned structured-summary generator; Agent binds its configured compactor. */
  summarize?: import('./strategies/conversation-compaction.js').ContextSummaryGenerator;
  /** Obtain the exact visible definitions, including dynamic descriptions and identity filtering. */
  getTools?: () => FunctionToolDefinition[];
  /** Additional top-level instructions sent separately from the context input. */
  instructions?: string;
  /** Resolve known request contributions from the selected tools; synchronous, without context mutation. */
  getRequestOptions?: (tools: FunctionToolDefinition[]) =>
    Pick<TextGenerateOptions, 'instructions' | 'response_format' | 'native_tools'>;
  /** Usable capacity advertised by the initially selected provider/model; explicit host limits remain an upper bound. */
  modelMaxContextTokens?: number;
}

/** Diagnostic snapshot of the last successful prepare; token counts are estimates. */
export interface ContextPreparation {
  /** Diagnostic for the opt-in transactional built-ins in this preparation. */
  selection?: import('./assembly.js').ContextSelectionManifest;
  compaction?: import('./strategies/conversation-compaction.js').ConversationCompactionReport;
  /** Monotonic, process-local successful preparation number. */
  revision: number;
  /** Millisecond timestamp at selection; later context mutations do not refresh it. */
  preparedAt: number;
  /** Estimated budget for that selected request, including final host-hook adjustments. */
  budget: ContextBudget;
}

/** Result of prepare() - ready for a model call. */
export interface PreparedContext {
  /** Snapshot of tool definitions counted for this request (additive). */
  tools?: FunctionToolDefinition[];
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
  /** Host-controlled protected task view; disabled by default. Requires plugins.taskState. */
  taskState?: boolean;

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
 * Resolved features retain the original required keys, plus optional additions
 * and arbitrary external flags. Keep the required set stable so adding an opt-in
 * feature does not break existing snapshot/configuration consumers. Live contexts
 * still merge every known default; older constructed snapshots can omit additions.
 */
export type ResolvedContextFeatures = KnownContextFeatures & Required<Pick<KnownContextFeatures,
  | 'workingMemory' | 'inContextMemory' | 'persistentInstructions' | 'userInfo'
  | 'toolCatalog' | 'sharedWorkspace' | 'memory' | 'memoryWrite'
>> & Record<string, boolean>;

/**
 * Default feature configuration for built-in plugins.
 */
export const DEFAULT_FEATURES: Required<KnownContextFeatures> = {
  taskState: false,
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
  /** Built-in host task/scope config, or an existing external taskState factory's record.
   * Use TaskStatePluginConfig for strict built-in validation; runtime validates the
   * built-in when no external factory owns this feature key.
   */
  taskState?: import('./plugins/TaskStatePluginNextGen.js').TaskStatePluginConfig | Record<string, unknown>;

  /** Opt-in durable evidence. Enable features.evidence; scope and policy are host-owned. */
  evidence?: Record<string, unknown>;
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
  /** Optional budgeted data contributions and explicit stable-prefix layout; host-owned, never restored from sessions. */
  assembly?: import('./assembly.js').ContextAssemblyConfig;
  /** Model name (used for context window lookup) */
  model: string;

  /** Maximum context tokens (auto-detected from model if not provided) */
  maxContextTokens?: number;

  /** Tokens to reserve for response (default: 4096) */
  responseReserve?: number;

  /**
   * Utilization ratio (of available content budget) at which compaction is
   * allowed to run. Below this, NO compaction happens — every message,
   * including all tool results, stays verbatim in the input array for the
   * duration of the agentic loop. Compaction (and any strategy-driven spill of
   * tool results to working memory) only kicks in once utilization crosses
   * this "critical" line. Default: 0.9 (CONTEXT_DEFAULTS.HARD_LIMIT).
   *
   * This is intentionally decoupled from the compaction strategy's own
   * `threshold` (which now only governs how far DOWN to reclaim once critical
   * is hit), so tool-heavy agents keep their reads inline until the context is
   * genuinely close to full. The emergency oversized-input path
   * (handleOversizedInput) remains the true last-resort safety valve for a
   * single batch that alone exceeds the window.
   */
  criticalCompactionThreshold?: number;

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
   * Viewer's IANA timezone (e.g. 'America/New_York'). Flows to ToolContext
   * (`timeZone`) and to the memory plugin, so tools and injected memory
   * content render instants as wall-clock time in this zone instead of UTC —
   * the model never converts. Display-only; stored instants are unchanged.
   * The library is otherwise timezone-agnostic: the host supplies this
   * explicitly; the library never reads entity metadata to discover it. When
   * omitted, times are rendered/returned as stored (UTC).
   */
  timezone?: string;

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
  /**
   * Compaction only triggers once utilization crosses this critical line.
   * Below it, all tool results stay verbatim in the input array. 0.9 mirrors
   * CONTEXT_DEFAULTS.HARD_LIMIT.
   */
  criticalCompactionThreshold: 0.9,
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

  /** Emitted after an explicit context rollover commits atomically. */
  'context:rolled_over': { result: ContextRolloverResult; timestamp: number };
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
  /** Additive opt-in strategy diagnostic; legacy result shapes remain valid. */
  report?: import('./strategies/conversation-compaction.js').ConversationCompactionReport;
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
 * Input passed to a context-rollover summarizer.
 *
 * `items` is a detached clone of the older conversation prefix. Mutating it
 * cannot mutate the live context. Recent turns are intentionally excluded
 * because they remain verbatim after rollover.
 */
export interface ContextRolloverSummaryInput {
  /** Older conversation items that must be represented by the summary. */
  readonly items: ReadonlyArray<InputItem>;

  /** Estimated size of `items`, using the context's configured estimator. */
  readonly estimatedTokens: number;

  /** Number of recent user turns that will remain verbatim. */
  readonly preservedRecentTurns: number;

  /** Optional host-provided reason for observability or prompt selection. */
  readonly reason?: string;
}

/** Host-supplied summarizer used by an explicit context rollover. */
export type ContextRolloverSummarizer = (
  input: ContextRolloverSummaryInput,
) => Promise<string> | string;

/** Options for an explicit context rollover. */
export interface ContextRolloverOptions {
  /**
   * Number of most-recent user turns to keep byte-for-byte. Tool calls and
   * their results stay with their containing turn. Default: 8.
   */
  preserveRecentTurns?: number;

  /** Summarize the older prefix. The live context changes only after success. */
  summarize: ContextRolloverSummarizer;

  /** Optional reason included in the result and rollover event. */
  reason?: string;
}

/** Result of an explicit context rollover. */
export interface ContextRolloverResult {
  /** Whether an older prefix existed and was replaced by a summary capsule. */
  performed: boolean;

  /** Estimated conversation tokens before rollover. */
  beforeTokens: number;

  /** Estimated conversation tokens after rollover. */
  afterTokens: number;

  /** Net estimated tokens freed (may be negative for an unusually long summary). */
  tokensFreed: number;

  /** Number of older message items represented by the summary. */
  itemsSummarized: number;

  /** Number of exact recent/opaque items retained alongside the summary. */
  itemsRetained: number;

  /** Number of recent user turns retained verbatim. */
  retainedTurns: number;

  /** Estimated token size of the generated summary capsule. */
  summaryTokens: number;

  /** Optional host-provided reason. */
  reason?: string;
}

/**
 * Read-only context passed to compaction strategies.
 * Provides access to data needed for compaction decisions and
 * controlled methods to modify state.
 */
export interface CompactionContext {
  /** Optional transactional capability supplied by NextGen preparation. Legacy contexts remain valid. */
  compactConversation?(options: import('./strategies/conversation-compaction.js').ConversationCompactionOptions): Promise<CompactionResult>;
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

  /** Reclaim threshold (0-1); the context critical gate decides when compact() runs. */
  readonly threshold: number;

  /**
   * Plugin names this strategy requires to function.
   * Validation is performed when strategy is assigned to context.
   * Missing recommendations produce a warning; strategies own missing-plugin behavior.
   * Transactional built-ins require source retention; legacy built-ins may degrade.
   *
   * @example
   * ```typescript
   * readonly requiredPlugins = ['working_memory'] as const;
   * ```
   */
  readonly requiredPlugins?: readonly string[];

  /**
   * Emergency compaction - triggered when content usage exceeds the context critical gate.
   * The strategy threshold controls how far to reclaim, not when preparation triggers.
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
