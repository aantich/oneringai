/**
 * FileRoutineDefinitionStorage - File-based storage for routine definitions.
 *
 * Stores routines as JSON files on disk with per-user isolation.
 * Path: ~/.oneringai/users/<userId>/routines/<sanitized-id>.json
 *
 * Features:
 * - Per-user isolation (multi-tenant safe)
 * - Cross-platform path handling
 * - Safe ID sanitization
 * - Atomic file operations (write to .tmp then rename)
 * - Per-user index file for fast listing/filtering
 * - Index auto-rebuild if missing
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { sanitizeUserId, sanitizeId } from './utils.js';
import type { IRoutineDefinitionStorage } from '../../domain/interfaces/IRoutineDefinitionStorage.js';
import type { RoutineDefinition } from '../../domain/entities/Routine.js';

/**
 * Configuration for FileRoutineDefinitionStorage
 */
export interface FileRoutineDefinitionStorageConfig {
  /** Override the base directory (default: ~/.oneringai/users) */
  baseDirectory?: string;
  /** Pretty-print JSON (default: true) */
  prettyPrint?: boolean;
}

/**
 * Index entry for fast listing without loading full files
 */
interface RoutineIndexEntry {
  id: string;
  name: string;
  description: string;
  tags?: string[];
  author?: string;
  updatedAt: string;
}

/**
 * Index file structure
 */
interface RoutineIndex {
  version: number;
  routines: RoutineIndexEntry[];
  lastUpdated: string;
}

/**
 * Stored file wrapper
 */
interface StoredRoutine {
  version: number;
  definition: RoutineDefinition;
}

const STORAGE_VERSION = 1;
// sanitizeUserId, sanitizeId, DEFAULT_USER_ID imported from ./utils.js

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
 * File-based storage for routine definitions.
 *
 * Single instance handles all users. UserId is passed to each method.
 */
export class FileRoutineDefinitionStorage implements IRoutineDefinitionStorage {
  private readonly baseDirectory: string;
  private readonly prettyPrint: boolean;

  constructor(config: FileRoutineDefinitionStorageConfig = {}) {
    this.baseDirectory = config.baseDirectory ?? getDefaultBaseDirectory();
    this.prettyPrint = config.prettyPrint ?? true;
  }

  private getUserDirectory(userId: string | undefined): string {
    const sanitizedId = sanitizeUserId(userId);
    return join(this.baseDirectory, sanitizedId, 'routines');
  }

  private getIndexPath(userId: string | undefined): string {
    return join(this.getUserDirectory(userId), '_index.json');
  }

  private getRoutinePath(userId: string | undefined, sanitizedId: string): string {
    return join(this.getUserDirectory(userId), `${sanitizedId}.json`);
  }

  async save(userId: string | undefined, definition: RoutineDefinition): Promise<void> {
    const directory = this.getUserDirectory(userId);
    const sanitized = sanitizeId(definition.id);
    const filePath = this.getRoutinePath(userId, sanitized);

    await this.ensureDirectory(directory);

    const stored: StoredRoutine = { version: STORAGE_VERSION, definition };
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

    await this.updateIndex(userId, definition);
  }

  async load(userId: string | undefined, id: string): Promise<RoutineDefinition | null> {
    const sanitized = sanitizeId(id);
    const filePath = this.getRoutinePath(userId, sanitized);

    try {
      const data = await fs.readFile(filePath, 'utf-8');
      const stored = JSON.parse(data) as StoredRoutine;
      return stored.definition;
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

  async delete(userId: string | undefined, id: string): Promise<void> {
    const sanitized = sanitizeId(id);
    const filePath = this.getRoutinePath(userId, sanitized);

    try {
      await fs.unlink(filePath);
    } catch (error: unknown) {
      if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }

    await this.removeFromIndex(userId, id);
  }

  async exists(userId: string | undefined, id: string): Promise<boolean> {
    const sanitized = sanitizeId(id);
    const filePath = this.getRoutinePath(userId, sanitized);

    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async list(userId: string | undefined, options?: {
    tags?: string[];
    search?: string;
    limit?: number;
    offset?: number;
  }): Promise<RoutineDefinition[]> {
    const index = await this.loadIndex(userId);
    let entries = [...index.routines];

    // Apply tag filter
    if (options?.tags && options.tags.length > 0) {
      entries = entries.filter(e => {
        const entryTags = e.tags ?? [];
        return options.tags!.some(t => entryTags.includes(t));
      });
    }

    // Apply search filter (case-insensitive substring match on name + description)
    if (options?.search) {
      const searchLower = options.search.toLowerCase();
      entries = entries.filter(e =>
        e.name.toLowerCase().includes(searchLower) ||
        e.description.toLowerCase().includes(searchLower)
      );
    }

    // Sort by updatedAt descending
    entries.sort((a, b) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );

    // Apply pagination
    if (options?.offset) {
      entries = entries.slice(options.offset);
    }
    if (options?.limit) {
      entries = entries.slice(0, options.limit);
    }

    // Load full definitions for filtered entries
    const results: RoutineDefinition[] = [];
    for (const entry of entries) {
      const def = await this.load(userId, entry.id);
      if (def) {
        results.push(def);
      }
    }

    return results;
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

  private async loadIndex(userId: string | undefined): Promise<RoutineIndex> {
    const indexPath = this.getIndexPath(userId);

    try {
      const data = await fs.readFile(indexPath, 'utf-8');
      return JSON.parse(data) as RoutineIndex;
    } catch (error: unknown) {
      if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
        // Try to rebuild index from existing files
        return await this.rebuildIndex(userId);
      }
      throw error;
    }
  }

  private async saveIndex(userId: string | undefined, index: RoutineIndex): Promise<void> {
    const directory = this.getUserDirectory(userId);
    const indexPath = this.getIndexPath(userId);

    await this.ensureDirectory(directory);
    index.lastUpdated = new Date().toISOString();
    const data = this.prettyPrint
      ? JSON.stringify(index, null, 2)
      : JSON.stringify(index);

    await fs.writeFile(indexPath, data, 'utf-8');
  }

  private async updateIndex(userId: string | undefined, definition: RoutineDefinition): Promise<void> {
    const index = await this.loadIndex(userId);
    const entry = this.definitionToIndexEntry(definition);

    const existingIdx = index.routines.findIndex(e => e.id === definition.id);
    if (existingIdx >= 0) {
      index.routines[existingIdx] = entry;
    } else {
      index.routines.push(entry);
    }

    await this.saveIndex(userId, index);
  }

  private async removeFromIndex(userId: string | undefined, id: string): Promise<void> {
    const index = await this.loadIndex(userId);
    index.routines = index.routines.filter(e => e.id !== id);
    await this.saveIndex(userId, index);
  }

  private definitionToIndexEntry(definition: RoutineDefinition): RoutineIndexEntry {
    return {
      id: definition.id,
      name: definition.name,
      description: definition.description,
      tags: definition.tags,
      author: definition.author,
      updatedAt: definition.updatedAt,
    };
  }

  /**
   * Rebuild index by scanning directory for .json files (excluding _index.json).
   * Returns empty index if directory doesn't exist.
   */
  private async rebuildIndex(userId: string | undefined): Promise<RoutineIndex> {
    const directory = this.getUserDirectory(userId);
    const index: RoutineIndex = {
      version: 1,
      routines: [],
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
        const stored = JSON.parse(data) as StoredRoutine;
        if (stored.definition) {
          index.routines.push(this.definitionToIndexEntry(stored.definition));
        }
      } catch {
        // Skip corrupt files
      }
    }

    // Persist rebuilt index
    if (index.routines.length > 0) {
      await this.saveIndex(userId, index);
    }

    return index;
  }
}

/**
 * Create a FileRoutineDefinitionStorage with default configuration
 */
export function createFileRoutineDefinitionStorage(
  config?: FileRoutineDefinitionStorageConfig
): FileRoutineDefinitionStorage {
  return new FileRoutineDefinitionStorage(config);
}
