import { Character } from '../domain/entities/Character.js';
import type { Goal } from '../domain/entities/Goal.js';
import type { ICharacterRepository } from '../domain/ports/ICharacterRepository.js';
import type { IGoalRepository } from '../domain/ports/IGoalRepository.js';
import type { IMemoryRepository } from '../domain/ports/IMemoryRepository.js';
import type { IRelationshipRepository } from '../domain/ports/IRelationshipRepository.js';
import type { GoalEngine } from '../domain/services/GoalEngine.js';
import type { CharacterId } from '../domain/value-objects/CharacterId.js';
import type { DerivedState } from '../domain/value-objects/DerivedState.js';
import type { Personality } from '../domain/value-objects/Personality.js';

export interface CreateCharacterParams {
  name: string;
  description: string;
  age: number;
  background: string;
  personality: Personality;
}

/**
 * Application service for character lifecycle management.
 *
 * Orchestrates creation, retrieval, state updates, deletion, and goal
 * generation for characters. Coordinates between the character, goal, memory,
 * and relationship repositories and the GoalEngine domain service.
 */
export class CharacterService {
  constructor(
    private readonly characterRepo: ICharacterRepository,
    private readonly goalRepo: IGoalRepository,
    private readonly memoryRepo: IMemoryRepository,
    private readonly relationshipRepo: IRelationshipRepository,
    private readonly goalEngine: GoalEngine,
  ) {}

  /**
   * Creates a new character and generates its initial goals from personality.
   *
   * Steps:
   * 1. Construct a Character entity (assigns a new id and default derived state).
   * 2. Ask GoalEngine to generate initial goals from the character's personality.
   * 3. Persist the character.
   * 4. Persist each generated goal associated with the new character.
   * 5. Return the persisted character.
   */
  async createCharacter(params: CreateCharacterParams): Promise<Character> {
    const character = new Character({
      name: params.name,
      description: params.description,
      age: params.age,
      background: params.background,
      personality: params.personality,
    });

    const initialGoals = this.goalEngine.generateGoals(character);

    await this.characterRepo.save(character);

    await Promise.all(
      initialGoals.map((goal) => this.goalRepo.save(character.id, goal)),
    );

    return character;
  }

  /**
   * Returns the character with the given id, or null if not found.
   */
  async getCharacter(id: CharacterId): Promise<Character | null> {
    return this.characterRepo.findById(id);
  }

  /**
   * Returns every character in the repository.
   */
  async getAllCharacters(): Promise<Character[]> {
    return this.characterRepo.findAll();
  }

  /**
   * Applies a new DerivedState to a character and persists the change.
   *
   * Loads the character, mutates its state, and saves it back.
   * No-ops silently if the character does not exist.
   */
  async updateCharacterState(id: CharacterId, state: DerivedState): Promise<void> {
    const character = await this.characterRepo.findById(id);
    if (character === null) {
      return;
    }
    character.updateState(state);
    await this.characterRepo.save(character);
  }

  /**
   * Permanently removes a character and all associated data.
   *
   * Deletes in parallel: memories, relationships, goals, and the character
   * record itself. Each delete is a no-op if the character has no associated
   * records of that type.
   */
  async deleteCharacter(id: CharacterId): Promise<void> {
    await Promise.all([
      this.memoryRepo.deleteByCharacter(id),
      this.relationshipRepo.deleteByCharacter(id),
      this.goalRepo.deleteByCharacter(id),
    ]);
    await this.characterRepo.delete(id);
  }

  /**
   * Re-derives goals for an existing character from their personality.
   *
   * Removes all existing goals, generates fresh ones via GoalEngine, persists
   * them, and returns the new goal list. Returns an empty array if the
   * character does not exist.
   */
  async regenerateGoals(id: CharacterId): Promise<Goal[]> {
    const character = await this.characterRepo.findById(id);
    if (character === null) {
      return [];
    }

    await this.goalRepo.deleteByCharacter(id);

    const newGoals = this.goalEngine.generateGoals(character);

    await Promise.all(newGoals.map((goal) => this.goalRepo.save(id, goal)));

    return newGoals;
  }
}
