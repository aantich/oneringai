import type { ICharacterRepository } from '../domain/ports/ICharacterRepository.js';
import type { IGoalRepository } from '../domain/ports/IGoalRepository.js';
import type { IMemoryRepository } from '../domain/ports/IMemoryRepository.js';
import type { IRelationshipRepository } from '../domain/ports/IRelationshipRepository.js';
import type { IWorldClock } from '../domain/ports/IWorldClock.js';
import type { DailyPlanner } from '../domain/services/DailyPlanner.js';
import type { GoalEngine } from '../domain/services/GoalEngine.js';
import type { MemoryEngine } from '../domain/services/MemoryEngine.js';
import type { MoodEngine } from '../domain/services/MoodEngine.js';
import type { CharacterId } from '../domain/value-objects/CharacterId.js';

/** Number of ticks in a full simulation day (morning / afternoon / evening / night). */
const TICKS_PER_DAY = 4;

/**
 * Application service that orchestrates the simulation loop.
 *
 * Drives per-tick updates (memory decay, mood decay) and per-day lifecycle
 * events (daily planning, goal reprioritisation, rest) for all characters.
 * All persistence is handled by the injected repositories; this service
 * contains no storage state of its own.
 */
export class SimulationService {
  constructor(
    private readonly characterRepo: ICharacterRepository,
    private readonly goalRepo: IGoalRepository,
    private readonly memoryRepo: IMemoryRepository,
    private readonly relationshipRepo: IRelationshipRepository,
    private readonly clock: IWorldClock,
    private readonly moodEngine: MoodEngine,
    private readonly memoryEngine: MemoryEngine,
    private readonly goalEngine: GoalEngine,
    private readonly dailyPlanner: DailyPlanner,
  ) {}

  // ─── Public API ───────────────────────────────────────────────────────────

  /**
   * Advances the clock by one tick and applies per-tick updates to every
   * character:
   *   1. Advance the world clock.
   *   2. Decay each character's memories (importance reduction over time).
   *   3. Apply mood-tick decay to the character's derived state.
   *   4. Persist the updated character.
   */
  async tick(): Promise<void> {
    this.clock.advance();

    const characters = await this.characterRepo.findAll();

    await Promise.all(
      characters.map((character) => this._applyTick(character.id)),
    );
  }

  /**
   * Runs a complete simulation day for all characters.
   *
   * Sequence:
   *   1. Generate a fresh daily plan for each character (DailyPlanner).
   *   2. Run TICKS_PER_DAY ticks sequentially (morning → afternoon → evening → night).
   *   3. After the final tick, trigger end-of-day processing: goal
   *      reprioritisation and energy restoration via {@link startNewDay}.
   */
  async runDay(): Promise<void> {
    // Step 1 — Plan the day for all characters before any ticks run.
    const characters = await this.characterRepo.findAll();

    await Promise.all(
      characters.map(async (character) => {
        const time = this.clock.getCurrentTime();
        const goals = await this.goalRepo.findActive(character.id);
        const plan = this.dailyPlanner.createPlan(character, goals, time);
        character.setPlan(plan);
        await this.characterRepo.save(character);
      }),
    );

    // Step 2 — Run four ticks (one per time slot).
    for (let i = 0; i < TICKS_PER_DAY; i++) {
      await this.tick();
    }

    // Step 3 — End-of-day lifecycle.
    await this.startNewDay();
  }

  /**
   * Runs a single tick for one specific character without advancing the global
   * clock. Useful for targeted updates (e.g. responding to an external event).
   *
   * No-ops silently if the character does not exist.
   */
  async tickCharacter(characterId: CharacterId): Promise<void> {
    await this._applyTick(characterId);
  }

  /**
   * Triggers end-of-day processing for every character:
   *   1. Recalculate and update goal priorities via GoalEngine.
   *   2. Restore energy (simulate rest/sleep) via MoodEngine.
   *   3. Persist the updated character.
   *
   * Called automatically by {@link runDay} but can also be invoked directly
   * when the caller manages ticking externally.
   */
  async startNewDay(): Promise<void> {
    const characters = await this.characterRepo.findAll();

    await Promise.all(
      characters.map(async (character) => {
        // Recalculate goal priorities for the new day.
        const allGoals = await this.goalRepo.findByCharacter(character.id);
        const time = this.clock.getCurrentTime();
        this.goalEngine.reprioritize(allGoals, character, time);
        await Promise.all(
          allGoals.map((goal) => this.goalRepo.save(character.id, goal)),
        );

        // Restore energy after rest and update motivation from goals.
        const restedState = this.moodEngine.dayReset(character, allGoals);
        character.updateState(restedState);

        await this.characterRepo.save(character);
      }),
    );
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  /**
   * Applies per-tick updates to a single character and persists the result.
   * Shared by {@link tick} and {@link tickCharacter}.
   */
  private async _applyTick(characterId: CharacterId): Promise<void> {
    const character = await this.characterRepo.findById(characterId);
    if (character === null) {
      return;
    }

    // Decay all memories belonging to this character.
    const memories = await this.memoryRepo.findByCharacter(characterId);
    this.memoryEngine.decayMemories(memories, character.personality);
    await Promise.all(memories.map((memory) => this.memoryRepo.save(memory)));

    // Apply mood-tick decay to the derived state.
    const decayedState = this.moodEngine.tickDecay(character);
    character.updateState(decayedState);

    await this.characterRepo.save(character);
  }
}
