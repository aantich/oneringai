/**
 * Twilio - Send WhatsApp Message Tool
 *
 * Send a WhatsApp message via the Twilio Messages API.
 * Uses the same endpoint as SMS but with "whatsapp:" prefix on phone numbers.
 *
 * Important: Business-initiated messages (outside the 24-hour conversation window)
 * require pre-approved content templates via ContentSid.
 */

import type { Connector } from '../../core/Connector.js';
import type { ToolFunction, ToolContext } from '../../domain/entities/Tool.js';
import {
  type TwilioSendResult,
  type TwilioRawMessage,
  twilioFetch,
  toWhatsAppNumber,
  formatMessage,
  formatTwilioToolError,
} from './types.js';

export interface SendWhatsAppArgs {
  /** Destination phone number in E.164 format (e.g., "+15551234567"). The "whatsapp:" prefix is added automatically. */
  to: string;
  /** Your Twilio WhatsApp-enabled number (E.164). If omitted, uses connector options.defaultWhatsAppNumber */
  from?: string;
  /** Freeform message text. Only works within the 24-hour conversation window or for session messages. */
  body?: string;
  /** Content SID for pre-approved WhatsApp template (required for business-initiated messages outside 24h window) */
  contentSid?: string;
  /** JSON string of template variables to fill in the ContentSid template */
  contentVariables?: string;
  /** Optional webhook URL for delivery status updates */
  statusCallback?: string;
}

export function createSendWhatsAppTool(
  connector: Connector,
  userId?: string
): ToolFunction<SendWhatsAppArgs, TwilioSendResult> {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'send_whatsapp',
        description: `Send a WhatsApp message via Twilio.

USAGE:
- Sends a WhatsApp message to any phone number
- The "whatsapp:" prefix is added automatically to phone numbers
- Freeform text works only within the 24-hour conversation window (after user messages you first)
- Business-initiated messages (outside 24h window) REQUIRE a pre-approved template via contentSid
- For templates, use contentSid + contentVariables instead of body

EXAMPLES:
- Freeform reply: { "to": "+15551234567", "body": "Thanks for reaching out!" }
- Template message: { "to": "+15551234567", "contentSid": "HXXXXXXXXX", "contentVariables": "{\\"1\\":\\"John\\"}" }
- With from: { "to": "+15551234567", "from": "+15559876543", "body": "Your order shipped" }`,
        parameters: {
          type: 'object',
          properties: {
            to: {
              type: 'string',
              description: 'Destination phone number in E.164 format (e.g., "+15551234567"). The "whatsapp:" prefix is added automatically.',
            },
            from: {
              type: 'string',
              description: 'WhatsApp-enabled Twilio number (E.164). Defaults to connector\'s configured WhatsApp number.',
            },
            body: {
              type: 'string',
              description: 'Freeform message text. Only works within the 24h conversation window. Omit if using contentSid.',
            },
            contentSid: {
              type: 'string',
              description: 'Content SID for a pre-approved WhatsApp template. Required for business-initiated messages outside the 24h window.',
            },
            contentVariables: {
              type: 'string',
              description: 'JSON string of variables for the template (e.g., \'{"1":"John","2":"Order #123"}\').',
            },
            statusCallback: {
              type: 'string',
              description: 'Webhook URL to receive delivery status updates.',
            },
          },
          required: ['to'],
        },
      },
    },

    describeCall: (args: SendWhatsAppArgs): string => {
      if (args.body) {
        const preview = args.body.length > 50 ? args.body.slice(0, 47) + '...' : args.body;
        return `WhatsApp to ${args.to}: ${preview}`;
      }
      return `WhatsApp template to ${args.to} (${args.contentSid})`;
    },

    permission: {
      scope: 'session',
      riskLevel: 'medium',
      approvalMessage: `Send a WhatsApp message via Twilio (${connector.displayName})`,
    },

    execute: async (args: SendWhatsAppArgs, context?: ToolContext): Promise<TwilioSendResult> => {
      const effectiveUserId = context?.userId ?? userId;
      const effectiveAccountId = context?.accountId;

      try {
        if (!args.body && !args.contentSid) {
          return {
            success: false,
            error: 'Either "body" (freeform text) or "contentSid" (template) is required.',
          };
        }

        const to = toWhatsAppNumber(args.to);
        const fromRaw = args.from ?? (connector.getOptions().defaultWhatsAppNumber as string | undefined);

        if (!fromRaw) {
          return {
            success: false,
            error: 'No "from" WhatsApp number provided and no defaultWhatsAppNumber configured on the connector. Provide a "from" number or set options.defaultWhatsAppNumber on the Twilio connector.',
          };
        }

        const from = toWhatsAppNumber(fromRaw);

        const body: Record<string, string> = {
          To: to,
          From: from,
        };

        if (args.body) {
          body.Body = args.body;
        }
        if (args.contentSid) {
          body.ContentSid = args.contentSid;
        }
        if (args.contentVariables) {
          body.ContentVariables = args.contentVariables;
        }
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
          error: formatTwilioToolError('Failed to send WhatsApp message', error),
        };
      }
    },
  };
}
