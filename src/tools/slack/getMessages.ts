/**
 * Slack - Get Messages Tool
 *
 * Retrieve messages from a channel within an optional time range.
 * Uses conversations.history with cursor-based pagination.
 */

import type { Connector } from '../../core/Connector.js';
import type { ToolFunction, ToolContext } from '../../domain/entities/Tool.js';
import {
  type SlackGetMessagesResult,
  type SlackConversationsHistoryResponse,
  slackFetch,
  toSlackTimestamp,
  formatMessage,
} from './types.js';

export interface GetMessagesArgs {
  /** Channel ID to retrieve messages from */
  channel: string;
  /** Start of time range (ISO 8601 or Slack timestamp). Messages after this time. */
  oldest?: string;
  /** End of time range (ISO 8601 or Slack timestamp). Messages before this time. */
  latest?: string;
  /** Maximum number of messages to return (default: 50, max: 200) */
  limit?: number;
}

export function createGetMessagesTool(
  connector: Connector,
  userId?: string
): ToolFunction<GetMessagesArgs, SlackGetMessagesResult> {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'get_messages',
        description: `Get messages from a Slack channel within an optional time range.

USAGE:
- Returns messages in reverse chronological order (newest first)
- Accepts ISO 8601 dates or Slack timestamps for time range
- Returns top-level messages only — use get_thread for thread replies
- Each message includes: timestamp, author, text, thread info, reactions

EXAMPLES:
- Recent messages: { "channel": "C0123456789" }
- Last 24 hours: { "channel": "C0123456789", "oldest": "2025-03-16T00:00:00Z" }
- Time range: { "channel": "C0123456789", "oldest": "2025-03-01T00:00:00Z", "latest": "2025-03-15T23:59:59Z", "limit": 100 }`,
        parameters: {
          type: 'object',
          properties: {
            channel: {
              type: 'string',
              description: 'Channel ID (e.g., "C0123456789"). Use list_channels to find channel IDs.',
            },
            oldest: {
              type: 'string',
              description: 'Start of time range. ISO 8601 (e.g., "2025-03-16T00:00:00Z") or Slack timestamp.',
            },
            latest: {
              type: 'string',
              description: 'End of time range. ISO 8601 (e.g., "2025-03-16T23:59:59Z") or Slack timestamp.',
            },
            limit: {
              type: 'number',
              description: 'Maximum messages to return. Default: 50, max: 200.',
            },
          },
          required: ['channel'],
        },
      },
    },

    describeCall: (args: GetMessagesArgs): string => {
      const parts = [`#${args.channel}`];
      if (args.oldest) parts.push(`from ${args.oldest}`);
      if (args.latest) parts.push(`to ${args.latest}`);
      if (args.limit) parts.push(`limit=${args.limit}`);
      return parts.join(' ');
    },

    permission: {
      scope: 'session',
      riskLevel: 'low',
      approvalMessage: `Read Slack messages via ${connector.displayName}`,
    },

    execute: async (args: GetMessagesArgs, context?: ToolContext): Promise<SlackGetMessagesResult> => {
      const effectiveUserId = context?.userId ?? userId;
      const effectiveAccountId = context?.accountId;

      try {
        const limit = Math.min(args.limit ?? 50, 200);

        const body: Record<string, unknown> = {
          channel: args.channel,
          limit,
        };

        if (args.oldest) {
          body.oldest = toSlackTimestamp(args.oldest);
        }
        if (args.latest) {
          body.latest = toSlackTimestamp(args.latest);
        }

        const response = await slackFetch<SlackConversationsHistoryResponse>(
          connector,
          '/conversations.history',
          { body, userId: effectiveUserId, accountId: effectiveAccountId }
        );

        const messages = response.messages.map(formatMessage);

        return {
          success: true,
          messages,
          count: messages.length,
          hasMore: response.has_more ?? false,
          channel: args.channel,
        };
      } catch (error) {
        return {
          success: false,
          error: `Failed to get messages: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  };
}
