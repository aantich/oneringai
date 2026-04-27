/**
 * Task and Plan entities for TaskAgent
 *
 * Defines the data structures for task-based autonomous agents.
 */

import { DependencyCycleError } from '../errors/AIErrors.js';
import type { RoutineDefinition } from './Routine.js';

/**
 * Task status lifecycle
 */
export type TaskStatus =
  | 'pending'           // Not started
  | 'blocked'           // Dependencies not met
  | 'in_progress'       // Currently executing
  | 'waiting_external'  // Waiting on external event
  | 'completed'         // Successfully finished
  | 'failed'            // Failed after max retries
  | 'skipped'           // Skipped (condition not met)
  | 'cancelled';        // Manually cancelled

/**
 * Terminal statuses - task will not progress further
 */
export const TERMINAL_TASK_STATUSES: TaskStatus[] = ['completed', 'failed', 'skipped', 'cancelled'];

/**
 * Check if a task status is terminal (task will not progress further)
 */
export function isTerminalStatus(status: TaskStatus): boolean {
  return TERMINAL_TASK_STATUSES.includes(status);
}

/**
 * Plan status
 */
export type PlanStatus =
  | 'pending'
  | 'running'
  | 'suspended'
  | 'completed'
  | 'failed'
  | 'cancelled';

/**
 * Condition operators for conditional task execution
 */
export type ConditionOperator =
  | 'exists'
  | 'not_exists'
  | 'equals'
  | 'contains'
  | 'truthy'
  | 'greater_than'
  | 'less_than';

/**
 * Task condition - evaluated before execution
 */
export interface TaskCondition {
  memoryKey: string;
  operator: ConditionOperator;
  value?: unknown;
  onFalse: 'skip' | 'fail' | 'wait';
}

/**
 * External dependency configuration
 */
export interface ExternalDependency {
  type: 'webhook' | 'poll' | 'manual' | 'scheduled';

  /** For webhook: unique ID to match incoming webhook */
  webhookId?: string;

  /** For poll: how to check if complete */
  pollConfig?: {
    toolName: string;
    toolArgs: Record<string, unknown>;
    intervalMs: number;
    maxAttempts: number;
  };

  /** For scheduled: when to resume */
  scheduledAt?: number;

  /** For manual: description of what's needed */
  manualDescription?: string;

  /** Timeout for all types */
  timeoutMs?: number;

  /** Current state */
  state: 'waiting' | 'received' | 'timeout';

  /** Data received from external source */
  receivedData?: unknown;
  receivedAt?: number;
}

// ============================================================================
// Control Flow Types
// ============================================================================

/** Sub-routine specification: either inline tasks or a full RoutineDefinition */
export type SubRoutineSpec = TaskInput[] | RoutineDefinition;

/** Reference to a source value for control flow operations. */
export interface TaskSourceRef {
  /** Reference the output of a named task (resolves to __task_output_{name}) */
  task?: string;
  /** Direct memory key lookup */
  key?: string;
  /** JSON path to extract from the resolved value (e.g., 'data.items', 'results[0].entries') */
  path?: string;
}

/** Source can be a simple key string (legacy) or a structured reference. */
export type ControlFlowSource = string | TaskSourceRef;

/** Map: execute a sub-routine for each element in an array */
export interface TaskMapFlow {
  type: 'map';
  /** Source array reference — task name, memory key, or structured ref. */
  source: ControlFlowSource;
  /** Sub-routine to run per element */
  tasks: SubRoutineSpec;
  /** Memory key for collected results array */
  resultKey?: string;
  /** Cap iterations (default: array.length, hard max: 1000) */
  maxIterations?: number;
  /** Timeout per sub-execution iteration in ms (default: no timeout) */
  iterationTimeoutMs?: number;
}

/** Fold: accumulate a result across array elements */
export interface TaskFoldFlow {
  type: 'fold';
  /** Source array reference — task name, memory key, or structured ref. */
  source: ControlFlowSource;
  /** Sub-routine to run per element */
  tasks: SubRoutineSpec;
  /** Starting accumulator value */
  initialValue: unknown;
  /** Memory key for final accumulated result */
  resultKey: string;
  /** Cap iterations (default: array.length, hard max: 1000) */
  maxIterations?: number;
  /** Timeout per sub-execution iteration in ms (default: no timeout) */
  iterationTimeoutMs?: number;
}

/** Until: repeat a sub-routine until a condition is met */
export interface TaskUntilFlow {
  type: 'until';
  /** Sub-routine to run each iteration */
  tasks: SubRoutineSpec;
  /** Checked AFTER each iteration (reuses existing TaskCondition type) */
  condition: TaskCondition;
  /** Maximum iterations. Default: 1. Hard cap: 1000. */
  maxIterations?: number;
  /** Optional ICM key for current iteration index */
  iterationKey?: string;
  /** Timeout per sub-execution iteration in ms (default: no timeout) */
  iterationTimeoutMs?: number;
}

/** Union of all control flow types */
export type TaskControlFlow = TaskMapFlow | TaskFoldFlow | TaskUntilFlow;

/**
 * Task execution settings
 */
export interface TaskExecution {
  /** Can run in parallel with other parallel tasks */
  parallel?: boolean;

  /** Max concurrent if this spawns sub-work */
  maxConcurrency?: number;

  /** Priority (higher = executed first) */
  priority?: number;

  /**
   * Maximum LLM iterations (tool-call loops) per agent.run() for this task.
   * Prevents runaway agents. Default: 50.
   */
  maxIterations?: number;

  /**
   * If true (default), re-check condition immediately before LLM call
   * to protect against race conditions when parallel tasks modify memory.
   * Set to false to skip re-check for performance if you know condition won't change.
   */
  raceProtection?: boolean;
}

/**
 * Task completion validation settings
 *
 * Used to verify that a task actually achieved its goal before marking it complete.
 * Supports multiple validation approaches:
 * - Programmatic checks (memory keys, hooks)
 * - LLM self-reflection with completeness scoring
 * - Natural language criteria evaluation
 */
export interface TaskValidation {
  /**
   * Natural language completion criteria.
   * These are evaluated by LLM self-reflection to determine if the task is complete.
   * Examples:
   * - "The response contains at least 3 specific examples"
   * - "User's email has been validated and stored in memory"
   * - "All requested data fields are present in the output"
   *
   * This is the RECOMMENDED approach for flexible, intelligent validation.
   */
  completionCriteria?: string[];

  /**
   * Minimum completeness score (0-100) to consider task successful.
   * LLM self-reflection returns a score; if below this threshold:
   * - If requireUserApproval is set, ask user
   * - Otherwise, follow the mode setting (strict = fail, warn = continue)
   * Default: 80
   */
  minCompletionScore?: number;

  /**
   * When to require user approval:
   * - 'never': Never ask user, use automated decision (default)
   * - 'uncertain': Ask user when score is between minCompletionScore and minCompletionScore + 15
   * - 'always': Always ask user to confirm task completion
   */
  requireUserApproval?: 'never' | 'uncertain' | 'always';

  /**
   * Memory keys that must exist after task completion.
   * If the task should store data in memory, list the required keys here.
   * This is a hard requirement checked BEFORE LLM reflection.
   */
  requiredMemoryKeys?: string[];

  /**
   * Custom validation function name (registered via validateTask hook).
   * The hook will be called with this identifier to dispatch to the right validator.
   * Runs AFTER LLM reflection, can override the result.
   */
  customValidator?: string;

  /**
   * Validation mode:
   * - 'strict': Validation failure marks task as failed (default)
   * - 'warn': Validation failure logs warning but task still completes
   */
  mode?: 'strict' | 'warn';

  /**
   * Skip LLM self-reflection validation.
   * LLM validation is opt-in: set to `false` to enable it (requires completionCriteria).
   * Default: undefined (treated as true — validation auto-passes).
   */
  skipReflection?: boolean;
}

/**
 * Result of task validation (returned by LLM reflection)
 */
export interface TaskValidationResult {
  /** Whether the task is considered complete */
  isComplete: boolean;

  /** Completeness score from 0-100 */
  completionScore: number;

  /** LLM's explanation of why the task is/isn't complete */
  explanation: string;

  /** Per-criterion evaluation results */
  criteriaResults?: Array<{
    criterion: string;
    met: boolean;
    evidence?: string;
  }>;

  /** Whether user approval is needed */
  requiresUserApproval: boolean;

  /** Reason for requiring user approval */
  approvalReason?: string;
}

/**
 * A single unit of work
 */
export interface Task {
  id: string;
  name: string;
  description: string;
  status: TaskStatus;

  /** Tasks that must complete before this one (task IDs) */
  dependsOn: string[];

  /** External dependency (if waiting on external event) */
  externalDependency?: ExternalDependency;

  /** Condition for execution */
  condition?: TaskCondition;

  /** Execution settings */
  execution?: TaskExecution;

  /** Completion validation settings */
  validation?: TaskValidation;

  /** Tool names the LLM should prefer for this task (advisory, not enforced) */
  suggestedTools?: string[];

  /** Optional expected output description */
  expectedOutput?: string;

  /** Control flow: map, fold, or until (replaces normal LLM execution for this task) */
  controlFlow?: TaskControlFlow;

  /** Result after completion */
  result?: {
    success: boolean;
    output?: unknown;
    error?: string;
    /** Validation score (0-100) if validation was performed */
    validationScore?: number;
    /** Explanation of validation result */
    validationExplanation?: string;
  };

  /** Timestamps */
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  lastUpdatedAt: number;

  /** Retry tracking */
  attempts: number;
  maxAttempts: number;

  /** Metadata for extensions */
  metadata?: Record<string, unknown>;
}

/**
 * Input for creating a task
 */
export interface TaskInput {
  id?: string;
  name: string;
  description: string;
  dependsOn?: string[];           // Task names or IDs
  externalDependency?: ExternalDependency;
  condition?: TaskCondition;
  execution?: TaskExecution;
  suggestedTools?: string[];
  validation?: TaskValidation;
  expectedOutput?: string;
  controlFlow?: TaskControlFlow;
  maxAttempts?: number;
  metadata?: Record<string, unknown>;
}

/**
 * Plan concurrency settings
 */
export interface PlanConcurrency {
  maxParallelTasks: number;
  strategy: 'fifo' | 'priority' | 'shortest-first';

  /**
   * How to handle failures when executing tasks in parallel
   * - 'fail-fast': Stop on first failure (Promise.all behavior) - DEFAULT
   * - 'continue': Continue other tasks on failure, mark failed ones
   * - 'fail-all': Wait for all to complete, then report all failures together
   */
  failureMode?: 'fail-fast' | 'continue' | 'fail-all';
}

/**
 * Execution plan - a goal with steps to achieve it
 */
export interface Plan {
  id: string;
  goal: string;
  context?: string;

  tasks: Task[];

  /** Concurrency settings */
  concurrency?: PlanConcurrency;

  /** Can agent modify the plan? */
  allowDynamicTasks: boolean;

  /** Plan status */
  status: PlanStatus;

  /** Why is the plan suspended? */
  suspendedReason?: {
    type: 'waiting_external' | 'manual_pause' | 'error';
    taskId?: string;
    message?: string;
  };

  /** Timestamps */
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  lastUpdatedAt: number;

  /** For resume: which task to continue from */
  currentTaskId?: string;

  /** Metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Input for creating a plan
 */
export interface PlanInput {
  goal: string;
  context?: string;
  tasks: TaskInput[];
  concurrency?: PlanConcurrency;
  allowDynamicTasks?: boolean;
  metadata?: Record<string, unknown>;
  /** Skip dependency cycle detection (default: false) */
  skipCycleCheck?: boolean;
}

/**
 * Memory access interface for condition evaluation
 */
export interface ConditionMemoryAccess {
  get(key: string): Promise<unknown>;
}

// ============ Factory Functions ============

/**
 * Create a task with defaults
 */
export function createTask(input: TaskInput): Task {
  const now = Date.now();
  const id = input.id ?? `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  return {
    id,
    name: input.name,
    description: input.description,
    status: 'pending',
    dependsOn: input.dependsOn ?? [],
    externalDependency: input.externalDependency,
    condition: input.condition,
    execution: input.execution,
    suggestedTools: input.suggestedTools,
    validation: input.validation,
    expectedOutput: input.expectedOutput,
    controlFlow: input.controlFlow,
    attempts: 0,
    maxAttempts: input.maxAttempts ?? 3,
    createdAt: now,
    lastUpdatedAt: now,
    metadata: input.metadata,
  };
}

/**
 * Create a plan with tasks
 * @throws {DependencyCycleError} If circular dependencies detected (unless skipCycleCheck is true)
 */
export function createPlan(input: PlanInput): Plan {
  const now = Date.now();
  const id = `plan-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  // Create tasks first
  const tasks = input.tasks.map((taskInput) => createTask(taskInput));

  // Build name to ID map
  const nameToId = new Map<string, string>();
  for (const task of tasks) {
    nameToId.set(task.name, task.id);
  }

  // Resolve dependencies from names to IDs
  for (let i = 0; i < tasks.length; i++) {
    const taskInput = input.tasks[i]!;
    const task = tasks[i]!;

    if (taskInput.dependsOn && taskInput.dependsOn.length > 0) {
      task.dependsOn = taskInput.dependsOn.map((dep) => {
        // Check if it's already an ID (starts with 'task-')
        if (dep.startsWith('task-')) {
          return dep;
        }

        // Otherwise, it's a name - resolve it
        const resolvedId = nameToId.get(dep);
        if (!resolvedId) {
          throw new Error(`Task dependency "${dep}" not found in plan`);
        }
        return resolvedId;
      });
    }
  }

  // Check for dependency cycles (unless explicitly skipped)
  if (!input.skipCycleCheck) {
    const cycle = detectDependencyCycle(tasks);
    if (cycle) {
      // Convert task IDs to names for better error message
      const cycleNames = cycle.map((taskId) => {
        const task = tasks.find((t) => t.id === taskId);
        return task ? task.name : taskId;
      });
      throw new DependencyCycleError(cycleNames, id);
    }
  }

  return {
    id,
    goal: input.goal,
    context: input.context,
    tasks,
    concurrency: input.concurrency,
    allowDynamicTasks: input.allowDynamicTasks ?? true,
    status: 'pending',
    createdAt: now,
    lastUpdatedAt: now,
    metadata: input.metadata,
  };
}

// ============ Task Utilities ============

/**
 * Check if a task can be executed (dependencies met, status is pending)
 */
export function canTaskExecute(task: Task, allTasks: Task[]): boolean {
  // Must be pending
  if (task.status !== 'pending') {
    return false;
  }

  // Check if all dependencies are completed
  if (task.dependsOn.length > 0) {
    for (const depId of task.dependsOn) {
      const depTask = allTasks.find((t) => t.id === depId);
      if (!depTask || depTask.status !== 'completed') {
        return false;
      }
    }
  }

  return true;
}

/**
 * Get the next tasks that can be executed
 */
export function getNextExecutableTasks(plan: Plan): Task[] {
  const executable = plan.tasks.filter((task) => canTaskExecute(task, plan.tasks));

  if (executable.length === 0) {
    return [];
  }

  // If no concurrency config, return sequential (first one only)
  if (!plan.concurrency) {
    return [executable[0]!];
  }

  // Count currently running tasks
  const runningCount = plan.tasks.filter((t) => t.status === 'in_progress').length;
  const availableSlots = plan.concurrency.maxParallelTasks - runningCount;

  if (availableSlots <= 0) {
    return [];
  }

  // Filter for parallel-capable tasks
  const parallelTasks = executable.filter((task) => task.execution?.parallel === true);

  if (parallelTasks.length === 0) {
    // No parallel tasks available, return first sequential task
    return [executable[0]!];
  }

  // Sort by strategy
  let sortedTasks = [...parallelTasks];
  if (plan.concurrency.strategy === 'priority') {
    sortedTasks.sort((a, b) => (b.execution?.priority ?? 0) - (a.execution?.priority ?? 0));
  }
  // 'fifo' and 'shortest-first' use default order (creation order)

  // Return up to availableSlots tasks
  return sortedTasks.slice(0, availableSlots);
}

/**
 * Evaluate a task condition against memory
 */
export async function evaluateCondition(
  condition: TaskCondition,
  memory: ConditionMemoryAccess
): Promise<boolean> {
  const value = await memory.get(condition.memoryKey);

  switch (condition.operator) {
    case 'exists':
      return value !== undefined;

    case 'not_exists':
      return value === undefined;

    case 'equals':
      return value === condition.value;

    case 'contains':
      if (Array.isArray(value)) {
        return value.includes(condition.value);
      }
      if (typeof value === 'string' && typeof condition.value === 'string') {
        return value.includes(condition.value);
      }
      return false;

    case 'truthy':
      return !!value;

    case 'greater_than':
      if (typeof value === 'number' && typeof condition.value === 'number') {
        return value > condition.value;
      }
      return false;

    case 'less_than':
      if (typeof value === 'number' && typeof condition.value === 'number') {
        return value < condition.value;
      }
      return false;

    default:
      return false;
  }
}

/**
 * Update task status and timestamps
 */
export function updateTaskStatus(task: Task, status: TaskStatus): Task {
  const now = Date.now();
  const updated: Task = {
    ...task,
    status,
    lastUpdatedAt: now,
  };

  // Set startedAt when moving to in_progress (first time only)
  // But always increment attempts when moving to in_progress
  if (status === 'in_progress') {
    if (!updated.startedAt) {
      updated.startedAt = now;
    }
    updated.attempts += 1;
  }

  // Set completedAt when moving to completed or failed
  if ((status === 'completed' || status === 'failed') && !updated.completedAt) {
    updated.completedAt = now;
  }

  return updated;
}

/**
 * Check if a task is blocked by dependencies
 */
export function isTaskBlocked(task: Task, allTasks: Task[]): boolean {
  if (task.dependsOn.length === 0) {
    return false;
  }

  for (const depId of task.dependsOn) {
    const depTask = allTasks.find((t) => t.id === depId);
    if (!depTask) {
      return true; // Dependency not found
    }
    if (depTask.status !== 'completed') {
      return true; // Dependency not completed
    }
  }

  return false;
}

/**
 * Get the dependency tasks for a task
 */
export function getTaskDependencies(task: Task, allTasks: Task[]): Task[] {
  if (task.dependsOn.length === 0) {
    return [];
  }

  return task.dependsOn
    .map((depId) => allTasks.find((t) => t.id === depId))
    .filter((t): t is Task => t !== undefined);
}

/**
 * Resolve task name dependencies to task IDs
 * Modifies taskInputs in place
 */
export function resolveDependencies(taskInputs: TaskInput[], tasks: Task[]): void {
  // Build name to ID map
  const nameToId = new Map<string, string>();
  for (const task of tasks) {
    nameToId.set(task.name, task.id);
  }

  // Resolve dependencies
  for (const input of taskInputs) {
    if (input.dependsOn && input.dependsOn.length > 0) {
      input.dependsOn = input.dependsOn.map((dep) => {
        // If it's already an ID, keep it
        if (dep.startsWith('task-')) {
          return dep;
        }

        // Otherwise, resolve name to ID
        const resolvedId = nameToId.get(dep);
        if (!resolvedId) {
          throw new Error(`Task dependency "${dep}" not found`);
        }
        return resolvedId;
      });
    }
  }
}

/**
 * Detect dependency cycles in tasks using depth-first search
 * @param tasks Array of tasks with resolved dependencies (IDs, not names)
 * @returns Array of task IDs forming the cycle (e.g., ['A', 'B', 'C', 'A']), or null if no cycle
 */
export function detectDependencyCycle(tasks: Task[]): string[] | null {
  const visited = new Set<string>();
  const recStack = new Set<string>();
  const taskMap = new Map(tasks.map((t) => [t.id, t]));

  /**
   * DFS to detect back edges (cycles)
   * @param taskId Current task being visited
   * @param path Path from root to current node
   * @returns Cycle path if found, null otherwise
   */
  function dfs(taskId: string, path: string[]): string[] | null {
    // If taskId is in recursion stack, we found a cycle
    if (recStack.has(taskId)) {
      const cycleStart = path.indexOf(taskId);
      return [...path.slice(cycleStart), taskId];
    }

    // If already fully visited, no cycle through this node
    if (visited.has(taskId)) {
      return null;
    }

    // Mark as being visited (in current DFS path)
    visited.add(taskId);
    recStack.add(taskId);

    // Visit all dependencies (edges go from task to its dependencies)
    const task = taskMap.get(taskId);
    if (task) {
      for (const depId of task.dependsOn) {
        const cycle = dfs(depId, [...path, taskId]);
        if (cycle) {
          return cycle;
        }
      }
    }

    // Done with this node, remove from recursion stack
    recStack.delete(taskId);
    return null;
  }

  // Start DFS from each unvisited node
  for (const task of tasks) {
    if (!visited.has(task.id)) {
      const cycle = dfs(task.id, []);
      if (cycle) {
        return cycle;
      }
    }
  }

  return null;
}
