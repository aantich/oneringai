/**
 * GitHub Create PR Tool
 *
 * Create a pull request on a GitHub repository.
 */

import type { Connector } from '../../core/Connector.js';
import type { ToolFunction, ToolContext } from '../../domain/entities/Tool.js';
import {
  type GitHubCreatePRResult,
  resolveRepository,
  githubFetch,
  formatGitHubToolError,
} from './types.js';

/**
 * Arguments for the create_pr tool
 */
export interface CreatePRArgs {
  /** Repository in "owner/repo" format or full GitHub URL */
  repository?: string;
  /** Pull request title */
  title: string;
  /** Pull request description/body (Markdown supported) */
  body?: string;
  /** Source branch name (the branch with your changes) */
  head: string;
  /** Target branch name (the branch you want to merge into) */
  base: string;
  /** Create as a draft pull request */
  draft?: boolean;
}

/** @internal */
interface GitHubCreatePRResponse {
  number: number;
  html_url: string;
  state: string;
  title: string;
}

/**
 * Create a GitHub create_pr tool
 */
export function createCreatePRTool(
  connector: Connector,
  userId?: string
): ToolFunction<CreatePRArgs, GitHubCreatePRResult> {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'create_pr',
        description: `Create a pull request on a GitHub repository.

USAGE:
- Specify source branch (head) and target branch (base)
- Optionally create as draft

EXAMPLES:
- Create PR: { "title": "Add feature", "head": "feature-branch", "base": "main" }
- Draft PR: { "title": "WIP: Refactor", "head": "refactor", "base": "develop", "draft": true }
- With body: { "title": "Fix bug #42", "body": "Fixes the login issue\\n\\n## Changes\\n- Fixed auth flow", "head": "fix/42", "base": "main" }`,
        parameters: {
          type: 'object',
          properties: {
            repository: {
              type: 'string',
              description:
                'Repository in "owner/repo" format or full GitHub URL. Optional if connector has a default repository.',
            },
            title: {
              type: 'string',
              description: 'Pull request title',
            },
            body: {
              type: 'string',
              description: 'Pull request description/body (Markdown supported)',
            },
            head: {
              type: 'string',
              description: 'Source branch name (the branch with your changes)',
            },
            base: {
              type: 'string',
              description: 'Target branch name (the branch you want to merge into, e.g., "main")',
            },
            draft: {
              type: 'boolean',
              description: 'Create as a draft pull request (default: false)',
            },
          },
          required: ['title', 'head', 'base'],
        },
      },
    },

    describeCall: (args: CreatePRArgs): string => {
      const parts = [args.title];
      if (args.repository) parts.push(`in ${args.repository}`);
      return parts.join(' ');
    },

    permission: {
      scope: 'session',
      riskLevel: 'medium',
      approvalMessage: `Create a pull request on GitHub via ${connector.displayName}`,
    },

    execute: async (args: CreatePRArgs, context?: ToolContext): Promise<GitHubCreatePRResult> => {
      const effectiveUserId = context?.userId ?? userId;
      const effectiveAccountId = context?.accountId;
      const resolved = resolveRepository(args.repository, connector);
      if (!resolved.success) {
        return { success: false, error: resolved.error };
      }
      const { owner, repo } = resolved.repo;

      try {
        const pr = await githubFetch<GitHubCreatePRResponse>(
          connector,
          `/repos/${owner}/${repo}/pulls`,
          {
            method: 'POST',
            userId: effectiveUserId,
            accountId: effectiveAccountId,
            body: {
              title: args.title,
              body: args.body,
              head: args.head,
              base: args.base,
              draft: args.draft ?? false,
            },
          }
        );

        return {
          success: true,
          data: {
            number: pr.number,
            url: pr.html_url,
            state: pr.state,
            title: pr.title,
          },
        };
      } catch (error) {
        return {
          success: false,
          error: formatGitHubToolError('Failed to create PR', error),
        };
      }
    },
  };
}
