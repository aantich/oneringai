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
import type { PlanConcurrency } from '../../domain/entities/Task.js';
import { resolveRoutineDefinitionStorage } from './resolveStorage.js';

interface RoutineUpdates {
  description?: string;
  instructions?: string;
  parameters?: RoutineParameter[];
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
          'Update routine-level fields on an existing routine definition. For task-level updates use routine_update_task. Validates the updated routine before saving.',
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
