import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import dotenv from 'dotenv';
import { afterAll, describe, expect, it } from 'vitest';
import { Agent, Connector, ConnectorTools, InMemoryEvidenceStorage, ModelTask, StreamEventType, Vendor } from '../../../src/index.js';
import type { EnhancedConnectorAttempt, ToolExecutionOutcome } from '../../../src/index.js';
dotenv.config({ quiet: true });
const enabled = process.env.RUN_ENHANCED_CONNECTORS_LIVE === '1', reports: Record<string, unknown>[] = [];
const providers = [
  { name: 'openai', vendor: Vendor.OpenAI, key: process.env.OPENAI_API_KEY, model: 'gpt-4o-mini' },
  { name: 'anthropic', vendor: Vendor.Anthropic, key: process.env.ANTHROPIC_API_KEY, model: 'claude-haiku-4-5-20251001' },
  { name: 'google', vendor: Vendor.Google, key: process.env.GOOGLE_API_KEY, model: 'gemini-2.5-flash' },
];
afterAll(async () => {
  const path = process.env.ENHANCED_CONNECTORS_REPORT_PATH;
  if (enabled && path) { await mkdir(dirname(path), { recursive: true }); await writeFile(path, JSON.stringify({ protocol: 'consumer-c4-live-v1', scope: 'Actual LLMs and local synthetic GitHub-compatible HTTP only; no external service writes', reports }, null, 2) + '\n'); }
});
describe.skipIf(!enabled).sequential('C4 enhanced connector profile with actual models', () => {
  for (const p of providers) for (const mode of ['run', 'stream'] as const) it(`${p.name} ${mode}: scoped tools, source retention and mutation retry boundary`, async () => {
    if (!p.key) throw new Error(`Missing ${p.name} credentials`);
    const marker = 'C4_EXACT_SOURCE_42', source = marker + ' full allowed data '.repeat(1500);
    let reads = 0, writes = 0;
    const server = createServer((request, response) => {
      response.setHeader('Content-Type', 'application/json');
      if (request.method === 'POST') { writes++; response.writeHead(503); response.end(JSON.stringify({ message: 'Synthetic write accepted but response unavailable' })); return; }
      reads++;
      if (reads === 1) { response.writeHead(503); response.end(JSON.stringify({ message: 'Synthetic safe-read retry' })); return; }
      response.end(JSON.stringify({ type: 'file', path: 'source.txt', sha: marker, size: source.length, encoding: 'base64', content: Buffer.from(source).toString('base64') }));
    });
    await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve); });
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing local port');
    const name = `c4-${p.name}-${mode}`, service = `c4github_${p.name}_${mode}`;
    Connector.create({ name, vendor: p.vendor, auth: { type: 'api_key', apiKey: p.key } });
    Connector.create({ name: service, serviceType: 'github', baseURL: `http://127.0.0.1:${address.port}`, auth: { type: 'api_key', apiKey: 'SYNTHETIC_LOCAL_ONLY' }, retry: { maxRetries: 1, baseDelayMs: 1, maxDelayMs: 1 } });
    const attempts: EnhancedConnectorAttempt[] = [], task = new ModelTask({ limits: { maxCalls: 2 } });
    const storage = new InMemoryEvidenceStorage({ scope: { ownerId: 'live-host', namespace: name } });
    const tools = ConnectorTools.enhanced(service, { profile: 'execution-v1', onAttempt: value => attempts.push(value) }).filter(tool => /_(read_file|create_pr)_exec$/.test(tool.definition.function.name));
    const readName = `${service}_read_file_exec`, writeName = `${service}_create_pr_exec`;
    const outcomes: ToolExecutionOutcome[] = [];
    const agent = Agent.create({ connector: name, model: p.model, userId: 'live-host', permissions: { autoApproveAll: true }, thinking: { enabled: false }, temperature: 0,
      instructions: 'Read the requested local file exactly once. Parse the result summary JSON string and return only summary.metadata.sha, the provider file revision. No extra text. Do not create a pull request.',
      identities: [{ connector: service, toolFilter: tools.map(tool => tool.definition.function.name) }],
      emptyResponseRetry: { enabled: false }, modelExecution: { maxOutputTokensPerCall: 128 },
      context: { model: p.model, features: { evidence: true, toolCatalog: false, inContextMemory: false, workingMemory: false }, plugins: { evidence: { storage } } },
      hooks: { 'before:llm': async hook => {
        if (reads === 0) { hook.options.tool_choice = { type: 'function', function: { name: readName } }; hook.options.parallel_tool_calls = false; }
        else { hook.options.tools = []; delete hook.options.tool_choice; }
        return {};
      } },
    });
    agent.tools.registerConnectorTools(service, tools);
    agent.tools.on('tool:outcome', value => outcomes.push(value));
    try {
      expect(agent.tools.getEnabledRegistrations().filter(reg => reg.source === `connector:${service}`).map(reg => reg.tool.definition.function.name).sort()).toEqual([readName, writeName].sort());
      let text = '';
      const input = `Call ${readName} with repository="owner/repo", path="source.txt". Parse the summary JSON string and return only summary.metadata.sha, the provider file revision.`;
      if (mode === 'run') text = (await agent.run(input, { modelTask: task })).output_text ?? '';
      else for await (const event of agent.stream(input, { modelTask: task })) if (event.type === StreamEventType.OUTPUT_TEXT_DELTA) text += event.delta;
      expect(text).toContain(marker); expect(reads).toBe(2); expect(task.snapshot().totals.calls).toBe(2);
      const listing = await storage.list(); const sourceEntry = listing.entries.find(entry => entry.toolName === readName)!;
      expect((await storage.readRecord(sourceEntry.reference))?.result).toMatchObject({ content: '1\t' + source, sha: marker, truncated: false });
      const write = await agent.tools.executeWithOutcome(writeName, { repository: 'owner/repo', title: 'Synthetic', head: 'feature', base: 'main' });
      expect(write.outcome.status).toBe('failed'); expect(write.outcome.evidence?.effect).toBe('write'); expect(writes).toBe(1);
      expect(attempts.filter(value => value.state === 'dispatched')).toHaveLength(3); expect(new Set(attempts.map(value => value.invocationId)).size).toBe(2);
      reports.push({ provider: p.name, model: p.model, mode, passed: true, reads, writes, attempts, outcomes, usage: task.snapshot() });
    } catch (error) {
      reports.push({ provider: p.name, model: p.model, mode, passed: false, reads, writes, attempts, outcomes, usage: task.snapshot(), errorType: error instanceof Error ? error.name : 'unknown', diagnostic: error instanceof Error && error.name === 'AssertionError' ? error.message : undefined });
      throw new Error(`C4 ${p.name}/${mode} failed; credentials omitted`, { cause: error instanceof Error && error.name === 'AssertionError' ? error : undefined });
    } finally { agent.destroy(); task.destroy(); Connector.remove(service); Connector.remove(name); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  }, 90_000);
});
