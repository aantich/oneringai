import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';

// Planning diagnostics over CURRENT public APIs, not proposed implementations.
// The tool below is only a stand-in to characterize registration, not an enhanced
// factory implementation. No secrets, live services, or external writes.
const require = createRequire(new URL('../../package.json', import.meta.url));
const lib = require('@everworker/oneringai');
lib.ToolCatalogRegistry.setConnectorToolsModule({ ConnectorTools: lib.ConnectorTools });
const resources = [];
const observations = [];
const originalFetch = globalThis.fetch;
let forbiddenNetworkCalls = 0;
globalThis.fetch = async () => { forbiddenNetworkCalls++; throw new Error('Network forbidden'); };
const service = 'simplicity-review-service';
const llm = 'simplicity-review-llm';
const received = [];
const provider = {
  name: 'offline-fixture', capabilities: { text: true, images: false, audio: false, videos: false },
  getModelCapabilities: () => ({ supportsTools: true, supportsVision: false, supportsJSON: true,
    supportsJSONSchema: true, maxTokens: 16000, maxInputTokens: 16000, maxOutputTokens: 128 }),
  generate: async options => {
    received.push(options);
    return { id: 'r', object: 'response', created_at: 1, model: options.model, status: 'completed',
      output_text: 'Synthetic', output: [{ type: 'message', role: 'assistant',
        content: [{ type: 'output_text', text: 'Synthetic' }] }],
      usage: { input_tokens: 10, output_tokens: 1, total_tokens: 11 } };
  },
  validateConfig: async () => true, listModels: async () => [],
};
lib.Connector.create({ name: llm, vendor: lib.Vendor.OpenAI, auth: { type: 'none' }, options: { provider } });
lib.Connector.create({ name: service, serviceType: 'offline-review-service',
  baseURL: 'https://example.invalid', auth: { type: 'none' } });
const standIn = {
  definition: { type: 'function', function: { name: 'review_read_exec',
    parameters: { type: 'object', properties: {} } } }, execute: async () => ({ synthetic: true }),
};
function agent(config = {}) {
  const value = lib.Agent.create({ connector: llm, model: 'fixture',
    context: { model: 'fixture', features: { workingMemory: false, inContextMemory: false } }, ...config });
  resources.push(value); return value;
}
function names(value) { return value.getToolDefinitions().map(tool => tool.function.name); }
async function observe(id, run) {
  try { observations.push({ id, matched: true, ...await run() }); }
  catch (error) { observations.push({ id, matched: false, error: String(error) }); process.exitCode = 1; }
}
try {
  await observe('S01', async () => {
    const value = agent(); const signal = new AbortController().signal;
    await value.runDirect('Synthetic', { signal });
    assert.ok(received.at(-1).signal instanceof AbortSignal);
    return { kind: 'reuse-control', directCallAlreadyReceivesSignal: true };
  });
  await observe('S02', async () => {
    const value = agent({ identities: [{ connector: service }], tools: [standIn] });
    const enabled = names(value);
    assert.ok(enabled.includes('review_read_exec'));
    assert.ok(enabled.some(name => name.endsWith('_api')));
    assert.equal(value.tools.getRegistration('review_read_exec').source?.startsWith('connector:'), undefined);
    return { kind: 'registration-gap', enabled,
      meaning: 'Ordinary tool registration coexists with identity-generated legacy API tools and lacks connector source tagging.' };
  });
  await observe('S03', async () => {
    const value = agent({ identities: [{ connector: service, accountId: 'work', toolFilter: ['review_read_exec'] }] });
    value.tools.registerConnectorTools(service, [standIn], { accountId: 'work' });
    assert.deepEqual(names(value), ['review_read_exec']);
    assert.equal(value.tools.getRegistration('review_read_exec').source, `connector:${service}:work`);
    return { kind: 'static-recipe-control', enabled: names(value), source: `connector:${service}:work` };
  });
  await observe('S04', async () => {
    const value = agent({ identities: [{ connector: service, toolFilter: ['review_read_exec'] }],
      context: { model: 'fixture', features: { workingMemory: false, inContextMemory: false, toolCatalog: true } } });
    value.tools.registerConnectorTools(service, [standIn]);
    assert.ok(!names(value).some(name => name.endsWith('_api')));
    const catalog = value.context.getPlugin('tool_catalog');
    const load = catalog.getTools().find(tool => tool.definition.function.name === 'tool_catalog_load');
    const result = await load.execute({ category: `connector:${service}` });
    assert.equal(result.error, undefined);
    assert.ok(names(value).some(name => name.endsWith('_api')));
    return { kind: 'catalog-gap', legacyAliasLoadedDespiteIdentityToolFilter: true,
      meaning: 'Static tool filtering is not a profile-aware catalog contract.' };
  });
  await observe('S05', async () => {
    const value = agent({ userId: 'top-level-owner', context: { model: 'fixture', userId: 'context-owner',
      features: { workingMemory: false, inContextMemory: false } } });
    assert.equal(value.userId, 'context-owner');
    assert.equal(value.tools.getToolContext().userId, 'context-owner');
    return { kind: 'configuration-precedence-control', effectiveUserId: value.userId,
      meaning: 'Legacy context identity overrides top-level identity; new C6 must reject conflicting copies explicitly.' };
  });
} finally {
  for (const value of resources.reverse()) value.destroy();
  lib.Connector.clear(); globalThis.fetch = originalFetch;
}
assert.equal(forbiddenNetworkCalls, 0);
await writeFile(process.env.CONSUMER_SIMPLICITY_REPORT_PATH ?? '/tmp/oneringai-final-simplicity-probes.json',
  JSON.stringify({ protocol: 'consumer-final-simplicity-characterization-v1',
    recordedAt: new Date().toISOString(), forbiddenNetworkCalls, realProviderCalls: 0, observations }, null, 2) + '\n');
console.log(JSON.stringify({ matched: observations.filter(x => x.matched).length,
  total: observations.length, errors: observations.filter(x => !x.matched) }));
