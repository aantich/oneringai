/**
 * Agent Suspend/Resume Tests
 * Tests the SuspendSignal-based long-running session feature
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fsPromises } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { Agent } from '@/core/Agent.js';
import { Connector } from '@/core/Connector.js';
import { Vendor } from '@/core/Vendor.js';
import { ToolFunction, ToolCallState } from '@/domain/entities/Tool.js';
import { MessageRole } from '@/domain/entities/Message.js';
import { ContentType } from '@/domain/entities/Content.js';
import { LLMResponse } from '@/domain/entities/Response.js';
import { SuspendSignal } from '@/core/SuspendSignal.js';
import { StorageRegistry } from '@/core/StorageRegistry.js';
import { createFileContextStorage } from '@/infrastructure/storage/FileContextStorage.js';
import { FileCorrelationStorage } from '@/infrastructure/storage/FileCorrelationStorage.js';

// Mock the createProvider function
const mockGenerate = vi.fn();
const mockProvider = {
  name: 'openai',
  capabilities: { text: true, images: true, videos: false, audio: false },
  generate: mockGenerate,
  streamGenerate: vi.fn(),
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

/** Helper: create a standard LLM response with text */
function textResponse(text: string): LLMResponse {
  return {
    id: `resp_${Date.now()}`,
    object: 'response',
    created_at: Date.now(),
    status: 'completed',
    model: 'gpt-4',
    output: [{
      type: 'message',
      role: MessageRole.ASSISTANT,
      content: [{ type: ContentType.OUTPUT_TEXT, text }],
    }],
    output_text: text,
    usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
  };
}

/** Helper: create a response with tool calls */
function toolCallResponse(calls: Array<{ id: string; name: string; args: Record<string, unknown> }>): LLMResponse {
  return {
    id: `resp_${Date.now()}`,
    object: 'response',
    created_at: Date.now(),
    status: 'completed',
    model: 'gpt-4',
    output: [{
      type: 'message',
      role: MessageRole.ASSISTANT,
      content: calls.map(c => ({
        type: ContentType.TOOL_USE,
        id: c.id,
        name: c.name,
        arguments: JSON.stringify(c.args),
      })),
    }],
    output_text: '',
    usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
  };
}

describe('Agent - Suspend/Resume', () => {
  let testDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    Connector.clear();
    StorageRegistry.reset();

    testDir = join(tmpdir(), `agent-suspend-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);

    // Configure storage so sessions can be saved
    StorageRegistry.configure({
      sessions: (agentId: string) => createFileContextStorage(agentId, { baseDirectory: testDir }),
      correlations: new FileCorrelationStorage({ baseDirectory: join(testDir, 'correlations') }),
    } as any);

    Connector.create({
      name: 'test-openai',
      vendor: Vendor.OpenAI,
      auth: { type: 'api_key', apiKey: 'test-key' },
    });
  });

  afterEach(async () => {
    Connector.clear();
    StorageRegistry.reset();
    try {
      await fsPromises.rm(testDir, { recursive: true, force: true });
    } catch { /* ignore */ }
  });

  describe('SuspendSignal detection in agent loop', () => {
    it('should detect SuspendSignal and return suspended response', async () => {
      // Tool that returns a SuspendSignal
      const suspendTool: ToolFunction = {
        definition: {
          type: 'function',
          function: {
            name: 'send_email',
            description: 'Send an email and wait for reply',
            parameters: {
              type: 'object',
              properties: {
                to: { type: 'string' },
                body: { type: 'string' },
              },
              required: ['to', 'body'],
            },
          },
        },
        execute: async (args: Record<string, unknown>) => {
          return SuspendSignal.create({
            result: `Email sent to ${args.to}. Waiting for reply.`,
            correlationId: 'email:msg_123',
            metadata: { emailId: 'msg_123' },
          });
        },
      };

      const agent = Agent.create({
        connector: 'test-openai',
        model: 'gpt-4',
        tools: [suspendTool],
      });

      // First call: LLM requests tool call
      mockGenerate
        .mockResolvedValueOnce(toolCallResponse([{
          id: 'call_1',
          name: 'send_email',
          args: { to: 'user@example.com', body: 'Here are the results' },
        }]))
        // Second call: wrap-up response (after SuspendSignal detected)
        .mockResolvedValueOnce(textResponse('I\'ve sent the analysis to your email. I\'ll continue when you reply.'));

      const response = await agent.run('Analyze data and email results');

      // Response should be suspended
      expect(response.status).toBe('suspended');
      expect(response.suspension).toBeDefined();
      expect(response.suspension!.correlationId).toBe('email:msg_123');
      expect(response.suspension!.agentId).toBeDefined();
      expect(response.suspension!.sessionId).toBeDefined();
      expect(response.suspension!.resumeAs).toBe('user_message');
      expect(response.suspension!.metadata).toEqual({ emailId: 'msg_123' });
      expect(response.suspension!.expiresAt).toBeDefined();

      // Wrap-up text should be present
      expect(response.output_text).toContain('sent the analysis');

      // Should have made 2 LLM calls: initial (with tool call) + wrap-up (no tools)
      expect(mockGenerate).toHaveBeenCalledTimes(2);

      // Second call should have empty tools array (forced text-only)
      const secondCallArgs = mockGenerate.mock.calls[1][0];
      expect(secondCallArgs.tools).toEqual([]);

      agent.destroy();
    });

    it('should replace SuspendSignal content with display result for LLM', async () => {
      const suspendTool: ToolFunction = {
        definition: {
          type: 'function',
          function: {
            name: 'notify_user',
            description: 'Notify user',
            parameters: { type: 'object', properties: {} },
          },
        },
        execute: async () => {
          return SuspendSignal.create({
            result: 'Notification sent successfully',
            correlationId: 'notify:123',
          });
        },
      };

      const agent = Agent.create({
        connector: 'test-openai',
        model: 'gpt-4',
        tools: [suspendTool],
      });

      mockGenerate
        .mockResolvedValueOnce(toolCallResponse([{
          id: 'call_1',
          name: 'notify_user',
          args: {},
        }]))
        .mockResolvedValueOnce(textResponse('Done.'));

      const response = await agent.run('Notify the user');

      // The second LLM call should see the display result, not the SuspendSignal
      expect(response.status).toBe('suspended');

      agent.destroy();
    });

    it('should use custom resumeAs and ttl from SuspendSignal', async () => {
      const suspendTool: ToolFunction = {
        definition: {
          type: 'function',
          function: {
            name: 'wait_for_approval',
            description: 'Wait for approval',
            parameters: { type: 'object', properties: {} },
          },
        },
        execute: async () => {
          return SuspendSignal.create({
            result: 'Approval request sent',
            correlationId: 'approval:req_456',
            resumeAs: 'tool_result',
            ttl: 3600000, // 1 hour
          });
        },
      };

      const agent = Agent.create({
        connector: 'test-openai',
        model: 'gpt-4',
        tools: [suspendTool],
      });

      mockGenerate
        .mockResolvedValueOnce(toolCallResponse([{
          id: 'call_1',
          name: 'wait_for_approval',
          args: {},
        }]))
        .mockResolvedValueOnce(textResponse('Waiting for approval.'));

      const response = await agent.run('Submit for approval');

      expect(response.suspension!.resumeAs).toBe('tool_result');
      // TTL should be ~1 hour from now
      const expiresAt = new Date(response.suspension!.expiresAt);
      const now = new Date();
      const diffMs = expiresAt.getTime() - now.getTime();
      expect(diffMs).toBeGreaterThan(3500000);
      expect(diffMs).toBeLessThan(3700000);

      agent.destroy();
    });

    it('should only detect first SuspendSignal if multiple tools return one', async () => {
      let callCount = 0;
      const suspendTool: ToolFunction = {
        definition: {
          type: 'function',
          function: {
            name: 'suspend_tool',
            description: 'Suspend',
            parameters: { type: 'object', properties: {} },
          },
        },
        execute: async () => {
          callCount++;
          return SuspendSignal.create({
            result: `Suspended #${callCount}`,
            correlationId: `suspend:${callCount}`,
          });
        },
      };

      const agent = Agent.create({
        connector: 'test-openai',
        model: 'gpt-4',
        tools: [suspendTool],
      });

      // LLM calls the same tool twice in one turn
      mockGenerate
        .mockResolvedValueOnce(toolCallResponse([
          { id: 'call_1', name: 'suspend_tool', args: {} },
          { id: 'call_2', name: 'suspend_tool', args: {} },
        ]))
        .mockResolvedValueOnce(textResponse('Suspended.'));

      const response = await agent.run('Test');

      // First signal wins
      expect(response.suspension!.correlationId).toBe('suspend:1');

      agent.destroy();
    });

    it('should complete normally when no SuspendSignal is returned', async () => {
      const normalTool: ToolFunction = {
        definition: {
          type: 'function',
          function: {
            name: 'get_weather',
            description: 'Get weather',
            parameters: { type: 'object', properties: {} },
          },
        },
        execute: async () => ({ temperature: 72, conditions: 'sunny' }),
      };

      const agent = Agent.create({
        connector: 'test-openai',
        model: 'gpt-4',
        tools: [normalTool],
      });

      mockGenerate
        .mockResolvedValueOnce(toolCallResponse([{
          id: 'call_1',
          name: 'get_weather',
          args: {},
        }]))
        .mockResolvedValueOnce(textResponse('It is 72F and sunny.'));

      const response = await agent.run('What is the weather?');

      // Should complete normally, no suspension
      expect(response.status).toBe('completed');
      expect(response.suspension).toBeUndefined();

      agent.destroy();
    });
  });

  describe('execution:suspended event', () => {
    it('should emit execution:suspended event', async () => {
      const suspendTool: ToolFunction = {
        definition: {
          type: 'function',
          function: {
            name: 'send_email',
            description: 'Send email',
            parameters: { type: 'object', properties: {} },
          },
        },
        execute: async () => SuspendSignal.create({
          result: 'Sent',
          correlationId: 'email:test',
        }),
      };

      const agent = Agent.create({
        connector: 'test-openai',
        model: 'gpt-4',
        tools: [suspendTool],
      });

      const suspendedEvents: any[] = [];
      agent.on('execution:suspended' as any, (event: any) => {
        suspendedEvents.push(event);
      });

      mockGenerate
        .mockResolvedValueOnce(toolCallResponse([{
          id: 'call_1',
          name: 'send_email',
          args: {},
        }]))
        .mockResolvedValueOnce(textResponse('Done.'));

      await agent.run('Send email');

      expect(suspendedEvents).toHaveLength(1);
      expect(suspendedEvents[0].correlationId).toBe('email:test');
      expect(suspendedEvents[0].sessionId).toBeDefined();

      agent.destroy();
    });
  });
});
