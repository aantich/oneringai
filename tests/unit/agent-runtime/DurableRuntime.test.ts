import { describe, expect, it, vi, afterEach } from 'vitest';
import { Connector } from '@/core/Connector.js';
import { Vendor } from '@/core/Vendor.js';
import { AgentRuntime, LocalExecutionBackend, InMemoryRuntimeSessionStorage } from '@/agent-runtime/index.js';
import type { AgentDriver, DriverRun, DriverOpenSessionRequest, DriverSession } from '@/agent-runtime/index.js';

const policy = { filesystem: 'denied', commands: 'denied', sandboxNetwork: 'denied', providerWebSearch: 'denied', approvals: 'deny' } as const;
afterEach(() => Connector.clear());
function fixture() {
  Connector.create({ name: 'fixture', vendor: Vendor.OpenAI, auth: { type: 'none' } });
  const storage = new InMemoryRuntimeSessionStorage();
  const submitted = vi.fn(); let active = false;
  const open = async (request: DriverOpenSessionRequest): Promise<DriverSession> => {
    let destroyed = false;
    const run = (): DriverRun => ({ events: (async function* () { yield { type: 'agent.message.completed', data: { text: 'original-result' } } as const; })(), result: Promise.resolve({ status: 'completed', outputText: 'original-result' }), cancel: async () => {} });
    return { get isDestroyed() { return destroyed; }, destroy: async () => { destroyed = true; }, cancelActiveRun: async () => {},
      checkpoint: async () => ({ kind: 'fixture', active }), detach: async () => { destroyed = true; },
      run: async () => { submitted(); active = true; const result = run(); void result.result.then(() => { active = false; }); return result; },
    };
  };
  const driver: AgentDriver = { id: 'durable-fixture', inspect: async () => ({ capabilities: { driverId: 'durable-fixture', capabilities: { 'agent.definition': { id: 'agent.definition', support: 'native' } } } }), openSession: open, restoreSession: async request => ({ session: await open(request) }) };
  const create = () => new AgentRuntime({ backend: new LocalExecutionBackend({ drivers: [driver], sessionStorage: storage }) });
  const options = { execution: { driver: driver.id, connector: 'fixture', model: 'fixture' }, context: { userId: 'owner' }, policy };
  return { create, options, submitted, storage };
}
describe('acknowledged runtime recovery', () => {
  it('recovers terminal requests and deduplicates without sending native input again', async () => {
    const f = fixture(); const first = f.create(); const session = await first.createAgent({ id: 'logical', instructions: 'test' }).openSession(f.options);
    const run = await session.run('original-input', { requestId: 'stable' }); expect((await run.result).outputText).toBe('original-result');
    const reference = session.reference(); await session.detach(); await first.destroy();
    const second = f.create();
    try {
      const recovered = await second.resumeSession(reference, { context: f.options.context });
      expect((await (await recovered.run('original-input', { requestId: 'stable' })).result).outputText).toBe('original-result');
      expect(f.submitted).toHaveBeenCalledOnce();
      expect(() => (recovered.getRun(run.id))).not.toThrow();
      expect(() => (awaitRun => awaitRun.events())(run)).not.toThrow();
      await expect(recovered.run('changed', { requestId: 'stable' })).rejects.toThrow('different input');
      await expect(second.resumeSession(reference, { context: { userId: 'foreign' } })).rejects.toThrow('scope');
      await second.deleteSession(reference, { context: f.options.context });
    } finally { await second.destroy(); }
  });
  it('records ambiguous admission before native work and blocks accidental resubmission', async () => {
    const f = fixture(); const first = f.create(); const session = await first.createAgent({ id: 'logical', instructions: 'test' }).openSession(f.options); const reference = session.reference();
    await session.detach(); await first.destroy();
    const lease = await f.storage.acquire(reference.id, f.options.context); const record = (await lease.read())!;
    await lease.write({ ...record.data, activeRunId: 'run_unknown', requests: { stable: { digest: 'unreconciled', runId: 'run_unknown' } }, runs: { run_unknown: { state: 'submitting', payload: { input: 'original', options: {} } } } }, record.revision); await lease.release();
    const second = f.create();
    try {
      const recovered = await second.resumeSession(reference, { context: f.options.context });
      expect((await recovered.inspectState()).unresolvedEffects).toBe(true);
      await expect(recovered.run('do it again')).rejects.toThrow('reconciliation');
      await expect(recovered.getRun('run_unknown')).rejects.toThrow('no reconciled');
      expect(f.submitted).not.toHaveBeenCalled();
    } finally { await second.destroy(); }
  });
});
