import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Agent } from '@/core/Agent.js';
import { Connector } from '@/core/Connector.js';
import { Vendor } from '@/core/Vendor.js';
import { AgentContextNextGen } from '@/core/context-nextgen/AgentContextNextGen.js';
import { InMemoryEvidenceStorage } from '@/infrastructure/storage/EvidenceStorage.js';
import { FileContextStorage } from '@/infrastructure/storage/FileContextStorage.js';
import { ToolEvidenceMiddleware } from '@/core/evidence/ToolEvidenceMiddleware.js';
import { ContentType } from '@/domain/entities/Content.js';
import { MessageRole } from '@/domain/entities/Message.js';
import { StreamEventType } from '@/domain/entities/StreamEvent.js';
import type { StreamEvent } from '@/domain/entities/StreamEvent.js';
import type { ToolFunction, ToolExecutionReport, ToolResult, ToolContext } from '@/domain/entities/Tool.js';
import type { ITextProvider, TextGenerateOptions } from '@/domain/interfaces/ITextProvider.js';
import type { LLMResponse } from '@/domain/entities/Response.js';
import type { InputItem } from '@/domain/entities/Message.js';
import { OpenAIResponsesConverter } from '@/infrastructure/providers/openai/OpenAIResponsesConverter.js';
import { AnthropicConverter } from '@/infrastructure/providers/anthropic/AnthropicConverter.js';
import { GoogleConverter } from '@/infrastructure/providers/google/GoogleConverter.js';

const scope = { ownerId: 'alice', namespace: 'third-corrections' };
const raw = { id: 'RETAIN_SOURCE_914', body: 'exact source '.repeat(1000) };
const agents: Agent[] = [], contexts: AgentContextNextGen[] = [], names: string[] = [], dirs: string[] = [];
afterEach(async () => { agents.splice(0).forEach(a => a.destroy()); contexts.splice(0).forEach(c => c.destroy()); names.splice(0).forEach(n => Connector.remove(n)); vi.restoreAllMocks(); await Promise.all(dirs.splice(0).map(d => rm(d, { recursive: true, force: true }))); });
const probe = (name = 'probe'): ToolFunction => ({ definition: { type: 'function', function: { name, parameters: { type: 'object', properties: {} } } }, execute: async () => raw, output: { effect: 'write', summarize: () => 'accepted' } });
async function sessions() { const directory = await mkdtemp(join(tmpdir(), 'evidence-third-')); dirs.push(directory); return new FileContextStorage({ agentId: 'third', baseDirectory: directory }); }
function context(storage = new InMemoryEvidenceStorage({ scope }), storageForSessions?: FileContextStorage, enabled = true) { const c = AgentContextNextGen.create({ model: 'gpt-4o-mini', userId: scope.ownerId, storage: storageForSessions, features: { workingMemory: false, inContextMemory: false, evidence: enabled }, plugins: { evidence: { storage } } }); contexts.push(c); return c; }
const contents = (items: readonly InputItem[]) => items.flatMap(item => item.type === 'message' ? item.content : []);
const retained = (c: AgentContextNextGen) => [...c.getConversation(), ...c.getCurrentInput()];
function pair(c: AgentContextNextGen, report: ToolExecutionReport, delivery = report.evidence, outcome = true) { c.addUserMessage('once'); c.addAssistantResponse([{ type: 'message', role: MessageRole.ASSISTANT, content: [{ type: ContentType.TOOL_USE, id: 'call', name: 'probe', arguments: '{}' }] }]); c.addToolResults([{ tool_use_id: 'call', content: report.result, state: 'completed' as never, evidence: delivery, ...(outcome ? { outcome: report.outcome } : {}) }]); }
async function failed(c: AgentContextNextGen, storage: InMemoryEvidenceStorage) { c.tools.register(probe()); vi.spyOn(storage, 'put').mockRejectedValueOnce(new Error('offline')); return c.tools.executeWithOutcome('probe', {}, { callId: 'call' }); }
function response(count: number): LLMResponse { return { id: 'r', object: 'response', model: 'gpt-4o-mini', created_at: 1, status: 'completed', output_text: count ? '' : 'done', output: [{ type: 'message', role: MessageRole.ASSISTANT, content: count ? Array.from({ length: count }, (_, i) => ({ type: ContentType.TOOL_USE as const, id: `call-${i}`, name: `probe_${i}`, arguments: '{}' })) : [{ type: ContentType.OUTPUT_TEXT, text: 'done' }] }], usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } }; }
function fixture(count = 1, enabled = true, timeoutLast = false, sessionStorage?: FileContextStorage) {
  const storage = new InMemoryEvidenceStorage({ scope }); vi.spyOn(storage, 'put').mockRejectedValue(new Error('offline'));
  const packets: TextGenerateOptions[] = []; const executes = Array.from({ length: count }, () => vi.fn(async () => raw));
  const provider: ITextProvider = { name: 'fixture', capabilities: { text: true, images: false, audio: false, videos: false }, validateConfig: async () => true, listModels: async () => [], getModelCapabilities: () => ({ supportsTools: true, supportsVision: false, supportsJSON: true, supportsJSONSchema: true, maxTokens: 128000, maxInputTokens: 128000, maxOutputTokens: 1024 }),
    generate: vi.fn(async options => { packets.push(structuredClone(options)); return response(packets.length === 1 ? count : 0); }),
    streamGenerate: vi.fn(async function* (options: TextGenerateOptions): AsyncGenerator<StreamEvent> { packets.push(structuredClone(options)); if (packets.length === 1) { for (let i = 0; i < count; i++) { yield { type: StreamEventType.TOOL_CALL_START, response_id: 'r', item_id: `i-${i}`, tool_call_id: `call-${i}`, tool_name: `probe_${i}` }; yield { type: StreamEventType.TOOL_CALL_ARGUMENTS_DONE, response_id: 'r', tool_call_id: `call-${i}`, tool_name: `probe_${i}`, arguments: '{}' }; } } else yield { type: StreamEventType.OUTPUT_TEXT_DELTA, response_id: 'r', item_id: 'text', output_index: 0, content_index: 0, sequence_number: 0, delta: 'done' }; yield { type: StreamEventType.RESPONSE_COMPLETE, response_id: 'r', status: 'completed', usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 }, iterations: 1 }; }) };
  const tools: ToolFunction[] = executes.map((execute, i) => ({ ...probe(`probe_${i}`), execute }));
  if (timeoutLast) tools[count - 1]!.execute = vi.fn(async (_args: unknown, ctx?: ToolContext) => new Promise((_resolve, reject) => { ctx!.signal!.addEventListener('abort', () => reject(ctx!.signal!.reason), { once: true }); }));
  const name = `third-${names.length}`; names.push(name); Connector.create({ name, vendor: Vendor.OpenAI, auth: { type: 'none' }, options: { provider } });
  const agent = Agent.create({ connector: name, model: 'gpt-4o-mini', userId: scope.ownerId, tools, emptyResponseRetry: { enabled: false }, errorHandling: { toolFailureMode: 'fail' }, toolExecutionTimeout: timeoutLast ? 20 : 0, asyncTools: { autoContinue: false }, context: { model: 'gpt-4o-mini', storage: sessionStorage, features: { workingMemory: false, inContextMemory: false, evidence: enabled }, plugins: { evidence: { storage } } } }); agents.push(agent); return { agent, provider, storage, packets, tools, executes };
}

describe('T1 settled partial batches retain their raw observations', () => {
  it('saves a closed stream with opaque reasoning and recovers without another model/tool call', async () => {
    const sessionStorage = await sessions(); const { agent, provider, storage, tools, executes, packets } = fixture(1, true, false, sessionStorage); const stream = vi.mocked(provider.streamGenerate).getMockImplementation()!;
    vi.mocked(provider.streamGenerate).mockImplementation(async function* (options: TextGenerateOptions): AsyncGenerator<StreamEvent> { yield { type: StreamEventType.REASONING_DONE, response_id: 'r', item_id: 'reasoning', thinking: '', encrypted_content: 'OPAQUE_RETAINED' }; yield* stream(options); });
    // Capture the original implementation before replacing the mock to avoid recursion.
    const results: ToolResult[] = []; agent.on('tool:complete', e => results.push(e.result)); for await (const event of agent.stream('once')) if (event.type === StreamEventType.TOOL_EXECUTION_DONE) break;
    await agent.saveSession('closed'); expect(JSON.stringify((await sessionStorage.load('closed'))?.state)).toContain('OPAQUE_RETAINED'); vi.mocked(storage.put).mockRestore();
    const recovery = await new ToolEvidenceMiddleware({ storage }).record(tools[0]!, {}, { userId: scope.ownerId }, results[0]!.outcome!, { value: raw }); await agent.context.acknowledgeToolEvidence('call-0', recovery.reference!); await agent.loadSession('closed'); expect(JSON.stringify((await agent.context.prepare()).input)).toContain(raw.body);
    expect(await agent.context.acknowledgeToolEvidence('call-0', recovery.reference!)).toBe(1); expect(packets).toHaveLength(1); expect(executes[0]).toHaveBeenCalledTimes(1);
  });
  for (const [count, stop] of [[1, 1], [3, 1], [3, 3]] as const) for (const exit of ['break', 'return', 'throw'] as const) {
    it(`stream ${exit} after ${stop}/${count} completions preserves exact results and calls`, async () => {
      const { agent, executes, packets } = fixture(count); let completed = 0; const iterator = agent.stream('once');
      try { for await (const event of iterator) if (event.type === StreamEventType.TOOL_EXECUTION_DONE && ++completed === stop) { if (exit === 'return') await iterator.return?.(); if (exit === 'throw') throw new Error('consumer stopped'); break; } } catch (error) { expect((error as Error).message).toBe('consumer stopped'); }
      expect(executes.map(fn => fn.mock.calls.length)).toEqual(Array.from({ length: count }, (_, i) => i < stop ? 1 : 0)); expect(packets).toHaveLength(1);
      const state = await agent.getContextState(); expect(JSON.stringify(state)).toContain(raw.body);
      const results = contents(retained(agent.context)).filter(c => c.type === ContentType.TOOL_RESULT); expect(results).toHaveLength(stop); expect(new Set(results.map(r => r.type === ContentType.TOOL_RESULT ? r.tool_use_id : ''))).toHaveLength(stop);
      const restored = context(); restored.restoreState(state); const prepared = await restored.prepare(); expect(JSON.stringify(prepared.input)).toContain(raw.body);
      for (const converter of [new AnthropicConverter(), new GoogleConverter()]) expect(JSON.stringify(await converter.convertRequest({ model: 'gpt-4o-mini', input: prepared.input }))).toContain(raw.body);
      expect(JSON.stringify(new OpenAIResponsesConverter().convertInput(prepared.input))).toContain(raw.body);
    });
  }
  it.each(['run', 'stream'] as const)('%s fail-fast timeout retains earlier results without executing twice', async mode => {
    const { agent, executes, packets } = fixture(2, true, true); const run = async () => { if (mode === 'run') await agent.run('both'); else for await (const _event of agent.stream('both')) { /* drain */ } };
    await expect(run()).rejects.toThrow('timeout'); expect(executes[0]).toHaveBeenCalledTimes(1); expect(packets).toHaveLength(1); expect(JSON.stringify(await agent.getContextState())).toContain(raw.body);
    expect(contents(retained(agent.context)).filter(c => c.type === ContentType.TOOL_RESULT)).toHaveLength(2);
  });
  it.each(['run', 'stream'] as const)('%s retains raw data when its completion observer throws', async mode => {
    const { agent, executes } = fixture(); agent.on('tool:complete', () => { throw new Error('observer'); });
    const run = async () => { if (mode === 'run') await agent.run('once'); else for await (const _event of agent.stream('once')) { /* drain */ } }; await expect(run()).rejects.toThrow('observer');
    expect(JSON.stringify(await agent.getContextState())).toContain(raw.body); expect(executes[0]).toHaveBeenCalledTimes(1); expect(contents(retained(agent.context)).filter(c => c.type === ContentType.TOOL_RESULT)).toHaveLength(1);
  });
  it.each(['run', 'stream'] as const)('%s cancellation after settlement preserves its observation', async mode => {
    const { agent, executes } = fixture(2); agent.on('tool:complete', () => agent.cancel());
    const run = async () => { if (mode === 'run') await agent.run('both'); else for await (const _event of agent.stream('both')) { /* drain */ } }; await expect(run()).rejects.toThrow(); expect(JSON.stringify(await agent.getContextState())).toContain(raw.body); expect(executes[0]).toHaveBeenCalledTimes(1);
  });
  it.each(['run', 'stream'] as const)('%s fully drained result history has no duplicate finals', async mode => {
    const { agent, executes } = fixture(3); if (mode === 'run') await agent.run('all'); else for await (const _event of agent.stream('all')) { /* drain */ }
    expect(contents(retained(agent.context)).filter(c => c.type === ContentType.TOOL_RESULT)).toHaveLength(3); executes.forEach(fn => expect(fn).toHaveBeenCalledTimes(1));
  });
  it('keeps evidence-disabled stream-close behavior unchanged', async () => { const { agent } = fixture(1, false); for await (const event of agent.stream('once')) if (event.type === StreamEventType.TOOL_EXECUTION_DONE) break; expect(JSON.stringify(await agent.getContextState())).not.toContain(raw.body); });
});

describe('T2 receipt-only records do not acknowledge raw observations', () => {
  it('treats a JavaScript null optional result argument as a receipt, not an observation', async () => {
    const storage = new InMemoryEvidenceStorage({ scope }), c = context(storage); const report = await failed(c, storage); const receipt = await new ToolEvidenceMiddleware({ storage }).record(probe(), {}, { userId: scope.ownerId }, report.outcome, null as never); pair(c, report, receipt); c.addAssistantResponse([]); await expect(c.rollover({ preserveRecentTurns: 0, summarize: async () => 'lossy' })).rejects.toThrow('unacknowledged');
  });
  for (const status of ['succeeded', 'cancelled', 'failed'] as const) it.each([false, true])(`${status} receipt-only delivery stays protected (outcome=%s)`, async outcome => {
    const storage = new InMemoryEvidenceStorage({ scope }), c = context(storage); const report = await failed(c, storage); const receipt = await new ToolEvidenceMiddleware({ storage }).record(probe(), {}, { userId: scope.ownerId }, { ...report.outcome, status, completion: status === 'cancelled' ? 'unknown' : 'settled' });
    pair(c, report, receipt, outcome); expect(receipt.status).toBe('stored'); expect((await storage.readRecord(receipt.reference!))?.result).toBeUndefined(); c.addAssistantResponse([]);
    await expect(c.rollover({ preserveRecentTurns: 0, summarize: async () => 'lossy' })).rejects.toThrow('unacknowledged'); expect(JSON.stringify(c.getState())).toContain(raw.body);
  });
  it.each([null, { id: 'RETAIN_SOURCE_914', body: '[REDACTED]' }])('allows acknowledged result-bearing redaction %j', async result => {
    const storage = new InMemoryEvidenceStorage({ scope }), c = context(storage); const report = await failed(c, storage); const recovered = await new ToolEvidenceMiddleware({ storage, redact: (v, kind) => kind === 'result' ? result : v }).record(probe(), {}, { userId: scope.ownerId }, report.outcome, { value: raw }); pair(c, report, recovered); c.addAssistantResponse([]);
    expect((await c.rollover({ preserveRecentTurns: 0, summarize: async () => 'stored' })).performed).toBe(true); expect((await storage.readRecord(recovered.reference!))?.result).toEqual(result);
  });
  it.each([undefined, 'business failure'])('blocks receipt-only explicit async continuation (error=%s)', async error => {
    const { agent, storage, packets } = fixture(); const report = await agent.tools.executeWithOutcome('probe_0', {}, { callId: 'call-0' }); vi.restoreAllMocks();
    const receipt = await new ToolEvidenceMiddleware({ storage }).record(probe('probe_0'), {}, { userId: scope.ownerId }, report.outcome); const { projection: _, ...metadata } = receipt;
    await expect(agent.continueWithAsyncResults([{ tool_use_id: 'call-0', content: raw, state: 'completed' as never, evidence: receipt, outcome: { ...report.outcome, evidence: metadata }, error }])).rejects.toThrow('unacknowledged'); expect(packets).toHaveLength(0);
  });
  it('retains a native queued result after receipt-only repair, then resumes with a full observation', async () => {
    const { agent, storage, tools, packets } = fixture(); let executions = 0; tools[0]!.definition.blocking = false; let release!: () => void; const ready = new Promise<void>(resolve => { release = resolve; }); tools[0]!.execute = async () => { executions++; await ready; return raw; }; agent.tools.register(tools[0]!);
    const completed: ToolResult[] = []; agent.on('async:tool:complete', e => completed.push(e.result)); await agent.run('background'); release(); await vi.waitFor(() => expect(completed).toHaveLength(1)); vi.restoreAllMocks(); const original = completed[0]!;
    const middleware = new ToolEvidenceMiddleware({ storage }); const receipt = await middleware.record(tools[0]!, {}, { userId: scope.ownerId }, original.outcome!); const { projection: _, ...metadata } = receipt; original.evidence = receipt; original.outcome = { ...original.outcome!, evidence: metadata };
    await expect(agent.continueWithAsyncResults()).rejects.toThrow('unacknowledged'); expect(packets).toHaveLength(2);
    const recovery = await middleware.record(tools[0]!, {}, { userId: scope.ownerId }, original.outcome, { value: raw }); const { projection: _unused, ...fullMetadata } = recovery; original.evidence = recovery; original.outcome = { ...original.outcome, evidence: fullMetadata };
    await agent.continueWithAsyncResults(); expect(executions).toBe(1); await expect(agent.continueWithAsyncResults()).rejects.toThrow('No async results');
  });
});

describe('T3 restoration reconciles invocation identity after receipt changes', () => {
  for (const method of ['restoreState', 'load'] as const) it.each(['live-stored', 'snapshot-stored'] as const)(`${method} resolves %s receipt transition`, async transition => {
    const storage = new InMemoryEvidenceStorage({ scope }), sessionStorage = await sessions(), c = context(storage, sessionStorage); const report = await failed(c, storage); pair(c, report); const state = c.getState(); const recovered = await new ToolEvidenceMiddleware({ storage }).record(probe(), {}, { userId: scope.ownerId }, report.outcome, { value: raw });
    if (transition === 'live-stored') await c.acknowledgeToolEvidence('call', recovered.reference!); else for (const result of contents(state.conversation)) if (result.type === ContentType.TOOL_RESULT) result.evidence = { version: 1, executionId: report.outcome.executionId, status: 'stored', reference: recovered.reference };
    if (method === 'load') { await sessionStorage.save('checkpoint', state); await c.load('checkpoint'); } else c.restoreState(state);
    expect(contents(retained(c)).filter(result => result.type === ContentType.TOOL_RESULT)).toHaveLength(1); expect(JSON.stringify((await c.prepare()).input)).toContain(raw.body);
    if (transition === 'live-stored') expect(await c.acknowledgeToolEvidence('call', recovered.reference!)).toBe(1);
    expect((await c.rollover({ preserveRecentTurns: 0, summarize: async () => 'stored' })).performed).toBe(true);
  });
  it('keeps unrelated text and custom results while reconciling function results with the same call ID', async () => {
    const storage = new InMemoryEvidenceStorage({ scope }), c = context(storage); const report = await failed(c, storage); pair(c, report); const state = c.getState();
    const pending = c.getCurrentInput()[0]!; if (pending.type !== 'message') throw Error('fixture'); pending.content.push({ type: ContentType.INPUT_TEXT, text: 'UNRELATED_PENDING' }, { type: ContentType.CUSTOM_TOOL_RESULT, tool_use_id: 'call', content: 'CUSTOM_PENDING', evidence: { version: 1, executionId: report.outcome.executionId, status: 'storage_failed' } });
    c.restoreState(state); expect(contents(retained(c)).filter(r => r.type === ContentType.TOOL_RESULT)).toHaveLength(1); expect(JSON.stringify(c.getCurrentInput())).toContain('UNRELATED_PENDING'); expect(JSON.stringify(c.getCurrentInput())).toContain('CUSTOM_PENDING');
  });
  it('retains separate invocations and legacy pending input', async () => {
    const storage = new InMemoryEvidenceStorage({ scope }), c = context(storage); const report = await failed(c, storage); pair(c, report); const state = c.getState(); const pending = contents(c.getCurrentInput()).find(r => r.type === ContentType.TOOL_RESULT)!; if (pending.type !== ContentType.TOOL_RESULT) throw Error('fixture'); pending.evidence = { ...pending.evidence!, executionId: 'another-invocation' }; c.restoreState(state); expect(c.getCurrentInput()).toHaveLength(1);
    const legacy = context(undefined, undefined, false); legacy.addUserMessage('legacy input'); legacy.restoreState({ ...state, pluginStates: {} }); expect(JSON.stringify(legacy.getCurrentInput())).toContain('legacy input');
  });
});
