import type { TimeSlot } from '../types/Enums.js';
import type { CharacterId } from './CharacterId.js';
import { InvalidRangeError } from '../errors/DomainErrors.js';

export interface ScheduleBlock {
  readonly timeSlot: TimeSlot;
  /** Description of what the character is doing during this slot */
  readonly activity: string;
  /** ID of the goal this activity serves, if any */
  readonly relatedGoal?: string;
  /** Where the activity takes place */
  readonly location: string;
  /**
   * How easily this block can be rescheduled or interrupted.
   * 0 = completely rigid, 1 = fully flexible.
   */
  readonly flexibility: number;
  /** Other characters expected to participate */
  readonly participants?: readonly CharacterId[];
}

export interface ScheduleBlockParams {
  timeSlot: TimeSlot;
  activity: string;
  relatedGoal?: string;
  location: string;
  flexibility: number;
  participants?: CharacterId[];
}

/**
 * Creates a ScheduleBlock value object.
 * Validates that flexibility is in [0, 1].
 */
export function createScheduleBlock(params: ScheduleBlockParams): ScheduleBlock {
  if (!Number.isFinite(params.flexibility) || params.flexibility < 0 || params.flexibility > 1) {
    throw new InvalidRangeError('flexibility', params.flexibility, 0, 1);
  }

  const block: ScheduleBlock = {
    timeSlot: params.timeSlot,
    activity: params.activity,
    location: params.location,
    flexibility: params.flexibility,
    ...(params.relatedGoal !== undefined ? { relatedGoal: params.relatedGoal } : {}),
    ...(params.participants !== undefined
      ? { participants: Object.freeze([...params.participants]) }
      : {}),
  };

  return Object.freeze(block);
}
