/**
 * Microsoft Graph - Create Draft Email Tool
 *
 * Create a draft email or draft reply in the user's mailbox.
 */

import type { Connector } from '../../core/Connector.js';
import type { ToolFunction, ToolContext } from '../../domain/entities/Tool.js';
import {
  type MicrosoftDraftEmailResult,
  type GraphMessageResponse,
  getUserPathPrefix,
  microsoftFetch,
  formatRecipients,
  formatMicrosoftToolError,
} from './types.js';

export interface CreateDraftEmailArgs {
  to: string[];
  subject: string;
  body: string;
  cc?: string[];
  replyToMessageId?: string;
  targetUser?: string;
}

/**
 * Create a Microsoft Graph create_draft_email tool
 */
export function createDraftEmailTool(
  connector: Connector,
  userId?: string
): ToolFunction<CreateDraftEmailArgs, MicrosoftDraftEmailResult> {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'create_draft_email',
        description: `Create a draft email or draft reply in the user's Outlook mailbox via Microsoft Graph. The draft is saved but NOT sent — use send_email to send immediately instead.

PARAMETER FORMATS:
- to/cc: plain string array of email addresses. Example: ["alice@contoso.com", "bob@contoso.com"]. Do NOT use objects.
- subject: plain string. Example: "Project update" or "Re: Project update" for replies.
- body: HTML string. Example: "<p>Hi Alice,</p><p>Here is the update.</p>". Use <p>, <br>, <b>, <ul> tags for formatting.
- replyToMessageId: Graph message ID string (starts with "AAMk..."). Only set when replying to an existing email.

EXAMPLES:
- New draft: { "to": ["alice@contoso.com"], "subject": "Project update", "body": "<p>Hi Alice,</p><p>Here is the update.</p>" }
- Reply draft: { "to": ["alice@contoso.com"], "subject": "Re: Project update", "body": "<p>Thanks!</p>", "replyToMessageId": "AAMkADI1..." }
- With CC: { "to": ["alice@contoso.com"], "subject": "Notes", "body": "<p>See attached.</p>", "cc": ["bob@contoso.com"] }`,
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
              description: 'Email subject as plain string. Example: "Project update" or "Re: Original subject" for replies.',
            },
            body: {
              type: 'string',
              description: 'Email body as an HTML string. Example: "<p>Hello!</p><p>See you tomorrow.</p>"',
            },
            cc: {
              type: 'array',
              items: { type: 'string' },
              description: 'CC email addresses as plain strings. Example: ["bob@contoso.com"]. Optional.',
            },
            replyToMessageId: {
              type: 'string',
              description: 'Graph message ID of the email to reply to. Example: "AAMkADI1M2I3YzgtODg...". When set, creates a threaded reply draft.',
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

    describeCall: (args: CreateDraftEmailArgs): string => {
      const action = args.replyToMessageId ? 'Reply draft' : 'Draft';
      return `${action} to ${args.to.join(', ')}: ${args.subject}`;
    },

    permission: {
      scope: 'session',
      riskLevel: 'medium',
      approvalMessage: `Create a draft email via ${connector.displayName}`,
    },

    execute: async (
      args: CreateDraftEmailArgs,
      context?: ToolContext
    ): Promise<MicrosoftDraftEmailResult> => {
      const effectiveUserId = context?.userId ?? userId;
      const effectiveAccountId = context?.accountId;
      try {
        const prefix = getUserPathPrefix(connector, args.targetUser);

        if (args.replyToMessageId) {
          // Reply draft: createReply → then PATCH to prepend our HTML above quoted original
          const replyDraft = await microsoftFetch<GraphMessageResponse & { body?: { content?: string } }>(
            connector,
            `${prefix}/messages/${args.replyToMessageId}/createReply`,
            { method: 'POST', userId: effectiveUserId, accountId: effectiveAccountId, body: {} }
          );

          // Prepend our HTML body above the quoted original
          const quotedOriginal = replyDraft.body?.content ?? '';
          const combinedBody = `${args.body}<br/>${quotedOriginal}`;

          const updated = await microsoftFetch<GraphMessageResponse>(
            connector,
            `${prefix}/messages/${replyDraft.id}`,
            {
              method: 'PATCH',
              userId: effectiveUserId,
              accountId: effectiveAccountId,
              body: {
                subject: args.subject,
                body: { contentType: 'HTML', content: combinedBody },
                toRecipients: formatRecipients(args.to),
                ...(args.cc && { ccRecipients: formatRecipients(args.cc) }),
              },
            }
          );

          return {
            success: true,
            draftId: updated.id,
            webLink: updated.webLink,
          };
        }

        // New draft
        const draft = await microsoftFetch<GraphMessageResponse>(
          connector,
          `${prefix}/messages`,
          {
            method: 'POST',
            userId: effectiveUserId,
            accountId: effectiveAccountId,
            body: {
              isDraft: true,
              subject: args.subject,
              body: { contentType: 'HTML', content: args.body },
              toRecipients: formatRecipients(args.to),
              ...(args.cc && { ccRecipients: formatRecipients(args.cc) }),
            },
          }
        );

        return {
          success: true,
          draftId: draft.id,
          webLink: draft.webLink,
        };
      } catch (error) {
        return {
          success: false,
          error: formatMicrosoftToolError('Failed to create draft email', error),
        };
      }
    },
  };
}
