/**
 * Telegram - Get Chat Tool
 *
 * Get information about a chat (private, group, supergroup, or channel).
 */

import type { Connector } from '../../core/Connector.js';
import type { ToolFunction, ToolContext } from '../../domain/entities/Tool.js';
import { type TelegramGetChatResult, type TelegramChat, telegramFetch } from './types.js';

export interface GetChatArgs {
  /** Chat ID (number) or @username (string) */
  chat_id: string | number;
}

export function createGetChatTool(
  connector: Connector
): ToolFunction<GetChatArgs, TelegramGetChatResult> {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'telegram_get_chat',
        description: `Get information about a Telegram chat (private, group, supergroup, or channel).

USAGE:
- Returns chat details: title, type, description, username, invite link
- Works for any chat the bot is a member of
- For public chats/channels, use @username as chat_id

EXAMPLES:
- By ID: { "chat_id": -1001234567890 }
- By username: { "chat_id": "@mychannel" }`,
        parameters: {
          type: 'object',
          properties: {
            chat_id: {
              type: ['string', 'number'],
              description: 'Chat ID (number) or @username (string) for public chats.',
            },
          },
          required: ['chat_id'],
        },
      },
    },

    describeCall: (args: GetChatArgs): string => `Get chat ${args.chat_id}`,

    permission: {
      scope: 'session',
      riskLevel: 'low',
      approvalMessage: `Get Telegram chat info via ${connector.displayName}`,
    },

    execute: async (args: GetChatArgs, _context?: ToolContext): Promise<TelegramGetChatResult> => {
      try {
        const chat = await telegramFetch<TelegramChat>(connector, 'getChat', {
          body: { chat_id: args.chat_id },
        });
        return { success: true, chat };
      } catch (error) {
        return {
          success: false,
          error: `Failed to get chat: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  };
}
