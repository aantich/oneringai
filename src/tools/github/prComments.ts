/**
 * GitHub PR Comments Tool
 *
 * Get all comments and reviews on a pull request.
 * Merges three types: review comments (line-level), reviews, and issue comments.
 */

import type { Connector } from '../../core/Connector.js';
import type { ToolFunction, ToolContext } from '../../domain/entities/Tool.js';
import {
  type GitHubPRCommentsResult,
  type GitHubPRCommentEntry,
  type GitHubReviewCommentResponse,
  type GitHubReviewResponse,
  type GitHubIssueCommentResponse,
  resolveRepository,
  githubFetch,
  formatGitHubToolError,
} from './types.js';

/**
 * Arguments for the pr_comments tool
 */
export interface PRCommentsArgs {
  /** Repository in "owner/repo" format or full GitHub URL */
  repository?: string;
  /** Pull request number */
  pull_number: number;
}

/**
 * Create a GitHub pr_comments tool
 */
export function createPRCommentsTool(
  connector: Connector,
  userId?: string
): ToolFunction<PRCommentsArgs, GitHubPRCommentsResult> {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'pr_comments',
        description: `Get all comments and reviews on a pull request.

Returns a unified list of:
- **review_comment**: Line-level comments on specific code (includes file path and line number)
- **review**: Full reviews (approve/request changes/comment)
- **comment**: General comments on the PR (issue-level)

All entries are sorted by creation date (oldest first).

EXAMPLES:
- Get comments: { "pull_number": 123 }
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

    describeCall: (args: PRCommentsArgs): string => {
      const parts = [`comments for #${args.pull_number}`];
      if (args.repository) parts.push(`in ${args.repository}`);
      return parts.join(' ');
    },

    permission: {
      scope: 'session',
      riskLevel: 'low',
      approvalMessage: `Get PR comments and reviews from GitHub via ${connector.displayName}`,
    },

    execute: async (args: PRCommentsArgs, context?: ToolContext): Promise<GitHubPRCommentsResult> => {
      const effectiveUserId = context?.userId ?? userId;
      const effectiveAccountId = context?.accountId;
      const resolved = resolveRepository(args.repository, connector);
      if (!resolved.success) {
        return { success: false, error: resolved.error };
      }
      const { owner, repo } = resolved.repo;

      try {
        const basePath = `/repos/${owner}/${repo}`;
        const queryOpts = { userId: effectiveUserId, accountId: effectiveAccountId, queryParams: { per_page: 100 } as Record<string, string | number | boolean> };

        // Fetch all three types in parallel
        const [reviewComments, reviews, issueComments] = await Promise.all([
          githubFetch<GitHubReviewCommentResponse[]>(
            connector,
            `${basePath}/pulls/${args.pull_number}/comments`,
            queryOpts
          ),
          githubFetch<GitHubReviewResponse[]>(
            connector,
            `${basePath}/pulls/${args.pull_number}/reviews`,
            queryOpts
          ),
          githubFetch<GitHubIssueCommentResponse[]>(
            connector,
            `${basePath}/issues/${args.pull_number}/comments`,
            queryOpts
          ),
        ]);

        // Merge into unified format
        const allComments: GitHubPRCommentEntry[] = [];

        for (const rc of reviewComments) {
          allComments.push({
            id: rc.id,
            type: 'review_comment',
            author: rc.user.login,
            body: rc.body,
            created_at: rc.created_at,
            path: rc.path,
            line: rc.line ?? rc.original_line ?? undefined,
          });
        }

        for (const r of reviews) {
          // Skip reviews with empty body (often just approval with no comment)
          if (!r.body && r.state === 'APPROVED') continue;
          allComments.push({
            id: r.id,
            type: 'review',
            author: r.user.login,
            body: r.body || `[${r.state}]`,
            created_at: r.submitted_at,
            state: r.state,
          });
        }

        for (const ic of issueComments) {
          allComments.push({
            id: ic.id,
            type: 'comment',
            author: ic.user.login,
            body: ic.body,
            created_at: ic.created_at,
          });
        }

        // Sort by creation date (oldest first)
        allComments.sort(
          (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        );

        return {
          success: true,
          comments: allComments,
          count: allComments.length,
        };
      } catch (error) {
        return {
          success: false,
          error: formatGitHubToolError('Failed to get PR comments', error),
        };
      }
    },
  };
}
