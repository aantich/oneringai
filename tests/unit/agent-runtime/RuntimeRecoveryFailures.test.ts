import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Connector } from '@/core/Connector.js';
import { Vendor } from '@/core/Vendor.js';
import { AgentRuntime, LocalExecutionBackend, InMemoryRuntimeSessionStorage, FileRuntimeSessionStorage } from '@/agent-runtime/index.js';
import type { AgentDriver, DriverSession, DriverOpenSessionRequest, DriverRunRequest, DriverRunResult, JsonObject, RuntimeRunOptions } from '@/agent-runtime/index.js';
import type { IRuntimeSessionStorage } from '@/agent-runtime/RuntimeSessionStorage.js';
import { OpenAIManagedDriver } from '@/agent-runtime/openai-managed.js';
import { ClaudeManagedDriver } from '@/agent-runtime/claude-managed.js';
import { openAIManagedFixture } from '../../../examples/agent-runtime/openai-managed-fixture.js';
import { claudeManagedFixture } from '../../../examples/agent-runtime/claude-managed-fixture.js';

const policy = { filesystem: 'denied', commands: 'denied', sandboxNetwork: 'denied', providerWebSearch: 'denied', approvals: 'deny' } as const;
const context = { userId: 'owner' };
const options = { execution: { driver: 'fixture', connector: 'fixture', model: 'fixture' }, context, policy };
const directories: string[] = [];
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
async function directory() { const root = await mkdtemp(path.join(tmpdir(), 'runtime-review-')); directories.push(root); return root; }
afterEach(async () => { Connector.clear(); await Promise.all(directories.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
function fixtureDriver(overrides: Partial<DriverSession> = {}): AgentDriver {
  const openSession = async (): Promise<DriverSession> => ({
    isDestroyed: false, destroy: async () => {}, cancelActiveRun: async () => {}, detach: async () => {}, checkpoint: async () => ({ kind: 'fixture' }),
    run: async () => ({ events: (async function* () {})(), result: Promise.resolve({ status: 'completed', outputText: 'ACK' }), cancel: async () => {} }),
    ...overrides,
  });
  return { id: 'fixture', inspect: async () => ({ capabilities: { driverId: 'fixture', capabilities: Object.fromEntries(['agent.definition', 'run.model_override', 'run.reasoning_override', 'run.structured_output'].map(id => [id, { id, support: 'native' as const }])) } }), openSession, restoreSession: async () => ({ session: await openSession() }) };
}

describe('review regressions: request identity and failed restoration', () => {
  it.each([false, true])('dispatches the recorded request despite caller mutation during admission, storage=%s', async persisted => {
    Connector.create({ name: 'fixture', vendor: Vendor.OpenAI, auth: { type: 'none' } });
    const inspected = deferred<void>(); const proceed = deferred<void>(); const started = deferred<void>(); const completed = deferred<DriverRunResult>();
    const invoked = vi.fn(async (_request: DriverRunRequest) => { started.resolve(); return { events: (async function* () {})(), result: completed.promise, cancel: async () => {} }; });
    const runtime = new AgentRuntime({ backend: new LocalExecutionBackend({ sessionStorage: persisted ? new InMemoryRuntimeSessionStorage() : undefined, drivers: [fixtureDriver({ inspectState: async () => { inspected.resolve(); await proceed.promise; return { connection: 'attached', activity: 'ready', unresolvedEffects: false }; }, run: invoked })] }) });
    try {
      const session = await runtime.createAgent({ id: 'logical', instructions: '' }).openSession(options);
      const input = { parts: [{ type: 'text' as const, text: 'read invoice A' }] };
      const runOptions: RuntimeRunOptions = { requestId: 'stable', model: 'original-model', reasoning: { effort: 'low' }, responseFormat: { type: 'json_schema', schema: { type: 'object', properties: { original: { type: 'boolean' } } } }, metadata: { selected: { account: 'original' } } };
      const original = structuredClone({ input, options: runOptions });
      const pending = session.run(input, runOptions);
      input.parts[0]!.text = 'pay invoice B'; runOptions.model = 'changed-model';
      await inspected.promise;
      runOptions.reasoning!.effort = 'high'; if (runOptions.responseFormat?.type === 'json_schema') runOptions.responseFormat.schema.type = 'string'; runOptions.responseFormat = { type: 'text' }; (runOptions.metadata!.selected as JsonObject).account = 'changed';
      proceed.resolve(); const run = await pending; await started.promise;
      completed.resolve({ status: 'completed', outputText: 'ACK' }); await run.result;
      expect(invoked).toHaveBeenCalledOnce();
      expect(invoked.mock.calls[0]![0]).toMatchObject({ input: original.input, model: original.options.model, reasoning: original.options.reasoning, responseFormat: original.options.responseFormat, metadata: original.options.metadata });
      expect(await session.run(original.input, original.options)).toBe(run);
      await expect(session.run(input, runOptions)).rejects.toThrow('different input');
    } finally { proceed.resolve(); completed.resolve({ status: 'completed', outputText: 'ACK' }); await runtime.destroy(); }
  });

  it('retains live signal cancellation while detaching the serializable request snapshot', async () => {
    Connector.create({ name: 'fixture', vendor: Vendor.OpenAI, auth: { type: 'none' } });
    const inspected = deferred<void>(); const proceed = deferred<void>(); const driver = fixtureDriver(); const open = driver.openSession;
    const invoked = vi.fn();
    driver.openSession = async request => { const native = await open(request); const run = native.run; return { ...native, inspectState: async () => { inspected.resolve(); await proceed.promise; return { connection: 'attached', activity: 'ready', unresolvedEffects: false }; }, run: async request => { invoked(); return run(request); } }; };
    const runtime = new AgentRuntime({ backend: new LocalExecutionBackend({ drivers: [driver] }) });
    try {
      const session = await runtime.createAgent({ id: 'logical', instructions: '' }).openSession(options);
      const signal = new AbortController(); const pending = session.run('original', { signal: signal.signal }); void pending.catch(() => undefined);
      await inspected.promise; signal.abort(new Error('Host cancelled admission')); proceed.resolve();
      await expect(pending).rejects.toThrow('Host cancelled admission'); expect(invoked).not.toHaveBeenCalled();
      expect((await (await session.run('next')).result).status).toBe('completed'); expect(invoked).toHaveBeenCalledOnce();
    } finally { proceed.resolve(); await runtime.destroy(); }
  });

  it.each(['memory', 'file'] as const)('releases the %s writer after a transient initial read failure', async kind => {
    Connector.create({ name: 'fixture', vendor: Vendor.OpenAI, auth: { type: 'none' } });
    const base = kind === 'file' ? new FileRuntimeSessionStorage(await directory()) : new InMemoryRuntimeSessionStorage(); let fail = false;
    const storage: IRuntimeSessionStorage = { durability: base.durability, acquire: async (id, scope) => {
      const lease = await base.acquire(id, scope); return { ...lease, read: async () => { if (fail) { fail = false; throw new Error('Transient read failure'); } return lease.read(); } };
    } };
    const runtime = new AgentRuntime({ backend: new LocalExecutionBackend({ drivers: [fixtureDriver()], sessionStorage: storage }) });
    try {
      const session = await runtime.createAgent({ id: 'logical', instructions: '' }).openSession(options); const reference = session.reference(); await session.detach();
      fail = true; await expect(runtime.resumeSession(reference, { context })).rejects.toThrow('Transient read failure');
      const recovered = await runtime.resumeSession(reference, { context }); expect((await (await recovered.run('original')).result).outputText).toBe('ACK');
    } finally { await runtime.destroy(); }
  });

  it.each(['sequence-write', 'adoption'] as const)('keeps provisional sessions out of the cache after %s failure, permitting a real retry', async failure => {
    Connector.create({ name: 'fixture', vendor: Vendor.OpenAI, auth: { type: 'none' } });
    const base = new InMemoryRuntimeSessionStorage(); let fail = false;
    const writeEntered = deferred<void>(); const releaseWrite = deferred<void>();
    const storage: IRuntimeSessionStorage = { durability: base.durability, acquire: async (id, scope) => {
      const lease = await base.acquire(id, scope); return { ...lease, write: async (data, revision) => { if (fail && ((data.runs as JsonObject)?.run_original as JsonObject)?.sequenceHighWater) { fail = false; writeEntered.resolve(); await releaseWrite.promise; throw new Error('Sequence write failure'); } return lease.write(data, revision); } };
    } };
    const detached = vi.fn(); const destroyed = vi.fn(); const driver = fixtureDriver({ observationIndependent: true, detach: detached, destroy: destroyed });
    const restore = vi.fn(async (request: DriverOpenSessionRequest) => ({ session: await driver.openSession(request), activeRun: { events: (async function* () {})(), result: Promise.resolve({ status: 'completed' as const, outputText: 'original-result' }), cancel: async () => {} } })); driver.restoreSession = restore;
    const runtime = new AgentRuntime({ backend: new LocalExecutionBackend({ drivers: [driver], sessionStorage: storage }) });
    try {
      const session = await runtime.createAgent({ id: 'logical', instructions: '' }).openSession(options); const reference = session.reference(); await session.detach(); detached.mockClear();
      const lease = await base.acquire(reference.id, context); const record = (await lease.read())!;
      await lease.write({ ...record.data, activeRunId: 'run_original', runs: { run_original: { state: 'observing', payload: { input: 'original', options: failure === 'adoption' ? { responseFormat: { type: 'invalid' } } : {} }, sequenceHighWater: 0 } } }, record.revision); await lease.release();
      fail = failure === 'sequence-write'; const pending = runtime.resumeSession(reference, { context }); void pending.catch(() => undefined);
      if (failure === 'sequence-write') { await writeEntered.promise; await expect(runtime.resumeSession(reference, { context })).rejects.toThrow('writer'); releaseWrite.resolve(); }
      await expect(pending).rejects.toThrow(failure === 'adoption' ? 'Response format' : 'Sequence write failure');
      expect(detached).toHaveBeenCalledOnce(); expect(destroyed).not.toHaveBeenCalled();
      if (failure === 'adoption') { const repair = await base.acquire(reference.id, context); const current = structuredClone((await repair.read())!); ((current.data.runs as JsonObject).run_original as JsonObject).payload = { input: 'original', options: {} }; await repair.write(current.data, current.revision); await repair.release(); }
      const recovered = await runtime.resumeSession(reference, { context }); expect(restore).toHaveBeenCalledTimes(2);
      expect((await (await recovered.getRun('run_original')).result).outputText).toBe('original-result');
    } finally { releaseWrite.resolve(); await runtime.destroy(); }
  });

  it.each(['openai', 'claude'] as const)('failed %s observer restoration never cancels native work or resubmits its input', async vendor => {
    const base = new FileRuntimeSessionStorage(await directory()); let fail = false;
    const storage: IRuntimeSessionStorage = { durability: 'durable', acquire: async (id, scope) => {
      const lease = await base.acquire(id, scope); return { ...lease, write: async (data, revision) => { if (fail && Object.values((data.runs ?? {}) as JsonObject).some(value => Number((value as JsonObject).sequenceHighWater ?? 0) > 1000000)) { fail = false; throw new Error('Restored sequence write failure'); } return lease.write(data, revision); } };
    } };
    Connector.create({ name: 'fixture', vendor: vendor === 'openai' ? Vendor.OpenAI : Vendor.Anthropic, auth: { type: 'api_key', apiKey: 'offline-placeholder' } });
    const openai = openAIManagedFixture({ pauseCompletion: true }); const claude = claudeManagedFixture({ pauseAfterTool: true }); let effects = 0;
    const create = () => new AgentRuntime({ backend: new LocalExecutionBackend({ sessionStorage: storage, drivers: [vendor === 'openai' ? new OpenAIManagedDriver({ createClient: openai.createClient }) : new ClaudeManagedDriver({ createClient: claude.createClient })], resolveTools: () => ({ fingerprint: 'probe-v1', tools: [{ definition: { type: 'function', function: { name: 'probe', parameters: { type: 'object' } } }, execute: async () => { effects++; return { businessValue: 'original' }; } }] }) }) });
    const first = create(); const second = create();
    try {
      const session = await first.createAgent({ id: 'logical', instructions: 'Use probe', tools: ['probe'] }).openSession({ ...options, execution: { ...options.execution, driver: vendor === 'openai' ? 'openai.agents.api' : 'anthropic.managed.api', model: vendor === 'openai' ? 'gpt-6-astra' : 'claude-sonnet-4-6' }, ...(vendor === 'claude' ? { environment: { type: 'provider-managed' as const } } : {}) });
      const original = await session.run('original', { requestId: 'original' });
      await vi.waitFor(() => expect(vendor === 'openai' ? openai.counts.toolDeliveries : claude.counts.deliveries).toBe(1));
      const reference = session.reference(); await session.detach();
      fail = true; await expect(second.resumeSession(reference, { context })).rejects.toThrow('Restored sequence write failure');
      expect(openai.counts.cancels + claude.counts.interrupts).toBe(0);
      const recovered = await second.resumeSession(reference, { context }); (vendor === 'openai' ? openai : claude).complete();
      expect((await (await recovered.getRun(original.id)).result).outputText).toBe('ACK');
      expect(effects).toBe(1); expect(vendor === 'openai' ? openai.counts.inputs : claude.counts.inputs).toBe(1);
      await second.deleteSession(reference, { context });
    } finally { await second.destroy(); await first.destroy(); }
  });
});
