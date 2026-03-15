/**
 * FilePersistentInstructionsStorage - File-based storage for persistent instructions
 *
 * Stores custom agent instructions as a JSON file on disk.
 * Path: ~/.oneringai/agents/<agentId>/custom_instructions.json
 * Windows: %APPDATA%/oneringai/agents/<agentId>/custom_instructions.json
 *
 * Features:
 * - Cross-platform path handling
 * - Safe agent ID sanitization
 * - Atomic file operations
 * - Automatic directory creation
 * - Legacy .md file migration
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { sanitizeId } from './utils.js';
import type { IPersistentInstructionsStorage, InstructionEntry } from '../../domain/interfaces/IPersistentInstructionsStorage.js';

/**
 * Configuration for FilePersistentInstructionsStorage
 */
export interface FilePersistentInstructionsStorageConfig {
  /** Agent ID (used to create unique storage path) */
  agentId: string;
  /** Override the base directory (default: ~/.oneringai/agents) */
  baseDirectory?: string;
  /** Override the filename (default: custom_instructions.json) */
  filename?: string;
}

/**
 * On-disk JSON format for instruction entries
 */
interface StoredInstructionsFile {
  version: 2;
  entries: InstructionEntry[];
}

/**
 * Get the default base directory for persistent instructions
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

// sanitizeAgentId is an alias for sanitizeId from ./utils.js
const sanitizeAgentId = sanitizeId;

/**
 * File-based storage for persistent agent instructions
 */
export class FilePersistentInstructionsStorage implements IPersistentInstructionsStorage {
  private readonly directory: string;
  private readonly filePath: string;
  private readonly legacyFilePath: string;
  private readonly agentId: string;

  constructor(config: FilePersistentInstructionsStorageConfig) {
    this.agentId = config.agentId;
    const sanitizedId = sanitizeAgentId(config.agentId);
    const baseDir = config.baseDirectory ?? getDefaultBaseDirectory();
    const filename = config.filename ?? 'custom_instructions.json';

    this.directory = join(baseDir, sanitizedId);
    this.filePath = join(this.directory, filename);
    this.legacyFilePath = join(this.directory, 'custom_instructions.md');
  }

  /**
   * Load instruction entries from file.
   * Falls back to legacy .md file migration if JSON not found.
   */
  async load(): Promise<InstructionEntry[] | null> {
    // Try JSON file first
    try {
      const raw = await fs.readFile(this.filePath, 'utf-8');
      const data = JSON.parse(raw) as StoredInstructionsFile;
      if (data.version === 2 && Array.isArray(data.entries)) {
        return data.entries.length > 0 ? data.entries : null;
      }
      return null;
    } catch (error: unknown) {
      if (!(error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT')) {
        throw error;
      }
      // JSON file not found — try legacy .md migration
    }

    // Try legacy .md file
    try {
      const content = await fs.readFile(this.legacyFilePath, 'utf-8');
      const trimmed = content.trim();
      if (!trimmed) return null;

      const now = Date.now();
      return [{
        id: 'legacy_instructions',
        content: trimmed,
        createdAt: now,
        updatedAt: now,
      }];
    } catch (error: unknown) {
      if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  /**
   * Save instruction entries to file as JSON.
   * Creates directory if it doesn't exist.
   * Cleans up legacy .md file if present.
   */
  async save(entries: InstructionEntry[]): Promise<void> {
    await this.ensureDirectory();

    const data: StoredInstructionsFile = {
      version: 2,
      entries,
    };

    // Write atomically: write to temp file, then rename
    const tempPath = `${this.filePath}.tmp`;
    try {
      await fs.writeFile(tempPath, JSON.stringify(data, null, 2), 'utf-8');
      await fs.rename(tempPath, this.filePath);
    } catch (error) {
      // Clean up temp file if rename failed
      try {
        await fs.unlink(tempPath);
      } catch {
        // Ignore cleanup errors
      }
      throw error;
    }

    // Clean up legacy .md file if it exists
    await this.removeLegacyFile();
  }

  /**
   * Delete instructions file (and legacy .md if exists)
   */
  async delete(): Promise<void> {
    try {
      await fs.unlink(this.filePath);
    } catch (error: unknown) {
      if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }

    await this.removeLegacyFile();
  }

  /**
   * Check if instructions file exists (JSON or legacy .md)
   */
  async exists(): Promise<boolean> {
    try {
      await fs.access(this.filePath);
      return true;
    } catch {
      // Also check legacy file
      try {
        await fs.access(this.legacyFilePath);
        return true;
      } catch {
        return false;
      }
    }
  }

  /**
   * Get the file path (for display/debugging)
   */
  getPath(): string {
    return this.filePath;
  }

  /**
   * Get the agent ID
   */
  getAgentId(): string {
    return this.agentId;
  }

  /**
   * Ensure the directory exists
   */
  private async ensureDirectory(): Promise<void> {
    try {
      await fs.mkdir(this.directory, { recursive: true });
    } catch (error: unknown) {
      if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error;
      }
    }
  }

  /**
   * Remove legacy .md file if it exists
   */
  private async removeLegacyFile(): Promise<void> {
    try {
      await fs.unlink(this.legacyFilePath);
    } catch (error: unknown) {
      if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code !== 'ENOENT') {
        // Log but don't throw — this is a best-effort cleanup
        console.warn(`Failed to remove legacy instructions file: ${this.legacyFilePath}`);
      }
    }
  }
}
