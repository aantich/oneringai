/**
 * FileRoutineExecutionStorage - File-based storage for routine execution records.
 *
 * Stores executions as JSON files on disk with per-user isolation.
 * Path: ~/.oneringai/users/<userId>/routine-executions/<executionId>.json
 *
 * Features:
 * - Per-user isolation (multi-tenant safe)
 * - Cross-platform path handling
 * - Safe ID sanitization
 * - Atomic file operations (write to .tmp then rename)
 * - Per-user index file for fast listing/filtering
 * - Index auto-rebuild if missing
 * - Automatic pruning of old completed/failed records (maxRecords)
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { sanitizeUserId, sanitizeId, DEFAULT_USER_ID } from './utils.js';
import type { IRoutineExecutionStorage } from '../../domain/interfaces/IRoutineExecutionStorage.js';
import type {
  RoutineExecutionRecord,
  RoutineExecutionStep,
  RoutineTaskSnapshot,
} from '../../domain/entities/RoutineExecutionRecord.js';
import type { RoutineExecutionStatus } from '../../domain/entities/Routine.js';

/**
 * Configuration for FileRoutineExecutionStorage
 */
export interface FileRoutineExecutionStorageConfig {
  /** Override the base directory (default: ~/.oneringai/users) */
  baseDirectory?: string;
  /** Pretty-print JSON (default: true) */
  prettyPrint?: boolean;
  /** Maximum number of execution records per user (default: 100). Oldest completed/failed are pruned on insert. */
  maxRecords?: number;
}

/**
 * Index entry for fast listing without loading full files
 */
interface ExecutionIndexEntry {
  executionId: string;
  routineId: string;
  routineName: string;
  status: RoutineExecutionStatus;
  startedAt?: number;
  completedAt?: number;
}

/**
 * Index file structure
 */
interface ExecutionIndex {
  version: number;
  executions: ExecutionIndexEntry[];
  lastUpdated: string;
}

/**
 * Stored file wrapper
 */
interface StoredExecution {
  version: number;
  record: RoutineExecutionRecord;
}

const STORAGE_VERSION = 1;
// sanitizeUserId, sanitizeId, DEFAULT_USER_ID imported from ./utils.js
const DEFAULT_MAX_RECORDS = 100;

/**
 * Get the default base directory
 */
function getDefaultBaseDirectory(): string {
  const platform = process.platform;

  if (platform === 'win32') {
    const appData = process.env.APPDATA || process.env.LOCALAPPDATA;
    if (appData) {
      return join(appData, 'oneringai', 'users');
    }
  }

  return join(homedir(), '.oneringai', 'users');
}

/**
 * File-based storage for routine execution records.
 *
 * Single instance handles all users. UserId is passed to each method.
 */
export class FileRoutineExecutionStorage implements IRoutineExecutionStorage {
  private readonly baseDirectory: string;
  private readonly prettyPrint: boolean;
  private readonly maxRecords: number;

  constructor(config: FileRoutineExecutionStorageConfig = {}) {
    this.baseDirectory = config.baseDirectory ?? getDefaultBaseDirectory();
    this.prettyPrint = config.prettyPrint ?? true;
    this.maxRecords = config.maxRecords ?? DEFAULT_MAX_RECORDS;
  }

  private getUserDirectory(userId: string | undefined): string {
    const sanitizedId = sanitizeUserId(userId);
    return join(this.baseDirectory, sanitizedId, 'routine-executions');
  }

  private getIndexPath(userId: string | undefined): string {
    return join(this.getUserDirectory(userId), '_index.json');
  }

  private getExecutionPath(userId: string | undefined, sanitizedId: string): string {
    return join(this.getUserDirectory(userId), `${sanitizedId}.json`);
  }

  // We need userId for load/pushStep/updateTask/update, but the interface doesn't pass it.
  // We store a mapping of executionId -> userId so we can locate the file.
  // Alternative: scan all user dirs. Instead, we embed userId in the stored file and
  // keep a lightweight in-memory cache, plus fall back to scanning.
  private executionUserMap = new Map<string, string | undefined>();

  async insert(userId: string | undefined, record: RoutineExecutionRecord): Promise<string> {
    const directory = this.getUserDirectory(userId);
    const sanitized = sanitizeId(record.executionId);
    const filePath = this.getExecutionPath(userId, sanitized);

    await this.ensureDirectory(directory);

    const stored: StoredExecution = { version: STORAGE_VERSION, record };
    await this.atomicWrite(filePath, stored);

    // Cache the userId mapping
    this.executionUserMap.set(record.executionId, userId);

    await this.updateIndex(userId, record);
    await this.pruneOldRecords(userId);

    return record.executionId;
  }

  async update(
    id: string,
    updates: Partial<
      Pick<RoutineExecutionRecord, 'status' | 'progress' | 'error' | 'completedAt' | 'lastActivityAt'>
    >,
  ): Promise<void> {
    const { userId, filePath } = await this.resolveExecutionFile(id);
    const stored = await this.readStoredExecution(filePath);
    if (!stored) return;

    Object.assign(stored.record, updates);
    await this.atomicWrite(filePath, stored);

    // Update index if status or completedAt changed
    if (updates.status !== undefined || updates.completedAt !== undefined) {
      await this.updateIndex(userId, stored.record);
    }
  }

  async pushStep(id: string, step: RoutineExecutionStep): Promise<void> {
    const { filePath } = await this.resolveExecutionFile(id);
    const stored = await this.readStoredExecution(filePath);
    if (!stored) return;

    stored.record.steps.push(step);
    stored.record.lastActivityAt = step.timestamp;
    await this.atomicWrite(filePath, stored);
  }

  async updateTask(id: string, taskName: string, updates: Partial<RoutineTaskSnapshot>): Promise<void> {
    const { filePath } = await this.resolveExecutionFile(id);
    const stored = await this.readStoredExecution(filePath);
    if (!stored) return;

    const task = stored.record.tasks.find(t => t.name === taskName);
    if (!task) return;

    Object.assign(task, updates);
    await this.atomicWrite(filePath, stored);
  }

  async load(id: string): Promise<RoutineExecutionRecord | null> {
    try {
      const { filePath } = await this.resolveExecutionFile(id);
      const stored = await this.readStoredExecution(filePath);
      return stored?.record ?? null;
    } catch {
      return null;
    }
  }

  async list(
    userId: string | undefined,
    options?: {
      routineId?: string;
      status?: RoutineExecutionStatus;
      limit?: number;
      offset?: number;
    },
  ): Promise<RoutineExecutionRecord[]> {
    const index = await this.loadIndex(userId);
    let entries = [...index.executions];

    // Apply routineId filter
    if (options?.routineId) {
      entries = entries.filter(e => e.routineId === options.routineId);
    }

    // Apply status filter
    if (options?.status) {
      entries = entries.filter(e => e.status === options.status);
    }

    // Sort by startedAt descending (newest first)
    entries.sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));

    // Apply pagination
    if (options?.offset) {
      entries = entries.slice(options.offset);
    }
    if (options?.limit) {
      entries = entries.slice(0, options.limit);
    }

    // Load full records for filtered entries
    const results: RoutineExecutionRecord[] = [];
    for (const entry of entries) {
      const record = await this.loadByUserAndId(userId, entry.executionId);
      if (record) {
        results.push(record);
      }
    }

    return results;
  }

  async hasRunning(userId: string | undefined, routineId: string): Promise<boolean> {
    const index = await this.loadIndex(userId);
    return index.executions.some(
      e => e.routineId === routineId && e.status === 'running'
    );
  }

  getPath(userId: string | undefined): string {
    return this.getUserDirectory(userId);
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  private async ensureDirectory(dir: string): Promise<void> {
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch (error: unknown) {
      if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error;
      }
    }
  }

  private async atomicWrite(filePath: string, stored: StoredExecution): Promise<void> {
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
  }

  private async readStoredExecution(filePath: string): Promise<StoredExecution | null> {
    try {
      const data = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(data) as StoredExecution;
    } catch (error: unknown) {
      if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      if (error instanceof SyntaxError) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Load a record directly by userId + executionId (used by list()).
   */
  private async loadByUserAndId(userId: string | undefined, executionId: string): Promise<RoutineExecutionRecord | null> {
    const sanitized = sanitizeId(executionId);
    const filePath = this.getExecutionPath(userId, sanitized);
    const stored = await this.readStoredExecution(filePath);
    if (stored) {
      this.executionUserMap.set(executionId, userId);
    }
    return stored?.record ?? null;
  }

  /**
   * Resolve the file path for an execution ID.
   * Uses in-memory cache first, then falls back to scanning user directories.
   */
  private async resolveExecutionFile(executionId: string): Promise<{ userId: string | undefined; filePath: string }> {
    const sanitized = sanitizeId(executionId);

    // Check cache first
    if (this.executionUserMap.has(executionId)) {
      const userId = this.executionUserMap.get(executionId);
      return { userId, filePath: this.getExecutionPath(userId, sanitized) };
    }

    // Fall back: scan user directories
    try {
      const userDirs = await fs.readdir(this.baseDirectory);
      for (const userDir of userDirs) {
        const execDir = join(this.baseDirectory, userDir, 'routine-executions');
        const filePath = join(execDir, `${sanitized}.json`);
        try {
          await fs.access(filePath);
          const userId = userDir === DEFAULT_USER_ID ? undefined : userDir;
          this.executionUserMap.set(executionId, userId);
          return { userId, filePath };
        } catch {
          // Not in this user dir
        }
      }
    } catch {
      // Base directory doesn't exist
    }

    // Not found — default to 'default' user (will fail gracefully on read)
    const userId = undefined;
    return { userId, filePath: this.getExecutionPath(userId, sanitized) };
  }

  private async loadIndex(userId: string | undefined): Promise<ExecutionIndex> {
    const indexPath = this.getIndexPath(userId);

    try {
      const data = await fs.readFile(indexPath, 'utf-8');
      return JSON.parse(data) as ExecutionIndex;
    } catch (error: unknown) {
      if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
        return await this.rebuildIndex(userId);
      }
      throw error;
    }
  }

  private async saveIndex(userId: string | undefined, index: ExecutionIndex): Promise<void> {
    const directory = this.getUserDirectory(userId);
    const indexPath = this.getIndexPath(userId);

    await this.ensureDirectory(directory);
    index.lastUpdated = new Date().toISOString();
    const data = this.prettyPrint
      ? JSON.stringify(index, null, 2)
      : JSON.stringify(index);

    await fs.writeFile(indexPath, data, 'utf-8');
  }

  private async updateIndex(userId: string | undefined, record: RoutineExecutionRecord): Promise<void> {
    const index = await this.loadIndex(userId);
    const entry = this.recordToIndexEntry(record);

    const existingIdx = index.executions.findIndex(e => e.executionId === record.executionId);
    if (existingIdx >= 0) {
      index.executions[existingIdx] = entry;
    } else {
      index.executions.push(entry);
    }

    await this.saveIndex(userId, index);
  }

  private recordToIndexEntry(record: RoutineExecutionRecord): ExecutionIndexEntry {
    return {
      executionId: record.executionId,
      routineId: record.routineId,
      routineName: record.routineName,
      status: record.status,
      startedAt: record.startedAt,
      completedAt: record.completedAt,
    };
  }

  /**
   * Prune old completed/failed records if count exceeds maxRecords.
   * Running/paused/pending records are never pruned.
   */
  private async pruneOldRecords(userId: string | undefined): Promise<void> {
    const index = await this.loadIndex(userId);
    if (index.executions.length <= this.maxRecords) return;

    // Separate running/active from prunable
    const activeStatuses = new Set<RoutineExecutionStatus>(['running', 'paused', 'pending']);
    const active = index.executions.filter(e => activeStatuses.has(e.status));
    const prunable = index.executions.filter(e => !activeStatuses.has(e.status));

    // Sort prunable by startedAt ascending (oldest first)
    prunable.sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0));

    const totalToKeep = this.maxRecords - active.length;
    const toDelete = totalToKeep > 0 ? prunable.slice(0, prunable.length - totalToKeep) : prunable;

    if (toDelete.length === 0) return;

    // Delete old record files
    for (const entry of toDelete) {
      const sanitized = sanitizeId(entry.executionId);
      const filePath = this.getExecutionPath(userId, sanitized);
      try {
        await fs.unlink(filePath);
      } catch {
        // Ignore — file may already be gone
      }
      this.executionUserMap.delete(entry.executionId);
    }

    // Remove from index
    const deleteIds = new Set(toDelete.map(e => e.executionId));
    index.executions = index.executions.filter(e => !deleteIds.has(e.executionId));
    await this.saveIndex(userId, index);
  }

  /**
   * Rebuild index by scanning directory for .json files (excluding _index.json).
   * Returns empty index if directory doesn't exist.
   */
  private async rebuildIndex(userId: string | undefined): Promise<ExecutionIndex> {
    const directory = this.getUserDirectory(userId);
    const index: ExecutionIndex = {
      version: 1,
      executions: [],
      lastUpdated: new Date().toISOString(),
    };

    let files: string[];
    try {
      files = await fs.readdir(directory);
    } catch {
      return index;
    }

    for (const file of files) {
      if (!file.endsWith('.json') || file === '_index.json') continue;

      try {
        const data = await fs.readFile(join(directory, file), 'utf-8');
        const stored = JSON.parse(data) as StoredExecution;
        if (stored.record) {
          index.executions.push(this.recordToIndexEntry(stored.record));
          this.executionUserMap.set(stored.record.executionId, userId);
        }
      } catch {
        // Skip corrupt files
      }
    }

    // Persist rebuilt index
    if (index.executions.length > 0) {
      await this.saveIndex(userId, index);
    }

    return index;
  }
}

/**
 * Create a FileRoutineExecutionStorage with default configuration
 */
export function createFileRoutineExecutionStorage(
  config?: FileRoutineExecutionStorageConfig
): FileRoutineExecutionStorage {
  return new FileRoutineExecutionStorage(config);
}
