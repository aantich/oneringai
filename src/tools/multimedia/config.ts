/**
 * Module-level configuration for multimedia output storage
 *
 * Delegates to StorageRegistry for centralized storage management.
 * The public API (getMediaStorage / setMediaStorage) stays the same.
 *
 * @example
 * ```typescript
 * import { setMediaStorage } from 'oneringai';
 *
 * // Use custom S3 storage before creating agents
 * setMediaStorage(myS3Storage);
 * ```
 */

import type { IMediaStorage } from '../../domain/interfaces/IMediaStorage.js';
import { FileMediaStorage } from '../../infrastructure/storage/FileMediaStorage.js';
import { StorageRegistry } from '../../core/StorageRegistry.js';

/**
 * Get the global media storage (creates default FileMediaStorage on first access)
 */
export function getMediaStorage(): IMediaStorage {
  return StorageRegistry.resolve('media', () => new FileMediaStorage());
}

/**
 * Set a custom global media storage
 *
 * Call this before agent creation to use custom storage (S3, GCS, etc.)
 */
export function setMediaStorage(storage: IMediaStorage): void {
  StorageRegistry.set('media', storage);
}

// ============================================================================
// Deprecated aliases (remove in next major version)
// ============================================================================

/** @deprecated Use `getMediaStorage()` instead */
export const getMediaOutputHandler = getMediaStorage;

/** @deprecated Use `setMediaStorage()` instead */
export const setMediaOutputHandler = setMediaStorage;
