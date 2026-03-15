import type { ICharacterRepository } from '../../domain/ports/ICharacterRepository.js';
import type { Character } from '../../domain/entities/Character.js';
import type { CharacterId } from '../../domain/value-objects/CharacterId.js';

/**
 * In-memory implementation of ICharacterRepository.
 * Suitable for tests and as a runtime cache layer.
 */
export class InMemoryCharacterRepository implements ICharacterRepository {
  private readonly characters = new Map<string, Character>();

  async save(character: Character): Promise<void> {
    this.characters.set(character.id, character);
  }

  async findById(id: CharacterId): Promise<Character | null> {
    return this.characters.get(id) ?? null;
  }

  async findByName(name: string): Promise<Character | null> {
    for (const character of this.characters.values()) {
      if (character.name === name) {
        return character;
      }
    }
    return null;
  }

  async findAll(): Promise<Character[]> {
    return Array.from(this.characters.values());
  }

  async delete(id: CharacterId): Promise<void> {
    this.characters.delete(id);
  }

  async exists(id: CharacterId): Promise<boolean> {
    return this.characters.has(id);
  }

  /** Returns the number of characters currently stored. */
  get size(): number {
    return this.characters.size;
  }

  /** Removes all characters. Useful for test teardown. */
  clear(): void {
    this.characters.clear();
  }
}
