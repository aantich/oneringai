/**
 * InContextMemoryPluginNextGen - In-context key-value storage for NextGen context
 *
 * Unlike WorkingMemory (external storage with index), InContextMemory stores
 * data DIRECTLY in the LLM context. Values are immediately visible.
 *
 * Use for:
 * - Current state/status that changes frequently
 * - User preferences during a session
 * - Small accumulated results
 * - Counters, flags, control variables
 *
 * Do NOT use for:
 * - Large data (use WorkingMemory)
 * - Rarely accessed reference data
 */

import type { IContextPluginNextGen, ITokenEstimator, IStoreHandler, StoreEntrySchema, StoreGetResult, StoreSetResult, StoreDeleteResult, StoreListResult } from '../types.js';
import type { ToolFunction, ToolContext } from '../../../domain/entities/Tool.js';
import { simpleTokenEstimator } from '../BasePluginNextGen.js';

// ============================================================================
// Types
// ============================================================================

export type InContextPriority = 'low' | 'normal' | 'high' | 'critical';

export interface InContextEntry {
  key: string;
  description: string;
  value: unknown;
  updatedAt: number;
  priority: InContextPriority;
  /** If true, this entry is displayed in the user's side panel UI */
  showInUI?: boolean;
}

export interface InContextMemoryConfig {
  /** Maximum number of entries (default: 20) */
  maxEntries?: number;
  /** Maximum total tokens for all entries (default: 4000) */
  maxTotalTokens?: number;
  /** Default priority for new entries (default: 'normal') */
  defaultPriority?: InContextPriority;
  /** Whether to show timestamps in output (default: false) */
  showTimestamps?: boolean;
  /** Callback fired when entries change. Receives all current entries. */
  onEntriesChanged?: (entries: InContextEntry[]) => void;
}

export interface SerializedInContextMemoryState {
  entries: InContextEntry[];
}

// ============================================================================
// Constants
// ============================================================================

const PRIORITY_VALUES: Record<InContextPriority, number> = {
  low: 1,
  normal: 2,
  high: 3,
  critical: 4,
};

const DEFAULT_CONFIG = {
  maxEntries: 20,
  maxTotalTokens: 40000,
  defaultPriority: 'normal' as InContextPriority,
  showTimestamps: false,
};

// ============================================================================
// Instructions
// ============================================================================

const IN_CONTEXT_MEMORY_INSTRUCTIONS = `Store: "context". Values are DIRECTLY visible in your context window every turn \u2014 no retrieval needed.

**Priority levels** (for eviction when space is tight):
- \`low\`: Evicted first. Temporary data.
- \`normal\`: Default. Standard importance.
- \`high\`: Keep longer. Important state.
- \`critical\`: Never auto-evicted.

**UI Display:** Set \`showInUI: true\` to display the entry in the user's side panel.
Values shown in the UI support the same rich markdown formatting as the chat window
(see formatting instructions above). Use this for dashboards, progress displays, and results the user should see.`;

// ============================================================================
// Plugin Implementation
// ============================================================================

export class InContextMemoryPluginNextGen implements IContextPluginNextGen, IStoreHandler {
  readonly name = 'in_context_memory';

  private entries: Map<string, InContextEntry> = new Map();
  private config: {
    maxEntries: number;
    maxTotalTokens: number;
    defaultPriority: InContextPriority;
    showTimestamps: boolean;
    onEntriesChanged?: (entries: InContextEntry[]) => void;
  };
  private estimator: ITokenEstimator = simpleTokenEstimator;

  private _destroyed = false;
  private _tokenCache: number | null = null;
  private _instructionsTokenCache: number | null = null;
  private _notifyTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(config: InContextMemoryConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ============================================================================
  // IContextPluginNextGen Implementation
  // ============================================================================

  getInstructions(): string {
    return IN_CONTEXT_MEMORY_INSTRUCTIONS;
  }

  async getContent(): Promise<string | null> {
    if (this.entries.size === 0) {
      return null;
    }

    const content = this.formatEntries();
    this._tokenCache = this.estimator.estimateTokens(content);
    return content;
  }

  getContents(): Map<string, InContextEntry> {
    return new Map(this.entries);
  }

  getTokenSize(): number {
    return this._tokenCache ?? 0;
  }

  getInstructionsTokenSize(): number {
    if (this._instructionsTokenCache === null) {
      this._instructionsTokenCache = this.estimator.estimateTokens(IN_CONTEXT_MEMORY_INSTRUCTIONS);
    }
    return this._instructionsTokenCache;
  }

  isCompactable(): boolean {
    return true;
  }

  async compact(targetTokensToFree: number): Promise<number> {
    // TODO: Implement smart compaction
    // For now, evict lowest priority entries until we free enough
    const before = this.getTokenSize();

    const evictable = Array.from(this.entries.values())
      .filter(e => e.priority !== 'critical')
      .sort((a, b) => {
        const priorityDiff = PRIORITY_VALUES[a.priority] - PRIORITY_VALUES[b.priority];
        if (priorityDiff !== 0) return priorityDiff;
        return a.updatedAt - b.updatedAt; // Oldest first within same priority
      });

    let freed = 0;
    let evicted = false;
    for (const entry of evictable) {
      if (freed >= targetTokensToFree) break;
      const entryTokens = this.estimator.estimateTokens(this.formatEntry(entry));
      this.entries.delete(entry.key);
      freed += entryTokens;
      evicted = true;
    }

    this._tokenCache = null;
    const content = await this.getContent();
    const after = content ? this.estimator.estimateTokens(content) : 0;

    if (evicted) this.notifyEntriesChanged();

    return Math.max(0, before - after);
  }

  getTools(): ToolFunction[] {
    return [];
  }

  destroy(): void {
    if (this._destroyed) return;
    if (this._notifyTimer) clearTimeout(this._notifyTimer);
    this.entries.clear();
    this._destroyed = true;
    this._tokenCache = null;
  }

  getState(): SerializedInContextMemoryState {
    return {
      entries: Array.from(this.entries.values()),
    };
  }

  restoreState(state: unknown): void {
    const s = state as SerializedInContextMemoryState;
    if (!s || !s.entries) return;

    this.entries.clear();
    for (const entry of s.entries) {
      this.entries.set(entry.key, entry);
    }
    this._tokenCache = null;
    this.notifyEntriesChanged();
  }

  // ============================================================================
  // Entry Management
  // ============================================================================

  /**
   * Store or update a key-value pair
   */
  set(key: string, description: string, value: unknown, priority?: InContextPriority, showInUI?: boolean): void {
    this.assertNotDestroyed();

    const entry: InContextEntry = {
      key,
      description,
      value,
      updatedAt: Date.now(),
      priority: priority ?? this.config.defaultPriority,
      showInUI: showInUI ?? false,
    };

    this.entries.set(key, entry);
    this.enforceMaxEntries();
    this.enforceTokenLimit();
    this._tokenCache = null;
    this.notifyEntriesChanged();
  }

  /**
   * Get a value by key
   */
  get(key: string): unknown | undefined {
    this.assertNotDestroyed();
    return this.entries.get(key)?.value;
  }

  /**
   * Check if a key exists
   */
  has(key: string): boolean {
    this.assertNotDestroyed();
    return this.entries.has(key);
  }

  /**
   * Delete an entry
   */
  delete(key: string): boolean {
    this.assertNotDestroyed();
    const deleted = this.entries.delete(key);
    if (deleted) {
      this._tokenCache = null;
      this.notifyEntriesChanged();
    }
    return deleted;
  }

  /**
   * List all entries with metadata
   */
  list(): Array<{ key: string; description: string; priority: InContextPriority; updatedAt: number; showInUI: boolean }> {
    this.assertNotDestroyed();
    return Array.from(this.entries.values()).map(e => ({
      key: e.key,
      description: e.description,
      priority: e.priority,
      updatedAt: e.updatedAt,
      showInUI: e.showInUI ?? false,
    }));
  }

  /**
   * Clear all entries
   */
  clear(): void {
    this.assertNotDestroyed();
    this.entries.clear();
    this._tokenCache = null;
    this.notifyEntriesChanged();
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  private formatEntries(): string {
    const lines: string[] = [];

    const sorted = Array.from(this.entries.values())
      .sort((a, b) => PRIORITY_VALUES[b.priority] - PRIORITY_VALUES[a.priority]);

    for (const entry of sorted) {
      lines.push(this.formatEntry(entry));
    }

    return lines.join('\n\n');
  }

  private formatEntry(entry: InContextEntry): string {
    const valueStr = typeof entry.value === 'string'
      ? entry.value
      : JSON.stringify(entry.value, null, 2);

    let line = `**${entry.key}** (${entry.priority}): ${entry.description}`;
    if (this.config.showTimestamps) {
      line += ` [${new Date(entry.updatedAt).toISOString()}]`;
    }
    line += `\n\`\`\`\n${valueStr}\n\`\`\``;

    return line;
  }

  private enforceMaxEntries(): void {
    if (this.entries.size <= this.config.maxEntries) return;

    // Evict lowest priority, oldest entries
    const evictable = this.getEvictableEntries();

    while (this.entries.size > this.config.maxEntries && evictable.length > 0) {
      const toEvict = evictable.shift()!;
      this.entries.delete(toEvict.key);
    }
  }

  private enforceTokenLimit(): void {
    const maxTokens = this.config.maxTotalTokens;
    if (maxTokens <= 0) return;

    let totalTokens = this.estimateTotalTokens();
    if (totalTokens <= maxTokens) return;

    // Evict lowest priority, oldest entries until under limit
    const evictable = this.getEvictableEntries();

    while (totalTokens > maxTokens && evictable.length > 0) {
      const toEvict = evictable.shift()!;
      const entryTokens = this.estimator.estimateTokens(this.formatEntry(toEvict));
      this.entries.delete(toEvict.key);
      totalTokens -= entryTokens;
    }
  }

  private estimateTotalTokens(): number {
    let total = 0;
    for (const entry of this.entries.values()) {
      total += this.estimator.estimateTokens(this.formatEntry(entry));
    }
    return total;
  }

  /**
   * Get entries sorted by eviction priority (lowest priority, oldest first).
   * Critical entries are excluded.
   */
  private getEvictableEntries(): InContextEntry[] {
    return Array.from(this.entries.values())
      .filter(e => e.priority !== 'critical')
      .sort((a, b) => {
        const priorityDiff = PRIORITY_VALUES[a.priority] - PRIORITY_VALUES[b.priority];
        if (priorityDiff !== 0) return priorityDiff;
        return a.updatedAt - b.updatedAt;
      });
  }

  /**
   * Debounced notification when entries change.
   * Calls config.onEntriesChanged with all current entries.
   */
  private notifyEntriesChanged(): void {
    if (!this.config.onEntriesChanged) return;

    if (this._notifyTimer) clearTimeout(this._notifyTimer);
    this._notifyTimer = setTimeout(() => {
      this._notifyTimer = null;
      if (!this._destroyed && this.config.onEntriesChanged) {
        this.config.onEntriesChanged(Array.from(this.entries.values()));
      }
    }, 100);
  }

  private assertNotDestroyed(): void {
    if (this._destroyed) {
      throw new Error('InContextMemoryPluginNextGen is destroyed');
    }
  }

  // ============================================================================
  // IStoreHandler Implementation
  // ============================================================================

  getStoreSchema(): StoreEntrySchema {
    return {
      storeId: 'context',
      displayName: 'Live Context',
      description: 'Values shown DIRECTLY in your context window — no retrieval needed.',
      usageHint: 'Use for: small state, counters, flags, preferences you need to see every turn. Do NOT use for large data (use "memory" — it won\'t waste context tokens).',
      setDataFields: 'description (required): Brief description shown in context\nvalue (required): Data to store (any JSON value)\npriority?: "low" | "normal" | "high" | "critical" (default: "normal")\nshowInUI?: boolean — display in user\'s side panel (default: false)',
    };
  }

  async storeGet(key?: string, _context?: ToolContext): Promise<StoreGetResult> {
    this.assertNotDestroyed();
    if (key) {
      const entry = this.entries.get(key);
      if (!entry) return { found: false, key };
      return {
        found: true,
        key,
        entry: {
          key: entry.key,
          description: entry.description,
          value: entry.value,
          priority: entry.priority,
          showInUI: entry.showInUI ?? false,
          updatedAt: entry.updatedAt,
        },
      };
    }
    // Return all entries
    return {
      found: true,
      entries: Array.from(this.entries.values()).map(e => ({
        key: e.key,
        description: e.description,
        value: e.value,
        priority: e.priority,
        showInUI: e.showInUI ?? false,
        updatedAt: e.updatedAt,
      })),
    };
  }

  async storeSet(key: string, data: Record<string, unknown>, _context?: ToolContext): Promise<StoreSetResult> {
    const description = data.description as string;
    const value = data.value;
    if (!description || value === undefined) {
      return { success: false, key, message: 'Both "description" and "value" are required in data' };
    }
    this.set(
      key,
      description,
      value,
      data.priority as InContextPriority | undefined,
      data.showInUI as boolean | undefined,
    );
    return {
      success: true,
      key,
      showInUI: (data.showInUI as boolean) ?? false,
      message: `Stored "${key}" in live context${data.showInUI ? ' (visible in UI)' : ''}`,
    };
  }

  async storeDelete(key: string, _context?: ToolContext): Promise<StoreDeleteResult> {
    const deleted = this.delete(key);
    return { deleted, key };
  }

  async storeList(_filter?: Record<string, unknown>, _context?: ToolContext): Promise<StoreListResult> {
    const entries = this.list();
    return {
      entries: entries.map(e => ({ ...e })),
      total: entries.length,
    };
  }
}
