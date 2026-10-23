import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const results = [];
for (const [format, lib] of [['esm', await import('@everworker/oneringai')], ['cjs', require('@everworker/oneringai')]]) {
  let checks = 0, selections = 0; const requests = [];
  const usage = { input_tokens: 10, output_tokens: 2, total_tokens: 12 };
  const generate = async options => { requests.push(options); return { id: 'answer', object: 'response', created_at: 1, model: options.model, status: 'completed',
    output_text: 'ACK', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'ACK' }] }], usage }; };
  const provider = { name: 'public-routing-fixture', capabilities: { text: true, images: false, audio: false, videos: false }, generate,
    async *streamGenerate(options) { const r = await generate(options);
      yield { type: lib.StreamEventType.OUTPUT_TEXT_DELTA, response_id: r.id, item_id: 'text', output_index: 0, content_index: 0, sequence_number: 1, delta: 'ACK' };
      yield { type: lib.StreamEventType.RESPONSE_COMPLETE, response_id: r.id, status: 'completed', usage, iterations: 1 }; },
    getModelCapabilities: () => ({ supportsTools: true, supportsVision: false, supportsJSON: true, supportsJSONSchema: true,
      maxTokens: 16000, maxInputTokens: 16000, maxOutputTokens: 128 }), validateConfig: async () => true, listModels: async () => [] };
  const name = `public-routing-${format}`;
  lib.Connector.create({ name, vendor: lib.Vendor.OpenAI, auth: { type: 'none' }, options: { provider } });
  const agent = lib.Agent.create({ connector: name, model: 'main', context: { model: 'main', features: { workingMemory: false, inContextMemory: false } },
    modelExecution: { customProviderAttempts: 'single', routing: { routes: { fast: { model: 'fast' } }, sticky: 'phase', select: ({ hints }) => {
      selections++; return hints.taskType === 'lookup' ? 'fast' : 'default'; } } } });
  const task = new lib.ModelTask({ limits: { maxCalls: 8 } });
  try {
    const first = await agent.run('one', { routing: { taskType: 'lookup', phase: 'gather' }, modelTask: task });
    assert.equal(first.routing.selectedRoute, 'fast'); checks++;
    const second = await agent.run('two', { routing: { taskType: 'other', phase: 'gather' }, modelTask: task });
    assert.equal(second.routing.source, 'sticky'); checks++;
    assert.equal(selections, 1); checks++;
    let stream; for await (const event of agent.stream('three', { routing: { route: 'default' }, modelTask: task })) if (event.type === lib.StreamEventType.RESPONSE_COMPLETE) stream = event;
    assert.equal(stream.routing.selectedRoute, 'default'); checks++;
    await agent.run('four', { routing: null, modelTask: task });
    assert.equal(agent.getRoutingDiagnostics().source, 'disabled'); checks++;
    await agent.runDirect('five', { modelTask: task }); assert.equal(requests.at(-1).model, 'main'); checks++;
    assert.deepEqual(task.snapshot().invocations.map(i => i.model), ['fast', 'fast', 'main', 'main', 'main']); checks++;
    assert.equal(agent.model, 'main'); checks++;
    assert.equal(agent.context.model, 'main'); checks++;
    assert.equal(agent.tools, agent.context.tools); checks++;
    assert.equal(Object.hasOwn(agent.context.getState(), 'routing'), false); checks++;
    const before = requests.length;
    await assert.rejects(agent.run('invalid', { routing: { route: 'missing' } })); assert.equal(requests.length, before); checks++;
    provider.generate = async options => ({ ...await generate(options), output: [
      { type: 'reasoning', id: 'opaque', encrypted_content: 'PUBLIC_FAST_STATE' },
      { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'ACK' }] },
    ] });
    await agent.run('produce bound state', { routing: { route: 'fast' } });
    const state = structuredClone(agent.context.getState());
    const restored = lib.Agent.create({ connector: name, model: 'fast', context: { model: 'fast', features: { workingMemory: false, inContextMemory: false } } });
    try {
      restored.context.restoreState(state);
      const listener = event => { event.options.model = 'other'; };
      restored.on('llm:request', listener);
      const count = requests.length;
      await assert.rejects(restored.run('incompatible replay'), /replay/); assert.equal(requests.length, count); checks++;
      restored.off('llm:request', listener);
      const matched = await restored.run('matching replay'); assert.equal(matched.model, 'fast'); checks++;
      assert.equal(matched.routing, undefined); checks++;
    } finally { restored.destroy(); provider.generate = generate; }

    const repaired = lib.Agent.create({ connector: name, model: 'main', context: { model: 'main', features: { workingMemory: false, inContextMemory: false } }, modelExecution: { customProviderAttempts: 'single' } });
    let repairCalls = 0;
    provider.generate = async options => {
      const response = await generate(options), text = ++repairCalls === 1 ? 'INVALID_JSON' : '{"answer":"OK"}';
      return { ...response, output_text: text, output: [
        ...(repairCalls === 2 ? [{ type: 'reasoning', id: 'repaired-opaque', encrypted_content: 'REPAIRED_PUBLIC_STATE' }] : []),
        { type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] },
      ] };
    };
    try {
      const response = await repaired.run('Return JSON', { responseFormat: { type: 'json_schema', name: 'answer', strict: true, schema: { type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'], additionalProperties: false } } });
      assert.deepEqual(response.output_parsed, { answer: 'OK' }); checks++;
      assert.equal(repaired.context.getState().providerStateBinding.model, 'main'); checks++;
      assert.match(JSON.stringify(repaired.context.getState().conversation), /REPAIRED_PUBLIC_STATE/); checks++;
      repaired.on('llm:request', event => { event.options.model = 'other'; });
      await assert.rejects(repaired.run('Wrong owner'), /replay/); assert.equal(repairCalls, 2); checks++;
    } finally { repaired.destroy(); provider.generate = generate; }

    let counts = 0;
    const nativeName = `public-native-${format}`;
    lib.Connector.create({ name: nativeName, vendor: lib.Vendor.Anthropic, auth: { type: 'none' }, options: { provider: {
      ...provider, name: 'public-native-alternative', compaction: {
        countInput: async () => { counts++; return 50; },
        compact: async () => ({ protocol: 'public-fixture', input: [], usage }),
      },
    } } });
    let native;
    try {
      native = lib.Agent.create({ connector: name, model: 'main', context: { model: 'main', features: { evidence: true, workingMemory: false, inContextMemory: false },
        compactionStrategy: new lib.ContextCompactionStrategy({ plugins: 'off', history: { mode: 'native' } }) },
        modelExecution: { customProviderAttempts: 'single', routing: { routes: { native: { connector: nativeName, model: 'native-alternative', allowContextTransfer: true } }, select: () => 'native' } } });
      const response = await native.run('native alternative'); assert.equal(response.routing.connector, nativeName); checks++;
      assert.ok(counts > 0); checks++;
      const count = requests.length;
      await assert.rejects(native.run('unsupported default', { routing: null }), /compaction/); assert.equal(requests.length, count); checks++;
    } finally { native?.destroy(); lib.Connector.remove(nativeName); }
  } finally { agent.destroy(); task.destroy(); lib.Connector.remove(name); }
  results.push({ format, checks });
}
console.log(JSON.stringify({ protocol: 'stage-14a-public-runtime-v1', passed: true, results }));
