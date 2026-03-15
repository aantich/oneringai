import type { Character } from '../entities/Character.js';
import type { Memory } from '../entities/Memory.js';
import type { Relationship } from '../entities/Relationship.js';
import type { Situation } from '../types/Situation.js';
import type { ActionType } from '../types/Enums.js';
import {
  createActionWeight,
  sortByWeight,
} from '../value-objects/ActionWeight.js';
import type { ActionWeight } from '../value-objects/ActionWeight.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Normalise a [-1, 1] trait to [0, 1].
 *
 * The design-doc formula uses `clamp(trait)` where clamp means normalising the
 * [-1, 1] range to [0, 1]: `(value + 1) / 2`.
 */
function norm(trait: number): number {
  return (trait + 1) / 2;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Check whether any recalled memory contains a betrayal tag. */
function hasBetrayalMemory(memories: Memory[]): boolean {
  return memories.some((m) => m.tags.includes('betrayal'));
}

/**
 * Check whether the situation involves a goal that the character actively
 * pursues (loose keyword match on the description).
 */
function goalAlignmentBoost(character: Character, situation: Situation): number {
  // We only have the situation tags to work with here; look for overlaps with
  // active goal descriptions in a lightweight way.
  const activeGoalCount = 0; // Goals are not stored on Character entity directly —
  // The BehaviorEngine receives the character snapshot.  We use situation tags
  // as a proxy: if situation.opportunity is high, treat it as aligned with goals.
  void activeGoalCount; // suppress unused-var lint
  return situation.opportunity * 0.1;
}

// ─── BehaviorEngine ───────────────────────────────────────────────────────────

/**
 * Stateless service: maps personality + context → action weights.
 *
 * Implements the exact weight formulas from the NPC Character Behavior Framework
 * design document.  All personality traits are normalised from [-1, 1] to [0, 1]
 * before use.
 */
export class BehaviorEngine {
  /**
   * Calculate action weights for a situation.
   *
   * Implements the design-doc weight formulas exactly:
   *
   * fight:     0.20*(1−agreeableness) + 0.15*riskTolerance + 0.15*(anger mood) + 0.20*threat + 0.10*(1−neuroticism) + 0.10*confidence + 0.10*(1−disposition)
   * flee:      0.25*neuroticism + 0.20*(1−riskTolerance) + 0.20*(fear mood) + 0.20*threat + 0.15*(1−confidence)
   * negotiate: 0.25*agreeableness + 0.20*extraversion + 0.15*conscientiousness + 0.15*trust + 0.15*(1−impulsivity) + 0.10*fairness
   * deceive:   0.25*(1−compassion) + 0.20*openness + 0.15*(1−fairness) + 0.15*(1−trust) + 0.15*stakes + 0.10*(1−authority)
   * help:      0.30*compassion + 0.25*agreeableness + 0.20*disposition + 0.15*loyalty + 0.10*(1−threat)
   * observe:   0.25*openness + 0.25*conscientiousness + 0.25*(1−impulsivity) + 0.15*(1−extraversion) + 0.10*(1−threat)
   * submit:    derived from authority, low confidence, power imbalance
   * ignore:    derived from low extraversion, low stakes
   *
   * Returns sorted ActionWeight[] (descending by weight), filtered to
   * `situation.availableActions`.
   */
  calculateActionWeights(
    character: Character,
    situation: Situation,
    relationship?: Relationship,
    relevantMemories: Memory[] = [],
  ): ActionWeight[] {
    const p = character.personality;
    const s = character.state;

    // ── Normalised personality traits (0–1) ───────────────────────────────────
    const agreeableness = norm(p.agreeableness);
    const riskTolerance = norm(p.riskTolerance);
    const neuroticism = norm(p.neuroticism);
    const extraversion = norm(p.extraversion);
    const conscientiousness = norm(p.conscientiousness);
    const openness = norm(p.openness);
    const compassion = norm(p.compassion);
    const fairness = norm(p.fairness);
    const loyalty = norm(p.loyalty);
    const authority = norm(p.authority);
    const impulsivity = norm(p.impulsivity);

    // ── Situation values ───────────────────────────────────────────────────────
    const threat = situation.threatLevel;
    const stakes = situation.stakes;

    // ── Relationship values (with neutral defaults when no relationship) ───────
    const disposition = relationship !== undefined ? norm(relationship.disposition) : 0.5;
    const trust = relationship !== undefined ? norm(relationship.trust) : 0.3;
    const powerBalance = relationship !== undefined ? relationship.powerBalance : 0; // [-1, 1]

    // ── Mood components ───────────────────────────────────────────────────────
    const angerMood = s.mood === 'anger' ? s.moodIntensity : 0;
    const fearMood = s.mood === 'fear' ? s.moodIntensity : 0;

    // ── Memory modifiers ──────────────────────────────────────────────────────
    const betrayalPenalty = hasBetrayalMemory(relevantMemories) ? 0.15 : 0;

    // ── Goal alignment boost (situational opportunity proxy) ──────────────────
    const goalBoost = goalAlignmentBoost(character, situation);

    // ── Stress modifier: high stress amplifies impulsive choices ──────────────
    // We dampen deliberate actions (negotiate, observe) when stress is high
    // and amplify reactive ones (fight, flee) slightly.
    const stressFactor = s.stress;

    // ─────────────────────────────────────────────────────────────────────────
    // RAW WEIGHTS (design-doc formulas)
    // ─────────────────────────────────────────────────────────────────────────

    const rawWeights: Record<ActionType, number> = {
      fight:
        0.20 * (1 - agreeableness) +
        0.15 * riskTolerance +
        0.15 * angerMood +
        0.20 * threat +
        0.10 * (1 - neuroticism) +
        0.10 * s.confidence +
        0.10 * (1 - disposition),

      flee:
        0.25 * neuroticism +
        0.20 * (1 - riskTolerance) +
        0.20 * fearMood +
        0.20 * threat +
        0.15 * (1 - s.confidence),

      negotiate:
        0.25 * agreeableness +
        0.20 * extraversion +
        0.15 * conscientiousness +
        0.15 * (trust - betrayalPenalty) +
        0.15 * (1 - impulsivity) +
        0.10 * fairness,

      deceive:
        0.25 * (1 - compassion) +
        0.20 * openness +
        0.15 * (1 - fairness) +
        0.15 * (1 - trust) +
        0.15 * stakes +
        0.10 * (1 - authority),

      help:
        0.30 * compassion +
        0.25 * agreeableness +
        0.20 * disposition +
        0.15 * loyalty +
        0.10 * (1 - threat),

      observe:
        0.25 * openness +
        0.25 * conscientiousness +
        0.25 * (1 - impulsivity) +
        0.15 * (1 - extraversion) +
        0.10 * (1 - threat),

      submit:
        0.30 * authority +
        0.25 * (1 - s.confidence) +
        0.25 * (powerBalance < 0 ? Math.abs(powerBalance) : 0) + // dominated = higher submit
        0.20 * (1 - riskTolerance),

      ignore:
        0.35 * (1 - extraversion) +
        0.35 * (1 - stakes) +
        0.20 * (1 - threat) +
        0.10 * (1 - impulsivity),
    };

    // ─────────────────────────────────────────────────────────────────────────
    // SITUATIONAL MODIFIERS
    // ─────────────────────────────────────────────────────────────────────────

    // Goal alignment: small boost to actions that serve perceived opportunity
    rawWeights['fight'] += goalBoost * 0.3;
    rawWeights['negotiate'] += goalBoost * 0.5;
    rawWeights['help'] += goalBoost * 0.4;

    // Stress: amplifies reactive actions, dampens deliberate ones
    rawWeights['fight'] += stressFactor * impulsivity * 0.1;
    rawWeights['flee'] += stressFactor * 0.05;
    rawWeights['negotiate'] -= stressFactor * 0.05;
    rawWeights['observe'] -= stressFactor * 0.05;

    // Memory: betrayal reduces trust-based (negotiate, help) actions
    rawWeights['negotiate'] -= betrayalPenalty * 0.2;
    rawWeights['help'] -= betrayalPenalty * 0.15;

    // ─────────────────────────────────────────────────────────────────────────
    // CLAMP & FILTER TO AVAILABLE ACTIONS
    // ─────────────────────────────────────────────────────────────────────────

    const available = new Set<ActionType>(situation.availableActions);
    const actionWeights: ActionWeight[] = [];

    for (const [action, rawWeight] of Object.entries(rawWeights) as [ActionType, number][]) {
      if (!available.has(action)) continue;

      const weight = clamp(rawWeight, 0, 1);
      const reasoning = this._buildReasoning(
        action,
        weight,
        { agreeableness, riskTolerance, neuroticism, compassion, angerMood, fearMood, trust },
        threat,
        stakes,
        disposition,
        betrayalPenalty > 0,
      );

      actionWeights.push(createActionWeight({ action, weight, reasoning }));
    }

    return sortByWeight(actionWeights);
  }

  /**
   * Select an action using weighted random selection.
   *
   * Characters are biased by personality but can surprise — not a pure argmax.
   */
  selectAction(weights: ActionWeight[]): ActionWeight {
    if (weights.length === 0) {
      throw new Error('Cannot select action from empty weight list.');
    }

    const totalWeight = weights.reduce((sum, w) => sum + w.weight, 0);

    if (totalWeight <= 0) {
      // All weights are zero — return first action
      return weights[0]!;
    }

    let random = Math.random() * totalWeight;
    for (const w of weights) {
      random -= w.weight;
      if (random <= 0) return w;
    }

    // Fallback (floating point edge case)
    return weights[weights.length - 1]!;
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  private _buildReasoning(
    action: ActionType,
    weight: number,
    traits: {
      agreeableness: number;
      riskTolerance: number;
      neuroticism: number;
      compassion: number;
      angerMood: number;
      fearMood: number;
      trust: number;
    },
    threat: number,
    stakes: number,
    disposition: number,
    hasBetrayalInMemory: boolean,
  ): string {
    const parts: string[] = [];

    switch (action) {
      case 'fight':
        if (traits.agreeableness < 0.4) parts.push('disagreeable nature');
        if (traits.riskTolerance > 0.6) parts.push('risk appetite');
        if (traits.angerMood > 0.3) parts.push('anger');
        if (threat > 0.5) parts.push('high threat');
        break;
      case 'flee':
        if (traits.neuroticism > 0.6) parts.push('neurotic disposition');
        if (traits.riskTolerance < 0.4) parts.push('caution');
        if (traits.fearMood > 0.3) parts.push('fear');
        if (threat > 0.5) parts.push('high threat');
        break;
      case 'negotiate':
        if (traits.agreeableness > 0.6) parts.push('agreeableness');
        if (hasBetrayalInMemory) parts.push('tempered by betrayal memory');
        if (traits.trust > 0.5) parts.push('moderate trust');
        break;
      case 'deceive':
        if (traits.compassion < 0.4) parts.push('low compassion');
        if (stakes > 0.5) parts.push('high stakes');
        if (traits.trust < 0.4) parts.push('distrust');
        break;
      case 'help':
        if (traits.compassion > 0.6) parts.push('compassion');
        if (disposition > 0.5) parts.push('positive disposition');
        break;
      case 'observe':
        parts.push('deliberate temperament');
        break;
      case 'submit':
        if (disposition < 0.5) parts.push('power imbalance');
        break;
      case 'ignore':
        if (stakes < 0.3) parts.push('low stakes');
        break;
    }

    const base = `${action} (weight ${weight.toFixed(2)})`;
    return parts.length > 0 ? `${base} — driven by: ${parts.join(', ')}` : base;
  }
}
