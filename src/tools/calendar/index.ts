/**
 * Multi-Connector Calendar Tools
 *
 * Provides a unified find_meeting_slots tool that aggregates busy intervals
 * across multiple calendar providers (Google, Microsoft, etc.).
 *
 * @example
 * ```typescript
 * import {
 *   createUnifiedFindMeetingSlotsTool,
 *   createGoogleCalendarSlotsProvider,
 *   createMicrosoftCalendarSlotsProvider,
 * } from './tools/calendar/index.js';
 *
 * const tool = createUnifiedFindMeetingSlotsTool([
 *   createGoogleCalendarSlotsProvider(googleConnector),
 *   createMicrosoftCalendarSlotsProvider(msftConnector),
 * ]);
 * ```
 */

// Types
export type {
  IMultiConnectorProvider,
  ICalendarSlotsProvider,
  BusyInterval,
  GetBusyIntervalsArgs,
  GetBusyIntervalsResult,
  FindMeetingSlotsArgs,
  MeetingSlotSuggestion,
  FindSlotsResult,
  UnifiedFindSlotsResult,
  UnifiedFindMeetingSlotsOptions,
} from './types.js';

// Unified tool factory
export { createUnifiedFindMeetingSlotsTool } from './findMeetingSlots.js';

// Provider adapters
export {
  createGoogleCalendarSlotsProvider,
  createMicrosoftCalendarSlotsProvider,
} from './providers.js';
