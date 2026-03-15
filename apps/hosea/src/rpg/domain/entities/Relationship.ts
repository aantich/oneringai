import { CharacterInvariantError } from '../errors/DomainErrors.js';
import type { RelationshipType } from '../types/Enums.js';
import type { SimulationTime } from '../types/SimulationTime.js';
import type { CharacterId } from '../value-objects/CharacterId.js';

export interface RelationshipParams {
  id?: string;
  sourceId: CharacterId;
  targetId: CharacterId;
  type: RelationshipType;
  disposition: number;
  trust: number;
  respect: number;
  intimacy: number;
  powerBalance: number;
  dependence: number;
  sharedMemories?: string[];
  lastInteraction: SimulationTime;
  interactionCount?: number;
}

function clampSymmetric(value: number, field: string): number {
  if (!Number.isFinite(value) || value < -1 || value > 1) {
    throw new CharacterInvariantError(
      'relationship',
      `Field "${field}" must be a finite number in [-1, 1], got ${value}.`,
    );
  }
  return value;
}

function clamp01(value: number, field: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new CharacterInvariantError(
      'relationship',
      `Field "${field}" must be a finite number in [0, 1], got ${value}.`,
    );
  }
  return value;
}

/** Threshold below which a relationship is considered hostile. */
const HOSTILITY_THRESHOLD = -0.5;

/**
 * Weights for the weighted sentiment average.
 * Must sum to 1.0.
 */
const SENTIMENT_WEIGHTS = {
  disposition: 0.5,
  trust: 0.3,
  respect: 0.2,
} as const;

export class Relationship {
  readonly id: string;
  readonly sourceId: CharacterId;
  readonly targetId: CharacterId;
  type: RelationshipType;
  disposition: number;
  trust: number;
  respect: number;
  intimacy: number;
  powerBalance: number;
  dependence: number;
  sharedMemories: string[];
  lastInteraction: SimulationTime;
  interactionCount: number;

  constructor(params: RelationshipParams) {
    this.id = params.id ?? crypto.randomUUID();
    this.sourceId = params.sourceId;
    this.targetId = params.targetId;
    this.type = params.type;
    this.disposition = clampSymmetric(params.disposition, 'disposition');
    this.trust = clampSymmetric(params.trust, 'trust');
    this.respect = clampSymmetric(params.respect, 'respect');
    this.intimacy = clampSymmetric(params.intimacy, 'intimacy');
    this.powerBalance = clampSymmetric(params.powerBalance, 'powerBalance');
    this.dependence = clamp01(params.dependence, 'dependence');
    this.sharedMemories = params.sharedMemories ? [...params.sharedMemories] : [];
    this.lastInteraction = params.lastInteraction;
    this.interactionCount = params.interactionCount ?? 0;
  }

  // ─── Adjustments ──────────────────────────────────────────────────────────

  adjustDisposition(delta: number): void {
    this.disposition = Math.max(-1, Math.min(1, this.disposition + delta));
  }

  adjustTrust(delta: number): void {
    this.trust = Math.max(-1, Math.min(1, this.trust + delta));
  }

  adjustRespect(delta: number): void {
    this.respect = Math.max(-1, Math.min(1, this.respect + delta));
  }

  adjustIntimacy(delta: number): void {
    this.intimacy = Math.max(-1, Math.min(1, this.intimacy + delta));
  }

  // ─── Interaction recording ────────────────────────────────────────────────

  recordInteraction(memoryId: string, time: SimulationTime): void {
    if (!this.sharedMemories.includes(memoryId)) {
      this.sharedMemories.push(memoryId);
    }
    this.lastInteraction = time;
    this.interactionCount += 1;
  }

  // ─── Computed properties ──────────────────────────────────────────────────

  get isPositive(): boolean {
    return this.disposition > 0;
  }

  get isHostile(): boolean {
    return this.disposition < HOSTILITY_THRESHOLD;
  }

  /**
   * Weighted average of disposition, trust, and respect.
   * Result is in [-1, 1].
   */
  get overallSentiment(): number {
    return (
      this.disposition * SENTIMENT_WEIGHTS.disposition +
      this.trust * SENTIMENT_WEIGHTS.trust +
      this.respect * SENTIMENT_WEIGHTS.respect
    );
  }
}
