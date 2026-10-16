import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Agent, AgentRegistry, AgentContextNextGen, Connector, Vendor, createAgentPreset, InMemoryEvidenceStorage, FileContextStorage, PluginRegistry, BasePluginNextGen, EvidencePluginNextGen, TaskStatePluginNextGen, ContentType, MessageRole } from '../../../src/index.js';
import type { AgentConfig, AgentPresetConfig, EvidenceScope, SerializedContextState, TaskStateSnapshot } from '../../../src/index.js';
import { ScriptedLoopProvider } from '../../../examples/agent-loop/scripted-provider.js';

const scope = { ownerId: 'host', namespace: 'second-corrections', tenantId: 'tenant' };
const agents: Agent[] = [], contexts: AgentContextNextGen[] = [], directories: string[] = [];
afterEach(async () => {
  const ownedContexts = new Set([...agents.map(agent => agent.context), ...contexts]);
  for (const agent of agents.splice(0)) { try { agent.destroy(); } catch { /* Teardown failures are asserted by individual cases. */ } }
  for (const context of contexts.splice(0)) { try { context.destroy(); } catch { /* ditto */ } }
  // Destruction is synchronous; let already-admitted checkpoint/journal IO settle
  // before removing the real FileContextStorage directory. No fixed sleeps/retries.
  await Promise.all([...ownedContexts].map(async context => {
    const pending = context as unknown as { _sessionOperations: Promise<void> | null; _journalWriteQueue: Promise<void> };
    await pending._sessionOperations;
    await pending._journalWriteQueue;
  }));
  for (const key of ['evidence', 'taskState', 'early', 'resource', 'late']) PluginRegistry.remove(key);
  Connector.clear(); vi.restoreAllMocks(); vi.useRealTimers();
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});
function provider() {
  const value = new ScriptedLoopProvider(Array.from({ length: 20 }, () => ({ text: 'local answer' })));
  Connector.create({ name: 'main', vendor: Vendor.OpenAI, auth: { type: 'none' }, options: { provider: value }});
  return value;
}
function config(): AgentPresetConfig {
  return { connector: 'main', model: 'gpt-4o-mini', userId: scope.ownerId, context: {
    features: { workingMemory: false, inContextMemory: false }, plugins: {
      evidence: { scope, storage: new InMemoryEvidenceStorage({ scope }) },
      taskState: { scope, taskId: 'T42', association: 'binding' },
    },
  } };
}
function make(cfg: AgentConfig) { const value = Agent.create(cfg); agents.push(value); return value; }
async function sessions() {
  const directory = await mkdtemp(join(tmpdir(), 'stage12-second-')); directories.push(directory);
  return { storage: new FileContextStorage({ agentId: 'host', baseDirectory: directory }), path: (id: string) => join(directory, 'host', 'sessions', id + '.json') };
}
function gate() { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; }
class Empty extends BasePluginNextGen {
  constructor(readonly name: string) { super(); }
  getInstructions() { return null; } async getContent() { return null; } getContents() { return null; }
}

describe('failed resume with caller-owned context', () => {
  it.each(['storage', 'scope'] as const)('preserves real permission enforcement, host bindings and concurrent edits on %s rejection', async failureType => {
    provider(); vi.useFakeTimers(); const { storage } = await sessions();
    const context = AgentContextNextGen.create({ model: 'gpt-4o-mini', storage, features: { workingMemory: false, inContextMemory: false, evidence: true }, plugins: { evidence: { scope, storage: new InMemoryEvidenceStorage({ scope }) } }, maxContextTokens: 5000, responseReserve: 128, criticalCompactionThreshold: 0.01 }); contexts.push(context);
    const blocked = vi.fn(async () => 'local write'), allowed = vi.fn(async () => 'local receipt');
    const beforeCompaction = vi.fn(async () => {}), rejectedCompaction = vi.fn(async () => {});
    const original = make({ connector: 'main', model: 'gpt-4o-mini', context, instructions: 'HOST_PROMPT', userRoles: ['host'], lifecycleHooks: { beforeCompaction }, permissions: { allowlist: ['allowed'], blocklist: ['blocked'] }, tools: [
      { definition: { type: 'function', function: { name: 'blocked', parameters: { type: 'object', properties: {} } } }, execute: blocked },
      { definition: { type: 'function', function: { name: 'allowed', parameters: { type: 'object', properties: {} } } }, execute: allowed },
    ]});
    await original.saveSession('A'); const policy = original.tools.getPermissionManager(), toolContext = original.tools.getToolContext();
    const registryCount = AgentRegistry.count, listeners = original.tools.listenerCount('tool:registered'), timers = vi.getTimerCount();
    const state = structuredClone(context.getState());
    (state.pluginStates.evidence as { scope: EvidenceScope }).scope = { ...scope, ownerId: 'foreign' };
    const failure = Error('storage rejected');
    for (let i = 0; i < 3; i++) {
      const loading = gate(); let entered = false;
      const load = vi.spyOn(storage, 'load').mockImplementation(async () => { entered = true; await loading.promise; if (failureType === 'storage') throw failure; return { state } as Awaited<ReturnType<FileContextStorage['load']>>;});
      const pending = Agent.resume('B', { connector: 'main', model: 'gpt-4o-mini', context, instructions: 'REJECTED_PROMPT', userRoles: ['candidate'], permissions: { allowlist: ['allowed'], blocklist: ['blocked'] }, lifecycleHooks: { beforeCompaction: rejectedCompaction }, tools: [{ definition: { type: 'function', function: { name: 'candidate_only', parameters: { type: 'object', properties: {} } } }, execute: async () => 'candidate' }], session: { storage, autoSave: true, autoSaveIntervalMs: 5 }});
      const rejection = failureType === 'storage' ? expect(pending).rejects.toBe(failure) : expect(pending).rejects.toThrow('Evidence');
      await vi.waitFor(() => expect(entered).toBe(true));
      expect((await original.tools.executeWithOutcome('blocked', {})).outcome.status).toBe('denied');
      context.systemPrompt = 'HOST_EDIT_WHILE_LOADING';
      loading.release(); await rejection; load.mockRestore();
      expect(context.systemPrompt).toBe('HOST_EDIT_WHILE_LOADING'); expect(context.sessionId).toBe('A');
      expect(original.tools.getPermissionManager()).toBe(policy); expect(policy!.isDestroyed).toBe(false);
      expect(original.tools.getToolContext()).toBe(toolContext); expect(original.tools.has('candidate_only')).toBe(false);
      expect((await original.tools.executeWithOutcome('blocked', {})).outcome.status).toBe('denied');
      expect(await original.tools.execute('allowed', {})).toBe('local receipt');
      expect(AgentRegistry.count).toBe(registryCount); expect(vi.getTimerCount()).toBe(timers); expect(context.tools.listenerCount('tool:registered')).toBe(listeners);
    }
    expect(blocked).not.toHaveBeenCalled();
    context.setCompactionStrategy({ name: 'callback-probe', displayName: 'Callback probe', description: 'Verify the original lifecycle callback', threshold: 0.01, compact: async () => ({ tokensFreed: 0, messagesRemoved: 0, pluginsCompacted: [], log: [] }), consolidate: async () => ({ performed: false, tokensChanged: 0, actions: [] })});
    context.addUserMessage('check callback');
    await context.prepare();
    expect(beforeCompaction).toHaveBeenCalled(); expect(rejectedCompaction).not.toHaveBeenCalled();
    context.clearConversation(); expect((await original.run('Continue under original authority.')).output_text).toBe('local answer');
 });
  it.each([true, false])('successful shared resume loads once, binds candidate and preserves missing-session behavior (%s)', async found => {
    provider(); const { storage } = await sessions(); const context = AgentContextNextGen.create({ model: 'gpt-4o-mini', storage, features: { workingMemory: false, inContextMemory: false } }); contexts.push(context);
    if (found) { context.addInputItems([{ type: 'message', role: MessageRole.USER, content: [{ type: ContentType.INPUT_TEXT, text: 'SAVED_SHARED_HISTORY' }] }]); await context.save('B'); context.clearConversation(); }
    const load = vi.spyOn(storage, 'load'); const loadedEvent = vi.fn();
    AgentRegistry.once('agent:registered', ({ agent }) => { agent.on('session:loaded', loadedEvent); });
    const resumed = await Agent.resume('B', { connector: 'main', model: 'gpt-4o-mini', context, instructions: 'EXPLICIT_CANDIDATE_PROMPT', userRoles: ['candidate'], session: { storage } }); agents.push(resumed);
    expect(loadedEvent).toHaveBeenCalledTimes(found ? 1 : 0);
    if (found) expect(loadedEvent).toHaveBeenCalledWith({ sessionId: 'B' });
    expect(load).toHaveBeenCalledTimes(1); expect(resumed.context).toBe(context); expect(context.systemPrompt).toBe('EXPLICIT_CANDIDATE_PROMPT'); expect(context.sessionId).toBe(found ? 'B' : null);
    expect(context.tools.getPermissionManager()).toBe(resumed.policyManager); expect(context.tools.getToolContext()!.roles).toEqual(['candidate']);
    expect(JSON.stringify(context.getState())).toContain(found ? 'SAVED_SHARED_HISTORY' : 'EXPLICIT_CANDIDATE_PROMPT');
    expect((await resumed.run('Continue.')).output_text).toBe('local answer');
 });
});

describe('transactional managed checkpoint loading', () => {
  const mutations: Array<[string, (state: SerializedContextState) => void]> = [
    ...(['ownerId', 'namespace', 'tenantId'] as const).map(field => [field, (state: SerializedContextState) => { (state.pluginStates.evidence as { scope: EvidenceScope }).scope[field] = 'foreign'; }] as [string, (state: SerializedContextState) => void]),
    ['task', state => { (state.pluginStates.task_state as TaskStateSnapshot).taskId = 'FOREIGN_TASK'; }],
    ['association', state => { (state.pluginStates.task_state as TaskStateSnapshot).association = 'foreign'; }],
    ['version', state => { (state.pluginStates.task_state as { version: number }).version = 999; }],
  ];
  it.each(mutations)('retains A and foreign B on rejected %s load, then saves A and successfully loads a valid checkpoint', async (_label, mutate) => {
    provider(); const { storage, path } = await sessions(); const agent = make({ ...createAgentPreset('workflow', config()), session: { storage }});
    await agent.run('HOST_A_HISTORY'); agent.context.getPlugin<TaskStatePluginNextGen>('task_state')!.updateHost({ notes: [{ id: 'host', category: 'constraint', text: 'EXACT_HOST_NOTE', source: { label: 'host' } }] }, 0); await agent.saveSession('A', { title: 'A'});
    const valid = structuredClone(agent.context.getState()); const foreign = structuredClone(valid); mutate(foreign); foreign.systemPrompt = 'FOREIGN_PROMPT';
    await storage.save('B', foreign, { title: 'B' }); await storage.save('C', valid);
    const beforeA = await readFile(path('A'), 'utf8'), beforeB = await readFile(path('B'), 'utf8');
    const before = agent.context.getState(); const restored = vi.spyOn(agent, 'restoreContextState');
    await expect(agent.loadSession('B')).rejects.toThrow();
    expect(restored).not.toHaveBeenCalled(); expect(agent.getSessionId()).toBe('A'); expect(agent.context.getState().conversation).toEqual(before.conversation); expect(agent.context.getState().pluginStates).toEqual(before.pluginStates);
    expect(await readFile(path('A'), 'utf8')).toBe(beforeA); expect(await readFile(path('B'), 'utf8')).toBe(beforeB);
    await agent.saveSession(undefined, { title: 'A updated' }); expect((await storage.load('A'))!.state.metadata).toMatchObject({ title: 'A updated' }); expect(await readFile(path('B'), 'utf8')).toBe(beforeB);
    expect(await agent.loadSession('C')).toBe(true); expect(agent.getSessionId()).toBe('C'); expect(restored).toHaveBeenCalledTimes(1); expect(await agent.loadSession('missing')).toBe(false); expect(agent.getSessionId()).toBe('C');
 });
  it.each([false, true])('queues real autosaves and deferred agent snapshots through an async custom restore (%s rejection)', async reject => {
    provider(); vi.useFakeTimers(); const { storage } = await sessions(); const agent = make({ ...createAgentPreset('workflow', config()), session: { storage, autoSave: true, autoSaveIntervalMs: 10 }});
    await agent.run('HOST_A'); await agent.saveSession('A'); const before = agent.context.getState();
    const target = structuredClone(before); target.systemPrompt = 'TARGET_B'; target.conversation = [];
    await storage.save('B', target); const loadGate = gate(); const restoreFailure = Error('custom restore failed'); const restore = agent.restoreContextState.bind(agent); let entered = false;
    vi.spyOn(agent, 'restoreContextState').mockImplementation(async state => { await restore(state); entered = true; await loadGate.promise; if (reject) throw restoreFailure;});
    const save = vi.spyOn(storage, 'save'); const pending = agent.loadSession('B'); const rejected = reject ? expect(pending).rejects.toBe(restoreFailure) : undefined;
    await vi.waitFor(() => expect(entered).toBe(true));
    const snapshot = vi.spyOn(agent, 'getContextState'); const explicitSave = agent.saveSession(undefined, { title: 'host-save'});
    await vi.advanceTimersByTimeAsync(35); expect(save).not.toHaveBeenCalled(); expect(snapshot).not.toHaveBeenCalled(); expect(agent.getSessionId()).toBe('A');
    loadGate.release(); if (rejected) await rejected; else expect(await pending).toBe(true); await explicitSave;
    expect(snapshot).toHaveBeenCalledTimes(1); expect(save.mock.calls.every(([id]) => id === (reject ? 'A' : 'B'))).toBe(true);
    expect(agent.context.getState().conversation).toEqual(reject ? before.conversation : []); expect(agent.getSessionId()).toBe(reject ? 'A' : 'B');
    expect(JSON.stringify((await storage.load(reject ? 'A' : 'B'))!.state)).toContain(reject ? 'HOST_A' : 'TARGET_B');
 });
  it('preserves storage errors and direct loadRaw activation while serializing later saves', async () => {
    provider(); const { storage } = await sessions(); const agent = make({ ...createAgentPreset('workflow', config()), session: { storage } }); await agent.saveSession('A'); const failure = Error('backend read failed');
    const load = vi.spyOn(storage, 'load').mockRejectedValueOnce(failure); await expect(agent.loadSession('B')).rejects.toBe(failure); expect(agent.getSessionId()).toBe('A'); load.mockRestore();
    await storage.save('B', agent.context.getState()); expect(await agent.context.loadRaw('B')).toBeTruthy(); expect(agent.getSessionId()).toBe('B'); await agent.saveSession(); expect(agent.getSessionId()).toBe('B');
 });
  it('blocks checkpointing uncertain plugin state if third-party rollback fails, and recovers on a valid load', async () => {
    provider(); const { storage, path } = await sessions(); const agent = make({ ...createAgentPreset('workflow', config()), session: { storage } });
    const plugin = new Empty('extension'); let value = 'HOST'; let fail = false;
    plugin.getState = () => ({ value }); plugin.restoreState = () => { value = 'UNCERTAIN'; if (fail) throw Error('extension restore failed'); };
    agent.context.registerPlugin(plugin); await agent.saveSession('A'); await storage.save('B', agent.context.getState()); const original = await readFile(path('A'), 'utf8');
    fail = true; await expect(agent.loadSession('B')).rejects.toThrow('extension restore failed'); expect(agent.getSessionId()).toBe('A');
    await expect(agent.saveSession()).rejects.toThrow('Checkpoint rollback failed'); await expect(agent.context.save()).rejects.toThrow('Checkpoint rollback failed'); expect(await readFile(path('A'), 'utf8')).toBe(original);
    fail = false; expect(await agent.loadSession('A')).toBe(true); await agent.saveSession(); expect(agent.getSessionId()).toBe('A');
  });
  it('rolls back restored plugin state and pending input after an asynchronous extension fails', async () => {
    provider(); const { storage } = await sessions(); const agent = make({ ...createAgentPreset('workflow', config()), session: { storage } }); const task = agent.context.getPlugin<TaskStatePluginNextGen>('task_state')!;
    task.updateHost({ notes: [{ id: 'keep', category: 'constraint', text: 'KEEP_NOTE', source: { label: 'host' } }] }, 0); agent.context.addUserMessage('PENDING_HOST_INPUT'); await agent.saveSession('A');
    const before = structuredClone(agent.context.getState()), pending = structuredClone(agent.context.getCurrentInput()); const target = structuredClone(before); target.pluginStates.task_state = task.emptyState(); await storage.save('B', target);
    const restore = agent.restoreContextState.bind(agent), error = Error('agent extension failed');
    vi.spyOn(agent, 'restoreContextState').mockImplementation(async state => { await restore(state); agent.context.addUserMessage('TRANSIENT'); throw error;});
    await expect(agent.loadSession('B')).rejects.toBe(error); expect(task.getState()).toEqual(before.pluginStates.task_state); expect(agent.context.getCurrentInput()).toEqual(pending); expect(agent.getSessionId()).toBe('A');
 });
});

describe('normalized preset scope requirements', () => {
  for (const preset of ['research', 'workflow'] as const) for (const kind of ['prototype', 'non-enumerable'] as const) for (const field of ['evidence', 'taskState'] as const) for (const tenant of [true, false]) {
    it(`${preset} retains ${kind} ${field} scope (tenant ${tenant})`, () => {
      provider(); const expected = { ownerId: scope.ownerId, namespace: scope.namespace, ...(tenant ? { tenantId: scope.tenantId } : {}) };
      class Scope implements EvidenceScope { get ownerId() { return expected.ownerId; } get namespace() { return expected.namespace; } get tenantId() { return expected.tenantId; } }
      const accessor = kind === 'prototype' ? new Scope() : Object.defineProperties({}, Object.fromEntries(Object.keys(expected).map(key => [key, { get: () => expected[key as keyof typeof expected] }])) ) as EvidenceScope;
      const cfg = config(); cfg.context!.plugins!.evidence = { scope: field === 'evidence' ? accessor : { ...expected }, storage: new InMemoryEvidenceStorage({ scope: expected }) }; cfg.context!.plugins!.taskState = { scope: field === 'taskState' ? accessor : { ...expected }, taskId: 'T42' };
      const composed = createAgentPreset(preset, cfg); const agent = make(composed);
      expect((agent.context.getPlugin<EvidencePluginNextGen>('evidence')!).storage.scope).toEqual(expected);
      if (preset === 'workflow') expect(agent.context.getPlugin<TaskStatePluginNextGen>('task_state')!.scope).toEqual(expected);
      expected.namespace = 'MUTATED';
      if (preset === 'workflow' || field === 'evidence') expect(() => make(composed)).toThrow();
      else make(composed); // Disabled task state adds no scope requirement.
      expect(agent.context.getPlugin<EvidencePluginNextGen>('evidence')!.storage.scope.namespace).toBe(scope.namespace);
   });
  }
});

describe('best-effort owned teardown', () => {
  it.each(['early', 'middle', 'late'] as const)('releases all reachable owned resources after %s plugin throws; preserves shared ownership and idempotence', position => {
    vi.useFakeTimers(); const context = AgentContextNextGen.create({ model: 'gpt-4o-mini', features: { workingMemory: false, inContextMemory: false } }); contexts.push(context);
    const failure = Error('destructor failed'), destroyed: string[] = []; const timer = setInterval(() => {}, 5);
    const plugins = ['early', 'middle', 'late'].map(name => { const plugin = new Empty(name); plugin.destroy = () => { destroyed.push(name); if (name === 'middle') clearInterval(timer); if (name === position) throw failure; }; return plugin;});
    plugins.forEach(plugin => context.registerPlugin(plugin)); const shared = new Empty('shared'); shared.destroy = vi.fn(); context.registerPlugin(shared, { skipDestroyOnContextDestroy: true }); context.on('budget:updated', () => {});
    expect(() => context.destroy()).toThrow(failure); expect(destroyed).toEqual(['early', 'middle', 'late']); expect(shared.destroy).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
    expect(context.isDestroyed).toBe(true); expect(context.tools.isDestroyed).toBe(true); expect(context.eventNames()).toEqual([]); expect(context.tools.eventNames()).toEqual([]); expect(context.getPlugins()).toEqual([]); expect(() => context.destroy()).not.toThrow(); expect(destroyed).toHaveLength(3);
 });
  it('cleans unreachable rejected-preset timers/managers/listeners while preserving the composition error', () => {
    provider(); vi.useFakeTimers(); let contextTools: AgentContextNextGen['tools'] | undefined; const destroyed = vi.fn(), timer = setInterval(() => {}, 5);
    PluginRegistry.register('early', () => { const plugin = new Empty('early'); plugin.destroy = () => { throw Error('cleanup failure'); }; return plugin;});
    PluginRegistry.register('resource', () => { const plugin = new Empty('resource'); plugin.destroy = () => { destroyed(); clearInterval(timer); }; return plugin;});
    PluginRegistry.register('evidence', cfg => { const plugin = new EvidencePluginNextGen(cfg as ConstructorParameters<typeof EvidencePluginNextGen>[0]); const attach = plugin.attach.bind(plugin); plugin.attach = manager => { contextTools = manager; attach(manager); }; return plugin;});
    PluginRegistry.register('task_state', () => new Empty('task_state'), { featureKey: 'taskState'});
    const cfg = config(); Object.assign(cfg.context!.features!, { early: true, resource: true }); const count = AgentRegistry.count;
    expect(() => make(createAgentPreset('workflow', cfg))).toThrow('built-in taskState'); expect(destroyed).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0); expect(contextTools!.isDestroyed).toBe(true); expect(contextTools!.listenerCount('tool:outcome')).toBe(0); expect(AgentRegistry.count).toBe(count);
 });
  it('failed owned resume releases candidate policy/listeners/timers even when context destruction throws', async () => {
    provider(); vi.useFakeTimers(); const { storage } = await sessions(); const originalError = Error('load failed'); vi.spyOn(storage, 'load').mockRejectedValue(originalError);
    let captured!: AgentContextNextGen; const original = AgentContextNextGen.create;
    vi.spyOn(AgentContextNextGen, 'create').mockImplementation(cfg => { const context = original(cfg); captured = context; const plugin = new Empty('throwing'); plugin.destroy = () => { throw Error('teardown failed'); }; context.registerPlugin(plugin); return context;});
    const count = AgentRegistry.count; await expect(Agent.resume('bad', { ...createAgentPreset('workflow', config()), session: { storage, autoSave: true, autoSaveIntervalMs: 5 } })).rejects.toBe(originalError);
    expect(captured.isDestroyed).toBe(true); expect(captured.tools.isDestroyed).toBe(true); expect(captured.tools.getPermissionManager()!.isDestroyed).toBe(true); expect(captured.tools.eventNames()).toEqual([]); expect(vi.getTimerCount()).toBe(0); expect(AgentRegistry.count).toBe(count);
 });
});
