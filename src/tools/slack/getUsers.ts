/**
 * Slack - Get Users Tool
 *
 * List workspace members or look up a specific user by ID.
 * Uses users.list and users.info.
 */

import type { Connector } from '../../core/Connector.js';
import type { ToolFunction, ToolContext } from '../../domain/entities/Tool.js';
import {
  type SlackGetUsersResult,
  type SlackUser,
  type SlackUsersListResponse,
  type SlackUsersInfoResponse,
  slackFetch,
  slackPaginate,
} from './types.js';

export interface GetUsersArgs {
  /** Look up a specific user by ID (e.g., "U0123456789"). If omitted, lists all users. */
  userId?: string;
  /** Maximum number of users to return when listing (default: 100) */
  limit?: number;
  /** Include deactivated users (default: false) */
  includeDeactivated?: boolean;
}

function mapUser(member: SlackUsersListResponse['members'][0]): SlackUser {
  return {
    id: member.id,
    name: member.name,
    realName: member.real_name,
    displayName: member.profile?.display_name || undefined,
    email: member.profile?.email || undefined,
    isBot: member.is_bot ?? false,
    isAdmin: member.is_admin,
    timezone: member.tz,
  };
}

export function createGetUsersTool(
  connector: Connector,
  userId?: string
): ToolFunction<GetUsersArgs, SlackGetUsersResult> {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'get_users',
        description: `List workspace members or look up a specific Slack user.

USAGE:
- Look up a single user by ID to resolve <@U0123456789> mentions
- List all workspace members with names, emails, and roles
- Deactivated users are excluded by default

EXAMPLES:
- Look up user: { "userId": "U0123456789" }
- List all users: { }
- Include deactivated: { "includeDeactivated": true, "limit": 200 }`,
        parameters: {
          type: 'object',
          properties: {
            userId: {
              type: 'string',
              description: 'Specific user ID to look up (e.g., "U0123456789"). If omitted, lists all users.',
            },
            limit: {
              type: 'number',
              description: 'Maximum users to return when listing. Default: 100.',
            },
            includeDeactivated: {
              type: 'boolean',
              description: 'Include deactivated users. Default: false.',
            },
          },
          required: [],
        },
      },
    },

    describeCall: (args: GetUsersArgs): string =>
      args.userId ? `user ${args.userId}` : 'list users',

    permission: {
      scope: 'session',
      riskLevel: 'low',
      approvalMessage: `List Slack users via ${connector.displayName}`,
    },

    execute: async (args: GetUsersArgs, context?: ToolContext): Promise<SlackGetUsersResult> => {
      const effectiveUserId = context?.userId ?? userId;
      const effectiveAccountId = context?.accountId;

      try {
        // Single user lookup
        if (args.userId) {
          const response = await slackFetch<SlackUsersInfoResponse>(
            connector,
            '/users.info',
            {
              body: { user: args.userId },
              userId: effectiveUserId,
              accountId: effectiveAccountId,
            }
          );

          const user: SlackUser = {
            id: response.user.id,
            name: response.user.name,
            realName: response.user.real_name,
            displayName: response.user.profile?.display_name || undefined,
            email: response.user.profile?.email || undefined,
            isBot: response.user.is_bot ?? false,
            isAdmin: response.user.is_admin,
            timezone: response.user.tz,
          };

          return {
            success: true,
            users: [user],
            count: 1,
          };
        }

        // List all users
        const limit = args.limit ?? 100;

        const { items, hasMore } = await slackPaginate<SlackUsersListResponse, SlackUsersListResponse['members'][0]>(
          connector,
          '/users.list',
          { limit: Math.min(limit, 200) },
          (resp) => resp.members,
          { limit, userId: effectiveUserId, accountId: effectiveAccountId }
        );

        let users = items.map(mapUser);

        // Filter deactivated unless requested
        if (!args.includeDeactivated) {
          users = users.filter((u) => {
            // Find the raw member to check deleted status
            const raw = items.find((m) => m.id === u.id);
            return !raw?.deleted;
          });
        }

        return {
          success: true,
          users,
          count: users.length,
          hasMore,
        };
      } catch (error) {
        return {
          success: false,
          error: `Failed to get users: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  };
}
