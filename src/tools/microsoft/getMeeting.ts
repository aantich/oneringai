import { connectorFailure } from '../connector/enhancedInvocation.js';
/**
 * Microsoft Graph - Get Meeting Tool
 *
 * Retrieve full details of a single calendar event by its event ID.
 * Returns all meeting metadata including the online meeting join URL,
 * attendee list, full body, and organizer info.
 *
 * Requires Calendars.Read or Calendars.ReadWrite permission.
 */

import type { Connector } from '../../core/Connector.js';
import type { ToolFunction, ToolContext } from '../../domain/entities/Tool.js';
import {
  type MicrosoftGetMeetingResult,
  type GraphCalendarViewEvent,
  getUserPathPrefix,
  shouldExposeTargetUserParam,
  TARGET_USER_PARAM_SCHEMA,
  microsoftFetch,
  formatMicrosoftToolError,
  graphDateTimeToUtcIso,
} from './types.js';
import { utcIsoToLocalDisplay } from '../calendar/dateTime.js';

export interface GetMeetingArgs {
  eventId: string;
  targetUser?: string;
}

/** Zoom URL regex — matches zoom.us/j/<id> in any text */
const ZOOM_URL_RE = /https?:\/\/[\w.-]*zoom\.us\/j\/\d[\w?=&/.-]*/i;

/**
 * Extract the best available online meeting join URL from a calendar event.
 * Falls back to scanning the body HTML for Zoom links.
 */
function extractJoinUrl(event: GraphCalendarViewEvent): string | undefined {
  if (event.onlineMeeting?.joinUrl) return event.onlineMeeting.joinUrl;
  if (event.onlineMeetingUrl) return event.onlineMeetingUrl;

  // Fallback: scan full body for a Zoom link
  const bodyContent = event.body?.content;
  if (bodyContent) {
    const match = bodyContent.match(ZOOM_URL_RE);
    if (match) return match[0];
  }
  if (event.bodyPreview) {
    const match = event.bodyPreview.match(ZOOM_URL_RE);
    if (match) return match[0];
  }
  return undefined;
}

/**
 * Strip HTML tags and collapse whitespace for a plain text body.
 */
function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Create a Microsoft Graph get_meeting tool
 *
 * @param actAs Lock the on-behalf-of user; when set, the LLM cannot override.
 */
export function createGetMeetingTool(
  connector: Connector,
  userId?: string,
  actAs?: string,
): ToolFunction<GetMeetingArgs, MicrosoftGetMeetingResult> {
  const exposeTargetUser = shouldExposeTargetUserParam(connector, actAs);
  const properties: Record<string, unknown> = {
    eventId: {
      type: 'string',
      description: 'Calendar event ID from a list_meetings result or create_meeting result. Example: "AAMkADI1M2I3YzgtODg..."',
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
        description: `Get full details of a single calendar event by its event ID via Microsoft Graph.

Returns the complete meeting info: subject, time, organizer, attendees, location, body content, and online meeting join URL. The join URL may be Teams, Zoom, or any other provider.

WHEN TO USE:
- To get the full details of a specific meeting (e.g., body content, full attendee list)
- When you have an eventId from list_meetings and need more detail
- To find the online meeting join URL for transcript retrieval

TRANSCRIPT WORKFLOW:
Look at the joinUrl field in the result:
- If joinUrl contains "teams.microsoft.com" → use the get_meeting_transcript tool with the Teams meeting URL
- If joinUrl contains "zoom.us" → use the zoom_get_transcript tool with the Zoom meeting URL
- If joinUrl is empty, the meeting had no online component

PARAMETER FORMATS:
- eventId: The calendar event ID string (starts with "AAMk..." or similar). Get this from a list_meetings result.

RESPONSE FORMAT:
"start" and "end" are returned as UTC ISO 8601 strings ending with "Z" (e.g. "2026-05-22T09:00:00.000Z"). When the user's timezone is known, "startLocal"/"endLocal" carry — for a timed meeting the local wall-clock time (e.g. "Thu, May 22, 2026, 2:30 PM EDT"), for an all-day meeting a date with no time. State times to the user using these when present, and never convert "start"/"end" yourself. Pass the canonical "start"/"end" UTC values verbatim when calling other tools.

EXAMPLES:
- { "eventId": "AAMkADI1M2I3YzgtODg..." }`,
        parameters: {
          type: 'object',
          properties,
          required: ['eventId'],
        },
      },
    },

    describeCall: (args: GetMeetingArgs): string => {
      return `Get meeting ${args.eventId.slice(0, 16)}...`;
    },

    permission: {
      scope: 'session',
      riskLevel: 'low',
      approvalMessage: `Get calendar event details via ${connector.displayName}`,
    },

    execute: async (
      args: GetMeetingArgs,
      context?: ToolContext
    ): Promise<MicrosoftGetMeetingResult> => {
      const effectiveUserId = context?.userId ?? userId;
      const effectiveAccountId = context?.accountId;
      try {
        const prefix = getUserPathPrefix(connector, args.targetUser, actAs);

        const selectFields = [
          'id', 'subject', 'body', 'bodyPreview', 'start', 'end', 'isAllDay',
          'organizer', 'attendees', 'location',
          'isOnlineMeeting', 'onlineMeeting', 'onlineMeetingUrl', 'webLink',
        ].join(',');

        const event = await microsoftFetch<GraphCalendarViewEvent>(
          connector,
          `${prefix}/events/${args.eventId}`,
          {
            userId: effectiveUserId,
            accountId: effectiveAccountId,
            queryParams: { '$select': selectFields },
          }
        );

        // Extract plain text body from HTML
        let bodyText: string | undefined;
        if (event.body?.content) {
          bodyText = event.body.contentType === 'text'
            ? event.body.content
            : stripHtml(event.body.content);
        }

        const tz = event.start?.timeZone;
        // UTC ISO Z — see graphDateTimeToUtcIso for why naïve Graph times
        // must be normalized here rather than at every consumer.
        const startUtc = graphDateTimeToUtcIso(event.start?.dateTime, tz);
        const endUtc = graphDateTimeToUtcIso(event.end?.dateTime, event.end?.timeZone ?? tz);
        const displayTz = context?.timeZone;
        const allDay = Boolean(event.isAllDay);
        return {
          success: true,
          eventId: event.id,
          subject: event.subject,
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
          organizer: event.organizer?.emailAddress?.address,
          attendees: event.attendees
            ?.filter((a) => a.type !== 'resource')
            .map((a) => a.emailAddress.address),
          location: event.location?.displayName || undefined,
          joinUrl: extractJoinUrl(event),
          webLink: event.webLink,
          body: bodyText,
          isOnlineMeeting: !!event.isOnlineMeeting,
        };
      } catch (error) {
        return connectorFailure(connector, {
          success: false,
          isOnlineMeeting: false,
          error: formatMicrosoftToolError('Failed to get meeting', error),
        });
      }
    },
  };
}
