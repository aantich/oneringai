/**
 * GitHub Read File Tool
 *
 * Read file content from a GitHub repository.
 * Mirrors the local `read_file` tool for remote GitHub repos.
 *
 * Supports line range selection (offset/limit) and formats output
 * with line numbers matching the local read_file tool.
 */

import type { Connector } from '../../core/Connector.js';
import type { ToolFunction, ToolContext } from '../../domain/entities/Tool.js';
import {
  type GitHubReadFileResult,
  type GitHubContentResponse,
  type GitHubBlobResponse,
  resolveRepository,
  githubFetch,
  formatGitHubToolError,
} from './types.js';

/**
 * Arguments for the GitHub read_file tool
 */
export interface GitHubReadFileArgs {
  /** Repository in "owner/repo" format or full GitHub URL */
  repository?: string;
  /** File path within the repository (e.g., "src/index.ts") */
  path: string;
  /** Branch, tag, or commit SHA. Defaults to the repository's default branch. */
  ref?: string;
  /** Line number to start reading from (1-indexed). Useful for large files. */
  offset?: number;
  /** Number of lines to read (default: 2000). */
  limit?: number;
}

/**
 * Create a GitHub read_file tool
 */
export function createGitHubReadFileTool(
  connector: Connector,
  userId?: string
): ToolFunction<GitHubReadFileArgs, GitHubReadFileResult> {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'read_file',
        description: `Read file content from a GitHub repository.

USAGE:
- Reads a file and returns content with line numbers
- Supports line range selection with offset/limit for large files
- By default reads up to 2000 lines from the beginning

EXAMPLES:
- Read entire file: { "path": "src/index.ts" }
- Read specific branch: { "path": "README.md", "ref": "develop" }
- Read lines 100-200: { "path": "src/app.ts", "offset": 100, "limit": 100 }
- Specific repo: { "repository": "owner/repo", "path": "package.json" }

NOTE: Files larger than 1MB are fetched via the Git Blob API. Very large files (>5MB) may be truncated.`,
        parameters: {
          type: 'object',
          properties: {
            repository: {
              type: 'string',
              description:
                'Repository in "owner/repo" format or full GitHub URL. Optional if connector has a default repository.',
            },
            path: {
              type: 'string',
              description: 'File path within the repository (e.g., "src/index.ts")',
            },
            ref: {
              type: 'string',
              description: "Branch, tag, or commit SHA. Defaults to the repository's default branch.",
            },
            offset: {
              type: 'number',
              description: 'Line number to start reading from (1-indexed). Only provide if the file is too large.',
            },
            limit: {
              type: 'number',
              description: 'Number of lines to read (default: 2000). Only provide if the file is too large.',
            },
          },
          required: ['path'],
        },
      },
    },

    describeCall: (args: GitHubReadFileArgs): string => {
      const parts = [args.path];
      if (args.repository) parts.push(`in ${args.repository}`);
      if (args.ref) parts.push(`@${args.ref}`);
      if (args.offset && args.limit) parts.push(`[lines ${args.offset}-${args.offset + args.limit}]`);
      return parts.join(' ');
    },

    permission: {
      scope: 'session',
      riskLevel: 'low',
      approvalMessage: `Read a file from a GitHub repository via ${connector.displayName}`,
    },

    execute: async (args: GitHubReadFileArgs, context?: ToolContext): Promise<GitHubReadFileResult> => {
      const effectiveUserId = context?.userId ?? userId;
      const effectiveAccountId = context?.accountId;
      const resolved = resolveRepository(args.repository, connector);
      if (!resolved.success) {
        return { success: false, error: resolved.error };
      }
      const { owner, repo } = resolved.repo;

      try {
        let fileContent: string;
        let fileSha: string;
        let fileSize: number;

        // Fetch file via Contents API
        const refParam = args.ref ? `?ref=${encodeURIComponent(args.ref)}` : '';
        const contentResp = await githubFetch<GitHubContentResponse>(
          connector,
          `/repos/${owner}/${repo}/contents/${args.path}${refParam}`,
          { userId: effectiveUserId, accountId: effectiveAccountId }
        );

        if (contentResp.type !== 'file') {
          return {
            success: false,
            error: `Path is not a file: ${args.path} (type: ${contentResp.type}). Use search_files to explore the repository.`,
            path: args.path,
          };
        }

        fileSha = contentResp.sha;
        fileSize = contentResp.size;

        if (contentResp.content && contentResp.encoding === 'base64') {
          // Standard case: file content is inline as base64
          fileContent = Buffer.from(contentResp.content, 'base64').toString('utf-8');
        } else if (contentResp.git_url) {
          // Large file (>1MB): fall back to Blob API
          const blob = await githubFetch<GitHubBlobResponse>(
            connector,
            contentResp.git_url,
            { userId: effectiveUserId, accountId: effectiveAccountId }
          );
          fileContent = Buffer.from(blob.content, 'base64').toString('utf-8');
          fileSize = blob.size;
        } else {
          return {
            success: false,
            error: `Cannot read file content: ${args.path} (no content or git_url in response)`,
            path: args.path,
          };
        }

        // Apply offset and limit (matching filesystem readFile behavior)
        const offset = args.offset ?? 1;
        const limit = args.limit ?? 2000;

        const allLines = fileContent.split('\n');
        const totalLines = allLines.length;

        const startIndex = Math.max(0, offset - 1);
        const endIndex = Math.min(totalLines, startIndex + limit);
        const selectedLines = allLines.slice(startIndex, endIndex);

        // Format with line numbers (matching filesystem readFile format)
        const lineNumberWidth = String(endIndex).length;
        const formattedLines = selectedLines.map((line, i) => {
          const lineNum = startIndex + i + 1;
          const paddedNum = String(lineNum).padStart(lineNumberWidth, ' ');
          const truncatedLine = line.length > 2000 ? line.substring(0, 2000) + '...' : line;
          return `${paddedNum}\t${truncatedLine}`;
        });

        const truncated = endIndex < totalLines;
        const result = formattedLines.join('\n');

        return {
          success: true,
          content: result,
          path: args.path,
          size: fileSize,
          lines: totalLines,
          truncated,
          sha: fileSha,
        };
      } catch (error) {
        return {
          success: false,
          error: formatGitHubToolError('Failed to read file', error),
          path: args.path,
        };
      }
    },
  };
}
