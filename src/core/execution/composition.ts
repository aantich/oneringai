import type { Agent } from '../Agent.js';
import type { ModelTask } from '../model-execution/ModelTask.js';
import type { RunOptions } from '../Agent.js';
import type { DirectCallOptions } from '../BaseAgent.js';
import { InvalidConfigError, ToolPermissionDeniedError } from '../../domain/errors/AIErrors.js';
import type { ToolExecutionOutcome } from '../tool-execution/outcomes.js';
import type { EvidenceReference } from '../../domain/interfaces/IEvidenceStorage.js';
import { createExecutionSignal } from '../tool-execution/cancellation.js';

/** Private until the complete verified facade is delivered. Never serialized. */
export interface ExecutionBinding { modelTask?: ModelTask; signal?: AbortSignal }
type Owner = ReturnType<typeof createOwner>;
const COORDINATION = Symbol.for('@everworker/oneringai/composition/v2');
const SCOPE_DENIAL = Symbol.for('@everworker/oneringai/composition-scope/v1');
export interface CompositionToolObservation {
  late?: boolean;
  outcome: ToolExecutionOutcome;
  effect: 'read' | 'write' | 'unknown';
  result?: { value: unknown };
  arguments?: { value: unknown };
  acknowledgedResult?: EvidenceReference;
}
interface Coordination { version: 2; owner?: Owner; admission?: Owner; callSignal?: AbortSignal; busy?: () => boolean; destroyed?: () => boolean; directCalls: number }
function coordination(subject: object): Coordination | undefined {
  try {
    const value: unknown = Object.getOwnPropertyDescriptor(subject, COORDINATION)?.value;
    return value && typeof value === 'object' && 'version' in value && value.version === 2 ? value as Coordination : undefined;
  } catch { return undefined; }
}
function install(subject: object): Coordination | undefined {
  const existing = coordination(subject); if (existing) return existing;
  const state: Coordination = { version: 2, directCalls: 0 };
  try { Object.defineProperty(subject, COORDINATION, { value: state }); return state; }
  catch { return undefined; } // Legacy nonextensible/proxied managers still work outside opt-in composition.
}

export function registerCompositionAgent(agent: Agent, busy: () => boolean, destroyed: () => boolean): void {
  const state = install(agent); if (state) { state.busy = busy; state.destroyed = destroyed; } install(agent.tools);
}

/** Admission is synchronous and consumed before hooks/awaits; no ambient async scope. */
export function assertCompositionAdmission(agent: object): void {
  const state = coordination(agent), owner = state?.owner;
  if (owner && (state?.admission !== owner || owner.released)) throw new InvalidConfigError('Agent is exclusively owned by a composed operation');
}

export function admitComposition(agent: object): ExecutionBinding | undefined {
  assertCompositionAdmission(agent);
  const state = coordination(agent), owner = state?.owner;
  if (!owner) return undefined;
  const admission = state?.admission;
  const callSignal = state?.callSignal;
  delete state!.admission;
  delete state!.callSignal;
  if (admission !== owner || owner.released) throw new InvalidConfigError('Agent is exclusively owned by a composed operation');
  const signal = callSignal ? AbortSignal.any([owner.signal, callSignal]) : owner.signal;
  signal.throwIfAborted();
  owner.binding.modelTask?.signal.throwIfAborted();
  return { modelTask: owner.binding.modelTask, signal };
}

export function hasCompositionOwner(agent: object): boolean { return !!coordination(agent)?.owner; }
export function checkCompositionRelease(agent: object): void { coordination(agent)?.owner?.checkRelease(); }

export function captureCompositionToolObserver(manager: object): ((observation: CompositionToolObservation) => void) | undefined {
  const owner = coordination(manager)?.owner;
  return owner ? observation => owner.observeTool(observation) : undefined;
}
export function captureCompositionArguments(value: unknown): { value: unknown } | undefined {
  try { return { value: structuredClone(value) }; } catch { return undefined; }
}
export function compositionAllowsTool(manager: object, name: string): boolean { return coordination(manager)?.owner?.allowsTool(name) !== false; }
export function captureCompositionToolDenial(manager: object, name: string): Error | undefined {
  return coordination(manager)?.owner?.allowsTool(name) === false
    ? new ToolPermissionDeniedError(name, 'Outside the host-selected routine tool scope') : undefined;
}
export function attachCompositionDenial(execute: object, error: Error): void { Object.defineProperty(execute, SCOPE_DENIAL, { value: error }); }
export function getCompositionDenial(execute: object): Error | undefined {
  try { return Object.getOwnPropertyDescriptor(execute, SCOPE_DENIAL)?.value as Error | undefined; } catch { return undefined; }
}

export function trackCompositionWork(subject: object, promise: Promise<unknown>): void {
  const owner = coordination(subject)?.owner;
  owner?.track(promise);
}
export function compositionInvocationParent(subject: object): string | undefined { return coordination(subject)?.owner?.invocationParent; }

/** Existing direct concurrency stays unchanged outside an explicitly selected lease. */
export function beginCompositionDirect(agent: object): () => void {
  const state = coordination(agent);
  if (!state) return () => {};
  state.directCalls++;
  return () => { state.directCalls = Math.max(0, state.directCalls - 1); checkCompositionRelease(agent); };
}

/** Called only inside an already-admitted library maintenance operation. */
export function admitCompositionMaintenance<T>(agent: object, callback: () => T): T {
  const owner = coordination(agent)?.owner;
  return owner ? owner.admit(callback) : callback();
}

function createOwner(agent: Agent, initial: ExecutionBinding) {
  const state = coordination(agent)!, toolState = coordination(agent.tools)!;
  const lifetime = new AbortController();
  let joined = createExecutionSignal([lifetime.signal, initial.signal, initial.modelTask?.signal]);
  let resolveReleased!: () => void;
  const whenReleased = new Promise<void>(resolve => { resolveReleased = resolve; });
  const pending = new Set<Promise<unknown>>();
  const settledObservers = new Set<() => void>();
  const observers = new Set<(observation: CompositionToolObservation) => void>();
  let toolScope: Set<string> | undefined;
  let binding = Object.freeze({ ...initial }), releaseRequested = false, released = false, holds = 0;
  let invocationParent: string | undefined;
  const finish = (): void => {
    if (!releaseRequested || pending.size || holds || state.directCalls || state.busy?.()) return;
    released = true; joined.dispose(); delete state.owner; delete toolState.owner; resolveReleased();
  };
  const owner = {
    whenReleased,
    cancel(reason: unknown = new DOMException('Composition cancelled', 'AbortError')): void { lifetime.abort(reason); },
    get agent(): Agent { return agent; },
    get binding(): Readonly<ExecutionBinding> { return binding; }, get signal(): AbortSignal { return joined.controller.signal; },
    get invocationParent(): string | undefined { return invocationParent; },
    setInvocationParent(id: string): void {
      if (invocationParent === id) return;
      if (!id || invocationParent !== undefined || pending.size) throw new InvalidConfigError('Model invocation correlation must be fixed before child work starts');
      invocationParent = id;
    },
    get released() { return released; }, get pending() { return pending.size; },
    checkRelease: finish,
    allowsTool(name: string): boolean { return !toolScope || toolScope.has(name); },
    enterScope(names: ReadonlySet<string>): () => void {
      const previous = toolScope;
      toolScope = new Set([...names].filter(name => !previous || previous.has(name)));
      const installed = toolScope;
      let active = true; return () => {
        if (!active) return;
        if (toolScope !== installed) throw new InvalidConfigError('Routine scopes must restore in stack order');
        active = false; toolScope = previous;
      };
    },
    observeTool(observation: CompositionToolObservation): void {
      for (const observer of [...observers]) { try { observer(observation); } catch { /* Diagnostic capture cannot repeat a source action. */ } }
    },
    onWorkSettled(observer: () => void): () => void { settledObservers.add(observer); return () => { settledObservers.delete(observer); }; },
    onToolObservation(observer: (observation: CompositionToolObservation) => void): () => void {
      observers.add(observer); return () => { observers.delete(observer); };
    },
    admit<T>(callback: () => T, signal?: AbortSignal): T {
      if (released || releaseRequested) throw new InvalidConfigError('Composition lease is closed');
      if (state.admission) throw new InvalidConfigError('Composition admission is already active');
      state.admission = owner;
      state.callSignal = signal;
      try { return callback(); } finally { delete state.admission; delete state.callSignal; }
    },
    track(promise: Promise<unknown>): void {
      pending.add(promise);
      const settle = () => { pending.delete(promise); for (const observer of [...settledObservers]) { try { observer(); } catch { /* diagnostic lifecycle observer */ } } finish(); };
      void promise.then(settle, settle);
    },
    hold(): () => void {
      if (released || releaseRequested) throw new InvalidConfigError('Composition lease is closed');
      holds++; let active = true;
      return () => { if (active) { active = false; holds--; finish(); } };
    },
    replace(next: ExecutionBinding): void {
      if (pending.size || released || releaseRequested) throw new InvalidConfigError('Cannot replace an active composition binding');
      if (next.modelTask !== undefined && next.modelTask !== binding.modelTask) throw new InvalidConfigError('Continuation must retain its originating ModelTask');
      next.signal?.throwIfAborted(); binding.modelTask?.signal.throwIfAborted();
      const replacement = createExecutionSignal([lifetime.signal, next.signal, binding.modelTask?.signal]);
      joined.dispose(); joined = replacement; binding = Object.freeze({ modelTask: binding.modelTask, signal: next.signal });
    },
    release(): void { releaseRequested = true; finish(); },
    close(reason: unknown = new DOMException('Composition closed', 'AbortError')): void {
      lifetime.abort(reason); releaseRequested = true; finish();
    },
    run(input: Parameters<Agent['run']>[0], options?: RunOptions, signal?: AbortSignal) {
      const promise = owner.admit(() => agent.run(input, { ...options, modelTask: binding.modelTask }), signal);
      owner.track(promise); return promise;
    },
    direct(input: Parameters<Agent['runDirect']>[0], options?: DirectCallOptions) {
      const promise = owner.admit(() => agent.runDirect(input, { ...options, modelTask: binding.modelTask,
        signal: options?.signal ? AbortSignal.any([owner.signal, options.signal]) : owner.signal }));
      owner.track(promise); return promise;
    },
    async *stream(input: Parameters<Agent['stream']>[0], options?: RunOptions) {
      const iterator = agent.stream(input, { ...options, modelTask: binding.modelTask });
      let first = true;
      try {
        for (;;) {
          const work = first ? owner.admit(() => iterator.next()) : iterator.next(); first = false;
          owner.track(work); const next = await work; if (next.done) return; yield next.value;
        }
      } finally { await iterator.return?.(undefined); }
    },
    continue(signal?: AbortSignal) {
      const promise = owner.admit(() => agent.continueWithAsyncResults(), signal); owner.track(promise); return promise;
    },
  };
  return owner;
}

export type CompositionLease = ReturnType<typeof createOwner>;
export function acquireComposition(agent: Agent, binding: ExecutionBinding = {}): CompositionLease {
  binding.signal?.throwIfAborted(); binding.modelTask?.signal.throwIfAborted();
  const state = coordination(agent), toolState = coordination(agent.tools);
  if (!state?.busy || !toolState) throw new InvalidConfigError('Agent does not support this private composition version');
  if (state.owner || toolState.owner || state.destroyed?.() || state.busy() || state.directCalls) throw new InvalidConfigError('Agent is busy or already composed');
  const owner = createOwner(agent, binding); state.owner = owner; toolState.owner = owner; return owner;
}
