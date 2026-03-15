/**
 * Response entity Unit Tests
 * Tests LLMResponse, TokenUsage, and related types
 */

import { describe, it, expect } from 'vitest';
import { MessageRole } from '@/domain/entities/Message.js';
import { ContentType } from '@/domain/entities/Content.js';
import type { LLMResponse, TokenUsage, OutputItem } from '@/domain/entities/Response.js';
import type { Message, ReasoningItem, CompactionItem } from '@/domain/entities/Message.js';
import type { OutputTextContent, ToolUseContent } from '@/domain/entities/Content.js';

describe('Response entity', () => {
  describe('TokenUsage', () => {
    it('should track basic token counts', () => {
      const usage: TokenUsage = {
        input_tokens: 150,
        output_tokens: 50,
        total_tokens: 200,
      };

      expect(usage.input_tokens).toBe(150);
      expect(usage.output_tokens).toBe(50);
      expect(usage.total_tokens).toBe(200);
    });

    it('should include reasoning token details', () => {
      const usage: TokenUsage = {
        input_tokens: 100,
        output_tokens: 300,
        total_tokens: 400,
        output_tokens_details: {
          reasoning_tokens: 250,
        },
      };

      expect(usage.output_tokens_details).toBeDefined();
      expect(usage.output_tokens_details!.reasoning_tokens).toBe(250);
    });

    it('should work without reasoning token details', () => {
      const usage: TokenUsage = {
        input_tokens: 10,
        output_tokens: 5,
        total_tokens: 15,
      };

      expect(usage.output_tokens_details).toBeUndefined();
    });
  });

  describe('LLMResponse construction', () => {
    function makeResponse(overrides: Partial<LLMResponse> = {}): LLMResponse {
      return {
        id: 'resp_001',
        object: 'response',
        created_at: Date.now(),
        status: 'completed',
        model: 'gpt-4',
        output: [],
        usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
        ...overrides,
      };
    }

    it('should construct a minimal completed response', () => {
      const response = makeResponse();

      expect(response.id).toBe('resp_001');
      expect(response.object).toBe('response');
      expect(response.status).toBe('completed');
      expect(response.model).toBe('gpt-4');
      expect(response.output).toEqual([]);
    });

    it('should include output_text for text responses', () => {
      const textContent: OutputTextContent = {
        type: ContentType.OUTPUT_TEXT,
        text: 'Hello! How can I help?',
      };
      const outputMessage: Message = {
        type: 'message',
        role: MessageRole.ASSISTANT,
        content: [textContent],
      };
      const response = makeResponse({
        output: [outputMessage],
        output_text: 'Hello! How can I help?',
      });

      expect(response.output_text).toBe('Hello! How can I help?');
      expect(response.output).toHaveLength(1);
    });

    it('should include thinking text', () => {
      const response = makeResponse({
        thinking: 'Let me reason about this...',
      });

      expect(response.thinking).toBe('Let me reason about this...');
    });
  });

  describe('LLMResponse status variants', () => {
    function makeResponse(status: LLMResponse['status']): LLMResponse {
      return {
        id: 'resp_status',
        object: 'response',
        created_at: Date.now(),
        status,
        model: 'gpt-4',
        output: [],
        usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
      };
    }

    it('should support "completed" status', () => {
      expect(makeResponse('completed').status).toBe('completed');
    });

    it('should support "failed" status with error', () => {
      const response: LLMResponse = {
        ...makeResponse('failed'),
        error: {
          type: 'server_error',
          message: 'Internal server error',
        },
      };

      expect(response.status).toBe('failed');
      expect(response.error?.type).toBe('server_error');
      expect(response.error?.message).toBe('Internal server error');
    });

    it('should support "incomplete" status', () => {
      expect(makeResponse('incomplete').status).toBe('incomplete');
    });

    it('should support "cancelled" status', () => {
      expect(makeResponse('cancelled').status).toBe('cancelled');
    });

    it('should support "in_progress" status', () => {
      expect(makeResponse('in_progress').status).toBe('in_progress');
    });

    it('should support "queued" status', () => {
      expect(makeResponse('queued').status).toBe('queued');
    });
  });

  describe('Tool call extraction from response', () => {
    it('should contain tool_use content in output', () => {
      const toolUse: ToolUseContent = {
        type: ContentType.TOOL_USE,
        id: 'call_weather',
        name: 'get_weather',
        arguments: '{"city":"London"}',
      };
      const outputMessage: Message = {
        type: 'message',
        role: MessageRole.ASSISTANT,
        content: [toolUse],
      };
      const response: LLMResponse = {
        id: 'resp_tool',
        object: 'response',
        created_at: Date.now(),
        status: 'completed',
        model: 'gpt-4',
        output: [outputMessage],
        usage: { input_tokens: 20, output_tokens: 15, total_tokens: 35 },
      };

      const msg = response.output[0] as Message;
      const toolCalls = msg.content.filter((c) => c.type === ContentType.TOOL_USE) as ToolUseContent[];
      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0].name).toBe('get_weather');
      expect(JSON.parse(toolCalls[0].arguments)).toEqual({ city: 'London' });
    });

    it('should support multiple tool calls in one message', () => {
      const tools: ToolUseContent[] = [
        { type: ContentType.TOOL_USE, id: 'call_1', name: 'search', arguments: '{"q":"test"}' },
        { type: ContentType.TOOL_USE, id: 'call_2', name: 'fetch', arguments: '{"url":"https://example.com"}' },
      ];
      const outputMessage: Message = {
        type: 'message',
        role: MessageRole.ASSISTANT,
        content: tools,
      };
      const response: LLMResponse = {
        id: 'resp_multi_tool',
        object: 'response',
        created_at: Date.now(),
        status: 'completed',
        model: 'gpt-4',
        output: [outputMessage],
        usage: { input_tokens: 30, output_tokens: 25, total_tokens: 55 },
      };

      const msg = response.output[0] as Message;
      const toolCalls = msg.content.filter((c) => c.type === ContentType.TOOL_USE);
      expect(toolCalls).toHaveLength(2);
    });

    it('should support mixed text and tool_use content', () => {
      const outputMessage: Message = {
        type: 'message',
        role: MessageRole.ASSISTANT,
        content: [
          { type: ContentType.OUTPUT_TEXT, text: 'Let me check that.' } as OutputTextContent,
          { type: ContentType.TOOL_USE, id: 'call_x', name: 'lookup', arguments: '{}' } as ToolUseContent,
        ],
      };
      const response: LLMResponse = {
        id: 'resp_mixed',
        object: 'response',
        created_at: Date.now(),
        status: 'completed',
        model: 'gpt-4',
        output: [outputMessage],
        output_text: 'Let me check that.',
        usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 },
      };

      const msg = response.output[0] as Message;
      expect(msg.content.some((c) => c.type === ContentType.OUTPUT_TEXT)).toBe(true);
      expect(msg.content.some((c) => c.type === ContentType.TOOL_USE)).toBe(true);
    });
  });

  describe('Response metadata', () => {
    it('should support metadata as string record', () => {
      const response: LLMResponse = {
        id: 'resp_meta',
        object: 'response',
        created_at: Date.now(),
        status: 'completed',
        model: 'gpt-4',
        output: [],
        usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
        metadata: {
          request_id: 'req_abc',
          user_id: 'usr_123',
        },
      };

      expect(response.metadata).toBeDefined();
      expect(response.metadata!.request_id).toBe('req_abc');
      expect(response.metadata!.user_id).toBe('usr_123');
    });

    it('should work without metadata', () => {
      const response: LLMResponse = {
        id: 'resp_no_meta',
        object: 'response',
        created_at: Date.now(),
        status: 'completed',
        model: 'gpt-4',
        output: [],
        usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
      };

      expect(response.metadata).toBeUndefined();
    });
  });

  describe('Empty response handling', () => {
    it('should handle response with empty output array', () => {
      const response: LLMResponse = {
        id: 'resp_empty',
        object: 'response',
        created_at: Date.now(),
        status: 'completed',
        model: 'gpt-4',
        output: [],
        usage: { input_tokens: 5, output_tokens: 0, total_tokens: 5 },
      };

      expect(response.output).toEqual([]);
      expect(response.output_text).toBeUndefined();
      expect(response.usage.output_tokens).toBe(0);
    });

    it('should handle response with zero tokens', () => {
      const response: LLMResponse = {
        id: 'resp_zero',
        object: 'response',
        created_at: Date.now(),
        status: 'completed',
        model: 'gpt-4',
        output: [],
        usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
      };

      expect(response.usage.total_tokens).toBe(0);
    });
  });

  describe('OutputItem union type in response', () => {
    it('should accept Message as OutputItem', () => {
      const msg: Message = {
        type: 'message',
        role: MessageRole.ASSISTANT,
        content: [{ type: ContentType.OUTPUT_TEXT, text: 'ok' } as OutputTextContent],
      };
      const items: OutputItem[] = [msg];
      expect(items[0].type).toBe('message');
    });

    it('should accept ReasoningItem as OutputItem', () => {
      const reasoning: ReasoningItem = {
        type: 'reasoning',
        id: 'r1',
        effort: 'high',
        summary: 'Deep analysis',
      };
      const items: OutputItem[] = [reasoning];
      expect(items[0].type).toBe('reasoning');
    });

    it('should accept CompactionItem as OutputItem', () => {
      const compaction: CompactionItem = {
        type: 'compaction',
        id: 'c1',
        encrypted_content: 'compressed-data',
      };
      const items: OutputItem[] = [compaction];
      expect(items[0].type).toBe('compaction');
    });
  });

  describe('pendingAsyncTools', () => {
    it('should support pending async tools in response', () => {
      const response: LLMResponse = {
        id: 'resp_async',
        object: 'response',
        created_at: Date.now(),
        status: 'completed',
        model: 'gpt-4',
        output: [],
        usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
        pendingAsyncTools: [
          { toolCallId: 'tc_1', toolName: 'long_task', startTime: Date.now(), status: 'running' },
        ],
      };

      expect(response.pendingAsyncTools).toHaveLength(1);
      expect(response.pendingAsyncTools![0].toolName).toBe('long_task');
      expect(response.pendingAsyncTools![0].status).toBe('running');
    });

    it('should work without pendingAsyncTools', () => {
      const response: LLMResponse = {
        id: 'resp_no_async',
        object: 'response',
        created_at: Date.now(),
        status: 'completed',
        model: 'gpt-4',
        output: [],
        usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
      };

      expect(response.pendingAsyncTools).toBeUndefined();
    });
  });
});
