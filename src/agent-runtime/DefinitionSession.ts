import type { RuntimeFileTransfers } from './RuntimeFileTransfers.js';
import { randomUUID } from 'node:crypto';
import { AgentDriverConfigurationError, AgentBusyError, AgentEventHistoryExpiredError, AgentSessionRecoveryError } from './errors.js';
import { cloneAndFreezeJson, contentDigest, errorMessage } from './internal.js';
import { controlJson, controlValue, type RuntimeControl } from './RuntimeSessionStorage.js';
import type { AgentRun, AgentRunInput, AgentRunResult, AgentSession, JsonObject, RuntimeRunOptions, RuntimeSession, RuntimeSessionReference, RuntimeSessionSnapshot } from './types.js';
import type { DriverSession } from './AgentDriver.js';

export interface DefinitionSessionServices {
  files?: RuntimeFileTransfers;
  control?: RuntimeControl;
  start?: (input: AgentRunInput, options: RuntimeRunOptions, runId: string) => Promise<AgentRun>;
  detachObserver?: () => void;
  drainTools?: () => Promise<void>;
  onDetach?: () => void;
}

/** Logical observer and acknowledged control ledger over the unchanged execution kernel. */
export class DefinitionSession implements RuntimeSession {
  private detached = false;
  private transfer?: Promise<unknown>;
  private admission?: Promise<AgentRun>;
  private admissionAbort?: AbortController;
  private closed = false;
  private readonly requests = new Map<string, { digest: string; run: Promise<AgentRun> }>();
  private readonly runs = new Map<string, AgentRun>();
  private readonly pendingResults = new Map<string, AgentRunResult>();
  constructor(private readonly session: AgentSession, private readonly native: DriverSession, private readonly services: DefinitionSessionServices = {}) {}
  get id() { return this.session.id; }
  get agentId() { return this.session.agentId; }
  get capabilities() { return this.session.capabilities; }
  get state() { return this.session.state; }
  get isDestroyed() { return this.closed || this.session.isDestroyed; }
  get isDetached() { return this.detached; }
  get canReobserve() { return this.native.observationIndependent === true; }
  reference(): RuntimeSessionReference { return { version: 1, id: this.id }; }
  private assertTransfer(): RuntimeFileTransfers {
    if (this.detached || this.closed || !this.services.files) throw new AgentDriverConfigurationError('File transfer is disabled or the session is detached/closed');
    if (this.admission || this.transfer || this.state !== 'ready' || this.services.control?.data.activeRunId) throw new AgentBusyError('File transfer requires an idle, reconciled session');
    return this.services.files;
  }
  private async transferFile<T>(action: (files: RuntimeFileTransfers) => Promise<T>): Promise<T> {
    const files = this.assertTransfer();
    const pending = Promise.resolve().then(() => action(files)); this.transfer = pending;
    try { return await pending; } finally { if (this.transfer === pending) this.transfer = undefined; }
  }
  uploadFile(request: import('./types.js').RuntimeFileUpload) { return this.transferFile(files => files.upload(request)); }
  downloadArtifact(request: import('./types.js').RuntimeArtifactDownload) { return this.transferFile(files => files.download(request)); }
  async inspectState(): Promise<RuntimeSessionSnapshot> {
    const outbox = Object.values((this.services.control?.data.outbox ?? {}) as JsonObject);
    const unresolvedEffects = outbox.some(value => (value as JsonObject).state !== 'settled' || (((value as JsonObject).report as JsonObject | undefined)?.outcome as JsonObject | undefined)?.completion === 'unknown');
    const native = await this.native.inspectState?.();
    return native ? { ...native, unresolvedEffects: native.unresolvedEffects || unresolvedEffects } : {
      connection: this.detached ? 'reconnecting' : 'attached',
      activity: this.state === 'running' ? 'running' : this.state === 'failed' ? 'unknown' : this.isDestroyed ? 'terminal' : 'ready',
      unresolvedEffects: this.state === 'failed' || unresolvedEffects,
    };
  }
  run(input: AgentRunInput, options: RuntimeRunOptions = {}): Promise<AgentRun> {
    if (this.transfer) return Promise.reject(new AgentBusyError('File transfer is still active'));
    if (this.detached || this.closed) return Promise.reject(new AgentBusyError('Session observer is detached/closed; resume its reference'));
    if (Object.keys(options).some(key => !['signal','requestId','model','reasoning','responseFormat','metadata'].includes(key))) return Promise.reject(new AgentDriverConfigurationError('Unknown runtime run option; workflow/ModelTask authority is not a harness option'));
    const { signal, requestId, ...recorded } = options;
    const payload = cloneAndFreezeJson({ input, options: recorded }, 'Run request');
    const digest = contentDigest(payload);
    if (requestId !== undefined && (typeof requestId !== 'string' || !requestId.trim())) return Promise.reject(new AgentDriverConfigurationError('requestId must be non-empty'));
    const prior = requestId ? this.requests.get(requestId) : undefined;
    if (prior) {
      if (prior.digest !== digest) return Promise.reject(new AgentDriverConfigurationError('requestId was already used with different input/options'));
      return prior.run;
    }
    if (this.requests.size >= 1024) return Promise.reject(new AgentBusyError('Session request ledger is full; create a new session'));
    if (this.admission) return Promise.reject(new AgentBusyError('Run admission is already active'));
    const abort = new AbortController(); this.admissionAbort = abort;
    const admittedOptions = { ...payload.options, signal: signal ? AbortSignal.any([signal, abort.signal]) : abort.signal };
    const operation: Promise<AgentRun> = Promise.resolve().then(() => this.admit(payload.input, admittedOptions, requestId, digest, controlJson(payload))).finally(() => { if (this.admission === operation) { this.admission = undefined; this.admissionAbort = undefined; } });
    this.admission = operation;
    if (requestId) this.requests.set(requestId, { digest, run: operation });
    return operation;
  }
  private async admit(input: AgentRunInput, options: RuntimeRunOptions, requestId: string | undefined, digest: string, payload: JsonObject): Promise<AgentRun> {
    if (this.closed || this.detached) throw new AgentBusyError('Session observer closed during admission');
    const control = this.services.control;
    const saved = requestId ? (control?.data.requests as JsonObject | undefined)?.[requestId] as JsonObject | undefined : undefined;
    if (saved) {
      if (saved.digest !== digest && contentDigest(((control?.data.runs as JsonObject | undefined)?.[String(saved.runId)] as JsonObject | undefined)?.payload) !== digest) throw new AgentDriverConfigurationError('requestId was already used with different input/options');
      if (saved.state === 'rejected') throw new AgentDriverConfigurationError(String(saved.message));
      return this.getRun(String(saved.runId));
    }
    options.signal?.throwIfAborted();
    if ((await this.inspectState()).unresolvedEffects) throw new AgentSessionRecoveryError('Unresolved effects require host/source reconciliation before new input', this.reference());
    if (control?.data.activeRunId) throw new AgentSessionRecoveryError('Recorded native input is still active or its acceptance is unknown; resume it without resubmission', this.reference(), String(control.data.activeRunId));
    options.signal?.throwIfAborted();
    const runId = `run_${randomUUID()}`;
    if (control) await control.update(data => {
      data.requests ??= {}; data.runs ??= {};
      if (Object.keys(data.requests as JsonObject).length >= 1024) throw new AgentBusyError('Durable request ledger is full; create a new session');
      if (data.activeRunId) throw new AgentBusyError('Session admission is already in progress');
      data.activeRunId = runId;
      (data.runs as JsonObject)[runId] = { state: 'submitting', payload, sequenceHighWater: 1000000 };
      if (requestId) (data.requests as JsonObject)[requestId] = { digest, runId, state: 'admitted' };
    });
    let run: AgentRun;
    try {
      if (this.closed || this.detached) throw new AgentBusyError('Session observer closed during admission');
      options.signal?.throwIfAborted();
      run = this.services.start ? await this.services.start(input, options, runId) : await this.session.run(input, options); }
    catch (error) {
      if (control) await control.update(data => {
        delete data.activeRunId;
        (data.runs as JsonObject)[runId] = { state: 'rejected', message: errorMessage(error) };
        if (requestId) (data.requests as JsonObject)[requestId] = { digest, runId, state: 'rejected', message: errorMessage(error) };
      });
      throw error;
    }
    return this.trackRun(run);
  }
  /** @internal Adopt an existing provider turn without sending input again. */
  trackRun(run: AgentRun): AgentRun {
    const result = run.result.then(async value => {
      if (this.session.state === 'failed' || value.error?.code === 'AGENT_SESSION_RECOVERY_REQUIRED' || this.detached) {
        if (this.services.control && !this.detached) await this.services.control.update(data => { (data.runs as JsonObject)[run.id] = { ...(data.runs as JsonObject)[run.id] as JsonObject, state: 'unknown' }; });
        throw new AgentSessionRecoveryError('Native execution is not proven terminal; recover the original run', this.reference(), run.id);
      }
      this.pendingResults.set(run.id, value);
      try { await this.persistResult(run.id, value); }
      catch (error) { throw new AgentSessionRecoveryError(`Native result is retained but control persistence failed: ${errorMessage(error)}. Retry getRun after storage repair.`, this.reference(), run.id); }
      return value;
    });
    // Internal observation must not create unhandled rejections when callers only consume events.
    void result.catch(() => undefined);
    const wrapper: AgentRun = { id: run.id, sessionId: run.sessionId, result,
      events: options => run.events(options), cancel: reason => run.cancel(reason), steer: input => run.steer(input), respondToInteraction: (id, response) => run.respondToInteraction(id, response) };
    this.runs.set(run.id, wrapper);
    return wrapper;
  }
  private async persistResult(runId: string, result: AgentRunResult): Promise<void> {
    if (this.services.control) {
      const checkpoint = await this.native.checkpoint?.();
      await this.services.control.update(data => {
        (data.runs as JsonObject)[runId] = { state: 'terminal', result: controlValue(result) };
        if (data.activeRunId === runId) delete data.activeRunId;
        if (checkpoint) data.checkpoint = checkpoint;
      });
    }
    this.pendingResults.delete(runId);
  }
  async getRun(runId: string): Promise<AgentRun> {
    const retained = this.pendingResults.get(runId);
    if (retained) { await this.persistResult(runId, retained); return terminalRun(retained); }
    const run = this.runs.get(runId);
    if (run) return run;
    const saved = (this.services.control?.data.runs as JsonObject | undefined)?.[runId] as JsonObject | undefined;
    if (saved?.state === 'terminal' && saved.result) return terminalRun(saved.result as unknown as AgentRunResult);
    if (saved) throw new AgentSessionRecoveryError('Native input has no reconciled terminal result; resume the original session without resubmitting input', this.reference(), runId);
    throw new AgentDriverConfigurationError(`Run '${runId}' is unavailable in this session`);
  }
  cancelActiveRun(reason?: string): Promise<void> { this.admissionAbort?.abort(new AgentBusyError(reason ?? 'Run admission cancelled')); return this.session.cancelActiveRun(reason); }
  async detach(): Promise<void> {
    if (this.detached) return;
    if (this.admission || this.transfer) throw new AgentBusyError('Wait for run admission or file transfer before detaching');
    if (!this.native.detach) throw new AgentDriverConfigurationError('This driver cannot detach safely');
    const checkpoint = await this.native.checkpoint?.();
    if (checkpoint) await this.services.control?.update(data => { data.checkpoint = checkpoint; });
    await this.native.detach();
    this.detached = true;
    this.services.detachObserver?.();
    await this.services.drainTools?.();
    await this.services.control?.release();
    this.services.onDetach?.();
  }
  /** @internal Process-only test/embedding drivers can keep the original session. */
  reattach(): void { if (this.services.control && this.detached) throw new AgentBusyError('Durable sessions must reacquire native observation'); this.detached = false; }
  async destroy(): Promise<void> {
    if (this.closed || this.detached) return;
    this.closed = true;
    await this.admission?.catch(() => undefined);
    await this.transfer?.catch(() => undefined);
    try {
      try { await this.session.cancelActiveRun('Session destroyed'); } catch { /* Native confirmation remains the run observer's responsibility. */ }
      await Promise.allSettled([...this.runs.values()].map(run => run.result));
      await this.session.destroy();
    } finally { await this.services.control?.release(); }
  }
}
function terminalRun(result: AgentRunResult): AgentRun {
  return { id: result.runId, sessionId: result.sessionId, result: Promise.resolve(cloneAndFreezeJson(result, 'Saved run result')),
    events: () => { throw new AgentEventHistoryExpiredError(result.runId); }, cancel: async () => {},
    steer: async () => { throw new AgentBusyError('Run is terminal'); }, respondToInteraction: async () => { throw new AgentBusyError('Run is terminal'); } };
}
