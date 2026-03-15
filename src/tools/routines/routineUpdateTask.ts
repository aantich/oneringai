/**
 * routine_update_task - Updates a specific task within a routine definition.
 */

import type { ToolFunction } from '../../domain/entities/Tool.js';
import type { ToolContext } from '../../domain/interfaces/IToolContext.js';
import type { TaskInput } from '../../domain/entities/Task.js';
import type { IRoutineDefinitionStorage } from '../../domain/interfaces/IRoutineDefinitionStorage.js';
import { createRoutineDefinition } from '../../domain/entities/Routine.js';
import { resolveRoutineDefinitionStorage } from './resolveStorage.js';

interface TaskUpdates {
  description?: string;
  expectedOutput?: string;
  suggestedTools?: string[];
  maxAttempts?: number;
  validation?: {
    completionCriteria?: string[];
    minCompletionScore?: number;
  };
}

interface RoutineUpdateTaskArgs {
  routineId: string;
  taskName: string;
  updates: TaskUpdates;
}

export function createRoutineUpdateTask(
  storage?: IRoutineDefinitionStorage,
): ToolFunction<RoutineUpdateTaskArgs> {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'routine_update_task',
        description:
          'Update a specific task within an existing routine definition. Validates the updated routine before saving.',
        parameters: {
          type: 'object',
          properties: {
            routineId: {
              type: 'string',
              description: 'Routine ID containing the task to update',
            },
            taskName: {
              type: 'string',
              description: 'Name of the task to update',
            },
            updates: {
              type: 'object',
              description: 'Fields to update on the task',
              properties: {
                description: { type: 'string', description: 'New task description' },
                expectedOutput: { type: 'string', description: 'New expected output description' },
                suggestedTools: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'New list of suggested tool names',
                },
                maxAttempts: { type: 'number', description: 'New max retry count' },
                validation: {
                  type: 'object',
                  description: 'Validation settings to update',
                  properties: {
                    completionCriteria: {
                      type: 'array',
                      items: { type: 'string' },
                      description: 'Completion criteria strings',
                    },
                    minCompletionScore: {
                      type: 'number',
                      description: 'Minimum completion score (0-100)',
                    },
                  },
                },
              },
            },
          },
          required: ['routineId', 'taskName', 'updates'],
        },
      },
    },

    permission: { scope: 'session' as const, riskLevel: 'medium' as const },

    execute: async (args: RoutineUpdateTaskArgs, context?: ToolContext) => {
      try {
        const userId = context?.userId;
        const s = resolveRoutineDefinitionStorage(storage, context);

        // Load existing routine
        const routine = await s.load(userId, args.routineId);
        if (!routine) {
          return { success: false, error: `Routine not found: ${args.routineId}` };
        }

        // Find the task
        const taskIndex = routine.tasks.findIndex((t) => t.name === args.taskName);
        if (taskIndex === -1) {
          return {
            success: false,
            error: `Task not found: "${args.taskName}" in routine "${routine.name}"`,
          };
        }

        // Clone tasks array and the target task
        const updatedTasks = [...routine.tasks];
        const task = { ...updatedTasks[taskIndex] };
        const updatedFields: string[] = [];

        // Apply updates
        if (args.updates.description !== undefined) {
          task.description = args.updates.description;
          updatedFields.push('description');
        }
        if (args.updates.expectedOutput !== undefined) {
          task.expectedOutput = args.updates.expectedOutput;
          updatedFields.push('expectedOutput');
        }
        if (args.updates.suggestedTools !== undefined) {
          task.suggestedTools = args.updates.suggestedTools;
          updatedFields.push('suggestedTools');
        }
        if (args.updates.maxAttempts !== undefined) {
          task.maxAttempts = args.updates.maxAttempts;
          updatedFields.push('maxAttempts');
        }
        if (args.updates.validation !== undefined) {
          task.validation = {
            ...task.validation,
            ...args.updates.validation,
          };
          updatedFields.push('validation');
        }

        if (updatedFields.length === 0) {
          return { success: false, error: 'No valid update fields provided' };
        }

        updatedTasks[taskIndex] = task as TaskInput;

        // Re-validate the full routine via createRoutineDefinition
        const validated = createRoutineDefinition({
          ...routine,
          tasks: updatedTasks,
        });

        // Save back
        await s.save(userId, validated);

        return {
          success: true,
          routineId: routine.id,
          routineName: routine.name,
          taskName: args.taskName,
          updatedFields,
        };
      } catch (error) {
        return { success: false, error: (error as Error).message };
      }
    },

    describeCall: (args: RoutineUpdateTaskArgs) => `update ${args.taskName} in ${args.routineId}`,
  };
}

/** Default routine_update_task instance (resolves storage from StorageRegistry at execution time) */
export const routineUpdateTask = createRoutineUpdateTask();
