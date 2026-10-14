/** Offline: close a stream after one local action, checkpoint, repair and restore without replay. */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Agent, AgentContextNextGen, Connector, ContentType, FileContextStorage, InMemoryEvidenceStorage, MessageRole, StreamEventType, ToolCallState, ToolEvidenceMiddleware, Vendor } from '@everworker/oneringai';
import type { IEvidenceStorage, ITextProvider, ToolExecutionOutcome, ToolFunction } from '@everworker/oneringai';

const directory = await mkdtemp(join(tmpdir(), 'oneringai-stream-recovery-'));
const scope = { ownerId: 'example-user', namespace: 'stream-recovery' };
const memory = new InMemoryEvidenceStorage({ scope }); let available = false, executions = 0, modelCalls = 0;
const storage: IEvidenceStorage = { scope, durability: memory.durability,
  put: record => available ? memory.put(record) : Promise.reject(new Error('Synthetic storage outage')),
  read: memory.read.bind(memory), readRecord: memory.readRecord.bind(memory), list: memory.list.bind(memory), delete: memory.delete.bind(memory), pruneExpired: memory.pruneExpired.bind(memory) };
const sessions = new FileContextStorage({ agentId: 'stream-recovery', baseDirectory: directory });
const raw = { operationId: 'LOCAL_STREAM_WRITE_1', status: 'accepted', detail: 'exact source '.repeat(1000) };
const write: ToolFunction = { definition: { type: 'function', function: { name: 'local_write', parameters: { type: 'object', properties: {} } } }, execute: async () => { executions++; return raw; }, output: { effect: 'write' } };
const provider: ITextProvider = { name: 'offline', capabilities: { text: true, images: false, audio: false, videos: false }, validateConfig: async () => true, listModels: async () => [], getModelCapabilities: () => ({ supportsTools: true, supportsVision: false, supportsJSON: true, supportsJSONSchema: true, maxTokens: 128000, maxOutputTokens: 1024 }),
  generate: async () => { throw new Error('This example closes streaming before another model request.'); },
  async *streamGenerate() { modelCalls++; yield { type: StreamEventType.TOOL_CALL_START, response_id: 'r', item_id: 'tool', tool_call_id: 'write-call', tool_name: 'local_write' }; yield { type: StreamEventType.TOOL_CALL_ARGUMENTS_DONE, response_id: 'r', tool_call_id: 'write-call', tool_name: 'local_write', arguments: '{}' }; yield { type: StreamEventType.RESPONSE_COMPLETE, response_id: 'r', status: 'completed', usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 }, iterations: 1 }; } };
Connector.create({ name: 'offline-stream-recovery', vendor: Vendor.OpenAI, auth: { type: 'none' }, options: { provider } });
const agent = Agent.create({ connector: 'offline-stream-recovery', model: 'gpt-4o-mini', userId: scope.ownerId, tools: [write], context: { model: 'gpt-4o-mini', storage: sessions, features: { workingMemory: false, inContextMemory: false, evidence: true }, plugins: { evidence: { storage } } } });
let outcome: ToolExecutionOutcome | undefined;
try {
  for await (const event of agent.stream('Perform the local action once.')) {
    if (event.type === StreamEventType.TOOL_EXECUTION_DONE) { assert.equal(event.result, raw); outcome = event.outcome; break; }
  }
  assert.ok(outcome); assert.equal(outcome.evidence?.status, 'storage_failed');
  await agent.saveSession('interrupted'); assert.ok(JSON.stringify((await sessions.load('interrupted'))?.state).includes(raw.detail));
  console.log('Closing at tool completion retained the exact observation in the session checkpoint.');
  available = true; const middleware = new ToolEvidenceMiddleware({ storage });
  const receipt = await middleware.record(write, {}, { userId: scope.ownerId }, outcome);
  const receiptContext = AgentContextNextGen.create({ model: 'gpt-4o-mini', userId: scope.ownerId, features: { workingMemory: false, inContextMemory: false, evidence: true }, plugins: { evidence: { storage } } });
  try {
    receiptContext.addUserMessage('Already completed.'); receiptContext.addAssistantResponse([{ type: 'message', role: MessageRole.ASSISTANT, content: [{ type: ContentType.TOOL_USE, id: 'write-call', name: 'local_write', arguments: '{}' }] }]);
    receiptContext.addToolResults([{ tool_use_id: 'write-call', content: raw, outcome, evidence: receipt, state: ToolCallState.COMPLETED }]); receiptContext.addAssistantResponse([]);
    await assert.rejects(receiptContext.rollover({ preserveRecentTurns: 0, summarize: async () => 'lossy' }), /unacknowledged/);
  } finally { receiptContext.destroy(); }
  console.log('A stored receipt without a result cannot authorize discarding the raw source.');
  const recovered = await middleware.record(write, {}, { userId: scope.ownerId }, outcome, { value: raw }); assert.ok(recovered.reference);
  await agent.context.acknowledgeToolEvidence('write-call', recovered.reference);
  await agent.loadSession('interrupted'); // Older failed receipt replaces its matching now-acknowledged pending invocation.
  assert.ok(JSON.stringify((await agent.context.prepare()).input).includes(raw.detail));
  assert.equal(await agent.context.acknowledgeToolEvidence('write-call', recovered.reference), 1);
  await agent.context.rollover({ preserveRecentTurns: 0, summarize: async () => 'Action accepted; exact source stored.' });
  assert.deepEqual((await memory.readRecord(recovered.reference))?.result, raw);
  assert.equal(executions, 1); assert.equal(modelCalls, 1);
  console.log('Checkpoint restored after acknowledgement without duplicate results; action and synthetic model each ran once.');
  console.log('Evidence is process-local in this demo; choose a stable file/custom evidence backend for restart recovery.');
} finally { agent.destroy(); Connector.remove('offline-stream-recovery'); await rm(directory, { recursive: true, force: true }); }
