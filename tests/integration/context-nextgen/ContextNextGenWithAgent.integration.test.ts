/**
 * AgentContextNextGen Integration Tests (Real LLM)
 *
 * Tests context management with real LLM providers:
 * - Agent.create with context features
 * - Agent using memory tools in agentic loop
 * - Agent using in-context memory tools
 * - Multi-turn conversation with context tracking
 * - Streaming with context management
 * - runDirect bypassing context
 *
 * Requires API keys in environment:
 * - OPENAI_API_KEY
 * - ANTHROPIC_API_KEY
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as dotenv from 'dotenv';
import { Connector } from '../../../src/core/Connector.js';
import { Agent } from '../../../src/core/Agent.js';
import { Vendor } from '../../../src/core/Vendor.js';
import {
  isOutputTextDelta,
  isResponseComplete,
} from '../../../src/domain/entities/StreamEvent.js';
import type { InContextMemoryPluginNextGen } from '../../../src/core/context-nextgen/plugins/InContextMemoryPluginNextGen.js';

// Load environment variables
dotenv.config();

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

const HAS_OPENAI_KEY = Boolean(OPENAI_API_KEY);
const HAS_ANTHROPIC_KEY = Boolean(ANTHROPIC_API_KEY);

// Conditional test execution
const describeIfOpenAI = HAS_OPENAI_KEY ? describe : describe.skip;
const describeIfAnthropic = HAS_ANTHROPIC_KEY ? describe : describe.skip;

// ============================================================================
// OpenAI Integration Tests
// ============================================================================

describeIfOpenAI('AgentContextNextGen with OpenAI (Integration)', () => {
  beforeAll(() => {
    if (!OPENAI_API_KEY) {
      console.warn('OPENAI_API_KEY not set, skipping OpenAI integration tests');
      return;
    }

    Connector.create({
      name: 'openai-context-test',
      vendor: Vendor.OpenAI,
      auth: { type: 'api_key', apiKey: OPENAI_API_KEY },
    });
  });

  afterAll(() => {
    Connector.clear();
  });

  describe('Agent with context features', () => {
    it('should create agent with working memory enabled', async () => {
      const agent = Agent.create({
        connector: 'openai-context-test',
        model: 'gpt-4o-mini',
        context: { features: { workingMemory: true } },
      });

      expect(agent.context.features.workingMemory).toBe(true);
      expect(agent.context.memory).not.toBeNull();

      // Verify unified store tools are available
      const toolNames = agent.context.tools.getEnabled().map(t => t.definition.function.name);
      expect(toolNames).toContain('store_set');
      expect(toolNames).toContain('store_get');
    });

    it('should create agent with in-context memory enabled', async () => {
      const agent = Agent.create({
        connector: 'openai-context-test',
        model: 'gpt-4o-mini',
        context: { features: { workingMemory: false, inContextMemory: true } },
      });

      expect(agent.context.features.inContextMemory).toBe(true);
      expect(agent.context.hasPlugin('in_context_memory')).toBe(true);

      // Verify unified store tools are available
      const toolNames = agent.context.tools.getEnabled().map(t => t.definition.function.name);
      expect(toolNames).toContain('store_set');
      expect(toolNames).toContain('store_delete');
    });

    it('should create agent with all features disabled', async () => {
      const agent = Agent.create({
        connector: 'openai-context-test',
        model: 'gpt-4o-mini',
        context: { features: { workingMemory: false, inContextMemory: false } },
      });

      // memory returns null/undefined when plugin not registered
      expect(agent.context.memory).toBeFalsy();
      expect(agent.context.hasPlugin('in_context_memory')).toBe(false);

      // No store tools (no IStoreHandler plugins enabled)
      const toolNames = agent.context.tools.getEnabled().map(t => t.definition.function.name);
      expect(toolNames).not.toContain('store_set');
      expect(toolNames).not.toContain('store_get');
    });
  });

  describe('Agent using memory in agentic loop', () => {
    it('should allow agent to store and retrieve from memory', async () => {
      const agent = Agent.create({
        connector: 'openai-context-test',
        model: 'gpt-4o-mini',
        instructions: 'You are a helpful assistant. Store important information using the notes store.',
        context: { features: { workingMemory: true, inContextMemory: false } },
      });

      // First turn: store information
      const response1 = await agent.run(
        'Please store the following in the notes store with key "user_name": My name is Bob.'
      );

      expect(response1.status).toBe('completed');

      // Query memory to see what was stored (LLM may use different keys)
      const queryResult = await agent.context.memory!.query({ includeValues: true });

      // Should have stored something
      expect(queryResult.entries.length).toBeGreaterThan(0);
    }, 60000);

    it('should use memory across conversation turns', async () => {
      const agent = Agent.create({
        connector: 'openai-context-test',
        model: 'gpt-4o-mini',
        context: { features: { workingMemory: true } },
      });

      // Pre-store data in memory
      await agent.context.memory!.store('fact', 'Important fact', 'The secret code is 42.');

      // Ask about it
      const response = await agent.run(
        'Use store_get with store: "notes" and key: "fact" to retrieve it, then tell me what the secret code is.'
      );

      expect(response.status).toBe('completed');
      expect(response.output_text).toContain('42');
    }, 60000);
  });

  describe('Agent using in-context memory', () => {
    it('should include in-context values directly in context', async () => {
      const agent = Agent.create({
        connector: 'openai-context-test',
        model: 'gpt-4o-mini',
        context: { features: { workingMemory: false, inContextMemory: true } },
      });

      // Pre-set context value
      const plugin = agent.context.getPlugin<InContextMemoryPluginNextGen>('in_context_memory')!;
      plugin.set('user_mood', 'User mood', 'happy', 'high');

      // Ask about user
      const response = await agent.run(
        'Based on the context about the user, what is my current mood? Answer briefly.'
      );

      expect(response.status).toBe('completed');
      expect(response.output_text!.toLowerCase()).toContain('happy');
    }, 60000);
  });

  describe('Multi-turn conversation', () => {
    it('should maintain conversation context across turns', async () => {
      const agent = Agent.create({
        connector: 'openai-context-test',
        model: 'gpt-4o-mini',
        context: { features: { workingMemory: false } },
      });

      // Turn 1
      await agent.run('My favorite color is blue.');

      // Turn 2
      const response = await agent.run('What is my favorite color?');

      expect(response.status).toBe('completed');
      expect(response.output_text!.toLowerCase()).toContain('blue');
    }, 60000);

    it('should track budget across conversation', async () => {
      const agent = Agent.create({
        connector: 'openai-context-test',
        model: 'gpt-4o-mini',
        context: { features: { workingMemory: false } },
      });

      // Add several messages
      await agent.run('Message 1');
      await agent.run('Message 2');
      await agent.run('Message 3');

      // Check budget
      const budget = await agent.context.calculateBudget();

      expect(budget.conversationTokens).toBeGreaterThan(0);
      expect(budget.totalUsed).toBeGreaterThan(0);
      expect(budget.utilizationPercent).toBeGreaterThan(0);
    }, 90000);
  });

  describe('runDirect bypassing context', () => {
    it('should bypass context with runDirect', async () => {
      const agent = Agent.create({
        connector: 'openai-context-test',
        model: 'gpt-4o-mini',
        context: { features: { workingMemory: true } },
      });

      // Store something in memory
      await agent.context.memory!.store('key', 'description', 'value');

      // runDirect should not have access to memory or context
      const response = await agent.runDirect('Say "test"');

      expect(response.status).toBe('completed');
      // LLM may output "test" or "Test" - check case-insensitively
      expect(response.output_text!.toLowerCase()).toContain('test');

      // Memory should still exist (wasn't affected)
      const value = await agent.context.memory!.retrieve('key');
      expect(value).toBe('value');
    }, 30000);

    it('should not include memory tools in runDirect', async () => {
      const agent = Agent.create({
        connector: 'openai-context-test',
        model: 'gpt-4o-mini',
        context: { features: { workingMemory: true } },
      });

      // runDirect with includeTools: false should have no tools
      const response = await agent.runDirect('What tools do you have available?', {
        includeTools: false,
      });

      expect(response.status).toBe('completed');
      // Should not mention store tools
      expect(response.output_text!.toLowerCase()).not.toContain('store_set');
    }, 30000);
  });

  describe('Streaming with context', () => {
    it('should stream responses while maintaining context', async () => {
      const agent = Agent.create({
        connector: 'openai-context-test',
        model: 'gpt-4o-mini',
        context: { features: { workingMemory: false } },
      });

      // First turn
      await agent.run('My name is Charlie.');

      // Stream second turn
      const deltas: string[] = [];
      for await (const event of agent.stream('What is my name?')) {
        if (isOutputTextDelta(event)) {
          deltas.push(event.delta);
        }
      }

      const fullText = deltas.join('');
      expect(fullText.toLowerCase()).toContain('charlie');
    }, 60000);
  });
});

// ============================================================================
// Anthropic Integration Tests
// ============================================================================

describeIfAnthropic('AgentContextNextGen with Anthropic (Integration)', () => {
  beforeAll(() => {
    if (!ANTHROPIC_API_KEY) {
      console.warn('ANTHROPIC_API_KEY not set, skipping Anthropic integration tests');
      return;
    }

    Connector.create({
      name: 'anthropic-context-test',
      vendor: Vendor.Anthropic,
      auth: { type: 'api_key', apiKey: ANTHROPIC_API_KEY },
    });
  });

  afterAll(() => {
    Connector.clear();
  });

  describe('Agent with context features', () => {
    it('should create agent with context features', async () => {
      const agent = Agent.create({
        connector: 'anthropic-context-test',
        model: 'claude-haiku-4-5-20251001',
        context: { features: { workingMemory: true } },
      });

      expect(agent.context.features.workingMemory).toBe(true);
      expect(agent.context.memory).not.toBeNull();
    });

    it('should use memory tools in conversation', async () => {
      const agent = Agent.create({
        connector: 'anthropic-context-test',
        model: 'claude-haiku-4-5-20251001',
        context: { features: { workingMemory: true } },
      });

      // Pre-store data
      await agent.context.memory!.store('animal', 'Favorite animal', 'elephant');

      // Ask about it
      const response = await agent.run(
        'Use store_get with store: "notes" and key: "animal" to retrieve it, then tell me what my favorite animal is.'
      );

      expect(response.status).toBe('completed');
      expect(response.output_text!.toLowerCase()).toContain('elephant');
    }, 60000);
  });

  describe('Conversation continuity', () => {
    it('should maintain context across turns', async () => {
      const agent = Agent.create({
        connector: 'anthropic-context-test',
        model: 'claude-haiku-4-5-20251001',
        context: { features: { workingMemory: false } },
      });

      // Establish context with neutral content (not password-related to avoid safety refusals)
      await agent.run('My favorite number is 42.');

      // Query context
      const response = await agent.run('What is my favorite number?');

      expect(response.status).toBe('completed');
      expect(response.output_text).toContain('42');
    }, 60000);
  });
});
