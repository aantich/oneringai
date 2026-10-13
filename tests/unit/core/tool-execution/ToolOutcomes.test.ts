import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToolExecutionPipeline } from '@/core/tool-execution/ToolExecutionPipeline.js';
import { ToolManager } from '@/core/ToolManager.js';
import { ToolExecutionError, ToolTimeoutError } from '@/domain/errors/AIErrors.js';
import { PermissionPolicyManager } from '@/core/permissions/PermissionPolicyManager.js';
import { metrics } from '@/infrastructure/observability/Metrics.js';
import type { ToolFunction, ToolContext } from '@/domain/entities/Tool.js';
import type { ToolExecutionOutcome } from '@/core/tool-execution/outcomes.js';
import { createExecutionSignal, withAbort, abortableDelay } from '@/core/tool-execution/cancellation.js';

const managers: ToolManager[] = [];
afterEach(() => { managers.splice(0).forEach(m => m.destroy()); vi.useRealTimers(); vi.restoreAllMocks(); });
function fixture(execute: ToolFunction['execute'], timeout = 0) {
  const manager = new ToolManager({ toolExecutionTimeout: timeout }); managers.push(manager);
  manager.register({ definition: { type: 'function', function: { name: 'probe', parameters: { type: 'object', properties: {} } } }, execute });
  return manager;
}
function deferred<T = unknown>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

describe('semantic outcomes and raw compatibility', () => {
  it.each([undefined, null])('counts missing result %s as a failure without changing its raw shape', async value => {
    const manager = fixture(async () => value); const counter = vi.spyOn(metrics, 'increment');
    const report = await manager.executeWithOutcome('probe', {});
    expect(report.result).toEqual({ success: false, error: "Tool 'probe' returned no result" });
    expect(report.outcome).toMatchObject({ status: 'failed', executionStarted: true, completion: 'settled', cancellation: 'none' });
    expect(manager.getRegistration('probe')?.metadata).toMatchObject({ usageCount: 1, successCount: 0, failureCount: 1 });
    expect(counter).toHaveBeenCalledWith('tool.failed', 1, { tool: 'probe' });
    expect(counter).not.toHaveBeenCalledWith('tool.success', 1, expect.anything());
  });
  it('preserves the normalized exception object and records its provenance', async () => {
    const manager = fixture(async () => { throw new TypeError('offline'); });
    const report = await manager.executeWithOutcome('probe', {});
    expect(report.result).toEqual({ success: false, error: 'offline', errorType: 'TypeError', toolName: 'probe' });
    expect(report.outcome).toMatchObject({ status: 'failed', error: 'offline' });
    // Legacy circuit policy observes recovered promise settlement, deliberately unchanged.
    expect(manager.getToolCircuitBreakerMetrics('probe')?.successCount).toBe(1);
  });
  it.each([false, 0, '', { success: false, error: 'domain value' }, { error: 'domain value' }])('does not infer a failure from domain data %j', async raw => {
    const manager = fixture(async () => raw); const report = await manager.executeWithOutcome('probe', {});
    expect(report.result).toBe(raw); expect(report.outcome.status).toBe('succeeded');
    expect(manager.getRegistration('probe')?.metadata.successCount).toBe(1);
  });
  it('contains standalone pipeline outcome observer failures after an effect', async () => {
    const pipeline = new ToolExecutionPipeline(); const execute = vi.fn(async () => 'done');
    const result = await pipeline.execute({ definition: { type: 'function', function: { name: 'probe' } }, execute }, {}, {
      onOutcome: () => { throw new Error('Observer disconnected'); },
    });
    expect(result).toBe('done'); expect(execute).toHaveBeenCalledTimes(1);
  });
  it('preserves throwing mode when the normalizer is removed', async () => {
    const manager = fixture(async () => { throw new TypeError('raw failure'); });
    manager.executionPipeline.remove('result-normalizer');
    const error = await manager.execute('probe', {}).catch(e => e as ToolExecutionError);
    expect(error).toBeInstanceOf(ToolExecutionError); expect(error.originalError).toBeInstanceOf(TypeError);
    expect(error.outcome).toMatchObject({ status: 'failed', completion: 'settled' });
  });
  it('reports permission denial without executing the tool or changing the legacy denial payload', async () => {
    const execute = vi.fn(async () => 'write'); const manager = fixture(execute);
    const policies = new PermissionPolicyManager(); policies.blocklistAdd('probe'); manager.setPermissionManager(policies);
    const report = await manager.executeWithOutcome('probe', {});
    expect(report.result).toMatchObject({ success: false, errorType: 'ToolPermissionDeniedError' });
    expect(report.outcome).toMatchObject({ status: 'denied', executionStarted: false, completion: 'not_started' });
    expect(execute).not.toHaveBeenCalled(); expect(manager.getRegistration('probe')?.metadata.failureCount).toBe(1);
  });
  it('retains denied classification in the throwing pipeline mode', async () => {
    const execute = vi.fn(async () => 'write'); const manager = fixture(execute);
    manager.executionPipeline.remove('result-normalizer');
    const policies = new PermissionPolicyManager(); policies.blocklistAdd('probe'); manager.setPermissionManager(policies);
    const error = await manager.execute('probe', {}).catch(e => e as ToolExecutionError);
    expect(error.outcome).toMatchObject({ status: 'denied', executionStarted: false, completion: 'not_started' });
    expect(execute).not.toHaveBeenCalled();
  });
  it('retains tool-owned timeout classification in the throwing pipeline mode', async () => {
    const manager = fixture(async () => { throw new ToolTimeoutError('probe', 123); });
    manager.executionPipeline.remove('result-normalizer');
    const error = await manager.execute('probe', {}).catch(e => e as ToolExecutionError);
    expect(error.outcome).toMatchObject({ status: 'timed_out', timeoutMs: 123, completion: 'settled', cancellation: 'none' });
    expect(error.originalError).toBeInstanceOf(ToolTimeoutError);
  });
  it('keeps custom recovery and short circuit contracts', async () => {
    const execute = vi.fn(async () => { throw new Error('recover'); }); const manager = fixture(execute);
    manager.executionPipeline.remove('result-normalizer');
    manager.executionPipeline.use({ name: 'recover', onError: async () => ({ recovered: true }) });
    expect((await manager.executeWithOutcome('probe', {})).outcome.status).toBe('succeeded');
    manager.executionPipeline.use({ name: 'skip', beforeExecute: async () => ({ abort: true, result: 'skipped' }) });
    const report = await manager.executeWithOutcome('probe', {});
    expect(report.result).toBe('skipped'); expect(report.outcome.executionStarted).toBe(false); expect(execute).toHaveBeenCalledTimes(1);
  });
  it('contains failures of new diagnostic listeners without repeating an operation', async () => {
    const execute = vi.fn(async () => 'done'); const manager = fixture(execute);
    manager.on('tool:outcome', () => { throw new Error('UI disconnected'); });
    manager.on('tool:executed', () => { throw new Error('Old UI disconnected'); });
    const observer = vi.fn(() => { throw new Error('Observer disconnected'); });
    expect(await manager.execute('probe', {}, { onOutcome: observer })).toBe('done'); expect(observer).toHaveBeenCalledTimes(1); expect(execute).toHaveBeenCalledTimes(1);
    expect(manager.getRegistration('probe')?.metadata).toMatchObject({ usageCount: 1, successCount: 1, failureCount: 0 });
  });
});

describe('per-execution cancellation and correlation', () => {
  it('snapshots correlation IDs and does not charge a replacement registration', async () => {
    const work = deferred(); const manager = fixture(async () => work.promise);
    const options = { callId: 'original', runId: 'one' }; const call = manager.executeWithOutcome('probe', {}, options);
    options.callId = 'changed'; manager.unregister('probe');
    manager.register({ definition: { type: 'function', function: { name: 'probe' } }, execute: async () => 'replacement' });
    work.resolve('old result'); expect((await call).outcome.callId).toBe('original');
    expect(manager.getRegistration('probe')?.metadata.usageCount).toBe(0);
  });
  it('does not begin a pre-cancelled tool', async () => {
    const execute = vi.fn(async () => 'never'); const manager = fixture(execute); const host = new AbortController(); host.abort();
    const error = await manager.execute('probe', {}, { signal: host.signal }).catch(e => e);
    expect(error.outcome).toMatchObject({ status: 'cancelled', completion: 'not_started', executionStarted: false }); expect(execute).not.toHaveBeenCalled();
  });
  it('isolates simultaneous calls and snapshots trusted account context', async () => {
    const waits = [deferred(), deferred()]; const contexts: ToolContext[] = [];
    const manager = fixture(async ({ index }, context) => { contexts[index] = context!; return waits[index]!.promise; });
    const original = { userId: 'alice', connectorAccounts: { service: 'work' } }; manager.setToolContext(original);
    const host = new AbortController();
    const first = manager.execute('probe', { index: 0 }, { signal: host.signal, callId: 'a', runId: 'one' }).catch(e => e);
    manager.setToolContext({ userId: 'bob', connectorAccounts: { service: 'personal' } });
    const second = manager.execute('probe', { index: 1 }, { callId: 'b', runId: 'two' });
    original.connectorAccounts.service = 'changed'; host.abort();
    expect((await first).outcome).toMatchObject({ status: 'cancelled', callId: 'a', runId: 'one' });
    expect(contexts[0]?.userId).toBe('alice'); expect(contexts[0]?.connectorAccounts?.service).toBe('work');
    expect(contexts[1]?.signal?.aborted).toBe(false); expect(contexts[1]?.userId).toBe('bob');
    expect(original).not.toHaveProperty('signal'); waits[1]!.resolve('second'); expect(await second).toBe('second'); waits[0]!.resolve('late');
  });
  it('signals cooperative timeout and reports eventual acknowledgment separately', async () => {
    vi.useFakeTimers(); const manager = fixture(async (_args, context) => new Promise((_resolve, reject) => {
      context!.signal!.addEventListener('abort', () => reject(context!.signal!.reason), { once: true });
    }), 20);
    const late: ToolExecutionOutcome[] = []; manager.on('tool:late-complete', value => late.push(value));
    const call = manager.execute('probe', {}).catch(e => e);
    await vi.advanceTimersByTimeAsync(20); const error = await call;
    expect(error.outcome.status).toBe('timed_out'); expect(error.outcome.cancellation).not.toBe('none');
    if (late.length) expect(late[0]!.cancellation).toBe('acknowledged');
    expect(manager.getRegistration('probe')?.metadata.usageCount).toBe(1); expect(vi.getTimerCount()).toBe(0);
  });
  it.each(['resolve', 'reject'] as const)('observes noncooperative late %s once, with its original IDs and no duplicate accounting', async how => {
    vi.useFakeTimers(); const work = deferred(); const manager = fixture(async () => work.promise, 10);
    const initial: ToolExecutionOutcome[] = []; const late: ToolExecutionOutcome[] = [];
    manager.on('tool:outcome', value => initial.push(value)); manager.on('tool:late-complete', value => late.push(value));
    const call = manager.execute('probe', {}, { callId: 'original-call', runId: 'original-run' }).catch(e => e);
    await vi.advanceTimersByTimeAsync(10); const error = await call;
    expect(error.outcome).toMatchObject({ status: 'timed_out', completion: 'unknown', cancellation: 'requested' });
    manager.setToolContext({ userId: 'new-user' });
    if (how === 'resolve') work.resolve('external effect finished'); else work.reject(new Error('late failure'));
    await vi.advanceTimersByTimeAsync(0);
    expect(initial).toHaveLength(1); expect(late).toHaveLength(1);
    expect(late[0]).toMatchObject({ executionId: initial[0]!.executionId, callId: 'original-call', runId: 'original-run', completion: 'settled', status: how === 'resolve' ? 'succeeded' : 'failed' });
    expect(manager.getRegistration('probe')?.metadata).toMatchObject({ usageCount: 1, successCount: 0, failureCount: 1 });
  });
  it('does not execute after cancellation while a permission/plugin hook is pending', async () => {
    const gate = deferred<void>(); const execute = vi.fn(async () => 'never'); const manager = fixture(execute); const host = new AbortController();
    manager.executionPipeline.use({ name: 'approval', beforeExecute: async () => gate.promise });
    const call = manager.execute('probe', {}, { signal: host.signal }).catch(e => e); host.abort();
    expect((await call).outcome.completion).toBe('not_started'); gate.resolve(); await Promise.resolve(); await Promise.resolve(); expect(execute).not.toHaveBeenCalled();
  });
  it('cleans composed parent listeners after successful execution', async () => {
    const host = new AbortController(); const add = vi.spyOn(host.signal, 'addEventListener'); const remove = vi.spyOn(host.signal, 'removeEventListener');
    const manager = fixture(async () => 'done'); await manager.execute('probe', {}, { signal: host.signal });
    expect(add).toHaveBeenCalledTimes(1); expect(remove).toHaveBeenCalledTimes(1);
  });
  it('destroy requests cancellation of active calls and suppresses later diagnostic delivery', async () => {
    const work = deferred(); const manager = fixture(async () => work.promise); const outcomes = vi.fn(); manager.on('tool:late-complete', outcomes);
    const call = manager.execute('probe', {}, { signal: new AbortController().signal }).catch(e => e); manager.destroy();
    expect((await call).outcome.status).toBe('cancelled'); work.resolve('late'); await Promise.resolve(); expect(outcomes).not.toHaveBeenCalled();
  });
  it('per-call zero does not disable the existing manager safety net', async () => {
    vi.useFakeTimers(); const work = deferred(); const manager = fixture(async () => work.promise, 10);
    const call = manager.execute('probe', {}, { timeoutMs: 0 }).catch(e => e); await vi.advanceTimersByTimeAsync(20);
    expect((await call).outcome).toMatchObject({ status: 'timed_out', timeoutMs: 10 }); work.resolve('late'); expect(vi.getTimerCount()).toBe(0);
  });});

describe('signal resource lifecycle', () => {
  it('composes already-aborted and duplicate sources and disposes listeners idempotently', () => {
    const first = new AbortController(); const second = new AbortController(); const remove = vi.spyOn(first.signal, 'removeEventListener'); second.abort('reason');
    const scope = createExecutionSignal([first.signal, first.signal, undefined, second.signal]);
    expect(scope.controller.signal.reason).toBe('reason'); scope.dispose(); scope.dispose(); expect(remove).toHaveBeenCalledTimes(1);
  });
  it('removes a pending abort wait listener when its operation rejects', async () => {
    const host = new AbortController(); const remove = vi.spyOn(host.signal, 'removeEventListener');
    await expect(withAbort(Promise.reject(new Error('operation')), host.signal)).rejects.toThrow('operation'); expect(remove).toHaveBeenCalledTimes(1);
  });
  it('clears backoff timers on cancellation, including an already-aborted source', async () => {
    vi.useFakeTimers(); const host = new AbortController(); const wait = abortableDelay(10_000, host.signal).catch(e => e); host.abort('stop'); expect(await wait).toBe('stop');
    await expect(abortableDelay(10_000, host.signal)).rejects.toBe('stop'); expect(vi.getTimerCount()).toBe(0);
  });
});
