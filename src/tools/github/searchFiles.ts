/**
 * GitHub Search Files Tool
 *
 * Search for files by glob pattern in a GitHub repository.
 * Mirrors the local `glob` tool for remote GitHub repos.
 *
 * Uses the Git Trees API to fetch the full file tree, then filters client-side.
 */

import type { Connector } from '../../core/Connector.js';
import type { ToolFunction, ToolContext } from '../../domain/entities/Tool.js';
import {
  type GitHubSearchFilesResult,
  type GitHubTreeResponse,
  type GitHubRepoResponse,
  resolveRepository,
  githubFetch,
  formatGitHubToolError,
} from './types.js';

/**
 * Arguments for the search_files tool
 */
export interface SearchFilesArgs {
  /** Repository in "owner/repo" format or full GitHub URL */
  repository?: string;
  /** Glob pattern to match files (e.g., "**\/*.ts", "src/**\/*.tsx") */
  pattern: string;
  /** Branch, tag, or SHA (defaults to repo's default branch) */
  ref?: string;
}

/**
 * Simple glob pattern matcher (matches the filesystem glob tool approach)
 */
function matchGlobPattern(pattern: string, filePath: string): boolean {
  let regexPattern = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '{{GLOBSTAR}}')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '.')
    .replace(/\{\{GLOBSTAR\}\}/g, '.*');

  regexPattern = '^' + regexPattern + '$';

  try {
    const regex = new RegExp(regexPattern);
    return regex.test(filePath);
  } catch {
    return false;
  }
}

/**
 * Create a GitHub search_files tool
 */
export function createSearchFilesTool(
  connector: Connector,
  userId?: string
): ToolFunction<SearchFilesArgs, GitHubSearchFilesResult> {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'search_files',
        description: `Search for files by name/path pattern in a GitHub repository.

USAGE:
- Supports glob patterns like "**/*.ts", "src/**/*.tsx"
- Returns matching file paths sorted alphabetically
- Uses the repository's file tree for fast matching

PATTERN SYNTAX:
- * matches any characters except /
- ** matches any characters including /
- ? matches a single character

EXAMPLES:
- Find all TypeScript files: { "pattern": "**/*.ts" }
- Find files in src: { "pattern": "src/**/*.{ts,tsx}" }
- Find package.json: { "pattern": "**/package.json" }
- Search specific branch: { "pattern": "**/*.ts", "ref": "develop" }`,
        parameters: {
          type: 'object',
          properties: {
            repository: {
              type: 'string',
              description:
                'Repository in "owner/repo" format or full GitHub URL. Optional if connector has a default repository.',
            },
            pattern: {
              type: 'string',
              description: 'Glob pattern to match files (e.g., "**/*.ts", "src/**/*.tsx")',
            },
            ref: {
              type: 'string',
              description: 'Branch, tag, or commit SHA. Defaults to the repository\'s default branch.',
            },
          },
          required: ['pattern'],
        },
      },
    },

    describeCall: (args: SearchFilesArgs): string => {
      const parts = [args.pattern];
      if (args.repository) parts.push(`in ${args.repository}`);
      if (args.ref) parts.push(`@${args.ref}`);
      return parts.join(' ');
    },

    permission: {
      scope: 'session',
      riskLevel: 'low',
      approvalMessage: `Search files in a GitHub repository via ${connector.displayName}`,
    },

    execute: async (args: SearchFilesArgs, context?: ToolContext): Promise<GitHubSearchFilesResult> => {
      const effectiveUserId = context?.userId ?? userId;
      const effectiveAccountId = context?.accountId;
      const resolved = resolveRepository(args.repository, connector);
      if (!resolved.success) {
        return { success: false, error: resolved.error };
      }
      const { owner, repo } = resolved.repo;

      try {
        // Resolve ref (default branch if not specified)
        let ref = args.ref;
        if (!ref) {
          const repoInfo = await githubFetch<GitHubRepoResponse>(
            connector,
            `/repos/${owner}/${repo}`,
            { userId: effectiveUserId, accountId: effectiveAccountId }
          );
          ref = repoInfo.default_branch;
        }

        // Fetch full tree
        const tree = await githubFetch<GitHubTreeResponse>(
          connector,
          `/repos/${owner}/${repo}/git/trees/${ref}?recursive=1`,
          { userId: effectiveUserId }
        );

        // Filter by glob pattern (only blobs, not trees)
        const matching = tree.tree
          .filter(
            (entry) => entry.type === 'blob' && matchGlobPattern(args.pattern, entry.path)
          )
          .map((entry) => ({
            path: entry.path,
            size: entry.size ?? 0,
            type: entry.type,
          }))
          .sort((a, b) => a.path.localeCompare(b.path));

        return {
          success: true,
          files: matching,
          count: matching.length,
          truncated: tree.truncated,
        };
      } catch (error) {
        return {
          success: false,
          error: formatGitHubToolError('Failed to search files', error),
        };
      }
    },
  };
}
