/**
 * Microsoft Graph - Send Email Tool
 *
 * Send an email or reply to an existing message.
 */

import type { Connector } from '../../core/Connector.js';
import type { ToolFunction, ToolContext } from '../../domain/entities/Tool.js';
import {
  type MicrosoftSendEmailResult,
  getUserPathPrefix,
  microsoftFetch,
  formatRecipients,
  formatMicrosoftToolError,
} from './types.js';

export interface SendEmailArgs {
  to: string[];
  subject: string;
  body: string;
  cc?: string[];
  replyToMessageId?: string;
  replyAll?: boolean;
  targetUser?: string;
}

/**
 * Create a Microsoft Graph send_email tool
 */
export function createSendEmailTool(
  connector: Connector,
  userId?: string
): ToolFunction<SendEmailArgs, MicrosoftSendEmailResult> {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'send_email',
        description: `Send an email immediately or reply to an existing message via Microsoft Graph (Outlook). The email is sent right away — use create_draft_email to save a draft instead.

PARAMETER FORMATS:
- to/cc: plain string array of email addresses. Example: ["alice@contoso.com", "bob@contoso.com"]. Do NOT use objects.
- subject: plain string. Example: "Meeting tomorrow" or "Re: Meeting tomorrow" for replies.
- body: HTML string for both new emails and replies. Example: "<p>Hi Alice,</p><p>Can we meet at 2pm?</p>". Use <p>, <br>, <b>, <ul> tags. For replies, your HTML is prepended above the automatically-quoted original message.
- replyToMessageId: Graph message ID string (starts with "AAMk..."). Only set when replying to an existing email.
- replyAll: boolean. Only used together with replyToMessageId. When true, replies to ALL recipients (To + CC) of the original message. When false or omitted, replies only to the sender. Default: false.

REPLY BEHAVIOR:
- replyAll: false (default) → replies ONLY to the original sender. The "to" field overrides who receives the reply.
- replyAll: true → replies to the sender AND all To/CC recipients of the original message. The "to" field can add additional recipients.
- replyAll is IGNORED if replyToMessageId is not set.

EXAMPLES:
- Send new email: { "to": ["alice@contoso.com"], "subject": "Meeting tomorrow", "body": "<p>Can we meet at 2pm?</p>" }
- Reply to sender only: { "to": ["alice@contoso.com"], "subject": "Re: Meeting", "body": "<p>Confirmed!</p>", "replyToMessageId": "AAMkADI1..." }
- Reply all: { "to": ["alice@contoso.com"], "subject": "Re: Meeting", "body": "<p>Sounds good, see you then.</p>", "replyToMessageId": "AAMkADI1...", "replyAll": true }
- With CC: { "to": ["alice@contoso.com"], "subject": "Update", "body": "<p>FYI</p>", "cc": ["bob@contoso.com"] }`,
        parameters: {
          type: 'object',
          properties: {
            to: {
              type: 'array',
              items: { type: 'string' },
              description: 'Recipient email addresses as plain strings. Example: ["alice@contoso.com", "bob@contoso.com"]',
            },
            subject: {
              type: 'string',
              description: 'Email subject as plain string. Example: "Meeting tomorrow" or "Re: Original subject" for replies.',
            },
            body: {
              type: 'string',
              description: 'Email body as HTML string (e.g. "<p>Hi!</p>"). For replies, your HTML is prepended above the quoted original message.',
            },
            cc: {
              type: 'array',
              items: { type: 'string' },
              description: 'CC email addresses as plain strings. Example: ["bob@contoso.com"]. Optional.',
            },
            replyToMessageId: {
              type: 'string',
              description: 'Graph message ID of the email to reply to. Example: "AAMkADI1M2I3YzgtODg...". When set, sends a threaded reply.',
            },
            replyAll: {
              type: 'boolean',
              description: 'When true AND replyToMessageId is set, replies to ALL original recipients (To + CC), not just the sender. Default: false. Ignored if replyToMessageId is not set.',
            },
            targetUser: {
              type: 'string',
              description: 'User ID or email (UPN) for app-only auth. Example: "alice@contoso.com". Ignored in delegated auth.',
            },
          },
          required: ['to', 'subject', 'body'],
        },
      },
    },

    describeCall: (args: SendEmailArgs): string => {
      const action = args.replyToMessageId ? (args.replyAll ? 'Reply all' : 'Reply') : 'Send';
      return `${action} to ${args.to.join(', ')}: ${args.subject}`;
    },

    permission: {
      scope: 'session',
      riskLevel: 'medium',
      approvalMessage: `Send an email via ${connector.displayName}`,
    },

    execute: async (
      args: SendEmailArgs,
      context?: ToolContext
    ): Promise<MicrosoftSendEmailResult> => {
      const effectiveUserId = context?.userId ?? userId;
      const effectiveAccountId = context?.accountId;
      try {
        const prefix = getUserPathPrefix(connector, args.targetUser);

        if (args.replyToMessageId) {
          // 3-step reply flow for rich HTML with quoted original:
          // 1. createReply/createReplyAll → draft with quoted original in body
          // 2. PATCH → prepend our HTML above the quoted original
          // 3. send → send the draft

          // Step 1: Create reply draft (includes quoted original in body.content)
          const createEndpoint = args.replyAll ? 'createReplyAll' : 'createReply';
          const replyDraft = await microsoftFetch<{ id: string; body?: { content?: string } }>(
            connector,
            `${prefix}/messages/${args.replyToMessageId}/${createEndpoint}`,
            { method: 'POST', userId: effectiveUserId, accountId: effectiveAccountId, body: {} }
          );

          // Step 2: Prepend our HTML body above the quoted original
          const quotedOriginal = replyDraft.body?.content ?? '';
          const combinedBody = `${args.body}<br/>${quotedOriginal}`;

          await microsoftFetch(
            connector,
            `${prefix}/messages/${replyDraft.id}`,
            {
              method: 'PATCH',
              userId: effectiveUserId,
              accountId: effectiveAccountId,
              body: {
                body: { contentType: 'HTML', content: combinedBody },
                toRecipients: formatRecipients(args.to),
                ...(args.cc && { ccRecipients: formatRecipients(args.cc) }),
              },
            }
          );

          // Step 3: Send the draft
          await microsoftFetch(
            connector,
            `${prefix}/messages/${replyDraft.id}/send`,
            { method: 'POST', userId: effectiveUserId, accountId: effectiveAccountId }
          );
        } else {
          // Send new email (returns 202 with empty body)
          await microsoftFetch(
            connector,
            `${prefix}/sendMail`,
            {
              method: 'POST',
              userId: effectiveUserId,
              accountId: effectiveAccountId,
              body: {
                message: {
                  subject: args.subject,
                  body: { contentType: 'HTML', content: args.body },
                  toRecipients: formatRecipients(args.to),
                  ...(args.cc && { ccRecipients: formatRecipients(args.cc) }),
                },
                saveToSentItems: true,
              },
            }
          );
        }

        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: formatMicrosoftToolError('Failed to send email', error),
        };
      }
    },
  };
}
