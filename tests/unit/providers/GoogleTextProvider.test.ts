/**
 * GoogleTextProvider Unit Tests
 * Tests the Google Gemini provider implementation with mocked SDK
 *
 * CRITICAL: Tests the generationConfig spreading fix we made
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MessageRole } from '@/domain/entities/Message.js';
import { ContentType } from '@/domain/entities/Content.js';
import {
  ProviderAuthError,
  ProviderRateLimitError,
  ProviderContextLengthError,
} from '@/domain/errors/AIErrors.js';
import { StreamEventType } from '@/domain/entities/StreamEvent.js';

// Create mock functions with vi.hoisted for proper hoisting
const { mockGenerateContent, mockGenerateContentStream, mockInteractionsCreate, mockGoogleGenAI } = vi.hoisted(() => {
  const mockGenerateContent = vi.fn();
  const mockGenerateContentStream = vi.fn();
  const mockInteractionsCreate = vi.fn();
  const mockGoogleGenAI = vi.fn(() => ({
    models: {
      generateContent: mockGenerateContent,
      generateContentStream: mockGenerateContentStream,
    },
    interactions: { create: mockInteractionsCreate },
  }));
  return { mockGenerateContent, mockGenerateContentStream, mockInteractionsCreate, mockGoogleGenAI };
});

// Mock Google GenAI SDK
vi.mock('@google/genai', () => ({
  GoogleGenAI: mockGoogleGenAI,
}));

// Import after mocking
import { GoogleTextProvider } from '@/infrastructure/providers/google/GoogleTextProvider.js';

describe('GoogleTextProvider', () => {
  let provider: GoogleTextProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new GoogleTextProvider({
      apiKey: 'test-google-api-key',
    });
  });

  describe('constructor', () => {
    it('should create GoogleGenAI client with API key', () => {
      expect(mockGoogleGenAI).toHaveBeenCalledWith({
        apiKey: 'test-google-api-key',
      });
    });
  });

  describe('name and capabilities', () => {
    it('should have name "google"', () => {
      expect(provider.name).toBe('google');
    });

    it('should have correct capabilities', () => {
      expect(provider.capabilities).toEqual({
        text: true,
        images: true,
        videos: false,
        audio: false,
      });
    });
  });

  describe('generate()', () => {
    const mockResponse = {
      candidates: [
        {
          content: {
            parts: [{ text: 'Hello from Gemini!' }],
          },
          finishReason: 'STOP',
        },
      ],
      usageMetadata: {
        promptTokenCount: 10,
        candidatesTokenCount: 5,
        totalTokenCount: 15,
      },
    };

    beforeEach(() => {
      mockGenerateContent.mockResolvedValue(mockResponse);
    });

    it('should call generateContent with correct model', async () => {
      await provider.generate({
        model: 'gemini-2.0-flash',
        input: 'Hello',
      });

      expect(mockGenerateContent).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'gemini-2.0-flash',
        })
      );
    });

    it('should spread generationConfig directly into config object (CRITICAL FIX)', async () => {
      await provider.generate({
        model: 'gemini-2.0-flash',
        input: 'Hello',
        temperature: 0.7,
        max_output_tokens: 1000,
      });

      // CRITICAL: generationConfig properties should be spread directly, not nested
      const call = mockGenerateContent.mock.calls[0][0];

      // Should NOT have nested generationConfig
      expect(call.config.generationConfig).toBeUndefined();

      // Should have properties spread directly
      expect(call.config.temperature).toBe(0.7);
      expect(call.config.maxOutputTokens).toBe(1000);
    });

    it('should pass systemInstruction correctly', async () => {
      await provider.generate({
        model: 'gemini-2.0-flash',
        input: 'Hello',
        instructions: 'You are a helpful assistant',
      });

      const call = mockGenerateContent.mock.calls[0][0];
      expect(call.config.systemInstruction).toEqual({
        parts: [{ text: 'You are a helpful assistant' }],
      });
    });

    it('should pass tools and toolConfig', async () => {
      await provider.generate({
        model: 'gemini-2.0-flash',
        input: 'What is the weather?',
        tools: [
          {
            type: 'function',
            function: {
              name: 'get_weather',
              description: 'Get weather',
              parameters: {
                type: 'object',
                properties: { city: { type: 'string' } },
              },
            },
          },
        ],
      });

      const call = mockGenerateContent.mock.calls[0][0];
      expect(call.config.tools).toBeDefined();
      expect(call.config.toolConfig).toBeDefined();
    });

    it('should convert response to LLMResponse format', async () => {
      const response = await provider.generate({
        model: 'gemini-2.0-flash',
        input: 'Hello',
      });

      expect(response).toEqual(
        expect.objectContaining({
          object: 'response',
          status: 'completed',
          output_text: 'Hello from Gemini!',
          usage: {
            input_tokens: 10,
            output_tokens: 5,
            total_tokens: 15,
          },
        })
      );
    });

    it('should include output array with message', async () => {
      const response = await provider.generate({
        model: 'gemini-2.0-flash',
        input: 'Hello',
      });

      expect(response.output).toHaveLength(1);
      expect(response.output[0]).toEqual(
        expect.objectContaining({
          type: 'message',
          role: MessageRole.ASSISTANT,
        })
      );
    });

    it('should handle function call in response', async () => {
      mockGenerateContent.mockResolvedValue({
        candidates: [
          {
            content: {
              parts: [
                {
                  functionCall: {
                    name: 'get_weather',
                    args: { city: 'Paris' },
                  },
                },
              ],
            },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 5,
          totalTokenCount: 15,
        },
      });

      const response = await provider.generate({
        model: 'gemini-2.0-flash',
        input: 'What is the weather in Paris?',
      });

      expect(response.output[0].content).toContainEqual(
        expect.objectContaining({
          type: ContentType.TOOL_USE,
          name: 'get_weather',
        })
      );
    });
  });

  describe('Interactions API', () => {
    it('routes Gemini 3.8 Flash through Interactions by default', async () => {
      mockInteractionsCreate.mockResolvedValue({
        id: 'int_38',
        model: 'gemini-3.8-flash',
        status: 'completed',
        steps: [{ type: 'model_output', content: [{ type: 'text', text: 'Gemini 3.8' }] }],
      });

      await provider.generate({ model: 'gemini-3.8-flash', input: 'hello' });

      expect(mockInteractionsCreate).toHaveBeenCalledWith(expect.objectContaining({
        model: 'gemini-3.8-flash',
      }));
      expect(mockGenerateContent).not.toHaveBeenCalled();
    });

    it('uses Interactions by default for Gemini 3.5+ and converts steps', async () => {
      mockInteractionsCreate.mockResolvedValue({
        id: 'int_123',
        model: 'gemini-3.6-flash',
        status: 'completed',
        steps: [{ type: 'model_output', content: [{ type: 'text', text: 'Hello from Interactions' }] }],
        usage: { input_tokens: 3, output_tokens: 4, total_tokens: 7 },
      });

      const response = await provider.generate({
        model: 'gemini-3.6-flash',
        input: 'hello',
        thinking: { enabled: true, effort: 'high' },
      });

      expect(mockInteractionsCreate).toHaveBeenCalledWith(expect.objectContaining({
        model: 'gemini-3.6-flash',
        input: 'hello',
        store: true,
        generation_config: { thinking_level: 'high' },
      }));
      expect(response.output_text).toBe('Hello from Interactions');
      expect(response.usage.total_tokens).toBe(7);
    });

    it('allows Interactions storage to be explicitly disabled', async () => {
      mockInteractionsCreate.mockResolvedValue({
        id: 'int_no_store',
        model: 'gemini-3.6-flash',
        status: 'completed',
        steps: [{ type: 'model_output', content: [{ type: 'text', text: 'No store' }] }],
      });

      await provider.generate({
        model: 'gemini-3.6-flash',
        input: 'hello',
        vendorOptions: { store: false },
      });

      expect(mockInteractionsCreate).toHaveBeenCalledWith(expect.objectContaining({ store: false }));
    });

    it('forces a named function with Interactions allowed_tools', async () => {
      mockInteractionsCreate.mockResolvedValue({
        id: 'int_named_tool',
        model: 'gemini-3.6-flash',
        status: 'completed',
        steps: [{ type: 'function_call', id: 'call_1', name: 'lookup', arguments: { q: 'x' } }],
      });

      await provider.generate({
        model: 'gemini-3.6-flash',
        input: 'look this up',
        tools: [{
          type: 'function',
          function: { name: 'lookup', description: 'Lookup', parameters: { type: 'object' } },
        }],
        tool_choice: { type: 'function', function: { name: 'lookup' } },
      });

      expect(mockInteractionsCreate.mock.calls[0][0].generation_config.tool_choice).toEqual({
        allowed_tools: { mode: 'any', tools: ['lookup'] },
      });
    });

    it('maps Gemini 3.8 file search, computer use, continuation, and usage', async () => {
      mockInteractionsCreate.mockResolvedValue({
        id: 'int_native_tools',
        model: 'gemini-3.8-flash',
        status: 'completed',
        continuation_token: 'continue_123',
        steps: [
          { type: 'file_search_call', id: 'search_1', status: 'completed' },
          { type: 'model_output', content: [{ type: 'text', text: 'Found it' }] },
        ],
        usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 },
      });

      const response = await provider.generate({
        model: 'gemini-3.8-flash',
        input: 'Find and open the relevant file',
        continuation_token: 'continue_previous',
        native_tools: [
          {
            capability: 'file_search',
            options: { vectorStoreIds: ['fileSearchStores/contract-store'] },
          },
          { capability: 'computer_use', options: { environment: 'browser' } },
        ],
        data_handling: { allowProviderTools: true },
      });

      expect(mockInteractionsCreate).toHaveBeenCalledWith(expect.objectContaining({
        continuation_token: 'continue_previous',
        tools: [
          {
            type: 'file_search',
            file_search_store_names: ['fileSearchStores/contract-store'],
          },
          { type: 'computer_use', environment: 'browser' },
        ],
      }));
      expect(response.continuation_token).toBe('continue_123');
      expect(response.usage.native_tool_calls).toEqual({ file_search: 1 });
    });

    it('preserves the order of text and tool calls in stateless Interactions history', async () => {
      mockInteractionsCreate.mockResolvedValue({
        id: 'int_ordered',
        model: 'gemini-3.6-flash',
        status: 'completed',
        steps: [{ type: 'model_output', content: [{ type: 'text', text: 'Done' }] }],
      });

      await provider.generate({
        model: 'gemini-3.6-flash',
        input: [{
          type: 'message',
          role: MessageRole.ASSISTANT,
          content: [
            { type: ContentType.OUTPUT_TEXT, text: 'Before tool' },
            { type: ContentType.TOOL_USE, id: 'call_1', name: 'lookup', arguments: '{"q":"x"}' },
            { type: ContentType.OUTPUT_TEXT, text: 'After tool' },
          ],
        }],
      });

      expect(mockInteractionsCreate.mock.calls[0][0].input).toEqual([
        { type: 'model_output', content: [{ type: 'text', text: 'Before tool' }] },
        { type: 'function_call', id: 'call_1', name: 'lookup', arguments: { q: 'x' } },
        { type: 'model_output', content: [{ type: 'text', text: 'After tool' }] },
      ]);
    });

    it('replays a signed Interactions thought exactly once before its function call', async () => {
      mockInteractionsCreate.mockResolvedValueOnce({
        id: 'int_signed_response',
        model: 'gemini-3.8-flash',
        status: 'requires_action',
        steps: [
          {
            type: 'thought',
            signature: 'signed-thought-state',
            summary: [{ type: 'text', text: 'Checking' }],
          },
          { type: 'model_output', content: [{ type: 'text', text: 'Working' }] },
          { type: 'function_call', id: 'call_1', name: 'lookup', arguments: { q: 'x' } },
        ],
      });

      const firstResponse = await provider.generate({
        model: 'gemini-3.8-flash',
        input: 'Use the tool',
        tools: [{
          type: 'function',
          function: { name: 'lookup', description: 'Lookup', parameters: { type: 'object' } },
        }],
      });

      mockInteractionsCreate.mockResolvedValueOnce({
        id: 'int_signed_continuation',
        model: 'gemini-3.8-flash',
        status: 'completed',
        steps: [{ type: 'model_output', content: [{ type: 'text', text: 'Done' }] }],
      });
      await provider.generate({
        model: 'gemini-3.8-flash',
        input: firstResponse.output,
      });

      expect(mockInteractionsCreate.mock.calls[1][0].input).toEqual([
        { type: 'thought', signature: 'signed-thought-state' },
        { type: 'model_output', content: [{ type: 'text', text: 'Working' }] },
        { type: 'function_call', id: 'call_1', name: 'lookup', arguments: { q: 'x' } },
      ]);
    });

    it('allows generateContent opt-out for current models', async () => {
      mockGenerateContent.mockResolvedValue({
        candidates: [{ content: { parts: [{ text: 'legacy path' }] }, finishReason: 'STOP' }],
        usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
      });

      await provider.generate({
        model: 'gemini-3.6-flash',
        input: 'hello',
        vendorOptions: { api: 'generateContent' },
      });

      expect(mockGenerateContent).toHaveBeenCalled();
      expect(mockInteractionsCreate).not.toHaveBeenCalled();
    });
  });

  describe('streamGenerate()', () => {
    it('should spread generationConfig in stream config (CRITICAL FIX)', async () => {
      const mockStream = {
        [Symbol.asyncIterator]: async function* () {
          yield {
            candidates: [{ content: { parts: [{ text: 'Hi' }] } }],
          };
        },
      };
      mockGenerateContentStream.mockResolvedValue(mockStream);

      const events: any[] = [];
      for await (const event of provider.streamGenerate({
        model: 'gemini-2.0-flash',
        input: 'Hello',
        temperature: 0.5,
        max_output_tokens: 500,
      })) {
        events.push(event);
      }

      // CRITICAL: generationConfig properties should be spread directly
      const call = mockGenerateContentStream.mock.calls[0][0];
      expect(call.config.generationConfig).toBeUndefined();
      expect(call.config.temperature).toBe(0.5);
      expect(call.config.maxOutputTokens).toBe(500);
    });

    it('should emit correct stream events', async () => {
      const mockStream = {
        [Symbol.asyncIterator]: async function* () {
          yield {
            candidates: [{ content: { parts: [{ text: 'Hello' }] } }],
          };
          yield {
            candidates: [{ content: { parts: [{ text: ' world' }] }, finishReason: 'STOP' }],
            usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2, totalTokenCount: 7 },
          };
        },
      };
      mockGenerateContentStream.mockResolvedValue(mockStream);

      const events: any[] = [];
      for await (const event of provider.streamGenerate({
        model: 'gemini-2.0-flash',
        input: 'Hello',
      })) {
        events.push(event);
      }

      // Should have RESPONSE_CREATED
      expect(events.some((e) => e.type === StreamEventType.RESPONSE_CREATED)).toBe(true);

      // Should have OUTPUT_TEXT_DELTA
      expect(events.some((e) => e.type === StreamEventType.OUTPUT_TEXT_DELTA)).toBe(true);

      // Should have RESPONSE_COMPLETE
      expect(events.some((e) => e.type === StreamEventType.RESPONSE_COMPLETE)).toBe(true);
    });

    it('assigns distinct output positions to interleaved Interactions steps', async () => {
      mockInteractionsCreate.mockResolvedValue({
        [Symbol.asyncIterator]: async function* () {
          yield {
            event_type: 'interaction.created',
            interaction: { id: 'int_ordered_stream', model: 'gemini-3.8-flash' },
          };
          yield { event_type: 'step.delta', index: 0, delta: { type: 'text', text: 'Before' } };
          yield {
            event_type: 'step.start',
            index: 1,
            step: { type: 'function_call', id: 'call_1', name: 'lookup', arguments: { q: 'x' } },
          };
          yield { event_type: 'step.stop', index: 1 };
          yield { event_type: 'step.delta', index: 2, delta: { type: 'text', text: 'After' } };
          yield {
            event_type: 'interaction.completed',
            interaction: { id: 'int_ordered_stream', status: 'completed' },
          };
        },
      });

      const events = [];
      for await (const event of provider.streamGenerate({
        model: 'gemini-3.8-flash',
        input: 'Use the tool',
        tools: [{
          type: 'function',
          function: { name: 'lookup', description: 'Lookup', parameters: { type: 'object' } },
        }],
      })) events.push(event);

      expect(events.filter((event) => event.type === StreamEventType.OUTPUT_TEXT_DELTA)).toEqual([
        expect.objectContaining({ item_id: 'msg_resp_google_int_ordered_stream_0', output_index: 0 }),
        expect.objectContaining({ item_id: 'msg_resp_google_int_ordered_stream_2', output_index: 2 }),
      ]);
      expect(events).toContainEqual(expect.objectContaining({
        type: StreamEventType.TOOL_CALL_START,
        item_id: 'tool_resp_google_int_ordered_stream_1',
        output_index: 1,
      }));
    });

    it('accumulates Interactions argument deltas and preserves thought signatures', async () => {
      mockInteractionsCreate.mockResolvedValue({
        [Symbol.asyncIterator]: async function* () {
          yield {
            event_type: 'interaction.created',
            interaction: { id: 'int_signed_tool', model: 'gemini-3.8-flash' },
          };
          yield { event_type: 'step.start', index: 0, step: { type: 'thought' } };
          yield {
            event_type: 'step.delta',
            index: 0,
            delta: { type: 'thought_summary', content: { type: 'text', text: 'Checking' } },
          };
          yield {
            event_type: 'step.delta',
            index: 0,
            delta: { type: 'thought_signature', signature: 'signed-thought-state' },
          };
          yield { event_type: 'step.stop', index: 0 };
          yield {
            event_type: 'step.start',
            index: 1,
            step: { type: 'function_call', id: 'call_1', name: 'lookup', arguments: {} },
          };
          yield {
            event_type: 'step.delta',
            index: 1,
            delta: { type: 'arguments_delta', arguments: '{"q":' },
          };
          yield {
            event_type: 'step.delta',
            index: 1,
            delta: { type: 'arguments_delta', arguments: '"x"}' },
          };
          yield { event_type: 'step.stop', index: 1 };
          yield {
            event_type: 'interaction.completed',
            interaction: { id: 'int_signed_tool', status: 'requires_action' },
          };
        },
      });

      const events = [];
      for await (const event of provider.streamGenerate({
        model: 'gemini-3.8-flash',
        input: 'Use the tool',
        tools: [{
          type: 'function',
          function: { name: 'lookup', description: 'Lookup', parameters: { type: 'object' } },
        }],
      })) events.push(event);

      const argumentDeltas = events
        .filter((event) => event.type === StreamEventType.TOOL_CALL_ARGUMENTS_DELTA)
        .map((event) => event.delta)
        .join('');
      expect(argumentDeltas).toBe('{"q":"x"}');
      expect(JSON.parse(argumentDeltas)).toEqual({ q: 'x' });
      expect(events).toContainEqual(expect.objectContaining({
        type: StreamEventType.TOOL_CALL_ARGUMENTS_DONE,
        arguments: '{"q":"x"}',
      }));
      expect(events).toContainEqual(expect.objectContaining({
        type: StreamEventType.REASONING_DONE,
        thinking: 'Checking',
        signature: 'signed-thought-state',
      }));
    });

    it.each([
      ['cancelled', 'failed'],
      ['budget_exceeded', 'incomplete'],
    ] as const)('maps Interactions status_update %s to %s', async (providerStatus, expected) => {
      mockInteractionsCreate.mockResolvedValue({
        [Symbol.asyncIterator]: async function* () {
          yield {
            event_type: 'interaction.created',
            interaction: { id: 'int_status', model: 'gemini-3.6-flash', status: 'in_progress' },
          };
          yield {
            event_type: 'step.stop',
            index: 0,
            usage: { total_input_tokens: 2, total_output_tokens: 1, total_tokens: 3 },
          };
          yield {
            event_type: 'interaction.status_update',
            interaction_id: 'int_status',
            status: providerStatus,
          };
        },
      });

      const events = [];
      for await (const event of provider.streamGenerate({
        model: 'gemini-3.6-flash',
        input: 'Hello',
      })) events.push(event);

      expect(events.at(-1)).toMatchObject({
        type: StreamEventType.RESPONSE_COMPLETE,
        status: expected,
        stop_reason: providerStatus,
        usage: { total_tokens: 3 },
      });
    });

    it('preserves typed Interactions usage when completion omits usage', async () => {
      mockInteractionsCreate.mockResolvedValue({
        [Symbol.asyncIterator]: async function* () {
          yield {
            event_type: 'interaction.created',
            interaction: { id: 'int_usage', model: 'gemini-3.8-flash', status: 'in_progress' },
          };
          yield {
            event_type: 'step.delta',
            index: 0,
            delta: { type: 'text', text: 'Done' },
            metadata: {
              total_usage: { total_input_tokens: 4, total_output_tokens: 2, total_tokens: 6 },
            },
          };
          yield {
            event_type: 'interaction.completed',
            interaction: { id: 'int_usage', status: 'completed' },
          };
        },
      });

      const events = [];
      for await (const event of provider.streamGenerate({
        model: 'gemini-3.8-flash',
        input: 'Hello',
      })) events.push(event);

      expect(events.at(-1)).toMatchObject({
        type: StreamEventType.RESPONSE_COMPLETE,
        status: 'completed',
        usage: { input_tokens: 4, output_tokens: 2, total_tokens: 6 },
      });
    });

    it('maps terminal Interactions cancellation and incomplete statuses', async () => {
      mockInteractionsCreate.mockResolvedValue({
        [Symbol.asyncIterator]: async function* () {
          yield {
            event_type: 'interaction.completed',
            interaction: {
              id: 'int_cancelled',
              model: 'gemini-3.6-flash',
              status: 'cancelled',
              usage: { input_tokens: 1, output_tokens: 0, total_tokens: 1 },
            },
          };
        },
      });

      const events = [];
      for await (const event of provider.streamGenerate({
        model: 'gemini-3.6-flash',
        input: 'Hello',
      })) events.push(event);

      expect(events.at(-1)).toMatchObject({ status: 'failed', stop_reason: 'cancelled' });
    });

    it('emits an error event and a failed completion for Interactions SSE errors', async () => {
      mockInteractionsCreate.mockResolvedValue({
        [Symbol.asyncIterator]: async function* () {
          yield {
            event_type: 'error',
            error: { code: 'quota_exceeded', message: 'Quota exhausted' },
          };
        },
      });

      const events = [];
      for await (const event of provider.streamGenerate({
        model: 'gemini-3.6-flash',
        input: 'Hello',
      })) events.push(event);

      expect(events).toContainEqual(expect.objectContaining({
        type: StreamEventType.ERROR,
        error: expect.objectContaining({ code: 'quota_exceeded', message: 'Quota exhausted' }),
        recoverable: false,
      }));
      expect(events.at(-1)).toMatchObject({
        type: StreamEventType.RESPONSE_COMPLETE,
        status: 'failed',
        stop_reason: 'quota_exceeded',
      });
    });

    it('does not report a stream without a terminal Interactions event as completed', async () => {
      mockInteractionsCreate.mockResolvedValue({
        [Symbol.asyncIterator]: async function* () {
          yield {
            event_type: 'interaction.created',
            interaction: { id: 'int_truncated', model: 'gemini-3.6-flash', status: 'in_progress' },
          };
        },
      });

      const events = [];
      for await (const event of provider.streamGenerate({
        model: 'gemini-3.6-flash',
        input: 'Hello',
      })) events.push(event);

      expect(events.at(-1)).toMatchObject({
        type: StreamEventType.RESPONSE_COMPLETE,
        status: 'incomplete',
      });
    });
  });

  describe('error handling', () => {
    it('should throw ProviderAuthError on invalid API key', async () => {
      mockGenerateContent.mockRejectedValue({
        status: 401,
        message: 'API key not valid',
      });

      await expect(
        provider.generate({ model: 'gemini-2.0-flash', input: 'Hello' })
      ).rejects.toThrow(ProviderAuthError);
    });

    it('should throw ProviderRateLimitError on resource exhausted', async () => {
      mockGenerateContent.mockRejectedValue({
        status: 429,
        message: 'Resource exhausted',
      });

      await expect(
        provider.generate({ model: 'gemini-2.0-flash', input: 'Hello' })
      ).rejects.toThrow(ProviderRateLimitError);
    });

    it('should throw ProviderContextLengthError on context too long', async () => {
      mockGenerateContent.mockRejectedValue({
        message: 'context length exceeded',
      });

      await expect(
        provider.generate({ model: 'gemini-2.0-flash', input: 'Hello' })
      ).rejects.toThrow(ProviderContextLengthError);
    });

    it('should re-throw unknown errors', async () => {
      const customError = new Error('Custom error');
      mockGenerateContent.mockRejectedValue(customError);

      await expect(
        provider.generate({ model: 'gemini-2.0-flash', input: 'Hello' })
      ).rejects.toThrow('Custom error');
    });
  });

  describe('getModelCapabilities()', () => {
    it('should return correct capabilities for gemini-2.0 models', () => {
      const caps = provider.getModelCapabilities('gemini-2.0-flash');

      expect(caps.supportsTools).toBe(true);
      expect(caps.supportsVision).toBe(true);
      expect(caps.supportsJSON).toBe(true);
      expect(caps.maxTokens).toBe(1048576);
    });

    it('should return correct capabilities for gemini-1.5 models', () => {
      const caps = provider.getModelCapabilities('gemini-1.5-pro');

      expect(caps.supportsTools).toBe(true);
      expect(caps.supportsVision).toBe(true);
      expect(caps.maxTokens).toBe(1048576);
    });
  });

  describe('converter cleanup', () => {
    it('should clean up converter mappings after successful request', async () => {
      mockGenerateContent.mockResolvedValue({
        candidates: [
          {
            content: { parts: [{ text: 'Hi' }] },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
      });

      // Make multiple requests - should not have memory leaks
      await provider.generate({ model: 'gemini-2.0-flash', input: 'Hello 1' });
      await provider.generate({ model: 'gemini-2.0-flash', input: 'Hello 2' });
      await provider.generate({ model: 'gemini-2.0-flash', input: 'Hello 3' });

      // If cleanup works, no errors should occur
      expect(mockGenerateContent).toHaveBeenCalledTimes(3);
    });

    it('should clean up converter mappings even on error', async () => {
      mockGenerateContent.mockRejectedValueOnce(new Error('Test error'));
      mockGenerateContent.mockResolvedValueOnce({
        candidates: [
          {
            content: { parts: [{ text: 'Hi' }] },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
      });

      // First request fails
      await expect(
        provider.generate({ model: 'gemini-2.0-flash', input: 'Hello' })
      ).rejects.toThrow();

      // Second request should still work (cleanup happened in finally block)
      const response = await provider.generate({
        model: 'gemini-2.0-flash',
        input: 'Hello again',
      });
      expect(response.output_text).toBe('Hi');
    });
  });
});
