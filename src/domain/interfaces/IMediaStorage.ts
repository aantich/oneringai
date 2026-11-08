import type { MediaBytes } from '#oneringai-media-bytes';
/**
 * IMediaStorage - Storage interface for multimedia outputs (images, video, audio)
 *
 * Provides CRUD operations for media files produced by generation tools.
 * Implementations can use filesystem, S3, GCS, or any other storage backend.
 *
 * This follows Clean Architecture - the interface is in domain layer,
 * implementations are in infrastructure layer.
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Metadata about media being saved
 */
export interface MediaStorageMetadata {
  /** Type of media being saved */
  type: 'image' | 'video' | 'audio';
  /** File format (png, mp4, mp3, etc.) */
  format: string;
  /** Model used for generation */
  model: string;
  /** Vendor that produced the output */
  vendor: string;
  /** Index for multi-image results */
  index?: number;
  /** Suggested filename (without path) */
  suggestedFilename?: string;
  /** User ID — set by tool when userId is known, for per-user storage organization */
  userId?: string;
}

/**
 * Result of a save operation
 */
export interface MediaStorageResult {
  /** Location of the saved file (file path, URL, S3 key - depends on implementation) */
  location: string;
  /** MIME type of the saved file */
  mimeType: string;
  /** File size in bytes */
  size: number;
}

/**
 * Entry returned by list()
 */
export interface MediaStorageEntry {
  /** Location of the file */
  location: string;
  /** MIME type */
  mimeType: string;
  /** File size in bytes */
  size: number;
  /** Media type (image, video, audio) */
  type?: 'image' | 'video' | 'audio';
  /** When the file was created */
  createdAt: Date;
}

/**
 * Options for listing media files
 */
export interface MediaStorageListOptions {
  /** Filter by media type */
  type?: 'image' | 'video' | 'audio';
  /** Maximum number of results */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
}

// ============================================================================
// Storage Interface
// ============================================================================

/**
 * Storage interface for multimedia outputs
 *
 * Implementations:
 * - FileMediaStorage: File-based storage (default, uses local filesystem)
 * - (Custom) S3MediaStorage, GCSMediaStorage, etc.
 */
export interface IMediaStorage {
  /**
   * Save media data to storage
   *
   * @param data - Raw media data as Buffer
   * @param metadata - Information about the media for naming/organization
   * @returns Location and metadata of the saved file
   */
  save(data: MediaBytes, metadata: MediaStorageMetadata): Promise<MediaStorageResult>;

  /**
   * Read media data from storage
   *
   * @param location - Location string returned by save() or known file path
   * @returns The raw media data, or null if not found
   */
  read(location: string): Promise<MediaBytes | null>;

  /**
   * Delete media from storage
   *
   * @param location - Location string to delete
   * @throws Does NOT throw if the file doesn't exist
   */
  delete(location: string): Promise<void>;

  /**
   * Check if media exists in storage
   *
   * @param location - Location string to check
   */
  exists(location: string): Promise<boolean>;

  /**
   * List media files in storage (optional)
   *
   * @param options - Filtering and pagination options
   */
  list?(options?: MediaStorageListOptions): Promise<MediaStorageEntry[]>;

  /**
   * Get the storage path/location (for display/debugging)
   */
  getPath(): string;
}
