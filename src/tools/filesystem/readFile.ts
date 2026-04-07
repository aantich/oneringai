/**
 * Read File Tool
 *
 * Reads content from files on the local filesystem.
 * Supports text files with optional line range selection.
 *
 * Features:
 * - Read entire files or specific line ranges
 * - Automatic encoding detection
 * - Line number prefixing for easy reference
 * - Size limits to prevent memory issues
 * - Path validation for security
 */

import { readFile as fsReadFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname } from 'node:path';
import type { ToolFunction } from '../../domain/entities/Tool.js';
import {
  type FilesystemToolConfig,
  type ReadFileResult,
  DEFAULT_FILESYSTEM_CONFIG,
  validatePath,
} from './types.js';
import { FormatDetector } from '../../capabilities/documents/FormatDetector.js';
import { DocumentReader, mergeTextPieces } from '../../capabilities/documents/DocumentReader.js';

/**
 * Arguments for the read file tool
 */
export interface ReadFileArgs {
  /** Absolute path to the file to read */
  file_path: string;
  /** Line number to start reading from (1-indexed). Only provide if the file is too large. */
  offset?: number;
  /** Number of lines to read. Only provide if the file is too large. */
  limit?: number;
}

/**
 * Create a Read File tool with the given configuration
 */
export function createReadFileTool(config: FilesystemToolConfig = {}): ToolFunction<ReadFileArgs, ReadFileResult> {
  const mergedConfig = { ...DEFAULT_FILESYSTEM_CONFIG, ...config };

  return {
    definition: {
      type: 'function',
      function: {
        name: 'read_file',
        description: `Read content from a file on the local filesystem. Supports text files AND binary document formats — PDF, DOCX, PPTX, XLSX, ODS, ODT, ODP, and images (PNG, JPG, GIF, WEBP) are automatically converted to markdown text.

USAGE:
- The file_path parameter must be an absolute path, not a relative path
- By default, reads up to 2000 lines starting from the beginning of the file
- You can optionally specify a line offset and limit (especially handy for long files)
- Any lines longer than 2000 characters will be truncated
- Results are returned with line numbers starting at 1

DOCUMENT SUPPORT:
- PDF files: extracted as markdown text with per-page sections
- Word documents (.docx): converted to markdown preserving headings, lists, tables
- PowerPoint (.pptx): extracted slide-by-slide as markdown
- Excel (.xlsx) / CSV / ODS: converted to markdown key-value records (each row becomes a list of "**Header**: value" pairs). To get a markdown table instead, configure documentReaderConfig with tableFormat: 'markdown'. Other formats: 'csv', 'json'.
- OpenDocument (.odt, .odp, .ods): converted like their MS Office equivalents
- Images (.png, .jpg, .gif, .webp): described as image metadata
- Binary documents are auto-detected by extension — just pass the file path

WHEN TO USE:
- To read source code files before making edits
- To understand file contents and structure
- To read configuration files
- To examine log files or data files
- To read PDF, Word, Excel, PowerPoint, or other document files as text

IMPORTANT:
- Always read a file before attempting to edit it
- Use offset/limit for very large files to read in chunks
- The tool will return an error if the file doesn't exist
- offset/limit are ignored for binary document formats (full document is always returned)

EXAMPLES:
- Read entire file: { "file_path": "/path/to/file.ts" }
- Read lines 100-200: { "file_path": "/path/to/file.ts", "offset": 100, "limit": 100 }
- Read a PDF: { "file_path": "/path/to/report.pdf" }
- Read an Excel file: { "file_path": "/path/to/data.xlsx" }
- Read a Word doc: { "file_path": "/path/to/document.docx" }`,
        parameters: {
          type: 'object',
          properties: {
            file_path: {
              type: 'string',
              description: 'The absolute path to the file to read',
            },
            offset: {
              type: 'number',
              description: 'Line number to start reading from (1-indexed). Only provide if the file is too large to read at once.',
            },
            limit: {
              type: 'number',
              description: 'Number of lines to read. Only provide if the file is too large to read at once.',
            },
          },
          required: ['file_path'],
        },
      },
    },

    permission: { scope: 'always' as const, riskLevel: 'low' as const },

    describeCall: (args: ReadFileArgs): string => {
      if (args.offset && args.limit) {
        return `${args.file_path} [lines ${args.offset}-${args.offset + args.limit}]`;
      }
      return args.file_path;
    },

    execute: async (args: ReadFileArgs): Promise<ReadFileResult> => {
      const { file_path, offset = 1, limit = 2000 } = args;

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
        // Check file size
        const stats = await stat(resolvedPath);
        if (!stats.isFile()) {
          return {
            success: false,
            error: `Path is not a file: ${file_path}. Use list_directory to explore directories.`,
            path: file_path,
          };
        }

        if (stats.size > mergedConfig.maxFileSize) {
          return {
            success: false,
            error: `File is too large (${(stats.size / 1024 / 1024).toFixed(2)}MB). Maximum size is ${(mergedConfig.maxFileSize / 1024 / 1024).toFixed(2)}MB. Use offset and limit to read in chunks.`,
            path: file_path,
            size: stats.size,
          };
        }

        // Check if this is a binary document format that needs DocumentReader
        const ext = extname(resolvedPath).toLowerCase();
        if (FormatDetector.isBinaryDocumentFormat(ext)) {
          try {
            const reader = DocumentReader.create(mergedConfig.documentReaderConfig);
            const result = await reader.read(
              { type: 'file', path: resolvedPath },
              {
                extractImages: false,
                ...mergedConfig.documentReaderConfig?.defaults,
                formatOptions: {
                  ...mergedConfig.documentReaderConfig?.defaults?.formatOptions,
                  excel: {
                    tableFormat: 'markdown-kv',
                    ...mergedConfig.documentReaderConfig?.defaults?.formatOptions?.excel,
                  },
                },
              }
            );

            if (result.success) {
              const content = mergeTextPieces(result.pieces);
              return {
                success: true,
                content,
                lines: content.split('\n').length,
                truncated: false,
                encoding: 'document',
                size: stats.size,
                path: file_path,
              };
            }
            // Fall through to UTF-8 attempt if document reader fails
          } catch {
            // Fall through to UTF-8 attempt
          }
        }

        // Read file content
        const content = await fsReadFile(resolvedPath, 'utf-8');
        const allLines = content.split('\n');
        const totalLines = allLines.length;

        // Apply offset and limit (offset is 1-indexed)
        const startIndex = Math.max(0, offset - 1);
        const endIndex = Math.min(totalLines, startIndex + limit);
        const selectedLines = allLines.slice(startIndex, endIndex);

        // Format with line numbers
        const lineNumberWidth = String(endIndex).length;
        const formattedLines = selectedLines.map((line, i) => {
          const lineNum = startIndex + i + 1;
          const paddedNum = String(lineNum).padStart(lineNumberWidth, ' ');
          // Truncate very long lines
          const truncatedLine = line.length > 2000 ? line.substring(0, 2000) + '...' : line;
          return `${paddedNum}\t${truncatedLine}`;
        });

        const truncated = endIndex < totalLines;
        const result = formattedLines.join('\n');

        return {
          success: true,
          content: result,
          lines: totalLines,
          truncated,
          encoding: 'utf-8',
          size: stats.size,
          path: file_path,
        };
      } catch (error) {
        // Handle binary files or encoding issues
        if (error instanceof Error && error.message.includes('encoding')) {
          return {
            success: false,
            error: `File appears to be binary or uses an unsupported encoding: ${file_path}`,
            path: file_path,
          };
        }

        return {
          success: false,
          error: `Failed to read file: ${error instanceof Error ? error.message : String(error)}`,
          path: file_path,
        };
      }
    },
  };
}

/**
 * Default Read File tool instance
 */
export const readFile = createReadFileTool();
