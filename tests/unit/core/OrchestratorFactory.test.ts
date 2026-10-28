import { afterEach, describe, expect, it, vi } from 'vitest';
import { Agent, AgentRegistry, Connector, ModelTask, Vendor, createOrchestratorWithFactory, createOrchestrator, ContentType, MessageRole } from '@/index.js';
import type { AgentConstructionRequest, OrchestratorFactoryOptions, OrchestratedAgentConfig, ChildObservation, ToolFunction, AgentResponse } from '@/index.js';
import { makeProvider, answer } from './routing/fixture.js';
import { InMemoryEvidenceStorage } from '@/infrastructure/storage/EvidenceStorage.js';
import { ToolEvidenceMiddleware } from '@/core/evidence/ToolEvidenceMiddleware.js';
import type { ToolResult } from '@/domain/entities/Tool.js';
import { AlgorithmicCompactionStrategy } from '@/core/context-nextgen/strategies/AlgorithmicCompactionStrategy.js';
import type { SharedWorkspacePluginNextGen } from '@/core/context-nextgen/plugins/SharedWorkspacePluginNextGen.js';
const roots: Agent[] = [], tasks: ModelTask[] = [];
const waitIdle = () => new Promise<void>(resolve => setImmediate(resolve));
afterEach(async () => { roots.splice(0).forEach(agent => agent.destroy()); await waitIdle(); tasks.splice(0).forEach(task => task.destroy()); Connector.clear(); });
function setup(overrides: Partial<OrchestratorFactoryOptions> = {}, config = {}) {
  const p = makeProvider(); Connector.create({ name: 'factory', vendor: Vendor.OpenAI, auth: { type: 'none' }, options: { provider: p.provider } });
  const seen: AgentConstructionRequest[] = [], observations: ChildObservation[] = [];
  const configureAgent = (request: AgentConstructionRequest): OrchestratedAgentConfig => { seen.push(request); return { ...request.baseline,
    emptyResponseRetry: { enabled: false }, modelExecution: { customProviderAttempts: 'single' }, asyncTools: { autoContinue: false },
    context: { model: request.baseline.model, responseReserve: 64, features: { workingMemory: false, inContextMemory: false } } }; };
  return { ...p, seen, observations, async create() { const root = await createOrchestratorWithFactory({ connector: 'factory', model: 'main', agentTypes: { worker: { model: 'worker', systemPrompt: 'Work' } }, ...config },
    { configureAgent, onChildOutcome: report => observations.push(report), ...overrides }); roots.push(root); return root; }, configureAgent };
}
const child = (root: Agent, name: string): Agent => { const value = AgentRegistry.getChildren(root.registryId).find(info => info.name === name); const agent = value; if (!(agent instanceof Agent)) throw new Error('Missing actual child'); return agent; };
const assign = (root: Agent, name = 'one', extra = {}) => root.tools.executeWithOutcome('assign_turn', { agent: name, type: 'worker', instruction: 'Work once', ...extra });
describe('complete factory orchestrator', () => {
  it('returns a normal Agent and composes one shared pipeline before the first host run', async () => {
    const f = setup(); const root = await f.create(); expect(root).toBeInstanceOf(Agent); expect(root.tools).toBe(root.context.tools); expect(f.seen).toHaveLength(1);
    expect(f.seen[0]).toMatchObject({ role: 'parent', name: 'orchestrator' }); expect(f.seen[0]).not.toHaveProperty('type'); expect(f.seen[0]!.baseline.tools).toBeUndefined();
    await assign(root); await waitIdle(); const worker = child(root, 'one'); expect(worker.context.getPlugin('shared_workspace')).toBe(root.context.getPlugin('shared_workspace'));
    expect(f.seen[1]).toMatchObject({ role: 'worker', name: 'one', type: 'worker' }); expect(worker.parentAgentId).toBe(root.registryId); expect(worker.tools).toBe(worker.context.tools);
  });
  it('retains existing workspace deltas when assigning a later worker turn', async () => {
    const f = setup(); const root = await f.create(); await assign(root); await waitIdle();
    await new Promise(resolve => setTimeout(resolve, 2)); const workspace = root.context.getPlugin<SharedWorkspacePluginNextGen>('shared_workspace')!;
    await workspace.storeSet('host-update', { summary: 'CONFIRMED_WORKSPACE_CHANGE', author: 'host' }); await assign(root); await waitIdle();
    expect(JSON.stringify(f.generate.mock.calls.at(-1)![0].input)).toContain('[Workspace changes since your last turn]'); expect(JSON.stringify(f.generate.mock.calls.at(-1)![0].input)).toContain('CONFIRMED_WORKSPACE_CHANGE');
  });
  it('forwards full returned root and worker request controls and host per-call overrides', async () => {
    const hook = vi.fn(); const f = setup({ configureAgent: request => ({ connector: 'factory', model: request.role === 'parent' ? 'root-choice' : 'worker-choice',
      instructions: `HOST ${request.role}`, temperature: 0, maxIterations: 3,
      thinking: { enabled: false }, vendorOptions: { hostMarker: request.role }, promptCache: { mode: 'off' },
      modelExecution: { customProviderAttempts: 'single', maxOutputTokensPerCall: 47 }, userId: `${request.role}-owner`, userRoles: ['host'],
      asyncTools: { autoContinue: false, batchWindowMs: 0 }, historyMode: 'full', toolExecutionTimeout: 0,
      context: { model: 'main', responseReserve: 0, maxContextTokens: 4000, features: { workingMemory: false, inContextMemory: false }, timeZone: 'Europe/Zurich' },
      lifecycleHooks: { beforeContextPrepare: hook } }) });
    const root = await f.create(); await root.run('root', { temperature: 0.2 }); await assign(root); await waitIdle();
    expect(f.generate.mock.calls.map(([options]) => [options.model, options.temperature, options.max_output_tokens, options.vendorOptions])).toEqual([
      ['root-choice', 0.2, 47, { hostMarker: 'parent' }], ['worker-choice', 0, 47, { hostMarker: 'worker' }]]);
    expect(root.lifecycleHooks.beforeContextPrepare).toBe(hook); expect(child(root, 'one').lifecycleHooks.beforeContextPrepare).toBe(hook);
    expect(root.context.userId).toBe('parent-owner'); expect(child(root, 'one').context.userId).toBe('worker-owner');
    expect(root.context.responseReserve).toBe(0);
    await root.tools.execute('delegate_interactive', { agent: 'one', monitoring: 'active' }); await root.run('delegated'); await waitIdle();
    expect(f.generate.mock.calls.at(-1)?.[0]).toMatchObject({ temperature: 0, thinking: { enabled: false }, vendorOptions: { hostMarker: 'parent' }, instructions: 'HOST parent' });
  });
  it('uses a complete result with ordinary omitted defaults and never inherits root provider/account controls', async () => {
    const f = setup({ configureAgent: request => request.role === 'parent'
      ? { ...request.baseline, temperature: 0.91, userId: 'root', identities: [], vendorOptions: { rootOnly: true }, context: { model: 'main', features: { workingMemory: false, inContextMemory: false } } }
      : { connector: request.baseline.connector, model: request.baseline.model, context: { model: 'main', features: { workingMemory: false, inContextMemory: false } } } });
    const root = await f.create(); await assign(root); await waitIdle(); const worker = child(root, 'one'); expect(worker.model).toBe('worker'); expect(worker.userId).toBeUndefined();
    expect(f.generate.mock.calls[0]![0].vendorOptions).toBeUndefined(); expect(f.generate.mock.calls[0]![0].temperature).not.toBe(0.91);
  });
  it('reserves a name and capacity before awaiting host lookup, then releases a rejected admission once', async () => {
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); let calls = 0;
    const f = setup({ configureAgent: async request => { if (request.role === 'worker') { calls++; await gate; if (calls === 1) throw new Error('lookup failed'); } return f.configureAgent(request); } }, { maxAgents: 1 });
    const root = await f.create(); const first = assign(root); await vi.waitFor(() => expect(calls).toBe(1));
    expect((await assign(root)).outcome.status).toBe('failed'); expect((await assign(root, 'two')).outcome.status).toBe('failed'); expect(calls).toBe(1);
    release(); expect((await first).outcome.status).toBe('failed'); expect((await assign(root, 'two')).outcome.status).toBe('succeeded'); await waitIdle(); expect(calls).toBe(2);
  });
  it('honors maxAgents zero and avoids both host lookup and model I/O', async () => {
    const f = setup({}, { maxAgents: 0 }); const root = await f.create(); expect((await assign(root)).outcome.status).toBe('failed'); expect(f.seen).toHaveLength(1); expect(f.generate).not.toHaveBeenCalled();
  });
  it('treats a zero child deadline as expired before lookup or provider dispatch', async () => {
    const f = setup(); const root = await f.create(); expect((await assign(root, 'expired', { timeout: 0 })).outcome.status).toBe('failed'); expect(f.seen).toHaveLength(1); expect(f.generate).not.toHaveBeenCalled();
  });
  it('invalidates an abandoned async configuration before its late result can construct an orphan', async () => {
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); let entered = false;
    const f = setup({ configureAgent: async request => { if (request.role === 'worker') { entered = true; await gate; } return f.configureAgent(request); } }); const root = await f.create();
    const pending = assign(root, 'late'); void pending.catch(() => {}); await vi.waitFor(() => expect(entered).toBe(true)); root.destroy(); release();
    await expect(pending).rejects.toThrow(/destroyed/); await waitIdle(); expect(AgentRegistry.getChildren(root.registryId)).toHaveLength(0); expect(f.generate).not.toHaveBeenCalled();
  });
  it('rejects duplicate live conversation and session IDs, without rejecting shared backends', async () => {
    const f = setup({ configureAgent: request => ({ ...f.configureAgent(request), context: { model: 'main', agentId: 'same-live-conversation', features: { workingMemory: false, inContextMemory: false } } }) });
    const root = await f.create(); const result = await assign(root); expect(result.outcome.status).toBe('failed'); expect(JSON.stringify(result.result)).toContain('distinct conversation'); expect(AgentRegistry.getChildren(root.registryId)).toHaveLength(0);
  });
  it('reserves an explicit session ID before the parent performs its first lazy session load', async () => {
    const backend = { save: vi.fn(), load: vi.fn(async () => null), delete: vi.fn(), exists: vi.fn(async () => false), list: vi.fn(async () => []) };
    const f = setup({ configureAgent: request => ({ ...f.configureAgent(request), session: { storage: backend, id: 'one-live-session', autoSave: false } }) });
    const root = await f.create(); expect((await assign(root)).outcome.status).toBe('failed'); expect(f.generate).not.toHaveBeenCalled(); expect(AgentRegistry.getChildren(root.registryId)).toHaveLength(0);
  });
  it('does not force a ledger because a custom non-native strategy has an unrelated config bag', async () => {
    const strategy = new AlgorithmicCompactionStrategy(); Object.defineProperty(strategy, 'config', { value: { hostSpecific: true } });
    const f = setup({ configureAgent: request => { const { modelExecution: _ignored, ...ordinary } = f.configureAgent(request); return { ...ordinary, context: { ...ordinary.context!, compactionStrategy: strategy } }; } });
    const root = await f.create(); expect((await assign(root)).outcome.status).toBe('succeeded'); await waitIdle(); expect(f.observations[0]?.accounting).toBe('independent'); expect(f.observations[0]?.modelTaskId).toBeUndefined(); expect(f.generate).toHaveBeenCalledTimes(1);
  });
  it('keeps host-rejected child completion separate from settled execution', async () => {
    const f = setup({ configureAgent: request => ({ ...f.configureAgent(request), ...(request.role === 'worker' ? { loopPolicy: { maxRecoveryAttempts: 0, completion: () => ({ complete: false, reason: 'Missing confirmed business evidence' }) } } : {}) }) });
    const root = await f.create(); await assign(root); await waitIdle(); expect(f.observations[0]?.state).toBe('settled'); expect(f.observations[0]?.response?.loop?.completion?.complete).toBe(false); expect(f.observations[0]?.response?.loop?.reason).toBe('recovery_exhausted');
  });
  it('preserves exact host instructions during autoDescribe and accounts that creation call separately', async () => {
    const descriptionTask = new ModelTask(); tasks.push(descriptionTask); const f = setup({ descriptionExecution: { modelTask: descriptionTask }, configureAgent: request => ({ ...f.configureAgent(request), instructions: 'HOST PROMPT' }) }, { autoDescribe: true });
    f.generate.mockImplementation(async options => answer(options, '{"worker":{"description":"new description"}}')); const root = await f.create(); expect(root.context.systemPrompt).toBe('HOST PROMPT'); expect(descriptionTask.snapshot().totals.calls).toBe(1);
    const task = new ModelTask(); tasks.push(task); await root.run('later', { modelTask: task }); expect(task.snapshot().totals.calls).toBe(1); expect(descriptionTask.snapshot().totals.calls).toBe(1);
  });
  it('isolates rejected sync/async outcome observers and retains negative business output as successful data', async () => {
    const f = setup({ onChildOutcome: () => Promise.reject(new Error('diagnostic only')) }); f.generate.mockImplementation(async options => answer(options, '{"success":false,"business":"not approved"}'));
    const root = await f.create(); const result = await assign(root); expect(result.outcome.status).toBe('succeeded'); expect(JSON.stringify(result.result)).toContain('not approved'); await waitIdle(); expect(f.generate).toHaveBeenCalledTimes(1);
  });
  it('keeps timed-out raw provider work quarantined and reports its original IDs on late settlement', async () => {
    const f = setup(); let release!: () => void; f.generate.mockImplementation(async options => { await new Promise<void>(resolve => { release = resolve; }); return answer(options); });
    const root = await f.create(); const pending = assign(root, 'slow', { timeout: 0.025 }); await vi.waitFor(() => expect(f.generate).toHaveBeenCalled());
    expect((await pending).outcome.status).toBe('failed'); const again = await assign(root, 'slow'); expect(again.outcome.status).toBe('failed'); expect(f.generate).toHaveBeenCalledTimes(1);
    const first = f.observations[0]!; expect(first.state).toBe('timed_out'); release(); await vi.waitFor(() => expect(f.observations.some(report => report.late)).toBe(true));
    const last = f.observations.at(-1)!; expect(last.parentExecutionId).toBe(first.parentExecutionId); expect(last.childExecutionId).toBe(first.childExecutionId); expect(last.invocationIds).toHaveLength(1);
  });
  it('binds concurrent children admitted by a real parent turn to its task, then restores async delivery to that task after a later turn', async () => {
    const f = setup(); let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); let parents = 0;
    f.generate.mockImplementation(async options => { if (options.model === 'worker') { await gate; return answer(options, 'child done'); }
      if (++parents === 1) return { ...answer(options, ''), output: [{ type: 'message', role: MessageRole.ASSISTANT, content: [{ type: ContentType.TOOL_USE, id: 'child-call', name: 'assign_turn', arguments: JSON.stringify({ agent: 'one', type: 'worker', instruction: 'once' }) }] }] };
      return answer(options); });
    const root = await f.create(); const first = new ModelTask(), second = new ModelTask(); tasks.push(first, second);
    await root.run('start', { modelTask: first }); await vi.waitFor(() => expect(f.generate.mock.calls.some(([options]) => options.model === 'worker')).toBe(true));
    await root.run('later', { modelTask: second }); expect(second.snapshot().totals.calls).toBe(1); release(); await vi.waitFor(() => expect(root.hasPendingAsyncTools()).toBe(false));
    await root.continueWithAsyncResults(); expect(first.snapshot().totals.calls).toBe(4); expect(second.snapshot().totals.calls).toBe(1);
    await waitIdle(); expect(f.observations.at(-1)?.accounting).toBe('shared'); expect(f.observations.at(-1)?.modelTaskId).toBe(first.id); expect(first.signal.aborted).toBe(false);
    expect(first.snapshot().invocations.filter(record => record.model === 'worker').map(record => record.parentInvocationId)).toEqual([f.observations.at(-1)?.childExecutionId]);
    await expect(root.continueWithAsyncResults()).rejects.toThrow(/No async/);
  });
  it.each(['run', 'stream'] as const)('accounts delegated %s and active monitor calls on the current operation only', async mode => {
    const f = setup(); f.generate.mockImplementation(async options => answer(options, options.model === 'main' ? 'continue' : 'delegated'));
    const root = await f.create(); expect((await root.tools.executeWithOutcome('delegate_interactive', { agent: 'specialist', type: 'worker', monitoring: 'active' })).outcome.status).toBe('succeeded');
    const first = new ModelTask(), second = new ModelTask(); tasks.push(first, second);
    for (const task of [first, second]) { if (mode === 'run') await root.run('next', { modelTask: task }); else for await (const _event of root.stream('next', { modelTask: task })) { /* consume */ } await waitIdle(); }
    expect(first.snapshot().totals.calls).toBe(2); expect(second.snapshot().totals.calls).toBe(2); expect(f.observations).toHaveLength(2); expect(f.observations[0]?.parentExecutionId).not.toBe(f.observations[1]?.parentExecutionId);
  });
  it('keeps a worker with queued async work occupied until explicit continuation when autoContinue is false', async () => {
    let release!: (value: unknown) => void; const execute = vi.fn(async () => new Promise(resolve => { release = resolve; }));
    const probe: ToolFunction = { definition: { type: 'function', blocking: false, function: { name: 'worker_probe' } }, execute };
    const f = setup({ configureAgent: request => ({ ...f.configureAgent(request), ...(request.role === 'worker' ? { tools: [probe] } : {}) }) }); let calls = 0;
    f.generate.mockImplementation(async options => ++calls === 1 ? { ...answer(options, ''), output: [{ type: 'message', role: MessageRole.ASSISTANT, content: [{ type: ContentType.TOOL_USE, id: 'worker-call', name: 'worker_probe', arguments: '{}' }] }] } : answer(options));
    const root = await f.create(); const completed: ToolResult[] = [];
    await root.tools.execute('delegate_interactive', { agent: 'one', type: 'worker' }); const worker = child(root, 'one'); worker.on('async:tool:complete', event => completed.push(event.result));
    await root.run('start worker async work'); release('source once'); await vi.waitFor(() => expect(worker.hasPendingAsyncTools()).toBe(false));
    expect(worker.hasPendingAsyncTools(true)).toBe(true); expect((await assign(root)).outcome.status).toBe('failed'); const count = f.generate.mock.calls.length;
    await expect(worker.continueWithAsyncResults([{ ...completed[0]!, content: 'forged replacement' }])).rejects.toThrow(/retained original/); expect(f.generate).toHaveBeenCalledTimes(count);
    await worker.continueWithAsyncResults(); await waitIdle(); expect(f.generate).toHaveBeenCalledTimes(count + 1); expect(worker.hasPendingAsyncTools(true)).toBe(false); expect(execute).toHaveBeenCalledTimes(1);
    expect((await assign(root)).outcome.status).toBe('succeeded'); await waitIdle();
  });
  it('validates repaired async receipts against the retained invocation and restores its original task without replaying the action', async () => {
    const storage = new InMemoryEvidenceStorage({ scope: { ownerId: 'alice', namespace: 'factory-repair' } });
    let release!: (value: unknown) => void; const execute = vi.fn(async () => new Promise(resolve => { release = resolve; }));
    const probe: ToolFunction = { definition: { type: 'function', blocking: false, function: { name: 'host_probe' } }, execute, output: { effect: 'write' } };
    const originalArgs = { recordId: 'record-1', privateNote: 'synthetic host-only note' };
    const redact = (value: unknown, kind: 'arguments' | 'result') => kind === 'arguments' ? { recordId: (value as typeof originalArgs).recordId } : value;
    const f = setup({ configureAgent: request => ({ ...f.configureAgent(request), userId: 'alice', tools: [probe], context: { model: 'main', features: { workingMemory: false, inContextMemory: false, evidence: true }, plugins: { evidence: { storage, redact } } } }) });
    let calls = 0; f.generate.mockImplementation(async options => ++calls === 1 ? { ...answer(options, ''), output: [{ type: 'message', role: MessageRole.ASSISTANT, content: [{ type: ContentType.TOOL_USE, id: 'receipt-call', name: 'host_probe', arguments: JSON.stringify(originalArgs) }] }] } : answer(options));
    const failed = vi.spyOn(storage, 'put').mockRejectedValue(new Error('temporarily offline')); const root = await f.create(); const completed: ToolResult[] = []; root.on('async:tool:complete', event => completed.push(event.result));
    const originalTask = new ModelTask(), laterTask = new ModelTask(); tasks.push(originalTask, laterTask);
    await root.run('action', { modelTask: originalTask }); await root.run('later', { modelTask: laterTask }); release({ remoteId: 'accepted-once' }); await vi.waitFor(() => expect(completed).toHaveLength(1));
    await expect(root.continueWithAsyncResults()).rejects.toThrow(/unacknowledged/); const retained = completed[0]!; failed.mockRestore();
    const middleware = new ToolEvidenceMiddleware({ storage, redact }); const receipt = await middleware.record(probe, originalArgs, { userId: 'alice' }, retained.outcome!, { value: retained.content });
    const foreign = await middleware.record(probe, originalArgs, { userId: 'alice' }, { ...retained.outcome!, executionId: 'foreign-execution' }, { value: retained.content });
    expect((await storage.readRecord(receipt.reference!))?.source.arguments).toEqual({ recordId: 'record-1' });
    const before = f.generate.mock.calls.length;
    await expect(root.continueWithAsyncResults([{ ...retained, outcome: undefined, evidence: foreign }])).rejects.toThrow(/original invocation/); expect(f.generate).toHaveBeenCalledTimes(before);
    await root.continueWithAsyncResults([{ ...retained, outcome: undefined, evidence: receipt }]); expect(f.generate).toHaveBeenCalledTimes(before + 1); expect(originalTask.snapshot().totals.calls).toBe(3); expect(laterTask.snapshot().totals.calls).toBe(1); expect(execute).toHaveBeenCalledTimes(1);
    await expect(root.continueWithAsyncResults([retained])).rejects.toThrow(/retained original/);
  });
  it('retains a late unstored worker source through parent destruction until the host archives and acknowledges it', async () => {
    const storage = new InMemoryEvidenceStorage({ scope: { ownerId: 'alice', namespace: 'late-worker' } });
    let release!: (value: unknown) => void; const execute = vi.fn(async () => new Promise(resolve => { release = resolve; }));
    const raw = { remoteId: 'LATE_ACCEPTED_ONCE', body: 'full allowed source' };
    const probe: ToolFunction = { definition: { type: 'function', function: { name: 'late_probe' } }, execute, output: { effect: 'write' } };
    const f = setup({ configureAgent: request => request.role === 'parent' ? f.configureAgent(request) : { ...f.configureAgent(request), userId: 'alice', tools: [probe],
      context: { model: 'worker', features: { workingMemory: false, inContextMemory: false, evidence: true }, plugins: { evidence: { storage } } } } });
    let calls = 0; f.generate.mockImplementation(async options => ++calls === 1 ? { ...answer(options, ''), output: [{ type: 'message', role: MessageRole.ASSISTANT, content: [{ type: ContentType.TOOL_USE, id: 'late-action', name: 'late_probe', arguments: '{}' }] }] } : answer(options));
    const root = await f.create(); const pending = assign(root, 'one', { timeout: 0.03 }); await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
    expect((await pending).outcome.status).toBe('failed'); const worker = child(root, 'one'); root.destroy(); expect(worker.isDestroyed).toBe(false);
    const failed = vi.spyOn(storage, 'put').mockRejectedValue(new Error('offline during late observation')); release(raw);
    await vi.waitFor(() => expect(JSON.stringify([...worker.context.getConversation(), ...worker.context.getCurrentInput()])).toContain('LATE_ACCEPTED_ONCE'));
    expect(worker.isDestroyed).toBe(false); expect(f.observations.some(report => report.late && report.state === 'uncertain')).toBe(true);
    failed.mockRestore(); const outcome = f.observations.flatMap(report => report.toolOutcomes ?? []).findLast(value => value.toolName === 'late_probe' && value.completion === 'settled')!;
    const receipt = await new ToolEvidenceMiddleware({ storage }).record(probe, {}, { userId: 'alice' }, outcome, { value: raw });
    expect(await worker.context.acknowledgeToolEvidence('late-action', receipt.reference!)).toBeGreaterThan(0); worker.destroy(); await waitIdle();
    expect(worker.isDestroyed).toBe(true); expect(execute).toHaveBeenCalledTimes(1); expect(AgentRegistry.getChildren(root.registryId)).toHaveLength(0);
  });
  it('keeps the legacy factory and its synchronous callback/tool DTO behavior available', async () => {
    const f = setup(); const root = await createOrchestrator({ connector: 'factory', model: 'main', agentTypes: { worker: { systemPrompt: 'old' } }, features: { workingMemory: false, inContextMemory: false } }); roots.push(root);
    expect(root.tools).toBe(root.context.tools); const result = await root.tools.executeWithOutcome('assign_turn', { agent: 'old', type: 'worker', instruction: 'old', autoDestroy: true });
    expect(result.result).toMatchObject({ success: true, agent: 'old', destroyed: true }); expect(f.seen).toHaveLength(0);
  });
});
