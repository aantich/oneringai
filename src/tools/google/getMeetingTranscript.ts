/**
 * Google Meet - Get Meeting Transcript Tool
 *
 * Retrieves a meeting transcript from Google Meet.
 * Google Meet transcripts are saved as Google Docs in the meeting organizer's Drive.
 * This tool searches for the transcript doc and extracts its text content.
 */

import type { Connector } from '../../core/Connector.js';
import type { ToolFunction, ToolContext } from '../../domain/entities/Tool.js';
import {
  type GoogleGetTranscriptResult,
  type GoogleDriveFileListResponse,
  getGoogleUserId,
  googleFetch,
  GoogleAPIError,
} from './types.js';

interface GetMeetingTranscriptArgs {
  meetingTitle?: string;
  meetingCode?: string;
  fileId?: string;
  targetUser?: string;
}

/**
 * Create a Google Meet get_meeting_transcript tool
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
        description: `Retrieve a Google Meet meeting transcript.

Google Meet saves transcripts as Google Docs in the organizer's Google Drive. This tool finds the transcript document and returns its text content.

**Finding the transcript:** Provide one of:
- fileId: Direct Google Drive file ID of the transcript document (most reliable)
- meetingCode: The Google Meet code (e.g., "abc-defg-hij") — searches Drive for matching transcript
- meetingTitle: The calendar event title — searches Drive for a transcript file matching this name

The transcript document is typically named like "Meeting transcript - <meeting title> (<date>)".

**Note:** Transcripts must be enabled in Google Workspace admin settings. The transcript doc must be accessible to the authenticated user.`,
        parameters: {
          type: 'object',
          properties: {
            meetingTitle: {
              type: 'string',
              description: 'Calendar event title to search for in transcript filenames.',
            },
            meetingCode: {
              type: 'string',
              description: 'Google Meet code (e.g., "abc-defg-hij"). Searches Drive for matching transcript.',
            },
            fileId: {
              type: 'string',
              description: 'Direct Google Drive file ID of the transcript document (most reliable).',
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
          return {
            success: false,
            error: 'At least one of fileId, meetingTitle, or meetingCode is required.',
          };
        }

        let transcriptFileId = args.fileId;
        let meetingTitle = args.meetingTitle;

        // If no fileId, search Drive for the transcript
        if (!transcriptFileId) {
          // Build search query for transcript files
          // Google Meet transcripts are Google Docs with names like:
          // "Meeting transcript - <title> (<date>)" or containing the meet code
          let searchQuery = "mimeType='application/vnd.google-apps.document'";

          if (args.meetingCode) {
            const code = args.meetingCode.replace(/'/g, '');
            searchQuery += ` and fullText contains '${code}'`;
          } else if (args.meetingTitle) {
            const title = args.meetingTitle.replace(/'/g, '');
            searchQuery += ` and name contains 'transcript' and fullText contains '${title}'`;
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
            return {
              success: false,
              error: args.meetingCode
                ? `No transcript found for meeting code "${args.meetingCode}". Ensure transcription was enabled and the transcript is in your Drive.`
                : `No transcript found for "${args.meetingTitle}". Ensure transcription was enabled and the transcript is in your Drive.`,
            };
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
            return {
              success: false,
              error: 'Transcript file not found. Check that the file ID is correct and you have access.',
            };
          }
          if (error.status === 403 || error.status === 401) {
            return {
              success: false,
              error: 'Access denied. The connector may not have sufficient permissions (drive.readonly or drive scope required).',
            };
          }
        }
        return {
          success: false,
          error: `Failed to get transcript: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  };
}
