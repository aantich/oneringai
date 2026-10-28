// Private C2 cross-bundle acceptance; C3 publishes the facade, not this bridge.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const require = createRequire(import.meta.url);
const entry = pathToFileURL(resolve('dist/index.js')).href;
const cjs = resolve('dist/index.cjs');
const copies = [await import(entry), require(cjs), await import(entry + '?composition-copy')];
delete require.cache[require.resolve(cjs)]; copies.push(require(cjs));
const bridge = pathToFileURL(resolve('src/core/execution/composition.ts')).href;
const bindings = [await import(bridge), await import(bridge + '?composition-copy')];
let checks = 0, serial = 0;
for (const binding of bindings) for (const library of copies) {
  const name = `composition-package-${serial++}`;
  const provider = {
    name: 'composition-package', capabilities: { text: true, images: false, videos: false, audio: false },
    async generate(options) { return { id: 'one', object: 'response', created_at: 1, model: options.model, status: 'completed', output_text: 'READY',
      output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'READY' }] }], usage: { input_tokens: 5, output_tokens: 1, total_tokens: 6 } }; },
    async *streamGenerate(options) { yield { type: library.StreamEventType.RESPONSE_COMPLETE, response_id: 'one', status: 'completed', iterations: 1 }; },
    getModelCapabilities() { return { supportsTools: true, supportsVision: false, supportsJSON: true, supportsJSONSchema: true, maxTokens: 16000, maxInputTokens: 16000, maxOutputTokens: 128 }; },
    async validateConfig() { return true; }, async listModels() { return []; },
  };
  library.Connector.create({ name, vendor: library.Vendor.OpenAI, auth: { type: 'none' }, options: { provider } });
  const task = new library.ModelTask({ limits: { maxCalls: 2 } });
  const agent = library.Agent.create({ connector: name, model: 'composition-package',
    context: { model: 'composition-package', features: { workingMemory: false, inContextMemory: false } },
    modelExecution: { customProviderAttempts: 'single' },
  });
  const owner = binding.acquireComposition(agent, { modelTask: task });
  try {
    await assert.rejects(agent.runDirect('foreign'), /owned/); checks++;
    await assert.rejects(agent.run('foreign'), /owned/); checks++;
    assert.equal((await owner.run('task')).output_text, 'READY'); checks++;
    assert.equal((await owner.direct('reflect')).output_text, 'READY'); checks++;
    assert.equal(task.snapshot().totals.calls, 2); checks++;
    assert.equal(binding.hasCompositionOwner(agent), true); checks++;
    owner.release(); assert.equal(binding.hasCompositionOwner(agent), false); checks++;
    assert.equal(task.signal.aborted, false); checks++;
  } finally { owner.close(); agent.destroy(); task.destroy(); library.Connector.remove(name); }
}
for (const library of copies) { assert.equal(library.acquireComposition, undefined); checks++; }
console.log(JSON.stringify({ protocol: 'c2-private-cross-bundle-v1', checks, combinations: bindings.length * copies.length, passed: true }));
