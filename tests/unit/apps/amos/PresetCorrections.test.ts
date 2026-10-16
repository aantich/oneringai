import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentRegistry, Connector, Vendor, FileContextStorage, FileEvidenceStorage, type ToolFunction, type EvidenceScope, type TaskStateSnapshot, BasePluginNextGen, type Agent } from '@everworker/oneringai';
import { ScriptedLoopProvider } from '../../../../examples/agent-loop/scripted-provider.js';
import { AmosApp } from '../../../../apps/amos/src/app.js';
import { AgentRunner } from '../../../../apps/amos/src/agent/AgentRunner.js';
import { AmosSessionStorage } from '../../../../apps/amos/src/agent/AmosSessionStorage.js';
import { ConfigManager } from '../../../../apps/amos/src/config/ConfigManager.js';
import type { AmosConfig, CommandContext } from '../../../../apps/amos/src/config/types.js';

const dirs: string[] = [], apps: AmosApp[] = [], runners: AgentRunner[] = [];
function storage(runner: AgentRunner) { return (runner as unknown as { storage: AmosSessionStorage }).storage; }
afterEach(async () => {
  for (const app of apps.splice(0)) app.destroyAgent();
  for (const runner of runners) runner.destroy();
  await Promise.all(runners.splice(0).map(runner => storage(runner).flush()));
  Connector.clear(); vi.restoreAllMocks();
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});
async function fixture(autoSave = false, tool?: ToolFunction) {
  const dir = await mkdtemp(join(tmpdir(), 'amos-corrections-')); dirs.push(dir);
  const manager = new ConfigManager(dir); const config = await manager.load(); config.permissions.allowlist = ['probe']; config.permissions.promptForApproval = false;
  Object.assign(config, { preset: 'workflow', activeConnector: 'fixture', activeModel: 'gpt-4o-mini',
    evidence: { enabled: true, directory: join(dir, 'evidence'), ownerId: 'host', namespace: 'corrections' },
    taskState: { enabled: true, taskId: 'T42', ownerId: 'host', namespace: 'corrections' },
    session: { ...config.session, autoSave, autoSaveIntervalMs: 20, activeSessionId: null } });
  const provider = new ScriptedLoopProvider([...(tool ? [{ calls: [{ id: 'original', name: 'probe', args: {} }] }] : []), ...Array.from({ length: 20 }, () => ({ text: 'local answer' }))]);
  Connector.create({ name: 'fixture', vendor: Vendor.OpenAI, auth: { type: 'none' }, options: { provider } });
  const app = new AmosApp(dir); apps.push(app);
  Object.assign(app, { configManager: manager, connectorManager: { isRegistered: () => true }, toolLoader: { getEnabledTools: () => tool ? [tool] : [] }, promptManager: { getActiveContent: () => null } });
  let agent!: Agent; AgentRegistry.once('agent:registered', event => { agent = event.agent as Agent; });
  await app.createAgent(); const runner = app.getAgent() as AgentRunner; runners.push(runner);
  const invoke = (name: string, args: string[]) => app.getCommand(name)!.execute({ app, args, rawInput: `/${name} ${args.join(' ')}` } as CommandContext);
  return { app, runner, agent, dir, manager, config, provider, invoke };
}

describe('real AMOS app and session handoff', () => {
  it.each([false, true])('failed /session new preserves the old runner and %s saved-session pointer', async saved => {
    const f = await fixture(); await f.runner.run('Keep exact existing conversation.');
    if (saved) await f.runner.saveSession('keep');
    const id = f.app.getConfig().session.activeSessionId, count = AgentRegistry.count;
    expect((await f.invoke('preset', ['set', 'research'])).success).toBe(true);
    vi.spyOn(f.app, 'confirm').mockResolvedValue(false);
    vi.spyOn(AgentRunner.prototype, 'initialize').mockRejectedValueOnce(Error('candidate startup failed'));
    await expect(f.invoke('session', ['new'])).rejects.toThrow('candidate startup failed');
    expect(f.app.getAgent()).toBe(f.runner); expect(f.runner.isReady()).toBe(true); expect(AgentRegistry.count).toBe(count);
    expect(f.app.getConfig().session.activeSessionId).toBe(id); expect(f.runner.getSessionId()).toBe(id);
    expect(f.runner.inspectCapabilities().activePreset).toBe('workflow');
    await f.runner.run('Continue.'); expect(JSON.stringify(f.provider.requests[1])).toContain('Keep exact existing conversation.');
  });
  it('cleans an initialized failed candidate and leaves the prior runner usable', async () => {
    const f = await fixture(); await f.runner.run('Keep unsaved history.'); const count = AgentRegistry.count;
    const original = AgentRunner.prototype.initialize;
    vi.spyOn(AgentRunner.prototype, 'initialize').mockImplementationOnce(async function (this: AgentRunner, connector, model) {
      await original.call(this, connector, model); throw Error('after initialization');
    });
    await expect(f.app.createAgent({ freshSession: true })).rejects.toThrow('after initialization');
    expect(f.app.getAgent()).toBe(f.runner); expect(f.runner.isReady()).toBe(true); expect(AgentRegistry.count).toBe(count);
    expect(f.app.getConfig().session.activeSessionId).toBeNull();
  });
  it('commits a successful fresh session and keeps later session pointers connected to configuration', async () => {
    const f = await fixture(); await f.runner.run('Previous conversation.'); await f.runner.saveSession('old');
    await f.invoke('preset', ['set', 'research']); vi.spyOn(f.app, 'confirm').mockResolvedValue(false);
    expect((await f.invoke('session', ['new'])).success).toBe(true);
    const next = f.app.getAgent() as AgentRunner; runners.push(next);
    expect(next).not.toBe(f.runner); expect(f.runner.isReady()).toBe(false); expect(next.inspectCapabilities().activePreset).toBe('research');
    expect(f.app.getConfig().session.activeSessionId).toBeNull();
    await next.run('Fresh conversation.'); expect(JSON.stringify(f.provider.requests[1])).not.toContain('Previous conversation.');
    const id = await next.saveSession('new'); expect(f.app.getConfig().session.activeSessionId).toBe(id);
    expect((await new ConfigManager(f.dir).load()).session.activeSessionId).toBeNull();
    await f.app.saveConfig(); expect((await new ConfigManager(f.dir).load()).session.activeSessionId).toBe(id);
  });
  it('preserves checkpointed continuity across ordinary replacement and rejects overlapping initialization', async () => {
    const f = await fixture(); await f.runner.run('CONTINUITY');
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    const original = AgentRunner.prototype.initialize;
    vi.spyOn(AgentRunner.prototype, 'initialize').mockImplementationOnce(async function (this: AgentRunner, connector, model) { await gate; return original.call(this, connector, model); });
    const work = f.app.createAgent(); await expect(f.app.createAgent()).rejects.toThrow('initializing'); release(); await work;
    const next = f.app.getAgent() as AgentRunner; runners.push(next); await next.run('continue');
    expect(JSON.stringify(f.provider.requests[1])).toContain('CONTINUITY'); expect(f.runner.isReady()).toBe(false);
  });
  it('rejects repeated foreign-scope resumes without orphaning candidates or destroying old history', async () => {
    const f = await fixture(); await f.runner.run('ORIGINAL_HOST'); await f.runner.saveSession(); const count = AgentRegistry.count;
    f.app.updateConfig({ evidence: { ...f.config.evidence!, ownerId: 'foreign' }, taskState: { ...f.config.taskState!, ownerId: 'foreign' } });
    const pointer = f.app.getConfig().session.activeSessionId;
    for (let i = 0; i < 3; i++) await expect(f.app.createAgent()).rejects.toThrow();
    expect(AgentRegistry.count).toBe(count); expect(f.app.getAgent()).toBe(f.runner); expect(f.app.getConfig().session.activeSessionId).toBe(pointer);
    await f.runner.run('Continue under original host.'); expect(JSON.stringify(f.provider.requests[1])).toContain('ORIGINAL_HOST');
  });
  it('checkpoints authentic unstored observations before a fresh handoff and aborts handoff when checkpointing fails', async () => {
    const execute = vi.fn(async () => ({ exact: 'RAW_OBSERVATION_KEEP' }));
    const f = await fixture(false, { definition: { type: 'function', function: { name: 'probe', parameters: { type: 'object', properties: {} } } }, execute, output: { effect: 'read' } });
    vi.spyOn(FileEvidenceStorage.prototype, 'put').mockRejectedValue(Error('evidence unavailable'));
    await f.runner.run('Read once.'); expect(f.runner.hasUnstoredObservations()).toBe(true);
    const failure = vi.spyOn(f.runner, 'saveSession').mockRejectedValueOnce(Error('checkpoint failed'));
    await expect(f.app.createAgent({ freshSession: true })).rejects.toThrow('checkpoint failed');
    expect(f.app.getAgent()).toBe(f.runner); expect(f.runner.isReady()).toBe(true); expect(f.runner.hasUnstoredObservations()).toBe(true);
    failure.mockRestore(); await f.app.createAgent({ freshSession: true });
    const next = f.app.getAgent() as AgentRunner; runners.push(next);
    const id = f.runner.getSessionId();
    // The released runner has no live context; locate its retained recovery checkpoint.
    expect(id).toBeNull(); const checkpoints = await storage(f.runner).list(); expect(checkpoints).toHaveLength(1);
    expect(JSON.stringify((await storage(f.runner).load(checkpoints[0]!.sessionId))!.state)).toContain('RAW_OBSERVATION_KEEP');
    expect(next.getSessionId()).toBeNull(); expect(f.app.getConfig().session.activeSessionId).toBeNull(); expect(execute).toHaveBeenCalledTimes(1);
  });
  it('refuses replacement while an actual asynchronous tool still owns a delivery', async () => {
    let settle!: (value: string) => void;
    const f = await fixture(false, { definition: { type: 'function', blocking: false, function: { name: 'probe', parameters: { type: 'object', properties: {} } } }, execute: () => new Promise<string>(resolve => { settle = resolve; }), output: { effect: 'read' } });
    await f.runner.run('Start background read.');
    await expect(f.app.createAgent({ freshSession: true })).rejects.toThrow('asynchronous tools');
    expect(f.app.getAgent()).toBe(f.runner); expect(f.runner.isReady()).toBe(true);
    settle('settled background result');
    await vi.waitFor(() => { expect(f.provider.requests).toHaveLength(3); expect(f.runner.isRunning()).toBe(false); });
  });
});

describe('actual timer-backed AMOS session labels', () => {
  it('retains titles and preset labels in checkpoint/listing through autosave, unnamed save, and resume', async () => {
    const f = await fixture(true); await f.runner.run('checkpoint'); const id = await f.runner.saveSession('named');
    const path = join(f.dir, 'sessions', 'amos', 'sessions', id + '.json');
    const first = JSON.parse(await readFile(path, 'utf8'));
    await vi.waitFor(async () => {
      const saved = JSON.parse(await readFile(path, 'utf8')); expect(saved.lastSavedAt).not.toBe(first.lastSavedAt);
      expect(saved.metadata).toMatchObject({ title: 'named', agenticPreset: 'workflow' }); expect(saved.state.metadata).toMatchObject({ title: 'named', agenticPreset: 'workflow' });
    });
    await f.runner.saveSession(); expect((await f.runner.listSessions()).find(session => session.id === id)?.title).toBe('named');
    await f.app.createAgent(); const next = f.app.getAgent() as AgentRunner; runners.push(next);
    const resumed = JSON.parse(await readFile(path, 'utf8'));
    await vi.waitFor(async () => { const saved = JSON.parse(await readFile(path, 'utf8')); expect(saved.lastSavedAt).not.toBe(resumed.lastSavedAt); expect(saved.metadata.title).toBe('named'); expect(saved.state.metadata.agenticPreset).toBe('workflow'); });
    next.destroy(); await storage(next).flush(); const done = await readFile(path, 'utf8');
    await new Promise(resolve => setTimeout(resolve, 55)); expect(await readFile(path, 'utf8')).toBe(done);
  });
  it('orders overlapping writes, recovers from a failed save, and preserves ordinary FileContextStorage semantics', async () => {
    const f = await fixture(); await f.runner.run('checkpoint'); const id = await f.runner.saveSession('original');
    const adapter = storage(f.runner); const load = vi.spyOn(FileContextStorage.prototype, 'load').mockRejectedValueOnce(Error('read failed'));
    await expect(f.runner.saveSession('failed')).rejects.toThrow('read failed'); load.mockRestore();
    await Promise.all([f.runner.saveSession('renamed'), f.runner.saveSession()]);
    expect((await adapter.load(id))!.metadata).toMatchObject({ title: 'renamed', agenticPreset: 'workflow' });
    const plain = new FileContextStorage({ agentId: 'plain', baseDirectory: f.dir }); const state = (await adapter.load(id))!.state;
    await plain.save('ordinary', state, { title: 'ordinary' }); await plain.save('ordinary', state);
    expect((await plain.load('ordinary'))!.metadata).toEqual({});
  });
  it('serializes saves from overlapping old/new adapters for the same session location', async () => {
    const f = await fixture(); await f.runner.run('checkpoint'); const id = await f.runner.saveSession('initial');
    const first = storage(f.runner), second = new AmosSessionStorage({ agentId: 'amos', baseDirectory: join(f.dir, 'sessions') }, () => 'workflow');
    const state = (await first.load(id))!.state;
    const snapshot = () => ({ ...state, metadata: { savedAt: Date.now(), model: state.metadata.model } });
    await Promise.all([first.save(id, snapshot(), { title: 'first' }), second.save(id, snapshot(), { title: 'second' }), first.save(id, snapshot())]);
    expect((await second.load(id))!.metadata).toMatchObject({ title: 'second', agenticPreset: 'workflow' });
    expect((await first.list()).find(session => session.sessionId === id)?.metadata?.title).toBe('second');
  });
});


describe('rejected AMOS loads keep the active checkpoint and autosave target', () => {
  it.each(['ownerId', 'namespace', 'tenantId', 'task', 'association', 'version', 'storage', 'notification'] as const)('protects actual checkpoint bytes and pointers after %s rejection', async field => {
    const f = await fixture(true); await f.runner.run('HOST_A_HISTORY'); const idA = await f.runner.saveSession('A');
    const adapter = storage(f.runner); const saved = (await adapter.load(idA))!; const foreign = structuredClone(saved.state);
    if (field === 'ownerId' || field === 'namespace' || field === 'tenantId') (foreign.pluginStates.evidence as { scope: EvidenceScope }).scope[field] = 'foreign';
    if (field === 'task') (foreign.pluginStates.task_state as TaskStateSnapshot).taskId = 'FOREIGN_TASK';
    if (field === 'association') (foreign.pluginStates.task_state as TaskStateSnapshot).association = 'FOREIGN_ASSOCIATION';
    if (field === 'version') (foreign.pluginStates.task_state as { version: number }).version = 999;
    const idB = 'foreign-checkpoint'; await adapter.save(idB, foreign, { title: 'B' });
    const pathB = join(f.dir, 'sessions', 'amos', 'sessions', idB + '.json'); const beforeB = await readFile(pathB, 'utf8');
    const pathA = join(f.dir, 'sessions', 'amos', 'sessions', idA + '.json'); const beforeA = JSON.parse(await readFile(pathA, 'utf8'));
    const load = adapter.load.bind(adapter); const failure = Error('storage load failed');
    if (field === 'storage') vi.spyOn(adapter, 'load').mockImplementation(id => id === idB ? Promise.reject(failure) : load(id));
    if (field === 'notification') AgentRegistry.get(f.agent.registryId)!.on('session:loaded', () => { throw Error('host notification rejected'); });
    const rejected = await f.invoke('session', ['load', idB]); expect(rejected.success).toBe(false); expect(rejected.message).toContain('Failed to load session');
    expect(f.runner.getSessionId()).toBe(idA); expect(f.app.getConfig().session.activeSessionId).toBe(idA);
    // Actual interval must keep writing A, including after the rejected command.
    await vi.waitFor(async () => { expect(JSON.parse(await readFile(pathA, 'utf8')).lastSavedAt).not.toBe(beforeA.lastSavedAt); });
    await adapter.flush(); expect(await readFile(pathB, 'utf8')).toBe(beforeB);
    await f.runner.saveSession('Renamed A'); await f.runner.saveSession();
    expect(f.runner.getSessionId()).toBe(idA); expect(f.app.getConfig().session.activeSessionId).toBe(idA);
    expect((await adapter.load(idA))!.metadata).toMatchObject({ title: 'Renamed A', agenticPreset: 'workflow' });
    expect(await readFile(pathB, 'utf8')).toBe(beforeB); expect(JSON.stringify((await adapter.load(idA))!.state)).toContain('HOST_A_HISTORY');
    expect(f.provider.requests).toHaveLength(1);
  });
});


describe('AMOS plugin serialization and recovery', () => {
  class Extension extends BasePluginNextGen {
    readonly name = 'json_extension'; value = 'HOST_VALUE'; fail = false;
    getInstructions() { return null; } async getContent() { return null; } getContents() { return null; }
    override getState() { const value = this.value; return { toJSON() { return { value }; } }; }
    override restoreState(state: unknown) { if (this.fail) { this.value = 'UNCERTAIN'; throw Error('extension refuses restore'); } this.value = (state as { value: string }).value; }
  }
  it('loads a JSON-converting plugin through the real command and file adapter', async () => {
    const f = await fixture(); const plugin = new Extension(); f.agent.context.registerPlugin(plugin);
    const id = await f.runner.saveSession('JSON'); plugin.value = 'LATER';
    expect((await f.invoke('session', ['load', id])).success).toBe(true); expect(plugin.value).toBe('HOST_VALUE');
    expect(f.app.getConfig().session.activeSessionId).toBe(id); await f.runner.saveSession();
  });
  it('cannot save uncertain state after loading a legacy session missing its damaged extension', async () => {
    const f = await fixture(); const plugin = new Extension(); f.agent.context.registerPlugin(plugin);
    const id = await f.runner.saveSession('Known'); const adapter = storage(f.runner), good = (await adapter.load(id))!.state;
    await adapter.save('legacy', { ...good, pluginStates: {} }); const path = join(f.dir, 'sessions', 'amos', 'sessions', 'legacy.json'), before = await readFile(path, 'utf8');
    plugin.fail = true; expect((await f.invoke('session', ['load', id])).success).toBe(false);
    plugin.fail = false; expect((await f.invoke('session', ['load', 'legacy'])).success).toBe(true);
    expect((await f.invoke('session', ['save'])).success).toBe(false); expect(plugin.value).toBe('UNCERTAIN'); expect(await readFile(path, 'utf8')).toBe(before);
    expect((await f.invoke('session', ['load', id])).success).toBe(true); expect(plugin.value).toBe('HOST_VALUE'); expect((await f.invoke('session', ['save'])).success).toBe(true);
  });
});
