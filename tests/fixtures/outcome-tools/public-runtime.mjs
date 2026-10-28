import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const esm = await import('@everworker/oneringai');
const cjsPath = require.resolve('@everworker/oneringai');
const cjs = require(cjsPath);
const duplicateESM = await import(new URL('../../../dist/index.js?outcome-tools-duplicate', import.meta.url));
delete require.cache[cjsPath];
const duplicateCJS = require(cjsPath);
const libraries = [['esm', esm], ['cjs', cjs], ['duplicate-esm', duplicateESM], ['duplicate-cjs', duplicateCJS]];
const results = [];
for (const [format, helper] of libraries) for (const [managerFormat, runtime] of libraries) {
  let checks = 0; const manager = new runtime.ToolManager();
  const raw = Object.freeze({ success: false, id: 'RAW' }); let stale;
  const definition = { type: 'function', function: { name: 'probe', parameters: { type: 'object', properties: {} } } };
  manager.register(helper.createOutcomeTool({ definition, execute: async (args, invocation) => {
    stale = invocation.reportFailure;
    if (args.report) invocation.reportFailure(new Error('operational'));
    return raw;
  } }));
  try {
    const failure = await manager.executeWithOutcome('probe', { report: true });
    assert.equal(failure.result, raw); checks++;
    assert.equal(failure.outcome.status, 'failed'); checks++;
    assert.equal(failure.outcome.error, 'operational'); checks++;
    stale(new Error('stale'));
    const decline = await manager.executeWithOutcome('probe', { report: false });
    assert.equal(decline.outcome.status, 'succeeded'); checks++;
    assert.equal(decline.result, raw); checks++;
    assert.deepEqual(Object.keys(failure.outcome), Object.keys(decline.outcome)); checks++;
    assert.deepEqual(raw, { success: false, id: 'RAW' }); checks++;
    assert.equal(runtime.AGENT_PACKAGE_PROTOCOL_VERSION, 2); checks++;
    assert.equal('attachOutcomeCapture' in helper || 'captureOutcomeExecutor' in helper, false); checks++;
    const direct = helper.createOutcomeTool({ definition, execute: async (_args, invocation) => {
      invocation.reportFailure(new Error('direct')); return raw;
    } });
    assert.equal(await direct.execute({}), raw); checks++;
  } finally { manager.destroy(); }
  results.push({ helper: format, manager: managerFormat, checks });
}
for (let i = 0; i < libraries.length; i++) {
  const [format, helper] = libraries[i]; const [wrapperFormat, wrapper] = libraries[(i + 1) % libraries.length];
  const [, runtime] = libraries[(i + 2) % libraries.length];
  const connector = `outcome-${i}`, service = `outcome-fixture-${i}`;
  wrapper.Connector.create({ name: connector, serviceType: service, auth: { type: 'none' } });
  wrapper.ConnectorTools.registerService(service, () => [helper.createOutcomeTool({
    definition: { type: 'function', function: { name: 'lookup' } }, execute: async (_args, invocation) => {
      invocation.reportFailure(new Error('bound operational')); return { account: invocation.context?.accountId };
    },
  })]);
  const manager = new runtime.ToolManager();
  try {
    const tools = wrapper.ConnectorTools.for(connector, undefined, { accountId: 'work' });
    manager.registerConnectorTools(connector, tools, { accountId: 'work' });
    const report = await manager.executeWithOutcome(`${connector}_work_lookup`, {});
    assert.equal(report.outcome.status, 'failed'); assert.equal(report.outcome.error, 'bound operational');
    assert.deepEqual(report.result, { account: 'work' });
    results.push({ helper: format, wrapper: wrapperFormat, checks: 3 });
  } finally { manager.destroy(); wrapper.ConnectorTools.unregisterService(service); wrapper.Connector.remove(connector); }
}
for (const [format, runtime] of libraries.slice(0, 2)) {
  const connector = `outcome-legacy-remote-${format}`;
  const provider = { name: 'offline', capabilities: { text: true, images: false, audio: false, videos: false },
    getModelCapabilities: () => ({ supportsTools: true, supportsVision: false, supportsJSON: true,
      supportsJSONSchema: true, maxTokens: 16000, maxInputTokens: 16000, maxOutputTokens: 128 }),
    generate: async () => { throw new Error('No model calls allowed'); }, validateConfig: async () => true, listModels: async () => [] };
  runtime.Connector.create({ name: connector, vendor: runtime.Vendor.OpenAI, auth: { type: 'none' }, options: { provider } });
  const agent = runtime.Agent.create({ connector, model: 'offline',
    tools: [runtime.createOutcomeTool({ definition: { type: 'function', function: { name: 'remote_probe' } },
      permission: { scope: 'always' }, execute: async (_args, invocation) => {
        invocation.reportFailure(new Error('Local provenance stays local on v2')); return { id: 'raw' };
      } })], context: { model: 'offline', features: { workingMemory: false, inContextMemory: false } } });
  const pkg = runtime.exportAgentPackage(agent, { packageId: `legacy-${format}`, toolPlacement: () => 'remote' });
  const server = new runtime.AgentPackageToolServer(agent, pkg);
  try {
    const response = await server.execute({ protocolVersion: 2, packageId: pkg.packageId,
      requestId: 'legacy-call', toolName: 'remote_probe', arguments: {} });
    assert.equal(response.protocolVersion, 2); assert.equal(response.ok, false);
    assert.equal(Object.hasOwn(response, 'outcome'), false); assert.equal(response.error.code, 'tool_failed');
    results.push({ format, legacyRemoteBoundary: true, checks: 4 });
  } finally { await server.close(); agent.destroy(); runtime.Connector.remove(connector); }
}
console.log(JSON.stringify({ protocol: 'c1-public-outcomes-v1', checks: results.reduce((n, result) => n + result.checks, 0), results }));
