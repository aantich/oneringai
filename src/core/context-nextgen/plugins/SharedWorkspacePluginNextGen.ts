/**
 * SharedWorkspacePluginNextGen - Shared bulletin board for multi-agent coordination
 *
 * A storage-agnostic coordination layer where agents share artifacts, status,
 * and messages. Entries can hold inline content (for collaborative documents)
 * and/or external references (file paths, DB IDs, URLs) accessed via agent tools.
 *
 * Designed to be shared across agent instances: create one instance and
 * register it on multiple AgentContextNextGen contexts.
 *
 * Use for:
 * - Shared plans, designs, reviews
 * - Task status tracking across agents
 * - Collaborative documents (inline content)
 * - References to external resources
 *
 * Do NOT use for:
 * - Private agent state (use InContextMemory / "context" store)
 * - Persistent rules (use PersistentInstructions / "instructions" store)
 */

import type { IContextPluginNextGen, ITokenEstimator, IStoreHandler, StoreEntrySchema, StoreGetResult, StoreSetResult, StoreDeleteResult, StoreListResult, StoreActionResult } from '../types.js';
import type { ToolFunction, ToolContext } from '../../../domain/entities/Tool.js';
import { simpleTokenEstimator } from '../BasePluginNextGen.js';

// ============================================================================
// Types
// ============================================================================

export interface SharedWorkspaceEntry {
  key: string;
  /** Inline content (optional — for collaborative documents) */
  content?: string;
  /** External references: file paths, DB IDs, URLs, etc. (optional) */
  references?: string[];
  /** Required brief summary — always cheap to show in context */
  summary: string;
  /** Free-form status */
  status: string;
  /** Agent name or ID that last updated this entry */
  author: string;
  /** Auto-incremented on each update */
  version: number;
  /** Optional tags for filtering */
  tags?: string[];
  createdAt: number;
  updatedAt: number;
}

export interface WorkspaceLogEntry {
  author: string;
  message: string;
  timestamp: number;
}

export interface SharedWorkspaceConfig {
  /** Maximum number of entries (default: 50) */
  maxEntries?: number;
  /** Maximum total tokens for context rendering (default: 8000) */
  maxTotalTokens?: number;
  /** Maximum log entries to keep (default: 100) */
  maxLogEntries?: number;
  /** Callback when entries change */
  onEntriesChanged?: (entries: SharedWorkspaceEntry[]) => void;
}

export interface SerializedSharedWorkspaceState {
  entries: SharedWorkspaceEntry[];
  log: WorkspaceLogEntry[];
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_CONFIG: Required<Omit<SharedWorkspaceConfig, 'onEntriesChanged'>> = {
  maxEntries: 50,
  maxTotalTokens: 8000,
  maxLogEntries: 100,
};

// ============================================================================
// Instructions
// ============================================================================

const SHARED_WORKSPACE_INSTRUCTIONS = `Store: "workspace". Visible to ALL agents in the team.

**Content model:**
- \`content\`: Inline text for collaborative documents (plans, specs, notes)
- \`references\`: External pointers (file paths, DB IDs, URLs) accessed via your other tools
- Both can coexist: short spec inline + reference to full implementation

**Versioning:** Each update auto-increments the entry's version number and tracks the author.

**Actions:** \`store_action({ store: "workspace", action: "log", message: "..." })\` \u2014 append to shared conversation log. \`store_action({ store: "workspace", action: "history", limit?: 20 })\` \u2014 see recent log entries.`;

// ============================================================================
// Plugin Implementation
// ============================================================================

export class SharedWorkspacePluginNextGen implements IContextPluginNextGen, IStoreHandler {
  readonly name = 'shared_workspace';

  private entries: Map<string, SharedWorkspaceEntry> = new Map();
  private log: WorkspaceLogEntry[] = [];
  private config: Required<Omit<SharedWorkspaceConfig, 'onEntriesChanged'>> & {
    onEntriesChanged?: (entries: SharedWorkspaceEntry[]) => void;
  };
  private estimator: ITokenEstimator = simpleTokenEstimator;

  private _destroyed = false;
  private _tokenCache: number | null = null;
  private _instructionsTokenCache: number | null = null;

  constructor(config?: Partial<SharedWorkspaceConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ============================================================================
  // IContextPluginNextGen Implementation
  // ============================================================================

  getInstructions(): string {
    return SHARED_WORKSPACE_INSTRUCTIONS;
  }

  async getContent(): Promise<string | null> {
    if (this.entries.size === 0 && this.log.length === 0) {
      return null;
    }

    const content = this.formatContent();
    this._tokenCache = this.estimator.estimateTokens(content);
    return content;
  }

  getContents(): { entries: SharedWorkspaceEntry[]; log: WorkspaceLogEntry[] } {
    return {
      entries: Array.from(this.entries.values()),
      log: [...this.log],
    };
  }

  getTokenSize(): number {
    return this._tokenCache ?? 0;
  }

  getInstructionsTokenSize(): number {
    if (this._instructionsTokenCache === null) {
      this._instructionsTokenCache = this.estimator.estimateTokens(SHARED_WORKSPACE_INSTRUCTIONS);
    }
    return this._instructionsTokenCache;
  }

  isCompactable(): boolean {
    return this.entries.size > 0;
  }

  async compact(targetTokensToFree: number): Promise<number> {
    const before = this.getTokenSize();

    // First remove archived entries, then oldest low-activity entries
    const sortedEntries = Array.from(this.entries.values())
      .sort((a, b) => {
        // Archived first
        if (a.status === 'archived' && b.status !== 'archived') return -1;
        if (b.status === 'archived' && a.status !== 'archived') return 1;
        // Then oldest
        return a.updatedAt - b.updatedAt;
      });

    let freed = 0;
    let entriesRemoved = false;
    for (const entry of sortedEntries) {
      if (freed >= targetTokensToFree) break;
      const entryTokens = this.estimator.estimateTokens(this.formatEntry(entry));
      this.entries.delete(entry.key);
      freed += entryTokens;
      entriesRemoved = true;
    }

    this._tokenCache = null;
    const content = await this.getContent();
    const after = content ? this.estimator.estimateTokens(content) : 0;

    // H1: Notify listeners when compact removes entries
    if (entriesRemoved && this.config.onEntriesChanged) {
      this.config.onEntriesChanged(Array.from(this.entries.values()));
    }

    return Math.max(0, before - after);
  }

  getTools(): ToolFunction[] {
    return [];
  }

  destroy(): void {
    if (this._destroyed) return;
    this.entries.clear();
    this.log = [];
    this._destroyed = true;
    this._tokenCache = null;
    // M6: Release callback closure to prevent keeping external objects alive
    this.config.onEntriesChanged = undefined;
  }

  getState(): SerializedSharedWorkspaceState {
    return {
      entries: Array.from(this.entries.values()),
      log: [...this.log],
    };
  }

  restoreState(state: unknown): void {
    const s = state as SerializedSharedWorkspaceState;
    if (!s) return;

    this.entries.clear();
    if (s.entries) {
      for (const entry of s.entries) {
        this.entries.set(entry.key, entry);
      }
    }
    this.log = s.log ?? [];
    this._tokenCache = null;
  }

  // ============================================================================
  // IStoreHandler Implementation
  // ============================================================================

  getStoreSchema(): StoreEntrySchema {
    return {
      storeId: 'workspace',
      displayName: 'Shared Workspace',
      description: 'Team bulletin board — visible to ALL agents. Tracks shared artifacts, plans, and status.',
      usageHint: 'Use for: shared plans, reviews, task status, collaborative documents. Private notes? Use "context". Persistent rules? Use "instructions".',
      setDataFields: 'summary (required): Brief description of the artifact\ncontent?: Inline text content (for collaborative documents)\nreferences?: string[] — external pointers (file paths, DB IDs, URLs)\nstatus?: Free-form status (e.g., "draft", "in_review", "approved")\nauthor?: Who created/updated this entry (defaults to "unknown")\ntags?: string[] — for filtering',
      actions: {
        log: {
          description: 'Append a message to the shared conversation log',
          paramsDescription: 'message (required): Log message text',
        },
        history: {
          description: 'Get recent log entries',
          paramsDescription: 'limit?: Number of entries to return (default: 20)',
        },
        archive: {
          description: 'Set an entry\'s status to "archived"',
          paramsDescription: 'key (required): Entry key to archive',
        },
        clear: {
          description: 'Delete ALL workspace entries and log (irreversible)',
          destructive: true,
        },
      },
    };
  }

  async storeGet(key?: string, _context?: ToolContext): Promise<StoreGetResult> {
    if (key) {
      const entry = this.entries.get(key);
      if (!entry) return { found: false, key };
      return {
        found: true,
        key,
        entry: { ...entry } as unknown as Record<string, unknown>,
      };
    }
    return {
      found: true,
      entries: Array.from(this.entries.values()).map(e => ({ ...e }) as unknown as Record<string, unknown>),
    };
  }

  async storeSet(key: string, data: Record<string, unknown>, _context?: ToolContext): Promise<StoreSetResult> {
    const summary = data.summary as string;
    if (!summary) {
      return { success: false, key, message: '"summary" is required in data' };
    }

    const existing = this.entries.get(key);
    const now = Date.now();

    const entry: SharedWorkspaceEntry = {
      key,
      content: data.content as string | undefined,
      references: data.references as string[] | undefined,
      summary,
      status: (data.status as string) ?? existing?.status ?? 'draft',
      author: (data.author as string) ?? 'unknown',
      version: (existing?.version ?? 0) + 1,
      tags: data.tags as string[] | undefined,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    this.entries.set(key, entry);
    this.enforceMaxEntries();
    this._tokenCache = null;

    if (this.config.onEntriesChanged) {
      this.config.onEntriesChanged(Array.from(this.entries.values()));
    }

    return {
      success: true,
      key,
      version: entry.version,
      message: `${existing ? 'Updated' : 'Created'} "${key}" (v${entry.version})`,
    };
  }

  async storeDelete(key: string, _context?: ToolContext): Promise<StoreDeleteResult> {
    const deleted = this.entries.delete(key);
    if (deleted) {
      this._tokenCache = null;
      if (this.config.onEntriesChanged) {
        this.config.onEntriesChanged(Array.from(this.entries.values()));
      }
    }
    return { deleted, key };
  }

  async storeList(filter?: Record<string, unknown>, _context?: ToolContext): Promise<StoreListResult> {
    let entries = Array.from(this.entries.values());

    if (filter) {
      if (filter.status) {
        entries = entries.filter(e => e.status === filter.status);
      }
      if (filter.author) {
        entries = entries.filter(e => e.author === filter.author);
      }
      if (filter.tags && Array.isArray(filter.tags)) {
        const tags = filter.tags as string[];
        entries = entries.filter(e => e.tags?.some(t => tags.includes(t)));
      }
    }

    return {
      entries: entries.map(e => ({
        key: e.key,
        summary: e.summary,
        status: e.status,
        author: e.author,
        version: e.version,
        hasContent: !!e.content,
        referenceCount: e.references?.length ?? 0,
        tags: e.tags,
        updatedAt: e.updatedAt,
      })),
      total: entries.length,
    };
  }

  async storeAction(action: string, params?: Record<string, unknown>, _context?: ToolContext): Promise<StoreActionResult> {
    switch (action) {
      case 'log': {
        const message = params?.message as string;
        if (!message) {
          return { success: false, action, error: '"message" parameter is required' };
        }
        const author = (params?.author as string) ?? 'unknown';
        this.log.push({ author, message, timestamp: Date.now() });
        // Enforce max log entries
        if (this.log.length > this.config.maxLogEntries) {
          this.log = this.log.slice(-this.config.maxLogEntries);
        }
        this._tokenCache = null;
        return { success: true, action };
      }

      case 'history': {
        const limit = (params?.limit as number) ?? 20;
        const recent = this.log.slice(-limit);
        return { success: true, action, entries: recent, total: this.log.length };
      }

      case 'archive': {
        const key = params?.key as string;
        if (!key) {
          return { success: false, action, error: '"key" parameter is required' };
        }
        const entry = this.entries.get(key);
        if (!entry) {
          return { success: false, action, error: `Entry "${key}" not found` };
        }
        entry.status = 'archived';
        entry.updatedAt = Date.now();
        this._tokenCache = null;
        return { success: true, action, key };
      }

      case 'clear': {
        this.entries.clear();
        this.log = [];
        this._tokenCache = null;
        if (this.config.onEntriesChanged) {
          this.config.onEntriesChanged([]);
        }
        return { success: true, action, message: 'Workspace cleared' };
      }

      default:
        return { success: false, action, error: `Unknown action "${action}". Available: log, history, archive, clear` };
    }
  }

  // ============================================================================
  // Direct API (for programmatic access)
  // ============================================================================

  /** Get an entry by key */
  getEntry(key: string): SharedWorkspaceEntry | undefined {
    return this.entries.get(key);
  }

  /** Get all entries */
  getAllEntries(): SharedWorkspaceEntry[] {
    return Array.from(this.entries.values());
  }

  /** Get the conversation log */
  getLog(): WorkspaceLogEntry[] {
    return [...this.log];
  }

  /** Append to the conversation log */
  appendLog(author: string, message: string): void {
    this.log.push({ author, message, timestamp: Date.now() });
    if (this.log.length > this.config.maxLogEntries) {
      this.log = this.log.slice(-this.config.maxLogEntries);
    }
    this._tokenCache = null;
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  private formatContent(): string {
    const parts: string[] = [];

    // Entries section
    if (this.entries.size > 0) {
      parts.push(`## Shared Workspace (${this.entries.size} entries)`);
      const sorted = Array.from(this.entries.values())
        .sort((a, b) => b.updatedAt - a.updatedAt);
      for (const entry of sorted) {
        parts.push(this.formatEntry(entry));
      }
    }

    // Recent log (last 10 entries shown in context)
    if (this.log.length > 0) {
      parts.push(`\n## Team Log (last ${Math.min(10, this.log.length)} of ${this.log.length})`);
      const recent = this.log.slice(-10);
      for (const entry of recent) {
        parts.push(`- [${entry.author}] ${entry.message}`);
      }
    }

    return parts.join('\n');
  }

  private formatEntry(entry: SharedWorkspaceEntry): string {
    const parts: string[] = [];
    parts.push(`\n**${entry.key}** (v${entry.version}, ${entry.status}, by ${entry.author}): ${entry.summary}`);

    if (entry.references?.length) {
      parts.push(`  refs: ${entry.references.join(', ')}`);
    }
    if (entry.tags?.length) {
      parts.push(`  tags: ${entry.tags.join(', ')}`);
    }
    if (entry.content) {
      // Show inline content (truncated if long)
      const preview = entry.content.length > 500
        ? entry.content.substring(0, 500) + '... [truncated, use store_get for full content]'
        : entry.content;
      parts.push('```\n' + preview + '\n```');
    }

    return parts.join('\n');
  }

  private enforceMaxEntries(): void {
    if (this.entries.size <= this.config.maxEntries) return;

    // Remove archived first, then oldest
    const sorted = Array.from(this.entries.entries())
      .sort(([, a], [, b]) => {
        if (a.status === 'archived' && b.status !== 'archived') return -1;
        if (b.status === 'archived' && a.status !== 'archived') return 1;
        return a.updatedAt - b.updatedAt;
      });

    while (this.entries.size > this.config.maxEntries && sorted.length > 0) {
      const [key] = sorted.shift()!;
      this.entries.delete(key);
    }

    // H2: Invalidate token cache after removing entries
    this._tokenCache = null;
  }
}
