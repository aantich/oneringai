import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Agent, Connector, Vendor, createAgentPreset, InMemoryEvidenceStorage, exportAgentPackage, hydrateAgentPackage } from '../../../src/index.js';
import type { AgentContextNextGenConfig } from '../../../src/index.js';
import { AgentRuntime, LocalExecutionBackend, OneRingAIDriver } from '../../../src/agent-runtime/index.js';
import { CodexSdkDriver } from '../../../src/agent-runtime/codex.js';
import { ScriptedLoopProvider } from '../../../examples/agent-loop/scripted-provider.js';
const agents: Agent[] = [], dirs: string[] = [], runtimes: AgentRuntime[] = [];
afterEach(async () => { await Promise.all(runtimes.splice(0).map(r => r.destroy())); agents.splice(0).forEach(a => a.destroy()); Connector.clear(); await Promise.all(dirs.splice(0).map(d => rm(d, { recursive: true, force: true }))); });
function scoped(ownerId: string, model = 'gpt-4o-mini') {
  const scope = { ownerId, namespace: 'host-policy' };
  return createAgentPreset('workflow', { connector: 'main', model, userId: ownerId, context: { features: { workingMemory: false, inContextMemory: false }, plugins: { evidence: { scope, storage: new InMemoryEvidenceStorage({ scope }) }, taskState: { scope, taskId: 'T42' } } } });
}
const policy = { filesystem: 'denied' as const, commands: 'denied' as const, sandboxNetwork: 'denied' as const, providerWebSearch: 'denied' as const, approvals: 'deny' as const };
describe('preset host and runtime boundaries', () => {
  it('rehydrates policy under a new host scope and excludes provider-local config and callbacks', async () => {
    Connector.create({ name: 'main', vendor: Vendor.OpenAI, auth: { type: 'none' }, options: { provider: new ScriptedLoopProvider([{ text: 'Host verified' }]) } });
    const source = Agent.create({ connector: 'main', model: 'gpt-4o-mini', userId: 'source', context: { model: 'gpt-4o-mini', features: { workingMemory: false, inContextMemory: false } }, vendorOptions: { privateValue: 'DO_NOT_TRANSFER' }, loopPolicy: { completion: () => ({ complete: true }) } }); agents.push(source);
    const portable = exportAgentPackage(source, { toolPlacement: () => 'omit' });
    expect(JSON.stringify(portable)).not.toContain('DO_NOT_TRANSFER'); expect(portable.agent.runtime).not.toHaveProperty('loopPolicy');
    const receiving = scoped('receiver');
    const hydrated = await hydrateAgentPackage(portable, { connector: 'main', model: receiving.model, userId: 'receiver', permissions: {}, contextFactory: () => receiving.context as AgentContextNextGenConfig, agentConfig: { loopPolicy: receiving.loopPolicy } }); agents.push(hydrated);
    expect(hydrated.inspectCapabilities().context.plugins).toEqual(['evidence', 'task_state']);
    const scopedSource = Agent.create(scoped('source')); agents.push(scopedSource);
    await expect(hydrateAgentPackage(exportAgentPackage(scopedSource, { toolPlacement: () => 'omit' }), { connector: 'main', model: receiving.model, userId: 'receiver', permissions: {}, contextFactory: () => receiving.context as AgentContextNextGenConfig })).rejects.toThrow();
    expect(hydrated.inspectCapabilities().loop.hostCompletionCheck).toBe(false);
    const hostPolicy = { completion: () => ({ complete: true }) };
    const hostConfigured = await hydrateAgentPackage(portable, { connector: 'main', model: receiving.model, userId: 'receiver', permissions: {}, contextFactory: () => receiving.context as AgentContextNextGenConfig, agentConfig: { loopPolicy: hostPolicy, modelExecution: { helpers: { verifier: { connector: 'explicit-host', model: receiving.model } } } } }); agents.push(hostConfigured);
    expect(hostConfigured.inspectCapabilities().loop.hostCompletionCheck).toBe(true); expect(hostConfigured.inspectCapabilities().helpers.verifier?.connector).toBe('explicit-host');
    expect((await hostConfigured.run('Verify')).loop?.reason).toBe('completed');
    expect(JSON.stringify(hydrated.context.getPlugin('task_state')!.getState())).toContain('receiver');
    const invalid = structuredClone(portable); Object.assign(invalid.agent.runtime, { nativeTools: [{ capability: 'tool_search' }] });
    await expect(hydrateAgentPackage(invalid, { connector: 'main', model: receiving.model, permissions: {}, contextFactory: () => receiving.context as AgentContextNextGenConfig })).rejects.toThrow('unsupported field');
  });
  it('uses an existing runtime host factory without adding another loop or changing the portable spec', async () => {
    const provider = new ScriptedLoopProvider([{ text: 'Runtime preset response.' }]);
    Connector.create({ name: 'main', vendor: Vendor.OpenAI, auth: { type: 'none' }, options: { provider } });
    let made: Agent | undefined;
    const runtime = new AgentRuntime({ backend: new LocalExecutionBackend({ drivers: [new OneRingAIDriver({ trustAgentPolicy: true, factories: { workflow: ({ context }) => { made = Agent.create(scoped(context.userId!)); return made; } } })] }) }); runtimes.push(runtime);
    const selected = runtime.agent({ id: 'preset-runtime', driver: 'oneringai.agent', driverConfig: { source: { type: 'factory', name: 'workflow' } } });
    const inspected = await selected.inspect({ context: { userId: 'host' }, policy }); expect(made).toBeUndefined();
    expect(inspected.capabilities['context.native_compaction']).toBeUndefined(); expect(inspected.capabilities['tools.native_search']).toBeUndefined();
    const session = await selected.openSession({ context: { userId: 'host' }, policy }); const result = await (await session.run('hello')).result;
    expect(result.outputText).toBe('Runtime preset response.'); expect(provider.requests).toHaveLength(1); expect(made!.tools).toBe(made!.context.tools);
    expect(made!.inspectCapabilities().context.features.taskState).toBe(true);
    await session.destroy(); expect(made!.isDestroyed).toBe(true);
  });
  it('external SDK inspection does not advertise managed context/native controls and rejects preset injection', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'preset-external-')); dirs.push(directory);
    Connector.create({ name: 'main', vendor: Vendor.OpenAI, auth: { type: 'api_key', apiKey: 'unit-unused' } });
    let constructed = 0;
    class FakeCodex { constructor() { constructed++; } startThread() { throw Error('Inspection must not start a thread'); } }
    const driver = new CodexSdkDriver({ loadSdk: async () => ({ Codex: FakeCodex as never }) });
    const runtime = new AgentRuntime({ backend: new LocalExecutionBackend({ drivers: [driver] }) }); runtimes.push(runtime);
    const base = { id: 'external', driver: driver.id, connector: 'main', model: 'gpt-5.3-codex' };
    const request = { context: { userId: 'host' }, workspace: { type: 'local-directory' as const, path: directory }, policy: { ...policy, filesystem: 'workspace-write' as const, commands: 'sandboxed' as const } };
    const report = await runtime.agent(base).inspect(request);
    expect(report.capabilities['context.native_compaction']).toBeUndefined(); expect(report.capabilities['context.task_state']).toBeUndefined(); expect(report.capabilities['tools.native_search']).toBeUndefined();
    await expect(runtime.agent({ ...base, driverConfig: { preset: 'workflow' } }).inspect(request)).rejects.toThrow(/Unknown.*preset/i);
    await expect(runtime.agent({ ...base, requiredCapabilities: [{ id: 'context.task_state' }] }).inspect(request)).rejects.toThrow(); expect(constructed).toBe(0);
  });
});
