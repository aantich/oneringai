/**
 * routine_get - Retrieves a routine definition by ID or name.
 */

import type { ToolFunction } from '../../domain/entities/Tool.js';
import type { ToolContext } from '../../domain/interfaces/IToolContext.js';
import type { IRoutineDefinitionStorage } from '../../domain/interfaces/IRoutineDefinitionStorage.js';
import { resolveRoutineDefinitionStorage } from './resolveStorage.js';

interface RoutineGetArgs {
  routineId?: string;
  routineName?: string;
}

function truncate(val: unknown, limit: number): string | undefined {
  if (val === null || val === undefined) return undefined;
  const str = typeof val === 'string' ? val : JSON.stringify(val);
  if (str.length <= limit) return str;
  return `${str.substring(0, limit)}...[truncated]`;
}

export function createRoutineGet(storage?: IRoutineDefinitionStorage): ToolFunction<RoutineGetArgs> {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'routine_get',
        description:
          'Retrieve a routine definition by ID or by name search. Returns the full routine structure including tasks, parameters, and metadata.',
        parameters: {
          type: 'object',
          properties: {
            routineId: {
              type: 'string',
              description: 'Exact routine ID to load',
            },
            routineName: {
              type: 'string',
              description: 'Search for a routine by name (returns first match)',
            },
          },
        },
      },
    },

    permission: { scope: 'always' as const, riskLevel: 'low' as const },

    execute: async (args: RoutineGetArgs, context?: ToolContext) => {
      try {
        if (!args.routineId && !args.routineName) {
          return { success: false, error: 'Either routineId or routineName must be provided' };
        }

        const userId = context?.userId;
        const s = resolveRoutineDefinitionStorage(storage, context);

        let routine = null;

        if (args.routineId) {
          routine = await s.load(userId, args.routineId);
        } else if (args.routineName) {
          const results = await s.list(userId, { search: args.routineName, limit: 1 });
          routine = results.length > 0 ? results[0] : null;
        }

        if (!routine) {
          return {
            success: false,
            error: args.routineId
              ? `Routine not found: ${args.routineId}`
              : `No routine found matching name: ${args.routineName}`,
          };
        }

        return {
          success: true,
          routine: {
            id: routine.id,
            name: routine.name,
            description: routine.description,
            version: routine.version,
            author: routine.author,
            tags: routine.tags,
            instructions: truncate(routine.instructions, 500),
            parameters: routine.parameters,
            requiredTools: routine.requiredTools,
            requiredPlugins: routine.requiredPlugins,
            concurrency: routine.concurrency,
            allowDynamicTasks: routine.allowDynamicTasks,
            createdAt: routine.createdAt,
            updatedAt: routine.updatedAt,
            tasks: routine.tasks.map((t) => ({
              name: t.name,
              description: truncate(t.description, 500),
              dependsOn: t.dependsOn,
              suggestedTools: t.suggestedTools,
              expectedOutput: truncate(t.expectedOutput, 500),
              maxAttempts: t.maxAttempts,
              controlFlow: t.controlFlow ? { type: t.controlFlow.type } : undefined,
              validation: t.validation,
            })),
          },
        };
      } catch (error) {
        return { success: false, error: (error as Error).message };
      }
    },

    describeCall: (args: RoutineGetArgs) => args.routineId ?? args.routineName ?? 'routine',
  };
}

/** Default routine_get instance (resolves storage from StorageRegistry at execution time) */
export const routineGet = createRoutineGet();
