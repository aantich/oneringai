import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentContextNextGen, ObservationMaskingStrategy, StructuredSummaryStrategy, InMemoryEvidenceStorage, ContentType, MessageRole } from '../../../../../src/index.js';
import type { InputItem, ICompactionStrategy, StructuredContextSummary } from '../../../../../src/index.js';

const contexts: AgentContextNextGen[] = [];
afterEach(() => { contexts.splice(0).forEach(context => context.destroy()); vi.restoreAllMocks(); });
const user = (text: string): InputItem => ({ type: 'message', role: MessageRole.USER, content: [{ type: ContentType.INPUT_TEXT, text }] });
const assistant = (text: string): InputItem => ({ type: 'message', role: MessageRole.ASSISTANT, content: [{ type: ContentType.OUTPUT_TEXT, text }] });
const recent = () => [user('Recent first.'), assistant('OK.'), user('Recent second.'), assistant('OK.')];
const scope = { ownerId: 'owner', namespace: 'stage07-corrections' };
const summary = (id: string): StructuredContextSummary => ({ completedWork: [{ text: 'Observed the exact source.', sourceIds: [id] }], activeWork: [], constraints: [], decisions: [], uncertainties: [], artifacts: [], actionReceipts: [] });
function context(strategy: ICompactionStrategy, storage = new InMemoryEvidenceStorage({ scope }), capacity = 7000) {
  const ctx = AgentContextNextGen.create({ model: 'gpt-4o-mini', userId: scope.ownerId, maxContextTokens: capacity, responseReserve: 128, criticalCompactionThreshold: 0.8,
    features: { evidence: true, workingMemory: false, inContextMemory: false }, plugins: { evidence: { storage } }, compactionStrategy: strategy });
  contexts.push(ctx); return ctx;
}
async function readGroup(storage: InMemoryEvidenceStorage, id = 'call', repetitions = 800, effect: 'read' | 'write' | 'unknown' = 'read'): Promise<InputItem[]> {
  const raw = { answer: 'EXACT_REVIEW_VALUE', padding: 'Read observation detail. '.repeat(repetitions) };
  const reference = await storage.put({ version: 1, recordedAt: 1, source: { toolName: 'lookup', callId: id, executionId: id, arguments: {}, principal: { userId: scope.ownerId }, effect, status: 'succeeded', completion: 'settled', startedAt: 1, durationMs: 1 }, result: raw });
  return [{ type: 'message', role: MessageRole.ASSISTANT, content: [{ type: ContentType.TOOL_USE, id, name: 'lookup', arguments: '{}' }] },
    { type: 'message', role: MessageRole.USER, content: [{ type: ContentType.TOOL_RESULT, tool_use_id: id, content: raw, evidence: { version: 1, status: 'stored', executionId: id, reference } }] }];
}

describe('Stage 07 review corrections: eligibility and known no-op preflight', () => {
  for (const Strategy of [ObservationMaskingStrategy, StructuredSummaryStrategy]) {
    it(`${Strategy.name}: unchanged users do not crowd out a fitting read group at the default source cap`, async () => {
      const storage = new InMemoryEvidenceStorage({ scope }); const ctx = context(new Strategy(), storage);
      const exact = user('Original exact user constraints. '.repeat(600)); const group = await readGroup(storage);
      ctx.addInputItems([exact, ...group, ...recent()]);
      const helper = vi.fn(async ({ reference }: { reference: { id: string } }) => ({ summary: summary(reference.id) }));
      const prepared = await ctx.prepare({ summarize: helper }); expect(prepared.budget.available).toBeGreaterThanOrEqual(0);
      expect(ctx.getState().conversation).toContainEqual(exact); expect(ctx.lastPreparation?.compaction?.applied).toBe(true);
      const retained = await storage.readRecord(ctx.lastPreparation!.compaction!.sourceReferences[0]!);
      expect(retained?.result).toEqual({ items: group });
      if (Strategy === StructuredSummaryStrategy) expect(JSON.stringify(helper.mock.calls)).not.toContain('Original exact user constraints.');
    });
    it(`${Strategy.name}: capacity goes to multiple eligible groups while exact user text remains in place`, async () => {
      const storage = new InMemoryEvidenceStorage({ scope }); const ctx = context(new Strategy(), storage);
      const exact = user('Original exact user constraints. '.repeat(600));
      const first = await readGroup(storage, 'first', 400); const second = await readGroup(storage, 'second', 400);
      ctx.addInputItems([exact, ...first, ...second, ...recent()]);
      await ctx.prepare({ summarize: async request => ({ summary: summary(request.reference.id) }) });
      expect(ctx.getState().conversation).toContainEqual(exact);
      expect((await storage.readRecord(ctx.lastPreparation!.compaction!.sourceReferences[0]!))?.result).toEqual({ items: [...first, ...second] });
      expect(JSON.stringify(ctx.getState())).not.toContain('Read observation detail.');
    });
    it(`${Strategy.name}: a genuinely oversized connected group keeps its user text and observation`, async () => {
      const storage = new InMemoryEvidenceStorage({ scope }); const ctx = context(new Strategy(), storage);
      const group = await readGroup(storage); if (group[1]?.type === 'message') group[1].content.push({ type: ContentType.INPUT_TEXT, text: 'Connected exact user constraint. '.repeat(600) });
      ctx.addInputItems([user('Original task.'), ...group, ...recent()]); const before = JSON.stringify(ctx.getState().conversation);
      const put = vi.spyOn(storage, 'put'); const helper = vi.fn(async request => ({ summary: summary(request.reference.id) }));
      await expect(ctx.prepare({ summarize: helper })).rejects.toThrow('overflow');
      expect(JSON.stringify(ctx.getState().conversation)).toBe(before); expect(put).not.toHaveBeenCalled(); expect(helper).not.toHaveBeenCalled();
    });
    it.each(['minimum', 'observation-threshold'] as const)(`${Strategy.name}: impossible %s saving performs no retention or helper work`, async bound => {
      const storage = new InMemoryEvidenceStorage({ scope });
      const settings = bound === 'minimum' ? { minTokensSaved: 100000 } : { minObservationTokens: 100000 };
      const ctx = context(new Strategy(settings), storage); ctx.addInputItems([user('Original task.'), ...await readGroup(storage), ...recent()]);
      const before = JSON.stringify(ctx.getState().conversation); const put = vi.spyOn(storage, 'put'); const helper = vi.fn(async request => ({ summary: summary(request.reference.id) }));
      await ctx.prepare({ summarize: helper });
      expect(put).not.toHaveBeenCalled(); expect(helper).not.toHaveBeenCalled(); expect(JSON.stringify(ctx.getState().conversation)).toBe(before);
      expect(ctx.lastPreparation?.compaction).toMatchObject({ applied: false, sourceReferences: [], helperInvoked: false });
    });
    it.each(['open', 'full', 'offline'] as const)(`${Strategy.name}: repeated fitting critical requests with only exact content ignore %s storage`, async backend => {
      const storage = new InMemoryEvidenceStorage({ scope, maxRecords: backend === 'full' ? 1 : 2 });
      if (backend === 'full') await readGroup(storage, 'unrelated', 1);
      const ctx = context(new Strategy(), storage, 2000); ctx.addInputItems([user('Exact unchanged user constraint. '.repeat(130)), ...recent()]);
      const before = JSON.stringify(ctx.getState().conversation); const count = (await storage.list()).entries.length;
      const put = vi.spyOn(storage, 'put'); const read = vi.spyOn(storage, 'readRecord');
      if (backend === 'offline') { put.mockRejectedValue(new Error('offline')); read.mockRejectedValue(new Error('offline')); }
      const helper = vi.fn(async request => ({ summary: summary(request.reference.id) }));
      for (let i = 0; i < 4; i++) {
        const prepared = await ctx.prepare({ summarize: helper }); expect(prepared.budget.available).toBeGreaterThanOrEqual(0);
        expect(ctx.lastPreparation?.compaction).toMatchObject({ applied: false, tokensFreed: 0, sourceReferences: [], helperInvoked: false });
      }
      expect(put).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled(); expect(helper).not.toHaveBeenCalled();
      expect((await storage.list()).entries).toHaveLength(count); expect(JSON.stringify(ctx.getState().conversation)).toBe(before);
    });
    it.each(['write', 'unknown', 'unacknowledged'] as const)(`${Strategy.name}: protected %s observations remain exact without source writes`, async protection => {
      const storage = new InMemoryEvidenceStorage({ scope }); const ctx = context(new Strategy(), storage);
      const group = await readGroup(storage, 'protected', 800, protection === 'unacknowledged' ? 'read' : protection);
      if (protection === 'unacknowledged' && group[1]?.type === 'message' && group[1].content[0]?.type === ContentType.TOOL_RESULT) group[1].content[0].evidence!.status = 'storage_failed';
      ctx.addInputItems([user('Original task.'), ...group, ...recent()]); const before = JSON.stringify(ctx.getState().conversation);
      const put = vi.spyOn(storage, 'put'); const helper = vi.fn(async request => ({ summary: summary(request.reference.id) }));
      await ctx.prepare({ summarize: helper }); expect(put).not.toHaveBeenCalled(); expect(helper).not.toHaveBeenCalled(); expect(JSON.stringify(ctx.getState().conversation)).toBe(before);
    });
  }
  it('masking does not allocate source capacity to unchanged assistant narration', async () => {
    const storage = new InMemoryEvidenceStorage({ scope }); const ctx = context(new ObservationMaskingStrategy(), storage, 8000);
    const exact = assistant('Exact older assistant narration. '.repeat(100)); const group = await readGroup(storage);
    ctx.addInputItems([user('Original exact user constraints. '.repeat(600)), exact, ...group, ...recent()]);
    await ctx.prepare(); expect(ctx.getState().conversation).toContainEqual(exact);
    expect((await storage.readRecord(ctx.lastPreparation!.compaction!.sourceReferences[0]!))?.result).toEqual({ items: group });
  });
  it.each(['mask', 'error'] as const)('a tiny narrative cannot justify any valid summary capsule with fallback=%s', async fallback => {
    const storage = new InMemoryEvidenceStorage({ scope }); const ctx = context(new StructuredSummaryStrategy({ fallback }), storage, 2200);
    ctx.addInputItems([user('Exact unchanged user constraint. '.repeat(130)), assistant('Small narrative. '.repeat(10)), ...recent()]);
    const before = JSON.stringify(ctx.getState().conversation); const put = vi.spyOn(storage, 'put'); const helper = vi.fn(async request => ({ summary: summary(request.reference.id) }));
    await ctx.prepare({ summarize: helper }); expect(put).not.toHaveBeenCalled(); expect(helper).not.toHaveBeenCalled(); expect(JSON.stringify(ctx.getState().conversation)).toBe(before);
  });
  it.each(['mask', 'error'] as const)('an impossible capsule cap uses only the permitted fallback=%s', async fallback => {
    const storage = new InMemoryEvidenceStorage({ scope }); const ctx = context(new StructuredSummaryStrategy({ maxSummaryTokens: 1, fallback }), storage);
    const group = await readGroup(storage); ctx.addInputItems([user('Original task.'), ...group, ...recent()]); const before = JSON.stringify(ctx.getState().conversation);
    const put = vi.spyOn(storage, 'put'); const helper = vi.fn(async request => ({ summary: summary(request.reference.id) }));
    await ctx.prepare({ summarize: helper }); expect(helper).not.toHaveBeenCalled();
    if (fallback === 'mask') {
      expect(put).toHaveBeenCalledTimes(1); expect(ctx.lastPreparation?.compaction).toMatchObject({ applied: true, fallback: 'mask', helperInvoked: false });
      expect(JSON.stringify(ctx.getState())).not.toContain('00000000-0000-4000-8000-000000000000');
      expect((await storage.readRecord(ctx.lastPreparation!.compaction!.sourceReferences[0]!))?.result).toEqual({ items: group });
    } else {
      expect(put).not.toHaveBeenCalled(); expect(JSON.stringify(ctx.getState().conversation)).toBe(before); expect(ctx.lastPreparation?.compaction).toMatchObject({ applied: false, sourceReferences: [], helperInvoked: false });
    }
  });

});
