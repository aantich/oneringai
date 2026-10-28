import { afterEach, describe, expect, it, vi } from 'vitest';
import { createOutcomeTool } from '@/core/createOutcomeTool.js';
import type { OutcomeInvocation } from '@/core/createOutcomeTool.js';
import { ToolManager } from '@/core/ToolManager.js';
import { ToolExecutionPipeline } from '@/core/tool-execution/ToolExecutionPipeline.js';
import { ResultNormalizerPlugin } from '@/core/tool-execution/plugins/ResultNormalizerPlugin.js';
import { PermissionPolicyManager } from '@/core/permissions/PermissionPolicyManager.js';
import { Connector } from '@/core/Connector.js';
import { ConnectorTools } from '@/tools/connector/ConnectorTools.js';
import { ToolTimeoutError } from '@/domain/errors/AIErrors.js';
import type { ToolContext, ToolFunction, ToolExecutionOutcome } from '@/domain/entities/Tool.js';
import type { PipelineOutcome } from '@/core/tool-execution/outcomes.js';
import { InMemoryEvidenceStorage } from '@/infrastructure/storage/EvidenceStorage.js';
import { ToolEvidenceMiddleware } from '@/core/evidence/ToolEvidenceMiddleware.js';

const managers: ToolManager[] = [];
const service = 'outcome-invocation-fixture';
const definition = { type: 'function' as const, function: { name: 'probe', parameters: { type: 'object', properties: {} } } };
function manager(tool: ToolFunction) {
  const value = new ToolManager(); value.register(tool); managers.push(value); return value;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}
afterEach(() => {
  managers.splice(0).forEach(value => value.destroy()); ConnectorTools.unregisterService(service);
  Connector.clear(); ConnectorTools.clearCache(); vi.useRealTimers(); vi.restoreAllMocks();
});

describe('explicit operational failure and legacy raw contracts', () => {
  it.each([false, 0, '', 23, Object.freeze({ success: false, error: 'domain decision' }), Object.freeze([1, 2])])(
    'reports failure independently of the raw value %j', async raw => {
      const execute = vi.fn(async (_args, invocation: OutcomeInvocation) => {
        invocation.reportFailure(new Error('Lookup unavailable')); return raw;
      });
      const value = manager(createOutcomeTool({ definition, execute }));
      const report = await value.executeWithOutcome('probe', {}, { callId: 'call', runId: 'run' });
      expect(report.result).toBe(raw);
      expect(report.outcome).toMatchObject({ status: 'failed', error: 'Lookup unavailable', executionStarted: true,
        completion: 'settled', callId: 'call', runId: 'run', cancellation: 'none' });
      expect(execute).toHaveBeenCalledTimes(1);
      expect(value.getRegistration('probe')?.metadata).toMatchObject({ usageCount: 1, successCount: 0, failureCount: 1 });
      expect(value.getToolCircuitBreakerMetrics('probe')?.successCount).toBe(1);
    },
  );
  it('keeps unmarked negative data successful, including forged payload hints', async () => {
    const raw = Object.freeze({ success: false, error: 'Declined', reportFailure: true, __failure: true });
    const value = manager({ definition, execute: async () => raw });
    expect((await value.executeWithOutcome('probe', {})).outcome.status).toBe('succeeded');
    value.register(createOutcomeTool({ definition, execute: async () => raw }));
    expect((await value.executeWithOutcome('probe', {})).outcome.status).toBe('succeeded');
    expect(await value.execute('probe', {})).toBe(raw);
  });
  it('does not append fields to the tool, definition, context or frozen result', async () => {
    const context = Object.freeze({ userId: 'owner' });
    const raw = Object.freeze({ id: 'record' });
    const value = createOutcomeTool({ definition, execute: async (_args, invocation) => {
      expect(invocation.context).toBe(context); invocation.reportFailure(new Error('offline')); return raw;
    } });
    expect(await value.execute({}, context)).toBe(raw);
    expect(Object.keys(value)).toEqual(['definition', 'execute']);
    expect(Object.getOwnPropertySymbols(value)).toEqual([]);
    expect(JSON.stringify(value.definition)).toBe(JSON.stringify(definition));
    expect(Object.keys(context)).toEqual(['userId']); expect(Object.keys(raw)).toEqual(['id']);
  });
  it('preserves the ordinary tool receiver and raw direct return', async () => {
    let receiver: unknown;
    const raw = { success: false };
    const value = createOutcomeTool({ definition, execute: async function(_args, invocation) {
      receiver = this; invocation.reportFailure(new Error('reported')); return raw;
    } });
    expect(await value.execute({})).toBe(raw); expect(receiver).toBe(value);
    expect((await manager(value).executeWithOutcome('probe', {})).result).toBe(raw); expect(receiver).toBe(value);
  });
  it('captures the first error text and ignores repeated reports', async () => {
    const first = new Error('first');
    const value = manager(createOutcomeTool({ definition, execute: async (_args, invocation) => {
      invocation.reportFailure(first); first.message = 'mutated'; invocation.reportFailure(new Error('second')); return 'raw';
    } }));
    expect((await value.executeWithOutcome('probe', {})).outcome.error).toBe('first');
  });
  it('contains invalid JavaScript reports without throwing after an action', async () => {
    let effects = 0;
    const value = manager(createOutcomeTool({ definition, execute: async (_args, invocation) => {
      effects++; invocation.reportFailure('bad JS input' as unknown as Error); return 'accepted';
    } }));
    const result = await value.executeWithOutcome('probe', {});
    expect(result.result).toBe('accepted'); expect(result.outcome).toMatchObject({ status: 'failed', error: 'reportFailure requires an Error' });
    expect(effects).toBe(1);
  });
  it('does not turn a reported operational timeout into an admission timeout', async () => {
    const value = manager(createOutcomeTool({ definition, execute: async (_args, invocation) => {
      invocation.reportFailure(new ToolTimeoutError('remote', 123)); return { unavailable: true };
    } }));
    expect((await value.executeWithOutcome('probe', {})).outcome).toMatchObject({ status: 'failed', completion: 'settled' });
  });
  it('preserves old null normalization after an explicit report', async () => {
    const value = manager(createOutcomeTool({ definition, execute: async (_args, invocation) => {
      invocation.reportFailure(new Error('primary')); return null;
    } }));
    const result = await value.executeWithOutcome('probe', {});
    expect(result.result).toEqual({ success: false, error: "Tool 'probe' returned no result" });
    expect(result.outcome.error).toBe('primary');
  });
  it('publishes provenance through the standalone pipeline and retains a later throw as cause', async () => {
    const pipeline = new ToolExecutionPipeline(); pipeline.use(new ResultNormalizerPlugin());
    const later = new TypeError('later throw'); let outcome: PipelineOutcome | undefined;
    const tool = createOutcomeTool({ definition, execute: async (_args, invocation) => {
      invocation.reportFailure(new Error('primary')); throw later;
    } });
    const raw = await pipeline.execute(tool, {}, { onOutcome: value => { outcome = value; } });
    expect(raw).toEqual({ success: false, error: 'later throw', errorType: 'TypeError', toolName: 'probe' });
    expect(outcome?.status).toBe('failed'); expect(outcome?.error).toBeInstanceOf(AggregateError);
    expect(outcome?.error?.message).toBe('primary'); expect(outcome?.error?.cause).toBe(later);
  });
  it('retains reported provenance through custom recovery and result transformations', async () => {
    const pipeline = new ToolExecutionPipeline(); let outcome: PipelineOutcome | undefined;
    pipeline.use({ name: 'recovery', onError: async () => 'recovered' });
    const raw = await pipeline.execute(createOutcomeTool({ definition, execute: async (_args, invocation) => {
      invocation.reportFailure(new Error('primary')); throw new Error('later');
    } }), {}, { onOutcome: value => { outcome = value; } });
    expect(raw).toBe('recovered'); expect(outcome?.status).toBe('failed'); expect(outcome?.error?.cause).toBeInstanceOf(Error);
    const value = manager(createOutcomeTool({ definition, execute: async (_args, invocation) => {
      invocation.reportFailure(new Error('operational')); return { id: 1 };
    } }));
    value.executionPipeline.use({ name: 'projection', afterExecute: async () => 'transformed' });
    expect(await value.executeWithOutcome('probe', {})).toMatchObject({ result: 'transformed', outcome: { status: 'failed' } });
  });
  it('retains throwing mode and the later thrown raw error when normalization is disabled', async () => {
    const later = new TypeError('later');
    const value = manager(createOutcomeTool({ definition, execute: async (_args, invocation) => {
      invocation.reportFailure(new Error('primary')); throw later;
    } }));
    value.executionPipeline.remove('result-normalizer');
    const error = await value.execute('probe', {}).catch(error => error);
    expect(error.originalError).toBe(later); expect(error.outcome).toMatchObject({ status: 'failed', error: 'primary' });
  });
  it('does not run an explicitly selected callback on denial or short circuit', async () => {
    const execute = vi.fn(async () => 'never'); const value = manager(createOutcomeTool({ definition, execute }));
    const permissions = new PermissionPolicyManager(); permissions.blocklistAdd('probe'); value.setPermissionManager(permissions);
    expect((await value.executeWithOutcome('probe', {})).outcome).toMatchObject({ status: 'denied', executionStarted: false });
    expect(execute).not.toHaveBeenCalled();
    value.executionPipeline.remove('permission-enforcement');
    value.executionPipeline.use({ name: 'skip', beforeExecute: async () => ({ abort: true, result: 'cached' }) });
    expect(await value.executeWithOutcome('probe', {})).toMatchObject({ result: 'cached', outcome: { status: 'succeeded', executionStarted: false } });
    expect(execute).not.toHaveBeenCalled();
  });
  it('does not repeat work when outcome observers fail', async () => {
    const execute = vi.fn(async (_args, invocation: OutcomeInvocation) => {
      invocation.reportFailure(new Error('operational')); return 'raw';
    });
    const value = manager(createOutcomeTool({ definition, execute }));
    value.on('tool:outcome', () => { throw new Error('observer'); });
    const report = await value.executeWithOutcome('probe', {}, { onOutcome: () => { throw new Error('observer'); } });
    expect(report.outcome.status).toBe('failed'); expect(execute).toHaveBeenCalledTimes(1);
  });
});

describe('invocation ownership, admission and cancellation', () => {
  it('does not identify simultaneous invocations through shared contexts or returns', async () => {
    const gates = [deferred<void>(), deferred<void>()]; const raw = Object.freeze({ success: false });
    const value = manager(createOutcomeTool({ definition, execute: async ({ index }: { index: number }, invocation) => {
      await gates[index]!.promise; if (index === 0) invocation.reportFailure(new Error('first only')); return raw;
    } }));
    value.setToolContext({ userId: 'shared' });
    const first = value.executeWithOutcome('probe', { index: 0 }, { callId: 'first' });
    const second = value.executeWithOutcome('probe', { index: 1 }, { callId: 'second' });
    gates[1]!.resolve(); gates[0]!.resolve();
    expect((await first).outcome).toMatchObject({ status: 'failed', callId: 'first' });
    expect((await second).outcome).toMatchObject({ status: 'succeeded', callId: 'second' });
    expect((await second).result).toBe((await first).result);
  });
  it('makes a settled reporter inert before afterExecute and subsequent invocations', async () => {
    let oldReport!: OutcomeInvocation['reportFailure'];
    const value = manager(createOutcomeTool({ definition, execute: async (_args, invocation) => {
      oldReport = invocation.reportFailure; return 'raw';
    } }));
    value.executionPipeline.use({ name: 'late-report', afterExecute: async (_ctx, raw) => { oldReport(new Error('too late')); return raw; } });
    expect((await value.executeWithOutcome('probe', {})).outcome.status).toBe('succeeded');
    oldReport(new Error('still late'));
    expect((await value.executeWithOutcome('probe', {})).outcome.status).toBe('succeeded');
  });
  it('captures the selected callback before pending admission hooks and re-registration', async () => {
    const gate = deferred<void>();
    const first = createOutcomeTool({ definition, execute: async (_args, invocation) => {
      invocation.reportFailure(new Error('original')); return 'original';
    } });
    const replacement = createOutcomeTool({ definition, execute: async () => 'replacement' });
    const value = manager(first); value.executionPipeline.use({ name: 'wait', beforeExecute: async () => gate.promise });
    const pending = value.executeWithOutcome('probe', {});
    first.execute = replacement.execute; value.unregister('probe'); value.register(replacement); gate.resolve();
    expect(await pending).toMatchObject({ result: 'original', outcome: { error: 'original', status: 'failed' } });
    expect((await value.executeWithOutcome('probe', {})).outcome.status).toBe('succeeded');
    expect(value.getRegistration('probe')?.metadata).toMatchObject({ usageCount: 1, failureCount: 0 });
  });
  it.each(['cancel', 'timeout'] as const)('keeps %s primary and associates late reporting with the original invocation', async mode => {
    vi.useFakeTimers(); const gate = deferred<void>(); const entered = deferred<void>();
    const value = manager(createOutcomeTool({ definition, execute: async (_args, invocation) => {
      entered.resolve(); await gate.promise; invocation.reportFailure(new Error('late operational failure')); return 'settled raw';
    } }));
    const late: ToolExecutionOutcome[] = []; value.on('tool:late-complete', outcome => late.push(outcome));
    const controller = new AbortController();
    const pending = value.execute('probe', {}, { signal: controller.signal, timeoutMs: mode === 'timeout' ? 10 : 0,
      callId: 'original-call', runId: 'original-run' }).catch(error => error);
    await entered.promise;
    if (mode === 'cancel') controller.abort(); else await vi.advanceTimersByTimeAsync(10);
    const error = await pending; expect(error.outcome.status).toBe(mode === 'cancel' ? 'cancelled' : 'timed_out');
    gate.resolve(); await vi.advanceTimersByTimeAsync(0);
    expect(late).toHaveLength(1); expect(late[0]).toMatchObject({ status: 'failed', error: 'late operational failure',
      executionId: error.outcome.executionId, callId: 'original-call', runId: 'original-run', completion: 'settled' });
    expect(error.outcome.status).toBe(mode === 'cancel' ? 'cancelled' : 'timed_out');
    expect(value.getRegistration('probe')?.metadata).toMatchObject({ usageCount: 1, failureCount: 1 });
    expect(vi.getTimerCount()).toBe(0);
  });
  it('does not execute a callback after pre-cancellation', async () => {
    const execute = vi.fn(async () => 'never'); const value = manager(createOutcomeTool({ definition, execute }));
    const controller = new AbortController(); controller.abort();
    const error = await value.execute('probe', {}, { signal: controller.signal }).catch(error => error);
    expect(error.outcome.status).toBe('cancelled'); expect(execute).not.toHaveBeenCalled();
  });
  it('does not implicitly certify arbitrary execute wrappers', async () => {
    const tool = createOutcomeTool({ definition, execute: async (_args, invocation) => {
      invocation.reportFailure(new Error('not admitted through wrapper')); return 'raw';
    } });
    const wrapped = { ...tool, execute: (args: unknown, context?: ToolContext) => tool.execute(args, context) };
    expect((await manager(wrapped).executeWithOutcome('probe', {})).outcome.status).toBe('succeeded');
    expect((await manager({ ...tool }).executeWithOutcome('probe', {})).outcome.status).toBe('failed');
  });
});

describe('official account wrappers and evidence integration', () => {
  it.each(['explicit', 'context', 'map', 'none'] as const)('preserves failure reporting and %s account binding', async mode => {
    let received: ToolContext | undefined;
    let receiver: unknown;
    Connector.create({ name: 'service', serviceType: service, auth: { type: 'none' } });
    ConnectorTools.registerService(service, () => [createOutcomeTool({ definition: structuredClone(definition),
      execute: async function(_args, invocation) { receiver = this; received = invocation.context;
        invocation.reportFailure(new Error('service unavailable')); return { account: invocation.context?.accountId }; } })]);
    const [tool] = ConnectorTools.for('service', undefined, mode === 'explicit' ? { accountId: 'explicit' } : undefined);
    const value = manager(tool!); value.setToolContext({ userId: 'owner',
      accountId: mode === 'explicit' || mode === 'context' ? 'context' : undefined,
      connectorAccounts: mode !== 'none' ? { service: 'mapped' } : undefined });
    const report = await value.executeWithOutcome(tool!.definition.function.name, {});
    const account = mode === 'explicit' ? 'explicit' : mode === 'context' ? 'context' : mode === 'map' ? 'mapped' : undefined;
    expect(report.result).toEqual({ account }); expect(report.outcome.status).toBe('failed');
    expect(received?.accountId).toBe(account); expect(received?.userId).toBe('owner');
    expect(receiver).not.toBe(tool); // Existing wrapper invokes the source tool as receiver.
  });
  it('captures wrapped callbacks at admission while allowing future source replacements', async () => {
    const gate = deferred<void>(); let source!: ToolFunction;
    Connector.create({ name: 'service', serviceType: service, auth: { type: 'none' } });
    ConnectorTools.registerService(service, () => {
      source = createOutcomeTool({ definition: structuredClone(definition), execute: async (_args, invocation) => {
        invocation.reportFailure(new Error('original')); return 'original';
      } }); return [source];
    });
    const [wrapped] = ConnectorTools.for('service'); const value = manager(wrapped!);
    value.executionPipeline.use({ name: 'gate', beforeExecute: async () => gate.promise });
    const pending = value.executeWithOutcome('service_probe', {});
    source.execute = createOutcomeTool({ definition, execute: async () => 'replacement' }).execute; gate.resolve();
    expect(await pending).toMatchObject({ result: 'original', outcome: { status: 'failed', error: 'original' } });
    expect(await value.executeWithOutcome('service_probe', {})).toMatchObject({ result: 'replacement', outcome: { status: 'succeeded' } });
  });
  it('does not evaluate a legacy execute getter early through an account wrapper', async () => {
    const read = vi.fn(() => async () => 'raw');
    Connector.create({ name: 'service', serviceType: service, auth: { type: 'none' } });
    ConnectorTools.registerService(service, () => [{ definition: structuredClone(definition), get execute() { return read(); } }]);
    const [wrapped] = ConnectorTools.for('service'); read.mockClear(); const value = manager(wrapped!);
    const permissions = new PermissionPolicyManager(); permissions.blocklistAdd('service_probe'); value.setPermissionManager(permissions);
    await value.executeWithOutcome('service_probe', {}); expect(read).not.toHaveBeenCalled();
  });
  it('stores the unchanged raw observation with the reported failed outcome', async () => {
    const storage = new InMemoryEvidenceStorage({ scope: { ownerId: 'owner', namespace: 'outcomes' } });
    const raw = Object.freeze({ success: false, id: 'original-source' });
    const execute = vi.fn(async (_args, invocation: OutcomeInvocation) => {
      invocation.reportFailure(new Error('lookup unavailable')); return raw;
    });
    const value = manager(createOutcomeTool({ definition, execute, output: { effect: 'read' } }));
    value.setToolContext({ userId: 'owner' }); value.setEvidenceMiddleware(new ToolEvidenceMiddleware({ storage }));
    const report = await value.executeWithOutcome('probe', {}, { callId: 'call' });
    expect(report.result).toBe(raw); expect(report.outcome.status).toBe('failed'); expect(report.evidence?.status).toBe('stored');
    const record = await storage.readRecord(report.evidence!.reference!);
    expect(record?.result).toEqual(raw); expect(record?.source.status).toBe('failed'); expect(execute).toHaveBeenCalledTimes(1);
  });
  it('does not replay a settled action when evidence storage fails', async () => {
    const storage = new InMemoryEvidenceStorage({ scope: { ownerId: 'owner', namespace: 'failure' } });
    vi.spyOn(storage, 'put').mockRejectedValue(new Error('Storage unavailable'));
    let effects = 0; const raw = { id: 'settled-action' };
    const value = manager(createOutcomeTool({ definition, output: { effect: 'write' }, execute: async (_args, invocation) => {
      effects++; invocation.reportFailure(new Error('Remote state requires verification')); return raw;
    } }));
    value.setToolContext({ userId: 'owner' }); value.setEvidenceMiddleware(new ToolEvidenceMiddleware({ storage }));
    const report = await value.executeWithOutcome('probe', {}, { callId: 'write' });
    expect(report.result).toBe(raw); expect(report.outcome.status).toBe('failed');
    expect(report.evidence?.status).toBe('storage_failed'); expect(effects).toBe(1);
  });
});

it('contains async per-call outcome observer rejection without changing the raw action result', async () => {
  const raw = Object.freeze({ id: 'performed-once' }); const execute = vi.fn(async () => raw);
  const value = manager({ definition, execute });
  const report = await value.executeWithOutcome('probe', {}, { onOutcome: async () => { throw new Error('Async host observer'); } });
  await new Promise(resolve => setTimeout(resolve, 0)); expect(report.result).toBe(raw); expect(report.outcome.status).toBe('succeeded'); expect(execute).toHaveBeenCalledTimes(1);
});
