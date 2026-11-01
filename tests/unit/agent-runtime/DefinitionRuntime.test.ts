import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AgentRuntime, LocalExecutionBackend } from '@/agent-runtime/index.js';
import type { AgentDriver, DriverOpenSessionRequest, DriverSession, RuntimeSessionOptions } from '@/agent-runtime/index.js';
import { contentDigest } from '@/agent-runtime/internal.js';
import { RuntimeHostTools } from '@/agent-runtime/RuntimeHostTools.js';
import { Agent } from '@/core/Agent.js';
import { createMockConnector, resetMockProviders } from '../../helpers/mockConnector.js';
import { RuntimeControl, InMemoryRuntimeSessionStorage } from '@/agent-runtime/RuntimeSessionStorage.js';
import { definitionDigest } from '@/agent-runtime/RuntimeHostTools.js';
import { Connector } from '@/core/Connector.js';
import { Vendor } from '@/core/Vendor.js';
import { InMemoryEvidenceStorage } from '@/infrastructure/storage/EvidenceStorage.js';
import { ToolEvidenceMiddleware } from '@/core/evidence/ToolEvidenceMiddleware.js';
import { ToolManager } from '@/core/ToolManager.js';

beforeEach(() => { Connector.create({ name: 'test', vendor: Vendor.OpenAI, auth: { type: 'none' } }); });
afterEach(() => { Connector.clear(); resetMockProviders(); });
const options: RuntimeSessionOptions = { execution: { driver: 'fixture', connector: 'test', model: 'fixture' }, context: { tenantId: 'a', userId: 'b' }, policy: { filesystem: 'denied', commands: 'denied', sandboxNetwork: 'denied', providerWebSearch: 'denied', approvals: 'deny' } };
function driver(open: (request: DriverOpenSessionRequest) => void = () => {}): AgentDriver {
  return { id: 'fixture', inspect: async () => ({ capabilities: { driverId: 'fixture', capabilities: Object.fromEntries(['agent.definition','tools.host'].map(id => [id, { id, support: 'native' as const }])) } }), openSession: async request => {
    open(request);
    let destroyed = false;
    return { get isDestroyed() { return destroyed; }, destroy: async () => { destroyed = true; }, cancelActiveRun: async () => {}, detach: async () => {}, run: async request => ({ events: (async function* () { yield { type: 'agent.message.completed' as const, data: { text: String(request.input) } }; })(), result: Promise.resolve({ status: 'completed', outputText: String(request.input) }), cancel: async () => {} }) } satisfies DriverSession;
  } };
}
const tool = { definition: { type: 'function' as const, function: { name: 'probe', description: 'probe', parameters: { type: 'object' } } }, execute: async () => ({ success: false, businessValue: 3 }) };
describe('definition runtime', () => {
  it('freezes a reusable definition and binds it without changing legacy sources', async () => {
    const opened = vi.fn(); const runtime = new AgentRuntime({ backend: new LocalExecutionBackend({ drivers: [driver(opened)] }) });
    const definition = { id: 'same', instructions: 'do the task', metadata: { value: 'old' } };
    const agent = runtime.createAgent(definition); definition.metadata.value = 'new';
    expect(agent.definition.metadata?.value).toBe('old');
    expect((await agent.inspect(options)).definitionDigest).toHaveLength(64);
    expect(opened).not.toHaveBeenCalled();
    const first = await agent.openSession(options); const second = await agent.openSession(options);
    expect(first.id).not.toBe(second.id); expect(opened.mock.calls[0][0].spec.definition.instructions).toBe('do the task');
    await expect(first.run('unsafe-budget', { modelTask: { limit: 1 } } as unknown as Parameters<typeof first.run>[1])).rejects.toThrow('Unknown runtime run option');
    const run = await first.run('hello', { requestId: 'one' });
    expect((await run.result).outputText).toBe('hello');
    expect(await first.run('hello', { requestId: 'one' })).toBe(run);
    await expect(first.run('different', { requestId: 'one' })).rejects.toThrow('different input');
    expect(await first.getRun(run.id)).toBe(run);
    await first.detach(); await expect(first.run('next')).rejects.toThrow('detached');
    const resumed = await runtime.resumeSession(first.reference(), { context: options.context });
    expect(resumed).toBe(first);
    await expect(runtime.resumeSession(first.reference(), { context: { userId: 'foreign' } })).rejects.toThrow('scope');
    await runtime.deleteSession(first.reference(), { context: options.context }); expect(first.isDestroyed).toBe(true);
    await runtime.destroy(); expect(second.isDestroyed).toBe(true);
  });
  it('reports side-effect-free schema/configuration inspection and leaves external enforcement unknown', async () => {
    const opened = vi.fn(); const runtime = new AgentRuntime({ backend: new LocalExecutionBackend({ drivers: [driver(opened)], resolveTools: () => ({ tools: [tool], fingerprint: 'v1' }) }) });
    try {
      const report = await runtime.createAgent({ id: 'a', instructions: '', tools: ['probe'] }).inspect(options);
      expect(report.inspection?.tools).toEqual([{ name: 'probe', schemaDigest: contentDigest(tool.definition.function.parameters) }]);
      expect(report.inspection?.enforcement.nativeCommands).toBe('unknown'); expect(report.inspection?.accountAccess).toBe('unknown'); expect(report.inspection?.executionDigest).toHaveLength(64);
      expect(opened).not.toHaveBeenCalled();
    } finally { await runtime.destroy(); }
  });
  it('deduplicates canonical request/tool arguments while rejecting a changed value', async () => {
    const storage = new InMemoryRuntimeSessionStorage();
    const runtime = new AgentRuntime({ backend: new LocalExecutionBackend({ drivers: [driver()], sessionStorage: storage }) });
    try {
      const session = await runtime.createAgent({ id: 'a', instructions: '' }).openSession(options);
      const run = await session.run('same', { requestId: 'canonical', metadata: { a: 1, b: 2 } }); await run.result;
      expect(await session.run('same', { metadata: { b: 2, a: 1 }, requestId: 'canonical' })).toBe(run);
    } finally { await runtime.destroy(); }
    let calls = 0; const lease = await storage.acquire('session_canonical', {}); const control = new RuntimeControl(lease, await lease.write({ outbox: {} }, 0));
    const host = new RuntimeHostTools({ fingerprint: 'v1', tools: [{ ...tool, execute: async () => { calls++; return 'once'; } }] }, {}); host.control = control;
    try {
      await host.beginRun('r', new AbortController().signal);
      await host.execute('probe', { a: { x: 1, y: 2 }, b: 3 }, 'call'); await host.execute('probe', { b: 3, a: { y: 2, x: 1 } }, 'call');
      expect(calls).toBe(1); await expect(host.execute('probe', { a: { x: 2, y: 2 }, b: 3 }, 'call')).rejects.toThrow('different arguments');
    } finally { await host.endRun(); await host.close(); await control.release(); }
  });
  it('requires exact selection and a verified host-tools capability', async () => {
    const runtime = new AgentRuntime({ backend: new LocalExecutionBackend({ drivers: [driver()], resolveTools: () => ({ tools: [], fingerprint: 'v1' }) }) });
    await expect(runtime.createAgent({ id: 'a', instructions: '', tools: ['probe'] }).inspect(options)).rejects.toThrow('exactly');
    expect(() => runtime.createAgent({ id: 'a', instructions: '', tools: ['probe','probe'] })).toThrow('unique');
    expect(() => runtime.createAgent({ id: 'a', instructions: '', model: 'misplaced' } as unknown as Parameters<typeof runtime.createAgent>[0])).toThrow('unknown field');
    await runtime.destroy();
  });
  it('preserves an existing manager pipeline and raw business values', async () => {
    const manager = new ToolManager(); manager.register(tool);
    const middleware = vi.fn(); manager.executionPipeline.use({ name: 'test', beforeExecute: async () => { middleware(); } });
    const host = new RuntimeHostTools({ tools: [tool], manager, fingerprint: 'implementation+scope-v1' }, {});
    await expect(host.execute('probe', {}, 'outside')).rejects.toThrow('active run');
    await host.beginRun('run', new AbortController().signal);
    const report = await host.execute('probe', {}, 'call');
    expect(report.rawResult).toEqual({ success: false, businessValue: 3 }); expect(report.outcome.status).toBe('succeeded'); expect(middleware).toHaveBeenCalledOnce();
    await expect(host.execute('foreign', {}, 'call2')).rejects.toThrow('not selected');
    await host.close(); expect(manager.isDestroyed).toBe(false); manager.destroy();
  });
  it.each([false, true])('retains original evidence owner/projection and never repeats a failed observation, storage failure=%s', async fail => {
    const raw = { id: 'exact-source', detail: 'SOURCE'.repeat(3000) }; let calls = 0;
    const storage = new InMemoryEvidenceStorage({ scope: { ownerId: 'b', namespace: 'runtime' } });
    if (fail) vi.spyOn(storage, 'put').mockRejectedValue(new Error('storage unavailable'));
    const probe = { ...tool, execute: async () => { calls++; return raw; }, output: { effect: 'read' as const, summarize: () => 'exact-source' } };
    const manager = new ToolManager(); manager.setToolContext({ userId: 'b' }); manager.register(probe); manager.setEvidenceMiddleware(new ToolEvidenceMiddleware({ storage, projectThresholdBytes: 1 }));
    const retained = vi.fn(); const host = new RuntimeHostTools({ tools: [probe], manager, fingerprint: 'evidence-v1', onRetainedObservation: retained }, { userId: 'b' });
    const stop = vi.fn(); await host.beginRun('r', new AbortController().signal, stop);
    try {
      if (fail) {
        await expect(host.execute('probe', {}, 'original')).rejects.toThrow('raw result is retained');
        await expect(host.execute('probe', {}, 'original')).rejects.toThrow('raw result is retained');
        expect(host.retainedObservation('original')?.result).toBe(raw); expect(retained).toHaveBeenCalledOnce(); expect(stop).toHaveBeenCalledOnce();
      } else {
        const report = await host.execute('probe', {}, 'original'); expect(report.rawResult).toBe(raw);
        expect(report.modelText).toContain('exact-source'); expect(report.modelText).not.toContain('SOURCESOURCE');
        expect(await storage.readRecord(report.evidence!.reference!)).toMatchObject({ result: raw, source: { callId: 'original', runId: 'r' } });
        await host.execute('probe', {}, 'original');
      }
      expect(calls).toBe(1);
    } finally { await host.endRun(); await host.close(); expect(manager.isDestroyed).toBe(false); manager.destroy(); }
  });
  it('stops native continuation after failed result acknowledgement, then redelivers without another action', async () => {
    let calls = 0; const raw = { effect: 'committed' }; const retained = vi.fn(); const stop = vi.fn();
    const host = new RuntimeHostTools({ fingerprint: 'v1', onRetainedObservation: retained, tools: [{ ...tool, execute: async () => { calls++; return raw; } }] }, {});
    const storage = new InMemoryRuntimeSessionStorage(); const lease = await storage.acquire('session_ack', {}); const initial = await lease.write({ outbox: {} }, 0);
    let writes = 0; let fail = true;
    const control = new RuntimeControl({ ...lease, write: async (data, revision) => { if (++writes > 1 && fail) throw new Error('Result acknowledgement unavailable'); return lease.write(data, revision); } }, initial); host.control = control;
    try {
      await host.beginRun('run', new AbortController().signal, stop);
      await expect(host.execute('probe', {}, 'native-call')).rejects.toThrow('acknowledgement unavailable');
      expect(calls).toBe(1); expect(stop).toHaveBeenCalledOnce(); expect(retained).toHaveBeenCalledOnce(); expect(host.retainedObservation('native-call')?.result).toBe(raw);
      fail = false; const report = await host.execute('probe', {}, 'native-call'); expect(report.modelText).toContain('committed'); expect(calls).toBe(1); expect(host.retainedObservation('native-call')).toBeUndefined();
    } finally { await host.endRun(); await host.close(); await control.release(); }
  });
  it.each([false, true])('preserves native call IDs while separating different admitted runs, control=%s', async durable => {
    let calls = 0; const host = new RuntimeHostTools({ fingerprint: 'v1', tools: [{ ...tool, execute: async () => ++calls }] }, {});
    const store = new InMemoryRuntimeSessionStorage(); const lease = await store.acquire('session_reused', {}); const control = new RuntimeControl(lease, await lease.write({ outbox: {} }, 0));
    if (durable) host.control = control;
    try {
      for (const id of ['first', 'second']) {
        await host.beginRun(id, new AbortController().signal);
        const report = await host.execute('probe', {}, 'same-native-call-id'); expect(report.outcome.callId).toBe('same-native-call-id'); expect(report.outcome.runId).toBe(id);
        await host.endRun();
      }
      expect(calls).toBe(2);
    } finally { await host.close(); await control.release(); }
  });
  it('rejects asynchronous tool scheduling instead of rewriting metadata', () => {
    expect(() => new RuntimeHostTools({ tools: [{ ...tool, definition: { ...tool.definition, blocking: false } }], fingerprint: 'x' }, {})).toThrow('blocking');
  });
  it('keeps legacy drivers usable but rejects them for definition sessions', async () => {
    const legacy = driver(); legacy.inspect = async () => ({ capabilities: { driverId: 'fixture', capabilities: {} } });
    const runtime = new AgentRuntime({ backend: new LocalExecutionBackend({ drivers: [legacy] }) });
    const session = await runtime.agent({ id: 'old', driver: 'fixture' }).openSession(options); expect(session.isDestroyed).toBe(false);
    await expect(runtime.createAgent({ id: 'new', instructions: '' }).openSession(options)).rejects.toThrow('agent.definition'); await runtime.destroy();
  });
  it('uses an explicit Agent lifecycle owner with original execution IDs and one manager', async () => {
    createMockConnector('owner');
    const owner = Agent.create({ connector: 'owner', model: 'gpt-4', userId: 'b', tools: [tool] });
    const host = new RuntimeHostTools({ tools: [tool], owner, fingerprint: 'owner-scope-v1' }, { userId: 'b' });
    const storage = new InMemoryRuntimeSessionStorage(); const lease = await storage.acquire('session_owner', { userId: 'b' });
    const control = new RuntimeControl(lease, await lease.write({ outbox: {}, runs: { runtime_run: { state: 'observing' } } }, 0)); host.control = control;
    const complete = vi.fn(); owner.on('execution:complete', complete);
    try {
      await host.beginRun('runtime_run', new AbortController().signal, undefined, 'original user input');
      expect(owner.isRunning()).toBe(true); expect(owner.tools).toBe(owner.context.tools);
      const report = await host.execute('probe', {}, 'original-call');
      expect(report.outcome.runId).toMatch(/^exec_/); expect(report.outcome.callId).toBe('original-call'); expect(report.rawResult).toEqual({ success: false, businessValue: 3 });
      const saved = ((control.data.outbox as Record<string, { call: { runId: string; runtimeRunId: string } }> )['original-call'])!;
      expect(saved.call.runId).toBe(report.outcome.runId); expect(saved.call.runtimeRunId).toBe('runtime_run');
      await host.endRun(); expect(owner.isRunning()).toBe(false); expect(complete).toHaveBeenCalledOnce();
    } finally { await host.close(); await control.release(); owner.destroy(); }
  });
  it.each(['completed','failed','cancelled','incomplete'] as const)('forwards the verified native %s result to the explicit Agent lifecycle owner', async status => {
    createMockConnector('lifecycle-owner'); const owner = Agent.create({ connector: 'lifecycle-owner', model: 'gpt-4', userId: 'b', tools: [tool] });
    const complete = vi.fn(); owner.on('execution:complete', complete);
    const native = driver(); const open = native.openSession;
    native.openSession = async request => { const session = await open(request); const run = session.run.bind(session); session.run = async input => ({ ...await run(input), result: Promise.resolve({ status, outputText: 'Actual native answer' }) }); return session; };
    const runtime = new AgentRuntime({ backend: new LocalExecutionBackend({ drivers: [native], resolveTools: () => ({ tools: [tool], owner, fingerprint: 'lifecycle-owner-v1' }) }) });
    try {
      const session = await runtime.createAgent({ id: 'a', instructions: '', tools: ['probe'] }).openSession(options);
      expect((await (await session.run('task')).result).status).toBe(status);
      expect(complete).toHaveBeenCalledOnce(); expect(complete.mock.calls[0]?.[0].response).toMatchObject({ status, output_text: 'Actual native answer' });
      expect(owner.isRunning()).toBe(false);
    } finally { await runtime.destroy(); owner.destroy(); }
  });
  it('reconciles an orphaned original effect without executing a replacement action', async () => {
    const execute = vi.fn(async () => 'must not run');
    const outcome = { executionId: 'original', toolName: 'probe', callId: 'call', runId: 'run', status: 'succeeded' as const, startedAt: 1, durationMs: 1, executionStarted: true, completion: 'settled' as const, cancellation: 'none' as const };
    const host = new RuntimeHostTools({ tools: [{ ...tool, execute }], fingerprint: 'v1', reconcile: async () => ({ result: { value: 'source-proof' }, outcome }) }, {});
    const storage = new InMemoryRuntimeSessionStorage(); const lease = await storage.acquire('session_orphan', {});
    const digest = definitionDigest({ id: 'probe', instructions: '{}' });
    const control = new RuntimeControl(lease, await lease.write({ runs: { run: { state: 'unknown' } }, outbox: { call: { state: 'executing', digest, call: { name: 'probe', args: {}, callId: 'call', runId: 'run' } } } }, 0)); host.control = control;
    await host.reconcilePending(); await host.beginRun('run', new AbortController().signal);
    expect((await host.execute('probe', {}, 'call')).modelText).toBe('{"value":"source-proof"}'); expect(execute).not.toHaveBeenCalled();
    await host.endRun(); await host.close(); await control.release();
  });

});
