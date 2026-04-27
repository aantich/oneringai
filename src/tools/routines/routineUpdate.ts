/**
 * routine_update - Updates routine-level fields on an existing routine definition.
 *
 * For task-level updates, use routine_update_task instead.
 */

import type { ToolFunction } from '../../domain/entities/Tool.js';
import type { ToolContext } from '../../domain/interfaces/IToolContext.js';
import type { IRoutineDefinitionStorage } from '../../domain/interfaces/IRoutineDefinitionStorage.js';
import type {
  RoutineParameter,
  DeterministicStep,
} from '../../domain/entities/Routine.js';
import { createRoutineDefinition } from '../../domain/entities/Routine.js';
import type { PlanConcurrency, TaskInput } from '../../domain/entities/Task.js';
import { resolveRoutineDefinitionStorage } from './resolveStorage.js';

interface RoutineUpdates {
  description?: string;
  instructions?: string;
  parameters?: RoutineParameter[];
  tasks?: TaskInput[];
  preSteps?: DeterministicStep[];
  postSteps?: DeterministicStep[];
  postStepsTrigger?: 'on-success' | 'always';
  timeoutMs?: number;
  requiredTools?: string[];
  requiredPlugins?: string[];
  concurrency?: PlanConcurrency;
  allowDynamicTasks?: boolean;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

interface RoutineUpdateArgs {
  routineId: string;
  updates: RoutineUpdates;
}

const UPDATABLE_FIELDS: (keyof RoutineUpdates)[] = [
  'description',
  'instructions',
  'parameters',
  'tasks',
  'preSteps',
  'postSteps',
  'postStepsTrigger',
  'timeoutMs',
  'requiredTools',
  'requiredPlugins',
  'concurrency',
  'allowDynamicTasks',
  'tags',
  'metadata',
];

export function createRoutineUpdate(
  storage?: IRoutineDefinitionStorage,
): ToolFunction<RoutineUpdateArgs> {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'routine_update',
        description:
          'Update an existing routine definition. ' +
          'Supports both routine-level fields (description, instructions, parameters, concurrency, etc.) ' +
          'and full replacement of the tasks array (add/remove/reorder/rename tasks, change dependencies, control flow, conditions). ' +
          'For surgical edits to a single existing task (description, expectedOutput, etc.) prefer routine_update_task. ' +
          'Validates the merged routine via createRoutineDefinition (checks dependency graph + cycles) before saving.',
        parameters: {
          type: 'object',
          properties: {
            routineId: {
              type: 'string',
              description: 'Routine ID to update',
            },
            updates: {
              type: 'object',
              description: 'Fields to update on the routine',
              properties: {
                description: { type: 'string', description: 'New routine description' },
                instructions: { type: 'string', description: 'New instructions injected into system prompt' },
                parameters: {
                  type: 'array',
                  description: 'Replace the full parameters array',
                  items: {
                    type: 'object',
                    properties: {
                      name: { type: 'string' },
                      description: { type: 'string' },
                      required: { type: 'boolean' },
                      default: {},
                    },
                    required: ['name', 'description'],
                  },
                },
                tasks: {
                  type: 'array',
                  description:
                    'Replace the full tasks array. The merged routine is re-validated before saving — cycles, missing dependencies, or unreferenced task names will reject the update. ' +
                    'Each task supports the same shape as in generate_routine: name, description, dependsOn, suggestedTools, expectedOutput, maxAttempts, condition, controlFlow, validation, execution, metadata. ' +
                    'For changes to a single existing task by name, prefer routine_update_task.',
                  items: {
                    type: 'object',
                    properties: {
                      name: { type: 'string', description: 'Unique task name (used in dependsOn references)' },
                      description: { type: 'string', description: 'What this task should accomplish' },
                      dependsOn: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Task names that must complete first',
                      },
                      suggestedTools: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Preferred tool names for this task',
                      },
                      expectedOutput: { type: 'string', description: 'Description of expected task output' },
                      maxAttempts: { type: 'number', description: 'Max retries on failure (default: 3)' },
                      condition: {
                        type: 'object',
                        description: 'Conditional execution based on memory state',
                        properties: {
                          memoryKey: { type: 'string' },
                          operator: {
                            type: 'string',
                            enum: ['exists', 'not_exists', 'equals', 'contains', 'truthy', 'greater_than', 'less_than'],
                          },
                          value: {},
                          onFalse: { type: 'string', enum: ['skip', 'fail', 'wait'] },
                        },
                        required: ['memoryKey', 'operator', 'onFalse'],
                      },
                      controlFlow: {
                        type: 'object',
                        description:
                          'Control flow for iteration. Per-type required fields:\n' +
                          '- map: type, source, tasks\n' +
                          '- fold: type, source, tasks, initialValue, resultKey (BOTH required — no defaults)\n' +
                          '- until: type, tasks, condition (maxIterations optional, defaults to 1)',
                        properties: {
                          type: { type: 'string', enum: ['map', 'fold', 'until'] },
                          source: {},
                          tasks: { type: 'array', items: { type: 'object' } },
                          resultKey: { type: 'string' },
                          initialValue: {},
                          condition: { type: 'object' },
                          maxIterations: { type: 'number' },
                          iterationKey: { type: 'string' },
                          iterationTimeoutMs: { type: 'number' },
                        },
                        required: ['type', 'tasks'],
                      },
                      validation: {
                        type: 'object',
                        properties: {
                          skipReflection: { type: 'boolean' },
                          completionCriteria: { type: 'array', items: { type: 'string' } },
                          minCompletionScore: { type: 'number' },
                          requiredMemoryKeys: { type: 'array', items: { type: 'string' } },
                          mode: { type: 'string', enum: ['strict', 'warn'] },
                          requireUserApproval: { type: 'string', enum: ['never', 'uncertain', 'always'] },
                          customValidator: { type: 'string' },
                        },
                      },
                      execution: {
                        type: 'object',
                        properties: {
                          parallel: { type: 'boolean' },
                          maxConcurrency: { type: 'number' },
                          priority: { type: 'number' },
                          maxIterations: { type: 'number' },
                        },
                      },
                      metadata: { type: 'object' },
                    },
                    required: ['name', 'description'],
                  },
                },
                preSteps: {
                  type: 'array',
                  description: 'Replace the full preSteps array (deterministic tool calls before tasks)',
                  items: {
                    type: 'object',
                    properties: {
                      name: { type: 'string', description: 'Step name' },
                      toolName: { type: 'string', description: 'Tool to invoke' },
                      args: { type: 'object', description: 'Arguments (supports {{param.NAME}} templates)' },
                      resultKey: { type: 'string', description: 'ICM key for result' },
                      onError: { type: 'string', enum: ['fail', 'continue', 'skip-remaining'] },
                      timeoutMs: { type: 'number' },
                    },
                    required: ['name', 'toolName', 'args'],
                  },
                },
                postSteps: {
                  type: 'array',
                  description: 'Replace the full postSteps array (deterministic tool calls after tasks)',
                  items: {
                    type: 'object',
                    properties: {
                      name: { type: 'string', description: 'Step name' },
                      toolName: { type: 'string', description: 'Tool to invoke' },
                      args: { type: 'object', description: 'Arguments (supports {{param.NAME}}, {{result.TASK}}, {{step.STEP}} templates)' },
                      resultKey: { type: 'string', description: 'ICM key for result' },
                      onError: { type: 'string', enum: ['fail', 'continue', 'skip-remaining'] },
                      timeoutMs: { type: 'number' },
                    },
                    required: ['name', 'toolName', 'args'],
                  },
                },
                postStepsTrigger: {
                  type: 'string',
                  enum: ['on-success', 'always'],
                  description: 'When to run postSteps',
                },
                timeoutMs: {
                  type: 'number',
                  description: 'Max wall-clock time for entire execution in ms (0 = disabled)',
                },
                requiredTools: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Tool names that must be available',
                },
                requiredPlugins: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Plugin names that must be enabled',
                },
                concurrency: {
                  type: 'object',
                  description: 'Concurrency settings',
                  properties: {
                    maxParallelTasks: { type: 'number' },
                    strategy: { type: 'string', enum: ['fifo', 'priority', 'shortest-first'] },
                    failureMode: { type: 'string', enum: ['fail-fast', 'continue', 'fail-all'] },
                  },
                  required: ['maxParallelTasks', 'strategy'],
                },
                allowDynamicTasks: { type: 'boolean', description: 'Allow LLM to add/modify tasks at runtime' },
                tags: { type: 'array', items: { type: 'string' }, description: 'Tags for categorization' },
                metadata: { type: 'object', description: 'Arbitrary metadata' },
              },
            },
          },
          required: ['routineId', 'updates'],
        },
      },
    },

    permission: { scope: 'session' as const, riskLevel: 'medium' as const },

    execute: async (args: RoutineUpdateArgs, context?: ToolContext) => {
      try {
        const userId = context?.userId;
        const s = resolveRoutineDefinitionStorage(storage, context);

        const routine = await s.load(userId, args.routineId);
        if (!routine) {
          return { success: false, error: `Routine not found: ${args.routineId}` };
        }

        const updatedFields: string[] = [];
        const merged = { ...routine };

        for (const field of UPDATABLE_FIELDS) {
          if (args.updates[field] !== undefined) {
            (merged as Record<string, unknown>)[field] = args.updates[field];
            updatedFields.push(field);
          }
        }

        if (updatedFields.length === 0) {
          return { success: false, error: 'No valid update fields provided' };
        }

        // Re-validate via createRoutineDefinition (checks deps, cycles, etc.)
        const validated = createRoutineDefinition({
          ...merged,
          id: routine.id,
        });

        await s.save(userId, validated);

        return {
          success: true,
          routineId: routine.id,
          routineName: routine.name,
          updatedFields,
        };
      } catch (error) {
        return { success: false, error: (error as Error).message };
      }
    },

    describeCall: (args: RoutineUpdateArgs) =>
      `update routine ${args.routineId}`,
  };
}

/** Default routine_update instance (resolves storage from StorageRegistry at execution time) */
export const routineUpdate = createRoutineUpdate();
