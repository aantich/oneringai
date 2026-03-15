/**
 * FileUserInfoStorage - File-based storage for user information
 *
 * Stores user information as a JSON file on disk.
 * Path: ~/.oneringai/users/<userId>/user_info.json
 * Windows: %APPDATA%/oneringai/users/<userId>/user_info.json
 *
 * Features:
 * - Cross-platform path handling
 * - Safe user ID sanitization
 * - Atomic file operations
 * - Automatic directory creation
 * - Multi-user support (one storage instance for all users)
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { sanitizeUserId, DEFAULT_USER_ID } from './utils.js';
import type { IUserInfoStorage, UserInfoEntry } from '../../domain/interfaces/IUserInfoStorage.js';

/**
 * Configuration for FileUserInfoStorage
 */
export interface FileUserInfoStorageConfig {
  /** Override the base directory (default: ~/.oneringai/users) */
  baseDirectory?: string;
  /** Override the filename (default: user_info.json) */
  filename?: string;
}

/**
 * On-disk JSON format for user info entries
 */
interface StoredUserInfoFile {
  version: 1;
  userId: string;
  entries: UserInfoEntry[];
}

/**
 * Get the default base directory for user info
 * Uses ~/.oneringai/users on Unix-like systems
 * Uses %APPDATA%/oneringai/users on Windows
 */
function getDefaultBaseDirectory(): string {
  const platform = process.platform;

  if (platform === 'win32') {
    // Windows: Use APPDATA if available, otherwise fall back to home
    const appData = process.env.APPDATA || process.env.LOCALAPPDATA;
    if (appData) {
      return join(appData, 'oneringai', 'users');
    }
  }

  // Unix-like (Linux, macOS) and fallback: Use home directory
  return join(homedir(), '.oneringai', 'users');
}

// DEFAULT_USER_ID imported from ./utils.js

/**
 * Sanitize user ID for use as a directory name
 * Removes or replaces characters that are not safe for filenames
 */
// sanitizeUserId imported from ./utils.js

/**
 * File-based storage for user information
 *
 * Single instance handles all users. UserId is passed to each method.
 */
export class FileUserInfoStorage implements IUserInfoStorage {
  private readonly baseDirectory: string;
  private readonly filename: string;

  constructor(config?: FileUserInfoStorageConfig) {
    this.baseDirectory = config?.baseDirectory ?? getDefaultBaseDirectory();
    this.filename = config?.filename ?? 'user_info.json';
  }

  /**
   * Get the directory path for a specific user
   */
  private getUserDirectory(userId: string | undefined): string {
    const sanitizedId = sanitizeUserId(userId);
    return join(this.baseDirectory, sanitizedId);
  }

  /**
   * Get the file path for a specific user
   */
  private getUserFilePath(userId: string | undefined): string {
    return join(this.getUserDirectory(userId), this.filename);
  }

  /**
   * Load user info entries from file for a specific user
   */
  async load(userId: string | undefined): Promise<UserInfoEntry[] | null> {
    const filePath = this.getUserFilePath(userId);

    try {
      const raw = await fs.readFile(filePath, 'utf-8');
      const data = JSON.parse(raw) as StoredUserInfoFile;
      if (data.version === 1 && Array.isArray(data.entries)) {
        return data.entries.length > 0 ? data.entries : null;
      }
      return null;
    } catch (error: unknown) {
      if (!(error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT')) {
        throw error;
      }
      // File not found
      return null;
    }
  }

  /**
   * Save user info entries to file for a specific user
   * Creates directory if it doesn't exist.
   */
  async save(userId: string | undefined, entries: UserInfoEntry[]): Promise<void> {
    const directory = this.getUserDirectory(userId);
    const filePath = this.getUserFilePath(userId);

    await this.ensureDirectory(directory);

    const data: StoredUserInfoFile = {
      version: 1,
      userId: userId || DEFAULT_USER_ID,
      entries,
    };

    // Write atomically: write to temp file, then rename
    const tempPath = `${filePath}.tmp`;
    try {
      await fs.writeFile(tempPath, JSON.stringify(data, null, 2), 'utf-8');
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
  }

  /**
   * Delete user info file for a specific user
   */
  async delete(userId: string | undefined): Promise<void> {
    const filePath = this.getUserFilePath(userId);

    try {
      await fs.unlink(filePath);
    } catch (error: unknown) {
      if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }

  /**
   * Check if user info file exists for a specific user
   */
  async exists(userId: string | undefined): Promise<boolean> {
    const filePath = this.getUserFilePath(userId);

    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get the file path for a specific user (for display/debugging)
   */
  getPath(userId: string | undefined): string {
    return this.getUserFilePath(userId);
  }

  /**
   * Ensure the directory exists
   */
  private async ensureDirectory(directory: string): Promise<void> {
    try {
      await fs.mkdir(directory, { recursive: true });
    } catch (error: unknown) {
      if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error;
      }
    }
  }
}
