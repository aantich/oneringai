/** Offline C4: real local HTTP transport, no LLM calls or external writes. Build first. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Agent, Connector, ConnectorTools, ContentType, MessageRole, ToolCallState, FileEvidenceStorage } from '@everworker/oneringai';
import type { EnhancedConnectorAttempt } from '@everworker/oneringai';
import { offlineRoutingConnector } from './model-routing/fixture.js';

const source = 'EXACT_SOURCE_42 ' + 'complete allowed source '.repeat(1500);
let reads = 0, writes = 0;
let foreignRequests = 0;
const foreign = createServer((_request, response) => { foreignRequests++; response.end('{}'); });
await new Promise<void>(resolve => { foreign.listen(0, '127.0.0.1', resolve); });
const foreignAddress = foreign.address(); if (!foreignAddress || typeof foreignAddress === 'string') throw new Error('Missing second local HTTP port');
const server = createServer((request, response) => {
  response.setHeader('Content-Type', 'application/json');
  if (request.url === '/same-origin') { response.writeHead(302, { Location: '/redirect-result' }); response.end(); return; }
  if (request.url === '/redirect-result') { response.end('{"redirected":true}'); return; }
  if (request.url === '/foreign-origin') { response.writeHead(302, { Location: `http://127.0.0.1:${foreignAddress.port}/capture` }); response.end(); return; }
  if (request.method === 'POST') {
    writes++; response.writeHead(503); response.end(JSON.stringify({ message: 'Synthetic write accepted, response unavailable' })); return;
  }
  reads++;
  if (reads === 1) { response.writeHead(503); response.end(JSON.stringify({ message: 'Synthetic safe-read retry' })); return; }
  response.end(JSON.stringify({ type: 'file', path: 'source.txt', size: source.length, sha: 'exact-sha-42', encoding: 'base64', content: Buffer.from(source).toString('base64') }));
});
await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve); });
const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing local HTTP port');
const directory = await mkdtemp(join(tmpdir(), 'oneringai-c4-'));
const scope = { ownerId: 'example-host', namespace: 'connector-profile' };
const storage = new FileEvidenceStorage({ directory, scope });
const llm = offlineRoutingConnector('c4-model');
Connector.create({ name: 'c4-github', serviceType: 'github', baseURL: `http://127.0.0.1:${address.port}`,
  auth: { type: 'api_key', apiKey: 'SYNTHETIC_LOCAL_ONLY', headerName: 'X-API-Key', headerPrefix: '' }, retry: { maxRetries: 1, baseDelayMs: 1, maxDelayMs: 1 } });
const attempts: EnhancedConnectorAttempt[] = [];
const selected = ConnectorTools.enhanced('c4-github', { profile: 'execution-v1', accountId: 'work', onAttempt: value => attempts.push(value) });
assert.ok(selected.length);
const agent = Agent.create({ connector: llm.connector, model: llm.mainModel, userId: scope.ownerId,
  permissions: { autoApproveAll: true }, // This example admits only the synthetic local service.
  identities: [{ connector: 'c4-github', accountId: 'work', toolFilter: selected.map(tool => tool.definition.function.name) }],
  context: { model: llm.mainModel, features: { toolCatalog: false, evidence: true, workingMemory: false, inContextMemory: false }, plugins: { evidence: { storage } } },
});
try {
  agent.tools.registerConnectorTools('c4-github', selected, { accountId: 'work' });
  assert.deepEqual(agent.tools.listEnabled().sort(), [...selected.map(tool => tool.definition.function.name), 'evidence_read', 'evidence_list'].sort());
  const toolName = 'c4-github_work_read_file_exec';
  agent.context.addUserMessage('Read the synthetic source.');
  agent.context.addAssistantResponse([{ type: 'message', role: MessageRole.ASSISTANT, content: [{ type: ContentType.TOOL_USE, id: 'source-1', name: toolName, arguments: '{}' }] }]);
  const read = await agent.tools.executeWithOutcome(toolName, { repository: 'owner/repo', path: 'source.txt' }, { callId: 'source-1' });
  assert.equal(read.outcome.status, 'succeeded'); assert.ok(read.evidence?.reference); assert.ok(read.evidence.projection); assert.equal(read.result.content, '1\t' + source);
  agent.context.addToolResults([{ tool_use_id: 'source-1', content: read.result, evidence: read.evidence, state: ToolCallState.COMPLETED }]);
  agent.context.addAssistantResponse([{ type: 'message', role: MessageRole.ASSISTANT, content: [{ type: ContentType.OUTPUT_TEXT, text: 'Source acknowledged.' }] }]);
  await agent.context.rollover({ preserveRecentTurns: 0, summarize: async () => 'Use the source reference for exact content.' });
  assert.deepEqual((await storage.readRecord(read.evidence.reference))?.result, read.result);
  const write = await agent.tools.executeWithOutcome('c4-github_work_create_pr_exec', { repository: 'owner/repo', title: 'Synthetic', head: 'feature', base: 'main' });
  assert.equal(write.outcome.status, 'failed'); assert.equal(writes, 1); assert.equal(reads, 2); assert.equal(llm.requests.length, 0);
  assert.equal(attempts.filter(value => value.state === 'dispatched').length, 3);
  const generic = 'c4-github_work_api_exec';
  assert.equal((await agent.tools.executeWithOutcome(generic, { method: 'GET', endpoint: '/same-origin' })).outcome.status, 'succeeded');
  assert.equal((await agent.tools.executeWithOutcome(generic, { method: 'GET', endpoint: '/foreign-origin' })).outcome.status, 'failed');
  assert.equal(foreignRequests, 0); assert.equal(attempts.filter(value => value.state === 'dispatched').length, 6);
  console.log('Safe read: two physical attempts; complete source retained through rollover.');
  console.log('Synthetic mutation: one physical attempt despite HTTP 503; host reconciliation owns remote completion.');
  console.log('Generic redirects: same-origin followed; cross-origin blocked before forwarding credentials. Foreign requests: 0.');
  console.log('LLM calls: 0. Legacy aliases: 0. Evidence:', read.evidence.reference.durability);
} finally {
  agent.destroy(); Connector.remove('c4-github'); Connector.remove(llm.connector.name);
  await Promise.all([server, foreign].map(value => new Promise<void>((resolve, reject) => value.close(error => error ? reject(error) : resolve()))));
  await rm(directory, { recursive: true, force: true });
}
