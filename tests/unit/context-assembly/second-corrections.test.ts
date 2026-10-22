import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  Agent, AgentContextNextGen, BasePluginNextGen, Connector, Vendor, ContentType, MessageRole,
  FileCorrelationStorage, StorageRegistry, SuspendSignal, ModelTask,
} from '../../../src/index.js';
import type { AgentConfig, InputItem, IContextStorage, SerializedContextState, WorkingMemoryPluginNextGen } from '../../../src/index.js';
import { ScriptedLoopProvider } from '../../../examples/agent-loop/scripted-provider.js';
import type { ScriptedFrame } from '../../../examples/agent-loop/scripted-provider.js';
const agents: Agent[] = [], contexts: AgentContextNextGen[] = [], tasks: ModelTask[] = [], directories: string[] = [];
afterEach(async () => {
  agents.splice(0).forEach(agent => agent.destroy()); contexts.splice(0).forEach(ctx => ctx.destroy()); tasks.splice(0).forEach(task => task.destroy());
  Connector.clear(); StorageRegistry.remove('correlations'); vi.restoreAllMocks();
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});
class Source extends BasePluginNextGen {
  name = 'source'; getInstructions() { return ''; } async getContent() { return null; } getContents() { return null; }
}
const format = { type: 'json_schema' as const, name: 'answer', schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false } };
const json = (value: unknown) => JSON.stringify(value);
const finalDetail = 'final-detail '.repeat(600), largeAnswer = json({ ok: true, detail: finalDetail });
const largeFormat = { ...format, schema: { ...format.schema, properties: { ok: { type: 'boolean' }, detail: { type: 'string' } }, required: ['ok', 'detail'] } };
function fixture(frames: ScriptedFrame[], extra: Partial<AgentConfig> = {}, native = false) {
  const name = `second-correction-${agents.length}`, provider = new ScriptedLoopProvider(frames);
  vi.spyOn(provider, 'getModelCapabilities').mockReturnValue({ ...provider.getModelCapabilities(), supportsJSONSchema: native });
  Connector.create({ name, vendor: Vendor.OpenAI, auth: { type: 'none' }, options: { provider } });
  const agent = Agent.create({ connector: name, model: 'gpt-4o-mini', emptyResponseRetry: { enabled: false }, modelExecution: { customProviderAttempts: 'single', maxOutputTokensPerCall: 2300 }, ...extra }); agents.push(agent);
  return { agent, provider };
}
function oldPair(): InputItem[] { return [
  { type: 'message', role: MessageRole.ASSISTANT, content: [{ type: ContentType.TOOL_USE, id: 'old-read', name: 'read', arguments: '{}' }] },
  { type: 'message', role: MessageRole.USER, content: [{ type: ContentType.TOOL_RESULT, tool_use_id: 'old-read', content: 'DATA '.repeat(1200) }] },
]; }
function memoryStorage() {
  const states = new Map<string, SerializedContextState>();
  const storage: IContextStorage = { getPath: () => 'memory://second-correction', save: async (id, state) => { states.set(id, JSON.parse(json(state))); },
    load: async id => { const state = states.get(id); return state ? { version: 1, sessionId: id, createdAt: new Date().toISOString(), lastSavedAt: new Date().toISOString(), metadata: {}, state: JSON.parse(json(state)) } : null; },
    list: async () => [], delete: async id => { states.delete(id); }, exists: async id => states.has(id) };
  return { storage, states };
}
function attachSource(agent: Agent) {
  const source = new Source(); agent.context.registerPlugin(source); const contribute = vi.fn(() => [{ id: 'A', text: 'UNCHANGED_SELECTED_FACT', protected: true }]);
  agent.context.registerContextContributor(source.name, { getRevision: () => 1, contribute }); return contribute;
}

describe('S2-R1 structured finalization before managed consolidation', () => {
  for (const native of [false, true]) for (const layout of ['legacy', 'stable-prefix'] as const) {
    it.each(['empty', 'source', 'memory'] as const)(`${native ? 'native repair' : 'prompt formatting'} / ${layout} / %s preserves frozen evidence then spills`, async selected => {
      const { agent, provider } = fixture([{ text: 'non-json '.repeat(800) }, { text: largeAnswer }], {
        context: { model: 'gpt-4o-mini', maxContextTokens: 8000, responseReserve: 2300, criticalCompactionThreshold: 0.85,
          assembly: { layout }, features: { workingMemory: true, inContextMemory: false } },
      }, native);
      let contributions = 0;
      const memory = agent.context.getPlugin<WorkingMemoryPluginNextGen>('working_memory')!;
      if (selected === 'source') { const contribute = attachSource(agent); contributions = 0; contribute.mockImplementation(() => { contributions++; return [{ id: 'A', text: 'UNCHANGED_SELECTED_FACT', protected: true }]; }); }
      if (selected === 'memory') agent.context.registerContextContributor(memory.name, { getRevision: () => json(memory.getState()), contribute: () => { contributions++; return [{ id: 'A', text: 'FROZEN_MEMORY_VIEW', protected: true }]; } });
      const compact = vi.spyOn(agent.context.compactionStrategy, 'compact'), consolidate = vi.spyOn(agent.context.compactionStrategy, 'consolidate');
      agent.context.addInputItems(oldPair()); const task = new ModelTask({ limits: { maxCalls: 2 } }); tasks.push(task);
      const response = await agent.run('Return ok.', { responseFormat: largeFormat, modelTask: task });
      expect(response.output_parsed).toEqual({ ok: true, detail: finalDetail }); expect(provider.requests).toHaveLength(2); expect(compact).not.toHaveBeenCalled(); expect(consolidate).toHaveBeenCalledTimes(1);
      expect(contributions).toBe(selected === 'empty' ? 0 : 1); expect(json(agent.context.getConversation())).not.toContain('old-read');
      expect(json(agent.context.getConversation())).toContain('ok'); expect(json(agent.context.getConversation())).not.toContain('non-json');
      expect((await memory.query({ tier: 'raw' })).entries).toHaveLength(1);
      expect(task.snapshot().invocations.map(invocation => invocation.phase)).toEqual(['generation', 'repair']);
      expect(agent.context.lastPreparation!.selection!.accounting.providerInputTokens).toBe(10);
      if (selected !== 'empty') expect(json(provider.requests[1]!.input)).toContain(selected === 'memory' ? 'FROZEN_MEMORY_VIEW' : 'UNCHANGED_SELECTED_FACT');
    });
  }
  it.each([false, true])('keeps unconfigured/default consolidation ordering with assembly=%s', async assembly => {
    const order: string[] = [];
    const { agent, provider } = fixture([{ text: 'not JSON '.repeat(800) }, { text: largeAnswer }], {
      context: { model: 'gpt-4o-mini', maxContextTokens: 8000, responseReserve: 2300, ...(assembly ? { assembly: {} } : {}), features: { workingMemory: true, inContextMemory: false } },
    });
    const generate = provider.generate.bind(provider); vi.spyOn(provider, 'generate').mockImplementation(async options => { order.push('model'); return generate(options); });
    const consolidate = agent.context.consolidate.bind(agent.context);
    vi.spyOn(agent.context, 'consolidate').mockImplementation(async () => { order.push('consolidate'); return consolidate(); });
    agent.context.addInputItems(oldPair()); await agent.run('Return ok', { responseFormat: largeFormat });
    expect(order).toEqual(assembly ? ['model', 'model', 'consolidate'] : ['model', 'consolidate', 'model']);
  });
  it('retains recoverable tool groups when post-format spill storage fails, then repairs without a model call', async () => {
    const { agent, provider } = fixture([{ text: 'non-json '.repeat(800) }, { text: largeAnswer }], {
      context: { model: 'gpt-4o-mini', maxContextTokens: 8000, responseReserve: 2300, assembly: {}, features: { workingMemory: true, inContextMemory: false } },
    });
    const memory = agent.context.getPlugin<WorkingMemoryPluginNextGen>('working_memory')!, store = memory.store.bind(memory), failure = Error('SPILL_FAILURE');
    const intercepted = vi.spyOn(memory, 'store').mockRejectedValueOnce(failure); agent.context.addInputItems(oldPair());
    await expect(agent.run('Return ok and the detail.', { responseFormat: largeFormat })).rejects.toBe(failure);
    expect(provider.requests).toHaveLength(2); expect(json(agent.context.getConversation())).toContain('old-read'); expect(json(agent.context.getConversation())).toContain('final-detail');
    intercepted.mockImplementation(store); await agent.context.consolidate();
    expect(json(agent.context.getConversation())).not.toContain('old-read'); expect((await memory.query({ tier: 'raw' })).entries).toHaveLength(1); expect(provider.requests).toHaveLength(2);
  });
  it('runs an existing custom consolidation once after formatting, without recollecting', async () => {
    const order: string[] = [];
    const { agent, provider } = fixture([{ text: 'prose '.repeat(1000) }, { text: largeAnswer }], {
      context: { model: 'gpt-4o-mini', maxContextTokens: 5000, responseReserve: 1800, criticalCompactionThreshold: 0.7,
        assembly: {}, features: { workingMemory: false, inContextMemory: false }, compactionStrategy: {
          name: 'custom', displayName: 'Custom', description: 'Existing extension', threshold: 0.7,
          compact: async () => ({ tokensFreed: 0, messagesRemoved: 0, pluginsCompacted: [], log: [] }),
          consolidate: async state => { order.push('consolidate'); const freed = await state.removeMessages([0]); return { performed: true, tokensChanged: -freed, actions: ['Removed old plain history'] }; },
        } },
    });
    const generate = provider.generate.bind(provider); vi.spyOn(provider, 'generate').mockImplementation(async options => { order.push('model'); return generate(options); });
    const contribute = attachSource(agent); agent.context.addInputItems([{ type: 'message', role: MessageRole.USER, content: [{ type: ContentType.INPUT_TEXT, text: 'old '.repeat(500) }] }]);
    expect((await agent.run('Return ok.', { responseFormat: largeFormat })).output_parsed).toEqual({ ok: true, detail: finalDetail });
    expect(order).toEqual(['model', 'model', 'consolidate']); expect(contribute).toHaveBeenCalledTimes(1);
  });
});

async function suspensionFixture(native = false, layout: 'legacy' | 'stable-prefix' = 'legacy', selected = true) {
  const directory = await mkdtemp(join(tmpdir(), 'stage05-second-suspend-')); directories.push(directory);
  const correlations = new FileCorrelationStorage({ baseDirectory: directory }); StorageRegistry.configure({ correlations });
  const { storage, states } = memoryStorage(); const submit = vi.fn(async () => SuspendSignal.create({ result: 'ACCEPTED_R42', correlationId: 'job' }));
  const { agent, provider } = fixture([{ calls: [{ id: 'submit-once', name: 'submit', args: {} }] }, { text: native ? 'The value of ok is true.' : '{"ok":true}' }, { text: '{"ok":true}' }, { text: 'Continued' }], {
    context: { model: 'gpt-4o-mini', storage, assembly: { layout }, features: { workingMemory: false, inContextMemory: false } },
    tools: [{ definition: { type: 'function', function: { name: 'submit', parameters: { type: 'object', properties: {} } } }, output: { effect: 'write' }, execute: submit }],
  }, native);
  const contribute = selected ? attachSource(agent) : undefined;
  return { agent, provider, storage, states, submit, correlations, contribute };
}
describe('S2-R2 suspension formatting and durable session identity', () => {
  for (const native of [false, true]) for (const layout of ['legacy', 'stable-prefix'] as const) for (const existing of [false, true]) {
    it.each([false, true])(`${native ? 'native repair' : 'prompt formatting'} / ${layout} / existing=${existing} / selected=%s persists one coherent suspended answer`, async selected => {
      const { agent, provider, states, submit, correlations, contribute } = await suspensionFixture(native, layout, selected);
      if (existing) await agent.saveSession('existing');
      const saved = vi.fn(), suspended = vi.fn(), events = agent as unknown as { on(event: string, listener: () => void): void }; events.on('session:saved', saved); events.on('execution:suspended', suspended);
      const task = new ModelTask({ limits: { maxCalls: 3 } }); tasks.push(task);
      const response = await agent.run('Submit once.', { responseFormat: format, modelTask: task });
      expect(response.status).toBe('suspended'); expect(response.output_parsed).toEqual({ ok: true }); expect(submit).toHaveBeenCalledTimes(1);
      expect(provider.requests).toHaveLength(3); expect(contribute?.mock.calls.length ?? 0).toBe(selected ? 2 : 0);
      expect(saved).toHaveBeenCalledTimes(1); expect(suspended).toHaveBeenCalledTimes(1);
      const ref = await correlations.resolve('job'); expect(ref!.sessionId).toBe(response.suspension!.sessionId); expect(agent.getSessionId()).toBe(ref!.sessionId);
      expect(existing ? ref!.sessionId : ref!.sessionId.startsWith('suspended-')).toBe(existing ? 'existing' : true);
      const checkpoint = json(states.get(ref!.sessionId)); expect(checkpoint).toContain('ACCEPTED_R42'); expect(checkpoint).not.toContain('The value of ok is true.');
      expect(checkpoint).toContain('ok'); expect(task.snapshot().invocations.map(invocation => invocation.phase)).toEqual(['generation', 'wrapup', 'repair']);
      expect(agent.context.lastPreparation!.selection!.accounting.providerInputTokens).toBe(10);
      const resumed = await Agent.resume(ref!.sessionId, { connector: agent.connector.name, model: 'gpt-4o-mini', session: { storage: agent.context.storage! }, context: { model: 'gpt-4o-mini', storage: agent.context.storage!, assembly: { layout }, features: { workingMemory: false, inContextMemory: false } } }); agents.push(resumed);
      await resumed.run('Continue from the settled observation.'); expect(submit).toHaveBeenCalledTimes(1);
    });
  }
  it('persists a native valid answer without an unnecessary repair or identity reservation', async () => {
    const { agent, provider, submit, correlations } = await suspensionFixture(true);
    const generate = provider.generate.bind(provider); vi.spyOn(provider, 'generate').mockImplementation(async options => {
      const response = await generate(options);
      if (provider.requests.length === 2) { response.output_text = '{"ok":true}'; response.output = [{ type: 'message', role: MessageRole.ASSISTANT, content: [{ type: ContentType.OUTPUT_TEXT, text: '{"ok":true}' }] }]; }
      return response;
    });
    const response = await agent.run('Submit once.', { responseFormat: format }); expect(response.status).toBe('suspended'); expect(response.output_parsed).toEqual({ ok: true });
    expect(provider.requests).toHaveLength(2); expect(submit).toHaveBeenCalledTimes(1); expect((await correlations.resolve('job'))!.sessionId).toBe(response.suspension!.sessionId);
  });
  it.each(['save', 'correlation', 'format', 'cancel', 'prompt', 'account'] as const)('retains the accepted observation without replay after %s failure', async failure => {
    const { agent, provider, storage, states, submit, correlations } = await suspensionFixture();
    const original = Error('EXPECTED_FAILURE');
    if (failure === 'save') vi.spyOn(storage, 'save').mockRejectedValueOnce(original);
    if (failure === 'correlation') vi.spyOn(correlations, 'save').mockRejectedValueOnce(original);
    const generate = provider.generate.bind(provider);
    vi.spyOn(provider, 'generate').mockImplementation(async options => {
      if (provider.requests.length === 2 && failure === 'format') throw original;
      if (provider.requests.length === 2 && failure === 'cancel') { agent.cancel(); throw new DOMException('Provider observed cancellation', 'AbortError'); }
      const response = await generate(options);
      if (provider.requests.length === 2 && failure === 'prompt') agent.context.systemPrompt = 'NEW_HOST_PROMPT';
      if (provider.requests.length === 2 && failure === 'account') agent.tools.setToolContext({ accountId: 'OTHER_ACCOUNT' });
      return response;
    });
    await expect(agent.run('Submit once.', { responseFormat: format })).rejects.toThrow();
    expect(submit).toHaveBeenCalledTimes(1); expect(json(agent.context.getConversation())).toContain('ACCEPTED_R42');
    // Explicit checkpoint recovery saves the retained observation, never runs the action.
    await agent.saveSession('recovery'); expect(json(states.get('recovery'))).toContain('ACCEPTED_R42'); expect(submit).toHaveBeenCalledTimes(1);
    if (failure === 'prompt' || failure === 'account') expect(provider.requests).toHaveLength(2);
  });
});

describe('S2-R3 uncertainty over supported protocol content', () => {
  const image = { type: ContentType.INPUT_IMAGE_URL as const, image_url: { url: 'data:image/png;base64,AA==', detail: 'low' as const } }, file = { type: ContentType.INPUT_FILE as const, file_id: 'file-opaque' };
  for (const protocol of ['function', 'custom'] as const) it.each(['image', 'file', 'text-array', 'text-string'] as const)(`${protocol} %s result marks only uncertain data`, async shape => {
    const ctx = AgentContextNextGen.create({ model: 'gpt-4o-mini', assembly: {}, features: { workingMemory: false, inContextMemory: false } }); contexts.push(ctx);
    const output = shape === 'image' ? [image] : shape === 'file' ? [file] : shape === 'text-array' ? [{ type: ContentType.INPUT_TEXT as const, text: 'plain' }] : 'plain';
    const call = protocol === 'function' ? { type: ContentType.TOOL_USE as const, id: 'c', name: 'read', arguments: '{}' } : { type: ContentType.CUSTOM_TOOL_USE as const, id: 'c', name: 'read', input: 'input' };
    ctx.addInputItems([{ type: 'message', role: MessageRole.ASSISTANT, content: [call] }, { type: protocol === 'function' ? 'function_call_output' : 'custom_tool_call_output', call_id: 'c', output }]); ctx.setCurrentInput('Inspect observation');
    const retained = () => json({ conversation: ctx.getState().conversation, pending: ctx.getCurrentInput(), plugins: ctx.getState().pluginStates });
    const before = retained(), prepared = await ctx.prepare(); ctx.validateRequestBudget({ input: prepared.input, tools: prepared.tools });
    expect(ctx.lastPreparation!.selection!.accounting.opaqueOrMultimodal).toBe(shape === 'image' || shape === 'file'); expect(retained()).toBe(before);
  });
  it('includes an opaque tool signature after a bounded final-input refresh', async () => {
    const ctx = AgentContextNextGen.create({ model: 'gpt-4o-mini', assembly: {}, features: { workingMemory: false, inContextMemory: false } }); contexts.push(ctx);
    ctx.setCurrentInput('Original'); const prepared = await ctx.prepare();
    const input: InputItem[] = [...prepared.input, { type: 'message', role: MessageRole.ASSISTANT, content: [{ type: ContentType.TOOL_USE, id: 'signed', name: 'read', arguments: '{}', thoughtSignature: 'OPAQUE_GOOGLE_SIGNATURE' }] },
      { type: 'function_call_output', call_id: 'signed', output: 'plain' }];
    const request = { model: 'gpt-4o-mini', input, tools: prepared.tools }; await ctx._reconcileContextRequest(request); ctx.validateRequestBudget(request);
    expect(ctx.lastPreparation!.selection!.accounting.opaqueOrMultimodal).toBe(true); expect(json(request.input)).toContain('OPAQUE_GOOGLE_SIGNATURE');
  });
});
