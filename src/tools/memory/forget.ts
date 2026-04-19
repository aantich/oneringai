/**
 * memory_forget — archive a fact, optionally superseding it with a replacement.
 * Supersession preserves history (full audit chain); archive hides without
 * a successor.
 */

import type { ToolFunction } from '../../domain/entities/Tool.js';
import type { MemoryToolDeps, Visibility } from './types.js';
import { resolveScope, visibilityToPermissions } from './types.js';

export interface ForgetArgs {
  factId: string;
  /**
   * When provided, the archived fact is superseded by a new one with these
   * fields. The new fact inherits the predecessor's subjectId; the predicate
   * / value / details / etc. come from here.
   */
  replaceWith?: {
    predicate?: string;
    value?: unknown;
    objectId?: string;
    details?: string;
    confidence?: number;
    importance?: number;
    observedAt?: string;
    contextIds?: string[];
    visibility?: Visibility;
  };
  groupId?: string;
}

const DESCRIPTION = `Archive a fact, optionally replacing it with a corrected/updated one. Supersession (replaceWith) preserves history — you can always audit what changed. Plain archive just hides the fact.

Examples:
- Archive a wrong fact outright: {"factId":"fact_xyz"}
- Supersede with a correction (subject inherited from predecessor):
  {"factId":"fact_xyz","replaceWith":{"predicate":"role","value":"senior engineer"}}
- Update free-form document:
  {"factId":"fact_note","replaceWith":{"predicate":"learned_pattern","details":"New version of the pattern...","importance":0.8}}`;

export function createForgetTool(deps: MemoryToolDeps): ToolFunction<ForgetArgs> {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'memory_forget',
        description: DESCRIPTION,
        parameters: {
          type: 'object',
          properties: {
            factId: { type: 'string' },
            replaceWith: { type: 'object' },
            groupId: { type: 'string' },
          },
          required: ['factId'],
        },
      },
    },

    describeCall: (args) => `forget ${args.factId}${args.replaceWith ? ' (replace)' : ''}`,

    execute: async (args, context) => {
      if (!args.factId || typeof args.factId !== 'string') {
        return { error: 'factId is required (non-empty string)' };
      }
      const scope = resolveScope(context?.userId, deps.defaultUserId, args.groupId);

      try {
        if (!args.replaceWith) {
          await deps.memory.archiveFact(args.factId, scope);
          // Invalidate cache if the archived fact's subject is user/agent.
          // Since we don't have the fact object here, invalidate unconditionally
          // on any forget — cheap.
          deps.onWriteToOwnSubjects?.();
          return { archived: true, factId: args.factId };
        }

        // Supersede path — use MemorySystem.addFact with supersedes. We need the
        // predecessor's subjectId; fetch the fact first via the store accessor
        // on memory. MemorySystem doesn't expose a public getFact; findFacts +
        // id filter isn't ideal. Fall back to archiveFact if lookup fails.
        const predecessor = await findFactById(deps, args.factId, scope);
        if (!predecessor) {
          return { error: `fact '${args.factId}' not found or not visible` };
        }

        const rw = args.replaceWith;
        if (!rw.predicate && !predecessor.predicate) {
          return { error: 'replaceWith.predicate required when predecessor has none' };
        }
        if (rw.value === undefined && !rw.objectId && !rw.details) {
          return {
            error: 'replaceWith needs at least one of: value, objectId, details',
          };
        }

        const permissions = rw.visibility
          ? visibilityToPermissions(rw.visibility)
          : predecessor.permissions;
        const observedAt = rw.observedAt ? new Date(rw.observedAt) : new Date();

        const newFact = await deps.memory.addFact(
          {
            subjectId: predecessor.subjectId,
            predicate: rw.predicate ?? predecessor.predicate,
            kind: 'atomic',
            value: rw.value,
            objectId: rw.objectId,
            details: rw.details,
            confidence: rw.confidence,
            importance: rw.importance,
            contextIds: rw.contextIds,
            observedAt,
            permissions,
            supersedes: args.factId,
          },
          scope,
        );

        deps.onWriteToOwnSubjects?.();

        return {
          superseded: true,
          oldFactId: args.factId,
          newFact: {
            id: newFact.id,
            subjectId: newFact.subjectId,
            predicate: newFact.predicate,
            value: newFact.value,
            objectId: newFact.objectId,
            details: newFact.details,
          },
        };
      } catch (err) {
        return { error: `memory_forget failed: ${(err as Error).message}` };
      }
    },
  };
}

async function findFactById(
  deps: MemoryToolDeps,
  factId: string,
  scope: import('../../memory/index.js').ScopeFilter,
) {
  // No direct getFact on MemorySystem — scan via findFacts with no filter and
  // match by id. Small (limit=1) but broad — acceptable for the rare supersede
  // path; library consumers doing high-rate superseding should use
  // memory.addFact({...supersedes}) directly.
  // Better: expose getFact. Let's do that — simpler and faster.
  return deps.memory.getFact(factId, scope);
}
