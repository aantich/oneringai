import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  Agent, AgentContextNextGen, AgentRegistry, BasePluginNextGen, Connector,
  FileContextStorage, InMemoryEvidenceStorage, PluginRegistry, Vendor,
  createAgentPreset, ContentType, MessageRole,
} from '../../../src/index.js';
import type { AgentConfig, SerializedContextState, ToolFunction } from '../../../src/index.js';
import { ScriptedLoopProvider } from '../../../examples/agent-loop/scripted-provider.js';

const agents: Agent[] = [], contexts: AgentContextNextGen[] = [], directories: string[] = [];
const scope = { ownerId: 'host', namespace: 'third-corrections' };
afterEach(async () => {
  const all = new Set([...contexts, ...agents.map(agent => agent.context)]);
  for (const agent of agents.splice(0)) { try { agent.destroy(); } catch { /* Original-error tests assert failing cleanup. */ } }
  for (const context of contexts.splice(0)) { try { context.destroy(); } catch { /* ditto */ } }
  await Promise.all([...all].map(async context => {
    const pending = context as unknown as { _sessionOperations: Promise<void> | null; _journalWriteQueue: Promise<void> };
    await pending._sessionOperations; await pending._journalWriteQueue;
  }));
  PluginRegistry.remove('jsonExtension'); Connector.clear(); vi.restoreAllMocks(); vi.useRealTimers();
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});
function provider() {
  const supplied = new ScriptedLoopProvider(Array.from({ length: 15 }, () => ({ text: 'local answer' })));
  Connector.create({ name: 'main', vendor: Vendor.OpenAI, auth: { type: 'none' }, options: { provider: supplied } });
  return supplied;
}
async function fileStorage() {
  const directory = await mkdtemp(join(tmpdir(), 'stage12-third-')); directories.push(directory);
  return { storage: new FileContextStorage({ agentId: 'host', baseDirectory: directory }), path: (id: string) => join(directory, 'host', 'sessions', id + '.json') };
}
function make(config: AgentConfig) { const value = Agent.create(config); agents.push(value); return value; }
function shared(storage: FileContextStorage) {
  const value = AgentContextNextGen.create({ model: 'gpt-4o-mini', storage,
    features: { workingMemory: false, inContextMemory: false }, journalFilter: [],
    maxContextTokens: 5000, criticalCompactionThreshold: 0.01 });
  contexts.push(value); return value;
}
function input(text: string) { return { type: 'message' as const, role: MessageRole.USER, content: [{ type: ContentType.INPUT_TEXT as const, text }] }; }
class Empty extends BasePluginNextGen {
  constructor(readonly name: string) { super(); }
  getInstructions() { return null; } async getContent() { return null; } getContents() { return null; }
}

 describe('whole shared-resume admission', () => {
  const phases = ['notification', 'registration', 'tool-registration', 'provider', 'connector'] as const;
  it.each(phases)('restores authority, state and resources on %s rejection', async phase => {
    const supplied = provider(); vi.useFakeTimers(); const { storage, path } = await fileStorage(); const context = shared(storage);
    const write = vi.fn(async () => 'local write'), allowed = vi.fn(async () => 'local receipt');
    const originalHook = vi.fn(async () => {}), rejectedHook = vi.fn(async () => {});
    const blocked: ToolFunction = { definition: { type: 'function', function: { name: 'blocked', parameters: { type: 'object', properties: {} } } }, execute: write };
    const permitted: ToolFunction = { definition: { type: 'function', function: { name: 'allowed', parameters: { type: 'object', properties: {} } } }, execute: allowed };
    const permissions = { blocklist: ['blocked'], allowlist: ['allowed'] };
    const owner = make({ connector: 'main', model: 'gpt-4o-mini', context, instructions: 'A_HOST_PROMPT', tools: [blocked, permitted], permissions, userRoles: ['host'], lifecycleHooks: { beforeCompaction: originalHook } });
    context.addInputItems([input('HISTORY_A')]); await owner.saveSession('A');
    const target = JSON.parse(JSON.stringify(context.getState())) as SerializedContextState; target.systemPrompt = 'B_PROMPT'; target.conversation = [input('HISTORY_B')]; await storage.save('B', target);
    const beforeA = await readFile(path('A'), 'utf8'), beforeB = await readFile(path('B'), 'utf8');
    const policy = context.tools.getPermissionManager(), toolContext = context.tools.getToolContext(), count = AgentRegistry.count, timers = vi.getTimerCount(), listeners = context.tools.listenerCount('tool:registered');
    const failure = Error(`${phase} rejected`); let candidate: Agent | undefined;
    if (phase === 'notification' || phase === 'registration') AgentRegistry.once('agent:registered', ({ agent }) => {
      candidate = agent as Agent;
      if (phase === 'registration') throw failure;
      agent.on('session:loaded', () => { expect(context.sessionId).toBe('B'); throw failure; });
    });
    const registered = ({ name }: { name: string }) => { if (phase === 'tool-registration' && name === 'candidate_new') throw failure; };
    context.tools.on('tool:registered', registered);
    let connector = 'main';
    if (phase === 'provider') {
      Connector.create({ name: 'service-only', serviceType: 'fixture', auth: { type: 'none' } }); connector = 'service-only';
    }
    if (phase === 'connector') connector = 'missing-connector';
    const candidateNew: ToolFunction = { definition: { type: 'function', function: { name: 'candidate_new', parameters: { type: 'object', properties: {} } } }, execute: async () => 'candidate', permission: { scope: 'always' } };
    const pending = Agent.resume('B', { connector, model: 'gpt-4o-mini', context, permissions,
      instructions: 'CANDIDATE_PROMPT', userRoles: ['candidate'], lifecycleHooks: { beforeCompaction: rejectedHook },
      tools: [{ ...permitted, execute: async () => 'candidate override' }, candidateNew], session: { storage, autoSave: true, autoSaveIntervalMs: 5 } });
    if (phase === 'provider') await expect(pending).rejects.toThrow('no vendor');
    else if (phase === 'connector') await expect(pending).rejects.toThrow('not found');
    else await expect(pending).rejects.toBe(failure);
    context.tools.off('tool:registered', registered);
    expect(context.tools.getPermissionManager()).toBe(policy); expect(policy!.isDestroyed).toBe(false);
    expect((await owner.tools.executeWithOutcome('blocked', {})).outcome.status).toBe('denied'); expect(write).not.toHaveBeenCalled();
    expect(await owner.tools.execute('allowed', {})).toBe('local receipt'); expect(context.tools.get('allowed')!.execute).toBe(permitted.execute);
    expect(context.tools.has('candidate_new')).toBe(false); expect(owner.permissions.getToolConfig('candidate_new')).toBeUndefined();
    expect(context.tools.getToolContext()).toBe(toolContext); expect(toolContext!.roles).toEqual(['host']);
    expect(context.sessionId).toBe('A'); expect(context.systemPrompt).toBe('A_HOST_PROMPT'); expect(JSON.stringify(context.getConversation())).toContain('HISTORY_A'); expect(JSON.stringify(context.getConversation())).not.toContain('HISTORY_B');
    expect(AgentRegistry.count).toBe(count); expect(vi.getTimerCount()).toBe(timers); expect(context.tools.listenerCount('tool:registered')).toBe(listeners);
    expect(candidate?.isDestroyed ?? true).toBe(true); expect(await readFile(path('A'), 'utf8')).toBe(beforeA); expect(await readFile(path('B'), 'utf8')).toBe(beforeB);
    context.setCompactionStrategy({ name: 'callback-probe', displayName: 'Callback', description: 'Original callback after rejection', threshold: 0.01, compact: async () => ({ tokensFreed: 0, messagesRemoved: 0, pluginsCompacted: [], log: [] }), consolidate: async () => ({ performed: false, tokensChanged: 0, actions: [] }) });
    await context.prepare(); expect(originalHook).toHaveBeenCalled(); expect(rejectedHook).not.toHaveBeenCalled();
    expect((await owner.run('Continue under original authority.')).output_text).toBe('local answer'); expect(supplied.requests).toHaveLength(1);
  });
  it('keeps autosaves and synchronous notification-requested saves on A when admission rejects', async () => {
    provider(); vi.useFakeTimers(); const { storage, path } = await fileStorage(); const context = shared(storage);
    const owner = make({ connector: 'main', model: 'gpt-4o-mini', context, session: { storage, autoSave: true, autoSaveIntervalMs: 10 } });
    context.addInputItems([input('HOST_A')]); await owner.saveSession('A'); const target = context.getState(); await storage.save('B', target); const beforeB = await readFile(path('B'), 'utf8');
    const error = Error('observer rejected'); let requestedSave: Promise<void> | undefined;
    AgentRegistry.once('agent:registered', ({ agent }) => agent.on('session:loaded', () => { requestedSave = context.save(); throw error; }));
    await expect(Agent.resume('B', { connector: 'main', model: 'gpt-4o-mini', context, session: { storage, autoSave: true, autoSaveIntervalMs: 5 } })).rejects.toBe(error);
    await requestedSave; await vi.advanceTimersByTimeAsync(25); await owner.saveSession();
    expect(context.sessionId).toBe('A'); expect(await readFile(path('B'), 'utf8')).toBe(beforeB); expect(JSON.stringify((await storage.load('A'))!.state)).toContain('HOST_A');
  });
  it('retains the original notification error even if candidate teardown throws', async () => {
    provider(); const { storage } = await fileStorage(); const context = shared(storage); const owner = make({ connector: 'main', model: 'gpt-4o-mini', context, permissions: { blocklist: ['blocked'] } }); await owner.saveSession('A');
    const error = Error('notification failed'); let failedPolicy: Agent['policyManager'] | undefined;
    AgentRegistry.once('agent:registered', ({ agent }) => { const candidate = agent as Agent; failedPolicy = candidate.policyManager; const destroy = failedPolicy.destroy.bind(failedPolicy); failedPolicy.destroy = () => { destroy(); throw Error('teardown failed'); }; agent.on('session:loaded', () => { throw error; }); });
    const policy = owner.policyManager;
    await expect(Agent.resume('A', { connector: 'main', model: 'gpt-4o-mini', context, session: { storage } })).rejects.toBe(error);
    expect(failedPolicy!.isDestroyed).toBe(true); expect(context.tools.getPermissionManager()).toBe(policy); expect(policy.isDestroyed).toBe(false);
  });
  it('rolls back ordinary managed loads if the existing loaded notification rejects', async () => {
    provider(); const { storage } = await fileStorage(); const context = shared(storage); const error = Error('loaded listener failed');
    AgentRegistry.once('agent:registered', ({ agent }) => agent.on('session:loaded', () => { expect(context.sessionId).toBe('B'); throw error; }));
    const owner = make({ connector: 'main', model: 'gpt-4o-mini', context });
    context.addInputItems([input('HOST_A')]); await owner.saveSession('A'); const state = context.getState(); await storage.save('B', { ...state, conversation: [input('HOST_B')] });
    await expect(owner.loadSession('B')).rejects.toBe(error); expect(owner.getSessionId()).toBe('A'); expect(JSON.stringify(context.getConversation())).toContain('HOST_A');
  });
  it('cleans constructor failure in an owned resume, including initialized plugins', async () => {
    provider(); vi.useFakeTimers(); const { storage } = await fileStorage(); const destroyed = vi.fn(); let captured!: AgentContextNextGen;
    const original = AgentContextNextGen.create;
    vi.spyOn(AgentContextNextGen, 'create').mockImplementation(config => { const context = original(config); captured = context; const plugin = new Empty('resource'); plugin.destroy = destroyed; context.registerPlugin(plugin); return context; });
    Connector.create({ name: 'service-only', serviceType: 'fixture', auth: { type: 'none' } }); const count = AgentRegistry.count;
    await expect(Agent.resume('A', { connector: 'service-only', model: 'gpt-4o-mini', session: { storage, autoSave: true } })).rejects.toThrow('no vendor');
    expect(captured.isDestroyed).toBe(true); expect(captured.tools.isDestroyed).toBe(true); expect(captured.tools.getPermissionManager()!.isDestroyed).toBe(true); expect(destroyed).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0); expect(AgentRegistry.count).toBe(count);
  });
});

class JsonState extends Empty {
  value = 'SAVED_VALUE'; failRestore = false; failSerialization = false;
  constructor(readonly conversion: 'own' | 'prototype' | 'date' = 'own') { super('json_extension'); }
  override getState(): unknown {
    if (this.failSerialization) return { toJSON() { throw Error('serialization rejected'); } };
    const value = this.value;
    if (this.conversion === 'date') return { value, date: new Date('2026-10-16T00:00:00Z') };
    if (this.conversion === 'prototype') return new (class { #value = value; toJSON() { return { value: this.#value }; } })();
    return { toJSON() { return { value }; } };
  }
  override restoreState(state: unknown) { const data = state as { value: string }; this.value = data.value; if (this.failRestore && data.value === 'REJECT') throw Error('restore rejected'); }
}

describe('existing JSON serialization contract', () => {
  for (const conversion of ['own', 'prototype', 'date'] as const) for (const mode of ['context', 'agent', 'preset'] as const) {
    it(`${mode} loads ${conversion} JSON state through actual file storage`, async () => {
      provider(); const { storage } = await fileStorage(); const plugin = new JsonState(conversion);
      PluginRegistry.register('json_extension', () => plugin);
      const config = { connector: 'main', model: 'gpt-4o-mini', userId: scope.ownerId, session: { storage }, context: {
        model: 'gpt-4o-mini', features: { workingMemory: false, inContextMemory: false, jsonExtension: true }, plugins: { evidence: { scope, storage: new InMemoryEvidenceStorage({ scope }) }, taskState: { scope, taskId: 'T42' } },
      } } satisfies AgentConfig;
      const owner = make(mode === 'preset' ? createAgentPreset('workflow', config) : config);
      await owner.saveSession('A'); expect((await storage.load('A'))!.state.pluginStates.json_extension).toMatchObject({ value: 'SAVED_VALUE' }); plugin.value = 'LATER';
      expect(await (mode === 'context' ? owner.context.load('A') : owner.loadSession('A'))).toBe(true); expect(plugin.value).toBe('SAVED_VALUE');
      plugin.value = 'HOST_BEFORE_REJECT'; const rejected = JSON.parse(JSON.stringify(owner.context.getState())) as SerializedContextState; rejected.pluginStates.json_extension = { value: 'REJECT' }; await storage.save('B', rejected); plugin.failRestore = true;
      await expect(mode === 'context' ? owner.context.load('B') : owner.loadSession('B')).rejects.toThrow('restore rejected'); expect(plugin.value).toBe('HOST_BEFORE_REJECT'); expect(owner.getSessionId()).toBe('A'); await owner.saveSession();
    });
  }
  it.each(['context', 'agent'] as const)('serialization errors precede mutation in %s loads', async mode => {
    provider(); const { storage, path } = await fileStorage(); const context = shared(storage); const plugin = new JsonState(); context.registerPlugin(plugin); const owner = make({ connector: 'main', model: 'gpt-4o-mini', context });
    await owner.saveSession('A'); await storage.save('B', JSON.parse(JSON.stringify(context.getState())) as SerializedContextState); const beforeA = await readFile(path('A'), 'utf8'), beforeB = await readFile(path('B'), 'utf8'); plugin.failSerialization = true;
    await expect(mode === 'context' ? context.load('B') : owner.loadSession('B')).rejects.toThrow('serialization rejected'); expect(owner.getSessionId()).toBe('A'); expect(plugin.value).toBe('SAVED_VALUE');
    expect(await readFile(path('A'), 'utf8')).toBe(beforeA); expect(await readFile(path('B'), 'utf8')).toBe(beforeB);
  });
});

class RepairState extends Empty {
  value = 'HOST'; fail = false;
  override getState() { return { value: this.value }; }
  override restoreState(state: unknown) { if (this.fail) { this.value = 'UNCERTAIN_STATE'; throw Error(`${this.name} refuses restore`); } this.value = (state as { value: string }).value; }
}

describe('recovery belongs to the affected plugin instances', () => {
  it.each(['context', 'agent'] as const)('keeps %s saves blocked across a missing-plugin load, then permits actual repair', async mode => {
    provider(); vi.useFakeTimers(); const { storage, path } = await fileStorage(); const context = shared(storage); const plugin = new RepairState('extension'); context.registerPlugin(plugin);
    const owner = make({ connector: 'main', model: 'gpt-4o-mini', context, session: { storage, autoSave: true, autoSaveIntervalMs: 10 } });
    await owner.saveSession('A'); const good = JSON.parse(JSON.stringify(context.getState())) as SerializedContextState; await storage.save('B', good); await storage.save('legacy', { ...good, pluginStates: {} }); const bytesA = await readFile(path('A'), 'utf8'), bytesLegacy = await readFile(path('legacy'), 'utf8'); plugin.fail = true;
    const load = (id: string) => mode === 'context' ? context.load(id) : owner.loadSession(id);
    await expect(load('B')).rejects.toThrow('refuses restore'); await expect(owner.saveSession()).rejects.toThrow('Checkpoint rollback failed');
    expect(await load('legacy')).toBe(true); expect(plugin.value).toBe('UNCERTAIN_STATE'); await expect(context.save()).rejects.toThrow('Checkpoint rollback failed');
    await vi.advanceTimersByTimeAsync(25); await expect(owner.saveSession()).rejects.toThrow('Checkpoint rollback failed'); expect(await readFile(path('A'), 'utf8')).toBe(bytesA); expect(await readFile(path('legacy'), 'utf8')).toBe(bytesLegacy);
    plugin.fail = false; expect(await load('A')).toBe(true); expect(plugin.value).toBe('HOST'); await owner.saveSession(); expect(owner.getSessionId()).toBe('A');
  });
  it('requires each failed plugin to recover and does not equate checkpoint-key presence with restoration', async () => {
    provider(); const { storage } = await fileStorage(); const context = shared(storage); const first = new RepairState('first'), second = new RepairState('second'); context.registerPlugin(first); context.registerPlugin(second);
    const owner = make({ connector: 'main', model: 'gpt-4o-mini', context }); await owner.saveSession('A'); const good = JSON.parse(JSON.stringify(context.getState())) as SerializedContextState;
    await storage.save('B', good); await storage.save('first-only', { ...good, pluginStates: { first: { value: 'FIRST_REPAIRED' } } }); await storage.save('second-only', { ...good, pluginStates: { second: { value: 'SECOND_REPAIRED' } } }); first.fail = second.fail = true;
    await expect(owner.loadSession('B')).rejects.toThrow('first refuses restore'); first.fail = second.fail = false;
    const ignore = vi.spyOn(owner, 'restoreContextState').mockResolvedValue();
    expect(await owner.loadSession('A')).toBe(true); await expect(owner.saveSession()).rejects.toThrow('Checkpoint rollback failed'); ignore.mockRestore();
    expect(await owner.loadSession('first-only')).toBe(true); expect(first.value).toBe('FIRST_REPAIRED'); expect(second.value).toBe('UNCERTAIN_STATE'); await expect(owner.saveSession()).rejects.toThrow('Checkpoint rollback failed');
    expect(await owner.loadSession('second-only')).toBe(true); await owner.saveSession(); expect(second.value).toBe('SECOND_REPAIRED'); expect(first.value).toBe('FIRST_REPAIRED');
  });
  it('supports explicit trusted host restoreState repair without new APIs or saved fields', async () => {
    provider(); const { storage } = await fileStorage(); const context = shared(storage); const plugin = new RepairState('extension'); context.registerPlugin(plugin); const owner = make({ connector: 'main', model: 'gpt-4o-mini', context });
    await owner.saveSession('A'); const good = JSON.parse(JSON.stringify(context.getState())) as SerializedContextState; plugin.fail = true; await expect(owner.loadSession('A')).rejects.toThrow('refuses restore');
    plugin.fail = false; context.restoreState({ ...good, pluginStates: {} }); await expect(context.save()).rejects.toThrow('Checkpoint rollback failed');
    context.restoreState(good); expect(plugin.value).toBe('HOST'); await owner.saveSession();
  });
});
