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
import type { ToolFunction, ToolExecutionReport } from '@/domain/entities/Tool.js';
import type { IContextStorage, SerializedContextState } from '@/domain/interfaces/IContextStorage.js';
import type { ITextProvider, TextGenerateOptions } from '@/domain/interfaces/ITextProvider.js';
import type { StreamEvent } from '@/domain/entities/StreamEvent.js';
import type { LLMResponse } from '@/domain/entities/Response.js';
import { OpenAIResponsesConverter } from '@/infrastructure/providers/openai/OpenAIResponsesConverter.js';
import { AnthropicConverter } from '@/infrastructure/providers/anthropic/AnthropicConverter.js';
import { GoogleConverter } from '@/infrastructure/providers/google/GoogleConverter.js';

const scope = { ownerId: 'alice', namespace: 'second-corrections' };
const raw = { operationId: 'WRITE_ONCE_731', detail: 'exact retained observation '.repeat(1000) };
const contexts: AgentContextNextGen[] = []; const agents: Agent[] = []; const dirs: string[] = []; const connectors: string[] = [];
afterEach(async () => { agents.splice(0).forEach(a => a.destroy()); contexts.splice(0).forEach(c => c.destroy()); connectors.splice(0).forEach(n => Connector.remove(n)); vi.restoreAllMocks(); await Promise.all(dirs.splice(0).map(d => rm(d, { recursive: true, force: true }))); });
function tool(): ToolFunction { return { definition: { type: 'function', function: { name: 'probe', parameters: { type: 'object', properties: {} } } }, execute: async () => raw, output: { effect: 'write', summarize: () => 'Write accepted' } }; }
function context(storage = new InMemoryEvidenceStorage({ scope }), sessions?: IContextStorage, enabled = true) {
  const c = AgentContextNextGen.create({ model: 'gpt-4o-mini', userId: scope.ownerId, agentId: 'second', storage: sessions,
    features: { workingMemory: false, inContextMemory: false, evidence: enabled }, plugins: { evidence: { storage } } }); contexts.push(c); return c;
}
function addPair(c: AgentContextNextGen, r: ToolExecutionReport, shape: 'both' | 'delivery' | 'outcome' = 'both', mixed = false) {
  c.addUserMessage('write once'); c.addAssistantResponse([{ type: 'message', role: MessageRole.ASSISTANT, content: [{ type: ContentType.TOOL_USE, id: 'call', name: 'probe', arguments: '{}' }, ...(mixed ? [{ type: ContentType.TOOL_USE as const, id: 'other', name: 'probe', arguments: '{}' }] : [])] }]);
  c.addToolResults([{ tool_use_id: 'call', content: r.result, state: 'completed' as never, ...(shape !== 'delivery' ? { outcome: r.outcome } : {}), ...(shape !== 'outcome' ? { evidence: r.evidence } : {}) }, ...(mixed ? [{ tool_use_id: 'other', content: 'OTHER_RESULT', state: 'completed' as never }] : [])]);
}
async function failed(c: AgentContextNextGen, storage: InMemoryEvidenceStorage) { c.tools.register(tool()); vi.spyOn(storage, 'put').mockRejectedValue(new Error('offline')); return c.tools.executeWithOutcome('probe', {}, { callId: 'call', runId: 'run' }); }
const text = (c: AgentContextNextGen) => JSON.stringify([...c.getConversation(), ...c.getCurrentInput()]);

describe('S1 protected pending input survives replacement', () => {
  for (const operation of ['addUserMessage', 'setCurrentInput', 'addToolResults'] as const) {
    it.each([false, true])(`${operation} retains complete failed-evidence groups (mixed=%s)`, async mixed => {
      const storage = new InMemoryEvidenceStorage({ scope }); const c = context(storage); const report = await failed(c, storage); addPair(c, report, 'both', mixed);
      if (operation === 'addToolResults') c.addToolResults([{ tool_use_id: 'new', content: 'FOLLOW_UP', state: 'completed' as never }]); else c[operation]('FOLLOW_UP');
      expect(JSON.stringify(c.getConversation())).toContain(raw.detail); expect(text(c)).toContain(report.outcome.executionId); expect(text(c)).toContain('storage_failed');
      if (mixed) expect(JSON.stringify(c.getConversation())).toContain('OTHER_RESULT');
      c.addAssistantResponse([]); await expect(c.rollover({ preserveRecentTurns: 0, summarize: async () => 'lossy' })).rejects.toThrow('unacknowledged');
    });
  }
  it('retains protected input even when an insertion observer throws', async () => {
    const storage = new InMemoryEvidenceStorage({ scope }); const c = context(storage); addPair(c, await failed(c, storage));
    c.on('message:added', () => { throw new Error('observer'); }); expect(() => c.setCurrentInput('async')).toThrow('observer'); expect(text(c)).toContain(raw.detail);
  });
  it('preserves legacy evidence-disabled input replacement and snapshot shape', () => {
    const c = context(undefined, undefined, false); c.addUserMessage('legacy pending'); expect(c.getState().conversation).toHaveLength(0); c.setCurrentInput('replacement'); expect(text(c)).not.toContain('legacy pending');
  });
});

describe('S2 optional outcome and authentic delivery correlation', () => {
  for (const status of ['stored', 'storage_failed', 'projection_failed'] as const) {
    it.each(['both', 'delivery', 'outcome'] as const)(`${status} preserves retention metadata with %s`, async shape => {
      const storage = new InMemoryEvidenceStorage({ scope }); const c = context(storage); const probe = tool(); if (status === 'projection_failed') probe.output!.summarize = () => { throw new Error('summary'); }; c.tools.register(probe);
      if (status === 'storage_failed') vi.spyOn(storage, 'put').mockRejectedValueOnce(new Error('offline'));
      const report = await c.tools.executeWithOutcome('probe', {}, { callId: 'call' }); addPair(c, report, shape);
      const metadata = JSON.stringify(c.getCurrentInput()); expect(metadata).toContain(report.outcome.executionId); expect(metadata).toContain(status);
      c.addAssistantResponse([]);
      if (status === 'storage_failed') { await expect(c.rollover({ preserveRecentTurns: 0, summarize: async () => 'lossy' })).rejects.toThrow('unacknowledged'); const recovery = await new ToolEvidenceMiddleware({ storage }).record(probe, {}, { userId: scope.ownerId }, report.outcome, { value: raw }); expect(await c.acknowledgeToolEvidence('call', recovery.reference!)).toBe(1); }
      expect((await c.rollover({ preserveRecentTurns: 0, summarize: async () => 'stored' })).performed).toBe(true);
    });
  }
  it.each(['copy', 'forged', 'foreign', 'wrong-call'])('does not authorize projection/receipts from %s delivery', async kind => {
    const storage = new InMemoryEvidenceStorage({ scope: kind === 'foreign' ? { ...scope, namespace: 'foreign' } : scope }); const source = context(storage); source.tools.register(tool()); const report = await source.tools.executeWithOutcome('probe', {}, { callId: kind === 'wrong-call' ? 'other' : 'call' });
    const c = context(); const evidence = kind === 'copy' ? { ...report.evidence! } : kind === 'forged' ? { ...report.evidence!, projection: 'FORGED' } : report.evidence;
    addPair(c, { ...report, evidence }, 'delivery'); expect(JSON.stringify(c.getCurrentInput())).toContain(raw.detail); expect(JSON.stringify(c.getCurrentInput())).not.toContain(report.outcome.executionId);
  });
  it('does not let a conflicting host outcome discard an authentic failed delivery', async () => {
    const storage = new InMemoryEvidenceStorage({ scope }); const c = context(storage); const report = await failed(c, storage);
    addPair(c, { ...report, outcome: { ...report.outcome, evidence: { status: 'stored', effect: 'write' } } }); c.addAssistantResponse([]);
    await expect(c.rollover({ preserveRecentTurns: 0, summarize: async () => 'lossy' })).rejects.toThrow('unacknowledged');
  });
  it('keeps legacy tool results without either optional field valid', () => {
    const c = context(); c.addToolResults([{ tool_use_id: 'call', content: raw, state: 'completed' as never }]); expect(text(c)).toContain(raw.detail); expect(text(c)).not.toContain('"evidence"');
  });
  it('preserves delivery-only raw data when request preparation cannot fit', async () => {
    const storage = new InMemoryEvidenceStorage({ scope }); const c = context(storage); addPair(c, await failed(c, storage), 'delivery'); c.addAssistantResponse([]); c.setCurrentInput('Continue without repeating the action');
    await expect(c.prepare({ modelMaxContextTokens: 1000 })).rejects.toThrow('cannot fit');
    expect(text(c)).toContain(raw.detail); expect(text(c)).toContain('storage_failed');
  });
});

describe('S3 snapshots preserve pending unacknowledged observations', () => {
  it.each(['restoreState', 'load'] as const)('%s of the same pending snapshot does not duplicate a result', async method => {
    let state: SerializedContextState;
    const sessions = { save: async (_id: string, s: SerializedContextState) => { state = structuredClone(s); }, load: async () => ({ state: structuredClone(state) }) } as unknown as IContextStorage;
    const storage = new InMemoryEvidenceStorage({ scope }); const c = context(storage, sessions); addPair(c, await failed(c, storage));
    if (method === 'load') { await c.save('same'); await c.load('same'); } else c.restoreState(c.getState());
    const results = [...c.getConversation(), ...c.getCurrentInput()].flatMap(item => item.type === 'message' ? item.content : []).filter(content => content.type === ContentType.TOOL_RESULT);
    expect(results).toHaveLength(1); expect(text(c)).toContain(raw.detail);
  });
  it('takes detached, repeatable snapshots without committing or duplicating active input', async () => {
    const storage = new InMemoryEvidenceStorage({ scope }); const c = context(storage); addPair(c, await failed(c, storage), 'delivery', true);
    const before = JSON.stringify(c.getConversation()), pending = JSON.stringify(c.getCurrentInput()); const first = c.getState(), second = c.getState();
    expect(JSON.stringify(first.conversation)).toContain(raw.detail); expect(first.conversation).toEqual(second.conversation); expect(JSON.stringify(c.getConversation())).toBe(before); expect(JSON.stringify(c.getCurrentInput())).toBe(pending);
    c.getCurrentInput().forEach(item => { if (item.type === 'message') item.content.forEach(content => { if (content.type === ContentType.TOOL_RESULT) content.content = 'later mutation'; }); });
    expect(JSON.stringify(first.conversation)).toContain(raw.detail); expect(first.conversation).not.toBe(second.conversation);
  });
  it.each(['file', 'journal-free'] as const)('save/load with %s storage supports exact host recovery', async kind => {
    const directory = await mkdtemp(join(tmpdir(), 'evidence-second-save-')); dirs.push(directory); let state: SerializedContextState;
    const sessions = kind === 'file' ? new FileContextStorage({ agentId: 'second', baseDirectory: directory }) : { save: async (_id: string, value: SerializedContextState) => { state = structuredClone(value); }, load: async () => ({ state: structuredClone(state) }) } as unknown as IContextStorage;
    const storage = new InMemoryEvidenceStorage({ scope }); const c = context(storage, sessions), restored = context(storage, sessions); const report = await failed(c, storage); addPair(c, report, 'delivery'); const pending = JSON.stringify(c.getCurrentInput());
    await c.save('recovery'); await c.save('recovery'); expect(JSON.stringify(c.getCurrentInput())).toBe(pending); expect(await restored.load('recovery')).toBe(true); expect(text(restored)).toContain(raw.detail);
    expect(restored.getConversation().flatMap(item => item.type === 'message' ? item.content : []).filter(content => content.type === ContentType.TOOL_RESULT)).toHaveLength(1);
    await expect(restored.rollover({ preserveRecentTurns: 0, summarize: async () => 'lossy' })).rejects.toThrow('unacknowledged'); vi.restoreAllMocks();
    const recovery = await new ToolEvidenceMiddleware({ storage }).record(tool(), {}, { userId: scope.ownerId }, report.outcome, { value: raw }); expect(await restored.acknowledgeToolEvidence('call', recovery.reference!)).toBe(1);
    expect((await restored.rollover({ preserveRecentTurns: 0, summarize: async () => 'stored' })).performed).toBe(true); expect((await storage.readRecord(recovery.reference!))?.result).toEqual(raw);
  });
});

function response(call: boolean): LLMResponse { return { id: 'r', object: 'response', created_at: 1, model: 'gpt-4o-mini', status: 'completed', output_text: call ? '' : 'done', output: [{ type: 'message', role: MessageRole.ASSISTANT, content: call ? [{ type: ContentType.TOOL_USE, id: 'call', name: 'probe', arguments: '{}' }] : [{ type: ContentType.OUTPUT_TEXT, text: 'done' }] }], usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } }; }
function agentFixture(storage: InMemoryEvidenceStorage, sessions?: IContextStorage) {
  const packets: TextGenerateOptions[] = []; const provider: ITextProvider = { name: 'second', capabilities: { text: true, images: false, audio: false, videos: false },
    generate: vi.fn(async options => { packets.push(structuredClone(options)); if (packets.length === 1) return response(true); throw new Error('provider interrupted'); }),
    streamGenerate: vi.fn(async function* (options: TextGenerateOptions): AsyncGenerator<StreamEvent> { packets.push(structuredClone(options)); if (packets.length > 1) throw new Error('provider interrupted'); yield { type: StreamEventType.TOOL_CALL_START, response_id: 'r', item_id: 'i', tool_call_id: 'call', tool_name: 'probe' }; yield { type: StreamEventType.TOOL_CALL_ARGUMENTS_DONE, response_id: 'r', tool_call_id: 'call', tool_name: 'probe', arguments: '{}' }; yield { type: StreamEventType.RESPONSE_COMPLETE, response_id: 'r', status: 'completed', usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 }, iterations: 1 }; }),
    getModelCapabilities: () => ({ supportsTools: true, supportsVision: false, supportsJSON: true, supportsJSONSchema: true, maxTokens: 128000, maxInputTokens: 128000, maxOutputTokens: 1024 }), validateConfig: async () => true, listModels: async () => [] };
  const name = `second-${connectors.length}`; connectors.push(name); Connector.create({ name, vendor: Vendor.OpenAI, auth: { type: 'none' }, options: { provider } });
  const probe = tool(); probe.execute = vi.fn(probe.execute);
  const agent = Agent.create({ connector: name, model: 'gpt-4o-mini', userId: scope.ownerId, tools: [probe], maxIterations: 3, emptyResponseRetry: { enabled: false }, asyncTools: { autoContinue: false },
    context: { model: 'gpt-4o-mini', storage: sessions, features: { workingMemory: false, inContextMemory: false, evidence: true }, plugins: { evidence: { storage } } } }); agents.push(agent); return { agent, provider, packets, probe };
}
describe('managed interruption and mixed async integration', () => {
  it.each(['run', 'stream'] as const)('%s interrupted after a failed evidence write saves recoverable input', async mode => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-second-save-')); dirs.push(directory); const sessions = new FileContextStorage({ agentId: 'second', baseDirectory: directory }); const storage = new InMemoryEvidenceStorage({ scope }); const { agent, probe } = agentFixture(storage, sessions); vi.spyOn(storage, 'put').mockRejectedValue(new Error('offline'));
    const consume = async () => { if (mode === 'run') await agent.run('once'); else for await (const _event of agent.stream('once')) { /* drain */ } };
    await expect(consume()).rejects.toThrow('provider interrupted'); expect(JSON.stringify(agent.context.getCurrentInput())).toContain(raw.detail); await agent.saveSession('interrupted');
    const restored = agentFixture(storage, sessions).agent; expect(await restored.loadSession('interrupted')).toBe(true); expect(text(restored.context)).toContain(raw.detail); expect(probe.execute).toHaveBeenCalledTimes(1);
    expect(JSON.stringify((await sessions.load('interrupted'))?.state)).toContain(raw.detail);
  });
  it.each(['continue', 'new-run'] as const)('%s preserves interrupted protected input before a new request', async operation => {
    const storage = new InMemoryEvidenceStorage({ scope }); const { agent, packets, provider } = agentFixture(storage); vi.spyOn(storage, 'put').mockRejectedValue(new Error('offline')); await expect(agent.run('once')).rejects.toThrow('provider interrupted');
    vi.mocked(provider.generate).mockImplementationOnce(async options => { packets.push(structuredClone(options)); return response(false); });
    if (operation === 'continue') await agent.continueWithAsyncResults([{ tool_use_id: 'background', tool_name: 'background', content: 'ready', state: 'completed' as never }]); else await agent.run('follow up');
    expect(JSON.stringify(packets.at(-1)!.input)).toContain(raw.detail); expect(text(agent.context)).toContain(raw.detail); expect(text(agent.context)).toContain('storage_failed');
  });
  it.each(['cancel', 'fit'] as const)('retains pending data for save after %s stops the next request', async reason => {
    const storage = new InMemoryEvidenceStorage({ scope }); const { agent, probe, provider } = agentFixture(storage); vi.spyOn(storage, 'put').mockRejectedValue(new Error('offline'));
    agent.registerHook('after:tool', async () => { if (reason === 'cancel') agent.cancel(); return {}; });
    // Restrict the second preparation without changing the first request's tool dispatch.
    if (reason === 'fit') { const prepare = agent.context.prepare.bind(agent.context); vi.spyOn(agent.context, 'prepare').mockImplementation(options => prepare({ ...options, ...(JSON.stringify(agent.context.getCurrentInput()).includes(raw.detail) ? { modelMaxContextTokens: 1000 } : {}) })); }
    await expect(agent.run('once')).rejects.toThrow(reason === 'fit' ? 'cannot fit' : 'cancelled'); expect(JSON.stringify(await agent.getContextState())).toContain(raw.detail); expect(probe.execute).toHaveBeenCalledTimes(1); expect(provider.generate).toHaveBeenCalledTimes(1);
  });
  it.each([false, true])('mixed background/blocking results remain intact (background settles first=%s)', async first => {
    const storage = new InMemoryEvidenceStorage({ scope }); const { agent, provider, packets, probe } = agentFixture(storage); const originalPut = storage.put.bind(storage); vi.spyOn(storage, 'put').mockImplementation(record => record.source.toolName === 'probe' ? Promise.reject(new Error('offline')) : originalPut(record));
    let release!: () => void, completed!: () => void; const background = new Promise<void>(resolve => { release = resolve; }); const ready = new Promise<void>(resolve => { completed = resolve; });
    agent.tools.register({ definition: { type: 'function', blocking: false, function: { name: 'background', parameters: { type: 'object', properties: {} } } }, execute: async () => { if (!first) await background; return { ready: true }; } });
    agent.on('async:tool:complete', () => completed()); vi.mocked(probe.execute).mockImplementationOnce(async () => { if (first) await ready; return raw; });
    // The registered tool holds the same function captured by register(); re-register for the new implementation.
    agent.tools.register(probe);
    if (!first) agent.registerHook('after:tool', async () => { release(); await ready; return {}; });
    vi.mocked(provider.generate).mockImplementation(async options => { packets.push(structuredClone(options)); if (packets.length !== 1) return response(false); const r = response(true); if (r.output[0]?.type === 'message') r.output[0].content.unshift({ type: ContentType.TOOL_USE, id: 'background', name: 'background', arguments: '{}' }); return r; });
    await agent.run('both'); expect(probe.execute).toHaveBeenCalledTimes(1); expect(JSON.stringify(packets[1]!.input)).toContain(raw.detail); expect(text(agent.context)).toContain(raw.detail); expect(text(agent.context)).toContain('storage_failed');
    const packet = packets[1]!;
    const converted = [new OpenAIResponsesConverter().convertInput(packet.input), new AnthropicConverter().convertRequest(packet), await new GoogleConverter().convertRequest(packet)];
    for (const request of converted) expect(JSON.stringify(request)).toContain(raw.detail);
    await expect(agent.context.rollover({ preserveRecentTurns: 0, summarize: async () => 'lossy' })).rejects.toThrow('unacknowledged');
  });
});
