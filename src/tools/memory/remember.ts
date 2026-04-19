/**
 * memory_remember — write an atomic fact about a subject. Be proactive:
 * whenever the user reveals something you should remember, store it.
 */

import type { ToolFunction } from '../../domain/entities/Tool.js';
import type { MemoryToolDeps, SubjectRef, Visibility } from './types.js';
import {
  SUBJECT_TOKEN_ME,
  SUBJECT_TOKEN_THIS_AGENT,
  clampUnit,
  resolveScope,
  toErrorMessage,
  visibilityToPermissions,
} from './types.js';
import { findForeignContextIds, ownerlessSubjectWarning } from './ownership.js';

export interface RememberArgs {
  subject: SubjectRef;
  /** Relationship type — 'prefers', 'works_at', 'learned_pattern', 'employee_count', etc. */
  predicate: string;
  /**
   * Fact kind:
   *   - "atomic" (default) — short, structured: scalar values, relations, or brief observations.
   *   - "document" — long-form narrative: procedures, learned patterns, multi-paragraph recaps.
   * Documents are always embedded for semantic search; atomic facts are embedded
   * only when `details` is long enough. Pick "document" for prose, "atomic" for data.
   */
  kind?: 'atomic' | 'document';
  /** Scalar value when the fact is a datum (name, number, flag). Mutually exclusive with objectId. */
  value?: unknown;
  /** Entity id when the fact links to another entity — or use memory_link instead. Mutually exclusive with value. */
  objectId?: string;
  /** Long-form markdown/text for narrative facts. Required when kind='document'. */
  details?: string;
  /** 0..1 confidence. Default 1.0 for direct user-provided facts; LLM-inferred → lower. Values outside [0,1] are clamped. */
  confidence?: number;
  /** 0..1 importance. Drives ranking. 1.0 for identity-level, 0.1 for trivia. Default 0.5. Clamped to [0,1]. */
  importance?: number;
  /** When did this event happen? ISO string. Default: now. */
  observedAt?: string;
  /** Extra entities this fact is "about" — e.g. [dealId] when logging activity around a deal. */
  contextIds?: string[];
  /** Visibility. Default: 'private' for user/other subjects, 'group' for this_agent. */
  visibility?: Visibility;
}

const DESCRIPTION = `Record a new fact (subject, predicate, value-or-object). Be proactive — whenever the user reveals something you should remember, store it. Facts accumulate and feed into profile regeneration automatically.

Subject can be: "me", "this_agent", entity id, {id}, {identifier:{kind,value}}, or {surface:"..."}.

You can ONLY write facts on entities you own (the tool rejects writes to entities owned by other users — upsert your own entity first via memory_find_entity).

kind (default "atomic"):
- "atomic": short/structured — attributes (employee_count=500), relations (attended → meeting), brief observations. Use this for data.
- "document": long-form prose — procedures, learned patterns, multi-paragraph recaps. Use this for narrative you want indexed semantically.

value vs objectId: set EITHER value OR objectId, never both. (Mixing the two makes the fact ambiguous in later queries.)

visibility (default varies by subject):
- "private": only the owner (current user) can see — good for personal notes.
- "group": the user's group can read — for team-shared knowledge.
- "public": library defaults (group+world read) — for broadly useful facts.

Defaults: user subject → "private"; this_agent → "group" (shared agents); other → "private".

If contextIds contains any entity you don't own, visibility is automatically downgraded to "private" to prevent leaking fabricated facts into another user's context graph — the response will include a "warnings" field in that case.

Examples:
- User preference (atomic, scalar):
  {"subject":"me","predicate":"prefers","value":"concise responses"}
- Company attribute (atomic, your own company entity):
  {"subject":{"surface":"Acme"},"predicate":"employee_count","value":500,"confidence":0.8,"importance":0.3}
- Learned procedure (document — indexed for semantic recall):
  {"subject":"this_agent","predicate":"learned_pattern","kind":"document","details":"When users ask for tax calculations, always clarify the jurisdiction before quoting rates because …","visibility":"group"}
- Observation tied to a context entity (atomic with narrative details):
  {"subject":{"surface":"Alice"},"predicate":"raised_concern","details":"Timeline risk","contextIds":["<dealId>"]}`;

export function createRememberTool(deps: MemoryToolDeps): ToolFunction<RememberArgs> {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'memory_remember',
        description: DESCRIPTION,
        parameters: {
          type: 'object',
          properties: {
            subject: { description: 'Subject — see SubjectRef forms.' },
            predicate: { type: 'string' },
            kind: { type: 'string', enum: ['atomic', 'document'] },
            value: { description: 'Scalar value (string, number, boolean, object). Mutually exclusive with objectId.' },
            objectId: { type: 'string' },
            details: { type: 'string' },
            confidence: { type: 'number' },
            importance: { type: 'number' },
            observedAt: { type: 'string' },
            contextIds: { type: 'array', items: { type: 'string' } },
            visibility: { type: 'string', enum: ['private', 'group', 'public'] },
          },
          required: ['subject', 'predicate'],
        },
      },
    },

    describeCall: (args) => `${args.predicate}=${String(args.value ?? args.objectId ?? '…').slice(0, 40)}`,

    execute: async (args, context) => {
      if (!args.subject) return { error: 'subject is required' };
      if (!args.predicate || typeof args.predicate !== 'string') {
        return { error: 'predicate is required (non-empty string)' };
      }
      if (args.value === undefined && args.objectId === undefined && !args.details) {
        return { error: 'provide at least one of value, objectId, or details' };
      }
      if (args.value !== undefined && args.objectId !== undefined) {
        return { error: 'set either value or objectId, not both' };
      }

      const scope = resolveScope(context?.userId, deps.defaultUserId, deps.defaultGroupId);
      const resolved = await deps.resolve(args.subject, scope);
      if (!resolved.ok) {
        return { error: resolved.message, candidates: resolved.candidates };
      }

      // H-1: reject ghost-writes. The memory layer enforces fact.ownerId ==
      // subject.ownerId (ScopeInvariantError otherwise), so writing to a
      // foreign-owned entity would silently land the fact under the foreign
      // owner. Block it at the tool layer.
      if (
        resolved.entity.ownerId !== undefined &&
        resolved.entity.ownerId !== scope.userId
      ) {
        return {
          error:
            `memory_remember: cannot write facts on entities you don't own ` +
            `(subject.ownerId=${resolved.entity.ownerId}, caller=${scope.userId ?? 'none'}). ` +
            `Upsert your own entity via memory_find_entity or ask the owner to write this fact.`,
          subjectOwnerId: resolved.entity.ownerId,
        };
      }

      // Pick visibility: explicit arg > per-subject default.
      let vis = args.visibility ?? pickDefaultVisibility(deps, args.subject, resolved.entity.id);

      const warnings: string[] = [];

      // H1: surface ownerless-subject writes in the audit trail. The memory
      // layer will still attach fact.ownerId = scope.userId, but the subject
      // entity itself stays ownerless. LLM + logs see the divergence.
      const ownerlessWarn = ownerlessSubjectWarning(resolved.entity.ownerId, scope.userId);
      if (ownerlessWarn) warnings.push(ownerlessWarn);

      // H-2: if any contextId points to a foreign-owned (but visible) entity
      // and the chosen visibility would leak it via graph-touchesEntity
      // queries, downgrade to 'private'. Invisible contextIds are left for
      // the memory layer to reject. Adapter errors during the check are
      // treated as "foreign" (fail-safe) rather than crashing the tool.
      if (args.contextIds?.length && (vis === 'group' || vis === 'public')) {
        const foreign = await findForeignContextIds(
          deps.memory,
          args.contextIds,
          scope,
          { tool: 'memory_remember', subjectId: resolved.entity.id },
        );
        if (foreign.length > 0) {
          vis = 'private';
          warnings.push(
            `visibility downgraded to "private": contextIds include entities you don't own or couldn't verify (${foreign.join(', ')}). ` +
            `Non-private writes on foreign context would leak into their owners' graph queries.`,
          );
        }
      }

      const permissions = visibilityToPermissions(vis);
      const observedAt = args.observedAt ? new Date(args.observedAt) : new Date();

      try {
        const fact = await deps.memory.addFact(
          {
            subjectId: resolved.entity.id,
            predicate: args.predicate,
            kind: args.kind ?? 'atomic',
            value: args.value,
            objectId: args.objectId,
            details: args.details,
            confidence: clampUnit(args.confidence),
            importance: clampUnit(args.importance),
            contextIds: args.contextIds,
            observedAt,
            permissions,
          },
          scope,
        );

        const payload: Record<string, unknown> = {
          fact: {
            id: fact.id,
            subjectId: fact.subjectId,
            predicate: fact.predicate,
            kind: fact.kind,
            value: fact.value,
            objectId: fact.objectId,
            details: fact.details,
            confidence: fact.confidence,
            importance: fact.importance,
            permissions: fact.permissions,
            observedAt: fact.observedAt,
          },
          visibility: vis,
        };
        if (warnings.length > 0) payload.warnings = warnings;
        return payload;
      } catch (err) {
        return { error: `memory_remember failed: ${toErrorMessage(err)}` };
      }
    },
  };
}

function pickDefaultVisibility(
  deps: MemoryToolDeps,
  subject: SubjectRef,
  resolvedId: string,
): Visibility {
  const { userEntityId, agentEntityId } = deps.getOwnSubjectIds();
  if (subject === SUBJECT_TOKEN_ME || resolvedId === userEntityId) {
    return deps.defaultVisibility.forUser;
  }
  if (subject === SUBJECT_TOKEN_THIS_AGENT || resolvedId === agentEntityId) {
    return deps.defaultVisibility.forAgent;
  }
  return deps.defaultVisibility.forOther;
}

