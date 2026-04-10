/**
 * Slack - Add Reaction Tool
 *
 * Add an emoji reaction to a message.
 * Uses reactions.add.
 */

import type { Connector } from '../../core/Connector.js';
import type { ToolFunction, ToolContext } from '../../domain/entities/Tool.js';
import {
  type SlackAddReactionResult,
  type SlackReactionsAddResponse,
  slackFetch,
  formatSlackToolError,
} from './types.js';

export interface AddReactionArgs {
  /** Channel containing the message */
  channel: string;
  /** Timestamp of the message to react to */
  ts: string;
  /** Emoji name without colons (e.g., "thumbsup", "eyes", "white_check_mark") */
  emoji: string;
}

export function createAddReactionTool(
  connector: Connector,
  userId?: string
): ToolFunction<AddReactionArgs, SlackAddReactionResult> {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'add_reaction',
        description: `Add an emoji reaction to a Slack message.

USAGE:
- Lightweight way to acknowledge messages without posting a reply
- Use emoji names without colons
- Common emojis: thumbsup, eyes, white_check_mark, heavy_check_mark, rocket, tada, thinking_face, raised_hands

EXAMPLES:
- Acknowledge: { "channel": "C0123456789", "ts": "1234567890.123456", "emoji": "eyes" }
- Approve: { "channel": "C0123456789", "ts": "1234567890.123456", "emoji": "white_check_mark" }
- Celebrate: { "channel": "C0123456789", "ts": "1234567890.123456", "emoji": "tada" }`,
        parameters: {
          type: 'object',
          properties: {
            channel: {
              type: 'string',
              description: 'Channel ID containing the message.',
            },
            ts: {
              type: 'string',
              description: 'Timestamp of the message to react to.',
            },
            emoji: {
              type: 'string',
              description: 'Emoji name without colons. E.g., "thumbsup", "eyes", "white_check_mark".',
            },
          },
          required: ['channel', 'ts', 'emoji'],
        },
      },
    },

    describeCall: (args: AddReactionArgs): string =>
      `:${args.emoji}: on ${args.ts}`,

    permission: {
      scope: 'session',
      riskLevel: 'low',
      approvalMessage: `Add reaction in Slack via ${connector.displayName}`,
    },

    execute: async (args: AddReactionArgs, context?: ToolContext): Promise<SlackAddReactionResult> => {
      const effectiveUserId = context?.userId ?? userId;
      const effectiveAccountId = context?.accountId;

      try {
        // Strip colons if user accidentally included them
        const emoji = args.emoji.replace(/^:+|:+$/g, '');

        await slackFetch<SlackReactionsAddResponse>(
          connector,
          '/reactions.add',
          {
            body: {
              channel: args.channel,
              timestamp: args.ts,
              name: emoji,
            },
            userId: effectiveUserId,
            accountId: effectiveAccountId,
          }
        );

        return { success: true };
      } catch (error) {
        // already_reacted is not a real error
        if (error instanceof Error && error.message.includes('already_reacted')) {
          return { success: true };
        }
        return {
          success: false,
          error: formatSlackToolError('Failed to add reaction', error),
        };
      }
    },
  };
}
