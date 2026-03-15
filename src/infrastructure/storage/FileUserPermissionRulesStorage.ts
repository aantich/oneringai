/**
 * FileUserPermissionRulesStorage - File-based storage for per-user permission rules.
 *
 * Path: ~/.oneringai/users/<userId>/permission_rules.json
 * Windows: %APPDATA%/oneringai/users/<userId>/permission_rules.json
 *
 * Same pattern as FileUserInfoStorage — atomic writes, userId sanitization.
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { sanitizeUserId, DEFAULT_USER_ID } from './utils.js';
import type { IUserPermissionRulesStorage } from '../../domain/interfaces/IUserPermissionRulesStorage.js';
import type { UserPermissionRule } from '../../core/permissions/types.js';

export interface FileUserPermissionRulesStorageConfig {
  /** Override the base directory (default: ~/.oneringai/users) */
  baseDirectory?: string;
  /** Override the filename (default: permission_rules.json) */
  filename?: string;
}

interface StoredRulesFile {
  version: 1;
  userId: string;
  rules: UserPermissionRule[];
}

function getDefaultBaseDirectory(): string {
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || process.env.LOCALAPPDATA;
    if (appData) {
      return join(appData, 'oneringai', 'users');
    }
  }
  return join(homedir(), '.oneringai', 'users');
}

export class FileUserPermissionRulesStorage implements IUserPermissionRulesStorage {
  private readonly baseDirectory: string;
  private readonly filename: string;

  constructor(config?: FileUserPermissionRulesStorageConfig) {
    this.baseDirectory = config?.baseDirectory ?? getDefaultBaseDirectory();
    this.filename = config?.filename ?? 'permission_rules.json';
  }

  private getUserDirectory(userId: string | undefined): string {
    return join(this.baseDirectory, sanitizeUserId(userId));
  }

  private getUserFilePath(userId: string | undefined): string {
    return join(this.getUserDirectory(userId), this.filename);
  }

  async load(userId: string | undefined): Promise<UserPermissionRule[] | null> {
    const filePath = this.getUserFilePath(userId);
    try {
      const raw = await fs.readFile(filePath, 'utf-8');
      const data = JSON.parse(raw) as StoredRulesFile;
      if (data.version === 1 && Array.isArray(data.rules)) {
        return data.rules.length > 0 ? data.rules : null;
      }
      return null;
    } catch (error: unknown) {
      if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  async save(userId: string | undefined, rules: UserPermissionRule[]): Promise<void> {
    const directory = this.getUserDirectory(userId);
    const filePath = this.getUserFilePath(userId);

    await this.ensureDirectory(directory);

    const data: StoredRulesFile = {
      version: 1,
      userId: userId || DEFAULT_USER_ID,
      rules,
    };

    const tempPath = `${filePath}.tmp`;
    try {
      await fs.writeFile(tempPath, JSON.stringify(data, null, 2), 'utf-8');
      await fs.rename(tempPath, filePath);
    } catch (error) {
      try { await fs.unlink(tempPath); } catch { /* ignore */ }
      throw error;
    }
  }

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

  async exists(userId: string | undefined): Promise<boolean> {
    try {
      await fs.access(this.getUserFilePath(userId));
      return true;
    } catch {
      return false;
    }
  }

  getPath(userId: string | undefined): string {
    return this.getUserFilePath(userId);
  }

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
