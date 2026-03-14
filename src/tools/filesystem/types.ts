/**
 * Filesystem Tools - Shared Types
 *
 * Common types and configuration for filesystem operations.
 */

import { readdir } from 'node:fs/promises';
import { resolve, normalize, isAbsolute, join, sep } from 'node:path';
import { homedir } from 'node:os';
import type { DocumentReaderConfig } from '../../capabilities/documents/types.js';

/**
 * Configuration for filesystem tools
 */
export interface FilesystemToolConfig {
  /**
   * Base working directory for all operations.
   * All paths will be resolved relative to this directory.
   * Defaults to process.cwd()
   */
  workingDirectory?: string;

  /**
   * Allowed directories for file operations.
   * If specified, operations outside these directories will be blocked.
   * Paths can be absolute or relative to workingDirectory.
   */
  allowedDirectories?: string[];

  /**
   * Blocked directories (e.g., node_modules, .git).
   * Operations in these directories will be blocked.
   */
  blockedDirectories?: string[];

  /**
   * Maximum file size to read (in bytes).
   * Default: 10MB
   */
  maxFileSize?: number;

  /**
   * Maximum number of results for glob/grep operations.
   * Default: 1000
   */
  maxResults?: number;

  /**
   * Whether to follow symlinks.
   * Default: false
   */
  followSymlinks?: boolean;

  /**
   * File extensions to exclude from search.
   * Default: common binary extensions
   */
  excludeExtensions?: string[];

  /**
   * Document reader config for non-text file formats (PDF, DOCX, XLSX, etc.).
   * When set, read_file will automatically convert binary document formats to markdown.
   */
  documentReaderConfig?: DocumentReaderConfig;
}

/**
 * Default configuration
 */
/** FilesystemToolConfig with all base fields required (documentReaderConfig remains optional) */
export type FilesystemToolConfigDefaults = Required<Omit<FilesystemToolConfig, 'documentReaderConfig'>> & Pick<FilesystemToolConfig, 'documentReaderConfig'>;

export const DEFAULT_FILESYSTEM_CONFIG: FilesystemToolConfigDefaults = {
  workingDirectory: process.cwd(),
  allowedDirectories: [],
  blockedDirectories: ['node_modules', '.git', '.svn', '.hg', '__pycache__', '.cache'],
  maxFileSize: 10 * 1024 * 1024, // 10MB
  maxResults: 1000,
  followSymlinks: false,
  excludeExtensions: [
    '.exe', '.dll', '.so', '.dylib', '.bin', '.obj', '.o', '.a',
    '.zip', '.tar', '.gz', '.bz2', '.7z', '.rar',
    '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.svg', '.webp',
    '.mp3', '.mp4', '.wav', '.avi', '.mov', '.mkv',
    // Note: .pdf, .docx, .xlsx, .pptx are NOT excluded — DocumentReader handles them
    '.doc', '.xls', '.ppt', // Legacy Office formats not yet supported
    '.woff', '.woff2', '.ttf', '.eot', '.otf',
  ],
};

/**
 * Result of a file read operation
 */
export interface ReadFileResult {
  success: boolean;
  content?: string;
  lines?: number;
  truncated?: boolean;
  encoding?: string;
  size?: number;
  error?: string;
  path?: string;
}

/**
 * Result of a file write operation
 */
export interface WriteFileResult {
  success: boolean;
  path?: string;
  bytesWritten?: number;
  created?: boolean;
  error?: string;
}

/**
 * Result of a file edit operation
 */
export interface EditFileResult {
  success: boolean;
  path?: string;
  replacements?: number;
  error?: string;
  diff?: string;
}

/**
 * Result of a glob operation
 */
export interface GlobResult {
  success: boolean;
  files?: string[];
  count?: number;
  truncated?: boolean;
  error?: string;
}

/**
 * A single grep match
 */
export interface GrepMatch {
  file: string;
  line: number;
  column?: number;
  content: string;
  context?: {
    before: string[];
    after: string[];
  };
}

/**
 * Result of a grep operation
 */
export interface GrepResult {
  success: boolean;
  matches?: GrepMatch[];
  filesSearched?: number;
  filesMatched?: number;
  totalMatches?: number;
  truncated?: boolean;
  error?: string;
}

/**
 * Normalize a path to use forward slashes (for consistent cross-platform behavior).
 * On Windows, path.relative() and path.resolve() return backslash-separated paths,
 * which breaks glob pattern matching and directory filtering.
 */
export function toForwardSlash(p: string): string {
  return sep === '\\' ? p.replace(/\\/g, '/') : p;
}

/**
 * Validate and resolve a path within allowed boundaries
 */
export function validatePath(
  inputPath: string,
  config: FilesystemToolConfig = {}
): { valid: boolean; resolvedPath: string; error?: string } {
  const workingDir = config.workingDirectory || process.cwd();
  const allowedDirs = config.allowedDirectories || [];
  const blockedDirs = config.blockedDirectories || DEFAULT_FILESYSTEM_CONFIG.blockedDirectories;

  // Expand tilde (~) to home directory
  let expandedPath = inputPath;
  if (inputPath.startsWith('~/')) {
    expandedPath = resolve(homedir(), inputPath.slice(2));
  } else if (inputPath === '~') {
    expandedPath = homedir();
  }

  // Resolve the path
  let resolvedPath: string;
  if (isAbsolute(expandedPath)) {
    resolvedPath = normalize(expandedPath);
  } else {
    resolvedPath = resolve(workingDir, expandedPath);
  }

  // Check blocked directories - check if any path segment matches a blocked directory name
  // Use forward slashes for consistent matching across platforms
  const normalizedResolved = toForwardSlash(resolvedPath);
  const pathSegments = normalizedResolved.split('/').filter(Boolean);
  for (const blocked of blockedDirs) {
    // If blocked is a simple name (no slashes), check path segments
    if (!blocked.includes('/')) {
      if (pathSegments.includes(blocked)) {
        return {
          valid: false,
          resolvedPath,
          error: `Path is in blocked directory: ${blocked}`,
        };
      }
    } else {
      // If blocked is a path, resolve it and check prefix
      const blockedPath = toForwardSlash(isAbsolute(blocked) ? blocked : resolve(workingDir, blocked));
      if (normalizedResolved.startsWith(blockedPath + '/') || normalizedResolved === blockedPath) {
        return {
          valid: false,
          resolvedPath,
          error: `Path is in blocked directory: ${blocked}`,
        };
      }
    }
  }

  // Check allowed directories (if specified)
  if (allowedDirs.length > 0) {
    let isAllowed = false;
    for (const allowed of allowedDirs) {
      const allowedPath = toForwardSlash(isAbsolute(allowed) ? allowed : resolve(workingDir, allowed));
      if (normalizedResolved.startsWith(allowedPath + '/') || normalizedResolved === allowedPath) {
        isAllowed = true;
        break;
      }
    }
    if (!isAllowed) {
      return {
        valid: false,
        resolvedPath,
        error: `Path is outside allowed directories`,
      };
    }
  }

  return { valid: true, resolvedPath };
}

/**
 * Expand tilde (~) to the user's home directory
 */
export function expandTilde(inputPath: string): string {
  if (inputPath.startsWith('~/')) {
    return resolve(homedir(), inputPath.slice(2));
  } else if (inputPath === '~') {
    return homedir();
  }
  return inputPath;
}

/**
 * Check if a file extension should be excluded
 */
export function isExcludedExtension(
  filePath: string,
  excludeExtensions: string[] = DEFAULT_FILESYSTEM_CONFIG.excludeExtensions
): boolean {
  const ext = filePath.toLowerCase().substring(filePath.lastIndexOf('.'));
  return excludeExtensions.includes(ext);
}

/**
 * Yielded entry from walkDirectory
 */
export interface WalkEntry {
  /** Full absolute path */
  fullPath: string;
  /** Filename / directory name */
  name: string;
  /** True when the entry is a regular file */
  isFile: boolean;
  /** True when the entry is a directory */
  isDirectory: boolean;
}

/**
 * Shared async generator for recursive directory traversal.
 * Handles blocked directories and depth limits.
 * Both glob.ts and grep.ts use this instead of duplicating traversal logic.
 */
export async function* walkDirectory(
  dir: string,
  config: FilesystemToolConfigDefaults,
  maxDepth: number = 50,
  _depth: number = 0,
): AsyncGenerator<WalkEntry> {
  if (_depth > maxDepth) return;

  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    // Skip directories we can't read
    return;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      const isBlocked = config.blockedDirectories.some(
        blocked => entry.name === blocked,
      );
      if (isBlocked) continue;

      yield { fullPath, name: entry.name, isFile: false, isDirectory: true };
      yield* walkDirectory(fullPath, config, maxDepth, _depth + 1);
    } else if (entry.isFile()) {
      yield { fullPath, name: entry.name, isFile: true, isDirectory: false };
    }
  }
}
