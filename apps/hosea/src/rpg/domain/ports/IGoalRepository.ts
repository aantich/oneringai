import type { CharacterId } from '../value-objects/CharacterId.js';
import type { GoalType } from '../types/Enums.js';
import type { Goal } from '../entities/Goal.js';

/**
 * Port (repository interface) for persisting and querying Goal records.
 *
 * Goals do not carry a characterId on the entity itself, so the repository
 * owns the character-to-goal association. All write operations therefore
 * accept an explicit characterId alongside the goal.
 *
 * Implementations live in the infrastructure layer.
 */
export interface IGoalRepository {
  /**
   * Persists a goal and associates it with the given character.
   * Creates a new record if one does not exist, or replaces the existing
   * record with the same goal id (updating the character association if it
   * has changed).
   */
  save(characterId: CharacterId, goal: Goal): Promise<void>;

  /** Returns the goal with the given id, or null if not found. */
  findById(id: string): Promise<Goal | null>;

  /** Returns all goals associated with the given character. */
  findByCharacter(characterId: CharacterId): Promise<Goal[]>;

  /**
   * Returns all goals associated with the given character that match
   * the specified GoalType.
   */
  findByType(characterId: CharacterId, type: GoalType): Promise<Goal[]>;

  /**
   * Returns all goals associated with the given character that are
   * currently active (status === 'active').
   */
  findActive(characterId: CharacterId): Promise<Goal[]>;

  /** Permanently removes the goal with the given id. No-ops if not found. */
  delete(id: string): Promise<void>;

  /** Permanently removes every goal associated with the given character. */
  deleteByCharacter(characterId: CharacterId): Promise<void>;
}
