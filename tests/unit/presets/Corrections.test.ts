import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Agent, AgentRegistry, AgentContextNextGen, Connector, Vendor, createAgentPreset, InMemoryEvidenceStorage, FileContextStorage, PluginRegistry, BasePluginNextGen, EvidencePluginNextGen, TaskStatePluginNextGen, ObservationMaskingStrategy, ContentType, MessageRole } from '../../../src/index.js';
import type { AgentPresetConfig, AdvancedTextCapabilities, ModelCapabilities, TaskStatePluginConfig, AgentContextNextGenConfig } from '../../../src/index.js';
import { ScriptedLoopProvider } from '../../../examples/agent-loop/scripted-provider.js';

const scope = { ownerId: 'host', namespace: 'corrections' };
const agents: Agent[] = [], dirs: string[] = [];
afterEach(async () => {
  agents.splice(0).forEach(agent => agent.destroy());
  for (const key of ['evidence', 'taskState', 'presetExtension']) PluginRegistry.remove(key);
  Connector.setAccessPolicy(null); Connector.clear(); vi.restoreAllMocks(); vi.useRealTimers();
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});
function config(): AgentPresetConfig {
  return { connector: 'main', model: 'gpt-4o-mini', userId: scope.ownerId, context: {
    features: { workingMemory: false, inContextMemory: false }, plugins: {
      evidence: { scope, storage: new InMemoryEvidenceStorage({ scope }) }, taskState: { scope, taskId: 'T42', association: 'host-session' },
    },
  } };
}
function provider() {
  const result = new ScriptedLoopProvider(Array.from({ length: 10 }, () => ({ text: 'local answer' })));
  Connector.create({ name: 'main', vendor: Vendor.OpenAI, auth: { type: 'none' }, options: { provider: result } });
  return result;
}
function make(cfg: Parameters<typeof Agent.create>[0]) { const agent = Agent.create(cfg); agents.push(agent); return agent; }
class Extension extends BasePluginNextGen {
  constructor(readonly name: string, readonly value?: unknown) { super(); }
  getInstructions() { return null; } async getContent() { return null; } getContents() { return this.value; }
}

describe('preset host identity and extension compatibility', () => {
  for (const preset of ['research', 'workflow'] as const) for (const form of ['omitted', 'undefined'] as const) {
    it(`${preset} ${form} principal retains scoped connector access and tool identity`, async () => {
      provider(); Connector.create({ name: 'foreign', serviceType: 'fixture', auth: { type: 'none' } });
      Connector.setAccessPolicy({ canAccess: (connector, identity) => identity.userId === scope.ownerId && connector.name === 'main' });
      const cfg = config(); cfg.identities = [];
      if (form === 'undefined') Object.assign(cfg.context!, { userId: undefined, identities: undefined });
      const agent = make(createAgentPreset(preset, cfg));
      expect(agent.userId).toBe(scope.ownerId);
      expect(agent.tools.getToolContext()!.userId).toBe(scope.ownerId);
      expect(agent.tools.getToolContext()!.connectorRegistry!.has('foreign')).toBe(false);
      const execute = vi.fn(async (_args, context) => context?.userId);
      agent.addTool({ definition: { type: 'function', function: { name: 'who', description: 'host identity', parameters: { type: 'object', properties: {} } } }, execute });
      expect(await agent.tools.execute('who', {})).toBe(scope.ownerId);
      expect(() => createAgentPreset(preset, { ...cfg, context: { ...cfg.context, userId: 'foreign' } })).toThrow('must match');
    });
  }
  it('preserves opaque and accessor-backed plugin receivers while detaching plain configuration records', () => {
    provider();
    class Config { [key: string]: unknown; #limit = 7; get limit() { return this.#limit; } }
    const instance = new Config(); const factory = vi.fn(cfg => new Extension('preset_extension', cfg?.limit));
    PluginRegistry.register('preset_extension', factory);
    const cfg = config(); cfg.context!.features!.presetExtension = true; cfg.context!.plugins!.presetExtension = instance;
    const composed = createAgentPreset('research', cfg);
    expect(factory).not.toHaveBeenCalled();
    expect((composed.context as AgentContextNextGenConfig).plugins!.presetExtension).toBe(instance);
    expect(make(composed).context.getPlugin<Extension>('preset_extension')!.value).toBe(7);
    const accessor = { get limit() { expect(this).toBe(accessor); return 9; } };
    cfg.context!.plugins!.presetExtension = accessor;
    expect(make(createAgentPreset('research', cfg)).context.getPlugin<Extension>('preset_extension')!.value).toBe(9);
    cfg.context!.plugins!.presetExtension = { limit: 3 };
    const detached = createAgentPreset('research', cfg).context as AgentContextNextGenConfig;
    expect(detached.plugins!.presetExtension).not.toBe(cfg.context!.plugins!.presetExtension);
    factory.mockClear(); cfg.context!.features!.presetExtension = false;
    make(createAgentPreset('research', cfg)); expect(factory).not.toHaveBeenCalled();
  });
  it('retains symbol-backed opaque configuration instead of changing its receiver', () => {
    const key = Symbol('host state'); const value = { limit: 7, get [key]() { expect(this).toBe(value); return 'host'; } };
    const cfg = config(); cfg.context!.plugins!.extension = value;
    const result = createAgentPreset('workflow', cfg).context as AgentContextNextGenConfig;
    expect(result.plugins!.extension).toBe(value); expect((result.plugins!.extension as typeof value)[key]).toBe('host');
  });
  it.each(['research', 'workflow'] as const)('%s rejects owner changes before model dispatch', async preset => {
    const supplied = provider(); const agent = make(createAgentPreset(preset, config()));
    agent.context.userId = 'foreign';
    await expect(agent.run('continue')).rejects.toThrow('selected host scope'); expect(supplied.requests).toHaveLength(0);
  });
});

describe('declared provider capability projection', () => {
  it('reads prototype/private-field getters, omits unrelated data, and returns detached nested values', async () => {
    const supplied = provider();
    class Caps implements ModelCapabilities {
      #tokens = 128000; get supportsTools() { return true; } get supportsVision() { return false; }
      get supportsJSON() { return true; } get supportsJSONSchema() { return false; }
      get maxTokens() { return this.#tokens; } get maxInputTokens() { return this.#tokens; } get maxOutputTokens() { return 4096; }
      get privateDiagnostic(): never { throw Error('Must not traverse extras'); }
      opaqueCallback = () => {};
    }
    class Cache {
      get mode() { return 'request_controlled' as const; } get ttlModes(): Array<'short' | 'extended'> { return ['short']; }
      get reportsCacheUsage() { return true; } get explicitBreakpoints() { return true; }
      privateDiagnostic = 'not-public';
    }
    const advanced: AdvancedTextCapabilities = {
      reasoningHistory: 'always', promptCaching: new Cache(), batch: { supported: true, cancellable: true, maxRequests: 10, completionWindow: '24h' },
      structuredOutput: { jsonObject: 'native', jsonSchema: 'prompt', nativeWithTools: false }, nativeTools: ['web_search'], nativeToolOptions: { remoteMcpApproval: false },
      responsesExtensions: { asyncToolCalling: true, midTurnSteering: false, configurationUpdates: false, misalignmentMonitoring: false },
      dataHandling: { promptCaching: 'provider_managed', batch: 'provider_retained', remoteMcp: 'third_party' },
    };
    vi.spyOn(supplied, 'getModelCapabilities').mockReturnValue(new Caps());
    Object.assign(supplied, { getAdvancedCapabilities: () => advanced });
    const agent = make(createAgentPreset('research', config())); const report = agent.inspectCapabilities();
    expect(report.provider).toEqual({ supportsTools: true, supportsVision: false, supportsJSON: true, supportsJSONSchema: false, maxTokens: 128000, maxInputTokens: 128000, maxOutputTokens: 4096 });
    expect(report.advanced!.promptCaching).not.toHaveProperty('privateDiagnostic'); expect(JSON.stringify(report)).not.toContain('not-public');
    report.advanced!.nativeTools.length = 0; report.advanced!.promptCaching.ttlModes.length = 0; report.advanced!.batch.maxRequests = 1;
    expect(agent.inspectCapabilities().advanced!.nativeTools).toEqual(['web_search']); expect(advanced.batch.maxRequests).toBe(10);
    expect((await agent.run('hello')).output_text).toBe('local answer');
  });
  it('rejects invalid declared scalars and lists locally without invoking the provider', () => {
    const supplied = provider(); const caps = supplied.getModelCapabilities();
    vi.spyOn(supplied, 'getModelCapabilities').mockReturnValue({ ...caps, supportsTools: 'private' as unknown as boolean });
    const agent = make(createAgentPreset('research', config()));
    expect(() => agent.inspectCapabilities()).toThrow('invalid declared capability'); expect(supplied.requests).toHaveLength(0);
  });
  const invalidAdvanced: Array<[string, (value: AdvancedTextCapabilities) => void]> = [
    ['non-array tools', value => { value.nativeTools = 'private' as unknown as AdvancedTextCapabilities['nativeTools']; }],
    ['unknown tool entry', value => { value.nativeTools = ['private' as AdvancedTextCapabilities['nativeTools'][number]]; }],
    ['nonfinite capacity', value => { value.batch.maxRequests = Infinity; }],
    ['non-string window', value => { value.batch.completionWindow = 7 as unknown as string; }],
  ];
  it.each(invalidAdvanced)('rejects %s without traversing or dispatching provider internals', (label, mutate) => {
    const supplied = provider(); const advanced: AdvancedTextCapabilities = {
      promptCaching: { mode: 'unsupported', ttlModes: [], reportsCacheUsage: false }, batch: { supported: false, cancellable: false },
      structuredOutput: { jsonObject: 'prompt', jsonSchema: 'prompt', nativeWithTools: false }, nativeTools: [], nativeToolOptions: { remoteMcpApproval: false },
      dataHandling: { promptCaching: 'none', batch: 'none', remoteMcp: 'none' },
    };
    const agent = make(createAgentPreset('research', config())); Object.assign(supplied, { getAdvancedCapabilities: () => advanced });
    expect(agent.inspectCapabilities().advanced).toEqual(advanced); mutate(advanced);
    expect(() => agent.inspectCapabilities(), label).toThrow('invalid declared capability'); expect(supplied.requests).toHaveLength(0);
  });
});

describe('actual preset protection and failed candidate cleanup', () => {
  it.each(['evidence', 'taskState'] as const)('rejects incompatible %s overrides at creation and cleans candidates; plain Agents retain their extension contract', required => {
    const supplied = provider(); const destroyed = vi.fn();
    const factory = vi.fn(() => { const plugin = new Extension(required === 'taskState' ? 'task_state' : required); plugin.destroy = destroyed; return plugin; });
    PluginRegistry.register(required === 'taskState' ? 'task_state' : required, factory, { featureKey: required });
    const composed = createAgentPreset('workflow', config()); expect(factory).not.toHaveBeenCalled(); const count = AgentRegistry.count;
    expect(() => make(composed)).toThrow(`built-in ${required}`);
    expect(destroyed).toHaveBeenCalledTimes(1); expect(AgentRegistry.count).toBe(count); expect(supplied.requests).toHaveLength(0);
    make({ ...config(), context: { model: 'gpt-4o-mini', features: { [required]: true } } });
    const disabled = config(); disabled.context!.strategy = 'algorithmic'; disabled.context!.features = { evidence: false, taskState: false };
    factory.mockClear(); make(createAgentPreset('workflow', disabled)); expect(factory).not.toHaveBeenCalled();
  });
  it('accepts verified built-in factories and enforces their protected task state at dispatch', async () => {
    const supplied = provider();
    PluginRegistry.register('evidence', cfg => new EvidencePluginNextGen(cfg as ConstructorParameters<typeof EvidencePluginNextGen>[0]));
    PluginRegistry.register('task_state', cfg => new TaskStatePluginNextGen(cfg as TaskStatePluginConfig), { featureKey: 'taskState' });
    const agent = make(createAgentPreset('workflow', config()));
    agent.context.getPlugin<TaskStatePluginNextGen>('task_state')!.updateHost({ notes: [{ id: 'exact', category: 'constraint', text: 'HOST_REQUIRED', source: { label: 'host' } }] }, 0);
    await agent.run('hello'); expect(JSON.stringify(supplied.requests[0])).toContain('HOST_REQUIRED');
    agent.on('llm:request', event => { if (event.options) event.options.input = 'stripped'; });
    await expect(agent.run('tamper')).rejects.toThrow('Protected task state'); expect(supplied.requests).toHaveLength(1);
  });
  it('accepts a built-in evidence factory and actually compacts acknowledged reads before dispatch', async () => {
    const supplied = provider(); const cfg = config(); const storage = cfg.context!.plugins!.evidence!.storage as InMemoryEvidenceStorage;
    PluginRegistry.register('evidence', value => new EvidencePluginNextGen(value as ConstructorParameters<typeof EvidencePluginNextGen>[0]));
    Object.assign(cfg.context!, { maxContextTokens: 5000, responseReserve: 128, criticalCompactionThreshold: 0.8,
      compactionStrategy: new ObservationMaskingStrategy({ preserveRecentTurns: 0, preserveRecentMessages: 0, maxSourceTokens: 20000 }) });
    const agent = make(createAgentPreset('research', cfg)); const raw = { exactId: 'SOURCE', body: 'Bounded source text. '.repeat(1800) };
    const reference = await storage.put({ version: 1, recordedAt: 1, source: { toolName: 'lookup', callId: 'read', executionId: 'original', arguments: {}, principal: {}, effect: 'read', status: 'succeeded', completion: 'settled', startedAt: 1, durationMs: 1 }, result: raw });
    agent.context.addInputItems([
      { type: 'message', role: MessageRole.ASSISTANT, content: [{ type: ContentType.TOOL_USE, id: 'read', name: 'lookup', arguments: '{}' }] },
      { type: 'message', role: MessageRole.USER, content: [{ type: ContentType.TOOL_RESULT, tool_use_id: 'read', content: raw, evidence: { version: 1, status: 'stored', executionId: 'original', reference } }] },
    ]);
    await agent.run('Continue with the exact source.');
    expect(agent.context.lastPreparation!.compaction?.applied).toBe(true);
    expect(supplied.requests).toHaveLength(1); expect(JSON.stringify(supplied.requests[0])).not.toContain(raw.body);
    expect(await storage.read(reference)).toBeTruthy();
  });
  it.each(['scope', 'storage', 'taskId', 'association'] as const)('rejects a built-in factory that silently substitutes host %s', field => {
    provider();
    if (field === 'storage' || field === 'scope') PluginRegistry.register('evidence', cfg => new EvidencePluginNextGen({ ...cfg, scope: field === 'scope' ? { ...scope, namespace: 'foreign' } : scope, storage: new InMemoryEvidenceStorage({ scope: field === 'scope' ? { ...scope, namespace: 'foreign' } : scope }) }));
    else PluginRegistry.register('task_state', cfg => new TaskStatePluginNextGen({ ...cfg, [field]: 'foreign' } as TaskStatePluginConfig), { featureKey: 'taskState' });
    expect(() => make(createAgentPreset('workflow', config()))).toThrow('selected host');
  });
  it('cleans registry, listeners and autosave timers on repeated storage rejection and preserves the original error', async () => {
    provider(); vi.useFakeTimers();
    const dir = await mkdtemp(join(tmpdir(), 'preset-cleanup-')); dirs.push(dir);
    const storage = new FileContextStorage({ agentId: 'cleanup', baseDirectory: dir }); const failure = Error('storage rejected');
    vi.spyOn(storage, 'load').mockRejectedValue(failure);
    const contexts: AgentContextNextGen[] = []; const original = AgentContextNextGen.create;
    vi.spyOn(AgentContextNextGen, 'create').mockImplementation(cfg => { const context = original(cfg); contexts.push(context); return context; });
    const count = AgentRegistry.count, timers = vi.getTimerCount();
    for (let i = 0; i < 3; i++) await expect(Agent.resume('bad', { ...createAgentPreset('workflow', config()), session: { storage, autoSave: true, autoSaveIntervalMs: 10 } })).rejects.toBe(failure);
    expect(AgentRegistry.count).toBe(count); expect(vi.getTimerCount()).toBe(timers);
    expect(contexts).toHaveLength(3); expect(contexts.every(context => context.isDestroyed && context.tools.eventNames().length === 0)).toBe(true);
    expect(vi.mocked(storage.load)).toHaveBeenCalledTimes(3);
  });
  it('failed resume releases candidate listeners without destroying caller-owned context or storage', async () => {
    provider(); const dir = await mkdtemp(join(tmpdir(), 'preset-host-context-')); dirs.push(dir);
    const storage = new FileContextStorage({ agentId: 'host', baseDirectory: dir }); const failure = Error('host storage rejected');
    vi.spyOn(storage, 'load').mockRejectedValue(failure);
    const context = AgentContextNextGen.create({ model: 'gpt-4o-mini', storage, features: { workingMemory: false, inContextMemory: false } });
    const listeners = context.tools.listenerCount('tool:registered'), count = AgentRegistry.count;
    try {
      await expect(Agent.resume('bad', { connector: 'main', model: 'gpt-4o-mini', context, session: { storage } })).rejects.toBe(failure);
      expect(context.isDestroyed).toBe(false); expect(context.tools.listenerCount('tool:registered')).toBe(listeners); expect(AgentRegistry.count).toBe(count);
      expect(context.storage).toBe(storage);
    } finally { context.destroy(); }
  });
});
