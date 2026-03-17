/**
 * Slack - Search Messages Tool
 *
 * Search for messages by keyword, user, channel, or date range.
 * Uses search.messages — the most powerful Slack query tool.
 */

import type { Connector } from '../../core/Connector.js';
import type { ToolFunction, ToolContext } from '../../domain/entities/Tool.js';
import {
  type SlackSearchMessagesResult,
  type SlackSearchMessagesResponse,
  type SlackMentionMessage,
  slackFetch,
  fromSlackTimestamp,
} from './types.js';

export interface SearchMessagesArgs {
  /** Search query. Supports Slack search modifiers: from:, in:, before:, after:, has:, etc. */
  query: string;
  /** Maximum number of results (default: 20, max: 100) */
  limit?: number;
  /** Sort: "timestamp" (default) or "score" (relevance) */
  sort?: string;
}

export function createSearchMessagesTool(
  connector: Connector,
  userId?: string
): ToolFunction<SearchMessagesArgs, SlackSearchMessagesResult> {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'search_messages',
        description: `Search for messages across Slack by keyword, user, channel, or date range.

USAGE:
- Supports Slack search modifiers in the query string
- Returns matching messages with channel info and permalinks

SEARCH MODIFIERS:
- from:@username — messages from a specific user
- in:#channel — messages in a specific channel
- before:2025-03-15 — messages before a date
- after:2025-03-01 — messages after a date
- has:reaction — messages with reactions
- has:link — messages with links
- has:pin — pinned messages
- is:thread — messages in threads

EXAMPLES:
- Keyword search: { "query": "deployment plan" }
- From a user: { "query": "from:@alice deployment" }
- In a channel: { "query": "in:#engineering bug fix" }
- Date range: { "query": "after:2025-03-01 before:2025-03-15 release" }
- Combined: { "query": "from:@bob in:#ops after:2025-03-10 incident" }`,
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Search query. Supports Slack modifiers: from:, in:, before:, after:, has:, is:thread, etc.',
            },
            limit: {
              type: 'number',
              description: 'Maximum results. Default: 20, max: 100.',
            },
            sort: {
              type: 'string',
              enum: ['timestamp', 'score'],
              description: 'Sort by time or relevance. Default: "timestamp".',
            },
          },
          required: ['query'],
        },
      },
    },

    describeCall: (args: SearchMessagesArgs): string => {
      const preview = args.query.length > 60 ? args.query.slice(0, 57) + '...' : args.query;
      return `search: ${preview}`;
    },

    permission: {
      scope: 'session',
      riskLevel: 'low',
      approvalMessage: `Search Slack messages via ${connector.displayName}`,
    },

    execute: async (args: SearchMessagesArgs, context?: ToolContext): Promise<SlackSearchMessagesResult> => {
      const effectiveUserId = context?.userId ?? userId;
      const effectiveAccountId = context?.accountId;

      try {
        const limit = Math.min(args.limit ?? 20, 100);

        const response = await slackFetch<SlackSearchMessagesResponse>(
          connector,
          '/search.messages',
          {
            body: {
              query: args.query,
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
          total: response.messages.total,
          hasMore: messages.length < response.messages.total,
        };
      } catch (error) {
        return {
          success: false,
          error: `Failed to search messages: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  };
}
