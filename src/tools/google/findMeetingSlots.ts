/**
 * Google Calendar - Find Meeting Slots Tool
 *
 * Find available meeting time slots for a set of attendees using the freeBusy API.
 * API is designed to match Microsoft's find_meeting_slots exactly.
 */

import type { Connector } from '../../core/Connector.js';
import type { ToolFunction, ToolContext } from '../../domain/entities/Tool.js';
import {
  type GoogleFindSlotsResult,
  type MeetingSlotSuggestion,
  type GoogleFreeBusyResponse,
  getGoogleUserId,
  shouldExposeTargetUserParam,
  TARGET_USER_PARAM_SCHEMA,
  googleFetch,
  normalizeEmails,
  formatGoogleToolError,
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
 * Parse an ISO datetime string into a Date object.
 *
 * If the string already has timezone info (Z or +/-offset), it's parsed directly.
 * Otherwise, it's treated as UTC by appending 'Z'. This is intentional:
 * the freeBusy API receives the user's timezone separately and returns busy
 * periods in UTC, so our slot computation correctly compares UTC-to-UTC.
 */
function parseDateTime(dt: string): Date {
  if (/[Zz]$/.test(dt) || /[+-]\d{2}:\d{2}$/.test(dt)) {
    return new Date(dt);
  }
  return new Date(dt + 'Z');
}

/**
 * Find free slots by subtracting busy intervals from the search window.
 *
 * This implements the slot-finding logic on the client side since Google's
 * freeBusy API only returns busy periods, not suggestions.
 */
function findFreeSlots(
  busyByAttendee: Map<string, { start: Date; end: Date }[]>,
  windowStart: Date,
  windowEnd: Date,
  durationMs: number,
  maxResults: number,
): MeetingSlotSuggestion[] {
  const attendees = Array.from(busyByAttendee.keys());

  // Merge all busy intervals across all attendees into a single sorted list
  // with attendee info preserved for availability reporting
  const allBusy: { start: Date; end: Date; attendee: string }[] = [];
  for (const [attendee, intervals] of busyByAttendee) {
    for (const interval of intervals) {
      allBusy.push({ ...interval, attendee });
    }
  }

  // Generate candidate slots at 15-minute intervals within the window
  const STEP_MS = 15 * 60 * 1000;
  const slots: MeetingSlotSuggestion[] = [];

  for (
    let candidateStart = windowStart.getTime();
    candidateStart + durationMs <= windowEnd.getTime() && slots.length < maxResults;
    candidateStart += STEP_MS
  ) {
    const candidateEnd = candidateStart + durationMs;

    // Check each attendee's availability for this slot
    const attendeeAvailability: { attendee: string; availability: string }[] = [];
    let allFree = true;

    for (const attendee of attendees) {
      const busyIntervals = busyByAttendee.get(attendee) ?? [];
      const isBusy = busyIntervals.some(
        b => b.start.getTime() < candidateEnd && b.end.getTime() > candidateStart
      );

      attendeeAvailability.push({
        attendee,
        availability: isBusy ? 'busy' : 'free',
      });

      if (isBusy) allFree = false;
    }

    if (allFree) {
      slots.push({
        start: new Date(candidateStart).toISOString(),
        end: new Date(candidateEnd).toISOString(),
        confidence: '100',
        attendeeAvailability,
      });
    }
  }

  return slots;
}

/**
 * Create a Google Calendar find_meeting_slots tool.
 *
 * Uses the Google Calendar freeBusy API to check attendee availability,
 * then computes free slots client-side.
 *
 * The args and result format intentionally match the Microsoft find_meeting_slots tool.
 */
/**
 * @param actAs Lock the on-behalf-of user; when set, the LLM cannot override.
 */
export function createGoogleFindMeetingSlotsTool(
  connector: Connector,
  userId?: string,
  actAs?: string,
): ToolFunction<FindMeetingSlotsArgs, GoogleFindSlotsResult> {
  const exposeTargetUser = shouldExposeTargetUserParam(connector, actAs);
  const properties: Record<string, unknown> = {
    attendees: {
      type: 'array',
      items: { type: 'string' },
      description: 'Attendee email addresses as plain strings. Example: ["alice@example.com", "bob@example.com"]. Do NOT pass objects.',
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
        description: `Find available meeting time slots when all attendees are free, via Google Calendar. Checks each attendee's Google Calendar and suggests times when everyone is available.

PARAMETER FORMATS:
- attendees: plain string array of email addresses. Example: ["alice@example.com", "bob@example.com"]. Do NOT use objects — just plain email strings.
- startDateTime/endDateTime: ISO 8601 string without timezone suffix. Example: "2025-01-15T08:00:00". Can span multiple days.
- duration: number of minutes as integer. Example: 30 or 60.
- timeZone: IANA timezone string. Example: "America/New_York", "Europe/Zurich". Default: "UTC".
- maxResults: integer. Default: 5.

EXAMPLES:
- Find 30min slot: { "attendees": ["alice@example.com", "bob@example.com"], "startDateTime": "2025-01-15T08:00:00", "endDateTime": "2025-01-15T18:00:00", "duration": 30, "timeZone": "America/New_York" }
- Find 1hr slot across days: { "attendees": ["alice@example.com"], "startDateTime": "2025-01-15T08:00:00", "endDateTime": "2025-01-17T18:00:00", "duration": 60, "maxResults": 10 }`,
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
    ): Promise<GoogleFindSlotsResult> => {
      const effectiveUserId = context?.userId ?? userId;
      const effectiveAccountId = context?.accountId;

      try {
        // Ensure the connector resolves the user for service accounts (validation only;
        // freeBusy doesn't take a user-prefix in URL, so we just throw early if missing).
        getGoogleUserId(connector, args.targetUser, actAs);
        const tz = args.timeZone ?? 'UTC';
        const attendees = normalizeEmails(args.attendees);
        const maxResults = args.maxResults ?? 5;
        const durationMs = args.duration * 60 * 1000;

        // Convert datetimes to RFC3339 for the API
        const windowStart = parseDateTime(args.startDateTime);
        const windowEnd = parseDateTime(args.endDateTime);

        // Call Google Calendar freeBusy API
        const freeBusyResult = await googleFetch<GoogleFreeBusyResponse>(
          connector,
          '/calendar/v3/freeBusy',
          {
            method: 'POST',
            userId: effectiveUserId,
            accountId: effectiveAccountId,
            body: {
              timeMin: windowStart.toISOString(),
              timeMax: windowEnd.toISOString(),
              timeZone: tz,
              items: attendees.map(email => ({ id: email })),
            },
          }
        );

        // Check for errors in the response
        const calendars = freeBusyResult.calendars ?? {};
        const errorAttendees: string[] = [];
        const busyByAttendee = new Map<string, { start: Date; end: Date }[]>();

        for (const attendee of attendees) {
          const cal = calendars[attendee];
          if (!cal) {
            // Attendee not in response — might not have access
            errorAttendees.push(attendee);
            busyByAttendee.set(attendee, []);
            continue;
          }
          if (cal.errors && cal.errors.length > 0) {
            errorAttendees.push(attendee);
            busyByAttendee.set(attendee, []);
            continue;
          }
          busyByAttendee.set(
            attendee,
            (cal.busy ?? []).map(b => ({ start: new Date(b.start), end: new Date(b.end) }))
          );
        }

        // Find free slots
        const slots = findFreeSlots(busyByAttendee, windowStart, windowEnd, durationMs, maxResults);

        let emptySuggestionsReason: string | undefined;
        if (slots.length === 0) {
          if (errorAttendees.length > 0) {
            emptySuggestionsReason = `Could not check availability for: ${errorAttendees.join(', ')}. They may have restricted calendar sharing.`;
          } else {
            emptySuggestionsReason = 'No free slots found in the specified time window where all attendees are available.';
          }
        }

        return {
          success: true,
          slots,
          emptySuggestionsReason,
        };
      } catch (error) {
        return {
          success: false,
          error: formatGoogleToolError('Failed to find meeting slots', error),
        };
      }
    },
  };
}
