import { InvalidRangeError } from '../errors/DomainErrors.js';
import type { CharacterId } from '../value-objects/CharacterId.js';
import type { SimulationTime } from './SimulationTime.js';
import type { ActionType } from './Enums.js';

/**
 * An immutable snapshot of the context in which a character must make a
 * behavioral decision. All numeric fields are normalised to [0, 1].
 */
export interface Situation {
  /** Human-readable description of what is happening. */
  readonly description: string;

  /** Name or identifier of the physical location. */
  readonly location: string;

  /** The simulation time at which the situation occurs. */
  readonly time: SimulationTime;

  /** All character ids present in this situation, including the deciding character. */
  readonly participants: CharacterId[];

  /**
   * Degree of physical or existential danger in the situation.
   * 0 = no threat, 1 = immediate lethal threat.
   */
  readonly threatLevel: number;

  /**
   * How consequential the outcome of this situation is.
   * 0 = trivial, 1 = life-defining.
   */
  readonly stakes: number;

  /**
   * Degree of advantageous opportunity present.
   * 0 = no opportunity, 1 = exceptional opportunity.
   */
  readonly opportunity: number;

  /** The set of actions a character may choose from in this situation. */
  readonly availableActions: ActionType[];

  /**
   * Free-form labels that classify the situation
   * (e.g. 'combat', 'social', 'trade', 'exploration').
   */
  readonly tags: string[];
}

// ─── Params ───────────────────────────────────────────────────────────────────

export interface SituationParams {
  description: string;
  location: string;
  time: SimulationTime;
  participants: CharacterId[];
  threatLevel: number;
  stakes: number;
  opportunity: number;
  availableActions: ActionType[];
  tags: string[];
}

// ─── Validation helper ────────────────────────────────────────────────────────

function validateRange01(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new InvalidRangeError(field, value, 0, 1);
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Creates an immutable Situation value object.
 *
 * Validates that threatLevel, stakes, and opportunity are all within [0, 1].
 *
 * @throws {InvalidRangeError} if any numeric field is outside [0, 1].
 */
export function createSituation(params: SituationParams): Situation {
  validateRange01(params.threatLevel, 'threatLevel');
  validateRange01(params.stakes, 'stakes');
  validateRange01(params.opportunity, 'opportunity');

  return Object.freeze({
    description: params.description,
    location: params.location,
    time: params.time,
    participants: Object.freeze([...params.participants]) as CharacterId[],
    threatLevel: params.threatLevel,
    stakes: params.stakes,
    opportunity: params.opportunity,
    availableActions: Object.freeze([...params.availableActions]) as ActionType[],
    tags: Object.freeze([...params.tags]) as string[],
  } satisfies Situation) as Situation;
}
