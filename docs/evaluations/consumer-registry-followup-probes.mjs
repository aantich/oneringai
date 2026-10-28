import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';

// Investigation only: characterizes current gaps/controls, not proposed APIs.
// Uses the built public package and source provider internals deliberately.
// No .env reads. All provider transport is replaced; network is forbidden.
const require = createRequire(new URL('../../package.json', import.meta.url));
const shared = require('@everworker/oneringai/shared');
const { STT_MODEL_REGISTRY } = await import('../../src/domain/entities/STTModel.ts');
const { OpenAITextProvider } = await import('../../src/infrastructure/providers/openai/OpenAITextProvider.ts');
const observations = [];
const originalFetch = globalThis.fetch;
let forbiddenNetworkCalls = 0;
globalThis.fetch = async () => {
  forbiddenNetworkCalls++;
  throw new Error('Network forbidden in registry planning fixture');
};
async function observe(id, run) {
  try { observations.push({ id, matched: true, ...await run() }); }
  catch (error) { observations.push({ id, matched: false, error: String(error) }); process.exitCode = 1; }
}
const requests = [];
const provider = new OpenAITextProvider({ apiKey: 'non-secret-offline-fixture', maxRetries: 0 });
provider.client = {
  responses: {
    create: async params => {
      requests.push({ endpoint: 'generate', params });
      return { id: 'fixture', object: 'response', created_at: 1, model: params.model,
        status: 'completed', output: [{ type: 'message', id: 'm', role: 'assistant',
          status: 'completed', content: [{ type: 'output_text', text: 'Synthetic', annotations: [] }] }],
        usage: { input_tokens: 10, output_tokens: 1, total_tokens: 11 } };
    },
    inputTokens: { count: async params => {
      requests.push({ endpoint: 'count', params });
      return { input_tokens: 10 };
    } },
  },
};
try {
  await observe('F01', async () => {
    const models = ['gpt-realtime-2.1', 'gpt-realtime-2.1-mini', 'gpt-realtime-2'];
    for (const model of models) {
      const record = shared.getModelInfo(model);
      assert.equal(record.features.reasoning, true);
      assert.equal(record.features.reasoningEfforts, undefined);
    }
    return { kind: 'missing-capability-metadata', models };
  });
  await observe('F02', async () => {
    assert.equal(shared.Vendor.Custom, 'custom');
    assert.equal(shared.isVendor('custom'), true);
    assert.equal(shared.VENDOR_PRESENTATION, undefined);
    assert.equal(shared.getVendorPresentation, undefined);
    return { kind: 'identity-control', customStillVendorId: true,
      meaning: 'Known proposed presentation names are absent; source review confirms no branding catalog.' };
  });
  await observe('F03', async () => {
    const record = STT_MODEL_REGISTRY['gpt-live-transcribe'];
    assert.equal(record.capabilities.features.streaming, true);
    assert.equal(record.capabilities.realtimeInputTranscription, undefined);
    return { kind: 'generic-streaming-control', model: 'gpt-live-transcribe', streaming: true,
      meaning: 'Generic flag alone supplies no conversation-model/transport compatibility contract.' };
  });
  await observe('F04', async () => {
    const before = requests.length;
    await assert.rejects(provider.generate({ model: 'gpt-6-astra', input: 'Synthetic',
      temperature: 0.2, thinking: { enabled: true, effort: 'high' } }), /does not support temperature/);
    assert.equal(requests.length, before);
    return { kind: 'intentional-strict-control', rejectedBeforeSDKDispatch: true };
  });
  await observe('F05', async () => {
    await provider.generate({ model: 'gpt-6-sol', input: 'Synthetic',
      temperature: 0, thinking: { enabled: true, effort: 'none' } });
    const wire = requests.at(-1).params;
    assert.equal(wire.temperature, 0);
    assert.equal(wire.reasoning.effort, 'none');
    return { kind: 'conditional-sampling-control', model: wire.model, temperature: 0, effort: 'none' };
  });
  await observe('F06', async () => {
    const options = { model: 'gpt-6-astra', input: 'Synthetic', temperature: 0.2,
      thinking: { enabled: true, effort: 'high' } };
    const count = await provider.compaction.countInput(options);
    assert.equal(count, 10);
    const wire = requests.at(-1);
    assert.equal(wire.endpoint, 'count');
    assert.equal(wire.params.temperature, undefined);
    assert.equal(wire.params.reasoning.effort, 'high');
    const before = requests.length;
    await assert.rejects(provider.generate(options), /does not support temperature/);
    assert.equal(requests.length, before);
    assert.equal(options.temperature, 0.2);
    return { kind: 'count-versus-dispatch-gap', mockedInputCount: count,
      sameGenerationRequestRejected: true, originalOptionsUnchanged: true };
  });
  await observe('F07', async () => {
    const before = requests.length;
    await assert.rejects(provider.generate({ model: 'gpt-6-astra', input: 'Synthetic',
      thinking: { enabled: true, effort: 'high' }, vendorOptions: { temperature: 0.2 } }), /does not support temperature/);
    assert.equal(requests.length, before);
    return { kind: 'explicit-provider-control', rawVendorTemperatureRemainsRejected: true };
  });
} finally { globalThis.fetch = originalFetch; }
assert.equal(forbiddenNetworkCalls, 0);
const report = { protocol: 'consumer-registry-followup-characterization-v1',
  recordedAt: new Date().toISOString(), realProviderCalls: 0, forbiddenNetworkCalls,
  mockedProviderRequests: requests, observations };
await writeFile(process.env.CONSUMER_REGISTRY_REVIEW_REPORT_PATH ?? '/tmp/oneringai-registry-followup-probes.json',
  JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ matched: observations.filter(x => x.matched).length,
  total: observations.length, forbiddenNetworkCalls, errors: observations.filter(x => !x.matched) }));
