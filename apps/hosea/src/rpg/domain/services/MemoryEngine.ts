import type { Memory } from '../entities/Memory.js';
import type { Personality } from '../value-objects/Personality.js';
import type { Situation } from '../types/Situation.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Normalise a [-1, 1] trait to [0, 1]. */
function norm(trait: number): number {
  return (trait + 1) / 2;
}

/** The importance level below which a memory is considered effectively forgotten. */
const FORGOTTEN_THRESHOLD = 0.05;

/**
 * Base decay amount per tick before personality modifiers.
 * A memory with no emotional weight at default personality decays at ~0.02/tick,
 * giving a half-life of ~25 ticks.
 */
const BASE_DECAY_RATE = 0.02;

// ─── MemoryEngine ─────────────────────────────────────────────────────────────

/**
 * Stateless service: handles memory decay, recall scoring, and importance
 * calculation.
 *
 * All mutations are applied directly to the mutable Memory instances (decay /
 * reinforce are entity methods). Recall and importance are purely computed.
 */
export class MemoryEngine {
  /**
   * Apply time-based decay to all memories.
   *
   * - Each memory's importance decreases
   * - High emotionalValence (absolute) slows decay
   * - High neuroticism slows decay of negative memories
   * - Memories below importance threshold (0.05) could be flagged
   *
   * Mutates importance on each Memory in place (calls `memory.decay()`).
   * Returns the subset of memories that have dropped below the forgotten threshold.
   */
  decayMemories(memories: Memory[], personality: Personality): Memory[] {
    const neuroticism01 = norm(personality.neuroticism);
    const forgotten: Memory[] = [];

    for (const memory of memories) {
      const absValence = Math.abs(memory.emotionalValence);

      // High emotional intensity slows decay (vivid memories persist)
      const emotionalSlowing = absValence * 0.5; // 0–0.5 reduction

      // High neuroticism additionally preserves negative memories
      let neuroticSlowing = 0;
      if (memory.emotionalValence < 0) {
        neuroticSlowing = neuroticism01 * 0.3; // 0–0.3 reduction for negative memories
      }

      const decayAmount = Math.max(0, BASE_DECAY_RATE - emotionalSlowing - neuroticSlowing);
      memory.decay(decayAmount);

      if (memory.importance < FORGOTTEN_THRESHOLD) {
        forgotten.push(memory);
      }
    }

    return forgotten;
  }

  /**
   * Recall: find relevant memories for a situation.
   *
   * Scores each memory by:
   * - tag overlap with situation tags
   * - participant overlap with situation participants
   * - recency (higher tick = more recent = higher score)
   * - importance
   *
   * Returns top `limit` memories sorted by descending relevance score.
   */
  recall(memories: Memory[], situation: Situation, limit = 5): Memory[] {
    if (memories.length === 0) return [];

    // Find the most recent tick for recency normalisation
    const maxTick = Math.max(...memories.map((m) => m.timestamp.tick), 1);

    const scored = memories.map((memory) => {
      let score = 0;

      // Tag overlap
      const situationTagSet = new Set(situation.tags);
      const memoryTagCount = memory.tags.filter((t) => situationTagSet.has(t)).length;
      const emotionTagCount = memory.emotionalTags.filter((e) =>
        situationTagSet.has(e as string),
      ).length;
      score += (memoryTagCount + emotionTagCount) * 0.2;

      // Participant overlap
      const situationParticipantSet = new Set(situation.participants);
      const participantOverlap = memory.participants.filter((p) =>
        situationParticipantSet.has(p),
      ).length;
      score += participantOverlap * 0.3;

      // Recency: normalised 0–1, with linear falloff
      const recency = maxTick > 0 ? memory.timestamp.tick / maxTick : 0;
      score += recency * 0.25;

      // Importance: already in [0, 1]
      score += memory.importance * 0.25;

      return { memory, score };
    });

    // Sort descending and return top N
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map((s) => s.memory);
  }

  /**
   * Calculate initial importance of a new memory.
   *
   * - Base importance from emotional intensity (abs(valence))
   * - Boost for tags matching personality (e.g., 'betrayal' + high loyalty = high importance)
   * - Boost for high number of participants
   *
   * Returns a value in [0, 1].
   */
  calculateImportance(memory: Memory, personality: Personality): number {
    const absValence = Math.abs(memory.emotionalValence);

    // Base: emotional intensity is the primary driver
    let importance = absValence * 0.6;

    // Personality-tag alignment boosts
    const loyalty01 = norm(personality.loyalty);
    const compassion01 = norm(personality.compassion);
    const authority01 = norm(personality.authority);
    const neuroticism01 = norm(personality.neuroticism);

    const tags = new Set(memory.tags);

    if (tags.has('betrayal')) {
      // Betrayal hits loyal characters especially hard
      importance += loyalty01 * 0.2;
    }
    if (tags.has('loss') || tags.has('grief')) {
      importance += compassion01 * 0.1;
    }
    if (tags.has('humiliation') || tags.has('disrespect')) {
      importance += authority01 * 0.15;
    }
    if (tags.has('threat') || tags.has('danger')) {
      importance += neuroticism01 * 0.15;
    }
    if (tags.has('triumph') || tags.has('victory')) {
      // Pride matters more to those high in authority/respect
      importance += authority01 * 0.1;
    }

    // Participant count: witnessing/being involved with many people = more memorable
    const participantBoost = Math.min(memory.participants.length * 0.05, 0.2);
    importance += participantBoost;

    return Math.max(0, Math.min(1, importance));
  }
}
