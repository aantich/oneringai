import { Goal } from '../entities/Goal.js';
import type { Character } from '../entities/Character.js';
import type { SimulationTime } from '../types/SimulationTime.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Normalise a [-1, 1] trait to [0, 1]. */
function norm(trait: number): number {
  return (trait + 1) / 2;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// ─── Goal templates ───────────────────────────────────────────────────────────

interface GoalTemplate {
  description: string;
  successCondition: string;
  failureCondition: string;
  /** Minimum normalised trait value (0–1) required to generate this goal */
  threshold: number;
  drivenBy: string[];
}

/**
 * Maps a personality dimension key to a set of life-goal templates.
 * Templates are selected when the associated trait exceeds the threshold.
 */
const GOAL_TEMPLATES: Record<string, GoalTemplate[]> = {
  // High openness + high riskTolerance → exploration/discovery goals
  openness_high: [
    {
      description: 'Explore the unknown reaches of the world',
      successCondition: 'Discover and map at least three uncharted locations',
      failureCondition: 'Remain confined to familiar territory indefinitely',
      threshold: 0.65,
      drivenBy: ['openness'],
    },
    {
      description: 'Master an esoteric or forbidden field of knowledge',
      successCondition: 'Achieve recognised expertise in a rare discipline',
      failureCondition: 'Abandon the pursuit of unconventional knowledge',
      threshold: 0.75,
      drivenBy: ['openness'],
    },
  ],
  // Low authority + high openness → anti-establishment goals
  openness_authority_contrast: [
    {
      description: 'Overthrow or reform the corrupt establishment',
      successCondition: 'Successfully challenge or dismantle an unjust power structure',
      failureCondition: 'Capitulate to the existing order',
      threshold: 0.6,
      drivenBy: ['openness', 'authority'],
    },
  ],
  // High conscientiousness + high authority → leadership/achievement goals
  conscientiousness_high: [
    {
      description: 'Rise to a position of leadership and lasting influence',
      successCondition: 'Attain a recognised leadership role over a meaningful group',
      failureCondition: 'Remain powerless or forgotten',
      threshold: 0.65,
      drivenBy: ['conscientiousness', 'authority'],
    },
    {
      description: 'Leave a lasting legacy through disciplined work',
      successCondition: 'Complete a significant long-term project that outlasts the character',
      failureCondition: 'Die without completing any lasting work',
      threshold: 0.7,
      drivenBy: ['conscientiousness'],
    },
  ],
  // High agreeableness + high compassion → protection/service goals
  compassion_high: [
    {
      description: 'Protect the vulnerable and heal the sick',
      successCondition: 'Consistently provide aid and protection to those in need',
      failureCondition: 'Stand idle while innocents suffer',
      threshold: 0.65,
      drivenBy: ['agreeableness', 'compassion'],
    },
  ],
  // Low agreeableness + low compassion → power/wealth accumulation goals
  agreeableness_low: [
    {
      description: 'Accumulate power and wealth at any cost',
      successCondition: 'Become one of the most influential and wealthy figures in the region',
      failureCondition: 'Remain weak, poor, or subservient',
      threshold: 0.65,
      drivenBy: ['agreeableness', 'compassion'],
    },
  ],
  // High neuroticism + high loyalty → protection of loved ones
  neuroticism_loyalty: [
    {
      description: 'Keep family and closest allies safe from all threats',
      successCondition: 'Ensure that all close relations remain alive and unharmed',
      failureCondition: 'Lose a loved one to preventable danger',
      threshold: 0.6,
      drivenBy: ['neuroticism', 'loyalty'],
    },
  ],
  // High riskTolerance + high openness → adventure goals
  risk_high: [
    {
      description: 'Seek out danger and glory in pursuit of legendary status',
      successCondition: 'Accomplish feats that become known across the realm',
      failureCondition: 'Live and die in obscurity',
      threshold: 0.7,
      drivenBy: ['riskTolerance', 'openness'],
    },
  ],
  // High fairness → justice goals
  fairness_high: [
    {
      description: 'Bring justice to those who have escaped accountability',
      successCondition: 'Successfully hold powerful wrongdoers accountable',
      failureCondition: 'Allow injustice to persist unchallenged',
      threshold: 0.7,
      drivenBy: ['fairness'],
    },
  ],
};

// ─── GoalEngine ───────────────────────────────────────────────────────────────

/**
 * Stateless service: generates life goals from personality and dynamically
 * reprioritises existing goals based on current state and time.
 */
export class GoalEngine {
  /**
   * Generate life/long-term goals based on a character's personality.
   *
   * Maps dominant trait combinations to goal templates from the design doc.
   * Returns 2–4 life goals based on the strongest trait combinations.
   */
  generateGoals(character: Character): Goal[] {
    const p = character.personality;
    const results: Goal[] = [];

    const o = norm(p.openness);
    const c = norm(p.conscientiousness);
    const a = norm(p.agreeableness);
    const n = norm(p.neuroticism);
    const compassion = norm(p.compassion);
    const fairness = norm(p.fairness);
    const loyalty = norm(p.loyalty);
    const authority = norm(p.authority);
    const risk = norm(p.riskTolerance);

    type Candidate = { template: GoalTemplate; score: number };
    const candidates: Candidate[] = [];

    // High openness
    for (const tpl of GOAL_TEMPLATES['openness_high']!) {
      if (o >= tpl.threshold) candidates.push({ template: tpl, score: o });
    }

    // Low authority + high openness (anti-establishment)
    if (o >= 0.6 && authority < 0.4) {
      for (const tpl of GOAL_TEMPLATES['openness_authority_contrast']!) {
        candidates.push({ template: tpl, score: (o + (1 - authority)) / 2 });
      }
    }

    // High conscientiousness
    for (const tpl of GOAL_TEMPLATES['conscientiousness_high']!) {
      if (c >= tpl.threshold) candidates.push({ template: tpl, score: c });
    }

    // High compassion + agreeableness
    if (compassion >= 0.65 || a >= 0.65) {
      for (const tpl of GOAL_TEMPLATES['compassion_high']!) {
        if ((compassion + a) / 2 >= tpl.threshold) {
          candidates.push({ template: tpl, score: (compassion + a) / 2 });
        }
      }
    }

    // Low agreeableness + low compassion → power-hungry goals
    if (a < 0.4 || compassion < 0.4) {
      for (const tpl of GOAL_TEMPLATES['agreeableness_low']!) {
        if ((1 - a + 1 - compassion) / 2 >= tpl.threshold) {
          candidates.push({ template: tpl, score: (2 - a - compassion) / 2 });
        }
      }
    }

    // High neuroticism + high loyalty
    if (n >= 0.6 && loyalty >= 0.6) {
      for (const tpl of GOAL_TEMPLATES['neuroticism_loyalty']!) {
        candidates.push({ template: tpl, score: (n + loyalty) / 2 });
      }
    }

    // High risk tolerance
    for (const tpl of GOAL_TEMPLATES['risk_high']!) {
      if (risk >= tpl.threshold) candidates.push({ template: tpl, score: risk });
    }

    // High fairness
    for (const tpl of GOAL_TEMPLATES['fairness_high']!) {
      if (fairness >= tpl.threshold) candidates.push({ template: tpl, score: fairness });
    }

    // Sort by score and take the top 4 unique templates
    candidates.sort((a, b) => b.score - a.score);
    const seen = new Set<string>();
    const maxGoals = 4;

    for (const { template } of candidates) {
      if (results.length >= maxGoals) break;
      if (seen.has(template.description)) continue;
      seen.add(template.description);

      // Priority proportional to the score, capped
      const priority = clamp(0.5 + candidates.find((c) => c.template === template)!.score * 0.4, 0.5, 0.95);

      results.push(
        new Goal({
          description: template.description,
          type: 'life',
          status: 'active',
          priority,
          progress: 0,
          drivenBy: template.drivenBy,
          successCondition: template.successCondition,
          failureCondition: template.failureCondition,
        }),
      );
    }

    // Always return at least 2 goals (use fallbacks if needed)
    if (results.length < 2) {
      results.push(
        new Goal({
          description: 'Find meaning and connection in life',
          type: 'life',
          status: 'active',
          priority: 0.5,
          progress: 0,
          drivenBy: ['extraversion', 'agreeableness'],
          successCondition: 'Maintain at least one deeply satisfying relationship',
        }),
      );
    }

    return results;
  }

  /**
   * Reprioritise existing goals based on current state and time.
   *
   * Factors:
   * - Urgency: boost priority for approaching deadlines
   * - Mood alignment: anger → confrontation goals up; fear → safety goals up
   * - Personality: conscientiousness = stick to existing; impulsivity = shift rapidly
   *
   * Mutates `goal.priority` in place via `Goal.updatePriority()`.
   */
  reprioritize(goals: Goal[], character: Character, currentTime: SimulationTime): void {
    const p = character.personality;
    const s = character.state;

    const conscientiousness01 = norm(p.conscientiousness);
    const impulsivity01 = norm(p.impulsivity);

    // How much the dynamic modifiers can shift priority vs sticking to the original
    // Conscientious characters resist shifts; impulsive ones embrace them.
    const shiftMagnitude = clamp(0.1 + impulsivity01 * 0.3 - conscientiousness01 * 0.15, 0.05, 0.4);

    for (const goal of goals) {
      if (goal.status !== 'active' && goal.status !== 'paused') continue;

      let delta = 0;

      // ── Urgency: deadline proximity ────────────────────────────────────────
      if (goal.deadline !== undefined) {
        const daysRemaining = goal.deadline.day - currentTime.day;
        if (daysRemaining <= 0) {
          // Overdue — maximum urgency boost
          delta += 0.3;
        } else if (daysRemaining <= 3) {
          // Imminent deadline
          delta += 0.2;
        } else if (daysRemaining <= 7) {
          delta += 0.1;
        }
      }

      // ── Mood alignment ────────────────────────────────────────────────────
      const moodBoost = s.moodIntensity * 0.15; // scale by how strong the mood is

      if (s.mood === 'anger') {
        // Anger boosts confrontational goals
        const desc = goal.description.toLowerCase();
        if (
          desc.includes('overthrow') ||
          desc.includes('justice') ||
          desc.includes('power') ||
          desc.includes('challenge')
        ) {
          delta += moodBoost;
        }
      } else if (s.mood === 'fear') {
        // Fear boosts safety/protection goals
        const desc = goal.description.toLowerCase();
        if (
          desc.includes('safe') ||
          desc.includes('protect') ||
          desc.includes('family') ||
          desc.includes('survive')
        ) {
          delta += moodBoost;
        }
      } else if (s.mood === 'joy') {
        // Joy gently boosts progress on positive/social goals
        delta += moodBoost * 0.5;
      }

      // ── Progress stagnation penalty for non-impulsive characters ──────────
      if (goal.progress < 0.1 && conscientiousness01 > 0.6) {
        // Conscientious characters get frustrated by stagnant goals
        delta -= 0.05;
      }

      // Apply delta, scaled by shiftMagnitude
      const scaledDelta = delta * shiftMagnitude;
      const newPriority = clamp(goal.priority + scaledDelta, 0, 1);
      goal.updatePriority(newPriority);
    }
  }

  /**
   * Decompose a high-level goal into 1–3 immediate/short-term sub-goals.
   *
   * Links each sub-goal back via `parentGoal`.
   * Returns the newly created sub-Goal instances (not yet added to any character).
   */
  decompose(goal: Goal): Goal[] {
    const subGoals: Goal[] = [];

    // Generic decomposition heuristics based on goal description keywords
    const desc = goal.description.toLowerCase();

    if (desc.includes('explore') || desc.includes('discover')) {
      subGoals.push(
        new Goal({
          description: 'Gather information and maps of the target region',
          type: 'short_term',
          status: 'active',
          priority: clamp(goal.priority * 0.8, 0, 1),
          progress: 0,
          parentGoal: goal.id,
          drivenBy: goal.drivenBy,
          successCondition: 'Obtain reliable information about the destination',
        }),
        new Goal({
          description: 'Secure supplies and companions for the journey',
          type: 'immediate',
          status: 'active',
          priority: clamp(goal.priority * 0.7, 0, 1),
          progress: 0,
          parentGoal: goal.id,
          drivenBy: goal.drivenBy,
          successCondition: 'Assemble necessary resources and at least one travel companion',
        }),
      );
    } else if (desc.includes('protect') || desc.includes('safe')) {
      subGoals.push(
        new Goal({
          description: 'Identify current threats to those under protection',
          type: 'immediate',
          status: 'active',
          priority: clamp(goal.priority * 0.9, 0, 1),
          progress: 0,
          parentGoal: goal.id,
          drivenBy: goal.drivenBy,
          successCondition: 'Compile a list of known threats and their severity',
        }),
        new Goal({
          description: 'Establish a secure refuge or escape route',
          type: 'short_term',
          status: 'active',
          priority: clamp(goal.priority * 0.75, 0, 1),
          progress: 0,
          parentGoal: goal.id,
          drivenBy: goal.drivenBy,
          successCondition: 'Identify and prepare a location that can shelter key allies',
        }),
      );
    } else if (desc.includes('power') || desc.includes('leadership') || desc.includes('influence')) {
      subGoals.push(
        new Goal({
          description: 'Build alliances with key power brokers',
          type: 'short_term',
          status: 'active',
          priority: clamp(goal.priority * 0.8, 0, 1),
          progress: 0,
          parentGoal: goal.id,
          drivenBy: goal.drivenBy,
          successCondition: 'Forge at least two meaningful political or social alliances',
        }),
        new Goal({
          description: 'Demonstrate competence in a public or respected domain',
          type: 'short_term',
          status: 'active',
          priority: clamp(goal.priority * 0.7, 0, 1),
          progress: 0,
          parentGoal: goal.id,
          drivenBy: goal.drivenBy,
          successCondition: 'Achieve recognition for skill or accomplishment in a relevant field',
        }),
      );
    } else {
      // Generic fallback decomposition
      subGoals.push(
        new Goal({
          description: `Research and plan toward: ${goal.description}`,
          type: 'immediate',
          status: 'active',
          priority: clamp(goal.priority * 0.7, 0, 1),
          progress: 0,
          parentGoal: goal.id,
          drivenBy: goal.drivenBy,
          successCondition: `Have a concrete plan for achieving: ${goal.successCondition}`,
        }),
        new Goal({
          description: `Take the first concrete step toward: ${goal.description}`,
          type: 'short_term',
          status: 'active',
          priority: clamp(goal.priority * 0.6, 0, 1),
          progress: 0,
          parentGoal: goal.id,
          drivenBy: goal.drivenBy,
          successCondition: 'Complete one meaningful action that advances the parent goal',
        }),
      );
    }

    // Register sub-goal IDs on the parent (mutates parent entity in place)
    for (const subGoal of subGoals) {
      goal.addSubGoal(subGoal.id);
    }

    return subGoals;
  }
}
