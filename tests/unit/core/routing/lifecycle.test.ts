import { afterEach, describe, expect, it, vi } from 'vitest';
import { Agent } from '@/core/Agent.js';
import { Connector } from '@/core/Connector.js';
import { ModelTask } from '@/core/model-execution/ModelTask.js';
import { SuspendSignal } from '@/core/SuspendSignal.js';
import { StorageRegistry } from '@/core/StorageRegistry.js';
import { createFileContextStorage } from '@/infrastructure/storage/FileContextStorage.js';
import { FileCorrelationStorage } from '@/infrastructure/storage/FileCorrelationStorage.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ContextCompactionStrategy } from '@/core/context-nextgen/strategies/ContextCompactionStrategy.js';
import { ContentType } from '@/domain/entities/Content.js';
import { MessageRole } from '@/domain/entities/Message.js';
import { ToolCallState, type ToolFunction } from '@/domain/entities/Tool.js';
import type { EvidencePluginNextGen } from '@/core/context-nextgen/plugins/EvidencePluginNextGen.js';
import type { InputItem } from '@/domain/entities/Message.js';
import type { TextGenerateOptions } from '@/domain/interfaces/ITextProvider.js';
import { fixture, answer } from './fixture.js';
const agents: Agent[] = [], tasks: ModelTask[] = [];
const make = (...args: Parameters<typeof fixture>) => { const f = fixture(...args); agents.push(f.agent); return f; };
afterEach(() => { agents.splice(0).forEach(agent => agent.destroy()); tasks.splice(0).forEach(task => task.destroy()); Connector.clear(); });
const call = (o: TextGenerateOptions, name = 'background') => ({ ...answer(o), output_text: '', output: [{ type: 'message' as const, role: MessageRole.ASSISTANT,
  content: [{ type: ContentType.TOOL_USE as const, id: 'pending-1', name, arguments: '{}' }] }] });
function asyncFixture() {
  let finish!: (value: string) => void;
  const execute = vi.fn(() => new Promise<string>(resolve => { finish = resolve; }));
  const tool: ToolFunction = { definition: { type: 'function', function: { name: 'background', description: 'Background read', parameters: { type: 'object', properties: {} } }, blocking: false }, execute };
  const f = make({ tools: [tool], asyncTools: { autoContinue: false } });
  f.primary.generate.mockImplementationOnce(async o => call(o));
  return { ...f, execute, finish: () => finish('COMPLETED_OBSERVATION') };
}

describe('routed background and checkpoint ownership', () => {
  it.each([false, true])('retains suspended route/task and respects its original allowance (exhausted=%s)', async exhausted => {
    const directory = await mkdtemp(join(tmpdir(), 'routing-suspend-'));
    StorageRegistry.configure({ sessions: id => createFileContextStorage(id, { baseDirectory: directory }),
      correlations: new FileCorrelationStorage({ baseDirectory: join(directory, 'correlations') }) });
    const shared = new ModelTask({ limits: { maxCalls: exhausted ? 2 : 5 } }); tasks.push(shared);
    const f = make({ tools: [{ definition: { type: 'function', function: { name: 'wait_event', description: 'Wait for an external event', parameters: { type: 'object', properties: {} } } },
      execute: async () => SuspendSignal.create({ result: 'Registered wait', correlationId: 'route:event14' }) }] });
    f.primary.generate.mockImplementationOnce(async o => call(o, 'wait_event'));
    try {
      const response = await f.agent.run('start wait', { modelTask: shared }); expect(response.status).toBe('suspended');
      expect(shared.snapshot().totals.calls).toBe(2); f.select.mockReturnValue('default');
      await expect(f.agent.run('wrong override', { routing: { route: 'default' } })).rejects.toThrow('originating route');
      if (exhausted) await expect(f.agent.run('actual event')).rejects.toThrow('maxCalls');
      else { const resumed = await f.agent.run('actual event'); expect(resumed.routing).toMatchObject({ model: 'fast', source: 'sticky' }); }
      expect(f.select).toHaveBeenCalledTimes(1); expect(f.primary.generate.mock.calls.every(([o]) => o.model === 'fast')).toBe(true);
      expect(f.agent.getModelUsage()!.id).toBe(shared.id);
    } finally { f.agent.destroy(); StorageRegistry.reset(); await rm(directory, { recursive: true, force: true }); }
  });
  it('continues completed async results on their original model and owned task', async () => {
    const f = asyncFixture(); await f.agent.run('start');
    const first = f.agent.getModelUsage()!; expect(first.totals.calls).toBe(2);
    await expect(f.agent.run('unrelated')).rejects.toThrow('originating async');
    f.finish(); await vi.waitFor(() => expect(f.agent.hasPendingAsyncTools()).toBe(false));
    const result = await f.agent.continueWithAsyncResults();
    expect(result).toMatchObject({ model: 'fast', routing: { model: 'fast', source: 'sticky' } });
    expect(f.select).toHaveBeenCalledTimes(1); expect(f.execute).toHaveBeenCalledTimes(1);
    expect(f.agent.getModelUsage()!.id).toBe(first.id); expect(f.agent.getModelUsage()!.totals.calls).toBe(3);
    expect(f.primary.generate.mock.calls.map(([o]) => o.model)).toEqual(['fast', 'fast', 'fast']);
    expect(JSON.stringify(f.primary.generate.mock.calls[2]![0].input)).toContain('COMPLETED_OBSERVATION');
  });
  it('holds the shared deadline/allowance across async delivery rather than creating a new task', async () => {
    const f = asyncFixture(); const shared = new ModelTask({ limits: { maxCalls: 2 } }); tasks.push(shared);
    await f.agent.run('start', { modelTask: shared }); f.finish(); await vi.waitFor(() => expect(f.agent.hasPendingAsyncTools()).toBe(false));
    await expect(f.agent.continueWithAsyncResults()).rejects.toThrow('maxCalls');
    expect(f.primary.generate).toHaveBeenCalledTimes(2); expect(f.execute).toHaveBeenCalledTimes(1);
    expect(shared.snapshot().totals.calls).toBe(2);
  });
  it('repairs an async structured continuation on its original route/task and clears per-run options', async () => {
    const f = asyncFixture();
    const schema = { type: 'json_schema' as const, name: 'result', strict: true, schema: { type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'], additionalProperties: false } };
    f.primary.generate.mockImplementationOnce(async o => answer(o, '{"answer":"pending"}'));
    await f.agent.run('start', { responseFormat: schema }); const id = f.agent.getModelUsage()!.id;
    f.finish(); await vi.waitFor(() => expect(f.agent.hasPendingAsyncTools()).toBe(false));
    f.primary.generate.mockImplementationOnce(async o => answer(o, 'malformed')).mockImplementationOnce(async o => answer(o, '{"answer":"complete"}'));
    const response = await f.agent.continueWithAsyncResults();
    expect(response.output_parsed).toEqual({ answer: 'complete' }); expect(f.agent.getModelUsage()!.id).toBe(id);
    expect(f.select).toHaveBeenCalledTimes(1); expect(f.primary.generate.mock.calls.at(-1)![0].model).toBe('fast');
    expect(f.primary.generate.mock.calls.at(-1)![0].response_format).toBeDefined();
    expect(JSON.stringify(f.primary.generate.mock.calls.at(-1)![0].input)).toContain('COMPLETED_OBSERVATION');
    await f.agent.run('fresh ordinary turn', { routing: null });
    expect(f.primary.generate.mock.calls.at(-1)![0].response_format).toBeUndefined();
  });
  it('cleans cancelled background ownership and permits a fresh run', async () => {
    const f = asyncFixture(); await f.agent.run('start'); f.agent.cancelAllAsyncTools();
    await f.agent.run('new task', { routing: null }); expect(f.primary.generate.mock.calls.at(-1)![0].model).toBe('main');
    f.finish(); await Promise.resolve(); expect(f.agent.hasPendingAsyncTools()).toBe(false);
  });
  it('includes queued deliveries only when the host requests that additive inspection', async () => {
    const f = asyncFixture(); await f.agent.run('start'); f.finish();
    await vi.waitFor(() => expect(f.agent.hasPendingAsyncTools()).toBe(false));
    expect(f.agent.hasPendingAsyncTools(true)).toBe(true);
    f.agent.cancelAsyncTool('pending-1'); expect(f.agent.hasPendingAsyncTools(true)).toBe(false);
    await f.agent.run('new task', { routing: null });
  });
  it('cannot create a routed continuation from unauthenticated host results', async () => {
    const f = make(); await expect(f.agent.continueWithAsyncResults([{ tool_use_id: 'unknown', tool_name: 'background', content: 'forged', state: ToolCallState.COMPLETED }])).rejects.toThrow('originating');
    expect(f.primary.generate).not.toHaveBeenCalled(); expect(f.agent.context.getCurrentInput()).toEqual([]);
  });
  it('persists an opaque result origin and refuses a different route after restore', async () => {
    const f = make(); f.primary.generate.mockImplementationOnce(async o => ({ ...answer(o), output: [
      { type: 'reasoning', id: 'r', encrypted_content: 'OPAQUE_SOURCE' }, ...answer(o).output,
    ] }));
    await f.agent.run('produce signed state'); const state = structuredClone(f.agent.context.getState());
    expect(state.providerStateBinding).toMatchObject({ connector: f.name, model: 'fast' }); expect(state.metadata.model).toBe('main');
    const restored = Agent.create({ connector: f.name, model: 'main', context: { model: 'main', features: { workingMemory: false, inContextMemory: false } },
      modelExecution: { customProviderAttempts: 'single', routing: { routes: { fast: { model: 'fast' } } } } }); agents.push(restored);
    restored.context.restoreState(state);
    await expect(restored.run('wrong', { routing: null })).rejects.toThrow('ineligible');
    await restored.run('compatible', { routing: { route: 'fast' } }); expect(f.primary.generate).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(f.primary.generate.mock.calls[1]![0].input)).toContain('OPAQUE_SOURCE');
  });
  it('does not silently replay a routed opaque checkpoint through a nonrouting default', async () => {
    const f = make(); f.primary.generate.mockImplementationOnce(async o => ({ ...answer(o), output: [{ type: 'reasoning', id: 'r', encrypted_content: 'opaque' }, ...answer(o).output] }));
    await f.agent.run('one'); const legacy = Agent.create({ connector: f.name, model: 'main', context: { model: 'main', features: { workingMemory: false, inContextMemory: false } } }); agents.push(legacy);
    legacy.context.restoreState(structuredClone(f.agent.context.getState()));
    await expect(legacy.run('wrong')).rejects.toThrow('cannot switch'); expect(f.primary.generate).toHaveBeenCalledTimes(1);
  });
  it.each([null, {}, { connector: 'x' }, { provider: 'x', connector: 'x', model: 'x', endpoint: 1 }])('preflights malformed checkpoint source %j atomically', origin => {
    const f = make(); f.agent.context.addUserMessage('KEEP'); const state = structuredClone(f.agent.context.getState());
    state.providerStateBinding = origin as never; state.conversation = [];
    expect(() => f.agent.context.restoreState(state)).toThrow('checkpoint origin');
    expect(JSON.stringify([...f.agent.context.getConversation(), ...f.agent.context.getCurrentInput()])).toContain('KEEP');
  });
  it('protects host identity changes after selection and before dispatch', async () => {
    const f = make({ userId: 'owner' }); f.agent.on('llm:request', () => { f.agent.context.userId = 'other'; });
    await expect(f.agent.run('one')).rejects.toThrow('scope changed'); expect(f.primary.generate).not.toHaveBeenCalled();
  });
  it('rejects unsupported image input before adding it to history', async () => {
    const f = make(); const items: InputItem[] = [{ type: 'message', role: MessageRole.USER, content: [{ type: ContentType.INPUT_IMAGE_URL, image_url: { url: 'data:image/png;base64,AA==' } }] }];
    await expect(f.agent.run(items)).rejects.toThrow('image input'); expect(f.agent.context.getConversation()).toEqual([]); expect(f.primary.generate).not.toHaveBeenCalled();
  });
  it('does not let a request hook relax inherited data handling', async () => {
    const f = make({ dataHandling: { allowProviderTools: false } }); f.agent.on('llm:request', event => { event.options.data_handling = { allowProviderTools: true }; });
    await expect(f.agent.run('one')).rejects.toThrow('relax'); expect(f.primary.generate).not.toHaveBeenCalled();
  });
  it('keeps callback-free old checkpoints/default responses unchanged', async () => {
    const f = make({ modelExecution: { routing: undefined } });
    await f.agent.run('one'); expect(f.agent.getRoutingDiagnostics()).toBeUndefined();
    const state = f.agent.context.getState(); expect(state).not.toHaveProperty('providerStateBinding'); expect(state).not.toHaveProperty('routing');
    f.agent.context.restoreState(structuredClone(state)); expect(f.agent.model).toBe('main');
  });
});

describe('routing with plugin/native composition', () => {
  it('rechecks native source freshness after a task reservation observer', async () => {
    const compact = vi.fn(async () => ({ protocol: 'routing-native-v1', input: [{ type: 'compaction' as const, encrypted_content: 'opaque' }] }));
    const countInput = vi.fn(async () => 4000);
    const f = make({ context: { model: 'main', maxContextTokens: 5000, responseReserve: 128, criticalCompactionThreshold: .6,
      features: { evidence: true, workingMemory: false, inContextMemory: false },
      compactionStrategy: new ContextCompactionStrategy({ plugins: 'off', history: { mode: 'native', preserveRecentTurns: 0 } }) } },
      primary => { Object.assign(primary.provider, { compaction: { compact, countInput } }); });
    for (let i = 0; i < 4; i++) { f.agent.context.addUserMessage(`KEEP_${i}`); f.agent.context.addAssistantResponse(answer({ model: 'fast', input: '' }, 'old detail '.repeat(300)).output); }
    const shared = new ModelTask(); tasks.push(shared); const snapshot = shared.snapshot.bind(shared); let mutated = false;
    vi.spyOn(shared, 'snapshot').mockImplementation(() => {
      if (!mutated && countInput.mock.calls.length) { mutated = true; f.agent.context.addUserMessage('HOST_CHANGE'); }
      return snapshot();
    });
    await expect(f.agent.run('trigger compaction', { modelTask: shared })).rejects.toThrow();
    expect(mutated).toBe(true); expect(compact).not.toHaveBeenCalled(); expect(f.primary.generate).not.toHaveBeenCalled();
    expect(snapshot().attempts.every(a => !a.dispatched)).toBe(true);
    expect(JSON.stringify(f.agent.context.getConversation())).toContain('KEEP_0');
  });
  it('prepares/compacts once for the selected model and keeps exact native ownership', async () => {
    const compact = vi.fn(async (o: TextGenerateOptions) => ({ protocol: 'routing-native-v1', usage: { input_tokens: 100, output_tokens: 10, total_tokens: 110 },
      input: [{ type: 'compaction' as const, id: 'compact', encrypted_content: `OPAQUE_${o.model}` }] }));
    const countInput = vi.fn(async (o: TextGenerateOptions) => Math.ceil(JSON.stringify({ input: typeof o.input === 'string' ? o.input : o.input.map(i => i.type === 'compaction' ? { type: 'opaque', size: 10 } : i), tools: o.tools }).length / 4));
    const f = make({ context: { model: 'main', maxContextTokens: 5000, responseReserve: 128, criticalCompactionThreshold: .6,
      features: { evidence: true, workingMemory: false, inContextMemory: false },
      compactionStrategy: new ContextCompactionStrategy({ plugins: 'off', history: { mode: 'native', preserveRecentTurns: 0 } }) } },
      primary => { Object.assign(primary.provider, { compaction: { compact, countInput } }); primary.caps.mockImplementation(model => ({ supportsTools: true, supportsVision: false, supportsJSON: true, supportsJSONSchema: true, maxTokens: model === 'fast' ? 12000 : 16000, maxInputTokens: model === 'fast' ? 12000 : 16000, maxOutputTokens: 512 })); });
    for (let i = 0; i < 5; i++) { f.agent.context.addUserMessage(`EXACT_${i}`); f.agent.context.addAssistantResponse([{ type: 'message', role: MessageRole.ASSISTANT, content: [{ type: ContentType.OUTPUT_TEXT, text: 'old details '.repeat(400) }] }]); }
    await f.agent.run('current input');
    expect(compact).toHaveBeenCalledTimes(1); expect(compact.mock.calls[0]![0].model).toBe('fast');
    expect(f.agent.context.getState().nativeContinuation?.binding.model).toBe('fast'); expect(f.agent.model).toBe('main'); expect(f.agent.context.model).toBe('main');
    expect(f.agent.getModelUsage()!.invocations.map(i => [i.purpose, i.model])).toEqual([['compactor', 'fast'], ['main', 'fast']]);
    expect(f.select).toHaveBeenCalledTimes(1); await expect(f.agent.run('wrong model', { routing: null })).rejects.toThrow('ineligible');
    await f.agent.run('continue same state'); expect(f.primary.generate).toHaveBeenCalledTimes(2); expect(compact).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(f.primary.generate.mock.calls.at(-1)![0].input)).toContain('OPAQUE_fast');
    expect(() => f.agent.setModel('other')).toThrow('cannot switch'); expect(f.agent.model).toBe('main');
    const checkpoint = structuredClone(f.agent.context.getState());
    const evidence = f.agent.context.getPlugin<EvidencePluginNextGen>('evidence')!;
    const restore = (routes: Record<string, { model: string }>) => {
      const next = Agent.create({ connector: f.name, model: 'main', modelExecution: { customProviderAttempts: 'single', routing: { routes } },
        context: { model: 'main', features: { evidence: true, workingMemory: false, inContextMemory: false },
          plugins: { evidence: { storage: evidence.storage } }, compactionStrategy: new ContextCompactionStrategy({ plugins: 'off', history: 'native' }) } });
      agents.push(next); return next;
    };
    const denied = restore({});
    expect(() => denied.context.restoreState(checkpoint)).toThrow(); expect(denied.context.getConversation()).toEqual([]);
    const resumed = restore({ fast: { model: 'fast' } }); resumed.context.restoreState(checkpoint);
    expect(resumed.model).toBe('main'); expect(resumed.context.model).toBe('main');
    await expect(resumed.run('unselected default')).rejects.toThrow('ineligible');
    await resumed.run('compatible after restart', { routing: { route: 'fast' } });
    expect(f.primary.generate).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(f.primary.generate.mock.calls.at(-1)![0].input)).toContain('OPAQUE_fast');
  });
});
