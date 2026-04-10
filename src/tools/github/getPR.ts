/**
 * GitHub Get PR Tool
 *
 * Get full details of a pull request from a GitHub repository.
 */

import type { Connector } from '../../core/Connector.js';
import type { ToolFunction, ToolContext } from '../../domain/entities/Tool.js';
import {
  type GitHubGetPRResult,
  type GitHubPRResponse,
  resolveRepository,
  githubFetch,
  formatGitHubToolError,
} from './types.js';

/**
 * Arguments for the get_pr tool
 */
export interface GetPRArgs {
  /** Repository in "owner/repo" format or full GitHub URL */
  repository?: string;
  /** Pull request number */
  pull_number: number;
}

/**
 * Create a GitHub get_pr tool
 */
export function createGetPRTool(
  connector: Connector,
  userId?: string
): ToolFunction<GetPRArgs, GitHubGetPRResult> {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'get_pr',
        description: `Get full details of a pull request from a GitHub repository.

Returns: title, description, state, author, labels, reviewers, merge status, branches, file stats, and more.

EXAMPLES:
- Get PR: { "pull_number": 123 }
- Specific repo: { "repository": "owner/repo", "pull_number": 456 }`,
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

    describeCall: (args: GetPRArgs): string => {
      const parts = [`#${args.pull_number}`];
      if (args.repository) parts.push(`in ${args.repository}`);
      return parts.join(' ');
    },

    permission: {
      scope: 'session',
      riskLevel: 'low',
      approvalMessage: `Get pull request details from GitHub via ${connector.displayName}`,
    },

    execute: async (args: GetPRArgs, context?: ToolContext): Promise<GitHubGetPRResult> => {
      const effectiveUserId = context?.userId ?? userId;
      const effectiveAccountId = context?.accountId;
      const resolved = resolveRepository(args.repository, connector);
      if (!resolved.success) {
        return { success: false, error: resolved.error };
      }
      const { owner, repo } = resolved.repo;

      try {
        const pr = await githubFetch<GitHubPRResponse>(
          connector,
          `/repos/${owner}/${repo}/pulls/${args.pull_number}`,
          { userId: effectiveUserId, accountId: effectiveAccountId }
        );

        return {
          success: true,
          data: {
            number: pr.number,
            title: pr.title,
            body: pr.body,
            state: pr.state,
            draft: pr.draft,
            author: pr.user.login,
            labels: pr.labels.map((l) => l.name),
            reviewers: pr.requested_reviewers.map((r) => r.login),
            mergeable: pr.mergeable,
            head: pr.head.ref,
            base: pr.base.ref,
            url: pr.html_url,
            created_at: pr.created_at,
            updated_at: pr.updated_at,
            additions: pr.additions,
            deletions: pr.deletions,
            changed_files: pr.changed_files,
          },
        };
      } catch (error) {
        return {
          success: false,
          error: formatGitHubToolError('Failed to get PR', error),
        };
      }
    },
  };
}
