import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoutineRunner } from '@/core/routines/createRoutineRunner.js';
import { createRoutineDefinition } from '@/domain/entities/Routine.js';
import { ModelTask } from '@/core/model-execution/ModelTask.js';
import { Connector } from '@/core/Connector.js';
import { fixture, answer } from './routing/fixture.js';
import { hasCompositionOwner } from '@/core/execution/composition.js';
import type { Agent } from '@/core/Agent.js';
import type { RoutineRunner, RoutineRunResult } from '@/core/routines/types.js';

const agents: Agent[] = [], runners: RoutineRunner[] = [], tasks: ModelTask[] = [];
const make = (config = {}) => { const value = fixture({ modelExecution: { customProviderAttempts: 'single' }, ...config }); agents.push(value.agent); return value; };
const runner = (options: Parameters<typeof createRoutineRunner>[0]) => { const value = createRoutineRunner(options); runners.push(value); return value; };
const definition = (extra = {}) => createRoutineDefinition({ name: 'Verified fixture', description: 'Synthetic', tasks: [{ id: 'one', name: 'one', description: 'One' }, { id: 'two', name: 'two', description: 'Two', dependsOn: ['one'] }], ...extra });
function continuation(result: RoutineRunResult) { if (!('continuation' in result)) throw new Error(`Expected continuation, got ${result.state}`); return result.continuation; }
function tool(agent: Agent, name: string, execute: () => Promise<unknown>) { agent.tools.register({ definition: { type: 'function', function: { name, parameters: { type: 'object', properties: {} } } }, execute, output: { effect: 'write' } }); }
afterEach(() => { runners.splice(0).forEach(value => value.close()); agents.splice(0).forEach(value => value.destroy()); tasks.splice(0).forEach(value => value.destroy()); Connector.clear(); });

describe('verified routine runner', () => {
  it('requires verification and validates limits before work', () => {
    expect(() => createRoutineRunner({} as never)).toThrow(/verify/);
    expect(() => createRoutineRunner({ verify: () => ({ kind: 'verified' }), maxObservationBytes: 1 })).toThrow(/maxObservation/);
  });
  it('checks task readiness then final state after exactly one post action', async () => {
    const { agent, primary } = make(); let written = false;
    const execute = vi.fn(async () => { written = true; return { success: false, domainValue: 0 }; }); tool(agent, 'post', execute);
    const phases: string[] = [];
    const r = runner({ verify: observation => { phases.push(observation.phase); if (observation.phase === 'routine') expect(written).toBe(true); return { kind: 'verified' }; } });
    const result = await r.run({ agent, definition: definition({ postSteps: [{ name: 'post', toolName: 'post', args: {} }] }) });
    expect(result.state).toBe('completed'); expect(phases).toEqual(['task', 'task', 'routine']); expect(primary.generate).toHaveBeenCalledTimes(2); expect(execute).toHaveBeenCalledTimes(1);
    expect(result.observations.at(-1)?.stepOutcomes[0]).toMatchObject({ state: 'succeeded', result: { success: false, domainValue: 0 } });
    await vi.waitFor(() => expect(hasCompositionOwner(agent)).toBe(false));
  });
  it('pauses before dependent work and resumes the same cursor without replay', async () => {
    const { agent, primary } = make(); const pre = vi.fn(async () => ({ id: 'submission' })); tool(agent, 'submit', pre);
    let ready = false;
    const r = runner({ verify: observation => observation.phase === 'task' && observation.taskId === 'one' && !ready ? { kind: 'waiting', reason: 'Remote pending' } : { kind: 'verified' } });
    const first = await r.run({ agent, definition: definition({ preSteps: [{ name: 'submit', toolName: 'submit', args: {} }] }) });
    expect(first.state).toBe('waiting'); expect(primary.generate).toHaveBeenCalledTimes(1); expect(pre).toHaveBeenCalledTimes(1);
    await expect(agent.runDirect('unrelated')).rejects.toThrow(/owned/); ready = true;
    const last = await r.resume(continuation(first), { authorize: () => true });
    expect(last.state).toBe('completed'); expect(primary.generate).toHaveBeenCalledTimes(2); expect(pre).toHaveBeenCalledTimes(1);
    expect(last.observations[0]).toMatchObject({ initialVerification: { kind: 'waiting' }, verification: { kind: 'verified' }, reason: 'reconcile' });
    await expect(r.resume(continuation(first), { authorize: () => true })).rejects.toThrow(/stale/);
  });
  it.each(['throw', 'malformed'] as const)('retains the handle after %s verifier failure', async mode => {
    const { agent, primary } = make(); let bad = true;
    const r = runner({ verify: () => { if (bad) { if (mode === 'throw') throw new Error('backend offline'); return { kind: 'nonsense' } as never; } return { kind: 'verified' }; } });
    const first = await r.run({ agent, definition: definition() }); expect(first.state).toBe('uncertain'); bad = false;
    expect((await r.resume(continuation(first), { authorize: () => true })).state).toBe('completed'); expect(primary.generate).toHaveBeenCalledTimes(2);
  });
  it('rejects false/throwing authorization and replacement tasks without consuming the handle', async () => {
    const { agent, primary } = make(); const shared = new ModelTask(); tasks.push(shared); let ready = false;
    const r = runner({ verify: () => ready ? { kind: 'verified' } : { kind: 'waiting', reason: 'wait' } });
    const first = await r.run({ agent, definition: definition(), execution: { modelTask: shared } });
    await expect(r.resume(continuation(first), { authorize: () => false })).rejects.toThrow(/authorization/);
    await expect(r.resume(continuation(first), { authorize: () => { throw new Error('denied'); } })).rejects.toThrow(/denied/);
    const other = new ModelTask(); tasks.push(other);
    await expect(r.resume(continuation(first), { authorize: () => true, execution: { modelTask: other } })).rejects.toThrow(/replace/);
    ready = true; expect((await r.resume(continuation(first), { authorize: () => true })).state).toBe('completed');
    expect(primary.generate).toHaveBeenCalledTimes(2); expect(shared.snapshot().totals.calls).toBe(2);
  });
  it('serializes authorization before consuming a continuation', async () => {
    const { agent } = make(); let ready = false, approve!: (value: boolean) => void;
    const r = runner({ verify: () => ready ? { kind: 'verified' } : { kind: 'waiting', reason: 'wait' } });
    const first = await r.run({ agent, definition: definition() });
    const resume = r.resume(continuation(first), { authorize: () => new Promise<boolean>(resolve => { approve = resolve; }) });
    await vi.waitFor(() => expect(approve).toBeTypeOf('function'));
    await expect(r.resume(continuation(first), { authorize: () => true })).rejects.toThrow(/concurrent/);
    ready = true; approve(true); expect((await resume).state).toBe('completed');
  });
  it('leaves an aborted authorization locked until its actual settlement and keeps the handle', async () => {
    const { agent } = make(); let ready = false, approve!: (value: boolean) => void;
    const r = runner({ verify: () => ready ? { kind: 'verified' } : { kind: 'waiting', reason: 'wait' } });
    const first = await r.run({ agent, definition: definition() }); const controller = new AbortController();
    const resume = r.resume(continuation(first), { execution: { signal: controller.signal }, authorize: () => new Promise<boolean>(resolve => { approve = resolve; }) });
    await vi.waitFor(() => expect(approve).toBeTypeOf('function')); controller.abort(); await expect(resume).rejects.toThrow();
    await expect(r.resume(continuation(first), { authorize: () => true })).rejects.toThrow(/concurrent/); approve(true);
    await new Promise(resolve => setTimeout(resolve, 0)); ready = true;
    expect((await r.resume(continuation(first), { authorize: () => true })).state).toBe('completed');
  });
  it('requires both strict reflection boolean and score and rechecks without resubmission', async () => {
    const { agent, primary } = make(); let ready = false, main = 0;
    primary.generate.mockImplementation(async options => {
      if (options.instructions?.includes('task completion evaluator')) return answer(options, JSON.stringify({ isComplete: ready, completionScore: 100, explanation: 'quality' }));
      main++; return answer(options);
    });
    const r = runner({ verify: () => ({ kind: 'verified' }) });
    const def = definition({ tasks: [{ id: 'one', name: 'one', description: 'One', validation: { skipReflection: false, completionCriteria: ['ready'] } }] });
    const first = await r.run({ agent, definition: def }); expect(first.state).toBe('uncertain'); expect(main).toBe(1); ready = true;
    expect((await r.resume(continuation(first), { authorize: () => true })).state).toBe('completed'); expect(main).toBe(1); expect(primary.generate).toHaveBeenCalledTimes(3);
  });
  it('records warn quality independently from host verification', async () => {
    const { agent, primary } = make(); primary.generate.mockImplementation(async options => answer(options, options.instructions?.includes('task completion evaluator') ? '{"isComplete":false,"completionScore":99,"explanation":"not ready"}' : 'ANSWER'));
    const verify = vi.fn(() => ({ kind: 'verified' as const })); const r = runner({ verify });
    const result = await r.run({ agent, definition: definition({ tasks: [{ name: 'one', description: 'One', validation: { skipReflection: false, completionCriteria: ['ready'], mode: 'warn' } }] }) });
    expect(result.state).toBe('completed'); expect(result.observations[0]?.quality).toMatchObject({ passed: false, warning: 'not ready' }); expect(verify).toHaveBeenCalledTimes(2);
  });
  it('rejects nested replay settings before pre-steps', async () => {
    const { agent, primary } = make(); const execute = vi.fn(async () => 1); tool(agent, 'submit', execute);
    await expect(runner({ verify: () => ({ kind: 'verified' }) }).run({ agent, definition: definition({ preSteps: [{ name: 'submit', toolName: 'submit', args: {} }], tasks: [{ name: 'map', description: 'map', controlFlow: { type: 'map', source: 'items', tasks: [{ name: 'bad', description: 'bad', maxAttempts: 2 }] } }] }) })).rejects.toThrow(/maxAttempts/);
    expect(execute).not.toHaveBeenCalled(); expect(primary.generate).not.toHaveBeenCalled();
  });
  it('uses the same ToolManager and scopes visible and guessed tools', async () => {
    const { agent, primary } = make(); const allowed = vi.fn(async () => 0), excluded = vi.fn(async () => 1);
    tool(agent, 'allowed', allowed); tool(agent, 'excluded', excluded); const manager = agent.tools;
    primary.generate.mockImplementation(async options => { expect(options.tools?.map(value => value.function.name)).toEqual(['allowed']); expect((await agent.tools.executeWithOutcome('excluded', {})).outcome.status).toBe('denied'); return answer(options); });
    const result = await runner({ verify: () => ({ kind: 'verified' }) }).run({ agent, definition: definition({ requiredTools: ['allowed'] }) });
    expect(result.state).toBe('completed'); expect(agent.tools).toBe(manager); expect(agent.context.tools).toBe(manager); expect(excluded).not.toHaveBeenCalled();
    expect(agent.tools.listEnabled()).toContain('excluded');
  });
  it('retains an oversized pre-step result, archives it, then continues without replay', async () => {
    const { agent, primary } = make(); const raw = { id: 'actual', body: 'x'.repeat(18000) }; const execute = vi.fn(async () => raw); tool(agent, 'large', execute);
    const r = runner({ maxObservationBytes: 8192, verify: () => ({ kind: 'verified' }) });
    let result = await r.run({ agent, definition: definition({ preSteps: [{ name: 'large', toolName: 'large', args: {} }] }) });
    expect(result.state).toBe('uncertain'); expect(primary.generate).not.toHaveBeenCalled();
    for (let i = 0; i < 8 && result.state !== 'completed'; i++) {
      const inspection = r.inspect(result.operationId)!;
      const index = await r.readSource(result.operationId, inspection.sourceIndexId, { maxBytes: 100000 }) as { sources: { id: string; retained: string }[] };
      for (const source of index.sources.filter(source => source.retained === 'operation')) {
        const data = await r.readSource(result.operationId, source.id, { maxBytes: 200000 }); expect(data).toBeDefined();
        r.acknowledgeSource(result.operationId, source.id, { version: 1, id: source.id, sha256: 'a'.repeat(64), bytes: 20000, durability: 'process' });
      }
      result = await r.resume(continuation(result), { authorize: () => true });
    }
    expect(result.state).toBe('completed'); expect(execute).toHaveBeenCalledTimes(1); expect(primary.generate).toHaveBeenCalledTimes(2);
  });
  it('close revokes continuation and never destroys a borrowed Agent', async () => {
    const { agent } = make(); const destroy = vi.spyOn(agent, 'destroy'); const r = runner({ verify: () => ({ kind: 'waiting', reason: 'wait' }) });
    const first = await r.run({ agent, definition: definition() }); r.close(); r.close();
    await expect(r.resume(continuation(first), { authorize: () => true })).rejects.toThrow(/closed/);
    expect(destroy).not.toHaveBeenCalled();
  });
  it('asTool retains its one owned child across waits and emits JSON without continuation', async () => {
    const { agent, primary } = make(); const createAgent = vi.fn(() => agent); const destroy = vi.spyOn(agent, 'destroy'); let ready = false; let handle: ReturnType<typeof continuation> | undefined;
    const r = runner({ verify: () => ready ? { kind: 'verified' } : { kind: 'waiting', reason: 'wait' }, onProgress: event => { if (event.kind === 'result' && 'continuation' in event.result) handle = event.result.continuation; } });
    const adapter = r.asTool({ definition: definition(), toolName: 'routine_tool', createAgent });
    const first = await adapter.execute({}); expect(first.state).toBe('waiting'); expect(first).not.toHaveProperty('continuation'); expect(destroy).not.toHaveBeenCalled();
    expect(await adapter.execute({})).toEqual(first); expect(createAgent).toHaveBeenCalledTimes(1); ready = true;
    expect((await r.resume(handle!, { authorize: () => true })).state).toBe('completed'); await vi.waitFor(() => expect(destroy).toHaveBeenCalledTimes(1)); expect(primary.generate).toHaveBeenCalledTimes(2);
  });
});

describe('verified routine review regressions', () => {
  it('requires explicit host reconciliation of a false managed verdict without resubmitting', async () => {
    const { agent, primary } = make(); primary.generate.mockImplementation(async options => ({ ...answer(options), loop: { version: 1, executionId: 'managed', phase: 'stopped', iterations: 1, recoveryAttempts: 0, observedToolCalls: 0, consecutiveToolFailures: 0, repeatedResults: 0, stalledIterations: 0, uncertainEffects: [], completion: { complete: false } } }));
    const verify = vi.fn(() => ({ kind: 'verified' as const })); const r = runner({ verify });
    const first = await r.run({ agent, definition: definition({ tasks: [{ name: 'one', description: 'one' }] }) });
    expect(first.state).toBe('uncertain'); expect(verify).not.toHaveBeenCalled();
    expect((await r.resume(continuation(first), { authorize: () => true })).state).toBe('completed'); expect(primary.generate).toHaveBeenCalledTimes(1);
  });
  it('waits on a condition before the task submission and rechecks it on resume', async () => {
    const { agent, primary } = make({ context: { model: 'main', features: { inContextMemory: true, workingMemory: false } } });
    const r = runner({ verify: () => ({ kind: 'verified' }) });
    const first = await r.run({ agent, definition: definition({ tasks: [{ name: 'conditional', description: 'conditional', condition: { memoryKey: 'host_ready', operator: 'equals', value: true, onFalse: 'wait' } }] }) });
    expect(first.state).toBe('uncertain'); expect(primary.generate).not.toHaveBeenCalled();
    agent.context.getPlugin('in_context_memory')!.set('host_ready', 'Explicit host capacity repair', true);
    expect((await r.resume(continuation(first), { authorize: () => true })).state).toBe('completed'); expect(primary.generate).toHaveBeenCalledTimes(1);
  });
  it('marks a condition skip truthfully and starts only its accepted dependent', async () => {
    const { agent, primary } = make(); const r = runner({ verify: () => ({ kind: 'verified' }) });
    const result = await r.run({ agent, definition: definition({ tasks: [{ id: 'skip', name: 'skip', description: 'skip', condition: { memoryKey: 'missing', operator: 'exists', onFalse: 'skip' } }, { name: 'child', description: 'child', dependsOn: ['skip'] }] }) });
    expect(result.state).toBe('completed'); expect(result.observations[0]?.tasks).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'skip', state: 'skipped' })])); expect(primary.generate).toHaveBeenCalledTimes(1);
  });
  it('restores colliding routine-owned memory while preserving ordinary task memory', async () => {
    const { agent, primary } = make({ context: { model: 'main', features: { inContextMemory: true, workingMemory: true } } });
    const icm = agent.context.getPlugin('in_context_memory')!;
    icm.set('__routine_plan', 'host-owned collision', 'before', 'high');
    primary.generate.mockImplementation(async options => { icm.set('task_result', 'keep', false); return answer(options); });
    const result = await runner({ verify: () => ({ kind: 'verified' }) }).run({ agent, definition: definition() });
    expect(result.state).toBe('completed'); expect(icm.get('__routine_plan')).toBe('before'); expect(icm.get('task_result')).toBe(false);
  });
  it('retries only failed cleanup bookkeeping after repair, never task submission', async () => {
    const { agent, primary } = make({ context: { model: 'main', features: { inContextMemory: true, workingMemory: false } } });
    const icm = agent.context.getPlugin('in_context_memory')!; const original = icm.delete.bind(icm); let fail = true;
    vi.spyOn(icm, 'delete').mockImplementation(key => { if (fail && key === '__routine_plan') throw new Error('restore unavailable'); return original(key); });
    const r = runner({ verify: () => ({ kind: 'verified' }) }); const first = await r.run({ agent, definition: definition() });
    expect(first.state).toBe('uncertain'); expect(hasCompositionOwner(agent)).toBe(true); fail = false;
    expect((await r.resume(continuation(first), { authorize: () => true })).state).toBe('completed'); expect(primary.generate).toHaveBeenCalledTimes(2);
  });
  it('verifies nested leaf/group boundaries using one task and preserves the parent memory frame', async () => {
    const { agent, primary } = make({ context: { model: 'main', features: { inContextMemory: true, workingMemory: false } } });
    agent.context.getPlugin('in_context_memory')!.set('items', 'items', [0, false]);
    const shared = new ModelTask(); tasks.push(shared); const phases: string[] = [];
    const r = runner({ verify: observation => { phases.push(observation.phase); return { kind: 'verified' }; } });
    const result = await r.run({ agent, execution: { modelTask: shared }, definition: definition({ tasks: [{ id: 'group', name: 'group', description: 'group', controlFlow: { type: 'map', source: 'items', tasks: [{ id: 'leaf', name: 'leaf', description: 'leaf' }] } }] }) });
    expect(result.state).toBe('completed'); expect(primary.generate).toHaveBeenCalledTimes(2); expect(shared.snapshot().totals.calls).toBe(2); expect(phases).toEqual(['task', 'routine', 'task', 'routine', 'task', 'routine']);
    const leaves = result.observations.filter(value => value.phase === 'task' && value.taskId !== 'group');
    expect(new Set(leaves.map(value => value.executionId)).size).toBe(2);
  });
  it('rejects reused active caller factories without destroying the borrowed caller', async () => {
    const { agent, primary } = make(); let release!: () => void;
    primary.generate.mockImplementation(async options => { await new Promise<void>(resolve => { release = resolve; }); return answer(options); });
    const current = agent.run('caller'); await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    const destroy = vi.spyOn(agent, 'destroy'); const r = runner({ verify: () => ({ kind: 'verified' }) });
    await expect(r.asTool({ definition: definition(), toolName: 'child', createAgent: () => agent }).execute({})).rejects.toThrow(/busy/);
    expect(destroy).not.toHaveBeenCalled(); release(); await current;
  });
  it('preserves a routine absolute deadline across waiting and does not run post actions after it', async () => {
    const { agent } = make(); const post = vi.fn(async () => 1); tool(agent, 'post', post);
    const r = runner({ verify: () => ({ kind: 'waiting', reason: 'wait' }) });
    const first = await r.run({ agent, definition: definition({ timeoutMs: 50, postStepsTrigger: 'always', postSteps: [{ name: 'post', toolName: 'post', args: {} }] }) });
    await new Promise(resolve => setTimeout(resolve, 65));
    const next = await r.resume(continuation(first), { authorize: () => true, execution: { signal: new AbortController().signal } });
    expect(next.state).toBe('uncertain'); expect(post).not.toHaveBeenCalled();
  });
});

describe('verified routine late recovery', () => {
  it('keeps late real tool data after close until the host archives it', async () => {
    const { agent, primary } = make(); let settle!: (value: unknown) => void;
    tool(agent, 'slow_write', () => new Promise(resolve => { settle = resolve; }));
    const r = runner({ verify: () => ({ kind: 'verified' }) });
    const first = await r.run({ agent, definition: definition({ preSteps: [{ name: 'slow', toolName: 'slow_write', args: {}, timeoutMs: 10 }] }) });
    expect(first.state).toBe('uncertain'); expect(primary.generate).not.toHaveBeenCalled(); r.close();
    expect(hasCompositionOwner(agent)).toBe(true); settle({ id: 'late-actual', status: 'committed' });
    await vi.waitFor(async () => {
      const current = r.inspect(first.operationId)!;
      const sources = await r.readSource(first.operationId, current.sourceIndexId, { maxBytes: 100000 }) as { sources: { id: string; retained: string }[] };
      const raws = await Promise.all(sources.sources.filter(value => value.retained === 'operation').map(value => r.readSource(first.operationId, value.id, { maxBytes: 100000 })));
      expect(JSON.stringify(raws)).toContain('late-actual');
    });
    expect(hasCompositionOwner(agent)).toBe(true);
    const inspection = r.inspect(first.operationId)!;
    const index = await r.readSource(first.operationId, inspection.sourceIndexId, { maxBytes: 100000 }) as { sources: { id: string; retained: string }[] };
    let found = false;
    for (const source of index.sources.filter(value => value.retained === 'operation')) {
      const value = await r.readSource(first.operationId, source.id, { maxBytes: 100000 });
      if (JSON.stringify(value).includes('late-actual')) found = true;
      r.acknowledgeSource(first.operationId, source.id, { version: 1, id: source.id, sha256: 'b'.repeat(64), bytes: 100, durability: 'process' });
    }
    expect(found).toBe(true); r.close(); await vi.waitFor(() => expect(hasCompositionOwner(agent)).toBe(false));
  });
  it('pre-step operational failure gets a correlated final gate rather than hanging or replaying', async () => {
    const { agent, primary } = make(); const execute = vi.fn(async () => { throw new Error('synthetic failure'); }); tool(agent, 'failed', execute);
    const r = runner({ verify: () => ({ kind: 'verified' }) });
    const first = await r.run({ agent, definition: definition({ preSteps: [{ name: 'failed', toolName: 'failed', args: {} }] }) });
    expect(first.state).toBe('uncertain'); expect(execute).toHaveBeenCalledTimes(1); expect(primary.generate).not.toHaveBeenCalled();
    const final = await r.resume(continuation(first), { authorize: () => true }); expect(final.state).toBe('completed'); expect(execute).toHaveBeenCalledTimes(1); expect(primary.generate).not.toHaveBeenCalled();
  });
});

it('passes a false control-flow output to its dependent without losing it as absent', async () => {
  const { agent, primary } = make({ context: { model: 'main', features: { inContextMemory: true, workingMemory: false } } });
  const icm = agent.context.getPlugin('in_context_memory')!; icm.set('empty', 'empty', []);
  primary.generate.mockImplementation(async options => { expect(icm.get('__dep_result_group')).toBe('false'); return answer(options); });
  const result = await runner({ verify: () => ({ kind: 'verified' }) }).run({ agent, definition: definition({ tasks: [
    { id: 'group', name: 'group', description: 'group', controlFlow: { type: 'fold', source: 'empty', initialValue: false, resultKey: 'fold_output', tasks: [{ name: 'leaf', description: 'leaf' }] } },
    { name: 'dependent', description: 'dependent', dependsOn: ['group'] },
  ] }) });
  expect(result.state).toBe('completed'); expect(primary.generate).toHaveBeenCalledTimes(1);
});

it('continues authentic queued async results under the same task without rerunning their action', async () => {
  const { agent, primary } = make({ modelExecution: { customProviderAttempts: 'single', routing: undefined }, asyncTools: { autoContinue: true } });
  let settle!: (value: unknown) => void; const execute = vi.fn(() => new Promise(resolve => { settle = resolve; }));
  agent.tools.register({ definition: { type: 'function', function: { name: 'async_read', parameters: { type: 'object', properties: {} } }, blocking: false }, output: { effect: 'read' }, execute });
  primary.generate.mockImplementationOnce(async options => ({ ...answer(options, ''), output: [{ type: 'message', role: 'assistant' as never, content: [{ type: 'tool_use' as never, id: 'async-1', name: 'async_read', arguments: '{}' }] }] }));
  const shared = new ModelTask({ limits: { maxCalls: 3 } }); tasks.push(shared);
  const r = runner({ verify: () => ({ kind: 'verified' }) });
  const first = await r.run({ agent, definition: definition({ tasks: [{ name: 'one', description: 'one' }] }), execution: { modelTask: shared } });
  expect(first.state).toBe('uncertain'); expect(primary.generate).toHaveBeenCalledTimes(2);
  settle({ id: 'async-source' }); await vi.waitFor(() => expect(agent.hasPendingAsyncTools()).toBe(false));
  await new Promise(resolve => setTimeout(resolve, 0));
  expect((await r.resume(continuation(first), { authorize: () => true })).state).toBe('completed');
  expect(execute).toHaveBeenCalledTimes(1); expect(primary.generate).toHaveBeenCalledTimes(3); expect(shared.snapshot().totals.calls).toBe(3);
});

it('rejects existing unacknowledged evidence before any new pre-step action', async () => {
  const { agent, primary } = make(); const execute = vi.fn(async () => 1); tool(agent, 'submit', execute);
  vi.spyOn(agent.context, 'getConversation').mockReturnValue([{ type: 'message', role: 'user', content: [{ type: 'tool_result', tool_use_id: 'old', content: 'retained', evidence: { version: 1, status: 'storage_failed' } }] }] as never);
  const r = runner({ verify: () => ({ kind: 'verified' }) });
  await expect(r.run({ agent, definition: definition({ preSteps: [{ name: 'submit', toolName: 'submit', args: {} }] }) })).rejects.toThrow(/unacknowledged/);
  expect(execute).not.toHaveBeenCalled(); expect(primary.generate).not.toHaveBeenCalled(); expect(hasCompositionOwner(agent)).toBe(false);
});

it('does not infer scheduler skips from a business payload field', async () => {
  const { agent } = make({ context: { model: 'main', features: { inContextMemory: true, workingMemory: false } } });
  agent.context.getPlugin('in_context_memory')!.set('empty', 'empty', []);
  const states: string[] = [];
  const r = runner({ verify: observation => { if (observation.phase === 'task') states.push(observation.tasks.find(task => task.id === observation.taskId)!.state); return { kind: 'verified' }; } });
  const result = await r.run({ agent, definition: definition({ tasks: [{ id: 'fold', name: 'fold', description: 'fold', controlFlow: { type: 'fold', source: 'empty', initialValue: { skipped: false }, resultKey: 'business_result', tasks: [{ name: 'leaf', description: 'leaf' }] } }] }) });
  expect(result.state).toBe('completed'); expect(states).toEqual(['settled']);
});

it('contains async progress rejection without changing verification or repeating the source action', async () => {
  const { agent, primary } = make(); const execute = vi.fn(async () => ({ id: 'performed-once' })); tool(agent, 'submit', execute);
  const r = runner({ verify: () => ({ kind: 'verified' }), onProgress: async () => { throw new Error('Async host observer'); } });
  const result = await r.run({ agent, definition: definition({ preSteps: [{ name: 'submit', toolName: 'submit', args: {} }] }) });
  await new Promise(resolve => setTimeout(resolve, 0)); expect(result.state).toBe('completed'); expect(execute).toHaveBeenCalledTimes(1); expect(primary.generate).toHaveBeenCalledTimes(2);
});
