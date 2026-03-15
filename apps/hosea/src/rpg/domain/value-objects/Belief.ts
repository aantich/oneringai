import type { BeliefSource } from '../types/Enums.js';
import { InvalidRangeError } from '../errors/DomainErrors.js';

export interface Belief {
  readonly id: string;
  /** The entity or concept this belief is about (e.g. a character name, place, or abstract idea) */
  readonly subject: string;
  /** The proposition the character believes */
  readonly content: string;
  /** How strongly the character holds this belief, 0-1 */
  readonly confidence: number;
  readonly source: BeliefSource;
  /**
   * Ground truth flag — whether the belief is actually true in the game world.
   * Hidden from the character; used by simulation logic only.
   */
  readonly isTrue?: boolean;
}

export interface BeliefParams {
  id?: string;
  subject: string;
  content: string;
  confidence: number;
  source: BeliefSource;
  isTrue?: boolean;
}

/**
 * Creates a Belief value object.
 * Validates that confidence is in [0, 1] and generates a UUID for id if not provided.
 */
export function createBelief(params: BeliefParams): Belief {
  if (!Number.isFinite(params.confidence) || params.confidence < 0 || params.confidence > 1) {
    throw new InvalidRangeError('confidence', params.confidence, 0, 1);
  }

  const belief: Belief = {
    id: params.id ?? crypto.randomUUID(),
    subject: params.subject,
    content: params.content,
    confidence: params.confidence,
    source: params.source,
    ...(params.isTrue !== undefined ? { isTrue: params.isTrue } : {}),
  };

  return Object.freeze(belief);
}
