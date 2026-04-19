/**
 * memory_remember — write an atomic fact about a subject. Be proactive:
 * whenever the user reveals something you should remember, store it.
 */

import type { ToolFunction } from '../../domain/entities/Tool.js';
import type { MemoryToolDeps, SubjectRef, Visibility } from './types.js';
import {
  SUBJECT_TOKEN_ME,
  SUBJECT_TOKEN_THIS_AGENT,
  resolveScope,
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
  /** 0..1 confidence. Default 1.0 for direct user-provided facts; LLM-inferred → lower. */
  confidence?: number;
  /** 0..1 importance. Drives ranking. 1.0 for identity-level, 0.1 for trivia. Default 0.5. */
  importance?: number;
  /** When did this event happen? ISO string. Default: now. */
  observedAt?: string;
  /** Extra entities this fact is "about" — e.g. [dealId] when logging activity around a deal. */
  contextIds?: string[];
  /** Visibility. Default: 'private' for user/other subjects, 'group' for this_agent. */
  visibility?: Visibility;
  /** Group scope. Optional. */
  groupId?: string;
}

const DESCRIPTION = `Record a new atomic fact (subject, predicate, value-or-object). Be proactive — whenever the user reveals something you should remember, store it. Facts accumulate and feed into profile regeneration automatically.

Subject can be: "me", "this_agent", entity id, {id}, {identifier:{kind,value}}, or {surface:"..."}.

visibility (default varies by subject):
- "private": only the owner (current user) can see — good for personal notes.
- "group": the user's group can read — for team-shared knowledge.
- "public": library defaults (group+world read) — for broadly useful facts.

Defaults: user subject → "private"; this_agent → "group" (shared agents); other → "private".

Examples:
- Remember a user preference:
  {"subject":"me","predicate":"prefers","value":"concise responses"}
- Company fact with confidence + importance:
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
            groupId: { type: 'string' },
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

      const scope = resolveScope(context?.userId, deps.defaultUserId, args.groupId);
      const resolved = await deps.resolve(args.subject, scope);
      if (!resolved.ok) {
        return { error: resolved.message, candidates: resolved.candidates };
      }

      // Pick visibility: explicit arg > per-subject default.
      const vis = args.visibility ?? pickDefaultVisibility(deps, args.subject, resolved.entity.id);
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
            confidence: args.confidence,
            importance: args.importance,
            contextIds: args.contextIds,
            observedAt,
            permissions,
          },
          scope,
        );

        // Invalidate plugin cache if this touches user or agent subject.
        maybeInvalidate(deps, resolved.entity.id);

        return {
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
      } catch (err) {
        return { error: `memory_remember failed: ${(err as Error).message}` };
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

function maybeInvalidate(deps: MemoryToolDeps, entityId: string): void {
  const { userEntityId, agentEntityId } = deps.getOwnSubjectIds();
  if (entityId === userEntityId || entityId === agentEntityId) {
    deps.onWriteToOwnSubjects?.();
  }
}
