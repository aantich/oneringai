/**
 * Twilio - Get Message Tool
 *
 * Retrieve a single message by its SID from the Twilio Messages API.
 * Returns full message details including delivery status, price, and error info.
 */

import type { Connector } from '../../core/Connector.js';
import type { ToolFunction, ToolContext } from '../../domain/entities/Tool.js';
import {
  type TwilioGetMessageResult,
  type TwilioRawMessage,
  twilioFetch,
  formatMessage,
} from './types.js';

export interface GetMessageArgs {
  /** The Twilio Message SID (e.g., "SM1234567890abcdef1234567890abcdef") */
  sid: string;
}

export function createGetMessageTool(
  connector: Connector,
  userId?: string
): ToolFunction<GetMessageArgs, TwilioGetMessageResult> {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'get_message',
        description: `Get full details of a single Twilio message by its SID.

USAGE:
- Returns complete message details: body, status, direction, price, error info
- Message SIDs start with "SM" (e.g., "SM1234567890abcdef1234567890abcdef")
- Useful for checking delivery status of a sent message

EXAMPLES:
- { "sid": "SM1234567890abcdef1234567890abcdef" }`,
        parameters: {
          type: 'object',
          properties: {
            sid: {
              type: 'string',
              description: 'The Message SID (starts with "SM", 34 characters).',
            },
          },
          required: ['sid'],
        },
      },
    },

    describeCall: (args: GetMessageArgs): string => {
      return `Get message ${args.sid}`;
    },

    permission: {
      scope: 'session',
      riskLevel: 'low',
      approvalMessage: `Read a Twilio message via ${connector.displayName}`,
    },

    execute: async (args: GetMessageArgs, context?: ToolContext): Promise<TwilioGetMessageResult> => {
      const effectiveUserId = context?.userId ?? userId;
      const effectiveAccountId = context?.accountId;

      try {
        const raw = await twilioFetch<TwilioRawMessage>(
          connector,
          `/Messages/${args.sid}.json`,
          { method: 'GET', userId: effectiveUserId, accountId: effectiveAccountId }
        );

        return {
          success: true,
          message: formatMessage(raw),
        };
      } catch (error) {
        return {
          success: false,
          error: `Failed to get message: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  };
}
