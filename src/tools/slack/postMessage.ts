/**
 * Slack - Post Message Tool
 *
 * Send a message to a channel, DM, or thread.
 * Uses chat.postMessage with optional thread_ts for replies.
 */

import type { Connector } from '../../core/Connector.js';
import type { ToolFunction, ToolContext } from '../../domain/entities/Tool.js';
import {
  type SlackPostMessageResult,
  type SlackPostMessageResponse,
  slackFetch,
} from './types.js';

export interface PostMessageArgs {
  /** Channel or conversation ID to post to */
  channel: string;
  /** Message text (supports Slack mrkdwn formatting) */
  text: string;
  /** Thread timestamp to reply to (makes this a threaded reply) */
  threadTs?: string;
  /** If true, also post the reply to the channel (default: false) */
  replyBroadcast?: boolean;
  /** Set to false to disable link unfurling (default: true) */
  unfurlLinks?: boolean;
}

export function createPostMessageTool(
  connector: Connector,
  userId?: string
): ToolFunction<PostMessageArgs, SlackPostMessageResult> {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'post_message',
        description: `Send a message to a Slack channel, DM, or thread.

USAGE:
- Posts a new message or a threaded reply
- Supports Slack mrkdwn formatting: *bold*, _italic_, ~strikethrough~, \`code\`, \`\`\`code block\`\`\`, <url|text>, <@user_id>
- To reply in a thread, provide the thread_ts of the parent message
- To reply AND post to channel, set replyBroadcast=true

EXAMPLES:
- Post to channel: { "channel": "C0123456789", "text": "Hello team!" }
- Reply in thread: { "channel": "C0123456789", "text": "Good point!", "threadTs": "1234567890.123456" }
- Broadcast reply: { "channel": "C0123456789", "text": "Summary for everyone", "threadTs": "1234567890.123456", "replyBroadcast": true }
- Mention user: { "channel": "C0123456789", "text": "Hey <@U0123456789>, take a look" }`,
        parameters: {
          type: 'object',
          properties: {
            channel: {
              type: 'string',
              description: 'Channel or conversation ID (e.g., "C0123456789" for channels, "D0123456789" for DMs).',
            },
            text: {
              type: 'string',
              description: 'Message text. Supports Slack mrkdwn: *bold*, _italic_, `code`, <url|label>, <@user_id>.',
            },
            threadTs: {
              type: 'string',
              description: 'Thread timestamp to reply to. Makes this a threaded reply instead of a top-level message.',
            },
            replyBroadcast: {
              type: 'boolean',
              description: 'If replying in a thread, also post the reply to the channel. Default: false.',
            },
            unfurlLinks: {
              type: 'boolean',
              description: 'Enable or disable link unfurling (previews). Default: true.',
            },
          },
          required: ['channel', 'text'],
        },
      },
    },

    describeCall: (args: PostMessageArgs): string => {
      const action = args.threadTs ? 'Reply in' : 'Post to';
      const preview = args.text.length > 50 ? args.text.slice(0, 47) + '...' : args.text;
      return `${action} ${args.channel}: ${preview}`;
    },

    permission: {
      scope: 'session',
      riskLevel: 'medium',
      approvalMessage: `Post a message to Slack via ${connector.displayName}`,
    },

    execute: async (args: PostMessageArgs, context?: ToolContext): Promise<SlackPostMessageResult> => {
      const effectiveUserId = context?.userId ?? userId;
      const effectiveAccountId = context?.accountId;

      try {
        const body: Record<string, unknown> = {
          channel: args.channel,
          text: args.text,
        };

        if (args.threadTs) {
          body.thread_ts = args.threadTs;
        }
        if (args.replyBroadcast) {
          body.reply_broadcast = true;
        }
        if (args.unfurlLinks === false) {
          body.unfurl_links = false;
        }

        const response = await slackFetch<SlackPostMessageResponse>(
          connector,
          '/chat.postMessage',
          { body, userId: effectiveUserId, accountId: effectiveAccountId }
        );

        return {
          success: true,
          ts: response.ts,
          channel: response.channel,
        };
      } catch (error) {
        return {
          success: false,
          error: `Failed to post message: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  };
}
