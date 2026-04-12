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

interface StepPhaseSummary {
  total: number;
  completed: number;
  failed: number;
  errors?: string[];
}

function buildStepSummary(
  steps: Array<{ type: string; data?: Record<string, unknown> }>,
  completedType: string,
  failedType: string,
  startedType: string,
): StepPhaseSummary | undefined {
  const started = steps.filter(s => s.type === startedType).length;
  if (started === 0) return undefined;

  const completed = steps.filter(s => s.type === completedType).length;
  const failedSteps = steps.filter(s => s.type === failedType);
  const errors = failedSteps
    .map(s => s.data?.error as string | undefined)
    .filter((e): e is string => !!e);

  return {
    total: started,
    completed,
    failed: failedSteps.length,
    ...(errors.length > 0 ? { errors } : {}),
  };
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

        const executions = records.map((rec) => {
          const preStepsSummary = buildStepSummary(
            rec.steps, 'prestep.completed', 'prestep.failed', 'prestep.started',
          );
          const postStepsSummary = buildStepSummary(
            rec.steps, 'poststep.completed', 'poststep.failed', 'poststep.started',
          );

          return {
            executionId: rec.executionId,
            status: rec.status,
            startedAt: rec.startedAt ? new Date(rec.startedAt).toISOString() : undefined,
            completedAt: rec.completedAt ? new Date(rec.completedAt).toISOString() : undefined,
            error: rec.error,
            connectorName: rec.connectorName,
            model: rec.model,
            ...(preStepsSummary ? { preStepsSummary } : {}),
            tasks: rec.tasks.map((t) => ({
              name: t.name,
              status: t.status,
              attempts: t.attempts,
              result: t.result,
            })),
            ...(postStepsSummary ? { postStepsSummary } : {}),
          };
        });

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
