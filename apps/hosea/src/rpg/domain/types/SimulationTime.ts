import type { TimeSlot } from './Enums.js';

// Number of time slots per day (morning, afternoon, evening, night)
export const ticksPerDay = 4;

// Tick-based game time abstraction
export interface SimulationTime {
  readonly tick: number;
  readonly day: number;
  readonly timeSlot: TimeSlot;
}

const TIME_SLOTS: readonly TimeSlot[] = ['morning', 'afternoon', 'evening', 'night'];

/**
 * Creates a SimulationTime value object.
 */
export function createSimulationTime(
  tick: number,
  day: number,
  timeSlot: TimeSlot,
): SimulationTime {
  return Object.freeze({ tick, day, timeSlot });
}

/**
 * Advances the simulation time by one tick.
 * Rolls over the time slot and increments the day as needed.
 */
export function advanceTick(time: SimulationTime): SimulationTime {
  const currentSlotIndex = TIME_SLOTS.indexOf(time.timeSlot);
  const nextSlotIndex = (currentSlotIndex + 1) % ticksPerDay;
  const nextTimeSlot = TIME_SLOTS[nextSlotIndex]!;
  const nextTick = time.tick + 1;
  const nextDay = nextSlotIndex === 0 ? time.day + 1 : time.day;
  return createSimulationTime(nextTick, nextDay, nextTimeSlot);
}

/**
 * Returns true if two SimulationTime values represent the same in-game day.
 */
export function isSameDay(a: SimulationTime, b: SimulationTime): boolean {
  return a.day === b.day;
}

/**
 * Returns the absolute number of days between two SimulationTime values.
 */
export function daysBetween(a: SimulationTime, b: SimulationTime): number {
  return Math.abs(a.day - b.day);
}
