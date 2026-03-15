import type { CharacterId } from '../value-objects/CharacterId.js';
import type { Relationship } from '../entities/Relationship.js';

/**
 * Port (repository interface) for persisting and querying Relationship records.
 * Implementations live in the infrastructure layer.
 */
export interface IRelationshipRepository {
  /**
   * Persists a relationship. Creates a new record if one does not exist,
   * or replaces the existing record with the same id.
   */
  save(relationship: Relationship): Promise<void>;

  /** Returns the relationship with the given id, or null if not found. */
  findById(id: string): Promise<Relationship | null>;

  /**
   * Returns all relationships where the given character is either the
   * source or the target.
   */
  findByCharacter(characterId: CharacterId): Promise<Relationship[]>;

  /**
   * Returns the relationship from sourceId toward targetId, or null if
   * no such directed relationship exists.
   */
  findBetween(
    sourceId: CharacterId,
    targetId: CharacterId,
  ): Promise<Relationship | null>;

  /** Permanently removes the relationship with the given id. No-ops if not found. */
  delete(id: string): Promise<void>;

  /**
   * Permanently removes every relationship where the given character is either
   * the source or the target.
   */
  deleteByCharacter(characterId: CharacterId): Promise<void>;
}
