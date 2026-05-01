/**
 * Microsoft Graph - Find Meeting Slots Tool
 *
 * Find available meeting time slots for a set of attendees.
 */

import type { Connector } from '../../core/Connector.js';
import type { ToolFunction, ToolContext } from '../../domain/entities/Tool.js';
import {
  type MicrosoftFindSlotsResult,
  type GraphFindMeetingTimesResponse,
  getUserPathPrefix,
  shouldExposeTargetUserParam,
  TARGET_USER_PARAM_SCHEMA,
  microsoftFetch,
  formatAttendees,
  formatMicrosoftToolError,
} from './types.js';

export interface FindMeetingSlotsArgs {
  attendees: string[];
  startDateTime: string;
  endDateTime: string;
  duration: number;
  timeZone?: string;
  maxResults?: number;
  targetUser?: string;
}

/**
 * Create a Microsoft Graph find_meeting_slots tool
 *
 * @param actAs Lock the on-behalf-of user; when set, the LLM cannot override.
 */
export function createFindMeetingSlotsTool(
  connector: Connector,
  userId?: string,
  actAs?: string,
): ToolFunction<FindMeetingSlotsArgs, MicrosoftFindSlotsResult> {
  const exposeTargetUser = shouldExposeTargetUserParam(connector, actAs);
  const properties: Record<string, unknown> = {
    attendees: {
      type: 'array',
      items: { type: 'string' },
      description: 'Attendee email addresses as plain strings. Example: ["alice@contoso.com", "bob@contoso.com"]. Do NOT pass objects.',
    },
    startDateTime: {
      type: 'string',
      description: 'Search window start as ISO 8601 string without timezone suffix. Example: "2025-01-15T08:00:00"',
    },
    endDateTime: {
      type: 'string',
      description: 'Search window end as ISO 8601 string without timezone suffix. Example: "2025-01-15T18:00:00". Can span multiple days.',
    },
    duration: {
      type: 'number',
      description: 'Meeting duration in minutes as integer. Example: 30 or 60.',
    },
    timeZone: {
      type: 'string',
      description: 'IANA timezone string for start/end times. Example: "America/New_York", "Europe/Zurich". Default: "UTC".',
    },
    maxResults: {
      type: 'number',
      description: 'Maximum number of time slot suggestions as integer. Default: 5.',
    },
  };
  if (exposeTargetUser) {
    properties.targetUser = TARGET_USER_PARAM_SCHEMA;
  }

  return {
    definition: {
      type: 'function',
      function: {
        name: 'find_meeting_slots',
        description: `Find available meeting time slots when all attendees are free, via Microsoft Graph. Checks each attendee's Outlook calendar and suggests times when everyone is available.

PARAMETER FORMATS:
- attendees: plain string array of email addresses. Example: ["alice@contoso.com", "bob@contoso.com"]. Do NOT use objects — just plain email strings.
- startDateTime/endDateTime: ISO 8601 string without timezone suffix. Example: "2025-01-15T08:00:00". Can span multiple days.
- duration: number of minutes as integer. Example: 30 or 60.
- timeZone: IANA timezone string. Example: "America/New_York", "Europe/Zurich". Default: "UTC".
- maxResults: integer. Default: 5.

EXAMPLES:
- Find 30min slot: { "attendees": ["alice@contoso.com", "bob@contoso.com"], "startDateTime": "2025-01-15T08:00:00", "endDateTime": "2025-01-15T18:00:00", "duration": 30, "timeZone": "America/New_York" }
- Find 1hr slot across days: { "attendees": ["alice@contoso.com"], "startDateTime": "2025-01-15T08:00:00", "endDateTime": "2025-01-17T18:00:00", "duration": 60, "maxResults": 10 }`,
        parameters: {
          type: 'object',
          properties,
          required: ['attendees', 'startDateTime', 'endDateTime', 'duration'],
        },
      },
    },

    describeCall: (args: FindMeetingSlotsArgs): string => {
      return `Find ${args.duration}min slots for ${args.attendees.length} attendees`;
    },

    permission: {
      scope: 'session',
      riskLevel: 'low',
      approvalMessage: `Find meeting time slots via ${connector.displayName}`,
    },

    execute: async (
      args: FindMeetingSlotsArgs,
      context?: ToolContext
    ): Promise<MicrosoftFindSlotsResult> => {
      const effectiveUserId = context?.userId ?? userId;
      const effectiveAccountId = context?.accountId;
      try {
        const prefix = getUserPathPrefix(connector, args.targetUser, actAs);
        const tz = args.timeZone ?? 'UTC';

        const result = await microsoftFetch<GraphFindMeetingTimesResponse>(
          connector,
          `${prefix}/findMeetingTimes`,
          {
            method: 'POST',
            userId: effectiveUserId,
            accountId: effectiveAccountId,
            headers: { 'Prefer': `outlook.timezone="${tz}"` },
            body: {
              attendees: formatAttendees(args.attendees),
              timeConstraint: {
                timeslots: [
                  {
                    start: { dateTime: args.startDateTime, timeZone: tz },
                    end: { dateTime: args.endDateTime, timeZone: tz },
                  },
                ],
              },
              meetingDuration: `PT${args.duration}M`,
              maxCandidates: args.maxResults ?? 5,
            },
          }
        );

        const slots = (result.meetingTimeSuggestions ?? []).map((s) => ({
          start: s.meetingTimeSlot.start.dateTime,
          end: s.meetingTimeSlot.end.dateTime,
          timeZone: s.meetingTimeSlot.start.timeZone,
          confidence: String(s.confidence),
          attendeeAvailability: (s.attendeeAvailability ?? []).map((a) => ({
            attendee: a.attendee.emailAddress.address,
            availability: a.availability,
          })),
        }));

        return {
          success: true,
          slots,
          emptySuggestionsReason: result.emptySuggestionsReason,
        };
      } catch (error) {
        return {
          success: false,
          error: formatMicrosoftToolError('Failed to find meeting slots', error),
        };
      }
    },
  };
}
