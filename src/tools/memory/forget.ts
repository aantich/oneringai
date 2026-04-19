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
      const scope = resolveScope(context?.userId, deps.defaultUserId, deps.defaultGroupId);

      try {
        if (!args.replaceWith) {
          await deps.memory.archiveFact(args.factId, scope);
          // Cache invalidation is conservative: we don't know the archived fact's
          // subject here, so always flip dirty — cheap vs. another round-trip.
          deps.onWriteToOwnSubjects?.();
          return { archived: true, factId: args.factId };
        }

        // Load predecessor to capture subjectId + default permissions before
        // writing the successor.
        const predecessor = await deps.memory.getFact(args.factId, scope);
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
