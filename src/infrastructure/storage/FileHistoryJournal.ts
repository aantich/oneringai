/**
 * FileHistoryJournal - JSONL-based append-only conversation history journal
 *
 * Stores history entries as newline-delimited JSON (JSONL) files alongside
 * session state files. Each line is a self-contained JSON object representing
 * one HistoryEntry.
 *
 * Path: <sessionsDirectory>/<sessionId>.history.jsonl
 *
 * Design:
 * - Append-only writes (fast, no rewrite of existing data)
 * - Line-based reads with filtering (no need to parse entire file for counts)
 * - Streaming support via async iteration
 * - Automatic directory creation on first write
 *
 * @example
 * ```typescript
 * const journal = new FileHistoryJournal('/path/to/sessions');
 *
 * // Append (fast, append-only)
 * await journal.append('session-1', [{ timestamp: Date.now(), type: 'user', item: msg, turnIndex: 0 }]);
 *
 * // Read with filtering
 * const entries = await journal.read('session-1', { limit: 50, types: ['user', 'assistant'] });
 *
 * // Stream large histories
 * for await (const entry of journal.stream!('session-1')) {
 *   console.log(entry.type, entry.turnIndex);
 * }
 * ```
 */

import { promises as fs } from 'fs';
import { createReadStream } from 'fs';
import { sanitizeId } from './utils.js';
import { join } from 'path';
import { createInterface } from 'readline';
import type { IHistoryJournal, HistoryEntry, HistoryReadOptions } from '../../domain/interfaces/IHistoryJournal.js';

/**
 * Sanitize ID for use as a filename.
 * Same logic as FileContextStorage to ensure matching paths.
 */
// sanitizeId imported from ./utils.js

/**
 * File-based history journal using JSONL format.
 */
export class FileHistoryJournal implements IHistoryJournal {
  private readonly sessionsDirectory: string;
  private directoryEnsured = false;

  constructor(sessionsDirectory: string) {
    this.sessionsDirectory = sessionsDirectory;
  }

  /**
   * Get the JSONL file path for a session's history.
   */
  private journalPath(sessionId: string): string {
    return join(this.sessionsDirectory, `${sanitizeId(sessionId)}.history.jsonl`);
  }

  /**
   * Ensure the sessions directory exists (lazy, once per instance).
   */
  private async ensureDirectory(): Promise<void> {
    if (this.directoryEnsured) return;
    await fs.mkdir(this.sessionsDirectory, { recursive: true });
    this.directoryEnsured = true;
  }

  /**
   * Append entries to the journal file.
   *
   * Uses fs.appendFile which is atomic for small writes on most filesystems.
   * Each entry is serialized as a single JSON line.
   */
  async append(sessionId: string, entries: HistoryEntry[]): Promise<void> {
    if (entries.length === 0) return;

    await this.ensureDirectory();

    const lines = entries.map(e => JSON.stringify(e)).join('\n') + '\n';
    await fs.appendFile(this.journalPath(sessionId), lines, 'utf-8');
  }

  /**
   * Read history entries with optional filtering and pagination.
   *
   * For large files, prefer stream() with pagination.
   */
  async read(sessionId: string, options?: HistoryReadOptions): Promise<HistoryEntry[]> {
    const filePath = this.journalPath(sessionId);

    let content: string;
    try {
      content = await fs.readFile(filePath, 'utf-8');
    } catch (error: unknown) {
      if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw error;
    }

    const trimmed = content.trim();
    if (!trimmed) return [];

    let entries: HistoryEntry[] = [];
    for (const line of trimmed.split('\n')) {
      if (!line) continue;
      try {
        entries.push(JSON.parse(line) as HistoryEntry);
      } catch {
        // Skip malformed lines (defensive)
      }
    }

    // Apply filters
    entries = this.applyFilters(entries, options);

    // Apply pagination
    if (options?.offset) {
      entries = entries.slice(options.offset);
    }
    if (options?.limit) {
      entries = entries.slice(0, options.limit);
    }

    return entries;
  }

  /**
   * Count entries without fully parsing the file.
   *
   * Counts non-empty lines in the JSONL file.
   */
  async count(sessionId: string): Promise<number> {
    const filePath = this.journalPath(sessionId);

    let content: string;
    try {
      content = await fs.readFile(filePath, 'utf-8');
    } catch (error: unknown) {
      if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
        return 0;
      }
      throw error;
    }

    const trimmed = content.trim();
    if (!trimmed) return 0;

    // Count non-empty lines
    let count = 0;
    for (const line of trimmed.split('\n')) {
      if (line) count++;
    }
    return count;
  }

  /**
   * Delete the journal file for a session.
   */
  async clear(sessionId: string): Promise<void> {
    try {
      await fs.unlink(this.journalPath(sessionId));
    } catch (error: unknown) {
      if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
        return; // Already gone
      }
      throw error;
    }
  }

  /**
   * Stream history entries line-by-line using readline.
   *
   * Memory-efficient for large histories — only one entry in memory at a time.
   */
  async *stream(sessionId: string, options?: HistoryReadOptions): AsyncIterable<HistoryEntry> {
    const filePath = this.journalPath(sessionId);

    // Check file exists
    try {
      await fs.access(filePath);
    } catch {
      return; // No journal file
    }

    const fileStream = createReadStream(filePath, { encoding: 'utf-8' });
    const rl = createInterface({ input: fileStream, crlfDelay: Infinity });

    let offset = options?.offset ?? 0;
    let limit = options?.limit ?? Infinity;
    let yielded = 0;

    try {
      for await (const line of rl) {
        if (!line) continue;

        let entry: HistoryEntry;
        try {
          entry = JSON.parse(line) as HistoryEntry;
        } catch {
          continue; // Skip malformed lines
        }

        // Apply filters
        if (!this.matchesFilters(entry, options)) continue;

        // Apply offset
        if (offset > 0) {
          offset--;
          continue;
        }

        // Apply limit
        if (yielded >= limit) break;

        yield entry;
        yielded++;
      }
    } finally {
      rl.close();
      fileStream.destroy();
    }
  }

  /**
   * Get the file path for a session's journal (for debugging).
   */
  getLocation(sessionId: string): string {
    return this.journalPath(sessionId);
  }

  // ============================================================================
  // Private helpers
  // ============================================================================

  /**
   * Apply non-pagination filters to an array of entries.
   */
  private applyFilters(entries: HistoryEntry[], options?: HistoryReadOptions): HistoryEntry[] {
    if (!options) return entries;

    return entries.filter(e => this.matchesFilters(e, options));
  }

  /**
   * Check if a single entry matches the filter criteria.
   */
  private matchesFilters(entry: HistoryEntry, options?: HistoryReadOptions): boolean {
    if (!options) return true;

    if (options.types && options.types.length > 0 && !options.types.includes(entry.type)) {
      return false;
    }
    if (options.after !== undefined && entry.timestamp < options.after) {
      return false;
    }
    if (options.before !== undefined && entry.timestamp > options.before) {
      return false;
    }
    if (options.fromTurn !== undefined && entry.turnIndex < options.fromTurn) {
      return false;
    }
    if (options.toTurn !== undefined && entry.turnIndex > options.toTurn) {
      return false;
    }

    return true;
  }
}
