import { afterEach, describe, expect, it, vi } from 'vitest';
import { Agent, AgentContextNextGen, Connector, ContextCompactionStrategy, Vendor, ModelTask,
  ContentType, MessageRole, StreamEventType, InMemoryEvidenceStorage, TaskStatePluginNextGen, StrategyRegistry } from '../../../../src/index.js';
import type { ITextProvider, TextGenerateOptions, InputItem, ContextCompactionStrategyConfig } from '../../../../src/index.js';
import type { IContextStorage, SerializedContextState, AgentContextNextGenConfig, AgentConfig, Message, TextCompactionResponse } from '../../../../src/index.js';
import { BasePluginNextGen } from '../../../../src/core/context-nextgen/BasePluginNextGen.js';
import { nativePrefixCutoff } from '../../../../src/core/context-nextgen/compaction/coordinator.js';

const agents: Agent[] = [], contexts: AgentContextNextGen[] = [], tasks: ModelTask[] = [];
afterEach(() => { agents.splice(0).forEach(a => a.destroy()); contexts.splice(0).forEach(c => c.destroy());
  tasks.splice(0).forEach(t => t.destroy()); Connector.clear(); vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.useRealTimers(); });
const text = (role: MessageRole, value: string): Message => ({ type: 'message', role,
  content: [{ type: role === MessageRole.ASSISTANT ? ContentType.OUTPUT_TEXT : ContentType.INPUT_TEXT, text: value }] });
const usage = { input_tokens: 80, output_tokens: 20, total_tokens: 100 };
class Shrinkable extends BasePluginNextGen {
  readonly name = 'custom-shrinkable'; value = 'PLUGIN_EXACT '.repeat(100); calls = 0;
  getInstructions() { return 'Plugin-owned state.'; }
  async getContent() { return this.value; }
  getContents() { return this.value; }
  getState() { return { value: this.value }; }
  restoreState(state: unknown) { this.value = (state as { value: string }).value; }
  override isCompactable() { return true; }
  override async compact() { this.calls++; this.value = 'PLUGIN_COMPACTED'; return 500; }
}
function setup(config: ContextCompactionStrategyConfig = { plugins: 'off', history: 'native' }, max = 16000, extra: Partial<AgentContextNextGenConfig> = {}, agentConfig: Partial<AgentConfig> = {}) {
  const count = vi.fn(async (options: TextGenerateOptions) => {
    const input = typeof options.input === 'string' ? options.input : options.input.map(item => item.type === 'compaction' ? { type: 'native', tokenCost: 50 } : item);
    return Math.ceil(JSON.stringify({ input, tools: options.tools, instructions: options.instructions, schema: options.response_format }).length / 4);
  });
  const compact = vi.fn<(options: TextGenerateOptions) => Promise<TextCompactionResponse>>(async (_options: TextGenerateOptions) => ({ protocol: 'test-native-v1', usage,
    input: [text(MessageRole.USER, 'RETAINED_NATIVE_USER'), { type: 'compaction' as const, id: 'native', encrypted_content: 'x'.repeat(80000) }] }));
  const generate = vi.fn(async (o: TextGenerateOptions) => ({ id: 'answer', object: 'response' as const, created_at: 1, model: o.model,
    status: 'completed' as const, output_text: 'DONE', output: [text(MessageRole.ASSISTANT, 'DONE')], usage }));
  const provider: ITextProvider = { name: 'fixture', capabilities: { text: true, images: false, videos: false, audio: false },
    compaction: { compact, countInput: count }, generate,
    async *streamGenerate(o) { await generate(o); yield { type: StreamEventType.OUTPUT_TEXT_DELTA, response_id: 'answer', item_id: 'm', output_index: 0,
      content_index: 0, sequence_number: 1, delta: 'DONE' }; yield { type: StreamEventType.RESPONSE_COMPLETE, response_id: 'answer', status: 'completed', usage, iterations: 1 }; },
    getModelCapabilities: () => ({ supportsTools: true, supportsVision: false, supportsJSON: true, supportsJSONSchema: true, maxTokens: 32000, maxInputTokens: 32000, maxOutputTokens: 512 }),
    validateConfig: async () => true, listModels: async () => [] };
  const name = `native-${agents.length}`;
  Connector.create({ name, vendor: Vendor.OpenAI, auth: { type: 'none' }, options: { provider } });
  const storage = new InMemoryEvidenceStorage({ scope: { ownerId: 'owner', namespace: 'native' } });
  const agent = Agent.create({ connector: name, model: 'fixture', userId: 'owner', modelExecution: { customProviderAttempts: 'single' },
    ...agentConfig,
    context: { ...extra, model: 'fixture', maxContextTokens: max, responseReserve: 100, criticalCompactionThreshold: .7,
      compactionStrategy: new ContextCompactionStrategy(config),
      features: { workingMemory: false, inContextMemory: false, evidence: config.history !== 'off', ...extra.features }, plugins: { ...extra.plugins, evidence: { storage } } } }); agents.push(agent);
  for (let i = 0; i < 5; i++) { agent.context.addUserMessage(`EXACT_USER_${i}`); agent.context.addAssistantResponse([text(MessageRole.ASSISTANT, `ANSWER_${i} ` + 'old details '.repeat(220))]); }
  return { agent, provider, count, compact, generate, storage };
}

describe('16A optional composition policy', () => {
  it.each([
    undefined, {}, { plugins: 'auto' }, { history: 'native' }, { plugins: 'wrong', history: 'off' },
    { plugins: 'off', history: { mode: 'native', preserveRecentTurns: -1 } },
  ])('rejects invalid configuration %j', value => {
    expect(() => new ContextCompactionStrategy(value as ContextCompactionStrategyConfig)).toThrow();
  });
  for (const plugins of ['off', 'auto'] as const) for (const history of ['off', 'native'] as const) {
    it(`supports plugins=${plugins}, history=${history}`, async () => {
      const f = setup({ plugins, history }); const plugin = new Shrinkable(); f.agent.context.registerPlugin(plugin);
      const report = await f.agent.compactContext();
      expect(f.agent.tools).toBe(f.agent.context.tools);
      expect(report.history.status).toBe(history === 'native' ? 'compacted' : 'skipped');
      expect(f.compact).toHaveBeenCalledTimes(history === 'native' ? 1 : 0);
      expect(plugin.calls).toBe(0); // below pressure; manual plugins do not discard gratuitously
      expect(plugin.value).toContain('PLUGIN_EXACT');
      if (history === 'native') expect(f.agent.context.getState()).toHaveProperty('nativeContinuation');
      else expect(f.agent.context.getState()).not.toHaveProperty('nativeContinuation');
    });
  }
  it.each(['run', 'stream'] as const)('%s preserves the complete native window and recent exact turns, using provider counts', async mode => {
    const { agent, compact, generate } = setup();
    const report = await agent.compactContext();
    expect(report.history.status).toBe('compacted'); expect(report.inputTokensAfter).toBeLessThan(report.inputTokensBefore!);
    const snapshot = agent.context.getState();
    expect(snapshot.conversation[0]).toEqual(text(MessageRole.USER, 'RETAINED_NATIVE_USER'));
    expect(snapshot.conversation[1]?.type).toBe('compaction');
    expect(JSON.stringify(snapshot.conversation)).toContain('EXACT_USER_3');
    expect(JSON.stringify(snapshot.conversation)).toContain('EXACT_USER_4');
    expect(JSON.stringify(snapshot.conversation)).not.toContain('EXACT_USER_0');
    if (mode === 'run') await agent.run('CURRENT_EXACT'); else for await (const _event of agent.stream('CURRENT_EXACT')) { /* drain */ }
    expect(compact).toHaveBeenCalledTimes(1); expect(generate).toHaveBeenCalledTimes(1);
    const request = generate.mock.calls[0]![0]; expect(request.nativeContext).toBe(true);
    expect(JSON.stringify(request.input)).toContain('RETAINED_NATIVE_USER');
    expect(JSON.stringify(request.input)).toContain('CURRENT_EXACT');
    expect(agent.context.lastPreparation!.budget.providerCountedInputTokens).toBeGreaterThan(0);
    expect(agent.context.lastPreparation!.budget.totalUsed).toBeGreaterThan(16000);
  });
  it('keeps capability and fresh-budget inspection free of provider count or native calls', async () => {
    const f = setup(); await f.agent.compactContext();
    const counted = f.count.mock.calls.length, native = f.compact.mock.calls.length;
    f.agent.inspectCapabilities(); const budget = await f.agent.context.calculateBudget();
    expect(budget.providerCountedInputTokens).toBeUndefined();
    expect(f.count).toHaveBeenCalledTimes(counted); expect(f.compact).toHaveBeenCalledTimes(native);
  });
  it('keeps plugin history controls independent for all manual targets', async () => {
    const f = setup({ plugins: 'auto', history: 'native' }); const plugin = new Shrinkable(); f.agent.context.registerPlugin(plugin);
    expect((await f.agent.compactContext({ target: 'plugins' })).history.reason).toBe('not_selected'); expect(f.compact).not.toHaveBeenCalled();
    await f.agent.compactContext({ target: 'history' }); expect(plugin.calls).toBe(0); expect(f.compact).toHaveBeenCalledTimes(1);
  });
  it('does not automatically compact when disabled; still permits explicit history operation', async () => {
    const f = setup({ plugins: 'auto', history: 'native', automatic: false });
    await f.agent.run('Current'); expect(f.compact).not.toHaveBeenCalled();
    await f.agent.compactContext(); expect(f.compact).toHaveBeenCalledTimes(1);
  });
  it('retains exact sources and refuses model/strategy changes while native state is active', async () => {
    const f = setup(); await f.agent.compactContext(); const state = f.agent.context.getState();
    const reference = state.nativeContinuation!.sourceReferences[0]!;
    expect(JSON.stringify((await f.storage.readRecord(reference))!.result)).toContain('EXACT_USER_0');
    expect(() => f.agent.setModel('other')).toThrow(); expect(f.agent.model).toBe('fixture');
    expect(() => f.agent.context.setCompactionStrategy(StrategyRegistry.create('algorithmic'))).toThrow();
    f.agent.context.clearConversation(); f.agent.setModel('other'); expect(f.agent.model).toBe('other');
  });
  it('shares native and main invocation budgets and accounts a rejected reduction', async () => {
    const f = setup(); const task = new ModelTask({ limits: { maxCalls: 1 } }); tasks.push(task);
    await f.agent.compactContext({ modelTask: task });
    await expect(f.agent.run('Next', { modelTask: task })).rejects.toThrow(); expect(f.generate).not.toHaveBeenCalled();
    expect(task.snapshot().invocations.map(i => i.purpose)).toEqual(['compactor']);
  });
  it('rejects incomplete tool dependencies in a returned canonical window before committing it', async () => {
    const f = setup();
    f.compact.mockImplementationOnce(async () => ({ protocol: 'test-native-v1', usage, input: [
      { type: 'compaction', id: 'bad', encrypted_content: 'opaque' },
      { type: 'message', role: MessageRole.ASSISTANT, content: [{ type: ContentType.TOOL_USE, id: 'dangling', name: 'lookup', arguments: '{}' }] },
    ] }));
    await expect(f.agent.compactContext()).rejects.toThrow('incomplete tool dependencies');
    expect(f.agent.context.getState()).not.toHaveProperty('nativeContinuation');
    expect(f.agent.getModelUsage()!.totals.calls).toBe(1);
  });
  it('enforces the replay-metadata bound in UTF-8 bytes before changing history', async () => {
    const f = setup(); const actual = f.compact.getMockImplementation()!;
    f.compact.mockImplementationOnce(async request => ({ ...await actual(request), state: { padding: '😀'.repeat(20000) } }));
    await expect(f.agent.compactContext()).rejects.toThrow('metadata exceeds');
    expect(f.agent.context.getState()).not.toHaveProperty('nativeContinuation');
    expect(f.agent.getModelUsage()!.totals.calls).toBe(1);
  });
  it('uses a small custom provider window without imposing an unrelated 4096-token source reserve', async () => {
    const f = setup({ plugins: 'off', history: { mode: 'native', preserveRecentTurns: 0 } });
    f.provider.getModelCapabilities = () => ({ supportsTools: true, supportsVision: false, supportsJSON: true, supportsJSONSchema: true,
      maxTokens: 1024, maxInputTokens: 1024, maxOutputTokens: 256 });
    f.agent.context.clearConversation(); f.agent.context.addUserMessage('OLD');
    f.agent.context.addAssistantResponse([text(MessageRole.ASSISTANT, 'Small historical detail. '.repeat(20))]);
    const report = await f.agent.compactContext(); expect(report.history.status).toBe('compacted'); expect(f.compact).toHaveBeenCalledTimes(1);
  });
  it('keeps history on no reduction while charging the completed native invocation', async () => {
    const f = setup(); const original = f.agent.context.getState().conversation;
    f.compact.mockImplementationOnce(async () => ({ protocol: 'test-native-v1', usage,
      input: [...original, { type: 'compaction', id: 'larger', encrypted_content: 'blob' }] }));
    const report = await f.agent.compactContext(); expect(report.history.reason).toBe('no_reduction');
    expect(f.agent.context.getState().conversation).toEqual(original);
    expect(f.agent.getModelUsage()!.invocations).toHaveLength(1);
  });
  it('holds the execution slot, supports cancellation, and rejects a changed source after native response', async () => {
    const f = setup(); let release!: () => void; let entered!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; }); const started = new Promise<void>(resolve => { entered = resolve; });
    const actual = f.compact.getMockImplementation()!;
    f.compact.mockImplementationOnce(async request => { entered(); await pending; return actual(request); });
    const operation = f.agent.compactContext(); await started;
    await expect(f.agent.run('Concurrent')).rejects.toThrow('active compact');
    f.agent.context.addUserMessage('HOST_EDIT'); release();
    await expect(operation).rejects.toThrow('changed');
    expect(f.agent.context.getState()).not.toHaveProperty('nativeContinuation');
    expect(JSON.stringify(f.agent.context.getCurrentInput())).toContain('HOST_EDIT');
  });
  it('round-trips optional native envelopes and rejects altered or foreign state atomically', async () => {
    const f = setup(); await f.agent.compactContext(); const good = f.agent.context.getState();
    const bad = structuredClone(good); bad.nativeContinuation!.binding.model = 'other';
    expect(() => f.agent.context.restoreState(bad)).toThrow(); expect(f.agent.context.getState().conversation).toEqual(good.conversation);
    const corrupt = structuredClone(good); corrupt.conversation[1] = { type: 'compaction', id: 'forged', encrypted_content: 'forged' };
    expect(() => f.agent.context.restoreState(corrupt)).toThrow();
    f.agent.context.restoreState(structuredClone(good)); await f.agent.run('Resume'); expect(f.generate).toHaveBeenCalledTimes(1);
  });
  it.each(['project', 'organization', 'environment-endpoint'] as const)('binds checkpoint replay to the effective service identity: %s', async changed => {
    const f = setup(); await f.agent.compactContext(); const saved = structuredClone(f.agent.context.getState());
    f.agent.context.clearConversation();
    if (changed === 'environment-endpoint') vi.stubEnv('OPENAI_BASE_URL', 'https://changed.invalid/v1');
    else f.agent.connector.config.options = { ...f.agent.connector.config.options, [changed]: 'OTHER_SERVICE_SCOPE' };
    expect(() => f.agent.setModel('other')).toThrow('transport configuration changed');
    expect(f.agent.model).toBe('fixture'); expect(f.agent.context.model).toBe('fixture');
    expect(() => f.agent.context.restoreState(saved)).toThrow('transport configuration changed');
    expect(f.agent.context.getConversation()).toHaveLength(0);
  });
  it('restores faithful JSON storage that reorders object keys, preserving array order and signed values', async () => {
    const f = setup(); await f.agent.compactContext();
    const reorder = (value: unknown): unknown => Array.isArray(value) ? value.map(reorder)
      : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).reverse().map(([key, child]) => [key, reorder(child)])) : value;
    const state = reorder(f.agent.context.getState()) as SerializedContextState;
    f.agent.context.restoreState(state); await f.agent.run('After a JSONB-style round-trip');
    expect(f.generate).toHaveBeenCalledTimes(1); expect(f.compact).toHaveBeenCalledTimes(1);
  });
  it('reduces a plugin once, rebuilds the complete frame and avoids unnecessary native history work', async () => {
    const f = setup({ plugins: 'auto', history: 'native' }, 5000);
    const plugin = new Shrinkable(); f.agent.context.registerPlugin(plugin);
    f.count.mockImplementation(async o => JSON.stringify(o.input).includes('PLUGIN_EXACT') ? 4800 : 1000);
    await f.agent.run('Current');
    expect(plugin.calls).toBe(1); expect(f.compact).not.toHaveBeenCalled();
    expect(JSON.stringify(f.generate.mock.calls[0]![0].input)).toContain('PLUGIN_COMPACTED');
    expect(f.agent.context.lastPreparation!.compactionDetails).toMatchObject({ plugins: { status: 'compacted', compacted: [plugin.name] }, history: { reason: 'not_needed' } });
  });
  it('automatically compacts history once and dispatches its canonical result', async () => {
    const f = setup({ plugins: 'off', history: 'native' }, 5000);
    f.count.mockImplementation(async o => typeof o.input !== 'string' && o.input.some(i => i.type === 'compaction') ? 2000 : 4800);
    await f.agent.run('Current'); expect(f.compact).toHaveBeenCalledTimes(1); expect(f.generate).toHaveBeenCalledTimes(1);
    expect(f.agent.context.lastPreparation!.compactionDetails!.history.status).toBe('compacted');
  });
  it.each(['put', 'readRecord'] as const)('preserves history when source %s fails before native dispatch', async method => {
    const f = setup(); const original = f.agent.context.getState().conversation;
    vi.spyOn(f.storage, method).mockRejectedValueOnce(new Error('ARCHIVE_FAILED'));
    await expect(f.agent.compactContext()).rejects.toThrow(); expect(f.compact).not.toHaveBeenCalled();
    expect(f.agent.context.getState().conversation).toEqual(original);
  });
  it('rejects redacted source archival instead of discarding exact history', async () => {
    const f = setup(); const actual = f.storage.readRecord.bind(f.storage);
    vi.spyOn(f.storage, 'readRecord').mockImplementation(async ref => {
      const record = await actual(ref); return record ? { ...record, result: { items: [] } } : null;
    });
    await expect(f.agent.compactContext()).rejects.toThrow('redacted'); expect(f.compact).not.toHaveBeenCalled();
  });
  it('rejects removal of the canonical window by a final host hook', async () => {
    const f = setup(); await f.agent.compactContext();
    f.agent.registerHook('before:llm', async () => ({ modified: { input: [text(MessageRole.USER, 'DROP_HISTORY')] } }));
    await expect(f.agent.run('Current')).rejects.toThrow('canonical native window'); expect(f.generate).not.toHaveBeenCalled();
  });
  it('rejects a budget observer changing the current input after provider counting', async () => {
    const f = setup(); await f.agent.compactContext(); let updates = 0;
    f.agent.context.on('budget:updated', () => {
      if (++updates === 2) f.agent.context.addUserMessage('LATE_HOST_EDIT');
    });
    // Force final validation to emit a changed budget after its count.
    const count = f.count.getMockImplementation()!; let n = 0;
    f.count.mockImplementation(async o => await count(o) + ++n);
    await expect(f.agent.run('Current')).rejects.toThrow(); expect(f.generate).not.toHaveBeenCalled();
  });
  it('cancels an uncooperative count without committing native state', async () => {
    const f = setup(); f.count.mockImplementationOnce(async () => await new Promise<number>(() => {}));
    const controller = new AbortController(); const operation = f.agent.compactContext({ signal: controller.signal });
    controller.abort(new Error('STOP_COUNT'));
    await expect(operation).rejects.toThrow('STOP_COUNT'); expect(f.compact).not.toHaveBeenCalled();
  });
  it('forwards manual cancellation to native transport, discards late state and retains late usage', async () => {
    const f = setup(); const controller = new AbortController();
    const task = new ModelTask({ limits: { maxCalls: 2 } }); tasks.push(task);
    let release!: () => void, entered!: () => void; let signal!: AbortSignal;
    const ready = new Promise<void>(resolve => { entered = resolve; }); const pending = new Promise<void>(resolve => { release = resolve; });
    const actual = f.compact.getMockImplementation()!;
    f.compact.mockImplementationOnce(async request => { signal = request.signal!; entered(); await pending; return actual(request); });
    const operation = f.agent.compactContext({ signal: controller.signal, modelTask: task }); await ready;
    controller.abort(new Error('STOP_NATIVE'));
    await expect(operation).rejects.toThrow('STOP_NATIVE'); expect(signal.aborted).toBe(true);
    expect(f.agent.context.getState()).not.toHaveProperty('nativeContinuation');
    release(); await new Promise(resolve => setTimeout(resolve, 0));
    expect(task.snapshot().invocations[0]).toMatchObject({ status: 'cancelled', lateSettlement: true, usage });
    expect(f.agent.context.getState()).not.toHaveProperty('nativeContinuation');
  });
  it('protects historical action groups without acknowledged settled evidence', async () => {
    const f = setup({ plugins: 'off', history: { mode: 'native', preserveRecentTurns: 0 } }); f.agent.context.clearConversation();
    f.agent.context.addInputItems([
      { type: 'message', role: MessageRole.ASSISTANT, content: [{ type: ContentType.TOOL_USE, id: 'write', name: 'submit', arguments: '{}' }] },
      { type: 'message', role: MessageRole.USER, content: [{ type: ContentType.TOOL_RESULT, tool_use_id: 'write', content: 'uncertain' }] },
    ]);
    const report = await f.agent.compactContext(); expect(report.history.reason).toBe('protected'); expect(f.compact).not.toHaveBeenCalled();
  });
  it.each(['settled', 'unknown', 'wrong-execution', 'wrong-arguments', 'wrong-name', 'receipt-only'] as const)('checks acknowledged historical write settlement: %s', async condition => {
    const f = setup({ plugins: 'off', history: { mode: 'native', preserveRecentTurns: 0 } }); f.agent.context.clearConversation();
    const reference = await f.storage.put({ version: 1, recordedAt: 1,
      source: { toolName: condition === 'wrong-name' ? 'other' : 'submit', callId: 'write', executionId: condition === 'wrong-execution' ? 'other' : 'original',
        arguments: condition === 'wrong-arguments' ? { changed: true } : {}, principal: { userId: 'owner' }, effect: 'write', status: 'succeeded',
        completion: condition === 'unknown' ? 'unknown' : 'settled', startedAt: 1, durationMs: 1 },
      ...(condition === 'receipt-only' ? {} : { result: 'ACKNOWLEDGED_RESULT '.repeat(150) }) });
    f.agent.context.addInputItems([
      { type: 'message', role: MessageRole.ASSISTANT, content: [{ type: ContentType.TOOL_USE, id: 'write', name: 'submit', arguments: '{}' }] },
      { type: 'message', role: MessageRole.USER, content: [{ type: ContentType.TOOL_RESULT, tool_use_id: 'write', content: 'ACKNOWLEDGED_RESULT '.repeat(150),
        evidence: { version: 1, status: 'stored', executionId: 'original', reference } }] },
    ]);
    const report = await f.agent.compactContext();
    expect(f.compact).toHaveBeenCalledTimes(condition === 'settled' ? 1 : 0);
    expect(report.history.status).toBe(condition === 'settled' ? 'compacted' : 'skipped');
  });
  it('reports a completed plugin reduction if the later native phase fails', async () => {
    const f = setup({ plugins: 'auto', history: 'native' }, 5000); const plugin = new Shrinkable(); f.agent.context.registerPlugin(plugin);
    f.count.mockImplementation(async () => 4800); f.compact.mockRejectedValueOnce(new Error('NATIVE_FAILED'));
    await expect(f.agent.compactContext()).rejects.toMatchObject({ message: 'NATIVE_FAILED', compaction: {
      status: 'compacted', plugins: { status: 'compacted', compacted: [plugin.name] }, history: { status: 'skipped' } } });
    expect(plugin.value).toBe('PLUGIN_COMPACTED'); expect(plugin.calls).toBe(1);
    expect(f.agent.context.getState()).not.toHaveProperty('nativeContinuation');
  });
  it('resumes into a caller-owned, previously unbound context without changing the shared manager', async () => {
    const f = setup(); await f.agent.compactContext(); const state = structuredClone(f.agent.context.getState());
    const storage: IContextStorage = { getPath: () => 'memory://native', save: async () => {}, load: async sessionId => ({ version: 1, sessionId, createdAt: '', lastSavedAt: '', metadata: {}, state }),
      delete: async () => {}, exists: async () => true, list: async () => [] };
    const context = AgentContextNextGen.create({ model: 'fixture', userId: 'owner', storage,
      features: { workingMemory: false, inContextMemory: false, evidence: true }, plugins: { evidence: { storage: f.storage } },
      compactionStrategy: new ContextCompactionStrategy({ plugins: 'off', history: 'native' }) }); contexts.push(context);
    const resumed = await Agent.resume('native-session', { connector: f.agent.connector.name, model: 'fixture', context,
      modelExecution: { customProviderAttempts: 'single' }, session: { storage } }); agents.push(resumed);
    expect(resumed.context).toBe(context); expect(resumed.tools).toBe(context.tools);
    await resumed.run('Continue'); expect(f.generate).toHaveBeenCalledTimes(1); expect(f.compact).toHaveBeenCalledTimes(1);
  });
  it('keeps committed native state and reports checkpoint failure without repeating compaction', async () => {
    const f = setup(); const state: SerializedContextState = structuredClone(f.agent.context.getState());
    const save = vi.fn<() => Promise<void>>(async () => { throw new Error('CHECKPOINT_FAILED'); });
    const storage: IContextStorage = { getPath: () => 'memory://native', save, load: async sessionId => ({ version: 1, sessionId, createdAt: '', lastSavedAt: '', metadata: {}, state }),
      delete: async () => {}, exists: async () => true, list: async () => [] };
    const agent = await Agent.resume('native-session', { connector: f.agent.connector.name, model: 'fixture', userId: 'owner',
      modelExecution: { customProviderAttempts: 'single' }, session: { storage },
      context: { model: 'fixture', features: { workingMemory: false, inContextMemory: true, evidence: true }, plugins: { evidence: { storage: f.storage } },
        compactionStrategy: new ContextCompactionStrategy({ plugins: 'off', history: 'native' }) } }); agents.push(agent);
    let hooks = 0; agent.setLifecycleHooks({ beforeCompaction: async () => {
      hooks++; agent.context.getPlugin<import('../../../../src/index.js').InContextMemoryPluginNextGen>('in_context_memory')!.set('saved', 'Confirmed host note', 'CHECKPOINT_FACT_37', 'critical');
    } });
    await expect(agent.compactContext()).rejects.toMatchObject({ message: 'CHECKPOINT_FAILED', contextCommitted: true,
      compaction: { status: 'compacted', checkpointed: false } });
    expect(agent.context.getState().nativeContinuation).toBeDefined(); expect(f.compact).toHaveBeenCalledTimes(1);
    expect(f.generate).not.toHaveBeenCalled(); expect(save).toHaveBeenCalledTimes(1); expect(hooks).toBe(1);
    expect(JSON.stringify(agent.context.getState().pluginStates.in_context_memory)).toContain('CHECKPOINT_FACT_37');
    save.mockResolvedValueOnce(undefined); await agent.saveSession();
    expect(hooks).toBe(1); expect(f.compact).toHaveBeenCalledTimes(1); expect(save).toHaveBeenCalledTimes(2);
  });
  it('keeps task state, selected plugin data and native history through a final structured repair', async () => {
    const f = setup(undefined, 16000, { assembly: { maxDataTokens: 300 }, features: { taskState: true },
      plugins: { taskState: { taskId: 'native-task', scope: { ownerId: 'owner', namespace: 'native' } } } });
    const task = f.agent.context.getPlugin<TaskStatePluginNextGen>('task_state')!;
    task.updateHost({ notes: [{ id: 'constraint', category: 'constraint', text: 'CURRENT_HOST_LIMIT_37', source: { label: 'Host' } }] }, task.getState().revision);
    let collections = 0;
    const data = new Shrinkable(); f.agent.context.registerPlugin(data);
    f.agent.context.registerContextContributor(data.name, { getRevision: () => data.value, contribute: async () => { collections++; return [{ id: 'selected', text: 'FRESH_SELECTED_DATA' }]; } });
    await f.agent.compactContext();
    const normal = f.generate.getMockImplementation()!;
    f.generate.mockImplementation(async o => { const r = await normal(o); const value = f.generate.mock.calls.length === 1 ? 'INVALID_JSON' : '{"ok":true}';
      return { ...r, output_text: value, output: [text(MessageRole.ASSISTANT, value)] }; });
    const response = await f.agent.run('Return ok true', { responseFormat: { type: 'json_schema', name: 'native_answer', schema: {
      type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false } } });
    expect(response.output_parsed).toEqual({ ok: true }); expect(f.generate).toHaveBeenCalledTimes(2);
    for (const [request] of f.generate.mock.calls) {
      const wire = JSON.stringify(request.input); expect(wire).toContain('CURRENT_HOST_LIMIT_37'); expect(wire).toContain('FRESH_SELECTED_DATA'); expect(wire).toContain('RETAINED_NATIVE_USER');
    }
    expect(collections).toBeGreaterThan(0); expect(f.compact).toHaveBeenCalledTimes(1);
  });
  it('rejects a host hook changing a protected recent turn while preserving its native block', async () => {
    const f = setup(); await f.agent.compactContext();
    f.agent.registerHook('before:llm', async ({ options }: { options: TextGenerateOptions }) => ({ modified: {
      input: (options.input as InputItem[]).filter(item => !(item.type === 'message' && item.content.some(c => c.type === ContentType.INPUT_TEXT && c.text === 'EXACT_USER_3'))) } }));
    await expect(f.agent.run('Current')).rejects.toThrow('protected recent'); expect(f.generate).not.toHaveBeenCalled();
  });
});

describe('16A prefix boundaries', () => {
  it('never splits a connected tool group or a retained native window', () => {
    const history: InputItem[] = [text(MessageRole.USER, 'old'),
      { type: 'message', role: MessageRole.ASSISTANT, content: [{ type: ContentType.TOOL_USE, id: 'call', name: 'lookup', arguments: '{}' }] },
      text(MessageRole.USER, 'recent'), { type: 'message', role: MessageRole.USER, content: [{ type: ContentType.TOOL_RESULT, tool_use_id: 'call', content: 'result' }] }];
    expect(nativePrefixCutoff(history, [], 1)).toBe(1);
    expect(nativePrefixCutoff(history, [], 1, 2)).toBe(0);
    expect(nativePrefixCutoff(history, [history[3]!], 0)).toBe(1);
  });
});

describe('16A review corrections: bounded composition and early admission', () => {
  it('keeps plugin-only compaction independent of a previously bound native driver', async () => {
    const f = setup(undefined, 5000); f.agent.context.clearConversation();
    f.agent.context.setCompactionStrategy(new ContextCompactionStrategy({ plugins: 'auto', history: 'off' }));
    f.agent.setModel('other');
    const plugin = new Shrinkable(); plugin.value = 'PLUGIN_EXACT '.repeat(2400); f.agent.context.registerPlugin(plugin);
    const report = await f.agent.compactContext({ target: 'plugins' });
    expect(report.plugins.status).toBe('compacted'); expect(plugin.calls).toBe(1);
    expect(f.count).not.toHaveBeenCalled(); expect(f.compact).not.toHaveBeenCalled();
  });
  it.each(['run', 'stream'] as const)('%s rejects a pending server token before reduction or archival', async mode => {
    const f = setup({ plugins: 'auto', history: 'native' }, 5000);
    const plugin = new Shrinkable(); f.agent.context.registerPlugin(plugin);
    f.count.mockResolvedValue(4800); const put = vi.spyOn(f.storage, 'put');
    const before = structuredClone(f.agent.context.getConversation());
    const operation = mode === 'run' ? f.agent.run('Next', { continuationToken: 'server-state' })
      : (async () => { for await (const _event of f.agent.stream('Next', { continuationToken: 'server-state' })) { /* drain */ } })();
    await expect(operation).rejects.toThrow('server-owned state');
    expect(plugin.calls).toBe(0); expect(f.compact).not.toHaveBeenCalled(); expect(put).not.toHaveBeenCalled(); expect(f.generate).not.toHaveBeenCalled();
    expect(f.agent.context.getConversation()).toEqual(before);
    expect(f.agent.getModelUsage()!.totals.calls).toBe(0);
    // Rejection does not consume the execution slot or prevent a supported turn.
    f.count.mockResolvedValue(1000); await f.agent.run('A compatible new input'); expect(f.generate).toHaveBeenCalledTimes(1);
  });
  it.each(['all', 'plugins', 'history'] as const)('rejects configured hosted tools before manual target %s', async target => {
    const f = setup({ plugins: 'auto', history: 'native' }, 5000, {}, { nativeTools: [{ capability: 'web_search' }], dataHandling: { allowProviderTools: true } });
    const plugin = new Shrinkable(); f.agent.context.registerPlugin(plugin);
    // Exercise a supported hosted tool with explicit policy permission, so the
    // rejection concerns native ownership rather than a missing data permission.
    f.count.mockResolvedValue(4800); const put = vi.spyOn(f.storage, 'put');
    const before = structuredClone(f.agent.context.getConversation());
    await expect(f.agent.compactContext({ target })).rejects.toThrow('hosted tools');
    expect(plugin.calls).toBe(0); expect(put).not.toHaveBeenCalled(); expect(f.compact).not.toHaveBeenCalled();
    expect(f.agent.context.getConversation()).toEqual(before); expect(f.agent.getModelUsage()!.totals.calls).toBe(0);
  });
  it.each(['manual', 'automatic'] as const)('bounds contributor work after history mutation: %s', async mode => {
    const f = setup({ plugins: 'off', history: 'native' }, 5000, { assembly: { timeoutMs: 1000, maxDataTokens: 100 } });
    const plugin = new Shrinkable(); f.agent.context.registerPlugin(plugin); let collections = 0;
    f.agent.context.registerContextContributor(plugin.name, { getRevision: () => 1, contribute: () => {
      collections++; return [{ id: 'current', text: 'CURRENT_SOURCE' }];
    } });
    f.count.mockImplementation(async request => (request.input as InputItem[]).some(i => i.type === 'compaction') ? 1000 : 4800);
    if (mode === 'manual') await f.agent.compactContext(); else await f.agent.run('Next');
    expect(collections).toBe(mode === 'manual' ? 1 : 2);
    expect(f.compact).toHaveBeenCalledTimes(1); expect(f.count.mock.calls.length).toBeLessThanOrEqual(mode === 'manual' ? 4 : 7);
    if (mode === 'automatic') expect(JSON.stringify(f.generate.mock.calls[0]![0].input)).toContain('CURRENT_SOURCE');
  });
  it('rebuilds current source contributions after plugin reduction, then after native mutation', async () => {
    const f = setup({ plugins: 'auto', history: 'native' }, 5000, { assembly: { timeoutMs: 1000, maxDataTokens: 100 } });
    const plugin = new Shrinkable(); f.agent.context.registerPlugin(plugin); const rendered: string[] = [];
    f.agent.context.registerContextContributor(plugin.name, { getRevision: () => plugin.value, contribute: () => {
      rendered.push(plugin.value); return [{ id: 'source', text: plugin.value.slice(0, 60) }];
    } });
    f.count.mockImplementation(async request => (request.input as InputItem[]).some(i => i.type === 'compaction') ? 1000 : 4800);
    await f.agent.run('Next'); expect(plugin.calls).toBe(1); expect(f.compact).toHaveBeenCalledTimes(1);
    expect(rendered).toHaveLength(3); expect(rendered[0]).toContain('PLUGIN_EXACT'); expect(rendered.slice(1)).toEqual(['PLUGIN_COMPACTED', 'PLUGIN_COMPACTED']);
    expect(JSON.stringify(f.generate.mock.calls[0]![0].input)).toContain('PLUGIN_COMPACTED');
  });
  it.each(['manual', 'automatic'] as const)('cancels a nested signal-observing contribution at the shared deadline: %s', async mode => {
    vi.useFakeTimers();
    const f = setup({ plugins: 'auto', history: 'native' }, 5000, { assembly: { timeoutMs: 40, maxDataTokens: 100 } });
    const plugin = new Shrinkable(); f.agent.context.registerPlugin(plugin); let collections = 0; let nestedSignal: AbortSignal | undefined;
    let entered!: () => void; const ready = new Promise<void>(resolve => { entered = resolve; });
    f.agent.context.registerContextContributor(plugin.name, { getRevision: () => plugin.value, contribute: ({ signal }) => {
      if (++collections === 1) return [{ id: 'first', text: 'FIRST' }];
      nestedSignal = signal; entered();
      return new Promise((_resolve, reject) => { signal.addEventListener('abort', () => reject(signal.reason), { once: true }); });
    } });
    f.count.mockResolvedValue(4800);
    const operation = mode === 'manual' ? f.agent.compactContext() : f.agent.run('Next');
    const settled = operation.then(() => undefined, error => error);
    try {
      await ready; await vi.advanceTimersByTimeAsync(40);
      expect(nestedSignal?.aborted).toBe(true);
      expect(await settled).toMatchObject({ code: 'CONTEXT_ASSEMBLY_TIMEOUT' });
    } finally { f.agent.cancel('TEST_CLEANUP'); await settled; vi.useRealTimers(); }
    expect(plugin.calls).toBe(1); expect(f.compact).not.toHaveBeenCalled(); expect(f.generate).not.toHaveBeenCalled();
    expect(f.agent.context.getState().nativeContinuation).toBeUndefined();
  });
  it('honors host cancellation during rebuilt contributions without waiting for the deadline', async () => {
    const f = setup({ plugins: 'auto', history: 'native' }, 5000, { assembly: { timeoutMs: 1000, maxDataTokens: 100 } });
    const plugin = new Shrinkable(); f.agent.context.registerPlugin(plugin); let calls = 0;
    let started!: () => void; const ready = new Promise<void>(resolve => { started = resolve; });
    f.agent.context.registerContextContributor(plugin.name, { getRevision: () => plugin.value, contribute: ({ signal }) => {
      if (++calls === 1) return [{ id: 'first', text: 'FIRST' }];
      started(); return new Promise((_resolve, reject) => { signal.addEventListener('abort', () => reject(signal.reason), { once: true }); });
    } });
    f.count.mockResolvedValue(4800); const operation = f.agent.run('Next'); await ready; f.agent.cancel('HOST_CANCEL');
    await expect(operation).rejects.toThrow('HOST_CANCEL'); expect(f.compact).not.toHaveBeenCalled(); expect(f.generate).not.toHaveBeenCalled();
  });
  it('refreshes a contributor revision changed by a compaction hook before native work', async () => {
    const f = setup({ plugins: 'off', history: 'native' }, 5000, { assembly: { maxDataTokens: 100 } });
    const plugin = new Shrinkable(); f.agent.context.registerPlugin(plugin); let revision = 1;
    const revisions: number[] = [];
    f.agent.context.registerContextContributor(plugin.name, { getRevision: () => revision, contribute: () => {
      revisions.push(revision); return [{ id: 'source', text: revision === 1 ? 'OLD_SOURCE' : 'HOOK_SOURCE_2' }];
    } });
    f.agent.context.setBeforeCompactionCallback(async () => { revision++; });
    f.count.mockImplementation(async request => (request.input as InputItem[]).some(i => i.type === 'compaction') ? 1000 : 4800);
    await f.agent.run('Next'); expect(f.compact).toHaveBeenCalledTimes(1);
    expect(revisions).toEqual([1, 2, 2]);
    const input = JSON.stringify(f.generate.mock.calls[0]![0].input);
    expect(input).toContain('HOOK_SOURCE_2'); expect(input).not.toContain('OLD_SOURCE');
  });
});

describe('16A second-review corrections', () => {
  const invoke = async (agent: Agent, mode: 'run' | 'stream' | 'manual', modelTask?: ModelTask, signal?: AbortSignal) => {
    if (mode === 'manual') return agent.compactContext({ modelTask, signal });
    if (mode === 'run') return agent.run('Next', { modelTask });
    for await (const _event of agent.stream('Next', { modelTask })) { /* drain */ }
    return undefined;
  };
  it.each(['run', 'stream'] as const)('%s preserves whiteboard writes from beforeCompaction', async mode => {
    let f!: ReturnType<typeof setup>; let hooks = 0;
    f = setup(undefined, 5000, { features: { inContextMemory: true } }, { lifecycleHooks: { beforeCompaction: async () => {
      hooks++; f.agent.context.getPlugin<import('../../../../src/index.js').InContextMemoryPluginNextGen>('in_context_memory')!
        .set('critical', 'Preserved host fact', 'HOOK_FACT_37', 'critical');
    } } });
    f.count.mockImplementation(async request => (request.input as InputItem[]).some(i => i.type === 'compaction') ? 1000 : 4800);
    await invoke(f.agent, mode);
    expect(hooks).toBe(1); expect(f.compact).toHaveBeenCalledTimes(1); expect(f.generate).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(f.generate.mock.calls[0]![0].input)).toContain('HOOK_FACT_37');
  });
  it.each(['run', 'stream'] as const)('%s preserves notes written by beforeCompaction', async mode => {
    let f!: ReturnType<typeof setup>; let hooks = 0;
    f = setup(undefined, 5000, { features: { workingMemory: true } }, { lifecycleHooks: { beforeCompaction: async () => {
      hooks++; await f.agent.context.memory!.store('preserved', 'HOOK_NOTES_37', { exact: 'HOOK_FACT_37' }, { tier: 'findings', pinned: true });
    } } });
    f.count.mockImplementation(async request => (request.input as InputItem[]).some(i => i.type === 'compaction') ? 1000 : 4800);
    await invoke(f.agent, mode);
    expect(hooks).toBe(1); expect(f.compact).toHaveBeenCalledTimes(1); expect(f.generate).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(f.generate.mock.calls[0]![0].input)).toContain('HOOK_NOTES_37');
    expect(JSON.stringify(f.agent.context.memory!.getState())).toContain('HOOK_FACT_37');
  });
  it('recounts hook changes and skips native work when pressure disappears', async () => {
    const f = setup(undefined, 5000); const plugin = new Shrinkable(); f.agent.context.registerPlugin(plugin);
    f.agent.context.setBeforeCompactionCallback(async () => { plugin.value = 'SHORT_AFTER_HOOK'; });
    f.count.mockImplementation(async request => JSON.stringify(request.input).includes('PLUGIN_EXACT') ? 4800 : 1000);
    const put = vi.spyOn(f.storage, 'put');
    await f.agent.run('Next');
    expect(f.compact).not.toHaveBeenCalled(); expect(put).not.toHaveBeenCalled(); expect(plugin.calls).toBe(0);
    expect(JSON.stringify(f.generate.mock.calls[0]![0].input)).toContain('SHORT_AFTER_HOOK');
    expect(f.agent.context.lastPreparation?.compactionDetails?.history.reason).toBe('not_needed');
  });
  it.each([['timeout', 'run'], ['cancel', 'run'], ['timeout', 'manual'], ['cancel', 'manual']] as const)('bounds a hook-triggered contribution refresh: %s %s', async (condition, mode) => {
    vi.useFakeTimers();
    const f = setup(undefined, 5000, { assembly: { timeoutMs: 40, maxDataTokens: 100 } });
    const plugin = new Shrinkable(); f.agent.context.registerPlugin(plugin); let collections = 0;
    let entered!: () => void; const ready = new Promise<void>(resolve => { entered = resolve; });
    f.agent.context.registerContextContributor(plugin.name, { getRevision: () => plugin.value, contribute: ({ signal }) => {
      if (++collections === 1) return [{ id: 'first', text: 'FIRST' }];
      entered(); return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    } });
    f.agent.context.setBeforeCompactionCallback(async () => { plugin.value = 'HOOK_CHANGED'; });
    f.count.mockResolvedValue(4800);
    const settled = (mode === 'manual' ? f.agent.compactContext() : f.agent.run('Next')).then(() => undefined, error => error);
    try {
      // A baseline defect may reject before entering the refresh; avoid hanging its red run.
      await Promise.race([ready, settled]);
      if (condition === 'timeout') await vi.advanceTimersByTimeAsync(40); else f.agent.cancel('HOOK_REFRESH_CANCEL');
      const error = await settled;
      expect(collections).toBe(2);
      if (condition === 'timeout') expect(error).toMatchObject({ code: 'CONTEXT_ASSEMBLY_TIMEOUT' });
      else expect(error.message).toBe('HOOK_REFRESH_CANCEL');
      expect(f.compact).not.toHaveBeenCalled(); expect(f.generate).not.toHaveBeenCalled();
    } finally { f.agent.cancel('CLEANUP'); await settled; vi.useRealTimers(); }
  });
  it.each(['prompt', 'input', 'tools', 'scope'] as const)('does not refresh away a changed protected hook boundary: %s', async changed => {
    const f = setup(undefined, 5000); const plugin = new Shrinkable(); f.agent.context.registerPlugin(plugin);
    f.count.mockResolvedValue(4800); const put = vi.spyOn(f.storage, 'put');
    f.agent.context.setBeforeCompactionCallback(async () => {
      plugin.value = 'SAVED_BY_HOOK';
      if (changed === 'prompt') f.agent.context.systemPrompt = 'CHANGED_HOST_PROMPT';
      if (changed === 'input') f.agent.context.addUserMessage('CHANGED_INPUT');
      if (changed === 'tools') f.agent.tools.register({ definition: { type: 'function', function: { name: 'new_tool', description: 'Changed visibility', parameters: { type: 'object', properties: {} } } }, execute: async () => 'ok' });
      if (changed === 'scope') Object.defineProperty(f.storage, 'scope', { value: { ...f.storage.scope, namespace: 'CHANGED_SCOPE' } });
    });
    await expect(f.agent.run('Next')).rejects.toThrow(/changed|scope/i);
    expect(put).not.toHaveBeenCalled(); expect(f.compact).not.toHaveBeenCalled(); expect(f.generate).not.toHaveBeenCalled();
  });
  for (const mode of ['run', 'stream', 'manual'] as const) for (const cause of ['cancel', 'deadline'] as const) {
    it(`cancels a stalled native proof and releases ${mode} ownership: ${cause}`, async () => {
      if (cause === 'deadline') vi.useFakeTimers();
      const f = setup(); await f.agent.compactContext();
      const before = structuredClone(f.agent.context.getConversation()); const original = f.storage.readRecord.bind(f.storage);
      let entered!: () => void, release!: (value: Awaited<ReturnType<typeof original>>) => void;
      const ready = new Promise<void>(resolve => { entered = resolve; });
      const pending = new Promise<Awaited<ReturnType<typeof original>>>(resolve => { release = resolve; });
      const read = vi.spyOn(f.storage, 'readRecord').mockImplementationOnce(async () => { entered(); return pending; });
      const task = new ModelTask({ limits: cause === 'deadline' ? { deadline: Date.now() + 200 } : {} }); tasks.push(task);
      const controller = new AbortController();
      const settled = invoke(f.agent, mode, task, controller.signal).then(() => undefined, error => error);
      await ready;
      if (cause === 'cancel') {
        if (mode === 'manual') controller.abort(new Error('PROOF_CANCEL')); else f.agent.cancel('PROOF_CANCEL');
      } else await vi.advanceTimersByTimeAsync(200);
      try {
        const outcome = Promise.race([settled, new Promise<undefined>(resolve => setTimeout(resolve, 400))]);
        if (cause === 'deadline') await vi.advanceTimersByTimeAsync(400);
        const error = await outcome;
        expect(error?.message).toBe(cause === 'deadline' ? 'Model task deadline exceeded' : 'PROOF_CANCEL');
        expect(f.agent.context.getConversation()).toEqual(before); expect(f.generate).not.toHaveBeenCalled();
        expect(f.compact).toHaveBeenCalledTimes(1);
        // Recovery must work even while the old read is still unresolved.
        await f.agent.run('RECOVERED'); expect(f.generate).toHaveBeenCalledTimes(1);
        const recovered = structuredClone(f.agent.context.getConversation());
        release(await original(f.agent.context.getState().nativeContinuation!.sourceReferences[0]!));
        await settled; await Promise.resolve();
        expect(f.agent.context.getConversation()).toEqual(recovered); expect(read.mock.calls.length).toBeGreaterThan(1);
      } finally { release(null); await settled; }
    });
  }
  it('observes a late proof rejection without resuming a cancelled operation', async () => {
    const f = setup(); await f.agent.compactContext();
    let entered!: () => void, reject!: (error: Error) => void;
    const ready = new Promise<void>(resolve => { entered = resolve; });
    vi.spyOn(f.storage, 'readRecord').mockImplementationOnce(() => { entered(); return new Promise((_resolve, fail) => { reject = fail; }); });
    const settled = f.agent.run('Next').then(() => undefined, error => error); await ready; f.agent.cancel('LATE_PROOF');
    try {
      expect((await Promise.race([settled, new Promise<undefined>(resolve => setTimeout(resolve, 100))]))?.message).toBe('LATE_PROOF');
    } finally { reject(new Error('LATE_BACKEND_FAILURE')); await settled; }
    await f.agent.run('RECOVERED'); expect(f.generate).toHaveBeenCalledTimes(1); expect(f.compact).toHaveBeenCalledTimes(1);
  });
  it('does not start a proof read for an already-aborted manual operation', async () => {
    const f = setup(); await f.agent.compactContext(); const read = vi.spyOn(f.storage, 'readRecord');
    const controller = new AbortController(); controller.abort(new Error('ALREADY_CANCELLED'));
    await expect(f.agent.compactContext({ signal: controller.signal })).rejects.toThrow('ALREADY_CANCELLED');
    expect(read).not.toHaveBeenCalled(); expect(f.compact).toHaveBeenCalledTimes(1);
  });
});

describe('16A second-review proof boundaries and compatibility', () => {
  it('can refresh plugin-only memory at the hook boundary without a native adapter call', async () => {
    const f = setup({ plugins: 'auto', history: 'off' }, 5000); f.agent.context.clearConversation();
    const plugin = new Shrinkable(); plugin.value = 'PLUGIN_EXACT '.repeat(3000); f.agent.context.registerPlugin(plugin);
    f.agent.context.setBeforeCompactionCallback(async () => { plugin.value = 'PRESERVED_SMALL'; });
    await f.agent.run('Next');
    expect(JSON.stringify(f.generate.mock.calls[0]![0].input)).toContain('PRESERVED_SMALL');
    expect(plugin.calls).toBe(0); expect(f.count).not.toHaveBeenCalled(); expect(f.compact).not.toHaveBeenCalled();
  });
  it('preserves the algorithmic lifecycle hook contract', async () => {
    const f = setup(undefined, 5000, { features: { inContextMemory: true } });
    f.agent.context.setCompactionStrategy(StrategyRegistry.create('algorithmic')); let hooks = 0;
    f.agent.context.setBeforeCompactionCallback(async () => {
      hooks++; f.agent.context.getPlugin<import('../../../../src/index.js').InContextMemoryPluginNextGen>('in_context_memory')!.set('saved', 'Saved in hook', 'SAVED_FACT', 'critical');
    });
    await f.agent.run('Next'); expect(hooks).toBe(1);
    expect(JSON.stringify(f.generate.mock.calls[0]![0].input)).toContain('SAVED_FACT'); expect(f.compact).not.toHaveBeenCalled();
  });
  it('cancels a later retained-source proof without losing the earlier chain', async () => {
    const f = setup(); await f.agent.compactContext();
    for (let i = 0; i < 3; i++) { f.agent.context.addUserMessage(`NEW_${i}`); f.agent.context.addAssistantResponse([text(MessageRole.ASSISTANT, 'More historical details. '.repeat(200))]); }
    await f.agent.compactContext();
    const snapshot = structuredClone(f.agent.context.getState()); expect(snapshot.nativeContinuation!.sourceReferences).toHaveLength(2);
    const original = f.storage.readRecord.bind(f.storage);
    let entered!: () => void, release!: () => void;
    const ready = new Promise<void>(resolve => { entered = resolve; }), pending = new Promise<void>(resolve => { release = resolve; });
    const read = vi.spyOn(f.storage, 'readRecord').mockImplementationOnce(original).mockImplementationOnce(async reference => {
      entered(); await pending; return original(reference);
    });
    const settled = f.agent.run('Next').then(() => undefined, error => error); await ready; f.agent.cancel('SECOND_PROOF_CANCEL');
    try {
      expect((await Promise.race([settled, new Promise<undefined>(resolve => setTimeout(resolve, 100))]))?.message).toBe('SECOND_PROOF_CANCEL');
      expect(f.agent.context.getConversation()).toEqual(snapshot.conversation); expect(f.agent.context.getState().nativeContinuation).toEqual(snapshot.nativeContinuation);
      await f.agent.run('RECOVERED'); expect(f.generate).toHaveBeenCalledTimes(1); expect(f.compact).toHaveBeenCalledTimes(2);
    } finally { release(); await settled; read.mockRestore(); }
  });
  it.each(['action', 'archive'] as const)('bounds read-only %s proof waits before native dispatch', async phase => {
    const f = setup({ plugins: 'off', history: { mode: 'native', preserveRecentTurns: 0 } });
    if (phase === 'action') {
      f.agent.context.clearConversation();
      const reference = await f.storage.put({ version: 1, recordedAt: 1,
        source: { toolName: 'submit', callId: 'write', executionId: 'original', arguments: {}, principal: { userId: 'owner' },
          effect: 'write', status: 'succeeded', completion: 'settled', startedAt: 1, durationMs: 1 }, result: 'ACKNOWLEDGED_RESULT '.repeat(150) });
      f.agent.context.addInputItems([
        { type: 'message', role: MessageRole.ASSISTANT, content: [{ type: ContentType.TOOL_USE, id: 'write', name: 'submit', arguments: '{}' }] },
        { type: 'message', role: MessageRole.USER, content: [{ type: ContentType.TOOL_RESULT, tool_use_id: 'write', content: 'ACKNOWLEDGED_RESULT '.repeat(150),
          evidence: { version: 1, status: 'stored', executionId: 'original', reference } }] },
      ]);
    }
    const before = structuredClone(f.agent.context.getConversation()); const put = vi.spyOn(f.storage, 'put');
    let entered!: () => void, release!: () => void;
    const ready = new Promise<void>(resolve => { entered = resolve; }), pending = new Promise<void>(resolve => { release = resolve; });
    vi.spyOn(f.storage, 'readRecord').mockImplementationOnce(async () => { entered(); await pending; return null; });
    const controller = new AbortController();
    const settled = f.agent.compactContext({ signal: controller.signal }).then(() => undefined, error => error);
    await ready; controller.abort(new Error('READ_PROOF_CANCEL'));
    try {
      expect((await Promise.race([settled, new Promise<undefined>(resolve => setTimeout(resolve, 100))]))?.message).toBe('READ_PROOF_CANCEL');
      expect(f.agent.context.getConversation()).toEqual(before); expect(f.agent.context.getState().nativeContinuation).toBeUndefined();
      expect(put).toHaveBeenCalledTimes(phase === 'archive' ? 1 : 0); expect(f.compact).not.toHaveBeenCalled(); expect(f.generate).not.toHaveBeenCalled();
    } finally { release(); await settled; }
  });
  it('keeps the lease until an admitted archival write settles after cancellation', async () => {
    const f = setup(); const original = f.storage.put.bind(f.storage);
    let entered!: () => void, release!: () => void;
    const ready = new Promise<void>(resolve => { entered = resolve; }), pending = new Promise<void>(resolve => { release = resolve; });
    vi.spyOn(f.storage, 'put').mockImplementationOnce(async record => { entered(); await pending; return original(record); });
    const controller = new AbortController();
    const settled = f.agent.compactContext({ signal: controller.signal }).then(() => undefined, error => error);
    await ready; controller.abort(new Error('WRITE_CANCEL'));
    try {
      expect(await Promise.race([settled.then(() => 'settled'), new Promise<string>(resolve => setTimeout(() => resolve('pending'), 20))])).toBe('pending');
      await expect(f.agent.run('Concurrent')).rejects.toThrow('active compact');
    } finally { release(); }
    expect((await settled).message).toBe('WRITE_CANCEL'); expect(f.compact).not.toHaveBeenCalled();
    await f.agent.run('RECOVERED'); expect(f.generate).toHaveBeenCalledTimes(1);
  });
  it('does not read proofs for an already-cancelled ModelTask', async () => {
    const f = setup(); await f.agent.compactContext(); const read = vi.spyOn(f.storage, 'readRecord');
    const task = new ModelTask(); tasks.push(task); task.cancel(new Error('TASK_ALREADY_CANCELLED'));
    await expect(f.agent.run('Next', { modelTask: task })).rejects.toThrow('TASK_ALREADY_CANCELLED');
    expect(read).not.toHaveBeenCalled(); expect(f.generate).not.toHaveBeenCalled();
  });
  it('still rejects missing retained sources without dispatch or native replacement', async () => {
    const f = setup(); await f.agent.compactContext(); const before = structuredClone(f.agent.context.getState());
    vi.spyOn(f.storage, 'readRecord').mockResolvedValueOnce(null);
    await expect(f.agent.run('Next')).rejects.toThrow('source is missing');
    expect(f.generate).not.toHaveBeenCalled(); expect(f.compact).toHaveBeenCalledTimes(1);
    expect(f.agent.context.getState().nativeContinuation).toEqual(before.nativeContinuation);
    await f.agent.run('RECOVERED'); expect(f.generate).toHaveBeenCalledTimes(1);
  });
});

describe('16A second-review pending native session load', () => {
  it.each(['run', 'stream', 'manual', 'manual-signal', 'deadline'] as const)('cancels a %s waiting on a host-owned load, then recovers the same checkpoint', async mode => {
    if (mode === 'deadline') vi.useFakeTimers();
    const f = setup(); await f.agent.compactContext(); const snapshot = structuredClone(f.agent.context.getState());
    const storage: IContextStorage = { getPath: () => 'memory://native', save: async () => {},
      load: async sessionId => ({ version: 1, sessionId, createdAt: '', lastSavedAt: '', metadata: {}, state: snapshot }),
      delete: async () => {}, exists: async () => true, list: async () => [] };
    const original = f.storage.readRecord.bind(f.storage);
    let entered!: () => void, release!: () => void;
    const ready = new Promise<void>(resolve => { entered = resolve; }), pending = new Promise<void>(resolve => { release = resolve; });
    vi.spyOn(f.storage, 'readRecord').mockImplementationOnce(async reference => { entered(); await pending; return original(reference); });
    const resumed = Agent.create({ connector: f.agent.connector.name, model: 'fixture', userId: 'owner',
      modelExecution: { customProviderAttempts: 'single' }, session: { id: 'saved-native', storage },
      context: { model: 'fixture', features: { workingMemory: false, inContextMemory: false, evidence: true },
        plugins: { evidence: { storage: f.storage } }, compactionStrategy: new ContextCompactionStrategy({ plugins: 'off', history: 'native' }) } }); agents.push(resumed);
    await ready;
    const controller = new AbortController();
    const task = new ModelTask({ limits: mode === 'deadline' ? { deadline: Date.now() + 50 } : {} }); tasks.push(task);
    const operation = mode === 'manual' || mode === 'manual-signal' ? resumed.compactContext({ signal: controller.signal })
      : mode === 'stream' ? (async () => { for await (const _event of resumed.stream('CANCELLED_STARTUP')) { /* drain */ } })()
      : resumed.run('CANCELLED_STARTUP', { modelTask: task });
    const settled = operation.then(() => undefined, error => error);
    // Both APIs acquire their lease synchronously before their first await.
    if (mode === 'manual-signal') controller.abort(new Error('STARTUP_CANCEL'));
    else if (mode === 'deadline') await vi.advanceTimersByTimeAsync(50);
    else resumed.cancel('STARTUP_CANCEL');
    let recovery: Promise<unknown> | undefined;
    try {
      const outcome = Promise.race([settled, new Promise<undefined>(resolve => setTimeout(resolve, 100))]);
      if (mode === 'deadline') await vi.advanceTimersByTimeAsync(100);
      expect((await outcome)?.message).toBe(mode === 'deadline' ? 'Model task deadline exceeded' : 'STARTUP_CANCEL');
      expect(f.generate).not.toHaveBeenCalled(); expect(f.compact).toHaveBeenCalledTimes(1);
      // The independent, already-started restore still owns its checkpoint. A
      // fresh turn waits for it instead of bypassing or poisoning the load.
      recovery = resumed.run('RECOVERED_STARTUP');
      expect(f.generate).not.toHaveBeenCalled(); release(); await recovery;
      expect(f.generate).toHaveBeenCalledTimes(1); expect(f.compact).toHaveBeenCalledTimes(1);
      expect(resumed.context.getState().nativeContinuation).toEqual(snapshot.nativeContinuation);
      expect(JSON.stringify(resumed.context.getConversation())).not.toContain('CANCELLED_STARTUP');
      expect(JSON.stringify(resumed.context.getConversation())).toContain('RECOVERED_STARTUP');
    } finally { release(); await settled; await recovery; }
  });
});

describe('16A third-review manual lifecycle', () => {
  it('leaves custom native adapters in charge of their own thinking replay representation', async () => {
    const f = setup({ plugins: 'off', history: { mode: 'native', preserveRecentTurns: 0 } });
    f.agent.context.addAssistantResponse([{ type: 'message', role: MessageRole.ASSISTANT, content: [
      { type: ContentType.THINKING, thinking: 'CUSTOM_FACT_37', persistInHistory: true, providerMetadata: { customReplay: 'CUSTOM_OPAQUE' } },
      { type: ContentType.OUTPUT_TEXT, text: 'Custom answer' },
    ] }]);
    expect((await f.agent.compactContext()).history.status).toBe('compacted');
    expect(JSON.stringify(f.compact.mock.calls[0]![0].input)).toContain('CUSTOM_OPAQUE');
  });

  it('preflights evidence ownership before manual counting, hooks or mutation', async () => {
    const f = setup(); f.agent.context.userId = 'different-owner';
    let hooks = 0; f.agent.context.setBeforeCompactionCallback(async () => { hooks++; });
    await expect(f.agent.compactContext()).rejects.toThrow('scoped evidence');
    expect(hooks).toBe(0); expect(f.count).not.toHaveBeenCalled(); expect(f.compact).not.toHaveBeenCalled();
  });

  for (const target of ['all', 'history', 'plugins'] as const) for (const store of ['whiteboard', 'notes'] as const) {
    it(`preserves ${store} once during explicit ${target} with automatic disabled`, async () => {
      const f = setup({ plugins: 'auto', history: 'native', automatic: false }, 5000,
        { features: { inContextMemory: true, workingMemory: true } });
      const plugin = new Shrinkable(); f.agent.context.registerPlugin(plugin);
      const events: string[] = [];
      f.agent.context.on('compaction:starting', () => events.push('starting'));
      f.agent.context.on('context:compacted', () => events.push('compacted'));
      let hooks = 0;
      f.agent.setLifecycleHooks({ beforeCompaction: async () => {
        hooks++; events.push('hook');
        if (store === 'whiteboard') f.agent.context.getPlugin<import('../../../../src/index.js').InContextMemoryPluginNextGen>('in_context_memory')!
          .set('saved', 'Confirmed host fact', 'MANUAL_FACT_37', 'critical');
        else await f.agent.context.memory!.store('saved', 'MANUAL_NOTE_37', 'MANUAL_FACT_37', { tier: 'findings', pinned: true });
      } });
      f.count.mockImplementation(async request => (request.input as InputItem[]).some(item => item.type === 'compaction') ? 1000 : JSON.stringify(request.input).includes('PLUGIN_EXACT') ? 4800 : 1000);
      const report = await f.agent.compactContext({ target });
      expect(hooks).toBe(1); expect(events).toEqual(['starting', 'hook', 'compacted']);
      expect(report.trigger).toBe('manual'); expect(report.status).toBe('compacted');
      expect(f.compact).toHaveBeenCalledTimes(target === 'plugins' ? 0 : 1);
      expect(plugin.calls).toBe(target === 'history' ? 0 : 1);
      expect(JSON.stringify(f.agent.context.getPlugin(store === 'whiteboard' ? 'in_context_memory' : 'working_memory')!.getState())).toContain('MANUAL_FACT_37');
      expect(f.generate).not.toHaveBeenCalled();
    });
  }
  it('refreshes a manual hook contribution once and retains the manual target', async () => {
    const f = setup({ plugins: 'off', history: 'native', automatic: false }, 5000, { assembly: { maxDataTokens: 100 } });
    const plugin = new Shrinkable(); f.agent.context.registerPlugin(plugin); let revision = 1;
    const revisions: number[] = [];
    f.agent.context.registerContextContributor(plugin.name, { getRevision: () => revision, contribute: () => {
      revisions.push(revision); return [{ id: 'source', text: `CURRENT_SOURCE_${revision}` }];
    } });
    f.agent.context.setBeforeCompactionCallback(async () => { revision++; });
    await f.agent.compactContext({ target: 'history' });
    expect(revisions).toEqual([1, 2]); expect(f.compact).toHaveBeenCalledTimes(1);
    expect(f.compact.mock.calls[0]![0].instructions).not.toContain('CURRENT_SOURCE_1');
    expect(plugin.calls).toBe(0);
  });
  it.each(['prompt', 'input', 'tools', 'scope'] as const)('rejects protected manual hook edits: %s', async changed => {
    const f = setup(); const put = vi.spyOn(f.storage, 'put');
    f.agent.context.setBeforeCompactionCallback(async () => {
      if (changed === 'prompt') f.agent.context.systemPrompt = 'CHANGED';
      if (changed === 'input') f.agent.context.addUserMessage('CHANGED');
      if (changed === 'tools') f.agent.tools.register({ definition: { type: 'function', function: { name: 'changed', description: 'Changed tool', parameters: { type: 'object', properties: {} } } }, execute: async () => true });
      if (changed === 'scope') Object.defineProperty(f.storage, 'scope', { value: { ...f.storage.scope, namespace: 'changed' } });
    });
    await expect(f.agent.compactContext()).rejects.toThrow(/changed|scope/i);
    expect(put).not.toHaveBeenCalled(); expect(f.compact).not.toHaveBeenCalled();
  });
  it('keeps hook errors best effort and emits no completed event on a skipped manual operation', async () => {
    const f = setup(); f.agent.context.clearConversation(); let hooks = 0;
    f.agent.context.setBeforeCompactionCallback(async () => { hooks++; throw new Error('HOOK_FAILED'); });
    const completed = vi.fn(); f.agent.context.on('context:compacted', completed);
    expect((await f.agent.compactContext()).status).toBe('skipped');
    expect(hooks).toBe(1); expect(completed).not.toHaveBeenCalled(); expect(f.compact).not.toHaveBeenCalled();
  });
  it.each(['cancel', 'deadline'] as const)('keeps hook mutation ownership until settlement, then stops manual work: %s', async cause => {
    vi.useFakeTimers(); const f = setup();
    let entered!: () => void, release!: () => void;
    const ready = new Promise<void>(resolve => { entered = resolve; }), pending = new Promise<void>(resolve => { release = resolve; });
    f.agent.context.setBeforeCompactionCallback(async () => { entered(); await pending; });
    const task = new ModelTask({ limits: cause === 'deadline' ? { deadline: Date.now() + 50 } : {} }); tasks.push(task);
    const operation = f.agent.compactContext({ modelTask: task }).then(() => undefined, error => error);
    try {
      await Promise.race([ready, operation]);
      if (cause === 'deadline') await vi.advanceTimersByTimeAsync(50); else f.agent.cancel('MANUAL_HOOK_CANCEL');
      await expect(f.agent.run('Concurrent')).rejects.toThrow('active compact');
      release(); const error = await operation;
      expect(error?.message).toBe(cause === 'deadline' ? 'Model task deadline exceeded' : 'MANUAL_HOOK_CANCEL');
      expect(f.compact).not.toHaveBeenCalled();
    } finally { release(); await operation; }
    f.agent.context.setBeforeCompactionCallback(null); await f.agent.compactContext();
    expect(f.compact).toHaveBeenCalledTimes(1);
  });
});
