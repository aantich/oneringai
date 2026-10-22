import { afterEach, describe, expect, it } from 'vitest';
import { Agent, AgentContextNextGen, BasePluginNextGen, Connector, Vendor, ContentType, MessageRole } from '../../../src/index.js';
import type { ContextAssemblyConfig, ContextBlock, IContextStorage, SerializedContextState } from '../../../src/index.js';
import { ScriptedLoopProvider } from '../../../examples/agent-loop/scripted-provider.js';
const contexts: AgentContextNextGen[] = [], agents: Agent[] = [];
afterEach(() => { agents.splice(0).forEach(agent => agent.destroy()); contexts.splice(0).forEach(ctx => ctx.destroy()); Connector.clear(); });
class Source extends BasePluginNextGen {
  name = 'source'; value = 'HOST'; getInstructions() { return 'Legacy instructions'; } async getContent() { return this.value; } getContents() { return this.value; }
  override getState() { return { value: this.value }; } override restoreState(state: unknown) { this.value = (state as { value: string }).value; }
}
function make(assembly: ContextAssemblyConfig = {}) {
  const ctx = AgentContextNextGen.create({ model: 'gpt-4o-mini', assembly, features: { workingMemory: false, inContextMemory: false } }); contexts.push(ctx);
  const plugin = new Source(); ctx.registerPlugin(plugin); return { ctx, plugin };
}
describe('Stage 05 failure and extension compatibility', () => {
  it.each([{ maxDataTokens: -1 }, { timeoutMs: 0 }, { timeoutMs: 30001 }, { maxBlocks: 0 }, { maxBlockCharacters: NaN }, { reasoningReserveTokens: -1 }, { sourceTokenLimits: { source: -1 } }, { layout: 'invented' }])('rejects invalid explicit configuration %j', config => {
    expect(() => make(config as ContextAssemblyConfig)).toThrow();
  });
  it.each([{ id: '', text: 'x' }, { id: 'bad\nid', text: 'x' }, { id: 'A', text: '12345' }, { id: 'A', text: 'x', projection: '12345' }, { id: 'A', text: 'x', expiresAt: NaN }, { id: 'A', text: 'x', dependencies: [3] }])('rejects malformed contribution %j', block => {
    const { ctx, plugin } = make({ maxBlockCharacters: 4 }); ctx.registerContextContributor('source', { getRevision: () => plugin.value, contribute: () => [block as ContextBlock] });
    return expect(ctx.prepare()).rejects.toThrow();
  });
  it('bounds block count and retains a previous diagnostic after a later failure', async () => {
    const { ctx } = make({ maxBlocks: 1 }); let blocks: ContextBlock[] = [{ id: 'A', text: 'A' }]; ctx.registerContextContributor('source', { getRevision: () => 1, contribute: () => blocks });
    await ctx.prepare(); const previous = ctx.lastPreparation; blocks = [blocks[0]!, { id: 'B', text: 'B' }];
    await expect(ctx.prepare()).rejects.toThrow('Too many'); expect(ctx.lastPreparation).toEqual(previous);
  });
  it('accepts class companions with private-field receivers and explicit getter instructions', async () => {
    const { ctx } = make(); class Companion { #value = 'PRIVATE'; get instructions() { return 'Explicit host override'; } getRevision() { return this.#value; } contribute() { return [{ id: 'A', text: this.#value }]; } }
    ctx.registerContextContributor('source', new Companion()); const result = await ctx.prepare();
    expect(JSON.stringify(result.input)).toContain('PRIVATE'); expect(JSON.stringify(result.input)).toContain('Explicit host override'); expect(JSON.stringify(result.input)).not.toContain('Legacy instructions');
  });
  it('does not activate assembly after a rejected registration on a legacy context', async () => {
    const ctx = AgentContextNextGen.create({ model: 'gpt-4o-mini' }); contexts.push(ctx);
    expect(() => ctx.registerContextContributor('absent', { getRevision: () => 1, contribute: () => [] })).toThrow(); await ctx.prepare(); expect(ctx.lastPreparation).not.toHaveProperty('selection');
  });
  it('supports cross-plugin dependencies with complete source attribution', async () => {
    const { ctx } = make(); const other = new Source(); other.name = 'other'; ctx.registerPlugin(other);
    ctx.registerContextContributor('source', { getRevision: () => 1, contribute: () => [{ id: 'A', text: 'exact', protected: true, dependencies: ['other/B'] }] });
    ctx.registerContextContributor('other', { getRevision: () => 1, contribute: () => [{ id: 'B', text: 'source' }] }); await ctx.prepare();
    expect(ctx.lastPreparation!.selection!.entries.find(entry => entry.id === 'other/B')).toMatchObject({ source: 'other', reason: 'protected' });
  });
  it('rejects input changes and unregistered source revisions after preparation', async () => {
    const { ctx } = make(); ctx.registerContextContributor('source', { getRevision: () => 1, contribute: () => [] }); let prepared = await ctx.prepare(); ctx.addUserMessage('New task');
    expect(() => ctx.validateRequestBudget({ input: prepared.input })).toThrow('input changed'); prepared = await ctx.prepare(); ctx.unregisterContextContributor('source');
    expect(() => ctx.validateRequestBudget({ input: prepared.input })).toThrow('changed');
  });
  it('persists source state without contributors, selected views or host authority and requires host reattachment', async () => {
    const states = new Map<string, SerializedContextState>();
    const storage: IContextStorage = { getPath: () => 'memory://stage05', save: async (id, state) => { states.set(id, JSON.parse(JSON.stringify(state))); },
      load: async id => { const state = states.get(id); return state ? { version: 1, sessionId: id, createdAt: new Date().toISOString(), lastSavedAt: new Date().toISOString(), metadata: {}, state } : null; }, list: async () => [], delete: async id => { states.delete(id); }, exists: async id => states.has(id) };
    const first = AgentContextNextGen.create({ model: 'gpt-4o-mini', storage }); contexts.push(first); const source = new Source(); first.registerPlugin(source);
    first.registerContextContributor('source', { getRevision: () => source.value, contribute: () => [{ id: 'A', text: 'SELECTED_ONLY' }] }); await first.prepare(); await first.save('A');
    expect(JSON.stringify(states.get('A'))).not.toContain('SELECTED_ONLY'); const second = AgentContextNextGen.create({ model: 'gpt-4o-mini', storage }); contexts.push(second); const restored = new Source(); restored.value = 'LATER'; second.registerPlugin(restored);
    expect(await second.load('A')).toBe(true); expect(restored.value).toBe('HOST'); await second.prepare(); expect(second.lastPreparation).not.toHaveProperty('selection');
  });
  it('retains managed JSON output/repair fit checks without overwriting main selection usage', async () => {
    const provider = new ScriptedLoopProvider([{ text: 'not JSON' }, { text: '{"ok":true}' }]); Connector.create({ name: 'main', vendor: Vendor.OpenAI, auth: { type: 'none' }, options: { provider } });
    const agent = Agent.create({ connector: 'main', model: 'gpt-4o-mini', context: { model: 'gpt-4o-mini', assembly: { layout: 'stable-prefix' }, features: { workingMemory: false, inContextMemory: false } } }); agents.push(agent);
    const source = new Source(); agent.context.registerPlugin(source); agent.context.registerContextContributor('source', { getRevision: () => 1, contribute: () => [{ id: 'A', text: 'host data', protected: true }] });
    const response = await agent.run('Return ok true.', { responseFormat: { type: 'json_schema', name: 'answer', schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false } } });
    expect(response.output_parsed).toEqual({ ok: true }); expect(provider.requests).toHaveLength(2); expect(agent.context.lastPreparation!.selection).toBeDefined();
  });
  it('does not project a dependency silently when its full form is required by a selected dependent', async () => {
    const { ctx } = make({ maxDataTokens: 100 }); ctx.registerContextContributor('source', { getRevision: () => 1, contribute: () => [
      { id: 'A', priority: 10, text: 'big '.repeat(1000), projection: 'small' }, { id: 'B', priority: 1, text: 'dependent', dependencies: ['source/A'] },
    ] }); await ctx.prepare(); const manifest = ctx.lastPreparation!.selection!;
    expect(manifest.entries.find(entry => entry.id === 'source/A')?.status).toBe('projected'); expect(manifest.entries.find(entry => entry.id === 'source/B')?.status).toBe('omitted');
  });
});

describe('single-pass compaction and conservative model limits', () => {
  it('rebuilds selected data after exactly one compaction and preserves protected dependency closure', async () => {
    const source = new Source(); let compactions = 0;
    const ctx = AgentContextNextGen.create({ model: 'gpt-4o-mini', maxContextTokens: 1200, responseReserve: 100, criticalCompactionThreshold: 0.8, assembly: { maxDataTokens: 200 }, features: { workingMemory: false, inContextMemory: false },
      compactionStrategy: { name: 'bounded', displayName: 'Bounded', description: 'Refresh data after history compaction', threshold: 0.8,
        compact: async state => { compactions++; source.value = 'AFTER_COMPACTION'; const freed = await state.removeMessages([0]); return { tokensFreed: freed, messagesRemoved: 1, pluginsCompacted: [], log: [] }; }, consolidate: async () => ({ performed: false, tokensChanged: 0, actions: [] }) } }); contexts.push(ctx); ctx.registerPlugin(source);
    ctx.registerContextContributor('source', { getRevision: () => source.value, contribute: () => [{ id: 'A', text: source.value, protected: true }] });
    ctx.addInputItems([{ type: 'message', role: MessageRole.USER, content: [{ type: ContentType.INPUT_TEXT, text: 'OLD '.repeat(1100) }] }]);
    const result = await ctx.prepare(); expect(compactions).toBe(1); expect(JSON.stringify(result.input)).toContain('AFTER_COMPACTION'); expect(result.budget.available).toBeGreaterThanOrEqual(0);
  });
  it('labels the existing unknown-model fallback without claiming a verified provider capacity', async () => {
    const ctx = AgentContextNextGen.create({ model: 'unregistered-fixture-model', assembly: {}, features: { workingMemory: false, inContextMemory: false } }); contexts.push(ctx); await ctx.prepare();
    expect(ctx.lastPreparation!.selection!.accounting.capacitySource).toBe('fallback'); expect(ctx.lastPreparation!.selection!.accounting.providerInputTokens).toBeNull();
  });
});

describe('admission and scope isolation', () => {
  it('rejects principal changes during definition selection instead of attributing old data to new scope', async () => {
    const { ctx } = make(); ctx.tools.setToolContext({ userId: 'A' }); ctx.registerContextContributor('source', { getRevision: () => 1, contribute: () => [{ id: 'A', text: 'OWNER_A_DATA' }] });
    await expect(ctx.prepare({ getTools: () => { ctx.tools.setToolContext({ userId: 'B' }); return []; } })).rejects.toThrow('authority'); expect(ctx.lastPreparation).toBeNull();
  });
  it.each(['blocks', 'revision', 'empty-revision', 'null-block', 'protected', 'priority'] as const)('rejects invalid external companion %s', async mode => {
    const { ctx } = make();
    const contribute = () => mode === 'blocks' ? null : mode === 'null-block' ? [null] : [{ id: 'A', text: 'A', ...(mode === 'protected' ? { protected: 'yes' } : {}), ...(mode === 'priority' ? { priority: Infinity } : {}) }];
    ctx.registerContextContributor('source', { getRevision: () => mode === 'revision' ? {} : mode === 'empty-revision' ? undefined : 1, contribute } as unknown as import('../../../src/index.js').ContextContributor);
    await expect(ctx.prepare()).rejects.toThrow();
  });
  it('fails explicitly when reserved reasoning/output space leaves no usable input window', async () => {
    const ctx = AgentContextNextGen.create({ model: 'gpt-4o-mini', maxContextTokens: 1000, responseReserve: 100, assembly: { reasoningReserveTokens: 1000 } }); contexts.push(ctx);
    await expect(ctx.prepare()).rejects.toMatchObject({ code: 'CONTEXT_OVERFLOW' });
  });
});

describe('inspection and scoped source-reader recovery', () => {
  it('does not invoke contributors during pre-preparation budget inspection', async () => {
    const { ctx } = make(); let callbacks = 0;
    ctx.registerContextContributor('source', { getRevision: () => 1, contribute: () => { callbacks++; throw Error('Must not inspect with source work'); } });
    expect((await ctx.calculateBudget()).available).toBeGreaterThan(0); expect(callbacks).toBe(0); expect(ctx.lastPreparation).toBeNull();
    await expect(ctx.prepare()).rejects.toThrow('Must not inspect'); expect(callbacks).toBe(1);
  });
  it('provides a valid scoped selector without revealing its answer in error feedback', async () => {
    const { buildSourceSelectorHint } = await import('../../../examples/context-strategy-comparison.js');
    const ctx = AgentContextNextGen.create({ model: 'gpt-4o-mini', features: { inContextMemory: false } }); contexts.push(ctx);
    const memory = ctx.getPlugin<import('../../../src/index.js').WorkingMemoryPluginNextGen>('working_memory')!;
    await memory.storeSet('proof', { description: 'Source proof', tier: 'raw', value: { answer: 'SECRET_ANSWER', artifact: 'A42' } });
    const key = (await memory.storeList()).entries[0]!.key; if (typeof key !== 'string') throw Error('Expected an exact source key');
    const hint = await buildSourceSelectorHint(memory); expect(hint).toContain(JSON.stringify({ noteKey: key })); expect(hint).not.toContain('SECRET_ANSWER'); expect(hint).not.toContain('A42');
    expect(JSON.stringify(await memory.retrieve(key))).toContain('SECRET_ANSWER');
  });
  it('bounds notes-key feedback and excludes non-source metadata keys', async () => {
    const { buildSourceSelectorHint } = await import('../../../examples/context-strategy-comparison.js');
    const hint = await buildSourceSelectorHint({ storeList: async () => ({ total: 25, entries: [
      { key: 'receipt.only', description: 'Not a source' }, ...Array.from({ length: 24 }, (_, index) => ({ key: `raw.source${index}`, description: 'Do not expose descriptions' })),
    ] }) });
    expect((hint.match(/"noteKey"/g) ?? [])).toHaveLength(8); expect(hint).not.toContain('receipt.only'); expect(hint).not.toContain('Do not expose descriptions');
  });
});
