import { connectorFailure } from '../connector/enhancedInvocation.js';
/**
 * Google Calendar - List Meetings Tool
 *
 * Lists calendar events within a time window.
 */

import type { Connector } from '../../core/Connector.js';
import type { ToolFunction, ToolContext } from '../../domain/entities/Tool.js';
import { calendarDateTimeToUtcIso, utcIsoToLocalDisplay } from '../calendar/dateTime.js';
import {
  type GoogleListMeetingsResult,
  type GoogleMeetingListEntry,
  type GoogleCalendarEvent,
  type GoogleCalendarEventListResponse,
  getGoogleCalendarUserId,
  shouldExposeTargetUserParam,
  TARGET_USER_PARAM_SCHEMA,
  googleFetch,
  formatGoogleToolError,
} from './types.js';

interface ListMeetingsArgs {
  startDateTime: string;
  endDateTime: string;
  timeZone?: string;
  maxResults?: number;
  targetUser?: string;
}

/**
 * Extract the Meet link from a calendar event
 */
function extractMeetLink(event: GoogleCalendarEvent): string | undefined {
  if (event.hangoutLink) return event.hangoutLink;
  const videoEntry = event.conferenceData?.entryPoints?.find(
    ep => ep.entryPointType === 'video'
  );
  return videoEntry?.uri;
}

/**
 * Convert a Google Calendar event to our list entry format
 */
function toMeetingEntry(event: GoogleCalendarEvent): GoogleMeetingListEntry {
  const meetLink = extractMeetLink(event);
  const tz = event.start?.timeZone ?? 'UTC';
  const endTz = event.end?.timeZone ?? tz;

  // Filter out resource attendees
  const attendees = (event.attendees ?? [])
    .filter(a => !a.resource)
    .map(a => a.email);

  return {
    eventId: event.id,
    summary: event.summary ?? '(No title)',
    start: calendarDateTimeToUtcIso(event.start?.dateTime ?? event.start?.date, tz),
    end: calendarDateTimeToUtcIso(event.end?.dateTime ?? event.end?.date, endTz),
    timeZone: tz,
    organizer: event.organizer?.email,
    attendees: attendees.length > 0 ? attendees : undefined,
    location: event.location,
    meetLink,
    isOnlineMeeting: Boolean(meetLink || event.hangoutLink || event.conferenceData),
    description: event.description || undefined,
  };
}

/**
 * Create a Google Calendar list_meetings tool
 *
 * @param actAs Lock the on-behalf-of user; when set, the LLM cannot override.
 */
export function createGoogleListMeetingsTool(
  connector: Connector,
  userId?: string,
  actAs?: string,
): ToolFunction<ListMeetingsArgs, GoogleListMeetingsResult> {
  const exposeTargetUser = shouldExposeTargetUserParam(connector, actAs);
  const properties: Record<string, unknown> = {
    startDateTime: {
      type: 'string',
      description: 'Start of time window as ISO 8601 (RFC 3339). Example: "2025-01-15T00:00:00Z"',
    },
    endDateTime: {
      type: 'string',
      description: 'End of time window as ISO 8601 (RFC 3339). Example: "2025-01-16T00:00:00Z"',
    },
    timeZone: {
      type: 'string',
      description: 'IANA timezone. Default: "UTC".',
    },
    maxResults: {
      type: 'number',
      description: 'Max events to return (1-100). Default: 50.',
    },
  };
  if (exposeTargetUser) {
    properties.targetUser = TARGET_USER_PARAM_SCHEMA;
  }

  return {
    definition: {
      type: 'function',
      function: {
        name: 'list_meetings',
        description: `List calendar events from Google Calendar within a time window.

Returns events with their details including Google Meet links, attendees, and location.

PARAMETER FORMATS:
- startDateTime/endDateTime: ISO 8601 string with timezone offset or Z suffix. Example: "2025-01-15T08:00:00Z" or "2025-01-15T08:00:00-05:00"
- timeZone: IANA timezone. Example: "America/New_York". Default: "UTC"
- maxResults: integer, max 100. Default: 50

RESPONSE FORMAT:
Each meeting's "start" and "end" are returned as UTC ISO 8601 strings ending with "Z", regardless of the timeZone you requested. When the user's timezone is known, each meeting also includes "startLocal"/"endLocal" — for timed meetings the local wall-clock time (e.g. "Thu, May 22, 2026, 2:30 PM EDT"); for all-day meetings a date with no time. State times to the user using startLocal/endLocal when present; do NOT convert "start"/"end" yourself. When passing times to show_calendar or scheduling tools, use the canonical "start"/"end" verbatim and never reconstruct them from wall-clock digits.

EXAMPLE:
{ "startDateTime": "2025-01-15T00:00:00Z", "endDateTime": "2025-01-16T00:00:00Z", "timeZone": "America/New_York" }`,
        parameters: {
          type: 'object',
          properties,
          required: ['startDateTime', 'endDateTime'],
        },
      },
      blocking: true,
      timeout: 30000,
    },

    describeCall: (args: ListMeetingsArgs): string => {
      return `List meetings ${args.startDateTime} to ${args.endDateTime}`;
    },

    permission: {
      scope: 'session',
      riskLevel: 'low',
      approvalMessage: `List calendar events via ${connector.displayName}`,
    },

    execute: async (
      args: ListMeetingsArgs,
      context?: ToolContext
    ): Promise<GoogleListMeetingsResult> => {
      const effectiveUserId = context?.userId ?? userId;
      const effectiveAccountId = context?.accountId;

      try {
        const calendarUser = getGoogleCalendarUserId(connector, args.targetUser, actAs);
        const maxResults = Math.min(args.maxResults ?? 50, 100);

        const result = await googleFetch<GoogleCalendarEventListResponse>(
          connector,
          `/calendar/v3/calendars/${calendarUser}/events`,
          {
            userId: effectiveUserId,
            accountId: effectiveAccountId,
            queryParams: {
              timeMin: args.startDateTime,
              timeMax: args.endDateTime,
              timeZone: args.timeZone ?? 'UTC',
              maxResults,
              singleEvents: true,
              orderBy: 'startTime',
            },
          }
        );

        const displayTz = context?.timeZone;
        const meetings = (result.items ?? [])
          .filter(e => e.status !== 'cancelled')
          .map((event) => {
            const entry = toMeetingEntry(event);
            // Localized display alongside canonical UTC start/end when the host
            // supplied the viewer's timezone — so the model states times in the
            // user's zone without converting. Omitted when no zone. All-day
            // events (date-only, no dateTime) render as a date with no zone
            // conversion so the day doesn't shift.
            if (displayTz) {
              const allDay = Boolean(event.start?.date && !event.start?.dateTime);
              entry.startLocal = utcIsoToLocalDisplay(entry.start, displayTz, allDay);
              entry.endLocal = utcIsoToLocalDisplay(entry.end, displayTz, allDay);
            }
            return entry;
          });

        return {
          success: true,
          meetings,
          totalCount: meetings.length,
        };
      } catch (error) {
        return connectorFailure(connector, {
          success: false,
          error: formatGoogleToolError('Failed to list meetings', error),
        });
      }
    },
  };
}
