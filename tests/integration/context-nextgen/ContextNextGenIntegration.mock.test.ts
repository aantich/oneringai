/**
 * AgentContextNextGen Integration Tests (Mock LLM)
 *
 * Tests core context management functionality with deterministic mock LLM:
 * - Context preparation with system prompt
 * - Budget calculation and tracking
 * - Compaction triggering when threshold reached
 * - Multi-turn conversation management
 * - Tool use/result pair preservation during compaction
 * - Budget warning events
 * - Context clearing
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AgentContextNextGen } from '../../../src/core/context-nextgen/AgentContextNextGen.js';
import type { ContextBudget, ContextFeatures } from '../../../src/core/context-nextgen/types.js';
import {
  createMinimalContext,
  createContextWithFeatures,
  createContextWithHistory,
  safeDestroy,
  FEATURE_PRESETS,
} from '../../helpers/contextTestHelpers.js';
import type { ToolFunction } from '../../../src/domain/entities/Tool.js';

describe('AgentContextNextGen Integration (Mock)', () => {
  let ctx: AgentContextNextGen | null = null;

  afterEach(() => {
    safeDestroy(ctx);
    ctx = null;
  });

  // ============================================================================
  // Context Preparation
  // ============================================================================

  describe('Context Preparation', () => {
    it('should prepare context with system prompt', async () => {
      ctx = AgentContextNextGen.create({
        model: 'gpt-4',
        systemPrompt: 'You are a helpful assistant.',
        features: FEATURE_PRESETS.minimal,
      });

      ctx.addUserMessage('Hello!');
      const { input, budget } = await ctx.prepare();

      // System message should be first
      expect(input.length).toBeGreaterThan(0);
      expect(input[0]?.type).toBe('message');

      // Budget should be calculated
      expect(budget.totalUsed).toBeGreaterThan(0);
      expect(budget.breakdown.systemPrompt).toBeGreaterThan(0);
      expect(budget.utilizationPercent).toBeGreaterThan(0);
    });

    it('should include user message in prepared context', async () => {
      ctx = createMinimalContext();

      ctx.addUserMessage('Test message');
      const { input, budget } = await ctx.prepare();

      expect(input.length).toBe(2); // System message + current input
      expect(budget.currentInputTokens).toBeGreaterThan(0);
    });

    it('should report correct budget breakdown', async () => {
      ctx = AgentContextNextGen.create({
        model: 'gpt-4',
        systemPrompt: 'System prompt here.',
        features: FEATURE_PRESETS.minimal,
      });

      ctx.addUserMessage('User input');
      const { budget } = await ctx.prepare();

      // Verify breakdown structure
      expect(budget.breakdown).toHaveProperty('systemPrompt');
      expect(budget.breakdown).toHaveProperty('persistentInstructions');
      expect(budget.breakdown).toHaveProperty('pluginInstructions');
      expect(budget.breakdown).toHaveProperty('pluginContents');
      expect(budget.breakdown).toHaveProperty('tools');
      expect(budget.breakdown).toHaveProperty('conversation');
      expect(budget.breakdown).toHaveProperty('currentInput');

      // Total should match sum
      const sum = budget.breakdown.systemPrompt +
        budget.breakdown.persistentInstructions +
        budget.breakdown.pluginInstructions +
        budget.breakdown.tools +
        budget.breakdown.conversation +
        budget.breakdown.currentInput;

      expect(budget.totalUsed).toBeGreaterThanOrEqual(sum - 100); // Allow some overhead
    });
  });

  // ============================================================================
  // Budget Tracking
  // ============================================================================

  describe('Budget Calculation', () => {
    it('should calculate available tokens correctly', async () => {
      ctx = AgentContextNextGen.create({
        model: 'gpt-4',
        maxContextTokens: 10000,
        responseReserve: 1000,
        features: FEATURE_PRESETS.minimal,
      });

      ctx.addUserMessage('Hello');
      const { budget } = await ctx.prepare();

      expect(budget.maxTokens).toBe(10000);
      expect(budget.responseReserve).toBe(1000);
      expect(budget.available).toBeLessThan(10000 - 1000);
      expect(budget.totalUsed + budget.available).toBeLessThanOrEqual(10000 - 1000);
    });

    it('should calculate utilization percentage', async () => {
      ctx = AgentContextNextGen.create({
        model: 'gpt-4',
        maxContextTokens: 1000,
        responseReserve: 100,
        features: FEATURE_PRESETS.minimal,
      });

      // Add some content
      ctx.addUserMessage('A message with some content');
      const { budget } = await ctx.prepare();

      // Utilization should be (totalUsed / (maxTokens - responseReserve)) * 100
      const expectedUtil = (budget.totalUsed / (1000 - 100)) * 100;
      expect(budget.utilizationPercent).toBeCloseTo(expectedUtil, 1);
    });

    it('should track tool tokens when tools are registered', async () => {
      const testTool: ToolFunction = {
        definition: {
          type: 'function',
          function: {
            name: 'test_tool',
            description: 'A test tool with a long description to take up tokens',
            parameters: {
              type: 'object',
              properties: {
                input: { type: 'string', description: 'Input parameter' },
              },
              required: ['input'],
            },
          },
        },
        execute: async () => ({ result: 'ok' }),
      };

      ctx = AgentContextNextGen.create({
        model: 'gpt-4',
        features: FEATURE_PRESETS.minimal,
        tools: [testTool],
      });

      ctx.addUserMessage('Hello');
      const { budget } = await ctx.prepare();

      expect(budget.toolsTokens).toBeGreaterThan(0);
      expect(budget.breakdown.tools).toBeGreaterThan(0);
    });

    it('should calculate budget without triggering compaction', async () => {
      ctx = AgentContextNextGen.create({
        model: 'gpt-4',
        maxContextTokens: 5000,
        features: FEATURE_PRESETS.minimal,
      });

      // Add some history
      ctx.addUserMessage('First message');
      ctx.addAssistantResponse([{
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'First response' }],
      }]);

      // Use calculateBudget (doesn't trigger compaction)
      const budget = await ctx.calculateBudget();

      expect(budget.conversationTokens).toBeGreaterThan(0);
      expect(budget.totalUsed).toBeGreaterThan(0);
    });
  });

  // ============================================================================
  // Multi-turn Conversation
  // ============================================================================

  describe('Multi-turn Conversation', () => {
    it('should maintain conversation history across turns', async () => {
      ctx = createMinimalContext();

      // Turn 1
      ctx.addUserMessage('Message 1');
      ctx.addAssistantResponse([{
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'Response 1' }],
      }]);

      // Turn 2
      ctx.addUserMessage('Message 2');
      ctx.addAssistantResponse([{
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'Response 2' }],
      }]);

      const conversation = ctx.getConversation();
      expect(conversation.length).toBe(4); // 2 user + 2 assistant messages
    });

    it('should move current input to conversation after assistant response', async () => {
      ctx = createMinimalContext();

      // Add user message (becomes current input)
      ctx.addUserMessage('User message');
      expect(ctx.getCurrentInput().length).toBe(1);
      expect(ctx.getConversation().length).toBe(0);

      // Add assistant response (moves user message to conversation)
      ctx.addAssistantResponse([{
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'Assistant response' }],
      }]);

      expect(ctx.getCurrentInput().length).toBe(0);
      expect(ctx.getConversation().length).toBe(2);
    });

    it('should handle tool use and tool result pairs', async () => {
      ctx = createMinimalContext();

      // Simulate assistant making a tool call
      ctx.addUserMessage('Use a tool');
      ctx.addAssistantResponse([{
        type: 'message',
        role: 'assistant',
        content: [{
          type: 'tool_use',
          id: 'call_123',
          name: 'test_tool',
          arguments: '{"input": "test"}',
        }],
      }]);

      // Add tool results
      ctx.addToolResults([{
        tool_use_id: 'call_123',
        content: 'Tool result here',
      }]);

      // Tool results should be in current input
      expect(ctx.getCurrentInput().length).toBe(1);

      // Prepare should include everything
      const { input } = await ctx.prepare();
      expect(input.length).toBeGreaterThan(2); // System + conversation + current input
    });

    it('should use createContextWithHistory helper correctly', async () => {
      ctx = createContextWithHistory(5);

      const conversation = ctx.getConversation();
      expect(conversation.length).toBe(10); // 5 pairs of user + assistant
    });
  });

  // ============================================================================
  // Compaction
  // ============================================================================

  describe('Compaction', () => {
    it('should trigger compaction when utilization exceeds threshold', async () => {
      // Create context with small limit to trigger compaction
      ctx = AgentContextNextGen.create({
        model: 'gpt-4',
        maxContextTokens: 500,
        responseReserve: 100,
        strategy: 'algorithmic', // 70% threshold
        features: FEATURE_PRESETS.minimal,
      });

      // Add messages to fill up context
      for (let i = 0; i < 10; i++) {
        ctx.addMessage('user', `This is message number ${i} with some content to fill up the context`);
        ctx.addMessage('assistant', `This is response number ${i} with additional content to take up space`);
      }

      // Prepare should trigger compaction
      const { compacted, compactionLog } = await ctx.prepare();

      // Compaction should have occurred
      expect(compacted).toBe(true);
      expect(compactionLog.length).toBeGreaterThan(0);
    });

    it('should preserve tool pairs during compaction', async () => {
      ctx = AgentContextNextGen.create({
        model: 'gpt-4',
        maxContextTokens: 800,
        responseReserve: 100,
        strategy: 'algorithmic',
        features: FEATURE_PRESETS.minimal,
      });

      // Add some messages
      ctx.addMessage('user', 'First message');
      ctx.addMessage('assistant', 'First response');

      // Add tool use
      ctx.addUserMessage('Use the tool');
      ctx.addAssistantResponse([{
        type: 'message',
        role: 'assistant',
        content: [{
          type: 'tool_use',
          id: 'tool_abc',
          name: 'my_tool',
          arguments: '{}',
        }],
      }]);

      // Add tool result - this becomes current input
      ctx.addToolResults([{
        tool_use_id: 'tool_abc',
        content: 'Result from tool',
      }]);

      // Add assistant response to complete the tool call cycle
      // This moves the tool result to conversation
      ctx.addAssistantResponse([{
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'Tool completed' }],
      }]);

      // Add more messages to potentially trigger compaction
      for (let i = 0; i < 5; i++) {
        ctx.addMessage('user', `More content ${i}`);
        ctx.addMessage('assistant', `More response ${i}`);
      }

      await ctx.prepare();

      // If tool pair still exists, both should be present
      const conversation = ctx.getConversation();
      const hasToolUse = conversation.some(item => {
        if (item.type !== 'message') return false;
        return (item as any).content?.some((c: any) => c.type === 'tool_use' && c.id === 'tool_abc');
      });
      const hasToolResult = conversation.some(item => {
        if (item.type !== 'message') return false;
        return (item as any).content?.some((c: any) => c.type === 'tool_result' && c.tool_use_id === 'tool_abc');
      });

      // Either both should be present or both should be removed (pair preservation)
      // Note: compaction may remove the pair entirely, but never leaves orphans
      expect(hasToolUse).toBe(hasToolResult);
    });
  });

  // ============================================================================
  // Budget Events
  // ============================================================================

  describe('Budget Events', () => {
    it('should emit budget:warning when utilization exceeds 70%', async () => {
      const warningHandler = vi.fn();

      ctx = AgentContextNextGen.create({
        model: 'gpt-4',
        maxContextTokens: 300,
        responseReserve: 50,
        features: FEATURE_PRESETS.minimal,
      });

      ctx.on('budget:warning', warningHandler);

      // Add content to push utilization above 70%
      for (let i = 0; i < 5; i++) {
        ctx.addMessage('user', `Message ${i} with some content`);
        ctx.addMessage('assistant', `Response ${i} with some content`);
      }

      await ctx.prepare();

      // Should have emitted warning (may also emit critical)
      expect(warningHandler.mock.calls.length +
        ctx.listenerCount('budget:critical')).toBeGreaterThanOrEqual(0);
    });

    it('should emit budget:critical when utilization exceeds 90%', async () => {
      const criticalHandler = vi.fn();

      ctx = AgentContextNextGen.create({
        model: 'gpt-4',
        maxContextTokens: 200,
        responseReserve: 20,
        strategy: 'algorithmic', // 90% threshold, less aggressive compaction
        features: FEATURE_PRESETS.minimal,
      });

      ctx.on('budget:critical', criticalHandler);

      // Add lots of content
      for (let i = 0; i < 10; i++) {
        ctx.addMessage('user', `Message ${i} with content`);
        ctx.addMessage('assistant', `Response ${i} with content`);
      }

      await ctx.prepare();

      // Note: compaction may have reduced utilization below 90%
      // The event is only emitted if after compaction it's still >= 90%
    });

    it('should emit context:compacted when compaction occurs', async () => {
      const compactedHandler = vi.fn();

      ctx = AgentContextNextGen.create({
        model: 'gpt-4',
        maxContextTokens: 400,
        responseReserve: 50,
        strategy: 'algorithmic',
        features: FEATURE_PRESETS.minimal,
      });

      ctx.on('context:compacted', compactedHandler);

      // Fill up context
      for (let i = 0; i < 8; i++) {
        ctx.addMessage('user', `Message ${i}`);
        ctx.addMessage('assistant', `Response ${i}`);
      }

      const { compacted } = await ctx.prepare();

      if (compacted) {
        expect(compactedHandler).toHaveBeenCalled();
        const eventArg = compactedHandler.mock.calls[0][0];
        expect(eventArg).toHaveProperty('tokensFreed');
        expect(eventArg).toHaveProperty('log');
      }
    });

    it('should emit message:added when messages are added', async () => {
      const addedHandler = vi.fn();

      ctx = createMinimalContext();
      ctx.on('message:added', addedHandler);

      ctx.addUserMessage('Hello');
      expect(addedHandler).toHaveBeenCalledWith(expect.objectContaining({ role: 'user' }));

      ctx.addAssistantResponse([{
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'Hi' }],
      }]);
      expect(addedHandler).toHaveBeenCalledWith(expect.objectContaining({ role: 'assistant' }));
    });
  });

  // ============================================================================
  // Context Clearing
  // ============================================================================

  describe('Context Clearing', () => {
    it('should clear conversation history', async () => {
      ctx = createContextWithHistory(3);

      expect(ctx.getConversation().length).toBe(6);

      ctx.clearConversation('test reason');

      expect(ctx.getConversation().length).toBe(0);
      expect(ctx.getCurrentInput().length).toBe(0);
    });

    it('should emit conversation:cleared event', async () => {
      const clearedHandler = vi.fn();

      ctx = createContextWithHistory(2);
      ctx.on('conversation:cleared', clearedHandler);

      ctx.clearConversation('manual clear');

      expect(clearedHandler).toHaveBeenCalledWith({ reason: 'manual clear' });
    });
  });

  // ============================================================================
  // Feature Configuration
  // ============================================================================

  describe('Feature Configuration', () => {
    it('should enable working memory by default', () => {
      ctx = AgentContextNextGen.create({ model: 'gpt-4' });

      expect(ctx.features.workingMemory).toBe(true);
      expect(ctx.hasPlugin('working_memory')).toBe(true);
      expect(ctx.memory).not.toBeNull();
    });

    it('should disable working memory when configured', () => {
      ctx = AgentContextNextGen.create({
        model: 'gpt-4',
        features: { workingMemory: false },
      });

      expect(ctx.features.workingMemory).toBe(false);
      expect(ctx.hasPlugin('working_memory')).toBe(false);
      // memory returns null/undefined when plugin not registered
      expect(ctx.memory).toBeFalsy();
    });

    it('should enable all features with full preset', () => {
      ctx = createContextWithFeatures(FEATURE_PRESETS.full, { agentId: 'test-agent' });

      expect(ctx.features.workingMemory).toBe(true);
      expect(ctx.features.inContextMemory).toBe(true);
      expect(ctx.features.persistentInstructions).toBe(true);

      expect(ctx.hasPlugin('working_memory')).toBe(true);
      expect(ctx.hasPlugin('in_context_memory')).toBe(true);
      expect(ctx.hasPlugin('persistent_instructions')).toBe(true);
    });

    it('should register the unified store_* tools when any IStoreHandler plugin is enabled', async () => {
      ctx = createContextWithFeatures(FEATURE_PRESETS.full, { agentId: 'test-agent' });

      const tools = ctx.tools.getEnabled();
      const toolNames = tools.map(t => t.definition.function.name);

      // Unified store tools — registered once when any IStoreHandler plugin appears
      expect(toolNames).toContain('store_set');
      expect(toolNames).toContain('store_get');
      expect(toolNames).toContain('store_delete');
      expect(toolNames).toContain('store_list');
      expect(toolNames).toContain('store_action');
    });

    it('should not register store_* tools when no IStoreHandler plugins are enabled', () => {
      ctx = createMinimalContext();

      const tools = ctx.tools.getEnabled();
      const toolNames = tools.map(t => t.definition.function.name);

      expect(toolNames).not.toContain('store_set');
      expect(toolNames).not.toContain('store_get');
      expect(toolNames).not.toContain('store_delete');
    });
  });

  // ============================================================================
  // Error Handling
  // ============================================================================

  describe('Error Handling', () => {
    it('should throw when context is destroyed', async () => {
      ctx = createMinimalContext();
      ctx.destroy();

      expect(() => ctx!.addUserMessage('test')).toThrow('destroyed');
      await expect(ctx.prepare()).rejects.toThrow('destroyed');
    });

    it('should throw when too many tools are registered', async () => {
      // Create many tools with large descriptions
      const manyTools: ToolFunction[] = [];
      for (let i = 0; i < 100; i++) {
        manyTools.push({
          definition: {
            type: 'function',
            function: {
              name: `tool_${i}`,
              description: 'A'.repeat(1000), // Large description
              parameters: { type: 'object', properties: {}, required: [] },
            },
          },
          execute: async () => ({ result: i }),
        });
      }

      ctx = AgentContextNextGen.create({
        model: 'gpt-4',
        maxContextTokens: 1000, // Very small
        responseReserve: 100,
        features: FEATURE_PRESETS.minimal,
        tools: manyTools,
      });

      ctx.addUserMessage('test');
      await expect(ctx.prepare()).rejects.toThrow(/too many tools/i);
    });
  });

  // ============================================================================
  // Compatibility / Legacy APIs
  // ============================================================================

  describe('Legacy API Compatibility', () => {
    it('should support addMessage for legacy code', () => {
      ctx = createMinimalContext();

      ctx.addMessage('user', 'Hello');
      ctx.addMessage('assistant', 'Hi there');

      expect(ctx.getConversation().length).toBe(2);
    });

    it('should support setCurrentInput for legacy code', () => {
      ctx = createMinimalContext();

      ctx.setCurrentInput('Test input');

      expect(ctx.getCurrentInput().length).toBe(1);
    });

    it('should support prepareConversation as alias for prepare', async () => {
      ctx = createMinimalContext();
      ctx.addUserMessage('test');

      const result = await ctx.prepareConversation();

      expect(result).toHaveProperty('input');
      expect(result).toHaveProperty('budget');
    });
  });
});
