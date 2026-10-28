import { afterEach, describe, expect, it, vi } from 'vitest';
import { acquireComposition, hasCompositionOwner } from '@/core/execution/composition.js';
import { ModelTask } from '@/core/model-execution/ModelTask.js';
import { Connector } from '@/core/Connector.js';
import { fixture, answer } from './routing/fixture.js';
import type { Agent } from '@/core/Agent.js';
import { Agent as AgentClass } from '@/core/Agent.js';
import { RoutineBinding } from '@/core/execution/routineBinding.js';
import { createRoutineDefinition } from '@/domain/entities/Routine.js';
import { getPlugins } from '@/core/routineControlFlow.js';
import { compactModel } from '@/core/model-execution/ModelExecutor.js';
import type { ITextProvider } from '@/domain/interfaces/ITextProvider.js';
import { InMemoryEvidenceStorage } from '@/infrastructure/storage/EvidenceStorage.js';
import { ToolEvidenceMiddleware } from '@/core/evidence/ToolEvidenceMiddleware.js';

const agents: Agent[] = [], tasks: ModelTask[] = [];
function setup() { const value = fixture({ modelExecution: { customProviderAttempts: 'single' }, emptyResponseRetry: { enabled: false } }); agents.push(value.agent); return value; }
function task(limits = {}) { const value = new ModelTask({ limits }); tasks.push(value); return value; }
afterEach(() => { agents.splice(0).forEach(a => a.destroy()); tasks.splice(0).forEach(t => t.destroy()); Connector.clear(); });

describe('private selected composition binding', () => {
  it('uses one borrowed task across managed, direct reflection/extraction and streaming calls', async () => {
    const { agent } = setup(), shared = task({ maxCalls: 4 }); const lease = acquireComposition(agent, { modelTask: shared });
    await lease.run('task'); await lease.direct('reflection', { purpose: 'verifier' });
    await lease.direct('extract', { purpose: 'extractor' });
    for await (const _event of lease.stream('stream task')) { /* consume */ }
    expect(shared.snapshot().totals).toMatchObject({ calls: 4, totalTokens: 52 });
    expect(shared.snapshot().invocations.map(i => i.purpose)).toEqual(['main', 'verifier', 'extractor', 'main']);
    lease.release(); expect(hasCompositionOwner(agent)).toBe(false);
    expect(shared.signal.aborted).toBe(false);
  });

  it.each(['run', 'runDirect', 'rolloverContext', 'compactContext', 'beginExternalExecution', 'continueWithAsyncResults'] as const)('rejects unrelated %s while paused, before dispatch', async method => {
    const { agent, primary } = setup(); const lease = acquireComposition(agent);
    await expect((agent[method] as (...args: any[]) => Promise<unknown>)(...(['run', 'runDirect'].includes(method) ? ['unrelated'] : []))).rejects.toThrow(/owned|compos/);
    expect(primary.generate).not.toHaveBeenCalled(); lease.release();
  });

  it.each(['stream', 'streamDirect'] as const)('rejects unrelated %s first iteration', async method => {
    const { agent, primary } = setup(); const lease = acquireComposition(agent);
    await expect(agent[method]('unrelated').next()).rejects.toThrow(/owned|compos/);
    expect(primary.generate).not.toHaveBeenCalled(); lease.release();
  });

  it('rejects already aborted admission without any reservation or lease', () => {
    const { agent, primary } = setup(); const host = new AbortController(); host.abort(); const shared = task();
    expect(() => acquireComposition(agent, { modelTask: shared, signal: host.signal })).toThrow();
    expect(hasCompositionOwner(agent)).toBe(false); expect(shared.snapshot().totals.calls).toBe(0); expect(primary.generate).not.toHaveBeenCalled();
  });

  it('does not admit another owner while a legacy managed call is active', async () => {
    const { agent, primary } = setup(); let release!: () => void;
    primary.generate.mockImplementation(async options => { await new Promise<void>(resolve => { release = resolve; }); return answer(options); });
    const running = agent.run('legacy'); await vi.waitFor(() => expect(primary.generate).toHaveBeenCalled());
    expect(() => acquireComposition(agent)).toThrow(/busy/); release(); await running;
    const next = acquireComposition(agent); next.release();
  });

  it('tracks legacy direct occupancy but preserves its ordinary concurrency', async () => {
    const { agent, primary } = setup(); let release!: () => void; const gate = new Promise<void>(r => { release = r; });
    primary.generate.mockImplementation(async options => { await gate; return answer(options); });
    const calls = [agent.runDirect('a'), agent.runDirect('b')];
    expect(() => acquireComposition(agent)).toThrow(/busy/); release(); await Promise.all(calls);
    const next = acquireComposition(agent); next.release(); expect(primary.generate).toHaveBeenCalledTimes(2);
  });

  it('cancels the exact admitted generation without cancelling its borrowed task or sibling', async () => {
    const { agent, primary } = setup(); const sibling = setup(); const shared = task(); const host = new AbortController();
    primary.generate.mockImplementation(async options => new Promise((_resolve, reject) => options.signal!.addEventListener('abort', () => reject(options.signal!.reason), { once: true })));
    const lease = acquireComposition(agent, { modelTask: shared, signal: host.signal });
    const running = lease.run('blocked'); void running.catch(() => {});
    await vi.waitFor(() => expect(primary.generate).toHaveBeenCalled()); host.abort(new Error('child only'));
    await expect(running).rejects.toThrow('child only'); expect(shared.signal.aborted).toBe(false);
    await sibling.agent.run('sibling', { modelTask: shared }); expect(shared.snapshot().totals.calls).toBe(2); lease.release();
  });

  it('keeps ownership after cancellation until an uncooperative provider actually settles', async () => {
    const { agent, primary } = setup(); let release!: () => void; const shared = task();
    primary.generate.mockImplementation(async options => { await new Promise<void>(r => { release = r; }); return answer(options); });
    const lease = acquireComposition(agent, { modelTask: shared }); const running = lease.direct('slow'); void running.catch(() => {});
    await vi.waitFor(() => expect(primary.generate).toHaveBeenCalled()); lease.close(); await expect(running).rejects.toThrow();
    expect(hasCompositionOwner(agent)).toBe(true); await expect(agent.runDirect('unrelated')).rejects.toThrow(/owned/);
    release(); await vi.waitFor(() => expect(hasCompositionOwner(agent)).toBe(false));
    expect(shared.snapshot().invocations[0]?.lateSettlement).toBe(true); expect(shared.signal.aborted).toBe(false);
  });

  it('prevents a new task or a pre-aborted replacement from invalidating the paused binding', async () => {
    const { agent } = setup(); const shared = task(); const lease = acquireComposition(agent, { modelTask: shared });
    expect(() => lease.replace({ modelTask: task() })).toThrow(/originating/);
    expect(() => lease.replace({ signal: AbortSignal.abort() })).toThrow();
    await lease.run('original'); expect(shared.snapshot().totals.calls).toBe(1); lease.release();
  });

  it('retains an exhausted task on continuation instead of allocating a fresh ledger', async () => {
    const { agent, primary } = setup(); const shared = task({ maxCalls: 1 }); const lease = acquireComposition(agent, { modelTask: shared });
    await lease.run('first'); lease.replace({ signal: new AbortController().signal });
    await expect(lease.direct('second')).rejects.toThrow(/maxCalls/); expect(primary.generate).toHaveBeenCalledTimes(1);
    expect(shared.snapshot().totals.calls).toBe(1); lease.release();
  });

  it('cleans a rejected admitted call so a later owning call can run', async () => {
    const { agent } = setup(); const lease = acquireComposition(agent);
    await expect(lease.admit(() => agent.compactContext({ checkpoint: true }))).rejects.toThrow(/storage/);
    await lease.run('next'); lease.release(); expect(hasCompositionOwner(agent)).toBe(false);
  });

  it('does not authorize reentrant host hooks through the admitted prefix', async () => {
    const { agent } = setup(); const denied: Promise<unknown>[] = [];
    agent.on('execution:start', () => { const call = agent.runDirect('unrelated'); void call.catch(() => {}); denied.push(call); });
    const lease = acquireComposition(agent); await lease.run('owner'); await expect(denied[0]).rejects.toThrow(/owned/); lease.release();
  });

  it('shares explicitly bound helpers but leaves ordinary helper omission independent', async () => {
    const { name, primary } = setup();
    const agent = AgentClass.create({ connector: name, model: 'main',
      context: { model: 'main', features: { workingMemory: false, inContextMemory: false } },
      modelExecution: { customProviderAttempts: 'single', helpers: { extractor: { connector: name, model: 'main', maxOutputTokens: 64 } } } });
    agents.push(agent); primary.generate.mockImplementation(async options => answer(options, '{"value":"ready"}'));
    const shared = task(); const lease = acquireComposition(agent, { modelTask: shared });
    const schema = { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] };
    const bound = await agent.invokeHelper('extractor', 'extract', { schema, ...lease.binding, signal: lease.signal });
    const independent = await agent.invokeHelper('extractor', 'extract', { schema });
    expect(bound.taskId).toBe(shared.id); expect(independent.taskId).not.toBe(shared.id);
    expect(shared.snapshot().totals.calls).toBe(1); lease.release();
  });

  it('a task deadline cannot be reset by replacing only the caller signal', async () => {
    const { agent, primary } = setup(); const shared = task({ deadline: Date.now() + 50 });
    const lease = acquireComposition(agent, { modelTask: shared });
    await new Promise(r => setTimeout(r, 70));
    expect(() => lease.replace({ signal: new AbortController().signal })).toThrow();
    await expect(lease.run('late')).rejects.toThrow(); expect(primary.generate).not.toHaveBeenCalled(); lease.release();
  });

  it('rejects a second owner without interfering with the admitted owner', async () => {
    const { agent } = setup(); const lease = acquireComposition(agent);
    expect(() => acquireComposition(agent)).toThrow(/busy/); await lease.run('owner'); lease.release();
    const next = acquireComposition(agent); await next.direct('new owner'); next.release();
  });

  it('does not expose a mutable task/signal binding or acquire a destroyed agent', () => {
    const { agent } = setup(); const shared = task(); const lease = acquireComposition(agent, { modelTask: shared });
    expect(() => Object.assign(lease.binding, { modelTask: task() })).toThrow(); expect(lease.binding.modelTask).toBe(shared);
    lease.release(); agent.destroy(); expect(() => acquireComposition(agent)).toThrow(/busy/);
  });

  it('retains ownership through coordinator cleanup without treating a paused hold as model work', () => {
    const { agent } = setup(); const lease = acquireComposition(agent); const release = lease.hold();
    expect(lease.pending).toBe(0); lease.replace({ signal: new AbortController().signal });
    lease.close(); expect(hasCompositionOwner(agent)).toBe(true); release(); release();
    expect(hasCompositionOwner(agent)).toBe(false);
  });

  it('does not retain a destroyed idle Agent after the selected owner closes', () => {
    const { agent } = setup(); const lease = acquireComposition(agent); agent.destroy(); lease.close();
    expect(hasCompositionOwner(agent)).toBe(false);
  });

  it('retains a yielded direct stream until its iterator actually closes', async () => {
    const { agent } = setup(); const lease = acquireComposition(agent);
    const iterator = agent.streamDirect('stream', { modelTask: task(), signal: lease.signal });
    expect((await lease.admit(() => iterator.next())).done).toBe(false);
    lease.close(); expect(hasCompositionOwner(agent)).toBe(true);
    await iterator.return?.(undefined); expect(hasCompositionOwner(agent)).toBe(false);
  });

  it('retains noncooperative native compaction until billed work actually settles', async () => {
    const { agent, primary, name } = setup(); const shared = task(); let release!: () => void;
    const provider: ITextProvider = { ...primary.provider, compaction: {
      countInput: async () => 10,
      compact: async () => { await new Promise<void>(r => { release = r; }); return { protocol: 'test', input: [], usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 } }; },
    } };
    const lease = acquireComposition(agent, { modelTask: shared });
    const work = compactModel(provider, Connector.get(name), { model: 'main', input: [], signal: lease.signal }, shared,
      { customProviderAttempts: 'single' }, promise => lease.track(promise)); void work.catch(() => {});
    await vi.waitFor(() => expect(release).toBeTypeOf('function')); lease.close(); await expect(work).rejects.toThrow();
    expect(hasCompositionOwner(agent)).toBe(true); release(); await vi.waitFor(() => expect(hasCompositionOwner(agent)).toBe(false));
    expect(shared.snapshot().invocations[0]?.lateSettlement).toBe(true); expect(shared.snapshot().totals.calls).toBe(1);
  });

  it.each(['map', 'fold', 'until'] as const)('threads the exact task through recursive %s, extraction and reflection', async type => {
    const f = fixture({ modelExecution: { customProviderAttempts: 'single' },
      context: { features: { workingMemory: false, inContextMemory: true } } }); agents.push(f.agent);
    const { agent, primary } = f; const shared = task(); const lease = acquireComposition(agent, { modelTask: shared });
    const memory = getPlugins(agent).icmPlugin!;
    memory.set('source', 'Synthetic list needing extraction', 'first;second', 'high');
    memory.set('finished', 'Host loop exit', true, 'high');
    primary.generate.mockImplementation(async options => answer(options,
      options.instructions?.includes('task completion evaluator') ? '{"isComplete":true,"completionScore":100,"explanation":"synthetic"}'
        : typeof options.input === 'string' && options.input.startsWith('Extract a JSON array') ? '[1,2]' : 'RESULT'));
    const leaf = [{ name: 'leaf', description: 'Process one item', maxAttempts: 1,
      validation: { skipReflection: false, completionCriteria: ['Synthetic completion'] } }];
    const controlFlow = type === 'until'
      ? { type, tasks: leaf, condition: { memoryKey: 'finished', operator: 'truthy' as const, onFalse: 'wait' as const }, maxIterations: 2 }
      : { type, tasks: leaf, source: 'source', initialValue: 0, resultKey: 'results' };
    const definition = createRoutineDefinition({ name: 'Bound recursive flow', description: 'Internal C2 fixture', tasks: [{ name: 'group', description: 'Process', controlFlow }] });
    const result = await new RoutineBinding(lease).execute({ definition, agent });
    expect(result.status).toBe('completed');
    const purposes = shared.snapshot().invocations.map(i => i.purpose);
    expect(purposes.filter(p => p === 'main')).toHaveLength(type === 'until' ? 1 : 2);
    expect(purposes.filter(p => p === 'verifier')).toHaveLength(type === 'until' ? 1 : 2);
    expect(purposes.filter(p => p === 'extractor')).toHaveLength(type === 'until' ? 0 : 1);
    expect(agent.tools).toBe(agent.context.tools); expect(shared.signal.aborted).toBe(false); lease.release();
  });

  it('binds deterministic-step cancellation and never starts later tasks/post actions', async () => {
    const { agent, primary } = setup(); const shared = task(), host = new AbortController();
    const step = vi.fn(async (_args, context) => new Promise((_resolve, reject) => context.signal.addEventListener('abort', () => reject(context.signal.reason), { once: true })));
    const post = vi.fn(async () => true);
    agent.tools.register({ definition: { type: 'function', function: { name: 'step', parameters: { type: 'object', properties: {} } } }, execute: step });
    agent.tools.register({ definition: { type: 'function', function: { name: 'post', parameters: { type: 'object', properties: {} } } }, execute: post });
    const definition = createRoutineDefinition({ name: 'Step cancellation', description: 'Internal C2 fixture',
      preSteps: [{ name: 'step', toolName: 'step', args: {} }], postSteps: [{ name: 'post', toolName: 'post', args: {} }], postStepsTrigger: 'always', tasks: [{ name: 'leaf', description: 'Do not run' }] });
    const lease = acquireComposition(agent, { modelTask: shared, signal: host.signal });
    const running = new RoutineBinding(lease).execute({ definition, agent }); void running.catch(() => {});
    await vi.waitFor(() => expect(step).toHaveBeenCalled()); host.abort(new Error('Stop steps'));
    const result = await running; expect(result.status).toBe('failed'); expect(post).not.toHaveBeenCalled(); expect(primary.generate).not.toHaveBeenCalled();
    expect(shared.signal.aborted).toBe(false); lease.release();
  });

  it('limits one recursive iteration without cancelling a sibling or borrowed task', async () => {
    const { agent, primary } = setup(); const shared = task(); const sibling = setup();
    primary.generate.mockImplementation(async options => new Promise((_resolve, reject) => {
      options.signal!.addEventListener('abort', () => reject(options.signal!.reason), { once: true });
    }));
    const definition = createRoutineDefinition({ name: 'Child deadline', description: 'Internal C2 fixture', tasks: [{ name: 'group', description: 'bounded iteration', maxAttempts: 1,
      controlFlow: { type: 'until', tasks: [{ name: 'leaf', description: 'slow child', maxAttempts: 1 }], maxIterations: 1,
        iterationTimeoutMs: 30, condition: { memoryKey: 'done', operator: 'not_exists', onFalse: 'wait' } } }] });
    const lease = acquireComposition(agent, { modelTask: shared });
    const result = await new RoutineBinding(lease).execute({ definition, agent });
    expect(result.status).toBe('failed'); expect(shared.signal.aborted).toBe(false); expect(lease.signal.aborted).toBe(false);
    await sibling.agent.run('unaffected sibling', { modelTask: shared });
    expect(shared.snapshot().totals.calls).toBe(2); expect(primary.generate).toHaveBeenCalledTimes(1); lease.release();
  });

  it('rejects a foreign routine Agent before tools, bookkeeping or model dispatch', async () => {
    const { agent, primary } = setup(); const foreign = setup(); const lease = acquireComposition(agent);
    const definition = createRoutineDefinition({ name: 'Wrong Agent', description: 'Internal C2 fixture', tasks: [{ name: 'leaf', description: 'Do not run' }] });
    await expect(new RoutineBinding(lease).execute({ definition, agent: foreign.agent })).rejects.toThrow(/admitted Agent/);
    expect(primary.generate).not.toHaveBeenCalled(); expect(foreign.primary.generate).not.toHaveBeenCalled(); lease.release();
  });

  it('retains raw storage ownership after the evidence acknowledgement deadline has already expired', async () => {
    const { agent } = setup(); const storage = new InMemoryEvidenceStorage({ scope: { ownerId: 'owner', namespace: 'ack-timeout' } });
    const put = storage.put.bind(storage); let finish!: () => void;
    vi.spyOn(storage, 'put').mockImplementation(async record => { await new Promise<void>(resolve => { finish = resolve; }); return put(record); });
    agent.tools.setEvidenceMiddleware(new ToolEvidenceMiddleware({ storage, writeTimeoutMs: 10 }));
    agent.tools.register({ definition: { type: 'function', function: { name: 'stored_action' } }, execute: async () => ({ id: 'actual-action' }) });
    const lease = acquireComposition(agent), result = await agent.tools.executeWithOutcome('stored_action', {});
    expect(result.outcome.status).toBe('succeeded'); expect(result.evidence?.status).toBe('storage_failed');
    lease.release(); expect(hasCompositionOwner(agent)).toBe(true); finish(); await lease.whenReleased; expect(hasCompositionOwner(agent)).toBe(false);
  });

  it('retains ownership until late tool evidence finishes storing', async () => {
    const { agent } = setup();
    const storage = new InMemoryEvidenceStorage({ scope: { ownerId: 'owner', namespace: 'late-composition' } });
    const put = storage.put.bind(storage); let blockWrites = false, storing = false;
    let releaseStore!: () => void, releaseTool!: () => void;
    const gate = new Promise<void>(r => { releaseStore = r; });
    vi.spyOn(storage, 'put').mockImplementation(async record => {
      if (blockWrites) { storing = true; await gate; } return put(record);
    });
    agent.tools.setToolContext({ ...agent.tools.getToolContext(), userId: 'owner' });
    agent.tools.setEvidenceMiddleware(new ToolEvidenceMiddleware({ storage }));
    agent.tools.register({ definition: { type: 'function', function: { name: 'slow_observation', parameters: { type: 'object', properties: {} } } },
      execute: async () => { await new Promise<void>(r => { releaseTool = r; }); return { id: 'actual-result' }; } });
    const lease = acquireComposition(agent);
    await expect(agent.tools.execute('slow_observation', {}, { signal: lease.signal, timeoutMs: 20 })).rejects.toThrow();
    blockWrites = true; lease.close(); releaseTool();
    await vi.waitFor(() => expect(storing).toBe(true)); expect(hasCompositionOwner(agent)).toBe(true);
    releaseStore(); await vi.waitFor(() => expect(hasCompositionOwner(agent)).toBe(false));
  });
});
