/**
 * Unified Find Meeting Slots Tool
 *
 * Aggregates busy intervals from multiple calendar providers (Microsoft, Google, etc.)
 * and computes meeting slots where ALL attendees across ALL providers are free.
 *
 * Pattern:
 * 1. Accept ICalendarSlotsProvider[] at construction
 * 2. Each provider returns raw busy intervals (not computed slots)
 * 3. Merge all busy data and compute unified free slots in one place
 */

import type { ToolFunction, ToolContext } from '../../domain/entities/Tool.js';
import type {
  ICalendarSlotsProvider,
  FindMeetingSlotsArgs,
  GetBusyIntervalsArgs,
  MeetingSlotSuggestion,
  UnifiedFindSlotsResult,
  UnifiedFindMeetingSlotsOptions,
} from './types.js';

// ============================================================================
// Unified Tool Args (extends base with attendeeMapping)
// ============================================================================

interface UnifiedFindMeetingSlotsArgs extends FindMeetingSlotsArgs {
  /**
   * Optional mapping of attendee email → provider name.
   * When provided, each attendee is only sent to their assigned provider.
   * When omitted, all attendees are sent to all providers.
   */
  attendeeMapping?: Record<string, string>;
}

// ============================================================================
// Slot Computation
// ============================================================================

/**
 * Parse an ISO datetime string into a Date.
 * Naive datetimes (no Z or offset) are treated as UTC.
 */
function parseDateTime(dt: string): Date {
  if (/[Zz]$/.test(dt) || /[+-]\d{2}:\d{2}$/.test(dt)) {
    return new Date(dt);
  }
  return new Date(dt + 'Z');
}

/**
 * Compute free slots from per-attendee busy data.
 *
 * Scans the time window at 15-minute steps and returns slots where
 * ALL attendees are free simultaneously.
 */
function computeFreeSlots(
  busyByAttendee: Map<string, { start: number; end: number }[]>,
  windowStart: Date,
  windowEnd: Date,
  durationMs: number,
  maxResults: number,
): MeetingSlotSuggestion[] {
  const attendees = Array.from(busyByAttendee.keys());
  const STEP_MS = 15 * 60 * 1000;
  const slots: MeetingSlotSuggestion[] = [];

  for (
    let candidateStart = windowStart.getTime();
    candidateStart + durationMs <= windowEnd.getTime() && slots.length < maxResults;
    candidateStart += STEP_MS
  ) {
    const candidateEnd = candidateStart + durationMs;

    const attendeeAvailability: { attendee: string; availability: string }[] = [];
    let allFree = true;

    for (const attendee of attendees) {
      const busyIntervals = busyByAttendee.get(attendee) ?? [];
      const isBusy = busyIntervals.some(
        b => b.start < candidateEnd && b.end > candidateStart
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

// ============================================================================
// Tool Factory
// ============================================================================

/**
 * Create a unified find_meeting_slots tool that aggregates across multiple
 * calendar providers.
 *
 * Each provider returns raw busy intervals from its calendar API.
 * This tool merges all busy data and computes free slots in one place.
 *
 * @param providers - Calendar providers to query (e.g., Google, Microsoft)
 * @param options - Optional configuration (attendee mapping, etc.)
 *
 * @example
 * ```typescript
 * const googleProvider = createGoogleCalendarSlotsProvider(googleConnector);
 * const msftProvider = createMicrosoftCalendarSlotsProvider(msftConnector);
 *
 * const tool = createUnifiedFindMeetingSlotsTool([googleProvider, msftProvider]);
 * const result = await tool.execute({
 *   attendees: ['alice@google.com', 'bob@microsoft.com'],
 *   startDateTime: '2025-01-15T08:00:00',
 *   endDateTime: '2025-01-15T18:00:00',
 *   duration: 30,
 * });
 * ```
 */
export function createUnifiedFindMeetingSlotsTool(
  providers: ICalendarSlotsProvider[],
  options?: UnifiedFindMeetingSlotsOptions,
): ToolFunction<UnifiedFindMeetingSlotsArgs, UnifiedFindSlotsResult> {
  if (providers.length === 0) {
    throw new Error('At least one calendar provider is required');
  }

  const providerNames = providers.map(p => p.name).join(', ');

  return {
    definition: {
      type: 'function',
      function: {
        name: 'find_meeting_slots',
        description: `Find available meeting time slots across multiple calendar systems (${providerNames}).

Checks each attendee's calendar across all connected providers and suggests times when everyone is available.

PARAMETER FORMATS:
- attendees: plain string array of email addresses. Example: ["alice@google.com", "bob@microsoft.com"]. Do NOT use objects — just plain email strings.
- startDateTime/endDateTime: ISO 8601 string without timezone suffix. Example: "2025-01-15T08:00:00". Can span multiple days.
- duration: number of minutes as integer. Example: 30 or 60.
- timeZone: IANA timezone string. Example: "America/New_York", "Europe/Zurich". Default: "UTC".
- maxResults: integer. Default: 5.
- attendeeMapping: optional object mapping attendee email → provider name. When omitted, all attendees are checked against all providers.

EXAMPLES:
- Basic: { "attendees": ["alice@google.com", "bob@outlook.com"], "startDateTime": "2025-01-15T08:00:00", "endDateTime": "2025-01-15T18:00:00", "duration": 30 }
- With routing: { "attendees": ["alice@google.com", "bob@outlook.com"], "startDateTime": "2025-01-15T08:00:00", "endDateTime": "2025-01-15T18:00:00", "duration": 30, "attendeeMapping": { "alice@google.com": "Google", "bob@outlook.com": "Microsoft" } }`,
        parameters: {
          type: 'object',
          properties: {
            attendees: {
              type: 'array',
              items: { type: 'string' },
              description: 'Attendee email addresses as plain strings.',
            },
            startDateTime: {
              type: 'string',
              description: 'Search window start as ISO 8601. Example: "2025-01-15T08:00:00"',
            },
            endDateTime: {
              type: 'string',
              description: 'Search window end as ISO 8601. Example: "2025-01-15T18:00:00"',
            },
            duration: {
              type: 'number',
              description: 'Meeting duration in minutes. Example: 30 or 60.',
            },
            timeZone: {
              type: 'string',
              description: 'IANA timezone. Default: "UTC".',
            },
            maxResults: {
              type: 'number',
              description: 'Max slot suggestions. Default: 5.',
            },
            attendeeMapping: {
              type: 'object',
              description: 'Optional: map attendee email → provider name to route attendees to specific providers.',
              additionalProperties: { type: 'string' },
            },
          },
          required: ['attendees', 'startDateTime', 'endDateTime', 'duration'],
        },
      },
    },

    describeCall: (args: UnifiedFindMeetingSlotsArgs): string => {
      return `Find ${args.duration}min slots for ${args.attendees.length} attendees across ${providers.length} providers`;
    },

    permission: {
      scope: 'session',
      riskLevel: 'low',
      approvalMessage: `Find meeting slots across ${providerNames}`,
    },

    execute: async (
      args: UnifiedFindMeetingSlotsArgs,
      context?: ToolContext,
    ): Promise<UnifiedFindSlotsResult> => {
      try {
        const maxResults = args.maxResults ?? 5;
        const durationMs = args.duration * 60 * 1000;
        const windowStart = parseDateTime(args.startDateTime);
        const windowEnd = parseDateTime(args.endDateTime);
        const mapping = args.attendeeMapping ?? options?.attendeeMapping;

        // ---- Route attendees to providers ----

        const providerAttendees = new Map<ICalendarSlotsProvider, string[]>();

        if (mapping) {
          const providerByName = new Map(providers.map(p => [p.name, p]));

          for (const attendee of args.attendees) {
            const providerName = mapping[attendee] ?? mapping[attendee.toLowerCase()];
            if (providerName) {
              const provider = providerByName.get(providerName);
              if (provider) {
                const list = providerAttendees.get(provider) ?? [];
                list.push(attendee);
                providerAttendees.set(provider, list);
                continue;
              }
            }
            // No mapping or unknown provider — send to all
            for (const provider of providers) {
              const list = providerAttendees.get(provider) ?? [];
              list.push(attendee);
              providerAttendees.set(provider, list);
            }
          }
        } else {
          for (const provider of providers) {
            providerAttendees.set(provider, [...args.attendees]);
          }
        }

        // ---- Fetch busy intervals from all providers in parallel ----

        const providerResults = await Promise.allSettled(
          Array.from(providerAttendees.entries())
            .filter(([, attendees]) => attendees.length > 0)
            .map(async ([provider, attendees]) => {
              const providerArgs: GetBusyIntervalsArgs = {
                attendees,
                startDateTime: args.startDateTime,
                endDateTime: args.endDateTime,
                timeZone: args.timeZone,
              };
              const result = await provider.execute(providerArgs, context);
              return { provider, result };
            })
        );

        // ---- Merge busy intervals ----

        const providerErrors: Record<string, string> = {};
        // Store busy intervals as epoch ms for fast comparison
        const allBusy = new Map<string, { start: number; end: number }[]>();

        for (const settled of providerResults) {
          if (settled.status === 'rejected') {
            const error = settled.reason instanceof Error
              ? settled.reason.message
              : String(settled.reason);
            providerErrors['unknown'] = error;
            continue;
          }

          const { provider, result } = settled.value;

          if (!result.success) {
            providerErrors[provider.name] = result.error ?? 'Unknown error';
            continue;
          }

          // Merge busy intervals into the global map
          for (const [attendee, intervals] of Object.entries(result.busyIntervals ?? {})) {
            const existing = allBusy.get(attendee) ?? [];
            for (const interval of intervals) {
              existing.push({
                start: parseDateTime(interval.start).getTime(),
                end: parseDateTime(interval.end).getTime(),
              });
            }
            allBusy.set(attendee, existing);
          }
        }

        // Ensure every requested attendee is in the map
        for (const attendee of args.attendees) {
          if (!allBusy.has(attendee)) {
            // No data from any provider — treat as free (optimistic)
            allBusy.set(attendee, []);
          }
        }

        // ---- Compute unified free slots ----

        const slots = computeFreeSlots(allBusy, windowStart, windowEnd, durationMs, maxResults);

        let emptySuggestionsReason: string | undefined;
        if (slots.length === 0) {
          const hasErrors = Object.keys(providerErrors).length > 0;
          if (hasErrors) {
            const errorProviders = Object.keys(providerErrors).join(', ');
            emptySuggestionsReason = `No free slots found. Some providers had errors: ${errorProviders}. ` +
              'Results may be incomplete.';
          } else {
            emptySuggestionsReason = 'No free slots found in the specified time window where all attendees are available.';
          }
        }

        return {
          success: true,
          slots,
          emptySuggestionsReason,
          providerErrors: Object.keys(providerErrors).length > 0 ? providerErrors : undefined,
        };
      } catch (error) {
        return {
          success: false,
          error: `Failed to find meeting slots: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  };
}
