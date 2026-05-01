/**
 * Microsoft Graph - List Meetings Tool
 *
 * List calendar events in a given time window via the calendarView API.
 * Returns key info for each event including online meeting join URLs,
 * which may be Teams, Zoom, or any other meeting provider.
 *
 * Requires Calendars.Read or Calendars.ReadWrite permission.
 */

import type { Connector } from '../../core/Connector.js';
import type { ToolFunction, ToolContext } from '../../domain/entities/Tool.js';
import {
  type MicrosoftListMeetingsResult,
  type MeetingListEntry,
  type GraphCalendarViewResponse,
  type GraphCalendarViewEvent,
  getUserPathPrefix,
  shouldExposeTargetUserParam,
  TARGET_USER_PARAM_SCHEMA,
  microsoftFetch,
  formatMicrosoftToolError,
} from './types.js';

export interface ListMeetingsArgs {
  startDateTime: string;
  endDateTime: string;
  timeZone?: string;
  maxResults?: number;
  targetUser?: string;
}

/** Zoom URL regex — matches zoom.us/j/<id> in any text */
const ZOOM_URL_RE = /https?:\/\/[\w.-]*zoom\.us\/j\/\d[\w?=&/.-]*/i;

/**
 * Extract the best available online meeting join URL from a calendar event.
 *
 * Priority:
 * 1. onlineMeeting.joinUrl (structured field — Teams, Zoom plugin, etc.)
 * 2. onlineMeetingUrl (legacy/flat field)
 * 3. Zoom URL extracted from bodyPreview (fallback for events where
 *    the Zoom link is pasted in the body but not set as onlineMeeting)
 */
function extractJoinUrl(event: GraphCalendarViewEvent): string | undefined {
  if (event.onlineMeeting?.joinUrl) return event.onlineMeeting.joinUrl;
  if (event.onlineMeetingUrl) return event.onlineMeetingUrl;

  // Fallback: scan body preview for a Zoom link
  if (event.bodyPreview) {
    const match = event.bodyPreview.match(ZOOM_URL_RE);
    if (match) return match[0];
  }
  return undefined;
}

/**
 * Map a Graph API calendar event to a compact meeting entry.
 */
function toMeetingEntry(event: GraphCalendarViewEvent): MeetingListEntry {
  return {
    eventId: event.id,
    subject: event.subject ?? '(no subject)',
    start: event.start?.dateTime ?? '',
    end: event.end?.dateTime ?? '',
    timeZone: event.start?.timeZone ?? 'UTC',
    organizer: event.organizer?.emailAddress?.address,
    attendees: event.attendees
      ?.filter((a) => a.type !== 'resource')
      .map((a) => a.emailAddress.address),
    location: event.location?.displayName || undefined,
    joinUrl: extractJoinUrl(event),
    isOnlineMeeting: !!event.isOnlineMeeting,
    bodyPreview: event.bodyPreview || undefined,
  };
}

/**
 * Create a Microsoft Graph list_meetings tool
 *
 * @param actAs Lock the on-behalf-of user; when set, the LLM cannot override.
 */
export function createListMeetingsTool(
  connector: Connector,
  userId?: string,
  actAs?: string,
): ToolFunction<ListMeetingsArgs, MicrosoftListMeetingsResult> {
  const exposeTargetUser = shouldExposeTargetUserParam(connector, actAs);
  const properties: Record<string, unknown> = {
    startDateTime: {
      type: 'string',
      description: 'Start of time window as ISO 8601 string without timezone suffix. Example: "2025-01-13T00:00:00"',
    },
    endDateTime: {
      type: 'string',
      description: 'End of time window as ISO 8601 string without timezone suffix. Example: "2025-01-17T23:59:59"',
    },
    timeZone: {
      type: 'string',
      description: 'IANA timezone string for interpreting start/end times. Example: "America/New_York", "Europe/Zurich". Default: "UTC".',
    },
    maxResults: {
      type: 'number',
      description: 'Maximum number of events to return (1-100). Default: 25.',
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
        description: `List calendar events (meetings) from the user's Outlook calendar within a time window via Microsoft Graph.

Returns key details for each meeting including the online meeting join URL. The join URL may point to Microsoft Teams, Zoom, or any other meeting provider — use it to determine which platform hosted the meeting.

WHEN TO USE:
- To find meetings in a date range (e.g., "what meetings did I have last week?")
- To find the join URL for a specific meeting so you can retrieve its transcript
- To get a list of upcoming or past meetings with attendee info

TRANSCRIPT WORKFLOW:
After listing meetings, look at each meeting's joinUrl field:
- If joinUrl contains "teams.microsoft.com" → use the get_meeting_transcript tool with the Teams meeting URL
- If joinUrl contains "zoom.us" → use the zoom_get_transcript tool with the Zoom meeting URL
- If joinUrl is empty, the meeting had no online component (no transcript available)

PARAMETER FORMATS:
- startDateTime: ISO 8601 WITHOUT timezone suffix. Example: "2025-01-13T00:00:00"
- endDateTime: ISO 8601 WITHOUT timezone suffix. Example: "2025-01-17T23:59:59"
- timeZone: IANA timezone string. Example: "America/New_York". Default: "UTC"
- maxResults: integer, 1-100. Default: 25

EXAMPLES:
- This week: { "startDateTime": "2025-01-13T00:00:00", "endDateTime": "2025-01-17T23:59:59", "timeZone": "America/New_York" }
- Today only: { "startDateTime": "2025-01-15T00:00:00", "endDateTime": "2025-01-15T23:59:59", "timeZone": "Europe/Zurich" }
- Last 7 days: { "startDateTime": "2025-01-08T00:00:00", "endDateTime": "2025-01-15T23:59:59" }`,
        parameters: {
          type: 'object',
          properties,
          required: ['startDateTime', 'endDateTime'],
        },
      },
    },

    describeCall: (args: ListMeetingsArgs): string => {
      return `List meetings from ${args.startDateTime} to ${args.endDateTime}`;
    },

    permission: {
      scope: 'session',
      riskLevel: 'low',
      approvalMessage: `List calendar events via ${connector.displayName}`,
    },

    execute: async (
      args: ListMeetingsArgs,
      context?: ToolContext
    ): Promise<MicrosoftListMeetingsResult> => {
      const effectiveUserId = context?.userId ?? userId;
      const effectiveAccountId = context?.accountId;
      try {
        const prefix = getUserPathPrefix(connector, args.targetUser, actAs);
        const top = Math.min(Math.max(args.maxResults ?? 25, 1), 100);

        const selectFields = [
          'id', 'subject', 'bodyPreview', 'start', 'end',
          'organizer', 'attendees', 'location',
          'isOnlineMeeting', 'onlineMeeting', 'onlineMeetingUrl', 'webLink',
        ].join(',');

        const response = await microsoftFetch<GraphCalendarViewResponse>(
          connector,
          `${prefix}/calendarView`,
          {
            userId: effectiveUserId,
            accountId: effectiveAccountId,
            headers: {
              'Prefer': `outlook.timezone="${args.timeZone ?? 'UTC'}"`,
            },
            queryParams: {
              startDateTime: args.startDateTime,
              endDateTime: args.endDateTime,
              '$select': selectFields,
              '$top': top,
              '$orderby': 'start/dateTime',
            },
          }
        );

        const meetings = (response.value ?? []).map(toMeetingEntry);

        return {
          success: true,
          meetings,
          totalCount: meetings.length,
        };
      } catch (error) {
        return {
          success: false,
          error: formatMicrosoftToolError('Failed to list meetings', error),
        };
      }
    },
  };
}
