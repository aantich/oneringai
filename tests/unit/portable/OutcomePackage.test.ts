import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentPackageOutcomeServer, createAgentPackageOutcomeTools, hydrateAgentPackageWithOutcomes, exportAgentPackage, InMemoryEvidenceStorage, Connector, Agent, hydrateAgentPackage, createOutcomeTool, ContentType, MessageRole, StreamEventType } from '@/index.js';
import type { RemoteOutcomeTransport, OutcomeExecuteRequest, AgentPackageOutcomeServerOptions, ToolFunction, EvidenceStorageOptions } from '@/index.js';
import { fixture, answer } from '../core/routing/fixture.js';
import { outcomeToolFingerprint } from '@/portable/outcomeWire.js';
const agents: Agent[] = [], servers: AgentPackageOutcomeServer[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map(s => s.close())); agents.splice(0).forEach(a => a.destroy()); Connector.clear(); });
const storage = (namespace: string) => new InMemoryEvidenceStorage({ scope: { ownerId: 'owner', namespace }, maxReadChars: 1024 });
async function setup(result: unknown = { success: false, reason: 'business declined' }, options: Partial<AgentPackageOutcomeServerOptions> = {}, sourceTool?: ToolFunction, localLimits: Partial<EvidenceStorageOptions> = {}) {
  const source = fixture(); agents.push(source.agent);
  const execute = vi.fn(async () => result);
  source.agent.tools.register(sourceTool ?? { definition: { type: 'function', function: { name: 'remote', parameters: { type: 'object', properties: {}, additionalProperties: false } } }, output: { effect: 'write' }, execute });
  const pkg = exportAgentPackage(source.agent, { toolPlacement: name => name === 'remote' ? 'remote' : 'omit' });
  const serverStorage = storage('server'), localStorage = new InMemoryEvidenceStorage({ scope: { ownerId: 'owner', namespace: 'client' }, maxReadChars: 1024, ...localLimits }), authorize = vi.fn(async (_access: any) => true);
  const server = new AgentPackageOutcomeServer(source.agent, pkg, { storage: serverStorage, authorize, maxReadChars: 1024, ...options }); servers.push(server);
  const transport: RemoteOutcomeTransport = { negotiate: r => server.negotiate(r, {}), execute: r => server.execute(r, {}), getReceipt: r => server.getReceipt(r, {}), cancel: r => server.cancel(r, {}), readEvidence: r => server.readEvidence(r, {}) };
  const receiver = fixture(); agents.push(receiver.agent);
  const hydration = { connector: receiver.name, model: 'main', transport, permissions: { defaultScope: 'always' as const }, contextFactory: () => ({ model: 'main', features: { workingMemory: false, inContextMemory: false, evidence: true }, plugins: { evidence: { storage: localStorage } } }) };
  const pair = await hydrateAgentPackageWithOutcomes(server.package(), hydration); agents.push(pair.agent);
  return { ...pair, source, receiver, server, pkg, execute, transport, localStorage, serverStorage, authorize, hydration };
}
describe('negotiated portable tool outcomes', () => {
  it.each([false, 0, { value: null }, { success: false, reason: 'business declined' }])('preserves complete raw business data %j and separate authentic proxy/source IDs', async result => {
    const f = await setup(result), report = await f.agent.tools.executeWithOutcome('remote', {}, { callId: 'call', runId: 'local-run' });
    expect(report.result).toEqual(result); expect(report.outcome.status).toBe('succeeded');
    const observation = f.session.inspect()[0]!; expect(observation.pendingSource).toBe(false); expect(observation.receipt?.serverOutcome?.status).toBe('succeeded');
    expect(observation.receipt?.serverOutcome?.executionId).not.toBe(report.outcome.executionId); expect(observation.proxyOutcome?.runId).toBe('local-run');
    expect((await f.localStorage.readRecord(observation.reference!))?.result).toMatchObject({ kind: 'oneringai.remote-observation/1', payload: { hasResult: true, result } }); expect(f.execute).toHaveBeenCalledTimes(1);
  });
  it('retrieves an entire oversized result in integrity-checked chunks instead of truncating it', async () => {
    const raw = { items: Array.from({ length: 600 }, (_, id) => ({ id, text: `item-${id}` })) }, f = await setup(raw, { maxInlineBytes: 0, maxReadChars: 1024 });
    const read = vi.spyOn(f.transport, 'readEvidence'); expect(await f.agent.tools.execute('remote', {})).toEqual(raw); expect(read.mock.calls.length).toBeGreaterThan(10); expect(f.session.inspect()[0]?.pendingSource).toBe(false);
  });
  it('deduplicates a stable request and denies changed contracts and stale source epochs without repeating writes', async () => {
    const f = await setup(); let request!: OutcomeExecuteRequest; const real = f.transport.execute; f.transport.execute = async r => { request = r; return real(r); };
    await f.agent.tools.execute('remote', {}); expect((await f.server.execute(request, {})).hasResult).toBe(true); expect(f.execute).toHaveBeenCalledTimes(1);
    await expect(f.server.execute({ ...request, toolFingerprint: 'b'.repeat(64) }, {})).rejects.toThrow(/already used/);
    expect((await f.server.execute({ ...request, sessionId: 'different-epoch' }, {})).receipt.state).toBe('unknown'); expect(f.execute).toHaveBeenCalledTimes(1);
    const n = await f.transport.negotiate({ protocol: 'oneringai.tool-outcomes/1', packageId: f.pkg.packageId }); expect(request.toolFingerprint).toBe(outcomeToolFingerprint(n.tools[0]!.definitionFingerprint, 'write'));
  });
  it('rechecks host authorization for cached receipts, cancellation and every source read', async () => {
    let allowed = true; const f = await setup({}, { authorize: async () => allowed }); await f.agent.tools.execute('remote', {}); const op = f.session.inspect()[0]!;
    allowed = false; await expect(f.session.getReceipt(op.operationId)).rejects.toThrow(/access denied/); await expect(f.session.cancel(op.operationId)).rejects.toThrow(/access denied/); await expect(f.session.readEvidence(op.receipt!.source!)).rejects.toThrow(/access denied/); expect(f.execute).toHaveBeenCalledTimes(1);
  });
  it('retains an interrupted write barrier until explicit source reconciliation without resubmitting', async () => {
    const f = await setup(); const real = f.transport.execute; f.transport.execute = async r => { await real(r); throw new Error('response disconnected after commit'); };
    expect((await f.agent.tools.executeWithOutcome('remote', {}, { callId: 'call' })).outcome).toMatchObject({ status: 'failed', error: expect.stringMatching(/disconnected/) }); const op = f.session.inspect()[0]!;
    await expect(f.agent.run('submit again')).rejects.toThrow(/reconciliation/); expect(f.receiver.primary.generate).not.toHaveBeenCalled();
    const recovered = await f.session.getReceipt(op.operationId); expect(recovered.pendingSource).toBe(false); expect(recovered.proxyOutcome?.status).toBe('failed'); expect(recovered.receipt?.serverOutcome?.status).toBe('succeeded'); expect(f.execute).toHaveBeenCalledTimes(1);
    expect(await f.agent.run('inspect repaired state')).toBeDefined();
  });
  it('stores no action when admission proof cannot be acknowledged', async () => {
    const f = await setup(); vi.spyOn(f.localStorage, 'put').mockRejectedValue(new Error('offline')); expect((await f.agent.tools.executeWithOutcome('remote', {})).outcome).toMatchObject({ status: 'failed', error: expect.stringMatching(/no action submitted/) }); expect(f.execute).not.toHaveBeenCalled();
  });
  it('restores acknowledged observations from scoped backend proof, rejects mutable checkpoint forgery and old-loader downgrade', async () => {
    const f = await setup(); await f.agent.tools.execute('remote', {}, { callId: 'call' }); const checkpoint = f.session.checkpoint();
    const restored = await hydrateAgentPackageWithOutcomes(checkpoint, f.hydration); agents.push(restored.agent); expect(restored.session.inspect()[0]?.pendingSource).toBe(false); expect(f.execute).toHaveBeenCalledTimes(1);
    checkpoint.checkpoint!.operations[0]!.argumentsFingerprint = 'f'.repeat(64); await expect(hydrateAgentPackageWithOutcomes(checkpoint, f.hydration)).rejects.toThrow(/proof differs/);
    await expect(hydrateAgentPackage(checkpoint as any, f.hydration)).rejects.toThrow();
  });
  it('creates tools before Agent construction with one shared manager and rejects a mismatched evidence backend', async () => {
    const f = await setup(), local = storage('factory'), tools = await createAgentPackageOutcomeTools(f.server.package(), { transport: f.transport, storage: local });
    const child = fixture({ tools: tools.tools, context: { model: 'main', features: { evidence: true }, plugins: { evidence: { storage: local } } } }); agents.push(child.agent);
    expect(child.agent.tools).toBe(child.agent.context.tools); expect(await child.agent.tools.execute('remote', {})).toEqual({ success: false, reason: 'business declined' }); expect(tools.session.checkpoint(child.agent).checkpoint?.operations).toHaveLength(1);
    expect(() => fixture({ tools: tools.tools })).toThrow(/owns one/);
  });
  it('uses invocation-owned operational failure while preserving its raw remote result', async () => {
    const raw = { ok: true, application: 'unchanged' };
    const f = await setup(raw, {}, createOutcomeTool({ definition: { type: 'function', function: { name: 'remote' } }, output: { effect: 'write' }, execute: async (_args, invocation) => { invocation.reportFailure(new Error('operational source failure')); return raw; } }));
    const result = await f.agent.tools.executeWithOutcome('remote', {}); expect(result.result).toEqual(raw); expect(result.outcome.status).toBe('failed'); expect(f.session.inspect()[0]?.receipt?.serverOutcome?.status).toBe('failed');
  });
  it('retains failed server storage sources for explicit host repair without repeating the write', async () => {
    const f = await setup(), put = f.serverStorage.put.bind(f.serverStorage); vi.spyOn(f.serverStorage, 'put').mockRejectedValue(new Error('storage unavailable'));
    await f.agent.tools.execute('remote', {}); const op = f.session.inspect()[0]!, retained = f.server.readRetainedSource(op.operationId)!; expect(retained).toBeDefined(); expect(f.execute).toHaveBeenCalledTimes(1);
    vi.mocked(f.serverStorage.put).mockImplementation(put); const reference = await put(retained); await f.server.acknowledgeSource(op.operationId, reference); expect(f.server.readRetainedSource(op.operationId)).toBeUndefined(); expect((await f.session.getReceipt(op.operationId)).receipt?.source).toEqual(reference); expect(f.execute).toHaveBeenCalledTimes(1);
  });
  it('rejects a tool replacement during async authorization before dispatching either executable', async () => {
    const f = await setup(), replacement = vi.fn(async () => 'replaced'); let once = false;
    f.authorize.mockImplementation(async (access: any) => { if (access.operation === 'execute' && !once) { once = true; f.source.agent.tools.register({ definition: { type: 'function', function: { name: 'remote' } }, output: { effect: 'write' }, execute: replacement }); } return true; });
    const result = await f.agent.tools.executeWithOutcome('remote', {}); expect(result.outcome.status).toBe('failed'); expect(f.session.inspect()[0]?.receipt?.admission).toBe('not_started'); expect(f.execute).not.toHaveBeenCalled(); expect(replacement).not.toHaveBeenCalled();
  });
  it('rejects foreign package evidence and forged chunk content before acknowledging it', async () => {
    const f = await setup({ big: 'x'.repeat(5000) }, { maxInlineBytes: 0 }), read = f.transport.readEvidence;
    f.transport.readEvidence = async (request, options) => { const response = await read(request, options); if (response.chunk?.text) response.chunk.text = response.chunk.text.replace('x', 'y'); return response; };
    const result = await f.agent.tools.executeWithOutcome('remote', {}); expect(result.outcome.status).toBe('failed'); expect(f.session.inspect()[0]?.pendingSource).toBe(true); expect(f.execute).toHaveBeenCalledTimes(1);
    const foreign = await f.serverStorage.put({ version: 1, recordedAt: 1, source: { toolName: 'other', executionId: 'other', arguments: {}, principal: {}, effect: 'read', status: 'succeeded', completion: 'settled', startedAt: 1, durationMs: 1 }, result: 'private other package' });
    await expect(f.server.readEvidence({ protocol: 'oneringai.tool-outcomes/1', packageId: f.pkg.packageId, sessionId: f.session.inspect()[0]!.sessionId, reference: foreign }, {})).rejects.toThrow(/outside/);
  });
  it('keeps source cancellation pending until raw work settles and records the late source with original identity', async () => {
    let finish!: () => void; const action = vi.fn(async () => { await new Promise<void>(resolve => { finish = resolve; }); return { committed: 'original' }; });
    const f = await setup({}, {}, { definition: { type: 'function', function: { name: 'remote' } }, output: { effect: 'write' }, execute: action });
    const pending = f.agent.tools.executeWithOutcome('remote', {}, { callId: 'cancel-call' }); await vi.waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    const op = f.session.inspect()[0]!; await f.session.cancel(op.operationId); const proxy = await pending; expect(proxy.outcome.status).toBe('failed'); expect(f.session.inspect()[0]?.receipt?.serverOutcome?.completion).toBe('unknown');
    finish(); await vi.waitFor(async () => expect((await f.session.getReceipt(op.operationId)).pendingSource).toBe(false));
    const settled = f.session.inspect()[0]!; expect(settled.receipt?.serverOutcome?.callId).toBe(op.operationId); expect(settled.receipt?.serverOutcome?.status).toBe('succeeded'); expect(action).toHaveBeenCalledTimes(1);
  });
  it('enforces bounded admission without evicting old request identity', async () => {
    const f = await setup({}, { maxRequests: 1 }); await f.agent.tools.execute('remote', {}); const before = f.session.inspect();
    await expect(f.agent.tools.executeWithOutcome('remote', {})).rejects.toThrow(/capacity/); expect(f.execute).toHaveBeenCalledTimes(1); expect(f.session.inspect()).toEqual(before);
  });

  it.each(['run', 'stream'] as const)('%s stops an uncertain write before the next model call even without loop policy, then repairs retained context', async mode => {
    const f = await setup(), real = f.transport.execute;
    f.transport.execute = async request => { await real(request); throw new Error('disconnected after commit'); };
    f.receiver.primary.generate.mockImplementation(async options => ({ ...answer(options, ''), output: [{ type: 'message', role: MessageRole.ASSISTANT, content: [{ type: ContentType.TOOL_USE, id: 'actual-model-call', name: 'remote', arguments: '{}' }] }] }));
    f.receiver.primary.provider.streamGenerate.mockImplementation(async function* () {
      yield { type: StreamEventType.TOOL_CALL_START, response_id: 'call', item_id: 'item', tool_call_id: 'actual-model-call', tool_name: 'remote', sequence_number: 1 };
      yield { type: StreamEventType.TOOL_CALL_ARGUMENTS_DONE, response_id: 'call', tool_call_id: 'actual-model-call', tool_name: 'remote', arguments: '{}' };
      yield { type: StreamEventType.RESPONSE_COMPLETE, response_id: 'call', status: 'completed', usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 }, iterations: 1 };
    });
    if (mode === 'run') await expect(f.agent.run('do one action')).rejects.toThrow(/reconciliation/);
    else await expect((async () => { for await (const _event of f.agent.stream('do one action')) { /* consume */ } })()).rejects.toThrow(/reconciliation/);
    expect(f.execute).toHaveBeenCalledTimes(1); expect(mode === 'run' ? f.receiver.primary.generate.mock.calls.length : f.receiver.primary.provider.streamGenerate.mock.calls.length).toBe(1);
    const op = f.session.inspect()[0]!; expect((await f.session.getReceipt(op.operationId)).pendingSource).toBe(false); expect(f.execute).toHaveBeenCalledTimes(1);
  });

  it('restores an interrupted proxy receipt and repairs it from remote source proof without inventing proxy success', async () => {
    const f = await setup(), execute = f.transport.execute; f.transport.execute = async request => { await execute(request); throw new Error('response lost'); };
    await f.agent.tools.execute('remote', {}, { callId: 'persisted-call' }); const checkpoint = f.session.checkpoint(); expect(checkpoint.checkpoint!.operations[0]!.proxyReceipt).toBeDefined();
    const loaded = await hydrateAgentPackageWithOutcomes(checkpoint, f.hydration); agents.push(loaded.agent); expect(loaded.session.inspect()[0]?.pendingSource).toBe(true);
    const repaired = await loaded.session.getReceipt(loaded.session.inspect()[0]!.operationId); expect(repaired.pendingSource).toBe(false); expect(repaired.proxyOutcome?.status).toBe('failed'); expect(repaired.receipt?.serverOutcome?.status).toBe('succeeded'); expect(f.execute).toHaveBeenCalledTimes(1);
  });

  it('checks remote serialized byte capacity before accumulating multibyte chunks, then repairs without replay', async () => {
    const f = await setup({ quote: '界'.repeat(1200) }, { maxInlineBytes: 0 }), read = vi.spyOn(f.transport, 'readEvidence');
    const hint = vi.spyOn(f.localStorage, 'serializationLimitBytes', 'get').mockReturnValue(3000);
    const result = await f.agent.tools.executeWithOutcome('remote', {}, { callId: 'bounded-byte-recovery' }); expect(result.outcome.status).toBe('failed'); expect(read).toHaveBeenCalledTimes(1); expect(f.execute).toHaveBeenCalledTimes(1);
    hint.mockRestore(); const repaired = await f.session.getReceipt(f.session.inspect()[0]!.operationId); expect(repaired.pendingSource).toBe(false); expect(f.execute).toHaveBeenCalledTimes(1);
  });

  it.each(['return', 'throw'] as const)('keeps uninstrumented source writes unknown when a supported execution override may %s after committing', async mode => {
    const f = await setup(), writes = vi.fn(async () => { if (mode === 'throw') throw new Error('reply lost after commit'); return { committed: true }; });
    f.source.agent.tools.execute = writes;
    let original!: OutcomeExecuteRequest;
    const execute = f.transport.execute; f.transport.execute = request => { original = request; return execute(request); };
    await f.agent.tools.executeWithOutcome('remote', {}, { callId: 'override-call' });
    const op = f.session.inspect()[0]!;
    expect(writes).toHaveBeenCalledTimes(1); expect(op).toMatchObject({ state: 'unknown', pendingSource: true, receipt: { state: 'unknown', admission: 'unknown' } });
    expect(op.receipt?.serverOutcome).toBeUndefined();
    await expect(f.agent.run('retry the write')).rejects.toThrow(/reconciliation/);
    expect((await f.server.execute(original, {})).receipt.state).toBe('unknown');
    expect((await f.session.getReceipt(op.operationId)).pendingSource).toBe(true); expect(writes).toHaveBeenCalledTimes(1);
    expect(f.receiver.primary.generate).not.toHaveBeenCalled();
  });

  it('releases the borrowed source after a completion listener throws, preserving the close error and idempotency', async () => {
    const f = await setup(); await f.agent.tools.execute('remote', {});
    const error = new Error('completion observer failed'), listener = () => { throw error; };
    f.source.agent.on('execution:complete', listener);
    const closing = f.server.close();
    try {
      await expect(closing).rejects.toBe(error); expect(f.server.close()).toBe(closing);
      expect(f.source.agent.isRunning()).toBe(false); expect(f.source.agent.isDestroyed).toBe(false);
      f.source.agent.off('execution:complete', listener);
      expect((await f.source.agent.run('reuse borrowed source')).status).toBe('completed');
    } finally {
      f.source.agent.off('execution:complete', listener);
      // This test already asserted the intentionally rejected, fully settled close.
      servers.splice(servers.indexOf(f.server), 1);
    }
  });

  it('reuses acknowledged evidence through repeated and concurrent lookups at the exact two-record quota', async () => {
    const f = await setup({ full: 'unchanged source' }, {}, undefined, { maxRecords: 2 });
    await f.agent.tools.execute('remote', {}, { callId: 'poll-call' });
    const original = f.session.inspect()[0]!, put = vi.spyOn(f.localStorage, 'put'), reads = vi.spyOn(f.transport, 'readEvidence'), lookups = vi.spyOn(f.transport, 'getReceipt');
    for (let i = 0; i < 3; i++) expect((await f.session.getReceipt(original.operationId)).reference).toEqual(original.reference);
    const concurrent = await Promise.all(Array.from({ length: 8 }, () => f.session.getReceipt(original.operationId)));
    expect(concurrent.every(report => report.pendingSource === false && report.reference?.id === original.reference?.id)).toBe(true);
    expect(lookups).toHaveBeenCalledTimes(11); expect(put).not.toHaveBeenCalled(); expect(reads).not.toHaveBeenCalled(); expect(f.execute).toHaveBeenCalledTimes(1);
  });

  it('commits one repaired observation for concurrent lookups after a disconnected write at the three-record quota', async () => {
    const f = await setup({ accepted: true }, {}, undefined, { maxRecords: 3 }), execute = f.transport.execute;
    f.transport.execute = async request => { await execute(request); throw new Error('disconnected after commit'); };
    await f.agent.tools.execute('remote', {}, { callId: 'repair-poll-call' });
    const op = f.session.inspect()[0]!, put = vi.spyOn(f.localStorage, 'put');
    const reports = await Promise.all(Array.from({ length: 8 }, () => f.session.getReceipt(op.operationId)));
    expect(reports.every(report => !report.pendingSource && report.proxyOutcome?.status === 'failed')).toBe(true);
    expect(new Set(reports.map(report => report.reference?.id)).size).toBe(1); expect(put).toHaveBeenCalledTimes(1); expect(f.execute).toHaveBeenCalledTimes(1);
  });

  it('does not consume a queued lookup after its caller cancels or poison later receipt repair', async () => {
    const f = await setup(); await f.agent.tools.execute('remote', {}); const op = f.session.inspect()[0]!;
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }), original = f.transport.getReceipt;
    const lookup = vi.spyOn(f.transport, 'getReceipt').mockImplementationOnce(async request => { await gate; return original(request); });
    const first = f.session.getReceipt(op.operationId); await vi.waitFor(() => expect(lookup).toHaveBeenCalledTimes(1));
    const caller = new AbortController(), queued = f.session.getReceipt(op.operationId, { signal: caller.signal });
    caller.abort(new Error('cancel queued read')); await expect(queued).rejects.toThrow('cancel queued read');
    release(); await first; expect((await f.session.getReceipt(op.operationId)).pendingSource).toBe(false);
    expect(lookup).toHaveBeenCalledTimes(2); expect(f.execute).toHaveBeenCalledTimes(1);
  });

  it('repairs a removed local observation once and retains the write barrier if that repair fails', async () => {
    const f = await setup({ accepted: true }, {}, undefined, { maxRecords: 2 });
    await f.agent.tools.execute('remote', {}, { callId: 'missing-local-proof' }); const op = f.session.inspect()[0]!;
    await f.localStorage.delete(op.reference!);
    const put = vi.spyOn(f.localStorage, 'put').mockRejectedValueOnce(new Error('repair storage offline'));
    await expect(f.session.getReceipt(op.operationId)).rejects.toThrow('repair storage offline');
    expect(f.session.inspect()[0]!.pendingSource).toBe(true);
    await expect(f.agent.run('repeat action')).rejects.toThrow(/reconciliation/);
    const repaired = await f.session.getReceipt(op.operationId);
    expect(repaired.pendingSource).toBe(false); expect(repaired.reference?.id).not.toBe(op.reference!.id);
    expect(put).toHaveBeenCalledTimes(2); expect(f.execute).toHaveBeenCalledTimes(1);
  });

  it('reuses a committed proof when retained-context acknowledgement must be retried at the exact quota', async () => {
    const f = await setup({ accepted: true }, {}, undefined, { maxRecords: 3 }), execute = f.transport.execute;
    f.transport.execute = async request => { await execute(request); throw new Error('disconnected after commit'); };
    f.receiver.primary.generate.mockImplementation(async options => ({ ...answer(options, ''), output: [{ type: 'message', role: MessageRole.ASSISTANT,
      content: [{ type: ContentType.TOOL_USE, id: 'context-repair-call', name: 'remote', arguments: '{}' }] }] }));
    await expect(f.agent.run('submit once')).rejects.toThrow(/reconciliation/);
    const op = f.session.inspect()[0]!, put = vi.spyOn(f.localStorage, 'put');
    const acknowledge = vi.spyOn(f.agent.context, 'acknowledgeToolEvidence').mockRejectedValueOnce(new Error('context temporarily busy'));
    await expect(f.session.getReceipt(op.operationId)).rejects.toThrow('context temporarily busy');
    expect(f.session.inspect()[0]!.pendingSource).toBe(true);
    expect((await f.session.getReceipt(op.operationId)).pendingSource).toBe(false);
    expect(acknowledge).toHaveBeenCalledTimes(2); expect(put).toHaveBeenCalledTimes(1); expect(f.execute).toHaveBeenCalledTimes(1);
  });

});
