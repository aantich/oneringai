/**
 * Routine Control Flow — map, fold, until handlers + template resolution
 *
 * Control flow tasks delegate to executeRoutine() recursively with the shared agent,
 * using ICM keys (__map_item, __map_index, etc.) to pass iteration state.
 */

import type { Agent } from './Agent.js';
import type { Task, TaskInput, SubRoutineSpec, ConditionMemoryAccess, TaskMapFlow, TaskFoldFlow, TaskUntilFlow, ControlFlowSource } from '../domain/entities/Task.js';
import { evaluateCondition } from '../domain/entities/Task.js';
import type { RoutineDefinition, RoutineExecution, RoutineParameter } from '../domain/entities/Routine.js';
import { createRoutineDefinition } from '../domain/entities/Routine.js';
import type { InContextMemoryPluginNextGen } from './context-nextgen/plugins/InContextMemoryPluginNextGen.js';
import type { WorkingMemoryPluginNextGen } from './context-nextgen/plugins/WorkingMemoryPluginNextGen.js';
import { executeRoutine } from './routineRunner.js';
import { logger } from '../infrastructure/observability/Logger.js';

// ============================================================================
// Constants
// ============================================================================

const HARD_MAX_ITERATIONS = 1000;
const ICM_LARGE_THRESHOLD = 5000; // tokens — results above this go to WM

/** Well-known ICM/WM keys used by the routine execution framework. */
export const ROUTINE_KEYS = {
  /** Plan overview with task statuses (ICM) */
  PLAN: '__routine_plan',
  /** Dependency results location guide (ICM) */
  DEPS: '__routine_deps',
  /** Prefix for per-dependency result keys (ICM/WM) */
  DEP_RESULT_PREFIX: '__dep_result_',
  /** Current map/fold item (ICM) */
  MAP_ITEM: '__map_item',
  /** Current map/fold index, 0-based (ICM) */
  MAP_INDEX: '__map_index',
  /** Total items in map/fold (ICM) */
  MAP_TOTAL: '__map_total',
  /** Running fold accumulator (ICM) */
  FOLD_ACCUMULATOR: '__fold_accumulator',
  /** Prefix for large dep results stored in WM findings tier */
  WM_DEP_FINDINGS_PREFIX: 'findings/__dep_result_',
  /** Prefix for auto-stored task outputs (set by output contracts) */
  TASK_OUTPUT_PREFIX: '__task_output_',
  /** Prefix for pre-step results stored in ICM/WM */
  PRE_STEP_PREFIX: '__prestep_',
  /** Prefix for post-step results stored in ICM/WM */
  POST_STEP_PREFIX: '__poststep_',
} as const;

// ============================================================================
// Types
// ============================================================================

export interface ControlFlowResult {
  completed: boolean;
  result?: unknown;
  error?: string;
}

// ============================================================================
// Template Resolution
// ============================================================================

/**
 * Resolve template placeholders in text.
 *
 * Supported namespaces:
 * - {{param.name}} → inputs[name]
 * - {{map.item}} / {{map.index}} / {{map.total}} → ICM keys
 * - {{fold.accumulator}} → ICM key
 *
 * Non-string values are JSON.stringify'd. Unresolved templates are left as-is.
 */
export function resolveTemplates(
  text: string,
  inputs: Record<string, unknown>,
  icmPlugin: InContextMemoryPluginNextGen | null
): string {
  return text.replace(/\{\{(\w+)\.(\w+)\}\}/g, (_match, namespace: string, key: string) => {
    let value: unknown;

    if (namespace === 'param') {
      value = inputs[key];
    } else if (namespace === 'map') {
      const icmKey = `__map_${key}`;
      value = icmPlugin?.get(icmKey);
    } else if (namespace === 'fold') {
      const icmKey = `__fold_${key}`;
      value = icmPlugin?.get(icmKey);
    } else {
      // Unknown namespace — leave as-is
      return _match;
    }

    if (value === undefined) {
      return _match; // Unresolved — leave as-is
    }

    return typeof value === 'string' ? value : JSON.stringify(value);
  });
}

/**
 * Resolve templates in task description, expectedOutput, and controlFlow.source.
 * Returns a shallow copy — original task is NOT mutated.
 */
export function resolveTaskTemplates(
  task: Task,
  inputs: Record<string, unknown>,
  icmPlugin: InContextMemoryPluginNextGen | null
): Task {
  const resolvedDescription = resolveTemplates(task.description, inputs, icmPlugin);
  const resolvedExpectedOutput = task.expectedOutput
    ? resolveTemplates(task.expectedOutput, inputs, icmPlugin)
    : task.expectedOutput;

  // Resolve templates in controlFlow.source
  let resolvedControlFlow = task.controlFlow;
  if (task.controlFlow && 'source' in task.controlFlow) {
    const flow = task.controlFlow as TaskMapFlow | TaskFoldFlow;
    const source = flow.source;

    if (typeof source === 'string') {
      const r = resolveTemplates(source, inputs, icmPlugin);
      if (r !== source) {
        resolvedControlFlow = { ...flow, source: r };
      }
    } else if (source) {
      let changed = false;
      const resolved = { ...source };

      if (resolved.task) {
        const r = resolveTemplates(resolved.task, inputs, icmPlugin);
        if (r !== resolved.task) { resolved.task = r; changed = true; }
      }
      if (resolved.key) {
        const r = resolveTemplates(resolved.key, inputs, icmPlugin);
        if (r !== resolved.key) { resolved.key = r; changed = true; }
      }

      if (changed) {
        resolvedControlFlow = { ...flow, source: resolved };
      }
    }
  }

  if (
    resolvedDescription === task.description &&
    resolvedExpectedOutput === task.expectedOutput &&
    resolvedControlFlow === task.controlFlow
  ) {
    return task; // No changes — avoid unnecessary copy
  }

  return {
    ...task,
    description: resolvedDescription,
    expectedOutput: resolvedExpectedOutput,
    controlFlow: resolvedControlFlow,
  };
}

// ============================================================================
// Deterministic Step Argument Resolution
// ============================================================================

/**
 * Context for resolving templates in deterministic step arguments.
 */
export interface StepResolveContext {
  /** Routine input parameters ({{param.NAME}}) */
  inputs: Record<string, unknown>;
  /** Task results map: task name → output ({{result.TASK_NAME}}, post-steps only) */
  taskResults?: Map<string, unknown>;
  /** Prior step results map: step name → output ({{step.STEP_NAME}}) */
  stepResults?: Map<string, unknown>;
}

/**
 * Resolve template placeholders in deterministic step arguments (deep).
 *
 * Walks the argument object recursively. For string values, resolves:
 * - {{param.NAME}} — from inputs
 * - {{result.TASK_NAME}} — from task outputs (post-steps)
 * - {{step.STEP_NAME}} — from prior step results
 *
 * Non-string values pass through unchanged. Unresolved templates are left as-is.
 */
export function resolveStepArgs(
  args: Record<string, unknown>,
  context: StepResolveContext
): Record<string, unknown> {
  function resolveValue(value: unknown): unknown {
    if (typeof value === 'string') {
      return value.replace(
        /\{\{(\w+)\.([^}]+)\}\}/g,
        (_match, namespace: string, key: string) => {
          let resolved: unknown;
          if (namespace === 'param') {
            resolved = context.inputs[key];
          } else if (namespace === 'result') {
            resolved = context.taskResults?.get(key);
          } else if (namespace === 'step') {
            resolved = context.stepResults?.get(key);
          } else {
            return _match;
          }
          if (resolved === undefined) return _match;
          return typeof resolved === 'string' ? resolved : JSON.stringify(resolved);
        }
      );
    }
    if (Array.isArray(value)) return value.map(resolveValue);
    if (value !== null && typeof value === 'object') {
      const obj = value as Record<string, unknown>;
      const resolved: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(obj)) {
        resolved[k] = resolveValue(v);
      }
      return resolved;
    }
    return value;
  }

  const resolved: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    resolved[k] = resolveValue(v);
  }
  return resolved;
}

// ============================================================================
// Parameter Validation
// ============================================================================

/**
 * Validate inputs against parameter definitions and apply defaults.
 * @throws Error if a required parameter is missing
 */
export function validateAndResolveInputs(
  parameters: RoutineParameter[] | undefined,
  inputs: Record<string, unknown> | undefined
): Record<string, unknown> {
  const resolved: Record<string, unknown> = { ...(inputs ?? {}) };

  if (!parameters || parameters.length === 0) {
    return resolved;
  }

  for (const param of parameters) {
    if (resolved[param.name] === undefined) {
      if (param.required) {
        throw new Error(`Missing required parameter: "${param.name}"`);
      }
      if (param.default !== undefined) {
        resolved[param.name] = param.default;
      }
    }
  }

  return resolved;
}

// ============================================================================
// Memory Helpers
// ============================================================================

/**
 * Read a value from ICM first, falling back to WM.
 */
export async function readMemoryValue(
  key: string,
  icmPlugin: InContextMemoryPluginNextGen | null,
  wmPlugin: WorkingMemoryPluginNextGen | null
): Promise<unknown> {
  // Try ICM first
  if (icmPlugin) {
    const icmValue = icmPlugin.get(key);
    if (icmValue !== undefined) return icmValue;
  }

  // Fall back to WM
  if (wmPlugin) {
    const wmValue = await wmPlugin.retrieve(key);
    if (wmValue !== undefined) return wmValue;
  }

  return undefined;
}

/**
 * Store a value in ICM (if small enough) or WM (if large).
 */
export async function storeResult(
  key: string,
  description: string,
  value: unknown,
  icmPlugin: InContextMemoryPluginNextGen | null,
  wmPlugin: WorkingMemoryPluginNextGen | null
): Promise<void> {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  const estimatedTokens = Math.ceil(serialized.length / 4);

  if (estimatedTokens < ICM_LARGE_THRESHOLD && icmPlugin) {
    icmPlugin.set(key, description, value, 'high');
  } else if (wmPlugin) {
    await wmPlugin.store(key, description, serialized, { tier: 'findings' });
  } else if (icmPlugin) {
    // No WM — put in ICM anyway
    icmPlugin.set(key, description, value, 'high');
  }
}

// ============================================================================
// Sub-routine Resolution
// ============================================================================

/**
 * Resolve a SubRoutineSpec into a RoutineDefinition.
 * If it's already a RoutineDefinition, return as-is.
 * If it's TaskInput[], wrap into a minimal RoutineDefinition.
 */
export function resolveSubRoutine(spec: SubRoutineSpec, parentTaskName: string): RoutineDefinition {
  if (!Array.isArray(spec)) {
    // Already a RoutineDefinition
    return spec;
  }

  // It's TaskInput[] — wrap into a RoutineDefinition
  return createRoutineDefinition({
    name: `${parentTaskName} (sub-routine)`,
    description: `Sub-routine of ${parentTaskName}`,
    tasks: spec as TaskInput[],
  });
}

// ============================================================================
// Helpers
// ============================================================================

export function getPlugins(agent: Agent) {
  const icmPlugin = agent.context.getPlugin('in_context_memory') as InContextMemoryPluginNextGen | null;
  const wmPlugin = agent.context.memory as WorkingMemoryPluginNextGen | null;
  return { icmPlugin, wmPlugin };
}

function cleanMapKeys(icmPlugin: InContextMemoryPluginNextGen | null): void {
  if (!icmPlugin) return;
  icmPlugin.delete(ROUTINE_KEYS.MAP_ITEM);
  icmPlugin.delete(ROUTINE_KEYS.MAP_INDEX);
  icmPlugin.delete(ROUTINE_KEYS.MAP_TOTAL);
}

function cleanFoldKeys(icmPlugin: InContextMemoryPluginNextGen | null): void {
  if (!icmPlugin) return;
  cleanMapKeys(icmPlugin);
  icmPlugin.delete(ROUTINE_KEYS.FOLD_ACCUMULATOR);
}

/**
 * Resolve a sub-routine spec and prepare an augmented copy for instruction injection.
 */
function prepareSubRoutine(
  tasks: SubRoutineSpec,
  parentTaskName: string
): { augmented: RoutineDefinition; baseInstructions: string } {
  const subRoutine = resolveSubRoutine(tasks, parentTaskName);
  return {
    augmented: { ...subRoutine },
    baseInstructions: subRoutine.instructions ?? '',
  };
}

/**
 * Get the output from the last completed task in a sub-execution,
 * iterating backwards without copying the array.
 */
function getSubRoutineOutput(execution: RoutineExecution): unknown {
  const tasks = execution.plan.tasks;
  for (let i = tasks.length - 1; i >= 0; i--) {
    if (tasks[i]!.status === 'completed') {
      return tasks[i]!.result?.output ?? null;
    }
  }
  return null;
}

/**
 * Set ICM iteration keys (__map_item, __map_index, __map_total) for map/fold loops.
 */
function setIterationKeys(
  icmPlugin: InContextMemoryPluginNextGen | null,
  item: unknown,
  index: number,
  total: number,
  label: string
): void {
  if (!icmPlugin) return;
  icmPlugin.set(ROUTINE_KEYS.MAP_ITEM, `Current ${label} item (${index + 1}/${total})`, item, 'high');
  icmPlugin.set(ROUTINE_KEYS.MAP_INDEX, `Current ${label} index (0-based)`, index, 'high');
  icmPlugin.set(ROUTINE_KEYS.MAP_TOTAL, `Total items in ${label}`, total, 'high');
}

/**
 * Wrap a promise with an optional timeout. Returns the promise result if it resolves
 * before the timeout, otherwise rejects with a descriptive error.
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number | undefined,
  label: string
): Promise<T> {
  if (!timeoutMs) return promise;
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

// ============================================================================
// Source Resolution (Three-Layer)
// ============================================================================

/** Well-known field names that commonly contain array data. */
const COMMON_ARRAY_FIELDS = ['data', 'items', 'results', 'entries', 'list', 'records', 'values', 'elements'] as const;

/**
 * Extract a nested value using dot notation + bracket indexing.
 * E.g., 'data.items', 'results[0].entries', 'response.data'
 * Auto-parses JSON strings before traversing.
 */
function extractByPath(value: unknown, path: string): unknown {
  let current: unknown = value;

  // Auto-parse JSON strings
  if (typeof current === 'string') {
    try { current = JSON.parse(current); } catch { return undefined; }
  }

  const segments = path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
  for (const segment of segments) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/**
 * Attempt to coerce a value to an array without LLM calls:
 * 1. Already an array → return as-is
 * 2. JSON string → parse, check if array or object with array field
 * 3. Object → check common array field names (data, items, results, ...)
 * Returns the original value unchanged if no coercion succeeds.
 */
function tryCoerceToArray(value: unknown): unknown {
  if (value === undefined || value === null) return value;
  if (Array.isArray(value)) return value;

  // JSON string → parse
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
      // Parsed to non-array object — fall through to object check
      if (typeof parsed === 'object' && parsed !== null) {
        value = parsed;
      } else {
        return value; // primitive — can't coerce
      }
    } catch {
      return value; // not JSON — will go to LLM fallback
    }
  }

  // Object → check common array fields
  if (typeof value === 'object' && value !== null) {
    for (const field of COMMON_ARRAY_FIELDS) {
      const candidate = (value as Record<string, unknown>)[field];
      if (Array.isArray(candidate)) return candidate;
    }
  }

  return value; // not coercible algorithmically
}

/**
 * Last-resort LLM extraction: ask the agent to extract a JSON array from raw data.
 * Uses runDirect() to avoid polluting the agent's conversation history.
 * Truncates input to 8000 chars to keep the extraction call fast and cheap.
 */
async function llmExtractArray(agent: Agent, rawValue: unknown): Promise<unknown[]> {
  const serialized = typeof rawValue === 'string' ? rawValue : JSON.stringify(rawValue);
  const truncated = serialized.length > 8000
    ? serialized.slice(0, 8000) + '\n...(truncated)'
    : serialized;

  const response = await agent.runDirect(
    [
      'Extract a JSON array from the data below for iteration.',
      'Return ONLY a valid JSON array. No explanation, no markdown fences, no extra text.',
      'If the data contains a list in any format (JSON, markdown, numbered list, comma-separated), convert it to a JSON array of items.',
      '',
      'Data:',
      truncated,
    ].join('\n'),
    { temperature: 0, maxOutputTokens: 4096 }
  );

  const text = response.output_text?.trim() ?? '';

  // Strip markdown code fences if present (LLMs often wrap in ```json)
  const cleaned = text
    .replace(/^```(?:json|JSON)?\s*\n?/, '')
    .replace(/\n?\s*```$/, '')
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (parseErr) {
    throw new Error(`LLM returned invalid JSON: ${(parseErr as Error).message}. Raw: "${text.slice(0, 200)}"`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error(`LLM extraction produced ${typeof parsed}, expected array`);
  }

  return parsed;
}

/**
 * Resolve the source array for a map/fold control flow using layered resolution:
 * 1. Determine lookup key(s) from source config
 * 2. Read from ICM/WM with fallback chain
 * 3. Apply JSON path extraction if specified
 * 4. Coerce to array algorithmically (JSON parse, common field names)
 * 5. LLM extraction fallback if still not an array
 */
export async function resolveFlowSource(
  flow: { source: ControlFlowSource; maxIterations?: number },
  flowType: string,
  agent: Agent,
  execution: RoutineExecution | undefined,
  icmPlugin: InContextMemoryPluginNextGen | null,
  wmPlugin: WorkingMemoryPluginNextGen | null
): Promise<{ array: unknown[]; maxIter: number } | ControlFlowResult> {
  const log = logger.child({ fn: 'resolveFlowSource', flowType });

  // ── Phase 1: Build ordered lookup chain ──
  const source = flow.source;
  const lookups: Array<{ key: string; path?: string; label: string }> = [];

  if (typeof source === 'string') {
    // Simple key string: source: 'my_key'
    lookups.push({ key: source, label: `key "${source}"` });
  } else if (source.task) {
    // Task reference: source: { task: 'Research' }
    // Primary: output contract key (__task_output_Research)
    lookups.push({
      key: `${ROUTINE_KEYS.TASK_OUTPUT_PREFIX}${source.task}`,
      path: source.path,
      label: `task output "${source.task}"`,
    });
    // Fallback: dep_result key (injected by injectRoutineContext)
    if (execution) {
      const depTask = execution.plan.tasks.find(t => t.name === source.task);
      if (depTask) {
        lookups.push({
          key: `${ROUTINE_KEYS.DEP_RESULT_PREFIX}${depTask.id}`,
          path: source.path,
          label: `dep result "${source.task}"`,
        });
      }
    }
  } else if (source.key) {
    // Direct key with optional path: source: { key: 'data', path: 'items' }
    lookups.push({ key: source.key, path: source.path, label: `key "${source.key}"` });
  }

  if (lookups.length === 0) {
    return { completed: false, error: `${flowType}: source has no task, key, or string value` };
  }

  // ── Phase 2: Try each lookup in order ──
  let rawValue: unknown;
  let resolvedVia: string | undefined;

  for (const { key, path, label } of lookups) {
    const value = await readMemoryValue(key, icmPlugin, wmPlugin);
    if (value !== undefined) {
      rawValue = path ? extractByPath(value, path) : value;
      resolvedVia = label;
      break;
    }
  }

  if (rawValue === undefined) {
    const tried = lookups.map(l => l.label).join(', ');
    return { completed: false, error: `${flowType}: source not found (tried: ${tried})` };
  }

  log.debug({ resolvedVia }, 'Source value found');

  // ── Phase 3: Coerce to array (algorithmic, zero-cost) ──
  let value = tryCoerceToArray(rawValue);

  // ── Phase 4: LLM extraction fallback ──
  if (!Array.isArray(value)) {
    log.info({ resolvedVia, valueType: typeof value }, 'Source not an array, attempting LLM extraction');
    try {
      value = await llmExtractArray(agent, rawValue);
      log.info({ extractedLength: (value as unknown[]).length }, 'LLM extraction succeeded');
    } catch (err) {
      return {
        completed: false,
        error: `${flowType}: source value is not an array and LLM extraction failed: ${(err as Error).message}`,
      };
    }
  }

  const arr = value as unknown[];
  if (arr.length === 0) {
    log.warn('Source array is empty');
  }

  const maxIter = Math.min(arr.length, flow.maxIterations ?? arr.length, HARD_MAX_ITERATIONS);
  return { array: arr, maxIter };
}

// ============================================================================
// Control Flow Handlers
// ============================================================================

/**
 * Handle map control flow: iterate array, run sub-routine per element.
 */
async function handleMap(
  agent: Agent,
  flow: TaskMapFlow,
  task: Task,
  inputs: Record<string, unknown>,
  execution?: RoutineExecution
): Promise<ControlFlowResult> {
  const { icmPlugin, wmPlugin } = getPlugins(agent);
  const log = logger.child({ controlFlow: 'map', task: task.name });

  // 1. Resolve source array via layered resolution
  const sourceResult = await resolveFlowSource(flow, 'Map', agent, execution, icmPlugin, wmPlugin);
  if ('completed' in sourceResult) return sourceResult;
  const { array, maxIter } = sourceResult;
  const results: unknown[] = [];

  // 2. Resolve sub-routine
  const { augmented, baseInstructions } = prepareSubRoutine(flow.tasks, task.name);

  log.info({ arrayLength: array.length, maxIterations: maxIter }, 'Starting map iteration');

  try {
    for (let i = 0; i < maxIter; i++) {
      setIterationKeys(icmPlugin, array[i], i, array.length, 'map');

      // Inject iteration-specific instructions
      augmented.instructions = [
        `You are processing item ${i + 1} of ${array.length} in a map operation.`,
        'The current item is available in your live context as __map_item.',
        'Current index (0-based) is in __map_index, total count in __map_total.',
        '',
        baseInstructions,
      ].join('\n');

      // Execute sub-routine recursively (with optional per-iteration timeout)
      const subExecution = await withTimeout(
        executeRoutine({ definition: augmented, agent, inputs }),
        flow.iterationTimeoutMs,
        `Map iteration ${i}`
      );

      if (subExecution.status !== 'completed') {
        return {
          completed: false,
          error: `Map iteration ${i} failed: ${subExecution.error ?? 'sub-routine failed'}`,
        };
      }

      results.push(getSubRoutineOutput(subExecution));
    }
  } finally {
    cleanMapKeys(icmPlugin);
  }

  // Store results if resultKey specified
  if (flow.resultKey) {
    await storeResult(flow.resultKey, `Map results from "${task.name}"`, results, icmPlugin, wmPlugin);
  }

  log.info({ resultCount: results.length }, 'Map completed');
  return { completed: true, result: results };
}

/**
 * Handle fold control flow: accumulate across array elements.
 */
async function handleFold(
  agent: Agent,
  flow: TaskFoldFlow,
  task: Task,
  inputs: Record<string, unknown>,
  execution?: RoutineExecution
): Promise<ControlFlowResult> {
  const { icmPlugin, wmPlugin } = getPlugins(agent);
  const log = logger.child({ controlFlow: 'fold', task: task.name });

  // 1. Resolve source array via layered resolution
  const sourceResult = await resolveFlowSource(flow, 'Fold', agent, execution, icmPlugin, wmPlugin);
  if ('completed' in sourceResult) return sourceResult;
  const { array, maxIter } = sourceResult;
  let accumulator: unknown = flow.initialValue;

  // 2. Resolve sub-routine
  const { augmented, baseInstructions } = prepareSubRoutine(flow.tasks, task.name);

  log.info({ arrayLength: array.length, maxIterations: maxIter }, 'Starting fold iteration');

  try {
    for (let i = 0; i < maxIter; i++) {
      setIterationKeys(icmPlugin, array[i], i, array.length, 'fold');
      if (icmPlugin) {
        icmPlugin.set(ROUTINE_KEYS.FOLD_ACCUMULATOR, 'Running accumulator — update via context_set', accumulator, 'high');
      }

      // Inject iteration-specific instructions
      augmented.instructions = [
        `You are processing item ${i + 1} of ${array.length} in a fold/accumulate operation.`,
        'The current item is in __map_item. The running accumulator is in __fold_accumulator.',
        'After processing, use context_set to update __fold_accumulator with the new accumulated value.',
        'Your final text response will also be captured as the result.',
        '',
        baseInstructions,
      ].join('\n');

      // Execute sub-routine (with optional per-iteration timeout)
      const subExecution = await withTimeout(
        executeRoutine({ definition: augmented, agent, inputs }),
        flow.iterationTimeoutMs,
        `Fold iteration ${i}`
      );

      if (subExecution.status !== 'completed') {
        return {
          completed: false,
          error: `Fold iteration ${i} failed: ${subExecution.error ?? 'sub-routine failed'}`,
        };
      }

      // Read new accumulator: try sub-execution's last task output first.
      // getSubRoutineOutput() returns null when no completed task exists —
      // any other value (including '', undefined, 0, false) is a valid accumulator.
      const taskOutput = getSubRoutineOutput(subExecution);

      if (taskOutput !== null) {
        accumulator = taskOutput;
      } else if (icmPlugin) {
        // Fallback: LLM may have updated via context_set
        const icmAccumulator = icmPlugin.get(ROUTINE_KEYS.FOLD_ACCUMULATOR);
        if (icmAccumulator !== undefined) {
          accumulator = icmAccumulator;
        }
      }
    }
  } finally {
    cleanFoldKeys(icmPlugin);
  }

  // Store final accumulator
  await storeResult(flow.resultKey, `Fold result from "${task.name}"`, accumulator, icmPlugin, wmPlugin);

  log.info('Fold completed');
  return { completed: true, result: accumulator };
}

/**
 * Handle until control flow: repeat until condition is met.
 */
async function handleUntil(
  agent: Agent,
  flow: TaskUntilFlow,
  task: Task,
  inputs: Record<string, unknown>
): Promise<ControlFlowResult> {
  const { icmPlugin, wmPlugin } = getPlugins(agent);
  const log = logger.child({ controlFlow: 'until', task: task.name });

  // Resolve sub-routine
  const { augmented, baseInstructions } = prepareSubRoutine(flow.tasks, task.name);

  log.info({ maxIterations: flow.maxIterations }, 'Starting until loop');

  // Build ConditionMemoryAccess adapter from readMemoryValue
  const memoryAccess: ConditionMemoryAccess = {
    get: (key: string) => readMemoryValue(key, icmPlugin, wmPlugin),
  };

  try {
    for (let i = 0; i < flow.maxIterations; i++) {
      // Set iteration key if configured
      if (flow.iterationKey && icmPlugin) {
        icmPlugin.set(flow.iterationKey, 'Current iteration index', i, 'high');
      }

      // Inject iteration-specific instructions
      augmented.instructions = [
        `You are in iteration ${i + 1} of a repeating operation (max ${flow.maxIterations}).`,
        'Complete the task. The loop will continue until its exit condition is met.',
        '',
        baseInstructions,
      ].join('\n');

      // Execute sub-routine (with optional per-iteration timeout)
      const subExecution = await withTimeout(
        executeRoutine({ definition: augmented, agent, inputs }),
        flow.iterationTimeoutMs,
        `Until iteration ${i}`
      );

      if (subExecution.status !== 'completed') {
        return {
          completed: false,
          error: `Until iteration ${i} failed: ${subExecution.error ?? 'sub-routine failed'}`,
        };
      }

      // Evaluate condition AFTER iteration
      const conditionMet = await evaluateCondition(flow.condition, memoryAccess);
      if (conditionMet) {
        log.info({ iteration: i + 1 }, 'Until condition met');
        return { completed: true };
      }
    }
  } finally {
    // Clean up iteration key if set
    if (flow.iterationKey && icmPlugin) {
      icmPlugin.delete(flow.iterationKey);
    }
  }

  return { completed: false, error: `Until loop: maxIterations (${flow.maxIterations}) exceeded` };
}

// ============================================================================
// Dispatcher
// ============================================================================

/**
 * Execute a control flow task. Dispatches to the appropriate handler.
 */
export async function executeControlFlow(
  agent: Agent,
  task: Task,
  inputs: Record<string, unknown>,
  execution?: RoutineExecution
): Promise<ControlFlowResult> {
  const flow = task.controlFlow!;

  switch (flow.type) {
    case 'map':
      return handleMap(agent, flow, task, inputs, execution);
    case 'fold':
      return handleFold(agent, flow, task, inputs, execution);
    case 'until':
      return handleUntil(agent, flow, task, inputs);
    default:
      return { completed: false, error: `Unknown control flow type: ${(flow as any).type}` };
  }
}
