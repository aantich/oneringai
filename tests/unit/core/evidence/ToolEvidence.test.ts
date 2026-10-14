import type { IEvidenceStorage } from '@/domain/interfaces/IEvidenceStorage.js';
import { PluginRegistry } from '@/core/context-nextgen/PluginRegistry.js';
import { BasePluginNextGen } from '@/core/context-nextgen/BasePluginNextGen.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToolManager } from '@/core/ToolManager.js';
import { ToolEvidenceMiddleware } from '@/core/evidence/ToolEvidenceMiddleware.js';
import { InMemoryEvidenceStorage } from '@/infrastructure/storage/EvidenceStorage.js';
import { AgentContextNextGen } from '@/core/context-nextgen/AgentContextNextGen.js';
import { EvidencePluginNextGen } from '@/core/context-nextgen/plugins/EvidencePluginNextGen.js';
import { StorageRegistry } from '@/core/StorageRegistry.js';
import { PermissionPolicyManager } from '@/core/permissions/PermissionPolicyManager.js';
import type { ToolFunction, ToolExecutionOutcome } from '@/domain/entities/Tool.js';

const scope = { ownerId: 'alice', namespace: 'task' };
const raw = { status: 'complete', ids: ['s1', 's2'], detail: 'SOURCE'.repeat(3000) };
const managers: ToolManager[] = []; const contexts: AgentContextNextGen[] = [];
function tool(execute = vi.fn(async () => raw)): ToolFunction {
  return { definition: { type: 'function', function: { name: 'probe', parameters: { type: 'object', properties: {} } } }, execute,
    output: { expectedSize: 'large', effect: 'read', summarize: value => JSON.stringify({ status: (value as typeof raw).status, ids: (value as typeof raw).ids }) } };
}
function setup(extra = {}) {
  const storage = new InMemoryEvidenceStorage({ scope }); const manager = new ToolManager({ toolExecutionTimeout: 0 }); managers.push(manager);
  manager.setToolContext({ userId: 'alice', agentId: 'agent', accountId: 'work' });
  manager.setEvidenceMiddleware(new ToolEvidenceMiddleware({ storage, ...extra })); const probe = tool(); manager.register(probe);
  return { storage, manager, probe };
}
function context(extra = {}, limits: { responseReserve?: number; maxContextTokens?: number } = {}) { const c = AgentContextNextGen.create({ model: 'gpt-4o-mini', agentId: 'agent', userId: 'alice',
  features: { workingMemory: false, inContextMemory: false, evidence: true }, plugins: { evidence: { scope, ...extra } }, ...limits }); contexts.push(c); return c; }
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { resolve, promise }; }
afterEach(() => { contexts.splice(0).forEach(c => c.destroy()); managers.splice(0).forEach(m => m.destroy()); StorageRegistry.reset(); PluginRegistry._reset(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('post-settlement evidence middleware', () => {
  it('stores exact source and preserves raw returns while projecting status, IDs and correlation', async () => {
    const { storage, manager } = setup(); const observed = vi.fn(); const report = await manager.executeWithOutcome('probe', { q: 'A' }, { callId: 'call', runId: 'run', onEvidence: observed });
    expect(report.result).toBe(raw); expect(report.outcome).toMatchObject({ status: 'succeeded', evidence: { status: 'stored', effect: 'read' } });
    expect(report.outcome.evidence).not.toHaveProperty('projection'); expect(observed).toHaveBeenCalledWith(report.evidence);
    const projection = JSON.parse(report.evidence!.projection!); expect(projection).toMatchObject({ callId: 'call', status: 'succeeded' });
    expect(JSON.parse(projection.summary)).toEqual({ status: 'complete', ids: ['s1', 's2'] });
    const stored = await storage.readRecord(report.evidence!.reference!); expect(stored).toMatchObject({ result: raw, source: { arguments: { q: 'A' }, callId: 'call', runId: 'run', principal: { userId: 'alice', accountId: 'work' } } });
    expect((await manager.execute('probe', {}))).toBe(raw);
  });
  it('keeps disabled middleware silent and does not call summarizers or storage', async () => {
    const { manager, probe, storage } = setup(); const summarize = vi.spyOn(probe.output!, 'summarize'); const put = vi.spyOn(storage, 'put'); manager.setEvidenceMiddleware();
    const result = await manager.executeWithOutcome('probe', {}); expect(result.result).toBe(raw); expect(result).not.toHaveProperty('evidence'); expect(result.outcome).not.toHaveProperty('evidence');
    expect(put).not.toHaveBeenCalled(); expect(summarize).not.toHaveBeenCalled();
  });
  it.each(['throw', 'oversized', 'empty', 'promise', 'rejected-promise', 'rejected-thenable'])('isolates %s projection failure from successful external effects', async mode => {
    const { manager, storage, probe } = setup(); const execute = vi.fn(async () => raw); probe.execute = execute;
    probe.output!.summarize = (() => { if (mode === 'throw') throw new Error('SENSITIVE_ERROR'); if (mode === 'promise') return Promise.resolve('bad'); if (mode === 'rejected-promise') return Promise.reject(new Error('SENSITIVE_ASYNC_ERROR')); if (mode === 'rejected-thenable') return { then: (_resolve: unknown, reject: (error: Error) => void) => reject(new Error('SENSITIVE_THENABLE_ERROR')) }; return mode === 'empty' ? '' : 'x'.repeat(2001); }) as unknown as (v: unknown) => string;
    const report = await manager.executeWithOutcome('probe', {}); expect(report.result).toBe(raw); expect(report.outcome.status).toBe('succeeded'); expect(report.evidence?.status).toBe('projection_failed');
    expect(report.evidence?.projection).toBeUndefined(); expect(await storage.readRecord(report.evidence!.reference!)).toMatchObject({ result: raw }); expect(execute).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(report.outcome)).not.toContain('SENSITIVE_ERROR'); expect(manager.getRegistration('probe')?.metadata).toMatchObject({ successCount: 1, failureCount: 0 });
  });
  it('isolates failed acknowledgement after a real effect and never attempts a projection or retry', async () => {
    const { manager, storage, probe } = setup(); const execute = vi.fn(async () => { return raw; }); probe.execute = execute;
    vi.spyOn(storage, 'put').mockRejectedValue(new Error('sensitive backend credentials')); const summarize = vi.spyOn(probe.output!, 'summarize');
    const report = await manager.executeWithOutcome('probe', {}); expect(report.outcome.status).toBe('succeeded'); expect(report.evidence).toMatchObject({ status: 'storage_failed', errorCode: 'storage' });
    expect(report.result).toBe(raw); expect(report.evidence?.reference).toBeUndefined(); expect(summarize).not.toHaveBeenCalled(); expect(execute).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(report.outcome)).not.toContain('credentials');
  });
  it('does not allow malformed backend acknowledgements to authorize projection', async () => {
    const { manager, storage } = setup(); vi.spyOn(storage, 'put').mockResolvedValue(undefined!);
    const report = await manager.executeWithOutcome('probe', {}); expect(report.evidence?.status).toBe('storage_failed'); expect(report.evidence?.projection).toBeUndefined();
  });
  it('bounds stalled storage and never uses a late acknowledgement to replace raw data', async () => {
    vi.useFakeTimers(); const { manager, storage } = setup({ writeTimeoutMs: 10 }); const gate = deferred<never>(); vi.spyOn(storage, 'put').mockReturnValue(gate.promise);
    const work = manager.executeWithOutcome('probe', {}); await vi.advanceTimersByTimeAsync(10); const report = await work;
    expect(report.outcome.status).toBe('succeeded'); expect(report.evidence?.status).toBe('storage_failed'); expect(vi.getTimerCount()).toBe(0);
  });
  it('captures actual dispatched arguments before a tool mutates them and retains original trusted identity', async () => {
    const { manager, storage, probe } = setup(); const gate = deferred<typeof raw>();
    manager.executionPipeline.use({ name: 'adjust', beforeExecute: async () => ({ modifiedArgs: { actual: 7 } }) });
    probe.execute = async args => { args.actual = 99; return gate.promise; };
    const call = manager.executeWithOutcome('probe', { original: 1 }, { callId: 'old' }); await vi.waitFor(() => expect(manager.getRegistration('probe')?.metadata.usageCount).toBe(0));
    manager.setToolContext({ userId: 'bob' }); gate.resolve(raw); const report = await call;
    expect(await storage.readRecord(report.evidence!.reference!)).toMatchObject({ source: { arguments: { actual: 7 }, principal: { userId: 'alice' }, callId: 'old' } });
  });
  it('keeps admission-time output hints despite re-registration and mutation', async () => {
    const { manager, storage, probe } = setup(); const gate = deferred<typeof raw>(); probe.execute = async () => gate.promise;
    const call = manager.executeWithOutcome('probe', {}); probe.output!.effect = 'write'; probe.output!.summarize = () => 'WRONG'; manager.unregister('probe'); manager.register(tool());
    gate.resolve(raw); const report = await call; expect(report.evidence?.effect).toBe('read'); expect(report.evidence?.projection).not.toContain('WRONG'); expect((await storage.list()).entries).toHaveLength(1);
  });
  it('applies credential-key redaction and host policy without serializing connector capabilities', async () => {
    const { manager, storage, probe } = setup({ redact: (value: unknown) => typeof value === 'object' && value ? { ...value, privateContent: '[HIDDEN]' } : value });
    probe.execute = async () => ({ apiKey: 'secret-A', nested: { authorization: 'secret-B', access_token: 'secret-C' }, privateContent: 'PII' });
    const report = await manager.executeWithOutcome('probe', { password: 'secret-D', clientSecret: 'secret-E' }); const record = await storage.readRecord(report.evidence!.reference!);
    const content = JSON.stringify(record); for (const secret of ['secret-A', 'secret-B', 'secret-C', 'secret-D', 'secret-E', 'PII', 'connectorRegistry']) expect(content).not.toContain(secret);
    expect(content).toContain('[REDACTED]'); expect(content).toContain('[HIDDEN]');
  });
  it('retains raw nonserializable output without misreporting the effect', async () => {
    const { manager, probe } = setup(); const value = { cycle: {} as unknown }; value.cycle = value; probe.execute = async () => value;
    const report = await manager.executeWithOutcome('probe', {}); expect(report.result).toBe(value); expect(report.outcome.status).toBe('succeeded'); expect(report.evidence?.status).toBe('storage_failed');
  });
  it('does not infer semantic failure from business status=false and leaves unhinted/small results raw', async () => {
    const { manager, probe } = setup(); probe.execute = async () => ({ success: false }) as unknown as typeof raw;
    expect((await manager.executeWithOutcome('probe', {})).evidence?.projection).toBeUndefined();
    probe.execute = async () => raw; delete probe.output!.summarize;
    expect((await manager.executeWithOutcome('probe', {})).outcome.status).toBe('succeeded'); expect((await manager.executeWithOutcome('probe', {})).evidence?.projection).toBeUndefined();
  });
  it('isolates diagnostic observer failures and cannot let projector mutation change application results', async () => {
    const { manager, probe, storage } = setup(); probe.output!.summarize = value => { (value as typeof raw).ids.push('MUTATED'); return 'ok'; };
    const report = await manager.executeWithOutcome('probe', {}, { onEvidence: () => { throw new Error('observer'); } });
    expect(report.result.ids).toEqual(['s1', 's2']); expect((await storage.readRecord(report.evidence!.reference!))?.result).toEqual(raw);
  });
  it('records denied and normalized failure outcomes without claiming execution occurred', async () => {
    const { manager, storage } = setup(); const policies = new PermissionPolicyManager(); policies.blocklistAdd('probe'); manager.setPermissionManager(policies);
    const report = await manager.executeWithOutcome('probe', {}); const record = await storage.readRecord(report.evidence!.reference!);
    expect(record?.source).toMatchObject({ status: 'denied', completion: 'not_started' });
    manager.executionPipeline.remove('permission-enforcement'); manager.get('probe')!.execute = async () => { throw new Error('effect ambiguity'); };
    const failed = await manager.executeWithOutcome('probe', {}); expect(failed.outcome.status).toBe('failed'); expect((await storage.list()).entries).toHaveLength(2);
  });
  it('records unresolved cancellation and a separate late observation under original correlation without delivery', async () => {
    const { manager, storage, probe } = setup(); const gate = deferred<typeof raw>(); const started = deferred<void>(); probe.output!.effect = 'write'; probe.execute = async () => { started.resolve(); return gate.promise; };
    const host = new AbortController(); const initial: ToolExecutionOutcome[] = []; const late: ToolExecutionOutcome[] = []; const deliveries = vi.fn(); manager.on('tool:outcome', o => initial.push(o)); manager.on('tool:late-complete', o => late.push(o));
    const call = manager.execute('probe', {}, { signal: host.signal, callId: 'old-call', runId: 'old-run', onEvidence: deliveries }).catch(e => e); await started.promise; host.abort();
    const error = await call; expect(error.outcome).toMatchObject({ status: 'cancelled', completion: 'unknown', evidence: { status: 'stored' } });
    expect((await storage.readRecord(error.outcome.evidence.reference))?.source).toMatchObject({ completion: 'unknown', effect: 'write' });
    manager.setToolContext({ userId: 'other' }); gate.resolve(raw); await vi.waitFor(() => expect(late).toHaveLength(1));
    expect(late[0]).toMatchObject({ callId: 'old-call', runId: 'old-run', status: 'succeeded', completion: 'settled' });
    expect((await storage.readRecord(late[0]!.evidence!.reference!))?.source).toMatchObject({ principal: { userId: 'alice' }, late: true });
    expect(deliveries).toHaveBeenCalledTimes(1); expect(initial).toHaveLength(1); expect(manager.getRegistration('probe')?.metadata.usageCount).toBe(1);
  });
});

describe('context evidence plugin and compatibility', () => {
  it('resolves through StorageRegistry only when enabled, sharing the existing tool manager', async () => {
    const factory = vi.fn((s) => new InMemoryEvidenceStorage({ scope: s })); StorageRegistry.configure({ evidence: factory });
    const disabled = AgentContextNextGen.create({ model: 'gpt-4o-mini', features: { workingMemory: false, inContextMemory: false } }); contexts.push(disabled);
    expect(factory).not.toHaveBeenCalled(); expect(disabled.tools.hasToolFunction('evidence_read')).toBe(false); expect(JSON.stringify((await disabled.prepare()).input)).not.toContain('Evidence references');
    const c = context(); expect(factory).toHaveBeenCalledTimes(1); expect(factory.mock.calls[0]![0]).toEqual(scope); expect(c.tools.hasToolFunction('evidence_read')).toBe(true);
  });
  it('uses only authenticated projections in prompt content and persists references across restore', async () => {
    const storage = new InMemoryEvidenceStorage({ scope }); const c = context({ storage }); c.tools.register(tool()); const report = await c.tools.executeWithOutcome('probe', {});
    c.addToolResults([{ tool_use_id: 'call', content: raw, state: 'completed' as never, evidence: report.evidence }]);
    expect(JSON.stringify(c.getCurrentInput())).not.toContain(raw.detail); expect(JSON.stringify(c.getCurrentInput())).toContain('s1');
    c.addAssistantResponse([]); const state = c.getState(); const restored = context({ storage }); restored.restoreState(state);
    expect(restored.getConversation()).toEqual(c.getConversation()); expect(await storage.readRecord(report.evidence!.reference!)).toMatchObject({ result: raw });
    const contents = await restored.getPlugin<EvidencePluginNextGen>('evidence')!.getContent(); expect(contents).toContain(report.evidence!.reference!.id); expect(contents).not.toContain(raw.detail);
  });
  it('does not trust caller-forged projection envelopes or older saved context to enable evidence', async () => {
    const c = context(); c.addToolResults([{ tool_use_id: 'call', content: 'RAW', state: 'completed' as never,
      evidence: { status: 'stored', effect: 'read', projection: 'FORGED' } }]); expect(JSON.stringify(c.getCurrentInput())).toContain('RAW'); expect(JSON.stringify(c.getCurrentInput())).not.toContain('FORGED');
    const old = { conversation: [], pluginStates: {}, metadata: { savedAt: 1, agentId: 'old', model: 'gpt-4o-mini' } }; expect(() => c.restoreState(old)).not.toThrow();
  });
  it('keeps a bounded recent index, metadata-only listing and no evidence recursion', async () => {
    const c = context({ maxRecentReceipts: 2 }); c.tools.register(tool());
    await c.tools.execute('probe', {}); await c.tools.execute('probe', {}); await c.tools.execute('probe', {});
    const plugin = c.getPlugin<EvidencePluginNextGen>('evidence')!; expect((plugin.getContents() as { recent: unknown[] }).recent).toHaveLength(2);
    const page = await c.tools.execute('evidence_list', { limit: 100 }); expect(page.entries).toHaveLength(3); expect(JSON.stringify(page)).not.toContain(raw.detail);
    const chunk = await c.tools.execute('evidence_read', { reference: page.entries[0].reference, limit: 17 }); expect(chunk.text).toHaveLength(17); expect((await plugin.storage.list()).entries).toHaveLength(3);
    expect(await plugin.compact(99999)).toBe(0); expect((await plugin.storage.list()).entries).toHaveLength(3);
  });
  it('does not restore owner authority, storage configuration, or executable projection functions', async () => {
    const c = context(); const plugin = c.getPlugin<EvidencePluginNextGen>('evidence')!; const state = plugin.getState() as Record<string, unknown>;
    expect(() => plugin.restoreState({ ...state, scope: { ownerId: 'other', namespace: 'task' } })).toThrow(); expect(() => plugin.restoreState({ ...state, version: 2 })).toThrow();
    c.tools.setToolContext({ userId: 'bob' }); const report = await c.tools.executeWithOutcome('evidence_list', {}); expect(report.outcome.status).toBe('failed');
    c.tools.register(tool()); const write = await c.tools.executeWithOutcome('probe', {}); expect(write.evidence?.status).toBe('storage_failed'); expect(write.result).toBe(raw);
  });
  it('cleans diagnostic listeners and does not delete evidence on context destruction', async () => {
    const storage = new InMemoryEvidenceStorage({ scope }); const c = context({ storage }); c.tools.register(tool()); const report = await c.tools.executeWithOutcome('probe', {});
    c.destroy(); contexts.pop(); expect(await storage.readRecord(report.evidence!.reference!)).not.toBeNull(); expect(c.tools.listenerCount('tool:outcome')).toBe(0);
  });
});

describe('unacknowledged raw evidence is protected from context reduction', () => {
  it('keeps the whole tool pair during consolidation and refuses rollover until evidence is acknowledged', async () => {
    const c = context(); const plugin = c.getPlugin<EvidencePluginNextGen>('evidence')!; vi.spyOn(plugin.storage, 'put').mockRejectedValue(new Error('offline'));
    c.tools.register(tool()); c.addUserMessage('query');
    c.addAssistantResponse([{ type: 'message', role: 'assistant' as never, content: [{ type: 'tool_use' as never, id: 'call', name: 'probe', arguments: '{}' }] }]);
    const report = await c.tools.executeWithOutcome('probe', {});
    c.addToolResults([{ tool_use_id: 'call', content: raw, state: 'completed' as never, outcome: report.outcome, evidence: report.evidence }]);
    c.addAssistantResponse([]); const before = JSON.stringify(c.getConversation());
    await c.consolidate(); expect(JSON.stringify(c.getConversation())).toBe(before);
    await expect(c.prepare({ modelMaxContextTokens: 8192 })).rejects.toThrow();
    expect(JSON.stringify(c.getConversation())).toContain(raw.detail);
    await expect(c.rollover({ preserveRecentTurns: 0, summarize: async () => 'lossy summary' })).rejects.toThrow('unacknowledged tool evidence');
    const restored = context(); restored.restoreState(c.getState());
    await expect(restored.rollover({ preserveRecentTurns: 0, summarize: async () => 'lossy summary' })).rejects.toThrow('unacknowledged tool evidence');
  });
  it('refuses emergency truncation of unacknowledged current results and keeps the raw copy', async () => {
    const c = context({}, { responseReserve: 256 }); const storage = c.getPlugin<EvidencePluginNextGen>('evidence')!.storage; vi.spyOn(storage, 'put').mockRejectedValue(new Error('offline'));
    c.tools.register(tool()); c.addUserMessage('query'); c.addAssistantResponse([{ type: 'message', role: 'assistant' as never, content: [{ type: 'tool_use' as never, id: 'call', name: 'probe', arguments: '{}' }] }]);
    const report = await c.tools.executeWithOutcome('probe', {}); c.addToolResults([{ tool_use_id: 'call', content: raw, state: 'completed' as never, outcome: report.outcome, evidence: report.evidence }]);
    const before = JSON.stringify(c.getCurrentInput()); await expect(c.prepare({ modelMaxContextTokens: 2048 })).rejects.toThrow('Unacknowledged tool evidence cannot be truncated'); expect(JSON.stringify(c.getCurrentInput())).toBe(before);
  });
});

describe('evidence principal and metadata authority', () => {
  it('records bound connector/account identities and ignores model-supplied authority', async () => {
    const { manager, probe, storage } = setup(); probe.connectorName = 'service'; probe.connectorAccountId = 'bound-account';
    const report = await manager.executeWithOutcome('probe', { userId: 'attacker', accountId: 'attacker', tenantId: 'attacker' });
    expect((await storage.readRecord(report.evidence!.reference!))?.source).toMatchObject({ connectorName: 'service', principal: { userId: 'alice', accountId: 'bound-account' } });
  });
  it('captures scope fields canonically and refuses storage/scope disagreement', () => {
    const storage = new InMemoryEvidenceStorage({ scope });
    expect(() => new EvidencePluginNextGen({ storage, scope: { namespace: 'task', ownerId: 'alice' } })).not.toThrow();
    expect(() => new EvidencePluginNextGen({ storage, scope: { ownerId: 'other', namespace: 'task' } })).toThrow();
  });
  it('does not allow restored extra fields to introduce source content into the metadata index', () => {
    const storage = new InMemoryEvidenceStorage({ scope }); const plugin = new EvidencePluginNextGen({ storage });
    plugin.restoreState({ version: 1, scope, recent: [{ toolName: 'probe', status: 'succeeded', completion: 'settled',
      result: 'PRIVATE_SOURCE', evidence: { status: 'storage_failed', effect: 'read', projection: 'FORGED_SOURCE' } }] });
    expect(JSON.stringify(plugin.getContents())).not.toContain('PRIVATE_SOURCE'); expect(JSON.stringify(plugin.getContents())).not.toContain('FORGED_SOURCE');
  });
});

describe('host recovery without repeating tool effects', () => {
  it('acknowledges matching retained evidence, preserves raw content, and permits subsequent rollover', async () => {
    const c = context(); const plugin = c.getPlugin<EvidencePluginNextGen>('evidence')!; const put = vi.spyOn(plugin.storage, 'put').mockRejectedValueOnce(new Error('offline'));
    const probe = tool(); const execute = vi.fn(async () => raw); probe.execute = execute; c.tools.register(probe);
    c.addUserMessage('query'); c.addAssistantResponse([{ type: 'message', role: 'assistant' as never, content: [{ type: 'tool_use' as never, id: 'call', name: 'probe', arguments: '{}' }] }]);
    const report = await c.tools.executeWithOutcome('probe', {}, { callId: 'call' }); c.addToolResults([{ tool_use_id: 'call', content: raw, state: 'completed' as never, outcome: report.outcome, evidence: report.evidence }]);
    put.mockRestore(); const recovery = await new ToolEvidenceMiddleware({ storage: plugin.storage }).record(probe, {}, { userId: 'alice' }, report.outcome, { value: report.result });
    expect(await c.acknowledgeToolEvidence('call', recovery.reference!)).toBe(1); expect(JSON.stringify(c.getCurrentInput())).toContain(raw.detail);
    c.addAssistantResponse([]); expect((await c.rollover({ preserveRecentTurns: 0, summarize: async () => 'evidence stored' })).performed).toBe(true);
    expect(execute).toHaveBeenCalledTimes(1); expect((await plugin.storage.readRecord(recovery.reference!))?.result).toEqual(raw);
  });
  it('rejects unrelated invocation evidence and concurrent context changes', async () => {
    const c = context(); c.tools.register(tool()); const plugin = c.getPlugin<EvidencePluginNextGen>('evidence')!;
    const report = await c.tools.executeWithOutcome('probe', {}, { callId: 'another-call' });
    await expect(c.acknowledgeToolEvidence('missing', report.evidence!.reference!)).rejects.toThrow('does not match');
    const original = plugin.storage.readRecord.bind(plugin.storage); const gate = deferred<void>();
    vi.spyOn(plugin.storage, 'readRecord').mockImplementation(async ref => { await gate.promise; return original(ref); });
    const pending = c.acknowledgeToolEvidence('another-call', report.evidence!.reference!); c.addUserMessage('changed'); gate.resolve();
    await expect(pending).rejects.toThrow('Context changed');
  });
});

describe('projection and restored-index bounds', () => {
  it('caps the complete projection envelope without truncating call IDs or repeating an effect', async () => {
    const { manager, storage } = setup({ maxProjectionChars: 100 }); const report = await manager.executeWithOutcome('probe', {}, { callId: 'full-call-id' });
    expect(report.evidence?.status).toBe('projection_failed'); expect(report.evidence?.projection).toBeUndefined(); expect((await storage.readRecord(report.evidence!.reference!))?.source.callId).toBe('full-call-id');
  });
  it('restores a larger valid index under a smaller current limit', () => {
    const storage = new InMemoryEvidenceStorage({ scope }); const plugin = new EvidencePluginNextGen({ storage, maxRecentReceipts: 1 });
    plugin.restoreState({ version: 1, scope, recent: ['old', 'new'].map(toolName => ({ toolName, status: 'succeeded', completion: 'settled', evidence: { status: 'storage_failed', effect: 'read' } })) });
    expect(JSON.stringify(plugin.getContents())).not.toContain('old'); expect(JSON.stringify(plugin.getContents())).toContain('new');
  });
});


describe('pre-existing external evidence feature compatibility', () => {
  it('preserves the external factory, arbitrary configuration and tool/prompt contribution', async () => {
    class LegacyEvidence extends BasePluginNextGen {
      readonly name = 'legacy_evidence';
      getInstructions(): string { return 'LEGACY_PLUGIN_ACTIVE'; }
      async getContent(): Promise<string | null> { return null; }
      getContents(): unknown { return {}; }
      getTools(): ToolFunction[] { return [tool()]; }
    }
    const factory = vi.fn(() => new LegacyEvidence());
    PluginRegistry.register('legacy_evidence', factory, { featureKey: 'evidence' });
    const c = context({ storage: 'legacy-storage-name' });
    expect(factory).toHaveBeenCalledWith({ scope, storage: 'legacy-storage-name' }, expect.anything());
    expect(c.hasPlugin('legacy_evidence')).toBe(true); expect(c.tools.hasToolFunction('evidence_read')).toBe(false);
    expect(JSON.stringify((await c.prepare()).input)).toContain('LEGACY_PLUGIN_ACTIVE');
  });
});


describe('scoped model-facing evidence IDs', () => {
  it('supports ID reads, retains full-reference calls, and rejects ambiguous selectors', async () => {
    const c = context(); c.tools.register(tool()); const report = await c.tools.executeWithOutcome('probe', {}); const reference = report.evidence!.reference!;
    const byId = await c.tools.executeWithOutcome('evidence_read', { id: reference.id, limit: 512 }); expect(byId.outcome.status).toBe('succeeded');
    const byReference = await c.tools.execute('evidence_read', { reference, limit: 512 }); expect(byId.result.text).toBe(byReference.text);
    expect((await c.tools.executeWithOutcome('evidence_read', { id: reference.id, reference })).outcome.status).toBe('failed');
    expect((await c.tools.executeWithOutcome('evidence_read', {})).outcome.status).toBe('failed');
  });
  it('preserves custom stores without the optional ID lookup method through bounded metadata lookup', async () => {
    const underlying = new InMemoryEvidenceStorage({ scope }); const list = vi.spyOn(underlying, 'list');
    const storage: IEvidenceStorage = { scope, durability: 'process', put: underlying.put.bind(underlying), read: underlying.read.bind(underlying),
      readRecord: underlying.readRecord.bind(underlying), list: underlying.list.bind(underlying), delete: underlying.delete.bind(underlying), pruneExpired: underlying.pruneExpired.bind(underlying) };
    const c = context({ storage }); c.tools.register(tool()); const report = await c.tools.executeWithOutcome('probe', {});
    const read = await c.tools.executeWithOutcome('evidence_read', { id: report.evidence!.reference!.id, limit: 512 });
    expect(read.outcome.status).toBe('succeeded'); expect(list).toHaveBeenCalledWith({ after: undefined, limit: 100, signal: expect.anything() });
  });
});

describe('legacy backend ID lookup budget', () => {
  it('stops a backend that never finishes pagination without an unbounded read loop', async () => {
    const underlying = new InMemoryEvidenceStorage({ scope }); const list = vi.fn(async () => ({ entries: [], next: '00000000-0000-4000-8000-000000000000' }));
    const storage: IEvidenceStorage = { scope, durability: 'process', put: underlying.put.bind(underlying), read: underlying.read.bind(underlying),
      readRecord: underlying.readRecord.bind(underlying), list, delete: underlying.delete.bind(underlying), pruneExpired: underlying.pruneExpired.bind(underlying) };
    const c = context({ storage }); const result = await c.tools.executeWithOutcome('evidence_read', { id: '00000000-0000-4000-8000-000000000000' });
    expect(result.outcome.status).toBe('failed'); expect(result.result.error).toContain('Evidence capacity'); expect(list).toHaveBeenCalledTimes(10);
  });
});


describe('disabled evidence retains legacy plugin output-hint identity', () => {
  it('preserves existing host plugin mutation visibility to the selected tool', async () => {
    const { manager, probe } = setup(); manager.setEvidenceMiddleware();
    probe.execute = async () => probe.output!.expectedSize;
    manager.executionPipeline.use({ name: 'legacy-output-policy', beforeExecute: async ctx => {
      expect(ctx.tool.output).toBe(probe.output); ctx.tool.output!.expectedSize = 'small';
    } });
    expect(await manager.execute('probe', {})).toBe('small');
  });
});


describe('async host callback containment', () => {
  it.each(['resolve', 'reject'])('rejects asynchronous storage redaction (%s) without unhandled rejection or unredacted writes', async mode => {
    const { manager, storage } = setup({ redact: async () => { if (mode === 'reject') throw new Error('SENSITIVE_POLICY_ERROR'); return {}; } });
    const put = vi.spyOn(storage, 'put'); const report = await manager.executeWithOutcome('probe', {});
    expect(report.result).toBe(raw); expect(report.outcome.status).toBe('succeeded'); expect(report.evidence?.status).toBe('storage_failed'); expect(put).not.toHaveBeenCalled();
  });
  it('contains rejected asynchronous evidence observers after a successful effect', async () => {
    const { manager } = setup(); const report = await manager.executeWithOutcome('probe', {}, { onEvidence: async () => { throw new Error('OBSERVER_DISCONNECTED'); } });
    expect(report.result).toBe(raw); expect(report.outcome.status).toBe('succeeded'); expect(report.evidence?.status).toBe('stored');
  });
});


describe('redaction rejects accessors without invoking them', () => {
  it('does not read a then accessor while containing asynchronous policy errors', async () => {
    const getter = vi.fn(() => { throw new Error('ACCESSOR_MUST_NOT_RUN'); });
    const { manager, storage } = setup({ redact: () => ({ get then() { return getter(); } }) });
    const put = vi.spyOn(storage, 'put'); const result = await manager.executeWithOutcome('probe', {});
    expect(result.outcome.status).toBe('succeeded'); expect(result.evidence?.status).toBe('storage_failed'); expect(getter).not.toHaveBeenCalled(); expect(put).not.toHaveBeenCalled();
  });
});


describe('foreign evidence snapshots fail before conversation mutation', () => {
  it('retains the original conversation and pending input on a scope/version rejection', () => {
    const c = context(); c.addUserMessage('ORIGINAL_INPUT'); const before = JSON.stringify(c.getState()); const inputBefore = JSON.stringify(c.getCurrentInput());
    const foreign = c.getState(); foreign.conversation = [{ type: 'message', role: 'user' as never, content: [{ type: 'input_text' as never, text: 'FOREIGN_CONTENT' }] }];
    foreign.pluginStates.evidence = { version: 1, scope: { ownerId: 'other', namespace: 'task' }, recent: [] };
    expect(() => c.restoreState(foreign)).toThrow(); expect(JSON.stringify(c.getConversation())).not.toContain('FOREIGN_CONTENT'); expect(JSON.stringify(c.getCurrentInput())).toBe(inputBefore);
    expect(JSON.parse(before).conversation).toEqual(c.getConversation());
  });
});
