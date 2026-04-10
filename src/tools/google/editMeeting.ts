/**
 * Google Calendar - Edit Meeting Tool
 *
 * Updates an existing calendar event (partial update via PATCH).
 */

import type { Connector } from '../../core/Connector.js';
import type { ToolFunction, ToolContext } from '../../domain/entities/Tool.js';
import {
  type GoogleEditMeetingResult,
  type GoogleCalendarEvent,
  getGoogleUserId,
  googleFetch,
  normalizeEmails,
  formatGoogleToolError,
} from './types.js';

interface EditMeetingArgs {
  eventId: string;
  summary?: string;
  startDateTime?: string;
  endDateTime?: string;
  attendees?: string[];
  description?: string;
  isOnlineMeeting?: boolean;
  location?: string;
  timeZone?: string;
  targetUser?: string;
}

/**
 * Create a Google Calendar edit_meeting tool
 */
export function createGoogleEditMeetingTool(
  connector: Connector,
  userId?: string
): ToolFunction<EditMeetingArgs, GoogleEditMeetingResult> {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'edit_meeting',
        description: `Update an existing Google Calendar event. Only fields you provide will be updated (partial update).

**Important:** The attendees field REPLACES the entire attendee list. Include all desired attendees, not just new ones.

PARAMETER FORMATS:
- eventId: The calendar event ID (from create_meeting or list_meetings)
- startDateTime/endDateTime: ISO 8601 string. Example: "2025-01-15T14:00:00"
- attendees: plain string array that REPLACES all existing attendees
- timeZone: IANA timezone string. Default: "UTC"

EXAMPLE:
{ "eventId": "abc123", "summary": "Updated Title", "attendees": ["alice@example.com", "bob@example.com"] }`,
        parameters: {
          type: 'object',
          properties: {
            eventId: {
              type: 'string',
              description: 'The calendar event ID to update.',
            },
            summary: {
              type: 'string',
              description: 'New event title (optional).',
            },
            startDateTime: {
              type: 'string',
              description: 'New start time as ISO 8601 (optional).',
            },
            endDateTime: {
              type: 'string',
              description: 'New end time as ISO 8601 (optional).',
            },
            attendees: {
              type: 'array',
              items: { type: 'string' },
              description: 'REPLACES all attendees. Include everyone you want on the invite.',
            },
            description: {
              type: 'string',
              description: 'New event description (optional). HTML supported.',
            },
            isOnlineMeeting: {
              type: 'boolean',
              description: 'If true, adds a Google Meet link (optional).',
            },
            location: {
              type: 'string',
              description: 'New physical location (optional).',
            },
            timeZone: {
              type: 'string',
              description: 'IANA timezone for start/end. Default: "UTC".',
            },
            targetUser: {
              type: 'string',
              description: 'User email for service-account auth. Ignored in delegated auth.',
            },
          },
          required: ['eventId'],
        },
      },
    },

    describeCall: (args: EditMeetingArgs): string => {
      return `Edit meeting: ${args.eventId}`;
    },

    permission: {
      scope: 'session',
      riskLevel: 'medium',
      approvalMessage: `Update a calendar event via ${connector.displayName}`,
    },

    execute: async (
      args: EditMeetingArgs,
      context?: ToolContext
    ): Promise<GoogleEditMeetingResult> => {
      const effectiveUserId = context?.userId ?? userId;
      const effectiveAccountId = context?.accountId;

      try {
        const tz = args.timeZone ?? 'UTC';
        const calendarUser = getGoogleUserId(connector, args.targetUser);

        const patchBody: Record<string, unknown> = {};

        if (args.summary !== undefined) {
          patchBody.summary = args.summary;
        }
        if (args.startDateTime !== undefined) {
          patchBody.start = { dateTime: args.startDateTime, timeZone: tz };
        }
        if (args.endDateTime !== undefined) {
          patchBody.end = { dateTime: args.endDateTime, timeZone: tz };
        }
        if (args.attendees !== undefined) {
          const attendees = normalizeEmails(args.attendees);
          patchBody.attendees = attendees.map(email => ({ email }));
        }
        if (args.description !== undefined) {
          patchBody.description = args.description;
        }
        if (args.location !== undefined) {
          patchBody.location = args.location;
        }
        if (args.isOnlineMeeting) {
          patchBody.conferenceData = {
            createRequest: {
              requestId: `meet-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              conferenceSolutionKey: { type: 'hangoutsMeet' },
            },
          };
        }

        const queryParams: Record<string, string | number | boolean> = {};
        if (args.isOnlineMeeting) {
          queryParams.conferenceDataVersion = 1;
        }

        const event = await googleFetch<GoogleCalendarEvent>(
          connector,
          `/calendar/v3/calendars/${calendarUser}/events/${args.eventId}`,
          {
            method: 'PATCH',
            body: patchBody,
            queryParams,
            userId: effectiveUserId,
            accountId: effectiveAccountId,
          }
        );

        return {
          success: true,
          eventId: event.id,
          htmlLink: event.htmlLink,
        };
      } catch (error) {
        return {
          success: false,
          error: formatGoogleToolError('Failed to edit meeting', error),
        };
      }
    },
  };
}
