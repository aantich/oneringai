/**
 * routine_delete - Permanently deletes a routine definition by ID.
 *
 * Note: This does not affect past execution records — those remain in
 * IRoutineExecutionStorage. Schedules or other systems referencing this
 * routine ID will fail at runtime with "Routine not found".
 */

import type { ToolFunction } from '../../domain/entities/Tool.js';
import type { ToolContext } from '../../domain/interfaces/IToolContext.js';
import type { IRoutineDefinitionStorage } from '../../domain/interfaces/IRoutineDefinitionStorage.js';
import { resolveRoutineDefinitionStorage } from './resolveStorage.js';

interface RoutineDeleteArgs {
  routineId: string;
}

interface RoutineDeleteResult {
  success: boolean;
  routineId?: string;
  routineName?: string;
  error?: string;
}

export function createRoutineDelete(
  storage?: IRoutineDefinitionStorage,
): ToolFunction<RoutineDeleteArgs, RoutineDeleteResult> {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'routine_delete',
        description:
          'Permanently delete a routine definition. Past execution records are preserved, but any schedules or systems still referencing this routine ID will fail at runtime. Confirm with the user before calling.',
        parameters: {
          type: 'object',
          properties: {
            routineId: {
              type: 'string',
              description: 'ID of the routine definition to delete.',
            },
          },
          required: ['routineId'],
        },
      },
    },

    permission: { scope: 'session' as const, riskLevel: 'high' as const },

    execute: async (
      args: RoutineDeleteArgs,
      context?: ToolContext,
    ): Promise<RoutineDeleteResult> => {
      try {
        const userId = context?.userId;
        const s = resolveRoutineDefinitionStorage(storage, context);

        const routine = await s.load(userId, args.routineId);
        if (!routine) {
          return { success: false, error: `Routine not found: ${args.routineId}` };
        }

        await s.delete(userId, args.routineId);

        return {
          success: true,
          routineId: args.routineId,
          routineName: routine.name,
        };
      } catch (error) {
        return { success: false, error: (error as Error).message };
      }
    },

    describeCall: (args: RoutineDeleteArgs) => `delete routine ${args.routineId}`,
  };
}

/** Default routine_delete instance (resolves storage from StorageRegistry at execution time) */
export const routineDelete = createRoutineDelete();
