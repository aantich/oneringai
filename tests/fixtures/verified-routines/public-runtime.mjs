import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const esm = await import('@everworker/oneringai'), cjsPath = require.resolve('@everworker/oneringai');
const cjs = require(cjsPath), duplicateESM = await import(new URL('../../../dist/index.js?verified-copy', import.meta.url));
delete require.cache[cjsPath]; const copies = [esm, cjs, duplicateESM, require(cjsPath)];
let checks = 0, sequence = 0;
for (const facade of copies) for (const library of copies) {
  const name = `verified-public-${sequence++}`; let calls = 0, submissions = 0, confirmed = false;
  const provider = { name: 'offline', capabilities: { text: true, images: false, audio: false, videos: false },
    generate: async options => { calls++; return { id: 'answer', object: 'response', created_at: 1, status: 'completed', model: options.model, output_text: 'READY',
      output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'READY' }] }], usage: { input_tokens: 5, output_tokens: 1, total_tokens: 6 } }; },
    getModelCapabilities: () => ({ supportsTools: true, supportsVision: false, supportsJSON: true, supportsJSONSchema: true, maxTokens: 16000, maxInputTokens: 16000, maxOutputTokens: 128 }),
    validateConfig: async () => true, listModels: async () => [] };
  library.Connector.create({ name, vendor: library.Vendor.OpenAI, auth: { type: 'none' }, options: { provider } });
  const agent = library.Agent.create({ connector: name, model: 'offline', modelExecution: { customProviderAttempts: 'single' },
    context: { model: 'offline', features: { workingMemory: false, inContextMemory: false } },
    tools: [{ definition: { type: 'function', function: { name: 'submit' } }, execute: async () => ({ id: ++submissions }), output: { effect: 'write' } }] });
  const task = new library.ModelTask({ limits: { maxCalls: 1 } });
  const runner = facade.createRoutineRunner({ verify: observation => observation.phase === 'routine' || confirmed ? { kind: 'verified' } : { kind: 'waiting', reason: 'Host pending' } });
  try {
    const definition = facade.createRoutineDefinition({ name: 'Public C3', description: 'Synthetic', preSteps: [{ name: 'submit', toolName: 'submit', args: {} }], tasks: [{ name: 'one', description: 'one' }] });
    const first = await runner.run({ agent, definition, execution: { modelTask: task } });
    assert.equal(first.state, 'waiting'); checks++; assert.equal(submissions, 1); checks++;
    await assert.rejects(agent.runDirect('foreign'), /owned/); checks++;
    confirmed = true; const last = await runner.resume(first.continuation, { authorize: () => true });
    assert.equal(last.state, 'completed'); checks++; assert.equal(calls, 1); checks++; assert.equal(submissions, 1); checks++;
    assert.equal(task.snapshot().totals.calls, 1); checks++;
    await assert.rejects(runner.resume(first.continuation, { authorize: () => true }), /stale/); checks++;
    assert.equal(library.AGENT_PACKAGE_PROTOCOL_VERSION, 2); checks++;
  } finally { runner.close(); agent.destroy(); task.destroy(); library.Connector.remove(name); }
}
console.log(JSON.stringify({ protocol: 'consumer-c3-public-v1', combinations: 16, checks, passed: true }));
