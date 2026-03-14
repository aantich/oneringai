import { Character } from '../../domain/entities/Character.js';
import { Memory } from '../../domain/entities/Memory.js';
import { Relationship } from '../../domain/entities/Relationship.js';
import { Goal } from '../../domain/entities/Goal.js';
import { createCharacterId } from '../../domain/value-objects/CharacterId.js';
import { createPersonality } from '../../domain/value-objects/Personality.js';
import { createDerivedState } from '../../domain/value-objects/DerivedState.js';
import { createBelief } from '../../domain/value-objects/Belief.js';
import { createPossession } from '../../domain/value-objects/Possession.js';
import { createDailyPlan } from '../../domain/value-objects/DailyPlan.js';
import { createScheduleBlock } from '../../domain/value-objects/ScheduleBlock.js';
import type { CharacterId } from '../../domain/value-objects/CharacterId.js';
import type { Personality } from '../../domain/value-objects/Personality.js';
import type { DerivedState } from '../../domain/value-objects/DerivedState.js';
import type { Possession, PossessionParams } from '../../domain/value-objects/Possession.js';
import type { Belief, BeliefParams } from '../../domain/value-objects/Belief.js';
import type { DailyPlan } from '../../domain/value-objects/DailyPlan.js';
import type { ScheduleBlock, ScheduleBlockParams } from '../../domain/value-objects/ScheduleBlock.js';
import type { SimulationTime } from '../../domain/types/SimulationTime.js';
import type { Emotion, GoalType, GoalStatus, RelationshipType, PossessionCategory, BeliefSource, TimeSlot } from '../../domain/types/Enums.js';

// ─── Character ────────────────────────────────────────────────────────────────

export interface CharacterJSON {
  version: number;
  id: string;
  name: string;
  description: string;
  age: number;
  background: string;
  personality: Record<string, number>;
  state: Record<string, unknown>;
  possessions: Record<string, unknown>[];
  beliefs: Record<string, unknown>[];
  currentPlan?: Record<string, unknown>;
}

export class CharacterSerializer {
  static readonly CURRENT_VERSION = 1;

  static toJSON(character: Character): CharacterJSON {
    return {
      version: CharacterSerializer.CURRENT_VERSION,
      id: character.id,
      name: character.name,
      description: character.description,
      age: character.age,
      background: character.background,
      personality: { ...character.personality } as Record<string, number>,
      state: serializeDerivedState(character.state),
      possessions: character.possessions.map(serializePossession),
      beliefs: character.beliefs.map(serializeBelief),
      ...(character.currentPlan !== undefined
        ? { currentPlan: serializeDailyPlan(character.currentPlan) }
        : {}),
    };
  }

  static fromJSON(json: CharacterJSON): Character {
    // Version migrations would be applied here before constructing
    const migratedJson = CharacterSerializer.migrate(json);

    const personality = createPersonality(migratedJson.personality as unknown as Personality);
    const state = deserializeDerivedState(migratedJson.state);
    const possessions = migratedJson.possessions.map(deserializePossession);
    const beliefs = migratedJson.beliefs.map(deserializeBelief);

    const character = new Character({
      id: createCharacterId(migratedJson.id),
      name: migratedJson.name,
      description: migratedJson.description,
      age: migratedJson.age,
      background: migratedJson.background,
      personality,
      state,
      possessions,
      beliefs,
    });

    if (migratedJson.currentPlan !== undefined) {
      character.setPlan(deserializeDailyPlan(migratedJson.currentPlan));
    }

    return character;
  }

  private static migrate(json: CharacterJSON): CharacterJSON {
    // Future: add migration logic for version < CURRENT_VERSION
    // Currently only version 1 exists so no migration is needed.
    return json;
  }
}

// ─── Memory ───────────────────────────────────────────────────────────────────

export interface MemoryJSON {
  version: number;
  id: string;
  description: string;
  timestamp: Record<string, unknown>;
  location?: string;
  participants: string[];
  perspectiveOf: string;
  emotionalValence: number;
  emotionalTags: string[];
  importance: number;
  tags: string[];
  relatedGoals: string[];
  relatedMemories: string[];
}

export class MemorySerializer {
  static readonly CURRENT_VERSION = 1;

  static toJSON(memory: Memory): MemoryJSON {
    return {
      version: MemorySerializer.CURRENT_VERSION,
      id: memory.id,
      description: memory.description,
      timestamp: serializeSimulationTime(memory.timestamp),
      ...(memory.location !== undefined ? { location: memory.location } : {}),
      participants: [...memory.participants],
      perspectiveOf: memory.perspectiveOf,
      emotionalValence: memory.emotionalValence,
      emotionalTags: [...memory.emotionalTags],
      importance: memory.importance,
      tags: [...memory.tags],
      relatedGoals: [...memory.relatedGoals],
      relatedMemories: [...memory.relatedMemories],
    };
  }

  static fromJSON(json: MemoryJSON): Memory {
    const migratedJson = MemorySerializer.migrate(json);

    return new Memory({
      id: migratedJson.id,
      description: migratedJson.description,
      timestamp: deserializeSimulationTime(migratedJson.timestamp),
      ...(migratedJson.location !== undefined ? { location: migratedJson.location } : {}),
      participants: migratedJson.participants.map((p) => createCharacterId(p)),
      perspectiveOf: createCharacterId(migratedJson.perspectiveOf),
      emotionalValence: migratedJson.emotionalValence,
      emotionalTags: migratedJson.emotionalTags as Emotion[],
      importance: migratedJson.importance,
      tags: [...migratedJson.tags],
      relatedGoals: [...migratedJson.relatedGoals],
      relatedMemories: [...migratedJson.relatedMemories],
    });
  }

  private static migrate(json: MemoryJSON): MemoryJSON {
    return json;
  }
}

// ─── Relationship ─────────────────────────────────────────────────────────────

export interface RelationshipJSON {
  version: number;
  id: string;
  sourceId: string;
  targetId: string;
  type: string;
  disposition: number;
  trust: number;
  respect: number;
  intimacy: number;
  powerBalance: number;
  dependence: number;
  sharedMemories: string[];
  lastInteraction: Record<string, unknown>;
  interactionCount: number;
}

export class RelationshipSerializer {
  static readonly CURRENT_VERSION = 1;

  static toJSON(relationship: Relationship): RelationshipJSON {
    return {
      version: RelationshipSerializer.CURRENT_VERSION,
      id: relationship.id,
      sourceId: relationship.sourceId,
      targetId: relationship.targetId,
      type: relationship.type,
      disposition: relationship.disposition,
      trust: relationship.trust,
      respect: relationship.respect,
      intimacy: relationship.intimacy,
      powerBalance: relationship.powerBalance,
      dependence: relationship.dependence,
      sharedMemories: [...relationship.sharedMemories],
      lastInteraction: serializeSimulationTime(relationship.lastInteraction),
      interactionCount: relationship.interactionCount,
    };
  }

  static fromJSON(json: RelationshipJSON): Relationship {
    const migratedJson = RelationshipSerializer.migrate(json);

    return new Relationship({
      id: migratedJson.id,
      sourceId: createCharacterId(migratedJson.sourceId),
      targetId: createCharacterId(migratedJson.targetId),
      type: migratedJson.type as RelationshipType,
      disposition: migratedJson.disposition,
      trust: migratedJson.trust,
      respect: migratedJson.respect,
      intimacy: migratedJson.intimacy,
      powerBalance: migratedJson.powerBalance,
      dependence: migratedJson.dependence,
      sharedMemories: [...migratedJson.sharedMemories],
      lastInteraction: deserializeSimulationTime(migratedJson.lastInteraction),
      interactionCount: migratedJson.interactionCount,
    });
  }

  private static migrate(json: RelationshipJSON): RelationshipJSON {
    return json;
  }
}

// ─── Goal ─────────────────────────────────────────────────────────────────────

export interface GoalJSON {
  version: number;
  id: string;
  description: string;
  type: string;
  status: string;
  priority: number;
  progress: number;
  deadline?: Record<string, unknown>;
  parentGoal?: string;
  subGoals: string[];
  prerequisites: string[];
  conflicts: string[];
  drivenBy: string[];
  triggeredBy?: string;
  successCondition: string;
  failureCondition?: string;
}

export class GoalSerializer {
  static readonly CURRENT_VERSION = 1;

  static toJSON(goal: Goal): GoalJSON {
    return {
      version: GoalSerializer.CURRENT_VERSION,
      id: goal.id,
      description: goal.description,
      type: goal.type,
      status: goal.status,
      priority: goal.priority,
      progress: goal.progress,
      ...(goal.deadline !== undefined
        ? { deadline: serializeSimulationTime(goal.deadline) }
        : {}),
      ...(goal.parentGoal !== undefined ? { parentGoal: goal.parentGoal } : {}),
      subGoals: [...goal.subGoals],
      prerequisites: [...goal.prerequisites],
      conflicts: [...goal.conflicts],
      drivenBy: [...goal.drivenBy],
      ...(goal.triggeredBy !== undefined ? { triggeredBy: goal.triggeredBy } : {}),
      successCondition: goal.successCondition,
      ...(goal.failureCondition !== undefined
        ? { failureCondition: goal.failureCondition }
        : {}),
    };
  }

  static fromJSON(json: GoalJSON): Goal {
    const migratedJson = GoalSerializer.migrate(json);

    return new Goal({
      id: migratedJson.id,
      description: migratedJson.description,
      type: migratedJson.type as GoalType,
      status: migratedJson.status as GoalStatus,
      priority: migratedJson.priority,
      progress: migratedJson.progress,
      ...(migratedJson.deadline !== undefined
        ? { deadline: deserializeSimulationTime(migratedJson.deadline) }
        : {}),
      ...(migratedJson.parentGoal !== undefined
        ? { parentGoal: migratedJson.parentGoal }
        : {}),
      subGoals: [...migratedJson.subGoals],
      prerequisites: [...migratedJson.prerequisites],
      conflicts: [...migratedJson.conflicts],
      drivenBy: [...migratedJson.drivenBy],
      ...(migratedJson.triggeredBy !== undefined
        ? { triggeredBy: migratedJson.triggeredBy }
        : {}),
      successCondition: migratedJson.successCondition,
      ...(migratedJson.failureCondition !== undefined
        ? { failureCondition: migratedJson.failureCondition }
        : {}),
    });
  }

  private static migrate(json: GoalJSON): GoalJSON {
    return json;
  }
}

// ─── Shared serialization helpers ─────────────────────────────────────────────

function serializeSimulationTime(time: SimulationTime): Record<string, unknown> {
  return {
    tick: time.tick,
    day: time.day,
    timeSlot: time.timeSlot,
  };
}

function deserializeSimulationTime(raw: Record<string, unknown>): SimulationTime {
  return {
    tick: raw['tick'] as number,
    day: raw['day'] as number,
    timeSlot: raw['timeSlot'] as TimeSlot,
  };
}

function serializeDerivedState(state: DerivedState): Record<string, unknown> {
  return {
    mood: state.mood,
    moodIntensity: state.moodIntensity,
    moodDuration: state.moodDuration,
    stress: state.stress,
    energy: state.energy,
    motivation: state.motivation,
    confidence: state.confidence,
    socialNeed: state.socialNeed,
    reputationPerception: state.reputationPerception,
  };
}

function deserializeDerivedState(raw: Record<string, unknown>): DerivedState {
  return createDerivedState({
    mood: raw['mood'] as Emotion,
    moodIntensity: raw['moodIntensity'] as number,
    moodDuration: raw['moodDuration'] as number,
    stress: raw['stress'] as number,
    energy: raw['energy'] as number,
    motivation: raw['motivation'] as number,
    confidence: raw['confidence'] as number,
    socialNeed: raw['socialNeed'] as number,
    reputationPerception: raw['reputationPerception'] as number,
  });
}

function serializePossession(possession: Possession): Record<string, unknown> {
  return {
    id: possession.id,
    name: possession.name,
    description: possession.description,
    category: possession.category,
    sentimentalValue: possession.sentimentalValue,
    utilityValue: possession.utilityValue,
    monetaryValue: possession.monetaryValue,
    condition: possession.condition,
    ...(possession.acquiredFrom !== undefined
      ? { acquiredFrom: possession.acquiredFrom }
      : {}),
    ...(possession.acquiredMemory !== undefined
      ? { acquiredMemory: possession.acquiredMemory }
      : {}),
  };
}

function deserializePossession(raw: Record<string, unknown>): Possession {
  const params: PossessionParams = {
    id: raw['id'] as string,
    name: raw['name'] as string,
    description: raw['description'] as string,
    category: raw['category'] as PossessionCategory,
    sentimentalValue: raw['sentimentalValue'] as number,
    utilityValue: raw['utilityValue'] as number,
    monetaryValue: raw['monetaryValue'] as number,
    condition: raw['condition'] as number,
    ...(raw['acquiredFrom'] !== undefined
      ? { acquiredFrom: createCharacterId(raw['acquiredFrom'] as string) }
      : {}),
    ...(raw['acquiredMemory'] !== undefined
      ? { acquiredMemory: raw['acquiredMemory'] as string }
      : {}),
  };
  return createPossession(params);
}

function serializeBelief(belief: Belief): Record<string, unknown> {
  return {
    id: belief.id,
    subject: belief.subject,
    content: belief.content,
    confidence: belief.confidence,
    source: belief.source,
    ...(belief.isTrue !== undefined ? { isTrue: belief.isTrue } : {}),
  };
}

function deserializeBelief(raw: Record<string, unknown>): Belief {
  const params: BeliefParams = {
    id: raw['id'] as string,
    subject: raw['subject'] as string,
    content: raw['content'] as string,
    confidence: raw['confidence'] as number,
    source: raw['source'] as BeliefSource,
    ...(raw['isTrue'] !== undefined ? { isTrue: raw['isTrue'] as boolean } : {}),
  };
  return createBelief(params);
}

function serializeScheduleBlock(block: ScheduleBlock): Record<string, unknown> {
  return {
    timeSlot: block.timeSlot,
    activity: block.activity,
    location: block.location,
    flexibility: block.flexibility,
    ...(block.relatedGoal !== undefined ? { relatedGoal: block.relatedGoal } : {}),
    ...(block.participants !== undefined
      ? { participants: [...block.participants] }
      : {}),
  };
}

function deserializeScheduleBlock(raw: Record<string, unknown>): ScheduleBlock {
  const params: ScheduleBlockParams = {
    timeSlot: raw['timeSlot'] as TimeSlot,
    activity: raw['activity'] as string,
    location: raw['location'] as string,
    flexibility: raw['flexibility'] as number,
    ...(raw['relatedGoal'] !== undefined ? { relatedGoal: raw['relatedGoal'] as string } : {}),
    ...(raw['participants'] !== undefined
      ? {
          participants: (raw['participants'] as string[]).map((p) =>
            createCharacterId(p),
          ),
        }
      : {}),
  };
  return createScheduleBlock(params);
}

function serializeDailyPlan(plan: DailyPlan): Record<string, unknown> {
  return {
    date: serializeSimulationTime(plan.date),
    blocks: plan.blocks.map(serializeScheduleBlock),
    contingencies: [...plan.contingencies],
  };
}

function deserializeDailyPlan(raw: Record<string, unknown>): DailyPlan {
  const blocks = (raw['blocks'] as Record<string, unknown>[]).map(
    deserializeScheduleBlock,
  );
  const contingencies = (raw['contingencies'] as string[] | undefined) ?? [];
  return createDailyPlan({
    date: deserializeSimulationTime(raw['date'] as Record<string, unknown>),
    blocks,
    contingencies,
  });
}

// Re-export CharacterId factory used by consumers of this module
export { createCharacterId };
export type { CharacterId };
