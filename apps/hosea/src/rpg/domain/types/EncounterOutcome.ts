import type { CharacterId } from '../value-objects/CharacterId.js';
import type { ActionWeight } from '../value-objects/ActionWeight.js';
import type { DerivedState } from '../value-objects/DerivedState.js';
import type { Memory } from '../entities/Memory.js';

// ─── RelationshipDelta ────────────────────────────────────────────────────────

/**
 * Describes the change applied to a single directed relationship as a result
 * of an encounter. Positive deltas indicate improvement; negative indicate
 * deterioration.
 */
export interface RelationshipDelta {
  /** The character whose relationship record is being updated. */
  readonly sourceId: CharacterId;

  /** The character toward whom the relationship points. */
  readonly targetId: CharacterId;

  /**
   * Change in general disposition (friendliness / goodwill).
   * Typically in the range [-1, 1], though no runtime clamp is applied here;
   * implementations should clamp when applying the delta to a Relationship.
   */
  readonly dispositionDelta: number;

  /**
   * Change in trust (belief that the target acts in good faith).
   * Typically in the range [-1, 1].
   */
  readonly trustDelta: number;

  /**
   * Change in respect (regard for the target's competence or status).
   * Typically in the range [-1, 1].
   */
  readonly respectDelta: number;
}

// ─── EncounterOutcome ─────────────────────────────────────────────────────────

/**
 * The fully-resolved result of an encounter between one or more characters.
 * Created by domain services after all action weights have been evaluated and
 * consequences applied.
 */
export interface EncounterOutcome {
  /**
   * The action each participant chose, keyed by their CharacterId.
   * An ActionWeight captures both the selected ActionType and the weight
   * (confidence) with which it was chosen.
   */
  readonly chosenActions: Map<CharacterId, ActionWeight>;

  /** New memory records that should be persisted for one or more characters. */
  readonly newMemories: Memory[];

  /** Relationship changes produced by this encounter. */
  readonly relationshipDeltas: RelationshipDelta[];

  /**
   * Partial DerivedState updates for characters affected by the encounter,
   * keyed by their CharacterId. Only the fields that changed are included;
   * implementations should merge these into the character's existing state.
   */
  readonly stateUpdates: Map<CharacterId, Partial<DerivedState>>;

  /** Plain-language summary of what happened during the encounter. */
  readonly narrative: string;
}

// ─── Params ───────────────────────────────────────────────────────────────────

export interface RelationshipDeltaParams {
  sourceId: CharacterId;
  targetId: CharacterId;
  dispositionDelta: number;
  trustDelta: number;
  respectDelta: number;
}

export interface EncounterOutcomeParams {
  chosenActions: Map<CharacterId, ActionWeight>;
  newMemories: Memory[];
  relationshipDeltas: RelationshipDelta[];
  stateUpdates: Map<CharacterId, Partial<DerivedState>>;
  narrative: string;
}

// ─── Factories ────────────────────────────────────────────────────────────────

/**
 * Creates an immutable RelationshipDelta value object.
 */
export function createRelationshipDelta(params: RelationshipDeltaParams): RelationshipDelta {
  return Object.freeze({ ...params } satisfies RelationshipDelta);
}

/**
 * Creates an immutable EncounterOutcome value object.
 *
 * The Maps and arrays are shallow-copied to prevent external mutation.
 * Note: the Memory objects inside newMemories and DerivedState partials
 * inside stateUpdates are assumed to already be immutable (created via
 * their own factories).
 */
export function createEncounterOutcome(params: EncounterOutcomeParams): EncounterOutcome {
  return Object.freeze({
    chosenActions: new Map(params.chosenActions),
    newMemories: Object.freeze([...params.newMemories]) as Memory[],
    relationshipDeltas: Object.freeze(
      params.relationshipDeltas.map((d) => Object.freeze({ ...d })),
    ) as RelationshipDelta[],
    stateUpdates: new Map(params.stateUpdates),
    narrative: params.narrative,
  } satisfies EncounterOutcome) as EncounterOutcome;
}
