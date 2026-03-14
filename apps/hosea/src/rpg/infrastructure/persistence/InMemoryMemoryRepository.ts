import type { IMemoryRepository } from '../../domain/ports/IMemoryRepository.js';
import type { Memory } from '../../domain/entities/Memory.js';
import type { CharacterId } from '../../domain/value-objects/CharacterId.js';
import type { SimulationTime } from '../../domain/types/SimulationTime.js';

/**
 * In-memory implementation of IMemoryRepository.
 * Maintains a secondary index of characterId → memoryIds for efficient lookups.
 * Suitable for tests and as a runtime cache layer.
 */
export class InMemoryMemoryRepository implements IMemoryRepository {
  private readonly memories = new Map<string, Memory>();
  /** Maps characterId (perspectiveOf) → set of memory ids owned by that character. */
  private readonly characterIndex = new Map<string, Set<string>>();

  async save(memory: Memory): Promise<void> {
    const existing = this.memories.get(memory.id);

    // If re-saving a memory whose perspectiveOf changed, update the old index.
    if (existing !== undefined && existing.perspectiveOf !== memory.perspectiveOf) {
      const oldSet = this.characterIndex.get(existing.perspectiveOf);
      if (oldSet !== undefined) {
        oldSet.delete(memory.id);
      }
    }

    this.memories.set(memory.id, memory);
    this.indexForCharacter(memory.perspectiveOf).add(memory.id);
  }

  async findById(id: string): Promise<Memory | null> {
    return this.memories.get(id) ?? null;
  }

  async findByCharacter(characterId: CharacterId): Promise<Memory[]> {
    const ids = this.characterIndex.get(characterId);
    if (ids === undefined || ids.size === 0) {
      return [];
    }
    const result: Memory[] = [];
    for (const id of ids) {
      const memory = this.memories.get(id);
      if (memory !== undefined) {
        result.push(memory);
      }
    }
    return result;
  }

  async findByTag(characterId: CharacterId, tag: string): Promise<Memory[]> {
    const all = await this.findByCharacter(characterId);
    return all.filter((m) => m.tags.includes(tag));
  }

  async findByTimeRange(
    characterId: CharacterId,
    from: SimulationTime,
    to: SimulationTime,
  ): Promise<Memory[]> {
    const all = await this.findByCharacter(characterId);
    return all.filter(
      (m) => m.timestamp.tick >= from.tick && m.timestamp.tick <= to.tick,
    );
  }

  async findByParticipant(
    characterId: CharacterId,
    participantId: CharacterId,
  ): Promise<Memory[]> {
    const all = await this.findByCharacter(characterId);
    return all.filter((m) => m.participants.includes(participantId));
  }

  async delete(id: string): Promise<void> {
    const memory = this.memories.get(id);
    if (memory === undefined) {
      return;
    }
    this.memories.delete(id);
    const idSet = this.characterIndex.get(memory.perspectiveOf);
    if (idSet !== undefined) {
      idSet.delete(id);
    }
  }

  async deleteByCharacter(characterId: CharacterId): Promise<void> {
    const ids = this.characterIndex.get(characterId);
    if (ids === undefined) {
      return;
    }
    for (const id of ids) {
      this.memories.delete(id);
    }
    this.characterIndex.delete(characterId);
  }

  /** Returns the total number of memories stored. */
  get size(): number {
    return this.memories.size;
  }

  /** Removes all memories. Useful for test teardown. */
  clear(): void {
    this.memories.clear();
    this.characterIndex.clear();
  }

  private indexForCharacter(characterId: CharacterId): Set<string> {
    let idSet = this.characterIndex.get(characterId);
    if (idSet === undefined) {
      idSet = new Set<string>();
      this.characterIndex.set(characterId, idSet);
    }
    return idSet;
  }
}
