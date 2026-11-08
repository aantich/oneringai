import { encodeBase64, decodeBase64 } from '../infrastructure/runtime/primitives.js';
/**
 * Image utilities for processing images
 */

export interface ImageData {
  mimeType: string;
  base64Data: string;
  size: number;
}

export interface FetchImageOptions {
  /** Timeout in milliseconds (default: 30000) */
  timeoutMs?: number;
  /** Maximum image size in bytes (default: 10MB) */
  maxSizeBytes?: number;
}

const DEFAULT_TIMEOUT_MS = 30000; // 30 seconds
const DEFAULT_MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

/**
 * Fetch an image from URL and convert to base64
 * Used by providers that require base64 (like Google)
 */
export async function fetchImageAsBase64(
  url: string,
  options?: FetchImageOptions
): Promise<ImageData> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, maxSizeBytes = DEFAULT_MAX_SIZE_BYTES } = options || {};

  // Check if it's already a data URI
  if (url.startsWith('data:image/')) {
    const matches = url.match(/^data:(image\/\w+);base64,(.+)$/);
    if (matches) {
      const base64Data = matches[2] || '';
      const size = calculateBase64Size(base64Data);

      // Check size limit for data URIs too
      if (size > maxSizeBytes) {
        throw new Error(`Image size (${formatBytes(size)}) exceeds maximum allowed (${formatBytes(maxSizeBytes)})`);
      }

      return {
        mimeType: matches[1] || 'image/png',
        base64Data,
        size,
      };
    }
  }

  // Fetch from URL with timeout and size limit
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
    }

    // Check content-length header before downloading
    const contentLength = response.headers.get('content-length');
    if (contentLength) {
      const size = parseInt(contentLength, 10);
      if (size > maxSizeBytes) {
        throw new Error(
          `Image size (${formatBytes(size)}) exceeds maximum allowed (${formatBytes(maxSizeBytes)})`
        );
      }
    }

    // Stream the response with size limit
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('Failed to get response body reader');
    }

    const chunks: Uint8Array[] = [];
    let totalSize = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      totalSize += value.length;
      if (totalSize > maxSizeBytes) {
        reader.cancel();
        throw new Error(
          `Image size exceeds maximum allowed (${formatBytes(maxSizeBytes)})`
        );
      }
      chunks.push(value);
    }

    // Combine chunks into a single buffer
    const buffer = new Uint8Array(totalSize);
    let offset = 0;
    for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.length; }
    const base64Data = encodeBase64(buffer);

    // Detect MIME type from content-type header or buffer magic numbers
    let mimeType = response.headers.get('content-type') || 'image/png';

    // Validate it's an image
    if (!mimeType.startsWith('image/')) {
      // Try to detect from magic numbers
      mimeType = detectImageFormatFromBuffer(buffer);
    }

    return {
      mimeType,
      base64Data,
      size: buffer.length,
    };
  } catch (error: any) {
    if (error.name === 'AbortError') {
      throw new Error(`Image fetch timed out after ${timeoutMs}ms`);
    }
    throw new Error(`Failed to fetch image from URL: ${error.message}`);
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Detect image format from buffer magic numbers
 */
function detectImageFormatFromBuffer(buffer: Uint8Array): string {
  const magic = Array.from(buffer.subarray(0, 4), value => value.toString(16).padStart(2, '0')).join('');

  if (magic.startsWith('89504e47')) return 'image/png';
  if (magic.startsWith('ffd8ff')) return 'image/jpeg';
  if (magic.startsWith('47494638')) return 'image/gif';
  if (magic.startsWith('52494646')) return 'image/webp';

  throw new Error('URL does not point to a valid image');
}

/**
 * Detect image format from base64 data
 */
export function detectImageFormat(base64Data: string): string {
  const buffer = decodeBase64(base64Data);
  const magic = Array.from(buffer.subarray(0, 4), value => value.toString(16).padStart(2, '0')).join('');

  if (magic.startsWith('89504e47')) return 'image/png';
  if (magic.startsWith('ffd8ff')) return 'image/jpeg';
  if (magic.startsWith('47494638')) return 'image/gif';
  if (magic.startsWith('52494646')) return 'image/webp';

  return 'image/png'; // Default
}

/**
 * Calculate accurate size from base64 data (in bytes)
 * Accounts for padding characters
 */
export function calculateBase64Size(base64Data: string): number {
  // Remove data URI prefix if present
  const data = base64Data.includes(',') ? base64Data.split(',')[1] : base64Data;

  if (!data || data.length === 0) return 0;

  // Count padding characters
  let padding = 0;
  if (data.endsWith('==')) padding = 2;
  else if (data.endsWith('=')) padding = 1;

  // Accurate calculation: (length * 3 / 4) - padding
  return Math.floor((data.length * 3) / 4) - padding;
}

/**
 * Format bytes into human-readable string
 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
