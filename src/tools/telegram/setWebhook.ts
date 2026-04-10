/**
 * Telegram - Set Webhook Tool
 *
 * Configure a webhook URL for receiving updates instead of polling.
 * Pass an empty URL to remove the webhook and switch back to getUpdates.
 */

import type { Connector } from '../../core/Connector.js';
import type { ToolFunction, ToolContext } from '../../domain/entities/Tool.js';
import { type TelegramSetWebhookResult, telegramFetch, formatTelegramToolError } from './types.js';

export interface SetWebhookArgs {
  /** HTTPS URL for receiving updates. Empty string removes the webhook. */
  url: string;
  /** Maximum number of simultaneous connections (1-100, default: 40) */
  max_connections?: number;
  /** Filter update types to receive */
  allowed_updates?: string[];
  /** Upload a custom certificate for self-signed webhooks (PEM format, not commonly needed) */
  drop_pending_updates?: boolean;
}

export function createSetWebhookTool(
  connector: Connector
): ToolFunction<SetWebhookArgs, TelegramSetWebhookResult> {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'telegram_set_webhook',
        description: `Set or remove a webhook for receiving Telegram updates.

USAGE:
- Set a webhook URL to receive updates via HTTPS POST instead of polling
- The URL must be HTTPS (Telegram rejects plain HTTP)
- Pass an empty URL ("") to remove the webhook and re-enable getUpdates polling
- Only one webhook can be active — setting a new one replaces the old one
- Use drop_pending_updates to skip accumulated updates when switching

EXAMPLES:
- Set webhook: { "url": "https://myserver.com/telegram/webhook" }
- Remove webhook: { "url": "" }
- With filters: { "url": "https://myserver.com/hook", "allowed_updates": ["message", "callback_query"] }`,
        parameters: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description: 'HTTPS webhook URL. Empty string removes the webhook.',
            },
            max_connections: {
              type: 'number',
              description: 'Max simultaneous HTTPS connections for update delivery (1-100). Default: 40.',
            },
            allowed_updates: {
              type: 'array',
              items: { type: 'string' },
              description: 'Filter by update type: "message", "callback_query", etc.',
            },
            drop_pending_updates: {
              type: 'boolean',
              description: 'Drop all pending updates when setting/removing the webhook.',
            },
          },
          required: ['url'],
        },
      },
    },

    describeCall: (args: SetWebhookArgs): string => {
      return args.url ? `Set webhook: ${args.url}` : 'Remove webhook';
    },

    permission: {
      scope: 'session',
      riskLevel: 'high',
      approvalMessage: `Set or remove Telegram webhook via ${connector.displayName}`,
    },

    execute: async (args: SetWebhookArgs, _context?: ToolContext): Promise<TelegramSetWebhookResult> => {
      try {
        if (args.url) {
          // Set webhook
          const body: Record<string, unknown> = { url: args.url };
          if (args.max_connections !== undefined) body.max_connections = args.max_connections;
          if (args.allowed_updates) body.allowed_updates = args.allowed_updates;
          if (args.drop_pending_updates) body.drop_pending_updates = true;
          await telegramFetch<boolean>(connector, 'setWebhook', { body });
        } else {
          // Remove webhook — deleteWebhook only accepts drop_pending_updates
          const body: Record<string, unknown> = {};
          if (args.drop_pending_updates) body.drop_pending_updates = true;
          await telegramFetch<boolean>(connector, 'deleteWebhook', { body });
        }
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: formatTelegramToolError('Failed to set webhook', error),
        };
      }
    },
  };
}
