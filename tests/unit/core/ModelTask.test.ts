import { afterEach, describe, expect, it, vi } from 'vitest';
import { ModelTask, ModelBudgetExceededError, modelExecutionFetch } from '@/core/model-execution/ModelTask.js';
import type { ModelCallDescriptor } from '@/core/model-execution/types.js';

const descriptor: ModelCallDescriptor = { purpose: 'main', connector: 'fixture', model: 'gpt-4o-mini',
  inputTokenBound: 80, outputTokenBound: 20, priceBound: { inputPerMillion: 1, outputPerMillion: 2 } };
const usage = { input_tokens: 10, output_tokens: 5, total_tokens: 15 };
const tasks: ModelTask[] = [];
const task = (limits: ConstructorParameters<typeof ModelTask>[0] = {}) => { const value = new ModelTask(limits); tasks.push(value); return value; };
afterEach(() => { tasks.splice(0).forEach(t => t.destroy()); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('process-local shared model tasks', () => {
  it('reserves synchronously across concurrent callers, then refunds unused tokens on known settlement', async () => {
    const t = task({ limits: { maxTokens: 100 } });
    let release!: () => void;
    const running = t.execute(descriptor, async () => { await new Promise<void>(resolve => { release = resolve; }); return usage; }, { usage: u => u });
    void running.catch(() => undefined);
    const rejected = vi.fn(async () => usage);
    await expect(t.execute(descriptor, rejected)).rejects.toBeInstanceOf(ModelBudgetExceededError);
    expect(rejected).not.toHaveBeenCalled();
    expect(t.snapshot().totals.chargedTokens).toBe(100);
    release(); await running;
    await t.execute({ ...descriptor, inputTokenBound: 60 }, async () => usage, { usage: u => u });
    expect(t.snapshot().totals).toMatchObject({ calls: 2, totalTokens: 30, chargedTokens: 30 });
  });

  it('does not refund calls, unknown usage or failed-attempt reservations', async () => {
    const t = task({ limits: { maxCalls: 1, maxTokens: 100 } });
    await expect(t.execute(descriptor, async () => { throw new Error('unknown remote completion'); })).rejects.toThrow('unknown remote');
    expect(t.snapshot().totals).toMatchObject({ calls: 1, unknownUsageInvocations: 1, unknownChargeAttempts: 1, chargedTokens: 100 });
    await expect(t.execute(descriptor, async () => usage)).rejects.toThrow('maxCalls');
  });

  it('tracks retries at fetch admission and counts aggregate success usage only once', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response('', { status: 503 })).mockResolvedValueOnce(new Response('{}'));
    vi.stubGlobal('fetch', fetch);
    const t = task({ limits: { maxCalls: 3, maxTokens: 300 } });
    await t.execute(descriptor, async () => {
      await modelExecutionFetch('https://fixture.invalid/generate');
      await modelExecutionFetch('https://fixture.invalid/generate');
      return usage;
    }, { transport: true, usage: u => u });
    const result = t.snapshot();
    expect(result.attempts.map(a => a.httpStatus)).toEqual([503, 200]);
    expect(result.totals).toMatchObject({ calls: 2, totalTokens: 15, unknownChargeAttempts: 1, chargedTokens: 115 });
    expect(result.invocations).toHaveLength(1);
  });

  it('prevents a physical retry when its reservation cannot be admitted', async () => {
    const fetch = vi.fn(async () => new Response('', { status: 429 })); vi.stubGlobal('fetch', fetch);
    const t = task({ limits: { maxCalls: 1 } });
    await expect(t.execute(descriptor, async () => {
      await modelExecutionFetch('https://fixture.invalid/generate');
      await modelExecutionFetch('https://fixture.invalid/generate');
    }, { transport: true })).rejects.toThrow('maxCalls');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(t.snapshot().totals.calls).toBe(1);
  });

  it('preserves multiple successful transport attempts and their aggregate usage without double charging', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}')));
    const t = task();
    await t.execute(descriptor, async () => {
      await modelExecutionFetch('https://fixture.invalid/generate');
      await modelExecutionFetch('https://fixture.invalid/continue'); return usage;
    }, { transport: true, usage: u => u });
    expect(t.snapshot().totals).toMatchObject({ calls: 2, totalTokens: 15, chargedTokens: 15, unknownChargeAttempts: 0 });
    expect(t.snapshot().attempts.every(a => a.usageCoveredByInvocation)).toBe(true);
  });

  it('refunds undispatched reservations after provider preflight failure', async () => {
    const t = task({ limits: { maxCalls: 1 } });
    await expect(t.execute(descriptor, async () => { throw new Error('preflight'); }, { transport: true })).rejects.toThrow('preflight');
    expect(t.snapshot().totals).toMatchObject({ calls: 0, chargedTokens: 0 });
    expect(t.snapshot().attempts[0]?.status).toBe('not_dispatched');
  });

  it('keeps unknown prices explicit and refuses a hard monetary ceiling without a bound', async () => {
    const unknown = { ...descriptor, model: 'unknown-model', priceBound: undefined };
    const t = task();
    await t.execute(unknown, async () => usage, { usage: u => u });
    expect(t.snapshot().invocations[0]?.modelCostUSD).toBeNull();
    expect(t.snapshot().totals.chargedCostUSD).toBeNull();
    const bounded = task({ limits: { maxCostUSD: 1 } }); const execute = vi.fn(async () => usage);
    await expect(bounded.execute(unknown, execute)).rejects.toThrow('unknown price'); expect(execute).not.toHaveBeenCalled();
    await bounded.execute(descriptor, async () => usage, { usage: u => u });
  });

  it('enforces a known monetary reservation before dispatch', async () => {
    const t = task({ limits: { maxCostUSD: 0.00001 } }); const execute = vi.fn(async () => usage);
    await expect(t.execute(descriptor, execute)).rejects.toThrow('maxCostUSD'); expect(execute).not.toHaveBeenCalled();
  });

  it('retains deployment upper rates after settlement instead of refunding to cheaper registry estimates', async () => {
    const request = { ...descriptor, priceBound: { inputPerMillion: 100, outputPerMillion: 100 } };
    const t = task({ limits: { maxCostUSD: 0.01 } });
    await t.execute(request, async () => usage, { usage: u => u });
    expect(t.snapshot().totals.chargedCostUSD).toBeCloseTo(0.0015);
    expect(t.snapshot().totals.knownModelCostUSD).toBeLessThan(0.0015);
    const next = vi.fn(async () => usage);
    await expect(t.execute(request, next)).rejects.toThrow('maxCostUSD');
    expect(next).not.toHaveBeenCalled();
  });

  it('does not count reasoning/cache subsets twice and detaches usage from subsequently merged responses', async () => {
    const t = task();
    const reported = { ...usage, cached_input_tokens: 6, output_tokens_details: { reasoning_tokens: 3 } };
    await t.execute(descriptor, async () => reported, { usage: u => u });
    reported.input_tokens = 100; reported.total_tokens = 105;
    const first = t.snapshot(); first.invocations[0]!.usage!.total_tokens = 999;
    expect(t.snapshot().totals).toMatchObject({ inputTokens: 10, outputTokens: 5, totalTokens: 15, cachedInputTokens: 6, reasoningTokens: 3 });
  });

  it('deduplicates external usage by ID, rejects conflicting replays and excludes unrelated credential fields', () => {
    const t = task();
    const report = { id: 'external-1', purpose: 'external', connector: 'fixture', model: 'gpt-4o-mini', usage,
      apiKey: 'MUST_NOT_APPEAR', authorization: { account: 'MUST_NOT_APPEAR' } };
    t.recordExternal(report);
    t.recordExternal({ model: report.model, usage: { total_tokens: 15, output_tokens: 5, input_tokens: 10 },
      connector: report.connector, purpose: report.purpose, id: report.id });
    expect(t.snapshot().totals).toMatchObject({ calls: 1, totalTokens: 15 });
    expect(JSON.stringify(t.snapshot())).not.toContain('MUST_NOT_APPEAR');
    expect(() => t.recordExternal({ ...report, usage: { ...usage, output_tokens: 6 } })).toThrow('Conflicting');
  });

  it.each([NaN, Infinity, -1, 0.5])('rejects malformed external usage %s without admitting it', invalid => {
    const t = task();
    expect(() => t.recordExternal({ id: 'bad', purpose: 'external', connector: 'fixture', model: 'unknown', usage: { ...usage, input_tokens: invalid } })).toThrow('Invalid external');
    expect(t.snapshot().totals.calls).toBe(0);
  });

  it('records malformed provider usage as unknown instead of making a false zero-cost claim', async () => {
    const t = task();
    await t.execute(descriptor, async () => ({ ...usage, total_tokens: NaN }), { usage: u => u });
    expect(t.snapshot().totals).toMatchObject({ totalTokens: 0, unknownUsageInvocations: 1, chargedTokens: 100 });
    expect(t.snapshot().invocations[0]?.usage).toBeNull();
  });

  it('cancels promptly, observes late settlement on the original task, and cannot affect a separate task', async () => {
    const t = task(); const controller = new AbortController(); let resolve!: (value: typeof usage) => void;
    const pending = t.execute(descriptor, async () => new Promise<typeof usage>(yes => { resolve = yes; }), { signal: controller.signal, usage: u => u });
    const rejected = pending.catch(error => error); controller.abort(new DOMException('stop', 'AbortError'));
    expect((await rejected).name).toBe('AbortError');
    const other = task(); resolve(usage);
    await vi.waitFor(() => expect(t.snapshot().invocations[0]?.lateSettlement).toBe(true));
    expect(t.snapshot().invocations[0]?.status).toBe('cancelled');
    expect(other.snapshot().totals.calls).toBe(0);
  });

  it('enforces task deadlines and cleans up its timer and abort listeners', async () => {
    vi.useFakeTimers();
    const host = new AbortController(); const remove = vi.spyOn(host.signal, 'removeEventListener');
    const t = task({ limits: { deadline: Date.now() + 20 }, signal: host.signal });
    const failure = t.execute(descriptor, async () => new Promise(() => undefined)).catch(error => error);
    await vi.advanceTimersByTimeAsync(21);
    expect((await failure).name).toBe('TimeoutError');
    t.destroy(); expect(vi.getTimerCount()).toBe(0); expect(remove).toHaveBeenCalled();
  });

  it('honors streaming backpressure and records usage once at completion', async () => {
    const t = task(); const produced = vi.fn();
    const iterator = t.iterate(descriptor, async function* () {
      produced(); yield { text: 'one' }; produced(); yield { usage };
    }, { usage: event => 'usage' in event ? event.usage : undefined });
    expect((await iterator.next()).value).toEqual({ text: 'one' }); expect(produced).toHaveBeenCalledTimes(1);
    expect((await iterator.next()).value).toEqual({ usage });
    expect((await iterator.next()).done).toBe(true);
    expect(t.snapshot().totals).toMatchObject({ calls: 1, totalTokens: 15, chargedTokens: 15 });
  });

  it.each(['failure', 'cancel', 'return'] as const)('retains terminal streaming usage exactly once on %s', async ending => {
    const t = task(); const host = new AbortController();
    const stream = t.iterate(descriptor, async function* () {
      yield usage;
      if (ending === 'failure') throw new Error('failure after final usage');
      await new Promise<void>(() => undefined);
    }, { signal: host.signal, usage: value => value });
    await stream.next();
    if (ending === 'return') await stream.return!(undefined);
    else {
      const pending = stream.next().catch(e => e);
      if (ending === 'cancel') host.abort();
      expect(await pending).toBeInstanceOf(Error);
    }
    const snapshot = t.snapshot();
    expect(snapshot.totals).toMatchObject({ calls: 1, totalTokens: 15, chargedTokens: 15, unknownUsageInvocations: 0, unknownChargeAttempts: 0 });
    expect(snapshot.invocations[0]?.status).toBe(ending === 'failure' ? 'failed' : 'cancelled');
    expect(snapshot.attempts[0]?.usageCoveredByInvocation).toBe(true);
  });

  it.each([false, true])('handles repeated terminal usage with conflict=%s', async conflict => {
    const t = task(); const stream = t.iterate(descriptor, async function* () {
      yield usage; yield { ...usage, ...(conflict ? { output_tokens: 6, total_tokens: 16 } : {}) };
    }, { usage: value => value });
    const consume = async () => { for await (const _value of stream) { /* consume */ } };
    if (conflict) await expect(consume()).rejects.toThrow('Conflicting terminal model usage');
    else await consume();
    expect(t.snapshot().totals.totalTokens).toBe(15);
    expect(t.snapshot().invocations[0]?.status).toBe(conflict ? 'failed' : 'succeeded');
  });

  it('treats reordered terminal usage metadata as the same report', async () => {
    const t = task(); const stream = t.iterate(descriptor, async function* () {
      yield { ...usage, native_tool_calls: { web_search: 1, code_execution: 2 } };
      yield { ...usage, native_tool_calls: { code_execution: 2, web_search: 1 } };
    }, { usage: value => value });
    for await (const _value of stream) { /* consume both identical reports */ }
    expect(t.snapshot().totals.totalTokens).toBe(15); expect(t.snapshot().invocations[0]?.status).toBe('succeeded');
  });

  it('retains failed retry reservations when terminal usage precedes an iterator error', async () => {
    const t = task(); vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response('', { status: 200 })));
    const stream = t.iterate(descriptor, async function* () {
      await modelExecutionFetch('https://fixture.invalid/first'); await modelExecutionFetch('https://fixture.invalid/retry');
      yield usage; throw new Error('late iterator failure');
    }, { transport: true, usage: value => value });
    await expect((async () => { for await (const _value of stream) { /* consume */ } })()).rejects.toThrow('late iterator');
    expect(t.snapshot().totals).toMatchObject({ calls: 2, totalTokens: 15, chargedTokens: 115, unknownChargeAttempts: 1 });
    expect(t.snapshot().attempts.map(a => a.usageCoveredByInvocation)).toEqual([false, true]);
  });

  it('records external outcomes with replay consistency and late cancellation diagnostics', () => {
    const t = task(); const report = { id: 'external-status', purpose: 'external', connector: 'fixture', model: 'gpt-4o-mini', usage };
    t.recordExternal(report); t.recordExternal({ ...report, status: 'succeeded' });
    expect(t.snapshot().totals.calls).toBe(1);
    expect(() => t.recordExternal({ ...report, status: 'failed' })).toThrow('Conflicting');
    t.cancel(); t.recordExternal({ ...report, id: 'late-failure', status: 'failed' });
    expect(t.snapshot().invocations[1]).toMatchObject({ status: 'failed', lateSettlement: true });
  });

  it('closes an early-exit stream without treating missing final usage as free', async () => {
    const t = task(); const closed = vi.fn(); let signal!: AbortSignal;
    const iterator = t.iterate(descriptor, async function* (selected) {
      signal = selected; try { yield 'one'; yield 'two'; } finally { closed(); }
    });
    await iterator.next(); await iterator.return!(undefined);
    expect(signal.aborted).toBe(true); expect(closed).toHaveBeenCalledTimes(1);
    expect(t.snapshot().totals).toMatchObject({ calls: 1, unknownUsageInvocations: 1, chargedTokens: 100 });
  });

  it.each([{ maxCalls: -1 }, { maxTokens: 1.5 }, { maxCostUSD: Infinity }, { deadline: NaN }])('rejects invalid task configuration %j', limits => {
    expect(() => task({ limits })).toThrow();
  });

  it('captures reservation bounds before asynchronous host mutation and does not under-admit a retry', async () => {
    const request = structuredClone(descriptor); vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })));
    const t = task({ limits: { maxTokens: 180 } });
    await expect(t.execute(request, async () => {
      await modelExecutionFetch('https://fixture.invalid/generate');
      request.inputTokenBound = 0; request.priceBound!.inputPerMillion = 0;
      await modelExecutionFetch('https://fixture.invalid/retry');
    }, { transport: true })).rejects.toThrow('maxTokens');
    expect(t.snapshot().totals.chargedTokens).toBe(100);
  });

  it('keeps unpriced processing tiers unknown instead of reporting base-rate cost', async () => {
    const t = task(); await t.execute(descriptor, async () => ({ ...usage, service_tier: 'unknown-premium' }), { usage: u => u });
    expect(t.snapshot().invocations[0]?.modelCostUSD).toBeNull(); expect(t.snapshot().totals.unknownCostInvocations).toBe(1);
  });

  it.each([
    { processing_mode: 'interactive' as const, service_tier: 'priority' },
    { processing_mode: 'standard' as const, speed: 'fast' },
    { processing_mode: 'batch' as const, service_tier: 'flex' },
    { service_tier: 'priority', speed: 'fast' },
  ])('keeps contradictory/composite external pricing unknown: %j', pricing => {
    const t = task({ limits: { maxCostUSD: 1 } });
    const report = { id: 'conflicting-price', purpose: 'external', connector: 'fixture', model: 'gpt-4o-mini', usage: { ...usage, ...pricing } };
    t.recordExternal(report); t.recordExternal(report);
    expect(t.snapshot().totals).toMatchObject({ calls: 1, totalTokens: 15, unknownCostInvocations: 1, chargedCostUSD: null });
  });

  it('accepts late external diagnostics after cancellation without reopening admission', async () => {
    const t = task(); t.cancel(new DOMException('stop', 'AbortError'));
    t.recordExternal({ id: 'late', purpose: 'external', connector: 'fixture', model: 'gpt-4o-mini', usage });
    expect(t.snapshot().totals.totalTokens).toBe(15);
    await expect(t.execute(descriptor, async () => usage)).rejects.toMatchObject({ name: 'AbortError' });
  });

  it.each([
    { inputTokenBound: -1 }, { outputTokenBound: 1.5 },
    { inputTokenBound: Number.MAX_SAFE_INTEGER, outputTokenBound: 1 },
    { priceBound: { inputPerMillion: -1, outputPerMillion: 1 } },
    { priceBound: { inputPerMillion: Number.MAX_VALUE, outputPerMillion: 1 } },
  ])('rejects invalid or overflowing public reservation bounds before operation admission: %j', async overrides => {
    const t = task(); const operation = vi.fn(async () => usage);
    await expect(t.execute({ ...descriptor, ...overrides }, operation)).rejects.toThrow();
    expect(operation).not.toHaveBeenCalled(); expect(t.snapshot().totals.calls).toBe(0);
  });
});
