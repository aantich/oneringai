/**
 * FileCustomToolStorage - File-based storage for custom tool definitions
 *
 * Stores custom tools as JSON files on disk with per-user isolation.
 * Path: ~/.oneringai/users/<userId>/custom-tools/<sanitized-name>.json
 *
 * Features:
 * - Per-user isolation (multi-tenant safe)
 * - Cross-platform path handling
 * - Safe name sanitization
 * - Atomic file operations (write to .tmp then rename)
 * - Per-user index file for fast listing
 * - Search support (case-insensitive substring on name + description)
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { sanitizeUserId, sanitizeId } from './utils.js';
import type { ICustomToolStorage, CustomToolListOptions } from '../../domain/interfaces/ICustomToolStorage.js';
import type { CustomToolDefinition, CustomToolSummary } from '../../domain/entities/CustomToolDefinition.js';

/**
 * Configuration for FileCustomToolStorage
 */
export interface FileCustomToolStorageConfig {
  /** Override the base directory (default: ~/.oneringai/users) */
  baseDirectory?: string;
  /** Pretty-print JSON (default: true) */
  prettyPrint?: boolean;
}

/**
 * Index entry for fast listing
 */
interface CustomToolIndexEntry {
  name: string;
  displayName?: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  tags?: string[];
  category?: string;
}

/**
 * Index file structure
 */
interface CustomToolIndex {
  version: number;
  tools: CustomToolIndexEntry[];
  lastUpdated: string;
}

/**
 * Get the default base directory for custom tool storage
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

// sanitizeUserId and sanitizeId imported from ./utils.js
// sanitizeName is an alias for sanitizeId
const sanitizeName = sanitizeId;

/**
 * File-based storage for custom tool definitions
 *
 * Single instance handles all users. UserId is passed to each method.
 */
export class FileCustomToolStorage implements ICustomToolStorage {
  private readonly baseDirectory: string;
  private readonly prettyPrint: boolean;

  constructor(config: FileCustomToolStorageConfig = {}) {
    this.baseDirectory = config.baseDirectory ?? getDefaultBaseDirectory();
    this.prettyPrint = config.prettyPrint ?? true;
  }

  /**
   * Get the directory path for a specific user's custom tools
   */
  private getUserDirectory(userId: string | undefined): string {
    const sanitizedId = sanitizeUserId(userId);
    return join(this.baseDirectory, sanitizedId, 'custom-tools');
  }

  /**
   * Get the index file path for a specific user
   */
  private getUserIndexPath(userId: string | undefined): string {
    return join(this.getUserDirectory(userId), '_index.json');
  }

  /**
   * Get the tool file path for a specific user
   */
  private getToolPath(userId: string | undefined, sanitizedName: string): string {
    return join(this.getUserDirectory(userId), `${sanitizedName}.json`);
  }

  /**
   * Save a custom tool definition
   */
  async save(userId: string | undefined, definition: CustomToolDefinition): Promise<void> {
    const directory = this.getUserDirectory(userId);
    const sanitized = sanitizeName(definition.name);
    const filePath = this.getToolPath(userId, sanitized);

    // Ensure directory exists
    await this.ensureDirectory(directory);

    // Write atomically
    const data = this.prettyPrint
      ? JSON.stringify(definition, null, 2)
      : JSON.stringify(definition);

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
    await this.updateIndex(userId, definition);
  }

  /**
   * Load a custom tool definition by name
   */
  async load(userId: string | undefined, name: string): Promise<CustomToolDefinition | null> {
    const sanitized = sanitizeName(name);
    const filePath = this.getToolPath(userId, sanitized);

    try {
      const data = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(data) as CustomToolDefinition;
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
   * Delete a custom tool definition
   */
  async delete(userId: string | undefined, name: string): Promise<void> {
    const sanitized = sanitizeName(name);
    const filePath = this.getToolPath(userId, sanitized);

    try {
      await fs.unlink(filePath);
    } catch (error: unknown) {
      if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }

    // Remove from index
    await this.removeFromIndex(userId, name);
  }

  /**
   * Check if a custom tool exists
   */
  async exists(userId: string | undefined, name: string): Promise<boolean> {
    const sanitized = sanitizeName(name);
    const filePath = this.getToolPath(userId, sanitized);

    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * List custom tools (summaries only)
   */
  async list(userId: string | undefined, options?: CustomToolListOptions): Promise<CustomToolSummary[]> {
    const index = await this.loadIndex(userId);
    let entries = [...index.tools];

    // Apply tag filter
    if (options?.tags && options.tags.length > 0) {
      entries = entries.filter(e => {
        const entryTags = e.tags ?? [];
        return options.tags!.some(t => entryTags.includes(t));
      });
    }

    // Apply category filter
    if (options?.category) {
      entries = entries.filter(e => e.category === options.category);
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

    // Convert to summaries
    return entries.map(e => ({
      name: e.name,
      displayName: e.displayName,
      description: e.description,
      createdAt: e.createdAt,
      updatedAt: e.updatedAt,
      metadata: {
        tags: e.tags,
        category: e.category,
      },
    }));
  }

  /**
   * Update metadata without loading full definition
   */
  async updateMetadata(userId: string | undefined, name: string, metadata: Record<string, unknown>): Promise<void> {
    const definition = await this.load(userId, name);
    if (!definition) {
      throw new Error(`Custom tool '${name}' not found`);
    }

    definition.metadata = { ...definition.metadata, ...metadata };
    definition.updatedAt = new Date().toISOString();
    await this.save(userId, definition);
  }

  /**
   * Get storage path for a specific user
   */
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

  private async loadIndex(userId: string | undefined): Promise<CustomToolIndex> {
    const indexPath = this.getUserIndexPath(userId);

    try {
      const data = await fs.readFile(indexPath, 'utf-8');
      return JSON.parse(data) as CustomToolIndex;
    } catch (error: unknown) {
      if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
        return {
          version: 1,
          tools: [],
          lastUpdated: new Date().toISOString(),
        };
      }
      throw error;
    }
  }

  private async saveIndex(userId: string | undefined, index: CustomToolIndex): Promise<void> {
    const directory = this.getUserDirectory(userId);
    const indexPath = this.getUserIndexPath(userId);

    await this.ensureDirectory(directory);
    index.lastUpdated = new Date().toISOString();
    const data = this.prettyPrint
      ? JSON.stringify(index, null, 2)
      : JSON.stringify(index);

    await fs.writeFile(indexPath, data, 'utf-8');
  }

  private async updateIndex(userId: string | undefined, definition: CustomToolDefinition): Promise<void> {
    const index = await this.loadIndex(userId);
    const entry = this.definitionToIndexEntry(definition);

    const existingIdx = index.tools.findIndex(e => e.name === definition.name);
    if (existingIdx >= 0) {
      index.tools[existingIdx] = entry;
    } else {
      index.tools.push(entry);
    }

    await this.saveIndex(userId, index);
  }

  private async removeFromIndex(userId: string | undefined, name: string): Promise<void> {
    const index = await this.loadIndex(userId);
    index.tools = index.tools.filter(e => e.name !== name);
    await this.saveIndex(userId, index);
  }

  private definitionToIndexEntry(definition: CustomToolDefinition): CustomToolIndexEntry {
    return {
      name: definition.name,
      displayName: definition.displayName,
      description: definition.description,
      createdAt: definition.createdAt,
      updatedAt: definition.updatedAt,
      tags: definition.metadata?.tags,
      category: definition.metadata?.category,
    };
  }
}

/**
 * Create a FileCustomToolStorage with default configuration
 */
export function createFileCustomToolStorage(
  config?: FileCustomToolStorageConfig
): FileCustomToolStorage {
  return new FileCustomToolStorage(config);
}
