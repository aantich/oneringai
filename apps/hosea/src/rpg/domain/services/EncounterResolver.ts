import { Memory } from '../entities/Memory.js';
import type { Character } from '../entities/Character.js';
import type { Relationship } from '../entities/Relationship.js';
import type { Situation } from '../types/Situation.js';
import type { ActionType, Emotion } from '../types/Enums.js';
import type { ActionWeight } from '../value-objects/ActionWeight.js';
import type { CharacterId } from '../value-objects/CharacterId.js';
import {
  createEncounterOutcome,
  createRelationshipDelta,
} from '../types/EncounterOutcome.js';
import type {
  EncounterOutcome,
  RelationshipDelta,
} from '../types/EncounterOutcome.js';
import type { DerivedState } from '../value-objects/DerivedState.js';
import type { BehaviorEngine } from './BehaviorEngine.js';
import type { MoodEngine } from './MoodEngine.js';
import type { MemoryEngine } from './MemoryEngine.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Describe the interaction between two chosen action types for narrative
 * generation and relationship deltas.
 */
type ActionInteraction = {
  dispositionDelta: number;
  trustDelta: number;
  respectDelta: number;
  /** Emotional valence of the resulting memory for each observer */
  valence: number;
  /** Tags to attach to the resulting memory */
  tags: string[];
  emotionalTags: Emotion[];
  narrativeVerb: string;
};

/**
 * Lookup table for pairwise action interactions.
 * Keys are `"sourceAction->targetAction"`.
 */
const INTERACTION_TABLE: Record<string, ActionInteraction> = {
  'fight->fight': {
    dispositionDelta: -0.2,
    trustDelta: -0.1,
    respectDelta: 0.05,
    valence: -0.6,
    tags: ['combat', 'conflict'],
    emotionalTags: ['anger', 'fear'],
    narrativeVerb: 'clashed violently with',
  },
  'fight->flee': {
    dispositionDelta: -0.1,
    trustDelta: -0.1,
    respectDelta: 0.1,
    valence: -0.4,
    tags: ['combat', 'pursuit'],
    emotionalTags: ['anger'],
    narrativeVerb: 'forced to flee from',
  },
  'fight->negotiate': {
    dispositionDelta: -0.15,
    trustDelta: -0.15,
    respectDelta: 0.0,
    valence: -0.3,
    tags: ['conflict', 'negotiation_attempted'],
    emotionalTags: ['anger', 'surprise'],
    narrativeVerb: 'confronted (negotiation refused) by',
  },
  'fight->submit': {
    dispositionDelta: 0.0,
    trustDelta: -0.1,
    respectDelta: 0.15,
    valence: -0.2,
    tags: ['dominance', 'submission'],
    emotionalTags: ['contempt'],
    narrativeVerb: 'dominated',
  },
  'fight->help': {
    dispositionDelta: -0.2,
    trustDelta: -0.2,
    respectDelta: -0.1,
    valence: -0.5,
    tags: ['conflict', 'betrayal'],
    emotionalTags: ['anger', 'sadness'],
    narrativeVerb: 'attacked despite aid from',
  },
  'flee->fight': {
    dispositionDelta: -0.1,
    trustDelta: 0.0,
    respectDelta: -0.1,
    valence: -0.3,
    tags: ['escape', 'retreat'],
    emotionalTags: ['fear'],
    narrativeVerb: 'fled from',
  },
  'flee->flee': {
    dispositionDelta: 0.0,
    trustDelta: 0.0,
    respectDelta: -0.05,
    valence: -0.2,
    tags: ['retreat', 'avoidance'],
    emotionalTags: ['fear'],
    narrativeVerb: 'both fled the scene alongside',
  },
  'negotiate->negotiate': {
    dispositionDelta: 0.15,
    trustDelta: 0.1,
    respectDelta: 0.05,
    valence: 0.3,
    tags: ['negotiation', 'cooperation'],
    emotionalTags: ['joy'],
    narrativeVerb: 'reached an agreement with',
  },
  'negotiate->deceive': {
    dispositionDelta: -0.25,
    trustDelta: -0.3,
    respectDelta: -0.1,
    valence: -0.7,
    tags: ['betrayal', 'deception'],
    emotionalTags: ['anger', 'disgust'],
    narrativeVerb: 'was deceived while negotiating with',
  },
  'negotiate->fight': {
    dispositionDelta: -0.2,
    trustDelta: -0.2,
    respectDelta: 0.0,
    valence: -0.5,
    tags: ['conflict', 'negotiation_failed'],
    emotionalTags: ['anger', 'surprise'],
    narrativeVerb: 'had negotiation break down violently with',
  },
  'negotiate->help': {
    dispositionDelta: 0.2,
    trustDelta: 0.15,
    respectDelta: 0.1,
    valence: 0.5,
    tags: ['cooperation', 'assistance'],
    emotionalTags: ['joy'],
    narrativeVerb: 'cooperated positively with',
  },
  'negotiate->submit': {
    dispositionDelta: 0.1,
    trustDelta: 0.1,
    respectDelta: 0.0,
    valence: 0.1,
    tags: ['negotiation', 'agreement'],
    emotionalTags: ['neutral'],
    narrativeVerb: 'reached a terms agreement with',
  },
  'deceive->negotiate': {
    dispositionDelta: 0.05, // deceiver feels slightly better (successful)
    trustDelta: -0.05,
    respectDelta: 0.0,
    valence: 0.1,
    tags: ['deception', 'manipulation'],
    emotionalTags: ['contempt'],
    narrativeVerb: 'manipulated',
  },
  'deceive->deceive': {
    dispositionDelta: -0.1,
    trustDelta: -0.2,
    respectDelta: 0.0,
    valence: -0.2,
    tags: ['deception', 'manipulation', 'counter_manipulation'],
    emotionalTags: ['contempt', 'disgust'],
    narrativeVerb: 'engaged in mutual deception with',
  },
  'help->help': {
    dispositionDelta: 0.25,
    trustDelta: 0.2,
    respectDelta: 0.1,
    valence: 0.7,
    tags: ['cooperation', 'mutual_aid', 'triumph'],
    emotionalTags: ['joy'],
    narrativeVerb: 'cooperated generously with',
  },
  'help->ignore': {
    dispositionDelta: -0.1,
    trustDelta: -0.1,
    respectDelta: -0.05,
    valence: -0.2,
    tags: ['rejected_aid', 'indifference'],
    emotionalTags: ['sadness'],
    narrativeVerb: 'tried to help but was ignored by',
  },
  'observe->observe': {
    dispositionDelta: 0.0,
    trustDelta: 0.0,
    respectDelta: 0.0,
    valence: 0.0,
    tags: ['observation', 'neutral'],
    emotionalTags: ['neutral'],
    narrativeVerb: 'observed',
  },
  'submit->fight': {
    dispositionDelta: -0.15,
    trustDelta: -0.1,
    respectDelta: -0.1,
    valence: -0.35,
    tags: ['submission', 'dominated'],
    emotionalTags: ['fear', 'sadness'],
    narrativeVerb: 'submitted to',
  },
  'ignore->ignore': {
    dispositionDelta: 0.0,
    trustDelta: 0.0,
    respectDelta: 0.0,
    valence: 0.0,
    tags: ['avoidance'],
    emotionalTags: ['neutral'],
    narrativeVerb: 'disregarded',
  },
};

/** Fallback interaction for pairs not in the table. */
const DEFAULT_INTERACTION: ActionInteraction = {
  dispositionDelta: 0.0,
  trustDelta: 0.0,
  respectDelta: 0.0,
  valence: 0.0,
  tags: ['encounter'],
  emotionalTags: ['neutral'],
  narrativeVerb: 'interacted with',
};

function lookupInteraction(a: ActionType, b: ActionType): ActionInteraction {
  return (
    INTERACTION_TABLE[`${a}->${b}`] ??
    INTERACTION_TABLE[`${b}->${a}`] ??
    DEFAULT_INTERACTION
  );
}

// ─── EncounterResolver ────────────────────────────────────────────────────────

/**
 * Stateless service: resolves multi-participant encounters.
 *
 * For each participant, calculates action weights, selects actions, resolves
 * pairwise interactions, and produces an EncounterOutcome with new memories,
 * relationship deltas, state updates, and a narrative summary.
 */
export class EncounterResolver {
  constructor(
    private readonly behaviorEngine: BehaviorEngine,
    private readonly moodEngine: MoodEngine,
    private readonly memoryEngine: MemoryEngine,
  ) {}

  /**
   * Resolve an encounter between characters.
   *
   * Steps:
   * 1. For each participant, calculate action weights
   * 2. Select actions for each
   * 3. Resolve pairwise interactions
   * 4. Generate new memories for each participant
   * 5. Calculate relationship deltas
   * 6. Calculate state updates (mood changes)
   * 7. Generate narrative description
   * 8. Return EncounterOutcome
   */
  resolve(
    participants: Character[],
    relationships: Map<string, Relationship>,
    memories: Map<string, Memory[]>,
    situation: Situation,
  ): EncounterOutcome {
    if (participants.length === 0) {
      return createEncounterOutcome({
        chosenActions: new Map(),
        newMemories: [],
        relationshipDeltas: [],
        stateUpdates: new Map(),
        narrative: 'No participants in this encounter.',
      });
    }

    // ── Step 1 & 2: Calculate and select actions ──────────────────────────────
    const chosenActions = new Map<CharacterId, ActionWeight>();

    for (const character of participants) {
      const charMemories = memories.get(character.id) ?? [];

      // Find the most relevant relationship (first other participant)
      const otherParticipant = participants.find((p) => p.id !== character.id);
      const relationship = otherParticipant
        ? (relationships.get(`${character.id}->${otherParticipant.id}`) ??
          relationships.get(`${otherParticipant.id}->${character.id}`))
        : undefined;

      // Recall relevant memories for this situation
      const relevantMemories = this.memoryEngine.recall(charMemories, situation, 5);

      // Calculate action weights (filtered to available actions in situation)
      const weights = this.behaviorEngine.calculateActionWeights(
        character,
        situation,
        relationship,
        relevantMemories,
      );

      const selected = this.behaviorEngine.selectAction(weights);
      chosenActions.set(character.id, selected);
    }

    // ── Step 3–6: Resolve pairwise interactions ───────────────────────────────
    const newMemories: Memory[] = [];
    const relationshipDeltas: RelationshipDelta[] = [];
    const stateUpdates = new Map<CharacterId, Partial<DerivedState>>();

    // Process all directed pairs (i, j)
    for (let i = 0; i < participants.length; i++) {
      const source = participants[i]!;
      const sourceAction = chosenActions.get(source.id)!;

      for (let j = 0; j < participants.length; j++) {
        if (i === j) continue;
        const target = participants[j]!;
        const targetAction = chosenActions.get(target.id)!;

        const interaction = lookupInteraction(
          sourceAction.action,
          targetAction.action,
        );

        // ── Relationship delta (source → target) ───────────────────────────────
        relationshipDeltas.push(
          createRelationshipDelta({
            sourceId: source.id,
            targetId: target.id,
            dispositionDelta: interaction.dispositionDelta,
            trustDelta: interaction.trustDelta,
            respectDelta: interaction.respectDelta,
          }),
        );

        // ── New memory for source ──────────────────────────────────────────────
        const memoryDescription =
          `${source.name} ${interaction.narrativeVerb} ${target.name} ` +
          `(${situation.description})`;

        const rawImportance = this.memoryEngine.calculateImportance(
          // Construct a temporary Memory-like object to compute importance
          // The Memory constructor validates, so we pass exact values
          new Memory({
            description: memoryDescription,
            timestamp: situation.time,
            location: situation.location,
            participants: participants.map((p) => p.id),
            perspectiveOf: source.id,
            emotionalValence: interaction.valence,
            emotionalTags: interaction.emotionalTags,
            importance: 0.5, // placeholder; will be replaced below
            tags: [...interaction.tags, ...situation.tags],
          }),
          source.personality,
        );

        const memory = new Memory({
          description: memoryDescription,
          timestamp: situation.time,
          location: situation.location,
          participants: participants.map((p) => p.id),
          perspectiveOf: source.id,
          emotionalValence: clamp(interaction.valence, -1, 1),
          emotionalTags: interaction.emotionalTags,
          importance: clamp(rawImportance, 0, 1),
          tags: [...interaction.tags, ...situation.tags],
        });

        newMemories.push(memory);

        // ── State update for source via MoodEngine ─────────────────────────────
        const updatedState = this.moodEngine.applyEvent(source, memory);

        // Merge with any existing partial update (last writer wins per field)
        const existing = stateUpdates.get(source.id) ?? {};
        stateUpdates.set(source.id, {
          ...existing,
          mood: updatedState.mood,
          moodIntensity: updatedState.moodIntensity,
          moodDuration: updatedState.moodDuration,
          stress: updatedState.stress,
          confidence: updatedState.confidence,
          socialNeed: updatedState.socialNeed,
        } satisfies Partial<DerivedState>);
      }
    }

    // ── Step 7: Generate narrative ────────────────────────────────────────────
    const narrative = this._buildNarrative(participants, chosenActions, situation);

    return createEncounterOutcome({
      chosenActions,
      newMemories,
      relationshipDeltas,
      stateUpdates,
      narrative,
    });
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  private _buildNarrative(
    participants: Character[],
    chosenActions: Map<CharacterId, ActionWeight>,
    situation: Situation,
  ): string {
    const parts: string[] = [`Encounter at ${situation.location}: ${situation.description}`];

    for (const character of participants) {
      const action = chosenActions.get(character.id);
      if (action) {
        parts.push(`${character.name} chose to ${action.action} (confidence: ${(action.weight * 100).toFixed(0)}%). ${action.reasoning}`);
      }
    }

    if (situation.threatLevel > 0.7) {
      parts.push('The situation was highly dangerous.');
    } else if (situation.threatLevel > 0.3) {
      parts.push('There was significant tension in the air.');
    }

    if (situation.stakes > 0.7) {
      parts.push('The stakes were extremely high.');
    }

    return parts.join(' ');
  }
}
