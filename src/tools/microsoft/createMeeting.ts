/**
 * Microsoft Graph - Create Meeting Tool
 *
 * Create a calendar event with optional Teams online meeting.
 */

import type { Connector } from '../../core/Connector.js';
import type { ToolFunction, ToolContext } from '../../domain/entities/Tool.js';
import {
  type MicrosoftCreateMeetingResult,
  type GraphEventResponse,
  getUserPathPrefix,
  shouldExposeTargetUserParam,
  TARGET_USER_PARAM_SCHEMA,
  microsoftFetch,
  formatAttendees,
  formatMicrosoftToolError,
} from './types.js';

export interface CreateMeetingArgs {
  subject: string;
  startDateTime: string;
  endDateTime: string;
  attendees: string[];
  body?: string;
  isOnlineMeeting?: boolean;
  location?: string;
  timeZone?: string;
  targetUser?: string;
}

/**
 * Create a Microsoft Graph create_meeting tool
 *
 * @param actAs Lock the on-behalf-of user; when set, the LLM cannot override.
 */
export function createMeetingTool(
  connector: Connector,
  userId?: string,
  actAs?: string,
): ToolFunction<CreateMeetingArgs, MicrosoftCreateMeetingResult> {
  const exposeTargetUser = shouldExposeTargetUserParam(connector, actAs);
  const properties: Record<string, unknown> = {
    subject: {
      type: 'string',
      description: 'Meeting title as plain string. Example: "Sprint Review"',
    },
    startDateTime: {
      type: 'string',
      description: 'Start date/time as ISO 8601 string without timezone suffix. Example: "2025-01-15T09:00:00"',
    },
    endDateTime: {
      type: 'string',
      description: 'End date/time as ISO 8601 string without timezone suffix. Example: "2025-01-15T09:30:00"',
    },
    attendees: {
      type: 'array',
      items: { type: 'string' },
      description: 'Attendee email addresses as plain strings. Example: ["alice@contoso.com", "bob@contoso.com"]',
    },
    body: {
      type: 'string',
      description: 'Meeting description as HTML string. Example: "<p>Agenda: discuss Q1 goals</p>". Optional.',
    },
    isOnlineMeeting: {
      type: 'boolean',
      description: 'Set to true to generate a Teams online meeting link. Default: false.',
    },
    location: {
      type: 'string',
      description: 'Physical location as plain string. Example: "Conference Room A". Optional.',
    },
    timeZone: {
      type: 'string',
      description: 'IANA timezone string for start/end times. Example: "America/New_York", "Europe/Zurich". Default: "UTC".',
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
        description: `Create a calendar event on the user's Outlook calendar via Microsoft Graph, optionally with a Teams online meeting link.

PARAMETER FORMATS:
- subject: plain string. Example: "Sprint Review"
- startDateTime/endDateTime: ISO 8601 string WITHOUT timezone suffix (timezone is a separate param). Example: "2025-01-15T09:00:00"
- attendees: plain string array of email addresses. Example: ["alice@contoso.com", "bob@contoso.com"]. Do NOT use objects.
- body: HTML string for the invitation body. Example: "<p>Agenda: discuss Q1 goals</p>". Optional.
- timeZone: IANA timezone string. Example: "America/New_York", "Europe/Zurich". Default: "UTC".
- isOnlineMeeting: boolean. Set true to auto-generate a Teams meeting link.
- location: plain string. Example: "Conference Room A". Optional.

EXAMPLES:
- Simple: { "subject": "Standup", "startDateTime": "2025-01-15T09:00:00", "endDateTime": "2025-01-15T09:30:00", "attendees": ["alice@contoso.com"], "timeZone": "America/New_York" }
- Teams: { "subject": "Sprint Review", "startDateTime": "2025-01-15T14:00:00", "endDateTime": "2025-01-15T15:00:00", "attendees": ["alice@contoso.com", "bob@contoso.com"], "isOnlineMeeting": true }`,
        parameters: {
          type: 'object',
          properties,
          required: ['subject', 'startDateTime', 'endDateTime', 'attendees'],
        },
      },
    },

    describeCall: (args: CreateMeetingArgs): string => {
      return `Create meeting: ${args.subject} (${args.attendees.length} attendees)`;
    },

    permission: {
      scope: 'session',
      riskLevel: 'medium',
      approvalMessage: `Create a calendar event via ${connector.displayName}`,
    },

    execute: async (
      args: CreateMeetingArgs,
      context?: ToolContext
    ): Promise<MicrosoftCreateMeetingResult> => {
      const effectiveUserId = context?.userId ?? userId;
      const effectiveAccountId = context?.accountId;
      try {
        const prefix = getUserPathPrefix(connector, args.targetUser, actAs);
        const tz = args.timeZone ?? 'UTC';

        const eventBody: Record<string, unknown> = {
          subject: args.subject,
          start: { dateTime: args.startDateTime, timeZone: tz },
          end: { dateTime: args.endDateTime, timeZone: tz },
          attendees: formatAttendees(args.attendees),
        };

        if (args.body) {
          eventBody.body = { contentType: 'HTML', content: args.body };
        }
        if (args.isOnlineMeeting) {
          eventBody.isOnlineMeeting = true;
          eventBody.onlineMeetingProvider = 'teamsForBusiness';
        }
        if (args.location) {
          eventBody.location = { displayName: args.location };
        }

        const event = await microsoftFetch<GraphEventResponse>(
          connector,
          `${prefix}/events`,
          { method: 'POST', userId: effectiveUserId, accountId: effectiveAccountId, body: eventBody }
        );

        return {
          success: true,
          eventId: event.id,
          webLink: event.webLink,
          onlineMeetingUrl: event.onlineMeeting?.joinUrl,
        };
      } catch (error) {
        return {
          success: false,
          error: formatMicrosoftToolError('Failed to create meeting', error),
        };
      }
    },
  };
}
