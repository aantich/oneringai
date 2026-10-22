import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const require = createRequire(import.meta.url), results = [];
for (const [format, lib] of [['esm', await import('@everworker/oneringai')], ['cjs', require('@everworker/oneringai')]]) {
  let checks = 0;
  const ctx = lib.AgentContextNextGen.create({ model: 'gpt-4o-mini', assembly: { layout: 'stable-prefix', maxDataTokens: 128 }, features: { workingMemory: false } });
  try {
    const memory = ctx.getPlugin('in_context_memory'); memory.set('needed', 'Exact result', 'A42', 'critical'); memory.set('bulk', 'Background', 'bulk '.repeat(2000), 'low');
    const original = JSON.stringify(memory.getState()); ctx.registerContextContributor(memory.name, lib.createInContextMemoryContributor(memory));
    const result = await ctx.prepare(); assert.equal(JSON.stringify(memory.getState()), original); checks++;
    const manifest = ctx.lastPreparation.selection; assert.equal(manifest.entries.find(entry => entry.id.endsWith('/bulk')).status, 'omitted'); assert.equal(manifest.entries.find(entry => entry.id.endsWith('/needed')).reason, 'protected'); checks++;
    assert.equal(manifest.accounting.cachedInputTokens, null); ctx.recordProviderUsage({ input_tokens: 100, cached_input_tokens: 0 }); assert.equal(ctx.lastPreparation.selection.accounting.cachedInputTokens, 0); checks++;
    ctx.validateRequestBudget({ model: 'gpt-4o-mini', input: result.input, tools: result.tools }); checks++;
    memory.set('needed', 'Corrected result', 'A43', 'critical'); assert.throws(() => ctx.validateRequestBudget({ model: 'gpt-4o-mini', input: result.input, tools: result.tools }), /changed/); checks++;
    const emptyRegistry = () => ({ get: name => lib.Connector.get(name), has: () => false, list: () => [], listAll: () => [], size: () => 0, getDescriptionsForTools: () => '', getInfo: () => ({}) });
    for (const [field, a, b] of [['accountId', 'A', 'B'], ['connectorAccounts', { service: 'A' }, { service: 'B' }], ['taskId', 'A', 'B'], ['connectorRegistry', emptyRegistry(), emptyRegistry()]]) {
      ctx.tools.mergeToolContext({ [field]: a }); const fresh = await ctx.prepare(); ctx.tools.mergeToolContext({ [field]: b });
      assert.throws(() => ctx.validateRequestBudget({ input: fresh.input, tools: fresh.tools }), /authority/); checks++;
    }
    const guided = await ctx.prepare(); assert.ok(!JSON.stringify(guided.input).includes('no retrieval needed')); assert.ok(!JSON.stringify(guided.tools).includes('no retrieval needed'));
    assert.ok(JSON.stringify(await ctx.tools.execute('store_get', { store: 'whiteboard', key: 'bulk' })).includes('bulk '.repeat(2000))); checks++;
    const legacy = lib.AgentContextNextGen.create({ model: 'gpt-4o-mini', features: { workingMemory: false, inContextMemory: false } });
    try { await legacy.prepare(); assert.equal(legacy.lastPreparation.selection, undefined); checks++; } finally { legacy.destroy(); }

    let sequence = 0;
    function fixture(frames, extra = {}) {
      const name = `stage05-public-${format}-${sequence++}`, requests = [];
      const provider = { name: 'public-script', capabilities: { text: true, images: false, audio: false, videos: false },
        async validateConfig() { return true; }, async listModels() { return ['gpt-4o-mini']; },
        getModelCapabilities() { return { supportsTools: true, supportsVision: false, supportsJSON: true, supportsJSONSchema: true, maxTokens: 128000, maxOutputTokens: 4096 }; },
        async generate(options) { const frame = frames[requests.length]; assert.ok(frame, 'Unexpected model call'); requests.push(structuredClone(options.input));
          return { id: `response-${requests.length}`, object: 'response', created_at: 1, status: 'completed', model: options.model, output_text: frame.text ?? '',
            output: [{ type: 'message', role: 'assistant', content: frame.read ? [{ type: 'tool_use', id: 'read-1', name: 'read', arguments: '{}' }] : [{ type: 'output_text', text: frame.text }] }],
            usage: { input_tokens: 17, output_tokens: 2, total_tokens: 19, cached_input_tokens: 3, cache_creation_input_tokens: 1 } }; },
        async *streamGenerate() { throw Error('This public control uses run'); },
      };
      lib.Connector.create({ name, vendor: lib.Vendor.OpenAI, auth: { type: 'none' }, options: { provider } });
      const agent = lib.Agent.create({ connector: name, model: 'gpt-4o-mini', context: { model: 'gpt-4o-mini', assembly: { layout: 'stable-prefix' }, features: { workingMemory: false, inContextMemory: false } }, ...extra });
      return { agent, name, requests };
    }
    const edited = fixture([{ text: 'VALUE_B' }], { hooks: { 'before:llm': async hook => { hook.options.input[hook.options.input.length - 1] = { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'QUESTION_B' }] }; return {}; } } });
    try {
      class Records extends lib.BasePluginNextGen { name = 'records'; getInstructions() { return null; } async getContent() { return 'FULL'; } getContents() { return null; } }
      edited.agent.context.registerPlugin(new Records()); let collections = 0;
      edited.agent.context.registerContextContributor('records', { getRevision: () => 1, contribute: packet => { collections++; return [{ id: 'record', text: JSON.stringify(packet.input).includes('QUESTION_B') ? 'VALUE_B' : 'VALUE_A' }]; } });
      await edited.agent.run('QUESTION_A'); assert.equal(edited.requests.length, 1); assert.equal(collections, 2); assert.ok(JSON.stringify(edited.requests[0]).includes('VALUE_B')); assert.ok(!JSON.stringify(edited.requests[0]).includes('VALUE_A')); checks++;
    } finally { edited.agent.destroy(); lib.Connector.remove(edited.name); }
    const repair = fixture([{ text: 'bad JSON' }]);
    try {
      repair.agent.once('iteration:complete', () => { repair.agent.context.systemPrompt = 'NEW_HOST_PROMPT'; });
      await assert.rejects(repair.agent.run('Return ok true', { responseFormat: { type: 'json_schema', name: 'answer', schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false } } }), error => error.code === 'CONTEXT_ASSEMBLY_STALE');
      assert.equal(repair.requests.length, 1); checks++;
    } finally { repair.agent.destroy(); lib.Connector.remove(repair.name); }
    const wrap = fixture([{ read: true }, { text: 'Wrap up' }], { maxIterations: 1, tools: [{ definition: { type: 'function', function: { name: 'read', parameters: { type: 'object', properties: {} } } }, output: { effect: 'read' }, execute: async () => 'LOCAL_READ' }] });
    try { await wrap.agent.run('Read once'); assert.equal(wrap.requests.length, 2); const observed = wrap.agent.context.lastPreparation.selection.accounting;
      assert.equal(observed.providerInputTokens, 17); assert.equal(observed.cachedInputTokens, 3); assert.equal(observed.cacheCreationInputTokens, 1); checks++;
    } finally { wrap.agent.destroy(); lib.Connector.remove(wrap.name); }
    for (const shape of ['image', 'file', 'signature']) {
      const observed = lib.AgentContextNextGen.create({ model: 'gpt-4o-mini', assembly: {}, features: { workingMemory: false, inContextMemory: false } });
      try {
        observed.addInputItems([{ type: 'message', role: 'assistant', content: [{ type: 'tool_use', id: 'native', name: 'read', arguments: '{}', ...(shape === 'signature' ? { thoughtSignature: 'OPAQUE' } : {}) }] },
          { type: 'function_call_output', call_id: 'native', output: shape === 'image' ? [{ type: 'input_image_url', image_url: { url: 'data:image/png;base64,AA==', detail: 'low' } }] : shape === 'file' ? [{ type: 'input_file', file_id: 'opaque-file' }] : 'plain' }]);
        const prepared = await observed.prepare(); observed.validateRequestBudget({ input: prepared.input, tools: prepared.tools }); assert.equal(observed.lastPreparation.selection.accounting.opaqueOrMultimodal, true); checks++;
      } finally { observed.destroy(); }
    }
    const detail = 'final-detail '.repeat(600), finalJson = JSON.stringify({ ok: true, detail });
    const pressure = fixture([{ text: 'non-json '.repeat(800) }, { text: finalJson }], { context: { model: 'gpt-4o-mini', maxContextTokens: 8000, responseReserve: 2300, assembly: {}, features: { workingMemory: true, inContextMemory: false } } });
    try {
      pressure.agent.context.addInputItems([{ type: 'message', role: 'assistant', content: [{ type: 'tool_use', id: 'old-read', name: 'read', arguments: '{}' }] }, { type: 'message', role: 'user', content: [{ type: 'tool_result', tool_use_id: 'old-read', content: 'DATA '.repeat(1200) }] }]);
      const response = await pressure.agent.run('Return ok and detail.', { responseFormat: { type: 'json_schema', name: 'detail', schema: { type: 'object', properties: { ok: { type: 'boolean' }, detail: { type: 'string' } }, required: ['ok', 'detail'], additionalProperties: false } } });
      assert.deepEqual(response.output_parsed, { ok: true, detail }); assert.equal(pressure.requests.length, 2); assert.ok(!JSON.stringify(pressure.agent.context.getConversation()).includes('old-read')); checks++;
    } finally { pressure.agent.destroy(); lib.Connector.remove(pressure.name); }
    const directory = await mkdtemp(join(tmpdir(), `public-stage05-${format}-`));
    const correlations = new lib.FileCorrelationStorage({ baseDirectory: directory }); lib.StorageRegistry.configure({ correlations });
    const states = new Map(), storage = { getPath: () => 'memory://public-stage05', save: async (id, state) => { states.set(id, JSON.parse(JSON.stringify(state))); }, load: async () => null, list: async () => [], delete: async () => {}, exists: async id => states.has(id) }; let submissions = 0;
    const suspended = fixture([{ read: true }, { text: 'The value of ok is true.' }, { text: '{"ok":true}' }], { context: { model: 'gpt-4o-mini', storage, assembly: {}, features: { workingMemory: false, inContextMemory: false } }, tools: [{ definition: { type: 'function', function: { name: 'read', parameters: { type: 'object', properties: {} } } }, output: { effect: 'write' }, execute: async () => { submissions++; return lib.SuspendSignal.create({ result: 'ACCEPTED_R42', correlationId: 'public-job' }); } }] });
    try {
      const response = await suspended.agent.run('Submit once.', { responseFormat: { type: 'json_schema', name: 'answer', schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false } } });
      assert.equal(response.status, 'suspended'); assert.deepEqual(response.output_parsed, { ok: true }); assert.equal(submissions, 1); assert.equal(suspended.requests.length, 3);
      const ref = await correlations.resolve('public-job'); assert.equal(ref.sessionId, response.suspension.sessionId); assert.ok(JSON.stringify(states.get(ref.sessionId)).includes('ACCEPTED_R42')); checks++;
    } finally { suspended.agent.destroy(); lib.Connector.remove(suspended.name); lib.StorageRegistry.remove('correlations'); await rm(directory, { recursive: true, force: true }); }
    results.push({ format, checks });
  } finally { ctx.destroy(); }
}
console.log(JSON.stringify({ protocol: 'stage05-public-v1', results }));
