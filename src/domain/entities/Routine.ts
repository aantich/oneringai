/**
 * Routine entities for reusable task-based workflows.
 *
 * A RoutineDefinition is a template (recipe) that can be executed multiple times.
 * A RoutineExecution is a running instance backed by an existing Plan.
 */

import type { TaskInput, Plan, PlanConcurrency } from './Task.js';
import { createPlan, isTerminalStatus } from './Task.js';

// ============================================================================
// Routine Parameters
// ============================================================================

/**
 * A parameter that a routine accepts as input.
 * Enables parameterized, reusable routines.
 */
export interface RoutineParameter {
  /** Parameter name (used as {{param.name}} in templates) */
  name: string;
  /** Human-readable description */
  description: string;
  /** Whether this parameter must be provided (default: false) */
  required?: boolean;
  /** Default value when not provided */
  default?: unknown;
}

// ============================================================================
// Deterministic Steps
// ============================================================================

/**
 * Error handling strategy for deterministic steps.
 * - 'fail': Abort the routine on step failure (default for preSteps)
 * - 'continue': Log the error and continue to next step (default for postSteps)
 * - 'skip-remaining': Stop executing remaining steps but don't fail the routine
 */
export type StepErrorStrategy = 'fail' | 'continue' | 'skip-remaining';

/**
 * A deterministic tool call that runs without LLM involvement.
 *
 * Arguments support template placeholders:
 * - {{param.NAME}} — resolved from routine input parameters
 * - {{result.TASK_NAME}} — resolved from task output (postSteps only)
 * - {{step.STEP_NAME}} — resolved from a previous step's result
 */
export interface DeterministicStep {
  /** Human-readable name for this step (used in recording and logging) */
  name: string;

  /** Tool name to invoke (must be registered on the agent) */
  toolName: string;

  /** Arguments to pass to the tool. Values can contain {{...}} templates. */
  args: Record<string, unknown>;

  /**
   * ICM/WM key where the step result is stored.
   * For preSteps: makes result available to tasks via this key.
   * For postSteps: makes result available to subsequent postSteps.
   * If omitted, result is stored as `__prestep_{name}` or `__poststep_{name}`.
   */
  resultKey?: string;

  /** Error handling strategy. Default: 'fail' for preSteps, 'continue' for postSteps. */
  onError?: StepErrorStrategy;

  /** Timeout in ms for this step. Default: 30000 (30s). */
  timeoutMs?: number;
}

// ============================================================================
// Routine Definition (Template)
// ============================================================================

/**
 * A reusable routine definition (template).
 *
 * Defines what to do but has no runtime state.
 * Multiple RoutineExecutions can be created from one RoutineDefinition.
 */
export interface RoutineDefinition {
  /** Unique routine identifier */
  id: string;

  /** Human-readable name */
  name: string;

  /** Description of what this routine accomplishes */
  description: string;

  /** Version string for tracking routine evolution */
  version?: string;

  /** Task templates in execution order (dependencies may override order) */
  tasks: TaskInput[];

  /** Tool names that must be available before starting */
  requiredTools?: string[];

  /** Plugin names that must be enabled before starting (e.g. 'working_memory') */
  requiredPlugins?: string[];

  /** Additional instructions injected into system prompt when routine is active */
  instructions?: string;

  /** Concurrency settings for task execution */
  concurrency?: PlanConcurrency;

  /** Whether the LLM can dynamically add/modify tasks during execution. Default: false */
  allowDynamicTasks?: boolean;

  /** Input parameters this routine accepts (templates use {{param.name}}) */
  parameters?: RoutineParameter[];

  /** Deterministic steps to execute BEFORE the agent-based task loop.
   *  Results are injected into agent context for use by tasks. */
  preSteps?: DeterministicStep[];

  /** Deterministic steps to execute AFTER the agent-based task loop completes.
   *  Can reference task results via {{result.TASK_NAME}} templates. */
  postSteps?: DeterministicStep[];

  /** When to run postSteps. Default: 'on-success' */
  postStepsTrigger?: 'on-success' | 'always';

  /** Tags for categorization and filtering */
  tags?: string[];

  /** Author/creator */
  author?: string;

  /** When the definition was created (ISO string) */
  createdAt: string;

  /** When the definition was last updated (ISO string) */
  updatedAt: string;

  /** Metadata for extensions */
  metadata?: Record<string, unknown>;
}

/**
 * Input for creating a RoutineDefinition.
 * id, createdAt, updatedAt are auto-generated if not provided.
 */
export interface RoutineDefinitionInput {
  id?: string;
  name: string;
  description: string;
  version?: string;
  tasks: TaskInput[];
  requiredTools?: string[];
  requiredPlugins?: string[];
  instructions?: string;
  concurrency?: PlanConcurrency;
  allowDynamicTasks?: boolean;
  parameters?: RoutineParameter[];
  preSteps?: DeterministicStep[];
  postSteps?: DeterministicStep[];
  postStepsTrigger?: 'on-success' | 'always';
  tags?: string[];
  author?: string;
  metadata?: Record<string, unknown>;
}

// ============================================================================
// Routine Execution (Runtime)
// ============================================================================

/**
 * Execution status for a routine run
 */
export type RoutineExecutionStatus =
  | 'pending'     // Created but not started
  | 'running'     // Currently executing
  | 'paused'      // Manually paused
  | 'completed'   // All tasks completed successfully
  | 'failed'      // Failed (unrecoverable)
  | 'cancelled';  // Manually cancelled

/**
 * Runtime state when executing a routine.
 * Created from a RoutineDefinition, delegates task management to Plan.
 */
export interface RoutineExecution {
  /** Unique execution ID */
  id: string;

  /** Reference to the routine definition ID */
  routineId: string;

  /** The live plan managing task execution (created via createPlan) */
  plan: Plan;

  /** Current execution status */
  status: RoutineExecutionStatus;

  /** Overall progress (0-100) based on completed tasks */
  progress: number;

  /** Timestamps */
  startedAt?: number;
  completedAt?: number;
  lastUpdatedAt: number;

  /** Error message if failed */
  error?: string;

  /** Metadata */
  metadata?: Record<string, unknown>;
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a RoutineDefinition with defaults.
 * Validates task dependency references and detects cycles.
 */
export function createRoutineDefinition(input: RoutineDefinitionInput): RoutineDefinition {
  const now = new Date().toISOString();
  const id = input.id ?? `routine-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  // Validate dependency references exist within the routine's tasks
  const taskNames = new Set(input.tasks.map((t) => t.name));
  const taskIds = new Set(input.tasks.filter((t) => t.id).map((t) => t.id!));

  for (const task of input.tasks) {
    if (task.dependsOn) {
      for (const dep of task.dependsOn) {
        if (!taskNames.has(dep) && !taskIds.has(dep)) {
          throw new Error(
            `Routine "${input.name}": task "${task.name}" depends on unknown task "${dep}"`
          );
        }
      }
    }
  }

  // Cycle detection: create a temporary plan (which runs detectDependencyCycle internally)
  // This validates the dependency graph is a DAG
  createPlan({
    goal: input.name,
    tasks: input.tasks,
  });

  return {
    id,
    name: input.name,
    description: input.description,
    version: input.version,
    tasks: input.tasks,
    requiredTools: input.requiredTools,
    requiredPlugins: input.requiredPlugins,
    instructions: input.instructions,
    concurrency: input.concurrency,
    allowDynamicTasks: input.allowDynamicTasks ?? false,
    parameters: input.parameters,
    preSteps: input.preSteps,
    postSteps: input.postSteps,
    postStepsTrigger: input.postStepsTrigger,
    tags: input.tags,
    author: input.author,
    createdAt: now,
    updatedAt: now,
    metadata: input.metadata,
  };
}

/**
 * Create a RoutineExecution from a RoutineDefinition.
 * Instantiates all tasks into a Plan via createPlan().
 */
export function createRoutineExecution(definition: RoutineDefinition): RoutineExecution {
  const now = Date.now();
  const executionId = `rexec-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  const plan = createPlan({
    goal: definition.name,
    context: definition.description,
    tasks: definition.tasks,
    concurrency: definition.concurrency,
    allowDynamicTasks: definition.allowDynamicTasks,
  });

  return {
    id: executionId,
    routineId: definition.id,
    plan,
    status: 'pending',
    progress: 0,
    lastUpdatedAt: now,
  };
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Compute routine progress (0-100) from plan task statuses.
 */
export function getRoutineProgress(execution: RoutineExecution): number {
  const { tasks } = execution.plan;
  if (tasks.length === 0) return 100;

  const completed = tasks.filter((t) => isTerminalStatus(t.status)).length;
  return Math.round((completed / tasks.length) * 100);
}
