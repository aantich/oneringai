/**
 * generate_routine - Generates and persists a complete RoutineDefinition from LLM output.
 */

import type { ToolFunction } from '../../domain/entities/Tool.js';
import type { ToolContext } from '../../domain/interfaces/IToolContext.js';
import type { IRoutineDefinitionStorage } from '../../domain/interfaces/IRoutineDefinitionStorage.js';
import type { RoutineDefinitionInput } from '../../domain/entities/Routine.js';
import { createRoutineDefinition } from '../../domain/entities/Routine.js';
import { resolveRoutineDefinitionStorage } from './resolveStorage.js';

interface GenerateRoutineArgs {
  definition: RoutineDefinitionInput;
}

interface GenerateRoutineResult {
  success: boolean;
  id?: string;
  name?: string;
  storagePath?: string;
  error?: string;
}

const TOOL_DESCRIPTION = `Generate and save a complete routine definition to persistent storage. A routine is a reusable, parameterized workflow template composed of tasks with dependencies, control flow, and validation.

## Routine Structure

A routine definition has these fields:
- **name** (required): Human-readable name (e.g., "Research and Summarize Topic")
- **description** (required): What this routine accomplishes
- **version**: Semver string for tracking evolution (e.g., "1.0.0")
- **author**: Creator name or identifier
- **tags**: Array of strings for categorization and filtering (e.g., ["research", "analysis"])
- **instructions**: Additional text injected into the agent's system prompt when executing this routine. Use for behavioral guidance, tone, constraints.
- **parameters**: Array of input parameters that make the routine reusable. Each has: name, description, required (default false), default. Use {{param.NAME}} in task descriptions/expectedOutput to reference them.
- **requiredTools**: Tool names that must be available before starting (e.g., ["web_fetch", "store_set"])
- **requiredPlugins**: Plugin names that must be enabled (e.g., ["working_memory"])
- **concurrency**: { maxParallelTasks: number, strategy: "fifo"|"priority"|"shortest-first", failureMode?: "fail-fast"|"continue"|"fail-all" }
- **allowDynamicTasks**: If true, the LLM can add/modify tasks during execution (default: false)
- **tasks** (required): Array of TaskInput objects defining the workflow steps

## Task Structure

Each task in the tasks array has:
- **name** (required): Unique name within the routine (used for dependency references)
- **description** (required): What this task should accomplish — the agent uses this as its goal
- **dependsOn**: Array of task names that must complete before this task starts (e.g., ["Gather Data", "Validate Input"])
- **suggestedTools**: Tool names the agent should prefer for this task (advisory, not enforced)
- **expectedOutput**: Description of what the task should produce — helps the agent know when it's done
- **maxAttempts**: Max retry count on failure (default: 3)
- **condition**: Execute only if a condition is met (see Conditions below)
- **controlFlow**: Map, fold, or until loop (see Control Flow below)
- **validation**: Completion validation settings (see Validation below)
- **execution**: { parallel?: boolean, maxConcurrency?: number, priority?: number, maxIterations?: number }
- **metadata**: Arbitrary key-value pairs for extensions

## Control Flow Types

Tasks can have a controlFlow field for iteration patterns:

### map — Iterate over an array, run sub-tasks per element
\`\`\`json
{
  "type": "map",
  "source": { "task": "Fetch Items" },
  "tasks": [
    { "name": "Process Item", "description": "Process {{map.item}} ({{map.index}}/{{map.total}})" }
  ],
  "resultKey": "processed_items",
  "maxIterations": 100,
  "iterationTimeoutMs": 30000
}
\`\`\`

### fold — Accumulate a result across array elements
\`\`\`json
{
  "type": "fold",
  "source": { "key": "data_points", "path": "results" },
  "tasks": [
    { "name": "Merge Entry", "description": "Merge {{map.item}} into {{fold.accumulator}}" }
  ],
  "initialValue": "",
  "resultKey": "merged_result",
  "maxIterations": 50
}
\`\`\`

### until — Loop until a condition is met
\`\`\`json
{
  "type": "until",
  "tasks": [
    { "name": "Refine Draft", "description": "Improve the current draft based on feedback" }
  ],
  "condition": { "memoryKey": "quality_score", "operator": "greater_than", "value": 80, "onFalse": "skip" },
  "maxIterations": 5,
  "iterationKey": "refinement_round"
}
\`\`\`

### Source field
The \`source\` field in map/fold can be:
- A string: direct memory key lookup (e.g., "my_items")
- \`{ task: "TaskName" }\`: resolves the output of a completed dependency task
- \`{ key: "memoryKey" }\`: direct memory key lookup
- \`{ key: "memoryKey", path: "data.items" }\`: memory key with JSON path extraction

### Sub-routine tasks
Tasks inside controlFlow.tasks have the same shape as regular tasks (name, description, dependsOn, suggestedTools, etc.) but execute within the control flow context.

## Template Placeholders

Use these in task descriptions and expectedOutput:
- \`{{param.NAME}}\` — routine parameter value
- \`{{map.item}}\` — current element in map/fold iteration
- \`{{map.index}}\` — current 0-based iteration index
- \`{{map.total}}\` — total number of elements
- \`{{fold.accumulator}}\` — current accumulated value in fold

## Task Conditions

Execute a task conditionally based on memory state:
\`\`\`json
{
  "memoryKey": "user_preference",
  "operator": "equals",
  "value": "detailed",
  "onFalse": "skip"
}
\`\`\`

Operators: "exists", "not_exists", "equals", "contains", "truthy", "greater_than", "less_than"
onFalse actions: "skip" (mark skipped), "fail" (mark failed), "wait" (block until condition met)

## Validation

Enable completion validation to verify task quality:
\`\`\`json
{
  "skipReflection": false,
  "completionCriteria": [
    "Response contains at least 3 specific examples",
    "All requested sections are present"
  ],
  "minCompletionScore": 80,
  "requiredMemoryKeys": ["result_data"],
  "mode": "strict"
}
\`\`\`

By default, skipReflection is true (validation auto-passes). Set to false and provide completionCriteria to enable LLM self-reflection validation.

## Best Practices

1. **Task naming**: Use clear, action-oriented names (e.g., "Research Topic", "Generate Summary"). Names are used in dependsOn references.
2. **Dependency chaining**: Build pipelines by having each task depend on the previous one. Independent tasks can run in parallel.
3. **Control flow vs sequential**: Use map/fold when iterating over dynamic data. Use sequential tasks for fixed multi-step workflows.
4. **Parameters**: Define parameters for any value that should vary between executions. Always provide a description.
5. **Instructions**: Use the instructions field for behavioral guidance that applies to all tasks in the routine.
6. **Keep tasks focused**: Each task should have a single clear goal. Break complex work into multiple dependent tasks.
7. **Expected output**: Always specify expectedOutput — it helps the agent know when it's done and what format to produce.`;

export function createGenerateRoutine(storage?: IRoutineDefinitionStorage): ToolFunction<GenerateRoutineArgs, GenerateRoutineResult> {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'generate_routine',
        description: TOOL_DESCRIPTION,
        parameters: {
          type: 'object',
          properties: {
            definition: {
              type: 'object',
              description: 'Complete routine definition input',
              properties: {
                name: { type: 'string', description: 'Human-readable routine name' },
                description: { type: 'string', description: 'What this routine accomplishes' },
                version: { type: 'string', description: 'Semver version string (e.g., "1.0.0")' },
                author: { type: 'string', description: 'Creator name or identifier' },
                tags: { type: 'array', items: { type: 'string' }, description: 'Tags for categorization' },
                instructions: { type: 'string', description: 'Additional instructions injected into system prompt during execution' },
                parameters: {
                  type: 'array',
                  description: 'Input parameters for reusable routines',
                  items: {
                    type: 'object',
                    properties: {
                      name: { type: 'string', description: 'Parameter name (referenced as {{param.name}})' },
                      description: { type: 'string', description: 'Human-readable description' },
                      required: { type: 'boolean', description: 'Whether this parameter must be provided (default: false)' },
                      default: { description: 'Default value when not provided' },
                    },
                    required: ['name', 'description'],
                  },
                },
                requiredTools: { type: 'array', items: { type: 'string' }, description: 'Tool names that must be available' },
                requiredPlugins: { type: 'array', items: { type: 'string' }, description: 'Plugin names that must be enabled' },
                concurrency: {
                  type: 'object',
                  description: 'Concurrency settings for parallel task execution',
                  properties: {
                    maxParallelTasks: { type: 'number', description: 'Maximum tasks running in parallel' },
                    strategy: { type: 'string', enum: ['fifo', 'priority', 'shortest-first'], description: 'Task selection strategy' },
                    failureMode: { type: 'string', enum: ['fail-fast', 'continue', 'fail-all'], description: 'How to handle failures in parallel' },
                  },
                  required: ['maxParallelTasks', 'strategy'],
                },
                allowDynamicTasks: { type: 'boolean', description: 'Allow LLM to add/modify tasks during execution (default: false)' },
                tasks: {
                  type: 'array',
                  description: 'Array of task definitions forming the workflow',
                  items: {
                    type: 'object',
                    properties: {
                      name: { type: 'string', description: 'Unique task name (used in dependsOn references)' },
                      description: { type: 'string', description: 'What this task should accomplish' },
                      dependsOn: { type: 'array', items: { type: 'string' }, description: 'Task names that must complete first' },
                      suggestedTools: { type: 'array', items: { type: 'string' }, description: 'Preferred tool names for this task' },
                      expectedOutput: { type: 'string', description: 'Description of expected task output' },
                      maxAttempts: { type: 'number', description: 'Max retries on failure (default: 3)' },
                      condition: {
                        type: 'object',
                        description: 'Conditional execution based on memory state',
                        properties: {
                          memoryKey: { type: 'string', description: 'Memory key to check' },
                          operator: { type: 'string', enum: ['exists', 'not_exists', 'equals', 'contains', 'truthy', 'greater_than', 'less_than'] },
                          value: { description: 'Value to compare against' },
                          onFalse: { type: 'string', enum: ['skip', 'fail', 'wait'], description: 'Action when condition is false' },
                        },
                        required: ['memoryKey', 'operator', 'onFalse'],
                      },
                      controlFlow: {
                        type: 'object',
                        description: 'Control flow for iteration (map, fold, or until)',
                        properties: {
                          type: { type: 'string', enum: ['map', 'fold', 'until'], description: 'Control flow type' },
                          source: { description: 'Source data: string key, { task: "name" }, { key: "key" }, or { key: "key", path: "json.path" }' },
                          tasks: { type: 'array', description: 'Sub-routine tasks to execute per iteration', items: { type: 'object' } },
                          resultKey: { type: 'string', description: 'Memory key for collected results' },
                          initialValue: { description: 'Starting accumulator value (fold only)' },
                          condition: { type: 'object', description: 'Exit condition (until only)' },
                          maxIterations: { type: 'number', description: 'Cap on iterations' },
                          iterationKey: { type: 'string', description: 'Memory key for iteration index (until only)' },
                          iterationTimeoutMs: { type: 'number', description: 'Timeout per iteration in ms' },
                        },
                        required: ['type', 'tasks'],
                      },
                      validation: {
                        type: 'object',
                        description: 'Completion validation settings',
                        properties: {
                          skipReflection: { type: 'boolean', description: 'Set to false to enable LLM self-reflection validation' },
                          completionCriteria: { type: 'array', items: { type: 'string' }, description: 'Natural language criteria for completion' },
                          minCompletionScore: { type: 'number', description: 'Minimum score (0-100) to pass (default: 80)' },
                          requiredMemoryKeys: { type: 'array', items: { type: 'string' }, description: 'Memory keys that must exist after completion' },
                          mode: { type: 'string', enum: ['strict', 'warn'], description: 'Validation failure mode (default: strict)' },
                          requireUserApproval: { type: 'string', enum: ['never', 'uncertain', 'always'], description: 'When to ask user for approval' },
                          customValidator: { type: 'string', description: 'Custom validation hook name' },
                        },
                      },
                      execution: {
                        type: 'object',
                        description: 'Execution settings',
                        properties: {
                          parallel: { type: 'boolean', description: 'Can run in parallel with other parallel tasks' },
                          maxConcurrency: { type: 'number', description: 'Max concurrent sub-work' },
                          priority: { type: 'number', description: 'Higher = executed first' },
                          maxIterations: { type: 'number', description: 'Max LLM iterations per task (default: 50)' },
                        },
                      },
                      metadata: { type: 'object', description: 'Arbitrary key-value metadata' },
                    },
                    required: ['name', 'description'],
                  },
                },
                metadata: { type: 'object', description: 'Arbitrary routine-level metadata' },
              },
              required: ['name', 'description', 'tasks'],
            },
          },
          required: ['definition'],
        },
      },
    },

    permission: { scope: 'session' as const, riskLevel: 'medium' as const },

    execute: async (args: GenerateRoutineArgs, context?: ToolContext): Promise<GenerateRoutineResult> => {
      try {
        const userId = context?.userId;
        const s = resolveRoutineDefinitionStorage(storage, context);

        // Validate and create the routine definition (checks deps + cycles)
        const routineDefinition = createRoutineDefinition(args.definition);

        // Persist to storage
        await s.save(userId, routineDefinition);

        return {
          success: true,
          id: routineDefinition.id,
          name: routineDefinition.name,
          storagePath: s.getPath(userId),
        };
      } catch (error) {
        return {
          success: false,
          error: (error as Error).message,
        };
      }
    },

    describeCall: (args: GenerateRoutineArgs) => args.definition?.name ?? 'routine',
  };
}

/** Default generate_routine instance (resolves storage from StorageRegistry at execution time) */
export const generateRoutine = createGenerateRoutine();
