/**
 * memory_link — create a relational fact linking two entities.
 * Both sides are entities (not scalar values).
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

export interface LinkArgs {
  from: SubjectRef;
  predicate: string;
  to: SubjectRef;
  /** Optional narrative describing WHY the two entities are linked. Indexed semantically when long enough. */
  details?: string;
  importance?: number;
  confidence?: number;
  observedAt?: string;
  contextIds?: string[];
  visibility?: Visibility;
}

const DESCRIPTION = `Link two entities with a predicate. Both sides are entities (not scalar values). Use for "X attended Y", "A works at B", "C references D", etc. If you want to record a value (number, string) instead, use memory_remember.

Both 'from' and 'to' accept any SubjectRef form: entity id, "me", "this_agent", {id}, {identifier}, or {surface}.

You can ONLY link FROM an entity you own. (The 'to' side can be any visible entity.) If foreign contextIds are supplied with non-private visibility, visibility is downgraded to "private" and a warning is included in the response.

Examples:
- Alice attended a meeting (only valid if your entity is the 'from' side):
  {"from":"me","predicate":"attended","to":{"surface":"Q3 planning"}}
- User works at a company, with narrative context:
  {"from":"me","predicate":"works_at","to":{"identifier":{"kind":"domain","value":"acme.com"}},"details":"Joined 2024-06 as platform eng lead"}
- Agent learned that two concepts are related:
  {"from":"this_agent","predicate":"related_to","to":"ent_concept_b","details":"Both arise in the Q3 rollout discussion"}`;

export function createLinkTool(deps: MemoryToolDeps): ToolFunction<LinkArgs> {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'memory_link',
        description: DESCRIPTION,
        parameters: {
          type: 'object',
          properties: {
            from: { description: 'Source entity — see SubjectRef forms.' },
            predicate: { type: 'string' },
            to: { description: 'Target entity — see SubjectRef forms.' },
            details: { type: 'string' },
            importance: { type: 'number' },
            confidence: { type: 'number' },
            observedAt: { type: 'string' },
            contextIds: { type: 'array', items: { type: 'string' } },
            visibility: { type: 'string', enum: ['private', 'group', 'public'] },
          },
          required: ['from', 'predicate', 'to'],
        },
      },
    },

    describeCall: (args) => `link via ${args.predicate}`,

    execute: async (args, context) => {
      if (!args.from) return { error: 'from is required' };
      if (!args.to) return { error: 'to is required' };
      if (!args.predicate || typeof args.predicate !== 'string') {
        return { error: 'predicate is required (non-empty string)' };
      }

      const scope = resolveScope(context?.userId, deps.defaultUserId, deps.defaultGroupId);

      const fromRes = await deps.resolve(args.from, scope);
      if (!fromRes.ok) {
        return { error: `from: ${fromRes.message}`, candidates: fromRes.candidates };
      }
      const toRes = await deps.resolve(args.to, scope);
      if (!toRes.ok) {
        return { error: `to: ${toRes.message}`, candidates: toRes.candidates };
      }

      // H-1: reject ghost-writes — the fact's subject is `from`, and the
      // memory layer enforces fact.ownerId == subject.ownerId. Writing from a
      // foreign-owned entity would silently attribute the link to that owner.
      if (
        fromRes.entity.ownerId !== undefined &&
        fromRes.entity.ownerId !== scope.userId
      ) {
        return {
          error:
            `memory_link: cannot write links from entities you don't own ` +
            `(from.ownerId=${fromRes.entity.ownerId}, caller=${scope.userId ?? 'none'}). ` +
            `Upsert your own entity via memory_find_entity or link from "me" / "this_agent".`,
          fromOwnerId: fromRes.entity.ownerId,
        };
      }

      // M-3: pick default visibility based on the `from` subject class, not
      // always `forOther`. This matches memory_remember and respects host
      // config like `defaultVisibility.forAgent='group'`.
      let vis = args.visibility ?? pickDefaultVisibility(deps, args.from, fromRes.entity.id);

      const warnings: string[] = [];

      // H1: surface ownerless-from audit note. fromRes is the fact's subject.
      const ownerlessWarn = ownerlessSubjectWarning(fromRes.entity.ownerId, scope.userId);
      if (ownerlessWarn) warnings.push(ownerlessWarn);

      // H-2: downgrade on foreign contextIds. Adapter errors → fail-safe to
      // "foreign" (downgrade to private).
      if (args.contextIds?.length && (vis === 'group' || vis === 'public')) {
        const foreign = await findForeignContextIds(
          deps.memory,
          args.contextIds,
          scope,
          { tool: 'memory_link', fromId: fromRes.entity.id },
        );
        if (foreign.length > 0) {
          vis = 'private';
          warnings.push(
            `visibility downgraded to "private": contextIds include entities you don't own or couldn't verify (${foreign.join(', ')}).`,
          );
        }
      }

      const permissions = visibilityToPermissions(vis);
      const observedAt = args.observedAt ? new Date(args.observedAt) : new Date();

      try {
        const fact = await deps.memory.addFact(
          {
            subjectId: fromRes.entity.id,
            predicate: args.predicate,
            kind: 'atomic',
            objectId: toRes.entity.id,
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
            objectId: fact.objectId,
            details: fact.details,
            observedAt: fact.observedAt,
            permissions: fact.permissions,
          },
          from: { id: fromRes.entity.id, displayName: fromRes.entity.displayName },
          to: { id: toRes.entity.id, displayName: toRes.entity.displayName },
          visibility: vis,
        };
        if (warnings.length > 0) payload.warnings = warnings;
        return payload;
      } catch (err) {
        return { error: `memory_link failed: ${toErrorMessage(err)}` };
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

