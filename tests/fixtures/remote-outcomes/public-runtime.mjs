import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url), path = require.resolve('@everworker/oneringai'), esm = await import('@everworker/oneringai');
const copies = [esm, require(path), await import(new URL('../../../dist/index.js?remote-copy', import.meta.url))]; let checks = 0, sequence = 0;
for (const root of copies) for (const wire of copies) {
  const name = `remote-public-${sequence++}`, provider = { name: 'offline', capabilities: { text: true }, getModelCapabilities: () => ({ supportsTools: true, supportsJSON: true, supportsJSONSchema: true, maxTokens: 8000, maxOutputTokens: 128 }) };
  root.Connector.create({ name, vendor: root.Vendor.OpenAI, auth: { type: 'none' }, options: { provider } }); let actions = 0;
  const source = root.Agent.create({ connector: name, model: 'offline', tools: [wire.createOutcomeTool({ definition: { type: 'function', function: { name: 'source' } }, output: { effect: 'read' }, execute: async () => { actions++; return { success: false, domain: 'data' }; } })], context: { model: 'offline', features: { workingMemory: false, inContextMemory: false } } });
  const sourceStorage = new root.InMemoryEvidenceStorage({ scope: { ownerId: 'source', namespace: name } }), localStorage = new root.InMemoryEvidenceStorage({ scope: { ownerId: 'client', namespace: name } });
  const server = new wire.AgentPackageOutcomeServer(source, root.exportAgentPackage(source), { storage: sourceStorage, authorize: () => true, maxInlineBytes: 0 });
  const transport = Object.fromEntries(['negotiate', 'execute', 'getReceipt', 'cancel', 'readEvidence'].map(method => [method, request => server[method](request, {})]));
  let client;
  try {
    const toolkit = await wire.createAgentPackageOutcomeTools(server.package(), { transport, storage: localStorage });
    client = root.Agent.create({ connector: name, model: 'offline', tools: toolkit.tools, context: { model: 'offline', features: { workingMemory: false, inContextMemory: false, evidence: true }, plugins: { evidence: { storage: localStorage } } } });
    const result = await client.tools.executeWithOutcome('source', {}, { callId: 'call' }); assert.deepEqual(result.result, { success: false, domain: 'data' }); checks++;
    assert.equal(result.outcome.status, 'succeeded'); checks++; assert.equal(client.tools, client.context.tools); checks++;
    const report = toolkit.session.inspect()[0]; assert.equal(report.pendingSource, false); checks++; assert.notEqual(report.proxyOutcome.executionId, report.receipt.serverOutcome.executionId); checks++;
    assert.equal((await localStorage.readRecord(report.reference)).result.kind, 'oneringai.remote-observation/1'); checks++; assert.equal(actions, 1); checks++;
    assert.equal(toolkit.session.checkpoint(client).protocol, 'oneringai.tool-outcomes/1'); checks++; assert.equal(root.AGENT_PACKAGE_PROTOCOL_VERSION, 2); checks++;
    assert.equal(root.acquireComposition, undefined); checks++;
  } finally { client?.destroy(); await server.close(); source.destroy(); root.Connector.remove(name); }
}
console.log(JSON.stringify({ protocol: 'consumer-c7-public-v1', combinations: 9, checks, passed: true }));
