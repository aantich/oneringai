/**
 * GitHub PR Files Tool
 *
 * Get the files changed in a pull request, including diffs.
 */

import type { Connector } from '../../core/Connector.js';
import type { ToolFunction, ToolContext } from '../../domain/entities/Tool.js';
import {
  type GitHubPRFilesResult,
  type GitHubPRFileEntry,
  resolveRepository,
  githubFetch,
  formatGitHubToolError,
} from './types.js';

/**
 * Arguments for the pr_files tool
 */
export interface PRFilesArgs {
  /** Repository in "owner/repo" format or full GitHub URL */
  repository?: string;
  /** Pull request number */
  pull_number: number;
}

/**
 * Create a GitHub pr_files tool
 */
export function createPRFilesTool(
  connector: Connector,
  userId?: string
): ToolFunction<PRFilesArgs, GitHubPRFilesResult> {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'pr_files',
        description: `Get the files changed in a pull request with diffs.

Returns: filename, status (added/modified/removed/renamed), additions, deletions, and patch (diff) content for each file.

EXAMPLES:
- Get files: { "pull_number": 123 }
- Specific repo: { "repository": "owner/repo", "pull_number": 456 }

NOTE: Very large diffs may be truncated by GitHub. Patch content may be absent for binary files.`,
        parameters: {
          type: 'object',
          properties: {
            repository: {
              type: 'string',
              description:
                'Repository in "owner/repo" format or full GitHub URL. Optional if connector has a default repository.',
            },
            pull_number: {
              type: 'number',
              description: 'Pull request number',
            },
          },
          required: ['pull_number'],
        },
      },
    },

    describeCall: (args: PRFilesArgs): string => {
      const parts = [`files for #${args.pull_number}`];
      if (args.repository) parts.push(`in ${args.repository}`);
      return parts.join(' ');
    },

    permission: {
      scope: 'session',
      riskLevel: 'low',
      approvalMessage: `Get PR changed files from GitHub via ${connector.displayName}`,
    },

    execute: async (args: PRFilesArgs, context?: ToolContext): Promise<GitHubPRFilesResult> => {
      const effectiveUserId = context?.userId ?? userId;
      const effectiveAccountId = context?.accountId;
      const resolved = resolveRepository(args.repository, connector);
      if (!resolved.success) {
        return { success: false, error: resolved.error };
      }
      const { owner, repo } = resolved.repo;

      try {
        const files = await githubFetch<GitHubPRFileEntry[]>(
          connector,
          `/repos/${owner}/${repo}/pulls/${args.pull_number}/files`,
          {
            userId: effectiveUserId,
            accountId: effectiveAccountId,
            queryParams: { per_page: 100 },
          }
        );

        return {
          success: true,
          files: files.map((f) => ({
            filename: f.filename,
            status: f.status,
            additions: f.additions,
            deletions: f.deletions,
            changes: f.changes,
            patch: f.patch,
          })),
          count: files.length,
        };
      } catch (error) {
        return {
          success: false,
          error: formatGitHubToolError('Failed to get PR files', error),
        };
      }
    },
  };
}
