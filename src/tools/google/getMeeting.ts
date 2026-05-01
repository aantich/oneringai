/**
 * Google Calendar - Get Meeting Tool
 *
 * Gets full details of a single calendar event.
 */

import type { Connector } from '../../core/Connector.js';
import type { ToolFunction, ToolContext } from '../../domain/entities/Tool.js';
import {
  type GoogleGetMeetingResult,
  type GoogleCalendarEvent,
  getGoogleUserId,
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
        const calendarUser = getGoogleUserId(connector, args.targetUser, actAs);

        const event = await googleFetch<GoogleCalendarEvent>(
          connector,
          `/calendar/v3/calendars/${calendarUser}/events/${args.eventId}`,
          {
            userId: effectiveUserId,
            accountId: effectiveAccountId,
          }
        );

        const meetLink = extractMeetLink(event);
        const start = event.start?.dateTime ?? event.start?.date ?? '';
        const end = event.end?.dateTime ?? event.end?.date ?? '';
        const tz = event.start?.timeZone ?? 'UTC';

        // Filter out resource attendees
        const attendees = (event.attendees ?? [])
          .filter(a => !a.resource)
          .map(a => a.email);

        // Extract plain text description
        let description = event.description;
        if (description) {
          description = stripHtml(description);
        }

        return {
          success: true,
          eventId: event.id,
          summary: event.summary,
          start,
          end,
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
        return {
          success: false,
          isOnlineMeeting: false,
          error: formatGoogleToolError('Failed to get meeting', error),
        };
      }
    },
  };
}
