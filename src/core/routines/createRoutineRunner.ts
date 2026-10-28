import { containAsyncRejection } from '../evidence/validation.js';
import { randomUUID } from 'node:crypto';
import type { Agent } from '../Agent.js';
import { InvalidConfigError } from '../../domain/errors/AIErrors.js';
import { evaluateCondition } from '../../domain/entities/Task.js';
import type { ToolExecutionOutcome } from '../../domain/entities/Tool.js';
import { acquireComposition, type CompositionLease, type CompositionToolObservation } from '../execution/composition.js';
import { RoutineBinding, type VerifiedRoutinePolicy } from '../execution/routineBinding.js';
import { getPlugins, readMemoryValue } from '../routineControlFlow.js';
import { hasUnacknowledgedEvidence } from '../context-nextgen/tool-pairs.js';
import { boundedData, freezeData, RoutineObservations } from './observations.js';
import { copyRoutineDefinition, preflightRoutine, preflightInputs } from './preflight.js';
import type { RoutineRunner, RoutineRunnerOptions, RoutineRunRequest, RoutineRunResult, RoutineContinuation,
  RoutineObservation, RoutineProgress, VerificationDecision, RoutineTaskSummary, RoutineStepObservation } from './types.js';

const invalid = (message: string): never => { throw new InvalidConfigError(`Verified routine: ${message}`); };
const errorText = (error: unknown): string => error instanceof Error ? error.message : String(error);
const abortError = () => new DOMException('Routine runner closed', 'AbortError');
interface Gate { key: string; binding: RoutineBinding; build(reason: 'settled' | 'reconcile'): RoutineObservation; quality?: () => Promise<boolean>;
  blocked?: (reason: 'settled' | 'reconcile') => string | undefined; settleAsync?: () => Promise<void>; resolve(): void; reject(error: unknown): void }
interface Operation {
  id: string; request: RoutineRunRequest; lease: CompositionLease; data: RoutineObservations;
  binding: RoutineBinding; current: RoutineBinding; tasks: Map<string, RoutineTaskSummary>; steps: RoutineStepObservation[];
  tools: Map<string, { outcome: ToolExecutionOutcome; sourceId?: string }>; gate?: Gate; handle?: RoutineContinuation;
  decisions: Map<string, { initial: VerificationDecision; latest: VerificationDecision }>;
  last?: RoutineRunResult; lifecycle: 'running' | 'paused' | 'settling'; lock: boolean; closed: boolean; finished: boolean; rootFinal: boolean; cleanups: Map<string, () => Promise<void>>; restoring: boolean; cleanupError?: string; deliveredThrough: number;
  listeners: Set<(result: RoutineRunResult) => void>; unsubscribe(): void; owned: boolean;
}

function decisionData(value: VerificationDecision): VerificationDecision {
  const copy = boundedData(value, 16384).data;
  if (!copy || !['verified', 'waiting', 'blocked', 'uncertain'].includes(copy.kind)
    || (copy.kind !== 'verified' && (typeof copy.reason !== 'string' || !copy.reason.trim() || copy.reason.length > 4096))
    || (copy.references !== undefined && (!Array.isArray(copy.references) || copy.references.length > 32))) return invalid('malformed verification decision');
  // Reuse source reference validation rather than accept arbitrary receipt-shaped objects.
  const references = new RoutineObservations('validation', 16384);
  copy.references?.forEach(reference => references.archived('observation', reference));
  return freezeData(copy);
}
function waitSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(signal.reason); };
    signal.addEventListener('abort', abort, { once: true });
    void promise.then(value => { signal.removeEventListener('abort', abort); resolve(value); }, error => { signal.removeEventListener('abort', abort); reject(error); });
  });
}

/** Opt-in verified, same-process routines. Legacy executeRoutine/createRoutineTool are unchanged. */
export function createRoutineRunner(options: RoutineRunnerOptions): RoutineRunner {
  if (!options || typeof options.verify !== 'function') return invalid('verify callback is required');
  const maximum = options.maxObservationBytes ?? 1_048_576, capacity = options.maxActiveOperations ?? 32;
  if (!Number.isSafeInteger(maximum) || maximum < 8192 || maximum > 67_108_864) return invalid('maxObservationBytes must be between 8192 and 67108864');
  if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 1000) return invalid('maxActiveOperations must be between 1 and 1000');
  const operations = new Map<string, Operation>(), handles = new WeakMap<object, Operation>();
  let closed = false, reserved = 0;
  const activeCount = () => [...operations.values()].filter(op => !op.lease.released).length;
  const progress = (event: RoutineProgress): void => { try { containAsyncRejection(options.onProgress?.(event)); } catch { /* Host diagnostics cannot replay effects. */ } };
  const report = (op: Operation) => {
    const task = op.lease.binding.modelTask;
    const base = { operationId: op.id, observations: op.data.observations(), accounting: task ? 'shared' as const : 'independent' as const };
    if (!task) return base;
    let snapshot: ReturnType<typeof task.snapshot>;
    try { snapshot = task.snapshot(); } catch { return { ...base, usageOmitted: 'unavailable' as const }; }
    try { return { ...base, usage: freezeData(boundedData(snapshot, maximum).data) }; }
    catch { return { ...base, usageOmitted: 'observation_capacity' as const }; }
  };
  const protectedContext = (op: Operation): boolean => {
    try { return [...op.request.agent.context.getConversation(), ...op.request.agent.context.getCurrentInput()].some(hasUnacknowledgedEvidence); }
    catch { return true; }
  };
  const publish = (op: Operation, result: RoutineRunResult): void => {
    op.last = result; op.deliveredThrough = op.data.revision; progress({ kind: 'result', result });
    const listeners = [...op.listeners]; op.listeners.clear(); listeners.forEach(listener => listener(result));
  };
  const pause = (op: Operation, reason: string, state: 'waiting' | 'blocked' | 'uncertain' = 'uncertain'): void => {
    if (op.closed) return;
    op.lifecycle = 'paused';
    const handle = Object.freeze(Object.create(null)) as RoutineContinuation;
    if (op.handle) handles.delete(op.handle);
    op.handle = handle; handles.set(handle, op);
    publish(op, freezeData({ ...report(op), state, reason, continuation: handle }));
  };
  const awaitNext = (op: Operation): Promise<RoutineRunResult> => new Promise(resolve => op.listeners.add(resolve));
  const releaseIfSafe = (op: Operation): void => {
    if (!op.finished || op.handle || op.lease.pending || op.request.agent.hasPendingAsyncTools(true) || op.data.hasPending || protectedContext(op)) return;
    if (op.restoring) return;
    if (op.cleanups.size) {
      op.restoring = true;
      const work = (async () => { for (const [id, restore] of op.cleanups) { await restore(); op.cleanups.delete(id); } })();
      op.lease.track(work);
      void work.then(() => { op.restoring = false; delete op.cleanupError; releaseIfSafe(op); }, error => { op.restoring = false; op.cleanupError = errorText(error); });
      return;
    }
    op.unsubscribe(); op.lease.release();
    void op.lease.whenReleased.then(() => {
      if (op.owned) { try { op.request.agent.destroy(); } catch { /* Already disposed by host. */ } }
      // Delivery owns the final snapshots; the runner is not an unbounded history store.
      operations.delete(op.id);
    });
  };
  const sources = (op: Operation, ids?: readonly string[]) => (ids ?? [...op.tools.values()].flatMap(tool => tool.sourceId ? [tool.sourceId] : []))
    .map(id => op.data.source(id, true));
  const headers = (op: Operation) => [...op.tasks.values()];
  const base = (op: Operation) => ({ operationId: op.id, tasks: headers(op), toolOutcomes: [...op.tools.values()].map(value => value.outcome),
    stepOutcomes: op.steps, sources: sources(op), complete: !op.data.hasPending });
  const toolObservation = (op: Operation, observation: CompositionToolObservation): void => {
    const key = observation.outcome.executionId;
    const raw = { outcome: observation.outcome, effect: observation.effect,
      ...(observation.arguments ? { arguments: observation.arguments.value } : {}),
      ...(observation.result ? { result: observation.result.value } : {}) };
    const sourceId = observation.acknowledgedResult
      ? op.data.archived('tool', observation.acknowledgedResult, `${op.id}:tool:${key}:${randomUUID()}`)
      : op.data.retain('tool', raw, `${op.id}:tool:${key}:${randomUUID()}`);
    op.tools.set(key, { outcome: observation.outcome, sourceId });
    op.data.source(sourceId, true);
    if (op.closed) {
      op.data.requireArchive(sourceId);
      const observation = phase(op, `${op.id}:closed`, { ...base(op), phase: 'routine', reason: 'reconcile' });
      progress({ kind: 'observation', observation });
    }
    if (op.data.hasPending && !op.closed) op.request.agent.cancel('Routine source capacity requires host archival');
  };
  const reconcile = async (op: Operation, gate: Gate, reason: 'settled' | 'reconcile'): Promise<void> => {
    if (op.closed) { gate.reject(abortError()); return; }
    let observation = gate.build(reason), decision: VerificationDecision;
    try {
      gate.binding.signal.throwIfAborted();
      if (reason === 'reconcile' && gate.settleAsync && !op.lease.pending && !op.request.agent.hasPendingAsyncTools() && op.request.agent.hasPendingAsyncTools(true)) await gate.settleAsync();
      if (op.data.hasPending) decision = { kind: 'uncertain', reason: 'Retained source requires host archival before further actions' };
      else if (op.lease.pending || op.request.agent.hasPendingAsyncTools(true) || protectedContext(op)) decision = { kind: 'uncertain', reason: 'Pending work or unacknowledged context evidence requires settlement/repair' };
      else {
        const blocked = gate.blocked?.(reason);
        if (blocked) decision = { kind: 'uncertain', reason: blocked };
        else if (gate.quality && !await gate.quality()) decision = { kind: 'uncertain', reason: 'Strict task quality has not passed; reconcile rechecks the retained response only' };
        else {
          observation = gate.build(reason);
          const work = Promise.resolve().then(() => options.verify(observation, { execution: op.lease.binding, signal: gate.binding.signal }));
          op.lease.track(work);
          decision = decisionData(await waitSignal(work, gate.binding.signal));
        }
      }
    } catch (error) { decision = { kind: 'uncertain', reason: `Verification unavailable: ${errorText(error)}`.slice(0, 4096) }; }
    if (op.closed) { gate.reject(abortError()); return; }
    const prior = op.decisions.get(gate.key);
    op.decisions.set(gate.key, { initial: prior?.initial ?? decision, latest: decision });
    observation = gate.build(reason); progress({ kind: 'observation', observation });
    if (decision.kind === 'verified' && observation.complete && !op.data.hasPending && !protectedContext(op) && !gate.binding.signal.aborted && !op.lease.pending) {
      op.lifecycle = 'running'; op.gate = undefined; gate.resolve();
    } else pause(op, decision.kind === 'verified' ? 'Verification data or cancellation requires reconciliation' : decision.reason,
      decision.kind === 'verified' ? 'uncertain' : decision.kind);
  };
  const gate = async (op: Operation, key: string, build: Gate['build'], quality?: Gate['quality'], blocked?: Gate['blocked'], settleAsync?: Gate['settleAsync']): Promise<void> => {
    if (op.closed) throw abortError();
    await new Promise<void>((resolve, reject) => {
      const current: Gate = { key, binding: op.current, build, resolve, reject, quality, blocked, settleAsync }; op.gate = current;
      void reconcile(op, current, 'settled');
    });
  };
  const phase = (op: Operation, key: string, candidate: RoutineObservation): RoutineObservation => {
    const decisions = op.decisions.get(key);
    return op.data.view(key, { ...candidate, ...(decisions ? { initialVerification: decisions.initial, verification: decisions.latest } : {}) });
  };
  const policy = (op: Operation): VerifiedRoutinePolicy => ({
    started(execution, binding) { op.current = binding; for (const task of execution.plan.tasks) op.tasks.set(`${execution.id}:${task.id}`, { id: task.id, executionId: execution.id, name: task.name, state: 'pending' }); },
    async cleanup(execution, binding, restore) {
      op.current = binding;
      op.cleanups.set(execution.id, restore);
      if (op.closed || op.data.hasPending || protectedContext(op)) return;
      try { await restore(); op.cleanups.delete(execution.id); return; } catch { /* Retain the coordinator and retry bookkeeping after host repair. */ }
      const key = `${execution.id}:cleanup`;
      await gate(op, key, reason => phase(op, key, { ...base(op), executionId: execution.id, phase: 'routine', reason }), async () => {
        try { await restore(); op.cleanups.delete(execution.id); return true; } catch { return false; }
      });
    },
    preserve: () => op.data.hasPending || protectedContext(op) || op.closed,
    async condition(execution, task, binding) {
      op.current = binding;
      const { icmPlugin, wmPlugin } = getPlugins(op.request.agent);
      const test = () => evaluateCondition(task.condition!, { get: key => readMemoryValue(key, icmPlugin, wmPlugin) });
      if (await test()) return 'run';
      if (task.condition!.onFalse !== 'wait') return task.condition!.onFalse;
      while (!await test()) {
        const key = `${execution.id}:${task.id}:condition`;
        await gate(op, key, reason => phase(op, key, { ...base(op), executionId: execution.id, phase: 'task', taskId: task.id, reason }),
          async () => await test());
        binding.signal.throwIfAborted();
      }
      return 'run';
    },
    async task(execution, task, binding, response, quality, recheck, skipped = false) {
      op.current = binding;
      const key = `${execution.id}:${task.id}`;
      op.tasks.set(key, { id: task.id, executionId: execution.id, name: task.name, state: skipped ? 'skipped' : task.result?.success === false ? 'failed' : 'settled' });
      const responseId = response || task.result ? op.data.retain('response', response ?? task.result, `${op.id}:response:${key}`) : undefined;
      let qualityAttempted = false;
      const build = (reason: 'settled' | 'reconcile'): RoutineObservation => phase(op, key, { ...base(op), executionId: execution.id, phase: 'task', taskId: task.id, reason,
        ...(responseId ? { ...(response ? { response } : {}), sources: [...sources(op), op.data.source(responseId, !response)] } : {}),
        ...(quality ? { quality: { checked: task.validation?.skipReflection === false || !!task.validation?.requiredMemoryKeys?.length, passed: quality.isComplete,
          ...(!quality.isComplete && task.validation?.mode === 'warn' ? { warning: quality.explanation } : {}) } } : {}) });
      await gate(op, key, build, quality ? async () => {
        if (quality.isComplete || task.validation?.mode === 'warn') return true;
        if (!qualityAttempted) { qualityAttempted = true; return false; }
        if (recheck) Object.assign(quality, await recheck());
        return quality.isComplete;
      } : undefined, reason => {
        if (reason === 'reconcile') return undefined;
        if (response && (response.status !== 'completed' || response.stop_reason === 'refusal' || response.pendingAsyncTools?.length
          || response.loop?.completion?.complete === false
          || (op.request.agent.inspectCapabilities().loop.hostCompletionCheck && response.loop?.completion?.complete !== true))) return 'Managed task did not establish readiness; host reconciliation is required';
        if (task.result?.success === false) return task.result.error ?? 'Task execution failed; host reconciliation is required';
        return undefined;
      }, response ? async () => { const continued = await op.lease.continue(binding.signal); if (continued) Object.assign(response, continued); } : undefined);
      const decision = op.decisions.get(key)!.latest;
      op.tasks.set(key, { id: task.id, executionId: execution.id, name: task.name, state: skipped ? 'skipped' : 'verified', verification: decision, references: decision.references });
      binding.signal.throwIfAborted();
    },
    async final(execution, binding) {
      op.current = binding;
      const key = `${execution.id}:final`;
      await gate(op, key, reason => phase(op, key, { ...base(op), executionId: execution.id, phase: 'routine', reason }), undefined,
        reason => execution.status !== 'completed' && reason === 'settled' ? execution.error ?? 'Routine has failed tasks' : undefined);
      binding.signal.throwIfAborted();
      if (binding.depth === 0) op.rootFinal = true;
    },
    async step(execution, step, stepPhase, index, state, result, binding) {
      op.current = binding;
      const id = `${execution.id}:${stepPhase}:${index}`, sourceId = op.data.retain('step', result, `${op.id}:step:${id}`);
      const entry = { id, name: step.name, phase: stepPhase, state, result, sourceId };
      const existing = op.steps.findIndex(value => value.id === id); if (existing < 0) op.steps.push(entry); else op.steps[existing] = entry;
      try { boundedData(entry, maximum); } catch { op.data.requireArchive(sourceId); }
      if (op.data.hasPending) {
        const key = `${id}:recovery`;
        await gate(op, key, reason => phase(op, key, { ...base(op), executionId: execution.id, phase: 'routine', reason, sources: [...sources(op), op.data.source(sourceId)] }));
      }
    },
  });
  const start = (request: RoutineRunRequest, owned = false): Promise<RoutineRunResult> => {
    if (closed) return invalid('runner is closed');
    if (activeCount() + reserved >= capacity) return invalid('active-operation capacity exceeded');
    if ([...request.agent.context.getConversation(), ...request.agent.context.getCurrentInput()].some(hasUnacknowledgedEvidence)) return invalid('repair unacknowledged context evidence before starting another routine');
    const definition = copyRoutineDefinition(request.definition);
    preflightRoutine(definition, request.agent, request.disableToolScoping);
    const inputs = boundedData(preflightInputs(definition, request.inputs), maximum).data;
    const lease = acquireComposition(request.agent, request.execution), id = randomUUID();
    const op = { id, request: { ...request, definition, inputs }, lease, data: new RoutineObservations(id, maximum),
      tasks: new Map(), steps: [], tools: new Map(), decisions: new Map(), lifecycle: 'running', lock: false, closed: false,
      finished: false, rootFinal: false, deliveredThrough: 0, cleanups: new Map(), restoring: false, listeners: new Set(), unsubscribe: () => {}, owned } as unknown as Operation;
    op.binding = new RoutineBinding(lease, [], policy(op)); op.current = op.binding;
    const stopTools = lease.onToolObservation(value => toolObservation(op, value));
    const stopSettled = lease.onWorkSettled(() => releaseIfSafe(op));
    op.unsubscribe = () => { stopTools(); stopSettled(); };
    operations.set(id, op); const result = awaitNext(op); progress({ kind: 'started', operationId: id });
    void (async () => {
      try {
        const execution = await op.binding.execute(op.request);
        // Early preflight/step exits in the reused engine still need final host reconciliation.
        if (!op.rootFinal && !op.closed) await policy(op).final(execution, op.current);
        op.finished = true; op.lifecycle = 'settling';
        const final = [...op.decisions.values()].at(-1)?.latest;
        if (!op.closed && final?.kind === 'verified' && !op.data.hasPending && !protectedContext(op)) publish(op, freezeData({ ...report(op), state: 'completed', verification: final }));
        else if (op.closed) publish(op, freezeData({ ...report(op), state: 'cancelled', reason: 'Routine runner closed' }));
        releaseIfSafe(op);
      } catch (error) {
        op.finished = true; op.lifecycle = 'settling';
        const ambiguous = [...op.tools.values()].some(tool => tool.outcome.executionStarted && tool.outcome.completion !== 'not_started');
        if (!op.closed && (ambiguous || op.data.hasPending || protectedContext(op))) pause(op, `Execution stopped: ${errorText(error)}`);
        else publish(op, freezeData({ ...report(op), state: op.closed || lease.signal.aborted ? 'cancelled' : 'failed', reason: errorText(error) }));
        if (!op.handle) releaseIfSafe(op);
      }
    })();
    return result;
  };
  const runner: RoutineRunner = {
    async run(request) { return start(request); },
    async resume(continuation, next) {
      const op = continuation && handles.get(continuation);
      if (!op || op.closed || closed || op.handle !== continuation || op.lock) return invalid('foreign, stale, closed or concurrently claimed continuation');
      if (!next || typeof next.authorize !== 'function') return invalid('resume requires host authorization');
      next.execution?.signal?.throwIfAborted();
      if (next.execution?.modelTask !== undefined && next.execution.modelTask !== op.lease.binding.modelTask) return invalid('continuation cannot replace its ModelTask');
      op.lock = true; let authorizationPending = false;
      try {
        const authorization = Promise.resolve().then(next.authorize);
        const signal = next.execution?.signal ?? op.lease.binding.signal;
        // Keep the lock until the actual authorization callback settles, including after caller abort.
        let authorized: boolean;
        try { authorized = signal ? await waitSignal(authorization, signal) : await authorization; }
        catch (error) { authorizationPending = true; void authorization.finally(() => { op.lock = false; }).catch(() => {}); throw error; }
        if (authorized !== true) return invalid('host authorization rejected continuation');
        if (op.closed || closed || op.handle !== continuation) return invalid('continuation was revoked during authorization');
        op.lease.replace(next.execution ?? { modelTask: op.lease.binding.modelTask, signal: op.lease.binding.signal });
        handles.delete(continuation); op.handle = undefined;
        const result = awaitNext(op); op.lifecycle = 'running';
        if (op.gate) await reconcile(op, op.gate, 'reconcile');
        else {
          // A terminal interrupted action has no live task cursor. Reconcile only its final receipts.
          const key = `${op.id}:interrupted`;
          void gate(op, key, reason => phase(op, key, { ...base(op), phase: 'routine', reason })).then(() => {
            publish(op, freezeData({ ...report(op), state: 'completed', verification: op.decisions.get(key)!.latest as Extract<VerificationDecision, { kind: 'verified' }> }));
            releaseIfSafe(op);
          }).catch(() => {});
        }
        return await result;
      } finally { if (!authorizationPending) op.lock = false; }
    },
    asTool(toolOptions) {
      if (closed) return invalid('runner is closed');
      if (!toolOptions || typeof toolOptions.createAgent !== 'function' || typeof toolOptions.toolName !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(toolOptions.toolName)) return invalid('invalid routine tool options');
      const definition = copyRoutineDefinition(toolOptions.definition);
      let active: Promise<import('./types.js').RoutineToolResult> | undefined;
      let activeId: string | undefined;
      const dto = (value: RoutineRunResult) => {
        const references = [...new Map(value.observations.flatMap(observation => observation.sources.flatMap(source => source.reference ? [source.reference] : []))
          .map(reference => [`${reference.id}:${reference.sha256}`, reference])).values()];
        return { operationId: value.operationId, state: value.state, references: references.slice(0, 32),
          ...(references.length > 32 ? { omittedReferences: references.length - 32 } : {}) };
      };
      return { definition: { type: 'function', function: { name: toolOptions.toolName, description: definition.description,
        parameters: { type: 'object', properties: Object.fromEntries((definition.parameters ?? []).map(parameter => [parameter.name, { description: parameter.description }])),
          required: (definition.parameters ?? []).filter(parameter => parameter.required).map(parameter => parameter.name), additionalProperties: false } } },
        async execute(args, context) {
          if (activeId) {
            const op = operations.get(activeId);
            if (op) return op.last ? dto(op.last) : { operationId: activeId, state: 'uncertain' as const, references: [] };
            activeId = undefined;
          }
          if (active) return active;
          if (closed || activeCount() + reserved >= capacity) return invalid('runner is closed or at capacity');
          reserved++;
          const work = (async () => {
            let child: Agent | undefined, accepted = false, reservation = true;
            try {
              const binding = toolOptions.resolveExecution?.(args, context) ?? {};
              const signal = AbortSignal.any([context?.signal, binding.signal].filter((value): value is AbortSignal => !!value)); signal.throwIfAborted();
              child = await toolOptions.createAgent();
              if (closed) return invalid('runner closed during child creation');
              signal.throwIfAborted();
              reserved--; reservation = false;
              const resultPromise = start({ definition, agent: child, inputs: args, execution: { modelTask: binding.modelTask, signal } }, true);
              accepted = true;
              const op = [...operations.values()].find(value => value.request.agent === child); activeId = op?.id;
              const result = await resultPromise; activeId = result.operationId; return dto(result);
            } finally {
              if (reservation) reserved--;
              if (!accepted && child) {
                // A rejected active/reused caller remains borrowed; only an idle fresh child is safe to dispose.
                try { const unused = acquireComposition(child); unused.release(); child.destroy(); } catch { /* busy/destroyed/foreign */ }
              }
              active = undefined;
            }
          })();
          active = work; return work;
        } };
    },
    inspect(id) {
      const op = operations.get(id); return op ? freezeData({ operationId: id, lifecycle: op.lifecycle, lastResult: op.last,
        accounting: op.lease.binding.modelTask ? 'shared' : 'independent', closed: op.closed, ...(op.cleanupError ? { cleanupError: op.cleanupError } : {}),
        ...op.data.inspectSources(), sourceIndexId: op.data.sourceIndexId }) : null;
    },
    async readSource(id, sourceId, readOptions) {
      const op = operations.get(id); if (!op) return invalid('unknown operation'); return op.data.read(sourceId, readOptions?.maxBytes);
    },
    acknowledgeSource(id, sourceId, reference) {
      const op = operations.get(id); if (!op) return invalid('unknown operation'); op.data.acknowledge(sourceId, reference); releaseIfSafe(op);
    },
    close() {
      closed = true;
      for (const op of operations.values()) {
        op.closed = true;
        op.data.protectSince(op.deliveredThrough);
        // Only this composition owns these deliveries; raw/evidence sources remain
        // protected above. Closing must not start another model call.
        op.request.agent.cancelAllAsyncTools();
        phase(op, `${op.id}:closed`, { ...base(op), phase: 'routine', reason: 'reconcile' });
        if (op.handle) handles.delete(op.handle); op.handle = undefined;
        op.lease.cancel(abortError()); op.gate?.reject(abortError());
        if (op.last?.state === 'waiting' || op.last?.state === 'blocked' || op.last?.state === 'uncertain') op.lifecycle = 'settling';
        releaseIfSafe(op);
      }
    },
  };
  return runner;
}
