/**
 * Zoom - Update Meeting Tool
 *
 * Update an existing Zoom meeting's settings.
 * Uses PATCH /meetings/{meetingId}
 * Accepts meeting URL or numeric ID.
 */

import type { Connector } from '../../core/Connector.js';
import type { ToolFunction, ToolContext } from '../../domain/entities/Tool.js';
import { type ZoomUpdateMeetingResult, zoomFetch, parseMeetingId, formatZoomToolError } from './types.js';

export interface UpdateMeetingArgs {
  /** Meeting URL (e.g., https://zoom.us/j/123...) or numeric meeting ID */
  meeting: string;
  /** New topic/title */
  topic?: string;
  /** New start time in ISO 8601 format */
  startTime?: string;
  /** New duration in minutes */
  duration?: number;
  /** New timezone */
  timezone?: string;
  /** New agenda/description */
  agenda?: string;
  /** New password */
  password?: string;
  /** Enable/disable waiting room */
  waitingRoom?: boolean;
  /** Enable/disable join before host */
  joinBeforeHost?: boolean;
}

export function createUpdateMeetingTool(
  connector: Connector,
  userId?: string
): ToolFunction<UpdateMeetingArgs, ZoomUpdateMeetingResult> {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'zoom_update_meeting',
        description: `Update an existing Zoom meeting.

USAGE:
- Accepts a meeting URL (https://zoom.us/j/...) or numeric meeting ID
- Only provide the fields you want to change
- Returns success/failure

EXAMPLES:
- Reschedule: { "meeting": "https://zoom.us/j/123456", "startTime": "2026-04-16T15:00:00Z" }
- Change topic: { "meeting": "123456789", "topic": "Updated standup" }
- Update settings: { "meeting": "https://zoom.us/j/123456", "waitingRoom": true, "duration": 45 }`,
        parameters: {
          type: 'object',
          properties: {
            meeting: {
              type: 'string',
              description: 'Meeting URL (https://zoom.us/j/...) or numeric meeting ID.',
            },
            topic: {
              type: 'string',
              description: 'New meeting topic/title.',
            },
            startTime: {
              type: 'string',
              description: 'New start time in ISO 8601 format.',
            },
            duration: {
              type: 'number',
              description: 'New duration in minutes.',
            },
            timezone: {
              type: 'string',
              description: 'New timezone.',
            },
            agenda: {
              type: 'string',
              description: 'New agenda/description.',
            },
            password: {
              type: 'string',
              description: 'New meeting password.',
            },
            waitingRoom: {
              type: 'boolean',
              description: 'Enable/disable waiting room.',
            },
            joinBeforeHost: {
              type: 'boolean',
              description: 'Allow/disallow join before host.',
            },
          },
          required: ['meeting'],
        },
      },
    },

    describeCall: (args: UpdateMeetingArgs): string => {
      const fields = [];
      if (args.topic) fields.push('topic');
      if (args.startTime) fields.push('time');
      if (args.duration) fields.push('duration');
      return `update meeting ${args.meeting}${fields.length ? ` (${fields.join(', ')})` : ''}`;
    },

    permission: {
      scope: 'once',
      riskLevel: 'medium',
      approvalMessage: `Update Zoom meeting via ${connector.displayName}`,
    },

    execute: async (args: UpdateMeetingArgs, context?: ToolContext): Promise<ZoomUpdateMeetingResult> => {
      const effectiveUserId = context?.userId ?? userId;
      const effectiveAccountId = context?.accountId;

      try {
        const meetingId = parseMeetingId(args.meeting);

        const body: Record<string, unknown> = {};
        if (args.topic !== undefined) body.topic = args.topic;
        if (args.startTime !== undefined) body.start_time = args.startTime;
        if (args.duration !== undefined) body.duration = args.duration;
        if (args.timezone !== undefined) body.timezone = args.timezone;
        if (args.agenda !== undefined) body.agenda = args.agenda;
        if (args.password !== undefined) body.password = args.password;

        const settings: Record<string, unknown> = {};
        if (args.waitingRoom !== undefined) settings.waiting_room = args.waitingRoom;
        if (args.joinBeforeHost !== undefined) settings.join_before_host = args.joinBeforeHost;
        if (Object.keys(settings).length > 0) body.settings = settings;

        // PATCH returns 204 No Content on success
        await zoomFetch(connector, `/meetings/${encodeURIComponent(meetingId)}`, {
          method: 'PATCH',
          body,
          userId: effectiveUserId,
          accountId: effectiveAccountId,
        });

        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: formatZoomToolError('Failed to update meeting', error),
        };
      }
    },
  };
}
