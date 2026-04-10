/**
 * Calendar Slots Provider Adapters
 *
 * Each provider calls its vendor's busy/schedule API directly and returns
 * raw per-attendee busy intervals. The unified tool does all slot computation.
 */

import type { Connector } from '../../core/Connector.js';
import type {
  ICalendarSlotsProvider,
  GetBusyIntervalsArgs,
  GetBusyIntervalsResult,
  BusyInterval,
} from './types.js';

import { googleFetch, type GoogleFreeBusyResponse } from '../google/types.js';
import { microsoftFetch, getUserPathPrefix } from '../microsoft/types.js';

// ============================================================================
// Google Calendar Provider — uses freeBusy API
// ============================================================================

/**
 * Create a Google Calendar provider that fetches busy intervals via the
 * Google Calendar freeBusy API.
 *
 * @param connector - A connector with serviceType 'google-api'
 * @param name - Display name (default: connector.displayName or "Google")
 * @param userId - Optional user ID for multi-user scenarios
 */
export function createGoogleCalendarSlotsProvider(
  connector: Connector,
  name?: string,
  userId?: string,
): ICalendarSlotsProvider {
  const displayName = name ?? connector.displayName ?? 'Google';

  return {
    name: displayName,

    async execute(args: GetBusyIntervalsArgs): Promise<GetBusyIntervalsResult> {
      try {
        const tz = args.timeZone ?? 'UTC';

        const response = await googleFetch<GoogleFreeBusyResponse>(
          connector,
          '/calendar/v3/freeBusy',
          {
            method: 'POST',
            userId,
            body: {
              timeMin: ensureRfc3339(args.startDateTime),
              timeMax: ensureRfc3339(args.endDateTime),
              timeZone: tz,
              items: args.attendees.map(email => ({ id: email })),
            },
          }
        );

        const busyIntervals: Record<string, BusyInterval[]> = {};
        const calendars = response.calendars ?? {};

        for (const attendee of args.attendees) {
          const cal = calendars[attendee];
          if (!cal || (cal.errors && cal.errors.length > 0)) {
            // No data or error for this attendee — report empty (unknown)
            busyIntervals[attendee] = [];
            continue;
          }
          busyIntervals[attendee] = (cal.busy ?? []).map(b => ({
            start: b.start,
            end: b.end,
          }));
        }

        return { success: true, busyIntervals };
      } catch (error) {
        return {
          success: false,
          error: `Google freeBusy failed: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  };
}

// ============================================================================
// Microsoft Calendar Provider — uses getSchedule API
// ============================================================================

/** @internal Microsoft getSchedule response */
interface MsftScheduleResponse {
  value: {
    scheduleId: string;
    availabilityView?: string;
    scheduleItems?: {
      status: string;
      start: { dateTime: string; timeZone: string };
      end: { dateTime: string; timeZone: string };
    }[];
    error?: { responseCode: string; message: string };
  }[];
}

/**
 * Create a Microsoft Calendar provider that fetches busy intervals via the
 * Microsoft Graph getSchedule API.
 *
 * Uses `POST /me/calendar/getSchedule` which returns per-attendee schedule
 * items (busy/tentative/OOF periods) directly.
 *
 * @param connector - A connector with serviceType 'microsoft'
 * @param name - Display name (default: connector.displayName or "Microsoft")
 * @param userId - Optional user ID for multi-user scenarios
 */
export function createMicrosoftCalendarSlotsProvider(
  connector: Connector,
  name?: string,
  userId?: string,
): ICalendarSlotsProvider {
  const displayName = name ?? connector.displayName ?? 'Microsoft';

  return {
    name: displayName,

    async execute(args: GetBusyIntervalsArgs): Promise<GetBusyIntervalsResult> {
      try {
        const tz = args.timeZone ?? 'UTC';
        const prefix = getUserPathPrefix(connector);

        const response = await microsoftFetch<MsftScheduleResponse>(
          connector,
          `${prefix}/calendar/getSchedule`,
          {
            method: 'POST',
            userId,
            body: {
              schedules: args.attendees,
              startTime: { dateTime: args.startDateTime, timeZone: tz },
              endTime: { dateTime: args.endDateTime, timeZone: tz },
            },
          }
        );

        const busyIntervals: Record<string, BusyInterval[]> = {};

        for (const schedule of response.value ?? []) {
          const attendee = schedule.scheduleId;
          if (schedule.error) {
            // Attendee schedule not accessible — report empty
            busyIntervals[attendee] = [];
            continue;
          }

          busyIntervals[attendee] = (schedule.scheduleItems ?? [])
            .filter(item => item.status !== 'free')
            .map(item => ({
              start: item.start.dateTime,
              end: item.end.dateTime,
            }));
        }

        // Ensure all requested attendees are in the result
        for (const attendee of args.attendees) {
          if (!(attendee in busyIntervals)) {
            busyIntervals[attendee] = [];
          }
        }

        return { success: true, busyIntervals };
      } catch (error) {
        return {
          success: false,
          error: `Microsoft getSchedule failed: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  };
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Ensure a datetime string is RFC3339 (has timezone info).
 * Appends 'Z' to naive datetimes.
 */
function ensureRfc3339(dt: string): string {
  if (/[Zz]$/.test(dt) || /[+-]\d{2}:\d{2}$/.test(dt)) return dt;
  return dt + 'Z';
}
