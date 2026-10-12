import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentContextNextGen } from '@/core/context-nextgen/AgentContextNextGen.js';
import { simpleTokenEstimator } from '@/core/context-nextgen/BasePluginNextGen.js';
import { WorkingMemoryPluginNextGen } from '@/core/context-nextgen/plugins/WorkingMemoryPluginNextGen.js';
import { DefaultCompactionStrategy } from '@/core/context-nextgen/strategies/DefaultCompactionStrategy.js';
import { AnthropicConverter } from '@/infrastructure/providers/anthropic/AnthropicConverter.js';
import { ContentType } from '@/domain/entities/Content.js';
import { ToolCallState } from '@/domain/entities/Tool.js';
import { MessageRole } from '@/domain/entities/Message.js';
import type { InputItem } from '@/domain/entities/Message.js';
import type { IContextStorage, StoredContextSession } from '@/domain/interfaces/IContextStorage.js';

const contexts: AgentContextNextGen[] = [];
afterEach(() => { contexts.splice(0).forEach(context => context.destroy()); vi.restoreAllMocks(); });
function create(storage?: IContextStorage, maxContextTokens = 3000) {
  const context = AgentContextNextGen.create({ model: 'gpt-4o-mini', maxContextTokens, responseReserve: 100,
    features: { workingMemory: false, inContextMemory: false }, storage });
  contexts.push(context); return context;
}
function pair(id: string, name: string, value: string, custom = false): InputItem[] {
  return [{ type: 'message', role: MessageRole.ASSISTANT, content: [custom
    ? { type: ContentType.CUSTOM_TOOL_USE, id, name, input: 'source' }
    : { type: ContentType.TOOL_USE, id, name, arguments: '{}' }] },
  custom ? { type: 'custom_tool_call_output', call_id: id, output: value }
    : { type: 'function_call_output', call_id: id, output: value }];
}
function storageFixture(): IContextStorage {
  let stored: StoredContextSession | null = null;
  return { save: async (sessionId, state) => {
    stored = { version: 1, sessionId, createdAt: '', lastSavedAt: '', metadata: {}, state: structuredClone(state) };
  }, load: async () => stored, exists: async () => stored !== null, delete: async () => { stored = null; },
  list: async () => [], getPath: () => 'memory://spill' };
}

describe('Stage 01 second corrective pass: spill identity and error accounting', () => {
  for (const mode of ['prepare', 'consolidate'] as const) {
    it.each([
      ['full IDs', 'first-12345678', 'lookup', 'second-12345678', 'lookup', false, 'function'],
      ['namespaces', 'shared-12345678', 'lookup', 'shared-12345678', 'lookup', true, 'custom'],
      ['sanitized names', 'first-12345678', 'get-order', 'second-12345678', 'get_order', false, 'function'],
    ] as const)(`${mode} keeps both sources across separate spills with colliding %s`, async (_label, firstId, firstName, secondId, secondName, custom, namespace) => {
      const storage = storageFixture();
      const first = create(storage); const memory = new WorkingMemoryPluginNextGen(); first.registerPlugin(memory);
      const firstValue = 'FIRST_SOURCE ' + 'evidence '.repeat(1300);
      const secondValue = 'SECOND_SOURCE ' + 'evidence '.repeat(1300);
      first.addInputItems(pair(firstId, firstName, firstValue));
      const compact = async (context: AgentContextNextGen) => {
        if (mode === 'prepare') { context.addUserMessage('Continue'); await context.prepare(); }
        else await context.consolidate();
      };
      await compact(first);
      const base = `raw.tool_result.${firstName.replace(/[^a-zA-Z0-9_]/g, '_')}.12345678`;
      expect(await memory.retrieve(base)).toBe(firstValue);
      // Exercise an additional pass in the same context, then a restored pass.
      first.addInputItems(pair(secondId, secondName, secondValue, custom)); await compact(first);
      expect(await memory.retrieve(base)).toBe(firstValue);
      expect(await memory.retrieve(`${base}.${namespace}.1`)).toBe(secondValue);
      expect(first.getConversation()).toHaveLength(0);
      await first.save('spill'); const restored = create(storage);
      const restoredMemory = new WorkingMemoryPluginNextGen(); restored.registerPlugin(restoredMemory);
      expect(await restored.load('spill')).toBe(true);
      restored.addInputItems(pair(secondId, secondName, 'THIRD_SOURCE ' + 'evidence '.repeat(1300), custom));
      await compact(restored);
      expect(await restoredMemory.retrieve(base)).toBe(firstValue);
      expect(await restoredMemory.retrieve(`${base}.${namespace}.1`)).toBe(secondValue);
      expect(await restoredMemory.retrieve(`${base}.${namespace}.2`)).toContain('THIRD_SOURCE');
      const read = await restored.tools.execute('store_get', { store: 'notes', key: base }) as { entry: { value: unknown } };
      expect(read.entry.value).toBe(firstValue);
    });
  }

  it('preserves preexisting suffix entries and their descriptions', async () => {
    const context = create(); const memory = new WorkingMemoryPluginNextGen(); context.registerPlugin(memory);
    await memory.store('tool_result.lookup.12345678', 'Original source', 'ORIGINAL', { tier: 'raw' });
    await memory.store('tool_result.lookup.12345678.function.1', 'Another source', 'OTHER', { tier: 'raw' });
    context.addInputItems(pair('next-12345678', 'lookup', 'NEXT ' + 'evidence '.repeat(1300)));
    await context.consolidate();
    expect(await memory.retrieve('raw.tool_result.lookup.12345678')).toBe('ORIGINAL');
    expect(await memory.retrieve('raw.tool_result.lookup.12345678.function.1')).toBe('OTHER');
    expect(await memory.retrieve('raw.tool_result.lookup.12345678.function.2')).toContain('NEXT');
    expect((await memory.query({})).entries.find(entry => entry.key === 'raw.tool_result.lookup.12345678')!.description).toBe('Original source');
  });

  it('retries a failed partial spill without overwriting the earlier write', async () => {
    const context = create(); const memory = new WorkingMemoryPluginNextGen(); context.registerPlugin(memory);
    const original = memory.store.bind(memory); let fail = true;
    vi.spyOn(memory, 'store').mockImplementation(async (key, ...args) => {
      if (fail && key.endsWith('22222222')) throw new Error('write failed');
      return original(key, ...args);
    });
    context.addInputItems([...pair('call-11111111', 'lookup', 'FIRST ' + 'evidence '.repeat(1300)),
      ...pair('call-22222222', 'lookup', 'SECOND ' + 'evidence '.repeat(1300))]);
    await expect(context.consolidate()).rejects.toThrow('write failed');
    expect(context.getConversation()).toHaveLength(4);
    fail = false; await context.consolidate();
    expect(context.getConversation()).toHaveLength(0);
    expect(await memory.retrieve('raw.tool_result.lookup.11111111')).toContain('FIRST');
    expect(await memory.retrieve('raw.tool_result.lookup.11111111.function.1')).toContain('FIRST');
    expect(await memory.retrieve('raw.tool_result.lookup.22222222')).toContain('SECOND');
  });

  it('retains history when storage returns a different value under the new key', async () => {
    const context = create(); const memory = new WorkingMemoryPluginNextGen(); context.registerPlugin(memory);
    vi.spyOn(memory, 'retrieve').mockResolvedValue('UNRELATED_SOURCE');
    context.addInputItems(pair('call-12345678', 'lookup', 'EXPECTED ' + 'evidence '.repeat(1300)));
    await expect(context.consolidate()).rejects.toThrow('working memory did not retain');
    expect(context.getConversation()).toHaveLength(2);
  });

  it('counts the exact error text Anthropic sends for an empty function result', async () => {
    const context = create(undefined, 1000);
    context.addInputItems(pair('call-error', 'lookup', '').slice(0, 1));
    context.addToolResults([{ tool_use_id: 'call-error', content: '', error: 'fitting diagnostic', state: ToolCallState.FAILED }]);
    const prepared = await context.prepare();
    const request = { model: 'claude-haiku-4-5-20251001', input: prepared.input, tools: prepared.tools, max_output_tokens: 100 };
    const checked = context.validateRequestBudget(request);
    const wire = new AnthropicConverter().convertRequest(request);
    const result = wire.messages.flatMap(message => typeof message.content === 'string' ? [] : message.content)
      .find(block => block.type === 'tool_result');
    expect(result).toMatchObject({ type: 'tool_result', content: 'fitting diagnostic', is_error: true });
    expect(checked.currentInputTokens).toBeGreaterThanOrEqual(simpleTokenEstimator.estimateTokens('fitting diagnostic'));
    const oversized = structuredClone(request);
    const pending = oversized.input.at(-1)!;
    if (pending.type !== 'message' || pending.content[0]!.type !== ContentType.TOOL_RESULT) throw new Error('Invalid fixture');
    pending.content[0]!.error = 'ERROR_DIAGNOSTIC '.repeat(1000);
    expect(() => context.validateRequestBudget(oversized)).toThrow('Context overflow');
    expect(() => context.validateRequestBudget(oversized, { recordPreparation: false })).toThrow('Context overflow');
    context.addToolResults([{ tool_use_id: 'call-error', content: '', error: pending.content[0]!.error, state: ToolCallState.FAILED }]);
    await expect(context.prepare()).rejects.toThrow('Context overflow');
    expect(context.getConversation()).toHaveLength(1);
    expect(JSON.stringify(context.getCurrentInput())).toContain('ERROR_DIAGNOSTIC');
  });

  it.each(['', 'diagnostic'])('counts content, error and attached images without losing fields (error=%s)', async error => {
    const context = create(); await context.prepare();
    const input: InputItem[] = [{ type: 'message', role: MessageRole.ASSISTANT, content: [
      { type: ContentType.TOOL_USE, id: 'attached', name: 'lookup', arguments: '{}' }] },
    { type: 'message', role: MessageRole.USER, content: [{ type: ContentType.TOOL_RESULT, tool_use_id: 'attached',
      content: 'partial result', error, __images: [{ base64: 'BYTES', mediaType: 'image/png' }] }] }];
    const withoutError = structuredClone(input);
    const block = withoutError[1]!;
    if (block.type !== 'message' || block.content[0]!.type !== ContentType.TOOL_RESULT) throw new Error('Invalid fixture');
    delete block.content[0]!.error;
    const checked = context.validateRequestBudget({ input });
    const baseline = context.validateRequestBudget({ input: withoutError }, { recordPreparation: false });
    expect(checked.totalUsed - baseline.totalUsed).toBe(simpleTokenEstimator.estimateTokens(error));
    expect(checked.totalUsed).toBeGreaterThan(1000);
    expect(JSON.stringify(input)).toContain('BYTES');
  });

  it('compacts historical error payloads while preserving a small pending result', async () => {
    const context = create(undefined, 1000); context.setCompactionStrategy(new DefaultCompactionStrategy());
    context.addInputItems(pair('old-error', 'lookup', '').map(item => {
      if (item.type === 'function_call_output') return { type: 'message', role: MessageRole.USER,
        content: [{ type: ContentType.TOOL_RESULT, tool_use_id: item.call_id, content: '', error: 'old diagnostics '.repeat(1000) }] };
      return item;
    }));
    context.addUserMessage('Continue'); const prepared = await context.prepare();
    expect(prepared.compacted).toBe(true); expect(context.getConversation()).toHaveLength(0);
    expect(prepared.budget.available).toBeGreaterThanOrEqual(0);
  });
});
