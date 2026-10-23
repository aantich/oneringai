import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Agent } from '@/core/Agent.js';
import { Connector } from '@/core/Connector.js';
import { ModelTask, modelExecutionFetch, registerModelTransport } from '@/core/model-execution/ModelTask.js';
import { StorageRegistry } from '@/core/StorageRegistry.js';
import { SuspendSignal } from '@/core/SuspendSignal.js';
import { createFileContextStorage } from '@/infrastructure/storage/FileContextStorage.js';
import { FileCorrelationStorage } from '@/infrastructure/storage/FileCorrelationStorage.js';
import { ContextCompactionStrategy } from '@/core/context-nextgen/strategies/ContextCompactionStrategy.js';
import { ContentType } from '@/domain/entities/Content.js';
import { MessageRole } from '@/domain/entities/Message.js';
import type { ResponseFormat } from '@/core/StructuredOutput.js';
import type { AgentLoopPolicy } from '@/core/agent-loop/types.js';
import { fixture, answer } from './fixture.js';

const agents: Agent[] = [], tasks: ModelTask[] = [], directories: string[] = [];
const make = (...args: Parameters<typeof fixture>) => { const value = fixture(...args); agents.push(value.agent); return value; };
const features = { workingMemory: false, inContextMemory: false };
const format: ResponseFormat = { type: 'json_schema', name: 'resume_answer', strict: true,
  schema: { type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'], additionalProperties: false } };
afterEach(async () => {
  agents.splice(0).forEach(agent => agent.destroy()); tasks.splice(0).forEach(task => task.destroy());
  Connector.clear(); StorageRegistry.reset();
  vi.unstubAllGlobals();
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })));
});
async function opaqueFixture() {
  const f = make(); f.primary.generate.mockImplementationOnce(async o => ({ ...answer(o),
    output: [{ type: 'reasoning', id: 'r', encrypted_content: 'OPAQUE_FAST_STATE' }, ...answer(o).output] }));
  await f.agent.run('Produce replay state'); const state = structuredClone(f.agent.context.getState());
  const legacy = Agent.create({ connector: f.name, model: 'fast', context: { model: 'fast', features } }); agents.push(legacy);
  legacy.context.restoreState(state); return { ...f, legacy, state };
}
async function invoke(agent: Agent, mode: 'run' | 'stream', options?: Parameters<Agent['run']>[1]) {
  if (mode === 'run') return agent.run('Continue', options);
  for await (const _event of agent.stream('Continue', options)) { /* consume the transport */ }
  return undefined;
}

describe('R1 replay ownership independent of routing', () => {
  for (const mode of ['run', 'stream'] as const) for (const hook of ['request', 'before'] as const) {
    it(`${mode} rejects a ${hook} hook ownership change with policy absent`, async () => {
      const f = await opaqueFixture(); const before = f.primary.generate.mock.calls.length;
      if (hook === 'request') f.legacy.on('llm:request', event => {
        if (mode === 'run') event.options.model = 'different';
        else f.legacy.context.userId = 'different-owner';
      });
      else f.legacy.registerHook('before:llm', (context: { options: { model: string } }) => { context.options.model = 'different'; return {}; });
      await expect(invoke(f.legacy, mode)).rejects.toThrow(/bound|replay|owner/i);
      expect(f.primary.generate).toHaveBeenCalledTimes(before);
    });
  }
  it('allows matching replay without adding routing diagnostics or requiring a task', async () => {
    const f = await opaqueFixture(); const response = await f.legacy.run('Continue', { routing: null });
    expect(response).not.toHaveProperty('routing'); expect(f.legacy.getModelUsage()).toBeUndefined();
    expect(f.primary.generate.mock.calls.at(-1)![0].model).toBe('fast');
  });
  it('preserves nonrouting hook overrides for portable history with origin metadata', async () => {
    const f = make(); await f.agent.run('Portable answer');
    const legacy = Agent.create({ connector: f.name, model: 'main', context: { model: 'main', features } }); agents.push(legacy);
    legacy.context.restoreState(structuredClone(f.agent.context.getState()));
    legacy.on('llm:request', event => { event.options.model = 'different'; });
    await legacy.run('Portable continuation'); expect(f.primary.generate.mock.calls.at(-1)![0].model).toBe('different');
  });
  it.each(['run', 'stream'] as const)('%s rechecks scope after a reservation observer', async mode => {
    const f = await opaqueFixture(); const task = new ModelTask(); tasks.push(task); const snapshot = task.snapshot.bind(task);
    vi.spyOn(task, 'snapshot').mockImplementationOnce(() => { f.legacy.context.userId = 'changed-owner'; return snapshot(); });
    const before = f.primary.generate.mock.calls.length;
    await expect(invoke(f.legacy, mode, { modelTask: task })).rejects.toThrow(/bound|replay|scope/i);
    expect(f.primary.generate).toHaveBeenCalledTimes(before); expect(snapshot().totals.calls).toBe(0);
  });
  it.each(['run', 'stream'] as const)('%s retains its guard across instrumented transport retries', async mode => {
    const f = await opaqueFixture(); const task = new ModelTask({ limits: { maxCalls: 3 } }); tasks.push(task);
    registerModelTransport(f.primary.provider);
    const fetch = vi.fn(async () => new Response('retry', { status: 500 })); vi.stubGlobal('fetch', fetch);
    f.primary.generate.mockImplementationOnce(async options => {
      await modelExecutionFetch('https://fixture.invalid/first');
      f.legacy.context.userId = 'changed-during-retry';
      await modelExecutionFetch('https://fixture.invalid/retry');
      return answer(options);
    });
    await expect(invoke(f.legacy, mode, { modelTask: task })).rejects.toThrow(/replay|scope/i);
    expect(fetch).toHaveBeenCalledTimes(1); expect(task.snapshot().attempts.filter(a => a.dispatched)).toHaveLength(1);
  });
  it('keeps routing opt-out guarded without adding constraints to a direct call', async () => {
    const f = await opaqueFixture(); const before = f.primary.generate.mock.calls.length;
    f.legacy.on('llm:request', event => { event.options.model = 'different'; });
    await expect(f.legacy.run('Continue', { routing: null })).rejects.toThrow('replay');
    expect(f.primary.generate).toHaveBeenCalledTimes(before);
    await f.legacy.runDirect('Independent portable request'); expect(f.primary.generate.mock.calls.at(-1)![0].model).toBe('fast');
  });
  it.each([false, true])('records actual hook-selected ownership when portable history gains opaque output (prior origin=%s)', async prior => {
    const f = make(); if (prior) await f.agent.run('Portable source');
    const legacy = Agent.create({ connector: f.name, model: 'main', context: { model: 'main', features } }); agents.push(legacy);
    if (prior) legacy.context.restoreState(structuredClone(f.agent.context.getState()));
    legacy.on('llm:request', event => { event.options.model = 'different'; });
    f.primary.generate.mockImplementationOnce(async o => ({ ...answer(o), output: [{ type: 'reasoning', id: 'r', encrypted_content: 'OPAQUE_DIFFERENT' }, ...answer(o).output] }));
    await legacy.run('Produce replay state'); const state = structuredClone(legacy.context.getState());
    expect(state.providerStateBinding?.model).toBe('different');
    const resumed = Agent.create({ connector: f.name, model: 'different', context: { model: 'different', features } }); agents.push(resumed);
    resumed.context.restoreState(state); await resumed.run('Matching continuation');
    expect(f.primary.generate.mock.calls.at(-1)![0].model).toBe('different');
  });
  it.each([false, true])('guards newly observed opaque state within the same legacy tool loop (mismatch=%s)', async mismatch => {
    const f = make(); const read = vi.fn(async () => 'observed');
    const legacy = Agent.create({ connector: f.name, model: 'main', context: { model: 'main', features },
      tools: [{ definition: { type: 'function', function: { name: 'read_value', description: 'Read', parameters: { type: 'object', properties: {} } } }, output: { effect: 'read' }, execute: read }] });
    agents.push(legacy); let requests = 0;
    legacy.on('llm:request', event => { event.options.model = ++requests === 1 || !mismatch ? 'different' : 'wrong-owner'; });
    f.primary.generate.mockImplementationOnce(async o => ({ ...answer(o), output_text: '', output: [{ type: 'reasoning', id: 'r', encrypted_content: 'OPAQUE_DIFFERENT' },
      { type: 'message', role: MessageRole.ASSISTANT, content: [{ type: ContentType.TOOL_USE, id: 'read-1', name: 'read_value', arguments: '{}' }] }] }));
    if (mismatch) await expect(legacy.run('Read once')).rejects.toThrow('replay');
    else await legacy.run('Read once');
    expect(f.primary.generate).toHaveBeenCalledTimes(mismatch ? 1 : 2); expect(read).toHaveBeenCalledTimes(1);
    expect(legacy.context.getState().providerStateBinding?.model).toBe('different');
  });
  it('records the admitted principal rather than relabeling output after an after-LLM scope change', async () => {
    const f = make(); const legacy = Agent.create({ connector: f.name, model: 'main', context: { model: 'main', features } }); agents.push(legacy);
    legacy.registerHook('after:llm', () => { legacy.context.userId = 'new-owner'; return {}; });
    f.primary.generate.mockImplementationOnce(async o => ({ ...answer(o), output: [{ type: 'reasoning', id: 'r', encrypted_content: 'OPAQUE_OLD_OWNER' }, ...answer(o).output] }));
    await legacy.run('Produce replay state'); expect(legacy.context.getState().providerStateBinding?.userId).toBeUndefined();
    await expect(legacy.run('Cannot relabel the old state')).rejects.toThrow(/principal|scope/i); expect(f.primary.generate).toHaveBeenCalledTimes(1);
  });
});

async function suspendedFixture(promptFallback = false, policy?: AgentLoopPolicy, maxCalls = 10) {
  const directory = await mkdtemp(join(tmpdir(), 'routing-corrections-')); directories.push(directory);
  StorageRegistry.configure({ sessions: id => createFileContextStorage(id, { baseDirectory: directory }),
    correlations: new FileCorrelationStorage({ baseDirectory: join(directory, 'correlations') }) });
  const wait = vi.fn(async () => SuspendSignal.create({ result: 'Waiting', correlationId: 'review:event' }));
  const f = make({ session: { storage: createFileContextStorage('routing-corrections', { baseDirectory: directory }), autoSave: false }, loopPolicy: policy, tools: [{ definition: { type: 'function', function: { name: 'wait_event', description: 'Wait', parameters: { type: 'object', properties: {} } } }, execute: wait }] }, primary => {
    if (promptFallback) primary.caps.mockImplementation(() => ({ supportsTools: true, supportsVision: false, supportsJSON: false, supportsJSONSchema: false,
      maxTokens: 16000, maxInputTokens: 16000, maxOutputTokens: 512 }));
  });
  f.primary.generate.mockImplementationOnce(async o => ({ ...answer(o), output_text: '', output: [{ type: 'message', role: MessageRole.ASSISTANT,
    content: [{ type: ContentType.TOOL_USE, id: 'wait-1', name: 'wait_event', arguments: '{}' }] }] }))
    .mockImplementation(async o => answer(o, '{"answer":"pending"}'));
  const task = new ModelTask({ limits: { maxCalls } }); tasks.push(task);
  const result = await f.agent.run('Wait and return JSON', { responseFormat: format, modelTask: task });
  expect(result.status).toBe('suspended'); return { ...f, task, wait };
}

describe('R2 suspended structured finalization', () => {
  it.each([false, true])('coerces the inherited format and runs the host predicate (prompt fallback=%s)', async fallback => {
    const completion = vi.fn(() => ({ complete: true })); const f = await suspendedFixture(fallback, { completion }); completion.mockClear();
    f.primary.generate.mockImplementation(async o => answer(o, '{"answer":"complete"}'));
    const result = await f.agent.run('External event arrived');
    expect(result.output_parsed).toEqual({ answer: 'complete' }); expect(completion).toHaveBeenCalledTimes(1);
    expect(result.loop).toMatchObject({ status: 'completed', completion: { complete: true } });
    expect(result.routing?.model).toBe('fast'); expect(f.agent.getModelUsage()!.id).toBe(f.task.id); expect(f.select).toHaveBeenCalledTimes(1);
  });
  it('repairs malformed resumed output within the same task', async () => {
    const f = await suspendedFixture(); const before = f.task.snapshot().totals.calls, revision = f.agent.context.lastPreparation!.revision;
    f.primary.generate.mockImplementationOnce(async o => answer(o, 'NOT_JSON')).mockImplementationOnce(async o => answer(o, '{"answer":"repaired"}'));
    const result = await f.agent.run('External event arrived');
    expect(result.output_parsed).toEqual({ answer: 'repaired' }); expect(f.task.snapshot().totals.calls).toBe(before + 2);
    expect(f.task.snapshot().invocations.at(-1)!.phase).toBe('repair');
    expect(JSON.stringify(f.primary.generate.mock.calls.at(-1)![0].input)).toContain('External event arrived');
    expect(f.agent.context.lastPreparation!.revision).toBe(revision + 1); expect(f.wait).toHaveBeenCalledTimes(1);
  });
  it('preserves the existing parse-only JSON contract rather than adding local schema enforcement', async () => {
    const f = await suspendedFixture(); const before = f.task.snapshot().totals.calls;
    f.primary.generate.mockImplementationOnce(async o => answer(o, '{"wrong":"shape"}'));
    const result = await f.agent.run('External event arrived');
    expect(result.output_parsed).toEqual({ wrong: 'shape' }); expect(f.task.snapshot().totals.calls).toBe(before + 1);
  });
  it('uses a supplied format override for both the resumed call and final coercion', async () => {
    const f = await suspendedFixture(); const next: ResponseFormat = { type: 'json_schema', name: 'new_shape', strict: true,
      schema: { type: 'object', properties: { count: { type: 'integer' } }, required: ['count'], additionalProperties: false } };
    f.primary.generate.mockImplementation(async o => answer(o, '{"count":7}'));
    const result = await f.agent.run('Use the new output shape', { responseFormat: next });
    expect(result.output_parsed).toEqual({ count: 7 });
    expect(f.primary.generate.mock.calls.at(-1)![0].response_format?.json_schema?.schema).toEqual(next.schema);
  });
  it('honors completion failure without spending a fresh recovery allowance', async () => {
    const completion = vi.fn(() => ({ complete: false, reason: 'Missing artifact' }));
    const f = await suspendedFixture(false, { completion, maxRecoveryAttempts: 0 }); completion.mockClear();
    f.primary.generate.mockImplementation(async o => answer(o, '{"answer":"complete"}'));
    const result = await f.agent.run('External event arrived');
    expect(completion).toHaveBeenCalledTimes(1); expect(result.loop).toMatchObject({ status: 'blocked', reason: 'recovery_exhausted' });
  });
  it('applies an explicit policy opt-out while retaining inherited formatting', async () => {
    const completion = vi.fn(() => ({ complete: false })); const f = await suspendedFixture(false, { completion }); completion.mockClear();
    f.primary.generate.mockImplementation(async o => answer(o, '{"answer":"complete"}'));
    const result = await f.agent.run('External event arrived', { loopPolicy: null });
    expect(result.output_parsed).toEqual({ answer: 'complete' }); expect(result.loop).toBeUndefined(); expect(completion).not.toHaveBeenCalled();
  });
  it('checks the repaired candidate and performs bounded predicate recovery', async () => {
    const completion = vi.fn().mockReturnValueOnce({ complete: false, feedback: 'Inspect the confirmed artifact.' }).mockReturnValueOnce({ complete: true });
    const f = await suspendedFixture(false, { completion, maxRecoveryAttempts: 1 }); completion.mockClear();
    f.primary.generate.mockImplementationOnce(async o => answer(o, 'broken')).mockImplementation(async o => answer(o, '{"answer":"verified"}'));
    const result = await f.agent.run('External event arrived');
    expect(result.output_parsed).toEqual({ answer: 'verified' }); expect(completion).toHaveBeenCalledTimes(2);
    expect(completion.mock.calls.map(([context]) => context.outputText)).toEqual(['{"answer":"verified"}', '{"answer":"verified"}']);
    expect(result.loop).toMatchObject({ status: 'completed', recoveryAttempts: 1 }); expect(f.wait).toHaveBeenCalledTimes(1);
  });
  it('keeps completion-check errors separate from model output and never reruns the wait', async () => {
    const completion = vi.fn(() => { throw new Error('PRIVATE_CHECK_DETAIL'); }); const f = await suspendedFixture(false, { completion }); completion.mockClear();
    const result = await f.agent.run('External event arrived');
    expect(result.output_parsed).toEqual({ answer: 'pending' }); expect(result.loop?.reason).toBe('checker_error');
    expect(JSON.stringify(result.loop)).not.toContain('PRIVATE_CHECK_DETAIL'); expect(f.wait).toHaveBeenCalledTimes(1);
  });
  it('does not reset the originating call budget to repair a resumed answer', async () => {
    const f = await suspendedFixture(false, undefined, 3);
    f.primary.generate.mockImplementationOnce(async o => answer(o, 'broken'));
    await expect(f.agent.run('External event arrived')).rejects.toThrow('maxCalls');
    expect(f.task.snapshot().totals.calls).toBe(3); expect(f.wait).toHaveBeenCalledTimes(1); expect(f.select).toHaveBeenCalledTimes(1);
  });
  it('cancels a resumed repair and keeps its single external wait observation', async () => {
    const f = await suspendedFixture(); let ready!: () => void, finish!: () => void;
    const entered = new Promise<void>(resolve => { ready = resolve; });
    f.primary.generate.mockImplementationOnce(async o => answer(o, 'broken')).mockImplementationOnce(async o => {
      ready(); await new Promise<void>(resolve => { finish = resolve; }); return answer(o, '{"answer":"late"}');
    });
    const result = f.agent.run('External event arrived'); await entered; f.agent.cancel('Cancel resumed repair');
    await expect(result).rejects.toThrow(); finish(); await Promise.resolve();
    expect(f.wait).toHaveBeenCalledTimes(1); expect(f.select).toHaveBeenCalledTimes(1);
  });
  it('rejects a hook that relaxes a newly tightened resumed data policy', async () => {
    const f = await suspendedFixture(); const before = f.primary.generate.mock.calls.length;
    f.agent.on('llm:request', event => { event.options.data_handling = { allowProviderTools: true }; });
    await expect(f.agent.run('External event arrived', { dataHandling: { allowProviderTools: false } })).rejects.toThrow('relax');
    expect(f.primary.generate).toHaveBeenCalledTimes(before); expect(f.wait).toHaveBeenCalledTimes(1);
  });
});

describe('R3 native alternative without an unused default adapter', () => {
  for (const mode of ['run', 'stream'] as const) it(`${mode} selects a supported alternative before binding native history`, async () => {
    const f = make({}, (_primary, secondary) => { Object.assign(secondary.provider, { compaction: { countInput: async () => 100,
      compact: async () => ({ protocol: 'test-native', input: [{ type: 'compaction', id: 'cmp', encrypted_content: 'opaque' }] }) } }); });
    const agent = Agent.create({ connector: f.name, model: 'main', context: { model: 'main', features: { ...features, evidence: true },
      compactionStrategy: new ContextCompactionStrategy({ plugins: 'off', history: 'native' }) },
      modelExecution: { customProviderAttempts: 'single', routing: { routes: { native: { connector: f.other, model: 'specialist', allowContextTransfer: true } }, select: () => 'native' } } });
    agents.push(agent); await invoke(agent, mode);
    expect(f.primary.generate).not.toHaveBeenCalled(); expect(f.secondary.generate).toHaveBeenCalledTimes(1);
    expect(agent.getRoutingDiagnostics()?.selectedRoute).toBe('native'); expect(agent.model).toBe('main');
    const before = agent.context.getConversation().length;
    await expect(agent.run('Unsupported default', { routing: null })).rejects.toThrow('native compaction');
    expect(agent.context.getConversation()).toHaveLength(before); expect(f.primary.generate).not.toHaveBeenCalled();
    await expect(agent.compactContext()).rejects.toThrow('native compaction');
  });
  it('retains the nonrouting constructor contract for an unsupported native default', () => {
    const f = make();
    expect(() => Agent.create({ connector: f.name, model: 'main', context: { model: 'main', features: { ...features, evidence: true },
      compactionStrategy: new ContextCompactionStrategy({ plugins: 'off', history: 'native' }) } })).toThrow('native compaction');
    expect(f.primary.destroy).not.toHaveBeenCalled();
  });
  it.each(['missing-permission', 'unsupported-fallback', 'unsupported-selected'] as const)('rejects %s before committing new input or dispatching', async scenario => {
    const f = make({}, primary => {
      if (scenario === 'unsupported-selected') Object.assign(primary.provider, { compaction: { countInput: async () => 100, compact: async () => ({ protocol: 'test-native', input: [] }) } });
    });
    const agent = Agent.create({ connector: f.name, model: 'main', context: { model: 'main', features: { ...features, evidence: true },
      compactionStrategy: new ContextCompactionStrategy({ plugins: 'off', history: 'native' }) },
      modelExecution: { customProviderAttempts: 'single', routing: { routes: { other: { connector: f.other, model: 'specialist', allowContextTransfer: scenario !== 'missing-permission' } },
        select: () => { if (scenario === 'unsupported-fallback') throw new Error('Selector unavailable'); return 'other'; } } } });
    agents.push(agent); await expect(agent.run('New private input')).rejects.toThrow(scenario === 'missing-permission' ? 'ineligible' : 'native compaction');
    expect(agent.context.getConversation()).toEqual([]); expect(agent.context.getCurrentInput()).toEqual([]);
    expect(f.primary.generate).not.toHaveBeenCalled(); expect(f.secondary.generate).not.toHaveBeenCalled();
  });
});
