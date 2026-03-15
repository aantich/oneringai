/**
 * FileCorrelationStorage - File-based storage for correlation mappings
 *
 * Stores correlation entries as individual JSON files on disk.
 * Path: ~/.oneringai/correlations/<correlationId-hash>.json
 *
 * Features:
 * - Safe filename hashing for arbitrary correlation IDs
 * - Reverse index by sessionId for cleanup on resume
 * - Automatic expiry checking on resolve
 * - Atomic file operations (write to temp, then rename)
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { createHash } from 'crypto';
import type {
  ICorrelationStorage,
  SessionRef,
  CorrelationSummary,
} from '../../domain/interfaces/ICorrelationStorage.js';

/**
 * Configuration for FileCorrelationStorage
 */
export interface FileCorrelationStorageConfig {
  /** Override the base directory (default: ~/.oneringai/correlations) */
  baseDirectory?: string;
}

/**
 * Stored entry format (on disk)
 */
interface StoredCorrelation {
  version: 1;
  correlationId: string;
  ref: SessionRef;
  createdAt: string;
}

/**
 * Hash a correlation ID to a safe filename
 */
function hashCorrelationId(correlationId: string): string {
  return createHash('sha256').update(correlationId).digest('hex').slice(0, 32);
}

/**
 * File-based implementation of ICorrelationStorage
 */
export class FileCorrelationStorage implements ICorrelationStorage {
  private readonly baseDir: string;
  private _initialized = false;

  constructor(config?: FileCorrelationStorageConfig) {
    this.baseDir = config?.baseDirectory ?? join(homedir(), '.oneringai', 'correlations');
  }

  private async ensureDir(): Promise<void> {
    if (this._initialized) return;
    await fs.mkdir(this.baseDir, { recursive: true });
    this._initialized = true;
  }

  private getFilePath(correlationId: string): string {
    return join(this.baseDir, `${hashCorrelationId(correlationId)}.json`);
  }

  async save(correlationId: string, ref: SessionRef): Promise<void> {
    await this.ensureDir();

    const entry: StoredCorrelation = {
      version: 1,
      correlationId,
      ref,
      createdAt: new Date().toISOString(),
    };

    const filePath = this.getFilePath(correlationId);
    const tmpPath = `${filePath}.tmp`;

    await fs.writeFile(tmpPath, JSON.stringify(entry, null, 2), 'utf-8');
    await fs.rename(tmpPath, filePath);
  }

  async resolve(correlationId: string): Promise<SessionRef | null> {
    try {
      const filePath = this.getFilePath(correlationId);
      const data = await fs.readFile(filePath, 'utf-8');
      const entry: StoredCorrelation = JSON.parse(data);

      // Check expiry
      if (new Date(entry.ref.expiresAt) < new Date()) {
        // Expired — clean up and return null
        await this.delete(correlationId);
        return null;
      }

      return entry.ref;
    } catch (err: any) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  }

  async delete(correlationId: string): Promise<void> {
    try {
      await fs.unlink(this.getFilePath(correlationId));
    } catch (err: any) {
      if (err.code !== 'ENOENT') throw err;
    }
  }

  async exists(correlationId: string): Promise<boolean> {
    const ref = await this.resolve(correlationId);
    return ref !== null;
  }

  async listBySession(sessionId: string): Promise<string[]> {
    const all = await this._readAll();
    return all
      .filter(e => e.ref.sessionId === sessionId)
      .map(e => e.correlationId);
  }

  async listByAgent(agentId: string): Promise<CorrelationSummary[]> {
    const all = await this._readAll();
    const now = new Date();

    return all
      .filter(e => e.ref.agentId === agentId)
      .map(e => ({
        correlationId: e.correlationId,
        agentId: e.ref.agentId,
        sessionId: e.ref.sessionId,
        suspendedAt: e.ref.suspendedAt,
        expiresAt: e.ref.expiresAt,
        isExpired: new Date(e.ref.expiresAt) < now,
      }));
  }

  async pruneExpired(): Promise<number> {
    const all = await this._readAll();
    const now = new Date();
    let pruned = 0;

    for (const entry of all) {
      if (new Date(entry.ref.expiresAt) < now) {
        await this.delete(entry.correlationId);
        pruned++;
      }
    }

    return pruned;
  }

  getPath(): string {
    return this.baseDir;
  }

  /**
   * Read all stored correlation entries
   */
  private async _readAll(): Promise<StoredCorrelation[]> {
    await this.ensureDir();
    const entries: StoredCorrelation[] = [];

    try {
      const files = await fs.readdir(this.baseDir);

      for (const file of files) {
        if (!file.endsWith('.json') || file.endsWith('.tmp')) continue;
        try {
          const data = await fs.readFile(join(this.baseDir, file), 'utf-8');
          const entry: StoredCorrelation = JSON.parse(data);
          if (entry.version === 1 && entry.correlationId && entry.ref) {
            entries.push(entry);
          }
        } catch {
          // Skip corrupt files
        }
      }
    } catch (err: any) {
      if (err.code !== 'ENOENT') throw err;
    }

    return entries;
  }
}

/**
 * Create a FileCorrelationStorage with default settings
 */
export function createFileCorrelationStorage(config?: FileCorrelationStorageConfig): FileCorrelationStorage {
  return new FileCorrelationStorage(config);
}
