/**
 * Slack - Get Thread Tool
 *
 * Retrieve all replies in a message thread.
 * Uses conversations.replies.
 */

import type { Connector } from '../../core/Connector.js';
import type { ToolFunction, ToolContext } from '../../domain/entities/Tool.js';
import {
  type SlackGetThreadResult,
  type SlackConversationsRepliesResponse,
  slackFetch,
  formatMessage,
} from './types.js';

export interface GetThreadArgs {
  /** Channel ID containing the thread */
  channel: string;
  /** Timestamp of the parent message (thread_ts) */
  ts: string;
  /** Maximum number of replies to return (default: 100, max: 200) */
  limit?: number;
}

export function createGetThreadTool(
  connector: Connector,
  userId?: string
): ToolFunction<GetThreadArgs, SlackGetThreadResult> {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'get_thread',
        description: `Get all replies in a Slack message thread.

USAGE:
- Returns the parent message plus all replies in chronological order
- Use the ts (timestamp) from get_messages or get_mentions to identify the thread
- Useful for understanding full conversation context before replying

EXAMPLES:
- Get thread: { "channel": "C0123456789", "ts": "1234567890.123456" }
- With limit: { "channel": "C0123456789", "ts": "1234567890.123456", "limit": 50 }`,
        parameters: {
          type: 'object',
          properties: {
            channel: {
              type: 'string',
              description: 'Channel ID containing the thread.',
            },
            ts: {
              type: 'string',
              description: 'Timestamp of the parent message (thread_ts). Get this from get_messages or get_mentions.',
            },
            limit: {
              type: 'number',
              description: 'Maximum replies to return. Default: 100, max: 200.',
            },
          },
          required: ['channel', 'ts'],
        },
      },
    },

    describeCall: (args: GetThreadArgs): string =>
      `thread ${args.ts} in ${args.channel}`,

    permission: {
      scope: 'session',
      riskLevel: 'low',
      approvalMessage: `Read Slack thread via ${connector.displayName}`,
    },

    execute: async (args: GetThreadArgs, context?: ToolContext): Promise<SlackGetThreadResult> => {
      const effectiveUserId = context?.userId ?? userId;
      const effectiveAccountId = context?.accountId;

      try {
        const limit = Math.min(args.limit ?? 100, 200);

        const response = await slackFetch<SlackConversationsRepliesResponse>(
          connector,
          '/conversations.replies',
          {
            body: {
              channel: args.channel,
              ts: args.ts,
              limit,
            },
            userId: effectiveUserId,
            accountId: effectiveAccountId,
          }
        );

        const allMessages = response.messages.map(formatMessage);

        // First message is the parent, rest are replies
        const parentMessage = allMessages[0];
        const replies = allMessages.slice(1);

        return {
          success: true,
          messages: replies,
          count: replies.length,
          parentMessage,
        };
      } catch (error) {
        return {
          success: false,
          error: `Failed to get thread: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  };
}
