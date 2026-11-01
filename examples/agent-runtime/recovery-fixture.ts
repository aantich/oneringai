import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AgentDriver, DriverOpenSessionRequest, DriverSession, DriverRun, RuntimeToolResolver } from 'oneringai/agent-runtime';
import { Connector, Vendor } from 'oneringai';
import type { ToolExecutionReport } from 'oneringai';

interface RemoteState { inputs: number; writes: number; acknowledgements: number; runId: string; receipt?: { result: string; timestamp: number } }
export async function readRemote(directory: string): Promise<RemoteState> { return JSON.parse(await readFile(path.join(directory, 'synthetic-remote.json'), 'utf8')) as RemoteState; }
async function writeRemote(directory: string, value: RemoteState): Promise<void> { await writeFile(path.join(directory, 'synthetic-remote.json'), JSON.stringify(value)); }

/** Synthetic remote service persists independently of the runtime's control/evidence state. */
export function recoveryFixture(directory: string, crashAfterWrite = false): { driver: AgentDriver; resolveTools: RuntimeToolResolver } {
  if (!Connector.has('synthetic')) Connector.create({ name: 'synthetic', vendor: Vendor.OpenAI, auth: { type: 'none' } });
  const create = (request: DriverOpenSessionRequest) => {
    let detached = false; let destroyed = false; let wake: (() => void) | undefined;
    const observe = (recovered: boolean): DriverRun => {
      let finish!: (value: { status: 'completed'; outputText: string }) => void;
      const result = new Promise<{ status: 'completed'; outputText: string }>(resolve => { finish = resolve; });
      const events = (async function* () {
        const report = await request.hostTools!.execute('submit_job', {}, 'native-call-1');
        if (!report.modelText.includes('ACK')) throw new Error('Original result was lost');
        yield { type: 'tool.completed' as const, data: { name: 'submit_job', replayed: recovered } };
        if (!recovered) { await new Promise<void>(resolve => { wake = resolve; if (detached) resolve(); }); return; }
        const state = await readRemote(directory); state.acknowledgements++; await writeRemote(directory, state);
        finish({ status: 'completed', outputText: 'ACK' });
      })();
      return { events, result, cancel: async () => {} };
    };
    const session: DriverSession = {
      get isDestroyed() { return destroyed; }, destroy: async () => { destroyed = true; wake?.(); },
      cancelActiveRun: async () => {}, detach: async () => { detached = true; wake?.(); },
      checkpoint: async () => ({ kind: 'synthetic-remote-v1', nativeId: request.sessionId! }),
      inspectState: async () => ({ connection: 'attached', activity: request.control?.data.activeRunId ? 'running' : 'ready', activeRunId: request.control?.data.activeRunId as string | undefined, unresolvedEffects: false }),
      run: async () => {
        await writeRemote(directory, { inputs: 1, writes: 0, acknowledgements: 0, runId: String(request.control?.data.activeRunId) });
        return observe(false);
      },
    };
    return { session, observe };
  };
  const driver: AgentDriver = {
    id: 'offline.remote.fixture',
    inspect: async () => ({ capabilities: { driverId: 'offline.remote.fixture', capabilities: Object.fromEntries(['agent.definition','tools.host','session.restore'].map(id => [id, { id, support: 'native' as const }])) } }),
    openSession: async request => create(request).session,
    restoreSession: async request => { const native = create(request); return { session: native.session, ...(request.control?.data.activeRunId ? { activeRun: native.observe(true) } : {}) }; },
    deleteSession: async () => {},
  };
  const resolveTools: RuntimeToolResolver = () => ({ fingerprint: 'synthetic-remote-scope-v1', tools: [{
    definition: { type: 'function', function: { name: 'submit_job', description: 'Synthetic external write', parameters: { type: 'object', properties: {}, additionalProperties: false } } },
    output: { effect: 'write' },
    execute: async () => {
      const state = await readRemote(directory); state.writes++; state.receipt = { result: 'ACK', timestamp: Date.now() }; await writeRemote(directory, state);
      if (crashAfterWrite) process.exit(0); // Intentional child-process crash after the synthetic service acknowledges its write.
      return { value: 'ACK' };
    },
  }], reconcile: async call => {
    const state = await readRemote(directory);
    if (!state.receipt || state.runId !== call.runId || call.callId !== 'native-call-1') return undefined;
    // Host-owned synthetic source receipt, using the existing outcome type; this is not another tool execution.
    const report: ToolExecutionReport = { result: { value: state.receipt.result }, outcome: { executionId: 'synthetic-source-receipt', toolName: call.name, callId: call.callId, runId: call.runId, status: 'succeeded', startedAt: state.receipt.timestamp, durationMs: 0, executionStarted: true, completion: 'settled', cancellation: 'none' } };
    return report;
  } });
  return { driver, resolveTools };
}
