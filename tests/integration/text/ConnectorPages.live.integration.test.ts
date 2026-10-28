import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import dotenv from 'dotenv';
import { afterAll, describe, expect, it } from 'vitest';
import { Agent, Connector, ConnectorTools, InMemoryEvidenceStorage, ModelTask, StreamEventType, Vendor } from '../../../src/index.js';
import type { EnhancedConnectorAttempt } from '../../../src/index.js';
dotenv.config({ quiet: true });
const enabled = process.env.RUN_CONNECTOR_PAGES_LIVE === '1', reports: Record<string, unknown>[] = [];
const providers = [
  { name: 'openai', vendor: Vendor.OpenAI, key: process.env.OPENAI_API_KEY, model: 'gpt-4o-mini' },
  { name: 'anthropic', vendor: Vendor.Anthropic, key: process.env.ANTHROPIC_API_KEY, model: 'claude-haiku-4-5-20251001' },
  { name: 'google', vendor: Vendor.Google, key: process.env.GOOGLE_API_KEY, model: 'gemini-2.5-flash' },
];
afterAll(async () => { const path = process.env.CONNECTOR_PAGES_REPORT_PATH; if (enabled && path) { await mkdir(dirname(path), { recursive: true }); await writeFile(path, JSON.stringify({ protocol: 'consumer-c5-live-v1', scope: 'Real models and synthetic local Drive pages; no external service writes', reports }, null, 2) + '\n'); } });
describe.skipIf(!enabled).sequential('C5 collection pages with real models', () => {
  for (const provider of providers) for (const mode of ['run', 'stream'] as const) it(`${provider.name}/${mode}: whole page projection, host continuation, coverage and catalog ownership`, async () => {
    if (!provider.key) throw new Error(`Missing ${provider.name} credentials`);
    const marker = 'C5_PROVIDER_ITEM_42', rows = [{ id: 'first', description: 'full source '.repeat(1200) }, { id: 'second', description: 'exact second source' }, { id: marker, description: 'last over-returned source' }];
    let reads = 0; const server = createServer((request, response) => {
      reads++; response.setHeader('Content-Type', 'application/json'); const url = new URL(request.url!, 'http://localhost');
      response.end(JSON.stringify(url.searchParams.has('pageToken') ? { files: [{ id: 'final', description: 'exact final source' }], incompleteSearch: false } : { files: rows, nextPageToken: 'provider-position', incompleteSearch: true }));
    }); await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve); }); const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing local port');
    const name = `c5-${provider.name}-${mode}`, service = `c5drive_${provider.name}_${mode}`, readName = `${service}_work_list_files_page`;
    Connector.create({ name, vendor: provider.vendor, auth: { type: 'api_key', apiKey: provider.key } });
    Connector.create({ name: service, serviceType: 'google-api', baseURL: `http://127.0.0.1:${address.port}`, auth: { type: 'api_key', apiKey: 'SYNTHETIC_LOCAL_ONLY' } });
    const storage = new InMemoryEvidenceStorage({ scope: { ownerId: 'live-host', namespace: name } }), task = new ModelTask({ limits: { maxCalls: 2 } }), attempts: EnhancedConnectorAttempt[] = [];
    const selected = ConnectorTools.enhanced(service, { profile: 'collections-v1', accountId: 'work', onAttempt: value => attempts.push(value) }).filter(tool => tool.definition.function.name === readName);
    const agent = Agent.create({ connector: name, model: provider.model, userId: 'live-host', thinking: { enabled: false }, temperature: 0, permissions: { autoApproveAll: true },
      instructions: 'Read the requested local Drive page once. Parse the summary JSON string and return only summary.metadata.items[2].id, the third provider item ID. No extra text.',
      identities: [{ connector: service, accountId: 'work', toolFilter: selected.map(tool => tool.definition.function.name) }],
      emptyResponseRetry: { enabled: false }, modelExecution: { maxOutputTokensPerCall: 128 },
      context: { model: provider.model, features: { evidence: true, toolCatalog: true, workingMemory: false, inContextMemory: false }, plugins: { evidence: { storage } } },
      hooks: { 'before:llm': async hook => { if (!reads) { hook.options.tool_choice = { type: 'function', function: { name: readName } }; hook.options.parallel_tool_calls = false; } else { hook.options.tools = []; delete hook.options.tool_choice; } return {}; } },
    }); agent.tools.registerConnectorTools(service, selected, { accountId: 'work' });
    try {
      let text = ''; const input = `Call ${readName} with pageSize=1 and no continuation. Return only summary.metadata.items[2].id.`;
      if (mode === 'run') text = (await agent.run(input, { modelTask: task })).output_text ?? '';
      else for await (const event of agent.stream(input, { modelTask: task })) if (event.type === StreamEventType.OUTPUT_TEXT_DELTA) text += event.delta;
      expect(text).toContain(marker); expect(reads).toBe(1); expect(task.snapshot().totals.calls).toBe(2);
      const entries = await storage.list(), firstSource = entries.entries.find(entry => entry.toolName === readName)!;
      const record = await storage.readRecord(firstSource.reference), first = record!.result as { items: unknown[]; returnedCount: number; searchCoverage: string; position: { state: string; continuation: string } };
      expect(first.items).toEqual(rows); expect(first.returnedCount).toBe(3); expect(first.searchCoverage).toBe('incomplete'); expect(first.position.state).toBe('more');
      await agent.tools.execute('tool_catalog_unload', { category: `connector:${service}:work` }); await agent.tools.execute('tool_catalog_load', { category: `connector:${service}:work` });
      const final = await agent.tools.executeWithOutcome(readName, { pageSize: 1, continuation: first.position.continuation }); expect(final.outcome.status, JSON.stringify(final.result)).toBe('succeeded'); expect(final.result).toMatchObject({ items: [{ id: 'final', description: 'exact final source' }], returnedCount: 1, searchCoverage: 'incomplete', position: { state: 'end' } });
      expect(reads).toBe(2); expect(task.snapshot().totals.calls).toBe(2); expect(attempts.filter(value => value.state === 'dispatched')).toHaveLength(2); expect(agent.tools.list()).not.toContain(`${service}_work_list_files`);
      reports.push({ provider: provider.name, model: provider.model, mode, passed: true, reads, returnedCount: first.returnedCount, finalCoverage: final.result.searchCoverage, physicalAttempts: attempts.filter(value => value.state === 'dispatched').length, usage: task.snapshot() });
    } catch (error) { reports.push({ provider: provider.name, mode, passed: false, reads, errorType: error instanceof Error ? error.name : 'unknown', diagnostic: error instanceof Error && error.name === 'AssertionError' ? error.message : undefined }); throw new Error(`C5 ${provider.name}/${mode} failed; credentials omitted`, { cause: error instanceof Error && error.name === 'AssertionError' ? error : undefined }); }
    finally { agent.destroy(); task.destroy(); Connector.remove(service); Connector.remove(name); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  }, 90_000);
});
