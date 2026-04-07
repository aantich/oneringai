/**
 * Telegram - Send Message Tool
 *
 * Send a text message to a chat via the Telegram Bot API.
 * Supports Markdown/HTML formatting, reply-to, and inline keyboards.
 */

import type { Connector } from '../../core/Connector.js';
import type { ToolFunction, ToolContext } from '../../domain/entities/Tool.js';
import { type TelegramSendResult, type TelegramMessage, telegramFetch } from './types.js';

export interface SendMessageArgs {
  /** Target chat ID (number) or @username (string) */
  chat_id: string | number;
  /** Message text (up to 4096 characters) */
  text: string;
  /** Parse mode: "Markdown", "MarkdownV2", or "HTML". Default: no formatting. */
  parse_mode?: 'Markdown' | 'MarkdownV2' | 'HTML';
  /** Message ID to reply to */
  reply_to_message_id?: number;
  /** Disable link previews */
  disable_web_page_preview?: boolean;
  /** Send silently (no notification sound) */
  disable_notification?: boolean;
}

export function createSendMessageTool(
  connector: Connector
): ToolFunction<SendMessageArgs, TelegramSendResult> {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'telegram_send_message',
        description: `Send a text message via Telegram Bot API.

USAGE:
- Send a message to any chat where the bot is a member
- chat_id can be a numeric ID or @username for public chats/channels
- Supports Markdown, MarkdownV2, and HTML formatting
- Maximum 4096 characters per message

EXAMPLES:
- Basic: { "chat_id": 123456789, "text": "Hello!" }
- Formatted: { "chat_id": "@mychannel", "text": "*bold* _italic_", "parse_mode": "Markdown" }
- Reply: { "chat_id": 123456789, "text": "Got it!", "reply_to_message_id": 42 }`,
        parameters: {
          type: 'object',
          properties: {
            chat_id: {
              type: ['string', 'number'],
              description: 'Target chat ID (number) or @username (string) for public chats/channels.',
            },
            text: {
              type: 'string',
              description: 'Message text. Up to 4096 characters.',
            },
            parse_mode: {
              type: 'string',
              enum: ['Markdown', 'MarkdownV2', 'HTML'],
              description: 'Text formatting mode. Omit for plain text.',
            },
            reply_to_message_id: {
              type: 'number',
              description: 'Message ID to reply to.',
            },
            disable_web_page_preview: {
              type: 'boolean',
              description: 'Disable link previews in the message.',
            },
            disable_notification: {
              type: 'boolean',
              description: 'Send silently without notification sound.',
            },
          },
          required: ['chat_id', 'text'],
        },
      },
    },

    describeCall: (args: SendMessageArgs): string => {
      const preview = args.text.length > 50 ? args.text.slice(0, 47) + '...' : args.text;
      return `Telegram to ${args.chat_id}: ${preview}`;
    },

    permission: {
      scope: 'session',
      riskLevel: 'medium',
      approvalMessage: `Send a Telegram message via ${connector.displayName}`,
    },

    execute: async (args: SendMessageArgs, _context?: ToolContext): Promise<TelegramSendResult> => {
      try {
        const body: Record<string, unknown> = {
          chat_id: args.chat_id,
          text: args.text,
        };

        if (args.parse_mode) body.parse_mode = args.parse_mode;
        if (args.reply_to_message_id) body.reply_to_message_id = args.reply_to_message_id;
        if (args.disable_web_page_preview) body.disable_web_page_preview = true;
        if (args.disable_notification) body.disable_notification = true;

        const message = await telegramFetch<TelegramMessage>(connector, 'sendMessage', { body });
        return { success: true, message };
      } catch (error) {
        return {
          success: false,
          error: `Failed to send message: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  };
}
