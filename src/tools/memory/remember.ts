/**
 * memory_remember — write an atomic fact about a subject. Be proactive:
 * whenever the user reveals something you should remember, store it.
 */

import type { ToolFunction } from '../../domain/entities/Tool.js';
import type { MemorySystem, ScopeFilter } from '../../memory/index.js';
import type { MemoryToolDeps, SubjectRef, Visibility } from './types.js';
import {
  SUBJECT_TOKEN_ME,
  SUBJECT_TOKEN_THIS_AGENT,
  clampUnit,
  resolveScope,
  toErrorMessage,
  visibilityToPermissions,
} from './types.js';

export interface RememberArgs {
  subject: SubjectRef;
  /** Relationship type — 'prefers', 'works_at', 'learned_pattern', 'employee_count', etc. */
  predicate: string;
  /** Scalar value when the fact is a datum (name, number, flag). */
  value?: unknown;
  /** Entity id/reference when the fact links to another entity — or use memory_link instead. */
  objectId?: string;
  /** Long-form markdown/text for narrative facts ('learned_pattern' etc.). */
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

const DESCRIPTION = `Record a new atomic fact (subject, predicate, value-or-object). Be proactive — whenever the user reveals something you should remember, store it. Facts accumulate and feed into profile regeneration automatically.

Subject can be: "me", "this_agent", entity id, {id}, {identifier:{kind,value}}, or {surface:"..."}.

You can ONLY write facts on entities you own (the tool rejects writes to entities owned by other users — upsert your own entity first via memory_find_entity).

visibility (default varies by subject):
- "private": only the owner (current user) can see — good for personal notes.
- "group": the user's group can read — for team-shared knowledge.
- "public": library defaults (group+world read) — for broadly useful facts.

Defaults: user subject → "private"; this_agent → "group" (shared agents); other → "private".

If contextIds contains any entity you don't own, visibility is automatically downgraded to "private" to prevent leaking fabricated facts into another user's context graph — the response will include a "warnings" field in that case.

Examples:
- Remember a user preference:
  {"subject":"me","predicate":"prefers","value":"concise responses"}
- Company fact with confidence + importance (your own company entity):
  {"subject":{"surface":"Acme"},"predicate":"employee_count","value":500,"confidence":0.8,"importance":0.3}
- Agent-level learned rule (shared with group):
  {"subject":"this_agent","predicate":"learned_pattern","details":"Always ask for dimensions before tax calculations","visibility":"group"}
- Observation tied to a context entity:
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
            value: { description: 'Scalar value (string, number, boolean, object).' },
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

      // H-2: if any contextId points to a foreign-owned (but visible) entity
      // and the chosen visibility would leak it via graph-touchesEntity
      // queries, downgrade to 'private'. Invisible contextIds are left for
      // the memory layer to reject.
      const warnings: string[] = [];
      if (args.contextIds?.length && (vis === 'group' || vis === 'public')) {
        const foreign = await findForeignContextIds(
          deps.memory,
          args.contextIds,
          scope,
        );
        if (foreign.length > 0) {
          vis = 'private';
          warnings.push(
            `visibility downgraded to "private": contextIds include entities you don't own (${foreign.join(', ')}). ` +
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
            kind: 'atomic',
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

/**
 * Filter contextIds to those pointing to entities visible but NOT owned by the
 * caller. Invisible entities are skipped (the memory layer will reject them
 * at addFact time).
 */
async function findForeignContextIds(
  memory: MemorySystem,
  contextIds: string[],
  scope: ScopeFilter,
): Promise<string[]> {
  const foreign: string[] = [];
  await Promise.all(
    contextIds.map(async (id) => {
      const ent = await memory.getEntity(id, scope);
      if (ent && ent.ownerId !== undefined && ent.ownerId !== scope.userId) {
        foreign.push(id);
      }
    }),
  );
  return foreign;
}
