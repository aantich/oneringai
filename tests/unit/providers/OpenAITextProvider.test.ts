/**
 * OpenAITextProvider Unit Tests
 * Tests the OpenAI provider implementation with mocked SDK
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
const { mockCreate, mockOpenAI } = vi.hoisted(() => {
  const mockCreate = vi.fn();
  const mockOpenAI = vi.fn(() => ({
    responses: {
      create: mockCreate,
    },
  }));
  return { mockCreate, mockOpenAI };
});

// Mock OpenAI SDK
vi.mock('openai', () => ({
  default: mockOpenAI,
}));

// Import after mocking
import { OpenAITextProvider } from '@/infrastructure/providers/openai/OpenAITextProvider.js';

describe('OpenAITextProvider', () => {
  let provider: OpenAITextProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new OpenAITextProvider({
      apiKey: 'test-api-key',
    });
  });

  describe('constructor', () => {
    it('should create OpenAI client with correct config', () => {
      expect(mockOpenAI).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKey: 'test-api-key',
        })
      );
    });

    it('should use baseURL if provided', () => {
      new OpenAITextProvider({
        apiKey: 'test-key',
        baseURL: 'https://custom.api.com',
      });

      expect(mockOpenAI).toHaveBeenCalledWith(
        expect.objectContaining({
          baseURL: 'https://custom.api.com',
        })
      );
    });

    it('should pass organization if provided', () => {
      new OpenAITextProvider({
        apiKey: 'test-key',
        organization: 'org-123',
      });

      expect(mockOpenAI).toHaveBeenCalledWith(
        expect.objectContaining({
          organization: 'org-123',
        })
      );
    });

    it('should use default timeout and maxRetries', () => {
      new OpenAITextProvider({
        apiKey: 'test-key',
      });

      expect(mockOpenAI).toHaveBeenCalledWith(
        expect.objectContaining({
          timeout: 60000,
          maxRetries: 3,
        })
      );
    });

    it('should use custom timeout and maxRetries', () => {
      new OpenAITextProvider({
        apiKey: 'test-key',
        timeout: 30000,
        maxRetries: 5,
      });

      expect(mockOpenAI).toHaveBeenCalledWith(
        expect.objectContaining({
          timeout: 30000,
          maxRetries: 5,
        })
      );
    });

    it('passes a validated rotating key callback to the OpenAI SDK', async () => {
      const getApiKey = vi.fn()
        .mockResolvedValueOnce('first-key')
        .mockResolvedValueOnce('   ');
      new OpenAITextProvider({
        apiKey: 'runtime-key-provider',
        apiKeyProvider: getApiKey,
      });

      const apiKey = mockOpenAI.mock.calls.at(-1)?.[0].apiKey;
      expect(apiKey).toEqual(expect.any(Function));
      await expect(apiKey()).resolves.toBe('first-key');
      await expect(apiKey()).rejects.toThrow('OpenAI API key provider returned an empty key');
    });
  });

  describe('name and capabilities', () => {
    it('should have name "openai"', () => {
      expect(provider.name).toBe('openai');
    });

    it('should have correct capabilities', () => {
      expect(provider.capabilities).toEqual({
        text: true,
        images: true,
        videos: false,
        audio: true,
      });
    });
  });

  describe('generate()', () => {
    const mockResponse = {
      id: 'resp-123',
      created_at: 1234567890,
      model: 'gpt-4',
      object: 'response',
      status: 'completed',
      output_text: 'Hello! How can I help you?',
      output: [
        {
          type: 'message',
          id: 'msg-123',
          role: 'assistant',
          status: 'completed',
          content: [
            {
              type: 'output_text',
              text: 'Hello! How can I help you?',
              annotations: [],
            },
          ],
        },
      ],
      usage: {
        input_tokens: 10,
        output_tokens: 8,
        total_tokens: 18,
      },
    };

    beforeEach(() => {
      mockCreate.mockResolvedValue(mockResponse);
    });

    it('should call responses.create with correct parameters', async () => {
      await provider.generate({
        model: 'gpt-4',
        input: 'Hello',
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'gpt-4',
          input: expect.anything(),
        })
      );
    });

    it('should convert string input correctly', async () => {
      await provider.generate({
        model: 'gpt-4',
        input: 'Hello world',
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          input: 'Hello world',
        })
      );
    });

    it('should pass instructions separately', async () => {
      await provider.generate({
        model: 'gpt-4',
        input: 'Hello',
        instructions: 'You are a helpful assistant',
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          input: 'Hello',
          instructions: 'You are a helpful assistant',
        })
      );
    });

    it('should pass temperature and max_output_tokens', async () => {
      await provider.generate({
        model: 'gpt-4',
        input: 'Hello',
        temperature: 0.7,
        max_output_tokens: 1000,
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          temperature: 0.7,
          max_output_tokens: 1000,
        })
      );
    });

    it.each(['gpt-6-sol', 'gpt-6-luna'])(
      'passes sampling controls for %s only when reasoning effort is none',
      async (model) => {
        await provider.generate({
          model,
          input: 'Hello',
          temperature: 0.2,
          thinking: { enabled: true, effort: 'none' },
        });

        expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
          model,
          temperature: 0.2,
          reasoning: expect.objectContaining({ effort: 'none' }),
        }));
      },
    );

    it.each(['gpt-6-astra', 'gpt-6.1-sol', 'gpt-6-sol', 'gpt-6-luna'])(
      'rejects sampling controls for %s when reasoning is active',
      async (model) => {
        await expect(provider.generate({
          model,
          input: 'Hello',
          temperature: 0.2,
          thinking: { enabled: true, effort: 'high' },
        })).rejects.toThrow(/does not support temperature/);

        expect(mockCreate).not.toHaveBeenCalled();
      },
    );

    it('should convert tools to Responses API format', async () => {
      const tools = [
        {
          type: 'function' as const,
          function: {
            name: 'get_weather',
            description: 'Get weather',
            parameters: {
              type: 'object',
              properties: { city: { type: 'string' } },
            },
          },
        },
      ];

      await provider.generate({
        model: 'gpt-4',
        input: 'What is the weather?',
        tools,
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: [
            {
              type: 'function',
              name: 'get_weather',
              description: 'Get weather',
              parameters: {
                type: 'object',
                properties: { city: { type: 'string' } },
              },
              strict: false, // Default to false for backward compatibility
            },
          ],
        })
      );
    });

    it('should enable strict mode when explicitly requested', async () => {
      const tools = [
        {
          type: 'function' as const,
          function: {
            name: 'strict_tool',
            description: 'A tool with strict validation',
            parameters: {
              type: 'object',
              properties: { value: { type: 'string' } },
              additionalProperties: false,
              required: ['value'],
            },
            strict: true, // Explicitly enable strict mode
          },
        },
      ];

      await provider.generate({
        model: 'gpt-4',
        input: 'Test',
        tools,
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: [
            {
              type: 'function',
              name: 'strict_tool',
              description: 'A tool with strict validation',
              parameters: {
                type: 'object',
                properties: { value: { type: 'string' } },
                additionalProperties: false,
                required: ['value'],
              },
              strict: true,
            },
          ],
        })
      );
    });

    it('should convert response to LLMResponse format', async () => {
      const response = await provider.generate({
        model: 'gpt-4',
        input: 'Hello',
      });

      expect(response).toEqual(
        expect.objectContaining({
          id: 'resp-123',
          object: 'response',
          model: 'gpt-4',
          status: 'completed',
          output_text: 'Hello! How can I help you?',
          usage: {
            input_tokens: 10,
            output_tokens: 8,
            total_tokens: 18,
          },
        })
      );
    });

    it('should include output array with message', async () => {
      const response = await provider.generate({
        model: 'gpt-4',
        input: 'Hello',
      });

      expect(response.output).toHaveLength(1);
      expect(response.output[0]).toEqual(
        expect.objectContaining({
          type: 'message',
          role: MessageRole.ASSISTANT,
          content: expect.arrayContaining([
            expect.objectContaining({
              type: 'output_text',
              text: 'Hello! How can I help you?',
            }),
          ]),
        })
      );
    });

    it('should handle tool calls in response', async () => {
      mockCreate.mockResolvedValue({
        id: 'resp-456',
        created_at: 1234567890,
        model: 'gpt-4',
        object: 'response',
        status: 'completed',
        output_text: '',
        output: [
          {
            type: 'function_call',
            call_id: 'call_123',
            name: 'get_weather',
            arguments: '{"city":"Paris"}',
            status: 'completed',
          },
        ],
        usage: {
          input_tokens: 20,
          output_tokens: 5,
          total_tokens: 25,
        },
      });

      const response = await provider.generate({
        model: 'gpt-4',
        input: 'What is the weather in Paris?',
      });

      expect(response.output[0].content).toContainEqual(
        expect.objectContaining({
          type: 'tool_use',
          id: 'call_123',
          name: 'get_weather',
          arguments: '{"city":"Paris"}',
        })
      );
    });

    it('should convert InputItem array correctly', async () => {
      await provider.generate({
        model: 'gpt-4',
        input: [
          {
            type: 'message',
            role: MessageRole.USER,
            content: [{ type: ContentType.INPUT_TEXT, text: 'Hello' }],
          },
          {
            type: 'message',
            role: MessageRole.ASSISTANT,
            content: [{ type: ContentType.OUTPUT_TEXT, text: 'Hi there!', annotations: [] }],
          },
        ],
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.arrayContaining([
            expect.objectContaining({ type: 'message', role: 'user' }),
            expect.objectContaining({ type: 'message', role: 'assistant' }),
          ]),
        })
      );
    });
  });

  describe('streamGenerate()', () => {
    it('should enable streaming with stream: true', async () => {
      const mockStreamResponse = {
        [Symbol.asyncIterator]: async function* () {
          yield {
            type: 'response.created',
            response: {
              id: 'resp-123',
              model: 'gpt-4',
              created_at: 1234567890,
            },
            sequence_number: 0,
          };
          yield {
            type: 'response.output_item.added',
            item: {
              type: 'message',
              id: 'msg-123',
              role: 'assistant',
              content: [],
              status: 'in_progress',
            },
            output_index: 0,
            sequence_number: 1,
          };
          yield {
            type: 'response.output_text.delta',
            delta: 'Hello',
            item_id: 'msg-123',
            output_index: 0,
            content_index: 0,
            sequence_number: 2,
            logprobs: [],
          };
          yield {
            type: 'response.output_text.delta',
            delta: ' world',
            item_id: 'msg-123',
            output_index: 0,
            content_index: 0,
            sequence_number: 3,
            logprobs: [],
          };
          yield {
            type: 'response.completed',
            response: {
              id: 'resp-123',
              model: 'gpt-4',
              created_at: 1234567890,
              status: 'completed',
              usage: {
                input_tokens: 5,
                output_tokens: 2,
                total_tokens: 7,
              },
            },
            sequence_number: 4,
          };
        },
      };

      mockCreate.mockResolvedValue(mockStreamResponse);

      const events: any[] = [];
      for await (const event of provider.streamGenerate({
        model: 'gpt-4',
        input: 'Hello',
      })) {
        events.push(event);
      }

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
            type: 'response.created',
            response: {
              id: 'resp-123',
              model: 'gpt-4',
              created_at: 1234567890,
            },
            sequence_number: 0,
          };
          yield {
            type: 'response.output_item.added',
            item: {
              type: 'message',
              id: 'msg-123',
              role: 'assistant',
              content: [],
              status: 'in_progress',
            },
            output_index: 0,
            sequence_number: 1,
          };
          yield {
            type: 'response.output_text.delta',
            delta: 'Hi',
            item_id: 'msg-123',
            output_index: 0,
            content_index: 0,
            sequence_number: 2,
            logprobs: [],
          };
          yield {
            type: 'response.completed',
            response: {
              id: 'resp-123',
              model: 'gpt-4',
              created_at: 1234567890,
              status: 'completed',
              usage: {
                input_tokens: 5,
                output_tokens: 1,
                total_tokens: 6,
              },
            },
            sequence_number: 3,
          };
        },
      };

      mockCreate.mockResolvedValue(mockStreamResponse);

      const events: any[] = [];
      for await (const event of provider.streamGenerate({
        model: 'gpt-4',
        input: 'Hello',
      })) {
        events.push(event);
      }

      // Should have RESPONSE_CREATED
      expect(events.some((e) => e.type === StreamEventType.RESPONSE_CREATED)).toBe(true);

      // Should have OUTPUT_TEXT_DELTA
      expect(events.some((e) => e.type === StreamEventType.OUTPUT_TEXT_DELTA)).toBe(true);

      // Should have RESPONSE_COMPLETE with usage
      const complete = events.find((e) => e.type === StreamEventType.RESPONSE_COMPLETE);
      expect(complete).toBeDefined();
      expect(complete.usage.input_tokens).toBe(5);
    });
  });

  describe('error handling', () => {
    it('should throw ProviderAuthError on 401', async () => {
      mockCreate.mockRejectedValue({ status: 401 });

      await expect(
        provider.generate({ model: 'gpt-4', input: 'Hello' })
      ).rejects.toThrow(ProviderAuthError);
    });

    it('should throw ProviderRateLimitError on 429', async () => {
      mockCreate.mockRejectedValue({ status: 429 });

      await expect(
        provider.generate({ model: 'gpt-4', input: 'Hello' })
      ).rejects.toThrow(ProviderRateLimitError);
    });

    it('should throw ProviderContextLengthError on context exceeded', async () => {
      mockCreate.mockRejectedValue({ code: 'context_length_exceeded' });

      await expect(
        provider.generate({ model: 'gpt-4', input: 'Hello' })
      ).rejects.toThrow(ProviderContextLengthError);
    });

    it('should re-throw unknown errors', async () => {
      const customError = new Error('Custom error');
      mockCreate.mockRejectedValue(customError);

      await expect(
        provider.generate({ model: 'gpt-4', input: 'Hello' })
      ).rejects.toThrow('Custom error');
    });
  });

  describe('getModelCapabilities()', () => {
    it('should return registry capabilities for registered models', () => {
      const caps = provider.getModelCapabilities('gpt-5.2');

      expect(caps.supportsTools).toBe(true);
      expect(caps.supportsJSON).toBe(true);
      expect(caps.supportsJSONSchema).toBe(true);
      expect(caps.maxTokens).toBe(400000);
      expect(caps.maxOutputTokens).toBe(128000);
    });

    it('should return registry capabilities for o-series models', () => {
      const caps = provider.getModelCapabilities('o3-mini');

      expect(caps.supportsTools).toBe(true);
      expect(caps.supportsVision).toBe(false);
      expect(caps.maxTokens).toBe(200000);
    });

    it('should return vendor defaults for unregistered models', () => {
      const caps = provider.getModelCapabilities('unknown-model');

      expect(caps.supportsTools).toBe(true);
      expect(caps.maxTokens).toBe(128000);
      expect(caps.maxOutputTokens).toBe(16384);
    });
  });
});
