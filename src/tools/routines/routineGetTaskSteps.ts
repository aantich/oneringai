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
  taskName?: string;
  phase?: 'task' | 'pre' | 'post' | 'all';
  stepTypes?: string[];
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
          'Get step-level execution detail for a routine execution. Filter by task name, phase, or step types.\n\n' +
          'Phases:\n' +
          '- "task" (default): steps within the main task loop (taskName required)\n' +
          '- "pre": deterministic preSteps\n' +
          '- "post": deterministic postSteps\n' +
          '- "all": everything (taskName optional filter)\n\n' +
          'Step type groups (use for stepTypes filter):\n' +
          '- task.*           — task.started, task.completed, task.failed, task.validation\n' +
          '- tool.*           — tool.start, tool.call\n' +
          '- llm.*            — llm.start, llm.complete\n' +
          '- control_flow.*   — control_flow.started, control_flow.completed (map/fold/until wrappers)\n' +
          '- prestep.*        — prestep.started, prestep.completed, prestep.failed\n' +
          '- poststep.*       — poststep.started, poststep.completed, poststep.failed\n' +
          '- iteration.complete, execution.error',
        parameters: {
          type: 'object',
          properties: {
            executionId: {
              type: 'string',
              description: 'Execution record ID',
            },
            taskName: {
              type: 'string',
              description: 'Name of the task or step to filter by. Required when phase is "task", optional otherwise.',
            },
            phase: {
              type: 'string',
              enum: ['task', 'pre', 'post', 'all'],
              description: 'Execution phase to query: "task" (default), "pre" (preSteps), "post" (postSteps), "all"',
            },
            stepTypes: {
              type: 'array',
              items: { type: 'string' },
              description:
                'Optional filter for step types (e.g., ["task.started", "task.completed", "prestep.failed"])',
            },
          },
          required: ['executionId'],
        },
      },
    },

    permission: { scope: 'always' as const, riskLevel: 'low' as const },

    execute: async (args: RoutineGetTaskStepsArgs, context?: ToolContext) => {
      try {
        const phase = args.phase ?? 'task';

        // Require taskName when phase is "task"
        if (phase === 'task' && !args.taskName) {
          return { success: false, error: 'taskName is required when phase is "task"' };
        }

        const s = resolveRoutineExecutionStorage(storage, context);

        const record = await s.load(args.executionId);
        if (!record) {
          return { success: false, error: `Execution not found: ${args.executionId}` };
        }

        // Phase-based filtering
        const preTypes = new Set<string>(['prestep.started', 'prestep.completed', 'prestep.failed']);
        const postTypes = new Set<string>(['poststep.started', 'poststep.completed', 'poststep.failed']);

        let filtered = record.steps;

        if (phase === 'pre') {
          filtered = filtered.filter(s => preTypes.has(s.type));
          if (args.taskName) {
            filtered = filtered.filter(s => s.taskName === args.taskName);
          }
        } else if (phase === 'post') {
          filtered = filtered.filter(s => postTypes.has(s.type));
          if (args.taskName) {
            filtered = filtered.filter(s => s.taskName === args.taskName);
          }
        } else if (phase === 'all') {
          if (args.taskName) {
            filtered = filtered.filter(s => s.taskName === args.taskName);
          }
        } else {
          // phase === 'task' — exclude pre/post step types, filter by taskName
          filtered = filtered.filter(
            s => !preTypes.has(s.type) && !postTypes.has(s.type) && s.taskName === args.taskName,
          );
        }

        // Optionally filter by step types
        if (args.stepTypes && args.stepTypes.length > 0) {
          const typeSet = new Set(args.stepTypes as RoutineStepType[]);
          filtered = filtered.filter((step) => typeSet.has(step.type));
        }

        const steps = filtered.map((step) => ({
          timestamp: new Date(step.timestamp).toISOString(),
          taskName: step.taskName,
          type: step.type,
          data: step.data,
        }));

        return {
          success: true,
          phase,
          ...(args.taskName ? { taskName: args.taskName } : {}),
          totalStepsInExecution: record.steps.length,
          filteredStepCount: steps.length,
          steps,
        };
      } catch (error) {
        return { success: false, error: (error as Error).message };
      }
    },

    describeCall: (args: RoutineGetTaskStepsArgs) =>
      `steps ${args.phase ?? 'task'}${args.taskName ? ` for ${args.taskName}` : ''}`,
  };
}

/** Default routine_get_task_steps instance (resolves storage from StorageRegistry at execution time) */
export const routineGetTaskSteps = createRoutineGetTaskSteps();
