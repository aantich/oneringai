/**
 * GitHub List Branches Tool
 *
 * List branches in a GitHub repository.
 * Supports filtering by name pattern and pagination.
 */

import type { Connector } from '../../core/Connector.js';
import type { ToolFunction, ToolContext } from '../../domain/entities/Tool.js';
import {
  type GitHubListBranchesResult,
  type GitHubBranchEntry,
  resolveRepository,
  githubFetch,
  formatGitHubToolError,
} from './types.js';

/**
 * Arguments for the list_branches tool
 */
export interface ListBranchesArgs {
  /** Repository in "owner/repo" format or full GitHub URL */
  repository?: string;
  /** Filter branches by name prefix or substring (case-insensitive, client-side) */
  filter?: string;
  /** Include only protected branches (default: false — list all) */
  protected_only?: boolean;
  /** Maximum number of branches to return (default: 100, max: 100) */
  limit?: number;
}

/** @internal */
interface GitHubBranchResponse {
  name: string;
  commit: { sha: string; url: string };
  protected: boolean;
}

/**
 * Create a GitHub list_branches tool
 */
export function createListBranchesTool(
  connector: Connector,
  userId?: string
): ToolFunction<ListBranchesArgs, GitHubListBranchesResult> {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'list_branches',
        description: `List branches in a GitHub repository.

USAGE:
- Lists all branches with their latest commit SHA and protection status
- Supports filtering by name pattern (case-insensitive substring match)
- Use this to discover branch names before searching/reading files on a specific branch

EXAMPLES:
- List all branches: {}
- Filter by name: { "filter": "feature" }
- Protected only: { "protected_only": true }
- Specific repo: { "repository": "owner/repo" }`,
        parameters: {
          type: 'object',
          properties: {
            repository: {
              type: 'string',
              description:
                'Repository in "owner/repo" format or full GitHub URL. Optional if connector has a default repository.',
            },
            filter: {
              type: 'string',
              description:
                'Filter branches by name (case-insensitive substring match). E.g., "feature", "release", "main".',
            },
            protected_only: {
              type: 'boolean',
              description: 'If true, only return protected branches. Default: false.',
            },
            limit: {
              type: 'number',
              description: 'Maximum number of branches to return (default: 100, max: 100).',
            },
          },
          required: [],
        },
      },
    },

    describeCall: (args: ListBranchesArgs): string => {
      const parts = ['branches'];
      if (args.filter) parts.push(`matching "${args.filter}"`);
      if (args.repository) parts.push(`in ${args.repository}`);
      return parts.join(' ');
    },

    permission: {
      scope: 'session',
      riskLevel: 'low',
      approvalMessage: `List branches in a GitHub repository via ${connector.displayName}`,
    },

    execute: async (
      args: ListBranchesArgs,
      context?: ToolContext
    ): Promise<GitHubListBranchesResult> => {
      const effectiveUserId = context?.userId ?? userId;
      const effectiveAccountId = context?.accountId;
      const resolved = resolveRepository(args.repository, connector);
      if (!resolved.success) {
        return { success: false, error: resolved.error };
      }
      const { owner, repo } = resolved.repo;

      try {
        const perPage = Math.min(args.limit ?? 100, 100);
        const queryParams: Record<string, string | number | boolean> = {
          per_page: perPage,
        };
        if (args.protected_only) {
          queryParams.protected = true;
        }

        const branches = await githubFetch<GitHubBranchResponse[]>(
          connector,
          `/repos/${owner}/${repo}/branches`,
          { userId: effectiveUserId, accountId: effectiveAccountId, queryParams }
        );

        let results: GitHubBranchEntry[] = branches.map((b) => ({
          name: b.name,
          sha: b.commit.sha,
          protected: b.protected,
        }));

        // Client-side filtering by name substring
        if (args.filter) {
          const filterLower = args.filter.toLowerCase();
          results = results.filter((b) => b.name.toLowerCase().includes(filterLower));
        }

        return {
          success: true,
          branches: results,
          count: results.length,
        };
      } catch (error) {
        return {
          success: false,
          error: formatGitHubToolError('Failed to list branches', error),
        };
      }
    },
  };
}
