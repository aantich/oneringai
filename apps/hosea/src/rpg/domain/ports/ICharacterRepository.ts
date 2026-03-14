import type { CharacterId } from '../value-objects/CharacterId.js';
import type { Character } from '../entities/Character.js';

/**
 * Port (repository interface) for persisting and retrieving Character aggregates.
 * Implementations live in the infrastructure layer.
 */
export interface ICharacterRepository {
  /**
   * Persists a character. Creates a new record if one does not exist,
   * or replaces the existing record with the same id.
   */
  save(character: Character): Promise<void>;

  /** Returns the character with the given id, or null if not found. */
  findById(id: CharacterId): Promise<Character | null>;

  /** Returns the first character whose name matches exactly, or null if not found. */
  findByName(name: string): Promise<Character | null>;

  /** Returns every character in the repository. */
  findAll(): Promise<Character[]>;

  /** Permanently removes the character with the given id. No-ops if not found. */
  delete(id: CharacterId): Promise<void>;

  /** Returns true if a character with the given id exists in the repository. */
  exists(id: CharacterId): Promise<boolean>;
}
