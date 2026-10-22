import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  Agent, AgentContextNextGen, BasePluginNextGen, Connector, ConnectorTools, Vendor,
  ContentType, MessageRole, StreamEventType, createInContextMemoryContributor,
  FileContextStorage, FileCorrelationStorage, StorageRegistry, SuspendSignal, ModelTask,
} from '../../../src/index.js';
import type {
  AgentConfig, ContextAssemblyConfig, ContextBlock, ContextContributionRequest,
  IConnectorRegistry, InContextMemoryPluginNextGen, InputItem, TextGenerateOptions, TokenUsage,
} from '../../../src/index.js';
import { ScriptedLoopProvider } from '../../../examples/agent-loop/scripted-provider.js';
import type { ScriptedFrame } from '../../../examples/agent-loop/scripted-provider.js';

const agents: Agent[] = [], contexts: AgentContextNextGen[] = [], directories: string[] = [];
afterEach(async () => {
  agents.splice(0).forEach(agent => agent.destroy()); contexts.splice(0).forEach(ctx => ctx.destroy());
  Connector.clear(); StorageRegistry.remove('correlations'); vi.useRealTimers(); vi.restoreAllMocks();
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});
class Source extends BasePluginNextGen {
  name = 'source'; revision = 0;
  getInstructions() { return 'Use source data as observations.'; }
  async getContent() { return 'FULL_LEGACY_SOURCE'; }
  getContents() { return null; }
}
const user = (text: string): InputItem => ({ type: 'message', role: MessageRole.USER, content: [{ type: ContentType.INPUT_TEXT, text }] });
const json = (value: unknown) => JSON.stringify(value);
function context(assembly: ContextAssemblyConfig = {}, extra: Partial<Parameters<typeof AgentContextNextGen.create>[0]> = {}) {
  const ctx = AgentContextNextGen.create({ model: 'gpt-4o-mini', maxContextTokens: 5000, responseReserve: 100,
    features: { workingMemory: false, inContextMemory: false }, assembly, ...extra });
  contexts.push(ctx); const source = new Source(); ctx.registerPlugin(source); ctx.setCurrentInput('QUESTION_A');
  return { ctx, source };
}
function fixture(frames: ScriptedFrame[] = [{ text: 'Answer' }], extra: Partial<AgentConfig> = {}) {
  const name = `stage05-correction-${agents.length}`, provider = new ScriptedLoopProvider(frames);
  Connector.create({ name, vendor: Vendor.OpenAI, auth: { type: 'none' }, options: { provider } });
  const agent = Agent.create({ connector: name, model: 'gpt-4o-mini', emptyResponseRetry: { enabled: false },
    context: { model: 'gpt-4o-mini', assembly: { layout: 'stable-prefix' }, features: { workingMemory: false, inContextMemory: false } }, ...extra });
  agents.push(agent); const source = new Source(); agent.context.registerPlugin(source);
  return { agent, provider, source };
}
async function execute(agent: Agent, mode: 'run' | 'stream', input = 'QUESTION_A') {
  if (mode === 'run') return (await agent.run(input)).output_text;
  let text = ''; for await (const event of agent.stream(input)) if (event.type === StreamEventType.OUTPUT_TEXT_DELTA) text += event.delta;
  return text;
}
function replaceQuestion(options: TextGenerateOptions, text = 'QUESTION_B') {
  const input = options.input as InputItem[];
  input[input.length - 1] = user(text);
}
function registry(): IConnectorRegistry {
  return { get: name => Connector.get(name), has: () => false, list: () => [], listAll: () => [], size: () => 0,
    getDescriptionsForTools: () => '', getInfo: () => ({}) };
}
const bindings = [
  { field: 'accountId', first: 'A', second: 'B' },
  { field: 'connectorAccounts', first: { service: 'A' }, second: { service: 'B' } },
  { field: 'taskId', first: 'A', second: 'B' },
  { field: 'connectorRegistry', first: registry(), second: registry() },
] as const;

describe('R1 effective account/task/registry authority', () => {
  for (const binding of bindings) {
    it.each(['await', 'dispatch', 'observer'] as const)(`${binding.field} changes at %s require new preparation`, async boundary => {
      const { ctx, source } = context(); ctx.tools.setToolContext({ [binding.field]: binding.first });
      const contribute = vi.fn(() => [{ id: 'A', text: 'SCOPE_A' }]);
      ctx.registerContextContributor(source.name, { getRevision: () => source.revision, contribute: async () => {
        if (boundary === 'await') { await Promise.resolve(); ctx.tools.setToolContext({ [binding.field]: binding.second }); }
        return contribute();
      } });
      if (boundary === 'await') { await expect(ctx.prepare()).rejects.toMatchObject({ code: 'CONTEXT_ASSEMBLY_STALE' }); return; }
      const prepared = await ctx.prepare();
      if (boundary === 'dispatch') ctx.tools.setToolContext({ [binding.field]: binding.second });
      else ctx.once('budget:updated', () => { ctx.tools.setToolContext({ [binding.field]: binding.second }); });
      expect(() => ctx.validateRequestBudget({ model: 'gpt-4o-mini', input: prepared.input, tools: prepared.tools,
        ...(boundary === 'observer' ? { instructions: 'Recount and notify' } : {}) })).toThrow('authority');
    });
    it(`${binding.field} affects fingerprints and fresh requests still fit`, async () => {
      vi.useFakeTimers(); const { ctx } = context(); ctx.tools.setToolContext({ [binding.field]: binding.first });
      let prepared = await ctx.prepare(); const before = ctx.lastPreparation!.selection!.requestFingerprint;
      ctx.tools.setToolContext({ [binding.field]: binding.second }); prepared = await ctx.prepare();
      expect(ctx.lastPreparation!.selection!.requestFingerprint).not.toBe(before);
      expect(ctx.validateRequestBudget({ input: prepared.input, tools: prepared.tools }).available).toBeGreaterThanOrEqual(0);
    });
  }
  it('uses the real connector account precedence while blocking an old prepared scope', async () => {
    const connector = Connector.create({ name: 'service', serviceType: 'custom', baseURL: 'https://local.invalid', auth: { type: 'none' } });
    const fetched = vi.spyOn(connector, 'fetch').mockImplementation(async () => new Response('{"ok":true}', { status: 200 }));
    const { ctx } = context(); ctx.tools.register(ConnectorTools.for('service')[0]!);
    ctx.tools.setToolContext({ accountId: 'explicit-A', connectorAccounts: { service: 'mapped-B' } });
    const prepared = await ctx.prepare();
    await ctx.tools.execute('service_api', { method: 'GET', endpoint: '/read' });
    expect(fetched.mock.calls[0]![3]).toBe('explicit-A');
    ctx.tools.mergeToolContext({ accountId: undefined });
    expect(() => ctx.validateRequestBudget({ input: prepared.input, tools: prepared.tools })).toThrow('authority');
    await ctx.tools.execute('service_api', { method: 'GET', endpoint: '/read' });
    expect(fetched.mock.calls[1]![3]).toBe('mapped-B');
  });
  it('canonicalizes account-map ordering without changing its scope', async () => {
    const { ctx } = context(); ctx.tools.setToolContext({ connectorAccounts: { a: 'A', b: 'B' } });
    const prepared = await ctx.prepare(); ctx.tools.setToolContext({ connectorAccounts: { b: 'B', a: 'A' } });
    expect(ctx.validateRequestBudget({ input: prepared.input, tools: prepared.tools }).available).toBeGreaterThanOrEqual(0);
  });
  it.each(['run', 'stream'] as const)('rejects host account switches before %s dispatch', async mode => {
    const { agent, provider } = fixture([{ text: 'Must not run' }], { hooks: { 'before:llm': async () => {
      agent.tools.setToolContext({ accountId: 'B' }); return {};
    } } });
    agent.tools.setToolContext({ accountId: 'A' });
    await expect(execute(agent, mode)).rejects.toMatchObject({ code: 'CONTEXT_ASSEMBLY_STALE' });
    expect(provider.requests).toHaveLength(0);
  });
});

describe('R2 bounded selection against actual submitted input', () => {
  for (const boundary of ['run-in-place', 'run-returned', 'run-listener', 'stream-in-place'] as const) {
    it.each(['replace', 'append', 'history'] as const)(`${boundary} %s refreshes once and submits matching data`, async edit => {
      let hookCalls = 0;
      const modify = (options: TextGenerateOptions) => {
        if (edit === 'replace') replaceQuestion(options);
        if (edit === 'append') (options.input as InputItem[]).push(user('QUESTION_B'));
        if (edit === 'history') {
          const input = options.input as InputItem[];
          const index = input.findIndex(item => json(item).includes('HISTORY_A')); input[index] = user('HISTORY_B');
        }
      };
      const { agent, provider, source } = fixture([{ text: 'SOURCE_B answer' }], { hooks: { 'before:llm': async hook => {
        hookCalls++;
        if (boundary === 'run-listener') return {};
        if (boundary === 'run-returned') { const next = { ...hook.options, input: structuredClone(hook.options.input) }; modify(next); return { modified: { input: next.input } }; }
        modify(hook.options); return {};
      } } });
      if (boundary === 'run-listener') agent.on('llm:request', ({ options }: { options: TextGenerateOptions }) => modify(options));
      agent.context.addInputItems([user('HISTORY_A')]);
      const contribute = vi.fn((packet: ContextContributionRequest) => [{ id: json(packet.input).includes('QUESTION_B') || json(packet.input).includes('HISTORY_B') ? 'B' : 'A',
        text: json(packet.input).includes('QUESTION_B') || json(packet.input).includes('HISTORY_B') ? 'SOURCE_B' : 'SOURCE_A' }]);
      agent.context.registerContextContributor(source.name, { getRevision: () => source.revision, contribute });
      const compact = vi.spyOn(agent.context.compactionStrategy, 'compact');
      expect(await execute(agent, boundary.startsWith('stream') ? 'stream' : 'run')).toBe('SOURCE_B answer');
      expect(provider.requests).toHaveLength(1); expect(hookCalls).toBe(1); expect(contribute).toHaveBeenCalledTimes(2); expect(compact).not.toHaveBeenCalled();
      expect(json(provider.requests[0]!.input)).toContain('SOURCE_B'); expect(json(provider.requests[0]!.input)).not.toContain('SOURCE_A');
      expect(agent.context.lastPreparation!.selection!.entries[0]!.id).toBe('source/B'); expect(agent.context.lastPreparation!.revision).toBe(1);
      expect(json(agent.context.getConversation())).not.toContain('context_data');
    });
  }
  it('does not recollect unchanged input or unconfigured legacy requests', async () => {
    const { agent, source } = fixture(); const contribute = vi.fn(() => [{ id: 'A', text: 'A' }]);
    agent.context.registerContextContributor(source.name, { getRevision: () => 1, contribute }); await agent.run('QUESTION_A');
    expect(contribute).toHaveBeenCalledTimes(1);
    const legacy = fixture([{ text: 'Legacy answer' }], { context: { model: 'gpt-4o-mini', features: { workingMemory: false, inContextMemory: false } },
      hooks: { 'before:llm': async () => ({ modified: { input: 'LEGACY_REPLACEMENT' } }) } });
    await legacy.agent.run('Original'); expect(legacy.provider.requests[0]!.input).toBe('LEGACY_REPLACEMENT'); expect(legacy.agent.context.lastPreparation).not.toHaveProperty('selection');
  });
  it('keeps one compaction even when a hook requires a final contribution refresh', async () => {
    let compactions = 0, contributions = 0;
    const { agent, source, provider } = fixture([{ text: 'B' }], {
      context: { model: 'gpt-4o-mini', maxContextTokens: 1500, responseReserve: 100, criticalCompactionThreshold: 0.2,
        features: { workingMemory: false, inContextMemory: false }, assembly: {}, compactionStrategy: {
          name: 'once', displayName: 'Once', description: 'Test only', threshold: 0.5,
          compact: async state => { compactions++; const freed = await state.removeMessages([0]); return { tokensFreed: freed, messagesRemoved: 1, pluginsCompacted: [], log: [] }; },
          consolidate: async () => ({ performed: false, tokensChanged: 0, actions: [] }),
        } }, hooks: { 'before:llm': async hook => { replaceQuestion(hook.options); return {}; } },
    });
    agent.context.addInputItems([user('old '.repeat(450))]);
    agent.context.registerContextContributor(source.name, { getRevision: () => 1, contribute: packet => { contributions++; return [{ id: 'selected', text: json(packet.input).includes('QUESTION_B') ? 'SOURCE_B' : 'SOURCE_A' }]; } });
    await agent.run('QUESTION_A'); expect(compactions).toBe(1); expect(contributions).toBe(3); expect(json(provider.requests[0]!.input)).toContain('SOURCE_B');
  });
  it('does not let synchronous validation silently admit a different task, or refresh twice', async () => {
    const { ctx, source } = context(); let contributions = 0;
    ctx.registerContextContributor(source.name, { getRevision: () => 1, contribute: packet => { contributions++; return [{ id: 'selected', text: json(packet.input) }]; } });
    const prepared = await ctx.prepare(); const request: TextGenerateOptions = { model: 'gpt-4o-mini', input: structuredClone(prepared.input), tools: prepared.tools };
    replaceQuestion(request); expect(() => ctx.validateRequestBudget(request)).toThrow('Submitted');
    await ctx._reconcileContextRequest(request); ctx.validateRequestBudget(request);
    replaceQuestion(request, 'QUESTION_C'); await expect(ctx._reconcileContextRequest(request)).rejects.toThrow('changed again'); expect(contributions).toBe(2);
  });
  it.each(['throw', 'scope', 'revision', 'request', 'destroy', 'overflow'] as const)('retains sources and rejects failed refresh: %s', async failure => {
    const { ctx, source } = context({}, { maxContextTokens: 1000 }); let calls = 0; let request!: TextGenerateOptions;
    const original = Error('SOURCE_FAILURE'); const state = json([ctx.getState().conversation, ctx.getState().pluginStates, ctx.getCurrentInput()]);
    ctx.registerContextContributor(source.name, { getRevision: () => source.revision, contribute: () => {
      calls++; if (calls === 1) return [{ id: 'A', text: 'A' }];
      if (failure === 'throw') throw original;
      if (failure === 'scope') ctx.tools.setToolContext({ accountId: 'changed' });
      if (failure === 'revision') source.revision++;
      if (failure === 'request') replaceQuestion(request, 'QUESTION_C');
      if (failure === 'destroy') ctx.destroy();
      return [{ id: 'B', text: failure === 'overflow' ? 'B'.repeat(6000) : 'B', protected: true }];
    } });
    const prepared = await ctx.prepare(); request = { model: 'gpt-4o-mini', input: structuredClone(prepared.input), tools: prepared.tools }; replaceQuestion(request);
    if (failure === 'throw') await expect(ctx._reconcileContextRequest(request)).rejects.toBe(original);
    else await expect(ctx._reconcileContextRequest(request)).rejects.toThrow();
    expect(calls).toBe(2); if (failure !== 'destroy') { expect(ctx.lastPreparation!.selection!.entries[0]!.id).toBe('source/A'); expect(json([ctx.getState().conversation, ctx.getState().pluginStates, ctx.getCurrentInput()])).toBe(state); }
  });
  it.each(['abort', 'timeout'] as const)('shares contributor time and discards late %s refresh results', async failure => {
    vi.useFakeTimers(); const { ctx, source } = context({ timeoutMs: 20 }); let calls = 0, release!: (blocks: ContextBlock[]) => void;
    ctx.registerContextContributor(source.name, { getRevision: () => 1, contribute: async () => {
      calls++; if (calls === 1) { await new Promise(resolve => setTimeout(resolve, 8)); return [{ id: 'A', text: 'A' }]; }
      return new Promise<ContextBlock[]>(resolve => { release = resolve; });
    } });
    const initial = ctx.prepare(); await vi.advanceTimersByTimeAsync(8); const prepared = await initial;
    const request: TextGenerateOptions = { model: 'gpt-4o-mini', input: structuredClone(prepared.input), tools: prepared.tools }; replaceQuestion(request);
    const controller = new AbortController(); const pending = ctx._reconcileContextRequest(request, { signal: controller.signal });
    const check = expect(pending).rejects.toThrow(); await vi.advanceTimersByTimeAsync(0);
    if (failure === 'abort') controller.abort(Error('HOST_CANCEL')); else await vi.advanceTimersByTimeAsync(12);
    await check; release([{ id: 'LATE', text: 'Never publish' }]); await Promise.resolve();
    expect(ctx.lastPreparation!.selection!.entries[0]!.id).toBe('source/A'); expect(json(request.input)).not.toContain('LATE');
    await expect(ctx._reconcileContextRequest(request)).rejects.toThrow('changed again'); expect(calls).toBe(2);
  });
  it('cannot refill an exhausted preparation allowance for a final refresh', async () => {
    vi.useFakeTimers(); const { ctx, source } = context({ timeoutMs: 20 }); let calls = 0;
    ctx.registerContextContributor(source.name, { getRevision: () => 1, contribute: () => { calls++; vi.setSystemTime(Date.now() + 20); return [{ id: 'A', text: 'A' }]; } });
    const prepared = await ctx.prepare(); const request = { model: 'gpt-4o-mini', input: prepared.input, tools: prepared.tools }; replaceQuestion(request);
    await expect(ctx._reconcileContextRequest(request)).rejects.toMatchObject({ code: 'CONTEXT_ASSEMBLY_TIMEOUT' }); expect(calls).toBe(1);
  });
  it.each(['run', 'stream'] as const)('agent cancellation stops an awaited %s refresh before provider admission', async mode => {
    const { agent, provider, source } = fixture([{ text: 'Must not run' }], { hooks: { 'before:llm': async hook => { replaceQuestion(hook.options); return {}; } } });
    let calls = 0, release!: (blocks: ContextBlock[]) => void;
    agent.context.registerContextContributor(source.name, { getRevision: () => 1, contribute: () => {
      calls++; return calls === 1 ? [{ id: 'A', text: 'A' }] : new Promise<ContextBlock[]>(resolve => { release = resolve; });
    } });
    const pending = execute(agent, mode); const rejected = expect(pending).rejects.toThrow();
    await vi.waitFor(() => expect(calls).toBe(2)); agent.cancel('Stop refresh'); await rejected;
    release([{ id: 'late', text: 'Must not publish' }]); await Promise.resolve(); expect(provider.requests).toHaveLength(0);
    expect(agent.context.lastPreparation!.selection!.entries[0]!.id).toBe('source/A');
  });
  it('refresh uses no extra model calls and keeps the same explicit ModelTask', async () => {
    const task = new ModelTask({ limits: { maxCalls: 1 } });
    const { agent, provider, source } = fixture([{ text: 'B' }], { modelExecution: { customProviderAttempts: 'single', maxOutputTokensPerCall: 64 },
      hooks: { 'before:llm': async hook => { replaceQuestion(hook.options); return {}; } } });
    let calls = 0; agent.context.registerContextContributor(source.name, { getRevision: () => 1, contribute: packet => { calls++; return [{ id: 'selected', text: json(packet.input) }]; } });
    try { await agent.run('QUESTION_A', { modelTask: task }); expect(task.snapshot().totals.calls).toBe(1); expect(provider.requests).toHaveLength(1); expect(calls).toBe(2); }
    finally { task.destroy(); }
  });
});

const format = { type: 'json_schema' as const, name: 'answer', schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false } };
describe('R3 formatting after expected commits and host changes', () => {
  for (const native of [false, true]) {
    it.each(['prompt', 'input', 'history', 'account', 'registry'] as const)(`${native ? 'native' : 'prompt'} repair rejects host %s changes`, async change => {
      const { agent, provider, source } = fixture([{ text: 'bad JSON' }, { text: '{"ok":true}' }]);
      if (native) vi.spyOn(provider, 'getModelCapabilities').mockReturnValue({ ...provider.getModelCapabilities(), supportsJSONSchema: true });
      agent.context.systemPrompt = 'ORIGINAL_HOST_PROMPT'; agent.context.addInputItems([user('EARLIER_INPUT')]);
      agent.context.registerContextContributor(source.name, { getRevision: () => 1, contribute: () => [{ id: 'A', text: 'ORIGINAL_DATA' }] });
      agent.once('iteration:complete', () => {
        if (change === 'prompt') agent.context.systemPrompt = 'NEW_HOST_PROMPT';
        if (change === 'input') agent.context.addUserMessage('HOST_CORRECTION');
        if (change === 'history') { const item = agent.context.getConversation()[0]!; if (item.type === 'message') item.content = [{ type: ContentType.INPUT_TEXT, text: 'EDITED_HISTORY' }]; }
        if (change === 'account') agent.tools.setToolContext({ accountId: 'different' });
        if (change === 'registry') agent.tools.setToolContext({ connectorRegistry: registry() });
      });
      await expect(agent.run('Return ok true', { responseFormat: format })).rejects.toMatchObject({ code: 'CONTEXT_ASSEMBLY_STALE' });
      expect(provider.requests).toHaveLength(1); expect(agent.context.lastPreparation!.selection!.accounting.providerInputTokens).toBe(10);
      if (change === 'input') expect(json(agent.context.getCurrentInput())).toContain('HOST_CORRECTION');
      if (change === 'prompt') expect(agent.context.systemPrompt).toBe('NEW_HOST_PROMPT');
    });
    it(`${native ? 'native' : 'prompt'} ordinary repair preserves its selected prefix and main diagnostics`, async () => {
      const { agent, provider, source } = fixture([{ text: 'bad JSON' }, { text: '{"ok":true}' }]);
      if (native) vi.spyOn(provider, 'getModelCapabilities').mockReturnValue({ ...provider.getModelCapabilities(), supportsJSONSchema: true });
      agent.context.systemPrompt = 'HOST_PROMPT'; const contribute = vi.fn(() => [{ id: 'A', text: 'SELECTED_DATA' }]);
      agent.context.registerContextContributor(source.name, { getRevision: () => 1, contribute });
      const response = await agent.run('Return ok true', { responseFormat: format });
      expect(response.output_parsed).toEqual({ ok: true }); expect(provider.requests).toHaveLength(2); expect(contribute).toHaveBeenCalledTimes(1);
      expect(json(provider.requests[1]!.input)).toContain('SELECTED_DATA'); expect(json(agent.context.getConversation())).toContain('ok'); expect(json(agent.context.getConversation())).not.toContain('bad JSON');
      expect(agent.context.lastPreparation!.revision).toBe(1); expect(agent.context.lastPreparation!.selection!.accounting.providerInputTokens).toBe(10);
    });
  }
  it('checks the current host prompt in direct auxiliary validation', async () => {
    const { ctx, source } = context(); ctx.registerContextContributor(source.name, { getRevision: () => 1, contribute: () => [] });
    await ctx.prepare(); ctx.addAssistantResponse([{ type: 'message', role: MessageRole.ASSISTANT, content: [{ type: ContentType.OUTPUT_TEXT, text: 'Answer' }] }]);
    ctx.systemPrompt = 'NEW_HOST_PROMPT';
    expect(() => ctx.validateRequestBudget({ input: ctx.formattingContextInput('Repair') }, { recordPreparation: false })).toThrow('host prompt');
  });
  it('never repeats an admitted local action when a later host correction invalidates formatting', async () => {
    let writes = 0;
    const { agent, provider } = fixture([{ calls: [{ id: 'submit-1', name: 'submit', args: {} }] }, { text: 'bad JSON' }, { text: '{"ok":true}' }], {
      tools: [{ definition: { type: 'function', function: { name: 'submit', parameters: { type: 'object', properties: {} } } }, output: { effect: 'write' }, execute: async () => { writes++; return { receipt: 'R42', completion: 'unknown' }; } }],
    });
    agent.on('iteration:complete', ({ response }) => { if (response.output_text === 'bad JSON') agent.context.systemPrompt = 'HOST_CORRECTION'; });
    await expect(agent.run('Submit once', { responseFormat: format })).rejects.toMatchObject({ code: 'CONTEXT_ASSEMBLY_STALE' });
    expect(writes).toBe(1); expect(provider.requests).toHaveLength(2); expect(json(agent.context.getConversation())).toContain('R42');
  });
});

describe('R4 accurate selected store prompt surfaces and exact recovery', () => {
  it.each([false, true])('preserves frozen class-backed store schemas with selection=%s', async selected => {
    const ctx = AgentContextNextGen.create({ model: 'gpt-4o-mini', ...(selected ? { assembly: {} } : {}), features: { workingMemory: false } }); contexts.push(ctx);
    const memory = ctx.getPlugin<InContextMemoryPluginNextGen>('in_context_memory')!, native = memory.getStoreSchema();
    class Schema {
      #value = native;
      get storeId() { return this.#value.storeId; } get displayName() { return this.#value.displayName; }
      get description() { return this.#value.description; } get usageHint() { return this.#value.usageHint; }
      get setDataFields() { return this.#value.setDataFields; } get actions() { return this.#value.actions; }
    }
    const schema = Object.freeze(new Schema()); vi.spyOn(memory, 'getStoreSchema').mockReturnValue(schema);
    memory.set('receipt', 'Exact source', 'A42', 'critical');
    if (selected) ctx.registerContextContributor(memory.name, createInContextMemoryContributor(memory));
    const prepared = await ctx.prepare(); expect(json(prepared.tools)).toContain('whiteboard'); expect(json(prepared.input)).toContain('Whiteboard');
    expect(memory.getStoreSchema()).toBe(schema); expect(schema.description).toBe(native.description);
    expect(json(prepared.tools).includes('no retrieval needed')).toBe(!selected);
  });
  it.each(['legacy', 'stable-prefix'] as const)('%s fixes overview and tool descriptions without changing stored schemas', async layout => {
    const ctx = AgentContextNextGen.create({ model: 'gpt-4o-mini', assembly: { layout, maxDataTokens: 128 }, features: { workingMemory: false } }); contexts.push(ctx);
    const memory = ctx.getPlugin<InContextMemoryPluginNextGen>('in_context_memory')!;
    memory.set('bulk', 'Omitted source', 'EXACT_BULK '.repeat(500), 'low'); memory.set('receipt', 'Selected source', 'A42', 'critical');
    const state = json(memory.getState()), schema = memory.getStoreSchema(); ctx.registerContextContributor(memory.name, createInContextMemoryContributor(memory));
    const selected = await ctx.prepare(); const instructions = json(selected.input.filter(item => item.type === 'message' && item.role === MessageRole.DEVELOPER));
    expect(instructions).toContain('omitted entries remain'); expect(instructions).not.toContain('no retrieval needed');
    expect(json(selected.tools)).not.toContain('no retrieval needed'); expect(memory.getStoreSchema()).toEqual(schema);
    expect(json(await ctx.tools.execute('store_list', { store: 'whiteboard' }))).toContain('bulk');
    expect(json(await ctx.tools.execute('store_get', { store: 'whiteboard', key: 'bulk' }))).toContain('EXACT_BULK'); expect(json(memory.getState())).toBe(state);
    ctx.unregisterContextContributor(memory.name); const legacy = await ctx.prepare();
    expect(json(legacy.input)).toContain('no retrieval needed'); expect(json(legacy.tools)).toContain('no retrieval needed'); expect(json(memory.getState())).toBe(state);
  });
});

describe('R5 actual per-request wrap-up usage', () => {
  for (const mode of ['run', 'stream'] as const) it.each(['zero', 'missing-cache'] as const)(`${mode} preserves %s observations at wrap-up`, async kind => {
    const { agent, provider } = fixture([{ calls: [{ id: 'read-1', name: 'read', args: {} }] }, { text: 'Wrap up' }], { maxIterations: 1,
      tools: [{ definition: { type: 'function', function: { name: 'read', parameters: { type: 'object', properties: {} } } }, output: { effect: 'read' }, execute: async () => 'LOCAL' }] });
    const generate = provider.generate.bind(provider); provider.generate = async options => {
      const response = await generate(options); response.usage = kind === 'zero' ? { input_tokens: 0, output_tokens: 0, total_tokens: 0, cached_input_tokens: 0, cache_creation_input_tokens: 0 }
        : { input_tokens: 7, output_tokens: 1, total_tokens: 8 }; return response;
    };
    await execute(agent, mode, 'Read once'); const accounting = agent.context.lastPreparation!.selection!.accounting;
    expect(accounting.providerInputTokens).toBe(kind === 'zero' ? 0 : 7); expect(accounting.cachedInputTokens).toBe(kind === 'zero' ? 0 : null); expect(accounting.cacheCreationInputTokens).toBe(kind === 'zero' ? 0 : null);
  });
  it.each(['run', 'stream'] as const)('%s records wrap-up usage separately from aggregate usage', async mode => {
    const { agent, provider } = fixture([{ calls: [{ id: 'read-1', name: 'read', args: {} }] }, { text: 'Wrap up' }], { maxIterations: 1,
      tools: [{ definition: { type: 'function', function: { name: 'read', parameters: { type: 'object', properties: {} } } }, output: { effect: 'read' }, execute: async () => 'LOCAL_RECEIPT' }] });
    const generate = provider.generate.bind(provider); provider.generate = async options => {
      const response = await generate(options); response.usage = { input_tokens: provider.requests.length * 10, output_tokens: 2,
        total_tokens: provider.requests.length * 10 + 2, cached_input_tokens: provider.requests.length * 3, cache_creation_input_tokens: provider.requests.length };
      return response;
    };
    let usage: TokenUsage | undefined;
    if (mode === 'run') usage = (await agent.run('Read once')).usage;
    else for await (const event of agent.stream('Read once')) if (event.type === StreamEventType.RESPONSE_COMPLETE) usage = event.usage;
    const accounting = agent.context.lastPreparation!.selection!.accounting;
    expect(provider.requests).toHaveLength(2); expect(accounting.providerInputTokens).toBe(20); expect(accounting.cachedInputTokens).toBe(6); expect(accounting.cacheCreationInputTokens).toBe(2);
    expect(accounting.inputTokenDelta).toBe(20 - accounting.estimatedInputTokens); if (mode === 'stream') expect(usage!.input_tokens).toBe(30);
    await agent.context.prepare(); expect(agent.context.lastPreparation!.selection!.accounting.providerInputTokens).toBeNull();
  });
  it('records suspension wrap-up usage without rerunning its submitted action', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'stage05-suspend-')); directories.push(directory);
    StorageRegistry.configure({ correlations: new FileCorrelationStorage({ baseDirectory: join(directory, 'correlations') }) });
    const action = vi.fn(async () => SuspendSignal.create({ result: 'LOCAL_ACCEPTED', correlationId: 'local-job' }));
    const { agent, provider } = fixture([{ calls: [{ id: 'submit-1', name: 'submit', args: {} }] }, { text: 'Waiting' }], {
      context: { model: 'gpt-4o-mini', assembly: {}, storage: new FileContextStorage({ agentId: 'stage05', baseDirectory: directory }), features: { workingMemory: false, inContextMemory: false } },
      tools: [{ definition: { type: 'function', function: { name: 'submit', parameters: { type: 'object', properties: {} } } }, output: { effect: 'write' }, execute: action }],
    });
    const response = await agent.run('Submit once'); expect(response.status).toBe('suspended'); expect(action).toHaveBeenCalledTimes(1); expect(provider.requests).toHaveLength(2);
    expect(agent.context.lastPreparation!.selection!.accounting.providerInputTokens).toBe(response.usage!.input_tokens);
  });
});
