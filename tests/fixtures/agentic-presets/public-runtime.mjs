// Run after build: node tests/fixtures/agentic-presets/public-runtime.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const summaries = [];
for (const [format, lib] of [['esm', await import('@everworker/oneringai')], ['cjs', require('@everworker/oneringai')]]) {
  let checks = 0;
  const connector = `public-presets-${format}`;
  let calls = 0;
  const provider = { name: 'public-preset-probe', capabilities: { text: true, images: false, videos: false, audio: false },
    async validateConfig() { return true; }, async listModels() { return ['gpt-4o-mini']; },
    getModelCapabilities() { return { supportsTools: true, supportsVision: false, supportsJSON: true, supportsJSONSchema: false, maxTokens: 128000, maxOutputTokens: 4096 }; },
    async generate(options) { calls++; return { id: 'p' + calls, object: 'response', created_at: 1, model: options.model, status: 'completed', output_text: 'verified', output: [{ type: 'message', role: lib.MessageRole.ASSISTANT, content: [{ type: lib.ContentType.OUTPUT_TEXT, text: 'verified' }] }], usage: { input_tokens: 10, output_tokens: 1, total_tokens: 11 } }; },
    async *streamGenerate() { throw Error('This consumer fixture exercises nonstream execution.'); },
  };
  lib.Connector.create({ name: connector, vendor: lib.Vendor.OpenAI, auth: { type: 'none' }, options: { provider } });
  try {
    const plain = lib.Agent.create({ connector, model: 'gpt-4o-mini' });
    try { assert.equal(plain.inspectCapabilities().loop.enabled, false); assert.equal((await plain.run('plain')).loop, undefined); checks++; }
    finally { plain.destroy(); }
    for (const preset of ['research', 'workflow']) {
      class Scope { get ownerId() { return 'public-host'; } get namespace() { return format + preset; } get tenantId() { return 'tenant'; } }
      const scope = new Scope();
      class Policy { #checks = 0; get checks() { return this.#checks; } completion() { this.#checks++; return { complete: true }; } }
      const policy = new Policy();
      const config = lib.createAgentPreset(preset, { connector, model: 'gpt-4o-mini', userId: scope.ownerId, loopPolicy: policy,
        context: { plugins: { evidence: { scope, storage: new lib.InMemoryEvidenceStorage({ scope }) }, taskState: { scope, taskId: 'T42' } } } });
      assert.equal(config.loopPolicy, policy); checks++;
      const agent = lib.Agent.create(config);
      try { assert.equal(agent.tools, agent.context.tools); assert.equal((await agent.run('verify')).loop.reason, 'completed'); assert.equal(policy.checks, 1); checks++;
        const report = agent.inspectCapabilities(); assert.equal(report.context.strategy, preset === 'research' ? 'observation-masking' : 'algorithmic'); report.context.features.evidence = false;
        assert.equal(agent.inspectCapabilities().context.features.evidence, true); checks++;
      } finally { agent.destroy(); }
    }
    assert.throws(() => lib.createAgentPreset('coding', { connector, model: 'gpt-4o-mini' })); checks++;
    assert.throws(() => lib.createAgentPreset('research', { connector, model: 'gpt-4o-mini', context: { features: { evidence: false } } })); checks++;
    const disabled = lib.Agent.create(lib.createAgentPreset('workflow', { connector, model: 'gpt-4o-mini', loopPolicy: null, context: { features: { evidence: false, taskState: false, workingMemory: false, inContextMemory: false } } }));
    try { assert.deepEqual(disabled.inspectCapabilities().context.plugins, []); assert.equal((await disabled.run('disabled')).loop, undefined); checks++; } finally { disabled.destroy(); }
    for (const preset of ['research', 'workflow']) {
      const scope = { ownerId: 'public-host', namespace: format + preset };
      const agent = lib.Agent.create({ ...lib.createAgentPreset(preset, { connector, model: 'gpt-4o-mini', userId: scope.ownerId,
        context: { userId: undefined, plugins: { evidence: { scope, storage: new lib.InMemoryEvidenceStorage({ scope }) }, taskState: { scope, taskId: 'T42' } } } }) });
      try { assert.equal(agent.userId, scope.ownerId); assert.equal(agent.tools.getToolContext().userId, scope.ownerId); checks++; } finally { agent.destroy(); }
    }
    class Capabilities {
      get supportsTools() { return true; } get supportsVision() { return false; } get supportsJSON() { return true; }
      get supportsJSONSchema() { return false; } get maxTokens() { return 128000; } opaqueCallback = () => {};
      privateDiagnostic = 'not-public';
    }
    const originalCaps = provider.getModelCapabilities; provider.getModelCapabilities = () => new Capabilities();
    const inspected = lib.Agent.create({ connector, model: 'gpt-4o-mini' });
    try { assert.equal(inspected.inspectCapabilities().provider.maxTokens, 128000); assert.equal(inspected.inspectCapabilities().provider.privateDiagnostic, undefined); checks++; }
    finally { inspected.destroy(); provider.getModelCapabilities = originalCaps; }
    class Extension extends lib.BasePluginNextGen {
      constructor(name, config) { super(); this.name = name; this.value = config?.limit; }
      getInstructions() { return null; } async getContent() { return null; } getContents() { return this.value; }
    }
    class ExtensionConfig { #limit = 7; get limit() { return this.#limit; } }
    lib.PluginRegistry.register('preset_extension', config => new Extension('preset_extension', config));
    try {
      const extended = lib.Agent.create(lib.createAgentPreset('workflow', { connector, model: 'gpt-4o-mini', context: {
        features: { evidence: false, taskState: false, presetExtension: true }, plugins: { presetExtension: new ExtensionConfig() } } }));
      try { assert.equal(extended.context.getPlugin('preset_extension').value, 7); checks++; } finally { extended.destroy(); }
    } finally { lib.PluginRegistry.remove('presetExtension'); }
    for (const key of ['evidence', 'taskState']) {
      lib.PluginRegistry.register(key === 'taskState' ? 'task_state' : key, () => new Extension(key === 'taskState' ? 'task_state' : key), { featureKey: key });
      try {
        const scope = { ownerId: 'public-host', namespace: format + key }; const count = lib.AgentRegistry.count;
        assert.throws(() => lib.Agent.create(lib.createAgentPreset('workflow', { connector, model: 'gpt-4o-mini', userId: scope.ownerId,
          context: { plugins: { evidence: { scope, storage: new lib.InMemoryEvidenceStorage({ scope }) }, taskState: { scope, taskId: 'T42' } } } })), /built-in/);
        assert.equal(lib.AgentRegistry.count, count); checks++;
      } finally { lib.PluginRegistry.remove(key); }
    }
    // Failed shared-context loading must leave the original tool authority intact.
    const loadError = Error('public backend rejected');
    const storage = { load: async () => { throw loadError; }, save: async () => {}, exists: async () => true };
    const context = lib.AgentContextNextGen.create({ model: 'gpt-4o-mini', storage, features: { workingMemory: false, inContextMemory: false } });
    let writes = 0;
    const owner = lib.Agent.create({ connector, model: 'gpt-4o-mini', context, instructions: 'PUBLIC_HOST_PROMPT', permissions: { blocklist: ['blocked_write'] }, tools: [
      { definition: { type: 'function', function: { name: 'blocked_write', parameters: { type: 'object', properties: {} } } }, execute: async () => { writes++; } },
    ] });
    try {
      const policy = context.tools.getPermissionManager();
      assert.equal((await owner.tools.executeWithOutcome('blocked_write', {})).outcome.status, 'denied'); checks++;
      await assert.rejects(lib.Agent.resume('bad', { connector, model: 'gpt-4o-mini', context, instructions: 'REJECTED_PROMPT', permissions: { blocklist: ['blocked_write'] }, session: { storage } }), error => error === loadError); checks++;
      assert.equal(context.tools.getPermissionManager(), policy); assert.equal(policy.isDestroyed, false); checks++;
      assert.equal((await owner.tools.executeWithOutcome('blocked_write', {})).outcome.status, 'denied'); assert.equal(writes, 0); checks++;
      assert.equal(context.systemPrompt, 'PUBLIC_HOST_PROMPT'); assert.equal(context.isDestroyed, false); checks++;
      const stored = context.getState(); storage.load = async () => ({ state: stored });
      await owner.saveSession('A'); const notificationError = Error('public notification rejected');
      lib.AgentRegistry.once('agent:registered', ({ agent }) => agent.on('session:loaded', () => { throw notificationError; }));
      await assert.rejects(lib.Agent.resume('B', { connector, model: 'gpt-4o-mini', context, instructions: 'REJECTED_B', session: { storage } }), error => error === notificationError);
      assert.equal(context.sessionId, 'A'); assert.equal(context.systemPrompt, 'PUBLIC_HOST_PROMPT');
      assert.equal(context.tools.getPermissionManager(), policy); assert.equal(policy.isDestroyed, false);
      assert.equal((await owner.tools.executeWithOutcome('blocked_write', {})).outcome.status, 'denied'); assert.equal(writes, 0); checks++;
      await assert.rejects(lib.Agent.resume('B', { connector: 'missing-connector', model: 'gpt-4o-mini', context, session: { storage } }), /not found/);
      assert.equal(context.sessionId, 'A'); assert.equal(context.systemPrompt, 'PUBLIC_HOST_PROMPT'); checks++;
      class JsonState extends lib.BasePluginNextGen {
        name = 'json_extension'; value = 'SAVED'; fail = false;
        getInstructions() { return null; } async getContent() { return null; } getContents() { return null; }
        getState() { const value = this.value; return { toJSON() { return { value }; } }; }
        restoreState(state) { if (this.fail) { this.value = 'UNCERTAIN'; throw Error('restore refused'); } this.value = state.value; }
      }
      const extension = new JsonState(); context.registerPlugin(extension);
      const good = JSON.parse(JSON.stringify(context.getState())); storage.load = async () => ({ state: good });
      extension.value = 'LATER'; assert.equal(await context.load('A'), true); assert.equal(extension.value, 'SAVED'); checks++;
      extension.fail = true; await assert.rejects(context.load('B'), /restore refused/);
      extension.fail = false; storage.load = async () => ({ state: { ...good, pluginStates: {} } });
      assert.equal(await context.load('legacy'), true); await assert.rejects(context.save(), /Checkpoint rollback failed/); assert.equal(extension.value, 'UNCERTAIN'); checks++;
      storage.load = async () => ({ state: good }); assert.equal(await context.load('A'), true); await context.save(); assert.equal(extension.value, 'SAVED'); checks++;
      let notifications = 0;
      lib.AgentRegistry.once('agent:registered', ({ agent }) => agent.on('session:loaded', () => { notifications++; }));
      const resumed = await lib.Agent.resume('valid', { connector, model: 'gpt-4o-mini', context, permissions: { blocklist: ['blocked_write'] }, session: { storage } });
      try { assert.equal(notifications, 1); assert.equal(resumed.context, context); assert.equal(context.sessionId, 'valid'); checks++; }
      finally { resumed.destroy(); }
    } finally { owner.destroy(); context.destroy(); }
    assert.equal(calls, 4); summaries.push({ format, checks, calls });
  } finally { lib.Connector.remove(connector); }
}
console.log(JSON.stringify({ protocol: 'stage12-public-v1', summaries }));
