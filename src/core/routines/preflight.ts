import type { Agent } from '../Agent.js';
import { InvalidConfigError } from '../../domain/errors/AIErrors.js';
import { createRoutineExecution, type RoutineDefinition } from '../../domain/entities/Routine.js';
import type { TaskInput } from '../../domain/entities/Task.js';
import { resolveSubRoutine, validateAndResolveInputs } from '../routineControlFlow.js';

const fail = (message: string): never => { throw new InvalidConfigError(`Verified routine: ${message}`); };
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
function integer(value: unknown, name: string, minimum: number, maximum = Number.MAX_SAFE_INTEGER): void {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) fail(`${name} must be an integer between ${minimum} and ${maximum}`);
}

/** JSON definition data is detached; callbacks and live Agent/task handles are not cloned. */
export function copyRoutineDefinition(definition: RoutineDefinition): RoutineDefinition {
  let copied: RoutineDefinition;
  try { copied = JSON.parse(JSON.stringify(definition, (_key, value) => {
    if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint'
      || (typeof value === 'number' && !Number.isFinite(value))) fail('definition must be JSON data');
    return value;
  })); } catch { return fail('definition must be JSON data'); }
  return copied;
}

/** Complete nested static preflight, before a deterministic pre-step or model call. */
export function preflightRoutine(definition: RoutineDefinition, agent: Agent, disableToolScoping = false): void {
  const plugins = new Set(agent.context.getContextToolNames());
  const catalog = agent.context.getPlugin('tool_catalog');
  for (const tool of catalog?.getTools() ?? []) plugins.delete(tool.definition.function.name);
  const all = new Set(agent.tools.listEnabled());
  const visit = (current: RoutineDefinition, parentScope: ReadonlySet<string>, depth: number): void => {
    if (depth > 32) fail('nested definition depth exceeds 32');
    if (!record(current) || typeof current.id !== 'string' || !current.id.trim() || typeof current.name !== 'string' || !current.name.trim() || !Array.isArray(current.tasks)) fail('invalid definition');
    if (current.tasks.length > 1000) fail('one definition supports at most 1000 static tasks');
    if (current.postStepsTrigger !== undefined && !['always', 'on-success'].includes(current.postStepsTrigger)) fail('unsupported postStepsTrigger');
    if (current.allowDynamicTasks !== undefined && current.allowDynamicTasks !== false) fail('dynamic tasks are unsupported');
    if (current.timeoutMs !== undefined) integer(current.timeoutMs, 'timeoutMs', 0, 2_147_483_647);
    if (current.concurrency) {
      if (current.concurrency.maxParallelTasks !== 1 || (current.concurrency.strategy !== undefined && current.concurrency.strategy !== 'fifo')) fail('only sequential FIFO execution is supported');
      if (current.concurrency.failureMode !== undefined && !['fail-fast', 'continue'].includes(current.concurrency.failureMode)) fail('unsupported failureMode');
    }
    for (const name of current.requiredPlugins ?? []) if (!agent.context.hasPlugin(name)) fail(`missing required plugin ${name}`);
    for (const name of current.requiredTools ?? []) {
      if (!all.has(name)) fail(`required tool ${name} is missing or disabled`);
      if (!parentScope.has(name)) fail(`nested required tool ${name} exceeds its parent scope`);
    }
    const scope = !disableToolScoping && current.requiredTools?.length
      ? new Set([...current.requiredTools, ...plugins].filter(name => parentScope.has(name))) : parentScope;
    for (const step of [...(current.preSteps ?? []), ...(current.postSteps ?? [])]) {
      if (!record(step) || typeof step.name !== 'string' || !step.name.trim() || typeof step.toolName !== 'string' || !record(step.args)) fail('invalid deterministic step');
      if (!scope.has(step.toolName)) fail(`step tool ${step.toolName} is unavailable in this scope`);
      if (step.onError !== undefined && !['fail', 'continue', 'skip-remaining'].includes(step.onError)) fail('unsupported step onError');
      if (step.timeoutMs !== undefined) integer(step.timeoutMs, 'step timeoutMs', 0, 2_147_483_647);
    }
    const names = new Set<string>(), ids = new Set<string>();
    for (const input of current.tasks) {
      const task = input as TaskInput;
      if (!record(task) || typeof task.name !== 'string' || !task.name.trim() || typeof task.description !== 'string') fail('invalid task');
      if (task.id !== undefined && (typeof task.id !== 'string' || !task.id.trim())) fail('invalid task ID');
      if (task.dependsOn !== undefined && (!Array.isArray(task.dependsOn) || task.dependsOn.some(id => typeof id !== 'string'))) fail('invalid task dependencies');
      if (task.execution !== undefined && !record(task.execution)) fail('invalid task execution settings');
      if (task.validation !== undefined && !record(task.validation)) fail('invalid validation settings');
      if (task.condition !== undefined && !record(task.condition)) fail('invalid task condition');
      if (names.has(task.name) || (task.id !== undefined && ids.has(task.id))) fail('duplicate task name or ID');
      names.add(task.name); if (task.id !== undefined) ids.add(task.id);
      if (task.externalDependency !== undefined) fail('external dependency scheduling is unsupported; verify external completion through the host callback');
      if (task.maxAttempts !== undefined && task.maxAttempts !== 1) fail('maxAttempts greater than one or zero is unsupported; outer action replay is excluded');
      task.maxAttempts = 1;
      if (task.execution?.parallel || (task.execution?.maxConcurrency !== undefined && task.execution.maxConcurrency !== 1)) fail('parallel tasks are unsupported');
      if (task.execution?.maxIterations !== undefined) integer(task.execution.maxIterations, 'task maxIterations', 1);
      const validation = task.validation;
      if (validation?.skipReflection !== undefined && typeof validation.skipReflection !== 'boolean') fail('invalid skipReflection');
      for (const values of [validation?.completionCriteria, validation?.requiredMemoryKeys]) if (values !== undefined && (!Array.isArray(values) || values.some(value => typeof value !== 'string' || !value))) fail('invalid validation criteria/memory keys');
      if (validation?.requireUserApproval && validation.requireUserApproval !== 'never') fail('model-led approval scheduling is unsupported');
      if (validation?.customValidator !== undefined) fail('customValidator hooks are unsupported; use the required host verifier');
      if (validation?.mode !== undefined && (typeof validation.mode !== 'string' || !['strict', 'warn'].includes(validation.mode))) fail('unsupported validation mode');
      if (validation?.minCompletionScore !== undefined && (typeof validation.minCompletionScore !== 'number' || !Number.isFinite(validation.minCompletionScore) || validation.minCompletionScore < 0 || validation.minCompletionScore > 100)) fail('minCompletionScore must be between 0 and 100');
      if (task.condition && (!['skip', 'fail', 'wait'].includes(task.condition.onFalse)
        || !['exists', 'not_exists', 'equals', 'contains', 'truthy', 'greater_than', 'less_than'].includes(task.condition.operator)
        || typeof task.condition.memoryKey !== 'string' || !task.condition.memoryKey)) fail('unsupported condition');
      const flow = task.controlFlow;
      if (flow) {
        if (!['map', 'fold', 'until'].includes(flow.type)) fail('unsupported control flow');
        if (flow.maxIterations !== undefined) integer(flow.maxIterations, 'flow maxIterations', 0, 1000);
        if (flow.iterationTimeoutMs !== undefined) integer(flow.iterationTimeoutMs, 'iterationTimeoutMs', 0, 2_147_483_647);
        visit(resolveSubRoutine(flow.tasks, task.name), scope, depth + 1);
      }
    }
    createRoutineExecution(current); // Reuse the existing dependency/cycle validation.
  };
  visit(definition, all, 0);
}

export function preflightInputs(definition: RoutineDefinition, inputs?: Record<string, unknown>): Record<string, unknown> {
  return validateAndResolveInputs(definition.parameters, inputs ?? {});
}
