import { afterEach, describe, expect, it, vi } from 'vitest';
import { Agent } from '@/core/Agent.js';
import { Connector } from '@/core/Connector.js';
import { Vendor } from '@/core/Vendor.js';
import { InMemoryEvidenceStorage } from '@/infrastructure/storage/EvidenceStorage.js';
import { ContentType } from '@/domain/entities/Content.js';
import { MessageRole } from '@/domain/entities/Message.js';
import { StreamEventType } from '@/domain/entities/StreamEvent.js';
import type { LLMResponse } from '@/domain/entities/Response.js';
import type { StreamEvent } from '@/domain/entities/StreamEvent.js';
import type { TextGenerateOptions } from '@/domain/interfaces/ITextProvider.js';
import type { ToolFunction, ToolResult } from '@/domain/entities/Tool.js';

const raw = { ids: ['RECORD_17'], status: 'found', rows: 'EXACT_SOURCE'.repeat(2000) };
const scope = { ownerId: 'alice', namespace: 'managed' };
const agents: Agent[] = [];
afterEach(() => { agents.splice(0).forEach(a => a.destroy()); Connector.remove('evidence-fixture'); vi.restoreAllMocks(); });
function response(call: boolean): LLMResponse {
  return { id: 'response', object: 'response', model: 'gpt-4o-mini', created_at: 1, status: 'completed', output_text: call ? '' : 'VERIFIED',
    output: [{ type: 'message', role: MessageRole.ASSISTANT, content: call ? [{ type: ContentType.TOOL_USE, id: 'call', name: 'lookup', arguments: '{}' }] : [{ type: ContentType.OUTPUT_TEXT, text: 'VERIFIED' }] }],
    usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } };
}
function fixture(enabled = true, extra = {}) {
  const packets: TextGenerateOptions[] = []; const storage = new InMemoryEvidenceStorage({ scope });
  const provider = { name: 'fixture', capabilities: { text: true, images: false, videos: false, audio: false },
    generate: vi.fn(async (options: TextGenerateOptions) => { packets.push(structuredClone(options)); return response(packets.length === 1); }),
    streamGenerate: vi.fn(async function* (options: TextGenerateOptions): AsyncGenerator<StreamEvent> {
      packets.push(structuredClone(options));
      if (packets.length === 1) {
        yield { type: StreamEventType.TOOL_CALL_START, response_id: 'response', item_id: 'item', tool_call_id: 'call', tool_name: 'lookup' };
        yield { type: StreamEventType.TOOL_CALL_ARGUMENTS_DONE, response_id: 'response', tool_call_id: 'call', tool_name: 'lookup', arguments: '{}' };
      } else yield { type: StreamEventType.OUTPUT_TEXT_DELTA, response_id: 'response', item_id: 'item', output_index: 0, content_index: 0, sequence_number: 0, delta: 'VERIFIED' };
      yield { type: StreamEventType.RESPONSE_COMPLETE, response_id: 'response', status: 'completed', usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 }, iterations: 1 };
    }),
    getModelCapabilities: () => ({ supportsTools: true, supportsVision: false, supportsJSON: true, supportsJSONSchema: true, maxTokens: 128000, maxInputTokens: 128000, maxOutputTokens: 1024 }),
    validateConfig: async () => true, listModels: async () => [], destroy: vi.fn() };
  Connector.create({ name: 'evidence-fixture', vendor: Vendor.OpenAI, auth: { type: 'none' }, options: { provider } });
  const execute = vi.fn(async () => raw);
  const tool: ToolFunction = { definition: { type: 'function', function: { name: 'lookup', parameters: { type: 'object', properties: {}, additionalProperties: false } } }, execute,
    output: { effect: 'read', expectedSize: 'large', summarize: value => JSON.stringify({ ids: (value as typeof raw).ids, status: (value as typeof raw).status }) } };
  const agent = Agent.create({ connector: 'evidence-fixture', model: 'gpt-4o-mini', userId: 'alice', tools: [tool], maxIterations: 3, emptyResponseRetry: { enabled: false }, thinking: { enabled: false },
    context: { model: 'gpt-4o-mini', features: { workingMemory: false, inContextMemory: false, evidence: enabled }, plugins: { evidence: { storage } } }, ...extra });
  agents.push(agent); return { agent, packets, storage, execute, tool, provider };
}
describe('managed evidence prompt and raw event contracts', () => {
  for (const mode of ['run', 'stream'] as const) {
    it(`${mode} sends acknowledged projection to the model and raw content to application listeners`, async () => {
      const { agent, packets, storage, execute } = fixture(); const completed: ToolResult[] = []; const streamResults: unknown[] = [];
      agent.on('tool:complete', e => completed.push(e.result));
      if (mode === 'run') expect((await agent.run('look up')).output_text).toBe('VERIFIED');
      else for await (const event of agent.stream('look up')) if (event.type === StreamEventType.TOOL_EXECUTION_DONE) streamResults.push(event.result);
      expect(packets).toHaveLength(2); const selected = JSON.stringify(packets[1]!.input); expect(selected).toContain('RECORD_17'); expect(selected).not.toContain(raw.rows); expect(selected).toContain('sha256');
      expect(completed[0]!.content).toBe(raw); if (mode === 'stream') expect(streamResults).toEqual([raw]);
      expect(execute).toHaveBeenCalledTimes(1); expect(agent.tools).toBe(agent.context.tools); expect((await storage.readRecord(completed[0]!.evidence!.reference!))?.result).toEqual(raw);
    });
    it(`${mode} with evidence disabled preserves legacy packets/events and performs no writes`, async () => {
      const { agent, packets, storage } = fixture(false); const put = vi.spyOn(storage, 'put'); const completed: ToolResult[] = []; agent.on('tool:complete', e => completed.push(e.result));
      if (mode === 'run') await agent.run('lookup'); else for await (const _event of agent.stream('lookup')) { /* drain */ }
      expect(JSON.stringify(packets[1]!.input)).toContain(raw.rows); expect(completed[0]).not.toHaveProperty('evidence'); expect(completed[0]!.outcome).not.toHaveProperty('evidence'); expect(put).not.toHaveBeenCalled();
    });
    it(`${mode} falls back to raw after evidence write failure without repeating a successful action`, async () => {
      const { agent, packets, storage, execute } = fixture(); vi.spyOn(storage, 'put').mockRejectedValue(new Error('storage unavailable'));
      if (mode === 'run') await agent.run('lookup'); else for await (const _event of agent.stream('lookup')) { /* drain */ }
      expect(JSON.stringify(packets[1]!.input)).toContain(raw.rows); expect(execute).toHaveBeenCalledTimes(1); expect(agent.getMetrics()).toMatchObject({ toolSuccessCount: 1, toolFailureCount: 0 });
    });
  }
  it('does not overwrite a host after-tool content modification with an older projection', async () => {
    const { agent, packets } = fixture(true, { hooks: { 'after:tool': async () => ({ modified: { content: 'HOST_REPLACEMENT' } }) } });
    await agent.run('lookup'); expect(JSON.stringify(packets[1]!.input)).toContain('HOST_REPLACEMENT'); expect(JSON.stringify(packets[1]!.input)).not.toContain('RECORD_17');
  });
  it('uses projected content for explicit asynchronous continuation without changing its raw event', async () => {
    const { agent, packets, provider } = fixture(); const report = await agent.tools.executeWithOutcome('lookup', {});
    provider.generate.mockImplementationOnce(async options => { packets.push(structuredClone(options)); return response(false); });
    // Continue with a host-provided completed result, through the normal owned continuation path.
    const first = await agent.continueWithAsyncResults([{ tool_use_id: 'call', tool_name: 'lookup', content: raw, state: 'completed' as never, evidence: report.evidence }]);
    expect(first).toBeDefined(); expect(JSON.stringify(packets[0]!.input)).not.toContain(raw.rows); expect(JSON.stringify(packets[0]!.input)).toContain('RECORD_17');
  });
});

describe('async evidence failure dispatch boundary', () => {
  it.each([undefined, 'EXTERNAL_FAILURE'])('retains the host-owned raw completion and stops continuation on failed storage (error=%s)', async error => {
    const { agent, provider, storage } = fixture(); vi.spyOn(storage, 'put').mockRejectedValue(new Error('offline'));
    const report = await agent.tools.executeWithOutcome('lookup', {});
    const result: ToolResult = { tool_use_id: 'call', tool_name: 'lookup', content: raw, error, state: 'completed' as never, outcome: report.outcome, evidence: report.evidence };
    await expect(agent.continueWithAsyncResults([result])).rejects.toThrow('unacknowledged evidence');
    expect(provider.generate).not.toHaveBeenCalled(); expect(result.content).toBe(raw);
  });
});


describe('disabled evidence and existing after-tool hook shape', () => {
  it('preserves legacy result keys when the host changes tool content', async () => {
    const { agent } = fixture(false, { hooks: { 'after:tool': async () => ({ modified: { content: 'HOST_RESULT' } }) } });
    const execute = vi.spyOn(agent.tools, 'execute');
    const completed: ToolResult[] = []; agent.on('tool:complete', e => completed.push(e.result)); await agent.run('lookup');
    expect(execute.mock.calls[0]![2]).not.toHaveProperty('onEvidence');
    expect(completed[0]!.content).toBe('HOST_RESULT'); expect(completed[0]).not.toHaveProperty('evidence');
  });
});

describe('R1 queued async evidence recovery', () => {
  it.each([false, true])('retains a native completion until host repair (autoContinue=%s)', async autoContinue => {
    const { agent, provider, storage, execute, tool } = fixture(true, { asyncTools: { autoContinue } });
    tool.definition.blocking = false;
    let release!: (value: typeof raw) => void; execute.mockImplementationOnce(async () => new Promise<typeof raw>(resolve => { release = resolve; }));
    const failedPut = vi.spyOn(storage, 'put').mockRejectedValue(new Error('offline'));
    const completed: ToolResult[] = []; agent.on('async:tool:complete', e => completed.push(e.result));
    await agent.run('background'); const continuation = vi.spyOn(agent, 'continueWithAsyncResults');
    release(raw); await vi.waitFor(() => expect(completed).toHaveLength(1));
    if (autoContinue) { await new Promise(resolve => setTimeout(resolve, 25)); expect(continuation).not.toHaveBeenCalled(); }
    await expect(agent.continueWithAsyncResults()).rejects.toThrow('unacknowledged evidence'); expect(provider.generate).toHaveBeenCalledTimes(2);
    failedPut.mockRestore(); const retained = completed[0]!;
    const { ToolEvidenceMiddleware } = await import('@/core/evidence/ToolEvidenceMiddleware.js');
    const recovery = await new ToolEvidenceMiddleware({ storage }).record(tool, {}, { userId: 'alice' }, retained.outcome!, { value: retained.content });
    retained.evidence = recovery; const { projection: _projection, ...receipt } = recovery;
    retained.outcome = { ...retained.outcome!, evidence: receipt };
    expect((await agent.continueWithAsyncResults()).output_text).toBe('VERIFIED');
    expect(execute).toHaveBeenCalledTimes(1); expect(provider.generate).toHaveBeenCalledTimes(3);
    await expect(agent.continueWithAsyncResults()).rejects.toThrow('No async results');
  });
});

describe('R5 mutable after-tool hooks preserve the host result view', () => {
  for (const mode of ['run', 'stream'] as const) {
    for (const modification of ['nested', 'direct-replacement', 'unchanged', 'metadata-only', 'throw'] as const) {
      it(`${mode} handles ${modification} hooks without stale projections`, async () => {
        const ownRaw = structuredClone(raw);
        const hook = async (ctx: { result: ToolResult }) => {
          if (modification === 'throw') throw new Error('synthetic hook failure');
          if (modification === 'nested') { ctx.result.content.ids[0] = 'HOST_CHANGED_ID'; return { modified: { content: ctx.result.content } }; }
          if (modification === 'direct-replacement') { ctx.result.content = { ids: ['HOST_CHANGED_ID'], rows: 'host' }; return {}; }
          return modification === 'metadata-only' ? { modified: { executionTime: 123 } } : {};
        };
        const { agent, packets, execute } = fixture(true, { hooks: { 'after:tool': hook } }); execute.mockResolvedValue(ownRaw);
        const completed: ToolResult[] = []; agent.on('tool:complete', e => completed.push(e.result));
        if (mode === 'run') await agent.run('lookup'); else for await (const _event of agent.stream('lookup')) { /* drain */ }
        const packet = JSON.stringify(packets[1]!.input);
        if (modification === 'nested' || modification === 'direct-replacement') {
          expect(packet).toContain('HOST_CHANGED_ID'); expect(packet).not.toContain('RECORD_17'); expect(completed[0]).not.toHaveProperty('evidence');
        } else { expect(packet).toContain('RECORD_17'); expect(packet).not.toContain(ownRaw.rows); }
        if (modification !== 'direct-replacement') expect(completed[0]!.content).toBe(ownRaw);
        expect(execute).toHaveBeenCalledTimes(1);
      });
    }
  }
});

describe('native async delivery before and after context insertion', () => {
  it.each(['before', 'after'])('handles a host %s-injection exception without losing an undelivered completion', async point => {
    const { agent, execute, tool, provider } = fixture(true, { asyncTools: { autoContinue: false } }); tool.definition.blocking = false;
    let release!: (value: typeof raw) => void; execute.mockImplementationOnce(async () => new Promise<typeof raw>(resolve => { release = resolve; }));
    const completed: ToolResult[] = []; agent.on('async:tool:complete', e => completed.push(e.result)); await agent.run('background'); release(raw); await vi.waitFor(() => expect(completed).toHaveLength(1));
    if (point === 'before') {
      const setter = vi.spyOn(agent.context, 'setCurrentInput').mockImplementationOnce(() => { throw new Error('before injection'); });
      await expect(agent.continueWithAsyncResults()).rejects.toThrow('before injection'); setter.mockRestore();
      expect(provider.generate).toHaveBeenCalledTimes(2); expect((await agent.continueWithAsyncResults()).output_text).toBe('VERIFIED');
    } else {
      const listener = () => { throw new Error('after injection'); }; agent.context.on('message:added', listener);
      await expect(agent.continueWithAsyncResults()).rejects.toThrow('after injection'); agent.context.off('message:added', listener);
      expect(JSON.stringify(agent.context.getCurrentInput())).toContain('[Async Tool Results]'); await expect(agent.continueWithAsyncResults()).rejects.toThrow('No async results');
    }
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it('honors multiple mutable hooks and string replacements without freezing objects', async () => {
    const own = structuredClone(raw); const { agent, packets, execute } = fixture(); execute.mockResolvedValue(own);
    agent.registerHook('after:tool', async (ctx: { result: ToolResult }) => { ctx.result.content.ids.push('HOST_A'); return {}; });
    agent.registerHook('after:tool', async (ctx: { result: ToolResult }) => ({ modified: { content: ctx.result.content.ids.join(',') } }));
    await agent.run('lookup'); expect(JSON.stringify(packets[1]!.input)).toContain('RECORD_17,HOST_A'); expect(Object.isFrozen(own)).toBe(false); expect(own.ids).toEqual(['RECORD_17', 'HOST_A']);
  });
});
