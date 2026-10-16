import { afterEach, describe, expect, it, vi } from 'vitest';
import { Agent, Connector, Vendor, StreamEventType, ContentType, ToolCallState, FileContextStorage, InMemoryEvidenceStorage, ToolEvidenceMiddleware } from '../../../src/index.js';
import type { AgentConfig, AgentLoopPolicy, AgentLoopDiagnostics, AgentLoopCheckContext, ToolFunction, ToolResult, ToolExecutionOutcome } from '../../../src/index.js';
import { ScriptedLoopProvider } from '../../../examples/agent-loop/scripted-provider.js';
import type { ScriptedFrame } from '../../../examples/agent-loop/scripted-provider.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const agents: Agent[] = [], names: string[] = [], directories: string[] = [];
afterEach(async () => { agents.splice(0).forEach(a => a.destroy()); names.splice(0).forEach(n => Connector.remove(n)); vi.useRealTimers(); vi.restoreAllMocks(); await Promise.all(directories.splice(0).map(d => rm(d, { recursive: true, force: true }))); });
const context = { model: 'gpt-4o-mini', features: { workingMemory: false, inContextMemory: false } };
const call = (id: string, args: Record<string, unknown> = {}): ScriptedFrame => ({ calls: [{ id, name: 'probe', args }] });
function tool(execute: ToolFunction['execute'], effect: 'read' | 'write' | 'unknown' = 'write', blocking = true): ToolFunction {
  return { definition: { type: 'function', blocking, function: { name: 'probe', parameters: { type: 'object', properties: {} } } }, output: { effect }, execute };
}
function fixture(frames: ScriptedFrame[], tools: ToolFunction[] = [], policy: AgentLoopPolicy | null = {}, extra: Partial<AgentConfig> = {}) {
  const name = `loop-correction-${names.length}`; names.push(name); const provider = new ScriptedLoopProvider(frames);
  Connector.create({ name, vendor: Vendor.OpenAI, auth: { type: 'none' }, options: { provider } });
  const agent = Agent.create({ connector: name, model: 'gpt-4o-mini', context, tools, loopPolicy: policy, maxIterations: 6,
    emptyResponseRetry: { enabled: false }, asyncTools: { autoContinue: false, asyncTimeout: 20 }, ...extra });
  agents.push(agent); return { agent, provider };
}
async function execute(mode: 'run' | 'stream', agent: Agent): Promise<AgentLoopDiagnostics | undefined> {
  if (mode === 'run') return (await agent.run('Submit once')).loop;
  let loop: AgentLoopDiagnostics | undefined, completions = 0;
  for await (const e of agent.stream('Submit once')) if (e.type === StreamEventType.RESPONSE_COMPLETE) { loop = e.loop; completions++; }
  expect(completions).toBe(1); return loop;
}
function blocks(agent: Agent) { return [...agent.context.getConversation(), ...agent.context.getCurrentInput()].flatMap(i => i.type === 'message' ? i.content : []); }

describe('Stage 10 review corrections', () => {
  for (const delivery of ['run', 'continuation'] as const) for (const effect of ['read', 'write'] as const) for (const failed of [false, true]) {
    it(`R1/R2 ${delivery} imports authentic ${failed ? 'failed' : 'successful'} ${effect} after replacement`, async () => {
      let settle!: (v: string) => void, reject!: (e: Error) => void;
      const original = vi.fn(() => new Promise<string>((ok, no) => { settle = ok; reject = no; }));
      const check = vi.fn((ctx: Readonly<AgentLoopCheckContext>) => {
        expect(ctx.observedToolCalls).toBe(1); expect(ctx.observations).toHaveLength(1);
        expect(ctx.observations[0]).toMatchObject({ effect, callId: 'background', outcome: { status: failed ? 'failed' : 'succeeded', completion: 'settled' } });
        return { complete: true };
      });
      const { agent, provider } = fixture([call('background'), { text: 'Pending' }, { text: 'Delivered' }], [tool(original, effect, false)], { completion: check }, { asyncTools: { autoContinue: false, asyncTimeout: 0 } });
      expect((await agent.run('Start')).loop?.reason).toBe('pending_async');
      agent.tools.unregister('probe'); const replacement = vi.fn(async () => 'replacement');
      agent.tools.register(tool(replacement, effect === 'read' ? 'write' : 'read'));
      if (failed) reject(Error('SETTLED_FAILURE')); else settle('ASYNC_RECEIPT');
      await vi.waitFor(() => expect(agent.hasPendingAsyncTools()).toBe(false));
      const response = delivery === 'run' ? await agent.run('ORIGINAL_RECEIVING_INPUT') : await agent.continueWithAsyncResults();
      expect(response.loop?.reason).toBe('completed'); expect(check).toHaveBeenCalledTimes(1);
      expect(original).toHaveBeenCalledTimes(1); expect(replacement).not.toHaveBeenCalled(); expect(provider.requests).toHaveLength(3);
      if (delivery === 'run') expect(JSON.stringify(provider.requests[2]!.input)).toContain('ORIGINAL_RECEIVING_INPUT');
      expect(JSON.stringify(provider.requests[2]!.input)).toContain(failed ? 'SETTLED_FAILURE' : 'ASYNC_RECEIPT');
    });
  }

  for (const delivery of ['run', 'continuation'] as const) {
    it(`R2 ${delivery} preserves admitted write/unknown completion with evidence enabled`, async () => {
      vi.useFakeTimers(); const scope = { ownerId: 'host', namespace: 'admitted-effect' };
      const storage = new InMemoryEvidenceStorage({ scope }); const check = vi.fn(() => ({ complete: true }));
      const { agent, provider } = fixture([call('write'), { text: 'Pending' }], [tool(async () => new Promise(() => {}), 'write', false)], { completion: check }, {
        userId: 'host', context: { ...context, features: { ...context.features, evidence: true }, plugins: { evidence: { storage } } },
      });
      await agent.run('Start'); agent.tools.register(tool(async () => 'read', 'read')); await vi.advanceTimersByTimeAsync(21);
      const response = delivery === 'run' ? await agent.run('Process') : await agent.continueWithAsyncResults();
      expect(response.loop?.reason).toBe('uncertain_effect'); expect(response.loop?.observedToolCalls).toBe(1);
      expect(check).not.toHaveBeenCalled(); expect(provider.requests).toHaveLength(2);
    });
    it(`R1 ${delivery} imports an unknown async write before dispatch or checking completion`, async () => {
      vi.useFakeTimers(); const check = vi.fn(() => ({ complete: true })); const write = vi.fn(async () => new Promise(() => {}));
      const { agent, provider } = fixture([call('write'), { text: 'Pending' }, { text: 'Must not be called' }], [tool(write, 'write', false)], { completion: check });
      expect((await agent.run('Start')).loop?.reason).toBe('pending_async'); await vi.advanceTimersByTimeAsync(21);
      const response = delivery === 'run' ? await agent.run('Process the delivered observation') : await agent.continueWithAsyncResults();
      expect(response.loop?.reason).toBe('uncertain_effect'); expect(response.loop?.observedToolCalls).toBe(1);
      expect(check).not.toHaveBeenCalled(); expect(write).toHaveBeenCalledTimes(1); expect(provider.requests).toHaveLength(2);
    });
    it(`R2 ${delivery} retains the admitted write effect after read re-registration`, async () => {
      vi.useFakeTimers(); const check = vi.fn(() => ({ complete: true })); const write = vi.fn(async () => new Promise(() => {})); const replacement = vi.fn(async () => ({ read: true }));
      const { agent, provider } = fixture([call('write'), { text: 'Pending' }, { text: 'Must not be called' }], [tool(write, 'write', false)], { completion: check });
      expect((await agent.run('Start')).loop?.reason).toBe('pending_async'); agent.tools.register(tool(replacement, 'read')); await vi.advanceTimersByTimeAsync(21);
      const response = delivery === 'run' ? await agent.run('Process') : await agent.continueWithAsyncResults();
      expect(response.loop?.reason).toBe('uncertain_effect'); expect(check).not.toHaveBeenCalled();
      expect(provider.requests).toHaveLength(2); expect(write).toHaveBeenCalledTimes(1); expect(replacement).not.toHaveBeenCalled();
    });
    it(`R1 ${delivery} enforces imported read-failure limits before another model call`, async () => {
      let reject!: (e: Error) => void;
      const check = vi.fn(() => ({ complete: true }));
      const { agent, provider } = fixture([call('read'), { text: 'Pending' }], [tool(() => new Promise((_ok, no) => { reject = no; }), 'read', false)], { completion: check, maxConsecutiveToolFailures: 1 }, { asyncTools: { autoContinue: false, asyncTimeout: 0 } });
      await agent.run('Start'); reject(Error('READ_FAILED'));
      await vi.waitFor(() => expect(agent.hasPendingAsyncTools()).toBe(false));
      const response = delivery === 'run' ? await agent.run('Process') : await agent.continueWithAsyncResults();
      expect(response.loop).toMatchObject({ reason: 'tool_failures', observedToolCalls: 1 });
      expect(check).not.toHaveBeenCalled(); expect(provider.requests).toHaveLength(2);
    });
    it(`R2 ${delivery} retains correlation when a legacy observer omits optional outcome`, async () => {
      vi.useFakeTimers(); const check = vi.fn(() => ({ complete: true }));
      const { agent, provider } = fixture([call('write'), { text: 'Pending' }], [tool(async () => new Promise(() => {}), 'write', false)], { completion: check });
      agent.on('async:tool:timeout', () => {
        // Public pending results are legacy extension surfaces. Omission cannot
        // reclassify the authentic delivery as a successful read.
        const pending = agent.getPendingAsyncTools()[0]; if (pending?.result) delete pending.result.outcome;
      });
      await agent.run('Start'); agent.tools.register(tool(async () => 'read', 'read')); await vi.advanceTimersByTimeAsync(21);
      const response = delivery === 'run' ? await agent.run('Process') : await agent.continueWithAsyncResults();
      expect(response.loop?.reason).toBe('uncertain_effect'); expect(response.loop?.uncertainEffects[0]?.executionId).toBeTruthy();
      expect(check).not.toHaveBeenCalled(); expect(provider.requests).toHaveLength(2);
    });
  }

  it('R2 treats uncorrelated legacy deliveries conservatively without inventing outcomes', async () => {
    const check = vi.fn(() => ({ complete: true }));
    const { agent, provider } = fixture([], [tool(async () => 'read', 'read')], { completion: check });
    const legacy: ToolResult = { tool_use_id: 'legacy', tool_name: 'probe', content: 'Legacy observation', state: ToolCallState.COMPLETED };
    expect((await agent.continueWithAsyncResults([legacy])).loop).toMatchObject({ reason: 'uncertain_effect', observedToolCalls: 1 });
    expect(check).not.toHaveBeenCalled(); expect(provider.requests).toHaveLength(0); expect(legacy.outcome).toBeUndefined();
  });

  it('R1 deduplicates same-run settlement and repeated authentic delivery identities', async () => {
    let settle!: (v: string) => void, delivered!: ToolResult;
    const effect = vi.fn(() => new Promise<string>(ok => { settle = ok; }));
    const { agent, provider } = fixture([call('background'), call('blocking'), { text: 'Delivered' }, { text: 'Delivered again' }], [tool(effect, 'read', false)], {
      completion: ctx => ({ complete: ctx.observedToolCalls >= 1 }),
    }, { asyncTools: { autoContinue: false, asyncTimeout: 0 } });
    agent.on('async:tool:complete', e => { delivered = e.result; });
    const generate = provider.generate.bind(provider);
    vi.spyOn(provider, 'generate').mockImplementation(async options => {
      if (provider.requests.length === 1) {
        settle('SAME_RUN_RAW'); await vi.waitFor(() => expect(agent.hasPendingAsyncTools()).toBe(false));
        agent.tools.register(tool(async () => 'BLOCKING_RAW', 'read'));
      }
      return generate(options);
    });
    const response = await agent.run('ORIGINAL_TASK');
    expect(response.loop).toMatchObject({ reason: 'completed', observedToolCalls: 2 }); expect(effect).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(provider.requests[2]!.input)).toContain('SAME_RUN_RAW');
    const repeated = await agent.continueWithAsyncResults([delivered, delivered]);
    expect(repeated.loop?.observedToolCalls).toBe(1); expect(provider.requests).toHaveLength(4);
  });

  for (const delivery of ['run', 'continuation'] as const) for (const change of ['scope', 'cancel'] as const) {
    it(`R1 ${delivery} rejects reentrant ${change} before observation dispatch`, async () => {
      let settle!: (v: string) => void; const check = vi.fn(() => ({ complete: true }));
      const { agent, provider } = fixture([call('background'), { text: 'Pending' }], [tool(() => new Promise<string>(ok => { settle = ok; }), 'read', false)], { completion: check }, { userId: 'alice', asyncTools: { autoContinue: false, asyncTimeout: 0 } });
      await agent.run('Start'); settle('PRIVATE_ASYNC_BODY'); await vi.waitFor(() => expect(agent.hasPendingAsyncTools()).toBe(false));
      agent.on(delivery === 'run' ? 'async:results:injected' : 'async:continuation:start', () => { if (change === 'scope') agent.userId = 'bob'; else agent.cancel(); });
      await expect(delivery === 'run' ? agent.run('Next') : agent.continueWithAsyncResults()).rejects.toThrow();
      expect(check).not.toHaveBeenCalled(); expect(provider.requests).toHaveLength(2);
      if (change === 'scope') expect(JSON.stringify(agent.context.getCurrentInput())).not.toContain('PRIVATE_ASYNC_BODY');
    });
  }

  for (const delivery of ['run', 'continuation'] as const) it(`R1 ${delivery} rechecks account scope after an awaited imported progress callback`, async () => {
    let settle!: (v: string) => void, rebind = false;
    const check = vi.fn(() => ({ complete: true }));
    const { agent, provider } = fixture([call('read'), { text: 'Pending' }], [tool(() => new Promise<string>(ok => { settle = ok; }), 'read', false)], {
      completion: check, progressKey: async () => { await Promise.resolve(); if (rebind) agent.tools.mergeToolContext({ accountId: 'personal' }); return 'host-progress'; },
    }, { asyncTools: { autoContinue: false, asyncTimeout: 0 } });
    agent.tools.mergeToolContext({ accountId: 'work' });
    await agent.run('Start'); settle('PRIVATE_ACCOUNT_BODY'); await vi.waitFor(() => expect(agent.hasPendingAsyncTools()).toBe(false)); rebind = true;
    await expect(delivery === 'run' ? agent.run('Next') : agent.continueWithAsyncResults()).rejects.toThrow('scope changed');
    expect(check).not.toHaveBeenCalled(); expect(provider.requests).toHaveLength(2);
    expect(JSON.stringify(agent.context.getCurrentInput())).not.toContain('PRIVATE_ACCOUNT_BODY');
  });

  for (const delivery of ['run', 'continuation'] as const) it(`R1 ${delivery} retains failed evidence for host repair without replay`, async () => {
    const scope = { ownerId: 'host', namespace: 'async-failure' }; const storage = new InMemoryEvidenceStorage({ scope });
    const put = vi.spyOn(storage, 'put').mockRejectedValue(Error('OFFLINE'));
    let settle!: (v: string) => void, delivered!: ToolResult; const write = vi.fn(() => new Promise<string>(ok => { settle = ok; }));
    const { agent, provider } = fixture([call('write'), { text: 'Pending' }, { text: 'Repaired' }], [tool(write, 'write', false)], {}, {
      userId: 'host', asyncTools: { autoContinue: false, asyncTimeout: 0 }, context: { ...context, features: { ...context.features, evidence: true }, plugins: { evidence: { storage } } },
    });
    agent.on('async:tool:complete', e => { delivered = e.result; });
    await agent.run('Start'); settle('RAW_FOR_REPAIR'); await vi.waitFor(() => expect(agent.hasPendingAsyncTools()).toBe(false));
    await expect(delivery === 'run' ? agent.run('Next') : agent.continueWithAsyncResults()).rejects.toThrow('unacknowledged');
    expect(provider.requests).toHaveLength(2); expect(write).toHaveBeenCalledTimes(1);
    put.mockRestore();
    const receipt = await new ToolEvidenceMiddleware({ storage }).record(tool(write, 'write', false), {}, { userId: 'host' }, delivered.outcome!, { value: delivered.content });
    delivered.evidence = receipt;
    delivered.outcome = { ...delivered.outcome!, evidence: receipt };
    expect((await agent.continueWithAsyncResults()).loop?.reason).toBe('answer_returned');
    expect(write).toHaveBeenCalledTimes(1); expect(provider.requests).toHaveLength(3);
  });

  for (const evidence of [false, true]) it(`R3 formatting preserves stopped calls and exact results; failed evidence=${evidence}`, async () => {
    const storage = new InMemoryEvidenceStorage({ scope: { ownerId: 'host', namespace: 'correction' } });
    if (evidence) vi.spyOn(storage, 'put').mockRejectedValue(Error('Synthetic storage failure'));
    const write = vi.fn(async () => ({ accepted: true, source: 'PROTECTED_RAW_42' }));
    const { agent, provider } = fixture([call('submitted', { job: 'A42' }), { text: '{"message":"Stopped"}' }, { text: 'Continue safely' }], [tool(write)], {}, {
      maxIterations: 1, userId: 'host', context: evidence ? { ...context, features: { ...context.features, evidence: true }, plugins: { evidence: { storage } } } : context,
    });
    const response = await agent.run('Submit', { responseFormat: { type: 'json_schema', name: 'answer', schema: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'], additionalProperties: false } } });
    expect(response.output_parsed).toEqual({ message: 'Stopped' }); expect(response.loop?.reason).toBe('iteration_limit');
    expect(blocks(agent).filter(b => b.type === ContentType.TOOL_USE)).toHaveLength(1);
    expect(blocks(agent).filter(b => b.type === ContentType.TOOL_RESULT)).toHaveLength(1);
    await agent.run('Continue', { loopPolicy: null });
    expect(JSON.stringify(provider.requests.at(-1)!.input)).toContain('PROTECTED_RAW_42');
    expect(JSON.stringify(provider.requests.at(-1)!.input)).toContain('A42'); expect(write).toHaveBeenCalledTimes(1);
  });

  it('R3 formatting a guarded queued write appends an answer without erasing the original call', async () => {
    vi.useFakeTimers(); const write = vi.fn(async () => new Promise(() => {}));
    const { agent, provider } = fixture([call('async-write', { job: 'ASYNC_ARGUMENT' }), { text: 'Pending' }, { text: '{"message":"Needs host verification"}' }, { text: 'Continued' }], [tool(write, 'write', false)]);
    await agent.run('Start'); await vi.advanceTimersByTimeAsync(21);
    const response = await agent.run('Inspect delivery', { responseFormat: { type: 'json_object' } });
    expect(response.loop?.reason).toBe('uncertain_effect'); expect(response.output_parsed).toEqual({ message: 'Needs host verification' });
    expect(blocks(agent).filter(b => b.type === ContentType.TOOL_USE)).toHaveLength(1);
    await agent.run('Host follow-up', { loopPolicy: null });
    expect(JSON.stringify(provider.requests.at(-1)!.input)).toContain('ASYNC_ARGUMENT'); expect(write).toHaveBeenCalledTimes(1);
  });

  for (const mode of ['run', 'stream'] as const) {
    for (const scopeChange of ['account', 'accounts', 'identities', 'roles', 'session', 'registry'] as const) it(`review 2 ${mode} rejects a pending completion after ${scopeChange} rebinding`, async () => {
      const { agent, provider } = fixture([{ text: 'Candidate' }], [], { completion: async () => {
        await Promise.resolve();
        if (scopeChange === 'account') agent.tools.mergeToolContext({ accountId: 'personal' });
        if (scopeChange === 'accounts') agent.tools.mergeToolContext({ connectorAccounts: { service: 'personal' } });
        if (scopeChange === 'identities') agent.tools.mergeToolContext({ identities: [{ connector: 'other' }] });
        if (scopeChange === 'roles') agent.tools.mergeToolContext({ roles: ['other'] });
        if (scopeChange === 'session') agent.tools.mergeToolContext({ sessionId: 'other' });
        if (scopeChange === 'registry') agent.tools.mergeToolContext({ connectorRegistry: Connector.asRegistry() });
        return { complete: true, reason: 'Old work account verified' };
      } });
      agent.tools.mergeToolContext({ accountId: 'work', connectorAccounts: { service: 'work' }, identities: [{ connector: 'main' }], roles: ['worker'], sessionId: 'original' });
      expect((await execute(mode, agent))?.reason).toBe('state_changed'); expect(agent.getLoopDiagnostics()?.status).toBe('blocked');
      expect(provider.requests).toHaveLength(1);
    });
    for (const reason of ['tool_failures', 'repeated_action'] as const) it(`R3/R4 ${mode} preserves ${reason} stopped batches before new input`, async () => {
      const executeTool = vi.fn(async () => { if (reason === 'tool_failures') throw Error('STOPPED_FAILURE'); return 'STOPPED_RECEIPT'; });
      const frame: ScriptedFrame = reason === 'repeated_action' ? { calls: [{ id: 'one', name: 'probe', args: { job: 'A42' } }, { id: 'two', name: 'probe', args: { job: 'A42' } }] } : call('one', { job: 'A42' });
      const { agent, provider } = fixture([frame, ...(mode === 'run' ? [{ text: '{"message":"Stopped"}' }] : []), { text: 'Resume' }], [tool(executeTool)], { maxConsecutiveToolFailures: 1 });
      const loop = mode === 'run' ? (await agent.run('Submit', { responseFormat: { type: 'json_object' } })).loop : await execute(mode, agent);
      expect(loop?.reason).toBe(reason); expect(agent.context.getCurrentInput()).toHaveLength(0);
      await agent.run('Resume', { loopPolicy: null });
      const sent = JSON.stringify(provider.requests.at(-1)!.input);
      expect(sent).toContain('A42'); expect(sent).toContain(reason === 'tool_failures' ? 'STOPPED_FAILURE' : 'STOPPED_RECEIPT');
      expect(executeTool).toHaveBeenCalledTimes(1);
      expect(blocks(agent).filter(b => b.type === ContentType.TOOL_RESULT)).toHaveLength(reason === 'repeated_action' ? 2 : 1);
    });
    it(`R4 ${mode} commits a stopped tool turn before accepting new input`, async () => {
      const write = vi.fn(async () => ({ accepted: true, source: 'STOPPED_RAW_42' }));
      const { agent, provider } = fixture([call('submitted'), { text: 'Continue safely' }], [tool(write)], {}, { maxIterations: 1 });
      expect((await execute(mode, agent))?.reason).toBe('iteration_limit');
      await agent.run('Continue', { loopPolicy: null });
      expect(JSON.stringify(provider.requests.at(-1)!.input)).toContain('STOPPED_RAW_42');
      expect(blocks(agent).filter(b => b.type === ContentType.TOOL_USE)).toHaveLength(1);
      expect(blocks(agent).filter(b => b.type === ContentType.TOOL_RESULT)).toHaveLength(1); expect(write).toHaveBeenCalledTimes(1);
    });
    for (const evidence of ['disabled', 'stored', 'failed'] as const) it(`R3/R4 ${mode} persists stopped connected groups and journal once; evidence ${evidence}`, async () => {
      const directory = await mkdtemp(join(tmpdir(), 'loop-corrections-')); directories.push(directory);
      const storage = new FileContextStorage({ agentId: 'stopped', baseDirectory: directory });
      const scope = { ownerId: 'host', namespace: 'stopped' }; const evidenceStorage = new InMemoryEvidenceStorage({ scope });
      const put = evidence === 'failed' ? vi.spyOn(evidenceStorage, 'put').mockRejectedValue(Error('OFFLINE')) : undefined;
      const write = vi.fn(async () => ({ receipt: 'FILE_RAW_42' }));
      const ctx = { ...context, agentId: 'stopped', userId: 'host', storage, features: { ...context.features, evidence: evidence !== 'disabled' }, plugins: { evidence: { storage: evidenceStorage } } };
      const frames = [call('submitted', { id: 'EXACT_ARGUMENT' }), ...(mode === 'run' ? [{ text: '{"message":"Stopped"}' }] : [])];
      const { agent } = fixture(frames, [tool(write)], {}, { maxIterations: 1, userId: 'host', context: ctx });
      let outcome!: ToolExecutionOutcome;
      agent.tools.on('tool:outcome', value => { outcome = value; });
      if (mode === 'run') await agent.run('ORIGINAL_PERSISTED_INPUT', { responseFormat: { type: 'json_object' } }); else await execute(mode, agent);
      expect(agent.context.getCurrentInput()).toHaveLength(0);
      await agent.saveSession('checkpoint');
      const entries = await storage.journal.read('checkpoint', { limit: 100 });
      const content = entries.flatMap(e => e.item.type === 'message' ? e.item.content : []);
      expect(content.filter(b => b.type === ContentType.TOOL_USE)).toHaveLength(1);
      expect(content.filter(b => b.type === ContentType.TOOL_RESULT)).toHaveLength(1);
      if (mode === 'run') expect(JSON.stringify(entries).match(/ORIGINAL_PERSISTED_INPUT/g)).toHaveLength(1);
      const restored = fixture([{ text: 'Continue' }], [tool(write)], null, { userId: 'host', context: ctx });
      expect(await restored.agent.loadSession('checkpoint')).toBe(true); expect(restored.agent.getLoopDiagnostics()).toBeUndefined();
      await restored.agent.run('Resume');
      expect(JSON.stringify(restored.provider.requests[0]!.input)).toContain('FILE_RAW_42');
      expect(JSON.stringify(restored.provider.requests[0]!.input)).toContain('EXACT_ARGUMENT');
      if (evidence === 'failed') {
        const retained = blocks(restored.agent).find(b => b.type === ContentType.TOOL_RESULT);
        expect(retained?.type === ContentType.TOOL_RESULT && retained.evidence?.status).toBe('storage_failed');
        put!.mockRestore();
        if (retained?.type !== ContentType.TOOL_RESULT) throw Error('Missing retained result');
        const receipt = await new ToolEvidenceMiddleware({ storage: evidenceStorage }).record(tool(write), { id: 'EXACT_ARGUMENT' }, { userId: 'host' }, outcome, { value: { receipt: 'FILE_RAW_42' } });
        expect(await restored.agent.context.acknowledgeToolEvidence('submitted', receipt.reference!)).toBe(1);
      }
      expect(write).toHaveBeenCalledTimes(1);
    });
    it(`R5 ${mode} invokes prototype completion with its private host receiver`, async () => {
      class Policy implements AgentLoopPolicy {
        maxRecoveryAttempts = 0; #calls = 0;
        get calls() { return this.#calls; }
        completion() { this.#calls++; return { complete: false, reason: 'Artifact absent' }; }
      }
      const policy = new Policy(); const { agent } = fixture([{ text: 'Premature completion' }], [], policy);
      expect((await execute(mode, agent))?.reason).toBe('recovery_exhausted'); expect(policy.calls).toBe(1);
    });
    it(`R5 ${mode} binds inherited progress and snapshots callbacks/options`, async () => {
      class Parent { #progressCalls = 0; progressKey() { this.#progressCalls++; return 'fixed'; } get calls() { return this.#progressCalls; } }
      class Policy extends Parent implements AgentLoopPolicy { maxStalledIterations = 1; maxRecoveryAttempts = 0; }
      const policy = new Policy(), write = vi.fn(async () => 'read');
      const { agent, provider } = fixture([call('one', { page: 1 }), call('two', { page: 2 })], [tool(write, 'read')], policy);
      const generate = provider.generate.bind(provider);
      vi.spyOn(provider, 'generate').mockImplementation(async options => { policy.maxStalledIterations = 10; policy.progressKey = () => 'mutated'; return generate(options); });
      expect((await execute(mode, agent))?.reason).toBe('recovery_exhausted');
      expect(policy.calls).toBe(2); expect(write).toHaveBeenCalledTimes(2); expect(provider.requests).toHaveLength(2);
    });
    for (const kind of ['own', 'arrow', 'bound'] as const) it(`R5 ${mode} supports ${kind} host callbacks`, async () => {
      const policy = { checks: 0, completion() { this.checks++; return { complete: false }; }, maxRecoveryAttempts: 0 };
      if (kind === 'arrow') policy.completion = () => { policy.checks++; return { complete: false }; };
      if (kind === 'bound') policy.completion = policy.completion.bind(policy);
      const { agent } = fixture([{ text: 'Unchecked candidate' }], [], policy);
      expect((await execute(mode, agent))?.reason).toBe('recovery_exhausted'); expect(policy.checks).toBe(1);
    });
  }
});
