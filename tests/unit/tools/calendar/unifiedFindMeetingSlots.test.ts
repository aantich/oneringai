/**
 * Tests for Unified Find Meeting Slots Tool
 */

import { describe, it, expect } from 'vitest';
import {
  createUnifiedFindMeetingSlotsTool,
  type ICalendarSlotsProvider,
  type GetBusyIntervalsArgs,
  type GetBusyIntervalsResult,
  type BusyInterval,
} from '../../../../src/tools/calendar/index.js';

// ============================================================================
// Mock Providers
// ============================================================================

/**
 * Create a mock calendar provider that returns predefined busy intervals.
 */
function createMockProvider(
  name: string,
  handler: (args: GetBusyIntervalsArgs) => Promise<GetBusyIntervalsResult>,
): ICalendarSlotsProvider {
  return { name, execute: handler };
}

/**
 * Create a provider that returns specific busy intervals per attendee.
 */
function createProviderWithBusy(
  name: string,
  busyMap: Record<string, BusyInterval[]>,
): ICalendarSlotsProvider {
  return createMockProvider(name, async () => ({
    success: true,
    busyIntervals: busyMap,
  }));
}

/**
 * Create a provider where all attendees are completely free.
 */
function createFreeProvider(name: string): ICalendarSlotsProvider {
  return createMockProvider(name, async (args) => ({
    success: true,
    busyIntervals: Object.fromEntries(args.attendees.map(a => [a, []])),
  }));
}

/**
 * Create a provider that always fails.
 */
function createFailingProvider(name: string, error: string): ICalendarSlotsProvider {
  return createMockProvider(name, async () => ({
    success: false,
    error,
  }));
}

/**
 * Create a provider that throws.
 */
function createThrowingProvider(name: string, error: string): ICalendarSlotsProvider {
  return createMockProvider(name, async () => {
    throw new Error(error);
  });
}

// ============================================================================
// Tests
// ============================================================================

describe('Unified Find Meeting Slots Tool', () => {

  // ========================================================================
  // Construction
  // ========================================================================

  describe('construction', () => {
    it('should throw if no providers given', () => {
      expect(() => createUnifiedFindMeetingSlotsTool([])).toThrow('At least one calendar provider');
    });

    it('should create tool with single provider', () => {
      const tool = createUnifiedFindMeetingSlotsTool([createFreeProvider('Google')]);
      expect(tool.definition.function.name).toBe('find_meeting_slots');
    });

    it('should include provider names in description', () => {
      const tool = createUnifiedFindMeetingSlotsTool([
        createFreeProvider('Google'),
        createFreeProvider('Microsoft'),
      ]);
      expect(tool.definition.function.description).toContain('Google');
      expect(tool.definition.function.description).toContain('Microsoft');
    });
  });

  // ========================================================================
  // Single provider — all free
  // ========================================================================

  describe('single provider - all free', () => {
    it('should return free slots when attendee has no busy intervals', async () => {
      const tool = createUnifiedFindMeetingSlotsTool([createFreeProvider('Google')]);
      const result = await tool.execute({
        attendees: ['alice@google.com'],
        startDateTime: '2025-01-15T08:00:00Z',
        endDateTime: '2025-01-15T10:00:00Z',
        duration: 30,
        maxResults: 5,
      });

      expect(result.success).toBe(true);
      expect(result.slots!.length).toBe(5);
      expect(result.slots![0]!.start).toContain('2025-01-15T08:00:00');
      expect(result.slots![0]!.attendeeAvailability[0]!.availability).toBe('free');
    });
  });

  // ========================================================================
  // Single provider — with busy
  // ========================================================================

  describe('single provider - with busy intervals', () => {
    it('should skip slots where attendee is busy', async () => {
      const provider = createProviderWithBusy('Google', {
        'alice@google.com': [
          { start: '2025-01-15T08:00:00Z', end: '2025-01-15T09:00:00Z' },
        ],
      });

      const tool = createUnifiedFindMeetingSlotsTool([provider]);
      const result = await tool.execute({
        attendees: ['alice@google.com'],
        startDateTime: '2025-01-15T08:00:00Z',
        endDateTime: '2025-01-15T10:00:00Z',
        duration: 30,
        maxResults: 10,
      });

      expect(result.success).toBe(true);
      // No slots during 8:00-9:00 (alice busy), first slot at 9:00
      expect(result.slots!.length).toBeGreaterThan(0);
      const firstSlot = result.slots![0]!;
      expect(new Date(firstSlot.start).getTime()).toBeGreaterThanOrEqual(
        new Date('2025-01-15T09:00:00Z').getTime()
      );
    });

    it('should return no slots when attendee is busy the entire window', async () => {
      const provider = createProviderWithBusy('Google', {
        'alice@google.com': [
          { start: '2025-01-15T08:00:00Z', end: '2025-01-15T18:00:00Z' },
        ],
      });

      const tool = createUnifiedFindMeetingSlotsTool([provider]);
      const result = await tool.execute({
        attendees: ['alice@google.com'],
        startDateTime: '2025-01-15T08:00:00Z',
        endDateTime: '2025-01-15T18:00:00Z',
        duration: 30,
      });

      expect(result.success).toBe(true);
      expect(result.slots).toHaveLength(0);
      expect(result.emptySuggestionsReason).toContain('No free slots');
    });
  });

  // ========================================================================
  // Multiple providers
  // ========================================================================

  describe('multiple providers', () => {
    it('should find slots where attendees from both providers are free', async () => {
      // Alice (Google) busy 8-9am
      const googleProvider = createProviderWithBusy('Google', {
        'alice@google.com': [
          { start: '2025-01-15T08:00:00Z', end: '2025-01-15T09:00:00Z' },
        ],
      });

      // Bob (Microsoft) busy 9-10am
      const msftProvider = createProviderWithBusy('Microsoft', {
        'bob@microsoft.com': [
          { start: '2025-01-15T09:00:00Z', end: '2025-01-15T10:00:00Z' },
        ],
      });

      const tool = createUnifiedFindMeetingSlotsTool([googleProvider, msftProvider]);
      const result = await tool.execute({
        attendees: ['alice@google.com', 'bob@microsoft.com'],
        startDateTime: '2025-01-15T08:00:00Z',
        endDateTime: '2025-01-15T11:00:00Z',
        duration: 30,
        maxResults: 10,
        attendeeMapping: {
          'alice@google.com': 'Google',
          'bob@microsoft.com': 'Microsoft',
        },
      });

      expect(result.success).toBe(true);
      expect(result.slots!.length).toBeGreaterThan(0);

      // No slot should overlap with 8-9 (alice busy) or 9-10 (bob busy)
      for (const slot of result.slots!) {
        const slotStart = new Date(slot.start).getTime();
        const slotEnd = new Date(slot.end).getTime();
        // Not during 8-9
        expect(
          slotStart >= new Date('2025-01-15T09:00:00Z').getTime() ||
          slotEnd <= new Date('2025-01-15T08:00:00Z').getTime()
        ).toBe(true);
        // Not during 9-10
        expect(
          slotStart >= new Date('2025-01-15T10:00:00Z').getTime() ||
          slotEnd <= new Date('2025-01-15T09:00:00Z').getTime()
        ).toBe(true);
        // All attendees should be free in every returned slot
        for (const av of slot.attendeeAvailability) {
          expect(av.availability).toBe('free');
        }
      }

      // First free slot should be at 10:00
      expect(result.slots![0]!.start).toContain('2025-01-15T10:00:00');
    });

    it('should return no slots when providers have no overlap', async () => {
      // Alice busy 10-18
      const googleProvider = createProviderWithBusy('Google', {
        'alice@google.com': [
          { start: '2025-01-15T10:00:00Z', end: '2025-01-15T18:00:00Z' },
        ],
      });

      // Bob busy 8-10
      const msftProvider = createProviderWithBusy('Microsoft', {
        'bob@microsoft.com': [
          { start: '2025-01-15T08:00:00Z', end: '2025-01-15T10:00:00Z' },
        ],
      });

      const tool = createUnifiedFindMeetingSlotsTool([googleProvider, msftProvider]);
      const result = await tool.execute({
        attendees: ['alice@google.com', 'bob@microsoft.com'],
        startDateTime: '2025-01-15T08:00:00Z',
        endDateTime: '2025-01-15T18:00:00Z',
        duration: 60,
        attendeeMapping: {
          'alice@google.com': 'Google',
          'bob@microsoft.com': 'Microsoft',
        },
      });

      expect(result.success).toBe(true);
      expect(result.slots).toHaveLength(0);
    });

    it('should merge busy intervals from same attendee across providers', async () => {
      // Both providers report busy for alice at different times
      const google = createProviderWithBusy('Google', {
        'alice@example.com': [
          { start: '2025-01-15T08:00:00Z', end: '2025-01-15T09:00:00Z' },
        ],
      });
      const msft = createProviderWithBusy('Microsoft', {
        'alice@example.com': [
          { start: '2025-01-15T10:00:00Z', end: '2025-01-15T11:00:00Z' },
        ],
      });

      const tool = createUnifiedFindMeetingSlotsTool([google, msft]);
      const result = await tool.execute({
        attendees: ['alice@example.com'],
        startDateTime: '2025-01-15T08:00:00Z',
        endDateTime: '2025-01-15T12:00:00Z',
        duration: 30,
        maxResults: 20,
      });

      expect(result.success).toBe(true);
      // Should have no slots during 8-9 or 10-11, but slots during 9-10 and 11-12
      for (const slot of result.slots!) {
        const start = new Date(slot.start).getTime();
        const end = new Date(slot.end).getTime();
        const busy1Start = new Date('2025-01-15T08:00:00Z').getTime();
        const busy1End = new Date('2025-01-15T09:00:00Z').getTime();
        const busy2Start = new Date('2025-01-15T10:00:00Z').getTime();
        const busy2End = new Date('2025-01-15T11:00:00Z').getTime();

        // Slot should not overlap with either busy period
        const overlaps1 = start < busy1End && end > busy1Start;
        const overlaps2 = start < busy2End && end > busy2Start;
        expect(overlaps1).toBe(false);
        expect(overlaps2).toBe(false);
      }
    });
  });

  // ========================================================================
  // Attendee routing
  // ========================================================================

  describe('attendee routing', () => {
    it('should route attendees to specific providers via attendeeMapping', async () => {
      let googleReceivedAttendees: string[] = [];
      let msftReceivedAttendees: string[] = [];

      const googleProvider = createMockProvider('Google', async (args) => {
        googleReceivedAttendees = args.attendees;
        return { success: true, busyIntervals: {} };
      });

      const msftProvider = createMockProvider('Microsoft', async (args) => {
        msftReceivedAttendees = args.attendees;
        return { success: true, busyIntervals: {} };
      });

      const tool = createUnifiedFindMeetingSlotsTool([googleProvider, msftProvider]);
      await tool.execute({
        attendees: ['alice@google.com', 'bob@microsoft.com'],
        startDateTime: '2025-01-15T08:00:00Z',
        endDateTime: '2025-01-15T18:00:00Z',
        duration: 30,
        attendeeMapping: {
          'alice@google.com': 'Google',
          'bob@microsoft.com': 'Microsoft',
        },
      });

      expect(googleReceivedAttendees).toEqual(['alice@google.com']);
      expect(msftReceivedAttendees).toEqual(['bob@microsoft.com']);
    });

    it('should send all attendees to all providers when no mapping', async () => {
      let googleReceivedAttendees: string[] = [];
      let msftReceivedAttendees: string[] = [];

      const googleProvider = createMockProvider('Google', async (args) => {
        googleReceivedAttendees = args.attendees;
        return { success: true, busyIntervals: {} };
      });

      const msftProvider = createMockProvider('Microsoft', async (args) => {
        msftReceivedAttendees = args.attendees;
        return { success: true, busyIntervals: {} };
      });

      const tool = createUnifiedFindMeetingSlotsTool([googleProvider, msftProvider]);
      await tool.execute({
        attendees: ['alice@google.com', 'bob@microsoft.com'],
        startDateTime: '2025-01-15T08:00:00Z',
        endDateTime: '2025-01-15T18:00:00Z',
        duration: 30,
      });

      expect(googleReceivedAttendees).toEqual(['alice@google.com', 'bob@microsoft.com']);
      expect(msftReceivedAttendees).toEqual(['alice@google.com', 'bob@microsoft.com']);
    });

    it('should send unmapped attendees to all providers', async () => {
      let googleReceivedAttendees: string[] = [];
      let msftReceivedAttendees: string[] = [];

      const googleProvider = createMockProvider('Google', async (args) => {
        googleReceivedAttendees = args.attendees;
        return { success: true, busyIntervals: {} };
      });

      const msftProvider = createMockProvider('Microsoft', async (args) => {
        msftReceivedAttendees = args.attendees;
        return { success: true, busyIntervals: {} };
      });

      const tool = createUnifiedFindMeetingSlotsTool([googleProvider, msftProvider]);
      await tool.execute({
        attendees: ['alice@google.com', 'bob@microsoft.com', 'charlie@unknown.com'],
        startDateTime: '2025-01-15T08:00:00Z',
        endDateTime: '2025-01-15T18:00:00Z',
        duration: 30,
        attendeeMapping: {
          'alice@google.com': 'Google',
          'bob@microsoft.com': 'Microsoft',
        },
      });

      expect(googleReceivedAttendees).toContain('alice@google.com');
      expect(googleReceivedAttendees).toContain('charlie@unknown.com');
      expect(msftReceivedAttendees).toContain('bob@microsoft.com');
      expect(msftReceivedAttendees).toContain('charlie@unknown.com');
    });
  });

  // ========================================================================
  // Error handling
  // ========================================================================

  describe('error handling', () => {
    it('should continue when one provider fails', async () => {
      const googleProvider = createProviderWithBusy('Google', {
        'alice@google.com': [],
      });
      const msftProvider = createFailingProvider('Microsoft', 'Auth expired');

      const tool = createUnifiedFindMeetingSlotsTool([googleProvider, msftProvider]);
      const result = await tool.execute({
        attendees: ['alice@google.com', 'bob@microsoft.com'],
        startDateTime: '2025-01-15T08:00:00Z',
        endDateTime: '2025-01-15T09:00:00Z',
        duration: 30,
        attendeeMapping: {
          'alice@google.com': 'Google',
          'bob@microsoft.com': 'Microsoft',
        },
      });

      expect(result.success).toBe(true);
      expect(result.providerErrors).toBeDefined();
      expect(result.providerErrors!['Microsoft']).toContain('Auth expired');
      // Should still find slots (bob treated as free since no data)
      expect(result.slots!.length).toBeGreaterThan(0);
    });

    it('should handle throwing providers gracefully', async () => {
      const googleProvider = createFreeProvider('Google');
      const throwingProvider = createThrowingProvider('Broken', 'Connection timeout');

      const tool = createUnifiedFindMeetingSlotsTool([googleProvider, throwingProvider]);
      const result = await tool.execute({
        attendees: ['alice@google.com'],
        startDateTime: '2025-01-15T08:00:00Z',
        endDateTime: '2025-01-15T09:00:00Z',
        duration: 30,
      });

      expect(result.success).toBe(true);
      expect(result.slots!.length).toBeGreaterThan(0);
    });

    it('should report provider errors in result', async () => {
      const failingProvider = createFailingProvider('Google', 'Rate limited');

      const tool = createUnifiedFindMeetingSlotsTool([failingProvider]);
      const result = await tool.execute({
        attendees: ['alice@google.com'],
        startDateTime: '2025-01-15T10:00:00Z',
        endDateTime: '2025-01-15T10:30:00Z',
        duration: 30,
      });

      expect(result.success).toBe(true);
      expect(result.providerErrors).toBeDefined();
      expect(result.providerErrors!['Google']).toContain('Rate limited');
    });
  });

  // ========================================================================
  // API compatibility
  // ========================================================================

  describe('API compatibility', () => {
    it('should match FindSlotsResult shape', async () => {
      const tool = createUnifiedFindMeetingSlotsTool([createFreeProvider('Google')]);
      const result = await tool.execute({
        attendees: ['alice@google.com'],
        startDateTime: '2025-01-15T08:00:00Z',
        endDateTime: '2025-01-15T09:00:00Z',
        duration: 30,
      });

      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('slots');

      const slot = result.slots![0]!;
      expect(slot).toHaveProperty('start');
      expect(slot).toHaveProperty('end');
      expect(slot).toHaveProperty('confidence');
      expect(slot).toHaveProperty('attendeeAvailability');
      expect(slot.attendeeAvailability[0]).toHaveProperty('attendee');
      expect(slot.attendeeAvailability[0]).toHaveProperty('availability');
    });

    it('should use default maxResults of 5', async () => {
      const tool = createUnifiedFindMeetingSlotsTool([createFreeProvider('Google')]);
      const result = await tool.execute({
        attendees: ['alice@google.com'],
        startDateTime: '2025-01-15T08:00:00Z',
        endDateTime: '2025-01-15T18:00:00Z',
        duration: 30,
      });

      expect(result.success).toBe(true);
      expect(result.slots!.length).toBe(5);
    });

    it('should respect custom maxResults', async () => {
      const tool = createUnifiedFindMeetingSlotsTool([createFreeProvider('Google')]);
      const result = await tool.execute({
        attendees: ['alice@google.com'],
        startDateTime: '2025-01-15T08:00:00Z',
        endDateTime: '2025-01-15T18:00:00Z',
        duration: 30,
        maxResults: 2,
      });

      expect(result.success).toBe(true);
      expect(result.slots!.length).toBe(2);
    });
  });

  // ========================================================================
  // describeCall
  // ========================================================================

  describe('describeCall', () => {
    it('should describe the call with attendee count and provider count', () => {
      const tool = createUnifiedFindMeetingSlotsTool([
        createFreeProvider('Google'),
        createFreeProvider('Microsoft'),
      ]);

      const desc = tool.describeCall!({
        attendees: ['a@x.com', 'b@y.com', 'c@z.com'],
        startDateTime: '',
        endDateTime: '',
        duration: 60,
      });

      expect(desc).toContain('60min');
      expect(desc).toContain('3 attendees');
      expect(desc).toContain('2 providers');
    });
  });

  // ========================================================================
  // Options
  // ========================================================================

  describe('options', () => {
    it('should use attendeeMapping from options when not in args', async () => {
      let googleReceived: string[] = [];
      let msftReceived: string[] = [];

      const googleProvider = createMockProvider('Google', async (args) => {
        googleReceived = args.attendees;
        return { success: true, busyIntervals: {} };
      });

      const msftProvider = createMockProvider('Microsoft', async (args) => {
        msftReceived = args.attendees;
        return { success: true, busyIntervals: {} };
      });

      const tool = createUnifiedFindMeetingSlotsTool(
        [googleProvider, msftProvider],
        {
          attendeeMapping: {
            'alice@google.com': 'Google',
            'bob@microsoft.com': 'Microsoft',
          },
        },
      );

      await tool.execute({
        attendees: ['alice@google.com', 'bob@microsoft.com'],
        startDateTime: '2025-01-15T08:00:00Z',
        endDateTime: '2025-01-15T18:00:00Z',
        duration: 30,
      });

      expect(googleReceived).toEqual(['alice@google.com']);
      expect(msftReceived).toEqual(['bob@microsoft.com']);
    });

    it('should prefer args attendeeMapping over options', async () => {
      let googleReceived: string[] = [];

      const googleProvider = createMockProvider('Google', async (args) => {
        googleReceived = args.attendees;
        return { success: true, busyIntervals: {} };
      });

      const msftProvider = createMockProvider('Microsoft', async () => {
        return { success: true, busyIntervals: {} };
      });

      const tool = createUnifiedFindMeetingSlotsTool(
        [googleProvider, msftProvider],
        {
          attendeeMapping: {
            'alice@google.com': 'Microsoft', // options says Microsoft
          },
        },
      );

      await tool.execute({
        attendees: ['alice@google.com'],
        startDateTime: '2025-01-15T08:00:00Z',
        endDateTime: '2025-01-15T18:00:00Z',
        duration: 30,
        attendeeMapping: {
          'alice@google.com': 'Google', // args says Google — should win
        },
      });

      expect(googleReceived).toEqual(['alice@google.com']);
    });
  });
});
