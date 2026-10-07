/**
 * Agent Unit Tests
 * Tests the main Agent class - the primary public API
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Agent, AgentConfig } from '@/core/Agent.js';
import { Connector } from '@/core/Connector.js';
import { Vendor } from '@/core/Vendor.js';
import { ToolFunction } from '@/domain/entities/Tool.js';
import { MessageRole } from '@/domain/entities/Message.js';
import { ContentType } from '@/domain/entities/Content.js';
import { StreamState } from '@/domain/entities/StreamState.js';
import { StreamEventType } from '@/domain/entities/StreamEvent.js';

// Mock the createProvider function
const mockGenerate = vi.fn();
const mockStreamGenerate = vi.fn();
const mockBatchSubmit = vi.fn();
const mockBatch = {
  submitBatch: mockBatchSubmit,
  getBatch: vi.fn(),
  cancelBatch: vi.fn(),
  getBatchResults: vi.fn(),
};
const mockProvider = {
  name: 'openai',
  capabilities: { text: true, images: true, videos: false, audio: false },
  generate: mockGenerate,
  streamGenerate: mockStreamGenerate,
  batch: mockBatch,
  getModelCapabilities: vi.fn(() => ({
    supportsTools: true,
    supportsVision: true,
    supportsJSON: true,
    supportsJSONSchema: true,
    maxTokens: 128000,
    maxOutputTokens: 16384,
  })),
};

vi.mock('@/core/createProvider.js', () => ({
  createProvider: vi.fn(() => mockProvider),
}));

describe('Agent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Connector.clear();

    // Create a test connector
    Connector.create({
      name: 'test-openai',
      vendor: Vendor.OpenAI,
      auth: { type: 'api_key', apiKey: 'test-key' },
    });
  });

  afterEach(() => {
    Connector.clear();
  });

  describe('Agent.create()', () => {
    it('should create an agent with connector name', () => {
      const agent = Agent.create({
        connector: 'test-openai',
        model: 'gpt-4',
      });

      expect(agent).toBeDefined();
      expect(agent.model).toBe('gpt-4');
    });

    it('should create an agent with connector instance', () => {
      const connector = Connector.get('test-openai');
      const agent = Agent.create({
        connector,
        model: 'gpt-4',
      });

      expect(agent).toBeDefined();
      expect(agent.connector).toBe(connector);
    });

    it('should throw if connector not found', () => {
      expect(() => {
        Agent.create({
          connector: 'non-existent',
          model: 'gpt-4',
        });
      }).toThrow(/not found/i);
    });

    it('should generate default name if not provided', () => {
      const agent = Agent.create({
        connector: 'test-openai',
        model: 'gpt-4',
      });

      expect(agent.name).toMatch(/^agent-\d+$/);
    });

    it('should use provided name', () => {
      const agent = Agent.create({
        connector: 'test-openai',
        model: 'gpt-4',
        name: 'my-custom-agent',
      });

      expect(agent.name).toBe('my-custom-agent');
    });

    it('should store instructions', () => {
      const agent = Agent.create({
        connector: 'test-openai',
        model: 'gpt-4',
        instructions: 'You are a helpful assistant',
      });

      expect(agent).toBeDefined();
    });

    it('should register tools', () => {
      const tool: ToolFunction = {
        definition: {
          type: 'function',
          function: {
            name: 'test_tool',
            description: 'A test tool',
            parameters: { type: 'object', properties: {} },
          },
        },
        execute: async () => ({ result: 'ok' }),
      };

      const agent = Agent.create({
        connector: 'test-openai',
        model: 'gpt-4',
        tools: [tool],
      });

      expect(agent.listTools()).toContain('test_tool');
    });

    it('binds batch submissions to the agent user and scoped connector registry', async () => {
      const scopedRegistry = {
        get: vi.fn((name: string) => Connector.get(name)),
      };
      mockBatchSubmit.mockResolvedValue({ id: 'batch_1', provider: 'openai', state: 'queued' });
      const agent = Agent.create({
        connector: 'test-openai',
        model: 'gpt-4',
        userId: 'tenant-user',
        registry: scopedRegistry as any,
      });

      await agent.getBatchProvider()!.submitBatch(
        [{ customId: 'one', options: { model: 'gpt-4', input: 'hello' } }],
        { dataHandling: { allowBatchRetention: true } },
      );

      expect(mockBatchSubmit).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            customId: 'one',
            options: expect.objectContaining({
              credential_context: {
                userId: 'tenant-user',
                connectorRegistry: scopedRegistry,
              },
            }),
          }),
        ],
        { dataHandling: { allowBatchRetention: true } },
      );
    });
  });

  describe('run()', () => {
    let agent: Agent;

    beforeEach(() => {
      agent = Agent.create({
        connector: 'test-openai',
        model: 'gpt-4',
      });

      mockGenerate.mockResolvedValue({
        id: 'resp_123',
        object: 'response',
        created_at: Date.now(),
        status: 'completed',
        model: 'gpt-4',
        output: [
          {
            type: 'message',
            id: 'msg_123',
            role: MessageRole.ASSISTANT,
            content: [
              {
                type: ContentType.OUTPUT_TEXT,
                text: 'Hello! How can I help you?',
                annotations: [],
              },
            ],
          },
        ],
        output_text: 'Hello! How can I help you?',
        usage: { input_tokens: 10, output_tokens: 8, total_tokens: 18 },
      });
    });

    it('should run with string input', async () => {
      const response = await agent.run('Hello');

      expect(mockGenerate).toHaveBeenCalled();
      expect(response.output_text).toBe('Hello! How can I help you?');
    });

    it('should forward advanced inference options to the provider', async () => {
      await agent.run('Hello', {
        promptCache: { mode: 'auto', ttl: 'extended', key: 'stable-v1' },
        nativeTools: [{ capability: 'web_search', options: { max_uses: 2 } }],
        dataHandling: { allowProviderCaching: true, allowThirdPartyTools: false },
        continuationToken: 'continue-managed',
      });

      expect(mockGenerate).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt_cache: { mode: 'auto', ttl: 'extended', key: 'stable-v1' },
          native_tools: [{ capability: 'web_search', options: { max_uses: 2 } }],
          data_handling: {
            allowProviderCaching: true,
            allowThirdPartyTools: false,
          },
          continuation_token: 'continue-managed',
        }),
      );
    });

    it('uses a managed continuation token only for the first provider request', async () => {
      const retryingAgent = Agent.create({
        connector: 'test-openai',
        model: 'gpt-4',
        emptyResponseRetry: { enabled: true, maxRetries: 1, initialDelayMs: 0, maxDelayMs: 0 },
      });
      mockGenerate
        .mockResolvedValueOnce({
          id: 'resp_empty',
          object: 'response',
          created_at: Date.now(),
          status: 'completed',
          model: 'gpt-4',
          output: [],
          usage: { input_tokens: 1, output_tokens: 0, total_tokens: 1 },
        })
        .mockResolvedValueOnce({
          id: 'resp_final',
          object: 'response',
          created_at: Date.now(),
          status: 'completed',
          model: 'gpt-4',
          output: [{
            type: 'message',
            role: MessageRole.ASSISTANT,
            content: [{ type: ContentType.OUTPUT_TEXT, text: 'Done' }],
          }],
          output_text: 'Done',
          usage: { input_tokens: 2, output_tokens: 1, total_tokens: 3 },
        });

      await retryingAgent.run('Continue', { continuationToken: 'continue-once' });

      expect(mockGenerate).toHaveBeenCalledTimes(2);
      expect(mockGenerate.mock.calls[0][0]).toEqual(expect.objectContaining({
        continuation_token: 'continue-once',
      }));
      expect(mockGenerate.mock.calls[1][0]).not.toHaveProperty('continuation_token');
    });

    it('should run with InputItem array', async () => {
      const response = await agent.run([
        {
          type: 'message',
          role: MessageRole.USER,
          content: [{ type: ContentType.INPUT_TEXT, text: 'Hello' }],
        },
      ]);

      expect(response.output_text).toBe('Hello! How can I help you?');
    });

    it('should include usage information', async () => {
      const response = await agent.run('Hello');

      expect(response.usage).toEqual({
        input_tokens: 10,
        output_tokens: 8,
        total_tokens: 18,
      });
    });

    it('should retain detailed provider usage in execution metrics', async () => {
      mockGenerate.mockResolvedValueOnce({
        id: 'resp_detailed',
        object: 'response',
        created_at: Date.now(),
        status: 'completed',
        model: 'gpt-4',
        output: [
          {
            type: 'message',
            role: MessageRole.ASSISTANT,
            content: [{ type: ContentType.OUTPUT_TEXT, text: 'Done' }],
          },
        ],
        output_text: 'Done',
        usage: {
          input_tokens: 10,
          output_tokens: 8,
          total_tokens: 18,
          cached_input_tokens: 7,
          cache_creation_input_tokens: 2,
          output_tokens_details: { reasoning_tokens: 3 },
          native_tool_calls: { web_search: 2 },
        },
      });

      await agent.run('Hello');

      expect(agent.getMetrics()).toEqual(
        expect.objectContaining({
          cachedInputTokens: 7,
          cacheCreationInputTokens: 2,
          reasoningTokens: 3,
          nativeToolCalls: { web_search: 2 },
        }),
      );
    });

    it('records the actual per-run inference options without credential internals', async () => {
      const historyAgent = Agent.create({
        connector: 'test-openai',
        model: 'gpt-4',
        historyMode: 'full',
      });
      let recordedRequest: Record<string, unknown> | undefined;
      historyAgent.registerHook('after:execution', ({ context }: any) => {
        recordedRequest = context.getHistory()[0]?.request;
      });

      await historyAgent.run('Hello', {
        temperature: 0.2,
        promptCache: { mode: 'off' },
        nativeTools: [{ capability: 'web_search' }],
        dataHandling: { allowProviderTools: true },
      });

      expect(recordedRequest).toEqual(
        expect.objectContaining({
          temperature: 0.2,
          prompt_cache: { mode: 'off' },
          native_tools: [{ capability: 'web_search' }],
          data_handling: { allowProviderTools: true },
        }),
      );
      expect(recordedRequest).not.toHaveProperty('credential_context');
    });

    it('should throw if agent is destroyed', async () => {
      agent.destroy();

      await expect(agent.run('Hello')).rejects.toThrow(/destroyed/i);
    });
  });

  describe('stream()', () => {
    let agent: Agent;

    beforeEach(() => {
      agent = Agent.create({
        connector: 'test-openai',
        model: 'gpt-4',
      });
    });

    it('should throw if agent is destroyed', async () => {
      agent.destroy();

      const stream = agent.stream('Hello');
      await expect(stream.next()).rejects.toThrow(/destroyed/i);
    });

    it('forwards a managed continuation token to the first streaming request', async () => {
      mockStreamGenerate.mockImplementation(async function* () {
        yield {
          type: StreamEventType.RESPONSE_CREATED,
          response_id: 'resp_stream',
          model: 'gpt-4',
          created_at: Math.floor(Date.now() / 1000),
        };
        yield {
          type: StreamEventType.OUTPUT_TEXT_DELTA,
          response_id: 'resp_stream',
          item_id: 'msg_stream',
          output_index: 0,
          content_index: 0,
          delta: 'Done',
          sequence_number: 0,
        };
        yield {
          type: StreamEventType.RESPONSE_COMPLETE,
          response_id: 'resp_stream',
          status: 'completed',
          usage: { input_tokens: 2, output_tokens: 1, total_tokens: 3 },
          iterations: 1,
        };
      });

      for await (const _event of agent.stream('Continue', {
        continuationToken: 'continue-stream',
      })) {
        // Drain the managed stream.
      }

      expect(mockStreamGenerate).toHaveBeenCalledWith(expect.objectContaining({
        continuation_token: 'continue-stream',
      }));
    });

    it('persists streamed custom tools with their input and async metadata', () => {
      const state = new StreamState('resp_custom', 'gpt-6-astra');
      state.startToolCall('call_custom', 'shell', 'item_custom', { outputIndex: 0 }, {
        toolType: 'custom',
        async: true,
      });
      state.accumulateToolArguments('call_custom', 'run tests');
      agent.context.addUserMessage('Use the shell');

      (agent as any)._addStreamingAssistantMessage(state, [], new Map([
        ['call_custom', { name: 'shell', args: 'run tests', async: true }],
      ]));

      expect(agent.context.getConversation()).toContainEqual(expect.objectContaining({
        type: 'message',
        role: MessageRole.ASSISTANT,
        content: [{
          type: ContentType.CUSTOM_TOOL_USE,
          id: 'call_custom',
          name: 'shell',
          input: 'run tests',
          async: true,
        }],
      }));
    });

    it('builds the final streamed response from the full ordered provider output', () => {
      const state = new StreamState('resp_ordered', 'gpt-6-astra');
      state.accumulateReasoningDelta('reasoning_0', 'Checked the request', { outputIndex: 0 });
      state.completeReasoning('reasoning_0', {
        encryptedContent: 'encrypted-reasoning',
        effort: 'high',
      }, { outputIndex: 0 });
      state.accumulateTextDelta('message_1', 'Working on it.', {
        outputIndex: 1,
        contentIndex: 0,
      });
      state.startToolCall('call_2', 'shell', 'custom_2', { outputIndex: 2 }, {
        toolType: 'custom',
        async: true,
      });
      state.accumulateToolArguments('call_2', 'npm test');
      state.accumulateCompaction({
        type: 'compaction',
        id: 'compaction_3',
        encrypted_content: 'encrypted-compaction',
      }, { outputIndex: 3 });
      state.providerStatus = 'incomplete';
      state.stopReason = 'max_output_tokens';
      state.continuationToken = 'continue-1';

      const response = (agent as any)._buildPlaceholderResponse('exec_ordered', 1_000, state);

      expect(response.output).toEqual([
        expect.objectContaining({
          type: 'reasoning',
          id: 'reasoning_0',
          summary: 'Checked the request',
          encrypted_content: 'encrypted-reasoning',
        }),
        expect.objectContaining({
          type: 'message',
          role: MessageRole.ASSISTANT,
          content: [
            { type: ContentType.OUTPUT_TEXT, text: 'Working on it.' },
            {
              type: ContentType.CUSTOM_TOOL_USE,
              id: 'call_2',
              name: 'shell',
              input: 'npm test',
              async: true,
            },
          ],
        }),
        expect.objectContaining({ type: 'compaction', id: 'compaction_3' }),
      ]);
      expect(response.output_text).toBe('Working on it.');
      expect(response.thinking).toBe('Checked the request');
      expect(response.status).toBe('incomplete');
      expect(response.stop_reason).toBe('max_output_tokens');
      expect(response.continuation_token).toBe('continue-1');
    });
  });

  describe('tool management', () => {
    let agent: Agent;

    beforeEach(() => {
      agent = Agent.create({
        connector: 'test-openai',
        model: 'gpt-4',
      });
    });

    it('should add tool dynamically', () => {
      const tool: ToolFunction = {
        definition: {
          type: 'function',
          function: {
            name: 'new_tool',
            description: 'A new tool',
            parameters: { type: 'object', properties: {} },
          },
        },
        execute: async () => ({ result: 'ok' }),
      };

      agent.addTool(tool);

      expect(agent.listTools()).toContain('new_tool');
    });

    it('should remove tool', () => {
      const tool: ToolFunction = {
        definition: {
          type: 'function',
          function: {
            name: 'removable_tool',
            description: 'A tool to remove',
            parameters: { type: 'object', properties: {} },
          },
        },
        execute: async () => ({ result: 'ok' }),
      };

      agent.addTool(tool);
      expect(agent.listTools()).toContain('removable_tool');

      agent.removeTool('removable_tool');
      expect(agent.listTools()).not.toContain('removable_tool');
    });

    it('should list all tools', () => {
      const tool1: ToolFunction = {
        definition: {
          type: 'function',
          function: {
            name: 'tool_a',
            description: 'Tool A',
            parameters: { type: 'object', properties: {} },
          },
        },
        execute: async () => ({}),
      };

      const tool2: ToolFunction = {
        definition: {
          type: 'function',
          function: {
            name: 'tool_b',
            description: 'Tool B',
            parameters: { type: 'object', properties: {} },
          },
        },
        execute: async () => ({}),
      };

      agent.addTool(tool1);
      agent.addTool(tool2);

      const tools = agent.listTools();
      expect(tools).toContain('tool_a');
      expect(tools).toContain('tool_b');
    });
  });

  describe('control methods', () => {
    let agent: Agent;

    beforeEach(() => {
      agent = Agent.create({
        connector: 'test-openai',
        model: 'gpt-4',
      });
    });

    it('should have pause method', () => {
      expect(typeof agent.pause).toBe('function');
      // Should not throw
      agent.pause('test pause');
    });

    it('should have resume method', () => {
      expect(typeof agent.resume).toBe('function');
    });

    it('should have cancel method', () => {
      expect(typeof agent.cancel).toBe('function');
    });
  });

  describe('introspection', () => {
    let agent: Agent;

    beforeEach(() => {
      agent = Agent.create({
        connector: 'test-openai',
        model: 'gpt-4',
      });
    });

    it('should return null context before running', () => {
      expect(agent.getContext()).toBeNull();
    });

    it('should return null metrics before running', () => {
      expect(agent.getMetrics()).toBeNull();
    });

    it('should return null summary before running', () => {
      expect(agent.getSummary()).toBeNull();
    });

    it('should return empty audit trail before running', () => {
      expect(agent.getAuditTrail()).toEqual([]);
    });

    it('should report not running initially', () => {
      expect(agent.isRunning()).toBe(false);
    });

    it('should report not paused initially', () => {
      expect(agent.isPaused()).toBe(false);
    });

    it('should report not cancelled initially', () => {
      expect(agent.isCancelled()).toBe(false);
    });
  });

  describe('cleanup and lifecycle', () => {
    let agent: Agent;

    beforeEach(() => {
      agent = Agent.create({
        connector: 'test-openai',
        model: 'gpt-4',
      });
    });

    it('should register cleanup callbacks', () => {
      const callback = vi.fn();
      agent.onCleanup(callback);

      agent.destroy();

      expect(callback).toHaveBeenCalled();
    });

    it('should call all cleanup callbacks on destroy', () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      agent.onCleanup(callback1);
      agent.onCleanup(callback2);

      agent.destroy();

      expect(callback1).toHaveBeenCalled();
      expect(callback2).toHaveBeenCalled();
    });

    it('should handle cleanup callback errors gracefully', () => {
      const errorCallback = vi.fn(() => {
        throw new Error('Cleanup error');
      });
      const normalCallback = vi.fn();

      agent.onCleanup(errorCallback);
      agent.onCleanup(normalCallback);

      // Should not throw
      expect(() => agent.destroy()).not.toThrow();

      // Both callbacks should have been attempted
      expect(errorCallback).toHaveBeenCalled();
      expect(normalCallback).toHaveBeenCalled();
    });

    it('should track destroyed state', () => {
      expect(agent.isDestroyed).toBe(false);

      agent.destroy();

      expect(agent.isDestroyed).toBe(true);
    });

    it('should handle multiple destroy calls gracefully', () => {
      agent.destroy();
      expect(() => agent.destroy()).not.toThrow();
    });
  });

  describe('event forwarding', () => {
    let agent: Agent;

    beforeEach(() => {
      agent = Agent.create({
        connector: 'test-openai',
        model: 'gpt-4',
      });
    });

    it('should be an EventEmitter', () => {
      expect(typeof agent.on).toBe('function');
      expect(typeof agent.off).toBe('function');
      expect(typeof agent.emit).toBe('function');
    });

    it('should allow subscribing to events', () => {
      const handler = vi.fn();

      agent.on('execution:start', handler);

      // Emit manually to test
      agent.emit('execution:start', { agentName: 'test' });

      expect(handler).toHaveBeenCalled();
    });

    it('should not emit events after destroy', () => {
      const handler = vi.fn();
      agent.on('execution:start', handler);

      agent.destroy();

      // The emit is blocked internally, but we can still call it
      // The agent checks _isDestroyed before emitting
      agent.emit('execution:start', { agentName: 'test' });

      // Handler should not be called since we removed listeners
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('configuration methods', () => {
    let agent: Agent;

    beforeEach(() => {
      agent = Agent.create({
        connector: 'test-openai',
        model: 'gpt-4',
        temperature: 0.5,
      });
    });

    describe('setModel()', () => {
      it('should change the model', () => {
        expect(agent.model).toBe('gpt-4');
        expect(agent.context.model).toBe('gpt-4');

        agent.setModel('gpt-4-turbo');

        expect(agent.model).toBe('gpt-4-turbo');
        expect(agent.context.model).toBe('gpt-4-turbo');
      });

      it('should preserve an explicit context limit while synchronizing context model metadata', () => {
        const custom = Agent.create({
          connector: 'test-openai',
          model: 'gpt-4o',
          context: { model: 'gpt-4o', maxContextTokens: 77_777 },
        });

        custom.setModel('gpt-4.1');

        expect(custom.context.model).toBe('gpt-4.1');
        expect(custom.context.maxContextTokens).toBe(77_777);
        custom.destroy();
      });

      it('should not partially update the model after destruction', () => {
        const originalModel = agent.model;
        agent.destroy();

        expect(() => agent.setModel('gpt-4-turbo')).toThrow(/destroyed/i);
        expect(agent.model).toBe(originalModel);
        expect(agent.context.model).toBe(originalModel);
      });

      it('should use new model in subsequent runs', async () => {
        mockGenerate.mockResolvedValue({
          id: 'resp_123',
          object: 'response',
          created_at: Date.now(),
          status: 'completed',
          model: 'gpt-4-turbo',
          output: [
            {
              type: 'message',
              id: 'msg_123',
              role: MessageRole.ASSISTANT,
              content: [
                {
                  type: ContentType.OUTPUT_TEXT,
                  text: 'Hello!',
                  annotations: [],
                },
              ],
            },
          ],
          output_text: 'Hello!',
          usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
        });

        agent.setModel('gpt-4-turbo');
        await agent.run('Hello');

        expect(mockGenerate).toHaveBeenCalledWith(
          expect.objectContaining({
            model: 'gpt-4-turbo',
          })
        );
      });
    });

    describe('setTemperature() and getTemperature()', () => {
      it('should return initial temperature', () => {
        expect(agent.getTemperature()).toBe(0.5);
      });

      it('should return undefined if temperature not set', () => {
        const agentNoTemp = Agent.create({
          connector: 'test-openai',
          model: 'gpt-4',
        });

        expect(agentNoTemp.getTemperature()).toBeUndefined();
      });

      it('should change the temperature', () => {
        agent.setTemperature(0.9);

        expect(agent.getTemperature()).toBe(0.9);
      });

      it('should use new temperature in subsequent runs', async () => {
        mockGenerate.mockResolvedValue({
          id: 'resp_123',
          object: 'response',
          created_at: Date.now(),
          status: 'completed',
          model: 'gpt-4',
          output: [
            {
              type: 'message',
              id: 'msg_123',
              role: MessageRole.ASSISTANT,
              content: [
                {
                  type: ContentType.OUTPUT_TEXT,
                  text: 'Hello!',
                  annotations: [],
                },
              ],
            },
          ],
          output_text: 'Hello!',
          usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
        });

        agent.setTemperature(0.9);
        await agent.run('Hello');

        expect(mockGenerate).toHaveBeenCalledWith(
          expect.objectContaining({
            temperature: 0.9,
          })
        );
      });
    });

    describe('setTools()', () => {
      const tool1: ToolFunction = {
        definition: {
          type: 'function',
          function: {
            name: 'tool_one',
            description: 'First tool',
            parameters: { type: 'object', properties: {} },
          },
        },
        execute: async () => ({ result: 'one' }),
      };

      const tool2: ToolFunction = {
        definition: {
          type: 'function',
          function: {
            name: 'tool_two',
            description: 'Second tool',
            parameters: { type: 'object', properties: {} },
          },
        },
        execute: async () => ({ result: 'two' }),
      };

      const tool3: ToolFunction = {
        definition: {
          type: 'function',
          function: {
            name: 'tool_three',
            description: 'Third tool',
            parameters: { type: 'object', properties: {} },
          },
        },
        execute: async () => ({ result: 'three' }),
      };

      it('should replace all tools with new array', () => {
        agent.addTool(tool1);
        agent.addTool(tool2);
        expect(agent.listTools()).toContain('tool_one');
        expect(agent.listTools()).toContain('tool_two');

        agent.setTools([tool3]);

        expect(agent.listTools()).not.toContain('tool_one');
        expect(agent.listTools()).not.toContain('tool_two');
        expect(agent.listTools()).toContain('tool_three');
      });

      it('should handle empty array (clear all tools)', () => {
        // NextGen doesn't auto-register tools by default
        const initialCount = agent.listTools().length;

        agent.addTool(tool1);
        agent.addTool(tool2);
        expect(agent.listTools().length).toBe(initialCount + 2);

        // setTools([]) clears ALL tools
        agent.setTools([]);

        expect(agent.listTools().length).toBe(0);
      });

      it('should replace with multiple tools', () => {
        // NextGen doesn't auto-register tools by default
        agent.addTool(tool1);
        expect(agent.listTools()).toContain('tool_one');

        // setTools replaces ALL tools (clears everything, then adds specified tools)
        agent.setTools([tool2, tool3]);

        expect(agent.listTools()).toContain('tool_two');
        expect(agent.listTools()).toContain('tool_three');
        expect(agent.listTools()).not.toContain('tool_one');
        expect(agent.listTools().length).toBe(2);
      });

      it('should use new tools in subsequent runs', async () => {
        mockGenerate.mockResolvedValue({
          id: 'resp_123',
          object: 'response',
          created_at: Date.now(),
          status: 'completed',
          model: 'gpt-4',
          output: [
            {
              type: 'message',
              id: 'msg_123',
              role: MessageRole.ASSISTANT,
              content: [
                {
                  type: ContentType.OUTPUT_TEXT,
                  text: 'Hello!',
                  annotations: [],
                },
              ],
            },
          ],
          output_text: 'Hello!',
          usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
        });

        agent.setTools([tool1, tool2]);
        await agent.run('Hello');

        expect(mockGenerate).toHaveBeenCalledWith(
          expect.objectContaining({
            tools: [tool1.definition, tool2.definition],
          })
        );
      });
    });
  });

  describe('configuration options', () => {
    it('should accept temperature', () => {
      const agent = Agent.create({
        connector: 'test-openai',
        model: 'gpt-4',
        temperature: 0.7,
      });

      expect(agent).toBeDefined();
    });

    it('should accept maxIterations', () => {
      const agent = Agent.create({
        connector: 'test-openai',
        model: 'gpt-4',
        maxIterations: 5,
      });

      expect(agent).toBeDefined();
    });

    it('returns deeply isolated runtime configuration snapshots', () => {
      const transformRequest = vi.fn(() => ({ transformed: true }));
      const agent = Agent.create({
        connector: 'test-openai',
        model: 'gpt-4',
        vendorOptions: { nested: { mode: 'safe' }, transformRequest },
        nativeTools: [{
          capability: 'web_search',
          options: { headers: { authorization: 'host-only' } },
        }],
      });
      const snapshot = agent.getRuntimeConfigSnapshot();
      (snapshot.vendorOptions?.nested as { mode: string }).mode = 'mutated';
      const nativeOptions = snapshot.nativeTools?.[0]?.options as {
        headers: { authorization: string };
      };
      nativeOptions.headers.authorization = 'mutated';

      expect(agent.getRuntimeConfigSnapshot()).toMatchObject({
        vendorOptions: { nested: { mode: 'safe' }, transformRequest },
        nativeTools: [{ options: { headers: { authorization: 'host-only' } } }],
      });
      expect(snapshot.vendorOptions?.transformRequest).toBe(transformRequest);

      agent.destroy();
    });

    it('should accept hooks configuration', () => {
      const agent = Agent.create({
        connector: 'test-openai',
        model: 'gpt-4',
        hooks: {
          onToolCall: [async () => {}],
        },
      });

      expect(agent).toBeDefined();
    });

    it('should accept limits configuration', () => {
      const agent = Agent.create({
        connector: 'test-openai',
        model: 'gpt-4',
        limits: {
          maxExecutionTime: 30000,
          maxToolCalls: 10,
        },
      });

      expect(agent).toBeDefined();
    });

    it('should accept errorHandling configuration', () => {
      const agent = Agent.create({
        connector: 'test-openai',
        model: 'gpt-4',
        errorHandling: {
          hookFailureMode: 'warn',
          toolFailureMode: 'continue',
        },
      });

      expect(agent).toBeDefined();
    });
  });

  describe('Session Loading Race Condition', () => {
    /**
     * Create a mock stored session with the proper IContextStorage format
     */
    function createMockStoredSession(sessionId: string) {
      return {
        version: 1,
        sessionId,
        createdAt: new Date().toISOString(),
        lastSavedAt: new Date().toISOString(),
        state: {
          version: 1,
          core: {
            systemPrompt: '',
            instructions: '',
            history: [],
            toolCalls: [],
          },
          tools: { enabled: {}, namespaces: {}, priorities: {} },
          permissions: { approvals: {} },
          plugins: {},
          config: {
            model: 'gpt-4',
            maxContextTokens: 128000,
            strategy: 'proactive',
          },
        },
        metadata: { name: 'Test' },
      };
    }

    it('should wait for session load before run()', async () => {
      // Create a mock storage that simulates slow loading
      let resolveLoad: () => void;
      const loadPromise = new Promise<void>((resolve) => {
        resolveLoad = resolve;
      });

      const mockStorage = {
        save: vi.fn().mockResolvedValue(undefined),
        load: vi.fn().mockImplementation(async () => {
          await loadPromise;
          return createMockStoredSession('test-session');
        }),
        delete: vi.fn().mockResolvedValue(undefined),
        exists: vi.fn().mockResolvedValue(true),
        list: vi.fn().mockResolvedValue([]),
        getPath: vi.fn().mockReturnValue('/mock/storage'),
      };

      // Mock response
      mockGenerate.mockResolvedValue({
        output_text: 'Hello!',
        output: [],
        usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
      });

      const agent = Agent.create({
        connector: 'test-openai',
        model: 'gpt-4',
        session: {
          storage: mockStorage,
          id: 'test-session', // Resume existing session
        },
      });

      // Start run immediately (before session loads)
      const runPromise = agent.run('Hello');

      // Verify load was called
      expect(mockStorage.load).toHaveBeenCalledWith('test-session');

      // Resolve the load after a delay
      await new Promise((r) => setTimeout(r, 10));
      resolveLoad!();

      // Run should complete successfully
      const response = await runPromise;
      expect(response.output_text).toBe('Hello!');
    });

    it('should wait for session load before stream()', async () => {
      let resolveLoad: () => void;
      const loadPromise = new Promise<void>((resolve) => {
        resolveLoad = resolve;
      });

      const mockStorage = {
        save: vi.fn().mockResolvedValue(undefined),
        load: vi.fn().mockImplementation(async () => {
          await loadPromise;
          return createMockStoredSession('test-session');
        }),
        delete: vi.fn().mockResolvedValue(undefined),
        exists: vi.fn().mockResolvedValue(true),
        list: vi.fn().mockResolvedValue([]),
        getPath: vi.fn().mockReturnValue('/mock/storage'),
      };

      // Mock streaming response
      async function* mockStream() {
        yield { type: 'text_delta', delta: 'Hello' };
        yield { type: 'done' };
      }
      mockStreamGenerate.mockReturnValue(mockStream());

      const agent = Agent.create({
        connector: 'test-openai',
        model: 'gpt-4',
        session: {
          storage: mockStorage,
          id: 'test-session',
        },
      });

      // Start stream immediately
      const streamIterator = agent.stream('Hello');

      // Verify load was called
      expect(mockStorage.load).toHaveBeenCalledWith('test-session');

      // Resolve the load
      await new Promise((r) => setTimeout(r, 10));
      resolveLoad!();

      // Stream should work
      const events = [];
      for await (const event of streamIterator) {
        events.push(event);
      }
      expect(events.length).toBeGreaterThan(0);
    });

    it('should wait for session load before saveSession()', async () => {
      let resolveLoad: () => void;
      const loadPromise = new Promise<void>((resolve) => {
        resolveLoad = resolve;
      });

      const mockStorage = {
        save: vi.fn().mockResolvedValue(undefined),
        load: vi.fn().mockImplementation(async () => {
          await loadPromise;
          return createMockStoredSession('test-session');
        }),
        delete: vi.fn().mockResolvedValue(undefined),
        exists: vi.fn().mockResolvedValue(true),
        list: vi.fn().mockResolvedValue([]),
        getPath: vi.fn().mockReturnValue('/mock/storage'),
      };

      const agent = Agent.create({
        connector: 'test-openai',
        model: 'gpt-4',
        session: {
          storage: mockStorage,
          id: 'test-session',
        },
      });

      // Start save immediately
      const savePromise = agent.saveSession();

      // Resolve the load
      await new Promise((r) => setTimeout(r, 10));
      resolveLoad!();

      // Save should complete without error
      await expect(savePromise).resolves.toBeUndefined();
      expect(mockStorage.save).toHaveBeenCalled();
    });
  });

  describe('execution ownership', () => {
    it('rejects external calls to tools hidden by the current connector identity', async () => {
      const workExecute = vi.fn(async () => ({ account: 'work' }));
      const personalExecute = vi.fn(async () => ({ account: 'personal' }));
      const connectorTool = (
        name: string,
        execute: ToolFunction['execute'],
      ): ToolFunction => ({
        definition: {
          type: 'function',
          function: {
            name,
            description: 'Read account data.',
            parameters: { type: 'object', properties: {} },
          },
        },
        execute,
        connectorName: 'test-openai',
      });
      const agent = Agent.create({
        connector: 'test-openai',
        model: 'gpt-4',
        permissions: { autoApproveAll: true },
      });
      agent.tools.registerConnectorTools(
        'test-openai',
        [connectorTool('read_work_account', workExecute)],
        { accountId: 'work' },
      );
      agent.tools.registerConnectorTools(
        'test-openai',
        [connectorTool('read_personal_account', personalExecute)],
        { accountId: 'personal' },
      );
      agent.identities = [{ connector: 'test-openai', accountId: 'work' }];

      const visibleToolNames = agent.getToolDefinitions().map((tool) => tool.function.name);
      expect(visibleToolNames).toContain('read_work_account');
      expect(visibleToolNames).not.toContain('read_personal_account');
      await agent.beginExternalExecution({ source: 'test-realtime' });

      await expect(agent.executeExternalToolCall({
        id: 'call_personal',
        name: 'read_personal_account',
        arguments: {},
      })).rejects.toThrow('not enabled on this agent');
      expect(personalExecute).not.toHaveBeenCalled();

      await expect(agent.executeExternalToolCall({
        id: 'call_work',
        name: 'read_work_account',
        arguments: {},
      })).resolves.toMatchObject({ content: { account: 'work' } });
      expect(workExecute).toHaveBeenCalledOnce();

      await agent.completeExternalExecution();
      agent.destroy();
    });

    it('keeps an external execution authoritative over run, stream, and continuations', async () => {
      const agent = Agent.create({ connector: 'test-openai', model: 'gpt-4' });
      await agent.beginExternalExecution({ source: 'test-realtime' });
      const externalContext = agent.getExecutionContext();

      await expect(agent.run('overlap')).rejects.toThrow(
        'active external execution',
      );
      await expect(agent.stream('overlap').next()).rejects.toThrow(
        'active external execution',
      );
      await expect(agent.continueWithAsyncResults()).rejects.toThrow(
        'active external execution',
      );
      expect(agent.getExecutionContext()).toBe(externalContext);
      expect(agent.isRunning()).toBe(true);

      await agent.completeExternalExecution();
      expect(agent.isRunning()).toBe(false);
      agent.destroy();
    });

    it('rejects an external session while a text run owns the Agent', async () => {
      let resolveGenerate!: (response: any) => void;
      mockGenerate.mockImplementationOnce(() => new Promise((resolve) => {
        resolveGenerate = resolve;
      }));
      const agent = Agent.create({ connector: 'test-openai', model: 'gpt-4' });

      const running = agent.run('hold the execution slot');
      await vi.waitFor(() => expect(mockGenerate).toHaveBeenCalled());
      await expect(agent.beginExternalExecution()).rejects.toThrow(
        'active run execution',
      );

      resolveGenerate({
        id: 'resp_owner',
        object: 'response',
        created_at: Date.now(),
        status: 'completed',
        model: 'gpt-4',
        output: [{
          type: 'message',
          role: MessageRole.ASSISTANT,
          content: [{ type: ContentType.OUTPUT_TEXT, text: 'done' }],
        }],
        output_text: 'done',
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      });
      await running;

      await expect(agent.beginExternalExecution()).resolves.toMatch(/^exec_/);
      await agent.completeExternalExecution();
      agent.destroy();
    });
  });

  describe('rolloverContext()', () => {
    const addTurn = (agent: Agent, user: string, reply: string) => {
      agent.context.addUserMessage(user);
      agent.context.addAssistantResponse([{
        type: 'message',
        role: MessageRole.ASSISTANT,
        content: [{ type: ContentType.OUTPUT_TEXT, text: reply }],
      }]);
    };

    it('uses a tool-free direct provider call and rolls over under one execution lease', async () => {
      mockGenerate.mockResolvedValue({
        id: 'summary_response',
        object: 'response',
        created_at: Date.now(),
        status: 'completed',
        model: 'gpt-4',
        output: [],
        output_text: 'The first two questions were answered.',
        usage: { input_tokens: 20, output_tokens: 8, total_tokens: 28 },
      });
      const agent = Agent.create({ connector: 'test-openai', model: 'gpt-4' });
      addTurn(agent, 'Question 1', 'Answer 1');
      addTurn(agent, 'Question 2', 'Answer 2');
      addTurn(agent, 'Question 3', 'Answer 3');

      const result = await agent.rolloverContext({
        preserveRecentTurns: 1,
        checkpoint: false,
        reason: 'realtime-session-expiring',
      });

      expect(result).toMatchObject({
        performed: true,
        itemsSummarized: 4,
        retainedTurns: 1,
        reason: 'realtime-session-expiring',
      });
      expect(mockGenerate).toHaveBeenCalledOnce();
      expect(mockGenerate).toHaveBeenCalledWith(expect.objectContaining({
        input: expect.stringContaining('Question 1'),
        instructions: expect.stringContaining('compact continuity brief'),
        tools: undefined,
        max_output_tokens: 2048,
      }));
      expect(JSON.stringify(agent.context.getConversation())).toContain(
        'The first two questions were answered.',
      );
      expect(agent.isRunning()).toBe(false);
      agent.destroy();
    });

    it('cannot race an active external Realtime execution', async () => {
      const agent = Agent.create({ connector: 'test-openai', model: 'gpt-4' });
      addTurn(agent, 'Question 1', 'Answer 1');
      await agent.beginExternalExecution({ source: 'realtime' });

      await expect(agent.rolloverContext({
        checkpoint: false,
        summarize: async () => 'summary',
      })).rejects.toThrow('active external execution');

      await agent.completeExternalExecution();
      await expect(agent.rolloverContext({
        preserveRecentTurns: 0,
        checkpoint: false,
        summarize: async () => 'summary',
      })).resolves.toMatchObject({ performed: true });
      agent.destroy();
    });

    it('checkpoints automatically when session storage is configured', async () => {
      const mockStorage = {
        save: vi.fn().mockResolvedValue(undefined),
        load: vi.fn().mockResolvedValue(null),
        delete: vi.fn().mockResolvedValue(undefined),
        exists: vi.fn().mockResolvedValue(false),
        list: vi.fn().mockResolvedValue([]),
        getPath: vi.fn().mockReturnValue('/mock/storage'),
      };
      const agent = Agent.create({
        connector: 'test-openai',
        model: 'gpt-4',
        session: { storage: mockStorage },
      });
      addTurn(agent, 'Question 1', 'Answer 1');
      addTurn(agent, 'Question 2', 'Answer 2');

      await agent.rolloverContext({
        preserveRecentTurns: 1,
        summarize: async () => 'Question 1 was answered.',
      });

      expect(mockStorage.save).toHaveBeenCalledOnce();
      expect(mockStorage.save).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          conversation: expect.arrayContaining([
            expect.objectContaining({ role: MessageRole.DEVELOPER }),
          ]),
        }),
      );
      agent.destroy();
    });
  });

  describe('clearConversation()', () => {
    it('should clear conversation history while preserving plugins', () => {
      const agent = Agent.create({
        connector: 'test-openai',
        model: 'gpt-4',
      });

      // Add messages to build up conversation
      agent.context.addUserMessage('Hello');
      agent.context.addAssistantResponse([{
        type: 'message',
        role: MessageRole.ASSISTANT,
        content: [{ type: ContentType.OUTPUT_TEXT, text: 'Hi there!' }],
      }]);
      agent.context.addUserMessage('How are you?');

      expect(agent.context.getConversation().length).toBeGreaterThan(0);

      // Clear conversation
      agent.clearConversation('test reset');

      // Conversation should be empty
      expect(agent.context.getConversation()).toHaveLength(0);

      // Agent should still be functional (tools intact)
      expect(agent.tools).toBeDefined();
    });
  });
});
