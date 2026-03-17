/**
 * Slack - Set Channel Topic Tool
 *
 * Update the topic of a Slack channel.
 * Uses conversations.setTopic.
 */

import type { Connector } from '../../core/Connector.js';
import type { ToolFunction, ToolContext } from '../../domain/entities/Tool.js';
import {
  type SlackSetChannelTopicResult,
  type SlackConversationsSetTopicResponse,
  slackFetch,
} from './types.js';

export interface SetChannelTopicArgs {
  /** Channel ID to update */
  channel: string;
  /** New topic text (max 250 characters) */
  topic: string;
}

export function createSetChannelTopicTool(
  connector: Connector,
  userId?: string
): ToolFunction<SetChannelTopicArgs, SlackSetChannelTopicResult> {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'set_channel_topic',
        description: `Update the topic of a Slack channel.

USAGE:
- Sets the channel topic (shown at the top of the channel)
- Max 250 characters
- Useful for status boards, incident tracking, sprint goals

EXAMPLES:
- Set topic: { "channel": "C0123456789", "topic": "Sprint 42: Auth migration - Due March 20" }
- Clear topic: { "channel": "C0123456789", "topic": "" }`,
        parameters: {
          type: 'object',
          properties: {
            channel: {
              type: 'string',
              description: 'Channel ID to update.',
            },
            topic: {
              type: 'string',
              description: 'New topic text. Max 250 characters. Empty string clears the topic.',
            },
          },
          required: ['channel', 'topic'],
        },
      },
    },

    describeCall: (args: SetChannelTopicArgs): string => {
      const preview = args.topic.length > 40 ? args.topic.slice(0, 37) + '...' : args.topic;
      return `topic for ${args.channel}: ${preview}`;
    },

    permission: {
      scope: 'session',
      riskLevel: 'medium',
      approvalMessage: `Set Slack channel topic via ${connector.displayName}`,
    },

    execute: async (args: SetChannelTopicArgs, context?: ToolContext): Promise<SlackSetChannelTopicResult> => {
      const effectiveUserId = context?.userId ?? userId;
      const effectiveAccountId = context?.accountId;

      try {
        const response = await slackFetch<SlackConversationsSetTopicResponse>(
          connector,
          '/conversations.setTopic',
          {
            body: {
              channel: args.channel,
              topic: args.topic.slice(0, 250),
            },
            userId: effectiveUserId,
            accountId: effectiveAccountId,
          }
        );

        return {
          success: true,
          topic: response.channel.topic?.value,
        };
      } catch (error) {
        return {
          success: false,
          error: `Failed to set topic: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  };
}
