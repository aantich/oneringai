import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url), path = require.resolve('@everworker/oneringai'), esm = await import('@everworker/oneringai'), cjs = require(path);
const duplicate = await import(new URL('../../../dist/index.js?factory-copy', import.meta.url)); delete require.cache[path];
const copies = [esm, cjs, duplicate, require(path)]; let checks = 0, sequence = 0;
for (const factory of copies) for (const helper of copies) {
  const connector = `factory-public-${sequence++}`, reports = [];
  const provider = { name: 'factory-public', capabilities: { text: true }, generate: async options => ({ id: 'response', object: 'response', created_at: 1, model: options.model,
    status: 'completed', output_text: 'DATA', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'DATA' }] }], usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 } }),
    getModelCapabilities: () => ({ supportsTools: true, supportsVision: false, supportsJSON: true, supportsJSONSchema: true, maxTokens: 8000, maxOutputTokens: 128 }) };
  factory.Connector.create({ name: connector, vendor: factory.Vendor.OpenAI, auth: { type: 'none' }, options: { provider } });
  const task = new helper.ModelTask({ limits: { maxCalls: 1 } });
  const parent = await factory.createOrchestratorWithFactory({ connector, model: 'main', agentTypes: { specialist: { model: 'worker', systemPrompt: 'Work' } } }, {
    configureAgent: ({ baseline }) => ({ ...baseline, context: { model: baseline.model, responseReserve: 64, features: { workingMemory: false, inContextMemory: false } },
      modelExecution: { customProviderAttempts: 'single' }, asyncTools: { autoContinue: false }, tools: [helper.createOutcomeTool({ definition: { type: 'function', function: { name: 'host_probe' } }, execute: async () => ({ success: false, business: true }) })] }),
    onChildOutcome: report => reports.push(report),
  });
  try {
    assert.equal(parent instanceof factory.Agent, true); checks++; assert.equal(parent.tools, parent.context.tools); checks++;
    const business = await parent.tools.executeWithOutcome('host_probe', {}); assert.equal(business.outcome.status, 'succeeded'); checks++;
    const delegated = await parent.tools.executeWithOutcome('delegate_interactive', { agent: 'child', type: 'specialist' }); assert.equal(delegated.outcome.status, 'succeeded'); checks++;
    const result = await parent.run('work', { modelTask: task }); await new Promise(resolve => setImmediate(resolve));
    assert.equal(result.output_text, 'DATA'); checks++; assert.equal(task.snapshot().totals.calls, 1); checks++;
    assert.equal(reports.length, 1); checks++; assert.equal(reports[0].accounting, 'shared'); checks++; assert.equal(reports[0].modelTaskId, task.id); checks++;
    assert.equal(task.snapshot().invocations[0].parentInvocationId, reports[0].childExecutionId); checks++; assert.equal(task.signal.aborted, false); checks++;
    assert.equal(factory.AGENT_PACKAGE_PROTOCOL_VERSION, 2); checks++;
  } finally { parent.destroy(); task.destroy(); factory.Connector.remove(connector); }
}
for (const library of copies) for (const name of ['FactoryPolicy', 'FactoryExecution', 'acquireComposition', 'markOrchestratorConstruction']) { assert.equal(library[name], undefined); checks++; }
console.log(JSON.stringify({ protocol: 'consumer-c6-public-v1', combinations: 16, checks, passed: true }));
