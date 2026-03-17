/**
 * Slack - Get Channel Info Tool
 *
 * Get detailed information about a specific channel.
 * Uses conversations.info.
 */

import type { Connector } from '../../core/Connector.js';
import type { ToolFunction, ToolContext } from '../../domain/entities/Tool.js';
import {
  type SlackGetChannelInfoResult,
  type SlackConversationsInfoResponse,
  slackFetch,
  fromSlackTimestamp,
} from './types.js';

export interface GetChannelInfoArgs {
  /** Channel ID to get info for */
  channel: string;
}

export function createGetChannelInfoTool(
  connector: Connector,
  userId?: string
): ToolFunction<GetChannelInfoArgs, SlackGetChannelInfoResult> {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'get_channel_info',
        description: `Get detailed information about a Slack channel.

USAGE:
- Returns channel name, topic, purpose, member count, creation date, creator
- Useful for understanding channel context before posting
- Works for public channels, private channels, DMs, and group DMs

EXAMPLES:
- Get info: { "channel": "C0123456789" }`,
        parameters: {
          type: 'object',
          properties: {
            channel: {
              type: 'string',
              description: 'Channel ID (e.g., "C0123456789").',
            },
          },
          required: ['channel'],
        },
      },
    },

    describeCall: (args: GetChannelInfoArgs): string =>
      `info for ${args.channel}`,

    permission: {
      scope: 'session',
      riskLevel: 'low',
      approvalMessage: `Get Slack channel info via ${connector.displayName}`,
    },

    execute: async (args: GetChannelInfoArgs, context?: ToolContext): Promise<SlackGetChannelInfoResult> => {
      const effectiveUserId = context?.userId ?? userId;
      const effectiveAccountId = context?.accountId;

      try {
        const response = await slackFetch<SlackConversationsInfoResponse>(
          connector,
          '/conversations.info',
          {
            body: { channel: args.channel },
            userId: effectiveUserId,
            accountId: effectiveAccountId,
          }
        );

        const ch = response.channel;

        return {
          success: true,
          channel: {
            id: ch.id,
            name: ch.name,
            topic: ch.topic?.value || undefined,
            purpose: ch.purpose?.value || undefined,
            memberCount: ch.num_members,
            isArchived: ch.is_archived ?? false,
            isPrivate: ch.is_private ?? false,
            isIM: ch.is_im ?? ch.is_mpim ?? false,
            created: ch.created ? fromSlackTimestamp(String(ch.created)) : undefined,
            creator: ch.creator,
          },
        };
      } catch (error) {
        return {
          success: false,
          error: `Failed to get channel info: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  };
}
