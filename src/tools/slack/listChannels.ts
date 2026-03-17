/**
 * Slack - List Channels Tool
 *
 * List public/private channels, DMs, and group DMs in the workspace.
 * Uses conversations.list with cursor-based pagination.
 */

import type { Connector } from '../../core/Connector.js';
import type { ToolFunction, ToolContext } from '../../domain/entities/Tool.js';
import {
  type SlackListChannelsResult,
  type SlackConversationsListResponse,
  slackPaginate,
} from './types.js';

export interface ListChannelsArgs {
  /** Filter by channel type: "public", "private", "dm", "mpim", or "all" (default: "public") */
  type?: string;
  /** Maximum number of channels to return (default: 100) */
  limit?: number;
  /** Exclude archived channels (default: true) */
  excludeArchived?: boolean;
}

export function createListChannelsTool(
  connector: Connector,
  userId?: string
): ToolFunction<ListChannelsArgs, SlackListChannelsResult> {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'list_channels',
        description: `List channels in the Slack workspace.

USAGE:
- Returns channel names, IDs, topics, purposes, and member counts
- Filter by type: public channels, private channels, DMs, or all
- Archived channels are excluded by default

EXAMPLES:
- List public channels: { }
- List all channel types: { "type": "all" }
- List private channels: { "type": "private", "limit": 50 }`,
        parameters: {
          type: 'object',
          properties: {
            type: {
              type: 'string',
              enum: ['public', 'private', 'dm', 'mpim', 'all'],
              description: 'Channel type filter. Default: "public".',
            },
            limit: {
              type: 'number',
              description: 'Maximum number of channels to return. Default: 100.',
            },
            excludeArchived: {
              type: 'boolean',
              description: 'Exclude archived channels. Default: true.',
            },
          },
          required: [],
        },
      },
    },

    describeCall: (args: ListChannelsArgs): string => {
      const parts = ['channels'];
      if (args.type && args.type !== 'public') parts.push(`(${args.type})`);
      if (args.limit) parts.push(`limit=${args.limit}`);
      return parts.join(' ');
    },

    permission: {
      scope: 'session',
      riskLevel: 'low',
      approvalMessage: `List Slack channels via ${connector.displayName}`,
    },

    execute: async (args: ListChannelsArgs, context?: ToolContext): Promise<SlackListChannelsResult> => {
      const effectiveUserId = context?.userId ?? userId;
      const effectiveAccountId = context?.accountId;

      try {
        // Map type filter to Slack's types parameter
        const typeMap: Record<string, string> = {
          public: 'public_channel',
          private: 'private_channel',
          dm: 'im',
          mpim: 'mpim',
          all: 'public_channel,private_channel,im,mpim',
        };
        const types = typeMap[args.type ?? 'public'] ?? 'public_channel';
        const limit = Math.min(args.limit ?? 100, 1000);

        const params: Record<string, unknown> = {
          types,
          exclude_archived: args.excludeArchived !== false,
          limit: Math.min(limit, 200), // Slack per-page limit
        };

        const { items, hasMore } = await slackPaginate<SlackConversationsListResponse, SlackConversationsListResponse['channels'][0]>(
          connector,
          '/conversations.list',
          params,
          (resp) => resp.channels,
          { limit, userId: effectiveUserId, accountId: effectiveAccountId }
        );

        const channels = items.map((ch) => ({
          id: ch.id,
          name: ch.name,
          topic: ch.topic?.value || undefined,
          purpose: ch.purpose?.value || undefined,
          memberCount: ch.num_members,
          isArchived: ch.is_archived ?? false,
          isPrivate: ch.is_private ?? false,
          isIM: ch.is_im ?? ch.is_mpim ?? false,
        }));

        return {
          success: true,
          channels,
          count: channels.length,
          hasMore,
        };
      } catch (error) {
        return {
          success: false,
          error: `Failed to list channels: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  };
}
