/** Offline: authenticated in-memory transport, exact sources and recovery without action replay. */
import assert from 'node:assert/strict';
import { Agent, Connector, Vendor, InMemoryEvidenceStorage, AgentPackageOutcomeServer, exportAgentPackage, hydrateAgentPackageWithOutcomes } from '@everworker/oneringai';
import type { ITextProvider, RemoteOutcomeTransport } from '@everworker/oneringai';
const provider: ITextProvider = { name: 'offline-remote', capabilities: { text: true, images: false, videos: false, audio: false },
  generate: async () => { throw new Error('This example requires no model call'); }, streamGenerate: async function* () { throw new Error('No model call'); },
  validateConfig: async () => true, listModels: async () => [], getModelCapabilities: () => ({ supportsTools: true, supportsVision: false, supportsJSON: true, supportsJSONSchema: true, maxTokens: 8000, maxOutputTokens: 128 }) };
Connector.create({ name: 'remote-demo', vendor: Vendor.OpenAI, auth: { type: 'none' }, options: { provider } });
let submissions = 0;
const source = Agent.create({ connector: 'remote-demo', model: 'offline', tools: [
  { definition: { type: 'function', function: { name: 'read_local' } }, output: { effect: 'read' }, execute: async () => ({ success: false, source: 'Local business decline is valid data', ids: ['a', 'b', 'c'] }) },
  { definition: { type: 'function', function: { name: 'submit_local' } }, output: { effect: 'write' }, execute: async () => ({ submission: ++submissions }) },
], context: { model: 'offline', features: { workingMemory: false, inContextMemory: false } } });
const sourceStorage = new InMemoryEvidenceStorage({ scope: { ownerId: 'source', namespace: 'demo' } }), localStorage = new InMemoryEvidenceStorage({ scope: { ownerId: 'local', namespace: 'demo' } });
const server = new AgentPackageOutcomeServer(source, exportAgentPackage(source), { storage: sourceStorage, maxInlineBytes: 0, authorize: (_access, host: { authenticated: boolean }) => host.authenticated });
const host = { authenticated: true }; let disconnect = true;
const transport: RemoteOutcomeTransport = { negotiate: r => server.negotiate(r, host), execute: async r => { const result = await server.execute(r, host); if (r.toolName === 'submit_local' && disconnect) { disconnect = false; throw new Error('Synthetic disconnect after commit'); } return result; },
  getReceipt: r => server.getReceipt(r, host), cancel: r => server.cancel(r, host), readEvidence: r => server.readEvidence(r, host) };
const { agent, session } = await hydrateAgentPackageWithOutcomes(server.package(), { connector: 'remote-demo', model: 'offline', transport, permissions: { autoApproveAll: true },
  contextFactory: () => ({ model: 'offline', features: { workingMemory: false, inContextMemory: false, evidence: true }, plugins: { evidence: { storage: localStorage } } }) });
try {
  const read = await agent.tools.executeWithOutcome('read_local', {}); assert.equal(read.outcome.status, 'succeeded'); assert.equal(read.result.success, false);
  const write = await agent.tools.executeWithOutcome('submit_local', {}, { callId: 'original-write' }); assert.equal(write.outcome.status, 'failed');
  await assert.rejects(agent.run('submit again'), /reconciliation/); const pending = session.inspect().find(op => op.toolName === 'submit_local')!;
  const repaired = await session.getReceipt(pending.operationId); assert.equal(repaired.pendingSource, false); assert.equal(submissions, 1);
  assert.equal(repaired.proxyOutcome?.status, 'failed'); assert.equal(repaired.receipt?.serverOutcome?.status, 'succeeded');
  // Receipt polling reauthorizes each lookup and reuses the acknowledged record.
  const before = (await localStorage.list({ limit: 100 })).entries.length;
  const polls = await Promise.all(Array.from({ length: 4 }, () => session.getReceipt(pending.operationId)));
  assert.ok(polls.every(value => value.reference?.id === repaired.reference!.id && !value.pendingSource));
  assert.equal((await localStorage.list({ limit: 100 })).entries.length, before);
  assert.ok(await localStorage.readRecord(repaired.reference!)); assert.equal(session.checkpoint().protocol, 'oneringai.tool-outcomes/1');
  console.log(JSON.stringify({ passed: true, submissions, operations: session.inspect().length, sourceRecovered: true, receiptPolls: polls.length, reusedObservation: true, accounting: repaired.accounting }));
} finally { session.close(); agent.destroy(); await server.close(); source.destroy(); Connector.remove('remote-demo'); }
