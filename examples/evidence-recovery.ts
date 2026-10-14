/** Offline failed-write recovery. Build first; no credentials, network or action replay. */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentContextNextGen, ContentType, FileContextStorage, InMemoryEvidenceStorage, MessageRole, ToolCallState, ToolEvidenceMiddleware } from '@everworker/oneringai';
import type { IEvidenceStorage, ToolFunction } from '@everworker/oneringai';

const scope = { ownerId: 'example-user', namespace: 'recovery-demo' };
const storage = new InMemoryEvidenceStorage({ scope });
let available = false;
// A legacy-compatible adapter can omit the optional serialization hint and ID lookup.
const backend: IEvidenceStorage = {
  scope, durability: storage.durability,
  put: record => available ? storage.put(record) : Promise.reject(new Error('Synthetic storage outage')),
  read: storage.read.bind(storage), readRecord: storage.readRecord.bind(storage), list: storage.list.bind(storage),
  delete: storage.delete.bind(storage), pruneExpired: storage.pruneExpired.bind(storage),
};
const directory = await mkdtemp(join(tmpdir(), 'oneringai-recovery-'));
const sessions = new FileContextStorage({ agentId: 'recovery-demo', baseDirectory: directory });
const create = () => AgentContextNextGen.create({ model: 'gpt-4o-mini', userId: scope.ownerId, agentId: 'recovery-demo', storage: sessions,
  features: { workingMemory: false, inContextMemory: false, evidence: true },
  plugins: { evidence: { storage: backend, maxSerializationBytes: 32768 } } });
let context = create();
let executions = 0;
const raw = { operationId: 'LOCAL_WRITE_1', status: 'accepted', detail: 'Exact local observation. '.repeat(500) };
const write: ToolFunction = {
  definition: { type: 'function', function: { name: 'local_write', description: 'Simulate one local write', parameters: { type: 'object', properties: {} } } },
  execute: async () => { executions++; return raw; },
  output: { effect: 'write', summarize: value => JSON.stringify({ operationId: (value as typeof raw).operationId, status: (value as typeof raw).status }) },
};
try {
  context.tools.register(write); context.addUserMessage('Perform the local action once.');
  context.addAssistantResponse([{ type: 'message', role: MessageRole.ASSISTANT, content: [{ type: ContentType.TOOL_USE, id: 'write-call', name: 'local_write', arguments: '{}' }] }]);
  const report = await context.tools.executeWithOutcome('local_write', {}, { callId: 'write-call', runId: 'example-run' });
  assert.equal(report.result, raw); assert.equal(report.outcome.status, 'succeeded'); assert.equal(report.evidence?.status, 'storage_failed');
  // outcome stays optional: authentic delivery carries its original recovery correlation internally.
  context.addToolResults([{ tool_use_id: 'write-call', content: raw, evidence: report.evidence, state: ToolCallState.COMPLETED }]);
  // Model/network/fit failures can leave results pending. Saving retains them without committing the active input.
  await context.save('interrupted'); context.destroy(); context = create();
  assert.equal(await context.load('interrupted'), true);
  assert.ok(JSON.stringify(context.getConversation()).includes(raw.detail));
  console.log('Pending delivery-only result survived file session save/load with its original invocation ID.');
  await assert.rejects(context.rollover({ preserveRecentTurns: 0, summarize: async () => 'lossy' }), /unacknowledged/);
  assert.ok(JSON.stringify(context.getConversation()).includes(raw.detail));

  available = true;
  const middleware = new ToolEvidenceMiddleware({ storage: backend, maxSerializationBytes: 32768 });
  const receiptOnly = await middleware.record(write, {}, { userId: scope.ownerId }, report.outcome);
  assert.ok(receiptOnly.reference);
  await assert.rejects(context.acknowledgeToolEvidence('write-call', receiptOnly.reference), /does not match/);
  console.log('Storage outage preserved raw data; a receipt without its result cannot release protection.');

  // Store the retained observation, without invoking the tool again.
  const recovered = await middleware.record(write, {}, { userId: scope.ownerId }, report.outcome, { value: report.result });
  assert.ok(recovered.reference);
  assert.equal(await context.acknowledgeToolEvidence('write-call', recovered.reference), 1);
  assert.equal((await context.rollover({ preserveRecentTurns: 0, summarize: async () => 'Action accepted; exact evidence stored.' })).performed, true);
  assert.deepEqual((await storage.readRecord(recovered.reference))?.result, raw);
  assert.equal(executions, 1);
  console.log('Result recovered and rollover allowed; local action executed exactly once.');
  console.log('This store is process-local. Configure a stable file/custom backend for restart recovery.');
} finally { context.destroy(); await rm(directory, { recursive: true, force: true }); }
