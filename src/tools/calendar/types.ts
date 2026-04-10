/**
 * Multi-Connector Calendar Tools — Shared Types
 *
 * Defines the provider interface for calendar operations that can be
 * aggregated across multiple connectors (Microsoft, Google, etc.).
 *
 * This is the first instance of the "multi-connector tool" pattern:
 * a single tool that delegates to multiple vendor-specific providers
 * and merges their results.
 */

// ============================================================================
// Multi-Connector Provider Interface
// ============================================================================

/**
 * Generic interface for a multi-connector provider.
 *
 * Each vendor-specific implementation wraps an existing connector and
 * exposes a uniform method. The aggregator tool calls all providers
 * in parallel and merges results.
 *
 * @template TArgs - The provider arguments type
 * @template TResult - The provider result type
 */
export interface IMultiConnectorProvider<TArgs, TResult> {
  /** Human-readable provider name (e.g., "Google (work)", "Microsoft (personal)") */
  readonly name: string;

  /** Execute the operation against this provider's connector */
  execute(args: TArgs, context?: unknown): Promise<TResult>;
}

// ============================================================================
// Calendar-Specific Types (shared across providers)
// ============================================================================

/**
 * A single busy interval for an attendee.
 */
export interface BusyInterval {
  start: string;
  end: string;
}

/**
 * Args for fetching busy intervals — the provider's actual job.
 */
export interface GetBusyIntervalsArgs {
  attendees: string[];
  startDateTime: string;
  endDateTime: string;
  timeZone?: string;
}

/**
 * Result from fetching busy intervals.
 * Each key is an attendee email, value is their busy periods.
 */
export interface GetBusyIntervalsResult {
  success: boolean;
  /** Per-attendee busy intervals. Key = attendee email. */
  busyIntervals?: Record<string, BusyInterval[]>;
  error?: string;
}

/**
 * Provider interface specifically for calendar busy interval lookups.
 *
 * Providers call their vendor's busy/schedule API directly and return
 * raw busy intervals. The unified tool handles all slot computation.
 */
export type ICalendarSlotsProvider = IMultiConnectorProvider<GetBusyIntervalsArgs, GetBusyIntervalsResult>;

/**
 * Args for the unified find_meeting_slots tool (user-facing).
 */
export interface FindMeetingSlotsArgs {
  attendees: string[];
  startDateTime: string;
  endDateTime: string;
  duration: number;
  timeZone?: string;
  maxResults?: number;
}

/**
 * A single slot suggestion with per-attendee availability.
 * Identical to MeetingSlotSuggestion in both google and microsoft types.
 */
export interface MeetingSlotSuggestion {
  start: string;
  end: string;
  confidence: string;
  attendeeAvailability: { attendee: string; availability: string }[];
}

/**
 * Result from find_meeting_slots — identical shape across all providers.
 */
export interface FindSlotsResult {
  success: boolean;
  slots?: MeetingSlotSuggestion[];
  emptySuggestionsReason?: string;
  error?: string;
}

/**
 * Options for the unified find_meeting_slots tool.
 */
export interface UnifiedFindMeetingSlotsOptions {
  /**
   * Optional mapping of attendee email → provider name.
   *
   * When provided, each attendee is only sent to their assigned provider,
   * reducing unnecessary API calls and avoiding errors for unknown attendees.
   *
   * When omitted, all attendees are sent to all providers. Providers are
   * expected to gracefully ignore attendees they can't resolve.
   */
  attendeeMapping?: Record<string, string>;
}

/**
 * Result from the unified find_meeting_slots tool.
 * Extends FindSlotsResult with per-provider error details.
 */
export interface UnifiedFindSlotsResult extends FindSlotsResult {
  /** Per-provider errors (provider name → error message). Only present if some providers failed. */
  providerErrors?: Record<string, string>;
}
