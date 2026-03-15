/**
 * Shared storage utilities for file-based storage implementations.
 */

import { promises as fs } from 'fs';

/** Default user ID when none is provided */
export const DEFAULT_USER_ID = 'default';

/**
 * Sanitize an ID for use as a filesystem-safe directory/file name.
 * Replaces unsafe chars with underscores, collapses multiples, trims, lowercases.
 *
 * @param id - Raw identifier string
 * @param fallback - Fallback value if sanitized result is empty (default: 'default')
 */
export function sanitizeId(id: string, fallback = 'default'): string {
  return id
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .toLowerCase()
    || fallback;
}

/**
 * Sanitize an optional user ID. Returns DEFAULT_USER_ID when undefined/empty.
 */
export function sanitizeUserId(userId: string | undefined): string {
  if (!userId) return DEFAULT_USER_ID;
  return sanitizeId(userId, DEFAULT_USER_ID);
}

/**
 * Ensure a directory exists, creating it recursively if needed.
 */
export async function ensureDirectory(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

/**
 * Extract an error message safely from an unknown error value.
 */
export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
