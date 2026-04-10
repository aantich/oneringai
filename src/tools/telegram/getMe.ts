/**
 * Telegram - Get Me Tool
 *
 * Returns basic information about the bot. Useful for testing the connection.
 */

import type { Connector } from '../../core/Connector.js';
import type { ToolFunction } from '../../domain/entities/Tool.js';
import { type TelegramGetMeResult, type TelegramUser, telegramFetch, formatTelegramToolError } from './types.js';

export function createGetMeTool(
  connector: Connector
): ToolFunction<Record<string, never>, TelegramGetMeResult> {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'telegram_get_me',
        description: `Get information about the Telegram bot (name, username, ID). Useful for verifying the bot connection is working.`,
        parameters: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
    },

    describeCall: (): string => 'Get bot info',

    permission: {
      scope: 'always',
      riskLevel: 'low',
      approvalMessage: `Get Telegram bot info via ${connector.displayName}`,
    },

    execute: async (): Promise<TelegramGetMeResult> => {
      try {
        const bot = await telegramFetch<TelegramUser>(connector, 'getMe');
        return { success: true, bot };
      } catch (error) {
        return {
          success: false,
          error: formatTelegramToolError('Failed to get bot info', error),
        };
      }
    },
  };
}
