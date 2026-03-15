/**
 * List Directory Tool
 *
 * Lists contents of a directory on the local filesystem.
 * Shows files and directories with metadata.
 *
 * Features:
 * - Lists files and directories
 * - Shows file sizes and modification times
 * - Supports recursive listing
 * - Filters by type (files only, directories only)
 */

import { readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { ToolFunction } from '../../domain/entities/Tool.js';
import {
  type FilesystemToolConfig,
  type FilesystemToolConfigDefaults,
  DEFAULT_FILESYSTEM_CONFIG,
  validatePath,
  toForwardSlash,
} from './types.js';

/**
 * Arguments for the list directory tool
 */
export interface ListDirectoryArgs {
  /** Path to the directory to list */
  path: string;
  /** Whether to list recursively */
  recursive?: boolean;
  /** Filter: "files" for files only, "directories" for directories only */
  filter?: 'files' | 'directories';
  /** Maximum depth for recursive listing (default: 3) */
  max_depth?: number;
}

/**
 * A single directory entry
 */
export interface DirectoryEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  modified?: string;
}

/**
 * Result of a list directory operation
 */
export interface ListDirectoryResult {
  success: boolean;
  entries?: DirectoryEntry[];
  count?: number;
  truncated?: boolean;
  error?: string;
}

/**
 * Recursively list directory contents
 */
async function listDir(
  dir: string,
  baseDir: string,
  config: FilesystemToolConfigDefaults,
  recursive: boolean,
  filter?: 'files' | 'directories',
  maxDepth: number = 3,
  currentDepth: number = 0,
  entries: DirectoryEntry[] = []
): Promise<DirectoryEntry[]> {
  if (currentDepth > maxDepth || entries.length >= config.maxResults) {
    return entries;
  }

  try {
    const dirEntries = await readdir(dir, { withFileTypes: true });

    for (const entry of dirEntries) {
      if (entries.length >= config.maxResults) break;

      const fullPath = join(dir, entry.name);
      const relativePath = toForwardSlash(relative(baseDir, fullPath));

      // Check if directory is blocked
      if (entry.isDirectory() && config.blockedDirectories.includes(entry.name)) {
        continue;
      }

      const isFile = entry.isFile();
      const isDir = entry.isDirectory();

      // Apply filter
      if (filter === 'files' && !isFile) {
        if (isDir && recursive) {
          await listDir(fullPath, baseDir, config, recursive, filter, maxDepth, currentDepth + 1, entries);
        }
        continue;
      }
      if (filter === 'directories' && !isDir) continue;

      try {
        const stats = await stat(fullPath);

        const dirEntry: DirectoryEntry = {
          name: entry.name,
          path: relativePath,
          type: isFile ? 'file' : 'directory',
        };

        if (isFile) {
          dirEntry.size = stats.size;
        }
        dirEntry.modified = stats.mtime.toISOString();

        entries.push(dirEntry);

        // Recurse into directories
        if (isDir && recursive) {
          await listDir(fullPath, baseDir, config, recursive, filter, maxDepth, currentDepth + 1, entries);
        }
      } catch {
        // Skip entries we can't stat
      }
    }
  } catch {
    // Skip directories we can't read
  }

  return entries;
}

/**
 * Create a List Directory tool with the given configuration
 */
export function createListDirectoryTool(config: FilesystemToolConfig = {}): ToolFunction<ListDirectoryArgs, ListDirectoryResult> {
  const mergedConfig = { ...DEFAULT_FILESYSTEM_CONFIG, ...config };

  return {
    definition: {
      type: 'function',
      function: {
        name: 'list_directory',
        description: `List the contents of a directory on the local filesystem.

USAGE:
- Shows files and directories in the specified path
- Includes file sizes and modification times
- Can list recursively with depth limit
- Can filter to show only files or only directories

WHEN TO USE:
- To explore a project's structure
- To see what files exist in a directory
- To find files before using read_file or edit_file
- As an alternative to glob when you want to see directory structure

EXAMPLES:
- List current directory: { "path": "." }
- List specific directory: { "path": "/path/to/project/src" }
- List recursively: { "path": ".", "recursive": true, "max_depth": 2 }
- List only files: { "path": ".", "filter": "files" }
- List only directories: { "path": ".", "filter": "directories" }`,
        parameters: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'Path to the directory to list',
            },
            recursive: {
              type: 'boolean',
              description: 'Whether to list recursively (default: false)',
            },
            filter: {
              type: 'string',
              enum: ['files', 'directories'],
              description: 'Filter to show only files or only directories',
            },
            max_depth: {
              type: 'number',
              description: 'Maximum depth for recursive listing (default: 3)',
            },
          },
          required: ['path'],
        },
      },
    },

    permission: { scope: 'always' as const, riskLevel: 'low' as const },

    describeCall: (args: ListDirectoryArgs): string => {
      const flags: string[] = [];
      if (args.recursive) flags.push('recursive');
      if (args.filter) flags.push(args.filter);
      if (flags.length > 0) {
        return `${args.path} (${flags.join(', ')})`;
      }
      return args.path;
    },

    execute: async (args: ListDirectoryArgs): Promise<ListDirectoryResult> => {
      const { path, recursive = false, filter, max_depth = 3 } = args;

      // Validate path
      const validation = validatePath(path, {
        ...mergedConfig,
        blockedDirectories: [], // Allow listing any valid directory
      });
      if (!validation.valid) {
        return {
          success: false,
          error: validation.error,
        };
      }

      const resolvedPath = validation.resolvedPath;

      // Check if directory exists
      if (!existsSync(resolvedPath)) {
        return {
          success: false,
          error: `Directory not found: ${path}`,
        };
      }

      try {
        const stats = await stat(resolvedPath);
        if (!stats.isDirectory()) {
          return {
            success: false,
            error: `Path is not a directory: ${path}. Use read_file to read file contents.`,
          };
        }

        // List directory contents
        const entries = await listDir(
          resolvedPath,
          resolvedPath,
          mergedConfig,
          recursive,
          filter,
          max_depth
        );

        // Sort: directories first, then alphabetically
        entries.sort((a, b) => {
          if (a.type !== b.type) {
            return a.type === 'directory' ? -1 : 1;
          }
          return a.name.localeCompare(b.name);
        });

        const truncated = entries.length >= mergedConfig.maxResults;

        return {
          success: true,
          entries,
          count: entries.length,
          truncated,
        };
      } catch (error) {
        return {
          success: false,
          error: `Failed to list directory: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  };
}

/**
 * Default List Directory tool instance
 */
export const listDirectory = createListDirectoryTool();
