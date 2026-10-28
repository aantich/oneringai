/** Offline C5: fourteen logical pages, real local HTTP, zero LLM/external-service calls. Build first. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Agent, Connector, ConnectorTools, FileEvidenceStorage, ToolManager, ContentType, MessageRole } from '@everworker/oneringai';
import type { ConnectorPage } from '@everworker/oneringai';
import { offlineRoutingConnector } from './model-routing/fixture.js';

const pages = Array.from({ length: 14 }, (_, n) => n === 5 ? [] : Array.from({ length: n === 13 ? 1 : 4 }, (_, i) => ({ id: `${n}:${i}`, name: `channel-${n}-${i}`, text: `EXACT-${n}-${i} ` + 'source body '.repeat(400) })));
const expected = pages.flatMap(items => items.map(item => item.id));
const hash = (ids: string[]): string => createHash('sha256').update(JSON.stringify(ids)).digest('hex');
let dispatches = 0;
const server = createServer((request, response) => {
  dispatches++; const url = new URL(request.url!, 'http://localhost'), number = Number(url.searchParams.get('cursor') ?? 0);
  response.setHeader('Content-Type', 'application/json');
  response.end(JSON.stringify({ ok: true, channels: pages[number], response_metadata: { next_cursor: number === 13 ? '' : String(number + 1) } }));
});
await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve); });
const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing local port');
const directory = await mkdtemp(join(tmpdir(), 'oneringai-c5-')), scope = { ownerId: 'example-host', namespace: 'collection-pages' };
const storage = new FileEvidenceStorage({ directory, scope }), llm = offlineRoutingConnector('c5-model');
Connector.create({ name: 'c5-slack', serviceType: 'slack', baseURL: `http://127.0.0.1:${address.port}`, auth: { type: 'api_key', apiKey: 'SYNTHETIC_LOCAL_ONLY' } });
const selected = ConnectorTools.enhanced('c5-slack', { profile: 'collections-v1', accountId: 'work' });
const agent = Agent.create({ connector: llm.connector, model: llm.mainModel, userId: scope.ownerId, permissions: { autoApproveAll: true },
  identities: [{ connector: 'c5-slack', accountId: 'work', toolFilter: selected.map(tool => tool.definition.function.name) }],
  context: { model: llm.mainModel, features: { toolCatalog: true, evidence: true, workingMemory: false, inContextMemory: false }, plugins: { evidence: { storage } } },
});
const replacement = new ToolManager();
try {
  agent.tools.registerConnectorTools('c5-slack', selected, { accountId: 'work' });
  const seen: string[] = [], positions = new Set<string>(); let continuation: string | undefined, firstContinuation = '', logicalPages = 0;
  do {
    const report = await agent.tools.executeWithOutcome('c5-slack_work_list_channels_page', { pageSize: 2, ...(continuation ? { continuation } : {}) });
    assert.equal(report.outcome.status, 'succeeded'); const result = report.result as ConnectorPage<{ id: string }>;
    assert.equal(result.returnedCount, result.items.length); assert.equal(result.reportedTotal, undefined); assert.equal(result.searchCoverage, 'complete'); seen.push(...result.items.map(item => item.id)); logicalPages++;
    console.log(`Page ${logicalPages}: returned ${result.returnedCount}, position ${result.position.state}, coverage ${result.searchCoverage}`);
    if (result.position.state === 'unknown') throw new Error(result.position.reason);
    if (result.position.state === 'more') { assert.ok(!positions.has(result.position.positionId), 'Repeated provider position'); positions.add(result.position.positionId); continuation = result.position.continuation; firstContinuation ||= continuation; }
    else continuation = undefined;
    if (logicalPages === 4) { await agent.tools.execute('tool_catalog_unload', { category: 'connector:c5-slack:work' }); await agent.tools.execute('tool_catalog_load', { category: 'connector:c5-slack:work' }); }
    if (logicalPages === 7) {
      agent.context.addUserMessage('Host traversal is continuing.'); agent.context.addAssistantResponse([{ type: 'message', role: MessageRole.ASSISTANT, content: [{ type: ContentType.OUTPUT_TEXT, text: 'Use the retained continuation and evidence.' }] }]);
      await agent.context.rollover({ preserveRecentTurns: 0, summarize: async () => 'Host traversal continues; retain the opaque continuation.' });
    }
  } while (continuation);
  assert.deepEqual(seen, expected); assert.equal(hash(seen), hash(expected)); assert.equal(logicalPages, 14); assert.equal(dispatches, 14); assert.equal(llm.requests.length, 0);
  const reopened = new FileEvidenceStorage({ directory, scope }), listing = await reopened.list(); const sources = listing.entries.filter(entry => entry.toolName === 'c5-slack_work_list_channels_page'); assert.equal(sources.length, 14);
  const records = []; for (const entry of sources) records.push(await reopened.readRecord(entry.reference));
  assert.ok(records.some(record => JSON.stringify(record?.result).includes(pages[0]![0]!.text)));
  replacement.registerConnectorTools('c5-slack', selected, { accountId: 'work' });
  assert.equal((await replacement.executeWithOutcome('c5-slack_work_list_channels_page', { pageSize: 2, continuation: firstContinuation })).outcome.status, 'failed'); assert.equal(dispatches, 14);
  assert.ok(!agent.tools.list().includes('c5-slack_work_list_channels'));
  console.log(`Exact IDs: ${seen.length}; SHA-256: ${hash(seen)}; logical pages/HTTP attempts: ${logicalPages}/${dispatches}; LLM calls: 0.`);
  console.log('Catalog reload and context rollover retained the codec; a fresh manager rejected the old continuation without HTTP.');
} finally {
  replacement.destroy(); agent.destroy(); Connector.remove('c5-slack'); Connector.remove(llm.connector.name);
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); await rm(directory, { recursive: true, force: true });
}
