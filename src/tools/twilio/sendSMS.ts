/**
 * Twilio - Send SMS Tool
 *
 * Send an SMS message to a phone number via the Twilio Messages API.
 * Supports text messages and optional status callback URL.
 */

import type { Connector } from '../../core/Connector.js';
import type { ToolFunction, ToolContext } from '../../domain/entities/Tool.js';
import {
  type TwilioSendResult,
  type TwilioRawMessage,
  twilioFetch,
  normalizePhoneNumber,
  formatMessage,
} from './types.js';

export interface SendSMSArgs {
  /** Destination phone number in E.164 format (e.g., "+15551234567") */
  to: string;
  /** Your Twilio phone number to send from (E.164 format). If omitted, uses connector options.defaultFromNumber */
  from?: string;
  /** Message text (up to 1600 characters for long SMS, auto-segmented) */
  body: string;
  /** Optional webhook URL for delivery status updates */
  statusCallback?: string;
}

export function createSendSMSTool(
  connector: Connector,
  userId?: string
): ToolFunction<SendSMSArgs, TwilioSendResult> {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'send_sms',
        description: `Send an SMS text message via Twilio.

USAGE:
- Sends an SMS to any phone number
- Phone numbers must be in E.164 format (e.g., "+15551234567")
- Messages over 160 characters are automatically split into segments
- Maximum 1600 characters per message

EXAMPLES:
- Basic: { "to": "+15551234567", "body": "Hello from the agent!" }
- With from number: { "to": "+15551234567", "from": "+15559876543", "body": "Meeting at 3pm" }`,
        parameters: {
          type: 'object',
          properties: {
            to: {
              type: 'string',
              description: 'Destination phone number in E.164 format (e.g., "+15551234567").',
            },
            from: {
              type: 'string',
              description: 'Twilio phone number to send from (E.164). Defaults to connector\'s configured number.',
            },
            body: {
              type: 'string',
              description: 'Message text. Up to 1600 characters (auto-segmented if over 160).',
            },
            statusCallback: {
              type: 'string',
              description: 'Webhook URL to receive delivery status updates.',
            },
          },
          required: ['to', 'body'],
        },
      },
    },

    describeCall: (args: SendSMSArgs): string => {
      const preview = args.body.length > 50 ? args.body.slice(0, 47) + '...' : args.body;
      return `SMS to ${args.to}: ${preview}`;
    },

    permission: {
      scope: 'session',
      riskLevel: 'medium',
      approvalMessage: `Send an SMS message via Twilio (${connector.displayName})`,
    },

    execute: async (args: SendSMSArgs, context?: ToolContext): Promise<TwilioSendResult> => {
      const effectiveUserId = context?.userId ?? userId;
      const effectiveAccountId = context?.accountId;

      try {
        const to = normalizePhoneNumber(args.to);
        const from = args.from
          ? normalizePhoneNumber(args.from)
          : (connector.getOptions().defaultFromNumber as string | undefined);

        if (!from) {
          return {
            success: false,
            error: 'No "from" phone number provided and no defaultFromNumber configured on the connector. Provide a "from" number or set options.defaultFromNumber on the Twilio connector.',
          };
        }

        const body: Record<string, string> = {
          To: to,
          From: from,
          Body: args.body,
        };

        if (args.statusCallback) {
          body.StatusCallback = args.statusCallback;
        }

        const raw = await twilioFetch<TwilioRawMessage>(
          connector,
          '/Messages.json',
          { method: 'POST', body, userId: effectiveUserId, accountId: effectiveAccountId }
        );

        return {
          success: true,
          message: formatMessage(raw),
        };
      } catch (error) {
        return {
          success: false,
          error: `Failed to send SMS: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  };
}
