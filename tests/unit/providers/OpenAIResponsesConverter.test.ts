/**
 * OpenAIResponsesConverter Unit Tests
 * Tests bidirectional conversion between our format and OpenAI Responses API
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { OpenAIResponsesConverter } from '@/infrastructure/providers/openai/OpenAIResponsesConverter.js';
import { MessageRole } from '@/domain/entities/Message.js';
import { ContentType } from '@/domain/entities/Content.js';
import { InvalidConfigError } from '@/domain/errors/AIErrors.js';
import type * as ResponsesAPI from 'openai/resources/responses/responses.js';

describe('OpenAIResponsesConverter', () => {
  let converter: OpenAIResponsesConverter;

  beforeEach(() => {
    converter = new OpenAIResponsesConverter();
  });

  describe('convertResponse() - Responses API → Our format', () => {
    it('should extract message ID from output items, not response ID', () => {
      // This is the critical test for the bug fix
      const mockResponse: ResponsesAPI.Response = {
        id: 'resp_070349d516eb005e00697787014084819081b359ca10e05383', // Response ID starts with "resp_"
        object: 'response',
        created_at: 1234567890,
        status: 'completed',
        model: 'gpt-5.2',
        output: [
          {
            type: 'message',
            id: 'msg_67ccd2bf17f0819081ff3bb2cf6508e60bb6a6b452d3795b', // Message ID starts with "msg_"
            status: 'completed',
            role: 'assistant',
            content: [
              {
                type: 'output_text',
                text: 'Hello, world!',
                annotations: [],
              },
            ],
          } as ResponsesAPI.ResponseOutputMessage,
        ],
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          total_tokens: 15,
        },
      } as any;

      const result = converter.convertResponse(mockResponse);

      // The bug was that result.output[0].id would be "resp_..." instead of "msg_..."
      expect(result.output[0].id).toBe('msg_67ccd2bf17f0819081ff3bb2cf6508e60bb6a6b452d3795b');
      expect(result.output[0].id).toMatch(/^msg_/); // Must start with "msg_"
      expect(result.output[0].id).not.toMatch(/^resp_/); // Must NOT start with "resp_"
    });

    it('should handle response with function call', () => {
      const mockResponse: ResponsesAPI.Response = {
        id: 'resp_12345',
        object: 'response',
        created_at: 1234567890,
        status: 'completed',
        model: 'gpt-5.2',
        output: [
          {
            type: 'function_call',
            id: 'fc_67890',
            call_id: 'call_abc123',
            name: 'get_weather',
            arguments: '{"location":"Paris"}',
            status: 'completed',
          } as ResponsesAPI.ResponseFunctionToolCall,
        ],
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          total_tokens: 15,
        },
      } as any;

      const result = converter.convertResponse(mockResponse);

      expect(result.output[0].content[0]).toEqual({
        type: 'tool_use',
        id: 'call_abc123',
        name: 'get_weather',
        arguments: '{"location":"Paris"}',
      });
    });

    it('preserves async function and custom tool calls', () => {
      const result = converter.convertResponse({
        id: 'resp_async',
        object: 'response',
        created_at: 1,
        status: 'completed',
        model: 'gpt-6-astra',
        output: [
          {
            type: 'function_call', call_id: 'call_fn', name: 'lookup',
            arguments: '{}', async: true, status: 'completed',
          },
          {
            type: 'custom_tool_call', call_id: 'call_custom', name: 'shell',
            input: 'long task', async: true, status: 'completed',
          },
        ],
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      } as any);

      expect((result.output[0] as any).content).toEqual([
        { type: 'tool_use', id: 'call_fn', name: 'lookup', arguments: '{}', async: true },
        { type: 'custom_tool_use', id: 'call_custom', name: 'shell', input: 'long task', async: true },
      ]);
    });

    it('should handle response with reasoning item (GPT-5 models)', () => {
      const mockResponse: ResponsesAPI.Response = {
        id: 'resp_12345',
        object: 'response',
        created_at: 1234567890,
        status: 'completed',
        model: 'gpt-5.2-thinking',
        output: [
          {
            type: 'reasoning',
            id: 'reasoning_12345',
            summary: 'Let me think about this step by step...',
            status: 'completed',
          } as ResponsesAPI.ResponseReasoningItem,
          {
            type: 'message',
            id: 'msg_67890',
            status: 'completed',
            role: 'assistant',
            content: [
              {
                type: 'output_text',
                text: 'The answer is 42.',
                annotations: [],
              },
            ],
          } as ResponsesAPI.ResponseOutputMessage,
        ],
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          total_tokens: 15,
        },
      } as any;

      const result = converter.convertResponse(mockResponse);

      // Should extract message ID from the message item, not reasoning item
      expect(result.output[0].id).toBe('msg_67890');
      expect(result.output[0].content).toHaveLength(2);
      expect(result.output[0].content[0].type).toBe('thinking');
      expect((result.output[0].content[0] as any).thinking).toBe('Let me think about this step by step...');
      expect((result.output[0].content[0] as any).persistInHistory).toBe(false);
      expect(result.output[0].content[1].type).toBe('output_text');
    });

    it('preserves encrypted reasoning once for stateless replay', () => {
      const result = converter.convertResponse({
        id: 'resp_encrypted',
        object: 'response',
        created_at: 1,
        status: 'completed',
        model: 'gpt-6-astra',
        output: [
          {
            type: 'reasoning', id: 'reasoning_1', status: 'completed',
            summary: [{ type: 'summary_text', text: 'Private summary' }],
            encrypted_content: 'opaque-reasoning',
          },
          {
            type: 'message', id: 'msg_1', status: 'completed', role: 'assistant',
            content: [{ type: 'output_text', text: 'Answer', annotations: [] }],
          },
        ],
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      } as any);

      expect(result.output).toEqual([
        expect.objectContaining({
          type: 'reasoning', id: 'reasoning_1', encrypted_content: 'opaque-reasoning',
        }),
        expect.objectContaining({
          type: 'message', id: 'msg_1',
          content: [expect.objectContaining({ type: 'output_text', text: 'Answer' })],
        }),
      ]);
      expect(result.thinking).toBe('Private summary');
      const replay = converter.convertInput(result.output).input as any[];
      expect(replay.filter((item) => item.type === 'reasoning')).toHaveLength(1);
    });

    it('should fallback to response ID if no message ID found', () => {
      // Edge case: if there's no message item, use response ID as fallback
      const mockResponse: ResponsesAPI.Response = {
        id: 'resp_12345',
        object: 'response',
        created_at: 1234567890,
        status: 'completed',
        model: 'gpt-5.2',
        output: [
          {
            type: 'function_call',
            id: 'fc_67890',
            call_id: 'call_abc123',
            name: 'get_weather',
            arguments: '{"location":"Paris"}',
            status: 'completed',
          } as ResponsesAPI.ResponseFunctionToolCall,
        ],
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          total_tokens: 15,
        },
      } as any;

      const result = converter.convertResponse(mockResponse);

      // No message item, so fallback to response ID
      expect(result.output[0].id).toBe('resp_12345');
    });

    it('preserves compaction items in provider output order', () => {
      const result = converter.convertResponse({
        id: 'resp_compacted',
        object: 'response',
        created_at: 1,
        status: 'completed',
        model: 'gpt-6-astra',
        output: [
          {
            type: 'message', id: 'msg_before', status: 'completed', role: 'assistant',
            content: [{ type: 'output_text', text: 'Before.', annotations: [] }],
          },
          { type: 'compaction', id: 'cmp_1', encrypted_content: 'opaque-state' },
          {
            type: 'message', id: 'msg_after', status: 'completed', role: 'assistant',
            content: [{ type: 'output_text', text: 'After.', annotations: [] }],
          },
        ],
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      } as any);

      expect(result.output).toEqual([
        expect.objectContaining({ type: 'message', id: 'msg_before' }),
        { type: 'compaction', id: 'cmp_1', encrypted_content: 'opaque-state' },
        expect.objectContaining({ type: 'message', id: 'msg_after' }),
      ]);
      expect(result.output_text).toBe('Before.After.');
    });

    it('keeps a compaction-only response compaction-only', () => {
      const result = converter.convertResponse({
        id: 'resp_compacted', object: 'response', created_at: 1,
        status: 'completed', model: 'gpt-6-astra',
        output: [{ type: 'compaction', id: 'cmp_1', encrypted_content: 'opaque-state' }],
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      } as any);

      expect(result.output).toEqual([
        { type: 'compaction', id: 'cmp_1', encrypted_content: 'opaque-state' },
      ]);
    });
  });

  describe('convertInput() - Our format → Responses API', () => {
    it('should preserve message IDs when converting to Responses API format', () => {
      const { input } = converter.convertInput([
        {
          type: 'message',
          id: 'msg_user123',
          role: MessageRole.USER,
          content: [{ type: ContentType.INPUT_TEXT, text: 'Hello' }],
        },
        {
          type: 'message',
          id: 'msg_assistant456', // This ID should be preserved (starts with msg_)
          role: MessageRole.ASSISTANT,
          content: [{ type: ContentType.OUTPUT_TEXT, text: 'Hi there!' }],
        },
      ]);

      const items = input as ResponsesAPI.ResponseInputItem[];
      expect(items).toHaveLength(2);
      expect((items[0] as ResponsesAPI.ResponseInputItem.Message).id).toBe('msg_user123');
      expect((items[1] as ResponsesAPI.ResponseInputItem.Message).id).toBe('msg_assistant456');
    });

    it('should convert tool use and tool result correctly', () => {
      const { input } = converter.convertInput([
        {
          type: 'message',
          role: MessageRole.ASSISTANT,
          content: [
            {
              type: ContentType.TOOL_USE,
              id: 'call_abc123',
              name: 'get_weather',
              arguments: '{"location":"Paris"}',
            },
          ],
        },
        {
          type: 'message',
          role: MessageRole.USER,
          content: [
            {
              type: ContentType.TOOL_RESULT,
              tool_use_id: 'call_abc123',
              content: '{"temp":22,"condition":"sunny"}',
            },
          ],
        },
      ]);

      const items = input as ResponsesAPI.ResponseInputItem[];

      // Tool use becomes function_call
      expect(items[0].type).toBe('function_call');
      expect((items[0] as ResponsesAPI.ResponseFunctionToolCall).call_id).toBe('call_abc123');
      expect((items[0] as ResponsesAPI.ResponseFunctionToolCall).name).toBe('get_weather');

      // Tool result becomes function_call_output
      expect(items[1].type).toBe('function_call_output');
      expect((items[1] as any).call_id).toBe('call_abc123');
      expect((items[1] as any).output).toBe('{"temp":22,"condition":"sunny"}');
    });

    it('converts Astra configuration updates and top-level async results', () => {
      const { input } = converter.convertInput([
        { type: 'configuration_update', reasoning: { effort: 'high' } },
        { type: 'function_call_output', call_id: 'call_fn', output: '{"ok":true}' },
        { type: 'custom_tool_call_output', call_id: 'call_custom', output: 'done' },
        { type: 'compaction_trigger' },
      ]);

      expect(input).toEqual([
        { type: 'configuration_update', reasoning: { effort: 'high' } },
        { type: 'function_call_output', call_id: 'call_fn', output: '{"ok":true}' },
        { type: 'custom_tool_call_output', call_id: 'call_custom', output: 'done' },
        { type: 'compaction_trigger' },
      ]);
    });

    it('rejects adjacent configuration updates and non-final compaction triggers', () => {
      expect(() => converter.convertInput([
        { type: 'configuration_update', reasoning: { effort: 'low' } },
        { type: 'configuration_update', reasoning: { effort: 'high' } },
      ])).toThrow(InvalidConfigError);
      expect(() => converter.convertInput([
        { type: 'compaction_trigger' },
        { type: 'function_call_output', call_id: 'call_fn', output: 'done' },
      ])).toThrow(InvalidConfigError);
    });

    it('preserves message text around top-level Responses tool items', () => {
      const { input } = converter.convertInput([{
        type: 'message',
        id: 'msg_ordered',
        role: MessageRole.ASSISTANT,
        content: [
          { type: ContentType.OUTPUT_TEXT, text: 'before' },
          { type: ContentType.TOOL_USE, id: 'call_1', name: 'lookup', arguments: '{"q":"x"}' },
          { type: ContentType.OUTPUT_TEXT, text: 'after' },
        ],
      }]);

      expect(input).toEqual([
        expect.objectContaining({
          type: 'message', id: 'msg_ordered', role: 'assistant',
          content: [{ type: 'output_text', text: 'before' }],
        }),
        { type: 'function_call', call_id: 'call_1', name: 'lookup', arguments: '{"q":"x"}' },
        expect.objectContaining({
          type: 'message', role: 'assistant',
          content: [{ type: 'output_text', text: 'after' }],
        }),
      ]);
    });
  });

  describe('convertTools()', () => {
    it('serializes async function and custom tools', () => {
      expect(converter.convertTools([
        {
          type: 'function',
          function: { name: 'lookup', parameters: { type: 'object' } },
          async: true,
        },
        { type: 'custom', name: 'shell', async: true },
      ])).toEqual([
        {
          type: 'function', name: 'lookup', description: '',
          parameters: { type: 'object' }, strict: false, async: true,
        },
        { type: 'custom', name: 'shell', async: true },
      ]);
    });
  });

  describe('Round-trip conversion', () => {
    it('should correctly handle multi-turn conversation with proper message IDs', () => {
      // Simulate a multi-turn conversation where message IDs must be preserved

      // Turn 1: Response from API with message ID
      const turn1Response = converter.convertResponse({
        id: 'resp_turn1',
        object: 'response',
        created_at: 1234567890,
        status: 'completed',
        model: 'gpt-5.2',
        output: [
          {
            type: 'message',
            id: 'msg_assistant_turn1',
            status: 'completed',
            role: 'assistant',
            content: [
              {
                type: 'output_text',
                text: 'I need to check the weather.',
                annotations: [],
              },
            ],
          } as ResponsesAPI.ResponseOutputMessage,
        ],
        usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
      } as any);

      // Verify the response has the correct message ID
      expect(turn1Response.output[0].id).toBe('msg_assistant_turn1');

      // Turn 2: Use the assistant's response as part of the next input
      const turn2Input = converter.convertInput([
        {
          type: 'message',
          role: MessageRole.USER,
          content: [{ type: ContentType.INPUT_TEXT, text: 'What is the weather?' }],
        },
        turn1Response.output[0], // Include the assistant's previous message
      ]);

      const items = turn2Input.input as ResponsesAPI.ResponseInputItem[];

      // Find the assistant message in the converted input
      const assistantMessage = items.find(
        (item) => item.type === 'message' && 'role' in item && item.role === 'assistant'
      ) as ResponsesAPI.ResponseInputItem.Message;

      // This is the critical assertion: the message ID should start with "msg_", not "resp_"
      expect(assistantMessage).toBeDefined();
      expect(assistantMessage.id).toBe('msg_assistant_turn1');
      expect(assistantMessage.id).toMatch(/^msg_/);
      expect(assistantMessage.id).not.toMatch(/^resp_/);
    });
  });
});
