import { afterEach, describe, expect, it, vi } from 'vitest';
import { Agent, Connector, Vendor, StreamEventType, TaskStatePluginNextGen, ModelTask, FileContextStorage, InMemoryEvidenceStorage, ContentType, SuspendSignal, StorageRegistry, FileCorrelationStorage } from '../../../src/index.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { AgentConfig, AgentLoopPolicy, AgentLoopCheckContext, AgentLoopCompletionResult, RunOptions, StreamEvent, ToolFunction } from '../../../src/index.js';
import { ScriptedLoopProvider } from '../../../examples/agent-loop/scripted-provider.js';
import type { ScriptedFrame } from '../../../examples/agent-loop/scripted-provider.js';
import { LoopController } from '../../../src/core/agent-loop/LoopController.js';

const agents: Agent[] = [];
const connectors: string[] = [];
afterEach(() => { agents.splice(0).forEach(a => a.destroy()); connectors.splice(0).forEach(n => Connector.remove(n)); vi.restoreAllMocks(); });
function fixture(frames: ScriptedFrame[], policy: AgentLoopPolicy | null = {}, tools: ToolFunction[] = [], extra: Partial<AgentConfig> = {}) {
  const provider = new ScriptedLoopProvider(frames);
  const name = `loop-${connectors.length}`; connectors.push(name);
  Connector.create({ name, vendor: Vendor.OpenAI, auth: { type: 'none' }, options: { provider } });
  const agent = Agent.create({ connector: name, model: 'gpt-4o-mini', tools, loopPolicy: policy,
    emptyResponseRetry: { enabled: false }, maxIterations: 8,
    context: { model: 'gpt-4o-mini', features: { workingMemory: false, inContextMemory: false } }, ...extra });
  agents.push(agent); return { agent, provider };
}
const call = (id: string, args: Record<string, unknown> | string = {}, name = 'probe'): ScriptedFrame => ({ calls: [{ id, name, args }] });
function tool(execute: ToolFunction['execute'], effect: 'read' | 'write' | 'unknown' = 'read'): ToolFunction {
  return { definition: { type: 'function', function: { name: 'probe', parameters: { type: 'object', properties: {} } } }, output: { effect }, execute };
}
async function run(mode: 'run' | 'stream', agent: Agent, options?: RunOptions) {
  const events: StreamEvent[] = [];
  if (mode === 'run') {
    const response = await agent.run('Do the requested task.', options);
    return { response, loop: response.loop, events, text: response.output_text ?? '' };
  }
  let text = '';
  for await (const event of agent.stream('Do the requested task.', options)) {
    events.push(event); if (event.type === StreamEventType.OUTPUT_TEXT_DELTA) text += event.delta;
  }
  const complete = events.filter(e => e.type === StreamEventType.RESPONSE_COMPLETE);
  expect(complete).toHaveLength(1);
  return { response: undefined, loop: complete[0]!.type === StreamEventType.RESPONSE_COMPLETE ? complete[0]!.loop : undefined, events, text };
}

describe('Stage 10 opt-in managed-loop policies', () => {
  it('bounds admissions while repeated asynchronous reads have not settled', () => {
    const policy = new LoopController({}, 'bounded-async');
    for (let i = 0; i < 1000; i++) policy.admit('read', {}, 'read');
    expect(() => policy.admit('read', {}, 'read')).toThrow('stopped');
    expect(policy.snapshot()).toMatchObject({ reason: 'no_progress', observedToolCalls: 0 });
  });

  it('bounds failure identities for a large rejected batch without inventing executions', () => {
    const policy = new LoopController({}, 'bounded-failures');
    for (let i = 0; i < 1001; i++) policy.noteFailure(`denied-${i}`);
    expect(policy.snapshot()).toMatchObject({ reason: 'no_progress', consecutiveToolFailures: 1000, observedToolCalls: 0 });
  });

  it('bounds explicitly delivered observation identities before any further managed dispatch', () => {
    const policy = new LoopController({}, 'bounded-deliveries');
    for (let i = 0; i < 1001; i++) policy.observe('read', {}, { revision: i }, undefined, 'read', `delivered-${i}`);
    expect(policy.snapshot()).toMatchObject({ reason: 'no_progress', observedToolCalls: 1000 });
  });
  for (const mode of ['run', 'stream'] as const) {
    it(`${mode} remains unchanged when disabled and supports an explicit null override`, async () => {
      const check = vi.fn(() => ({ complete: false }));
      const { agent, provider } = fixture([{ text: 'Ordinary answer' }], { completion: check });
      const result = await run(mode, agent, { loopPolicy: null });
      expect(result.loop).toBeUndefined(); expect(agent.getLoopDiagnostics()).toBeUndefined();
      expect(check).not.toHaveBeenCalled(); expect(provider.requests).toHaveLength(1);
      expect(JSON.stringify(provider.requests[0]!.input)).not.toContain('loop recovery');
    });

    it(`${mode} rejects premature prose and completes only after a real read observation`, async () => {
      let ready = false;
      const { agent, provider } = fixture([{ text: 'Already complete' }, call('read'), { text: 'Verified answer' }], {
        completion: ctx => ({ complete: ready && ctx.observations.some(o => o.outcome?.status === 'succeeded'), feedback: 'Read the required artifact before finishing.' }),
      }, [tool(async () => { ready = true; return { artifact: 'A42' }; })]);
      const result = await run(mode, agent);
      expect(result.loop).toMatchObject({ phase: 'complete', status: 'completed', reason: 'completed', recoveryAttempts: 1, observedToolCalls: 1 });
      expect(provider.requests).toHaveLength(3);
      expect(JSON.stringify(provider.requests[1]!.input)).toContain('Read the required artifact');
      expect(result.text).toContain('Verified answer');
      expect(agent.tools).toBe(agent.context.tools);
    });

    it(`${mode} preserves pending tool results while adding bounded failure feedback`, async () => {
      let attempts = 0;
      const { agent, provider } = fixture([call('first'), call('second'), { text: 'Recovered' }], {
        completion: () => ({ complete: attempts === 2 }),
      }, [tool(async () => { if (++attempts === 1) throw new Error('TRANSIENT_FAILURE'); return { value: 42 }; })]);
      const result = await run(mode, agent);
      expect(result.loop).toMatchObject({ status: 'completed', recoveryAttempts: 1, observedToolCalls: 2 });
      const request = JSON.stringify(provider.requests[1]!.input);
      expect(request).toContain('TRANSIENT_FAILURE'); expect(request).toContain('first'); expect(request).toContain('Host loop recovery');
      expect(agent.context.getOriginalUserInput()).toHaveLength(1);
      expect(JSON.stringify(agent.context.getOriginalUserInput())).toContain('Do the requested task.');
    });

    it(`${mode} exhausts the completion allowance without another model or tool call`, async () => {
      const { agent, provider } = fixture([{ text: 'Done' }, { text: 'Still done' }], { maxRecoveryAttempts: 1, completion: () => ({ complete: false, reason: 'Artifact missing' }) });
      const result = await run(mode, agent);
      expect(result.loop).toMatchObject({ phase: 'input_needed', status: 'blocked', reason: 'recovery_exhausted', recoveryAttempts: 1, completion: { complete: false } });
      expect(provider.requests).toHaveLength(2);
    });

    it(`${mode} bounds normalized identical read results before repeating again`, async () => {
      const execute = vi.fn(async () => ({ b: 2, a: 1 }));
      const { agent, provider } = fixture([call('a', '{"b":2,"a":1}'), call('b', '{"a":1,"b":2}'), call('c', '{"a":1,"b":2}')], { maxRepeatedResults: 2 }, [tool(execute)]);
      const result = await run(mode, agent);
      expect(execute).toHaveBeenCalledTimes(2); expect(provider.requests).toHaveLength(3);
      expect(result.loop).toMatchObject({ reason: 'repeated_results', phase: 'input_needed', observedToolCalls: 2 });
      expect(agent.context.getCurrentInput()).toHaveLength(0);
      expect(JSON.stringify(agent.context.getConversation())).toContain('c');
    });

    it(`${mode} permits explicit repeatable reads and changed observations`, async () => {
      const execute = vi.fn(async () => ({ state: 'waiting' }));
      const { agent } = fixture([call('a'), call('b'), call('c'), { text: 'Polling stopped' }], { maxRepeatedResults: 1, repeatableReadTools: ['probe'] }, [tool(execute)]);
      const result = await run(mode, agent);
      expect(execute).toHaveBeenCalledTimes(3); expect(result.loop?.reason).toBe('answer_returned');
    });

    it(`${mode} never repeats an admitted write, including duplicate calls in one response`, async () => {
      const execute = vi.fn(async () => ({ accepted: true }));
      const { agent } = fixture([{ calls: [{ id: 'one', name: 'probe', args: {} }, { id: 'two', name: 'probe', args: {} }] }], {}, [tool(execute, 'write')]);
      const result = await run(mode, agent);
      expect(execute).toHaveBeenCalledTimes(1);
      expect(result.loop).toMatchObject({ reason: 'repeated_action', status: 'blocked', observedToolCalls: 1 });
      expect(agent.context.getCurrentInput()).toHaveLength(0);
      expect(JSON.stringify(agent.context.getConversation())).toContain('two');
    });

    it(`${mode} does not infer a framework failure from an application success:false field`, async () => {
      const { agent } = fixture([call('one'), { text: 'Handled' }], {}, [tool(async () => ({ success: false, applicationStatus: 'not_found' }))]);
      const result = await run(mode, agent);
      expect(result.loop).toMatchObject({ reason: 'answer_returned', recoveryAttempts: 0, consecutiveToolFailures: 0 });
    });

    it(`${mode} handles a host checker exception without exposing backend error text`, async () => {
      const { agent, provider } = fixture([{ text: 'Candidate' }], { completion: () => { throw Error('PRIVATE_BACKEND_DETAIL'); } });
      const result = await run(mode, agent);
      expect(result.loop).toMatchObject({ reason: 'checker_error', phase: 'input_needed' });
      expect(JSON.stringify(result.loop)).not.toContain('PRIVATE_BACKEND_DETAIL'); expect(provider.requests).toHaveLength(1);
    });

    it(`${mode} times out an uncooperative check and aborts its provided signal`, async () => {
      let signal: AbortSignal | undefined;
      const { agent } = fixture([{ text: 'Candidate' }], { callbackTimeoutMs: 5, completion: ctx => { signal = ctx.signal; return new Promise<AgentLoopCompletionResult>(() => {}); } });
      const result = await run(mode, agent);
      expect(result.loop?.reason).toBe('checker_error'); expect(signal?.aborted).toBe(true); expect(agent.isRunning()).toBe(false);
    });

    it(`${mode} stops a stale check after a same-revision task restore`, async () => {
      let state: TaskStatePluginNextGen;
      const { agent } = fixture([{ text: 'Candidate' }], { completion: async () => { state.restoreState(state.getState()); return { complete: true }; } }, [], {
        userId: 'host', context: { model: 'gpt-4o-mini', features: { workingMemory: false, inContextMemory: false, taskState: true }, plugins: { taskState: { scope: { ownerId: 'host', namespace: 'test' }, taskId: 'task' } } },
      });
      state = agent.context.getPlugin<TaskStatePluginNextGen>('task_state')!;
      const result = await run(mode, agent); expect(result.loop).toMatchObject({ reason: 'state_changed', status: 'blocked' });
    });

    it(`${mode} caps predicate recovery at the configured iteration limit`, async () => {
      const { agent, provider } = fixture([{ text: 'Candidate' }], { maxRecoveryAttempts: 10, completion: () => ({ complete: false }) }, [], { maxIterations: 1 });
      const result = await run(mode, agent);
      expect(result.loop?.reason).toBe('iteration_limit'); expect(provider.requests).toHaveLength(1);
    });

    it(`${mode} never retries a provider refusal through the completion predicate`, async () => {
      const completion = vi.fn(() => ({ complete: false }));
      const { agent, provider } = fixture([{ text: '', stopReason: 'refusal' }], { completion });
      const result = await run(mode, agent);
      expect(result.loop?.reason).toBe('refusal'); expect(completion).not.toHaveBeenCalled(); expect(provider.requests).toHaveLength(1);
    });

    it(`${mode} stops after an unknown write timeout and never asks the model to replay it`, async () => {
      const execute = vi.fn(async () => new Promise(() => {}));
      const completion = vi.fn(() => ({ complete: true }));
      const { agent, provider } = fixture([call('uncertain')], { completion }, [tool(execute, 'write')]);
      agent.tools.toolExecutionTimeout = 5;
      const result = await run(mode, agent);
      expect(result.loop).toMatchObject({ reason: 'uncertain_effect', status: 'blocked', observedToolCalls: 1 });
      expect(result.loop?.uncertainEffects).toHaveLength(1);
      expect(execute).toHaveBeenCalledTimes(1); expect(provider.requests).toHaveLength(1); expect(completion).not.toHaveBeenCalled();
      expect(agent.context.getCurrentInput()).toHaveLength(0);
      expect(JSON.stringify(agent.context.getConversation())).toContain('uncertain');
    });

    it(`${mode} bounds consecutive failures separately from the recovery allowance`, async () => {
      const execute = vi.fn(async () => { throw Error('READ_FAILED'); });
      const { agent } = fixture([call('a'), call('b')], { maxConsecutiveToolFailures: 2, maxRecoveryAttempts: 10 }, [tool(execute)]);
      const result = await run(mode, agent);
      expect(execute).toHaveBeenCalledTimes(2); expect(result.loop).toMatchObject({ reason: 'tool_failures', consecutiveToolFailures: 2, recoveryAttempts: 1 });
    });

    it(`${mode} admits changed read observations while tracking repetition`, async () => {
      let reads = 0;
      const { agent } = fixture([call('a'), call('b'), call('c'), { text: 'Ready' }], { maxRepeatedResults: 2 }, [tool(async () => ({ revision: ++reads }))]);
      const result = await run(mode, agent);
      expect(reads).toBe(3); expect(result.loop).toMatchObject({ reason: 'answer_returned', recoveryAttempts: 0, repeatedResults: 1 });
    });

    it(`${mode} does not infer identical results from oversized observations`, async () => {
      const execute = vi.fn(async () => 'x'.repeat(70000));
      const { agent } = fixture([call('a'), call('b'), { text: 'Observed' }], { maxRepeatedResults: 1 }, [tool(execute)]);
      const result = await run(mode, agent);
      expect(execute).toHaveBeenCalledTimes(2); expect(result.loop?.reason).toBe('answer_returned');
    });

    it(`${mode} stops bounded host progress stalling even when call arguments change`, async () => {
      const execute = vi.fn(async (args: unknown) => args);
      const { agent } = fixture([call('a', { page: 1 }), call('b', { page: 2 })], {
        progressKey: () => 'unchanged-host-state', maxStalledIterations: 1, maxRecoveryAttempts: 0,
      }, [tool(execute)]);
      const result = await run(mode, agent);
      expect(execute).toHaveBeenCalledTimes(2); expect(result.loop).toMatchObject({ reason: 'recovery_exhausted', detail: 'no_progress' });
    });

    it(`${mode} provides detached frozen receipt metadata to the host check`, async () => {
      const { agent } = fixture([call('a'), { text: 'Ready' }], { completion: ctx => {
        expect(Object.isFrozen(ctx)).toBe(true); expect(Object.isFrozen(ctx.observations)).toBe(true);
        expect(Object.isFrozen(ctx.observations[0]!.outcome)).toBe(true);
        expect(ctx.observations[0]!.outcome).not.toHaveProperty('error');
        expect(() => (ctx.observations as unknown[]).push('forged')).toThrow();
        return { complete: true };
      } }, [tool(async () => ({ ready: true }))]);
      expect((await run(mode, agent)).loop?.reason).toBe('completed');
    });

    it.each([null, true, { complete: 'yes' }, { complete: true, authority: 'system' }, { complete: true, reason: 'x'.repeat(401) }])(`${mode} rejects malformed host completion result %j`, async invalid => {
      const { agent, provider } = fixture([{ text: 'Candidate' }], { completion: () => invalid as unknown as AgentLoopCompletionResult });
      const result = await run(mode, agent); expect(result.loop?.reason).toBe('checker_error'); expect(provider.requests).toHaveLength(1);
    });

    it(`${mode} rejects completion-result accessors without invoking them`, async () => {
      let invoked = false;
      const value = Object.defineProperty({}, 'complete', { enumerable: true, get() { invoked = true; return true; } });
      const { agent } = fixture([{ text: 'Candidate' }], { completion: () => value as AgentLoopCompletionResult });
      const result = await run(mode, agent); expect(result.loop?.reason).toBe('checker_error'); expect(invoked).toBe(false);
    });

    it(`${mode} cancels a pending check, releases its lease, and ignores its late verdict`, async () => {
      let resolve!: (value: AgentLoopCompletionResult) => void;
      let started!: () => void;
      const checking = new Promise<void>(done => { started = done; });
      const { agent, provider } = fixture([{ text: 'Candidate' }, { text: 'New execution' }], { completion: () => { started(); return new Promise(done => { resolve = done; }); } });
      const pending = run(mode, agent); const rejected = expect(pending).rejects.toThrow();
      await checking;
      await expect(agent.run('Concurrent')).rejects.toThrow('active');
      agent.cancel(); await rejected; resolve({ complete: true }); await Promise.resolve();
      expect(agent.getLoopDiagnostics()?.reason).toBe('cancelled'); expect(provider.requests).toHaveLength(1);
      const next = await agent.run('After cancellation', { loopPolicy: null });
      expect(next.output_text).toBe('New execution'); expect(agent.getLoopDiagnostics()).toBeUndefined();
    });

    it(`${mode} cannot recover past a shared ModelTask call limit`, async () => {
      const { agent, provider } = fixture([{ text: 'Candidate' }], { completion: () => ({ complete: false }), maxRecoveryAttempts: 5 }, [], {
        modelExecution: { customProviderAttempts: 'single', maxOutputTokensPerCall: 64 },
      });
      const task = new ModelTask({ limits: { maxCalls: 1 } });
      try {
        await expect(run(mode, agent, { modelTask: task })).rejects.toThrow();
        expect(provider.requests).toHaveLength(1); expect(task.snapshot().totals.calls).toBe(1);
        expect(agent.getLoopDiagnostics()?.reason).toBe('budget_exhausted');
        expect(agent.isRunning()).toBe(false);
      } finally { task.destroy(); }
    });

    it(`${mode} shares opt-in before-tool preparation without changing a skipped tool into evidence`, async () => {
      const execute = vi.fn(async () => 'must not execute');
      const before = vi.fn(async () => ({ skip: true, mockResult: { skipped: true } }));
      const { agent } = fixture([call('a'), { text: 'Skipped' }], {}, [tool(execute)], { hooks: { 'before:tool': before } });
      const result = await run(mode, agent);
      expect(before).toHaveBeenCalledTimes(1); expect(execute).not.toHaveBeenCalled();
      expect(result.loop).toMatchObject({ observedToolCalls: 0, reason: 'answer_returned' });
    });

    it(`${mode} uses modified hook arguments for effect admission and retains permission enforcement`, async () => {
      const execute = vi.fn(async (args: unknown) => args);
      const { agent } = fixture([call('a'), { text: 'Finished' }], {}, [tool(execute)], {
        hooks: { 'before:tool': async () => ({ modified: { function: { name: 'probe', arguments: '{"host":true}' } } }) },
      });
      await run(mode, agent); expect(execute.mock.calls[0]![0]).toEqual({ host: true });
    });

    it(`${mode} retains its unconfigured legacy hook trace while sharing response decisions`, async () => {
      const trace: string[] = [];
      const hooks: AgentConfig['hooks'] = {
        'before:execution': async () => { trace.push('before:execution'); },
        'before:llm': async () => { trace.push('before:llm'); return {}; },
        'after:llm': async () => { trace.push('after:llm'); return {}; },
        'before:tool': async () => { trace.push('before:tool'); return {}; },
        'after:tool': async () => { trace.push('after:tool'); return {}; },
        'after:execution': async () => { trace.push('after:execution'); },
      };
      const { agent } = fixture([call('a'), { text: 'Done' }], null, [tool(async () => { trace.push('execute'); return 1; })], { hooks });
      await run(mode, agent);
      expect(trace).toEqual(['before:execution', 'before:llm', 'after:llm',
        ...(mode === 'run' ? ['before:tool'] : []), 'execute', 'after:tool', 'before:llm', 'after:llm', 'after:execution']);
    });

    it(`${mode} exposes bounded candidate text and explicit observation omission metadata`, async () => {
      const { agent } = fixture([{ text: 'x'.repeat(40000) }], { completion: ctx => {
        expect(ctx.outputText).toHaveLength(32768); expect(ctx.outputTruncated).toBe(true);
        expect(ctx.observedToolCalls).toBe(0); expect(ctx.observationsTruncated).toBe(false);
        return { complete: true, reason: 'Host checks its independent artifact' };
      } });
      const result = await run(mode, agent); expect(result.loop?.reason).toBe('completed'); expect(result.text).toHaveLength(40000);
    });

    it(`${mode} retains existing bounded empty-response retry behavior before checking completion`, async () => {
      const completion = vi.fn(() => ({ complete: true }));
      const { agent, provider } = fixture([{}, {}, { text: 'Ready' }], { completion }, [], { emptyResponseRetry: { enabled: true, maxRetries: 2, initialDelayMs: 0, maxDelayMs: 0 } });
      const result = await run(mode, agent);
      expect(provider.requests).toHaveLength(3); expect(completion).toHaveBeenCalledTimes(1);
      expect(result.loop).toMatchObject({ reason: 'completed', iterations: 3, recoveryAttempts: 0 });
    });

    it(`${mode} never replays a write to repair failed evidence storage`, async () => {
      const scope = { ownerId: 'host', namespace: 'failure' };
      const storage = new InMemoryEvidenceStorage({ scope });
      vi.spyOn(storage, 'put').mockRejectedValue(Error('STORE_OFFLINE'));
      const execute = vi.fn(async () => ({ accepted: true, source: 'WRITE_RAW_SOURCE_42' }));
      const { agent } = fixture([call('original'), call('repeat')], {}, [tool(execute, 'write')], {
        userId: 'host', context: { model: 'gpt-4o-mini', features: { workingMemory: false, inContextMemory: false, evidence: true }, plugins: { evidence: { storage } } },
      });
      const result = await run(mode, agent);
      expect(execute).toHaveBeenCalledTimes(1); expect(result.loop?.reason).toBe('repeated_action');
      expect(JSON.stringify([...agent.context.getConversation(), ...agent.context.getCurrentInput()])).toContain('WRITE_RAW_SOURCE_42');
    });

    it.each(['failed', 'incomplete'] as const)(`${mode} never promotes provider %s to verified completion`, async status => {
      const completion = vi.fn(() => ({ complete: true }));
      const { agent, provider } = fixture([{ text: 'Candidate', status }], { completion });
      const result = await run(mode, agent);
      expect(result.loop?.reason).toBe(status === 'failed' ? 'provider_failed' : 'provider_incomplete');
      expect(completion).not.toHaveBeenCalled(); expect(provider.requests).toHaveLength(1);
    });
  }

  it('uses the actual repaired nonstream JSON candidate for its host completion check', async () => {
    const completion = vi.fn((ctx: Readonly<AgentLoopCheckContext>) => ({ complete: ctx.outputText === '{"value":"ok"}' }));
    const { agent, provider } = fixture([{ text: 'invalid JSON' }, { text: '{"value":"ok"}' }], { completion });
    const result = await agent.run('JSON please', { responseFormat: { type: 'json_schema', name: 'answer', strict: true, schema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false } } });
    expect(result.output_parsed).toEqual({ value: 'ok' }); expect(result.loop?.reason).toBe('completed');
    expect(completion).toHaveBeenCalledTimes(1); expect(provider.requests).toHaveLength(2);
  });

  it('persists task/evidence state without restoring callbacks or execution counters', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'loop-policy-session-'));
    const storage = new FileContextStorage({ agentId: 'loop', baseDirectory: directory });
    const context = { model: 'gpt-4o-mini', agentId: 'loop', userId: 'host', storage,
      features: { workingMemory: false, inContextMemory: false, taskState: true },
      plugins: { taskState: { scope: { ownerId: 'host', namespace: 'loop' }, taskId: 'task' } } };
    try {
      const first = fixture([{ text: 'Candidate' }], { maxRecoveryAttempts: 0, completion: () => ({ complete: false }) }, [], { context, userId: 'host' }).agent;
      first.context.getPlugin<TaskStatePluginNextGen>('task_state')!.updateHost({ notes: [{ id: 'cap', category: 'constraint', text: 'HOST_CAP_40', source: { label: 'Host' } }] }, 0);
      await first.run('Continue'); await first.saveSession('checkpoint');
      const saved = JSON.stringify(await storage.load('checkpoint'));
      expect(saved).not.toContain('completion'); expect(saved).not.toContain('recoveryAttempts');
      const second = fixture([{ text: 'Restored' }], null, [], { context, userId: 'host' }).agent;
      expect(await second.loadSession('checkpoint')).toBe(true);
      expect(second.getLoopDiagnostics()).toBeUndefined();
      expect(second.context.getPlugin<TaskStatePluginNextGen>('task_state')!.getState().notes[0]!.text).toBe('HOST_CAP_40');
      expect((await second.run('Continue')).loop).toBeUndefined();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('reports pending asynchronous work without invoking a completion predicate, then checks explicit continuation', async () => {
    let settle!: (value: unknown) => void;
    const pendingTool = tool(async () => new Promise(resolve => { settle = resolve; }));
    pendingTool.definition.blocking = false;
    const completion = vi.fn(() => ({ complete: true }));
    const { agent, provider } = fixture([call('async'), { text: 'Accepted' }, { text: 'Delivered' }], { completion }, [pendingTool], { asyncTools: { autoContinue: false } });
    const first = await agent.run('Start'); expect(first.loop?.reason).toBe('pending_async'); expect(completion).not.toHaveBeenCalled();
    settle({ delivered: true });
    await vi.waitFor(() => expect(agent.hasPendingAsyncTools()).toBe(false));
    const next = await agent.continueWithAsyncResults();
    expect(next.loop?.reason).toBe('completed'); expect(completion).toHaveBeenCalledTimes(1); expect(provider.requests).toHaveLength(3);
  });

  it('preserves suspension persistence and requires a fresh managed execution for completion', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'loop-suspend-'));
    StorageRegistry.configure({ correlations: new FileCorrelationStorage({ baseDirectory: join(directory, 'correlations') }) });
    const completion = vi.fn(() => ({ complete: true }));
    const storage = new FileContextStorage({ agentId: 'loop-suspend', baseDirectory: directory });
    const execute = vi.fn(async () => SuspendSignal.create({ result: { accepted: true }, correlationId: 'synthetic-job' }));
    const { agent, provider } = fixture([call('submit'), { text: 'Waiting for a host reply' }, { text: 'Host verified the completed job' }], { completion }, [tool(execute, 'write')], {
      context: { model: 'gpt-4o-mini', agentId: 'loop-suspend', storage, features: { workingMemory: false, inContextMemory: false } },
    });
    try {
      const response = await agent.run('Submit and wait');
      expect(response.status).toBe('suspended'); expect(response.loop).toMatchObject({ reason: 'suspended', status: 'waiting_external' });
      expect(completion).not.toHaveBeenCalled(); expect(execute).toHaveBeenCalledTimes(1);
      expect(response.suspension?.sessionId).toBeTruthy();
      expect(await storage.load(response.suspension!.sessionId)).toBeTruthy();
      expect((await agent.run('Host verified the job externally')).loop?.status).toBe('completed');
      expect(execute).toHaveBeenCalledTimes(1); expect(provider.requests).toHaveLength(3);
    } finally { StorageRegistry.remove('correlations'); await rm(directory, { recursive: true, force: true }); }
  });

  it('compares equivalent opted-in run and stream hook/action traces', async () => {
    const traces: string[][] = [];
    for (const mode of ['run', 'stream'] as const) {
      const trace: string[] = []; let reads = 0;
      const { agent } = fixture([call('one'), call('two'), { text: 'Verified' }], { completion: () => ({ complete: reads === 2 }) }, [tool(async () => {
        trace.push('execute'); if (++reads === 1) throw Error('Transient read'); return { value: 42 };
      })], { hooks: {
        'before:tool': async () => { trace.push('before:tool'); return {}; },
        'approve:tool': async () => { trace.push('approve:tool'); return { approved: true }; },
        'after:tool': async () => { trace.push('after:tool'); return {}; },
      } });
      const result = await run(mode, agent); expect(result.loop?.status).toBe('completed'); traces.push(trace);
    }
    expect(traces[0]).toEqual(traces[1]); expect(traces[0]!.filter(t => t === 'execute')).toHaveLength(2);
  });

  for (const mode of ['run', 'stream'] as const) {
    it(`${mode} checks shared helper admission against the same explicit ModelTask`, async () => {
      const task = new ModelTask({ limits: { maxCalls: 1 } });
      let agent!: Agent;
      const created = fixture([{ text: 'Candidate' }], { completion: async () => {
        await agent.invokeHelper('verifier', 'Verify the artifact', { modelTask: task, schema: { type: 'object' } });
        return { complete: true };
      } }, [], { modelExecution: { customProviderAttempts: 'single', maxOutputTokensPerCall: 128, helpers: { verifier: { connector: 'loop-0', model: 'gpt-4o-mini' } } } });
      agent = created.agent;
      const result = await run(mode, agent, { modelTask: task });
      expect(result.loop?.reason).toBe('budget_exhausted'); expect(created.provider.requests).toHaveLength(1);
    });

    it(`${mode} preserves permission denial without inventing an execution or uncertain effect`, async () => {
      const execute = vi.fn(async () => ({ accepted: true }));
      const { agent } = fixture([call('denied')], { maxRecoveryAttempts: 0 }, [tool(execute, 'write')], {
        hooks: { 'approve:tool': async () => ({ approved: false, reason: 'Host denial' }) },
      });
      const result = await run(mode, agent);
      expect(execute).not.toHaveBeenCalled(); expect(result.loop?.observedToolCalls).toBe(0);
      expect(result.loop?.uncertainEffects).toEqual([]); expect(result.loop?.reason).toBe('recovery_exhausted');
    });
  }

  it('keeps host policy callbacks out of an external transport execution', async () => {
    const completion = vi.fn(() => ({ complete: false }));
    const execute = vi.fn(async () => ({ value: 42 }));
    const { agent, provider } = fixture([], { completion }, [tool(execute)]);
    await agent.beginExternalExecution({ source: 'realtime-fixture' });
    await agent.executeExternalToolCall({ id: 'external-1', name: 'probe', arguments: {} });
    const response = await agent.completeExternalExecution({ outputText: 'External transport owns its final verdict.' });
    expect(response.loop).toBeUndefined(); expect(completion).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledTimes(1); expect(provider.requests).toHaveLength(0);
  });

  it('retains settled unacknowledged effects and releases the owning stream on early closure', async () => {
    const scope = { ownerId: 'host', namespace: 'closed' };
    const storage = new InMemoryEvidenceStorage({ scope });
    vi.spyOn(storage, 'put').mockRejectedValue(Error('STORE_OFFLINE'));
    const execute = vi.fn(async () => ({ source: 'RETAIN_ON_CLOSE' }));
    const { agent, provider } = fixture([call('write')], {}, [tool(execute, 'write')], {
      userId: 'host', context: { model: 'gpt-4o-mini', features: { workingMemory: false, inContextMemory: false, evidence: true }, plugins: { evidence: { storage } } },
    });
    const iterator = agent.stream('Write once');
    for (;;) { const step = await iterator.next(); if (step.done || step.value.type === StreamEventType.TOOL_EXECUTION_DONE) break; }
    expect(typeof iterator.return).toBe('function');
    await iterator.return?.(undefined);
    expect(execute).toHaveBeenCalledTimes(1); expect(provider.requests).toHaveLength(1); expect(agent.isRunning()).toBe(false);
    expect(agent.getLoopDiagnostics()?.reason).toBe('cancelled');
    expect(JSON.stringify(agent.context.getCurrentInput())).toContain('RETAIN_ON_CLOSE');
    const retained = agent.context.getCurrentInput().flatMap(i => i.type === 'message' ? i.content : []).find(c => c.type === ContentType.TOOL_RESULT);
    expect(retained?.type === ContentType.TOOL_RESULT && retained.evidence?.status).toBe('storage_failed');
  });

  it.each([
    { maxRecoveryAttempts: -1 }, { maxRecoveryAttempts: Infinity }, { maxRepeatedResults: 0 },
    { maxConsecutiveToolFailures: 1.5 }, { maxStalledIterations: 0 }, { callbackTimeoutMs: 60001 },
    { completion: true }, { progressKey: 'text' }, { repeatableReadTools: 'probe' }, [],
  ])('rejects invalid policy %j before model/action dispatch and releases its lease', async invalid => {
    const { agent, provider } = fixture([{ text: 'After rejection' }], invalid as unknown as AgentLoopPolicy);
    await expect(agent.run('Invalid')).rejects.toThrow(); expect(provider.requests).toHaveLength(0); expect(agent.isRunning()).toBe(false);
    expect((await agent.run('Valid', { loopPolicy: null })).output_text).toBe('After rejection');
  });
});
