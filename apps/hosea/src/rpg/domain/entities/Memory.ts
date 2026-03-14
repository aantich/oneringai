import { CharacterInvariantError } from '../errors/DomainErrors.js';
import type { Emotion } from '../types/Enums.js';
import type { SimulationTime } from '../types/SimulationTime.js';
import type { CharacterId } from '../value-objects/CharacterId.js';

export interface MemoryParams {
  id?: string;
  description: string;
  timestamp: SimulationTime;
  location?: string;
  participants?: CharacterId[];
  perspectiveOf: CharacterId;
  emotionalValence: number;
  emotionalTags?: Emotion[];
  importance: number;
  tags?: string[];
  relatedGoals?: string[];
  relatedMemories?: string[];
}

function clamp01(value: number, field: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new CharacterInvariantError(
      'memory',
      `Field "${field}" must be a finite number in [0, 1], got ${value}.`,
    );
  }
  return value;
}

function clampSymmetric(value: number, field: string): number {
  if (!Number.isFinite(value) || value < -1 || value > 1) {
    throw new CharacterInvariantError(
      'memory',
      `Field "${field}" must be a finite number in [-1, 1], got ${value}.`,
    );
  }
  return value;
}

/** Importance threshold above which a memory is considered significant. */
const SIGNIFICANCE_THRESHOLD = 0.3;

export class Memory {
  readonly id: string;
  readonly description: string;
  readonly timestamp: SimulationTime;
  readonly location?: string;
  readonly participants: CharacterId[];
  readonly perspectiveOf: CharacterId;
  emotionalValence: number;
  emotionalTags: Emotion[];
  importance: number;
  tags: string[];
  relatedGoals: string[];
  relatedMemories: string[];

  constructor(params: MemoryParams) {
    this.id = params.id ?? crypto.randomUUID();
    this.description = params.description;
    this.timestamp = params.timestamp;
    this.location = params.location;
    this.participants = params.participants ? [...params.participants] : [];
    this.perspectiveOf = params.perspectiveOf;
    this.emotionalValence = clampSymmetric(params.emotionalValence, 'emotionalValence');
    this.emotionalTags = params.emotionalTags ? [...params.emotionalTags] : [];
    this.importance = clamp01(params.importance, 'importance');
    this.tags = params.tags ? [...params.tags] : [];
    this.relatedGoals = params.relatedGoals ? [...params.relatedGoals] : [];
    this.relatedMemories = params.relatedMemories ? [...params.relatedMemories] : [];
  }

  // ─── Importance management ────────────────────────────────────────────────

  /** Reduces importance by the given amount, clamped to a minimum of 0. */
  decay(amount: number): void {
    this.importance = Math.max(0, this.importance - amount);
  }

  /** Increases importance by the given amount, clamped to a maximum of 1. */
  reinforce(amount: number): void {
    this.importance = Math.min(1, this.importance + amount);
  }

  // ─── Tag management ───────────────────────────────────────────────────────

  addTag(tag: string): void {
    if (!this.tags.includes(tag)) {
      this.tags.push(tag);
    }
  }

  // ─── Queries ──────────────────────────────────────────────────────────────

  /**
   * Returns true if the given character is the perspective holder or a participant.
   */
  isRelatedTo(characterId: CharacterId): boolean {
    return (
      this.perspectiveOf === characterId || this.participants.includes(characterId)
    );
  }

  get isSignificant(): boolean {
    return this.importance > SIGNIFICANCE_THRESHOLD;
  }
}
