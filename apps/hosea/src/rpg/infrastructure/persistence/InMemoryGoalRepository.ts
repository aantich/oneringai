import type { IGoalRepository } from '../../domain/ports/IGoalRepository.js';
import type { Goal } from '../../domain/entities/Goal.js';
import type { CharacterId } from '../../domain/value-objects/CharacterId.js';
import type { GoalType } from '../../domain/types/Enums.js';

/**
 * In-memory implementation of IGoalRepository.
 * Maintains a secondary index of characterId → goalIds and a separate map of
 * goalId → characterId so that character ownership can be resolved from either end.
 * Suitable for tests and as a runtime cache layer.
 */
export class InMemoryGoalRepository implements IGoalRepository {
  private readonly goals = new Map<string, Goal>();
  /** Maps characterId → set of goal ids owned by that character. */
  private readonly characterIndex = new Map<string, Set<string>>();
  /** Maps goalId → characterId for reverse lookup. */
  private readonly goalOwner = new Map<string, CharacterId>();

  async save(characterId: CharacterId, goal: Goal): Promise<void> {
    const existingOwnerId = this.goalOwner.get(goal.id);

    // If ownership changed, remove from the old character's index.
    if (existingOwnerId !== undefined && existingOwnerId !== characterId) {
      this.removeFromIndex(existingOwnerId, goal.id);
    }

    this.goals.set(goal.id, goal);
    this.goalOwner.set(goal.id, characterId);
    this.indexForCharacter(characterId).add(goal.id);
  }

  async findById(id: string): Promise<Goal | null> {
    return this.goals.get(id) ?? null;
  }

  async findByCharacter(characterId: CharacterId): Promise<Goal[]> {
    const ids = this.characterIndex.get(characterId);
    if (ids === undefined || ids.size === 0) {
      return [];
    }
    const result: Goal[] = [];
    for (const id of ids) {
      const goal = this.goals.get(id);
      if (goal !== undefined) {
        result.push(goal);
      }
    }
    return result;
  }

  async findByType(characterId: CharacterId, type: GoalType): Promise<Goal[]> {
    const all = await this.findByCharacter(characterId);
    return all.filter((g) => g.type === type);
  }

  async findActive(characterId: CharacterId): Promise<Goal[]> {
    const all = await this.findByCharacter(characterId);
    return all.filter((g) => g.status === 'active');
  }

  async delete(id: string): Promise<void> {
    const ownerId = this.goalOwner.get(id);
    if (ownerId === undefined) {
      return;
    }
    this.goals.delete(id);
    this.goalOwner.delete(id);
    this.removeFromIndex(ownerId, id);
  }

  async deleteByCharacter(characterId: CharacterId): Promise<void> {
    const ids = this.characterIndex.get(characterId);
    if (ids === undefined) {
      return;
    }
    for (const id of ids) {
      this.goals.delete(id);
      this.goalOwner.delete(id);
    }
    this.characterIndex.delete(characterId);
  }

  /** Returns the total number of goals stored. */
  get size(): number {
    return this.goals.size;
  }

  /** Removes all goals. Useful for test teardown. */
  clear(): void {
    this.goals.clear();
    this.characterIndex.clear();
    this.goalOwner.clear();
  }

  private indexForCharacter(characterId: CharacterId): Set<string> {
    let idSet = this.characterIndex.get(characterId);
    if (idSet === undefined) {
      idSet = new Set<string>();
      this.characterIndex.set(characterId, idSet);
    }
    return idSet;
  }

  private removeFromIndex(characterId: CharacterId, goalId: string): void {
    const idSet = this.characterIndex.get(characterId);
    if (idSet !== undefined) {
      idSet.delete(goalId);
    }
  }
}
