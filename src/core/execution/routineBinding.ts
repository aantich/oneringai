import type { Task, TaskValidationResult } from '../../domain/entities/Task.js';
import type { AgentResponse } from '../../domain/entities/Response.js';
import type { DeterministicStep } from '../../domain/entities/Routine.js';
import type { RoutineExecution } from '../../domain/entities/Routine.js';
import type { ExecuteRoutineOptions } from '../routineRunner.js';
import { executeRoutine } from '../routineRunner.js';
import type { CompositionLease } from './composition.js';
import { InvalidConfigError } from '../../domain/errors/AIErrors.js';

// Bind actual request/execution identities, never shared Agent/context/result identity.
const bindings = new WeakMap<object, RoutineBinding>();
export function routineBinding(value: object): RoutineBinding | undefined { return bindings.get(value); }
export function bindRoutineExecution(value: RoutineExecution, binding?: RoutineBinding): void {
  if (binding) bindings.set(value, binding);
}

export interface VerifiedRoutinePolicy {
  started(execution: RoutineExecution, binding: RoutineBinding): void;
  cleanup(execution: RoutineExecution, binding: RoutineBinding, restore: () => Promise<void>): Promise<void>;
  condition(execution: RoutineExecution, task: Task, binding: RoutineBinding): Promise<'run' | 'skip' | 'fail'>;
  task(execution: RoutineExecution, task: Task, binding: RoutineBinding, response?: AgentResponse,
    quality?: TaskValidationResult, recheck?: () => Promise<TaskValidationResult>, skipped?: boolean): Promise<void>;
  final(execution: RoutineExecution, binding: RoutineBinding): Promise<void>;
  step(execution: RoutineExecution, step: DeterministicStep, phase: 'pre' | 'post', index: number,
    state: 'succeeded' | 'failed' | 'uncertain', result: unknown, binding: RoutineBinding): Promise<void>;
  preserve(): boolean;
}

/** Private foundation; the public verified facade is delivered in C3. */
export class RoutineBinding {
  constructor(readonly lease: CompositionLease, private readonly constraints: readonly AbortSignal[] = [], readonly verified?: VerifiedRoutinePolicy, readonly depth = -1) {}
  get signal(): AbortSignal { return AbortSignal.any([this.lease.signal, ...this.constraints]); }
  run(input: Parameters<CompositionLease['run']>[0]) { return this.lease.run(input, undefined, this.signal); }
  direct(input: Parameters<CompositionLease['direct']>[0], options?: Parameters<CompositionLease['direct']>[1]) {
    return this.lease.direct(input, { ...options, signal: this.signal });
  }
  async execute(options: ExecuteRoutineOptions, iterationTimeoutMs?: number): Promise<RoutineExecution> {
    if (options.agent !== this.lease.agent) throw new InvalidConfigError('Bound routine must use its admitted Agent');
    if (!this.verified && options.definition.requiredTools?.length && !options.disableToolScoping) throw new InvalidConfigError('Private bound routines require shared-manager tool scoping');
    const timeouts = [iterationTimeoutMs, options.definition.timeoutMs];
    for (const timeout of timeouts) if (timeout !== undefined && (!Number.isSafeInteger(timeout) || timeout < 0)) throw new InvalidConfigError('Bound routine timeout must be a nonnegative safe integer');
    const release = this.lease.hold();
    const timers: ReturnType<typeof setTimeout>[] = [], constraints = [...this.constraints];
    for (const timeout of timeouts) {
      if (timeout === undefined || timeout === 0) continue;
      const controller = new AbortController(); constraints.push(controller.signal);
      timers.push(setTimeout(() => controller.abort(new DOMException('Routine deadline exceeded', 'TimeoutError')), timeout));
    }
    const nested = new RoutineBinding(this.lease, constraints, this.verified, this.depth + 1);
    const pluginTools = new Set(options.agent.context.getContextToolNames());
    for (const tool of options.agent.context.getPlugin('tool_catalog')?.getTools() ?? []) pluginTools.delete(tool.definition.function.name);
    const restore = this.verified && !options.disableToolScoping && options.definition.requiredTools?.length
      ? this.lease.enterScope(new Set([...options.definition.requiredTools, ...pluginTools])) : () => {};
    const request = { ...options };
    bindings.set(request, nested);
    try { nested.signal.throwIfAborted(); return await executeRoutine(request); }
    finally { bindings.delete(request); timers.forEach(clearTimeout); restore(); release(); }
  }
}
