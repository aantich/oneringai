import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import dotenv from 'dotenv';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { Agent, Connector, FileContextStorage, FileEvidenceStorage, Vendor, StreamEventType, ContentType, MessageRole, ToolCallState, ToolEvidenceMiddleware } from '../../../src/index.js';
import type { ToolExecutionOutcome, ToolResult } from '../../../src/index.js';
dotenv.config({ quiet: true });
const enabled = process.env.RUN_EVIDENCE_LIVE === '1';
const providers = [
  { name: 'openai', vendor: Vendor.OpenAI, key: process.env.OPENAI_API_KEY, model: 'gpt-4o-mini' },
  { name: 'anthropic', vendor: Vendor.Anthropic, key: process.env.ANTHROPIC_API_KEY, model: 'claude-haiku-4-5-20251001' },
  { name: 'google', vendor: Vendor.Google, key: process.env.GOOGLE_API_KEY, model: 'gemini-2.5-flash' },
];
const reports: Array<Record<string, unknown>> = [];
afterAll(async () => {
  if (!enabled || !process.env.EVIDENCE_REPORT_PATH) return;
  await mkdir(dirname(process.env.EVIDENCE_REPORT_PATH), { recursive: true });
  await writeFile(process.env.EVIDENCE_REPORT_PATH, JSON.stringify({ protocol: 'stage-03', recordedAt: new Date().toISOString(),
    scope: 'Functional live probes with local synthetic search tools; no external writes, reliability estimate, or quality/cost comparison.', reports }, null, 2) + '\n');
});
describe.skipIf(!enabled).sequential('Stage 03 live evidence', () => {
  for (const provider of providers) {
    it(`${provider.name} restores a delivery-only pending failed observation before a real model request`, async () => {
      if (!provider.key) throw new Error(`Missing ${provider.name} key for explicitly enabled live test`);
      const directory = await mkdtemp(join(tmpdir(), 'stage03-pending-live-')); const scope = { ownerId: 'live-fixture', namespace: 'pending-recovery' }; const name = `stage03-${provider.name}-pending`;
      const storage = new FileEvidenceStorage({ scope, directory: join(directory, 'evidence') }); const sessions = new FileContextStorage({ agentId: 'pending', baseDirectory: join(directory, 'sessions') });
      vi.spyOn(storage, 'put').mockRejectedValue(new Error('Synthetic storage failure')); let executions = 0, calls = 0, terminalInputHasSource = false;
      const marker = 'RESTORED_SOURCE_731'; const raw = { exactMarker: marker, padding: 'retained source '.repeat(600) };
      Connector.create({ name, vendor: provider.vendor, auth: { type: 'api_key', apiKey: provider.key } });
      const create = () => Agent.create({ connector: name, model: provider.model, userId: scope.ownerId, thinking: { enabled: false }, emptyResponseRetry: { enabled: false },
        instructions: 'The earlier large_search action has already completed. Return exactMarker verbatim from its raw tool result. Do not repeat the action or retrieve evidence; its storage write failed.',
        tools: [{ definition: { type: 'function', function: { name: 'large_search', parameters: { type: 'object', properties: {}, additionalProperties: false } } }, execute: async () => { executions++; return raw; } }],
        context: { model: provider.model, storage: sessions, features: { workingMemory: false, inContextMemory: false, evidence: true }, plugins: { evidence: { storage } } },
        vendorOptions: provider.name === 'google' ? { generationConfig: { thinkingConfig: { thinkingBudget: 0 } } } : undefined,
        hooks: { 'before:llm': async context => { calls++; terminalInputHasSource = JSON.stringify(context.options.input).includes(marker); context.options.max_output_tokens = 128; context.options.tools = undefined; context.options.tool_choice = undefined; return {}; } } });
      let agent = create();
      try {
        agent.context.addUserMessage('Search once.'); agent.context.addAssistantResponse([{ type: 'message', role: MessageRole.ASSISTANT, content: [{ type: ContentType.TOOL_USE, id: 'pending-call', name: 'large_search', arguments: '{}' }] }]);
        const report = await agent.tools.executeWithOutcome('large_search', {}, { callId: 'pending-call' }); expect(report.evidence?.status).toBe('storage_failed');
        agent.context.addToolResults([{ tool_use_id: 'pending-call', content: report.result, evidence: report.evidence, state: ToolCallState.COMPLETED }]);
        await agent.saveSession('pending'); agent.destroy(); agent = create(); expect(await agent.loadSession('pending')).toBe(true);
        const response = await agent.run('Return the exactMarker from the completed search.'); expect(response.output_text).toContain(marker); expect(terminalInputHasSource).toBe(true); expect(calls).toBe(1); expect(executions).toBe(1); expect((await storage.list()).entries).toHaveLength(0);
        reports.push({ provider: provider.name, model: provider.model, mode: 'pending-restore', passed: true, modelCalls: calls, executions, terminalInputHasSource, recoveredExactMarker: true, evidenceStatus: 'storage_failed', acknowledgement: null });
      } catch (error) { reports.push({ provider: provider.name, model: provider.model, mode: 'pending-restore', passed: false, modelCalls: calls, executions, terminalInputHasSource, errorType: error instanceof Error ? error.name : 'unknown' }); throw new Error(`Stage 03 ${provider.name} pending restore failed; credentials omitted.`, { cause: error instanceof Error && error.name === 'AssertionError' ? error : undefined }); }
      finally { agent.destroy(); Connector.remove(name); await rm(directory, { recursive: true, force: true }); vi.restoreAllMocks(); }
    }, 120_000);
  }
  for (const provider of providers) for (const mode of ['run', 'stream', 'storage-failure', 'hook-mutation', 'stream-close'] as const) {
    it(`${provider.name} ${mode}: exact evidence recovery or raw fallback`, async () => {
      if (!provider.key) throw new Error(`Missing ${provider.name} key for explicitly enabled live test`);
      const directory = await mkdtemp(join(tmpdir(), 'stage03-live-')); const scope = { ownerId: 'live-fixture', namespace: `${provider.name}-${mode}` };
      const storage = new FileEvidenceStorage({ directory, scope }); const name = `stage03-${provider.name}-${mode}`;
      if (mode === 'storage-failure' || mode === 'stream-close') vi.spyOn(storage, 'put').mockRejectedValue(new Error('Synthetic storage failure'));
      const needsRetrieval = mode === 'run' || mode === 'stream';
      const expectedMarker = mode === 'hook-mutation' ? 'HOST_CORRECTED_SOURCE_673' : 'EVIDENCE_SOURCE_672';
      const raw = { status: 'found', ids: ['DOC_LIVE_03'], exactMarker: 'EVIDENCE_SOURCE_672', padding: 'Large synthetic source. '.repeat(500) };
      const storedRaw = structuredClone(raw);
      let executions = 0; let modelCalls = 0; let terminalInputHasSource = false; const completed: ToolResult[] = []; const outcomes: ToolExecutionOutcome[] = [];
      Connector.create({ name, vendor: provider.vendor, auth: { type: 'api_key', apiKey: provider.key } });
      const agent = Agent.create({ connector: name, model: provider.model, userId: scope.ownerId, thinking: { enabled: false }, maxIterations: 4, emptyResponseRetry: { enabled: false },
        instructions: !needsRetrieval
          ? 'Call large_search exactly once. This probe supplies a raw JSON tool result: read exactMarker directly from that tool result and return its value verbatim. Do not call evidence_read or evidence_list; do not repeat large_search.'
          : 'Call large_search once. Its result is projected: call evidence_read with id equal to evidence.id from the projected result, offset 0 and limit 2048 (omit reference). Read exactMarker from stored JSON, then return its value verbatim. No other tools or retries.',
        tools: [{ definition: { type: 'function', function: { name: 'large_search', description: 'Get large synthetic search data.', parameters: { type: 'object', properties: {}, additionalProperties: false } } },
          execute: async () => { executions++; return raw; }, output: { effect: 'read', expectedSize: 'large', summarize: () => 'status=found; ids=[DOC_LIVE_03]. Exact source marker is only in stored evidence; retrieve it.' } }],
        context: { model: provider.model, storage: new FileContextStorage({ agentId: 'live-fixture', baseDirectory: join(directory, 'sessions') }), agentId: 'live-fixture', features: { workingMemory: false, inContextMemory: false, evidence: true }, plugins: { evidence: { storage } } },
        vendorOptions: provider.name === 'google' ? { generationConfig: { thinkingConfig: { thinkingBudget: 0 } } } : undefined,
        hooks: { 'before:llm': async context => {
          modelCalls++;
          const target = modelCalls === 1 ? 'large_search' : modelCalls === 2 && needsRetrieval ? 'evidence_read' : undefined;
          context.options.max_output_tokens = 384; context.options.parallel_tool_calls = false;
          if (target) context.options.tool_choice = { type: 'function', function: { name: target } };
          else { terminalInputHasSource = JSON.stringify(context.options.input).includes(expectedMarker); context.options.tools = undefined; context.options.tool_choice = undefined; }
          return {};
        }, 'after:tool': async context => {
          if (mode === 'hook-mutation' && context.result.tool_name === 'large_search') {
            context.result.content.exactMarker = expectedMarker;
            return { modified: { content: context.result.content } };
          }
          return {};
        } },
      });
      agent.on('tool:complete', event => completed.push(event.result)); agent.tools.on('tool:outcome', o => outcomes.push(o));
      try {
        let text = '';
        if (mode === 'stream-close') {
          for await (const event of agent.stream('Find the source once.')) if (event.type === StreamEventType.TOOL_EXECUTION_DONE) break;
          expect(executions).toBe(1); expect(modelCalls).toBe(1); await agent.saveSession('closed'); expect(JSON.stringify(await agent.getContextState())).toContain(raw.padding);
          vi.mocked(storage.put).mockRestore();
          const recovered = await new ToolEvidenceMiddleware({ storage }).record(agent.tools.get('large_search')!, {}, { userId: scope.ownerId }, completed[0]!.outcome!, { value: raw });
          await agent.context.acknowledgeToolEvidence(completed[0]!.tool_use_id, recovered.reference!); await agent.loadSession('closed'); await agent.context.prepare();
          expect(await agent.context.acknowledgeToolEvidence(completed[0]!.tool_use_id, recovered.reference!)).toBe(1);
          text = (await agent.run('Return exactMarker from the already completed search.')).output_text ?? '';
        } else if (mode === 'stream') for await (const event of agent.stream('Find and return the exact source marker.')) { if (event.type === StreamEventType.OUTPUT_TEXT_DELTA) text += event.delta; }
        else text = (await agent.run('Find and return the exact source marker.')).output_text ?? '';
        expect(terminalInputHasSource).toBe(true); expect(text).toContain(expectedMarker); expect(executions).toBe(1); expect(completed[0]!.content).toBe(raw);
        expect(outcomes[0]!.status).toBe('succeeded');
        if (mode === 'storage-failure' || mode === 'stream-close') {
          expect(outcomes[0]!.evidence?.status).toBe('storage_failed'); expect(completed[0]!.evidence?.projection).toBeUndefined(); expect(modelCalls).toBe(2);
        } else if (mode === 'hook-mutation') {
          expect(completed[0]!.evidence).toBeUndefined(); expect(outcomes[0]!.evidence?.status).toBe('stored');
          expect(modelCalls).toBe(2); expect(outcomes.map(o => o.toolName)).toEqual(['large_search']);
          const restarted = new FileEvidenceStorage({ directory, scope });
          expect((await restarted.readRecord(outcomes[0]!.evidence!.reference!))?.result).toEqual(storedRaw);
          expect(raw.exactMarker).toBe(expectedMarker); expect((await restarted.list()).entries).toHaveLength(1);
        } else {
          expect(outcomes.map(o => o.toolName)).toEqual(['large_search', 'evidence_read']); expect(completed[0]!.evidence!.projection).not.toContain('EVIDENCE_SOURCE_672');
          expect(completed[1]!.tool_args?.id).toBe(completed[0]!.evidence!.reference!.id); expect(completed[1]!.content.text).toContain('EVIDENCE_SOURCE_672'); expect(modelCalls).toBe(3);
          const restarted = new FileEvidenceStorage({ directory, scope }); expect((await restarted.readRecord(completed[0]!.evidence!.reference!))?.result).toEqual(storedRaw);
          expect((await restarted.list()).entries).toHaveLength(1);
        }
        reports.push({ provider: provider.name, model: provider.model, mode, passed: true, modelCalls, executions,
          recoveredExactMarker: true, terminalInputHasSource, acknowledgement: outcomes[0]!.evidence?.reference?.durability ?? null,
          evidenceStatus: outcomes[0]!.evidence?.status, rawChars: JSON.stringify(raw).length,
          projectionChars: completed[0]!.evidence?.projection?.length ?? null, outcomes: outcomes.map(o => ({ tool: o.toolName, status: o.status, completion: o.completion })) });
      } catch (error) {
        reports.push({ provider: provider.name, model: provider.model, mode, passed: false, modelCalls, executions, terminalInputHasSource, expectedReference: completed[0]?.evidence?.reference, readArguments: completed[1]?.tool_args, readError: completed[1]?.error, errorType: error instanceof Error ? error.name : 'unknown', outcomes: outcomes.map(o => ({ tool: o.toolName, status: o.status, completion: o.completion })) });
        throw new Error(`Stage 03 ${provider.name} ${mode} failed (${error instanceof Error ? error.name : 'unknown'}); see assertions/report, credentials omitted.`, { cause: error instanceof Error && error.name === 'AssertionError' ? error : undefined });
      } finally { agent.destroy(); Connector.remove(name); await rm(directory, { recursive: true, force: true }); vi.restoreAllMocks(); }
    }, 120_000);
  }
});
