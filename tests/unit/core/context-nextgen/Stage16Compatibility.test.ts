import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentContextNextGen } from '@/core/context-nextgen/AgentContextNextGen.js';
import { BasePluginNextGen } from '@/core/context-nextgen/BasePluginNextGen.js';
import { ContentType } from '@/domain/entities/Content.js';
import { MessageRole } from '@/domain/entities/Message.js';
import type { ICompactionStrategy } from '@/core/context-nextgen/types.js';
import type { IContextStorage, StoredContextSession } from '@/domain/interfaces/IContextStorage.js';

// Deliberately old-shaped implementations: no new optional compaction members.
class ExistingPlugin extends BasePluginNextGen {
  readonly name = 'existing-plugin';
  value = 'KEEP_THIS_STATE';
  getInstructions(): string { return 'Existing plugin instructions.'; }
  async getContent(): Promise<string> { return this.value; }
  getContents(): unknown { return this.value; }
  getState(): unknown { return { value: this.value }; }
  restoreState(state: unknown): void { this.value = (state as { value: string }).value; }
}
const contexts: AgentContextNextGen[] = [];
afterEach(() => { contexts.splice(0).forEach(context => context.destroy()); vi.useRealTimers(); });

describe('Stage 16 pinned existing context contracts', () => {
  it('keeps instance precedence, shared tools and old storage/plugin session round-trips', async () => {
    // The production prompt intentionally includes live time; round-trip equality
    // concerns state, so keep Date stable without changing asynchronous timers.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-22T10:00:00Z'));
    let saved: StoredContextSession | null = null;
    const storage: IContextStorage = {
      getPath: () => 'memory://old-adapter',
      save: async (sessionId, state, metadata = {}) => { saved = { version: 1, sessionId,
        createdAt: '2026-10-22T00:00:00Z', lastSavedAt: '2026-10-22T00:00:00Z', state: JSON.parse(JSON.stringify(state)), metadata }; },
      load: async () => saved, delete: async () => {}, exists: async () => !!saved, list: async () => [],
    };
    const compact = vi.fn(async () => ({ tokensFreed: 0, messagesRemoved: 0, pluginsCompacted: [], log: [] }));
    const strategy: ICompactionStrategy = { name: 'existing-custom', displayName: 'Existing', description: 'Old interface', threshold: .75,
      compact, consolidate: async () => ({ performed: false, tokensChanged: 0, actions: [] }) };
    const create = () => { const context = AgentContextNextGen.create({ model: 'gpt-4o-mini', strategy: 'unregistered-and-ignored',
      compactionStrategy: strategy, storage, features: { workingMemory: false, inContextMemory: false } }); contexts.push(context); return context; };
    const context = create(), plugin = new ExistingPlugin(); context.registerPlugin(plugin);
    context.addUserMessage('ORIGINAL_USER');
    context.addAssistantResponse([{ type: 'message', role: MessageRole.ASSISTANT, content: [{ type: ContentType.OUTPUT_TEXT, text: 'ORIGINAL_ANSWER' }] }]);
    const events: string[] = [];
    context.on('budget:updated', () => events.push('budget'));
    context.on('context:prepared', () => events.push('prepared'));
    const prepared = await context.prepare();
    expect(context.compactionStrategy).toBe(strategy); expect(compact).not.toHaveBeenCalled();
    expect(events).toEqual(['budget', 'prepared']);
    expect(prepared).toMatchObject({ compacted: false, compactionLog: [], tools: [] });
    expect(context.lastPreparation).not.toHaveProperty('compactionDetails');
    expect(JSON.stringify(prepared.input)).toContain('KEEP_THIS_STATE');
    expect(context.tools).toBe(context.tools);
    await context.save('old-session');
    expect(saved!.version).toBe(1); expect(saved!.state).not.toHaveProperty('nativeContinuation');
    const next = create(), restored = new ExistingPlugin(); restored.value = 'WRONG'; next.registerPlugin(restored);
    await expect(next.load('old-session')).resolves.toBe(true);
    expect(restored.value).toBe('KEEP_THIS_STATE');
    expect(JSON.stringify(next.getConversation())).toContain('ORIGINAL_USER');
    expect(JSON.stringify(next.getConversation())).toContain('ORIGINAL_ANSWER');
    expect((await next.prepare()).input).toEqual(prepared.input);
  });
});
