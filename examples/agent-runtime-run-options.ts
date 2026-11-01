/** Actual OneRingAI Agent loop: per-run options, JSON output, request replay, cancellation and recovery. */
import { Connector, StreamEventType } from 'oneringai';
import { AgentRuntime, LocalExecutionBackend, OneRingAIDriver, FileRuntimeSessionStorage } from 'oneringai/agent-runtime';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { offlineRoutingConnector } from './model-routing/fixture.js';

const root = await mkdtemp(path.join(tmpdir(), 'runtime-options-'));
const fixture = offlineRoutingConnector('runtime-options');
fixture.provider.streamGenerate = async function* (request) {
  fixture.requests.push(request);
  yield { type: StreamEventType.OUTPUT_TEXT_DELTA, response_id: 'offline', item_id: 'text', output_index: 0, content_index: 0, delta: '{"answer":"ACK"}', sequence_number: 1 };
  yield { type: StreamEventType.RESPONSE_COMPLETE, response_id: 'offline', status: 'completed', usage: { input_tokens: 2, output_tokens: 2, total_tokens: 4 }, iterations: 1 };
};
const runtime = new AgentRuntime({ backend: new LocalExecutionBackend({ drivers: [new OneRingAIDriver({ trustAgentPolicy: true, configurationRevision: 'options-example-v1', configureAgent: config => ({ ...config, context: { model: config.model, features: { workingMemory: false, inContextMemory: false } } }) })], sessionStorage: new FileRuntimeSessionStorage(path.join(root, 'control')) }) });
const context = { userId: 'example-owner' };
try {
  const agent = runtime.createAgent({ id: 'options-assistant', instructions: 'Return the requested JSON answer.' });
  const options = { execution: { driver: 'oneringai.agent', connector: 'runtime-options', model: 'gpt-6.1-sol' }, context, environment: { type: 'none' as const }, policy: { filesystem: 'denied' as const, commands: 'denied' as const, sandboxNetwork: 'denied' as const, providerWebSearch: 'denied' as const, approvals: 'deny' as const } };
  const session = await agent.openSession(options);
  const format = { type: 'json_schema' as const, name: 'answer', strict: true, schema: { type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'], additionalProperties: false } };
  const input = { parts: [{ type: 'text' as const, text: 'Return ACK.' }] };
  const pending = session.run(input, { requestId: 'original', model: 'gpt-6-astra', reasoning: { effort: 'low' }, responseFormat: format, metadata: { purpose: 'offline-example' } });
  input.parts[0]!.text = 'This caller mutation must never be dispatched';
  const run = await pending; const result = await run.result;
  if (JSON.stringify(fixture.requests).includes('caller mutation must never')) throw new Error('Caller mutation reached the provider');
  const parsed = result.outputParsed;
  if (result.status !== 'completed' || !parsed || typeof parsed !== 'object' || Array.isArray(parsed) || parsed.answer !== 'ACK' || result.configuration?.model !== 'gpt-6-astra') throw new Error(JSON.stringify(result));
  const calls = fixture.requests.length;
  await (await session.run('Return ACK in a new turn.', { requestId: 'next', responseFormat: format })).result;
  if (fixture.requests.length !== calls + 1) throw new Error('Continuation dispatch count differs');
  const aborted = new AbortController(); aborted.abort(new Error('Host cancelled before dispatch'));
  let cancellationObserved = false; try { await session.run('Do not dispatch', { signal: aborted.signal }); } catch { cancellationObserved = true; }
  if (!cancellationObserved || fixture.requests.length !== calls + 1) throw new Error('Cancelled input was dispatched');
  const reference = session.reference(); await session.detach();
  const restored = await runtime.resumeSession(reference, { context });
  const replayed = await restored.run({ parts: [{ type: 'text', text: 'Return ACK.' }] }, { requestId: 'original', model: 'gpt-6-astra', reasoning: { effort: 'low' }, responseFormat: format, metadata: { purpose: 'offline-example' } });
  if ((await replayed.result).runId !== run.id || fixture.requests.length !== calls + 1) throw new Error('Restored request was repeated');
  console.log(JSON.stringify({ mocked: true, parsed: result.outputParsed, selectedModel: result.configuration.model, cancellationObserved, providerCalls: fixture.requests.length, restoredOriginalRun: true }));
  await runtime.deleteSession(reference, { context });
} finally { await runtime.destroy(); Connector.remove('runtime-options'); await rm(root, { recursive: true, force: true }); }
