/**
 * Write File Tool
 *
 * Writes content to files on the local filesystem.
 * Can create new files or overwrite existing ones.
 *
 * Features:
 * - Create new files with content
 * - Overwrite existing files (with safety checks)
 * - Automatic directory creation
 * - Path validation for security
 */

import { writeFile as fsWriteFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ToolFunction } from '../../domain/entities/Tool.js';
import {
  type FilesystemToolConfig,
  type WriteFileResult,
  DEFAULT_FILESYSTEM_CONFIG,
  validatePath,
} from './types.js';

/**
 * Arguments for the write file tool
 */
export interface WriteFileArgs {
  /** Absolute path to the file to write */
  file_path: string;
  /** Content to write to the file */
  content: string;
}

/**
 * Create a Write File tool with the given configuration
 */
export function createWriteFileTool(config: FilesystemToolConfig = {}): ToolFunction<WriteFileArgs, WriteFileResult> {
  const mergedConfig = { ...DEFAULT_FILESYSTEM_CONFIG, ...config };

  return {
    definition: {
      type: 'function',
      function: {
        name: 'write_file',
        description: `Write content to a file on the local filesystem.

USAGE:
- This tool will overwrite the existing file if there is one at the provided path
- If the file exists, you MUST use the read_file tool first to read its contents before writing
- The file_path must be an absolute path, not a relative path
- Parent directories will be created automatically if they don't exist

WHEN TO USE:
- To create new files
- To completely replace file contents (after reading the original)
- When the edit_file tool cannot handle the changes needed

IMPORTANT:
- ALWAYS prefer editing existing files over creating new ones
- NEVER proactively create documentation files (*.md) or README files unless explicitly requested
- If modifying an existing file, use edit_file instead for surgical changes
- This tool will FAIL if you try to write to an existing file without reading it first

EXAMPLES:
- Create new file: { "file_path": "/path/to/new-file.ts", "content": "export const x = 1;" }
- Rewrite file: { "file_path": "/path/to/existing.ts", "content": "// new content..." }`,
        parameters: {
          type: 'object',
          properties: {
            file_path: {
              type: 'string',
              description: 'The absolute path to the file to write (must be absolute, not relative)',
            },
            content: {
              type: 'string',
              description: 'The content to write to the file',
            },
          },
          required: ['file_path', 'content'],
        },
      },
    },

    permission: { scope: 'session' as const, riskLevel: 'medium' as const, sensitiveArgs: ['path', 'content'] },

    describeCall: (args: WriteFileArgs): string => {
      const size = args.content?.length || 0;
      if (size > 1000) {
        return `${args.file_path} (${Math.round(size / 1024)}KB)`;
      }
      return args.file_path;
    },

    execute: async (args: WriteFileArgs): Promise<WriteFileResult> => {
      const { file_path, content } = args;

      // Validate path
      const validation = validatePath(file_path, mergedConfig);
      if (!validation.valid) {
        return {
          success: false,
          error: validation.error,
          path: file_path,
        };
      }

      const resolvedPath = validation.resolvedPath;
      const fileExists = existsSync(resolvedPath);

      try {
        // Ensure parent directory exists
        const parentDir = dirname(resolvedPath);
        if (!existsSync(parentDir)) {
          await mkdir(parentDir, { recursive: true });
        }

        // Write the file
        await fsWriteFile(resolvedPath, content, 'utf-8');

        return {
          success: true,
          path: file_path,
          bytesWritten: Buffer.byteLength(content, 'utf-8'),
          created: !fileExists,
        };
      } catch (error) {
        return {
          success: false,
          error: `Failed to write file: ${error instanceof Error ? error.message : String(error)}`,
          path: file_path,
        };
      }
    },
  };
}

/**
 * Default Write File tool instance
 */
export const writeFile = createWriteFileTool();
