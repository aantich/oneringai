import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Agent, Connector, Vendor, createAgentPreset, InMemoryEvidenceStorage, FileEvidenceStorage, FileContextStorage, TaskStatePluginNextGen, ModelTask, StreamEventType, StrategyRegistry, AgentContextNextGen, PluginRegistry } from '../../../src/index.js';
import type { AgentPresetConfig, AgentPresetName, AgentLoopPolicy, AgentLoopCompletionResult, AgentContextNextGenConfig } from '../../../src/index.js';
import { ScriptedLoopProvider } from '../../../examples/agent-loop/scripted-provider.js';

const scope = { ownerId: 'host-user', namespace: 'stage12' };
const agents: Agent[] = [], directories: string[] = [];
afterEach(async () => { agents.splice(0).forEach(a => a.destroy()); Connector.clear(); vi.restoreAllMocks(); await Promise.all(directories.splice(0).map(d => rm(d, { recursive: true, force: true }))); });
function config(): AgentPresetConfig {
  return { connector: 'test', model: 'gpt-4o-mini', userId: scope.ownerId, context: { plugins: {
    evidence: { scope, storage: new InMemoryEvidenceStorage({ scope }) }, taskState: { taskId: 'T42', scope },
  } } };
}
function create(name: AgentPresetName | null, frames: ConstructorParameters<typeof ScriptedLoopProvider>[0], overrides: Partial<AgentPresetConfig> = {}) {
  const provider = new ScriptedLoopProvider(frames);
  Connector.create({ name: 'test', vendor: Vendor.OpenAI, auth: { type: 'none' }, options: { provider } });
  const supplied = { ...config(), ...overrides };
  const agent = Agent.create(name ? createAgentPreset(name, supplied) : { ...supplied, context: { model: supplied.model, ...supplied.context } }); agents.push(agent);
  return { agent, provider };
}

describe('pure opt-in compositions', () => {
  it.each(['research', 'workflow'] as const)('%s composes existing features without IO or model calls', name => {
    const supplied = config(); const storage = supplied.context!.plugins!.evidence!.storage as InMemoryEvidenceStorage;
    const put = vi.spyOn(storage, 'put'); const list = vi.spyOn(storage, 'list');
    const result = createAgentPreset(name, supplied);
    expect(result.context).toMatchObject({ model: supplied.model, strategy: name === 'research' ? 'observation-masking' : 'algorithmic', features: { evidence: true } });
    expect(result.maxIterations).toBe(name === 'research' ? 12 : 8); expect(result.loopPolicy).toEqual({ maxRecoveryAttempts: 2 });
    expect(result.modelExecution).toBeUndefined(); expect(result.instructions).toBeUndefined(); expect(result.permissions).toBeUndefined();
    expect(put).not.toHaveBeenCalled(); expect(list).not.toHaveBeenCalled(); expect(Connector.has('test')).toBe(false);
    expect(supplied.context!.features).toBeUndefined(); expect(result.context).not.toBe(supplied.context);
    expect((result.context as typeof supplied.context)!.plugins!.evidence!.storage).toBe(storage);
  });
  it('preserves explicit false/null, empty collections, custom strategy and host objects', () => {
    const strategy = StrategyRegistry.create('algorithmic'); const tools: [] = [];
    const supplied = { ...config(), tools, maxIterations: 3, loopPolicy: null, context: { compactionStrategy: strategy, features: { evidence: false, taskState: false, workingMemory: false, inContextMemory: false } } };
    const result = createAgentPreset('workflow', supplied);
    expect(result.maxIterations).toBe(3); expect(result.loopPolicy).toBeNull(); expect(result.tools).toBe(tools);
    expect(result.context).toMatchObject({ compactionStrategy: strategy, features: supplied.context.features });
  });
  it.each(['unknown', 'coding', 'adaptive-routing'])('rejects unavailable preset %s', name => {
    expect(() => createAgentPreset(name as AgentPresetName, config())).toThrow('Unknown agent preset');
  });
  it.each(['proceduralMemory', 'adaptiveRouting', 'nativeCompaction'])('rejects unavailable feature %s', feature => {
    const supplied = config(); supplied.context!.features = { [feature]: true };
    expect(() => createAgentPreset('research', supplied)).toThrow('unavailable');
  });
  it('rejects conflicting model/principal and invalid iteration limits', () => {
    for (const extra of [{ model: 'other' }, { userId: 'other' }]) expect(() => createAgentPreset('research', { ...config(), context: { ...config().context, ...extra } })).toThrow('must match');
    for (const maxIterations of [0, -1, 1.5, Infinity, NaN]) expect(() => createAgentPreset('research', { ...config(), maxIterations })).toThrow('positive integer');
  });
  it('rejects masking without evidence and summaries without a helper', () => {
    expect(() => createAgentPreset('research', { ...config(), context: { features: { evidence: false } } })).toThrow('requires enabled evidence');
    const supplied = config(); supplied.context!.strategy = 'structured-summary';
    expect(() => createAgentPreset('research', supplied)).toThrow('compactor helper');
    expect(() => createAgentPreset('research', { ...config(), context: { strategy: 'future-native' } })).toThrow('Unknown preset context strategy');
    supplied.modelExecution = { helpers: { compactor: { connector: 'explicit', model: 'gpt-4o-mini' } } };
    expect(createAgentPreset('research', supplied).modelExecution).toBe(supplied.modelExecution);
  });
  it('rejects missing/foreign evidence and task authority before creating an agent', () => {
    const cases: Array<[AgentPresetName, AgentPresetConfig, string]> = [
      ['research', { connector: 'test', model: 'gpt-4o-mini' }, 'explicit evidence'],
      ['research', { ...config(), userId: 'foreign' }, 'must match'],
      ['workflow', { ...config(), context: { plugins: { evidence: config().context!.plugins!.evidence } } }, 'taskState'],
    ];
    const foreign = config(); foreign.context!.plugins!.evidence!.scope = { ...scope, tenantId: 'foreign' }; cases.push(['research', foreign, 'must match']);
    const task = config(); task.context!.plugins!.taskState!.scope = { ...scope, namespace: 'foreign' }; cases.push(['workflow', task, 'scopes must match']);
    for (const [name, supplied, error] of cases) expect(() => createAgentPreset(name, supplied)).toThrow(error);
  });

  it('treats undefined feature settings as absent and rejects malformed booleans/task IDs', () => {
    const supplied = config(); supplied.context!.features = { evidence: undefined };
    expect((createAgentPreset('research', supplied).context as AgentContextNextGenConfig).features?.evidence).toBe(true);
    for (const evidence of ['true', 1, null]) expect(() => createAgentPreset('research', { ...config(), context: { features: { evidence } } } as unknown as AgentPresetConfig)).toThrow('booleans');
    for (const taskId of ['', ' ', 12]) { const supplied = config(); supplied.context!.plugins!.taskState!.taskId = taskId; expect(() => createAgentPreset('workflow', supplied)).toThrow('taskId'); }
  });
  it('does not instantiate registered custom strategies during pure assembly', () => {
    let constructions = 0;
    class CustomStrategy {
      name = 'preset-custom'; displayName = 'Preset custom'; description = 'Host extension'; threshold = 0.8;
      constructor() { constructions++; }
      async compact() { return { tokensFreed: 0, messagesRemoved: 0, pluginsCompacted: [], log: [] }; }
      async consolidate() { return { performed: false, tokensChanged: 0, actions: [] }; }
    }
    StrategyRegistry.register(CustomStrategy);
    try { const before = constructions; const supplied = config(); supplied.context!.strategy = 'preset-custom';
      expect(createAgentPreset('research', supplied)).toBeTruthy(); expect(constructions).toBe(before);
    } finally { StrategyRegistry.remove('preset-custom'); }
  });
  it('rejects live context composition without taking ownership of the existing context', () => {
    const context = AgentContextNextGen.create({ model: 'gpt-4o-mini' });
    try { expect(() => createAgentPreset('research', { ...config(), context } as unknown as AgentPresetConfig)).toThrow('live context'); expect(context.isDestroyed).toBe(false); }
    finally { context.destroy(); }
  });
  it('permits explicitly registered extensions and keeps disabled factories idle', () => {
    const factory = vi.fn(() => { throw Error('Must not initialize during preset assembly'); });
    PluginRegistry.register('preset_extension', factory);
    try {
      const supplied = config(); supplied.context!.features = { presetExtension: true };
      expect(createAgentPreset('research', supplied)).toBeTruthy(); expect(factory).not.toHaveBeenCalled();
      supplied.context!.features = { unavailableButDisabled: false }; expect(createAgentPreset('research', supplied)).toBeTruthy();
    } finally { PluginRegistry.remove('presetExtension'); }
  });

});

describe('resolved execution and inspection', () => {
  it('keeps plain Agent defaults and unconfigured loop/helper behavior', async () => {
    const { agent, provider } = create(null, [{ text: 'baseline' }], { context: undefined });
    const report = agent.inspectCapabilities(); expect(report.context.strategy).toBe('algorithmic'); expect(report.context.plugins).not.toContain('evidence');
    expect(report.loop.enabled).toBe(false); expect(report.helpers).toEqual({});
    expect((await agent.run('hello')).loop).toBeUndefined(); expect(provider.requests).toHaveLength(1);
  });
  for (const name of ['research', 'workflow'] as const) for (const mode of ['run', 'stream'] as const) {
    it(`${name} ${mode} uses one shared tool pipeline and acknowledges actual evidence`, async () => {
      const execute = vi.fn(async () => ({ receipt: 'A42', ready: true }));
      const { agent, provider } = create(name, [{ calls: [{ id: 'c1', name: 'read_receipt', args: {} }] }, { text: 'ready' }], {
        tools: [{ definition: { type: 'function', function: { name: 'read_receipt', description: 'Read local receipt', parameters: { type: 'object', properties: {}, additionalProperties: false } } }, output: { effect: 'read' }, execute }],
      });
      expect(agent.tools).toBe(agent.context.tools);
      if (mode === 'run') expect((await agent.run('check')).loop?.reason).toBe('answer_returned');
      else { for await (const event of agent.stream('check')) if (event.type === StreamEventType.RESPONSE_COMPLETE) expect(event.loop?.reason).toBe('answer_returned'); }
      expect(execute).toHaveBeenCalledTimes(1); expect(provider.requests).toHaveLength(2);
      const report = agent.inspectCapabilities(); expect(report.context.evidenceDurability).toBe('process');
      expect(report.loop.hostCompletionCheck).toBe(false); expect(report.registry).toEqual({ known: true, vendorMatches: true, active: true });
      expect(report.context.plugins.includes('task_state')).toBe(name === 'workflow');
      expect(JSON.stringify(report)).not.toContain('A42'); expect(report.notices.join(' ')).toContain('external SDK');
    });
  }
  it('disabled preset features add zero content, tools, storage calls or helper calls', async () => {
    const supplied = config(); const storage = supplied.context!.plugins!.evidence!.storage as InMemoryEvidenceStorage; const put = vi.spyOn(storage, 'put');
    const { agent, provider } = create('workflow', [{ text: 'plain' }], { context: { strategy: 'algorithmic', features: { evidence: false, taskState: false, workingMemory: false, inContextMemory: false }, plugins: supplied.context!.plugins }, loopPolicy: null });
    expect(agent.inspectCapabilities().context.plugins).toEqual([]); expect(agent.getToolDefinitions()).toEqual([]);
    expect((await agent.run('hello')).loop).toBeUndefined(); expect(provider.requests).toHaveLength(1); expect(put).not.toHaveBeenCalled();
    expect(JSON.stringify(provider.requests[0])).not.toContain('T42');
  });
  it('retains class callback receiver and honors caller ModelTask budgets', async () => {
    class Policy implements AgentLoopPolicy { maxRecoveryAttempts = 0; #checks = 0; get checks() { return this.#checks; } completion() { this.#checks++; return { complete: true }; } }
    const policy = new Policy(); const { agent, provider } = create('workflow', [{ text: 'verified' }], { loopPolicy: policy, modelExecution: { customProviderAttempts: 'single' } });
    const task = new ModelTask({ limits: { maxCalls: 1 } });
    try { expect((await agent.run('check', { modelTask: task })).loop?.reason).toBe('completed'); expect(policy.checks).toBe(1); expect(agent.inspectCapabilities().loop.hostCompletionCheck).toBe(true);
      await expect(agent.run('again', { modelTask: task })).rejects.toThrow(); expect(provider.requests).toHaveLength(1);
    } finally { task.destroy(); }
  });
  it('reports actual context changes and detaches report values', () => {
    const { agent, provider } = create('research', []); const generate = vi.spyOn(provider, 'generate');
    class Capabilities { supportsTools = true; supportsVision = false; supportsJSON = true; supportsJSONSchema = false; maxTokens = 128000; maxOutputTokens = 4096; }
    const capabilities = new Capabilities(); vi.spyOn(provider, 'getModelCapabilities').mockReturnValue(capabilities);
    const first = agent.inspectCapabilities(); first.context.features.evidence = false; first.provider.maxTokens = 1; first.context.plugins.length = 0;
    expect(agent.inspectCapabilities().context.features.evidence).toBe(true); expect(agent.inspectCapabilities().provider.maxTokens).toBe(128000); expect(capabilities.maxTokens).toBe(128000);
    agent.context.setCompactionStrategy(StrategyRegistry.create('algorithmic')); expect(agent.inspectCapabilities().context.strategy).toBe('algorithmic');
    expect(agent.inspectCapabilities().advanced).toBeUndefined(); expect(generate).not.toHaveBeenCalled();
    Object.assign(capabilities, { opaqueCallback: () => {} }); expect(agent.inspectCapabilities().provider).not.toHaveProperty('opaqueCallback'); expect(generate).not.toHaveBeenCalled();
    agent.destroy(); expect(() => agent.inspectCapabilities()).toThrow();
  });
  it('reports registry uncertainty and never infers a vendor from an unknown model', () => {
    const { agent } = create('research', [], { model: 'private-model' }); expect(agent.inspectCapabilities().registry).toEqual({ known: false, active: null, vendorMatches: null });
    expect(agent.inspectCapabilities().notices.join(' ')).toContain('absent from the registry');
  });

  it('inspects configured helpers without resolving or invoking them and reports vendor mismatch', () => {
    const { agent, provider } = create('research', [], { model: 'claude-sonnet-4-6', modelExecution: { helpers: { verifier: { connector: 'host-verifier', model: 'gpt-4o-mini', allowContextTransfer: true } } } });
    const report = agent.inspectCapabilities(); expect(report.registry.vendorMatches).toBe(false);
    expect(report.helpers.verifier).toEqual({ connector: 'host-verifier', model: 'gpt-4o-mini', allowContextTransfer: true }); expect(provider.requests).toHaveLength(0);
  });
  for (const mode of ['run', 'stream'] as const) it(`preserves ${mode} cancellation and single-execution ownership`, async () => {
    let started!: () => void; const checking = new Promise<void>(resolve => { started = resolve; });
    let settle!: (value: AgentLoopCompletionResult) => void;
    const { agent, provider } = create('workflow', [{ text: 'candidate' }, { text: 'next' }], { loopPolicy: { completion: () => { started(); return new Promise(resolve => { settle = resolve; }); } } });
    const pending = mode === 'run' ? agent.run('check') : (async () => { for await (const event of agent.stream('check')) void event; })();
    const rejected = expect(pending).rejects.toThrow(); await checking;
    await expect(agent.run('concurrent')).rejects.toThrow('active'); agent.cancel(); await rejected;
    settle({ complete: true }); await Promise.resolve(); expect(agent.getLoopDiagnostics()?.reason).toBe('cancelled');
    expect((await agent.run('continue', { loopPolicy: null })).output_text).toBe('next'); expect(provider.requests).toHaveLength(2);
  });

  it('checkpoints task/evidence while callbacks remain host-owned and rejects foreign scope', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'preset-session-')); directories.push(directory);
    const storage = new FileContextStorage({ agentId: 'stage12', baseDirectory: directory });
    const supplied = config(); supplied.context!.plugins!.evidence = { scope, storage: new FileEvidenceStorage({ scope, directory: join(directory, 'evidence') }) };
    const completion = vi.fn(() => ({ complete: true }));
    const { agent } = create('workflow', [{ text: 'checkpoint' }], { ...supplied, session: { storage }, loopPolicy: { completion } });
    const taskState = agent.context.getPlugin<TaskStatePluginNextGen>('task_state')!;
    taskState.updateHost({ notes: [{ id: 'host-note', category: 'constraint', text: 'Keep exact A42.', source: { label: 'host' } }] }, 0);
    await agent.run('hello'); await agent.saveSession(); const id = agent.getSessionId()!;
    const restored = await Agent.resume(id, { ...createAgentPreset('workflow', supplied), session: { storage } }); agents.push(restored);
    expect(restored.inspectCapabilities().loop.hostCompletionCheck).toBe(false); expect(JSON.stringify(restored.context.getPlugin<TaskStatePluginNextGen>('task_state')!.getState())).toContain('Keep exact A42');
    const foreignScope = { ...scope, ownerId: 'foreign' }; const foreign = { ...config(), userId: foreignScope.ownerId, context: { plugins: { evidence: { scope: foreignScope, storage: new InMemoryEvidenceStorage({ scope: foreignScope }) }, taskState: { taskId: 'T42', scope: foreignScope } } } };
    await expect(Agent.resume(id, { ...createAgentPreset('workflow', foreign), session: { storage } })).rejects.toThrow(); expect(completion).toHaveBeenCalledTimes(1);
  });
});
