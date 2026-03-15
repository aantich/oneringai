import type { Character } from '../entities/Character.js';
import type { Memory } from '../entities/Memory.js';
import type { Goal } from '../entities/Goal.js';
import type { Emotion } from '../types/Enums.js';
import { createDerivedState } from '../value-objects/DerivedState.js';
import type { DerivedState } from '../value-objects/DerivedState.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Normalise a [-1, 1] trait to [0, 1]. */
function norm(trait: number): number {
  return (trait + 1) / 2;
}

/**
 * Map an emotional valence and a set of emotional tags to a primary Emotion.
 * Positive valence → joy / surprise; negative → mapped from tags then valence.
 */
function valenceToEmotion(valence: number, tags: Emotion[]): Emotion {
  // Prefer an explicit tag if present
  const primaryTags: Emotion[] = ['anger', 'fear', 'sadness', 'disgust', 'contempt', 'joy', 'surprise'];
  for (const tag of primaryTags) {
    if (tags.includes(tag)) return tag;
  }

  if (valence > 0.4) return 'joy';
  if (valence > 0.1) return 'surprise';
  if (valence < -0.6) return 'fear';
  if (valence < -0.3) return 'sadness';
  if (valence < -0.1) return 'disgust';
  return 'neutral';
}

/** Returns true when the memory's tags or emotion tags indicate a social interaction. */
function isSocialInteraction(memory: Memory): boolean {
  const socialTags = ['social', 'conversation', 'meeting', 'party', 'gathering', 'reunion'];
  return (
    memory.tags.some((t) => socialTags.includes(t)) ||
    memory.emotionalTags.some((e) => e === 'joy' || e === 'surprise')
  );
}

/** Returns true when the memory's tags indicate success. */
function isSuccessMemory(memory: Memory): boolean {
  return memory.tags.some((t) => ['triumph', 'success', 'victory', 'achievement'].includes(t));
}

/** Returns true when the memory's tags indicate failure. */
function isFailureMemory(memory: Memory): boolean {
  return memory.tags.some((t) => ['failure', 'defeat', 'loss', 'humiliation'].includes(t));
}

// ─── MoodEngine ───────────────────────────────────────────────────────────────

/**
 * Stateless service: computes DerivedState transitions driven by emotional events
 * and simulation-tick decay.
 *
 * All personality traits are in [-1, 1]; they are normalised to [0, 1] before
 * use in additive weight formulas.
 */
export class MoodEngine {
  /**
   * Apply an event's emotional impact to a character's state.
   *
   * - mood shifts based on memory's emotionalValence and emotionalTags
   * - moodIntensity influenced by neuroticism (high N = bigger swings)
   * - stress increases from negative events, proportional to neuroticism
   * - confidence affected by success/failure tags
   * - socialNeed adjusts based on social interaction tags
   *
   * Returns a new DerivedState (immutable); does not mutate the character.
   */
  applyEvent(character: Character, memory: Memory): DerivedState {
    const p = character.personality;
    const s = character.state;

    const neuroticism01 = norm(p.neuroticism);
    const valence = memory.emotionalValence; // [-1, 1]
    const absValence = Math.abs(valence);

    // ── Mood ──────────────────────────────────────────────────────────────────
    // High neuroticism amplifies mood swings.
    const swingAmplifier = 0.5 + neuroticism01 * 0.5; // 0.5 – 1.0
    const rawIntensityDelta = absValence * swingAmplifier;

    let newMood: Emotion = s.mood;
    let newMoodIntensity = s.moodIntensity;
    let newMoodDuration = s.moodDuration;

    // Only shift mood if the event has enough emotional weight to displace current mood
    if (rawIntensityDelta > 0.05) {
      newMood = valenceToEmotion(valence, memory.emotionalTags);
      newMoodIntensity = clamp(rawIntensityDelta, 0, 1);
      // Duration proportional to neuroticism (reactive characters stay in moods longer)
      newMoodDuration = Math.round(1 + neuroticism01 * 3); // 1–4 ticks
    }

    // ── Stress ────────────────────────────────────────────────────────────────
    // Negative events increase stress; neuroticism amplifies the increase.
    let newStress = s.stress;
    if (valence < 0) {
      const stressIncrease = absValence * (0.3 + neuroticism01 * 0.4);
      newStress = clamp(s.stress + stressIncrease, 0, 1);
    } else {
      // Positive events slightly relieve stress
      const stressRelief = absValence * 0.1;
      newStress = clamp(s.stress - stressRelief, 0, 1);
    }

    // ── Confidence ────────────────────────────────────────────────────────────
    let newConfidence = s.confidence;
    if (isSuccessMemory(memory)) {
      newConfidence = clamp(s.confidence + 0.1, 0, 1);
    } else if (isFailureMemory(memory)) {
      // High neuroticism makes failure hurt more
      const confidenceDrop = 0.05 + neuroticism01 * 0.1;
      newConfidence = clamp(s.confidence - confidenceDrop, 0, 1);
    }

    // ── SocialNeed ────────────────────────────────────────────────────────────
    let newSocialNeed = s.socialNeed;
    if (isSocialInteraction(memory)) {
      const extraversion01 = norm(p.extraversion);
      if (valence >= 0) {
        // Good social interaction satisfies extraverts more
        const satisfaction = 0.1 + extraversion01 * 0.15;
        newSocialNeed = clamp(s.socialNeed - satisfaction, 0, 1);
      } else {
        // Bad social interaction increases social anxiety for neurotics
        newSocialNeed = clamp(s.socialNeed + neuroticism01 * 0.1, 0, 1);
      }
    }

    return createDerivedState({
      mood: newMood,
      moodIntensity: newMoodIntensity,
      moodDuration: newMoodDuration,
      stress: newStress,
      energy: s.energy,
      motivation: s.motivation,
      confidence: newConfidence,
      socialNeed: newSocialNeed,
      reputationPerception: s.reputationPerception,
    });
  }

  /**
   * Tick-based natural decay of state.
   *
   * - moodDuration decreases by 1; if 0, mood returns toward 'neutral'
   * - moodIntensity decays toward 0 (faster for low-neuroticism)
   * - stress decays slowly
   * - energy decreases slightly per tick
   * - socialNeed increases based on extraversion
   *
   * Returns a new DerivedState; does not mutate the character.
   */
  tickDecay(character: Character): DerivedState {
    const p = character.personality;
    const s = character.state;

    const neuroticism01 = norm(p.neuroticism);
    const extraversion01 = norm(p.extraversion);

    // ── Mood duration and intensity ────────────────────────────────────────────
    const newMoodDuration = Math.max(0, s.moodDuration - 1);
    let newMood: Emotion = s.mood;
    let newMoodIntensity = s.moodIntensity;

    if (newMoodDuration === 0 && s.mood !== 'neutral') {
      // Mood fades; emotionally stable characters snap back faster
      const decayRate = 0.3 - neuroticism01 * 0.2; // 0.1–0.3
      newMoodIntensity = clamp(s.moodIntensity - decayRate, 0, 1);
      if (newMoodIntensity < 0.05) {
        newMood = 'neutral';
        newMoodIntensity = 0;
      }
    } else if (newMoodDuration > 0) {
      // Slow decay while mood is still active
      const activeDecayRate = 0.05 - neuroticism01 * 0.03; // 0.02–0.05
      newMoodIntensity = clamp(s.moodIntensity - activeDecayRate, 0, 1);
    }

    // ── Stress ────────────────────────────────────────────────────────────────
    // Stress decays slowly; emotionally stable characters recover faster.
    const stressDecay = 0.02 + (1 - neuroticism01) * 0.03; // 0.02–0.05
    const newStress = clamp(s.stress - stressDecay, 0, 1);

    // ── Energy ────────────────────────────────────────────────────────────────
    // Energy decreases slightly per tick (represents fatigue accumulation).
    const energyDrain = 0.05;
    const newEnergy = clamp(s.energy - energyDrain, 0, 1);

    // ── SocialNeed ────────────────────────────────────────────────────────────
    // Extraverts grow lonely faster; introverts are slower to need company.
    const socialGrowth = 0.02 + extraversion01 * 0.08; // 0.02–0.10
    const newSocialNeed = clamp(s.socialNeed + socialGrowth, 0, 1);

    return createDerivedState({
      mood: newMood,
      moodIntensity: newMoodIntensity,
      moodDuration: newMoodDuration,
      stress: newStress,
      energy: newEnergy,
      motivation: s.motivation,
      confidence: s.confidence,
      socialNeed: newSocialNeed,
      reputationPerception: s.reputationPerception,
    });
  }

  /**
   * Day boundary: rest and recovery.
   *
   * - energy restored based on conscientiousness (organised sleep)
   * - stress reduced significantly
   * - motivation recalculated from goals progress
   *
   * Returns a new DerivedState; does not mutate the character.
   */
  dayReset(character: Character, goals: Goal[] = []): DerivedState {
    const p = character.personality;
    const s = character.state;

    const conscientiousness01 = norm(p.conscientiousness);
    const neuroticism01 = norm(p.neuroticism);

    // ── Energy restoration ────────────────────────────────────────────────────
    // Conscientious characters sleep on schedule → better energy recovery.
    const energyRestored = 0.6 + conscientiousness01 * 0.4; // 0.6–1.0
    const newEnergy = clamp(s.energy + energyRestored, 0, 1);

    // ── Stress reduction ──────────────────────────────────────────────────────
    // Neurotic characters shed less stress overnight.
    const stressRelief = 0.3 - neuroticism01 * 0.2; // 0.1–0.3
    const newStress = clamp(s.stress - stressRelief, 0, 1);

    // ── Motivation recalculation from goals ───────────────────────────────────
    // Average progress of active goals; if no active goals, use current motivation.
    const activeGoals = goals.filter((g) => g.status === 'active');
    let newMotivation = s.motivation;
    if (activeGoals.length > 0) {
      const avgProgress = activeGoals.reduce((sum, g) => sum + g.progress, 0) / activeGoals.length;
      // Moderate progress is motivating; being stuck (0) or nearly done (1) reduces urgency differently.
      const progressMotivation = 0.3 + avgProgress * 0.4; // 0.3–0.7
      // Conscientiousness boosts baseline motivation
      const conscientiousnessBoost = conscientiousness01 * 0.3;
      newMotivation = clamp(progressMotivation + conscientiousnessBoost, 0, 1);
    }

    return createDerivedState({
      mood: s.mood,
      moodIntensity: s.moodIntensity,
      moodDuration: s.moodDuration,
      stress: newStress,
      energy: newEnergy,
      motivation: newMotivation,
      confidence: s.confidence,
      socialNeed: s.socialNeed,
      reputationPerception: s.reputationPerception,
    });
  }
}
