import { connectorFailure } from '../connector/enhancedInvocation.js';
/**
 * Google Meet - Get Meeting Transcript Tool
 *
 * Retrieves a meeting transcript or AI-generated meeting notes from Google Meet.
 * Google Meet saves two distinct artifact types as Google Docs in the organizer's Drive:
 *   1. Classic Meet transcripts — `<Meeting Name> (YYYY-MM-DD at HH:MM TZ) - Transcript`
 *      in folder "Meet Recordings" (when transcription is enabled in Workspace admin).
 *   2. Gemini "Take notes for me" output — `<Meeting Name> - YYYY/MM/DD HH:MM TZ - Notes by Gemini`
 *      in folder "Meet Notes" (when Gemini note-taking is enabled).
 *
 * This tool searches for either artifact via the Drive API and returns its text content.
 * Drive's `name contains` operator is case-insensitive, so suffix casing is irrelevant.
 */

import type { Connector } from '../../core/Connector.js';
import type { ToolFunction, ToolContext } from '../../domain/entities/Tool.js';
import {
  type GoogleGetTranscriptResult,
  type GoogleDriveFileListResponse,
  getGoogleUserId,
  googleFetch,
  GoogleAPIError,
  formatGoogleToolError,
} from './types.js';

interface GetMeetingTranscriptArgs {
  meetingTitle?: string;
  meetingCode?: string;
  fileId?: string;
  /** ISO date string. Restricts search to files modified on/after this date. */
  since?: string;
  /**
   * ISO date string. Restricts search to files modified strictly BEFORE this
   * date. Combined with `since`, gives a precise time window — needed for
   * per-occurrence attribution in recurring meetings (the same series produces
   * one transcript per occurrence, all sharing the meeting title).
   */
  before?: string;
  targetUser?: string;
}

/**
 * Create a Google Meet get_meeting_transcript tool
 *
 * NOTE on `actAs` lock — this tool does NOT participate. Transcript files are
 * fetched via `/drive/v3/files`, not user-scoped at the URL level. Data scope
 * is whatever the underlying token can see.
 */
export function createGoogleGetMeetingTranscriptTool(
  connector: Connector,
  userId?: string
): ToolFunction<GetMeetingTranscriptArgs, GoogleGetTranscriptResult> {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'get_meeting_transcript',
        description: `Retrieve a Google Meet meeting transcript or AI-generated meeting notes.

Google Meet saves two artifact types as Google Docs in the organizer's Drive:
- **Classic transcripts**: "<Meeting Name> (YYYY-MM-DD at HH:MM TZ) - Transcript" (folder "Meet Recordings")
- **Gemini notes** ("Take notes for me"): "<Meeting Name> - YYYY/MM/DD HH:MM TZ - Notes by Gemini" (folder "Meet Notes")

This tool searches for either and returns its text content.

**Finding the file:** Provide one of:
- fileId: Direct Google Drive file ID (most reliable)
- meetingCode: Google Meet code (e.g., "abc-defg-hij") — searches Drive for matching artifact
- meetingTitle: Calendar event title — searches Drive for an artifact matching this name

Optional: \`since\` (ISO date) restricts to files modified on/after that date. Combine with \`before\` (ISO date, exclusive) to pin a precise window — needed for per-occurrence attribution in recurring meetings.

**Note:** Transcription and/or Gemini notes must be enabled in Workspace admin settings. The file must be accessible to the authenticated user.`,
        parameters: {
          type: 'object',
          properties: {
            meetingTitle: {
              type: 'string',
              description: 'Calendar event title to match against the artifact filename.',
            },
            meetingCode: {
              type: 'string',
              description: 'Google Meet code (e.g., "abc-defg-hij"). Searches Drive for matching artifact.',
            },
            fileId: {
              type: 'string',
              description: 'Direct Google Drive file ID of the transcript or notes document (most reliable).',
            },
            since: {
              type: 'string',
              description: 'ISO date (e.g., "2026-05-27"). Restricts search to files modified on/after this date.',
            },
            before: {
              type: 'string',
              description: 'ISO date (e.g., "2026-05-28"). Restricts search to files modified strictly before this date. Combine with `since` to pin a precise window for recurring meetings.',
            },
            targetUser: {
              type: 'string',
              description: 'User email for service-account auth. Ignored in delegated auth.',
            },
          },
        },
      },
    },

    describeCall: (args: GetMeetingTranscriptArgs): string => {
      if (args.fileId) return `Get transcript: ${args.fileId}`;
      if (args.meetingCode) return `Get transcript for meeting: ${args.meetingCode}`;
      return `Get transcript: ${args.meetingTitle ?? 'search'}`;
    },

    permission: {
      scope: 'session',
      riskLevel: 'low',
      approvalMessage: `Get meeting transcript via ${connector.displayName}`,
    },

    execute: async (
      args: GetMeetingTranscriptArgs,
      context?: ToolContext
    ): Promise<GoogleGetTranscriptResult> => {
      const effectiveUserId = context?.userId ?? userId;
      const effectiveAccountId = context?.accountId;

      try {
        // Validate service-account auth if applicable
        getGoogleUserId(connector, args.targetUser);

        if (!args.fileId && !args.meetingTitle && !args.meetingCode) {
          return connectorFailure(connector, {
            success: false,
            error: 'At least one of fileId, meetingTitle, or meetingCode is required.',
          });
        }

        let transcriptFileId = args.fileId;
        let meetingTitle = args.meetingTitle;

        // If no fileId, search Drive for the transcript or Gemini notes.
        // Meet artifact filename conventions (verified May 2026):
        //   - Classic transcript: "<title> (YYYY-MM-DD at HH:MM TZ) - Transcript"
        //   - Gemini "Take notes for me": "<title> - YYYY/MM/DD HH:MM TZ - Notes by Gemini"
        // `name contains` is case-insensitive in Drive's q syntax.
        if (!transcriptFileId) {
          const artifactNamePatterns = [
            "name contains 'Transcript'",
            "name contains 'Notes by Gemini'",
          ].join(' or ');

          let searchQuery = `mimeType='application/vnd.google-apps.document' and (${artifactNamePatterns})`;

          if (args.meetingCode) {
            const code = args.meetingCode.replace(/'/g, '');
            // Code may appear in name (rare) or body (common — Meet link is embedded).
            searchQuery += ` and (fullText contains '${code}' or name contains '${code}')`;
          } else if (args.meetingTitle) {
            const title = args.meetingTitle.replace(/'/g, '');
            // Gemini puts the title in the filename; classic transcripts also do.
            // Fall back to fullText so legacy/edge cases still resolve.
            searchQuery += ` and (name contains '${title}' or fullText contains '${title}')`;
          }

          if (args.since) {
            const since = args.since.replace(/'/g, '');
            searchQuery += ` and modifiedTime > '${since}'`;
          }
          if (args.before) {
            const before = args.before.replace(/'/g, '');
            searchQuery += ` and modifiedTime < '${before}'`;
          }

          searchQuery += ' and trashed = false';

          const searchResult = await googleFetch<GoogleDriveFileListResponse>(
            connector,
            `/drive/v3/files`,
            {
              userId: effectiveUserId,
              accountId: effectiveAccountId,
              queryParams: {
                q: searchQuery,
                fields: 'files(id,name,modifiedTime)',
                orderBy: 'modifiedTime desc',
                pageSize: 5,
              },
            }
          );

          if (!searchResult.files || searchResult.files.length === 0) {
            const subject = args.meetingCode
              ? `meeting code "${args.meetingCode}"`
              : `"${args.meetingTitle}"`;
            return connectorFailure(connector, {
              success: false,
              error: `No transcript or Gemini notes found for ${subject}. Ensure either Meet transcription or "Take notes for me" was enabled, and the resulting Doc lives in the authenticated user's Drive (folder "Meet Recordings" or "Meet Notes").`,
            });
          }

          // Use the most recent matching file
          transcriptFileId = searchResult.files[0]!.id;
          meetingTitle = meetingTitle ?? searchResult.files[0]!.name;
        }

        // Export the Google Doc as plain text
        const transcriptText = await googleFetch<string>(
          connector,
          `/drive/v3/files/${transcriptFileId}/export`,
          {
            userId: effectiveUserId,
            accountId: effectiveAccountId,
            queryParams: { mimeType: 'text/plain' },
            accept: 'text/plain',
          }
        );

        if (!transcriptText || (typeof transcriptText === 'string' && transcriptText.trim().length === 0)) {
          return {
            success: true,
            isEmpty: true,
            transcript: '*(empty transcript — no content found)*',
            meetingTitle,
          };
        }

        return {
          success: true,
          transcript: typeof transcriptText === 'string' ? transcriptText : String(transcriptText),
          meetingTitle,
        };
      } catch (error) {
        if (error instanceof GoogleAPIError) {
          if (error.status === 404) {
            return connectorFailure(connector, {
              success: false,
              error: 'Transcript file not found. Check that the file ID is correct and you have access.',
            });
          }
          if (error.status === 403 || error.status === 401) {
            return connectorFailure(connector, {
              success: false,
              error: 'Access denied. The connector may not have sufficient permissions (drive.readonly or drive scope required).',
            });
          }
        }
        return connectorFailure(connector, {
          success: false,
          error: formatGoogleToolError('Failed to get transcript', error),
        });
      }
    },
  };
}
