/**
 * WorkingMemoryPluginNextGen - Working memory plugin for NextGen context
 *
 * Provides external storage with an INDEX shown in context.
 * LLM sees descriptions but must use store_get("notes", key) to get full values.
 *
 * Features:
 * - Hierarchical tiers: raw -> summary -> findings
 * - Priority-based eviction
 * - Task-aware scoping (optional)
 * - Automatic tier-based priorities
 * - Implements IStoreHandler for unified store_* tools
 */

import type { IContextPluginNextGen, ITokenEstimator, IStoreHandler, StoreEntrySchema, StoreGetResult, StoreSetResult, StoreDeleteResult, StoreListResult, StoreActionResult } from '../types.js';
import type { ToolFunction, ToolContext } from '../../../domain/entities/Tool.js';
import type { IMemoryStorage } from '../../../domain/interfaces/IMemoryStorage.js';
import { InMemoryStorage } from '../../../infrastructure/storage/InMemoryStorage.js';
import { simpleTokenEstimator } from '../BasePluginNextGen.js';
import { StorageRegistry } from '../../StorageRegistry.js';

import type {
  MemoryEntry,
  MemoryScope,
  MemoryPriority,
  MemoryTier,
  WorkingMemoryConfig,
  PriorityCalculator,
  PriorityContext,
} from '../../../domain/entities/Memory.js';

import {
  DEFAULT_MEMORY_CONFIG,
  staticPriorityCalculator,
  MEMORY_PRIORITY_VALUES,
  createMemoryEntry,
  formatMemoryIndex,
  formatSizeHuman,
  TIER_PRIORITIES,
  getTierFromKey,
  addTierPrefix,
} from '../../../domain/entities/Memory.js';

import type { MemoryIndex, MemoryIndexEntry } from '../../../domain/entities/Memory.js';

// ============================================================================
// Types
// ============================================================================

export interface SerializedWorkingMemoryState {
  version: number;
  entries: Array<{
    key: string;
    description: string;
    value: unknown;
    scope: MemoryScope;
    sizeBytes: number;
    basePriority?: MemoryPriority;
    pinned?: boolean;
  }>;
}

export type EvictionStrategy = 'lru' | 'size';

export interface WorkingMemoryPluginConfig {
  /** Memory configuration */
  config?: WorkingMemoryConfig;
  /** Storage backend (default: InMemoryStorage) */
  storage?: IMemoryStorage;
  /** Priority calculator (default: staticPriorityCalculator) */
  priorityCalculator?: PriorityCalculator;
}

// ============================================================================
// Instructions
// ============================================================================

const WORKING_MEMORY_INSTRUCTIONS = `Store: "notes". You see entry descriptions in context but must call store_get to read full values.

**Tier System** (for research/analysis):
- \`raw\`: Low priority, evicted first. Unprocessed data to summarize later.
- \`summary\`: Normal priority. Processed summaries of raw data.
- \`findings\`: High priority, kept longest. Final conclusions and insights.

**Workflow:**
1. Store raw data: \`store_set({ store: "notes", key: "topic", description: "...", value: ..., tier: "raw" })\`
2. Process and summarize: \`store_set({ store: "notes", key: "topic", description: "...", value: ..., tier: "summary" })\`
3. Extract findings: \`store_set({ store: "notes", key: "topic", description: "...", value: ..., tier: "findings" })\`
4. Clean up raw: \`store_action({ store: "notes", action: "cleanup_raw" })\` or \`store_delete({ store: "notes", key: "..." })\``;

// ============================================================================
// Plugin Implementation
// ============================================================================

export class WorkingMemoryPluginNextGen implements IContextPluginNextGen, IStoreHandler {
  readonly name = 'working_memory';

  private storage: IMemoryStorage;
  private config: WorkingMemoryConfig;
  private priorityCalculator: PriorityCalculator;
  private priorityContext: PriorityContext = {};
  private estimator: ITokenEstimator = simpleTokenEstimator;

  private _destroyed = false;
  private _tokenCache: number | null = null;
  private _instructionsTokenCache: number | null = null;

  /**
   * Synchronous snapshot of entries for getState() serialization.
   * Updated on every mutation (store, delete, evict, cleanupRaw, restoreState).
   * Solves the async/sync mismatch: IMemoryStorage.getAll() is async but
   * IContextPluginNextGen.getState() must be sync.
   */
  private _syncEntries: Map<string, SerializedWorkingMemoryState['entries'][number]> = new Map();

  constructor(pluginConfig: WorkingMemoryPluginConfig = {}) {
    const registryFactory = StorageRegistry.get('workingMemory');
    this.storage = pluginConfig.storage ?? registryFactory?.(StorageRegistry.getContext()) ?? new InMemoryStorage();
    this.config = pluginConfig.config ?? DEFAULT_MEMORY_CONFIG;
    this.priorityCalculator = pluginConfig.priorityCalculator ?? staticPriorityCalculator;
  }

  // ============================================================================
  // IContextPluginNextGen Implementation
  // ============================================================================

  getInstructions(): string {
    return WORKING_MEMORY_INSTRUCTIONS;
  }

  async getContent(): Promise<string | null> {
    const entries = await this.storage.getAll();
    if (entries.length === 0) {
      return null;
    }

    // Build MemoryIndex from entries
    const index = this.buildMemoryIndex(entries);

    // Format as index (descriptions only, not full values)
    const formatted = formatMemoryIndex(index);
    this._tokenCache = this.estimator.estimateTokens(formatted);
    return formatted;
  }

  getContents(): unknown {
    // Return raw entries for inspection
    return this.storage.getAll();
  }

  getTokenSize(): number {
    return this._tokenCache ?? 0;
  }

  getInstructionsTokenSize(): number {
    if (this._instructionsTokenCache === null) {
      this._instructionsTokenCache = this.estimator.estimateTokens(WORKING_MEMORY_INSTRUCTIONS);
    }
    return this._instructionsTokenCache;
  }

  isCompactable(): boolean {
    return true;
  }

  async compact(_targetTokensToFree: number): Promise<number> {
    // TODO: Implement smart compaction based on targetTokensToFree
    // For now, use simple LRU eviction
    const before = this.getTokenSize();
    await this.evict(3, 'lru');
    const content = await this.getContent();
    const after = content ? this.estimator.estimateTokens(content) : 0;
    return Math.max(0, before - after);
  }

  getTools(): ToolFunction[] {
    return [];
  }

  destroy(): void {
    if (this._destroyed) return;
    this._destroyed = true;
    this._tokenCache = null;
  }

  getState(): SerializedWorkingMemoryState {
    return {
      version: 1,
      entries: Array.from(this._syncEntries.values()),
    };
  }

  restoreState(state: unknown): void {
    const s = state as SerializedWorkingMemoryState;
    if (!s || !s.entries) return;

    // Clear sync snapshot and rebuild
    this._syncEntries.clear();

    // Restore entries to both storage and sync snapshot
    for (const entry of s.entries) {
      const memEntry = createMemoryEntry({
        key: entry.key,
        description: entry.description,
        value: entry.value,
        scope: entry.scope,
        priority: entry.basePriority,
        pinned: entry.pinned,
      }, this.config);
      this.storage.set(entry.key, memEntry);
      this._syncEntries.set(entry.key, {
        key: entry.key,
        description: entry.description,
        value: entry.value,
        scope: entry.scope,
        sizeBytes: entry.sizeBytes,
        basePriority: entry.basePriority,
        pinned: entry.pinned,
      });
    }
    this._tokenCache = null;
  }

  // ============================================================================
  // IStoreHandler Implementation
  // ============================================================================

  getStoreSchema(): StoreEntrySchema {
    return {
      storeId: 'notes',
      displayName: 'Notes',
      description: 'EXTERNAL storage with an index visible in context. You see descriptions only; use store_get to retrieve full values.',
      usageHint: 'Use for: large data, research findings, intermediate results. NOT for small state you check every turn (use "whiteboard" for that).',
      setDataFields: 'description (required): Brief description shown in context index\nvalue (required): Data to store (any JSON value)\ntier?: "raw" | "summary" | "findings" (default: "raw")\nscope?: "session" | "plan" | "persistent" (default: "session")\npriority?: "low" | "normal" | "high" | "critical"\npinned?: boolean (never evicted if true)',
      actions: {
        cleanup_raw: {
          description: 'Delete all raw-tier entries to free space',
        },
        query: {
          description: 'Search entries by pattern and/or tier',
          paramsDescription: 'pattern?: glob pattern, tier?: "raw"|"summary"|"findings", includeValues?: boolean, includeStats?: boolean',
        },
      },
    };
  }

  async storeGet(key?: string, _context?: ToolContext): Promise<StoreGetResult> {
    if (key) {
      const result = await this.retrieve(key);
      if (result === undefined) return { found: false, key };
      return {
        found: true,
        key,
        entry: { value: result } as Record<string, unknown>,
      };
    }
    // Return all entries (descriptions only, like memory_query with no filter)
    const allEntries = await this.query({});
    return {
      found: true,
      entries: allEntries.entries.map(e => ({
        key: e.key,
        description: e.description,
        tier: e.tier,
      })),
    };
  }

  async storeSet(key: string, data: Record<string, unknown>, _context?: ToolContext): Promise<StoreSetResult> {
    const description = data.description as string;
    const value = data.value;
    if (!description || value === undefined) {
      return { success: false, key, message: 'Both "description" and "value" are required in data' };
    }
    const result = await this.store(key, description, value, {
      tier: data.tier as MemoryTier | undefined,
      scope: data.scope as MemoryScope | undefined,
      priority: data.priority as MemoryPriority | undefined,
      pinned: data.pinned as boolean | undefined,
    });
    return { success: true, key: result.key, message: `Stored "${key}" in notes`, sizeBytes: result.sizeBytes };
  }

  async storeDelete(key: string, _context?: ToolContext): Promise<StoreDeleteResult> {
    const deleted = await this.delete(key);
    return { deleted, key };
  }

  async storeList(filter?: Record<string, unknown>, _context?: ToolContext): Promise<StoreListResult> {
    const results = await this.query({
      pattern: filter?.pattern as string | undefined,
      tier: filter?.tier as MemoryTier | undefined,
    });
    return {
      entries: results.entries.map(e => ({
        key: e.key,
        description: e.description,
        tier: e.tier,
      })),
      total: results.entries.length,
    };
  }

  async storeAction(action: string, params?: Record<string, unknown>, _context?: ToolContext): Promise<StoreActionResult> {
    switch (action) {
      case 'cleanup_raw': {
        const result = await this.cleanupRaw();
        return { success: true, action, deleted: result.deleted, keys: result.keys };
      }
      case 'query': {
        const results = await this.query({
          pattern: params?.pattern as string | undefined,
          tier: params?.tier as MemoryTier | undefined,
          includeValues: params?.includeValues as boolean | undefined,
          includeStats: params?.includeStats as boolean | undefined,
        });
        return { success: true, action, entries: results.entries, total: results.entries.length, stats: results.stats };
      }
      default:
        return { success: false, action, error: `Unknown action "${action}". Available: cleanup_raw, query` };
    }
  }

  // ============================================================================
  // Memory Operations (Core Implementation)
  // ============================================================================

  /**
   * Store a value in memory
   */
  async store(
    key: string,
    description: string,
    value: unknown,
    options?: {
      scope?: MemoryScope;
      priority?: MemoryPriority;
      tier?: MemoryTier;
      pinned?: boolean;
    }
  ): Promise<{ key: string; sizeBytes: number }> {
    this.assertNotDestroyed();

    // Apply tier prefix and priority if tier specified
    let finalKey = key;
    let finalPriority = options?.priority;

    if (options?.tier) {
      finalKey = addTierPrefix(key, options.tier);
      finalPriority = TIER_PRIORITIES[options.tier];
    }

    // Convert simple scope strings to task-aware format
    let scope: MemoryScope = options?.scope ?? 'session';

    const entry = createMemoryEntry({
      key: finalKey,
      description,
      value,
      scope,
      priority: finalPriority,
      pinned: options?.pinned,
    }, this.config);

    // Check size limits
    await this.ensureCapacity(entry.sizeBytes);

    await this.storage.set(finalKey, entry);
    this._syncEntries.set(finalKey, {
      key: finalKey,
      description,
      value,
      scope,
      sizeBytes: entry.sizeBytes,
      basePriority: finalPriority,
      pinned: options?.pinned,
    });
    this._tokenCache = null; // Invalidate cache

    return { key: finalKey, sizeBytes: entry.sizeBytes };
  }

  /**
   * Retrieve a value from memory
   */
  async retrieve(key: string): Promise<unknown | undefined> {
    this.assertNotDestroyed();
    const entry = await this.storage.get(key);
    if (entry) {
      entry.lastAccessedAt = Date.now();
      entry.accessCount++;
      await this.storage.set(key, entry);
      return entry.value;
    }
    return undefined;
  }

  /**
   * Delete a key from memory
   */
  async delete(key: string): Promise<boolean> {
    this.assertNotDestroyed();
    const exists = await this.storage.has(key);
    if (exists) {
      await this.storage.delete(key);
      this._syncEntries.delete(key);
      this._tokenCache = null;
      return true;
    }
    return false;
  }

  /**
   * Query memory entries
   */
  async query(options?: {
    pattern?: string;
    tier?: MemoryTier;
    includeValues?: boolean;
    includeStats?: boolean;
  }): Promise<{
    entries: Array<{
      key: string;
      description: string;
      tier?: MemoryTier;
      value?: unknown;
    }>;
    stats?: { count: number; totalBytes: number };
  }> {
    this.assertNotDestroyed();

    let entries = await this.storage.getAll();

    // Filter by tier
    if (options?.tier) {
      entries = entries.filter(e => getTierFromKey(e.key) === options.tier);
    }

    // Filter by pattern
    if (options?.pattern && options.pattern !== '*') {
      const regex = new RegExp(
        '^' + options.pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$'
      );
      entries = entries.filter(e => regex.test(e.key));
    }

    const result: Array<{
      key: string;
      description: string;
      tier?: MemoryTier;
      value?: unknown;
    }> = entries.map(e => ({
      key: e.key,
      description: e.description,
      tier: getTierFromKey(e.key),
      ...(options?.includeValues ? { value: e.value } : {}),
    }));

    if (options?.includeStats) {
      return {
        entries: result,
        stats: {
          count: entries.length,
          totalBytes: entries.reduce((sum, e) => sum + e.sizeBytes, 0),
        },
      };
    }

    return { entries: result };
  }

  /**
   * Format memory index for context
   */
  async formatIndex(): Promise<string> {
    const entries = await this.storage.getAll();
    const index = this.buildMemoryIndex(entries);
    return formatMemoryIndex(index);
  }

  /**
   * Evict entries to free space
   */
  async evict(count: number, strategy: EvictionStrategy = 'lru'): Promise<string[]> {
    const entries = await this.storage.getAll();

    // Get evictable entries (not pinned, not critical)
    const evictable = entries
      .filter(e => !e.pinned && this.computePriority(e) !== 'critical')
      .sort((a, b) => {
        const priorityDiff =
          MEMORY_PRIORITY_VALUES[this.computePriority(a)] -
          MEMORY_PRIORITY_VALUES[this.computePriority(b)];
        if (priorityDiff !== 0) return priorityDiff;

        if (strategy === 'lru') {
          return a.lastAccessedAt - b.lastAccessedAt;
        } else {
          return b.sizeBytes - a.sizeBytes;
        }
      });

    const toEvict = evictable.slice(0, count);
    const evictedKeys: string[] = [];

    for (const entry of toEvict) {
      await this.storage.delete(entry.key);
      this._syncEntries.delete(entry.key);
      evictedKeys.push(entry.key);
    }

    if (evictedKeys.length > 0) {
      this._tokenCache = null;
    }

    return evictedKeys;
  }

  /**
   * Cleanup raw tier entries
   */
  async cleanupRaw(): Promise<{ deleted: number; keys: string[] }> {
    const entries = await this.storage.getAll();
    const rawEntries = entries.filter(e => getTierFromKey(e.key) === 'raw');

    const keys: string[] = [];
    for (const entry of rawEntries) {
      await this.storage.delete(entry.key);
      this._syncEntries.delete(entry.key);
      keys.push(entry.key);
    }

    if (keys.length > 0) {
      this._tokenCache = null;
    }

    return { deleted: keys.length, keys };
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  private computePriority(entry: MemoryEntry): MemoryPriority {
    return this.priorityCalculator(entry, this.priorityContext);
  }

  /**
   * Build a MemoryIndex from raw entries
   */
  private buildMemoryIndex(entries: MemoryEntry[]): MemoryIndex {
    const maxSize = this.config.maxSizeBytes ?? DEFAULT_MEMORY_CONFIG.maxSizeBytes!;
    const maxIndexEntries = this.config.maxIndexEntries ?? DEFAULT_MEMORY_CONFIG.maxIndexEntries!;
    const totalSize = entries.reduce((sum, e) => sum + e.sizeBytes, 0);

    // Sort by priority (highest first), then by last access (most recent first)
    const sorted = [...entries].sort((a, b) => {
      const priorityDiff =
        MEMORY_PRIORITY_VALUES[this.computePriority(b)] -
        MEMORY_PRIORITY_VALUES[this.computePriority(a)];
      if (priorityDiff !== 0) return priorityDiff;
      return b.lastAccessedAt - a.lastAccessedAt;
    });

    // Limit entries for display
    const displayed = sorted.slice(0, maxIndexEntries);
    const omittedCount = Math.max(0, entries.length - maxIndexEntries);

    const indexEntries: MemoryIndexEntry[] = displayed.map(e => ({
      key: e.key,
      description: e.description,
      size: formatSizeHuman(e.sizeBytes),
      scope: e.scope,
      effectivePriority: this.computePriority(e),
      pinned: e.pinned,
    }));

    return {
      entries: indexEntries,
      totalSizeBytes: totalSize,
      totalSizeHuman: formatSizeHuman(totalSize),
      limitBytes: maxSize,
      limitHuman: formatSizeHuman(maxSize),
      utilizationPercent: maxSize > 0 ? (totalSize / maxSize) * 100 : 0,
      totalEntryCount: entries.length,
      omittedCount,
    };
  }

  private async ensureCapacity(neededBytes: number): Promise<void> {
    const entries = await this.storage.getAll();
    const currentSize = entries.reduce((sum, e) => sum + e.sizeBytes, 0);
    const maxSize = this.config.maxSizeBytes ?? DEFAULT_MEMORY_CONFIG.maxSizeBytes!;
    const maxEntries = this.config.maxIndexEntries ?? DEFAULT_MEMORY_CONFIG.maxIndexEntries!;

    const needsSizeEviction = currentSize + neededBytes > maxSize;
    const needsCountEviction = entries.length >= maxEntries;

    if (!needsSizeEviction && !needsCountEviction) return;

    // Sort evictable entries by priority (lowest first), then by LRU
    const evictable = entries
      .filter(e => !e.pinned && this.computePriority(e) !== 'critical')
      .sort((a, b) => {
        const priorityDiff =
          MEMORY_PRIORITY_VALUES[this.computePriority(a)] -
          MEMORY_PRIORITY_VALUES[this.computePriority(b)];
        if (priorityDiff !== 0) return priorityDiff;
        return a.lastAccessedAt - b.lastAccessedAt;
      });

    // Calculate eviction targets
    const bytesToFree = needsSizeEviction ? currentSize + neededBytes - maxSize * 0.8 : 0;
    const entriesToFree = needsCountEviction ? entries.length - maxEntries + 1 : 0; // +1 for incoming

    let freedBytes = 0;
    let freedCount = 0;

    for (const entry of evictable) {
      if (freedBytes >= bytesToFree && freedCount >= entriesToFree) break;
      await this.storage.delete(entry.key);
      this._syncEntries.delete(entry.key);
      freedBytes += entry.sizeBytes;
      freedCount++;
    }
  }

  private assertNotDestroyed(): void {
    if (this._destroyed) {
      throw new Error('WorkingMemoryPluginNextGen is destroyed');
    }
  }
}
