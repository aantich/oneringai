import { CharacterInvariantError } from '../errors/DomainErrors.js';
import type { SimulationTime } from '../types/SimulationTime.js';
import { createCharacterId } from '../value-objects/CharacterId.js';
import type { CharacterId } from '../value-objects/CharacterId.js';
import type { Personality } from '../value-objects/Personality.js';
import { createDefaultDerivedState } from '../value-objects/DerivedState.js';
import type { DerivedState } from '../value-objects/DerivedState.js';
import type { Possession } from '../value-objects/Possession.js';
import type { Belief } from '../value-objects/Belief.js';
import type { DailyPlan } from '../value-objects/DailyPlan.js';

export interface CharacterParams {
  id?: CharacterId;
  name: string;
  description: string;
  age: number;
  background: string;
  personality: Personality;
  state?: DerivedState;
  possessions?: Possession[];
  beliefs?: Belief[];
}

export class Character {
  readonly id: CharacterId;
  name: string;
  description: string;
  age: number;
  background: string;
  readonly personality: Personality;
  state: DerivedState;
  possessions: Possession[];
  beliefs: Belief[];
  currentPlan?: DailyPlan;

  constructor(params: CharacterParams) {
    if (!params.name || params.name.trim().length === 0) {
      throw new CharacterInvariantError(
        params.id ?? 'unknown',
        'Name must not be empty.',
      );
    }
    if (!Number.isFinite(params.age) || params.age <= 0) {
      throw new CharacterInvariantError(
        params.id ?? params.name,
        `Age must be a positive number, got ${params.age}.`,
      );
    }

    this.id = params.id ?? createCharacterId();
    this.name = params.name.trim();
    this.description = params.description;
    this.age = params.age;
    this.background = params.background;
    this.personality = params.personality;
    this.state = params.state ?? createDefaultDerivedState(params.personality);
    this.possessions = params.possessions ? [...params.possessions] : [];
    this.beliefs = params.beliefs ? [...params.beliefs] : [];
  }

  // ─── State ────────────────────────────────────────────────────────────────

  updateState(newState: DerivedState): void {
    this.state = newState;
  }

  // ─── Possessions ──────────────────────────────────────────────────────────

  addPossession(possession: Possession): void {
    const existing = this.possessions.find((p) => p.id === possession.id);
    if (existing) {
      throw new CharacterInvariantError(
        this.id,
        `Possession with id "${possession.id}" already exists.`,
      );
    }
    this.possessions.push(possession);
  }

  removePossession(possessionId: string): boolean {
    const index = this.possessions.findIndex((p) => p.id === possessionId);
    if (index === -1) {
      return false;
    }
    this.possessions.splice(index, 1);
    return true;
  }

  findPossession(possessionId: string): Possession | undefined {
    return this.possessions.find((p) => p.id === possessionId);
  }

  // ─── Beliefs ──────────────────────────────────────────────────────────────

  addBelief(belief: Belief): void {
    const existing = this.beliefs.find((b) => b.id === belief.id);
    if (existing) {
      throw new CharacterInvariantError(
        this.id,
        `Belief with id "${belief.id}" already exists.`,
      );
    }
    this.beliefs.push(belief);
  }

  updateBelief(
    beliefId: string,
    updates: Partial<Pick<Belief, 'confidence' | 'content'>>,
  ): void {
    const index = this.beliefs.findIndex((b) => b.id === beliefId);
    if (index === -1) {
      throw new CharacterInvariantError(
        this.id,
        `Belief with id "${beliefId}" not found.`,
      );
    }

    const current = this.beliefs[index]!;

    if (
      updates.confidence !== undefined &&
      (!Number.isFinite(updates.confidence) ||
        updates.confidence < 0 ||
        updates.confidence > 1)
    ) {
      throw new CharacterInvariantError(
        this.id,
        `Belief confidence must be in [0, 1], got ${updates.confidence}.`,
      );
    }

    // Beliefs are readonly value objects — replace with a new frozen object.
    const updated: Belief = Object.freeze({
      ...current,
      ...(updates.confidence !== undefined ? { confidence: updates.confidence } : {}),
      ...(updates.content !== undefined ? { content: updates.content } : {}),
    });

    this.beliefs[index] = updated;
  }

  removeBelief(beliefId: string): boolean {
    const index = this.beliefs.findIndex((b) => b.id === beliefId);
    if (index === -1) {
      return false;
    }
    this.beliefs.splice(index, 1);
    return true;
  }

  // ─── Plan ─────────────────────────────────────────────────────────────────

  setPlan(plan: DailyPlan): void {
    this.currentPlan = plan;
  }

  clearPlan(): void {
    this.currentPlan = undefined;
  }
}
