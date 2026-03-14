import type { ActionType } from '../types/Enums.js';
import { InvalidRangeError } from '../errors/DomainErrors.js';

export interface ActionWeight {
  readonly action: ActionType;
  /** Relative desirability of this action in the current context, 0-1 */
  readonly weight: number;
  /** Human-readable explanation of why this weight was assigned */
  readonly reasoning: string;
}

export interface ActionWeightParams {
  action: ActionType;
  weight: number;
  reasoning: string;
}

/**
 * Creates an ActionWeight value object.
 * Validates that weight is in [0, 1].
 */
export function createActionWeight(params: ActionWeightParams): ActionWeight {
  if (!Number.isFinite(params.weight) || params.weight < 0 || params.weight > 1) {
    throw new InvalidRangeError('weight', params.weight, 0, 1);
  }

  return Object.freeze({ ...params });
}

/**
 * Returns a new array of ActionWeights sorted by weight in descending order
 * (highest-weighted action first).
 */
export function sortByWeight(weights: readonly ActionWeight[]): ActionWeight[] {
  return [...weights].sort((a, b) => b.weight - a.weight);
}
