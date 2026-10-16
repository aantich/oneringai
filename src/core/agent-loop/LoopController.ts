import { createHash } from 'node:crypto';
import { AIError, InvalidConfigError } from '../../domain/errors/AIErrors.js';
import type { ToolExecutionOutcome } from '../../domain/entities/Tool.js';
import { json } from '../evidence/validation.js';
import { withAbort } from '../tool-execution/cancellation.js';
import type {
  AgentLoopPolicy, AgentLoopDiagnostics, AgentLoopReason, AgentLoopObservation,
  AgentLoopCheckContext, AgentLoopCompletionResult,
} from './types.js';

/** Internal admission stop, distinct from a tool's execution outcome. */
export class AgentLoopStop extends AIError {
  constructor() { super('Managed loop policy stopped before tool execution', 'AGENT_LOOP_STOP', 409); }
}

type Effect = AgentLoopObservation['effect'];
type Observed = { fingerprint?: string; repeats: number; admitted: boolean };

function fingerprint(value: unknown): string | undefined {
  try {
    const plain = JSON.parse(json(value, 65536));
    const canonical = (v: unknown): unknown => Array.isArray(v) ? v.map(canonical)
      : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical((v as Record<string, unknown>)[k])])) : v;
    return createHash('sha256').update(JSON.stringify(canonical(plain))).digest('hex');
  } catch { return undefined; }
}

/** One managed execution; no model/tool execution or persistent authority. */
export class LoopController {
  private readonly policy: AgentLoopPolicy;
  private readonly observations: AgentLoopObservation[] = [];
  private readonly calls = new Map<string, Observed>();
  private readonly seenCalls = new Set<string>();
  private readonly observedCallIds = new Set<string>();
  private readonly diagnostics: AgentLoopDiagnostics;
  private admissions = 0;
  private progress?: string;
  private lastBatchFailure = false;
  private lastBatchRepeat = false;
  private stopped = false;

  constructor(policy: AgentLoopPolicy, executionId: string) {
    if (!policy || typeof policy !== 'object' || Array.isArray(policy)) throw new InvalidConfigError('loopPolicy must be a host policy object');
    if (policy.repeatableReadTools !== undefined && !Array.isArray(policy.repeatableReadTools)) throw new InvalidConfigError('Invalid repeatableReadTools');
    // Capture callbacks explicitly: structural policies may use prototype methods
    // and private host state. Spreading loses those methods and their receiver.
    this.policy = { repeatableReadTools: [...(policy.repeatableReadTools ?? [])] };
    for (const key of ['progressKey', 'completion'] as const) {
      const callback = policy[key];
      if (callback !== undefined && typeof callback !== 'function') throw new InvalidConfigError(`Invalid loopPolicy.${key}`);
      if (key === 'progressKey') this.policy.progressKey = callback?.bind(policy) as AgentLoopPolicy['progressKey'];
      else this.policy.completion = callback?.bind(policy) as AgentLoopPolicy['completion'];
    }
    for (const [key, fallback, zero] of [
      ['maxRecoveryAttempts', 2, true], ['maxRepeatedResults', 3, false],
      ['maxConsecutiveToolFailures', 3, false], ['maxStalledIterations', 3, false],
      ['callbackTimeoutMs', 10000, false],
    ] as const) {
      const value = policy[key] ?? fallback;
      if (!Number.isSafeInteger(value) || value < (zero ? 0 : 1) || value > (key === 'callbackTimeoutMs' ? 60000 : 1000)) {
        throw new InvalidConfigError(`Invalid loopPolicy.${key}`);
      }
      this.policy[key] = value;
    }
    if (!Array.isArray(this.policy.repeatableReadTools) || this.policy.repeatableReadTools.length > 100
      || this.policy.repeatableReadTools.some(name => typeof name !== 'string' || !name || name.length > 256)) {
      throw new InvalidConfigError('Invalid repeatableReadTools');
    }
    this.diagnostics = { version: 1, executionId, phase: 'running', iterations: 0,
      recoveryAttempts: 0, observedToolCalls: 0, consecutiveToolFailures: 0,
      repeatedResults: 0, stalledIterations: 0, uncertainEffects: [] };
  }

  get isStopped(): boolean { return this.stopped; }
  get hasCompletionCheck(): boolean { return !!this.policy.completion; }
  snapshot(): AgentLoopDiagnostics { return structuredClone(this.diagnostics); }
  step(): void { this.diagnostics.iterations++; if (!this.stopped) this.diagnostics.phase = 'running'; }
  finish(reason: AgentLoopReason, detail?: string): void {
    this.stopped = true;
    delete this.diagnostics.status;
    delete this.diagnostics.detail;
    Object.assign(this.diagnostics, { reason, phase: reason === 'completed' ? 'complete'
      : reason === 'answer_returned' || reason === 'refusal' || reason === 'provider_failed' || reason === 'cancelled' ? 'stopped' : 'input_needed' });
    if (detail) this.diagnostics.detail = detail.slice(0, 400);
    if (reason === 'completed') this.diagnostics.status = 'completed';
    else if (reason === 'cancelled') this.diagnostics.status = 'cancelled';
    else if (reason === 'provider_failed') this.diagnostics.status = 'failed';
    else if (reason === 'pending_async' || reason === 'suspended') this.diagnostics.status = 'waiting_external';
    else if (this.diagnostics.phase === 'input_needed') this.diagnostics.status = 'blocked';
  }

  private key(name: string, args: unknown): string | undefined { return fingerprint([name, args]); }
  admit(name: string, args: unknown, effect: Effect): void {
    if (this.stopped) throw new AgentLoopStop();
    if (this.admissions >= 1000 || this.diagnostics.observedToolCalls >= 1000) { this.finish('no_progress', 'Invocation tracking capacity reached'); throw new AgentLoopStop(); }
    const key = this.key(name, args);
    if (!key) {
      if (effect !== 'read') { this.finish('no_progress', 'Action arguments cannot be safely fingerprinted within the tracking bound'); throw new AgentLoopStop(); }
      this.admissions++;
      return;
    }
    const previous = this.calls.get(key);
    if (effect !== 'read' && previous?.admitted) {
      this.finish('repeated_action'); throw new AgentLoopStop();
    }
    if (effect === 'read' && !this.policy.repeatableReadTools!.includes(name)
      && previous?.fingerprint && previous.repeats >= this.policy.maxRepeatedResults!) {
      this.finish('repeated_results'); throw new AgentLoopStop();
    }
    if (!previous && this.calls.size >= 1000) {
      this.finish('no_progress', 'Distinct invocation tracking capacity reached'); throw new AgentLoopStop();
    }
    const admitted = previous ?? { repeats: 0, admitted: false };
    if (effect !== 'read') admitted.admitted = true;
    this.calls.set(key, admitted);
    this.admissions++;
  }

  observe(name: string, args: unknown, result: unknown, outcome: ToolExecutionOutcome | undefined, effect: Effect, callId?: string): void {
    const identity = outcome?.executionId ?? callId;
    if (identity && this.seenCalls.has(identity)) return;
    if (this.diagnostics.observedToolCalls >= 1000 || this.observedCallIds.size >= 1000) {
      this.finish('no_progress', 'Observation tracking capacity reached'); return;
    }
    if (identity) this.seenCalls.add(identity);
    if (callId) this.observedCallIds.add(callId);
    this.diagnostics.observedToolCalls++;
    const clean = (value: unknown): unknown => Array.isArray(value) ? value.map(clean)
      : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).filter(([key, v]) => v !== undefined && key !== 'error').map(([key, v]) => [key, clean(v)])) : value;
    const cleanOutcome = outcome ? clean(outcome) as AgentLoopObservation['outcome'] : undefined;
    this.observations.push(structuredClone({ toolName: name, ...(callId ? { callId } : {}), effect, ...(cleanOutcome ? { outcome: cleanOutcome } : {}) }));
    if (this.observations.length > 100) this.observations.shift();
    const failed = !outcome || outcome.status !== 'succeeded';
    this.diagnostics.consecutiveToolFailures = failed ? this.diagnostics.consecutiveToolFailures + 1 : 0;
    this.lastBatchFailure ||= failed;
    if (effect !== 'read' && (!outcome || outcome.completion === 'unknown')) {
      this.diagnostics.uncertainEffects.push({ toolName: name, ...(callId ? { callId } : {}), ...(outcome ? { executionId: outcome.executionId } : {}) });
      this.finish('uncertain_effect');
    }
    const key = this.key(name, args);
    if (key) {
      const prior = this.calls.get(key) ?? { repeats: 0, admitted: effect !== 'read' };
      if (outcome?.completion === 'not_started') prior.admitted = false;
      const next = fingerprint([result, outcome?.status ?? 'unknown', outcome?.completion ?? 'unknown']);
      prior.repeats = next ? next === prior.fingerprint ? prior.repeats + 1 : 1 : 0;
      prior.fingerprint = next;
      this.calls.set(key, prior);
      this.diagnostics.repeatedResults = prior.repeats;
      if (effect === 'read' && next && prior.repeats >= this.policy.maxRepeatedResults!
        && !this.policy.repeatableReadTools!.includes(name)) this.lastBatchRepeat = true;
    }
  }

  noteFailure(callId: string): void {
    if (this.observedCallIds.has(callId)) return;
    if (this.observedCallIds.size >= 1000) { this.finish('no_progress', 'Failure tracking capacity reached'); return; }
    this.observedCallIds.add(callId); this.lastBatchFailure = true;
    this.diagnostics.consecutiveToolFailures++;
  }

  private recover(reason: AgentLoopReason, feedback: string): string | undefined {
    if (this.stopped) return undefined;
    if (this.diagnostics.recoveryAttempts >= this.policy.maxRecoveryAttempts!) {
      this.finish('recovery_exhausted', reason); return undefined;
    }
    this.diagnostics.recoveryAttempts++;
    this.diagnostics.phase = 'recovering'; this.diagnostics.reason = reason;
    return `[Host loop recovery feedback; attempt ${this.diagnostics.recoveryAttempts}/${this.policy.maxRecoveryAttempts}]\n${feedback}`;
  }

  async afterTools(context: AgentLoopCheckContext, current: () => boolean): Promise<string | undefined> {
    if (this.stopped) return undefined;
    const failure = this.lastBatchFailure, repeated = this.lastBatchRepeat;
    this.lastBatchFailure = false; this.lastBatchRepeat = false;
    if (this.diagnostics.consecutiveToolFailures >= this.policy.maxConsecutiveToolFailures!) {
      this.finish('tool_failures'); return undefined;
    }
    if (this.policy.progressKey) {
      const value = await this.callback(signal => this.policy.progressKey!(Object.freeze({ ...context, signal })), context.signal, current);
      if (this.stopped) return undefined;
      if (typeof value !== 'string' || value.length > 4000) { this.finish('checker_error'); return undefined; }
      this.diagnostics.stalledIterations = value === this.progress ? this.diagnostics.stalledIterations + 1 : 0;
      this.progress = value;
      if (this.diagnostics.stalledIterations >= this.policy.maxStalledIterations!) {
        this.diagnostics.stalledIterations = 0;
        return this.recover('no_progress', 'Host progress state is unchanged. Inspect the evidence and choose a different safe step, or ask for the missing input.');
      }
    }
    if (failure) return this.recover('tool_failures', 'A tool attempt failed. Inspect its observation and choose a safe correction. Do not repeat a write whose effect is uncertain.');
    if (repeated) return this.recover('repeated_results', 'The same normalized call returned the same observation repeatedly. Choose another safe approach or ask for missing input.');
    return undefined;
  }

  checkContext(outputText: string, iteration: number, signal: AbortSignal, taskState?: AgentLoopCheckContext['taskState']): AgentLoopCheckContext {
    const data = JSON.parse(json({ executionId: this.diagnostics.executionId, iteration,
      outputText: outputText.slice(0, 32768), outputTruncated: outputText.length > 32768,
      observations: this.observations, observedToolCalls: this.diagnostics.observedToolCalls,
      observationsTruncated: this.diagnostics.observedToolCalls > this.observations.length,
      ...(taskState ? { taskState } : {}) }, 1048576));
    const freeze = (value: unknown): void => {
      if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
    };
    freeze(data);
    return Object.freeze({ ...data, signal });
  }

  async candidate(context: AgentLoopCheckContext, current: () => boolean, status?: string, stopReason?: string): Promise<string | undefined> {
    if (this.stopped) return undefined;
    if (stopReason === 'refusal') { this.finish('refusal'); return undefined; }
    if (status !== 'completed') {
      this.finish(status === 'cancelled' ? 'cancelled' : status === 'incomplete' ? 'provider_incomplete'
        : status === 'queued' || status === 'in_progress' ? 'pending_async' : status === 'suspended' ? 'suspended' : 'provider_failed');
      return undefined;
    }
    if (!this.policy.completion) { this.finish('answer_returned'); return undefined; }
    const value = await this.callback(signal => this.policy.completion!(Object.freeze({ ...context, signal })), context.signal, current);
    if (this.stopped) return undefined;
    let result: AgentLoopCompletionResult;
    try {
      result = JSON.parse(json(value, 16384));
      if (!result || typeof result !== 'object' || Array.isArray(result) || typeof result.complete !== 'boolean'
        || Object.keys(result).some(key => !['complete', 'reason', 'feedback'].includes(key))
        || (result.reason !== undefined && (typeof result.reason !== 'string' || result.reason.length > 400))
        || (result.feedback !== undefined && (typeof result.feedback !== 'string' || result.feedback.length > 2000))) throw new Error();
    } catch { this.finish('checker_error'); return undefined; }
    this.diagnostics.completion = { complete: result.complete, ...(result.reason !== undefined ? { reason: result.reason } : {}) };
    if (result.complete) { this.finish('completed', result.reason); return undefined; }
    return this.recover('predicate_unmet', result.feedback ?? result.reason ?? 'Required host completion evidence is missing. Take a safe step to obtain it or ask for missing input.');
  }

  private async callback<T>(invoke: (signal: AbortSignal) => T | Promise<T>, signal: AbortSignal, current: () => boolean): Promise<T | undefined> {
    signal.throwIfAborted();
    const bounded = AbortSignal.any([signal, AbortSignal.timeout(this.policy.callbackTimeoutMs!)]);
    try {
      const value = await withAbort(Promise.resolve(invoke(bounded)), bounded);
      signal.throwIfAborted();
      if (!current()) { this.finish('state_changed'); return undefined; }
      return value;
    } catch (error) {
      signal.throwIfAborted(); this.finish(error instanceof AIError && error.code === 'MODEL_BUDGET_EXCEEDED' ? 'budget_exhausted' : 'checker_error'); return undefined;
    }
  }
}
