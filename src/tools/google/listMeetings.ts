/**
 * Google Calendar - List Meetings Tool
 *
 * Lists calendar events within a time window.
 */

import type { Connector } from '../../core/Connector.js';
import type { ToolFunction, ToolContext } from '../../domain/entities/Tool.js';
import {
  type GoogleListMeetingsResult,
  type GoogleMeetingListEntry,
  type GoogleCalendarEvent,
  type GoogleCalendarEventListResponse,
  getGoogleUserId,
  googleFetch,
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
  const start = event.start?.dateTime ?? event.start?.date ?? '';
  const end = event.end?.dateTime ?? event.end?.date ?? '';
  const tz = event.start?.timeZone ?? 'UTC';

  // Filter out resource attendees
  const attendees = (event.attendees ?? [])
    .filter(a => !a.resource)
    .map(a => a.email);

  return {
    eventId: event.id,
    summary: event.summary ?? '(No title)',
    start,
    end,
    timeZone: tz,
    organizer: event.organizer?.email,
    attendees: attendees.length > 0 ? attendees : undefined,
    location: event.location,
    meetLink,
    isOnlineMeeting: Boolean(meetLink || event.hangoutLink || event.conferenceData),
    description: event.description ? event.description.slice(0, 200) : undefined,
  };
}

/**
 * Create a Google Calendar list_meetings tool
 */
export function createGoogleListMeetingsTool(
  connector: Connector,
  userId?: string
): ToolFunction<ListMeetingsArgs, GoogleListMeetingsResult> {
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

EXAMPLE:
{ "startDateTime": "2025-01-15T00:00:00Z", "endDateTime": "2025-01-16T00:00:00Z", "timeZone": "America/New_York" }`,
        parameters: {
          type: 'object',
          properties: {
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
            targetUser: {
              type: 'string',
              description: 'User email for service-account auth. Ignored in delegated auth.',
            },
          },
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
        const calendarUser = getGoogleUserId(connector, args.targetUser);
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

        const meetings = (result.items ?? [])
          .filter(e => e.status !== 'cancelled')
          .map(toMeetingEntry);

        return {
          success: true,
          meetings,
          totalCount: meetings.length,
        };
      } catch (error) {
        return {
          success: false,
          error: `Failed to list meetings: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  };
}
