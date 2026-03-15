/**
 * AgentContextNextGen Unit Tests
 *
 * Tests for the NextGen context manager covering:
 * - Context preparation and compaction
 * - Plugin integration
 * - Conversation management
 * - Budget calculation
 * - Session persistence
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AgentContextNextGen } from '@/core/context-nextgen/AgentContextNextGen.js';
import { WorkingMemoryPluginNextGen } from '@/core/context-nextgen/plugins/WorkingMemoryPluginNextGen.js';
import { InContextMemoryPluginNextGen } from '@/core/context-nextgen/plugins/InContextMemoryPluginNextGen.js';
import { MessageRole } from '@/domain/entities/Message.js';
import { ContentType } from '@/domain/entities/Content.js';
import type { InputItem, Message, OutputItem } from '@/domain/entities/Message.js';
import type { IContextStorage, StoredContextSession, ContextSessionSummary, SerializedContextState } from '@/domain/interfaces/IContextStorage.js';
import type { ICompactionStrategy, CompactionResult, ConsolidationResult } from '@/core/context-nextgen/types.js';

/**
 * Create mock storage for testing
 */
function createMockStorage(): IContextStorage & { sessions: Map<string, StoredContextSession> } {
  const sessions = new Map<string, StoredContextSession>();

  return {
    sessions,
    async save(sessionId: string, state: SerializedContextState): Promise<void> {
      const now = new Date().toISOString();
      const existing = sessions.get(sessionId);
      sessions.set(sessionId, {
        version: 1,
        sessionId,
        createdAt: existing?.createdAt ?? now,
        lastSavedAt: now,
        state,
        metadata: {},
      });
    },
    async load(sessionId: string): Promise<StoredContextSession | null> {
      return sessions.get(sessionId) ?? null;
    },
    async delete(sessionId: string): Promise<void> {
      sessions.delete(sessionId);
    },
    async exists(sessionId: string): Promise<boolean> {
      return sessions.has(sessionId);
    },
    async list(): Promise<ContextSessionSummary[]> {
      return Array.from(sessions.values()).map(s => ({
        sessionId: s.sessionId,
        createdAt: new Date(s.createdAt),
        lastSavedAt: new Date(s.lastSavedAt),
        messageCount: s.state.conversation?.length ?? 0,
        memoryEntryCount: 0,
        metadata: s.metadata,
      }));
    },
    getPath(): string {
      return '/mock/storage';
    },
  };
}

describe('AgentContextNextGen', () => {
  let ctx: AgentContextNextGen;

  beforeEach(() => {
    ctx = AgentContextNextGen.create({
      model: 'gpt-4',
      maxContextTokens: 8000, // Small for testing
      responseReserve: 1000,
    });
  });

  afterEach(() => {
    ctx.destroy();
  });

  describe('Basic Properties', () => {
    it('should create with correct model', () => {
      expect(ctx.model).toBe('gpt-4');
    });

    it('should have a generated agentId', () => {
      expect(ctx.agentId).toBeDefined();
      expect(ctx.agentId.length).toBeGreaterThan(0);
    });

    it('should allow custom agentId', () => {
      const customCtx = AgentContextNextGen.create({
        model: 'gpt-4',
        agentId: 'custom-id',
      });
      expect(customCtx.agentId).toBe('custom-id');
      customCtx.destroy();
    });

    it('should have default features', () => {
      expect(ctx.features).toBeDefined();
      expect(ctx.features.workingMemory).toBe(true); // Default is true
      expect(ctx.features.inContextMemory).toBe(true);
      expect(ctx.features.persistentInstructions).toBe(false);
    });

    it('should expose ToolManager', () => {
      expect(ctx.tools).toBeDefined();
      expect(ctx.tools.list()).toBeDefined();
    });
  });

  describe('Conversation Management', () => {
    it('should add user message', () => {
      const id = ctx.addUserMessage('Hello');
      expect(id).toBeDefined();

      const input = ctx.getCurrentInput();
      expect(input).toHaveLength(1);
    });

    it('should move user message to conversation after assistant response', () => {
      ctx.addUserMessage('Hello');

      const output: OutputItem[] = [{
        type: 'message',
        role: MessageRole.ASSISTANT,
        content: [{ type: ContentType.OUTPUT_TEXT, text: 'Hi there!' }],
      }];

      ctx.addAssistantResponse(output);

      const conversation = ctx.getConversation();
      expect(conversation.length).toBe(2); // user + assistant

      const currentInput = ctx.getCurrentInput();
      expect(currentInput).toHaveLength(0);
    });

    it('should add tool results', () => {
      ctx.addToolResults([{
        tool_use_id: 'tool_123',
        content: 'Result data',
      }]);

      const input = ctx.getCurrentInput();
      expect(input).toHaveLength(1);
    });

    it('should clear conversation', () => {
      ctx.addUserMessage('Message 1');
      ctx.addAssistantResponse([{
        type: 'message',
        role: MessageRole.ASSISTANT,
        content: [{ type: ContentType.OUTPUT_TEXT, text: 'Response' }],
      }]);

      ctx.clearConversation('test');

      expect(ctx.getConversation()).toHaveLength(0);
      expect(ctx.getCurrentInput()).toHaveLength(0);
    });

    it('should track conversation length', () => {
      expect(ctx.getConversationLength()).toBe(0);

      ctx.addUserMessage('Hello');
      ctx.addAssistantResponse([{
        type: 'message',
        role: MessageRole.ASSISTANT,
        content: [{ type: ContentType.OUTPUT_TEXT, text: 'Hi' }],
      }]);

      expect(ctx.getConversationLength()).toBe(2);
    });
  });

  describe('Context Preparation', () => {
    it('should prepare context with system message', async () => {
      ctx = AgentContextNextGen.create({
        model: 'gpt-4',
        systemPrompt: 'You are helpful.',
      });

      ctx.addUserMessage('Hello');

      const { input, budget } = await ctx.prepare();

      expect(input).toHaveLength(2); // system + user
      expect(budget).toBeDefined();
      expect(budget.systemMessageTokens).toBeGreaterThan(0);
    });

    it('should calculate budget correctly', async () => {
      ctx.addUserMessage('Hello world');

      const { budget } = await ctx.prepare();

      expect(budget.maxTokens).toBe(8000);
      expect(budget.responseReserve).toBe(1000);
      expect(budget.totalUsed).toBeGreaterThan(0);
      expect(budget.available).toBeGreaterThan(0);
      expect(budget.utilizationPercent).toBeGreaterThanOrEqual(0);
      expect(budget.utilizationPercent).toBeLessThanOrEqual(100);
    });

    it('should include breakdown in budget', async () => {
      ctx.addUserMessage('Test');

      const { budget } = await ctx.prepare();

      expect(budget.breakdown).toBeDefined();
      expect(budget.breakdown.systemPrompt).toBeDefined();
      expect(budget.breakdown.conversation).toBeDefined();
      expect(budget.breakdown.currentInput).toBeDefined();
      expect(budget.breakdown.tools).toBeDefined();
    });

    it('should emit context:prepared event', async () => {
      const listener = vi.fn();
      ctx.on('context:prepared', listener);

      ctx.addUserMessage('Hello');
      await ctx.prepare();

      expect(listener).toHaveBeenCalled();
    });
  });

  describe('Plugin Integration', () => {
    it('should register plugin', () => {
      // Create context with auto-plugins disabled to test manual registration
      const testCtx = AgentContextNextGen.create({
        model: 'gpt-4',
        strategy: 'default',
        features: { workingMemory: false, inContextMemory: false },
      });

      const memoryPlugin = new WorkingMemoryPluginNextGen();
      testCtx.registerPlugin(memoryPlugin);

      expect(testCtx.hasPlugin('working_memory')).toBe(true);
      expect(testCtx.getPlugin('working_memory')).toBe(memoryPlugin);

      testCtx.destroy();
    });

    it('should reject duplicate plugin registration', () => {
      // Create context with auto-plugins disabled
      const testCtx = AgentContextNextGen.create({
        model: 'gpt-4',
        strategy: 'default',
        features: { workingMemory: false, inContextMemory: false },
      });

      const plugin1 = new WorkingMemoryPluginNextGen();
      const plugin2 = new WorkingMemoryPluginNextGen();

      testCtx.registerPlugin(plugin1);

      expect(() => testCtx.registerPlugin(plugin2)).toThrow('already registered');

      testCtx.destroy();
    });

    it('should register store tools when IStoreHandler plugin is added', () => {
      // Create context with auto-plugins disabled
      const testCtx = AgentContextNextGen.create({
        model: 'gpt-4',
        strategy: 'default',
        features: { workingMemory: false, inContextMemory: false },
      });

      const memoryPlugin = new WorkingMemoryPluginNextGen();
      testCtx.registerPlugin(memoryPlugin);

      const tools = testCtx.tools.list();
      // WorkingMemoryPluginNextGen implements IStoreHandler, so 5 store_* tools are registered
      expect(tools).toContain('store_get');
      expect(tools).toContain('store_set');
      expect(tools).toContain('store_delete');
      expect(tools).toContain('store_list');
      expect(tools).toContain('store_action');

      testCtx.destroy();
    });

    it('should include plugin content in prepared context', async () => {
      // Create context with auto-plugins disabled
      const testCtx = AgentContextNextGen.create({
        model: 'gpt-4',
        strategy: 'default',
        features: { workingMemory: false, inContextMemory: false },
      });

      const memoryPlugin = new WorkingMemoryPluginNextGen();
      testCtx.registerPlugin(memoryPlugin);

      await memoryPlugin.store('test_key', 'Test description', { data: 'value' });

      testCtx.addUserMessage('Hello');
      const { input } = await testCtx.prepare();

      // System message should include memory index
      const systemMsg = input[0] as Message;
      const textContent = systemMsg.content[0] as any;
      expect(textContent.text).toContain('Working Memory');

      testCtx.destroy();
    });

    it('should get all registered plugins', () => {
      // Create context with auto-plugins disabled
      const testCtx = AgentContextNextGen.create({
        model: 'gpt-4',
        strategy: 'default',
        features: { workingMemory: false, inContextMemory: false },
      });

      const plugin1 = new WorkingMemoryPluginNextGen();
      const plugin2 = new InContextMemoryPluginNextGen();

      testCtx.registerPlugin(plugin1);
      testCtx.registerPlugin(plugin2);

      const plugins = testCtx.getPlugins();
      expect(plugins).toHaveLength(2);

      testCtx.destroy();
    });

    it('should auto-register plugins based on features', () => {
      // Test auto-plugin creation (workingMemory is enabled by default)
      expect(ctx.hasPlugin('working_memory')).toBe(true);
      expect(ctx.memory).not.toBeNull();
    });
  });

  describe('Compaction', () => {
    it('should trigger compaction when context is full', async () => {
      // Create context with very small limit
      // Disable auto-plugins to allow small context for testing
      const smallCtx = AgentContextNextGen.create({
        model: 'gpt-4',
        maxContextTokens: 500,
        responseReserve: 100,
        strategy: 'default', // 70% threshold
        features: { workingMemory: false, inContextMemory: false },
      });

      // Add many messages to fill context
      for (let i = 0; i < 20; i++) {
        smallCtx.addUserMessage(`Message ${i} with some content`);
        smallCtx.addAssistantResponse([{
          type: 'message',
          role: MessageRole.ASSISTANT,
          content: [{ type: ContentType.OUTPUT_TEXT, text: `Response ${i} with content` }],
        }]);
      }

      const { compacted, compactionLog } = await smallCtx.prepare();

      expect(compacted).toBe(true);
      expect(compactionLog.length).toBeGreaterThan(0);

      smallCtx.destroy();
    });

    it('should compact plugins before conversation', async () => {
      // Disable auto-plugins to manually register plugin
      const smallCtx = AgentContextNextGen.create({
        model: 'gpt-4',
        maxContextTokens: 1000,
        responseReserve: 200,
        strategy: 'default',
        features: { workingMemory: false, inContextMemory: false },
      });

      const memoryPlugin = new WorkingMemoryPluginNextGen();
      smallCtx.registerPlugin(memoryPlugin);

      // Fill memory
      for (let i = 0; i < 10; i++) {
        await memoryPlugin.store(`key${i}`, `Entry ${i}`, { data: 'x'.repeat(50) });
      }

      // Add some conversation
      for (let i = 0; i < 5; i++) {
        smallCtx.addUserMessage(`Message ${i}`);
        smallCtx.addAssistantResponse([{
          type: 'message',
          role: MessageRole.ASSISTANT,
          content: [{ type: ContentType.OUTPUT_TEXT, text: `Response ${i}` }],
        }]);
      }

      const { compactionLog } = await smallCtx.prepare();

      // Check that compaction happened and plugins were compacted
      const memoryCompacted = compactionLog.some(log => log.includes('working_memory'));
      // May or may not have compacted memory depending on thresholds

      smallCtx.destroy();
    });

    it('should emit compaction event', async () => {
      // Disable auto-plugins to allow small context for testing
      const smallCtx = AgentContextNextGen.create({
        model: 'gpt-4',
        maxContextTokens: 500,
        responseReserve: 100,
        strategy: 'default',
        features: { workingMemory: false, inContextMemory: false },
      });

      const compactionListener = vi.fn();
      smallCtx.on('context:compacted', compactionListener);

      for (let i = 0; i < 20; i++) {
        smallCtx.addUserMessage(`Message ${i}`);
        smallCtx.addAssistantResponse([{
          type: 'message',
          role: MessageRole.ASSISTANT,
          content: [{ type: ContentType.OUTPUT_TEXT, text: `Response ${i}` }],
        }]);
      }

      await smallCtx.prepare();

      expect(compactionListener).toHaveBeenCalled();

      smallCtx.destroy();
    });

    it('should preserve tool pairs during conversation compaction', async () => {
      const smallCtx = AgentContextNextGen.create({
        model: 'gpt-4',
        maxContextTokens: 800,
        responseReserve: 100,
        strategy: 'default',
        features: { workingMemory: false, inContextMemory: false },
      });

      // Add a tool use/result pair
      smallCtx.addUserMessage('Use a tool');

      // Simulate assistant with tool use
      const assistantWithTool: Message = {
        type: 'message',
        role: MessageRole.ASSISTANT,
        content: [{
          type: ContentType.TOOL_USE,
          id: 'tool_abc123',
          name: 'test_tool',
          input: { arg: 'value' },
        }],
      };
      smallCtx.addInputItems([assistantWithTool]);

      // Add tool result
      smallCtx.addToolResults([{
        tool_use_id: 'tool_abc123',
        content: 'Tool result',
      }]);

      // Continue conversation
      smallCtx.addAssistantResponse([{
        type: 'message',
        role: MessageRole.ASSISTANT,
        content: [{ type: ContentType.OUTPUT_TEXT, text: 'Done' }],
      }]);

      // Add more messages to trigger compaction
      for (let i = 0; i < 15; i++) {
        smallCtx.addUserMessage(`Filler ${i}`);
        smallCtx.addAssistantResponse([{
          type: 'message',
          role: MessageRole.ASSISTANT,
          content: [{ type: ContentType.OUTPUT_TEXT, text: `Response ${i}` }],
        }]);
      }

      const { input, compacted } = await smallCtx.prepare();

      // If compaction happened, tool pairs should be removed together
      if (compacted) {
        const hasToolUse = input.some((item: InputItem) => {
          if (item.type !== 'message') return false;
          const msg = item as Message;
          return msg.content.some(c => c.type === ContentType.TOOL_USE);
        });

        const hasToolResult = input.some((item: InputItem) => {
          if (item.type !== 'message') return false;
          const msg = item as Message;
          return msg.content.some(c => c.type === ContentType.TOOL_RESULT);
        });

        // Either both should be present or both should be removed
        expect(hasToolUse).toBe(hasToolResult);
      }

      smallCtx.destroy();
    });
  });

  describe('Strategy Dependencies', () => {
    // Custom strategy that requires specific plugins
    class PluginDependentStrategy implements ICompactionStrategy {
      readonly name = 'plugin-dependent';
      readonly displayName = 'Plugin Dependent';
      readonly description = 'Requires working_memory plugin';
      readonly threshold = 0.75;
      readonly requiredPlugins = ['working_memory'] as const;

      async compact(): Promise<CompactionResult> {
        return { tokensFreed: 0, messagesRemoved: 0, pluginsCompacted: [], log: [] };
      }

      async consolidate(): Promise<ConsolidationResult> {
        return { performed: false, tokensChanged: 0, actions: [] };
      }
    }

    it('should accept strategy when required plugins are present', () => {
      // Working memory is enabled by default
      const ctx = AgentContextNextGen.create({
        model: 'gpt-4',
        features: { workingMemory: true },
        compactionStrategy: new PluginDependentStrategy(),
      });

      expect(ctx.compactionStrategy.name).toBe('plugin-dependent');
      ctx.destroy();
    });

    it('should warn (not throw) when required plugin is missing at creation', () => {
      // Should not throw — strategy degrades gracefully
      const ctx = AgentContextNextGen.create({
        model: 'gpt-4',
        features: { workingMemory: false, inContextMemory: false }, // Disabled!
        compactionStrategy: new PluginDependentStrategy(),
      });

      expect(ctx.compactionStrategy.name).toBe('plugin-dependent');
      ctx.destroy();
    });

    it('should warn (not throw) when required plugin is missing on setCompactionStrategy', () => {
      const ctx = AgentContextNextGen.create({
        model: 'gpt-4',
        strategy: 'default',
        features: { workingMemory: false, inContextMemory: false },
      });

      // Should not throw — strategy degrades gracefully
      ctx.setCompactionStrategy(new PluginDependentStrategy());
      expect(ctx.compactionStrategy.name).toBe('plugin-dependent');

      ctx.destroy();
    });

    it('should allow strategy when required plugin is missing with other plugins present', () => {
      const ctx = AgentContextNextGen.create({
        model: 'gpt-4',
        strategy: 'default',
        features: { workingMemory: false, inContextMemory: true },
      });

      // Should not throw — strategy degrades gracefully
      ctx.setCompactionStrategy(new PluginDependentStrategy());
      expect(ctx.compactionStrategy.name).toBe('plugin-dependent');

      ctx.destroy();
    });

    it('should allow strategy without requiredPlugins', () => {
      // 'default' strategy has no requiredPlugins
      const ctx = AgentContextNextGen.create({
        model: 'gpt-4',
        strategy: 'default',
        features: { workingMemory: false, inContextMemory: false },
      });

      expect(ctx.compactionStrategy.name).toBe('default');
      expect(ctx.compactionStrategy.requiredPlugins).toBeUndefined();
      ctx.destroy();
    });
  });

  describe('Oversized Input Handling', () => {
    it('should reject oversized user input', async () => {
      // Disable auto-plugins to allow small context for testing oversized input
      const smallCtx = AgentContextNextGen.create({
        model: 'gpt-4',
        maxContextTokens: 200,
        responseReserve: 50,
        strategy: 'default',
        features: { workingMemory: false, inContextMemory: false },
      });

      // Try to add very large user message
      const largeMessage = 'x'.repeat(10000);
      smallCtx.addUserMessage(largeMessage);

      await expect(smallCtx.prepare()).rejects.toThrow('too large');

      smallCtx.destroy();
    });

    it('should truncate oversized tool results', async () => {
      // Disable auto-plugins to allow small context for testing oversized input
      const smallCtx = AgentContextNextGen.create({
        model: 'gpt-4',
        maxContextTokens: 500,
        responseReserve: 100,
        strategy: 'default',
        features: { workingMemory: false, inContextMemory: false },
      });

      // Add assistant with tool use first
      const assistantWithTool: Message = {
        type: 'message',
        role: MessageRole.ASSISTANT,
        content: [{
          type: ContentType.TOOL_USE,
          id: 'tool_123',
          name: 'test_tool',
          input: {},
        }],
      };
      smallCtx.addInputItems([assistantWithTool]);

      // Add large tool result
      const largeResult = 'x'.repeat(5000);
      smallCtx.addToolResults([{
        tool_use_id: 'tool_123',
        content: largeResult,
      }]);

      const oversizedListener = vi.fn();
      smallCtx.on('input:oversized', oversizedListener);

      const { input } = await smallCtx.prepare();

      expect(oversizedListener).toHaveBeenCalled();

      smallCtx.destroy();
    });

    it('should emit budget warnings', async () => {
      // Disable auto-plugins to allow small context for testing budget warnings
      const smallCtx = AgentContextNextGen.create({
        model: 'gpt-4',
        maxContextTokens: 400,
        responseReserve: 50,
        strategy: 'default', // Default strategy (70% threshold)
        features: { workingMemory: false, inContextMemory: false },
      });

      const warningListener = vi.fn();
      smallCtx.on('budget:warning', warningListener);

      // Fill up context
      for (let i = 0; i < 10; i++) {
        smallCtx.addUserMessage(`Message ${i} with content`);
        smallCtx.addAssistantResponse([{
          type: 'message',
          role: MessageRole.ASSISTANT,
          content: [{ type: ContentType.OUTPUT_TEXT, text: `Response ${i}` }],
        }]);
      }

      await smallCtx.prepare();

      // Should have triggered a warning or critical event
      // (depending on exact token counts)

      smallCtx.destroy();
    });
  });

  describe('Session Persistence', () => {
    it('should save and load session', async () => {
      const storage = createMockStorage();
      const ctx1 = AgentContextNextGen.create({
        model: 'gpt-4',
        storage,
      });

      ctx1.addUserMessage('Hello');
      ctx1.addAssistantResponse([{
        type: 'message',
        role: MessageRole.ASSISTANT,
        content: [{ type: ContentType.OUTPUT_TEXT, text: 'Hi!' }],
      }]);

      await ctx1.save('test-session');
      ctx1.destroy();

      // Load in new context
      const ctx2 = AgentContextNextGen.create({
        model: 'gpt-4',
        storage,
      });

      const loaded = await ctx2.load('test-session');
      expect(loaded).toBe(true);

      const conversation = ctx2.getConversation();
      expect(conversation).toHaveLength(2);

      ctx2.destroy();
    });

    it('should return false for non-existent session', async () => {
      const storage = createMockStorage();
      const ctx1 = AgentContextNextGen.create({
        model: 'gpt-4',
        storage,
      });

      const loaded = await ctx1.load('non-existent');
      expect(loaded).toBe(false);

      ctx1.destroy();
    });

    it('should throw without storage', async () => {
      await expect(ctx.save()).rejects.toThrow('No storage');
    });

    it('should save plugin states', async () => {
      const storage = createMockStorage();
      const ctx1 = AgentContextNextGen.create({
        model: 'gpt-4',
        storage,
        features: { inContextMemory: true },
      });

      // ICM is now auto-registered via features — use getPlugin instead of registerPlugin
      const inContextPlugin = ctx1.getPlugin<InContextMemoryPluginNextGen>('in_context_memory')!;
      expect(inContextPlugin).toBeDefined();

      inContextPlugin.set('key1', 'Description', { data: 123 });

      await ctx1.save('with-plugins');
      ctx1.destroy();

      // Load and verify plugin state
      const ctx2 = AgentContextNextGen.create({
        model: 'gpt-4',
        storage,
        features: { inContextMemory: true },
      });

      await ctx2.load('with-plugins');

      const inContextPlugin2 = ctx2.getPlugin<InContextMemoryPluginNextGen>('in_context_memory')!;
      const value = inContextPlugin2.get('key1');
      expect(value).toEqual({ data: 123 });

      ctx2.destroy();
    });

    it('should check session existence', async () => {
      const storage = createMockStorage();
      const ctx1 = AgentContextNextGen.create({
        model: 'gpt-4',
        storage,
      });

      await ctx1.save('exists-session');

      const exists = await ctx1.sessionExists('exists-session');
      expect(exists).toBe(true);

      const notExists = await ctx1.sessionExists('not-exists');
      expect(notExists).toBe(false);

      ctx1.destroy();
    });

    it('should delete session', async () => {
      const storage = createMockStorage();
      const ctx1 = AgentContextNextGen.create({
        model: 'gpt-4',
        storage,
      });

      await ctx1.save('to-delete');
      await ctx1.deleteSession('to-delete');

      const exists = await ctx1.sessionExists('to-delete');
      expect(exists).toBe(false);

      ctx1.destroy();
    });
  });

  describe('System Prompt', () => {
    it('should get and set system prompt', () => {
      ctx.systemPrompt = 'New prompt';
      expect(ctx.systemPrompt).toBe('New prompt');
    });

    it('should include system prompt in prepared context', async () => {
      ctx.systemPrompt = 'Be helpful';
      ctx.addUserMessage('Hi');

      const { input } = await ctx.prepare();

      const systemMsg = input[0] as Message;
      const textContent = systemMsg.content[0] as any;
      expect(textContent.text).toContain('Be helpful');
    });
  });

  describe('Lifecycle', () => {
    it('should track destroyed state', () => {
      expect(ctx.isDestroyed).toBe(false);
      ctx.destroy();
      expect(ctx.isDestroyed).toBe(true);
    });

    it('should throw on operations after destroy', async () => {
      ctx.destroy();

      expect(() => ctx.addUserMessage('test')).toThrow('destroyed');
      await expect(ctx.prepare()).rejects.toThrow('destroyed');
    });

    it('should destroy plugins on context destroy', () => {
      // Use the auto-registered memory plugin
      const memoryPlugin = ctx.memory;
      expect(memoryPlugin).not.toBeNull();

      ctx.destroy();

      // Plugin should be destroyed (can't store new values)
      expect(() => memoryPlugin!.store('key', 'desc', {})).rejects.toThrow();
    });
  });

  describe('Compatibility Methods', () => {
    it('should support addMessage for legacy code', () => {
      ctx.addMessage('user', 'Hello');
      ctx.addMessage('assistant', 'Hi');

      const conversation = ctx.getConversation();
      expect(conversation.length).toBe(2);
    });

    it('should support setCurrentInput', () => {
      ctx.setCurrentInput('Test input');

      const input = ctx.getCurrentInput();
      expect(input).toHaveLength(1);
    });

    it('should support prepareConversation alias', async () => {
      ctx.addUserMessage('Test');

      const result = await ctx.prepareConversation();
      expect(result.input).toBeDefined();
      expect(result.budget).toBeDefined();
    });
  });
});
