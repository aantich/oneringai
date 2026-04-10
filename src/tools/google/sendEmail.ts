/**
 * Google Gmail - Send Email Tool
 *
 * Sends an email immediately or replies to an existing message via Gmail API.
 */

import type { Connector } from '../../core/Connector.js';
import type { ToolFunction, ToolContext } from '../../domain/entities/Tool.js';
import {
  type GoogleSendEmailResult,
  type GmailMessageResponse,
  getGoogleUserId,
  googleFetch,
  normalizeEmails,
  buildMimeMessage,
  encodeBase64Url,
} from './types.js';

interface SendEmailArgs {
  to: string[];
  subject: string;
  body: string;
  cc?: string[];
  replyToMessageId?: string;
  replyAll?: boolean;
  targetUser?: string;
}

/**
 * Create a Google Gmail send_email tool
 */
export function createGoogleSendEmailTool(
  connector: Connector,
  userId?: string
): ToolFunction<SendEmailArgs, GoogleSendEmailResult> {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'send_email',
        description: `Send an email immediately via Gmail, optionally as a reply to an existing message.

**Body format:** HTML is supported. Use <br> for line breaks, <b> for bold, etc.

**Replying:** Set replyToMessageId to a Gmail message ID to send a reply. Set replyAll to true to reply to all recipients of the original message. When replying, the 'to' field is still used (you can set it to the sender of the original message, or to different recipients).

**Threading:** When replyToMessageId is set, the sent message is automatically threaded with the original conversation.`,
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
              description: 'Email subject line. For replies, typically "Re: <original subject>".',
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
              description: 'Gmail message ID to reply to (optional). Threads the reply with the original.',
            },
            replyAll: {
              type: 'boolean',
              description: 'If true and replyToMessageId is set, includes all original recipients in CC. Default: false.',
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

    describeCall: (args: SendEmailArgs): string => {
      const to = normalizeEmails(args.to);
      return args.replyToMessageId
        ? `Reply${args.replyAll ? ' all' : ''} to ${to[0]}`
        : `Send email to ${to.join(', ')}`;
    },

    permission: {
      scope: 'session',
      riskLevel: 'medium',
      approvalMessage: `Send an email via Gmail using ${connector.displayName}`,
    },

    execute: async (
      args: SendEmailArgs,
      context?: ToolContext
    ): Promise<GoogleSendEmailResult> => {
      const effectiveUserId = context?.userId ?? userId;
      const effectiveAccountId = context?.accountId;

      try {
        const googleUser = getGoogleUserId(connector, args.targetUser);
        const to = normalizeEmails(args.to);
        let cc = args.cc ? normalizeEmails(args.cc) : undefined;
        const baseUrl = 'https://gmail.googleapis.com';

        let threadId: string | undefined;
        let inReplyTo: string | undefined;
        let references: string | undefined;

        // If replying, fetch the original message for threading
        if (args.replyToMessageId) {
          const original = await googleFetch<GmailMessageResponse>(
            connector,
            `/gmail/v1/users/${googleUser}/messages/${args.replyToMessageId}`,
            {
              baseUrl,
              userId: effectiveUserId,
              accountId: effectiveAccountId,
              queryParams: { format: 'metadata', metadataHeaders: 'Message-Id,References,From,To,Cc' },
            }
          );

          threadId = original.threadId;

          const headers = original.payload?.headers ?? [];
          const messageIdHeader = headers.find(h => h.name.toLowerCase() === 'message-id');
          if (messageIdHeader) {
            inReplyTo = messageIdHeader.value;
          }
          const referencesHeader = headers.find(h => h.name.toLowerCase() === 'references');
          if (referencesHeader) {
            references = [referencesHeader.value, inReplyTo].filter(Boolean).join(' ');
          }

          // For replyAll, collect original recipients into CC
          if (args.replyAll) {
            const originalTo = headers.find(h => h.name.toLowerCase() === 'to')?.value ?? '';
            const originalCc = headers.find(h => h.name.toLowerCase() === 'cc')?.value ?? '';
            const allRecipients = [originalTo, originalCc]
              .filter(Boolean)
              .join(',')
              .split(',')
              .map(e => e.trim())
              .filter(e => e.length > 0);

            // Merge with explicit CC, avoiding duplicates and current recipients
            const toSet = new Set(to.map(e => e.toLowerCase()));
            const ccSet = new Set((cc ?? []).map(e => e.toLowerCase()));
            for (const email of allRecipients) {
              // Extract just the email address from "Name <email>" format
              const match = email.match(/<([^>]+)>/);
              const addr = match ? match[1]! : email;
              const lower = addr.toLowerCase();
              if (!toSet.has(lower) && !ccSet.has(lower)) {
                cc = cc ?? [];
                cc.push(addr);
                ccSet.add(lower);
              }
            }
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

        const sendBody: Record<string, unknown> = { raw };
        if (threadId) {
          sendBody.threadId = threadId;
        }

        const result = await googleFetch<GmailMessageResponse>(
          connector,
          `/gmail/v1/users/${googleUser}/messages/send`,
          {
            baseUrl,
            method: 'POST',
            body: sendBody,
            userId: effectiveUserId,
            accountId: effectiveAccountId,
          }
        );

        return {
          success: true,
          messageId: result.id,
          threadId: result.threadId,
        };
      } catch (error) {
        return {
          success: false,
          error: `Failed to send email: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  };
}
