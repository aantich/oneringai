/**
 * Zoom - Get Meeting Transcript Tool
 *
 * Fetches the cloud recording transcript for a meeting.
 * Accepts a meeting URL or numeric ID, finds the TRANSCRIPT file,
 * downloads the VTT, and parses it into structured speaker-attributed text.
 *
 * Flow:
 * 1. Parse meeting ID from URL/string
 * 2. GET /meetings/{id}/recordings → find file_type "TRANSCRIPT"
 * 3. Download VTT via download_url
 * 4. Parse VTT → structured entries with speaker, timestamp, text
 */

import type { Connector } from '../../core/Connector.js';
import type { ToolFunction, ToolContext } from '../../domain/entities/Tool.js';
import {
  type ZoomGetTranscriptResult,
  type ZoomRecordingsResponse,
  zoomFetch,
  parseMeetingId,
  parseVTT,
  formatZoomToolError,
} from './types.js';

export interface GetTranscriptArgs {
  /** Meeting URL (e.g., https://zoom.us/j/123...) or numeric meeting ID */
  meeting: string;
}

export function createGetTranscriptTool(
  connector: Connector,
  userId?: string
): ToolFunction<GetTranscriptArgs, ZoomGetTranscriptResult> {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'zoom_get_transcript',
        description: `Get the full transcript of a Zoom meeting from its cloud recording.

USAGE:
- Accepts a meeting URL (https://zoom.us/j/...) or numeric meeting ID
- Downloads and parses the VTT transcript from cloud recordings
- Returns structured entries with speaker names, timestamps, and text
- Also returns fullText with formatted speaker-attributed transcript
- Requires cloud recording with audio transcript enabled on the meeting

EXAMPLES:
- From URL: { "meeting": "https://zoom.us/j/12345678901" }
- From ID: { "meeting": "12345678901" }`,
        parameters: {
          type: 'object',
          properties: {
            meeting: {
              type: 'string',
              description: 'Meeting URL (https://zoom.us/j/...) or numeric meeting ID.',
            },
          },
          required: ['meeting'],
        },
      },
    },

    describeCall: (args: GetTranscriptArgs): string => {
      return `transcript for ${args.meeting}`;
    },

    permission: {
      scope: 'session',
      riskLevel: 'low',
      approvalMessage: `Get Zoom meeting transcript via ${connector.displayName}`,
    },

    execute: async (args: GetTranscriptArgs, context?: ToolContext): Promise<ZoomGetTranscriptResult> => {
      const effectiveUserId = context?.userId ?? userId;
      const effectiveAccountId = context?.accountId;

      try {
        const meetingId = parseMeetingId(args.meeting);

        // Step 1: Get recordings for this meeting
        const recordings = await zoomFetch<ZoomRecordingsResponse>(connector, `/meetings/${encodeURIComponent(meetingId)}/recordings`, {
          userId: effectiveUserId,
          accountId: effectiveAccountId,
        });

        // Step 2: Find the TRANSCRIPT file
        const transcriptFile = recordings.recording_files?.find(
          (f) => f.file_type === 'TRANSCRIPT'
        );

        if (!transcriptFile) {
          return {
            success: false,
            meetingId,
            meetingTopic: recordings.topic,
            error: 'No transcript found for this meeting. Ensure cloud recording with audio transcript is enabled.',
          };
        }

        // Step 3: Download the VTT file
        // Zoom download URLs require the access token as a query param
        const downloadUrl = transcriptFile.download_url;
        const response = await connector.fetch(
          downloadUrl,
          { method: 'GET' },
          effectiveUserId,
          effectiveAccountId
        );

        if (!response.ok) {
          throw new Error(`Failed to download transcript: HTTP ${response.status}`);
        }

        const vttContent = await response.text();

        // Step 4: Parse VTT into structured entries
        const entries = parseVTT(vttContent);

        // Step 5: Build full text with speaker labels
        const fullText = entries
          .map((e) => `[${e.startTime}] ${e.speaker}: ${e.text}`)
          .join('\n');

        return {
          success: true,
          meetingId,
          meetingTopic: recordings.topic,
          transcript: entries,
          fullText,
          entryCount: entries.length,
        };
      } catch (error) {
        return {
          success: false,
          error: formatZoomToolError('Failed to get transcript', error),
        };
      }
    },
  };
}
