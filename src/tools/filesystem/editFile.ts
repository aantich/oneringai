/**
 * Edit File Tool
 *
 * Performs surgical edits to files using exact string replacement.
 * This is the preferred way to modify existing files.
 *
 * Features:
 * - Exact string matching for precise edits
 * - Preserves file formatting and indentation
 * - Supports replace_all for bulk changes
 * - Validates uniqueness of old_string
 * - Safe: only modifies what's specified
 */

import { readFile as fsReadFile, writeFile as fsWriteFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import type { ToolFunction } from '../../domain/entities/Tool.js';
import {
  type FilesystemToolConfig,
  type EditFileResult,
  DEFAULT_FILESYSTEM_CONFIG,
  validatePath,
} from './types.js';

/**
 * Arguments for the edit file tool
 */
export interface EditFileArgs {
  /** Absolute path to the file to edit */
  file_path: string;
  /** The exact text to find and replace */
  old_string: string;
  /** The text to replace it with (must be different from old_string) */
  new_string: string;
  /** Replace all occurrences (default: false, which requires old_string to be unique) */
  replace_all?: boolean;
}

/**
 * Create an Edit File tool with the given configuration
 */
export function createEditFileTool(config: FilesystemToolConfig = {}): ToolFunction<EditFileArgs, EditFileResult> {
  const mergedConfig = { ...DEFAULT_FILESYSTEM_CONFIG, ...config };

  return {
    definition: {
      type: 'function',
      function: {
        name: 'edit_file',
        description: `Perform exact string replacements in files.

USAGE:
- You MUST use read_file at least once before editing any file
- The old_string must match EXACTLY what's in the file, including all whitespace and indentation
- When editing text from read_file output, preserve the exact indentation as it appears AFTER the line number prefix
- The line number prefix format is: spaces + line number + tab. Everything after that tab is the actual file content
- NEVER include any part of the line number prefix in old_string or new_string

IMPORTANT RULES:
- ALWAYS prefer editing existing files over writing new ones
- The edit will FAIL if old_string is not found in the file
- The edit will FAIL if old_string appears more than once (unless replace_all is true)
- Use replace_all: true when you want to rename variables, update imports, etc.
- old_string and new_string must be different

MATCHING TIPS:
- Include enough surrounding context to make old_string unique
- Copy the exact whitespace from the file (spaces vs tabs matter!)
- For indented code, include the full indentation in old_string

EXAMPLES:
- Simple edit:
  { "file_path": "/path/to/file.ts", "old_string": "const x = 1;", "new_string": "const x = 2;" }

- Edit with context for uniqueness:
  { "file_path": "/path/to/file.ts",
    "old_string": "function foo() {\\n  return 1;\\n}",
    "new_string": "function foo() {\\n  return 2;\\n}" }

- Replace all occurrences:
  { "file_path": "/path/to/file.ts", "old_string": "oldName", "new_string": "newName", "replace_all": true }`,
        parameters: {
          type: 'object',
          properties: {
            file_path: {
              type: 'string',
              description: 'The absolute path to the file to modify',
            },
            old_string: {
              type: 'string',
              description: 'The exact text to find and replace',
            },
            new_string: {
              type: 'string',
              description: 'The text to replace it with (must be different from old_string)',
            },
            replace_all: {
              type: 'boolean',
              description: 'Replace all occurrences instead of requiring uniqueness (default: false)',
            },
          },
          required: ['file_path', 'old_string', 'new_string'],
        },
      },
    },

    permission: { scope: 'session' as const, riskLevel: 'medium' as const, sensitiveArgs: ['path'] },

    describeCall: (args: EditFileArgs): string => {
      const mode = args.replace_all ? ' (replace all)' : '';
      return `${args.file_path}${mode}`;
    },

    execute: async (args: EditFileArgs): Promise<EditFileResult> => {
      const { file_path, old_string, new_string, replace_all = false } = args;

      // Validate that old_string and new_string are different
      if (old_string === new_string) {
        return {
          success: false,
          error: 'old_string and new_string must be different',
          path: file_path,
        };
      }

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

      // Check if file exists
      if (!existsSync(resolvedPath)) {
        return {
          success: false,
          error: `File not found: ${file_path}`,
          path: file_path,
        };
      }

      try {
        // Read current content
        const content = await fsReadFile(resolvedPath, 'utf-8');

        // Count occurrences
        let occurrences = 0;
        let searchIndex = 0;
        while (true) {
          const foundIndex = content.indexOf(old_string, searchIndex);
          if (foundIndex === -1) break;
          occurrences++;
          searchIndex = foundIndex + 1;
        }

        // Validate occurrences
        if (occurrences === 0) {
          // Try to provide helpful feedback
          const trimmedOld = old_string.trim();
          const hasTrimmedMatch = content.includes(trimmedOld);

          let errorMsg = `old_string not found in file. `;
          if (hasTrimmedMatch && trimmedOld !== old_string) {
            errorMsg += `A similar string was found but with different whitespace. Check your indentation matches exactly.`;
          } else {
            errorMsg += `Make sure you're copying the exact text from the file, including all whitespace.`;
          }

          return {
            success: false,
            error: errorMsg,
            path: file_path,
            replacements: 0,
          };
        }

        if (occurrences > 1 && !replace_all) {
          return {
            success: false,
            error: `old_string appears ${occurrences} times in the file. Either provide more context to make it unique, or set replace_all: true to replace all occurrences.`,
            path: file_path,
            replacements: 0,
          };
        }

        // Perform replacement
        let newContent: string;
        if (replace_all) {
          newContent = content.split(old_string).join(new_string);
        } else {
          newContent = content.replace(old_string, new_string);
        }

        // Write the modified content
        await fsWriteFile(resolvedPath, newContent, 'utf-8');

        // Generate simple diff preview
        const diffPreview = generateDiffPreview(old_string, new_string);

        return {
          success: true,
          path: file_path,
          replacements: replace_all ? occurrences : 1,
          diff: diffPreview,
        };
      } catch (error) {
        return {
          success: false,
          error: `Failed to edit file: ${error instanceof Error ? error.message : String(error)}`,
          path: file_path,
        };
      }
    },
  };
}

/**
 * Generate a simple diff preview
 */
function generateDiffPreview(oldStr: string, newStr: string): string {
  const oldLines = oldStr.split('\n');
  const newLines = newStr.split('\n');

  const diff: string[] = [];
  const maxLines = Math.max(oldLines.length, newLines.length);

  // Show first few lines of old and new
  const previewLines = Math.min(maxLines, 5);

  diff.push('--- old');
  for (let i = 0; i < Math.min(oldLines.length, previewLines); i++) {
    diff.push(`- ${oldLines[i]}`);
  }
  if (oldLines.length > previewLines) {
    diff.push(`  ... (${oldLines.length - previewLines} more lines)`);
  }

  diff.push('+++ new');
  for (let i = 0; i < Math.min(newLines.length, previewLines); i++) {
    diff.push(`+ ${newLines[i]}`);
  }
  if (newLines.length > previewLines) {
    diff.push(`  ... (${newLines.length - previewLines} more lines)`);
  }

  return diff.join('\n');
}

/**
 * Default Edit File tool instance
 */
export const editFile = createEditFileTool();
