import type { IWorldClock } from '../../domain/ports/IWorldClock.js';
import type { SimulationTime } from '../../domain/types/SimulationTime.js';
import {
  advanceTick,
  createSimulationTime,
  ticksPerDay,
} from '../../domain/types/SimulationTime.js';

/** The time slot that marks the start of a new day. */
const FIRST_SLOT_OF_DAY = 'morning' as const;

/**
 * Simple, synchronous implementation of IWorldClock.
 *
 * The clock starts at day 1, tick 0, morning unless a custom start time
 * is provided. Each call to `advance()` moves forward by one tick (one of
 * morning / afternoon / evening / night). When a tick causes the day to
 * roll over, all day-change subscribers are notified after tick subscribers.
 *
 * Subscriptions return an unsubscribe function — call it to stop receiving
 * notifications without needing a reference to the original callback.
 */
export class SimpleWorldClock implements IWorldClock {
  private time: SimulationTime;
  private readonly tickCallbacks = new Set<(time: SimulationTime) => void>();
  private readonly dayCallbacks = new Set<(time: SimulationTime) => void>();

  constructor(startTime?: SimulationTime) {
    this.time = startTime ?? createSimulationTime(0, 1, 'morning');
  }

  getCurrentTime(): SimulationTime {
    return this.time;
  }

  advance(): SimulationTime {
    const previousDay = this.time.day;
    this.time = advanceTick(this.time);

    this.notifyTick(this.time);

    if (this.time.day !== previousDay) {
      this.notifyDayChange(this.time);
    }

    return this.time;
  }

  advanceToNextDay(): SimulationTime {
    // Advance until we reach the first slot of the next day.
    const targetDay = this.time.day + 1;
    while (this.time.day < targetDay) {
      this.advance();
    }
    return this.time;
  }

  onTick(callback: (time: SimulationTime) => void): () => void {
    this.tickCallbacks.add(callback);
    return () => {
      this.tickCallbacks.delete(callback);
    };
  }

  onDayChange(callback: (time: SimulationTime) => void): () => void {
    this.dayCallbacks.add(callback);
    return () => {
      this.dayCallbacks.delete(callback);
    };
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  private notifyTick(time: SimulationTime): void {
    for (const cb of this.tickCallbacks) {
      cb(time);
    }
  }

  private notifyDayChange(time: SimulationTime): void {
    for (const cb of this.dayCallbacks) {
      cb(time);
    }
  }
}
