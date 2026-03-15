import type { TimeSlot } from '../types/Enums.js';
import type { SimulationTime } from '../types/SimulationTime.js';
import type { ScheduleBlock } from './ScheduleBlock.js';

export interface DailyPlan {
  /** The in-game day this plan covers */
  readonly date: SimulationTime;
  /** Ordered sequence of schedule blocks, one per time slot */
  readonly blocks: readonly ScheduleBlock[];
  /**
   * Fallback behaviours if a block cannot be executed as planned.
   * Each string is a short narrative instruction (e.g. "Return home if marketplace is closed").
   */
  readonly contingencies: readonly string[];
}

export interface DailyPlanParams {
  date: SimulationTime;
  blocks: ScheduleBlock[];
  contingencies?: string[];
}

/**
 * Creates a DailyPlan value object.
 */
export function createDailyPlan(params: DailyPlanParams): DailyPlan {
  const plan: DailyPlan = {
    date: params.date,
    blocks: Object.freeze([...params.blocks]),
    contingencies: Object.freeze([...(params.contingencies ?? [])]),
  };

  return Object.freeze(plan);
}

/**
 * Returns the ScheduleBlock assigned to the given time slot, or undefined if none exists.
 */
export function getBlockForTimeSlot(
  plan: DailyPlan,
  timeSlot: TimeSlot,
): ScheduleBlock | undefined {
  return plan.blocks.find((block) => block.timeSlot === timeSlot);
}
