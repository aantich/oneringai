import type { Emotion } from '../types/Enums.js';
import type { Personality } from './Personality.js';
import { InvalidRangeError } from '../errors/DomainErrors.js';

export interface DerivedState {
  readonly mood: Emotion;
  /** 0-1 */
  readonly moodIntensity: number;
  /** Remaining ticks at current mood */
  readonly moodDuration: number;
  /** 0-1 */
  readonly stress: number;
  /** 0-1 */
  readonly energy: number;
  /** 0-1 */
  readonly motivation: number;
  /** 0-1 */
  readonly confidence: number;
  /** 0-1 */
  readonly socialNeed: number;
  /** -1 to 1 */
  readonly reputationPerception: number;
}

// ─── Validation helpers ───────────────────────────────────────────────────────

function clamp01(value: number, field: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new InvalidRangeError(field, value, 0, 1);
  }
  return value;
}

function clampSymmetric(value: number, field: string): number {
  if (!Number.isFinite(value) || value < -1 || value > 1) {
    throw new InvalidRangeError(field, value, -1, 1);
  }
  return value;
}

function clampNonNegativeInt(value: number, field: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new InvalidRangeError(field, value, 0, Number.MAX_SAFE_INTEGER);
  }
  return value;
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export interface DerivedStateParams {
  mood?: Emotion;
  moodIntensity?: number;
  moodDuration?: number;
  stress?: number;
  energy?: number;
  motivation?: number;
  confidence?: number;
  socialNeed?: number;
  reputationPerception?: number;
}

/**
 * Creates a DerivedState value object with sensible defaults.
 * Defaults: neutral mood, intensity 0, duration 0, stress 0,
 * energy 1.0, motivation 0.5, confidence 0.5, socialNeed 0.5,
 * reputationPerception 0.
 */
export function createDerivedState(params: DerivedStateParams = {}): DerivedState {
  const state: DerivedState = {
    mood: params.mood ?? 'neutral',
    moodIntensity: clamp01(params.moodIntensity ?? 0, 'moodIntensity'),
    moodDuration: clampNonNegativeInt(params.moodDuration ?? 0, 'moodDuration'),
    stress: clamp01(params.stress ?? 0, 'stress'),
    energy: clamp01(params.energy ?? 1.0, 'energy'),
    motivation: clamp01(params.motivation ?? 0.5, 'motivation'),
    confidence: clamp01(params.confidence ?? 0.5, 'confidence'),
    socialNeed: clamp01(params.socialNeed ?? 0.5, 'socialNeed'),
    reputationPerception: clampSymmetric(params.reputationPerception ?? 0, 'reputationPerception'),
  };

  return Object.freeze(state);
}

/**
 * Derives a baseline DerivedState from a character's Personality.
 *
 * Derivation rules:
 * - confidence: high conscientiousness + low neuroticism → higher confidence
 * - socialNeed: high extraversion → higher socialNeed
 * - motivation: high conscientiousness + low neuroticism → higher motivation
 * - stress: high neuroticism → higher baseline stress
 * - mood: 'neutral' baseline for everyone (mood changes via events)
 */
export function createDefaultDerivedState(personality: Personality): DerivedState {
  // Map personality traits ([-1, 1]) to [0, 1] range
  const normalize = (v: number) => (v + 1) / 2;

  const neuroticism01 = normalize(personality.neuroticism);
  const conscientiousness01 = normalize(personality.conscientiousness);
  const extraversion01 = normalize(personality.extraversion);

  // Confidence: boosted by conscientiousness, reduced by neuroticism
  const rawConfidence = (conscientiousness01 * 0.6 + (1 - neuroticism01) * 0.4);
  const confidence = Math.max(0, Math.min(1, rawConfidence));

  // Social need driven primarily by extraversion
  const socialNeed = Math.max(0, Math.min(1, extraversion01));

  // Motivation: high conscientiousness and low neuroticism increase motivation
  const rawMotivation = (conscientiousness01 * 0.5 + (1 - neuroticism01) * 0.5);
  const motivation = Math.max(0, Math.min(1, rawMotivation));

  // Stress: high neuroticism → higher baseline stress
  const stress = Math.max(0, Math.min(1, neuroticism01 * 0.4));

  return createDerivedState({
    mood: 'neutral',
    moodIntensity: 0,
    moodDuration: 0,
    stress,
    energy: 1.0,
    motivation,
    confidence,
    socialNeed,
    reputationPerception: 0,
  });
}
