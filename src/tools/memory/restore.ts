/**
 * memory_restore — reverse an archive. Companion to `memory_forget` so an
 * agent has an undo path for mistaken archives (H9: user feedback "I didn't
 * mean to forget that" should not require an admin).
 *
 * Cheap operation: flips `archived: false` on the fact after a scope/write
 * permission check. Does NOT recreate hard-deleted facts (the memory system
 * never hard-deletes from the tool path — `archiveFact` is the only
 * destruction primitive LLM tools can reach).
 */

import type { ToolFunction } from '../../domain/entities/Tool.js';
import type { MemoryToolDeps } from './types.js';
import { resolveScope, toErrorMessage } from './types.js';
import { FactSupersededError } from '../../memory/MemorySystem.js';

export interface RestoreArgs {
  factId: string;
}

const DESCRIPTION = `Restore a previously archived fact so it appears in queries again. Use when you archived a fact by mistake, or when the user says "actually keep that."

Examples:
- Undo a prior archive: {"factId":"fact_xyz"}
- No-op if the fact is already active: (returns restored=false, wasArchived=false)`;

export function createRestoreTool(deps: MemoryToolDeps): ToolFunction<RestoreArgs> {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'memory_restore',
        description: DESCRIPTION,
        parameters: {
          type: 'object',
          properties: {
            factId: { type: 'string' },
          },
          required: ['factId'],
        },
      },
    },

    describeCall: (args) => `restore ${args.factId}`,

    execute: async (args, context) => {
      if (!args.factId || typeof args.factId !== 'string') {
        return { error: 'factId is required (non-empty string)' };
      }
      const scope = resolveScope(context?.userId, deps.defaultUserId, deps.defaultGroupId);

      try {
        await deps.memory.restoreFact(args.factId, scope);
        return { restored: true, factId: args.factId };
      } catch (err) {
        // F1: surface supersession blockers as a structured result so the LLM
        // can take the correct recovery step (archive the successor first).
        if (err instanceof FactSupersededError) {
          return {
            error: err.message,
            supersededBy: err.supersededBy,
            factId: err.factId,
          };
        }
        return { error: `memory_restore failed: ${toErrorMessage(err)}` };
      }
    },
  };
}
