import type { IRelationshipRepository } from '../../domain/ports/IRelationshipRepository.js';
import type { Relationship } from '../../domain/entities/Relationship.js';
import type { CharacterId } from '../../domain/value-objects/CharacterId.js';

/**
 * In-memory implementation of IRelationshipRepository.
 * Maintains a secondary index of characterId → relationshipIds for efficient lookups.
 * Each character id (source or target) is indexed.
 * Suitable for tests and as a runtime cache layer.
 */
export class InMemoryRelationshipRepository implements IRelationshipRepository {
  private readonly relationships = new Map<string, Relationship>();
  /**
   * Maps characterId (either source or target) → set of relationship ids
   * that involve that character.
   */
  private readonly characterIndex = new Map<string, Set<string>>();

  async save(relationship: Relationship): Promise<void> {
    const existing = this.relationships.get(relationship.id);

    // If the relationship already exists, remove stale index entries
    // in case sourceId or targetId changed (unlikely but correct).
    if (existing !== undefined) {
      this.removeFromIndex(existing.sourceId, existing.id);
      this.removeFromIndex(existing.targetId, existing.id);
    }

    this.relationships.set(relationship.id, relationship);
    this.indexForCharacter(relationship.sourceId).add(relationship.id);
    this.indexForCharacter(relationship.targetId).add(relationship.id);
  }

  async findById(id: string): Promise<Relationship | null> {
    return this.relationships.get(id) ?? null;
  }

  async findByCharacter(characterId: CharacterId): Promise<Relationship[]> {
    const ids = this.characterIndex.get(characterId);
    if (ids === undefined || ids.size === 0) {
      return [];
    }
    const result: Relationship[] = [];
    for (const id of ids) {
      const rel = this.relationships.get(id);
      if (rel !== undefined) {
        result.push(rel);
      }
    }
    return result;
  }

  async findBetween(
    sourceId: CharacterId,
    targetId: CharacterId,
  ): Promise<Relationship | null> {
    const ids = this.characterIndex.get(sourceId);
    if (ids === undefined) {
      return null;
    }
    for (const id of ids) {
      const rel = this.relationships.get(id);
      if (rel !== undefined && rel.sourceId === sourceId && rel.targetId === targetId) {
        return rel;
      }
    }
    return null;
  }

  async delete(id: string): Promise<void> {
    const relationship = this.relationships.get(id);
    if (relationship === undefined) {
      return;
    }
    this.relationships.delete(id);
    this.removeFromIndex(relationship.sourceId, id);
    this.removeFromIndex(relationship.targetId, id);
  }

  async deleteByCharacter(characterId: CharacterId): Promise<void> {
    const ids = this.characterIndex.get(characterId);
    if (ids === undefined) {
      return;
    }
    for (const id of ids) {
      const rel = this.relationships.get(id);
      if (rel !== undefined) {
        this.relationships.delete(id);
        // Remove from the other character's index
        const otherId =
          rel.sourceId === characterId ? rel.targetId : rel.sourceId;
        this.removeFromIndex(otherId, id);
      }
    }
    this.characterIndex.delete(characterId);
  }

  /** Returns the total number of relationships stored. */
  get size(): number {
    return this.relationships.size;
  }

  /** Removes all relationships. Useful for test teardown. */
  clear(): void {
    this.relationships.clear();
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

  private removeFromIndex(characterId: CharacterId, relationshipId: string): void {
    const idSet = this.characterIndex.get(characterId);
    if (idSet !== undefined) {
      idSet.delete(relationshipId);
    }
  }
}
