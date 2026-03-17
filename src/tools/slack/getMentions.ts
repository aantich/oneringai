/**
 * Slack - Get Mentions Tool
 *
 * Find messages where the authenticated user/bot is mentioned.
 * Uses search.messages with a targeted query.
 */

import type { Connector } from '../../core/Connector.js';
import type { ToolFunction, ToolContext } from '../../domain/entities/Tool.js';
import {
  type SlackGetMentionsResult,
  type SlackSearchMessagesResponse,
  type SlackMentionMessage,
  slackFetch,
  fromSlackTimestamp,
  getAuthenticatedUserId,
} from './types.js';

export interface GetMentionsArgs {
  /** Maximum number of mentions to return (default: 20, max: 100) */
  limit?: number;
  /** Only return mentions from this channel (optional) */
  channel?: string;
  /** Sort order: "timestamp" (default) or "score" (relevance) */
  sort?: string;
}

export function createGetMentionsTool(
  connector: Connector,
  userId?: string
): ToolFunction<GetMentionsArgs, SlackGetMentionsResult> {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'get_mentions',
        description: `Find messages where you (the bot/user) are mentioned in Slack.

USAGE:
- Returns messages that mention the authenticated user/bot
- Includes channel info and permalinks for context
- Optionally filter to a specific channel
- Use get_thread on results to see full thread context

EXAMPLES:
- Recent mentions: { }
- Mentions in a channel: { "channel": "C0123456789" }
- Top 50 mentions by relevance: { "limit": 50, "sort": "score" }`,
        parameters: {
          type: 'object',
          properties: {
            limit: {
              type: 'number',
              description: 'Maximum mentions to return. Default: 20, max: 100.',
            },
            channel: {
              type: 'string',
              description: 'Filter mentions to this channel ID. Optional.',
            },
            sort: {
              type: 'string',
              enum: ['timestamp', 'score'],
              description: 'Sort by time (newest first) or relevance. Default: "timestamp".',
            },
          },
          required: [],
        },
      },
    },

    describeCall: (args: GetMentionsArgs): string => {
      const parts = ['mentions'];
      if (args.channel) parts.push(`in ${args.channel}`);
      if (args.limit) parts.push(`limit=${args.limit}`);
      return parts.join(' ');
    },

    permission: {
      scope: 'session',
      riskLevel: 'low',
      approvalMessage: `Search Slack mentions via ${connector.displayName}`,
    },

    execute: async (args: GetMentionsArgs, context?: ToolContext): Promise<SlackGetMentionsResult> => {
      const effectiveUserId = context?.userId ?? userId;
      const effectiveAccountId = context?.accountId;

      try {
        // Get our own user ID to build the mention query
        const selfUserId = await getAuthenticatedUserId(connector, effectiveUserId, effectiveAccountId);

        // Build search query
        let query = `<@${selfUserId}>`;
        if (args.channel) {
          query += ` in:<#${args.channel}>`;
        }

        const limit = Math.min(args.limit ?? 20, 100);

        const response = await slackFetch<SlackSearchMessagesResponse>(
          connector,
          '/search.messages',
          {
            body: {
              query,
              count: limit,
              sort: args.sort === 'score' ? 'score' : 'timestamp',
              sort_dir: 'desc',
            },
            userId: effectiveUserId,
            accountId: effectiveAccountId,
          }
        );

        const messages: SlackMentionMessage[] = response.messages.matches.map((match) => ({
          ts: match.ts,
          date: fromSlackTimestamp(match.ts),
          text: match.text,
          user: match.user,
          channel: match.channel,
          threadTs: match.thread_ts,
          permalink: match.permalink,
        }));

        return {
          success: true,
          messages,
          count: messages.length,
          hasMore: messages.length >= limit,
        };
      } catch (error) {
        return {
          success: false,
          error: `Failed to get mentions: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  };
}
