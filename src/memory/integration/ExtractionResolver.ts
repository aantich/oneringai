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
  /**
   * Type-specific fields the LLM extracted alongside the mention (e.g.
   * `{ state: 'proposed', dueAt: '2026-04-30', assigneeId: 'm1' }` for a task).
   * Flows through `upsertEntityBySurface.metadata` — on create, set verbatim;
   * on resolve, conservative `fillMissing` merge (never overwrites existing).
   */
  metadata?: Record<string, unknown>;
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
  /**
   * Pre-bound `label → entityId` map. When the LLM output references any of
   * these labels (as subject/object/contextId/mention), the resolver skips
   * upsert and uses the provided entity id directly. Intended for signal-level
   * metadata (email headers, calendar attendees) where identities are already
   * resolved upstream via strong identifiers — no need to round-trip through
   * the LLM.
   *
   * If the LLM output also contains a mention with the same label (e.g. it
   * ignored the prompt instruction not to redeclare), the pre-resolved binding
   * wins and the mention is skipped silently.
   */
  preResolved?: Record<string, EntityId>;
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

    // ----- Pass 0: pre-resolved bindings (no LLM involvement) -----
    // Seed the label→id map with caller-supplied bindings. If the LLM output
    // later contains a mention for one of these labels, the pre-resolved id
    // wins and the mention is skipped.
    if (opts?.preResolved) {
      for (const [label, entityId] of Object.entries(opts.preResolved)) {
        labelToEntityId.set(label, entityId);
      }
    }

    // ----- Pass 1: mentions → entities -----
    // Resolve in two sub-phases so contextEntityIds can include already-
    // resolved sibling labels (improves disambiguation).
    const mentionEntries = Object.entries(output.mentions ?? {});

    for (const [label, mention] of mentionEntries) {
      // Skip redeclared labels — pre-resolved binding wins defensively.
      if (opts?.preResolved && label in opts.preResolved) {
        continue;
      }
      try {
        const contextEntityIds = [...labelToEntityId.values()];
        const result = await this.memory.upsertEntityBySurface(
          {
            surface: mention.surface,
            type: mention.type,
            identifiers: mention.identifiers ?? [],
            aliases: mention.aliases ?? [],
            contextEntityIds,
            metadata: mention.metadata,
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

        // Partial context is still useful: drop only the missing labels,
        // keep the fact with whatever resolved. Previously an entire fact was
        // discarded on one missing context label — that silently lost every
        // multi-context fact where the LLM referenced one hallucinated label.
        // Missing labels are still surfaced via `unresolved[]` so the caller
        // can log/tighten the prompt.
        let contextIds: EntityId[] | undefined;
        if (spec.contextIds && spec.contextIds.length > 0) {
          const resolvedIds: EntityId[] = [];
          for (const cid of spec.contextIds) {
            const resolved = labelToEntityId.get(cid);
            if (!resolved) {
              unresolved.push({
                where: `fact:${i}`,
                reason: `context label "${cid}" not found in mentions (dropped from contextIds; fact still written)`,
              });
              continue;
            }
            resolvedIds.push(resolved);
          }
          contextIds = resolvedIds.length > 0 ? resolvedIds : undefined;
        }

        // Canonicalize the predicate and apply the configured H5 drift policy
        // when the result isn't in the registry. Strict-mode rejection happens
        // inside addFact and lands in `unresolved` via the surrounding
        // try/catch.
        let predicate = this.memory.canonicalizePredicate(spec.predicate);
        if (hasRegistry && !this.memory.getPredicateDefinition(predicate)) {
          const decision = this.memory.resolveUnknownPredicate(predicate);
          if (decision.policy === 'drop') {
            unresolved.push({
              where: `fact:${i}`,
              reason: `unknown predicate "${predicate}" — fact dropped (unknownPredicatePolicy='drop')`,
            });
            newPredicatesSet.add(predicate);
            continue;
          }
          if (decision.policy === 'fuzzy_map' && decision.mappedTo) {
            // Record the mapping so operators see "predicate X was snapped
            // onto Y" rather than just "X showed up".
            newPredicatesSet.add(`${predicate}→${decision.mappedTo}`);
            predicate = decision.mappedTo;
          } else {
            // 'keep' or 'fuzzy_map' with no close match — write verbatim.
            newPredicatesSet.add(predicate);
          }
        }

        // Kind validation — the prompt restricts to 'atomic' | 'document',
        // but LLMs hallucinate. Coerce unknown values to 'atomic' and record
        // the drift in `unresolved` (same shape as the newPredicates channel)
        // so callers can monitor and refine the prompt.
        let kind: FactKind;
        if (spec.kind === 'atomic' || spec.kind === 'document') {
          kind = spec.kind;
        } else if (spec.kind === undefined) {
          kind = 'atomic';
        } else {
          kind = 'atomic';
          unresolved.push({
            where: `fact:${i}`,
            reason: `unknown kind "${String(spec.kind)}", coerced to "atomic"`,
          });
        }

        // Auto-route `state_changed` facts on task-type subjects through
        // transitionTaskState so the side effects (metadata state update,
        // stateHistory append, completedAt for terminal states) fire as part
        // of ingestion. Falls back to plain addFact when:
        //  - memory.autoApplyTaskTransitions is false,
        //  - subject isn't a task,
        //  - value shape doesn't have a `to: string` field,
        //  - routing throws (we still want the fact written).
        if (
          predicate === 'state_changed' &&
          this.memory.autoApplyTaskTransitions
        ) {
          const observedAt = toDate(spec.observedAt);
          const routedFact = await this.tryRouteTaskTransition(
            subjectId,
            spec.value,
            {
              signalId: sourceSignalId,
              at: observedAt,
              reason: spec.details,
              // Preserve LLM-supplied fact fields through the state-machine
              // write — without these, the audit fact loses importance /
              // confidence / contextIds / validity that matter for ranking
              // and retrieval.
              factOverrides: {
                importance: spec.importance,
                confidence: spec.confidence,
                contextIds,
                validFrom: toDate(spec.validFrom),
                validUntil: toDate(spec.validUntil),
                summaryForEmbedding: spec.summaryForEmbedding,
              },
            },
            scope,
          );
          if (routedFact !== 'not_task') {
            if (routedFact) writtenFacts.push(routedFact);
            continue;
          }
          // else: subject isn't a task or value malformed — fall through to
          // normal addFact path so the fact still lands.
        }

        const fact = await this.memory.addFact(
          {
            subjectId,
            predicate,
            kind,
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

  /**
   * Route a `state_changed` fact through `MemorySystem.transitionTaskState`
   * when the subject is a task entity. Returns:
   *   - The written audit fact on success.
   *   - `null` on success when the transition was a no-op (same state).
   *   - `'not_task'` when routing doesn't apply (subject type != task OR
   *     value shape doesn't carry a `to: string` field) — caller should fall
   *     through to plain `addFact`.
   */
  private async tryRouteTaskTransition(
    subjectId: EntityId,
    value: unknown,
    opts: {
      signalId: string;
      at?: Date;
      reason?: string;
      factOverrides?: {
        importance?: number;
        confidence?: number;
        contextIds?: EntityId[];
        validFrom?: Date;
        validUntil?: Date;
        summaryForEmbedding?: string;
      };
    },
    scope: ScopeFilter,
  ): Promise<IFact | null | 'not_task'> {
    const subject = await this.memory.getEntity(subjectId, scope);
    if (!subject || subject.type !== 'task') return 'not_task';

    // Expect `{ to: string }` at minimum. The standard predicate example uses
    // `{ from, to }` but we only need `to`.
    const to = extractTo(value);
    if (!to) return 'not_task';

    const result = await this.memory.transitionTaskState(
      subjectId,
      to,
      {
        signalId: opts.signalId,
        at: opts.at,
        reason: opts.reason,
        validate: 'warn',
        factOverrides: opts.factOverrides,
      },
      scope,
    );
    return result.fact;
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

function extractTo(value: unknown): string | null {
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const to = (value as Record<string, unknown>).to;
    if (typeof to === 'string' && to.trim().length > 0) return to.trim();
  }
  return null;
}
