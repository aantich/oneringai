/**
 * Google Gmail - Create Draft Email Tool
 *
 * Creates a draft email or draft reply in Gmail.
 */

import type { Connector } from '../../core/Connector.js';
import type { ToolFunction, ToolContext } from '../../domain/entities/Tool.js';
import {
  type GoogleDraftEmailResult,
  type GmailDraftResponse,
  type GmailMessageResponse,
  getGoogleUserId,
  googleFetch,
  normalizeEmails,
  buildMimeMessage,
  encodeBase64Url,
  formatGoogleToolError,
} from './types.js';

interface CreateDraftEmailArgs {
  to: string[];
  subject: string;
  body: string;
  cc?: string[];
  replyToMessageId?: string;
  targetUser?: string;
}

/**
 * Create a Google Gmail create_draft_email tool
 */
export function createGoogleDraftEmailTool(
  connector: Connector,
  userId?: string
): ToolFunction<CreateDraftEmailArgs, GoogleDraftEmailResult> {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'create_draft_email',
        description: `Create a draft email in Gmail, optionally as a reply to an existing message.

The draft will be saved to the user's Drafts folder and can be reviewed and sent manually.

**Body format:** HTML is supported. Use <br> for line breaks, <b> for bold, etc.

**Reply drafts:** Set replyToMessageId to the Gmail message ID to create a reply draft. The draft will be threaded with the original message.`,
        parameters: {
          type: 'object',
          properties: {
            to: {
              type: 'array',
              items: { type: 'string' },
              description: 'Recipient email addresses. Example: ["alice@example.com"]',
            },
            subject: {
              type: 'string',
              description: 'Email subject line. For replies, this is typically "Re: <original subject>".',
            },
            body: {
              type: 'string',
              description: 'Email body content. HTML is supported.',
            },
            cc: {
              type: 'array',
              items: { type: 'string' },
              description: 'CC recipient email addresses (optional).',
            },
            replyToMessageId: {
              type: 'string',
              description: 'Gmail message ID to reply to (optional). Creates a threaded reply draft.',
            },
            targetUser: {
              type: 'string',
              description: 'User email for service-account auth. Ignored in delegated auth.',
            },
          },
          required: ['to', 'subject', 'body'],
        },
      },
    },

    describeCall: (args: CreateDraftEmailArgs): string => {
      const to = normalizeEmails(args.to);
      return args.replyToMessageId
        ? `Draft reply to ${to[0]}`
        : `Draft email to ${to.join(', ')}`;
    },

    permission: {
      scope: 'session',
      riskLevel: 'medium',
      approvalMessage: `Create a draft email in Gmail via ${connector.displayName}`,
    },

    execute: async (
      args: CreateDraftEmailArgs,
      context?: ToolContext
    ): Promise<GoogleDraftEmailResult> => {
      const effectiveUserId = context?.userId ?? userId;
      const effectiveAccountId = context?.accountId;

      try {
        const googleUser = getGoogleUserId(connector, args.targetUser);
        const to = normalizeEmails(args.to);
        const cc = args.cc ? normalizeEmails(args.cc) : undefined;
        const baseUrl = 'https://gmail.googleapis.com';

        let threadId: string | undefined;
        let inReplyTo: string | undefined;
        let references: string | undefined;

        // If replying, fetch the original message to get threading headers
        if (args.replyToMessageId) {
          const original = await googleFetch<GmailMessageResponse>(
            connector,
            `/gmail/v1/users/${googleUser}/messages/${args.replyToMessageId}`,
            {
              baseUrl,
              userId: effectiveUserId,
              accountId: effectiveAccountId,
              queryParams: { format: 'metadata', metadataHeaders: 'Message-Id,References' },
            }
          );

          threadId = original.threadId;

          // Extract Message-Id header for In-Reply-To
          const headers = original.payload?.headers ?? [];
          const messageIdHeader = headers.find(h => h.name.toLowerCase() === 'message-id');
          if (messageIdHeader) {
            inReplyTo = messageIdHeader.value;
          }
          const referencesHeader = headers.find(h => h.name.toLowerCase() === 'references');
          if (referencesHeader) {
            references = [referencesHeader.value, inReplyTo].filter(Boolean).join(' ');
          }
        }

        const mimeMessage = buildMimeMessage({
          to,
          subject: args.subject,
          body: args.body,
          cc,
          inReplyTo,
          references,
        });

        const raw = encodeBase64Url(mimeMessage);

        const draftBody: Record<string, unknown> = {
          message: { raw },
        };
        // Gmail API: threadId must be at the top level of the draft body, not inside message
        if (threadId) {
          draftBody.threadId = threadId;
        }

        const draft = await googleFetch<GmailDraftResponse>(
          connector,
          `/gmail/v1/users/${googleUser}/drafts`,
          {
            baseUrl,
            method: 'POST',
            body: draftBody,
            userId: effectiveUserId,
            accountId: effectiveAccountId,
          }
        );

        return {
          success: true,
          draftId: draft.id,
          messageId: draft.message?.id,
          threadId: draft.message?.threadId,
        };
      } catch (error) {
        return {
          success: false,
          error: formatGoogleToolError('Failed to create draft email', error),
        };
      }
    },
  };
}
