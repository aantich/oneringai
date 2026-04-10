/**
 * Microsoft Graph - Edit Meeting Tool
 *
 * Update an existing calendar event.
 */

import type { Connector } from '../../core/Connector.js';
import type { ToolFunction, ToolContext } from '../../domain/entities/Tool.js';
import {
  type MicrosoftEditMeetingResult,
  type GraphEventResponse,
  getUserPathPrefix,
  microsoftFetch,
  formatAttendees,
  formatMicrosoftToolError,
} from './types.js';

export interface EditMeetingArgs {
  eventId: string;
  subject?: string;
  startDateTime?: string;
  endDateTime?: string;
  attendees?: string[];
  body?: string;
  isOnlineMeeting?: boolean;
  location?: string;
  timeZone?: string;
  targetUser?: string;
}

/**
 * Create a Microsoft Graph edit_meeting tool
 */
export function createEditMeetingTool(
  connector: Connector,
  userId?: string
): ToolFunction<EditMeetingArgs, MicrosoftEditMeetingResult> {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'edit_meeting',
        description: `Update an existing Outlook calendar event via Microsoft Graph. Only the fields you provide will be changed — omitted fields keep their current values.

IMPORTANT: The "attendees" field REPLACES the entire attendee list. Include ALL desired attendees (both new and existing), not just the ones you want to add.

PARAMETER FORMATS:
- eventId: Graph event ID string (starts with "AAMk..."). Get this from a previous create_meeting result.
- subject: plain string. Example: "Updated: Sprint Review"
- startDateTime/endDateTime: ISO 8601 string without timezone suffix. Example: "2025-01-15T10:00:00"
- attendees: plain string array of email addresses. Example: ["alice@contoso.com", "charlie@contoso.com"]. Do NOT use objects. REPLACES all attendees.
- body: HTML string. Example: "<p>Updated agenda</p>"
- timeZone: IANA timezone string. Example: "Europe/Zurich". Default: "UTC".
- isOnlineMeeting: boolean. true = add Teams link, false = remove it.
- location: plain string. Example: "Room 201"

EXAMPLES:
- Reschedule: { "eventId": "AAMkADI1...", "startDateTime": "2025-01-15T10:00:00", "endDateTime": "2025-01-15T10:30:00", "timeZone": "America/New_York" }
- Change attendees: { "eventId": "AAMkADI1...", "attendees": ["alice@contoso.com", "charlie@contoso.com"] }
- Add Teams link: { "eventId": "AAMkADI1...", "isOnlineMeeting": true }`,
        parameters: {
          type: 'object',
          properties: {
            eventId: {
              type: 'string',
              description: 'Calendar event ID string from create_meeting result. Example: "AAMkADI1M2I3YzgtODg..."',
            },
            subject: {
              type: 'string',
              description: 'New meeting title as plain string. Example: "Updated: Sprint Review"',
            },
            startDateTime: {
              type: 'string',
              description: 'New start date/time as ISO 8601 string without timezone suffix. Example: "2025-01-15T10:00:00"',
            },
            endDateTime: {
              type: 'string',
              description: 'New end date/time as ISO 8601 string without timezone suffix. Example: "2025-01-15T10:30:00"',
            },
            attendees: {
              type: 'array',
              items: { type: 'string' },
              description: 'FULL replacement attendee list as plain email strings. Example: ["alice@contoso.com", "charlie@contoso.com"]. Include ALL attendees.',
            },
            body: {
              type: 'string',
              description: 'New meeting description as HTML string. Example: "<p>Updated agenda</p>"',
            },
            isOnlineMeeting: {
              type: 'boolean',
              description: 'true to add Teams meeting link, false to remove it.',
            },
            location: {
              type: 'string',
              description: 'New location as plain string. Example: "Conference Room A"',
            },
            timeZone: {
              type: 'string',
              description: 'IANA timezone string for start/end times. Example: "Europe/Zurich". Default: "UTC".',
            },
            targetUser: {
              type: 'string',
              description: 'User ID or email (UPN) for app-only auth. Example: "alice@contoso.com". Ignored in delegated auth.',
            },
          },
          required: ['eventId'],
        },
      },
    },

    describeCall: (args: EditMeetingArgs): string => {
      const fields = ['subject', 'startDateTime', 'endDateTime', 'attendees', 'body', 'location'] as const;
      const changed = fields.filter((f) => args[f] !== undefined);
      return `Edit meeting ${args.eventId.slice(0, 12)}... (${changed.join(', ') || 'no changes'})`;
    },

    permission: {
      scope: 'session',
      riskLevel: 'medium',
      approvalMessage: `Update a calendar event via ${connector.displayName}`,
    },

    execute: async (
      args: EditMeetingArgs,
      context?: ToolContext
    ): Promise<MicrosoftEditMeetingResult> => {
      const effectiveUserId = context?.userId ?? userId;
      const effectiveAccountId = context?.accountId;
      try {
        const prefix = getUserPathPrefix(connector, args.targetUser);
        const tz = args.timeZone ?? 'UTC';

        // Build partial update body with only provided fields
        const patchBody: Record<string, unknown> = {};

        if (args.subject !== undefined) patchBody.subject = args.subject;
        if (args.body !== undefined) patchBody.body = { contentType: 'HTML', content: args.body };
        if (args.startDateTime !== undefined) patchBody.start = { dateTime: args.startDateTime, timeZone: tz };
        if (args.endDateTime !== undefined) patchBody.end = { dateTime: args.endDateTime, timeZone: tz };
        if (args.attendees !== undefined) {
          patchBody.attendees = formatAttendees(args.attendees);
        }
        if (args.isOnlineMeeting !== undefined) {
          patchBody.isOnlineMeeting = args.isOnlineMeeting;
          if (args.isOnlineMeeting) {
            patchBody.onlineMeetingProvider = 'teamsForBusiness';
          }
        }
        if (args.location !== undefined) {
          patchBody.location = { displayName: args.location };
        }

        const event = await microsoftFetch<GraphEventResponse>(
          connector,
          `${prefix}/events/${args.eventId}`,
          { method: 'PATCH', userId: effectiveUserId, accountId: effectiveAccountId, body: patchBody }
        );

        return {
          success: true,
          eventId: event.id,
          webLink: event.webLink,
        };
      } catch (error) {
        return {
          success: false,
          error: formatMicrosoftToolError('Failed to edit meeting', error),
        };
      }
    },
  };
}
