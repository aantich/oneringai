import type { Relationship } from '../domain/entities/Relationship.js';
import type { ICharacterRepository } from '../domain/ports/ICharacterRepository.js';
import type { IMemoryRepository } from '../domain/ports/IMemoryRepository.js';
import type { IRelationshipRepository } from '../domain/ports/IRelationshipRepository.js';
import type { EncounterResolver } from '../domain/services/EncounterResolver.js';
import type { EncounterOutcome } from '../domain/types/EncounterOutcome.js';
import type { Situation } from '../domain/types/Situation.js';
import { createDerivedState } from '../domain/value-objects/DerivedState.js';
import type { CharacterId } from '../domain/value-objects/CharacterId.js';

/**
 * Application service that orchestrates encounter resolution between characters.
 *
 * Loads all participants and their relationship/memory context from the
 * repositories, delegates the decision logic to the EncounterResolver domain
 * service, and then persists all resulting changes (new memories, relationship
 * deltas, derived-state updates) back to the repositories.
 */
export class EncounterService {
  constructor(
    private readonly characterRepo: ICharacterRepository,
    private readonly memoryRepo: IMemoryRepository,
    private readonly relationshipRepo: IRelationshipRepository,
    private readonly encounterResolver: EncounterResolver,
  ) {}

  /**
   * Runs an encounter between the given participants in the given situation.
   *
   * Steps:
   *   1. Load every participant Character from the repository.
   *      Throws if any participant is not found (encounter cannot proceed with
   *      missing characters).
   *   2. Load all pairwise Relationships between the participants.
   *   3. Load memories relevant to each participant (memories involving at
   *      least one other participant in the encounter).
   *   4. Call {@link EncounterResolver.resolve} with the full context.
   *   5. Persist new Memory records produced by the outcome.
   *   6. Apply relationship deltas: load (or create) the directed relationship
   *      and apply each field delta, then save.
   *   7. Merge stateUpdate partials into each affected character's DerivedState
   *      via MoodEngine and save.
   *   8. Return the immutable EncounterOutcome.
   *
   * @throws {Error} if a participant CharacterId cannot be found in the repository.
   */
  async runEncounter(
    participantIds: CharacterId[],
    situation: Situation,
  ): Promise<EncounterOutcome> {
    // ── Step 1: Load participant characters ───────────────────────────────────
    const characters = await Promise.all(
      participantIds.map(async (id) => {
        const character = await this.characterRepo.findById(id);
        if (character === null) {
          throw new Error(
            `EncounterService: participant character "${id}" not found.`,
          );
        }
        return character;
      }),
    );

    // ── Step 2: Load all pairwise relationships between participants ───────────
    const relationships: Relationship[] = [];
    for (let i = 0; i < participantIds.length; i++) {
      for (let j = i + 1; j < participantIds.length; j++) {
        const sourceId = participantIds[i]!;
        const targetId = participantIds[j]!;

        const forward = await this.relationshipRepo.findBetween(sourceId, targetId);
        if (forward !== null) {
          relationships.push(forward);
        }

        const backward = await this.relationshipRepo.findBetween(targetId, sourceId);
        if (backward !== null) {
          relationships.push(backward);
        }
      }
    }

    // ── Step 3: Load relevant memories for each participant ───────────────────
    // A memory is "relevant" if it involves at least one other participant.
    const relevantMemories = await Promise.all(
      participantIds.map(async (characterId) => {
        const others = participantIds.filter((id) => id !== characterId);
        const perOtherMemories = await Promise.all(
          others.map((otherId) =>
            this.memoryRepo.findByParticipant(characterId, otherId),
          ),
        );
        // Flatten and deduplicate by memory id.
        const seen = new Set<string>();
        return perOtherMemories.flat().filter((m) => {
          if (seen.has(m.id)) return false;
          seen.add(m.id);
          return true;
        });
      }),
    );

    // ── Step 4: Resolve the encounter ─────────────────────────────────────────
    // Build the Map<"sourceId->targetId", Relationship> the domain service expects.
    const relationshipMap = new Map<string, Relationship>(
      relationships.map((rel) => [`${rel.sourceId}->${rel.targetId}`, rel]),
    );

    // Build the Map<characterId, Memory[]> the domain service expects.
    const memoriesMap = new Map<CharacterId, import('../domain/entities/Memory.js').Memory[]>(
      participantIds.map((id, idx) => [id, relevantMemories[idx] ?? []]),
    );

    const outcome = this.encounterResolver.resolve(
      characters,
      relationshipMap,
      memoriesMap,
      situation,
    );

    // ── Step 5: Persist new memories ──────────────────────────────────────────
    await Promise.all(outcome.newMemories.map((memory) => this.memoryRepo.save(memory)));

    // ── Step 6: Apply relationship deltas ─────────────────────────────────────
    const currentTime = situation.time;

    await Promise.all(
      outcome.relationshipDeltas.map(async (delta) => {
        let rel = await this.relationshipRepo.findBetween(delta.sourceId, delta.targetId);

        if (rel === null) {
          // No existing relationship — nothing to apply the delta to.
          // The EncounterResolver is responsible for including a baseline
          // Relationship in newMemories / outcome if one should be created.
          return;
        }

        rel.adjustDisposition(delta.dispositionDelta);
        rel.adjustTrust(delta.trustDelta);
        rel.adjustRespect(delta.respectDelta);

        // Record the interaction on the relationship using the first new memory
        // that involves both parties, or fall back to a plain timestamp update.
        const sharedMemory = outcome.newMemories.find(
          (m) =>
            m.participants.includes(delta.sourceId) &&
            m.participants.includes(delta.targetId),
        );
        if (sharedMemory !== undefined) {
          rel.recordInteraction(sharedMemory.id, currentTime);
        } else {
          // Increment the counter and update the timestamp without a memory id.
          rel.recordInteraction('', currentTime);
        }

        await this.relationshipRepo.save(rel);
      }),
    );

    // ── Step 7: Apply derived-state updates ───────────────────────────────────
    await Promise.all(
      Array.from(outcome.stateUpdates.entries()).map(async ([characterId, partial]) => {
        const character = characters.find((c) => c.id === characterId);
        if (character === undefined) {
          return;
        }

        // Merge the partial state update into the character's existing DerivedState.
        const updatedState = createDerivedState({ ...character.state, ...partial });
        character.updateState(updatedState);

        await this.characterRepo.save(character);
      }),
    );

    // ── Step 8: Return the outcome ────────────────────────────────────────────
    return outcome;
  }
}
