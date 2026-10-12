import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentContextNextGen } from '@/core/context-nextgen/AgentContextNextGen.js';
import { simpleTokenEstimator } from '@/core/context-nextgen/BasePluginNextGen.js';
import { WorkingMemoryPluginNextGen } from '@/core/context-nextgen/plugins/WorkingMemoryPluginNextGen.js';
import { ContentType } from '@/domain/entities/Content.js';
import { ToolCallState } from '@/domain/entities/Tool.js';
import { MessageRole } from '@/domain/entities/Message.js';
import type { InputItem, Message } from '@/domain/entities/Message.js';
import type { IContextStorage, StoredContextSession } from '@/domain/interfaces/IContextStorage.js';

const contexts: AgentContextNextGen[] = [];
afterEach(() => { contexts.splice(0).forEach(context => context.destroy()); });
function create(maxContextTokens = 3000, storage?: IContextStorage) {
  const context = AgentContextNextGen.create({ model: 'gpt-4o-mini', maxContextTokens, responseReserve: 100,
    features: { workingMemory: false, inContextMemory: false }, storage });
  contexts.push(context); return context;
}
function fixture(custom = false, nativeFirst = false): InputItem[] {
  const calls: Message = { type: 'message', role: MessageRole.ASSISTANT, content: ['source-a01', 'source-b01'].map(id =>
    custom ? { type: ContentType.CUSTOM_TOOL_USE, id, name: 'lookup', input: 'source' }
      : { type: ContentType.TOOL_USE, id, name: 'lookup', arguments: '{}' }) };
  return [calls, ...['source-a01', 'source-b01'].map((id, index): InputItem => {
    const value = index === 0 ? 'large evidence '.repeat(700) : 'UNIQUE_NATIVE_EVIDENCE';
    if ((index === 0) === nativeFirst) return { type: custom ? 'custom_tool_call_output' : 'function_call_output', call_id: id, output: value };
    return { type: 'message', role: MessageRole.USER, content: [custom
      ? { type: ContentType.CUSTOM_TOOL_RESULT, tool_use_id: id, content: value }
      : { type: ContentType.TOOL_RESULT, tool_use_id: id, content: value }] };
  })];
}
describe('Stage 01 corrective regressions', () => {
  it.each([[false, false], [false, true], [true, false], [true, true]])(
    'stores every connected result before removing mixed formats (custom=%s, native first=%s)', async (custom, nativeFirst) => {
      const context = create();
      const memory = new WorkingMemoryPluginNextGen(); context.registerPlugin(memory);
      context.addInputItems(fixture(custom, nativeFirst)); context.addUserMessage('Continue with both sources');
      const prepared = await context.prepare();
      expect(prepared.compacted).toBe(true);
      expect(await memory.retrieve('raw.tool_result.lookup.urce-a01')).toBe('large evidence '.repeat(700));
      expect(await memory.retrieve('raw.tool_result.lookup.urce-b01')).toBe('UNIQUE_NATIVE_EVIDENCE');
      expect(context.getConversation()).toHaveLength(0);
      expect(prepared.compactionLog.join(' ')).toContain('Removed 3 messages');
    });

  it('retains the entire connected group when a later storage write fails', async () => {
    const context = create();
    const memory = new WorkingMemoryPluginNextGen(); context.registerPlugin(memory);
    const store = memory.store.bind(memory);
    vi.spyOn(memory, 'store').mockImplementation(async (key, ...args) => {
      if (key.endsWith('urce-b01')) throw new Error('storage unavailable');
      return store(key, ...args);
    });
    context.addInputItems(fixture()); context.addUserMessage('Continue');
    await expect(context.prepare()).rejects.toThrow('storage unavailable');
    expect(context.getConversation()).toHaveLength(3);
  });

  it('counts function-call replay signatures with the same local estimate as thinking signatures', async () => {
    const context = create(1000);
    const signature = 'opaque-signature-'.repeat(1000);
    const prepared = await context.prepare();
    const input: InputItem[] = [
      { type: 'message', role: MessageRole.ASSISTANT, content: [{ type: ContentType.TOOL_USE,
        id: 'signature-call', name: 'lookup', arguments: '{}', async: true, thoughtSignature: signature }] },
    ];
    expect(() => context.validateRequestBudget({ input, tools: prepared.tools })).toThrow('Context overflow');
    context.addInputItems(input); context.addUserMessage('Continue');
    await expect(context.prepare()).rejects.toThrow('Context overflow');
    expect(simpleTokenEstimator.estimateTokens(signature)).toBeGreaterThan(1000);
  });

  it('preserves native multimodal arrays and message attachments in the spill', async () => {
    const context = create(); const memory = new WorkingMemoryPluginNextGen(); context.registerPlugin(memory);
    const history = fixture();
    const attached = history[1] as Message;
    const block = attached.content[0]!;
    if (block.type !== ContentType.TOOL_RESULT) throw new Error('Invalid fixture');
    block.__images = [{ base64: 'IMAGE_BYTES', mediaType: 'image/png' }]; block.error = 'partial result';
    const native = history[2]!;
    if (native.type !== 'function_call_output') throw new Error('Invalid fixture');
    native.output = [{ type: ContentType.INPUT_TEXT, text: 'native evidence' },
      { type: ContentType.INPUT_IMAGE_URL, image_url: { url: 'data:image/png;base64,IMAGE_BYTES', detail: 'low' } },
      { type: ContentType.INPUT_FILE, file_id: 'file-evidence' }];
    context.addInputItems(history); context.addUserMessage('Continue'); await context.prepare();
    expect(await memory.retrieve('raw.tool_result.lookup.urce-a01')).toEqual({ content: block.content,
      __images: block.__images, error: 'partial result' });
    expect(await memory.retrieve('raw.tool_result.lookup.urce-b01')).toEqual(native.output);
  });

  it('protects an entire mixed group whose native result is pending', async () => {
    const context = create(); const memory = new WorkingMemoryPluginNextGen(); context.registerPlugin(memory);
    const history = fixture(); context.addInputItems(history.slice(0, 2));
    const native = history[2]!; if (native.type !== 'function_call_output') throw new Error('Invalid fixture');
    context.addToolResults([{ tool_use_id: native.call_id, content: native.output, state: ToolCallState.COMPLETED }]);
    await expect(context.prepare()).rejects.toThrow('Context overflow');
    expect(context.getConversation()).toHaveLength(2);
    expect(await memory.retrieve('raw.tool_result.lookup.urce-a01')).toBeUndefined();
  });

  it('retains unrepresentable native content through consolidation and rolling compaction', async () => {
    const context = create(); const memory = new WorkingMemoryPluginNextGen(); context.registerPlugin(memory);
    const history = fixture(); const native = history[2]!;
    if (native.type !== 'function_call_output') throw new Error('Invalid fixture');
    native.output = undefined as unknown as string;
    context.addInputItems(history); context.addUserMessage('Continue');
    await expect(context.prepare()).rejects.toThrow('Context overflow');
    expect(context.getConversation()).toHaveLength(3);
  });

  it('keeps identical IDs in function and custom namespaces recoverable under different keys', async () => {
    const context = create(); const memory = new WorkingMemoryPluginNextGen(); context.registerPlugin(memory);
    const calls: Message = { type: 'message', role: MessageRole.ASSISTANT, content: [
      { type: ContentType.TOOL_USE, id: 'shared01', name: 'lookup', arguments: '{}' },
      { type: ContentType.CUSTOM_TOOL_USE, id: 'shared01', name: 'lookup', input: 'source' }] };
    context.addInputItems([calls, { type: 'function_call_output', call_id: 'shared01', output: 'large evidence '.repeat(700) },
      { type: 'custom_tool_call_output', call_id: 'shared01', output: 'custom evidence' }]);
    context.addUserMessage('Continue'); await context.prepare();
    expect(await memory.retrieve('raw.tool_result.lookup.shared01')).toBe('large evidence '.repeat(700));
    expect(await memory.retrieve('raw.tool_result.lookup.shared01.custom.1')).toBe('custom evidence');
  });

  it('does not replace the prepared revision or request when checking an auxiliary call', async () => {
    const context = create(); context.addUserMessage('selected'); const prepared = await context.prepare();
    const selected = context.lastPreparation; const events = vi.fn(); context.on('budget:updated', events);
    const request = { input: 'Auxiliary output', instructions: 'Return JSON' };
    const checked = context.validateRequestBudget(request, { recordPreparation: false });
    expect(checked.totalUsed).not.toBe(prepared.budget.totalUsed);
    expect(context.lastPreparation).toEqual(selected);
    expect(context.getCurrentInput()).toHaveLength(1);
    expect(events).not.toHaveBeenCalled(); expect(request.input).toBe('Auxiliary output');
  });

  it('counts schema and hosted tool overhead while keeping explicit host limits', async () => {
    const context = create(1000); await context.prepare();
    expect(() => context.validateRequestBudget({ input: 'hello', model: 'gpt-4.1', response_format: {
      type: 'json_schema', json_schema: { description: 'schema '.repeat(600) } } })).toThrow('Context overflow');
    const checked = context.validateRequestBudget({ input: 'hello', model: 'gpt-4.1', native_tools: [{ capability: 'web_search' }] });
    expect(checked.maxTokens).toBe(1000); expect(checked.toolsTokens).toBeGreaterThan(0);
  });

  it('uses provider metadata for custom models and preserves unknown-model fallbacks', async () => {
    const context = create(1000); await context.prepare();
    expect(context.validateRequestBudget({ input: 'hello', model: 'custom' }, { modelMaxContextTokens: 800 }).maxTokens).toBe(800);
    expect(context.validateRequestBudget({ input: 'hello', model: 'unknown' }).maxTokens).toBe(1000);
    expect(context.maxContextTokens).toBe(1000);
  });

  it('stores mixed results during consolidation before the first preparation', async () => {
    const context = create(); const memory = new WorkingMemoryPluginNextGen(); context.registerPlugin(memory);
    context.addInputItems(fixture());
    expect((await context.consolidate()).performed).toBe(true);
    expect(await memory.retrieve('raw.tool_result.lookup.urce-b01')).toBe('UNIQUE_NATIVE_EVIDENCE');
    expect(context.lastPreparation).toBeNull();
  });

  it('retains history if a later write evicts an earlier spilled result', async () => {
    const context = create(); const memory = new WorkingMemoryPluginNextGen(); context.registerPlugin(memory);
    const original = memory.store.bind(memory);
    vi.spyOn(memory, 'store').mockImplementation(async (key, ...args) => {
      if (key.endsWith('urce-b01')) await memory.delete('raw.tool_result.lookup.urce-a01');
      return original(key, ...args);
    });
    context.addInputItems(fixture()); context.addUserMessage('Continue');
    await expect(context.prepare()).rejects.toThrow('working memory did not retain');
    expect(context.getConversation()).toHaveLength(3);
  });

  it('protects an unresolved async call sharing a completed native group', async () => {
    const context = create(); const memory = new WorkingMemoryPluginNextGen(); context.registerPlugin(memory);
    const history = fixture(false, true);
    const calls = history[0] as Message;
    const unfinished = calls.content[1]!; if (unfinished.type !== ContentType.TOOL_USE) throw new Error('Invalid fixture');
    unfinished.async = true;
    context.addInputItems(history.slice(0, 2)); context.addUserMessage('Continue');
    await expect(context.prepare()).rejects.toThrow('Context overflow');
    expect(context.getConversation()).toHaveLength(2);
  });

  it('accounts for small tool and thinking signatures identically and preserves their bytes through save/load', async () => {
    let saved: StoredContextSession | null = null;
    const storage: IContextStorage = { save: async (sessionId, state) => {
      saved = { version: 1, sessionId, createdAt: '', lastSavedAt: '', metadata: {}, state: structuredClone(state) };
    }, load: async () => saved, delete: async () => { saved = null; }, exists: async () => saved !== null, list: async () => [], getPath: () => 'memory://signed-session' };
    const context = create(3000, storage); const signature = 'opaque-signature-preserved';
    const calls: Message = { type: 'message', role: MessageRole.ASSISTANT, content: [{ type: ContentType.TOOL_USE,
      id: 'signed01', name: 'lookup', arguments: '{}', thoughtSignature: signature }] };
    context.addInputItems([calls, { type: 'function_call_output', call_id: 'signed01', output: 'evidence' }]);
    context.addUserMessage('Continue'); const prepared = await context.prepare();
    const withSignature = context.validateRequestBudget({ input: prepared.input });
    const without = structuredClone(prepared.input); const unsigned = (without[1] as Message).content[0]!;
    if (unsigned.type !== ContentType.TOOL_USE) throw new Error('Invalid fixture'); delete unsigned.thoughtSignature;
    const noSignature = context.validateRequestBudget({ input: without }, { recordPreparation: false });
    expect(withSignature.totalUsed - noSignature.totalUsed).toBe(simpleTokenEstimator.estimateTokens(signature));
    const thinking = structuredClone(without); (thinking[1] as Message).content.push({ type: ContentType.THINKING,
      thinking: '', signature, persistInHistory: true });
    const inThinking = context.validateRequestBudget({ input: thinking }, { recordPreparation: false });
    const unsignedThinking = structuredClone(thinking); const block = (unsignedThinking[1] as Message).content.at(-1)!;
    if (block.type !== ContentType.THINKING) throw new Error('Invalid fixture'); delete block.signature;
    const noThinkingSignature = context.validateRequestBudget({ input: unsignedThinking }, { recordPreparation: false });
    expect(inThinking.totalUsed - noThinkingSignature.totalUsed).toBe(withSignature.totalUsed - noSignature.totalUsed);
    await context.save('signed-session'); const restored = create(3000, storage);
    expect(await restored.load('signed-session')).toBe(true); restored.addUserMessage('Continue');
    const replay = await restored.prepare();
    expect(JSON.stringify(replay.input)).toContain(signature);
    expect(replay.budget.conversationTokens).toBe(prepared.budget.conversationTokens);
  });
});
