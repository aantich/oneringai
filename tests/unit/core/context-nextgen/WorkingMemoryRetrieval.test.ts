import { afterEach, describe, expect, it } from 'vitest';
import { AgentContextNextGen } from '@/core/context-nextgen/AgentContextNextGen.js';
import { StoreToolsManager } from '@/core/context-nextgen/store-tools.js';
import { WorkingMemoryPluginNextGen } from '@/core/context-nextgen/plugins/WorkingMemoryPluginNextGen.js';
import { DEFAULT_MEMORY_CONFIG, formatMemoryIndex } from '@/domain/entities/Memory.js';
import { ContentType } from '@/domain/entities/Content.js';
import { MessageRole } from '@/domain/entities/Message.js';
import { OpenAIResponsesConverter } from '@/infrastructure/providers/openai/OpenAIResponsesConverter.js';
import type { IStoreHandler } from '@/core/context-nextgen/types.js';
import type { MemoryIndex } from '@/domain/entities/Memory.js';

const contexts: AgentContextNextGen[] = [];
afterEach(() => contexts.splice(0).forEach(context => context.destroy()));
function create(workingMemory = true, inContextMemory = false) {
  const context = AgentContextNextGen.create({ model: 'gpt-4o-mini', maxContextTokens: 3200, responseReserve: 512,
    features: { workingMemory, inContextMemory } });
  contexts.push(context);
  return context;
}

describe('working-memory retrieval contract', () => {
  it('keeps both colliding source values after separate spills/restore and explains keyed retrieval on the wire', async () => {
    const context = create();
    for (const [id, marker] of [['first-12345678', 'FIRST_SOURCE_VERIFIED'], ['second-12345678', 'SECOND_SOURCE_VERIFIED']]) {
      context.addInputItems([
        { type: 'message', role: MessageRole.USER, content: [{ type: ContentType.INPUT_TEXT, text: 'old observations '.repeat(650) }] },
        { type: 'message', role: MessageRole.ASSISTANT, content: [{ type: ContentType.TOOL_USE, id: id!, name: 'read_source', arguments: '{}' }] },
        { type: 'function_call_output', call_id: id!, output: JSON.stringify({ marker, records: 'source records '.repeat(100) }) },
      ]);
      await context.consolidate();
    }
    const restored = create();
    restored.restoreState(JSON.parse(JSON.stringify(context.getState())));
    restored.addUserMessage('Read both source values.');
    const prepared = await restored.prepare();
    const converter = new OpenAIResponsesConverter();
    const request = converter.convertInput(prepared.input);
    const tools = converter.convertTools(prepared.tools!);
    const get = tools.find(tool => tool.type === 'function' && tool.name === 'store_get');
    expect(get).toMatchObject({ description: expect.stringContaining('Omitting key returns only keys/descriptions, never values.'),
      parameters: { required: ['store'] } });
    const prompt = JSON.stringify(request);
    expect(prompt).toContain('store_get({ store: \\"notes\\", key: \\"<exact index key>\\" })');
    expect(prompt).not.toMatch(/memory_(retrieve|query|persist)/);
    expect(prompt).not.toContain('FIRST_SOURCE_VERIFIED');
    expect(prompt).not.toContain('SECOND_SOURCE_VERIFIED');
    expect(prepared.budget.available).toBeGreaterThanOrEqual(0);

    const keys = ['raw.tool_result.read_source.12345678', 'raw.tool_result.read_source.12345678.function.1'];
    const index = await restored.tools.executeWithOutcome('store_get', { store: 'notes' });
    expect(index.outcome.status).toBe('succeeded');
    expect(index.result).toEqual({ found: true, entries: keys.map(key => ({ key, description: 'Result of read_source()', tier: 'raw' })) });
    for (const [key, marker] of keys.map((key, i) => [key, ['FIRST_SOURCE_VERIFIED', 'SECOND_SOURCE_VERIFIED'][i]])) {
      const value = await restored.tools.execute('store_get', { store: 'notes', key });
      expect(value).toEqual({ found: true, key, entry: { value: JSON.stringify({ marker, records: 'source records '.repeat(100) }) } });
    }
    expect(await restored.tools.execute('store_get', { store: 'notes', key: 'missing' })).toEqual({ found: false, key: 'missing' });
  });

  it('uses the same unified retrieval guidance for content and formatIndex', async () => {
    const plugin = new WorkingMemoryPluginNextGen();
    try {
      await plugin.store('source', 'Source metadata', { marker: 'PRIVATE_SOURCE_VALUE' }, { tier: 'raw' });
      const content = await plugin.getContent();
      expect(content).toEqual(await plugin.formatIndex());
      expect(content).toContain('store_get({ store: "notes", key: "<exact index key>" })');
      expect(content).toContain('Index metadata only.');
      expect(content).not.toContain('PRIVATE_SOURCE_VALUE');
      expect(content).not.toMatch(/memory_(retrieve|query|persist)/);
    } finally { plugin.destroy(); }
  });

  it('lists omitted pinned entries through an available unified tool', async () => {
    const context = create(false);
    const plugin = new WorkingMemoryPluginNextGen({ config: { ...DEFAULT_MEMORY_CONFIG, maxIndexEntries: 1 } });
    context.registerPlugin(plugin);
    await plugin.store('first', 'First metadata', 'FIRST', { pinned: true });
    await plugin.store('second', 'Second metadata', 'SECOND', { pinned: true });
    const content = await plugin.getContent();
    expect(content).toContain('1 additional low-priority entries not shown.');
    expect(content).toContain('store_list({ store: "notes" })');
    expect(content).not.toMatch(/memory_(retrieve|query|persist)/);
    const listed = await context.tools.execute('store_list', { store: 'notes' });
    expect(listed).toMatchObject({ total: 2, entries: expect.arrayContaining([
      expect.objectContaining({ key: 'first' }), expect.objectContaining({ key: 'second' }),
    ]) });
  });

  it('preserves legacy formatter guidance when no unified store is selected', () => {
    const index: MemoryIndex = { entries: [{ key: 'source', description: 'Source', size: '1B', scope: 'session',
      effectivePriority: 'low', pinned: false }], totalSizeBytes: 1, totalSizeHuman: '1B', limitBytes: 1000,
      limitHuman: '1KB', utilizationPercent: 0.1, totalEntryCount: 2, omittedCount: 1 };
    const legacy = formatMemoryIndex(index);
    expect(legacy).toContain('Use `memory_retrieve("key")` to load full content.');
    expect(legacy).toContain('Use `memory_persist("key")` to keep data after task completion.');
    expect(legacy).toContain('memory_query()');
    expect(legacy).not.toContain('store_get');
    expect(formatMemoryIndex(index, 'notes')).toContain('store_get({ store: "notes", key: "<exact index key>" })');
  });

  it('keeps dynamic descriptions and keyless value-returning custom handlers compatible', async () => {
    const manager = new StoreToolsManager();
    const get = manager.getTools().find(tool => tool.definition.function.name === 'store_get')!;
    const handler: IStoreHandler = {
      getStoreSchema: () => ({ storeId: 'custom', displayName: 'Custom', description: 'Without a key, returns all stored values.',
        usageHint: 'Custom store', setDataFields: 'value' }),
      storeGet: async key => key ? { found: true, key, entry: { value: 'FULL_VALUE' } }
        : { found: true, entries: [{ key: 'one', value: 'FULL_VALUE' }] },
      storeSet: async key => ({ success: true, key }),
      storeDelete: async key => ({ deleted: true, key }),
      storeList: async () => ({ entries: [], total: 0 }),
    };
    try {
      expect(get.descriptionFactory!()).toContain('No stores available.');
      manager.registerHandler(handler);
      expect(get.descriptionFactory!()).toContain('Without a key, returns all stored values.');
      expect(get.definition.function.parameters!.required).toEqual(['store']);
      expect(await get.execute({ store: 'custom' })).toEqual({ found: true, entries: [{ key: 'one', value: 'FULL_VALUE' }] });
      manager.unregisterHandler('custom');
      expect(get.descriptionFactory!()).not.toContain('"custom"');
      expect(get.descriptionFactory!()).toContain('No stores available.');
    } finally { manager.destroy(); }
  });

  it('does not inject notes guidance when working memory is disabled', async () => {
    const context = create(false, true);
    const prepared = await context.prepare();
    const prompt = JSON.stringify({ input: prepared.input, tools: prepared.tools });
    expect(prompt).toContain('whiteboard');
    expect(prompt).not.toContain('## Notes');
    expect(JSON.stringify(prepared.tools)).not.toContain('notes');
    expect(prepared.tools!.find(tool => tool.function.name === 'store_get')!.function.description).toContain('metadata only');
  });
});
