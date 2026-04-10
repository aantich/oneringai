/**
 * Zoom - Create Meeting Tool
 *
 * Create a new Zoom meeting (instant or scheduled).
 * Uses POST /users/{userId}/meetings
 */

import type { Connector } from '../../core/Connector.js';
import type { ToolFunction, ToolContext } from '../../domain/entities/Tool.js';
import { type ZoomCreateMeetingResult, type ZoomMeetingResponse, zoomFetch, formatZoomToolError } from './types.js';

export interface CreateMeetingArgs {
  /** Meeting topic/title */
  topic: string;
  /** Meeting type: "instant" or "scheduled" (default: "scheduled") */
  type?: string;
  /** Start time in ISO 8601 format (required for scheduled meetings) */
  startTime?: string;
  /** Duration in minutes (default: 60) */
  duration?: number;
  /** Timezone (e.g., "America/New_York"). Defaults to the host's timezone. */
  timezone?: string;
  /** Meeting agenda/description */
  agenda?: string;
  /** Meeting password (auto-generated if not provided) */
  password?: string;
  /** Enable waiting room (default: false) */
  waitingRoom?: boolean;
  /** Enable join before host (default: false) */
  joinBeforeHost?: boolean;
  /** Zoom user ID or email to create meeting for (default: "me") */
  hostUserId?: string;
}

export function createCreateMeetingTool(
  connector: Connector,
  userId?: string
): ToolFunction<CreateMeetingArgs, ZoomCreateMeetingResult> {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'zoom_create_meeting',
        description: `Create a new Zoom meeting.

USAGE:
- Create instant or scheduled meetings
- Returns join URL, start URL, meeting ID, and password
- For scheduled meetings, provide startTime in ISO 8601 format

EXAMPLES:
- Instant meeting: { "topic": "Quick sync" }
- Scheduled: { "topic": "Team standup", "startTime": "2026-04-15T10:00:00Z", "duration": 30 }
- With options: { "topic": "Interview", "startTime": "2026-04-15T14:00:00Z", "waitingRoom": true }`,
        parameters: {
          type: 'object',
          properties: {
            topic: {
              type: 'string',
              description: 'Meeting topic/title.',
            },
            type: {
              type: 'string',
              enum: ['instant', 'scheduled'],
              description: 'Meeting type. Default: "scheduled".',
            },
            startTime: {
              type: 'string',
              description: 'Start time in ISO 8601 format (e.g., "2026-04-15T10:00:00Z"). Required for scheduled meetings.',
            },
            duration: {
              type: 'number',
              description: 'Duration in minutes. Default: 60.',
            },
            timezone: {
              type: 'string',
              description: 'Timezone (e.g., "America/New_York"). Defaults to host timezone.',
            },
            agenda: {
              type: 'string',
              description: 'Meeting agenda/description.',
            },
            password: {
              type: 'string',
              description: 'Meeting password. Auto-generated if omitted.',
            },
            waitingRoom: {
              type: 'boolean',
              description: 'Enable waiting room. Default: false.',
            },
            joinBeforeHost: {
              type: 'boolean',
              description: 'Allow participants to join before host. Default: false.',
            },
            hostUserId: {
              type: 'string',
              description: 'Zoom user ID or email to create meeting for. Default: "me".',
            },
          },
          required: ['topic'],
        },
      },
    },

    describeCall: (args: CreateMeetingArgs): string => {
      const parts = [args.topic];
      if (args.type === 'instant') parts.push('(instant)');
      if (args.startTime) parts.push(`at ${args.startTime}`);
      return parts.join(' ');
    },

    permission: {
      scope: 'once',
      riskLevel: 'medium',
      approvalMessage: `Create Zoom meeting via ${connector.displayName}`,
    },

    execute: async (args: CreateMeetingArgs, context?: ToolContext): Promise<ZoomCreateMeetingResult> => {
      const effectiveUserId = context?.userId ?? userId;
      const effectiveAccountId = context?.accountId;

      try {
        const hostId = args.hostUserId ?? (connector.getOptions()?.defaultUserId as string | undefined) ?? 'me';

        // Zoom meeting types: 1 = instant, 2 = scheduled
        const meetingType = args.type === 'instant' ? 1 : 2;

        const body: Record<string, unknown> = {
          topic: args.topic,
          type: meetingType,
          duration: args.duration ?? 60,
        };

        if (args.startTime && meetingType === 2) {
          body.start_time = args.startTime;
        }
        if (args.timezone) body.timezone = args.timezone;
        if (args.agenda) body.agenda = args.agenda;
        if (args.password) body.password = args.password;

        // Settings
        const settings: Record<string, unknown> = {};
        if (args.waitingRoom !== undefined) settings.waiting_room = args.waitingRoom;
        if (args.joinBeforeHost !== undefined) settings.join_before_host = args.joinBeforeHost;
        if (Object.keys(settings).length > 0) body.settings = settings;

        const meeting = await zoomFetch<ZoomMeetingResponse>(connector, `/users/${encodeURIComponent(hostId)}/meetings`, {
          method: 'POST',
          body,
          userId: effectiveUserId,
          accountId: effectiveAccountId,
        });

        return {
          success: true,
          meetingId: meeting.id,
          joinUrl: meeting.join_url,
          startUrl: meeting.start_url,
          topic: meeting.topic,
          startTime: meeting.start_time,
          duration: meeting.duration,
          timezone: meeting.timezone,
          password: meeting.password,
        };
      } catch (error) {
        return {
          success: false,
          error: formatZoomToolError('Failed to create meeting', error),
        };
      }
    },
  };
}
