/**
 * Telegram - Get Updates Tool
 *
 * Long-poll for incoming messages and events via the Telegram Bot API.
 * Returns an array of Update objects (messages, edits, channel posts).
 *
 * Note: Cannot be used simultaneously with webhooks.
 */

import type { Connector } from '../../core/Connector.js';
import type { ToolFunction, ToolContext } from '../../domain/entities/Tool.js';
import { type TelegramGetUpdatesResult, type TelegramUpdate, telegramFetch } from './types.js';

export interface GetUpdatesArgs {
  /** Offset: ID of the first update to return. Use last update_id + 1 to acknowledge previous updates. */
  offset?: number;
  /** Maximum number of updates to return (1-100, default: 100) */
  limit?: number;
  /** Timeout in seconds for long polling (0 = short poll, max 50, default: 0) */
  timeout?: number;
  /** Filter update types: "message", "edited_message", "channel_post", "edited_channel_post", etc. */
  allowed_updates?: string[];
}

export function createGetUpdatesTool(
  connector: Connector
): ToolFunction<GetUpdatesArgs, TelegramGetUpdatesResult> {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'telegram_get_updates',
        description: `Poll for incoming messages and events from Telegram.

USAGE:
- Returns new messages/events sent to the bot since the last poll
- Use offset = last_update_id + 1 to acknowledge processed updates and get only new ones
- Set timeout > 0 for long polling (waits up to N seconds for new updates)
- Cannot be used while a webhook is active — use telegram_set_webhook with empty URL to remove it first

EXAMPLES:
- Get all pending: { }
- Long poll: { "timeout": 30 }
- After processing: { "offset": 123456790 }
- Only messages: { "allowed_updates": ["message"] }`,
        parameters: {
          type: 'object',
          properties: {
            offset: {
              type: 'number',
              description: 'ID of the first update to return. Set to last update_id + 1 to skip already-processed updates.',
            },
            limit: {
              type: 'number',
              description: 'Max updates to return (1-100). Default: 100.',
            },
            timeout: {
              type: 'number',
              description: 'Long polling timeout in seconds (0-50). Default: 0 (immediate response).',
            },
            allowed_updates: {
              type: 'array',
              items: { type: 'string' },
              description: 'Filter by update type: "message", "edited_message", "channel_post", etc.',
            },
          },
          required: [],
        },
      },
    },

    describeCall: (args: GetUpdatesArgs): string => {
      const parts: string[] = ['Get updates'];
      if (args.offset) parts.push(`offset=${args.offset}`);
      if (args.timeout) parts.push(`timeout=${args.timeout}s`);
      if (args.limit) parts.push(`limit=${args.limit}`);
      return parts.join(' ');
    },

    permission: {
      scope: 'session',
      riskLevel: 'low',
      approvalMessage: `Read Telegram updates via ${connector.displayName}`,
    },

    execute: async (args: GetUpdatesArgs, _context?: ToolContext): Promise<TelegramGetUpdatesResult> => {
      try {
        const body: Record<string, unknown> = {};

        if (args.offset !== undefined) body.offset = args.offset;
        if (args.limit !== undefined) body.limit = Math.min(Math.max(args.limit, 1), 100);
        if (args.timeout !== undefined) body.timeout = Math.min(Math.max(args.timeout, 0), 50);
        if (args.allowed_updates) body.allowed_updates = args.allowed_updates;

        const updates = await telegramFetch<TelegramUpdate[]>(connector, 'getUpdates', { body });
        return {
          success: true,
          updates,
          count: updates.length,
        };
      } catch (error) {
        return {
          success: false,
          error: `Failed to get updates: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  };
}
