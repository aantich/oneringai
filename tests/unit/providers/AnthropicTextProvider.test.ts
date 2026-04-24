/**
 * AnthropicTextProvider Unit Tests
 * Tests the Anthropic provider implementation with mocked SDK
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

// Create mock functions with vi.hoisted for proper hoisting.
// `generate()` uses messages.stream(...).finalMessage(); streamGenerate() uses
// messages.create({ stream: true }). Both are mocked here so each code path
// can set its own behavior.
const { mockCreate, mockStream, mockFinalMessage, mockAnthropic } = vi.hoisted(() => {
  const mockCreate = vi.fn();
  const mockFinalMessage = vi.fn();
  const mockStream = vi.fn(() => ({
    finalMessage: mockFinalMessage,
    controller: { abort: vi.fn() },
    abort: vi.fn(),
  }));
  const mockAnthropic = vi.fn(() => ({
    messages: {
      create: mockCreate,
      stream: mockStream,
    },
  }));
  return { mockCreate, mockStream, mockFinalMessage, mockAnthropic };
});

// Mock Anthropic SDK
vi.mock('@anthropic-ai/sdk', () => ({
  default: mockAnthropic,
}));

// Import after mocking
import { AnthropicTextProvider } from '@/infrastructure/providers/anthropic/AnthropicTextProvider.js';

describe('AnthropicTextProvider', () => {
  let provider: AnthropicTextProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new AnthropicTextProvider({
      apiKey: 'test-anthropic-key',
    });
  });

  describe('constructor', () => {
    it('should create Anthropic client with correct config', () => {
      expect(mockAnthropic).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKey: 'test-anthropic-key',
        })
      );
    });

    it('should use custom baseURL if provided', () => {
      new AnthropicTextProvider({
        apiKey: 'test-key',
        baseURL: 'https://custom.anthropic.com',
      });

      expect(mockAnthropic).toHaveBeenCalledWith(
        expect.objectContaining({
          baseURL: 'https://custom.anthropic.com',
        })
      );
    });

    it('should use default maxRetries', () => {
      new AnthropicTextProvider({
        apiKey: 'test-key',
      });

      // Note: Anthropic SDK doesn't take timeout in constructor, only maxRetries
      expect(mockAnthropic).toHaveBeenCalledWith(
        expect.objectContaining({
          maxRetries: 3,
        })
      );
    });
  });

  describe('name and capabilities', () => {
    it('should have name "anthropic"', () => {
      expect(provider.name).toBe('anthropic');
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
      id: 'msg_123',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: 'Hello from Claude!' }],
      model: 'claude-3-5-sonnet-20241022',
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: {
        input_tokens: 10,
        output_tokens: 5,
      },
    };

    beforeEach(() => {
      // generate() routes through messages.stream(...).finalMessage()
      mockFinalMessage.mockResolvedValue(mockResponse);
    });

    it('should call messages.stream with converted request', async () => {
      await provider.generate({
        model: 'claude-3-5-sonnet-20241022',
        input: 'Hello',
      });

      expect(mockStream).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'claude-3-5-sonnet-20241022',
          messages: expect.any(Array),
          max_tokens: expect.any(Number),
        })
      );
    });

    it('should convert string input to user message', async () => {
      await provider.generate({
        model: 'claude-3-5-sonnet-20241022',
        input: 'Hello world',
      });

      expect(mockStream).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [{ role: 'user', content: 'Hello world' }],
        })
      );
    });

    it('should pass system instructions correctly', async () => {
      await provider.generate({
        model: 'claude-3-5-sonnet-20241022',
        input: 'Hello',
        instructions: 'You are a helpful assistant',
      });

      expect(mockStream).toHaveBeenCalledWith(
        expect.objectContaining({
          system: 'You are a helpful assistant',
        })
      );
    });

    it('should pass temperature if provided', async () => {
      await provider.generate({
        model: 'claude-3-5-sonnet-20241022',
        input: 'Hello',
        temperature: 0.7,
      });

      expect(mockStream).toHaveBeenCalledWith(
        expect.objectContaining({
          temperature: 0.7,
        })
      );
    });

    it('should pass max_tokens correctly', async () => {
      await provider.generate({
        model: 'claude-3-5-sonnet-20241022',
        input: 'Hello',
        max_output_tokens: 2000,
      });

      expect(mockStream).toHaveBeenCalledWith(
        expect.objectContaining({
          max_tokens: 2000,
        })
      );
    });

    it('should convert response to LLMResponse format', async () => {
      const response = await provider.generate({
        model: 'claude-3-5-sonnet-20241022',
        input: 'Hello',
      });

      expect(response).toEqual(
        expect.objectContaining({
          object: 'response',
          model: 'claude-3-5-sonnet-20241022',
          status: 'completed',
          output_text: 'Hello from Claude!',
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
        model: 'claude-3-5-sonnet-20241022',
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

    it('should handle tool use in response', async () => {
      mockFinalMessage.mockResolvedValue({
        ...mockResponse,
        content: [
          {
            type: 'tool_use',
            id: 'toolu_123',
            name: 'get_weather',
            input: { city: 'Paris' },
          },
        ],
        stop_reason: 'tool_use',
      });

      const response = await provider.generate({
        model: 'claude-3-5-sonnet-20241022',
        input: 'What is the weather in Paris?',
      });

      expect(response.output[0].content).toContainEqual(
        expect.objectContaining({
          type: ContentType.TOOL_USE,
          id: 'toolu_123',
          name: 'get_weather',
        })
      );
    });

    it('should convert tools to Anthropic format', async () => {
      await provider.generate({
        model: 'claude-3-5-sonnet-20241022',
        input: 'What is the weather?',
        tools: [
          {
            type: 'function',
            function: {
              name: 'get_weather',
              description: 'Get weather for a city',
              parameters: {
                type: 'object',
                properties: { city: { type: 'string' } },
                required: ['city'],
              },
            },
          },
        ],
      });

      expect(mockStream).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: expect.arrayContaining([
            expect.objectContaining({
              name: 'get_weather',
              description: 'Get weather for a city',
            }),
          ]),
        })
      );
    });
  });

  describe('streamGenerate()', () => {
    it('should use stream for streaming responses', async () => {
      // Note: The implementation uses messages.create({ stream: true }), not messages.stream()
      const mockStreamResponse = {
        [Symbol.asyncIterator]: async function* () {
          yield {
            type: 'message_start',
            message: {
              id: 'msg_123',
              type: 'message',
              role: 'assistant',
              content: [],
              model: 'claude-3-5-sonnet-20241022',
              stop_reason: null,
              stop_sequence: null,
              usage: { input_tokens: 10, output_tokens: 0 },
            },
          };
          yield {
            type: 'content_block_start',
            index: 0,
            content_block: { type: 'text', text: '' },
          };
          yield {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: 'Hello' },
          };
          yield {
            type: 'content_block_stop',
            index: 0,
          };
          yield {
            type: 'message_delta',
            delta: { stop_reason: 'end_turn', stop_sequence: null },
            usage: { output_tokens: 1 },
          };
          yield { type: 'message_stop' };
        },
      };

      mockCreate.mockResolvedValue(mockStreamResponse);

      const events: any[] = [];
      for await (const event of provider.streamGenerate({
        model: 'claude-3-5-sonnet-20241022',
        input: 'Hello',
      })) {
        events.push(event);
      }

      // Verify create was called with stream: true
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          stream: true,
        })
      );
    });

    it('should emit correct stream events', async () => {
      const mockStreamResponse = {
        [Symbol.asyncIterator]: async function* () {
          yield {
            type: 'message_start',
            message: {
              id: 'msg_123',
              type: 'message',
              role: 'assistant',
              content: [],
              model: 'claude-3-5-sonnet-20241022',
              stop_reason: null,
              stop_sequence: null,
              usage: { input_tokens: 10, output_tokens: 0 },
            },
          };
          yield {
            type: 'content_block_start',
            index: 0,
            content_block: { type: 'text', text: '' },
          };
          yield {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: 'Hi!' },
          };
          yield {
            type: 'content_block_stop',
            index: 0,
          };
          yield {
            type: 'message_delta',
            delta: { stop_reason: 'end_turn', stop_sequence: null },
            usage: { output_tokens: 1 },
          };
          yield { type: 'message_stop' };
        },
      };

      mockCreate.mockResolvedValue(mockStreamResponse);

      const events: any[] = [];
      for await (const event of provider.streamGenerate({
        model: 'claude-3-5-sonnet-20241022',
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
  });

  describe('error handling', () => {
    it('should throw ProviderAuthError on 401', async () => {
      mockFinalMessage.mockRejectedValue({ status: 401 });

      await expect(
        provider.generate({ model: 'claude-3-5-sonnet-20241022', input: 'Hello' })
      ).rejects.toThrow(ProviderAuthError);
    });

    it('should throw ProviderRateLimitError on 429', async () => {
      mockFinalMessage.mockRejectedValue({ status: 429 });

      await expect(
        provider.generate({ model: 'claude-3-5-sonnet-20241022', input: 'Hello' })
      ).rejects.toThrow(ProviderRateLimitError);
    });

    it('should throw ProviderContextLengthError on overloaded error', async () => {
      // The implementation checks for type === 'invalid_request_error' AND message contains 'prompt is too long'
      mockFinalMessage.mockRejectedValue({
        status: 400,
        type: 'invalid_request_error',
        message: 'prompt is too long',
      });

      await expect(
        provider.generate({ model: 'claude-3-5-sonnet-20241022', input: 'Hello' })
      ).rejects.toThrow(ProviderContextLengthError);
    });

    it('should re-throw unknown errors', async () => {
      const customError = new Error('Custom error');
      mockFinalMessage.mockRejectedValue(customError);

      await expect(
        provider.generate({ model: 'claude-3-5-sonnet-20241022', input: 'Hello' })
      ).rejects.toThrow('Custom error');
    });
  });

  describe('getModelCapabilities()', () => {
    it('should return correct capabilities for Claude 3.5 Sonnet', () => {
      const caps = provider.getModelCapabilities('claude-3-5-sonnet-20241022');

      expect(caps.supportsTools).toBe(true);
      expect(caps.supportsVision).toBe(true);
      expect(caps.supportsJSON).toBe(true);
    });

    it('should return correct capabilities for Claude 3 Opus', () => {
      const caps = provider.getModelCapabilities('claude-3-opus-20240229');

      expect(caps.supportsTools).toBe(true);
      expect(caps.supportsVision).toBe(true);
    });

    it('should return correct capabilities for Claude 3 Haiku', () => {
      const caps = provider.getModelCapabilities('claude-3-haiku-20240307');

      expect(caps.supportsTools).toBe(true);
      expect(caps.supportsVision).toBe(true);
    });
  });

  describe('converter cleanup', () => {
    it('should clean up converter after request', async () => {
      mockFinalMessage.mockResolvedValue({
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'Hi' }],
        model: 'claude-3-5-sonnet-20241022',
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      });

      // Multiple requests should work without memory leaks
      await provider.generate({ model: 'claude-3-5-sonnet-20241022', input: 'Hello 1' });
      await provider.generate({ model: 'claude-3-5-sonnet-20241022', input: 'Hello 2' });
      await provider.generate({ model: 'claude-3-5-sonnet-20241022', input: 'Hello 3' });

      expect(mockStream).toHaveBeenCalledTimes(3);
    });
  });
});
