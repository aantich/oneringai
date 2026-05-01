/**
 * Google Calendar - Create Meeting Tool
 *
 * Creates a calendar event with optional Google Meet link.
 */

import type { Connector } from '../../core/Connector.js';
import type { ToolFunction, ToolContext } from '../../domain/entities/Tool.js';
import {
  type GoogleCreateMeetingResult,
  type GoogleCalendarEvent,
  getGoogleUserId,
  shouldExposeTargetUserParam,
  TARGET_USER_PARAM_SCHEMA,
  googleFetch,
  normalizeEmails,
  formatGoogleToolError,
} from './types.js';

interface CreateMeetingArgs {
  summary: string;
  startDateTime: string;
  endDateTime: string;
  attendees: string[];
  description?: string;
  isOnlineMeeting?: boolean;
  location?: string;
  timeZone?: string;
  targetUser?: string;
}

/**
 * Extract the Google Meet link from a calendar event
 */
function extractMeetLink(event: GoogleCalendarEvent): string | undefined {
  // hangoutLink is the legacy Meet URL
  if (event.hangoutLink) return event.hangoutLink;
  // conferenceData may have a video entry point
  const videoEntry = event.conferenceData?.entryPoints?.find(
    ep => ep.entryPointType === 'video'
  );
  return videoEntry?.uri;
}

/**
 * Create a Google Calendar create_meeting tool
 *
 * @param actAs Lock the on-behalf-of user; when set, the LLM cannot override.
 */
export function createGoogleMeetingTool(
  connector: Connector,
  userId?: string,
  actAs?: string,
): ToolFunction<CreateMeetingArgs, GoogleCreateMeetingResult> {
  const exposeTargetUser = shouldExposeTargetUserParam(connector, actAs);
  const properties: Record<string, unknown> = {
    summary: {
      type: 'string',
      description: 'Event title/subject.',
    },
    startDateTime: {
      type: 'string',
      description: 'Event start as ISO 8601 string. Example: "2025-01-15T14:00:00"',
    },
    endDateTime: {
      type: 'string',
      description: 'Event end as ISO 8601 string. Example: "2025-01-15T15:00:00"',
    },
    attendees: {
      type: 'array',
      items: { type: 'string' },
      description: 'Attendee email addresses as plain strings.',
    },
    description: {
      type: 'string',
      description: 'Event description/body (optional). HTML supported.',
    },
    isOnlineMeeting: {
      type: 'boolean',
      description: 'If true, creates a Google Meet link for the event. Default: false.',
    },
    location: {
      type: 'string',
      description: 'Physical location for the event (optional).',
    },
    timeZone: {
      type: 'string',
      description: 'IANA timezone. Example: "America/New_York". Default: "UTC".',
    },
  };
  if (exposeTargetUser) {
    properties.targetUser = TARGET_USER_PARAM_SCHEMA;
  }

  return {
    definition: {
      type: 'function',
      function: {
        name: 'create_meeting',
        description: `Create a calendar event in Google Calendar with optional Google Meet video conference link.

PARAMETER FORMATS:
- summary: Event title/subject
- startDateTime/endDateTime: ISO 8601 string. Example: "2025-01-15T14:00:00"
- attendees: plain string array of email addresses. Example: ["alice@example.com"]
- timeZone: IANA timezone string. Example: "America/New_York". Default: "UTC"
- isOnlineMeeting: if true, creates a Google Meet link. Default: false

EXAMPLE:
{ "summary": "Sprint Review", "startDateTime": "2025-01-15T14:00:00", "endDateTime": "2025-01-15T15:00:00", "attendees": ["alice@example.com"], "timeZone": "America/New_York", "isOnlineMeeting": true }`,
        parameters: {
          type: 'object',
          properties,
          required: ['summary', 'startDateTime', 'endDateTime', 'attendees'],
        },
      },
    },

    describeCall: (args: CreateMeetingArgs): string => {
      return `Create meeting: ${args.summary}`;
    },

    permission: {
      scope: 'session',
      riskLevel: 'medium',
      approvalMessage: `Create a calendar event via ${connector.displayName}`,
    },

    execute: async (
      args: CreateMeetingArgs,
      context?: ToolContext
    ): Promise<GoogleCreateMeetingResult> => {
      const effectiveUserId = context?.userId ?? userId;
      const effectiveAccountId = context?.accountId;

      try {
        const tz = args.timeZone ?? 'UTC';
        const attendees = normalizeEmails(args.attendees);

        const eventBody: Record<string, unknown> = {
          summary: args.summary,
          start: { dateTime: args.startDateTime, timeZone: tz },
          end: { dateTime: args.endDateTime, timeZone: tz },
          attendees: attendees.map(email => ({ email })),
        };

        if (args.description) {
          eventBody.description = args.description;
        }
        if (args.location) {
          eventBody.location = args.location;
        }
        if (args.isOnlineMeeting) {
          eventBody.conferenceData = {
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

        // Google Calendar API uses a different base URL
        const calendarUser = getGoogleUserId(connector, args.targetUser, actAs);
        const event = await googleFetch<GoogleCalendarEvent>(
          connector,
          `/calendar/v3/calendars/${calendarUser}/events`,
          {
            method: 'POST',
            body: eventBody,
            queryParams,
            userId: effectiveUserId,
            accountId: effectiveAccountId,
          }
        );

        return {
          success: true,
          eventId: event.id,
          htmlLink: event.htmlLink,
          meetLink: extractMeetLink(event),
        };
      } catch (error) {
        return {
          success: false,
          error: formatGoogleToolError('Failed to create meeting', error),
        };
      }
    },
  };
}
