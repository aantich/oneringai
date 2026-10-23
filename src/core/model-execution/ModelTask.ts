import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { AIError, InvalidConfigError } from '../../domain/errors/AIErrors.js';
import { calculateCost } from '../../domain/entities/Model.js';
import type { TokenUsage } from '../../domain/entities/Response.js';
import { createExecutionSignal, withAbort } from '../tool-execution/cancellation.js';
import type { ModelAttemptRecord, ModelCallDescriptor, ModelInvocationRecord, ModelTaskLimits, ModelTaskSnapshot } from './types.js';

export class ModelBudgetExceededError extends AIError {
  constructor(public readonly limit: string) {
    super(`Model task cannot admit another attempt: ${limit}`, 'MODEL_BUDGET_EXCEEDED');
    this.name = 'ModelBudgetExceededError';
    Object.setPrototypeOf(this, ModelBudgetExceededError.prototype);
  }
}

interface InvocationState {
  signal: AbortSignal;
  beginTransport(): ModelAttemptRecord;
  endTransport(attempt: ModelAttemptRecord, status?: number): void;
}
const invocationStorage = new AsyncLocalStorage<InvocationState>();
/** @internal Counting/discovery are bounded auxiliary I/O, not generation attempts. */
export function withoutModelTracking<T>(operation: () => T): T { return invocationStorage.exit(operation); }
const instrumentedProviders = new WeakSet<object>();
const separateReasoningUsages = new WeakSet<TokenUsage>();
const failedModelUsages = new WeakMap<object, TokenUsage>();
/** @internal A decoded but unusable response can still carry acknowledged billable usage. */
export function markFailedModelUsage(error: unknown, usage: TokenUsage | null): void {
  if (error && typeof error === 'object' && usage) failedModelUsages.set(error, usage);
}
/** @internal Do not infer usage from arbitrary exception properties. */
export function getFailedModelUsage(error: unknown): TokenUsage | undefined {
  return error && typeof error === 'object' ? failedModelUsages.get(error) : undefined;
}

/** @internal Preserve legacy response fields while recording inclusive output usage. */
export function markSeparateReasoningUsage(usage: TokenUsage): void { separateReasoningUsages.add(usage); }

/** @internal GenerateContent reports visible output and thinking separately. */
export function getModelAccountingUsage(value: TokenUsage): TokenUsage {
  if (!separateReasoningUsages.has(value)) return value;
  const output = value.output_tokens + (value.output_tokens_details?.reasoning_tokens ?? 0);
  return { ...value, output_tokens: output, total_tokens: Math.max(value.total_tokens, value.input_tokens + output) };
}

function copyUsage(value: TokenUsage | undefined | null): TokenUsage | undefined {
  if (value) value = getModelAccountingUsage(value);
  if (!value || ![value.input_tokens, value.output_tokens, value.total_tokens].every(n => Number.isSafeInteger(n) && n >= 0)) return undefined;
  const usage: TokenUsage = { input_tokens: value.input_tokens, output_tokens: value.output_tokens,
    total_tokens: Math.max(value.total_tokens, value.input_tokens + value.output_tokens) };
  for (const key of ['cached_input_tokens', 'cache_creation_input_tokens', 'cost_usd_ticks'] as const) {
    const n = value[key];
    if (n !== undefined) { if (!Number.isSafeInteger(n) || n < 0) return undefined; usage[key] = n; }
  }
  if ((usage.cached_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) > usage.input_tokens) return undefined;
  if (value.output_tokens_details) {
    const n = value.output_tokens_details.reasoning_tokens;
    if (!Number.isSafeInteger(n) || n < 0 || n > usage.output_tokens) return undefined;
    usage.output_tokens_details = { reasoning_tokens: n };
  }
  if (value.cache_creation_details) {
    usage.cache_creation_details = {};
    for (const key of ['short_ttl_input_tokens', 'extended_ttl_input_tokens'] as const) {
      const n = value.cache_creation_details[key];
      if (n !== undefined) { if (!Number.isSafeInteger(n) || n < 0) return undefined; usage.cache_creation_details[key] = n; }
    }
  }
  if (value.native_tool_calls) usage.native_tool_calls = Object.fromEntries(Object.entries(value.native_tool_calls)
    .filter(([, n]) => n !== undefined && Number.isSafeInteger(n) && n >= 0).sort(([left], [right]) => left.localeCompare(right)));
  for (const key of ['processing_mode', 'service_tier', 'speed'] as const) if (value[key] !== undefined) Object.assign(usage, { [key]: value[key] });
  return usage;
}

/** @internal A single registry multiplier cannot price contradictory/composite modes. */
export function hasConflictingModelPricing(usage: Partial<TokenUsage>): boolean {
  const modes = [usage.processing_mode === 'standard' ? 'interactive' : usage.processing_mode,
    usage.speed === 'fast' ? 'fast' : undefined,
    usage.service_tier === 'priority' ? 'priority' : usage.service_tier === 'flex' ? 'flex' : undefined,
  ].filter(mode => mode !== undefined);
  return new Set(modes).size > 1;
}

function usageCost(model: string, usage: TokenUsage): number | null {
  const mode = usage.processing_mode ?? (usage.speed === 'fast' ? 'fast'
    : usage.service_tier === 'priority' ? 'priority' : usage.service_tier === 'flex' ? 'flex' : undefined);
  if (hasConflictingModelPricing(usage) || (usage.speed && !['standard', 'fast'].includes(usage.speed))
    || (usage.service_tier && !['default', 'standard', 'standard_only', 'priority', 'flex'].includes(usage.service_tier))) return null;
  return calculateCost(model, usage.input_tokens, usage.output_tokens, {
    cachedInputTokens: usage.cached_input_tokens, cacheCreationInputTokens: usage.cache_creation_input_tokens,
    cacheCreationDetails: { shortTtlInputTokens: usage.cache_creation_details?.short_ttl_input_tokens,
      extendedTtlInputTokens: usage.cache_creation_details?.extended_ttl_input_tokens }, processingMode: mode,
  });
}
/** @internal Providers opt in only after installing their SDK fetch adapter. */
export function registerModelTransport(provider: object): void { instrumentedProviders.add(provider); }
/** @internal */
export function hasModelTransport(provider: object): boolean { return instrumentedProviders.has(provider); }
/** @internal Preserve legacy SDK argument shape when no signal was supplied. */
export function modelRequestOptions(options: { signal?: AbortSignal }): [] | [{ signal: AbortSignal }] {
  return options.signal ? [{ signal: options.signal }] : [];
}

/** @internal No task means exactly the ordinary fetch call, without accounting. */
export const modelExecutionFetch: typeof globalThis.fetch = async (input, init) => {
  const state = invocationStorage.getStore();
  if (!state) return globalThis.fetch(input, init);
  state.signal.throwIfAborted();
  const attempt = state.beginTransport();
  const signals = [state.signal, init?.signal, input instanceof Request ? input.signal : undefined]
    .filter((signal): signal is AbortSignal => !!signal);
  try {
    const response = await globalThis.fetch(input, { ...init, signal: AbortSignal.any(signals) });
    state.endTransport(attempt, response.status);
    return response;
  } catch (error) {
    state.endTransport(attempt);
    throw error;
  }
};

/** In-process shared admission, reservations and usage. Never stores prompts or credentials. */
export class ModelTask {
  readonly id: string;
  readonly limits: Readonly<ModelTaskLimits>;
  private readonly controller = new AbortController();
  private readonly calls = new Map<string, ModelInvocationRecord>();
  private readonly attempts: ModelAttemptRecord[] = [];
  private readonly externalReports = new Map<string, string>();
  private readonly signalDispose: () => void;
  private deadlineTimer?: ReturnType<typeof setTimeout>;
  private destroyed = false;

  constructor(options: { id?: string; limits?: ModelTaskLimits; signal?: AbortSignal } = {}) {
    this.id = options.id ?? randomUUID();
    this.limits = Object.freeze({ ...options.limits });
    for (const [name, value] of Object.entries(this.limits)) {
      if (!Number.isFinite(value) || value < 0 || (['maxCalls', 'maxTokens', 'deadline'].includes(name) && !Number.isSafeInteger(value))) {
        throw new InvalidConfigError(`${name} must be a nonnegative finite ${name === 'maxCostUSD' ? 'number' : 'integer'}`);
      }
    }
    const signal = createExecutionSignal([options.signal]);
    const onAbort = (): void => this.cancel(signal.controller.signal.reason);
    signal.controller.signal.addEventListener('abort', onAbort, { once: true });
    this.signalDispose = () => { signal.controller.signal.removeEventListener('abort', onAbort); signal.dispose(); };
    if (signal.controller.signal.aborted) this.cancel(signal.controller.signal.reason);
    const armDeadline = (): void => {
      if (this.limits.deadline === undefined || this.signal.aborted) return;
      const delay = this.limits.deadline - Date.now();
      if (delay <= 0) this.cancel(new DOMException('Model task deadline exceeded', 'TimeoutError'));
      else { this.deadlineTimer = setTimeout(armDeadline, Math.min(delay, 2_147_483_647)); this.deadlineTimer.unref(); }
    };
    armDeadline();
  }

  get signal(): AbortSignal { return this.controller.signal; }

  cancel(reason: unknown = new DOMException('Model task cancelled', 'AbortError')): void {
    if (!this.controller.signal.aborted) this.controller.abort(reason);
    clearTimeout(this.deadlineTimer);
  }

  private check(): void {
    if (this.destroyed) throw new InvalidConfigError('Model task has been destroyed');
    if (this.limits.deadline !== undefined && Date.now() >= this.limits.deadline) this.cancel(new DOMException('Model task deadline exceeded', 'TimeoutError'));
    this.signal.throwIfAborted();
  }

  private reserve(call: ModelInvocationRecord, descriptor: ModelCallDescriptor, boundary: ModelAttemptRecord['boundary']): ModelAttemptRecord {
    this.check();
    for (const bound of [descriptor.inputTokenBound, descriptor.outputTokenBound]) {
      if (!Number.isSafeInteger(bound) || bound < 0) throw new InvalidConfigError('Model reservation token bounds must be nonnegative integers');
    }
    const tokens = descriptor.inputTokenBound + descriptor.outputTokenBound;
    if (!Number.isSafeInteger(tokens)) throw new InvalidConfigError('Combined model token reservation must be a safe integer');
    const price = descriptor.priceBound;
    if (price && (!Number.isFinite(price.inputPerMillion) || price.inputPerMillion < 0 || !Number.isFinite(price.outputPerMillion) || price.outputPerMillion < 0)) {
      throw new InvalidConfigError('Model price bounds must be finite nonnegative rates');
    }
    const cost = price ? (descriptor.inputTokenBound * price.inputPerMillion + descriptor.outputTokenBound * price.outputPerMillion) / 1_000_000 : null;
    if (cost !== null && !Number.isFinite(cost)) throw new InvalidConfigError('Model cost reservation must be finite');
    const totals = this.snapshot().totals;
    if (this.limits.maxCalls !== undefined && totals.calls + 1 > this.limits.maxCalls) throw new ModelBudgetExceededError('maxCalls');
    if (this.limits.maxTokens !== undefined && totals.chargedTokens + tokens > this.limits.maxTokens) throw new ModelBudgetExceededError('maxTokens');
    if (this.limits.maxCostUSD !== undefined) {
      if (cost === null || totals.chargedCostUSD === null) throw new ModelBudgetExceededError('unknown price or charge under maxCostUSD');
      if (totals.chargedCostUSD + cost > this.limits.maxCostUSD + 1e-12) throw new ModelBudgetExceededError('maxCostUSD');
    }
    const attempt: ModelAttemptRecord = { id: randomUUID(), invocationId: call.id, boundary, status: 'reserved', dispatched: false,
      reservedTokens: tokens, reservedCostUSD: cost, usageCoveredByInvocation: false };
    this.attempts.push(attempt);
    return attempt;
  }

  /** Execute one logical call; installed SDK adapters admit every physical retry separately. */
  async execute<T>(descriptor: ModelCallDescriptor, operation: (signal: AbortSignal) => Promise<T>, options: {
    signal?: AbortSignal; transport?: boolean; usage?: (result: T) => TokenUsage | undefined;
    /** @internal Latest terminal usage survives an iterator failure or cancellation. */
    observedUsage?: () => TokenUsage | undefined;
    /** @internal Final synchronous native request/authority guard, including retries. */
    beforeDispatch?: () => void;
    /** @internal Observed provider/transport dispatch after successful reservation. */
    onDispatch?: () => void;
  } = {}): Promise<{ result: T; invocationId: string }> {
    this.check();
    options.beforeDispatch?.();
    descriptor = structuredClone(descriptor);
    const call: ModelInvocationRecord = { id: randomUUID(), parentInvocationId: descriptor.parentInvocationId, purpose: descriptor.purpose,
      phase: descriptor.phase ?? 'generation', connector: descriptor.connector, model: descriptor.model, status: 'running',
      usage: null, modelCostUSD: null, lateSettlement: false, external: false };
    const composed = createExecutionSignal([this.signal, options.signal]);
    if (composed.controller.signal.aborted) { composed.dispose(); composed.controller.signal.throwIfAborted(); }
    let first: ModelAttemptRecord;
    try { first = this.reserve(call, descriptor, options.transport ? 'transport' : 'provider'); }
    catch (error) { composed.dispose(); throw error; }
    this.calls.set(call.id, call);
    let transportCount = 0;
    let callerStopped = false;
    const state: InvocationState = {
      signal: composed.controller.signal,
      beginTransport: () => {
        options.beforeDispatch?.();
        composed.controller.signal.throwIfAborted();
        let attempt: ModelAttemptRecord;
        try { attempt = transportCount++ === 0 ? first : this.reserve(call, descriptor, 'transport'); }
        catch (error) { composed.controller.abort(error); throw error; }
        try {
          options.beforeDispatch?.();
          composed.controller.signal.throwIfAborted();
        } catch (error) {
          attempt.status = 'not_dispatched'; attempt.reservedTokens = 0; attempt.reservedCostUSD = 0;
          throw error;
        }
        attempt.boundary = 'transport';
        attempt.dispatched = true;
        options.onDispatch?.();
        return attempt;
      },
      endTransport: (attempt, status) => {
        attempt.httpStatus = status;
        attempt.status = status !== undefined && status >= 200 && status < 300 ? 'received' : 'failed';
      },
    };
    const settle = (result?: T): void => {
      const observed = copyUsage(result === undefined ? options.observedUsage?.() : options.usage?.(result));
      // Legacy SDK converters retain zero-filled public usage when the wire
      // response omits it. Conservatively keep that transport charge unknown.
      const usage = options.transport && observed?.total_tokens === 0 ? undefined : observed;
      if (usage) {
        call.usage = usage;
        call.modelCostUSD = usageCost(descriptor.model, usage);
        const covered = this.attempts.filter(a => a.invocationId === call.id && (a.status === 'received' || a.boundary === 'provider'));
        for (const attempt of covered) { attempt.usageCoveredByInvocation = true; attempt.reservedTokens = 0; attempt.reservedCostUSD = 0; }
        const last = covered.at(-1);
        if (last) {
          last.reservedTokens = usage.total_tokens;
          // Budget charges retain the host's upper rates even when registry
          // estimates are lower than this deployment's actual token prices.
          const boundedCost = descriptor.priceBound
            ? (usage.input_tokens * descriptor.priceBound.inputPerMillion + usage.output_tokens * descriptor.priceBound.outputPerMillion) / 1_000_000 : null;
          last.reservedCostUSD = boundedCost === null ? call.modelCostUSD : Math.max(boundedCost, call.modelCostUSD ?? 0);
        }
      }
      if (!first.dispatched) { first.status = 'not_dispatched'; first.reservedTokens = 0; first.reservedCostUSD = 0; }
      call.lateSettlement = callerStopped;
    };
    const pending = invocationStorage.run(state, async () => {
      try {
        if (!options.transport) {
          options.beforeDispatch?.();
          composed.controller.signal.throwIfAborted();
          first.dispatched = true;
          options.onDispatch?.();
        }
        const result = await operation(composed.controller.signal);
        if (!options.transport) first.status = 'received';
        settle(result);
        if (!callerStopped) call.status = composed.controller.signal.aborted ? 'cancelled' : 'succeeded';
        return result;
      } catch (error) {
        if (!options.transport) first.status = 'failed';
        settle();
        if (!callerStopped) call.status = composed.controller.signal.aborted ? 'cancelled' : 'failed';
        throw error;
      }
    });
    try { return { result: await withAbort(pending, composed.controller.signal), invocationId: call.id }; }
    catch (error) {
      // A stream may already have reported final usage while its iterator is
      // still pending. Preserve it immediately, independently of late cleanup.
      if (options.observedUsage) settle();
      callerStopped = true;
      call.status = composed.controller.signal.aborted ? 'cancelled' : 'failed';
      throw error;
    }
    finally { composed.dispose(); }
  }

  /** Streaming variant with pull-based backpressure and invocation-local transport tracking. */
  async *iterate<T>(descriptor: ModelCallDescriptor, factory: (signal: AbortSignal) => AsyncIterable<T>, options: {
    signal?: AbortSignal; transport?: boolean; usage?: (event: T) => TokenUsage | undefined;
    beforeDispatch?: () => void;
    /** @internal Observed provider/transport dispatch after successful reservation. */
    onDispatch?: () => void;
  } = {}): AsyncIterableIterator<T> {
    const stop = new AbortController();
    const composed = createExecutionSignal([options.signal, stop.signal]);
    let next!: () => Promise<IteratorResult<T>>;
    let close: (() => Promise<unknown>) | undefined;
    let actualSignal: AbortSignal | undefined;
    let usage: TokenUsage | undefined;
    let readyResolve!: () => void; let readyReject!: (error: unknown) => void;
    const ready = new Promise<void>((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
    let finish!: () => void; let fail!: (error: unknown) => void;
    const completion = new Promise<void>((resolve, reject) => { finish = resolve; fail = reject; });
    void completion.catch(() => undefined);
    const work = this.execute(descriptor, async signal => {
      const iterator = factory(signal)[Symbol.asyncIterator]();
      const state = invocationStorage.getStore()!;
      actualSignal = signal;
      next = () => invocationStorage.run(state, () => iterator.next());
      close = async () => invocationStorage.run(state, () => iterator.return?.());
      readyResolve();
      await completion;
      return usage;
    }, { signal: composed.controller.signal, transport: options.transport, usage: value => value, observedUsage: () => usage, beforeDispatch: options.beforeDispatch, onDispatch: options.onDispatch });
    void work.catch(readyReject);
    let ended = false;
    try {
      await ready;
      for (;;) {
        const item = await withAbort(next(), actualSignal);
        if (item.done) { ended = true; finish(); await work; return; }
        const observed = options.usage?.(item.value);
        if (observed) {
          const validated = copyUsage(observed);
          if (validated) {
            if (usage && JSON.stringify(usage) !== JSON.stringify(validated)) throw new InvalidConfigError('Conflicting terminal model usage');
            usage = validated;
          }
        }
        yield item.value;
      }
    } catch (error) { fail(error); await work.catch(() => undefined); throw error; }
    finally {
      if (!ended) {
        stop.abort(new DOMException('Model stream consumer stopped', 'AbortError'));
        finish();
        await work.catch(() => undefined);
      }
      if (close) { try { await withAbort(close(), actualSignal); } catch { /* The operation remains observed if it ignores cancellation. */ } }
      composed.dispose();
    }
  }

  /** Host-reported usage is idempotent by ID. Conflicting replays fail explicitly. */
  recordExternal(report: { id: string; purpose: string; connector: string; model: string; parentInvocationId?: string; usage: TokenUsage | null;
    status?: 'succeeded' | 'failed' | 'cancelled'; }): void {
    if (this.destroyed) throw new InvalidConfigError('Model task has been destroyed');
    const usage = copyUsage(report.usage) ?? null;
    if (!report.id || (report.usage && !usage)) throw new InvalidConfigError('Invalid external model usage');
    if (report.status !== undefined && !['succeeded', 'failed', 'cancelled'].includes(report.status)) throw new InvalidConfigError('Invalid external model status');
    const normalized = { id: report.id, purpose: report.purpose, connector: report.connector, model: report.model,
      parentInvocationId: report.parentInvocationId, usage, status: report.status ?? 'succeeded' };
    const serialized = JSON.stringify(normalized);
    const prior = this.externalReports.get(report.id);
    if (prior !== undefined) {
      if (prior !== serialized) throw new InvalidConfigError('Conflicting external model usage report');
      return;
    }
    if (this.calls.has(report.id)) throw new InvalidConfigError('External report ID collides with an invocation');
    this.externalReports.set(report.id, serialized);
    const cost = usage ? usageCost(report.model, usage) : null;
    this.calls.set(report.id, { ...normalized, phase: 'generation', usage, modelCostUSD: cost, lateSettlement: this.signal.aborted, external: true });
    this.attempts.push({ id: randomUUID(), invocationId: report.id, boundary: 'provider', status: 'received', dispatched: true,
      reservedTokens: usage?.total_tokens ?? (this.limits.maxTokens ?? 0), reservedCostUSD: cost,
      usageCoveredByInvocation: usage !== null });
  }

  /** Attach a host validation result without recounting the model usage. */
  recordValidation(invocationId: string, valid: boolean): void {
    const call = this.calls.get(invocationId);
    if (!call) throw new InvalidConfigError('Unknown model invocation for validation');
    call.outputValidation = valid ? 'passed' : 'failed';
  }

  snapshot(): ModelTaskSnapshot {
    const invocations = [...this.calls.values()];
    const active = this.attempts.filter(a => a.status !== 'not_dispatched');
    const sum = (get: (u: TokenUsage) => number): number => invocations.reduce((n, call) => n + (call.usage ? get(call.usage) : 0), 0);
    return structuredClone({ id: this.id, limits: this.limits, invocations, attempts: this.attempts,
      totals: { calls: active.length, inputTokens: sum(u => u.input_tokens), outputTokens: sum(u => u.output_tokens),
        totalTokens: sum(u => u.total_tokens), cachedInputTokens: sum(u => u.cached_input_tokens ?? 0), reasoningTokens: sum(u => u.output_tokens_details?.reasoning_tokens ?? 0),
        knownModelCostUSD: invocations.reduce((n, call) => n + (call.modelCostUSD ?? 0), 0),
        unknownUsageInvocations: invocations.filter(call => call.usage === null).length,
        unknownCostInvocations: invocations.filter(call => call.modelCostUSD === null).length,
        unknownChargeAttempts: active.filter(a => a.dispatched && !a.usageCoveredByInvocation).length,
        chargedTokens: active.reduce((n, a) => n + a.reservedTokens, 0),
        chargedCostUSD: active.some(a => a.reservedCostUSD === null) ? null : active.reduce((n, a) => n + a.reservedCostUSD!, 0),
      } });
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true; this.cancel(new DOMException('Model task destroyed', 'AbortError')); this.signalDispose();
  }
}
