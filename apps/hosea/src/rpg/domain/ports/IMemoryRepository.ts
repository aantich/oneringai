import type { CharacterId } from '../value-objects/CharacterId.js';
import type { SimulationTime } from '../types/SimulationTime.js';
import type { Memory } from '../entities/Memory.js';

/**
 * Port (repository interface) for persisting and querying Memory records.
 * Implementations live in the infrastructure layer.
 */
export interface IMemoryRepository {
  /**
   * Persists a memory. Creates a new record if one does not exist,
   * or replaces the existing record with the same id.
   */
  save(memory: Memory): Promise<void>;

  /** Returns the memory with the given id, or null if not found. */
  findById(id: string): Promise<Memory | null>;

  /** Returns all memories that belong to the given character. */
  findByCharacter(characterId: CharacterId): Promise<Memory[]>;

  /**
   * Returns all memories belonging to a character that carry the given tag.
   * Tag matching is case-sensitive and exact.
   */
  findByTag(characterId: CharacterId, tag: string): Promise<Memory[]>;

  /**
   * Returns all memories belonging to a character whose timestamp falls
   * within the inclusive range [from, to] (compared by tick).
   */
  findByTimeRange(
    characterId: CharacterId,
    from: SimulationTime,
    to: SimulationTime,
  ): Promise<Memory[]>;

  /**
   * Returns all memories belonging to a character that involve a given
   * participant (i.e. the participant id appears in the memory's participant list).
   */
  findByParticipant(
    characterId: CharacterId,
    participantId: CharacterId,
  ): Promise<Memory[]>;

  /** Permanently removes the memory with the given id. No-ops if not found. */
  delete(id: string): Promise<void>;

  /** Permanently removes every memory belonging to the given character. */
  deleteByCharacter(characterId: CharacterId): Promise<void>;
}
