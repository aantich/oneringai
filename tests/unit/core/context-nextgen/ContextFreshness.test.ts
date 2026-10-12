import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentContextNextGen } from '@/core/context-nextgen/AgentContextNextGen.js';
import { BasePluginNextGen, simpleTokenEstimator } from '@/core/context-nextgen/BasePluginNextGen.js';
import { ContentType } from '@/domain/entities/Content.js';
import { ToolCallState } from '@/domain/entities/Tool.js';
import { MessageRole } from '@/domain/entities/Message.js';
import type { Message } from '@/domain/entities/Message.js';
import type { BeforeCompactionCallback, CompactionContext, ICompactionStrategy } from '@/core/context-nextgen/types.js';
import { WorkingMemoryPluginNextGen } from '@/core/context-nextgen/plugins/WorkingMemoryPluginNextGen.js';
import { ToolCatalogPluginNextGen } from '@/core/context-nextgen/plugins/ToolCatalogPluginNextGen.js';
import { StrategyRegistry } from '@/core/context-nextgen/strategies/StrategyRegistry.js';
import { ToolCatalogRegistry } from '@/core/ToolCatalogRegistry.js';

const contexts: AgentContextNextGen[] = [];
afterEach(() => { contexts.splice(0).forEach(ctx => ctx.destroy()); ToolCatalogRegistry.unregisterCategory('freshness-test'); });
function create(maxContextTokens = 600) {
  const ctx = AgentContextNextGen.create({ model: 'gpt-4o-mini', maxContextTokens, responseReserve: 100,
    features: { workingMemory: false, inContextMemory: false } });
  contexts.push(ctx);
  return ctx;
}
function strategy(compact: ICompactionStrategy['compact']): ICompactionStrategy {
  return { name: 'legacy-test', displayName: 'Legacy test', description: 'Freshness regression', threshold: 0.8,
    compact, consolidate: async () => ({ performed: false, tokensChanged: 0, actions: [] }) };
}
const call = (id: string, custom = false): Message => ({ type: 'message', role: MessageRole.ASSISTANT,
  content: [custom ? { type: ContentType.CUSTOM_TOOL_USE, id, name: 'shell', input: 'echo hello' }
    : { type: ContentType.TOOL_USE, id, name: 'lookup', arguments: '{"source":"trusted"}' }] });
const result = (id: string, value = 'result', custom = false): Message => ({ type: 'message', role: MessageRole.USER,
  content: [custom ? { type: ContentType.CUSTOM_TOOL_RESULT, tool_use_id: id, content: value }
    : { type: ContentType.TOOL_RESULT, tool_use_id: id, content: value }] });
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
const text = (value: string): Message => ({ type: 'message', role: MessageRole.USER,
  content: [{ type: ContentType.INPUT_TEXT, text: value }] });
class MutablePlugin extends BasePluginNextGen {
  readonly name = 'mutable';
  value = 'before eviction';
  getInstructions() { return `Read ${this.value}`; }
  async getContent() { this.updateTokenCache(simpleTokenEstimator.estimateTokens(this.value)); return this.value; }
  getContents() { return this.value; }
}

describe('context freshness regression', () => {
  it('rebuilds plugin content and instructions after compaction and supplies the first-call budget', async () => {
    const ctx = create();
    const plugin = new MutablePlugin();
    ctx.registerPlugin(plugin);
    let observed: CompactionContext['budget'] | undefined;
    ctx.setCompactionStrategy(strategy(async context => {
      observed = context.budget;
      plugin.value = 'after eviction';
      const freed = await context.removeMessages([0]);
      return { tokensFreed: freed, messagesRemoved: 1, pluginsCompacted: [], log: ['evicted'] };
    }));
    ctx.addInputItems([text('old history '.repeat(135))]);
    ctx.addUserMessage('continue');
    const prepared = await ctx.prepare();
    expect(observed!.totalUsed).toBeGreaterThan(400);
    expect(JSON.stringify(prepared.input)).toContain('after eviction');
    expect(JSON.stringify(prepared.input)).not.toContain('before eviction');
    expect(prepared.budget.available).toBeGreaterThanOrEqual(0);
  });

  it('counts sanitized history, rather than an orphan removed from the request', async () => {
    const ctx = create(3000);
    ctx.addInputItems([{ type: 'message', role: MessageRole.USER,
      content: [{ type: ContentType.TOOL_RESULT, tool_use_id: 'missing', content: 'orphan '.repeat(200) }] }]);
    ctx.addUserMessage('continue');
    const prepared = await ctx.prepare();
    expect(JSON.stringify(prepared.input)).not.toContain('orphan');
    expect(prepared.budget.conversationTokens).toBe(0);
  });

  it('recounts tool definitions changed by a compactor', async () => {
    const ctx = create();
    ctx.setCompactionStrategy(strategy(async context => {
      ctx.tools.register({ definition: { type: 'function', function: { name: 'new_tool',
        description: 'new schema', parameters: { type: 'object', properties: {} } } }, execute: async () => 'ok' });
      return { tokensFreed: await context.removeMessages([0]), messagesRemoved: 1, pluginsCompacted: [], log: [] };
    }));
    ctx.addInputItems([text('old history '.repeat(135))]);
    ctx.addUserMessage('continue');
    const prepared = await ctx.prepare();
    expect(prepared.budget.toolsTokens).toBeGreaterThan(0);
  });

  it('runs a legacy strategy only once if protected content still cannot fit', async () => {
    const ctx = create();
    const compact = vi.fn(async () => ({ tokensFreed: 0, messagesRemoved: 0, pluginsCompacted: [], log: [] }));
    ctx.setCompactionStrategy(strategy(compact));
    ctx.addInputItems([text('protected '.repeat(250))]);
    ctx.addUserMessage('continue');
    await expect(ctx.prepare()).rejects.toThrow('Context overflow');
    expect(compact).toHaveBeenCalledTimes(1);
  });

  it('rebuilds the real working-memory index after algorithmic spill', async () => {
    const ctx = create(2400);
    const memory = new WorkingMemoryPluginNextGen();
    ctx.registerPlugin(memory);
    ctx.addInputItems([call('source-12345678'), result('source-12345678', 'large evidence '.repeat(200))]);
    ctx.addUserMessage('continue with evidence');
    const prepared = await ctx.prepare();
    expect(prepared.compacted).toBe(true);
    expect(prepared.compactionLog.join(' ')).toContain('Moved lookup result');
    expect(JSON.stringify(prepared.input)).toContain('tool_result.lookup.12345678');
    expect(JSON.stringify(prepared.input)).not.toContain('large evidence large evidence');
    expect(prepared.budget.breakdown.pluginContents.working_memory).toBeGreaterThan(0);
    expect(await memory.retrieve('raw.tool_result.lookup.12345678')).toBeDefined();
  });

  it('recounts definitions and content after unloading a real catalog category', async () => {
    ToolCatalogRegistry.registerCategory({ name: 'freshness-test', displayName: 'Freshness test', description: 'Fixture' });
    ToolCatalogRegistry.registerTools('freshness-test', [{ name: 'catalog_fixture', displayName: 'Catalog fixture', description: 'Fixture', safeByDefault: true,
      tool: { definition: { type: 'function', function: { name: 'catalog_fixture', description: 'schema '.repeat(35),
        parameters: { type: 'object', properties: {} } } }, execute: async () => 'ok' } }]);
    const ctx = create(2400);
    const catalog = new ToolCatalogPluginNextGen({ categoryScope: ['freshness-test'] });
    ctx.registerPlugin(catalog);
    catalog.setToolManager(ctx.tools);
    await ctx.tools.execute('tool_catalog_load', { category: 'freshness-test' });
    const before = await ctx.prepare();
    ctx.setCompactionStrategy(strategy(async context => {
      await ctx.tools.execute('tool_catalog_unload', { category: 'freshness-test' });
      return { tokensFreed: await context.removeMessages([0]), messagesRemoved: 1, pluginsCompacted: [], log: [] };
    }));
    ctx.addInputItems([text('catalog history '.repeat(400))]);
    ctx.addUserMessage('continue');
    const after = await ctx.prepare();
    expect(after.tools!.some(tool => tool.function.name === 'catalog_fixture')).toBe(false);
    expect(after.budget.toolsTokens).toBeLessThan(before.budget.toolsTokens);
    expect(JSON.stringify(after.input)).not.toContain('**freshness-test**');
  });

  it('gives a strategy the new budget after a prior small preparation', async () => {
    const ctx = create();
    ctx.addUserMessage('small');
    const before = await ctx.prepare();
    ctx.addAssistantResponse([{ type: 'message', role: MessageRole.ASSISTANT,
      content: [{ type: ContentType.OUTPUT_TEXT, text: 'old '.repeat(500) }] }]);
    const observed = vi.fn();
    ctx.setCompactionStrategy(strategy(async context => {
      observed(context.budget.totalUsed);
      return { tokensFreed: await context.removeMessages([0, 1]), messagesRemoved: 2, pluginsCompacted: [], log: [] };
    }));
    ctx.addUserMessage('new');
    await ctx.prepare();
    expect(observed.mock.calls[0]![0]).toBeGreaterThan(before.budget.totalUsed);
  });

  it('keeps one pending result and its connected multi-call assistant message exact', async () => {
    const ctx = create(2000);
    const multi: Message = { ...call('a'), content: [...call('a').content, ...call('b').content] };
    ctx.addInputItems([text('discard '.repeat(750)), multi, result('a', 'first observation')]);
    ctx.addToolResults([{ tool_use_id: 'b', state: ToolCallState.COMPLETED, content: 'fresh second observation' }]);
    let freedProtected = -1;
    ctx.setCompactionStrategy(strategy(async context => {
      freedProtected = await context.removeMessages([1]);
      return { tokensFreed: await context.removeMessages([0]), messagesRemoved: 1, pluginsCompacted: [], log: [] };
    }));
    const prepared = await ctx.prepare();
    expect(freedProtected).toBe(0);
    expect(prepared.input.slice(1)).toEqual([multi, result('a', 'first observation'), ...ctx.getCurrentInput()]);
    expect(prepared.budget.currentInputTokens).toBeGreaterThan(0);
  });

  it('removes a whole multi-call group even for a legacy single-index proposal', async () => {
    const ctx = create();
    ctx.addInputItems([{ ...call('a'), content: [...call('a').content, ...call('b').content] },
      result('a', 'old '.repeat(350)), result('b')]);
    ctx.addUserMessage('current user input must remain');
    ctx.setCompactionStrategy(strategy(async context => ({ tokensFreed: await context.removeMessages([1]),
      messagesRemoved: 3, pluginsCompacted: [], log: [] })));
    const prepared = await ctx.prepare();
    expect(ctx.getConversation()).toEqual([]);
    expect(JSON.stringify(prepared.input)).toContain('current user input must remain');
  });

  it('keeps function and custom call IDs in separate namespaces', async () => {
    const ctx = create(3000);
    ctx.addInputItems([call('same'), result('same', 'custom orphan', true), text('retained')]);
    ctx.addUserMessage('continue');
    const prepared = await ctx.prepare();
    expect(JSON.stringify(prepared.input)).not.toContain('custom orphan');
    expect(JSON.stringify(prepared.input)).not.toContain('trusted');
    expect(JSON.stringify(prepared.input)).toContain('retained');
  });

  it('preserves a result followed by a library-style asynchronous text update', async () => {
    const ctx = create(3000);
    ctx.addInputItems([call('job'), result('job', 'accepted')]);
    ctx.addUserMessage('Tool lookup (job) completed: final evidence');
    const prepared = await ctx.prepare();
    expect(JSON.stringify(prepared.input)).toContain('accepted');
    expect(JSON.stringify(prepared.input)).toContain('final evidence');
    expect(prepared.input.slice(1)).toEqual([...ctx.getConversation(), ...ctx.getCurrentInput()]);
  });

  it('keeps native continuation outputs whose calls are stored at the provider', async () => {
    const ctx = create(3000);
    ctx.addInputItems([{ type: 'function_call_output', call_id: 'provider-stored', output: 'native continuation' }]);
    const prepared = await ctx.prepare();
    expect(JSON.stringify(prepared.input)).toContain('native continuation');
    expect(prepared.budget.conversationTokens).toBeGreaterThan(0);
  });

  it('rebuilds once for an observation arriving during an async prompt contribution', async () => {
    const ctx = create(3000);
    const started = deferred();
    const resume = deferred();
    const plugin = new MutablePlugin();
    const content = vi.spyOn(plugin, 'getContent').mockImplementationOnce(async () => {
      started.resolve(); await resume.promise; return 'delayed';
    });
    ctx.registerPlugin(plugin);
    const prepared = ctx.prepare();
    await started.promise;
    ctx.addUserMessage('fresh asynchronous observation');
    resume.resolve();
    expect(JSON.stringify((await prepared).input)).toContain('fresh asynchronous observation');
    expect(content).toHaveBeenCalledTimes(2);
  });

  it('has a finite bound when a prompt contributor continuously changes context', async () => {
    const ctx = create(3000);
    const plugin = new MutablePlugin();
    let changes = 0;
    const content = vi.spyOn(plugin, 'getContent').mockImplementation(async () => {
      ctx.addUserMessage(`changed ${++changes}`); return 'changing';
    });
    ctx.registerPlugin(plugin);
    await expect(ctx.prepare()).rejects.toThrow('changed repeatedly');
    expect(content).toHaveBeenCalledTimes(2);
    expect(ctx.lastPreparation).toBeNull();
  });

  it('rejects stale index removal without deleting newer host observations', async () => {
    const ctx = create();
    const started = deferred(); const resume = deferred();
    ctx.addInputItems([text('old '.repeat(600))]);
    ctx.setCompactionStrategy(strategy(async context => {
      started.resolve(); await resume.promise;
      return { tokensFreed: await context.removeMessages([0]), messagesRemoved: 1, pluginsCompacted: [], log: [] };
    }));
    const preparing = ctx.prepare();
    await started.promise;
    ctx.addInputItems([text('newer host observation')]);
    resume.resolve();
    await expect(preparing).rejects.toThrow('stale proposal rejected');
    expect(JSON.stringify(ctx.getConversation())).toContain('newer host observation');
    expect(JSON.stringify(ctx.getConversation())).toContain('old old');
  });

  it('rejects overlapping preparation and rollover during compaction', async () => {
    const ctx = create();
    const started = deferred(); const resume = deferred();
    ctx.addInputItems([text('old '.repeat(600))]);
    ctx.setCompactionStrategy(strategy(async context => {
      started.resolve(); await resume.promise;
      return { tokensFreed: await context.removeMessages([0]), messagesRemoved: 1, pluginsCompacted: [], log: [] };
    }));
    const preparing = ctx.prepare();
    await started.promise;
    await expect(ctx.prepare()).rejects.toThrow('prepare is in progress');
    await expect(ctx.rollover({ preserveRecentTurns: 0, summarize: async () => 'summary' })).rejects.toThrow('prepare is in progress');
    resume.resolve(); await preparing;
  });

  it('does not await or repeat observational hooks while rebuilding after compaction', async () => {
    const ctx = create();
    const plugin = new MutablePlugin();
    const neverFinished = deferred();
    const hook = vi.fn(() => neverFinished.promise);
    Object.assign(plugin, { onBeforePrepare: hook });
    ctx.registerPlugin(plugin);
    ctx.setCompactionStrategy(strategy(async context => ({ tokensFreed: await context.removeMessages([0]),
      messagesRemoved: 1, pluginsCompacted: [], log: [] })));
    ctx.addInputItems([text('old '.repeat(600))]);
    await ctx.prepare();
    expect(hook).toHaveBeenCalledTimes(1);
    neverFinished.resolve();
  });

  it('leaves tools and observations inline below the existing critical trigger', async () => {
    const ctx = create(1000);
    const compact = vi.fn(async () => ({ tokensFreed: 0, messagesRemoved: 0, pluginsCompacted: [], log: [] }));
    ctx.setCompactionStrategy(strategy(compact));
    const history = [call('inline'), result('inline', 'evidence '.repeat(270))];
    ctx.addInputItems(history);
    ctx.addUserMessage('continue');
    const prepared = await ctx.prepare();
    expect(prepared.budget.utilizationPercent).toBeGreaterThan(70);
    expect(prepared.budget.utilizationPercent).toBeLessThan(90);
    expect(compact).not.toHaveBeenCalled();
    expect(prepared.input.slice(1)).toEqual([...history, ...ctx.getCurrentInput()]);
  });

  it('uses fresh plugin/system counts for consolidation before any preparation', async () => {
    const ctx = create();
    const consolidate = vi.fn(async (_context: CompactionContext) => ({ performed: true, tokensChanged: 0, actions: [] }));
    ctx.setCompactionStrategy({ ...strategy(async () => ({ tokensFreed: 0, messagesRemoved: 0, pluginsCompacted: [], log: [] })), consolidate });
    ctx.systemPrompt = 'large protected system '.repeat(80);
    await ctx.consolidate();
    expect(consolidate).toHaveBeenCalledTimes(1);
    expect(consolidate.mock.calls[0]![0].budget.systemMessageTokens).toBeGreaterThan(400);
  });

  it('counts image observations and keeps disabled plugins absent', async () => {
    const ctx = create(3000);
    ctx.addUserMessage([{ type: ContentType.INPUT_TEXT, text: 'inspect' },
      { type: ContentType.INPUT_IMAGE_URL, image_url: { url: 'https://example.test/image.png', detail: 'low' } }]);
    const prepared = await ctx.prepare();
    expect(prepared.budget.currentInputTokens).toBe(4 + simpleTokenEstimator.estimateTokens('inspect') + 85);
    expect(prepared.budget.breakdown.pluginContents).toEqual({});
    expect(prepared.tools).toEqual([]);
    expect(JSON.stringify(prepared.input)).not.toContain('Working Memory');
  });

  it('counts native multimodal outputs as images rather than base64 text', async () => {
    const ctx = create(3000);
    ctx.addInputItems([{ type: 'function_call_output', call_id: 'provider-stored', output: [
      { type: ContentType.INPUT_TEXT, text: 'screenshot' },
      { type: ContentType.INPUT_IMAGE_URL, image_url: { url: `data:image/png;base64,${'A'.repeat(100000)}` } },
    ] }]);
    const prepared = await ctx.prepare();
    expect(prepared.budget.conversationTokens).toBeGreaterThanOrEqual(1000);
    expect(prepared.budget.conversationTokens).toBeLessThan(1500);
    expect(prepared.budget.available).toBeGreaterThanOrEqual(0);
  });

  it('includes replay signatures in protected multimodal request accounting', async () => {
    const ctx = create(1000);
    ctx.addUserMessage([{ type: ContentType.THINKING, thinking: 'short visible thought',
      signature: 'opaque-signature-'.repeat(300), persistInHistory: true }]);
    await expect(ctx.prepare()).rejects.toThrow('too large');
  });

  it('fails clearly when protected image results remain oversized after emergency text truncation', async () => {
    const ctx = create();
    ctx.addInputItems([call('image')]);
    ctx.addToolResults([{ tool_use_id: 'image', state: ToolCallState.COMPLETED, content: { text: 'tiny', __images: [{ base64: 'fixture', mediaType: 'image/png' }] } }]);
    await expect(ctx.prepare()).rejects.toThrow('Context overflow');
    expect(JSON.stringify(ctx.getConversation())).toContain('image');
    expect(JSON.stringify(ctx.getCurrentInput())).toContain('fixture');
  });

  it('returns detached inputs and diagnostics and increments preparation revisions', async () => {
    const ctx = create(3000);
    ctx.addUserMessage('selected');
    const first = await ctx.prepare();
    const diagnostic = ctx.lastPreparation!;
    diagnostic.budget.totalUsed = 99999;
    ctx.addUserMessage('next');
    expect(JSON.stringify(first.input)).toContain('selected');
    expect(ctx.lastPreparation!.budget.totalUsed).not.toBe(99999);
    await ctx.prepare();
    expect(ctx.lastPreparation!.revision).toBe(diagnostic.revision + 1);
  });

  it.each(['default', 'algorithmic'])('%s skips protected async calls before deciding it reclaimed enough', async name => {
    const ctx = create(1000);
    const pending = call('outstanding');
    pending.content[0] = { type: ContentType.TOOL_USE, id: 'outstanding', name: 'lookup',
      arguments: JSON.stringify({ request: 'protected '.repeat(180) }), async: true };
    ctx.addInputItems([pending, text('old history '.repeat(500))]);
    ctx.addUserMessage('continue');
    ctx.setCompactionStrategy(StrategyRegistry.create(name));
    const prepared = await ctx.prepare();
    expect(prepared.compacted).toBe(true);
    expect(ctx.getConversation()).toEqual([pending]);
    expect(JSON.stringify(prepared.input)).toContain('outstanding');
    expect(prepared.budget.available).toBeGreaterThanOrEqual(0);
  });

  it('recounts an existing result updated in place without duplicating final results', async () => {
    const ctx = create(3000);
    const observation = result('updated', 'initial');
    ctx.addInputItems([call('updated'), observation]);
    const before = await ctx.prepare();
    observation.content[0] = { type: ContentType.TOOL_RESULT, tool_use_id: 'updated', content: 'revised evidence '.repeat(30) };
    const after = await ctx.prepare();
    expect(after.budget.conversationTokens).toBeGreaterThan(before.budget.conversationTokens);
    expect(JSON.stringify(after.input)).toContain('revised evidence');
    expect(JSON.stringify(before.input)).not.toContain('revised evidence');
  });

  it('recounts hook-modified inputs and tools without a second compaction', async () => {
    const ctx = create(3000);
    ctx.addUserMessage('original');
    await ctx.prepare();
    const budget = ctx.validateRequestBudget({ input: [text('host replacement '.repeat(25))], instructions: 'host instructions', tools: [] });
    expect(budget.totalUsed).toBe(budget.systemMessageTokens + budget.currentInputTokens);
    expect(budget.breakdown.pluginContents).toEqual({});
    expect(ctx.lastPreparation!.budget).toEqual(budget);
    expect(() => ctx.validateRequestBudget({ input: [text('too large '.repeat(1500))] })).toThrow('Context overflow');
  });

  it('preserves the rollover mutation guard and rejects preparation while its summary is pending', async () => {
    const ctx = create(3000);
    const started = deferred(); const resume = deferred();
    ctx.addInputItems([text('old turn')]);
    const rolling = ctx.rollover({ preserveRecentTurns: 0, summarize: async () => {
      started.resolve(); await resume.promise; return 'summary';
    } });
    await started.promise;
    await expect(ctx.prepare()).rejects.toThrow('rollover is in progress');
    ctx.addUserMessage('arrived while summarizing');
    resume.resolve();
    await expect(rolling).rejects.toThrow('Context changed while rollover');
    expect(JSON.stringify(ctx.getConversation())).toContain('old turn');
    expect(JSON.stringify(ctx.getCurrentInput())).toContain('arrived while summarizing');
    await ctx.prepare();
  });

  it('releases its guard after a strategy failure and supplies the first budget to lifecycle callbacks', async () => {
    const ctx = create();
    ctx.addInputItems([text('old '.repeat(600))]);
    const before = vi.fn(async (_info: Parameters<BeforeCompactionCallback>[0]) => { throw new Error('observational callback failed'); });
    ctx.setBeforeCompactionCallback(before);
    ctx.setCompactionStrategy(strategy(async () => { throw new Error('strategy failed'); }));
    await expect(ctx.prepare()).rejects.toThrow('strategy failed');
    expect(before.mock.calls[0]![0].budget.totalUsed).toBeGreaterThan(500);
    ctx.setCompactionStrategy(strategy(async context => ({ tokensFreed: await context.removeMessages([0]),
      messagesRemoved: 1, pluginsCompacted: [], log: [] })));
    const next = await ctx.prepare();
    expect(next.compactionLog.join(' ')).toContain('observational callback failed');
    expect(next.budget.available).toBeGreaterThanOrEqual(0);
  });
});
