import type { Character } from '../entities/Character.js';
import type { Goal } from '../entities/Goal.js';
import type { SimulationTime } from '../types/SimulationTime.js';
import type { TimeSlot } from '../types/Enums.js';
import { createDailyPlan } from '../value-objects/DailyPlan.js';
import type { DailyPlan } from '../value-objects/DailyPlan.js';
import { createScheduleBlock } from '../value-objects/ScheduleBlock.js';
import type { ScheduleBlock } from '../value-objects/ScheduleBlock.js';
import type { GoalEngine } from './GoalEngine.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const ALL_SLOTS: TimeSlot[] = ['morning', 'afternoon', 'evening', 'night'];

/** Minimum number of goals a character will try to pursue per day. */
const MIN_GOALS_PER_DAY = 1;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Normalise a [-1, 1] trait to [0, 1]. */
function norm(trait: number): number {
  return (trait + 1) / 2;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Map a time slot to a human-readable description qualifier.
 */
function slotLabel(slot: TimeSlot): string {
  switch (slot) {
    case 'morning':
      return 'in the morning';
    case 'afternoon':
      return 'in the afternoon';
    case 'evening':
      return 'in the evening';
    case 'night':
      return 'at night';
  }
}

// ─── DailyPlanner ─────────────────────────────────────────────────────────────

/**
 * Stateless service: converts active goals + personality into a structured
 * DailyPlan covering all four time slots.
 *
 * Algorithm (from design doc):
 * 1. Sort active goals by priority
 * 2. Select top N goals (N influenced by conscientiousness)
 * 3. Assign to time blocks
 * 4. Personality filters (extravert → social; neurotic → safety margins)
 * 5. Reserve time for basic needs
 */
export class DailyPlanner {
  constructor(private readonly goalEngine: GoalEngine) {}

  /**
   * Create a daily plan for the given character.
   *
   * If the character has no active goals, the GoalEngine is used to generate
   * life goals first (they are not persisted — callers must save them).
   */
  createPlan(
    character: Character,
    goals: Goal[],
    currentTime: SimulationTime,
  ): DailyPlan {
    const p = character.personality;
    const s = character.state;

    const conscientiousness01 = norm(p.conscientiousness);
    const extraversion01 = norm(p.extraversion);
    const neuroticism01 = norm(p.neuroticism);
    const impulsivity01 = norm(p.impulsivity);

    // ── Step 1: Sort active goals by priority ─────────────────────────────────
    this.goalEngine.reprioritize(goals, character, currentTime);

    const activeGoals = goals
      .filter((g) => g.status === 'active')
      .sort((a, b) => b.priority - a.priority);

    // ── Step 2: Select top N goals ────────────────────────────────────────────
    // Conscientious characters take on more planned activities (up to 3 goal slots).
    const maxGoalSlots = Math.round(MIN_GOALS_PER_DAY + conscientiousness01 * 2); // 1–3
    const selectedGoals = activeGoals.slice(0, maxGoalSlots);

    // ── Step 3 & 4: Assign to time slots + personality filters ────────────────
    //
    // Slot assignment strategy:
    // - morning: most productive for conscientious; rest/safety for neurotic
    // - afternoon: primary work slot for all
    // - evening: social for extraverts; additional goal work for conscientious
    // - night: rest; extra safety margin for neurotic
    //
    // We fill slots from most to least important.

    const slotAssignments: Map<TimeSlot, ScheduleBlock> = new Map();

    const availableSlots: TimeSlot[] = [...ALL_SLOTS];

    // Assign goal-driven blocks ------------------------------------------------
    for (const goal of selectedGoals) {
      const slot = availableSlots.shift();
      if (slot === undefined) break;

      // Flexibility: conscientious characters stick to plans; impulsive ones are loose
      const flexibility = clamp(0.2 + impulsivity01 * 0.5 - conscientiousness01 * 0.2, 0.1, 0.9);

      slotAssignments.set(
        slot,
        createScheduleBlock({
          timeSlot: slot,
          activity: `Work toward: ${goal.description} (${slotLabel(slot)})`,
          relatedGoal: goal.id,
          location: this._inferLocation(goal.description),
          flexibility,
        }),
      );
    }

    // Extravert personality filter: schedule social activity in evening if free
    if (extraversion01 > 0.6 && !slotAssignments.has('evening')) {
      slotAssignments.set(
        'evening',
        createScheduleBlock({
          timeSlot: 'evening',
          activity: 'Socialise with friends or visit the tavern',
          location: 'social district',
          flexibility: 0.8,
        }),
      );
    }

    // Neurotic personality filter: add a safety-margin rest block in morning if free
    if (neuroticism01 > 0.65 && !slotAssignments.has('morning')) {
      slotAssignments.set(
        'morning',
        createScheduleBlock({
          timeSlot: 'morning',
          activity: 'Careful morning routine: check surroundings and prepare contingency plans',
          location: 'home',
          flexibility: 0.2,
        }),
      );
    }

    // ── Step 5: Reserve time for basic needs ──────────────────────────────────
    // Night is always reserved for sleep unless already assigned.
    if (!slotAssignments.has('night')) {
      slotAssignments.set(
        'night',
        createScheduleBlock({
          timeSlot: 'night',
          activity: 'Rest and sleep',
          location: 'home',
          flexibility: 0.1,
        }),
      );
    }

    // Fill any remaining unassigned slots with low-priority free time
    for (const slot of ALL_SLOTS) {
      if (!slotAssignments.has(slot)) {
        slotAssignments.set(
          slot,
          createScheduleBlock({
            timeSlot: slot,
            activity: this._defaultActivity(slot, character),
            location: 'home or nearby',
            flexibility: 0.9,
          }),
        );
      }
    }

    // ── Assemble blocks in chronological order ────────────────────────────────
    const blocks: ScheduleBlock[] = ALL_SLOTS.map((slot) => slotAssignments.get(slot)!);

    // ── Contingencies ─────────────────────────────────────────────────────────
    const contingencies = this._buildContingencies(character, selectedGoals, neuroticism01);

    return createDailyPlan({
      date: currentTime,
      blocks,
      contingencies,
    });
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  private _inferLocation(goalDescription: string): string {
    const desc = goalDescription.toLowerCase();
    if (desc.includes('explore') || desc.includes('journey')) return 'wilderness or road';
    if (desc.includes('social') || desc.includes('ally') || desc.includes('meet')) return 'social district';
    if (desc.includes('market') || desc.includes('trade') || desc.includes('wealth')) return 'marketplace';
    if (desc.includes('train') || desc.includes('fight') || desc.includes('power')) return 'training ground';
    if (desc.includes('research') || desc.includes('knowledge') || desc.includes('study')) return 'library or study';
    if (desc.includes('protect') || desc.includes('safe') || desc.includes('guard')) return 'defensive position';
    return 'town centre';
  }

  private _defaultActivity(slot: TimeSlot, character: Character): string {
    const s = character.state;
    if (s.energy < 0.3) return `Rest and recover (${slotLabel(slot)})`;
    switch (slot) {
      case 'morning':
        return 'Morning routine and errands';
      case 'afternoon':
        return 'Attend to daily responsibilities';
      case 'evening':
        return 'Relax and reflect on the day';
      case 'night':
        return 'Rest and sleep';
    }
  }

  private _buildContingencies(
    character: Character,
    selectedGoals: Goal[],
    neuroticism01: number,
  ): string[] {
    const contingencies: string[] = [
      'Return home if conditions become unsafe.',
    ];

    // Neurotic characters plan for more failure scenarios
    if (neuroticism01 > 0.6) {
      contingencies.push('If the primary location is unavailable, seek the nearest safe alternative.');
      contingencies.push('If feeling overwhelmed, take a break and defer non-urgent tasks to the next day.');
    }

    for (const goal of selectedGoals) {
      contingencies.push(
        `If unable to progress on "${goal.description}", spend the time gathering information instead.`,
      );
    }

    if (character.state.socialNeed > 0.7) {
      contingencies.push('If feeling isolated, seek company in the evening even if it disrupts the plan.');
    }

    return contingencies;
  }
}
