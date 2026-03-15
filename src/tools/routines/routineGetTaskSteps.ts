/**
 * routine_get_task_steps - Retrieves step-level detail for a specific task within an execution.
 */

import type { ToolFunction } from '../../domain/entities/Tool.js';
import type { ToolContext } from '../../domain/interfaces/IToolContext.js';
import type { IRoutineExecutionStorage } from '../../domain/interfaces/IRoutineExecutionStorage.js';
import type { RoutineStepType } from '../../domain/entities/RoutineExecutionRecord.js';
import { StorageRegistry } from '../../core/StorageRegistry.js';
import type { StorageContext } from '../../core/StorageRegistry.js';

interface RoutineGetTaskStepsArgs {
  executionId: string;
  taskName: string;
  stepTypes?: string[];
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

export function createRoutineGetTaskSteps(
  storage?: IRoutineExecutionStorage,
): ToolFunction<RoutineGetTaskStepsArgs> {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'routine_get_task_steps',
        description:
          'Get step-level execution detail for a specific task within a routine execution. Returns timestamped steps filtered by task name and optional step types.',
        parameters: {
          type: 'object',
          properties: {
            executionId: {
              type: 'string',
              description: 'Execution record ID',
            },
            taskName: {
              type: 'string',
              description: 'Name of the task to get steps for',
            },
            stepTypes: {
              type: 'array',
              items: { type: 'string' },
              description:
                'Optional filter for step types (e.g., ["task.started", "task.completed", "tool.call", "llm.complete"])',
            },
          },
          required: ['executionId', 'taskName'],
        },
      },
    },

    permission: { scope: 'always' as const, riskLevel: 'low' as const },

    execute: async (args: RoutineGetTaskStepsArgs, context?: ToolContext) => {
      try {
        const s = resolveRoutineExecutionStorage(storage, context);

        const record = await s.load(args.executionId);
        if (!record) {
          return { success: false, error: `Execution not found: ${args.executionId}` };
        }

        // Filter steps by taskName
        let filtered = record.steps.filter((step) => step.taskName === args.taskName);

        // Optionally filter by step types
        if (args.stepTypes && args.stepTypes.length > 0) {
          const typeSet = new Set(args.stepTypes as RoutineStepType[]);
          filtered = filtered.filter((step) => typeSet.has(step.type));
        }

        // Truncate step data values
        const steps = filtered.map((step) => {
          const truncatedData: Record<string, unknown> | undefined = step.data
            ? Object.fromEntries(
                Object.entries(step.data).map(([k, v]) => [k, truncate(v, 1000)]),
              )
            : undefined;

          return {
            timestamp: new Date(step.timestamp).toISOString(),
            type: step.type,
            data: truncatedData,
          };
        });

        return {
          success: true,
          taskName: args.taskName,
          totalStepsInExecution: record.steps.length,
          filteredStepCount: steps.length,
          steps,
        };
      } catch (error) {
        return { success: false, error: (error as Error).message };
      }
    },

    describeCall: (args: RoutineGetTaskStepsArgs) => `steps for ${args.taskName}`,
  };
}

/** Default routine_get_task_steps instance (resolves storage from StorageRegistry at execution time) */
export const routineGetTaskSteps = createRoutineGetTaskSteps();
