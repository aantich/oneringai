/**
 * ExtractionResolver — given a raw LLM extraction output {mentions, facts},
 * translates it into resolved entities + persisted facts.
 *
 * Three-pass flow:
 *   1. For each mention: call memory.upsertEntityBySurface → map local label → entity id.
 *   2. For each fact: translate subject/object/contextIds, attach sourceSignalId,
 *      call memory.addFact.
 *   3. Return result with resolved entities, written facts, merge candidates,
 *      and unresolved references (e.g., facts pointing to undefined mention labels).
 *
 * One bad mention or fact doesn't abort the whole ingest — errors are collected
 * per-item and surfaced in the result for caller review.
 */

import type { MemorySystem } from '../MemorySystem.js';
import type {
  EntityCandidate,
  EntityId,
  FactKind,
  IEntity,
  IFact,
  Identifier,
  ScopeFilter,
} from '../types.js';

// =============================================================================
// Input / output shapes — these mirror the default extraction prompt's JSON format.
// =============================================================================

export interface ExtractionMention {
  surface: string;
  type: string;
  identifiers?: Identifier[];
  aliases?: string[];
}

export interface ExtractionFactSpec {
  subject: string;                  // local mention label
  predicate: string;
  object?: string;                  // local mention label
  value?: unknown;
  details?: string;
  summaryForEmbedding?: string;
  confidence?: number;
  importance?: number;
  contextIds?: string[];            // local mention labels
  kind?: FactKind;                  // default 'atomic'
  validFrom?: string | Date;
  validUntil?: string | Date;
  observedAt?: string | Date;
}

export interface ExtractionOutput {
  mentions: Record<string, ExtractionMention>;
  facts: ExtractionFactSpec[];
}

export interface IngestionResolvedEntity {
  label: string;
  entity: IEntity;
  resolved: boolean;
  mergeCandidates: EntityCandidate[];
}

export interface IngestionError {
  /** Which mention label / fact index failed. */
  where: string;
  reason: string;
}

export interface IngestionResult {
  entities: IngestionResolvedEntity[];
  facts: IFact[];
  /** Entities that matched existing records with mid-confidence candidates. */
  mergeCandidates: Array<{ label: string; surface: string; candidates: EntityCandidate[] }>;
  /** Mention labels or facts that couldn't be resolved/written. */
  unresolved: IngestionError[];
  /**
   * Canonicalized predicates in the LLM output that are NOT in the memory
   * system's predicate registry. Useful for detecting vocabulary drift —
   * periodically review and either promote to the registry or refine the
   * prompt. Empty when no registry is configured.
   * Deduped.
   */
  newPredicates: string[];
}

export interface ExtractionResolverOptions {
  /** Override per-upsert threshold (default: memory system's config). */
  autoResolveThreshold?: number;
}

// =============================================================================
// ExtractionResolver
// =============================================================================

export class ExtractionResolver {
  constructor(private readonly memory: MemorySystem) {}

  /**
   * Ingest a raw LLM extraction output. Resolves mentions to entities (upsert
   * if missing), translates facts from label-space to id-space, writes them.
   * Attaches `sourceSignalId` to every written fact.
   */
  async resolveAndIngest(
    output: ExtractionOutput,
    sourceSignalId: string,
    scope: ScopeFilter,
    opts?: ExtractionResolverOptions,
  ): Promise<IngestionResult> {
    const entities: IngestionResolvedEntity[] = [];
    const mergeCandidates: IngestionResult['mergeCandidates'] = [];
    const unresolved: IngestionError[] = [];
    const labelToEntityId = new Map<string, EntityId>();

    // ----- Pass 1: mentions → entities -----
    // Resolve in two sub-phases so contextEntityIds can include already-
    // resolved sibling labels (improves disambiguation).
    const mentionEntries = Object.entries(output.mentions ?? {});

    for (const [label, mention] of mentionEntries) {
      try {
        const contextEntityIds = [...labelToEntityId.values()];
        const result = await this.memory.upsertEntityBySurface(
          {
            surface: mention.surface,
            type: mention.type,
            identifiers: mention.identifiers ?? [],
            aliases: mention.aliases ?? [],
            contextEntityIds,
          },
          scope,
          { autoResolveThreshold: opts?.autoResolveThreshold },
        );
        labelToEntityId.set(label, result.entity.id);
        entities.push({
          label,
          entity: result.entity,
          resolved: result.resolved,
          mergeCandidates: result.mergeCandidates,
        });
        if (result.mergeCandidates.length > 0) {
          mergeCandidates.push({
            label,
            surface: mention.surface,
            candidates: result.mergeCandidates,
          });
        }
      } catch (err) {
        unresolved.push({
          where: `mention:${label}`,
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // ----- Pass 2: facts → written facts -----
    const writtenFacts: IFact[] = [];
    const factSpecs = output.facts ?? [];
    const hasRegistry = this.memory.hasPredicateRegistry();
    const newPredicatesSet = new Set<string>();

    for (let i = 0; i < factSpecs.length; i++) {
      const spec = factSpecs[i]!;
      try {
        const subjectId = labelToEntityId.get(spec.subject);
        if (!subjectId) {
          unresolved.push({
            where: `fact:${i}`,
            reason: `subject label "${spec.subject}" not found in mentions`,
          });
          continue;
        }
        let objectId: EntityId | undefined;
        if (spec.object) {
          objectId = labelToEntityId.get(spec.object);
          if (!objectId) {
            unresolved.push({
              where: `fact:${i}`,
              reason: `object label "${spec.object}" not found in mentions`,
            });
            continue;
          }
        }

        let contextIds: EntityId[] | undefined;
        if (spec.contextIds && spec.contextIds.length > 0) {
          contextIds = [];
          let skip = false;
          for (const cid of spec.contextIds) {
            const resolved = labelToEntityId.get(cid);
            if (!resolved) {
              unresolved.push({
                where: `fact:${i}`,
                reason: `context label "${cid}" not found in mentions`,
              });
              skip = true;
              break;
            }
            contextIds.push(resolved);
          }
          if (skip) continue;
        }

        // Canonicalize the predicate and track unknowns for vocabulary-drift
        // monitoring. Strict-mode rejection happens inside addFact and lands
        // in `unresolved` via the surrounding try/catch.
        const predicate = this.memory.canonicalizePredicate(spec.predicate);
        if (hasRegistry && !this.memory.getPredicateDefinition(predicate)) {
          newPredicatesSet.add(predicate);
        }

        const fact = await this.memory.addFact(
          {
            subjectId,
            predicate,
            kind: spec.kind ?? 'atomic',
            objectId,
            value: spec.value,
            details: spec.details,
            summaryForEmbedding: spec.summaryForEmbedding,
            confidence: spec.confidence,
            importance: spec.importance,
            contextIds,
            observedAt: toDate(spec.observedAt),
            validFrom: toDate(spec.validFrom),
            validUntil: toDate(spec.validUntil),
            sourceSignalId,
          },
          scope,
        );
        writtenFacts.push(fact);
      } catch (err) {
        unresolved.push({
          where: `fact:${i}`,
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return {
      entities,
      facts: writtenFacts,
      mergeCandidates,
      unresolved,
      newPredicates: Array.from(newPredicatesSet).sort(),
    };
  }
}

// -------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------

function toDate(v: string | Date | undefined): Date | undefined {
  if (!v) return undefined;
  if (v instanceof Date) return v;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
}
