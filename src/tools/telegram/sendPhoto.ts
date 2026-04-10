/**
 * Telegram - Send Photo Tool
 *
 * Send a photo to a chat via the Telegram Bot API.
 * Supports sending by URL or file_id (previously uploaded).
 */

import type { Connector } from '../../core/Connector.js';
import type { ToolFunction, ToolContext } from '../../domain/entities/Tool.js';
import { type TelegramSendResult, type TelegramMessage, telegramFetch, formatTelegramToolError } from './types.js';

export interface SendPhotoArgs {
  /** Target chat ID (number) or @username (string) */
  chat_id: string | number;
  /** Photo URL or file_id of a previously sent photo */
  photo: string;
  /** Photo caption (up to 1024 characters) */
  caption?: string;
  /** Parse mode for caption: "Markdown", "MarkdownV2", or "HTML" */
  parse_mode?: 'Markdown' | 'MarkdownV2' | 'HTML';
  /** Message ID to reply to */
  reply_to_message_id?: number;
  /** Send silently (no notification sound) */
  disable_notification?: boolean;
}

export function createSendPhotoTool(
  connector: Connector
): ToolFunction<SendPhotoArgs, TelegramSendResult> {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'telegram_send_photo',
        description: `Send a photo via Telegram Bot API.

USAGE:
- Send a photo by URL or by file_id (from a previously sent photo)
- Optional caption up to 1024 characters with formatting support
- The bot must be a member of the target chat

EXAMPLES:
- By URL: { "chat_id": 123456789, "photo": "https://example.com/image.jpg" }
- With caption: { "chat_id": 123456789, "photo": "https://example.com/image.jpg", "caption": "Check this out!" }
- By file_id: { "chat_id": 123456789, "photo": "AgACAgIAAxk..." }`,
        parameters: {
          type: 'object',
          properties: {
            chat_id: {
              type: ['string', 'number'],
              description: 'Target chat ID (number) or @username (string).',
            },
            photo: {
              type: 'string',
              description: 'Photo URL or file_id of a previously uploaded photo.',
            },
            caption: {
              type: 'string',
              description: 'Photo caption. Up to 1024 characters.',
            },
            parse_mode: {
              type: 'string',
              enum: ['Markdown', 'MarkdownV2', 'HTML'],
              description: 'Formatting mode for the caption.',
            },
            reply_to_message_id: {
              type: 'number',
              description: 'Message ID to reply to.',
            },
            disable_notification: {
              type: 'boolean',
              description: 'Send silently without notification sound.',
            },
          },
          required: ['chat_id', 'photo'],
        },
      },
    },

    describeCall: (args: SendPhotoArgs): string => {
      const target = String(args.chat_id);
      return args.caption
        ? `Photo to ${target}: ${args.caption.slice(0, 40)}`
        : `Photo to ${target}`;
    },

    permission: {
      scope: 'session',
      riskLevel: 'medium',
      approvalMessage: `Send a Telegram photo via ${connector.displayName}`,
    },

    execute: async (args: SendPhotoArgs, _context?: ToolContext): Promise<TelegramSendResult> => {
      try {
        const body: Record<string, unknown> = {
          chat_id: args.chat_id,
          photo: args.photo,
        };

        if (args.caption) body.caption = args.caption;
        if (args.parse_mode) body.parse_mode = args.parse_mode;
        if (args.reply_to_message_id) body.reply_to_message_id = args.reply_to_message_id;
        if (args.disable_notification) body.disable_notification = true;

        const message = await telegramFetch<TelegramMessage>(connector, 'sendPhoto', { body });
        return { success: true, message };
      } catch (error) {
        return {
          success: false,
          error: formatTelegramToolError('Failed to send photo', error),
        };
      }
    },
  };
}
