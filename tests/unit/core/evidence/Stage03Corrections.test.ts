import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ToolManager } from '@/core/ToolManager.js';
import { ToolEvidenceMiddleware } from '@/core/evidence/ToolEvidenceMiddleware.js';
import { EvidenceError, json } from '@/core/evidence/validation.js';
import { AgentContextNextGen } from '@/core/context-nextgen/AgentContextNextGen.js';
import { BasePluginNextGen } from '@/core/context-nextgen/BasePluginNextGen.js';
import { FileEvidenceStorage, InMemoryEvidenceStorage } from '@/infrastructure/storage/EvidenceStorage.js';
import type { EvidenceRecord } from '@/domain/interfaces/IEvidenceStorage.js';
import type { ToolFunction } from '@/domain/entities/Tool.js';
import type { IContextStorage } from '@/domain/interfaces/IContextStorage.js';

const scope = { ownerId: 'alice', namespace: 'corrections' };
const raw = { id: 'SOURCE_ONLY_COPY', body: 'source '.repeat(2000) };
const managers: ToolManager[] = [];
const contexts: AgentContextNextGen[] = [];
const directories: string[] = [];
afterEach(async () => { contexts.splice(0).forEach(c => c.destroy()); managers.splice(0).forEach(m => m.destroy()); await Promise.all(directories.splice(0).map(d => rm(d, { recursive: true, force: true }))); vi.restoreAllMocks(); });
function tool(execute: ToolFunction['execute'] = async () => raw): ToolFunction {
  return { definition: { type: 'function', function: { name: 'probe', parameters: { type: 'object', properties: {} } } }, execute, output: { effect: 'write', summarize: () => 'source ready' } };
}
function context(storage = new InMemoryEvidenceStorage({ scope }), sessions?: IContextStorage) {
  const c = AgentContextNextGen.create({ model: 'gpt-4o-mini', agentId: 'corrections', userId: 'alice', storage: sessions,
    features: { workingMemory: false, inContextMemory: false, evidence: true }, plugins: { evidence: { storage } } }); contexts.push(c); return c;
}
function record(result: unknown = raw): EvidenceRecord {
  return { version: 1, recordedAt: Date.now(), source: { toolName: 'probe', executionId: 'exec', callId: 'call', arguments: {}, principal: { userId: 'alice' }, effect: 'write', status: 'succeeded', completion: 'settled', startedAt: 1, durationMs: 1 }, result };
}
function addRetained(c: AgentContextNextGen, report: Awaited<ReturnType<ToolManager['executeWithOutcome']>>) {
  c.addUserMessage('query'); c.addAssistantResponse([{ type: 'message', role: 'assistant' as never, content: [{ type: 'tool_use' as never, id: 'call', name: 'probe', arguments: '{}' }] }]);
  c.addToolResults([{ tool_use_id: 'call', content: report.result, state: 'completed' as never, outcome: report.outcome, evidence: report.evidence }]);
}

describe('R2 result recovery requires an observation', () => {
  it.each(['receipt', 'wrong-tool'])('rejects %s recovery without releasing protection', async kind => {
    const storage = new InMemoryEvidenceStorage({ scope }); const c = context(storage); const probe = tool(); c.tools.register(probe);
    const put = vi.spyOn(storage, 'put').mockRejectedValueOnce(new Error('offline')); const report = await c.tools.executeWithOutcome('probe', {}, { callId: 'call' }); addRetained(c, report); put.mockRestore();
    const receipt = record(); receipt.source.executionId = report.outcome.executionId;
    if (kind === 'receipt') delete receipt.result; else receipt.source.toolName = 'another_tool';
    const reference = await storage.put(receipt); const before = JSON.stringify(c.getCurrentInput());
    await expect(c.acknowledgeToolEvidence('call', reference)).rejects.toThrow(); expect(JSON.stringify(c.getCurrentInput())).toBe(before);
    c.addAssistantResponse([]); await expect(c.rollover({ preserveRecentTurns: 0, summarize: async () => 'lossy' })).rejects.toThrow('unacknowledged');
  });
  it.each([null, { id: 'SOURCE_ONLY_COPY', body: '[HOST_REDACTED]' }])('permits explicit redacted recovery %j', async recovered => {
    const storage = new InMemoryEvidenceStorage({ scope }); const c = context(storage); const probe = tool(); c.tools.register(probe);
    const put = vi.spyOn(storage, 'put').mockRejectedValueOnce(new Error('offline')); const report = await c.tools.executeWithOutcome('probe', {}, { callId: 'call' }); addRetained(c, report); put.mockRestore();
    const recovery = await new ToolEvidenceMiddleware({ storage, redact: (value, kind) => kind === 'result' ? recovered : value }).record(probe, {}, { userId: 'alice' }, report.outcome, { value: report.result });
    expect(await c.acknowledgeToolEvidence('call', recovery.reference!)).toBe(1); expect(JSON.stringify(c.getCurrentInput())).toContain(raw.body);
    c.addAssistantResponse([]); expect((await c.rollover({ preserveRecentTurns: 0, summarize: async () => 'stored' })).performed).toBe(true);
    expect((await storage.readRecord(recovery.reference!))?.result).toEqual(recovered);
  });
});

describe('R3 cancellation settlement retains exact observations', () => {
  it.each([1, 3, 5, 7, 10])('records a returned value when cancellation races fulfillment at microtask %i', async depth => {
    const storage = new InMemoryEvidenceStorage({ scope }); const manager = new ToolManager({ toolExecutionTimeout: 0 }); managers.push(manager);
    manager.setToolContext({ userId: 'alice' }); manager.setEvidenceMiddleware(new ToolEvidenceMiddleware({ storage })); const controller = new AbortController();
    const later = (remaining: number): void => { if (!remaining) controller.abort(new DOMException('cancel', 'AbortError')); else queueMicrotask(() => later(remaining - 1)); };
    const execute = vi.fn(async () => { queueMicrotask(() => later(depth)); return raw; }); manager.register(tool(execute)); const observed = vi.fn(); const late = vi.fn(); manager.on('tool:late-complete', late);
    await manager.executeWithOutcome('probe', {}, { signal: controller.signal, callId: 'call', runId: 'run', onOutcome: observed }).catch(() => undefined);
    await vi.waitFor(async () => { const entries = (await storage.list()).entries; const records = await Promise.all(entries.map(e => storage.readRecord(e.reference))); expect(records.filter(r => r && Object.hasOwn(r, 'result'))).toHaveLength(1); });
    const records = await Promise.all((await storage.list()).entries.map(e => storage.readRecord(e.reference)));
    expect(records.find(r => r && Object.hasOwn(r, 'result'))).toMatchObject({ result: raw, source: { callId: 'call', runId: 'run' } });
    expect(execute).toHaveBeenCalledTimes(1); expect(observed).toHaveBeenCalledTimes(1); expect(late.mock.calls.length).toBeLessThanOrEqual(1); expect(manager.getRegistration('probe')!.metadata.usageCount).toBe(1);
  });
});

class MarkerPlugin extends BasePluginNextGen {
  readonly name = 'marker';
  getInstructions(): string { return ''; }
  async getContent(): Promise<null> { return null; }
  getContents(): unknown { return 'original'; }
  getState(): unknown { return 'original'; }
  restoreState = vi.fn();
}
describe('R4 invalid evidence snapshots fail before context mutation', () => {
  for (const mode of ['restore', 'load'] as const) {
    it.each(['missing-reference', 'invalid-reference', 'wrong-status', 'invalid-array', 'oversized-index', 'long-tool'])(`${mode} preflights %s`, async kind => {
      let storedState: ReturnType<AgentContextNextGen['getState']>;
      const sessions = { load: async () => ({ state: storedState }) } as unknown as IContextStorage;
      const c = context(undefined, sessions); const marker = new MarkerPlugin(); c.registerPlugin(marker); c.addUserMessage('original pending');
      const stable = () => { const s = c.getState(); return JSON.stringify({ conversation: s.conversation, systemPrompt: s.systemPrompt, pluginStates: s.pluginStates }); }; const before = stable(); const inputBefore = JSON.stringify(c.getCurrentInput());
      const receipt = { toolName: kind === 'long-tool' ? 'x'.repeat(257) : 'probe', status: kind === 'wrong-status' ? 'bogus' : 'succeeded', completion: 'settled', evidence: { status: 'stored', effect: 'write', ...(kind === 'invalid-reference' ? { reference: { version: 1, id: 'bad' } } : {}) } };
      storedState = structuredClone(c.getState()); storedState.conversation = [{ type: 'message', role: 'user' as never, content: [{ type: 'input_text' as never, text: 'REJECTED_CONTENT' }] }]; storedState.systemPrompt = 'REJECTED_PROMPT';
      storedState.pluginStates = { marker: 'replacement', evidence: { version: 1, scope, recent: kind === 'invalid-array' ? {} : kind === 'oversized-index' ? Array.from({ length: 101 }, () => receipt) : [receipt] } };
      if (mode === 'load') await expect(c.load('bad')).rejects.toThrow(); else expect(() => c.restoreState(storedState)).toThrow();
      expect(stable()).toBe(before); expect(JSON.stringify(c.getCurrentInput())).toBe(inputBefore); expect(marker.restoreState).not.toHaveBeenCalled();
    });
  }
});

describe('R6 serialization budgets bound expansion before allocation', () => {
  it('stops traversal of a small acyclic shared graph at the byte budget', () => {
    let visits = 0; let value: unknown = 'leaf';
    for (let i = 0; i < 18; i++) { const node = { left: value, right: value }; value = new Proxy(node, { ownKeys(target) { visits++; return Reflect.ownKeys(target); } }); }
    expect(() => json(value, 512)).toThrowError('Evidence capacity'); expect(visits).toBeLessThan(200);
  });
  it.each(['😀', '\ud800', '\n"\\', 'é中', 'plain'])('counts exact UTF-8/escape bytes for %j', value => {
    const expected = JSON.stringify({ value }); const bytes = Buffer.byteLength(expected);
    expect(json({ value }, bytes)).toBe(expected); expect(() => json({ value }, bytes - 1)).toThrowError('Evidence capacity');
  });
  it('keeps surrogate pairs intact across internal string chunks', () => {
    const value = 'x'.repeat(4095) + '😀' + '\ud800' + '\n'.repeat(4096); const expected = JSON.stringify(value);
    expect(json(value, Buffer.byteLength(expected))).toBe(expected);
  });
  for (const kind of ['memory', 'file'] as const) {
    it(`${kind} rejects expanded data before walking the full graph`, async () => {
      const directory = await mkdtemp(join(tmpdir(), 'oneringai-evidence-bounds-')); directories.push(directory);
      const storage = kind === 'memory' ? new InMemoryEvidenceStorage({ scope, maxRecordBytes: 512 }) : new FileEvidenceStorage({ scope, directory, maxRecordBytes: 512 });
      let visits = 0; let value: unknown = 'leaf'; for (let i = 0; i < 18; i++) value = new Proxy({ a: value, b: value }, { ownKeys(target) { visits++; return Reflect.ownKeys(target); } });
      await expect(storage.put(record(value))).rejects.toMatchObject({ code: 'capacity' }); expect(visits).toBeLessThan(200); expect((await storage.list()).entries).toHaveLength(0);
    });
    it(`${kind} checks busy admission before inspecting another payload and snapshots admitted data`, async () => {
      const directory = await mkdtemp(join(tmpdir(), 'oneringai-evidence-admission-')); directories.push(directory);
      const storage = kind === 'memory' ? new InMemoryEvidenceStorage({ scope, maxPendingWrites: 1 }) : new FileEvidenceStorage({ scope, directory, maxPendingWrites: 1 });
      const input = record({ id: 'original' }); const first = storage.put(input); input.result = 'caller mutation';
      const getter = vi.fn(); await expect(storage.put(record({ get value() { return getter(); } }))).rejects.toMatchObject({ code: 'busy' }); expect(getter).not.toHaveBeenCalled();
      expect((await storage.readRecord(await first))?.result).toEqual({ id: 'original' });
    });
  }
});

describe('serialization admission and legacy custom backend boundaries', () => {
  it.each(['arguments', 'result', 'redactor', 'envelope'])('bounds %s before a custom backend receives source data', async kind => {
    const backing = new InMemoryEvidenceStorage({ scope });
    const put = vi.fn(backing.put.bind(backing));
    const storage = { scope, durability: backing.durability, put, read: backing.read.bind(backing), readRecord: backing.readRecord.bind(backing), list: backing.list.bind(backing), delete: backing.delete.bind(backing), pruneExpired: backing.pruneExpired.bind(backing) };
    const manager = new ToolManager({ toolExecutionTimeout: 0 }); managers.push(manager); manager.setToolContext({ userId: 'alice' });
    manager.setEvidenceMiddleware(new ToolEvidenceMiddleware({ storage, maxSerializationBytes: 800,
      redact: (value, selected) => kind === 'redactor' && selected === 'result' ? 'x'.repeat(1000) : value }));
    const output = kind === 'result' ? 'x'.repeat(1000) : kind === 'envelope' ? 'x'.repeat(600) : { id: 'small' };
    const execute = vi.fn(async () => output); manager.register(tool(execute));
    const report = await manager.executeWithOutcome('probe', kind === 'arguments' ? { input: 'x'.repeat(1000) } : {});
    expect(report.result).toBe(output); expect(report.outcome.status).toBe('succeeded'); expect(report.evidence).toMatchObject({ status: 'storage_failed', errorCode: 'capacity' });
    expect(put).not.toHaveBeenCalled(); expect(execute).toHaveBeenCalledTimes(1);
  });
  it('keeps legacy custom stores without a capacity hint valid and supports explicit bounds', async () => {
    const backing = new InMemoryEvidenceStorage({ scope }); const put = vi.fn(backing.put.bind(backing));
    const storage = { scope, durability: backing.durability, put, read: backing.read.bind(backing), readRecord: backing.readRecord.bind(backing), list: backing.list.bind(backing), delete: backing.delete.bind(backing), pruneExpired: backing.pruneExpired.bind(backing) };
    const manager = new ToolManager({ toolExecutionTimeout: 0 }); managers.push(manager); manager.setToolContext({ userId: 'alice' }); manager.register(tool());
    manager.setEvidenceMiddleware(new ToolEvidenceMiddleware({ storage })); const report = await manager.executeWithOutcome('probe', {});
    expect(report.evidence?.status).toBe('stored'); expect((await backing.readRecord(report.evidence!.reference!))?.result).toEqual(raw);
  });
  it('allows an explicit larger source budget when host redaction reduces the final record', async () => {
    const storage = new InMemoryEvidenceStorage({ scope, maxRecordBytes: 1024 }); const manager = new ToolManager({ toolExecutionTimeout: 0 }); managers.push(manager); manager.setToolContext({ userId: 'alice' });
    manager.setEvidenceMiddleware(new ToolEvidenceMiddleware({ storage, maxSerializationBytes: 32000, redact: (value, kind) => kind === 'result' ? { id: 'source', detail: '[HOST_REDACTED]' } : value })); manager.register(tool());
    const report = await manager.executeWithOutcome('probe', {}); expect(report.result).toBe(raw); expect(report.evidence?.status).toBe('stored'); expect(report.evidence!.reference!.bytes).toBeLessThanOrEqual(1024);
    expect((await storage.readRecord(report.evidence!.reference!))?.result).toEqual({ id: 'source', detail: '[HOST_REDACTED]' });
  });
  it('includes integrity/scope wrapper overhead in exact byte admission and releases failed reservations', async () => {
    const input = record('😀\n"\\'); const baseline = new InMemoryEvidenceStorage({ scope }); const reference = await baseline.put(input);
    const exact = new InMemoryEvidenceStorage({ scope, maxRecordBytes: reference.bytes }); expect((await exact.put(input)).bytes).toBe(reference.bytes);
    const smaller = new InMemoryEvidenceStorage({ scope, maxRecordBytes: reference.bytes - 1, maxPendingWrites: 1 }); await expect(smaller.put(input)).rejects.toMatchObject({ code: 'capacity' });
    const shorter = record(null); await expect(smaller.put(shorter)).resolves.toBeDefined();
  });
  it('bounds wide source work without invoking values or toJSON', () => {
    const value = Object.fromEntries(Array.from({ length: 5000 }, (_, i) => [`k${i}`, i]));
    expect(() => json(value, 64)).toThrowError('Evidence capacity');
    const getter = vi.fn(); const accessor = Object.defineProperty({}, 'value', { get: getter, enumerable: true }); expect(() => json(accessor, 1024)).toThrow(); expect(getter).not.toHaveBeenCalled();
    const toJSON = vi.fn(); expect(() => json({ toJSON }, 1024)).toThrow(); expect(toJSON).not.toHaveBeenCalled();
  });
});

describe('settled cancellation observations and projection isolation', () => {
  it('persists null under a host normalizer extension after settled cancellation without projection', async () => {
    const storage = new InMemoryEvidenceStorage({ scope }); const manager = new ToolManager({ toolExecutionTimeout: 0 }); managers.push(manager); const controller = new AbortController(); manager.setToolContext({ userId: 'alice' });
    manager.setEvidenceMiddleware(new ToolEvidenceMiddleware({ storage, projectThresholdBytes: 0 })); const summarize = vi.fn(() => 'null observed');
    manager.executionPipeline.use({ name: 'result-normalizer', priority: 0, afterExecute: async (_ctx, result) => result });
    const probe = tool(async () => { const cancel = (n: number): void => n ? queueMicrotask(() => cancel(n - 1)) : controller.abort(); queueMicrotask(() => cancel(5)); return null; }); probe.output!.summarize = summarize; manager.register(probe);
    const error = await manager.executeWithOutcome('probe', {}, { signal: controller.signal }).catch(e => e);
    expect(error.outcome).toMatchObject({ status: 'cancelled', completion: 'settled', evidence: { status: 'stored' } });
    expect((await storage.readRecord(error.outcome.evidence.reference))?.result).toBeNull(); expect(summarize).not.toHaveBeenCalled();
  });
  it('retains a late observation after manager destruction and never rebinds its owner', async () => {
    const storage = new InMemoryEvidenceStorage({ scope }); const manager = new ToolManager({ toolExecutionTimeout: 0 }); managers.push(manager); manager.setToolContext({ userId: 'alice' }); manager.setEvidenceMiddleware(new ToolEvidenceMiddleware({ storage }));
    let release!: (value: typeof raw) => void; let started!: () => void; const ready = new Promise<void>(resolve => { started = resolve; }); manager.register(tool(async () => { started(); return new Promise<typeof raw>(resolve => { release = resolve; }); }));
    const late = vi.fn(); manager.on('tool:late-complete', late); const call = manager.executeWithOutcome('probe', {}, { callId: 'destroyed-call' }).catch(e => e); await ready; manager.destroy(); await call; release(raw);
    await vi.waitFor(async () => { const records = await Promise.all((await storage.list()).entries.map(e => storage.readRecord(e.reference))); expect(records.find(r => r && Object.hasOwn(r, 'result'))).toMatchObject({ result: raw, source: { callId: 'destroyed-call', principal: { userId: 'alice' }, late: true } }); }); expect(late).not.toHaveBeenCalled();
  });
  it('invalidates a projection when a retained result changes before context admission', async () => {
    const storage = new InMemoryEvidenceStorage({ scope }); const c = context(storage); const own = structuredClone(raw); c.tools.register(tool(async () => own));
    const report = await c.tools.executeWithOutcome('probe', {}, { callId: 'call' }); own.id = 'CHANGED_AFTER_STORAGE'; addRetained(c, report);
    expect(JSON.stringify(c.getCurrentInput())).toContain('CHANGED_AFTER_STORAGE'); expect(JSON.stringify(c.getCurrentInput())).toContain(own.body);
  });
});

describe('recovery protocol and reentrant admission compatibility', () => {
  it('keeps function and custom call ID namespaces independent during recovery', async () => {
    const storage = new InMemoryEvidenceStorage({ scope }); const c = context(storage); const probe = tool(); c.tools.register(probe);
    const put = vi.spyOn(storage, 'put').mockRejectedValueOnce(new Error('offline')); const report = await c.tools.executeWithOutcome('probe', {}, { callId: 'call' }); addRetained(c, report); put.mockRestore();
    c.addInputItems([{ type: 'message', role: 'assistant' as never, content: [{ type: 'custom_tool_use' as never, id: 'call', name: 'other_namespace', input: '{}' }] }]);
    const recovery = await new ToolEvidenceMiddleware({ storage }).record(probe, {}, { userId: 'alice' }, report.outcome, { value: report.result });
    expect(await c.acknowledgeToolEvidence('call', recovery.reference!)).toBe(1);
  });
  it('releases only its own preparation reservation when source inspection reenters the store', async () => {
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    class GatedStore extends InMemoryEvidenceStorage { protected async writeBlob(id: string, bytes: Buffer): Promise<void> { await gate; return super.writeBlob(id, bytes); } }
    const storage = new GatedStore({ scope, maxPendingWrites: 2 }); let nested: ReturnType<typeof storage.put> | undefined;
    const value = new Proxy({}, { ownKeys() { nested ??= storage.put(record('nested')); throw new EvidenceError('invalid'); } });
    await expect(storage.put(record(value))).rejects.toMatchObject({ code: 'invalid' });
    const second = storage.put(record('second')); const third = storage.put(record('third')).catch(error => error); release();
    expect(await third).toMatchObject({ code: 'busy' }); await nested; await second; await expect(storage.put(record('subsequent'))).resolves.toBeDefined();
  });
});
