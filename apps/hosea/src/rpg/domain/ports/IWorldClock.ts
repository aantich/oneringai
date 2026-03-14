import type { SimulationTime } from '../types/SimulationTime.js';

/**
 * Port (service interface) for reading and controlling simulation time.
 *
 * The world clock is the authoritative source of the current tick. Domain
 * services subscribe to tick and day-change events rather than polling.
 * Implementations live in the infrastructure (or application) layer.
 */
export interface IWorldClock {
  /** Returns the current simulation time without advancing it. */
  getCurrentTime(): SimulationTime;

  /**
   * Advances the clock by one tick and returns the new time.
   * Notifies all tick subscribers and, when the day rolls over,
   * all day-change subscribers.
   */
  advance(): SimulationTime;

  /**
   * Advances the clock to the start of the next day (first time slot)
   * and returns the new time. Notifies tick and day-change subscribers
   * for each tick skipped.
   */
  advanceToNextDay(): SimulationTime;

  /**
   * Registers a callback to be invoked after every tick advance.
   * Returns an unsubscribe function that removes this specific callback.
   */
  onTick(callback: (time: SimulationTime) => void): () => void;

  /**
   * Registers a callback to be invoked whenever the in-game day changes.
   * Returns an unsubscribe function that removes this specific callback.
   */
  onDayChange(callback: (time: SimulationTime) => void): () => void;
}
