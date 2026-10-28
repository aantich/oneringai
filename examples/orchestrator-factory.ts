/** Offline C6: actual root/worker requests, distinct authority and a shared operation ledger. */
import assert from 'node:assert/strict';
import { AgentRegistry, Connector, ContentType, MessageRole, ModelTask, Vendor, createOrchestratorWithFactory } from '@everworker/oneringai';
import type { TextGenerateOptions, ITextProvider, ChildObservation } from '@everworker/oneringai';
const requests: TextGenerateOptions[] = [], observations: ChildObservation[] = [];
const provider: ITextProvider = { name: 'offline-factory', capabilities: { text: true, images: false, videos: false, audio: false },
  generate: async request => { requests.push(request); const text = request.model === 'root' ? 'continue' : 'LOCAL_CHILD_RESULT';
    return { id: `response-${requests.length}`, object: 'response', created_at: 1, model: request.model, status: 'completed', output_text: text,
      output: [{ type: 'message', role: MessageRole.ASSISTANT, content: [{ type: ContentType.OUTPUT_TEXT, text }] }], usage: { input_tokens: 12, output_tokens: 3, total_tokens: 15 } }; },
  streamGenerate: async function* () { throw new Error('This offline example uses run'); }, validateConfig: async () => true, listModels: async () => [],
  getModelCapabilities: () => ({ supportsTools: true, supportsVision: false, supportsJSON: true, supportsJSONSchema: true, maxTokens: 8000, maxOutputTokens: 128 }) };
Connector.create({ name: 'factory-example', vendor: Vendor.OpenAI, auth: { type: 'none' }, options: { provider } });
const task = new ModelTask({ limits: { maxCalls: 2 } });
const parent = await createOrchestratorWithFactory({ connector: 'factory-example', model: 'root', agentTypes: { specialist: { model: 'worker', systemPrompt: 'Work on authorized local data.' } } }, {
  configureAgent: ({ role, baseline }) => ({ ...baseline, instructions: role === 'parent' ? 'Monitor; return continue.' : 'Return LOCAL_CHILD_RESULT.',
    temperature: role === 'parent' ? 0.1 : 0, userId: role === 'parent' ? 'host' : 'approved-worker', identities: [], permissions: { autoApproveAll: true },
    modelExecution: { customProviderAttempts: 'single', maxOutputTokensPerCall: 64 }, asyncTools: { autoContinue: false },
    context: { model: baseline.model, responseReserve: role === 'parent' ? 128 : 64, timeZone: 'Europe/Zurich', features: { workingMemory: false, inContextMemory: false } } }),
  onChildOutcome: observation => { observations.push(observation); },
});
try {
  await parent.run('Check root configuration separately.');
  const admitted = await parent.tools.executeWithOutcome('delegate_interactive', { agent: 'specialist-1', type: 'specialist', monitoring: 'active' }); assert.equal(admitted.outcome.status, 'succeeded');
  const response = await parent.run('Do the local task', { modelTask: task }); await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(response.output_text, 'LOCAL_CHILD_RESULT'); assert.equal(task.snapshot().totals.calls, 2);
  assert.deepEqual(requests.map(request => [request.model, request.temperature]), [['root', 0.1], ['worker', 0], ['root', 0.1]]);
  const worker = AgentRegistry.getChildren(parent.registryId)[0]!; assert.equal(worker.context.getCurrentInput().length, 0);
  assert.equal(observations[0]?.accounting, 'shared'); assert.equal(observations[0]?.modelTaskId, task.id);
  console.log(JSON.stringify({ passed: true, requests: requests.map(request => ({ model: request.model, temperature: request.temperature })), calls: task.snapshot().totals.calls, childReports: observations.length, externalWrites: 0 }));
} finally { parent.destroy(); task.destroy(); Connector.remove('factory-example'); }
