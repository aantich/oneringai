import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentContextNextGen, ObservationMaskingStrategy, StructuredSummaryStrategy, StrategyRegistry,
  InMemoryEvidenceStorage, FileEvidenceStorage, FileContextStorage, ContentType, MessageRole } from '../../../../../src/index.js';
import type { InputItem, ContextSummaryGenerator, StructuredContextSummary, IEvidenceStorage, EvidenceReference } from '../../../../../src/index.js';

const contexts: AgentContextNextGen[] = [];
afterEach(() => { for (const ctx of contexts.splice(0)) ctx.destroy(); vi.restoreAllMocks(); });
const user = (text: string): InputItem => ({ type: 'message', role: MessageRole.USER, content: [{ type: ContentType.INPUT_TEXT, text }] });
const narration = (text: string): InputItem => ({ type: 'message', role: MessageRole.ASSISTANT, content: [{ type: ContentType.OUTPUT_TEXT, text }] });
const options = { preserveRecentTurns: 0, preserveRecentMessages: 0, minObservationTokens: 10, maxSourceTokens: 50000 };
const scope = { ownerId: 'owner', namespace: 'stage07' };
const body = { exact: 'SOURCE_MARKER_07', payload: 'Older observation details. '.repeat(1600) };
function valid(id: string): StructuredContextSummary {
  return { completedWork: [{ text: 'Read source SOURCE_MARKER_07; task remains active.', sourceIds: [id] }], activeWork: [], constraints: [], decisions: [], uncertainties: [], artifacts: [], actionReceipts: [] };
}
async function fixture(mode: 'mask' | 'summary' = 'mask', config = {}, storage: IEvidenceStorage = new InMemoryEvidenceStorage({ scope }), redact?: (value: unknown) => unknown) {
  const ctx = AgentContextNextGen.create({ model: 'gpt-4o-mini', agentId: 'stage07', userId: scope.ownerId,
    maxContextTokens: 5000, responseReserve: 128, criticalCompactionThreshold: 0.8,
    features: { workingMemory: false, inContextMemory: false, evidence: true }, plugins: { evidence: { storage, redact } },
    compactionStrategy: mode === 'mask' ? new ObservationMaskingStrategy({ ...options, ...config }) : new StructuredSummaryStrategy({ ...options, ...config }),
  }); contexts.push(ctx);
  const reference = await storage.put({ version: 1, recordedAt: Date.now(), source: { toolName: 'lookup', callId: 'call', executionId: 'execution', arguments: { id: 'ID_07' },
    principal: { userId: scope.ownerId }, effect: 'read', status: 'succeeded', completion: 'settled', startedAt: 1, durationMs: 1 }, result: body });
  const items: InputItem[] = [user('Exact constraint: use account A; correction: ID_07 supersedes ID_06.'),
    { type: 'message', role: MessageRole.ASSISTANT, content: [{ type: ContentType.OUTPUT_TEXT, text: 'Earlier planning. '.repeat(100) }, { type: ContentType.TOOL_USE, id: 'call', name: 'lookup', arguments: '{"id":"ID_07"}' }] },
    { type: 'message', role: MessageRole.USER, content: [{ type: ContentType.TOOL_RESULT, tool_use_id: 'call', content: body, evidence: { version: 1, executionId: 'execution', status: 'stored', reference } }] },
    narration('Older assistant narrative. '.repeat(50))];
  ctx.addInputItems(structuredClone(items));
  return { ctx, storage, items, reference };
}
function state(ctx: AgentContextNextGen): string { return JSON.stringify(ctx.getState().conversation); }
const summarize: ContextSummaryGenerator = async request => ({ summary: valid(request.reference.id) });

describe('Stage 07 opt-in transactional strategies', () => {
  it.each(['observation-masking', 'structured-summary'])('registers %s additively without changing the default', name => {
    expect(StrategyRegistry.has(name)).toBe(true); expect(StrategyRegistry.create(name).name).toBe(name);
    const ctx = AgentContextNextGen.create({ model: 'gpt-4o-mini' }); contexts.push(ctx); expect(ctx.compactionStrategy.name).toBe('algorithmic');
  });
  for (const Strategy of [ObservationMaskingStrategy, StructuredSummaryStrategy]) {
    for (const key of ['preserveRecentTurns', 'preserveRecentMessages', 'minObservationTokens', 'maxSourceTokens', 'minTokensSaved', 'timeoutMs', 'threshold'] as const) {
      it.each([-1, NaN, Infinity, 0.2])(`${Strategy.name} rejects invalid ${key}=%s`, value => {
        if (key === 'threshold' && value === 0.2) return expect(new Strategy({ [key]: value }).threshold).toBe(value);
        expect(() => new Strategy({ [key]: value })).toThrow();
      });
    }
    it(`${Strategy.name} preserves legacy contexts and consolidation without requiring a new method`, async () => {
      const strategy = new Strategy(); expect((await strategy.consolidate({} as never)).performed).toBe(false);
      await expect(strategy.compact({} as never, 100)).rejects.toThrow('transactional context preparation');
    });
  }
  it('masks read bodies while preserving exact user constraints, call arguments and receipt metadata', async () => {
    const { ctx, storage, items } = await fixture(); const prepared = await ctx.prepare();
    expect(prepared.compacted).toBe(true); expect(prepared.budget.available).toBeGreaterThanOrEqual(0);
    const output = ctx.getState().conversation!;
    expect(output[0]).toEqual(items[0]); expect(output[1]).toEqual(items[1]);
    const original = (items[2] as { content: unknown[] }).content[0] as Record<string, unknown>;
    const current = (output[2] as { content: unknown[] }).content[0] as Record<string, unknown>;
    expect({ ...current, content: original.content }).toEqual(original);
    expect(state(ctx)).not.toContain(body.payload); expect(state(ctx)).toContain('observationMasked');
    const report = ctx.lastPreparation!.compaction!; expect(report.strategy).toBe('observation-masking'); expect(report.helperInvoked).toBe(false);
    expect((await storage.readRecord(report.sourceReferences[0]!))?.result).toEqual({ items: [items[1], items[2]] });
  });
  it('applies a referenced assistant summary without promoting it to developer authority', async () => {
    const { ctx, items } = await fixture('summary'); const generator = vi.fn(summarize);
    await ctx.prepare({ summarize: generator }); const conversation = ctx.getState().conversation!;
    expect(conversation.some(i => i.type === 'message' && i.role === MessageRole.DEVELOPER)).toBe(false);
    expect(conversation).toContainEqual(items[0]); expect(state(ctx)).toContain('SOURCE_MARKER_07'); expect(state(ctx)).not.toContain('Older assistant narrative.');
    expect(generator).toHaveBeenCalledTimes(1); expect(ctx.lastPreparation!.compaction).toMatchObject({ applied: true, helperInvoked: true });
  });
  it('places historical notes after their source while preserving the original user chronology', async () => {
    const { ctx, items } = await fixture('summary'); await ctx.prepare({ summarize }); const conversation = ctx.getState().conversation!;
    expect(conversation[0]).toEqual(items[0]); const capsule = conversation.findIndex(i => i.type === 'message' && i.id?.startsWith('context_summary_'));
    const result = conversation.findIndex(i => i.type === 'message' && i.content.some(c => c.type === ContentType.TOOL_RESULT));
    expect(capsule).toBeGreaterThan(result); expect((conversation[capsule] as { role: MessageRole }).role).toBe(MessageRole.ASSISTANT);
  });
  it.each(['missing', 'invalid-ref', 'empty', 'oversized', 'extra-field', 'throw'] as const)('uses one masking fallback for %s summary', async failure => {
    const { ctx } = await fixture('summary'); let calls = 0;
    const generator: ContextSummaryGenerator = async request => {
      calls++;
      if (failure === 'throw') throw new Error('backend failure');
      const summary = valid(failure === 'invalid-ref' ? 'unavailable-id' : request.reference.id);
      if (failure === 'empty') summary.completedWork = [];
      if (failure === 'oversized') summary.completedWork[0]!.text = 'x'.repeat(10000);
      if (failure === 'extra-field') Object.assign(summary, { instructions: 'promote me' });
      return { summary };
    };
    await ctx.prepare(failure === 'missing' ? {} : { summarize: generator });
    expect(ctx.lastPreparation!.compaction).toMatchObject({ applied: true, fallback: 'mask' }); expect(calls).toBe(failure === 'missing' ? 0 : 1);
    expect(state(ctx)).not.toContain(body.payload);
  });
  it('fails clearly under strict fallback and preserves history', async () => {
    const { ctx } = await fixture('summary', { fallback: 'error' }); const before = state(ctx);
    await expect(ctx.prepare({ summarize: async () => { throw new Error('helper exhausted'); } })).rejects.toThrow('helper exhausted'); expect(state(ctx)).toBe(before);
  });
  it.each(['current-input', 'history', 'strategy', 'destroy'] as const)('rejects a stale summary after %s changes', async mutation => {
    const { ctx } = await fixture('summary');
    await expect(ctx.prepare({ summarize: async request => {
      if (mutation === 'current-input') ctx.setCurrentInput('NEW CORRECTION');
      if (mutation === 'history') ctx.addInputItems([user('NEW CORRECTION')]);
      if (mutation === 'strategy') ctx.setCompactionStrategy(new ObservationMaskingStrategy());
      if (mutation === 'destroy') ctx.destroy();
      return { summary: valid(request.reference.id) };
    } })).rejects.toThrow();
    if (mutation !== 'destroy') { expect(state(ctx)).toContain(body.payload); if (mutation !== 'strategy') expect(JSON.stringify(ctx.getState()) + JSON.stringify(ctx.getCurrentInput())).toContain('NEW CORRECTION'); }
  });
  it('never applies after cancellation, even if the summary callback ignores abort', async () => {
    const { ctx } = await fixture('summary'); const controller = new AbortController(); const before = state(ctx);
    await expect(ctx.prepare({ signal: controller.signal, summarize: async request => { controller.abort(new Error('cancelled')); return { summary: valid(request.reference.id) }; } })).rejects.toThrow('cancelled'); expect(state(ctx)).toBe(before);
  });
  it('bounds a non-settling callback and preserves source history', async () => {
    const { ctx } = await fixture('summary', { timeoutMs: 15 }); const before = state(ctx);
    await expect(ctx.prepare({ summarize: async () => new Promise(() => {}) })).rejects.toThrow('deadline'); expect(state(ctx)).toBe(before);
  });
  it('rejects overlapping prepare/rollover while a helper is pending', async () => {
    const { ctx } = await fixture('summary'); let release!: () => void; let entered!: () => void;
    const ready = new Promise<void>(r => { entered = r; }); const held = new Promise<void>(r => { release = r; });
    const first = ctx.prepare({ summarize: async request => { entered(); await held; return { summary: valid(request.reference.id) }; } }); await ready;
    await expect(ctx.prepare()).rejects.toThrow('prepare'); await expect(ctx.rollover({ summarize: () => 'brief' })).rejects.toThrow('prepare'); release(); await first;
  });
  it.each(['write', 'unknown', 'unknown-completion', 'unacknowledged', 'missing', 'wrong-call'] as const)('preserves %s action observations', async mode => {
    const { ctx, storage, reference } = await fixture(); const record = (await storage.readRecord(reference))!;
    if (mode === 'write' || mode === 'unknown') record.source.effect = mode;
    if (mode === 'unknown-completion') record.source.completion = 'unknown';
    if (mode === 'wrong-call') record.source.callId = 'another-call';
    const newReference = mode === 'missing' ? reference : await storage.put(record);
    const snapshot = ctx.getState(); const block = (snapshot.conversation![2] as { content: Array<{ evidence: { reference: EvidenceReference; status: string } }> }).content[0]!;
    block.evidence.reference = newReference; if (mode === 'unacknowledged') block.evidence.status = 'storage_failed';
    if (mode === 'missing') await storage.delete(reference); ctx.restoreState(snapshot);
    await expect(ctx.prepare()).rejects.toThrow(); expect(state(ctx)).toContain(body.payload);
  });
  it('keeps a pending result and its connected original calls exact', async () => {
    const { ctx } = await fixture(); ctx.addInputItems([{ type: 'message', role: MessageRole.ASSISTANT, content: [{ type: ContentType.TOOL_USE, id: 'async', name: 'lookup', arguments: '{}', async: true }] }]);
    ctx.setCurrentInput([{ type: ContentType.TOOL_RESULT, tool_use_id: 'call', content: { update: 'pending dependency' } }]);
    await expect(ctx.prepare()).rejects.toThrow(); expect(state(ctx)).toContain(body.payload); expect(state(ctx)).toContain('async');
  });
  it('retains opaque reasoning and multimodal observations without helper transfer', async () => {
    const { ctx } = await fixture('summary'); const snapshot = ctx.getState();
    const call = snapshot.conversation![1]!; if (call.type === 'message' && call.content[1]?.type === ContentType.TOOL_USE) call.content[1].thoughtSignature = 'OPAQUE_SIGNATURE';
    snapshot.conversation!.push({ type: 'reasoning', id: 'opaque', summary: 'OPAQUE_REASONING', encrypted_content: 'CIPHER' } as InputItem); ctx.restoreState(snapshot);
    const generator = vi.fn(summarize); await expect(ctx.prepare({ summarize: generator })).rejects.toThrow();
    expect(JSON.stringify(generator.mock.calls)).not.toContain('OPAQUE'); expect(state(ctx)).toContain('OPAQUE_SIGNATURE'); expect(state(ctx)).toContain('CIPHER');
  });
  it('does not archive a raw view that differs from its redacted stored observation', async () => {
    const { ctx, storage, reference } = await fixture('summary'); const snapshot = ctx.getState();
    const record = (await storage.readRecord(reference))!; record.result = { ...body, password: '[REDACTED]' };
    const stored = await storage.put(record);
    const block = (snapshot.conversation![2] as { content: Array<{ content: unknown; evidence: { reference: EvidenceReference } }> }).content[0]!;
    block.content = JSON.stringify({ ...body, password: 'SYNTHETIC_SECRET' }); block.evidence.reference = stored; ctx.restoreState(snapshot);
    const generator = vi.fn(summarize);
    await expect(ctx.prepare({ summarize: generator })).rejects.toThrow(); expect(JSON.stringify(generator.mock.calls)).not.toContain('SYNTHETIC_SECRET'); expect(state(ctx)).toContain('SYNTHETIC_SECRET');
    for (const entry of (await storage.list()).entries.filter(e => e.toolName === '__context_source__')) expect(JSON.stringify((await storage.readRecord(entry.reference))?.result)).not.toContain('SYNTHETIC_SECRET');
  });
  it('retains redacted tool arguments rather than creating an unredacted context archive', async () => {
    const { ctx, storage, reference } = await fixture('summary'); const snapshot = ctx.getState();
    const record = (await storage.readRecord(reference))!; record.source.arguments = { password: '[REDACTED]' };
    const stored = await storage.put(record); const call = snapshot.conversation![1]!;
    if (call.type === 'message' && call.content[1]?.type === ContentType.TOOL_USE) call.content[1].arguments = '{"password":"SYNTHETIC_SECRET"}';
    const result = snapshot.conversation![2]!; if (result.type === 'message' && result.content[0]?.type === ContentType.TOOL_RESULT) result.content[0].evidence!.reference = stored;
    ctx.restoreState(snapshot); const generator = vi.fn(summarize);
    await expect(ctx.prepare({ summarize: generator })).rejects.toThrow(); expect(JSON.stringify(generator.mock.calls)).not.toContain('SYNTHETIC_SECRET');
    for (const entry of (await storage.list()).entries.filter(e => e.toolName === '__context_source__')) expect(JSON.stringify((await storage.readRecord(entry.reference))?.result)).not.toContain('SYNTHETIC_SECRET');
  });
  it('storage failure preserves the whole source and does not call a helper', async () => {
    const { ctx, storage } = await fixture('summary'); const before = state(ctx); const generator = vi.fn(summarize); vi.spyOn(storage, 'put').mockRejectedValue(new Error('offline'));
    await expect(ctx.prepare({ summarize: generator })).rejects.toThrow('retain compaction source'); expect(state(ctx)).toBe(before); expect(generator).not.toHaveBeenCalled();
  });
  it('redaction changes cannot silently drop exact source or transfer raw content', async () => {
    const { ctx } = await fixture('summary', {}, new InMemoryEvidenceStorage({ scope }), () => ({ redacted: true }));
    const before = state(ctx); const generator = vi.fn(summarize);
    await expect(ctx.prepare({ summarize: generator })).rejects.toThrow(); expect(state(ctx)).toBe(before); expect(generator).not.toHaveBeenCalled();
  });
  it.each(['namespace', 'tenantId'] as const)('rejects custom-backend %s rebinding after admission', async field => {
    const backend = new InMemoryEvidenceStorage({ scope }); let namespace = scope.namespace; let tenantId: string | undefined;
    const storage: IEvidenceStorage = { get scope() { return { ...scope, namespace, ...(tenantId ? { tenantId } : {}) }; }, durability: backend.durability,
      put: record => backend.put(record), read: (reference, opts) => backend.read(reference, opts), readRecord: reference => backend.readRecord(reference),
      list: opts => backend.list(opts), delete: reference => backend.delete(reference), pruneExpired: now => backend.pruneExpired(now) };
    const { ctx } = await fixture('summary', {}, storage); const before = state(ctx);
    await expect(ctx.prepare({ summarize: async request => { if (field === 'namespace') namespace = 'rebound'; else tenantId = 'other-tenant'; return { summary: valid(request.reference.id) }; } })).rejects.toThrow('scope');
    expect(state(ctx)).toBe(before);
  });
  it('source loss after helper completion prevents apply', async () => {
    const { ctx, storage } = await fixture('summary'); const before = state(ctx);
    await expect(ctx.prepare({ summarize: async request => { await storage.delete(request.reference); return { summary: valid(request.reference.id) }; } })).rejects.toThrow('source was lost'); expect(state(ctx)).toBe(before);
  });
  it.each([{ preserveRecentTurns: 2 }, { preserveRecentMessages: 10 }, { maxSourceTokens: 1 }, { minTokensSaved: 100000 }])('fails fit explicitly without losing protected history: %j', async config => {
    const { ctx } = await fixture('mask', config); const before = state(ctx); await expect(ctx.prepare()).rejects.toThrow(); expect(state(ctx)).toBe(before);
  });
  it('does no helper/storage work below the critical gate and leaves the default path compatible', async () => {
    const { ctx, storage } = await fixture('summary'); ctx.clearConversation(); ctx.addInputItems([user('small')]);
    const put = vi.spyOn(storage, 'put'); const generator = vi.fn(summarize); await ctx.prepare({ summarize: generator });
    expect(generator).not.toHaveBeenCalled(); expect(put).not.toHaveBeenCalled(); expect(ctx.lastPreparation!.compaction).toBeUndefined();
  });
  it('persists summaries and exact references through real file session/evidence storage', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'stage07-state-'));
    try {
      const storage = new FileEvidenceStorage({ scope, directory: join(directory, 'evidence') }); const { ctx } = await fixture('summary', {}, storage);
      await ctx.prepare({ summarize }); const snapshot = ctx.getState();
      const restored = AgentContextNextGen.create({ model: 'gpt-4o-mini', features: { workingMemory: false, inContextMemory: false, evidence: true }, plugins: { evidence: { storage: new FileEvidenceStorage({ scope, directory: join(directory, 'evidence') }) } }, storage: new FileContextStorage({ agentId: 'stage07', baseDirectory: join(directory, 'sessions') }) }); contexts.push(restored);
      restored.restoreState(snapshot); await restored.save('saved'); restored.clearConversation(); await restored.load('saved');
      expect(state(restored)).toBe(JSON.stringify(snapshot.conversation));
      const ref = ctx.lastPreparation!.compaction!.sourceReferences[0]!; expect((await storage.readRecord(ref))?.result).toBeDefined();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
