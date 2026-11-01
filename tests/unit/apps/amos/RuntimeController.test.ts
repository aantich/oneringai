import { afterEach, describe, expect, it } from 'vitest';
import { Connector, Vendor } from '@/index.js';
import { AgentRuntime, LocalExecutionBackend, InMemoryRuntimeSessionStorage } from '@/agent-runtime/index.js';
import type { AgentDriver, DriverRunResult } from '@/agent-runtime/index.js';
import { AmosRuntimeController } from '../../../../apps/amos/src/runtime/AmosRuntimeController.js';

afterEach(() => Connector.clear());
describe('AMOS harness-neutral runtime mode', () => {
  it('exits during stalled admission, releases storage and never dispatches late input', async () => {
    Connector.create({ name: 'fixture', vendor: Vendor.OpenAI, auth: { type: 'none' } });
    let enter!: () => void; let release!: () => void; let inspect = false; let dispatches = 0;
    const entered = new Promise<void>(resolve => { enter = resolve; }); const pending = new Promise<void>(resolve => { release = resolve; });
    const storage = new InMemoryRuntimeSessionStorage();
    const driver: AgentDriver = { id: 'fixture', inspect: async () => ({ capabilities: { driverId: 'fixture', capabilities: { 'agent.definition': { id: 'agent.definition', support: 'native' } } } }), openSession: async () => ({
      isDestroyed: false, destroy: async () => {}, cancelActiveRun: async () => {}, checkpoint: async () => ({ kind: 'fixture' }),
      inspectState: async () => { if (inspect) { enter(); await pending; } return { connection: 'attached', activity: 'ready', unresolvedEffects: false }; },
      run: async () => { dispatches++; throw new Error('Input must never dispatch'); },
    }) };
    const runtime = new AgentRuntime({ backend: new LocalExecutionBackend({ drivers: [driver], sessionStorage: storage }) });
    const options = { execution: { driver: 'fixture', connector: 'fixture', model: 'fixture' }, context: { userId: 'owner' }, policy: { filesystem: 'denied', commands: 'denied', sandboxNetwork: 'denied', providerWebSearch: 'denied', approvals: 'deny' } } as const;
    const ui = new AmosRuntimeController({ runtime, definition: { id: 'a', instructions: '' }, options } as unknown as ConstructorParameters<typeof AmosRuntimeController>[0], () => {});
    try {
      await ui.open(); const reference = ui.snapshot().reference as { id: string }; inspect = true;
      const admission = ui.input('pending'); const rejected = expect(admission).rejects.toThrow(/cancelled|closed|exit/);
      await entered;
      await Promise.race([Promise.all([ui.close(), rejected]), new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('AMOS exit hung')), 500); timer.unref(); })]);
      expect(ui.snapshot().attached).toBe(false); expect(runtime.isDestroyed).toBe(true);
      const lease = await storage.acquire(reference.id, options.context); await lease.release();
      release(); await Promise.resolve(); expect(dispatches).toBe(0);
    } finally { release(); await ui.close(); }
  });
  it('releases the runtime when explicit native cancellation fails', async () => {
    let destroyed = false;
    const session = { reference: () => ({ version: 1, id: 'session_failure' }), capabilities: {}, inspectState: async () => ({ activity: 'ready' }), cancelActiveRun: async () => { throw new Error('Native stop acknowledgement lost'); } };
    const runtime = { createAgent: () => ({ inspect: async () => ({}), openSession: async () => session }), destroy: async () => { destroyed = true; } };
    const ui = new AmosRuntimeController({ runtime, definition: { id: 'a', instructions: '' }, options: {} } as unknown as ConstructorParameters<typeof AmosRuntimeController>[0], () => {});
    await ui.open(); await expect(ui.close()).rejects.toThrow('acknowledgement lost'); expect(destroyed).toBe(true); expect(ui.snapshot().attached).toBe(false);
  });
  it('renders activity/results, gates native commands and handles stop/detach/reattach without new input', async () => {
    Connector.create({ name: 'amos-runtime', vendor: Vendor.OpenAI, auth: { type: 'none' } });
    let inputs = 0; let finish!: (result: DriverRunResult) => void; let destroyed = false;
    const driver: AgentDriver = { id: 'fixture', inspect: async () => ({ capabilities: { driverId: 'fixture', capabilities: { 'agent.definition': { id: 'agent.definition', support: 'native' }, 'run.cancel': { id: 'run.cancel', support: 'native' } } } }), openSession: async () => ({
      get isDestroyed() { return destroyed; }, destroy: async () => { destroyed = true; }, detach: async () => {}, cancelActiveRun: async () => { finish?.({ status: 'cancelled', outputText: '' }); },
      run: async () => {
        inputs++; const result = new Promise<DriverRunResult>(resolve => { finish = resolve; });
        return { result, events: (async function* () { yield { type: 'agent.message.delta' as const, data: { text: 'working' } }; await result; })(), cancel: async () => { finish({ status: 'cancelled', outputText: '' }); } };
      },
    }) };
    const runtime = new AgentRuntime({ backend: new LocalExecutionBackend({ drivers: [driver] }) });
    const views: { type: string; data: unknown }[] = [];
    const ui = new AmosRuntimeController({ runtime, definition: { id: 'a', instructions: '' }, options: { execution: { driver: 'fixture', connector: 'amos-runtime', model: 'fixture' }, context: { userId: 'owner' }, policy: { filesystem: 'denied', commands: 'denied', sandboxNetwork: 'denied', providerWebSearch: 'denied', approvals: 'deny' } } }, view => views.push(view));
    try {
      await ui.open(); await expect(ui.input('/context')).rejects.toThrow('unavailable');
      await ui.input('work'); await expect(ui.input('second')).rejects.toThrow('already active');
      await ui.input('/status'); await ui.input('/stop'); await ui.wait();
      expect(views.some(view => view.type === 'activity')).toBe(true); expect(views.find(view => view.type === 'result')?.data).toMatchObject({ status: 'cancelled' });
      const reference = ui.snapshot().reference; await ui.input('/detach'); expect(ui.snapshot().attached).toBe(false);
      await expect(ui.input('no observer')).rejects.toThrow('detached'); await ui.input('/resume'); expect(ui.snapshot().reference).toEqual(reference); expect(inputs).toBe(1);
    } finally { await ui.close(); }
  });
});
