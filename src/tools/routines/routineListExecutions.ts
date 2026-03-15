/**
 * routine_list_executions - Lists execution records for a routine.
 */

import type { ToolFunction } from '../../domain/entities/Tool.js';
import type { ToolContext } from '../../domain/interfaces/IToolContext.js';
import type { IRoutineExecutionStorage } from '../../domain/interfaces/IRoutineExecutionStorage.js';
import type { RoutineExecutionStatus } from '../../domain/entities/Routine.js';
import { StorageRegistry } from '../../core/StorageRegistry.js';
import type { StorageContext } from '../../core/StorageRegistry.js';

interface RoutineListExecutionsArgs {
  routineId: string;
  limit?: number;
  status?: string;
}

function truncate(val: unknown, limit: number): string | undefined {
  if (val === null || val === undefined) return undefined;
  const str = typeof val === 'string' ? val : JSON.stringify(val);
  if (str.length <= limit) return str;
  return `${str.substring(0, limit)}...[truncated]`;
}

function buildStorageContext(toolContext?: ToolContext): StorageContext | undefined {
  const global = StorageRegistry.getContext();
  if (global) return global;
  if (toolContext?.userId) return { userId: toolContext.userId };
  return undefined;
}

function resolveRoutineExecutionStorage(
  explicit: IRoutineExecutionStorage | undefined,
  toolContext?: ToolContext,
): IRoutineExecutionStorage {
  if (explicit) return explicit;

  const factory = StorageRegistry.get('routineExecutions');
  if (factory) {
    return factory(buildStorageContext(toolContext));
  }

  throw new Error(
    'No IRoutineExecutionStorage configured. Register one via StorageRegistry.set("routineExecutions", factory).',
  );
}

export function createRoutineListExecutions(
  storage?: IRoutineExecutionStorage,
): ToolFunction<RoutineListExecutionsArgs> {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'routine_list_executions',
        description:
          'List execution records for a routine. Returns summaries of past and current executions including status, timing, and per-task results.',
        parameters: {
          type: 'object',
          properties: {
            routineId: {
              type: 'string',
              description: 'Routine ID to list executions for',
            },
            limit: {
              type: 'number',
              description: 'Maximum number of executions to return (default: 5, max: 20)',
            },
            status: {
              type: 'string',
              description:
                'Filter by execution status: "pending", "running", "paused", "completed", "failed", "cancelled", or "all" (default: "all")',
            },
          },
          required: ['routineId'],
        },
      },
    },

    permission: { scope: 'always' as const, riskLevel: 'low' as const },

    execute: async (args: RoutineListExecutionsArgs, context?: ToolContext) => {
      try {
        const userId = context?.userId;
        const s = resolveRoutineExecutionStorage(storage, context);

        const limit = Math.min(Math.max(args.limit ?? 5, 1), 20);
        const statusFilter = args.status && args.status !== 'all' ? args.status : undefined;

        const records = await s.list(userId, {
          routineId: args.routineId,
          status: statusFilter as RoutineExecutionStatus | undefined,
          limit,
        });

        const executions = records.map((rec) => ({
          executionId: rec.executionId,
          status: rec.status,
          startedAt: rec.startedAt ? new Date(rec.startedAt).toISOString() : undefined,
          completedAt: rec.completedAt ? new Date(rec.completedAt).toISOString() : undefined,
          error: truncate(rec.error, 500),
          connectorName: rec.connectorName,
          model: rec.model,
          tasks: rec.tasks.map((t) => ({
            name: t.name,
            status: t.status,
            attempts: t.attempts,
            result: t.result ? truncate(t.result.output ?? t.result.error, 500) : undefined,
          })),
        }));

        return {
          success: true,
          routineId: args.routineId,
          total: executions.length,
          executions,
        };
      } catch (error) {
        return { success: false, error: (error as Error).message };
      }
    },

    describeCall: (args: RoutineListExecutionsArgs) => `executions for ${args.routineId}`,
  };
}

/** Default routine_list_executions instance (resolves storage from StorageRegistry at execution time) */
export const routineListExecutions = createRoutineListExecutions();
