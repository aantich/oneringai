/**
 * Microsoft Graph - Get Meeting Transcript Tool
 *
 * Retrieve the transcript from a Teams online meeting.
 * Requires OnlineMeetingTranscript.Read.All permission.
 */

import type { Connector } from '../../core/Connector.js';
import type { ToolFunction, ToolContext } from '../../domain/entities/Tool.js';
import {
  type MicrosoftGetTranscriptResult,
  type GraphTranscriptListResponse,
  getUserPathPrefix,
  microsoftFetch,
  resolveMeetingId,
  formatMicrosoftToolError,
} from './types.js';

export interface GetMeetingTranscriptArgs {
  meetingId: string;
  targetUser?: string;
}

/**
 * Parse VTT content to extract plain text, stripping headers and timestamps.
 */
function parseVttToText(vtt: string): string {
  const lines = vtt.split('\n');
  const textLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    // Skip WEBVTT header, empty lines, cue identifiers, and timestamp lines
    if (
      trimmed === '' ||
      trimmed === 'WEBVTT' ||
      trimmed.startsWith('NOTE') ||
      /^\d+$/.test(trimmed) ||
      /^\d{2}:\d{2}/.test(trimmed)
    ) {
      continue;
    }
    textLines.push(trimmed);
  }

  return textLines.join('\n');
}

/**
 * Create a Microsoft Graph get_meeting_transcript tool
 */
export function createGetMeetingTranscriptTool(
  connector: Connector,
  userId?: string
): ToolFunction<GetMeetingTranscriptArgs, MicrosoftGetTranscriptResult> {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'get_meeting_transcript',
        description: `Retrieve the transcript from a Teams online meeting via Microsoft Graph. Returns plain text with speaker labels (VTT timestamps are stripped).

NOTE: Requires the OnlineMeetingTranscript.Read.All permission. Transcription must have been enabled during the meeting.

USAGE:
- Provide the Teams online meeting ID (NOT the calendar event ID — this is different) or a Teams meeting join URL
- The meetingId can be found in the Teams meeting details or extracted from the join URL

EXAMPLES:
- By meeting ID: { "meetingId": "MSo1N2Y5ZGFjYy03MWJmLTQ3NDMtYjQxMy01M2EdFGkdRWHJlQ" }
- By Teams join URL: { "meetingId": "https://teams.microsoft.com/l/meetup-join/19%3ameeting_MjA5YjFi..." }`,
        parameters: {
          type: 'object',
          properties: {
            meetingId: {
              type: 'string',
              description: 'Teams online meeting ID (e.g. "MSo1N2Y5...") or Teams meeting join URL. This is NOT the calendar event ID.',
            },
            targetUser: {
              type: 'string',
              description: 'User ID or email (UPN) to act on behalf of. Only needed for app-only (client_credentials) auth. Ignored in delegated auth.',
            },
          },
          required: ['meetingId'],
        },
      },
    },

    describeCall: (args: GetMeetingTranscriptArgs): string => {
      return `Get transcript for meeting ${args.meetingId.slice(0, 20)}...`;
    },

    permission: {
      scope: 'session',
      riskLevel: 'low',
      approvalMessage: `Get a meeting transcript via ${connector.displayName}`,
    },

    execute: async (
      args: GetMeetingTranscriptArgs,
      context?: ToolContext
    ): Promise<MicrosoftGetTranscriptResult> => {
      const effectiveUserId = context?.userId ?? userId;
      const effectiveAccountId = context?.accountId;
      try {
        const prefix = getUserPathPrefix(connector, args.targetUser);

        // Resolve meeting ID — handles both raw IDs and Teams join URLs
        const resolved = await resolveMeetingId(connector, args.meetingId, prefix, effectiveUserId, effectiveAccountId);
        const meetingId = resolved.meetingId;

        // Step 1: List transcripts for the meeting
        const transcriptList = await microsoftFetch<GraphTranscriptListResponse>(
          connector,
          `${prefix}/onlineMeetings/${meetingId}/transcripts`,
          { userId: effectiveUserId, accountId: effectiveAccountId }
        );

        if (!transcriptList.value || transcriptList.value.length === 0) {
          return {
            success: false,
            error: 'No transcripts found for this meeting. The meeting may not have had transcription enabled.',
          };
        }

        const transcriptId = transcriptList.value[0]!.id;

        // Step 2: Get transcript content as VTT
        // The content endpoint returns text/vtt, not JSON — use connector.fetch() directly
        const contentUrl = `${prefix}/onlineMeetings/${meetingId}/transcripts/${transcriptId}/content`;
        const response = await connector.fetch(
          contentUrl + '?$format=text/vtt',
          { method: 'GET', headers: { 'Accept': 'text/vtt' } },
          effectiveUserId,
          effectiveAccountId
        );

        if (!response.ok) {
          const errorText = await response.text();
          return {
            success: false,
            error: `Failed to fetch transcript content: ${response.status} ${errorText}`,
          };
        }

        const vttContent = await response.text();
        const transcript = parseVttToText(vttContent);

        return {
          success: true,
          transcript,
          meetingSubject: resolved.subject,
        };
      } catch (error) {
        return {
          success: false,
          error: formatMicrosoftToolError('Failed to get meeting transcript', error),
        };
      }
    },
  };
}
