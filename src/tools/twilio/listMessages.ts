/**
 * Twilio - List Messages Tool
 *
 * List and filter messages (SMS and WhatsApp) from the Twilio Messages API.
 * Supports filtering by phone number, date range, and channel.
 */

import type { Connector } from '../../core/Connector.js';
import type { ToolFunction, ToolContext } from '../../domain/entities/Tool.js';
import {
  type TwilioListMessagesResult,
  type TwilioListResponse,
  twilioFetch,
  normalizePhoneNumber,
  toWhatsAppNumber,
  formatMessage,
} from './types.js';

export interface ListMessagesArgs {
  /** Filter by destination phone number (E.164 format) */
  to?: string;
  /** Filter by sender phone number (E.164 format) */
  from?: string;
  /** Filter messages sent after this date (YYYY-MM-DD format) */
  dateSentAfter?: string;
  /** Filter messages sent before this date (YYYY-MM-DD format) */
  dateSentBefore?: string;
  /** Filter by channel: "sms", "whatsapp", or "all" (default: "all") */
  channel?: 'sms' | 'whatsapp' | 'all';
  /** Maximum number of messages to return (default: 50, max: 1000) */
  limit?: number;
}

export function createListMessagesTool(
  connector: Connector,
  userId?: string
): ToolFunction<ListMessagesArgs, TwilioListMessagesResult> {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'list_messages',
        description: `List and filter SMS and WhatsApp messages from Twilio.

USAGE:
- Returns messages in reverse chronological order (newest first)
- Filter by phone number (To/From), date range, and channel
- Twilio stores both SMS and WhatsApp in the same Messages resource
- To filter WhatsApp only, set channel="whatsapp" (adds "whatsapp:" prefix to number filters)
- Date filters use YYYY-MM-DD format
- No server-side direction filter — use "to" and "from" to isolate inbound vs outbound

EXAMPLES:
- All recent messages: { }
- Messages to a number: { "to": "+15551234567" }
- WhatsApp messages: { "channel": "whatsapp", "to": "+15551234567" }
- Date range: { "dateSentAfter": "2026-03-01", "dateSentBefore": "2026-03-31" }
- Combined: { "from": "+15551234567", "dateSentAfter": "2026-03-15", "limit": 100 }`,
        parameters: {
          type: 'object',
          properties: {
            to: {
              type: 'string',
              description: 'Filter by destination phone number (E.164 format, e.g., "+15551234567").',
            },
            from: {
              type: 'string',
              description: 'Filter by sender phone number (E.164 format).',
            },
            dateSentAfter: {
              type: 'string',
              description: 'Only messages sent after this date (YYYY-MM-DD).',
            },
            dateSentBefore: {
              type: 'string',
              description: 'Only messages sent before this date (YYYY-MM-DD).',
            },
            channel: {
              type: 'string',
              enum: ['sms', 'whatsapp', 'all'],
              description: 'Filter by channel type. Default: "all".',
            },
            limit: {
              type: 'number',
              description: 'Maximum messages to return. Default: 50, max: 1000.',
            },
          },
          required: [],
        },
      },
    },

    describeCall: (args: ListMessagesArgs): string => {
      const parts: string[] = ['List messages'];
      if (args.channel && args.channel !== 'all') parts.push(`(${args.channel})`);
      if (args.to) parts.push(`to ${args.to}`);
      if (args.from) parts.push(`from ${args.from}`);
      if (args.dateSentAfter) parts.push(`after ${args.dateSentAfter}`);
      if (args.dateSentBefore) parts.push(`before ${args.dateSentBefore}`);
      if (args.limit) parts.push(`limit=${args.limit}`);
      return parts.join(' ');
    },

    permission: {
      scope: 'session',
      riskLevel: 'low',
      approvalMessage: `Read Twilio messages via ${connector.displayName}`,
    },

    execute: async (args: ListMessagesArgs, context?: ToolContext): Promise<TwilioListMessagesResult> => {
      const effectiveUserId = context?.userId ?? userId;
      const effectiveAccountId = context?.accountId;

      try {
        const limit = Math.min(args.limit ?? 50, 1000);
        const channel = args.channel ?? 'all';

        const queryParams: Record<string, string> = {
          PageSize: String(limit),
        };

        // Apply phone number filters with optional WhatsApp prefix
        if (args.to) {
          const normalized = normalizePhoneNumber(args.to);
          queryParams.To = channel === 'whatsapp' ? toWhatsAppNumber(normalized) : normalized;
        }
        if (args.from) {
          const normalized = normalizePhoneNumber(args.from);
          queryParams.From = channel === 'whatsapp' ? toWhatsAppNumber(normalized) : normalized;
        }

        // Date filters
        if (args.dateSentAfter) {
          queryParams['DateSent>'] = args.dateSentAfter;
        }
        if (args.dateSentBefore) {
          queryParams['DateSent<'] = args.dateSentBefore;
        }

        const response = await twilioFetch<TwilioListResponse>(
          connector,
          '/Messages.json',
          { method: 'GET', queryParams, userId: effectiveUserId, accountId: effectiveAccountId }
        );

        let messages = response.messages.map(formatMessage);

        // Client-side channel filter when channel is specified but numbers weren't prefixed
        // (e.g., filtering WhatsApp when no To/From was provided).
        // NOTE: Twilio has no server-side channel filter. When filtering by channel without
        // To/From, the returned count may be less than `limit` since we filter after fetch.
        // The `hasMore` flag reflects Twilio's pagination, not the post-filter result.
        if (channel === 'whatsapp') {
          messages = messages.filter((m) => m.channel === 'whatsapp');
        } else if (channel === 'sms') {
          messages = messages.filter((m) => m.channel === 'sms');
        }

        return {
          success: true,
          messages,
          count: messages.length,
          hasMore: response.next_page_uri !== null,
        };
      } catch (error) {
        return {
          success: false,
          error: `Failed to list messages: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  };
}
