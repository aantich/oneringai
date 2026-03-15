/**
 * FileAgentDefinitionStorage - File-based storage for agent definitions
 *
 * Stores agent definitions as JSON files on disk.
 * Path: ~/.oneringai/agents/<agentId>/definition.json
 * Windows: %APPDATA%/oneringai/agents/<agentId>/definition.json
 *
 * Features:
 * - Cross-platform path handling
 * - Safe agent ID sanitization
 * - Atomic file operations
 * - Automatic directory creation
 * - Index file for fast listing
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { sanitizeId } from './utils.js';
import type {
  IAgentDefinitionStorage,
  StoredAgentDefinition,
  AgentDefinitionSummary,
  AgentDefinitionMetadata,
  AgentDefinitionListOptions,
} from '../../domain/interfaces/IAgentDefinitionStorage.js';
import { AGENT_DEFINITION_FORMAT_VERSION } from '../../domain/interfaces/IAgentDefinitionStorage.js';

/**
 * Configuration for FileAgentDefinitionStorage
 */
export interface FileAgentDefinitionStorageConfig {
  /** Override the base directory (default: ~/.oneringai/agents) */
  baseDirectory?: string;
  /** Pretty-print JSON (default: true) */
  prettyPrint?: boolean;
}

/**
 * Index entry for fast listing
 */
interface DefinitionIndexEntry {
  agentId: string;
  name: string;
  agentType: string;
  model: string;
  createdAt: string;
  updatedAt: string;
  metadata?: AgentDefinitionMetadata;
}

/**
 * Index file structure
 */
interface DefinitionIndex {
  version: number;
  agents: DefinitionIndexEntry[];
  lastUpdated: string;
}

/**
 * Get the default base directory for agent storage
 */
function getDefaultBaseDirectory(): string {
  const platform = process.platform;

  if (platform === 'win32') {
    const appData = process.env.APPDATA || process.env.LOCALAPPDATA;
    if (appData) {
      return join(appData, 'oneringai', 'agents');
    }
  }

  return join(homedir(), '.oneringai', 'agents');
}

/**
 * Sanitize agent ID for use as a directory name
 */
// sanitizeAgentId is an alias for sanitizeId from ./utils.js
const sanitizeAgentId = sanitizeId;

/**
 * File-based storage for agent definitions
 */
export class FileAgentDefinitionStorage implements IAgentDefinitionStorage {
  private readonly baseDirectory: string;
  private readonly indexPath: string;
  private readonly prettyPrint: boolean;
  private index: DefinitionIndex | null = null;

  constructor(config: FileAgentDefinitionStorageConfig = {}) {
    this.baseDirectory = config.baseDirectory ?? getDefaultBaseDirectory();
    this.prettyPrint = config.prettyPrint ?? true;
    this.indexPath = join(this.baseDirectory, '_agents_index.json');
  }

  /**
   * Save an agent definition
   */
  async save(definition: StoredAgentDefinition): Promise<void> {
    const sanitizedId = sanitizeAgentId(definition.agentId);
    const agentDir = join(this.baseDirectory, sanitizedId);
    const filePath = join(agentDir, 'definition.json');

    // Ensure directory exists
    await this.ensureDirectory(agentDir);

    // Update timestamps
    const now = new Date().toISOString();
    if (!definition.createdAt) {
      // Check if existing definition exists to preserve createdAt
      const existing = await this.loadRaw(sanitizedId);
      definition.createdAt = existing?.createdAt ?? now;
    }
    definition.updatedAt = now;
    definition.version = AGENT_DEFINITION_FORMAT_VERSION;

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
    await this.updateIndex(definition);
  }

  /**
   * Load an agent definition
   */
  async load(agentId: string): Promise<StoredAgentDefinition | null> {
    const sanitizedId = sanitizeAgentId(agentId);
    return this.loadRaw(sanitizedId);
  }

  /**
   * Delete an agent definition
   */
  async delete(agentId: string): Promise<void> {
    const sanitizedId = sanitizeAgentId(agentId);
    const agentDir = join(this.baseDirectory, sanitizedId);
    const filePath = join(agentDir, 'definition.json');

    try {
      await fs.unlink(filePath);
    } catch (error: unknown) {
      if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }

    // Remove from index
    await this.removeFromIndex(agentId);
  }

  /**
   * Check if an agent definition exists
   */
  async exists(agentId: string): Promise<boolean> {
    const sanitizedId = sanitizeAgentId(agentId);
    const filePath = join(this.baseDirectory, sanitizedId, 'definition.json');

    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * List all agent definitions
   */
  async list(options?: AgentDefinitionListOptions): Promise<AgentDefinitionSummary[]> {
    const index = await this.loadIndex();
    let entries = [...index.agents];

    // Apply filters
    if (options?.agentType) {
      entries = entries.filter(e => e.agentType === options.agentType);
    }

    if (options?.tags && options.tags.length > 0) {
      entries = entries.filter(e => {
        const entryTags = e.metadata?.tags ?? [];
        return options.tags!.some(t => entryTags.includes(t));
      });
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
      agentId: e.agentId,
      name: e.name,
      agentType: e.agentType,
      model: e.model,
      createdAt: new Date(e.createdAt),
      updatedAt: new Date(e.updatedAt),
      metadata: e.metadata,
    }));
  }

  /**
   * Update metadata without loading full definition
   */
  async updateMetadata(
    agentId: string,
    metadata: Partial<AgentDefinitionMetadata>
  ): Promise<void> {
    const definition = await this.load(agentId);
    if (!definition) {
      throw new Error(`Agent '${agentId}' not found`);
    }

    definition.metadata = { ...definition.metadata, ...metadata };
    await this.save(definition);
  }

  /**
   * Get storage path
   */
  getPath(): string {
    return this.baseDirectory;
  }

  /**
   * Rebuild the index by scanning all agent directories
   */
  async rebuildIndex(): Promise<void> {
    await this.ensureDirectory(this.baseDirectory);

    const entries = await fs.readdir(this.baseDirectory, { withFileTypes: true });
    const agentDirs = entries.filter(e => e.isDirectory() && !e.name.startsWith('_'));

    const indexEntries: DefinitionIndexEntry[] = [];

    for (const dir of agentDirs) {
      try {
        const filePath = join(this.baseDirectory, dir.name, 'definition.json');
        const data = await fs.readFile(filePath, 'utf-8');
        const definition = JSON.parse(data) as StoredAgentDefinition;
        indexEntries.push(this.definitionToIndexEntry(definition));
      } catch {
        // Skip invalid directories
      }
    }

    this.index = {
      version: 1,
      agents: indexEntries,
      lastUpdated: new Date().toISOString(),
    };

    await this.saveIndex();
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

  private async loadRaw(sanitizedId: string): Promise<StoredAgentDefinition | null> {
    const filePath = join(this.baseDirectory, sanitizedId, 'definition.json');

    try {
      const data = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(data) as StoredAgentDefinition;
    } catch (error: unknown) {
      if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      if (error instanceof SyntaxError) {
        console.warn(`Corrupted agent definition: ${filePath}`);
        return null;
      }
      throw error;
    }
  }

  private async loadIndex(): Promise<DefinitionIndex> {
    if (this.index) {
      return this.index;
    }

    try {
      const data = await fs.readFile(this.indexPath, 'utf-8');
      this.index = JSON.parse(data) as DefinitionIndex;
      return this.index;
    } catch (error: unknown) {
      if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.index = {
          version: 1,
          agents: [],
          lastUpdated: new Date().toISOString(),
        };
        return this.index;
      }
      throw error;
    }
  }

  private async saveIndex(): Promise<void> {
    if (!this.index) return;

    await this.ensureDirectory(this.baseDirectory);
    this.index.lastUpdated = new Date().toISOString();
    const data = this.prettyPrint
      ? JSON.stringify(this.index, null, 2)
      : JSON.stringify(this.index);

    await fs.writeFile(this.indexPath, data, 'utf-8');
  }

  private async updateIndex(definition: StoredAgentDefinition): Promise<void> {
    const index = await this.loadIndex();
    const entry = this.definitionToIndexEntry(definition);

    const existingIdx = index.agents.findIndex(e => e.agentId === definition.agentId);
    if (existingIdx >= 0) {
      index.agents[existingIdx] = entry;
    } else {
      index.agents.push(entry);
    }

    await this.saveIndex();
  }

  private async removeFromIndex(agentId: string): Promise<void> {
    const index = await this.loadIndex();
    index.agents = index.agents.filter(e => e.agentId !== agentId);
    await this.saveIndex();
  }

  private definitionToIndexEntry(definition: StoredAgentDefinition): DefinitionIndexEntry {
    return {
      agentId: definition.agentId,
      name: definition.name,
      agentType: definition.agentType,
      model: definition.connector.model,
      createdAt: definition.createdAt,
      updatedAt: definition.updatedAt,
      metadata: definition.metadata,
    };
  }
}

/**
 * Create a FileAgentDefinitionStorage with default configuration
 */
export function createFileAgentDefinitionStorage(
  config?: FileAgentDefinitionStorageConfig
): FileAgentDefinitionStorage {
  return new FileAgentDefinitionStorage(config);
}
