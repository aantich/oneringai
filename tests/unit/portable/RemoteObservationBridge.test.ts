import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToolManager, InMemoryEvidenceStorage, createOutcomeTool } from '@/index.js';
import type { ToolFunction, ToolExecutionOptions } from '@/index.js';
import { ToolEvidenceMiddleware, evidenceProvenance } from '@/core/evidence/ToolEvidenceMiddleware.js';
import { selectRemoteProxy, remoteInvocation, remoteOutcome, selectRemoteSourceAdmission, type RemoteInvocationObservation, type RemoteInvocationIdentity } from '@/core/tool-execution/remoteObservation.js';
const managers: ToolManager[] = [];
afterEach(() => { managers.splice(0).forEach(manager => manager.destroy()); });
const tool = (execute: ToolFunction['execute']): ToolFunction => ({ definition: { type: 'function', function: { name: 'proxy' } }, output: { effect: 'unknown' }, execute });
function manager() { const value = new ToolManager(); managers.push(value); return value; }
const observer = (overrides: Partial<RemoteInvocationObservation> = {}): RemoteInvocationObservation => ({ version: 1, effect: 'unknown', validateEvidence: async () => true, evidenceResult: (_outcome, result) => result, observeProxy: () => {}, issue: () => undefined, ...overrides });
describe('private remote observation integration in the shared manager', () => {
  it('captures real proxy IDs/principal before an async plugin yields and survives context copies', async () => {
    const value = manager(); value.setToolContext({ userId: 'original-owner' }); let captured: RemoteInvocationIdentity | undefined, release!: () => void, entered!: () => void;
    const ready = new Promise<void>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { release = resolve; }); const observation = observer();
    const proxy = tool(async (_args, context) => { expect(remoteInvocation({ ...context })).toBe(observation); return { success: false, business: true }; });
    selectRemoteProxy(proxy, identity => { captured = identity; return observation; }); value.register({ ...proxy });
    value.executionPipeline.use({ name: 'yield', beforeExecute: async () => { entered(); await gate; } });
    const pending = value.executeWithOutcome('proxy', {}, { callId: 'model-call', runId: 'parent-run' }); await ready; value.mergeToolContext({ userId: 'later-owner' }); release();
    const report = await pending; expect(captured).toMatchObject({ executionId: report.outcome.executionId, callId: 'model-call', runId: 'parent-run', principal: { userId: 'original-owner' } });
    expect(report.result).toEqual({ success: false, business: true }); expect(report.outcome.status).toBe('succeeded'); expect(remoteOutcome(report.outcome)).toBe(observation);
  });
  it('stores a complete source/sidecar envelope while retaining the exact raw business return and local outcome identity', async () => {
    const value = manager(), storage = new InMemoryEvidenceStorage({ scope: { ownerId: 'host', namespace: 'remote-full' } }); value.setToolContext({ userId: 'host' }); value.setEvidenceMiddleware(new ToolEvidenceMiddleware({ storage }));
    const raw = { success: false, reason: 'business declined' }; const complete = vi.fn();
    const proxy = createOutcomeTool({ ...tool(async () => raw), execute: async () => raw });
    selectRemoteProxy(proxy, () => observer({ effect: 'read', evidenceResult: (outcome, result) => result ? { value: { protocol: 'observation-test/1', proxyExecutionId: outcome.executionId, serverExecutionId: 'separate-server-id', result: result.value } } : undefined, observeProxy: complete }));
    value.register(proxy); const report = await value.executeWithOutcome('proxy', {}, { callId: 'model-call' });
    expect(report.result).toBe(raw); expect(report.outcome.status).toBe('succeeded'); expect(report.outcome.executionId).not.toBe('separate-server-id');
    const record = await storage.readRecord(report.evidence!.reference!); expect(record?.result).toEqual({ protocol: 'observation-test/1', proxyExecutionId: report.outcome.executionId, serverExecutionId: 'separate-server-id', result: raw });
    expect(complete).toHaveBeenCalledWith(report.outcome, report.evidence!.reference); expect(remoteOutcome(report.outcome)?.effect).toBe('read');
  });
  it('does not turn an unverified sidecar into result-bearing evidence through proxy success', async () => {
    const value = manager(), storage = new InMemoryEvidenceStorage({ scope: { ownerId: 'host', namespace: 'remote-unknown' } }); value.setToolContext({ userId: 'host' }); value.setEvidenceMiddleware(new ToolEvidenceMiddleware({ storage }));
    const raw = { externalId: 'observed-but-unverified' }, complete = vi.fn(), proxy = tool(async () => raw);
    selectRemoteProxy(proxy, () => observer({ evidenceResult: () => undefined, observeProxy: complete, issue: () => new Error('Remote write remains unknown') })); value.register(proxy);
    const report = await value.executeWithOutcome('proxy', {}); expect(report.result).toBe(raw); expect(report.outcome.status).toBe('succeeded');
    expect(evidenceProvenance(report.evidence)?.hasResult).toBe(false); expect(await storage.readRecord(report.evidence!.reference!)).not.toHaveProperty('result');
    expect(complete).toHaveBeenCalledWith(report.outcome, undefined); expect(remoteOutcome(report.outcome)?.issue()?.message).toBe('Remote write remains unknown');
  });
  it('keeps raw protection if host redaction removes essential observation metadata after a successful backend write', async () => {
    const value = manager(), storage = new InMemoryEvidenceStorage({ scope: { ownerId: 'host', namespace: 'remote-redacted' } }); value.setToolContext({ userId: 'host' });
    value.setEvidenceMiddleware(new ToolEvidenceMiddleware({ storage, redact: (data, kind) => kind === 'result' ? { result: (data as any).result } : data }));
    const raw = { id: 'exact-business-result' }, execute = vi.fn(async () => raw), proxy = tool(execute);
    selectRemoteProxy(proxy, () => observer({ evidenceResult: (outcome, result) => ({ value: { protocol: 'required-observation/1', executionId: outcome.executionId, result: result?.value } }),
      validateEvidence: async (_outcome, reference) => (await storage.readRecord(reference))?.result?.protocol === 'required-observation/1' })); value.register(proxy);
    const report = await value.executeWithOutcome('proxy', {}); expect(report.result).toBe(raw); expect(report.outcome.status).toBe('succeeded'); expect(report.evidence?.status).toBe('storage_failed'); expect(evidenceProvenance(report.evidence)?.hasResult).toBe(false); expect(execute).toHaveBeenCalledTimes(1);
  });
  it('isolates failing observers and retains ordinary execution when no profile is selected', async () => {
    const value = manager(), execute = vi.fn(async () => false), proxy = tool(execute);
    selectRemoteProxy(proxy, () => observer({ observeProxy: () => { throw new Error('diagnostic failure'); } })); value.register(proxy);
    expect((await value.executeWithOutcome('proxy', {})).outcome.status).toBe('succeeded'); expect(execute).toHaveBeenCalledTimes(1);
    value.register(tool(async () => ({ success: false }))); const ordinary = await value.executeWithOutcome('proxy', {}); expect(ordinary.outcome.status).toBe('succeeded'); expect(remoteOutcome(ordinary.outcome)).toBeUndefined();
  });
  it('rejects a replaced source executable at synchronous admission before any action executes', async () => {
    const value = manager(), original = vi.fn(async () => 'original'), replacement = vi.fn(async () => 'replacement'); value.register(tool(original));
    const options: ToolExecutionOptions = { callId: 'request' }; selectRemoteSourceAdmission(options, selected => { if (selected.execute !== original) throw new Error('Source registration changed'); });
    value.register(tool(replacement)); await expect(value.executeWithOutcome('proxy', {}, options)).rejects.toMatchObject({ outcome: { status: 'failed', executionStarted: false, completion: 'not_started' } });
    expect(original).not.toHaveBeenCalled(); expect(replacement).not.toHaveBeenCalled();
  });
});
