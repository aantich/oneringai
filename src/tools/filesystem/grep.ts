/**
 * Grep Tool
 *
 * Powerful search tool for finding content within files.
 * Supports regex patterns, file filtering, and context lines.
 *
 * Features:
 * - Full regex syntax support
 * - File type filtering
 * - Context lines (before/after match)
 * - Multiple output modes
 * - Case-insensitive search option
 */

import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { relative, extname } from 'node:path';
import type { ToolFunction } from '../../domain/entities/Tool.js';
import {
  type FilesystemToolConfig,
  type FilesystemToolConfigDefaults,
  type GrepResult,
  type GrepMatch,
  DEFAULT_FILESYSTEM_CONFIG,
  validatePath,
  isExcludedExtension,
  toForwardSlash,
  walkDirectory,
} from './types.js';

/**
 * Arguments for the grep tool
 */
export interface GrepArgs {
  /** The regex pattern to search for in file contents */
  pattern: string;
  /** File or directory to search in. Defaults to current working directory. */
  path?: string;
  /** Glob pattern to filter files (e.g., "*.ts", "*.{ts,tsx}") */
  glob?: string;
  /** File type to search (e.g., "ts", "js", "py"). More efficient than glob for standard types. */
  type?: string;
  /** Output mode: "content" shows lines, "files_with_matches" shows only file paths, "count" shows match counts */
  output_mode?: 'content' | 'files_with_matches' | 'count';
  /** Case insensitive search */
  case_insensitive?: boolean;
  /** Number of context lines before match */
  context_before?: number;
  /** Number of context lines after match */
  context_after?: number;
  /** Limit output to first N results */
  limit?: number;
}

/**
 * Map of common file types to extensions
 */
const FILE_TYPE_MAP: Record<string, string[]> = {
  ts: ['.ts', '.tsx'],
  js: ['.js', '.jsx', '.mjs', '.cjs'],
  py: ['.py', '.pyi'],
  java: ['.java'],
  go: ['.go'],
  rust: ['.rs'],
  c: ['.c', '.h'],
  cpp: ['.cpp', '.hpp', '.cc', '.hh', '.cxx', '.hxx'],
  cs: ['.cs'],
  rb: ['.rb'],
  php: ['.php'],
  swift: ['.swift'],
  kotlin: ['.kt', '.kts'],
  scala: ['.scala'],
  html: ['.html', '.htm'],
  css: ['.css', '.scss', '.sass', '.less'],
  json: ['.json'],
  yaml: ['.yaml', '.yml'],
  xml: ['.xml'],
  md: ['.md', '.markdown'],
  sql: ['.sql'],
  sh: ['.sh', '.bash', '.zsh'],
};

/**
 * Find files to search using shared walkDirectory
 */
async function findFilesToSearch(
  dir: string,
  config: FilesystemToolConfigDefaults,
  globPattern?: string,
  fileType?: string,
): Promise<string[]> {
  const files: string[] = [];
  const maxFiles = config.maxResults * 10;

  // Pre-compile glob regex if provided
  let globRegex: RegExp | undefined;
  if (globPattern) {
    const pattern = globPattern
      .replace(/\./g, '\\.')
      .replace(/\*/g, '.*')
      .replace(/\{([^}]+)\}/g, (_, p: string) => `(${p.split(',').join('|')})`);
    globRegex = new RegExp(pattern + '$');
  }

  for await (const entry of walkDirectory(dir, config)) {
    if (files.length >= maxFiles) break;
    if (!entry.isFile) continue;

    // Skip binary/excluded files
    if (isExcludedExtension(entry.name, config.excludeExtensions)) continue;

    // Check file type filter
    if (fileType) {
      const extensions = FILE_TYPE_MAP[fileType.toLowerCase()];
      if (extensions) {
        const ext = extname(entry.name).toLowerCase();
        if (!extensions.includes(ext)) continue;
      }
    }

    // Check glob pattern
    if (globRegex && !globRegex.test(entry.name)) continue;

    files.push(entry.fullPath);
  }

  return files;
}

/**
 * Search a single file for matches
 */
async function searchFile(
  filePath: string,
  regex: RegExp,
  contextBefore: number,
  contextAfter: number
): Promise<GrepMatch[]> {
  const matches: GrepMatch[] = [];

  try {
    const content = await readFile(filePath, 'utf-8');
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';
      regex.lastIndex = 0; // Reset regex state

      if (regex.test(line)) {
        const match: GrepMatch = {
          file: filePath,
          line: i + 1,
          content: line.length > 500 ? line.substring(0, 500) + '...' : line,
        };

        // Add context if requested
        if (contextBefore > 0 || contextAfter > 0) {
          match.context = {
            before: lines.slice(Math.max(0, i - contextBefore), i).map(l => l.length > 200 ? l.substring(0, 200) + '...' : l),
            after: lines.slice(i + 1, Math.min(lines.length, i + 1 + contextAfter)).map(l => l.length > 200 ? l.substring(0, 200) + '...' : l),
          };
        }

        matches.push(match);
      }
    }
  } catch {
    // Skip files we can't read (binary, permission issues, etc.)
  }

  return matches;
}

/**
 * Create a Grep tool with the given configuration
 */
export function createGrepTool(config: FilesystemToolConfig = {}): ToolFunction<GrepArgs, GrepResult> {
  const mergedConfig = { ...DEFAULT_FILESYSTEM_CONFIG, ...config };

  return {
    definition: {
      type: 'function',
      function: {
        name: 'grep',
        description: `A powerful search tool for finding content within files.

USAGE:
- Search for patterns using full regex syntax (e.g., "log.*Error", "function\\s+\\w+")
- Filter files with glob parameter (e.g., "*.js", "**/*.tsx") or type parameter (e.g., "js", "py")
- Output modes: "content" shows matching lines, "files_with_matches" shows only file paths, "count" shows match counts

PATTERN SYNTAX:
- Uses JavaScript regex syntax (not grep)
- Literal braces need escaping (use \\{ and \\} to find { and })
- Common patterns:
  - "TODO" - literal text
  - "function\\s+\\w+" - function declarations
  - "import.*from" - import statements
  - "\\bclass\\b" - word boundary matching

OUTPUT MODES:
- "content" - Shows matching lines with line numbers (default)
- "files_with_matches" - Shows only file paths that contain matches
- "count" - Shows match counts per file

EXAMPLES:
- Find TODO comments: { "pattern": "TODO|FIXME", "type": "ts" }
- Find function calls: { "pattern": "fetchUser\\(", "glob": "*.ts" }
- Find imports: { "pattern": "import.*react", "case_insensitive": true }
- List files with errors: { "pattern": "error", "output_mode": "files_with_matches" }
- Count matches: { "pattern": "console\\.log", "output_mode": "count" }

WHEN TO USE:
- To find where something is defined or used
- To search for patterns across multiple files
- To find all occurrences of a term
- Before making bulk changes`,
        parameters: {
          type: 'object',
          properties: {
            pattern: {
              type: 'string',
              description: 'The regex pattern to search for in file contents',
            },
            path: {
              type: 'string',
              description: 'File or directory to search in. Defaults to current working directory.',
            },
            glob: {
              type: 'string',
              description: 'Glob pattern to filter files (e.g., "*.js", "*.{ts,tsx}")',
            },
            type: {
              type: 'string',
              description: 'File type to search (e.g., "ts", "js", "py", "java", "go"). More efficient than glob.',
            },
            output_mode: {
              type: 'string',
              enum: ['content', 'files_with_matches', 'count'],
              description: 'Output mode: "content" shows lines, "files_with_matches" shows paths, "count" shows counts. Default: "files_with_matches"',
            },
            case_insensitive: {
              type: 'boolean',
              description: 'Case insensitive search (default: false)',
            },
            context_before: {
              type: 'number',
              description: 'Number of lines to show before each match (requires output_mode: "content")',
            },
            context_after: {
              type: 'number',
              description: 'Number of lines to show after each match (requires output_mode: "content")',
            },
            limit: {
              type: 'number',
              description: 'Limit output to first N results. Default: unlimited.',
            },
          },
          required: ['pattern'],
        },
      },
    },

    describeCall: (args: GrepArgs): string => {
      const parts = [`"${args.pattern}"`];
      if (args.glob) parts.push(`in ${args.glob}`);
      else if (args.type) parts.push(`in *.${args.type}`);
      if (args.path) parts.push(`(${args.path})`);
      return parts.join(' ');
    },

    execute: async (args: GrepArgs): Promise<GrepResult> => {
      const {
        pattern,
        path,
        glob: globPattern,
        type: fileType,
        output_mode = 'files_with_matches',
        case_insensitive = false,
        context_before = 0,
        context_after = 0,
        limit,
      } = args;

      // Determine search directory/file
      const searchPath = path || mergedConfig.workingDirectory;

      // Validate path
      const validation = validatePath(searchPath, {
        ...mergedConfig,
        blockedDirectories: [], // Allow grep from any valid directory
      });
      if (!validation.valid) {
        return {
          success: false,
          error: validation.error,
        };
      }

      const resolvedPath = validation.resolvedPath;

      // Check if path exists
      if (!existsSync(resolvedPath)) {
        return {
          success: false,
          error: `Path not found: ${searchPath}`,
        };
      }

      // Create regex
      let regex: RegExp;
      try {
        regex = new RegExp(pattern, case_insensitive ? 'gi' : 'g');
      } catch (error) {
        return {
          success: false,
          error: `Invalid regex pattern: ${error instanceof Error ? error.message : String(error)}`,
        };
      }

      try {
        // Find files to search
        const stats = await stat(resolvedPath);
        let filesToSearch: string[];

        if (stats.isFile()) {
          filesToSearch = [resolvedPath];
        } else {
          filesToSearch = await findFilesToSearch(
            resolvedPath,
            mergedConfig,
            globPattern,
            fileType
          );
        }

        // Search files
        const allMatches: GrepMatch[] = [];
        const fileMatchCounts: Map<string, number> = new Map();
        let filesMatched = 0;

        for (const file of filesToSearch) {
          if (limit && allMatches.length >= limit) break;

          const matches = await searchFile(
            file,
            regex,
            output_mode === 'content' ? context_before : 0,
            output_mode === 'content' ? context_after : 0
          );

          if (matches.length > 0) {
            filesMatched++;
            const relativePath = toForwardSlash(relative(resolvedPath, file)) || file;

            // Update match data with relative paths
            for (const match of matches) {
              match.file = relativePath;
            }

            fileMatchCounts.set(relativePath, matches.length);

            if (output_mode === 'content') {
              const remaining = limit ? limit - allMatches.length : Infinity;
              allMatches.push(...matches.slice(0, remaining));
            } else {
              // For files_with_matches and count, we just need to track files
              const firstMatch = matches[0];
              if (firstMatch) {
                allMatches.push(firstMatch);
              }
            }
          }
        }

        // Format output based on mode
        let resultMatches: GrepMatch[];

        switch (output_mode) {
          case 'files_with_matches':
            // Deduplicate to just file paths
            const uniqueFiles = new Set(allMatches.map(m => m.file));
            resultMatches = Array.from(uniqueFiles).map(file => ({
              file,
              line: 0,
              content: '',
            }));
            break;

          case 'count':
            resultMatches = Array.from(fileMatchCounts.entries()).map(([file, count]) => ({
              file,
              line: count,
              content: `${count} matches`,
            }));
            break;

          case 'content':
          default:
            resultMatches = allMatches;
        }

        const totalMatches = Array.from(fileMatchCounts.values()).reduce((a, b) => a + b, 0);
        const truncated = limit ? allMatches.length >= limit : totalMatches >= mergedConfig.maxResults;

        return {
          success: true,
          matches: resultMatches,
          filesSearched: filesToSearch.length,
          filesMatched,
          totalMatches,
          truncated,
        };
      } catch (error) {
        return {
          success: false,
          error: `Grep search failed: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  };
}

/**
 * Default Grep tool instance
 */
export const grep = createGrepTool();
