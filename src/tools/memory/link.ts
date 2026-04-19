/**
 * memory_link — create a relational fact linking two entities.
 * Both sides are entities (not scalar values).
 */

import type { ToolFunction } from '../../domain/entities/Tool.js';
import type { MemoryToolDeps, SubjectRef, Visibility } from './types.js';
import { resolveScope, visibilityToPermissions } from './types.js';

export interface LinkArgs {
  from: SubjectRef;
  predicate: string;
  to: SubjectRef;
  importance?: number;
  confidence?: number;
  observedAt?: string;
  contextIds?: string[];
  visibility?: Visibility;
  groupId?: string;
}

const DESCRIPTION = `Link two entities with a predicate. Both sides are entities (not scalar values). Use for "X attended Y", "A works at B", "C references D", etc. If you want to record a value (number, string) instead, use memory_remember.

Both 'from' and 'to' accept any SubjectRef form: entity id, "me", "this_agent", {id}, {identifier}, or {surface}.

Examples:
- Alice attended a meeting:
  {"from":{"surface":"Alice"},"predicate":"attended","to":{"surface":"Q3 planning"}}
- User works at a company:
  {"from":"me","predicate":"works_at","to":{"identifier":{"kind":"domain","value":"acme.com"}}}
- Doc references a deal (context-tagged):
  {"from":"ent_doc1","predicate":"references","to":"ent_deal1","contextIds":["ent_proj42"]}`;

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
            importance: { type: 'number' },
            confidence: { type: 'number' },
            observedAt: { type: 'string' },
            contextIds: { type: 'array', items: { type: 'string' } },
            visibility: { type: 'string', enum: ['private', 'group', 'public'] },
            groupId: { type: 'string' },
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

      const scope = resolveScope(context?.userId, deps.defaultUserId, args.groupId);

      const fromRes = await deps.resolve(args.from, scope);
      if (!fromRes.ok) {
        return { error: `from: ${fromRes.message}`, candidates: fromRes.candidates };
      }
      const toRes = await deps.resolve(args.to, scope);
      if (!toRes.ok) {
        return { error: `to: ${toRes.message}`, candidates: toRes.candidates };
      }

      const vis = args.visibility ?? deps.defaultVisibility.forOther;
      const permissions = visibilityToPermissions(vis);
      const observedAt = args.observedAt ? new Date(args.observedAt) : new Date();

      try {
        const fact = await deps.memory.addFact(
          {
            subjectId: fromRes.entity.id,
            predicate: args.predicate,
            kind: 'atomic',
            objectId: toRes.entity.id,
            confidence: args.confidence,
            importance: args.importance,
            contextIds: args.contextIds,
            observedAt,
            permissions,
          },
          scope,
        );

        // Touch cache on either side being user/agent.
        const own = deps.getOwnSubjectIds();
        if (
          fromRes.entity.id === own.userEntityId ||
          fromRes.entity.id === own.agentEntityId ||
          toRes.entity.id === own.userEntityId ||
          toRes.entity.id === own.agentEntityId
        ) {
          deps.onWriteToOwnSubjects?.();
        }

        return {
          fact: {
            id: fact.id,
            subjectId: fact.subjectId,
            predicate: fact.predicate,
            objectId: fact.objectId,
            observedAt: fact.observedAt,
            permissions: fact.permissions,
          },
          from: { id: fromRes.entity.id, displayName: fromRes.entity.displayName },
          to: { id: toRes.entity.id, displayName: toRes.entity.displayName },
        };
      } catch (err) {
        return { error: `memory_link failed: ${(err as Error).message}` };
      }
    },
  };
}
