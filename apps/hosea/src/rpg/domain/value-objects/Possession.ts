import type { PossessionCategory } from '../types/Enums.js';
import type { CharacterId } from './CharacterId.js';
import { InvalidRangeError } from '../errors/DomainErrors.js';

export interface Possession {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly category: PossessionCategory;
  /** Emotional importance to the character, 0-1 */
  readonly sentimentalValue: number;
  /** How useful the item is to the character, 0-1 */
  readonly utilityValue: number;
  /** Abstract currency units, >= 0 */
  readonly monetaryValue: number;
  readonly acquiredFrom?: CharacterId;
  /** Short narrative of how the item was obtained */
  readonly acquiredMemory?: string;
  /** Physical condition, 0-1 (0 = destroyed, 1 = perfect) */
  readonly condition: number;
}

export interface PossessionParams {
  id?: string;
  name: string;
  description: string;
  category: PossessionCategory;
  sentimentalValue: number;
  utilityValue: number;
  monetaryValue: number;
  acquiredFrom?: CharacterId;
  acquiredMemory?: string;
  condition: number;
}

function clamp01(value: number, field: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new InvalidRangeError(field, value, 0, 1);
  }
  return value;
}

/**
 * Creates a Possession value object.
 * Validates all numeric ranges and generates a UUID for id if not provided.
 */
export function createPossession(params: PossessionParams): Possession {
  const possession: Possession = {
    id: params.id ?? crypto.randomUUID(),
    name: params.name,
    description: params.description,
    category: params.category,
    sentimentalValue: clamp01(params.sentimentalValue, 'sentimentalValue'),
    utilityValue: clamp01(params.utilityValue, 'utilityValue'),
    monetaryValue: (() => {
      if (!Number.isFinite(params.monetaryValue) || params.monetaryValue < 0) {
        throw new InvalidRangeError('monetaryValue', params.monetaryValue, 0, Number.MAX_SAFE_INTEGER);
      }
      return params.monetaryValue;
    })(),
    acquiredFrom: params.acquiredFrom,
    acquiredMemory: params.acquiredMemory,
    condition: clamp01(params.condition, 'condition'),
  };

  return Object.freeze(possession);
}
