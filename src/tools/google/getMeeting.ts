import { connectorFailure } from '../connector/enhancedInvocation.js';
/**
 * Google Calendar - Get Meeting Tool
 *
 * Gets full details of a single calendar event.
 */

import type { Connector } from '../../core/Connector.js';
import type { ToolFunction, ToolContext } from '../../domain/entities/Tool.js';
import { calendarDateTimeToUtcIso, utcIsoToLocalDisplay } from '../calendar/dateTime.js';
import {
  type GoogleGetMeetingResult,
  type GoogleCalendarEvent,
  getGoogleCalendarUserId,
  shouldExposeTargetUserParam,
  TARGET_USER_PARAM_SCHEMA,
  googleFetch,
  stripHtml,
  formatGoogleToolError,
} from './types.js';

interface GetMeetingArgs {
  eventId: string;
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
 * Create a Google Calendar get_meeting tool
 *
 * @param actAs Lock the on-behalf-of user; when set, the LLM cannot override.
 */
export function createGoogleGetMeetingTool(
  connector: Connector,
  userId?: string,
  actAs?: string,
): ToolFunction<GetMeetingArgs, GoogleGetMeetingResult> {
  const exposeTargetUser = shouldExposeTargetUserParam(connector, actAs);
  const properties: Record<string, unknown> = {
    eventId: {
      type: 'string',
      description: 'The calendar event ID.',
    },
  };
  if (exposeTargetUser) {
    properties.targetUser = TARGET_USER_PARAM_SCHEMA;
  }

  return {
    definition: {
      type: 'function',
      function: {
        name: 'get_meeting',
        description: `Get full details of a single Google Calendar event by its event ID.

Returns the complete event including description, attendees with response status, Meet link, and location.

RESPONSE FORMAT:
"start" and "end" are returned as UTC ISO 8601 strings ending with "Z". When the user's timezone is known, "startLocal"/"endLocal" carry — for a timed meeting the local wall-clock time (e.g. "Thu, May 22, 2026, 2:30 PM EDT"), for an all-day meeting a date with no time. State times to the user using these when present, and never convert "start"/"end" yourself. Pass the canonical "start"/"end" UTC values verbatim when calling other tools.

EXAMPLE:
{ "eventId": "abc123def456" }`,
        parameters: {
          type: 'object',
          properties,
          required: ['eventId'],
        },
      },
    },

    describeCall: (args: GetMeetingArgs): string => {
      return `Get meeting: ${args.eventId}`;
    },

    permission: {
      scope: 'session',
      riskLevel: 'low',
      approvalMessage: `Get calendar event details via ${connector.displayName}`,
    },

    execute: async (
      args: GetMeetingArgs,
      context?: ToolContext
    ): Promise<GoogleGetMeetingResult> => {
      const effectiveUserId = context?.userId ?? userId;
      const effectiveAccountId = context?.accountId;

      try {
        const calendarUser = getGoogleCalendarUserId(connector, args.targetUser, actAs);

        const event = await googleFetch<GoogleCalendarEvent>(
          connector,
          `/calendar/v3/calendars/${calendarUser}/events/${args.eventId}`,
          {
            userId: effectiveUserId,
            accountId: effectiveAccountId,
          }
        );

        const meetLink = extractMeetLink(event);
        const tz = event.start?.timeZone ?? 'UTC';
        const endTz = event.end?.timeZone ?? tz;

        // Filter out resource attendees
        const attendees = (event.attendees ?? [])
          .filter(a => !a.resource)
          .map(a => a.email);

        // Extract plain text description
        let description = event.description;
        if (description) {
          description = stripHtml(description);
        }

        const startUtc = calendarDateTimeToUtcIso(event.start?.dateTime ?? event.start?.date, tz);
        const endUtc = calendarDateTimeToUtcIso(event.end?.dateTime ?? event.end?.date, endTz);
        const displayTz = context?.timeZone;
        const allDay = Boolean(event.start?.date && !event.start?.dateTime);

        return {
          success: true,
          eventId: event.id,
          summary: event.summary,
          start: startUtc,
          end: endUtc,
          // Localized display when the host supplied the viewer's timezone; the
          // canonical start/end above stay UTC for round-trip. All-day events
          // render as a date with no zone conversion so the day doesn't shift.
          ...(displayTz
            ? {
                startLocal: utcIsoToLocalDisplay(startUtc, displayTz, allDay),
                endLocal: utcIsoToLocalDisplay(endUtc, displayTz, allDay),
              }
            : {}),
          timeZone: tz,
          organizer: event.organizer?.email,
          attendees: attendees.length > 0 ? attendees : undefined,
          location: event.location,
          meetLink,
          htmlLink: event.htmlLink,
          description,
          isOnlineMeeting: Boolean(meetLink || event.hangoutLink || event.conferenceData),
        };
      } catch (error) {
        return connectorFailure(connector, {
          success: false,
          isOnlineMeeting: false,
          error: formatGoogleToolError('Failed to get meeting', error),
        });
      }
    },
  };
}
