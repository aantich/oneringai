import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const esm = await import('@everworker/oneringai'), cjs = createRequire(import.meta.url)('@everworker/oneringai');
const results = [];
for (const [format, lib, other] of [['esm', esm, cjs], ['cjs', cjs, esm]]) {
  let checks = 0;
  assert.equal(lib.StrategyRegistry.has('context-compaction'), false); checks++;
  for (const plugins of ['off', 'auto']) for (const history of ['off', 'native']) {
    let native = 0, main = 0;
    const usage = { input_tokens: 60, output_tokens: 20, total_tokens: 80 };
    const provider = { name: 'public-native-fixture', capabilities: { text: true, images: false, videos: false, audio: false },
      generate: async o => { main++; return { id: 'r', object: 'response', created_at: 1, model: o.model, status: 'completed',
        output_text: 'DONE', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'DONE' }] }], usage }; },
      async *streamGenerate() { throw new Error('Use run'); }, getModelCapabilities: () => ({ supportsTools: true, supportsVision: false,
        supportsJSON: true, supportsJSONSchema: true, maxTokens: 32000, maxInputTokens: 32000, maxOutputTokens: 2048 }),
      validateConfig: async () => true, listModels: async () => [],
      ...(history === 'native' ? { compaction: {
        compact: async () => { native++; return { protocol: 'public-fixture', usage, input: [{ type: 'compaction', id: 'cmp', encrypted_content: 'x'.repeat(80000) }] }; },
        countInput: async o => Math.ceil(JSON.stringify({ input: typeof o.input === 'string' ? o.input : o.input.map(i => i.type === 'compaction' ? { nativeTokens: 50 } : i), tools: o.tools, instructions: o.instructions }).length / 4),
      } } : {}),
    };
    const name = `public-native-${format}-${plugins}-${history}`;
    lib.Connector.create({ name, vendor: lib.Vendor.OpenAI, auth: { type: 'none' }, options: { provider } });
    // Deliberately mix the supported public module formats for the new policy.
    const agent = lib.Agent.create({ connector: name, model: 'gpt-6-astra', modelExecution: { customProviderAttempts: 'single' },
      context: { model: 'gpt-6-astra', maxContextTokens: 12000, responseReserve: 100,
        features: { workingMemory: false, inContextMemory: false, evidence: history === 'native' },
        compactionStrategy: new other.ContextCompactionStrategy({ plugins, history: history === 'native' ? { mode: 'native', preserveRecentTurns: 0 } : 'off' }) } });
    try {
      assert.equal(agent.tools, agent.context.tools); checks++;
      for (let i = 0; i < 4; i++) { agent.context.addUserMessage(`USER_${i}`); agent.context.addAssistantResponse([{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Historical detail. '.repeat(100) }] }]); }
      const before = agent.context.getState(); assert.equal(before.nativeContinuation, undefined); checks++;
      const pluginOnly = await agent.compactContext({ target: 'plugins' }); assert.equal(native, 0); assert.equal(pluginOnly.history.reason, history === 'native' ? 'not_selected' : 'disabled'); checks++;
      const report = await agent.compactContext({ target: 'history' }); assert.equal(native, history === 'native' ? 1 : 0); checks++;
      assert.equal(report.history.status, history === 'native' ? 'compacted' : 'skipped'); checks++;
      await agent.run('CURRENT'); assert.equal(main, 1); checks++;
      if (history === 'native') {
        assert.equal(agent.context.getState().nativeContinuation.version, 1); checks++;
        assert.ok(agent.context.lastPreparation.budget.providerCountedInputTokens < 12000); checks++;
        assert.throws(() => agent.setModel('other-model')); checks++;
        agent.context.restoreState(before); assert.equal(agent.context.getState().nativeContinuation, undefined); checks++;
      }
    } finally { agent.destroy(); lib.Connector.remove(name); }
  }
  results.push({ format, checks });
}
console.log(JSON.stringify({ protocol: 'stage-16a-public-runtime-v1', passed: true, results }));
