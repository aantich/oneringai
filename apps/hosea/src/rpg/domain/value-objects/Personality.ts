import { InvalidPersonalityError } from '../errors/DomainErrors.js';

export interface Personality {
  readonly openness: number;
  readonly conscientiousness: number;
  readonly extraversion: number;
  readonly agreeableness: number;
  readonly neuroticism: number;
  readonly compassion: number;
  readonly fairness: number;
  readonly loyalty: number;
  readonly authority: number;
  readonly purity: number;
  readonly riskTolerance: number;
  readonly impulsivity: number;
}

/** All personality trait names, useful for iteration and validation. */
export const PERSONALITY_TRAITS: readonly (keyof Personality)[] = [
  'openness',
  'conscientiousness',
  'extraversion',
  'agreeableness',
  'neuroticism',
  'compassion',
  'fairness',
  'loyalty',
  'authority',
  'purity',
  'riskTolerance',
  'impulsivity',
];

/**
 * Creates a Personality value object. All traits must be in the range [-1, 1].
 * Throws InvalidPersonalityError if any trait is out of range.
 */
export function createPersonality(params: Personality): Personality {
  for (const trait of PERSONALITY_TRAITS) {
    const value = params[trait];
    if (value < -1 || value > 1 || !Number.isFinite(value)) {
      throw new InvalidPersonalityError(trait, value);
    }
  }

  return Object.freeze({ ...params });
}
