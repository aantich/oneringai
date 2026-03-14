/**
 * UserInfoPluginNextGen - User information storage plugin for NextGen context
 *
 * Stores key-value information about the current user (preferences, context, metadata).
 * Data is user-scoped, not agent-scoped - different agents share the same user data.
 *
 * Use cases:
 * - User preferences (theme, language, timezone)
 * - User context (location, role, permissions)
 * - User metadata (name, email, profile info)
 * - TODO tracking (stored as entries with `todo_` key prefix)
 *
 * Storage: ~/.oneringai/users/<userId>/user_info.json
 *
 * Design:
 * - UserId passed at construction time from AgentContextNextGen._userId
 * - User data IS injected into context via getContent() (entries rendered as markdown)
 * - TODOs rendered in a separate "## Current TODOs" section as a checklist
 * - Internal entries (key starts with `_`) hidden from rendered output
 * - In-memory cache with lazy loading + write-through to storage
 * - Tools access current user's data only (no cross-user access)
 */

import type { IContextPluginNextGen, ITokenEstimator, IStoreHandler, StoreEntrySchema, StoreGetResult, StoreSetResult, StoreDeleteResult, StoreListResult, StoreActionResult } from '../types.js';
import type { ToolFunction, ToolContext } from '../../../domain/entities/Tool.js';
import type { IUserInfoStorage, UserInfoEntry } from '../../../domain/interfaces/IUserInfoStorage.js';
import { FileUserInfoStorage } from '../../../infrastructure/storage/FileUserInfoStorage.js';
import { simpleTokenEstimator } from '../BasePluginNextGen.js';
import { StorageRegistry } from '../../StorageRegistry.js';
import type { StorageContext } from '../../StorageRegistry.js';

// ============================================================================
// Types
// ============================================================================

export type { UserInfoEntry } from '../../../domain/interfaces/IUserInfoStorage.js';

export interface UserInfoPluginConfig {
  /** Custom storage implementation (default: FileUserInfoStorage) */
  storage?: IUserInfoStorage;
  /** Maximum total size across all entries in bytes (default: 100000 / ~100KB) */
  maxTotalSize?: number;
  /** Maximum number of entries (default: 100) */
  maxEntries?: number;
  /** User ID for storage isolation (resolved from AgentContextNextGen._userId) */
  userId?: string;
}

export interface SerializedUserInfoState {
  version: 1;
  entries: UserInfoEntry[];
  userId?: string;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_MAX_TOTAL_SIZE = 100000; // ~100KB
const DEFAULT_MAX_ENTRIES = 100;
const KEY_MAX_LENGTH = 100;
const KEY_PATTERN = /^[a-zA-Z0-9_-]+$/;

// ============================================================================
// Instructions
// ============================================================================

const USER_INFO_INSTRUCTIONS = `User Info stores key-value information about the current user.
Store name: 'user_info'. NOT for agent-specific state (use 'context' or 'memory').
Data is user-specific and persists across sessions and agents.
User info is automatically shown in context — no need to retrieve every turn.

**To manage:**
- \`store_set({ store: "user_info", key: "...", value: ..., description?: "..." })\`: Store/update user information
- \`store_get({ store: "user_info", key?: "..." })\`: Retrieve one entry by key, or all entries if no key
- \`store_delete({ store: "user_info", key: "..." })\`: Remove a specific entry
- \`store_action({ store: "user_info", action: "clear", params: { confirm: true } })\`: Remove all entries (destructive!)

**Use for:** User preferences, context, metadata (theme, language, timezone, role, etc.) It is also perfectly fine to search the web and other external sources for information about the user and then store it in user info for future use.

**Important:** Do not store sensitive information (passwords, tokens, PII) in user info. It is not encrypted and may be accessible to other parts of the system. Always follow best practices for security.

**Rules after each user message:** If the user provides new information about themselves, update user info accordingly. If they ask to change or remove existing information, do that as well. Always keep user info up to date with the latest information provided by the user. Learn about the user proactively!

## TODO Management

TODOs are stored alongside user info and shown in a separate "Current TODOs" section in context.

**Tools:**
- \`todo_add(title, description?, people?, dueDate?, tags?)\`: Create a new TODO item
- \`todo_update(id, title?, description?, people?, dueDate?, tags?, status?)\`: Update an existing TODO
- \`todo_remove(id)\`: Delete a TODO item

**Proactive creation — be helpful:**
- If the user's message implies an action item, task, or deadline → ask "Would you like me to create a TODO for this?"
- If the user explicitly says "remind me", "track this", "don't forget" → create a TODO immediately without asking.
- When discussing plans with deadlines or deliverables → suggest relevant TODOs.
- When the user mentions other people involved → include them in the \`people\` field.
- Suggest appropriate tags based on context (e.g. "work", "personal", "urgent").

**Reminder rules:**
- Check the \`_todo_last_reminded\` entry in user info. If its value is NOT today's date (YYYY-MM-DD) AND there are overdue or soon-due items (within 2 days), proactively remind the user ONCE at the start of the conversation, then set \`_todo_last_reminded\` to today's date via \`store_set({ store: "user_info", key: "_todo_last_reminded", value: "YYYY-MM-DD" })\`.
- Do NOT remind again in the same day unless the user explicitly asks about their TODOs.
- When reminding, prioritize: overdue items first, then items due today, then items due tomorrow.
- If the user asks about their TODOs or schedule, always answer regardless of reminder status.
- After completing a TODO, mark it as done via \`todo_update(id, status: 'done')\`. Suggest marking items done when context indicates completion.

**Cleanup rules:**
- Completed TODOs older than 48 hours (check updatedAt of done items) → auto-delete via \`todo_remove\` without asking.
- Overdue pending TODOs (past due > 7 days) → ask the user: "This TODO is overdue by X days — still relevant or should I remove it?"
- Run cleanup checks at the same time as reminders (once per day, using \`_todo_last_reminded\` marker).`;

// ============================================================================
// TODO Tool Definitions
// ============================================================================

const todoAddDefinition = {
  type: 'function' as const,
  function: {
    name: 'todo_add',
    description: 'Create a new TODO item for the user. Returns the generated todo ID.',
    parameters: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Short title for the TODO (required)',
        },
        description: {
          type: 'string',
          description: 'Optional detailed description',
        },
        people: {
          type: 'array',
          items: { type: 'string' },
          description: 'People involved besides the current user (optional)',
        },
        dueDate: {
          type: 'string',
          description: 'Due date in ISO format YYYY-MM-DD (optional)',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Categorization tags (optional, e.g. "work", "personal", "urgent")',
        },
      },
      required: ['title'],
    },
  },
};

const todoUpdateDefinition = {
  type: 'function' as const,
  function: {
    name: 'todo_update',
    description: 'Update an existing TODO item. Only provided fields are changed.',
    parameters: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The todo ID (e.g. "todo_a1b2c3")',
        },
        title: {
          type: 'string',
          description: 'New title',
        },
        description: {
          type: 'string',
          description: 'New description (pass empty string to clear)',
        },
        people: {
          type: 'array',
          items: { type: 'string' },
          description: 'New people list (replaces existing)',
        },
        dueDate: {
          type: 'string',
          description: 'New due date in ISO format YYYY-MM-DD (pass empty string to clear)',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'New tags list (replaces existing)',
        },
        status: {
          type: 'string',
          enum: ['pending', 'done'],
          description: 'New status',
        },
      },
      required: ['id'],
    },
  },
};

const todoRemoveDefinition = {
  type: 'function' as const,
  function: {
    name: 'todo_remove',
    description: 'Delete a TODO item.',
    parameters: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The todo ID to remove (e.g. "todo_a1b2c3")',
        },
      },
      required: ['id'],
    },
  },
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Validate key format
 */
function validateKey(key: unknown): string | null {
  if (typeof key !== 'string') return 'Key must be a string';
  const trimmed = key.trim();
  if (trimmed.length === 0) return 'Key cannot be empty';
  if (trimmed.length > KEY_MAX_LENGTH) return `Key exceeds maximum length (${KEY_MAX_LENGTH} chars)`;
  if (!KEY_PATTERN.test(trimmed)) return 'Key must contain only alphanumeric characters, dashes, and underscores';
  return null;
}

/**
 * Determine the type of a value for display
 */
function getValueType(value: unknown): UserInfoEntry['valueType'] {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value as UserInfoEntry['valueType'];
}

/**
 * Calculate size of a value in bytes (approximate)
 */
function calculateValueSize(value: unknown): number {
  const json = JSON.stringify(value);
  return Buffer.byteLength(json, 'utf-8');
}

/**
 * Build StorageContext from ToolContext
 */
function buildStorageContext(toolContext?: ToolContext): StorageContext | undefined {
  const global = StorageRegistry.getContext();
  if (global) return global;
  if (toolContext?.userId) return { userId: toolContext.userId };
  return undefined;
}

// ============================================================================
// TODO Helpers
// ============================================================================

const TODO_KEY_PREFIX = 'todo_';
const INTERNAL_KEY_PREFIX = '_';

interface TodoValue {
  type: 'todo';
  title: string;
  description?: string;
  people?: string[];
  dueDate?: string;
  tags?: string[];
  status: 'pending' | 'done';
}

function isTodoEntry(entry: UserInfoEntry): boolean {
  return entry.id.startsWith(TODO_KEY_PREFIX);
}

function isInternalEntry(entry: UserInfoEntry): boolean {
  return entry.id.startsWith(INTERNAL_KEY_PREFIX);
}

function generateTodoId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 6; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return `${TODO_KEY_PREFIX}${id}`;
}

function renderTodoEntry(entry: UserInfoEntry): string {
  const val = entry.value as TodoValue;
  const checkbox = val.status === 'done' ? '[x]' : '[ ]';
  const parts: string[] = [];

  if (val.dueDate) parts.push(`due: ${val.dueDate}`);
  if (val.people && val.people.length > 0) parts.push(`people: ${val.people.join(', ')}`);
  const meta = parts.length > 0 ? ` (${parts.join(', ')})` : '';
  const tags = val.tags && val.tags.length > 0 ? ` [${val.tags.join(', ')}]` : '';

  let line = `- ${checkbox} ${entry.id}: ${val.title}${meta}${tags}`;
  if (val.description) {
    line += `\n  ${val.description}`;
  }
  return line;
}

/**
 * Format a value for context rendering
 */
function formatValue(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

// ============================================================================
// Plugin Implementation
// ============================================================================

export class UserInfoPluginNextGen implements IContextPluginNextGen, IStoreHandler {
  readonly name = 'user_info';

  private _destroyed = false;
  private _storage: IUserInfoStorage | null = null;

  /** In-memory cache of entries */
  private _entries: Map<string, UserInfoEntry> = new Map();
  /** Whether entries have been loaded from storage */
  private _initialized = false;

  private readonly maxTotalSize: number;
  private readonly maxEntries: number;
  private readonly estimator: ITokenEstimator = simpleTokenEstimator;
  private readonly explicitStorage?: IUserInfoStorage;

  /** UserId for getContent() and lazy initialization */
  readonly userId: string | undefined;

  private _tokenCache: number | null = null;
  private _instructionsTokenCache: number | null = null;

  constructor(config?: UserInfoPluginConfig) {
    this.maxTotalSize = config?.maxTotalSize ?? DEFAULT_MAX_TOTAL_SIZE;
    this.maxEntries = config?.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.explicitStorage = config?.storage;
    this.userId = config?.userId;
  }

  // ============================================================================
  // IContextPluginNextGen Implementation
  // ============================================================================

  getInstructions(): string {
    return USER_INFO_INSTRUCTIONS;
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

  getContents(): Map<string, UserInfoEntry> {
    return new Map(this._entries);
  }

  getTokenSize(): number {
    return this._tokenCache ?? 0;
  }

  getInstructionsTokenSize(): number {
    if (this._instructionsTokenCache === null) {
      this._instructionsTokenCache = this.estimator.estimateTokens(USER_INFO_INSTRUCTIONS);
    }
    return this._instructionsTokenCache;
  }

  isCompactable(): boolean {
    // User info is never compacted
    return false;
  }

  async compact(_targetTokensToFree: number): Promise<number> {
    // Never compacted
    return 0;
  }

  getTools(): ToolFunction[] {
    return [
      this.createTodoAddTool(),
      this.createTodoUpdateTool(),
      this.createTodoRemoveTool(),
    ];
  }

  destroy(): void {
    if (this._destroyed) return;
    this._entries.clear();
    this._destroyed = true;
    this._tokenCache = null;
  }

  getState(): SerializedUserInfoState {
    return {
      version: 1,
      entries: Array.from(this._entries.values()),
      userId: this.userId,
    };
  }

  restoreState(state: unknown): void {
    if (!state || typeof state !== 'object') return;

    const s = state as Record<string, unknown>;

    if ('version' in s && s.version === 1 && Array.isArray(s.entries)) {
      this._entries.clear();
      for (const entry of s.entries as UserInfoEntry[]) {
        this._entries.set(entry.id, entry);
      }
      this._initialized = true;
      this._tokenCache = null;
    }
  }

  // ============================================================================
  // Public API
  // ============================================================================

  /**
   * Check if initialized
   */
  get isInitialized(): boolean {
    return this._initialized;
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  private assertNotDestroyed(): void {
    if (this._destroyed) {
      throw new Error('UserInfoPluginNextGen is destroyed');
    }
  }

  /**
   * Lazy load entries from storage
   */
  private async ensureInitialized(): Promise<void> {
    if (this._initialized || this._destroyed) return;

    try {
      const storage = this.resolveStorage();
      const entries = await storage.load(this.userId);
      this._entries.clear();
      if (entries) {
        for (const entry of entries) {
          this._entries.set(entry.id, entry);
        }
      }
      this._initialized = true;
    } catch (error) {
      console.warn(`Failed to load user info for userId '${this.userId ?? 'default'}':`, error);
      this._entries.clear();
      this._initialized = true;
    }
    this._tokenCache = null;
  }

  /**
   * Render entries as markdown for context injection
   */
  private renderContent(): string {
    const userEntries: UserInfoEntry[] = [];
    const todoEntries: UserInfoEntry[] = [];

    for (const entry of this._entries.values()) {
      if (isTodoEntry(entry)) {
        todoEntries.push(entry);
      } else if (!isInternalEntry(entry)) {
        userEntries.push(entry);
      }
      // Internal entries (key starts with `_`) are hidden from rendered output
    }

    const sections: string[] = [];

    // User info section
    if (userEntries.length > 0) {
      userEntries.sort((a, b) => a.createdAt - b.createdAt);
      sections.push(
        userEntries.map(entry => `### ${entry.id}\n${formatValue(entry.value)}`).join('\n\n'),
      );
    }

    // TODOs section
    if (todoEntries.length > 0) {
      // Sort: pending first (by due date asc, then createdAt), done last
      todoEntries.sort((a, b) => {
        const aVal = a.value as TodoValue;
        const bVal = b.value as TodoValue;
        // Pending before done
        if (aVal.status !== bVal.status) return aVal.status === 'pending' ? -1 : 1;
        // By due date (entries without due date go last)
        if (aVal.dueDate && bVal.dueDate) return aVal.dueDate.localeCompare(bVal.dueDate);
        if (aVal.dueDate) return -1;
        if (bVal.dueDate) return 1;
        return a.createdAt - b.createdAt;
      });
      sections.push(
        '## Current TODOs\n' + todoEntries.map(renderTodoEntry).join('\n'),
      );
    }

    return sections.join('\n\n');
  }

  /**
   * Resolve storage instance (lazy singleton)
   */
  private resolveStorage(context?: ToolContext): IUserInfoStorage {
    if (this._storage) return this._storage;

    // 1. Explicit storage (constructor param)
    if (this.explicitStorage) {
      this._storage = this.explicitStorage;
      return this._storage;
    }

    // 2. Registry factory
    const factory = StorageRegistry.get('userInfo');
    if (factory) {
      this._storage = factory(buildStorageContext(context));
      return this._storage;
    }

    // 3. Default file storage
    this._storage = new FileUserInfoStorage();
    return this._storage;
  }

  /**
   * Persist current entries to storage
   */
  private async persistToStorage(userId: string | undefined): Promise<void> {
    const storage = this.resolveStorage();
    if (this._entries.size === 0) {
      await storage.delete(userId);
    } else {
      await storage.save(userId, Array.from(this._entries.values()));
    }
  }

  // ============================================================================
  // IStoreHandler Implementation
  // ============================================================================

  getStoreSchema(): StoreEntrySchema {
    return {
      storeId: 'user_info',
      displayName: 'User Information',
      description: 'User-scoped data shared across all agents for this user. Persists across sessions.',
      usageHint: 'Use for: facts about the user, their preferences, profile data. NOT for agent-specific state (use "context" or "memory").',
      setDataFields: 'value (required): Data to store (any JSON value)\ndescription?: Brief description of what this entry is',
      actions: {
        clear: {
          description: 'Delete ALL user info entries (irreversible)',
          destructive: true,
        },
      },
    };
  }

  async storeGet(key?: string, _context?: ToolContext): Promise<StoreGetResult> {
    this.assertNotDestroyed();
    await this.ensureInitialized();

    if (this._entries.size === 0 && key !== undefined) {
      return { found: false, key };
    }

    // Get specific entry
    if (key !== undefined) {
      const trimmedKey = key.trim();
      const entry = this._entries.get(trimmedKey);

      if (!entry) {
        return { found: false, key: trimmedKey };
      }

      return {
        found: true,
        key: entry.id,
        entry: {
          key: entry.id,
          value: entry.value,
          valueType: entry.valueType,
          description: entry.description,
          createdAt: entry.createdAt,
          updatedAt: entry.updatedAt,
        },
      };
    }

    // Get all entries
    const entries = Array.from(this._entries.values());
    return {
      found: entries.length > 0,
      entries: entries.map(e => ({
        key: e.id,
        value: e.value,
        valueType: e.valueType,
        description: e.description,
        createdAt: e.createdAt,
        updatedAt: e.updatedAt,
      })),
    };
  }

  async storeSet(key: string, data: Record<string, unknown>, context?: ToolContext): Promise<StoreSetResult> {
    this.assertNotDestroyed();
    await this.ensureInitialized();

    const userId = context?.userId ?? this.userId;

    const value = data.value;
    const description = data.description as string | undefined;

    // Validate key
    const keyError = validateKey(key);
    if (keyError) {
      return { success: false, key, message: keyError };
    }

    const trimmedKey = key.trim();

    // Validate value
    if (value === undefined) {
      return { success: false, key: trimmedKey, message: 'Value cannot be undefined. Use null for explicit null value.' };
    }

    // Check maxEntries (new entry only)
    if (!this._entries.has(trimmedKey) && this._entries.size >= this.maxEntries) {
      return { success: false, key: trimmedKey, message: `Maximum number of entries reached (${this.maxEntries})` };
    }

    // Calculate sizes
    const valueSize = calculateValueSize(value);
    let currentTotal = 0;
    for (const e of this._entries.values()) {
      currentTotal += calculateValueSize(e.value);
    }
    const existingSize = this._entries.has(trimmedKey) ? calculateValueSize(this._entries.get(trimmedKey)!.value) : 0;
    const newTotal = currentTotal - existingSize + valueSize;

    if (newTotal > this.maxTotalSize) {
      return { success: false, key: trimmedKey, message: `Total size would exceed maximum (${this.maxTotalSize} bytes)` };
    }

    // Create or update entry
    const now = Date.now();
    const existing = this._entries.get(trimmedKey);
    const entry: UserInfoEntry = {
      id: trimmedKey,
      value,
      valueType: getValueType(value),
      description,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    this._entries.set(trimmedKey, entry);
    this._tokenCache = null;

    // Write-through to storage
    await this.persistToStorage(userId);

    return {
      success: true,
      key: trimmedKey,
      message: existing ? `User info '${trimmedKey}' updated` : `User info '${trimmedKey}' added`,
      valueType: entry.valueType,
      valueSize,
    };
  }

  async storeDelete(key: string, context?: ToolContext): Promise<StoreDeleteResult> {
    this.assertNotDestroyed();
    await this.ensureInitialized();

    const userId = context?.userId ?? this.userId;
    const trimmedKey = key.trim();

    if (!this._entries.has(trimmedKey)) {
      return { deleted: false, key: trimmedKey };
    }

    this._entries.delete(trimmedKey);
    this._tokenCache = null;

    // Write-through to storage
    await this.persistToStorage(userId);

    return { deleted: true, key: trimmedKey };
  }

  async storeList(_filter?: Record<string, unknown>, _context?: ToolContext): Promise<StoreListResult> {
    this.assertNotDestroyed();
    await this.ensureInitialized();

    const entries = Array.from(this._entries.values());
    return {
      entries: entries.map(e => ({
        key: e.id,
        value: e.value,
        valueType: e.valueType,
        description: e.description,
        createdAt: e.createdAt,
        updatedAt: e.updatedAt,
      })),
      total: entries.length,
    };
  }

  async storeAction(action: string, params?: Record<string, unknown>, context?: ToolContext): Promise<StoreActionResult> {
    this.assertNotDestroyed();

    if (action !== 'clear') {
      return { success: false, action, message: `Unknown action: ${action}` };
    }

    const userId = context?.userId ?? this.userId;

    if (params?.confirm !== true) {
      return { success: false, action, message: 'Must pass confirm: true to clear user info' };
    }

    this._entries.clear();
    this._tokenCache = null;

    const storage = this.resolveStorage(context);
    await storage.delete(userId);

    return {
      success: true,
      action: 'clear',
      message: 'All user information cleared',
    };
  }

  // ============================================================================
  // TODO Tool Factories
  // ============================================================================

  private createTodoAddTool(): ToolFunction {
    return {
      definition: todoAddDefinition,
      execute: async (args: Record<string, unknown>, context?: ToolContext) => {
        this.assertNotDestroyed();
        await this.ensureInitialized();

        const userId = context?.userId ?? this.userId;
        const title = args.title as string;

        if (!title || typeof title !== 'string' || title.trim().length === 0) {
          return { error: 'Title is required' };
        }

        // Check maxEntries
        if (this._entries.size >= this.maxEntries) {
          return { error: `Maximum number of entries reached (${this.maxEntries})` };
        }

        // Generate unique ID
        let todoId = generateTodoId();
        while (this._entries.has(todoId)) {
          todoId = generateTodoId();
        }

        const todoValue: TodoValue = {
          type: 'todo',
          title: title.trim(),
          description: args.description ? String(args.description).trim() : undefined,
          people: Array.isArray(args.people) ? args.people.filter((p): p is string => typeof p === 'string') : undefined,
          dueDate: typeof args.dueDate === 'string' && args.dueDate.trim() ? args.dueDate.trim() : undefined,
          tags: Array.isArray(args.tags) ? args.tags.filter((t): t is string => typeof t === 'string') : undefined,
          status: 'pending',
        };

        // Check size
        const valueSize = calculateValueSize(todoValue);
        let currentTotal = 0;
        for (const e of this._entries.values()) {
          currentTotal += calculateValueSize(e.value);
        }
        if (currentTotal + valueSize > this.maxTotalSize) {
          return { error: `Total size would exceed maximum (${this.maxTotalSize} bytes)` };
        }

        const now = Date.now();
        const entry: UserInfoEntry = {
          id: todoId,
          value: todoValue,
          valueType: 'object',
          description: title.trim(),
          createdAt: now,
          updatedAt: now,
        };

        this._entries.set(todoId, entry);
        this._tokenCache = null;

        await this.persistToStorage(userId);

        return {
          success: true,
          message: `TODO '${title.trim()}' created`,
          id: todoId,
          todo: todoValue,
        };
      },
      permission: { scope: 'always', riskLevel: 'low' },
      describeCall: (args) => `add todo '${args.title}'`,
    };
  }

  private createTodoUpdateTool(): ToolFunction {
    return {
      definition: todoUpdateDefinition,
      execute: async (args: Record<string, unknown>, context?: ToolContext) => {
        this.assertNotDestroyed();
        await this.ensureInitialized();

        const userId = context?.userId ?? this.userId;
        const id = args.id as string;

        if (!id || typeof id !== 'string') {
          return { error: 'Todo ID is required' };
        }

        const entry = this._entries.get(id);
        if (!entry || !isTodoEntry(entry)) {
          return { error: `TODO '${id}' not found` };
        }

        const currentValue = entry.value as TodoValue;
        const updatedValue: TodoValue = { ...currentValue };

        // Apply partial updates
        if (typeof args.title === 'string' && args.title.trim()) {
          updatedValue.title = args.title.trim();
        }
        if (args.description !== undefined) {
          updatedValue.description = typeof args.description === 'string' && args.description.trim()
            ? args.description.trim()
            : undefined;
        }
        if (args.people !== undefined) {
          updatedValue.people = Array.isArray(args.people)
            ? args.people.filter((p): p is string => typeof p === 'string')
            : undefined;
        }
        if (args.dueDate !== undefined) {
          updatedValue.dueDate = typeof args.dueDate === 'string' && args.dueDate.trim()
            ? args.dueDate.trim()
            : undefined;
        }
        if (args.tags !== undefined) {
          updatedValue.tags = Array.isArray(args.tags)
            ? args.tags.filter((t): t is string => typeof t === 'string')
            : undefined;
        }
        if (args.status === 'pending' || args.status === 'done') {
          updatedValue.status = args.status;
        }

        // Check size
        const valueSize = calculateValueSize(updatedValue);
        let currentTotal = 0;
        for (const e of this._entries.values()) {
          currentTotal += calculateValueSize(e.value);
        }
        const existingSize = calculateValueSize(currentValue);
        if (currentTotal - existingSize + valueSize > this.maxTotalSize) {
          return { error: `Total size would exceed maximum (${this.maxTotalSize} bytes)` };
        }

        const now = Date.now();
        const updatedEntry: UserInfoEntry = {
          ...entry,
          value: updatedValue,
          description: updatedValue.title,
          updatedAt: now,
        };

        this._entries.set(id, updatedEntry);
        this._tokenCache = null;

        await this.persistToStorage(userId);

        return {
          success: true,
          message: `TODO '${id}' updated`,
          id,
          todo: updatedValue,
        };
      },
      permission: { scope: 'always', riskLevel: 'low' },
      describeCall: (args) => `update todo '${args.id}'`,
    };
  }

  private createTodoRemoveTool(): ToolFunction {
    return {
      definition: todoRemoveDefinition,
      execute: async (args: Record<string, unknown>, context?: ToolContext) => {
        this.assertNotDestroyed();
        await this.ensureInitialized();

        const userId = context?.userId ?? this.userId;
        const id = args.id as string;

        if (!id || typeof id !== 'string') {
          return { error: 'Todo ID is required' };
        }

        const entry = this._entries.get(id);
        if (!entry || !isTodoEntry(entry)) {
          return { error: `TODO '${id}' not found` };
        }

        this._entries.delete(id);
        this._tokenCache = null;

        await this.persistToStorage(userId);

        return {
          success: true,
          message: `TODO '${id}' removed`,
          id,
        };
      },
      permission: { scope: 'always', riskLevel: 'low' },
      describeCall: (args) => `remove todo '${args.id}'`,
    };
  }
}
