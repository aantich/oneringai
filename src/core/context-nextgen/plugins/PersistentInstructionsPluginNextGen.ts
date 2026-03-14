/**
 * PersistentInstructionsPluginNextGen - Disk-persisted KVP instructions for NextGen context
 *
 * Stores custom instructions as individually keyed entries that persist across sessions on disk.
 * These are NEVER compacted - always included in context.
 *
 * Use cases:
 * - Agent personality/behavior customization
 * - User-specific preferences
 * - Accumulated knowledge/rules
 * - Custom tool usage guidelines
 *
 * Storage: ~/.oneringai/agents/<agentId>/custom_instructions.json
 */

import type { IContextPluginNextGen, IStoreHandler, StoreEntrySchema, StoreGetResult, StoreSetResult, StoreDeleteResult, StoreListResult, StoreActionResult, ITokenEstimator } from '../types.js';
import type { ToolFunction, ToolContext } from '../../../domain/entities/Tool.js';
import type { IPersistentInstructionsStorage, InstructionEntry } from '../../../domain/interfaces/IPersistentInstructionsStorage.js';
import { FilePersistentInstructionsStorage } from '../../../infrastructure/storage/FilePersistentInstructionsStorage.js';
import { simpleTokenEstimator } from '../BasePluginNextGen.js';
import { StorageRegistry } from '../../StorageRegistry.js';

// ============================================================================
// Types
// ============================================================================

export type { InstructionEntry } from '../../../domain/interfaces/IPersistentInstructionsStorage.js';

export interface PersistentInstructionsConfig {
  /** Agent ID - used to determine storage path (REQUIRED) */
  agentId: string;
  /** Custom storage implementation (default: FilePersistentInstructionsStorage) */
  storage?: IPersistentInstructionsStorage;
  /** Maximum total content length across all entries in characters (default: 50000) */
  maxTotalLength?: number;
  /** Maximum number of entries (default: 50) */
  maxEntries?: number;
}

export interface SerializedPersistentInstructionsState {
  entries: InstructionEntry[];
  agentId: string;
  version: 2;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_MAX_TOTAL_LENGTH = 50000;
const DEFAULT_MAX_ENTRIES = 50;
const KEY_MAX_LENGTH = 100;
const KEY_PATTERN = /^[a-zA-Z0-9_-]+$/;

// ============================================================================
// Instructions
// ============================================================================

const PERSISTENT_INSTRUCTIONS_INSTRUCTIONS = `Persistent Instructions are stored on disk and survive across sessions.
Each instruction is a keyed entry that can be independently managed.
Store name: "instructions". NOT for temporary state (use "context") or user info (use "user_info").

**To modify:**
- \`store_set({ store: "instructions", key: "...", content: "..." })\`: Add or update a single instruction by key
- \`store_delete({ store: "instructions", key: "..." })\`: Remove a single instruction by key
- \`store_list({ store: "instructions" })\`: List all instructions with keys and content
- \`store_action({ store: "instructions", action: "clear", params: { confirm: true } })\`: Remove all instructions (destructive!)

**Use for:** Agent personality, user preferences, learned rules, guidelines.`;

// ============================================================================
// Key Validation
// ============================================================================

function validateKey(key: unknown): string | null {
  if (typeof key !== 'string') return 'Key must be a string';
  const trimmed = key.trim();
  if (trimmed.length === 0) return 'Key cannot be empty';
  if (trimmed.length > KEY_MAX_LENGTH) return `Key exceeds maximum length (${KEY_MAX_LENGTH} chars)`;
  if (!KEY_PATTERN.test(trimmed)) return 'Key must contain only alphanumeric characters, dashes, and underscores';
  return null;
}

// ============================================================================
// Plugin Implementation
// ============================================================================

export class PersistentInstructionsPluginNextGen implements IContextPluginNextGen, IStoreHandler {
  readonly name = 'persistent_instructions';

  private _entries: Map<string, InstructionEntry> = new Map();
  private _initialized = false;
  private _destroyed = false;

  private readonly storage: IPersistentInstructionsStorage;
  private readonly maxTotalLength: number;
  private readonly maxEntries: number;
  private readonly agentId: string;
  private readonly estimator: ITokenEstimator = simpleTokenEstimator;

  private _tokenCache: number | null = null;
  private _instructionsTokenCache: number | null = null;

  constructor(config: PersistentInstructionsConfig) {
    if (!config.agentId) {
      throw new Error('PersistentInstructionsPluginNextGen requires agentId');
    }

    this.agentId = config.agentId;
    this.maxTotalLength = config.maxTotalLength ?? DEFAULT_MAX_TOTAL_LENGTH;
    this.maxEntries = config.maxEntries ?? DEFAULT_MAX_ENTRIES;
    const registryFactory = StorageRegistry.get('persistentInstructions');
    this.storage = config.storage
      ?? registryFactory?.(config.agentId, StorageRegistry.getContext())
      ?? new FilePersistentInstructionsStorage({ agentId: config.agentId });
  }

  // ============================================================================
  // IContextPluginNextGen Implementation
  // ============================================================================

  getInstructions(): string {
    return PERSISTENT_INSTRUCTIONS_INSTRUCTIONS;
  }

  async getContent(): Promise<string | null> {
    await this.ensureInitialized();

    if (this._entries.size === 0) {
      this._tokenCache = 0;
      return null;
    }

    const rendered = this.renderContent();
    this._tokenCache = this.estimator.estimateTokens(rendered);
    return rendered;
  }

  getContents(): Map<string, InstructionEntry> {
    return new Map(this._entries);
  }

  getTokenSize(): number {
    return this._tokenCache ?? 0;
  }

  getInstructionsTokenSize(): number {
    if (this._instructionsTokenCache === null) {
      this._instructionsTokenCache = this.estimator.estimateTokens(PERSISTENT_INSTRUCTIONS_INSTRUCTIONS);
    }
    return this._instructionsTokenCache;
  }

  isCompactable(): boolean {
    // Persistent instructions are NEVER compacted
    return false;
  }

  async compact(_targetTokensToFree: number): Promise<number> {
    // Never compacted
    return 0;
  }

  getTools(): ToolFunction[] {
    return [];
  }

  destroy(): void {
    if (this._destroyed) return;
    this._entries.clear();
    this._destroyed = true;
    this._tokenCache = null;
  }

  getState(): SerializedPersistentInstructionsState {
    return {
      entries: Array.from(this._entries.values()),
      agentId: this.agentId,
      version: 2,
    };
  }

  restoreState(state: unknown): void {
    if (!state || typeof state !== 'object') return;

    const s = state as Record<string, unknown>;

    // New format: { entries: InstructionEntry[], version: 2 }
    if ('version' in s && s.version === 2 && Array.isArray(s.entries)) {
      this._entries.clear();
      for (const entry of s.entries as InstructionEntry[]) {
        this._entries.set(entry.id, entry);
      }
      this._initialized = true;
      this._tokenCache = null;
      return;
    }

    // Legacy format: { content: string | null }
    if ('content' in s) {
      this._entries.clear();
      const content = s.content as string | null;
      if (content) {
        const now = Date.now();
        this._entries.set('legacy_instructions', {
          id: 'legacy_instructions',
          content,
          createdAt: now,
          updatedAt: now,
        });
      }
      this._initialized = true;
      this._tokenCache = null;
    }
  }

  // ============================================================================
  // Public API
  // ============================================================================

  /**
   * Initialize by loading from storage (called lazily)
   */
  async initialize(): Promise<void> {
    if (this._initialized || this._destroyed) return;

    try {
      const entries = await this.storage.load();
      this._entries.clear();
      if (entries) {
        for (const entry of entries) {
          this._entries.set(entry.id, entry);
        }
      }
      this._initialized = true;
    } catch (error) {
      console.warn(`Failed to load persistent instructions for agent '${this.agentId}':`, error);
      this._entries.clear();
      this._initialized = true;
    }
    this._tokenCache = null;
  }

  /**
   * Add or update an instruction entry by key
   */
  async set(key: string, content: string): Promise<boolean> {
    this.assertNotDestroyed();
    await this.ensureInitialized();

    const keyError = validateKey(key);
    if (keyError) return false;

    const trimmedContent = content.trim();
    if (trimmedContent.length === 0) return false;

    // Check maxEntries (new entry only)
    if (!this._entries.has(key) && this._entries.size >= this.maxEntries) {
      return false;
    }

    // Check maxTotalLength
    const currentTotal = this.calculateTotalContentLength();
    const existingLength = this._entries.get(key)?.content.length ?? 0;
    const newTotal = currentTotal - existingLength + trimmedContent.length;
    if (newTotal > this.maxTotalLength) {
      return false;
    }

    const now = Date.now();
    const existing = this._entries.get(key);
    this._entries.set(key, {
      id: key,
      content: trimmedContent,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });

    await this.persistToStorage();
    this._tokenCache = null;
    return true;
  }

  /**
   * Remove an instruction entry by key
   */
  async remove(key: string): Promise<boolean> {
    this.assertNotDestroyed();
    await this.ensureInitialized();

    if (!this._entries.has(key)) return false;

    this._entries.delete(key);

    if (this._entries.size === 0) {
      await this.storage.delete();
    } else {
      await this.persistToStorage();
    }

    this._tokenCache = null;
    return true;
  }

  /**
   * Get one entry by key, or all entries if no key provided
   */
  async get(key?: string): Promise<InstructionEntry | InstructionEntry[] | null> {
    this.assertNotDestroyed();
    await this.ensureInitialized();

    if (key !== undefined) {
      return this._entries.get(key) ?? null;
    }

    if (this._entries.size === 0) return null;
    return this.getSortedEntries();
  }

  /**
   * List metadata for all entries
   */
  async list(): Promise<{ key: string; contentLength: number; createdAt: number; updatedAt: number }[]> {
    this.assertNotDestroyed();
    await this.ensureInitialized();

    return this.getSortedEntries().map(entry => ({
      key: entry.id,
      contentLength: entry.content.length,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    }));
  }

  /**
   * Clear all instruction entries
   */
  async clear(): Promise<void> {
    this.assertNotDestroyed();
    this._entries.clear();
    await this.storage.delete();
    this._tokenCache = null;
  }

  /**
   * Check if initialized
   */
  get isInitialized(): boolean {
    return this._initialized;
  }

  // ============================================================================
  // IStoreHandler Implementation
  // ============================================================================

  getStoreSchema(): StoreEntrySchema {
    return {
      storeId: 'instructions',
      displayName: 'Persistent Instructions',
      description: 'Instructions that persist to disk across sessions. Stored per-agent.',
      usageHint: 'Use for: learned rules, guidelines, personality traits, user preferences for this agent. NOT for temporary state (use "context") or user profile data (use "user_info").',
      setDataFields: 'content (required, string only): The instruction text',
      actions: {
        clear: {
          description: 'Delete ALL instructions (irreversible)',
          destructive: true,
        },
      },
    };
  }

  async storeGet(key?: string, _context?: ToolContext): Promise<StoreGetResult> {
    if (key !== undefined) {
      const entry = await this.get(key) as InstructionEntry | null;
      if (!entry) {
        return { found: false, key };
      }
      return {
        found: true,
        key,
        entry: {
          key: entry.id,
          content: entry.content,
          contentLength: entry.content.length,
          createdAt: entry.createdAt,
          updatedAt: entry.updatedAt,
        },
      };
    }

    // No key — return all entries
    const all = await this.get();
    if (!all) {
      return { found: false, entries: [] };
    }
    const allEntries = all as InstructionEntry[];
    return {
      found: true,
      entries: allEntries.map(e => ({
        key: e.id,
        content: e.content,
        contentLength: e.content.length,
        createdAt: e.createdAt,
        updatedAt: e.updatedAt,
      })),
    };
  }

  async storeSet(key: string, data: Record<string, unknown>, _context?: ToolContext): Promise<StoreSetResult> {
    const content = data.content;
    if (typeof content !== 'string') {
      return { success: false, key, message: 'content must be a string' };
    }

    if (content.trim().length === 0) {
      return { success: false, key, message: 'Content cannot be empty. Use store_delete to remove an entry.' };
    }

    const keyError = validateKey(key);
    if (keyError) {
      return { success: false, key, message: keyError };
    }

    const isUpdate = this._entries.has(key.trim());
    const success = await this.set(key.trim(), content);
    if (!success) {
      if (!isUpdate && this._entries.size >= this.maxEntries) {
        return { success: false, key, message: `Maximum number of entries reached (${this.maxEntries})` };
      }
      return { success: false, key, message: `Content would exceed maximum total length (${this.maxTotalLength} chars)` };
    }

    return {
      success: true,
      key: key.trim(),
      message: isUpdate ? `Instruction '${key.trim()}' updated` : `Instruction '${key.trim()}' added`,
      contentLength: content.trim().length,
    };
  }

  async storeDelete(key: string, _context?: ToolContext): Promise<StoreDeleteResult> {
    const success = await this.remove(key.trim());
    return { deleted: success, key: key.trim() };
  }

  async storeList(_filter?: Record<string, unknown>, _context?: ToolContext): Promise<StoreListResult> {
    const entries = await this.list();
    return {
      entries: entries.map(e => ({
        key: e.key,
        contentLength: e.contentLength,
        createdAt: e.createdAt,
        updatedAt: e.updatedAt,
      })),
      total: entries.length,
    };
  }

  async storeAction(action: string, params?: Record<string, unknown>, _context?: ToolContext): Promise<StoreActionResult> {
    if (action === 'clear') {
      if (params?.confirm !== true) {
        return { success: false, action, message: 'Must pass confirm: true to clear instructions' };
      }
      await this.clear();
      return { success: true, action, message: 'All custom instructions cleared' };
    }

    return { success: false, action, message: `Unknown action: ${action}` };
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  private async ensureInitialized(): Promise<void> {
    if (!this._initialized) {
      await this.initialize();
    }
  }

  private assertNotDestroyed(): void {
    if (this._destroyed) {
      throw new Error('PersistentInstructionsPluginNextGen is destroyed');
    }
  }

  /**
   * Persist current entries to storage
   */
  private async persistToStorage(): Promise<void> {
    await this.storage.save(Array.from(this._entries.values()));
  }

  /**
   * Calculate total content length across all entries
   */
  private calculateTotalContentLength(): number {
    let total = 0;
    for (const entry of this._entries.values()) {
      total += entry.content.length;
    }
    return total;
  }

  /**
   * Get entries sorted by createdAt (oldest first)
   */
  private getSortedEntries(): InstructionEntry[] {
    return Array.from(this._entries.values()).sort((a, b) => a.createdAt - b.createdAt);
  }

  /**
   * Render all entries as markdown for context injection
   */
  private renderContent(): string {
    return this.getSortedEntries()
      .map(entry => `### ${entry.id}\n${entry.content}`)
      .join('\n\n');
  }
}
