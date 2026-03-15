/**
 * Agent Async Tool Tests
 * Tests non-blocking tool execution (blocking: false)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Agent, AgentConfig } from '@/core/Agent.js';
import { Connector } from '@/core/Connector.js';
import { Vendor } from '@/core/Vendor.js';
import { ToolFunction, ToolCallState } from '@/domain/entities/Tool.js';
import { MessageRole } from '@/domain/entities/Message.js';
import { ContentType } from '@/domain/entities/Content.js';
import { LLMResponse } from '@/domain/entities/Response.js';

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

describe('Agent - Async Tools', () => {
  let asyncToolExecute: ReturnType<typeof vi.fn>;
  let asyncToolResolve: ((value: unknown) => void) | null = null;
  let asyncToolReject: ((reason: Error) => void) | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    Connector.clear();

    Connector.create({
      name: 'test-openai',
      vendor: Vendor.OpenAI,
      auth: { type: 'api_key', apiKey: 'test-key' },
    });

    // Create a controllable async tool
    asyncToolExecute = vi.fn(() => new Promise((resolve, reject) => {
      asyncToolResolve = resolve;
      asyncToolReject = reject;
    }));
  });

  afterEach(() => {
    Connector.clear();
    asyncToolResolve = null;
    asyncToolReject = null;
  });

  function createAsyncTool(name = 'long_analysis'): ToolFunction {
    return {
      definition: {
        type: 'function',
        function: {
          name,
          description: 'A long-running analysis',
          parameters: { type: 'object', properties: { data: { type: 'string' } } },
        },
        blocking: false,
      },
      execute: asyncToolExecute,
    };
  }

  function createBlockingTool(name = 'read_data'): ToolFunction {
    return {
      definition: {
        type: 'function',
        function: {
          name,
          description: 'Read some data',
          parameters: { type: 'object', properties: { key: { type: 'string' } } },
        },
        // blocking: true is default
      },
      execute: vi.fn(async (args: any) => `data for ${args.key}`),
    };
  }

  it('should return placeholder for async tool and mark pendingAsyncTools on response', async () => {
    const asyncTool = createAsyncTool();

    const agent = Agent.create({
      connector: 'test-openai',
      model: 'gpt-4',
      asyncTools: { autoContinue: false },
      tools: [asyncTool],
    });

    // LLM call 1: calls the async tool
    // LLM call 2: sees placeholder, produces text response
    mockGenerate
      .mockResolvedValueOnce(toolCallResponse([
        { id: 'call_1', name: 'long_analysis', args: { data: 'test' } },
      ]))
      .mockResolvedValueOnce(textResponse('I started the analysis, waiting for results.'));

    const response = await agent.run('Analyze this');

    // The tool execute was called (fire-and-forget)
    expect(asyncToolExecute).toHaveBeenCalledWith({ data: 'test' }, expect.any(Object));

    // Response should have pending async tools
    expect(response.pendingAsyncTools).toBeDefined();
    expect(response.pendingAsyncTools).toHaveLength(1);
    expect(response.pendingAsyncTools![0].toolName).toBe('long_analysis');

    // Agent should report pending
    expect(agent.hasPendingAsyncTools()).toBe(true);
    expect(agent.getPendingAsyncTools()).toHaveLength(1);

    agent.cancelAllAsyncTools();
    agent.destroy();
  });

  it('should execute blocking and async tools in same iteration', async () => {
    const asyncTool = createAsyncTool();
    const blockingTool = createBlockingTool();

    const agent = Agent.create({
      connector: 'test-openai',
      model: 'gpt-4',
      asyncTools: { autoContinue: false },
      tools: [asyncTool, blockingTool],
    });

    // LLM calls both tools
    mockGenerate
      .mockResolvedValueOnce(toolCallResponse([
        { id: 'call_block', name: 'read_data', args: { key: 'foo' } },
        { id: 'call_async', name: 'long_analysis', args: { data: 'bar' } },
      ]))
      .mockResolvedValueOnce(textResponse('Got blocking data, async is running.'));

    const response = await agent.run('Do both things');

    // Blocking tool was awaited
    expect(blockingTool.execute).toHaveBeenCalledWith({ key: 'foo' }, expect.any(Object));
    // Async tool was started
    expect(asyncToolExecute).toHaveBeenCalledWith({ data: 'bar' }, expect.any(Object));

    expect(response.pendingAsyncTools).toHaveLength(1);

    agent.cancelAllAsyncTools();
    agent.destroy();
  });

  it('should auto-continue when async tool completes (autoContinue: true)', async () => {
    // Use a faster async tool that resolves quickly
    const quickAsyncExecute = vi.fn(async () => {
      return { analysis: 'done', score: 42 };
    });

    const asyncTool: ToolFunction = {
      definition: {
        type: 'function',
        function: {
          name: 'quick_analysis',
          description: 'Quick analysis',
          parameters: { type: 'object', properties: { data: { type: 'string' } } },
        },
        blocking: false,
      },
      execute: quickAsyncExecute,
    };

    const agent = Agent.create({
      connector: 'test-openai',
      model: 'gpt-4',
      asyncTools: { autoContinue: true, batchWindowMs: 50 },
      tools: [asyncTool],
    });

    // Initial run: tool call → placeholder → text
    mockGenerate
      .mockResolvedValueOnce(toolCallResponse([
        { id: 'call_q1', name: 'quick_analysis', args: { data: 'test' } },
      ]))
      .mockResolvedValueOnce(textResponse('Started analysis, will process when ready.'))
      // Auto-continuation: processes result message → text
      .mockResolvedValueOnce(textResponse('Analysis complete! Score is 42.'));

    const response = await agent.run('Analyze this');

    // The initial run completes with the second text response
    expect(response.output_text).toBe('Started analysis, will process when ready.');

    // Wait for auto-continuation to fire (async tool resolves instantly + batch window)
    await new Promise(resolve => setTimeout(resolve, 200));

    // The auto-continuation should have made another LLM call
    expect(mockGenerate).toHaveBeenCalledTimes(3);

    agent.destroy();
  });

  it('should deliver error results for failed async tools', async () => {
    const failingExecute = vi.fn(async () => {
      throw new Error('Analysis failed: invalid data');
    });

    const asyncTool: ToolFunction = {
      definition: {
        type: 'function',
        function: {
          name: 'failing_analysis',
          description: 'Failing analysis',
          parameters: { type: 'object', properties: {} },
        },
        blocking: false,
      },
      execute: failingExecute,
    };

    const agent = Agent.create({
      connector: 'test-openai',
      model: 'gpt-4',
      asyncTools: { autoContinue: true, batchWindowMs: 50 },
      tools: [asyncTool],
    });

    mockGenerate
      .mockResolvedValueOnce(toolCallResponse([
        { id: 'call_f1', name: 'failing_analysis', args: {} },
      ]))
      .mockResolvedValueOnce(textResponse('Started, waiting...'))
      // Continuation with error
      .mockResolvedValueOnce(textResponse('The analysis failed, let me try differently.'));

    const response = await agent.run('Analyze');
    expect(response.output_text).toBe('Started, waiting...');

    // Wait for auto-continuation
    await new Promise(resolve => setTimeout(resolve, 200));

    expect(mockGenerate).toHaveBeenCalledTimes(3);

    agent.destroy();
  });

  it('should emit async events', async () => {
    const quickExecute = vi.fn(async () => 'result');

    const asyncTool: ToolFunction = {
      definition: {
        type: 'function',
        function: {
          name: 'event_tool',
          description: 'Test events',
          parameters: { type: 'object', properties: {} },
        },
        blocking: false,
      },
      execute: quickExecute,
    };

    const agent = Agent.create({
      connector: 'test-openai',
      model: 'gpt-4',
      asyncTools: { autoContinue: false },
      tools: [asyncTool],
    });

    const startedEvents: any[] = [];
    const completeEvents: any[] = [];
    agent.on('async:tool:started', (e) => startedEvents.push(e));
    agent.on('async:tool:complete', (e) => completeEvents.push(e));

    mockGenerate
      .mockResolvedValueOnce(toolCallResponse([
        { id: 'call_ev1', name: 'event_tool', args: {} },
      ]))
      .mockResolvedValueOnce(textResponse('Ok'));

    await agent.run('Test');

    expect(startedEvents).toHaveLength(1);
    expect(startedEvents[0].toolName).toBe('event_tool');

    // Wait for async to complete
    await new Promise(resolve => setTimeout(resolve, 100));

    expect(completeEvents).toHaveLength(1);
    expect(completeEvents[0].toolName).toBe('event_tool');

    agent.cancelAllAsyncTools();
    agent.destroy();
  });

  it('should cancel async tools on destroy', async () => {
    const neverResolve = vi.fn(() => new Promise(() => {})); // never resolves

    const asyncTool: ToolFunction = {
      definition: {
        type: 'function',
        function: {
          name: 'hang_tool',
          description: 'Never completes',
          parameters: { type: 'object', properties: {} },
        },
        blocking: false,
      },
      execute: neverResolve,
    };

    const agent = Agent.create({
      connector: 'test-openai',
      model: 'gpt-4',
      asyncTools: { autoContinue: false },
      tools: [asyncTool],
    });

    mockGenerate
      .mockResolvedValueOnce(toolCallResponse([
        { id: 'call_h1', name: 'hang_tool', args: {} },
      ]))
      .mockResolvedValueOnce(textResponse('Started'));

    await agent.run('Start');

    expect(agent.hasPendingAsyncTools()).toBe(true);

    agent.destroy();

    // After destroy, no pending tools
    expect(agent.hasPendingAsyncTools()).toBe(false);
  });

  it('should support manual continueWithAsyncResults()', async () => {
    const agent = Agent.create({
      connector: 'test-openai',
      model: 'gpt-4',
      asyncTools: { autoContinue: false },
      tools: [createAsyncTool()],
    });

    mockGenerate
      .mockResolvedValueOnce(toolCallResponse([
        { id: 'call_m1', name: 'long_analysis', args: { data: 'test' } },
      ]))
      .mockResolvedValueOnce(textResponse('Started analysis.'));

    const response = await agent.run('Analyze');
    expect(response.pendingAsyncTools).toHaveLength(1);

    // Resolve the async tool externally
    asyncToolResolve!({ result: 'analysis complete' });
    await new Promise(resolve => setTimeout(resolve, 50));

    // Now manually continue
    mockGenerate.mockResolvedValueOnce(textResponse('Analysis result: complete'));

    const continuation = await agent.continueWithAsyncResults();
    expect(continuation.output_text).toBe('Analysis result: complete');

    agent.destroy();
  });

  it('should batch multiple async results', async () => {
    const tool1Execute = vi.fn(async () => 'result1');
    const tool2Execute = vi.fn(async () => 'result2');

    const tool1: ToolFunction = {
      definition: {
        type: 'function',
        function: { name: 'async_1', description: 'T1', parameters: { type: 'object', properties: {} } },
        blocking: false,
      },
      execute: tool1Execute,
    };

    const tool2: ToolFunction = {
      definition: {
        type: 'function',
        function: { name: 'async_2', description: 'T2', parameters: { type: 'object', properties: {} } },
        blocking: false,
      },
      execute: tool2Execute,
    };

    const agent = Agent.create({
      connector: 'test-openai',
      model: 'gpt-4',
      asyncTools: { autoContinue: true, batchWindowMs: 100 },
      tools: [tool1, tool2],
    });

    mockGenerate
      .mockResolvedValueOnce(toolCallResponse([
        { id: 'call_b1', name: 'async_1', args: {} },
        { id: 'call_b2', name: 'async_2', args: {} },
      ]))
      .mockResolvedValueOnce(textResponse('Both started.'))
      // Continuation with both results
      .mockResolvedValueOnce(textResponse('Both done!'));

    const response = await agent.run('Do both');
    expect(response.output_text).toBe('Both started.');

    // Both resolve instantly, batched together
    await new Promise(resolve => setTimeout(resolve, 300));

    // Should have made exactly 3 LLM calls (initial tool call, initial text, continuation)
    expect(mockGenerate).toHaveBeenCalledTimes(3);

    agent.destroy();
  });
});
