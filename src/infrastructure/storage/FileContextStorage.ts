/**
 * FileContextStorage - File-based storage for AgentContext session persistence
 *
 * Stores context sessions as JSON files on disk.
 * Path: ~/.oneringai/agents/<agentId>/sessions/<sessionId>.json
 * Windows: %APPDATA%/oneringai/agents/<agentId>/sessions/<sessionId>.json
 *
 * Features:
 * - Cross-platform path handling
 * - Safe session ID sanitization
 * - Atomic file operations (write to temp, then rename)
 * - Automatic directory creation
 * - Index file for fast listing
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { sanitizeId } from './utils.js';
import type {
  IContextStorage,
  StoredContextSession,
  ContextSessionSummary,
  ContextSessionMetadata,
  ContextStorageListOptions,
  SerializedContextState,
} from '../../domain/interfaces/IContextStorage.js';
import { CONTEXT_SESSION_FORMAT_VERSION } from '../../domain/interfaces/IContextStorage.js';
import type { IHistoryJournal } from '../../domain/interfaces/IHistoryJournal.js';
import { FileHistoryJournal } from './FileHistoryJournal.js';

/**
 * Configuration for FileContextStorage
 */
export interface FileContextStorageConfig {
  /** Agent ID (used to create unique storage path) */
  agentId: string;
  /** Override the base directory (default: ~/.oneringai/agents) */
  baseDirectory?: string;
  /** Pretty-print JSON (default: true for debugging, false in production) */
  prettyPrint?: boolean;
}

/**
 * Index entry for fast listing
 */
interface SessionIndexEntry {
  sessionId: string;
  createdAt: string;
  lastSavedAt: string;
  messageCount: number;
  memoryEntryCount: number;
  metadata: ContextSessionMetadata;
}

/**
 * Index file structure
 */
interface SessionIndex {
  version: number;
  agentId: string;
  sessions: SessionIndexEntry[];
  lastUpdated: string;
}

/**
 * Get the default base directory for agent storage
 * Uses ~/.oneringai/agents on Unix-like systems
 * Uses %APPDATA%/oneringai/agents on Windows
 */
function getDefaultBaseDirectory(): string {
  const platform = process.platform;

  if (platform === 'win32') {
    // Windows: Use APPDATA if available, otherwise fall back to home
    const appData = process.env.APPDATA || process.env.LOCALAPPDATA;
    if (appData) {
      return join(appData, 'oneringai', 'agents');
    }
  }

  // Unix-like (Linux, macOS) and fallback: Use home directory
  return join(homedir(), '.oneringai', 'agents');
}

/**
 * Sanitize ID for use as a directory/file name
 * Removes or replaces characters that are not safe for filenames
 */
// sanitizeId imported from ./utils.js

/**
 * Current format version (imported from interface)
 */
const FORMAT_VERSION = CONTEXT_SESSION_FORMAT_VERSION;

/**
 * File-based storage for AgentContext session persistence
 */
export class FileContextStorage implements IContextStorage {
  private readonly agentId: string;
  private readonly sessionsDirectory: string;
  private readonly indexPath: string;
  private readonly prettyPrint: boolean;
  private index: SessionIndex | null = null;
  /** Async mutex to prevent concurrent read-modify-write corruption of the index */
  private _indexLock: Promise<void> = Promise.resolve();

  /** History journal companion — appends full conversation history as JSONL */
  readonly journal: IHistoryJournal;

  constructor(config: FileContextStorageConfig) {
    this.agentId = config.agentId;
    const sanitizedAgentId = sanitizeId(config.agentId);
    const baseDir = config.baseDirectory ?? getDefaultBaseDirectory();
    this.prettyPrint = config.prettyPrint ?? true;

    // Sessions are stored in: <baseDir>/<agentId>/sessions/
    this.sessionsDirectory = join(baseDir, sanitizedAgentId, 'sessions');
    this.indexPath = join(this.sessionsDirectory, '_index.json');

    // Journal lives alongside session files
    this.journal = new FileHistoryJournal(this.sessionsDirectory);
  }

  /**
   * Save context state to a session file
   */
  async save(
    sessionId: string,
    state: SerializedContextState,
    metadata?: ContextSessionMetadata
  ): Promise<void> {
    await this.ensureDirectory();

    const now = new Date().toISOString();
    const sanitizedSessionId = sanitizeId(sessionId);
    const filePath = this.getFilePath(sanitizedSessionId);

    // Check if session exists to preserve createdAt
    let createdAt = now;
    const existing = await this.loadRaw(sanitizedSessionId);
    if (existing) {
      createdAt = existing.createdAt;
    }

    // Build stored session
    const storedSession: StoredContextSession = {
      version: FORMAT_VERSION,
      sessionId,
      createdAt,
      lastSavedAt: now,
      state,
      metadata: metadata ?? {},
    };

    // Write atomically: write to temp file, then rename
    const data = this.prettyPrint
      ? JSON.stringify(storedSession, null, 2)
      : JSON.stringify(storedSession);

    const tempPath = `${filePath}.tmp`;
    try {
      await fs.writeFile(tempPath, data, 'utf-8');
      await fs.rename(tempPath, filePath);
    } catch (error) {
      // Clean up temp file if rename failed
      try {
        await fs.unlink(tempPath);
      } catch {
        // Ignore cleanup errors
      }
      throw error;
    }

    // Update index
    await this.updateIndex(storedSession);
  }

  /**
   * Load context state from a session file
   */
  async load(sessionId: string): Promise<StoredContextSession | null> {
    const sanitizedSessionId = sanitizeId(sessionId);
    return this.loadRaw(sanitizedSessionId);
  }

  /**
   * Delete a session
   */
  async delete(sessionId: string): Promise<void> {
    const sanitizedSessionId = sanitizeId(sessionId);
    const filePath = this.getFilePath(sanitizedSessionId);

    try {
      await fs.unlink(filePath);
    } catch (error: unknown) {
      if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
      // Ignore if file doesn't exist
    }

    // Clean up journal file
    await this.journal.clear(sessionId);

    // Remove from index
    await this.removeFromIndex(sessionId);
  }

  /**
   * Check if a session exists
   */
  async exists(sessionId: string): Promise<boolean> {
    const sanitizedSessionId = sanitizeId(sessionId);
    const filePath = this.getFilePath(sanitizedSessionId);

    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * List all sessions (summaries only)
   */
  async list(options?: ContextStorageListOptions): Promise<ContextSessionSummary[]> {
    const index = await this.loadIndex();
    let entries = [...index.sessions];

    // Apply filters
    if (options?.tags && options.tags.length > 0) {
      entries = entries.filter(e => {
        const entryTags = e.metadata.tags ?? [];
        return options.tags!.some(t => entryTags.includes(t));
      });
    }

    if (options?.createdAfter) {
      const after = options.createdAfter.getTime();
      entries = entries.filter(e => new Date(e.createdAt).getTime() >= after);
    }

    if (options?.createdBefore) {
      const before = options.createdBefore.getTime();
      entries = entries.filter(e => new Date(e.createdAt).getTime() <= before);
    }

    if (options?.savedAfter) {
      const after = options.savedAfter.getTime();
      entries = entries.filter(e => new Date(e.lastSavedAt).getTime() >= after);
    }

    if (options?.savedBefore) {
      const before = options.savedBefore.getTime();
      entries = entries.filter(e => new Date(e.lastSavedAt).getTime() <= before);
    }

    // Sort by lastSavedAt descending (most recent first)
    entries.sort((a, b) =>
      new Date(b.lastSavedAt).getTime() - new Date(a.lastSavedAt).getTime()
    );

    // Apply pagination
    if (options?.offset) {
      entries = entries.slice(options.offset);
    }
    if (options?.limit) {
      entries = entries.slice(0, options.limit);
    }

    // Convert to summaries
    return entries.map(e => ({
      sessionId: e.sessionId,
      createdAt: new Date(e.createdAt),
      lastSavedAt: new Date(e.lastSavedAt),
      messageCount: e.messageCount,
      memoryEntryCount: e.memoryEntryCount,
      metadata: e.metadata,
    }));
  }

  /**
   * Update session metadata without loading full state
   */
  async updateMetadata(
    sessionId: string,
    metadata: Partial<ContextSessionMetadata>
  ): Promise<void> {
    const stored = await this.load(sessionId);
    if (!stored) {
      throw new Error(`Session '${sessionId}' not found`);
    }

    // Merge metadata
    stored.metadata = { ...stored.metadata, ...metadata };
    stored.lastSavedAt = new Date().toISOString();

    // Save back atomically: write to temp file, then rename
    const sanitizedSessionId = sanitizeId(sessionId);
    const filePath = this.getFilePath(sanitizedSessionId);
    const data = this.prettyPrint
      ? JSON.stringify(stored, null, 2)
      : JSON.stringify(stored);

    const tempPath = `${filePath}.tmp`;
    try {
      await fs.writeFile(tempPath, data, 'utf-8');
      await fs.rename(tempPath, filePath);
    } catch (error) {
      try {
        await fs.unlink(tempPath);
      } catch {
        // Ignore cleanup errors
      }
      throw error;
    }

    // Update index
    await this.updateIndex(stored);
  }

  /**
   * Get the storage path (for display/debugging)
   * @deprecated Use getLocation() instead
   */
  getPath(): string {
    return this.sessionsDirectory;
  }

  /**
   * Get a human-readable storage location string (for display/debugging)
   */
  getLocation(): string {
    return this.sessionsDirectory;
  }

  /**
   * Get the agent ID
   */
  getAgentId(): string {
    return this.agentId;
  }

  /**
   * Rebuild the index by scanning all session files
   * Useful for recovery or migration
   */
  async rebuildIndex(): Promise<void> {
    await this.ensureDirectory();

    const files = await fs.readdir(this.sessionsDirectory);
    const sessionFiles = files.filter(f => f.endsWith('.json') && !f.startsWith('_'));

    const entries: SessionIndexEntry[] = [];

    for (const file of sessionFiles) {
      try {
        const filePath = join(this.sessionsDirectory, file);
        const data = await fs.readFile(filePath, 'utf-8');
        const stored = JSON.parse(data) as StoredContextSession;
        entries.push(this.storedToIndexEntry(stored));
      } catch {
        // Skip invalid files
      }
    }

    this.index = {
      version: 1,
      agentId: this.agentId,
      sessions: entries,
      lastUpdated: new Date().toISOString(),
    };

    await this.saveIndex();
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  private getFilePath(sanitizedSessionId: string): string {
    return join(this.sessionsDirectory, `${sanitizedSessionId}.json`);
  }

  private async ensureDirectory(): Promise<void> {
    try {
      await fs.mkdir(this.sessionsDirectory, { recursive: true });
    } catch (error: unknown) {
      if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error;
      }
    }
  }

  private async loadRaw(sanitizedSessionId: string): Promise<StoredContextSession | null> {
    const filePath = this.getFilePath(sanitizedSessionId);

    try {
      const data = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(data) as StoredContextSession;
    } catch (error: unknown) {
      if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      // Handle corrupted JSON files gracefully
      if (error instanceof SyntaxError) {
        console.warn(`Corrupted session file: ${filePath}`);
        return null;
      }
      throw error;
    }
  }

  private async loadIndex(): Promise<SessionIndex> {
    if (this.index) {
      return this.index;
    }

    try {
      const data = await fs.readFile(this.indexPath, 'utf-8');
      this.index = JSON.parse(data) as SessionIndex;
      return this.index;
    } catch (error: unknown) {
      if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
        // No index yet, create empty one
        this.index = {
          version: 1,
          agentId: this.agentId,
          sessions: [],
          lastUpdated: new Date().toISOString(),
        };
        return this.index;
      }
      throw error;
    }
  }

  private async saveIndex(): Promise<void> {
    if (!this.index) return;

    await this.ensureDirectory();
    this.index.lastUpdated = new Date().toISOString();
    const data = this.prettyPrint
      ? JSON.stringify(this.index, null, 2)
      : JSON.stringify(this.index);

    await fs.writeFile(this.indexPath, data, 'utf-8');
  }

  /**
   * Acquire the index lock, run fn, then release.
   * Serializes all index mutations to prevent concurrent read-modify-write corruption.
   */
  private async withIndexLock<T>(fn: () => Promise<T>): Promise<T> {
    // Chain onto the existing lock so callers serialize
    const prev = this._indexLock;
    let release!: () => void;
    this._indexLock = new Promise<void>(resolve => { release = resolve; });

    await prev; // wait for prior operation
    try {
      return await fn();
    } finally {
      release();
    }
  }

  private async updateIndex(stored: StoredContextSession): Promise<void> {
    await this.withIndexLock(async () => {
      const index = await this.loadIndex();
      const entry = this.storedToIndexEntry(stored);

      const existingIdx = index.sessions.findIndex(e => e.sessionId === stored.sessionId);
      if (existingIdx >= 0) {
        index.sessions[existingIdx] = entry;
      } else {
        index.sessions.push(entry);
      }

      await this.saveIndex();
    });
  }

  private async removeFromIndex(sessionId: string): Promise<void> {
    await this.withIndexLock(async () => {
      const index = await this.loadIndex();
      index.sessions = index.sessions.filter(e => e.sessionId !== sessionId);
      await this.saveIndex();
    });
  }

  private storedToIndexEntry(stored: StoredContextSession): SessionIndexEntry {
    // NextGen state structure:
    // - conversation: InputItem[] (the history)
    // - pluginStates.workingMemory: { entries: [...] }
    const workingMemoryState = stored.state.pluginStates?.workingMemory as
      | { entries?: unknown[] }
      | undefined;

    return {
      sessionId: stored.sessionId,
      createdAt: stored.createdAt,
      lastSavedAt: stored.lastSavedAt,
      messageCount: stored.state.conversation?.length ?? 0,
      memoryEntryCount: workingMemoryState?.entries?.length ?? 0,
      metadata: stored.metadata,
    };
  }
}

/**
 * Create a FileContextStorage for the given agent
 *
 * @param agentId - Agent ID
 * @param options - Optional configuration
 * @returns FileContextStorage instance
 *
 * @example
 * ```typescript
 * const storage = createFileContextStorage('my-agent');
 * const ctx = AgentContext.create({
 *   model: 'gpt-4',
 *   storage,
 * });
 *
 * // Save session
 * await ctx.save('session-001', { title: 'My Session' });
 *
 * // Load session
 * await ctx.load('session-001');
 * ```
 */
export function createFileContextStorage(
  agentId: string,
  options?: Omit<FileContextStorageConfig, 'agentId'>
): FileContextStorage {
  return new FileContextStorage({ agentId, ...options });
}
