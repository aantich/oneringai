import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Agent } from '@/core/Agent.js';
import { Connector } from '@/core/Connector.js';
import { StorageRegistry } from '@/core/StorageRegistry.js';
import { SuspendSignal } from '@/core/SuspendSignal.js';
import { ModelTask } from '@/core/model-execution/ModelTask.js';
import { FileContextStorage } from '@/infrastructure/storage/FileContextStorage.js';
import { FileCorrelationStorage } from '@/infrastructure/storage/FileCorrelationStorage.js';
import { ContentType } from '@/domain/entities/Content.js';
import { MessageRole } from '@/domain/entities/Message.js';
import type { OutputItem } from '@/domain/entities/Message.js';
import { StreamEventType } from '@/domain/entities/StreamEvent.js';
import type { RunOptions } from '@/core/Agent.js';
import { answer, fixture } from './fixture.js';
const agents: Agent[] = [], tasks: ModelTask[] = [], directories: string[] = [];
const make = (...args: Parameters<typeof fixture>) => { const f = fixture(...args); agents.push(f.agent); return f; };
const format = { type: 'json_schema' as const, name: 'answer', strict: true, schema: { type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'], additionalProperties: false } };
afterEach(async () => {
  vi.restoreAllMocks(); agents.splice(0).forEach(a => a.destroy()); tasks.splice(0).forEach(t => t.destroy()); Connector.clear(); StorageRegistry.reset();
  await Promise.all(directories.splice(0).map(d => rm(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })));
});
function opaque(kind: string, output: OutputItem[]): OutputItem[] {
  if (kind === 'reasoning' || kind === 'compaction') return [{ type: kind, id: 'repaired-state', encrypted_content: 'REPAIRED_OPAQUE' }, ...output] as OutputItem[];
  const first = output[0]!; if (first.type !== 'message') throw new Error('Expected response message');
  return [{ ...first, content: [kind === 'thinking'
    ? { type: ContentType.THINKING, thinking: 'synthetic reasoning', signature: 'REPAIRED_OPAQUE', persistInHistory: true }
    : { type: ContentType.PROVIDER_STATE, provider: 'google', data: { marker: 'REPAIRED_OPAQUE' } }, ...first.content] }];
}
async function consume(agent: Agent, mode: 'run' | 'stream', options?: RunOptions) {
  if (mode === 'run') return agent.run('Continue', options);
  for await (const _event of agent.stream('Continue', options)) { /* consume all events */ }
  return undefined;
}
async function setupSuspension(options: { fallback?: boolean; calls?: number; malformed?: boolean; owned?: boolean; budget?: "tokens" | "cost" | "deadline"; assembly?: boolean } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'routing-second-fixes-')); directories.push(directory);
  const storage = new FileContextStorage({ agentId: 'second-fixes', baseDirectory: directory });
  const correlations = new FileCorrelationStorage({ baseDirectory: join(directory, 'correlations') }); StorageRegistry.configure({ correlations });
  const wait = vi.fn(async () => SuspendSignal.create({ result: 'WAIT_ACKNOWLEDGED', correlationId: 'second:event' }));
  const select = vi.fn(() => 'fast');
  const deadline = Date.now() + 60_000;
  const limits = { maxCalls: options.calls ?? 8, ...(options.budget === 'tokens' ? { maxTokens: 6150 } : {}), ...(options.budget === 'cost' ? { maxCostUSD: .00615 } : {}), ...(options.budget === 'deadline' ? { deadline } : {}) };
  const f = make({ context: { model: 'main', ...(options.assembly ? { assembly: {} } : {}) }, session: { storage, autoSave: false }, tools: [{ definition: { type: 'function', function: { name: 'wait_event', description: 'Register wait', parameters: { type: 'object', properties: {} } } }, execute: wait }],
    modelExecution: { customProviderAttempts: 'single', ...(options.owned ? { limits } : {}), routing: { routes: { fast: { model: 'fast', priceBound: { inputPerMillion: 1, outputPerMillion: 1 } } }, select } } }, primary => {
      if (options.fallback) primary.caps.mockImplementation(() => ({ supportsTools: true, supportsVision: false, supportsJSON: false, supportsJSONSchema: false, maxTokens: 16000, maxInputTokens: 16000, maxOutputTokens: 128 }));
    });
  f.primary.generate.mockImplementationOnce(async o => ({ ...answer(o, ''), output: [{ type: 'message', role: MessageRole.ASSISTANT,
    content: [{ type: ContentType.TOOL_USE, id: 'wait-1', name: 'wait_event', arguments: '{}' }] }] }))
    .mockImplementationOnce(async o => ({ ...answer(o, options.malformed ? 'NOT_JSON' : '{"answer":"WAITING"}'), ...(options.budget === 'tokens' || options.budget === 'cost' ? { usage: { input_tokens: 6000, output_tokens: 128, total_tokens: 6128 } } : {}) }))
    .mockImplementation(async o => answer(o, '{"answer":"FORMATTED"}'));
  const task = options.owned ? undefined : new ModelTask({ limits }); if (task) tasks.push(task);
  return { ...f, select, deadline, directory, storage, correlations, wait, task };
}

describe('S1 repaired replay state', () => {
  for (const kind of ['thinking', 'provider_state', 'reasoning', 'compaction']) for (const mode of ['run', 'stream'] as const) {
    it(`preserves ${kind} and rejects a subsequent ${mode} owner change with routing absent`, async () => {
      const f = make({ modelExecution: { routing: undefined } });
      f.primary.generate.mockImplementationOnce(async o => answer(o, 'NOT_JSON')).mockImplementationOnce(async o => ({ ...answer(o, '{"answer":"OK"}'), output: opaque(kind, answer(o, '{"answer":"OK"}').output) }));
      const response = await f.agent.run('Return JSON', { responseFormat: format });
      expect(response.output_parsed).toEqual({ answer: 'OK' });
      const state = structuredClone(f.agent.context.getState());
      expect(JSON.stringify(state.conversation)).toContain('REPAIRED_OPAQUE'); expect(state.providerStateBinding?.model).toBe('main');
      expect(state.conversation.filter(i => i.type === 'message' && i.role === MessageRole.ASSISTANT)).toHaveLength(1);
      f.agent.registerHook('before:llm', (hook: { options: { model: string } }) => { hook.options.model = 'other'; return {}; });
      await expect(consume(f.agent, mode)).rejects.toThrow(/replay|owner/); expect(f.primary.generate).toHaveBeenCalledTimes(2);
    });
  }
  it('keeps portable repaired history compatible with legacy model hooks', async () => {
    const f = make({ modelExecution: { routing: undefined } });
    f.primary.generate.mockImplementationOnce(async o => answer(o, 'NOT_JSON')).mockImplementation(async o => answer(o, '{"answer":"OK"}'));
    await f.agent.run('JSON', { responseFormat: format }); f.agent.on('llm:request', event => { event.options.model = 'other'; });
    await f.agent.run('Continue'); expect(f.primary.generate.mock.calls.at(-1)![0].model).toBe('other'); expect(f.agent.context.getState()).not.toHaveProperty('providerStateBinding');
  });
  it('commits newly signed prompt reformat output even when its JSON text is unchanged', async () => {
    const f = make({ modelExecution: { routing: undefined }, tools: [{ definition: { type: 'function', function: { name: 'read', description: 'Read', parameters: { type: 'object', properties: {} } } }, execute: async () => 'unused' }] }, primary => {
      primary.caps.mockImplementation(() => ({ supportsTools: true, supportsVision: false, supportsJSON: false, supportsJSONSchema: false, maxTokens: 16000, maxInputTokens: 16000, maxOutputTokens: 128 }));
    });
    f.primary.generate.mockImplementationOnce(async o => answer(o, '{"answer":"OK"}')).mockImplementationOnce(async o => ({ ...answer(o, '{"answer":"OK"}'), output: opaque('thinking', answer(o, '{"answer":"OK"}').output) }));
    const response = await f.agent.run('JSON', { responseFormat: format });
    expect(response.output_parsed).toEqual({ answer: 'OK' }); expect(JSON.stringify(f.agent.context.getState().conversation)).toContain('REPAIRED_OPAQUE');
    expect(f.agent.context.getState().providerStateBinding?.model).toBe('main'); expect(f.primary.generate).toHaveBeenCalledTimes(2);
  });
  it('keeps repaired state and ordering in the checkpoint and existing file journal', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'repair-journal-')); directories.push(directory);
    const storage = new FileContextStorage({ agentId: 'repair', baseDirectory: directory });
    const f = make({ modelExecution: { routing: undefined }, session: { storage, autoSave: false } });
    await f.agent.saveSession('repair');
    f.primary.generate.mockImplementationOnce(async o => answer(o, 'NOT_JSON')).mockImplementationOnce(async o => ({ ...answer(o, '{"answer":"OK"}'), output: opaque('reasoning', answer(o, '{"answer":"OK"}').output) }));
    await f.agent.run('JSON', { responseFormat: format }); await f.agent.saveSession();
    // Journal writes remain asynchronous and ordered; poll their public view.
    await vi.waitFor(async () => { const rows = await storage.journal.read('repair'); expect(rows.at(-2)?.item.type).toBe('reasoning'); expect(JSON.stringify(rows.at(-1)?.item)).toContain('OK'); });
    const saved = await storage.load('repair'); expect(saved?.state.providerStateBinding?.model).toBe('main'); expect(JSON.stringify(saved?.state)).toContain('REPAIRED_OPAQUE');
    const restored = Agent.create({ connector: f.name, model: 'main', context: { model: 'main', features: { workingMemory: false, inContextMemory: false } } }); agents.push(restored);
    restored.context.restoreState(saved!.state); restored.context.userId = 'different-owner';
    await expect(restored.run('Continue')).rejects.toThrow(/principal|scope/); expect(f.primary.generate).toHaveBeenCalledTimes(2);
  });
  it('appends a repaired empty response without replacing its preceding tool-call receipt', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'empty-repair-journal-')); directories.push(directory);
    const storage = new FileContextStorage({ agentId: 'empty-repair', baseDirectory: directory });
    const read = vi.fn(async () => 'OBSERVED_VALUE');
    const f = make({ emptyResponseRetry: { enabled: false }, modelExecution: { routing: undefined }, session: { storage, autoSave: false },
      tools: [{ definition: { type: 'function', function: { name: 'read', description: 'Read', parameters: { type: 'object', properties: {} } } }, execute: read }] });
    await f.agent.saveSession('empty-repair');
    f.primary.generate.mockImplementationOnce(async o => ({ ...answer(o, ''), output: [{ type: 'message', role: MessageRole.ASSISTANT,
      content: [{ type: ContentType.TOOL_USE, id: 'read-1', name: 'read', arguments: '{}' }] }] }))
      .mockImplementationOnce(async o => ({ ...answer(o, ''), output: [] }))
      .mockImplementationOnce(async o => answer(o, '{"answer":"OBSERVED_VALUE"}'));
    const response = await f.agent.run('Read and return JSON', { responseFormat: format });
    expect(response.output_parsed).toEqual({ answer: 'OBSERVED_VALUE' }); expect(read).toHaveBeenCalledTimes(1);
    expect(f.agent.getModelUsage()?.invocations.at(-1)?.phase).toBe('repair');
    await vi.waitFor(async () => {
      const rows = await storage.journal.read('empty-repair');
      expect(rows.some(row => row.item.type === 'message' && row.item.content.some(part => part.type === ContentType.TOOL_USE && part.id === 'read-1'))).toBe(true);
      const last = rows.at(-1)?.item;
      expect(last?.type === 'message' && last.content.some(part => part.type === ContentType.OUTPUT_TEXT && part.text === response.output_text)).toBe(true);
    });
    expect(f.agent.context.getConversation().some(item => item.type === 'message' && item.content.some(part => part.type === ContentType.TOOL_USE && part.id === 'read-1'))).toBe(true);
  });
  it('preserves the admitted principal if the host changes scope while repair is pending', async () => {
    const f = make({ userId: 'original', modelExecution: { routing: undefined } });
    f.primary.generate.mockImplementationOnce(async o => answer(o, 'NOT_JSON')).mockImplementationOnce(async o => {
      f.agent.context.userId = 'changed'; return { ...answer(o, '{"answer":"OK"}'), output: opaque('provider_state', answer(o, '{"answer":"OK"}').output) };
    });
    await f.agent.run('JSON', { responseFormat: format }); expect(f.agent.context.getState().providerStateBinding?.userId).toBe('original');
    await expect(f.agent.run('Continue')).rejects.toThrow(/principal|scope/); expect(f.primary.generate).toHaveBeenCalledTimes(2);
  });
  it('does not replace an unrelated assistant observation inserted during repair', async () => {
    const f = make({ modelExecution: { routing: undefined } });
    f.primary.generate.mockImplementationOnce(async o => answer(o, 'NOT_JSON')).mockImplementationOnce(async o => {
      f.agent.context.addAssistantResponse(answer(o, 'HOST_OBSERVATION').output); return answer(o, '{"answer":"OK"}');
    });
    await expect(f.agent.run('JSON', { responseFormat: format })).rejects.toThrow('changed during structured');
    expect(JSON.stringify(f.agent.context.getConversation().at(-1))).toContain('HOST_OBSERVATION');
  });
});

describe('S2 rejected resume retains ownership', () => {
  for (const mode of ['run', 'stream'] as const) it(`${mode} cannot reset a spent shared task by retrying an event`, async () => {
    const f = await setupSuspension({ calls: 2 }); await f.agent.run('Wait', { responseFormat: format, modelTask: f.task }); f.select.mockReturnValue('default');
    for (let i = 0; i < 2; i++) await expect(consume(f.agent, mode)).rejects.toThrow('maxCalls');
    expect(f.primary.generate).toHaveBeenCalledTimes(2); expect(f.select).toHaveBeenCalledTimes(1); expect(f.wait).toHaveBeenCalledTimes(1);
    expect(f.agent.getModelUsage()?.id).toBe(f.task!.id);
  });
  it('preserves an owned task until explicit host cancellation abandons the pending execution', async () => {
    const f = await setupSuspension({ calls: 2, owned: true }); await f.agent.run('Wait', { responseFormat: format }); const id = f.agent.getModelUsage()!.id;
    for (let i = 0; i < 2; i++) await expect(f.agent.run('Event')).rejects.toThrow('maxCalls');
    expect(f.agent.getModelUsage()?.id).toBe(id); f.agent.cancel('Abandon this wait; observation remains valid');
    const response = await f.agent.run('New explicit work', { routing: null });
    expect(response.routing?.selectedRoute).toBe('default'); expect(f.agent.getModelUsage()?.id).not.toBe(id); expect(f.wait).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(f.agent.context.getState())).toContain('WAIT_ACKNOWLEDGED');
  });
  it('keeps effective format/data overrides after pre-dispatch rejection and releases ownership on success', async () => {
    const f = await setupSuspension(); await f.agent.run('Wait', { responseFormat: format, modelTask: f.task });
    const hook = (event: { options: { model: string } }) => { event.options.model = 'wrong'; }; f.agent.on('llm:request', hook);
    await expect(f.agent.run('Event', { dataHandling: { allowProviderTools: false } })).rejects.toThrow('switch'); f.agent.off('llm:request', hook); f.select.mockReturnValue('default');
    const response = await f.agent.run('Event'); expect(response.output_parsed).toEqual({ answer: 'FORMATTED' }); expect(response.routing?.model).toBe('fast');
    expect(f.primary.generate.mock.calls.at(-1)![0].data_handling?.allowProviderTools).toBe(false); expect(f.select).toHaveBeenCalledTimes(1);
    await f.agent.run('New work', { routing: null }); expect(f.primary.generate.mock.calls.at(-1)![0].model).toBe('main');
  });
  for (const budget of ['tokens', 'cost', 'deadline'] as const) for (const mode of ['run', 'stream'] as const) it(`${mode} retains its original ${budget} limit after repeated rejection`, async () => {
    const f = await setupSuspension({ budget }); await f.agent.run('Wait', { responseFormat: format, modelTask: f.task }); f.select.mockReturnValue('default');
    if (budget === 'deadline') vi.spyOn(Date, 'now').mockReturnValue(f.deadline + 1);
    for (let i = 0; i < 2; i++) await expect(consume(f.agent, mode)).rejects.toThrow(budget === 'tokens' ? 'maxTokens' : budget === 'cost' ? 'maxCostUSD' : 'deadline');
    expect(f.agent.getModelUsage()?.id).toBe(f.task!.id); expect(f.select).toHaveBeenCalledTimes(1); expect(f.primary.generate).toHaveBeenCalledTimes(2); expect(f.wait).toHaveBeenCalledTimes(1);
  });
  it('retains the origin after preparation failure and permits a matching retry', async () => {
    const f = await setupSuspension(); await f.agent.run('Wait', { responseFormat: format, modelTask: f.task }); f.select.mockReturnValue('default');
    vi.spyOn(f.agent.context, 'prepare').mockRejectedValueOnce(new Error('Temporary preparation failure'));
    await expect(f.agent.run('Event')).rejects.toThrow('Temporary preparation failure');
    const response = await f.agent.run('Event'); expect(response.routing?.model).toBe('fast'); expect(response.output_parsed).toEqual({ answer: 'FORMATTED' });
    expect(f.select).toHaveBeenCalledTimes(1); expect(f.agent.getModelUsage()?.id).toBe(f.task!.id); expect(f.wait).toHaveBeenCalledTimes(1);
  });
  it('settles a successful streamed resume when the consumer stops at its terminal event', async () => {
    const f = await setupSuspension(); await f.agent.run('Wait', { responseFormat: format, modelTask: f.task });
    let terminal = false;
    for await (const event of f.agent.stream('Event')) if (event.type === StreamEventType.RESPONSE_COMPLETE) { terminal = true; break; }
    expect(terminal).toBe(true);
    await f.agent.run('New work', { routing: null }); expect(f.primary.generate.mock.calls.at(-1)![0].model).toBe('main'); expect(f.wait).toHaveBeenCalledTimes(1);
  });
});

describe('S3 coherent suspension persistence', () => {
  it.each([false, true].flatMap(fallback => [false, true].map(assembly => ({ fallback, assembly }))))('checkpoints the final parsed answer before the suspension event ($fallback, assembly=$assembly)', async ({ fallback, assembly }) => {
    const f = await setupSuspension({ fallback, assembly, malformed: true }); let eventState: Promise<unknown> | undefined;
    f.agent.on('execution:suspended' as never, (event: { sessionId: string }) => { eventState = f.storage.load(event.sessionId); });
    const response = await f.agent.run('Wait', { responseFormat: format, modelTask: f.task });
    expect(response.status).toBe('suspended'); expect(response.output_parsed).toEqual({ answer: 'FORMATTED' });
    const saved = await f.storage.load(response.suspension!.sessionId); expect(JSON.stringify(saved?.state.conversation)).toContain('FORMATTED'); expect(JSON.stringify(saved?.state.conversation)).not.toContain('NOT_JSON');
    expect(JSON.stringify(await eventState)).toContain('FORMATTED'); expect(f.wait).toHaveBeenCalledTimes(1);
    expect(await f.correlations.resolve('second:event')).not.toBeNull();
  });
  it.each([false, true])('retains a failed finalization receipt without publishing success (fallback=%s)', async fallback => {
    const f = await setupSuspension({ fallback, calls: 2, malformed: !fallback }); const suspended = vi.fn(); f.agent.on('execution:suspended' as never, suspended);
    await expect(f.agent.run('Wait', { responseFormat: format, modelTask: f.task })).rejects.toThrow('maxCalls');
    expect(suspended).not.toHaveBeenCalled(); expect(f.wait).toHaveBeenCalledTimes(1);
    const saved = await f.storage.load(f.agent.getSessionId()!); expect(JSON.stringify(saved?.state)).toContain('WAIT_ACKNOWLEDGED');
    expect((saved?.state.metadata as Record<string, unknown> | undefined)?.suspensionFinalization).toMatchObject({ status: 'failed', correlationId: 'second:event' });
    expect(await f.correlations.resolve('second:event')).not.toBeNull();
    await expect(f.agent.run('Event')).rejects.toThrow('maxCalls'); expect(f.primary.generate).toHaveBeenCalledTimes(2); expect(f.wait).toHaveBeenCalledTimes(1);
  });
  it.each(['session', 'correlation'] as const)('does not publish suspension when the %s checkpoint write fails', async backend => {
    const f = await setupSuspension(); const suspended = vi.fn(); f.agent.on('execution:suspended' as never, suspended);
    const save = backend === 'session' ? vi.spyOn(f.storage, 'save') : vi.spyOn(f.correlations, 'save'); save.mockRejectedValueOnce(new Error('Storage unavailable'));
    await expect(f.agent.run('Wait', { responseFormat: format, modelTask: f.task })).rejects.toThrow('Storage unavailable');
    expect(suspended).not.toHaveBeenCalled(); expect(JSON.stringify(f.agent.context.getState())).toContain('WAIT_ACKNOWLEDGED');
    const response = await f.agent.run('Event'); expect(response.routing?.model).toBe('fast'); expect(f.agent.getModelUsage()?.id).toBe(f.task!.id); expect(f.wait).toHaveBeenCalledTimes(1);
  });
  it('reports both finalization and recovery checkpoint failure while retaining the actual wait', async () => {
    const f = await setupSuspension({ calls: 2, malformed: true }); vi.spyOn(f.storage, 'save').mockRejectedValueOnce(new Error('Recovery storage unavailable'));
    let failure: unknown; try { await f.agent.run('Wait', { responseFormat: format, modelTask: f.task }); } catch (e) { failure = e; }
    expect(failure).toBeInstanceOf(AggregateError); expect((failure as AggregateError).errors.map(e => e.message)).toEqual([expect.stringContaining('maxCalls'), 'Recovery storage unavailable']);
    expect(JSON.stringify(f.agent.context.getState())).toContain('WAIT_ACKNOWLEDGED');
    await expect(f.agent.run('Event')).rejects.toThrow('maxCalls'); expect(f.wait).toHaveBeenCalledTimes(1);
  });
  it('preserves a cancelled finalization receipt without publishing suspension or repeating its tool', async () => {
    const f = await setupSuspension({ malformed: true }); const suspended = vi.fn(); f.agent.on('execution:suspended' as never, suspended);
    let ready!: () => void, finish!: () => void; const entered = new Promise<void>(resolve => { ready = resolve; });
    f.primary.generate.mockImplementationOnce(async o => { ready(); await new Promise<void>(resolve => { finish = resolve; }); return answer(o, '{"answer":"LATE"}'); });
    const run = f.agent.run('Wait', { responseFormat: format, modelTask: f.task }); await entered; f.agent.cancel('Host cancelled finalization');
    await expect(run).rejects.toThrow(); finish(); await Promise.resolve();
    expect(suspended).not.toHaveBeenCalled(); expect(f.wait).toHaveBeenCalledTimes(1);
    const saved = await f.storage.load(f.agent.getSessionId()!); expect(JSON.stringify(saved?.state)).toContain('WAIT_ACKNOWLEDGED');
    expect((saved?.state.metadata as Record<string, unknown>)?.suspensionFinalization).toMatchObject({ status: 'failed' });
  });
});
