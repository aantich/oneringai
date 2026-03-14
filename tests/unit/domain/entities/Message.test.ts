/**
 * Message entity Unit Tests
 * Tests Message, CompactionItem, ReasoningItem types and related constructs
 */

import { describe, it, expect } from 'vitest';
import { MessageRole } from '@/domain/entities/Message.js';
import type { Message, CompactionItem, ReasoningItem, InputItem, OutputItem } from '@/domain/entities/Message.js';
import { ContentType } from '@/domain/entities/Content.js';
import type {
  InputTextContent,
  InputImageContent,
  OutputTextContent,
  ToolUseContent,
  ToolResultContent,
  ThinkingContent,
  Content,
} from '@/domain/entities/Content.js';

describe('Message entity', () => {
  describe('MessageRole enum', () => {
    it('should have correct role values', () => {
      expect(MessageRole.USER).toBe('user');
      expect(MessageRole.ASSISTANT).toBe('assistant');
      expect(MessageRole.DEVELOPER).toBe('developer');
    });

    it('should use "developer" instead of "system" (Responses API convention)', () => {
      // Responses API uses "developer" for system-level messages
      expect(MessageRole.DEVELOPER).toBe('developer');
      expect(Object.values(MessageRole)).not.toContain('system');
    });
  });

  describe('Message construction with text content', () => {
    it('should construct a user message with input_text content', () => {
      const content: InputTextContent = {
        type: ContentType.INPUT_TEXT,
        text: 'Hello, world!',
      };
      const message: Message = {
        type: 'message',
        role: MessageRole.USER,
        content: [content],
      };

      expect(message.type).toBe('message');
      expect(message.role).toBe('user');
      expect(message.content).toHaveLength(1);
      expect(message.content[0].type).toBe(ContentType.INPUT_TEXT);
      expect((message.content[0] as InputTextContent).text).toBe('Hello, world!');
    });

    it('should construct an assistant message with output_text content', () => {
      const content: OutputTextContent = {
        type: ContentType.OUTPUT_TEXT,
        text: 'I can help with that.',
      };
      const message: Message = {
        type: 'message',
        role: MessageRole.ASSISTANT,
        content: [content],
      };

      expect(message.role).toBe('assistant');
      expect((message.content[0] as OutputTextContent).text).toBe('I can help with that.');
    });

    it('should construct a developer message', () => {
      const content: InputTextContent = {
        type: ContentType.INPUT_TEXT,
        text: 'You are a helpful assistant.',
      };
      const message: Message = {
        type: 'message',
        role: MessageRole.DEVELOPER,
        content: [content],
      };

      expect(message.role).toBe('developer');
    });
  });

  describe('Message with image content', () => {
    it('should construct a message with input_image_url content', () => {
      const imageContent: InputImageContent = {
        type: ContentType.INPUT_IMAGE_URL,
        image_url: {
          url: 'https://example.com/image.png',
          detail: 'high',
        },
      };
      const message: Message = {
        type: 'message',
        role: MessageRole.USER,
        content: [imageContent],
      };

      expect(message.content).toHaveLength(1);
      const img = message.content[0] as InputImageContent;
      expect(img.type).toBe(ContentType.INPUT_IMAGE_URL);
      expect(img.image_url.url).toBe('https://example.com/image.png');
      expect(img.image_url.detail).toBe('high');
    });

    it('should support image content with default detail', () => {
      const imageContent: InputImageContent = {
        type: ContentType.INPUT_IMAGE_URL,
        image_url: {
          url: 'data:image/png;base64,abc123',
        },
      };

      expect(imageContent.image_url.detail).toBeUndefined();
    });
  });

  describe('Message with tool content', () => {
    it('should construct a message with tool_use content', () => {
      const toolUse: ToolUseContent = {
        type: ContentType.TOOL_USE,
        id: 'call_abc123',
        name: 'get_weather',
        arguments: '{"city":"Paris"}',
      };
      const message: Message = {
        type: 'message',
        role: MessageRole.ASSISTANT,
        content: [toolUse],
      };

      expect(message.content).toHaveLength(1);
      const tu = message.content[0] as ToolUseContent;
      expect(tu.type).toBe(ContentType.TOOL_USE);
      expect(tu.id).toBe('call_abc123');
      expect(tu.name).toBe('get_weather');
      expect(JSON.parse(tu.arguments)).toEqual({ city: 'Paris' });
    });

    it('should construct a message with tool_result content', () => {
      const toolResult: ToolResultContent = {
        type: ContentType.TOOL_RESULT,
        tool_use_id: 'call_abc123',
        content: '{"temperature": 22, "unit": "celsius"}',
      };
      const message: Message = {
        type: 'message',
        role: MessageRole.USER,
        content: [toolResult],
      };

      const tr = message.content[0] as ToolResultContent;
      expect(tr.type).toBe(ContentType.TOOL_RESULT);
      expect(tr.tool_use_id).toBe('call_abc123');
      expect(tr.error).toBeUndefined();
    });

    it('should construct tool_result with error', () => {
      const toolResult: ToolResultContent = {
        type: ContentType.TOOL_RESULT,
        tool_use_id: 'call_fail',
        content: '',
        error: 'Connection timeout',
      };

      expect(toolResult.error).toBe('Connection timeout');
    });

    it('should construct tool_result with __images', () => {
      const toolResult: ToolResultContent = {
        type: ContentType.TOOL_RESULT,
        tool_use_id: 'call_screenshot',
        content: 'Screenshot taken',
        __images: [{ base64: 'iVBOR...', mediaType: 'image/png' }],
      };

      expect(toolResult.__images).toHaveLength(1);
      expect(toolResult.__images![0].mediaType).toBe('image/png');
    });
  });

  describe('Message with thinking content', () => {
    it('should construct thinking content with signature', () => {
      const thinking: ThinkingContent = {
        type: ContentType.THINKING,
        thinking: 'Let me analyze this step by step...',
        signature: 'sig_opaque_abc',
        persistInHistory: true,
      };

      expect(thinking.type).toBe(ContentType.THINKING);
      expect(thinking.thinking).toContain('step by step');
      expect(thinking.signature).toBe('sig_opaque_abc');
      expect(thinking.persistInHistory).toBe(true);
    });

    it('should support thinking without signature (non-Anthropic)', () => {
      const thinking: ThinkingContent = {
        type: ContentType.THINKING,
        thinking: 'Processing...',
        persistInHistory: false,
      };

      expect(thinking.signature).toBeUndefined();
      expect(thinking.persistInHistory).toBe(false);
    });
  });

  describe('Message with multiple content items', () => {
    it('should support mixed content in a single message', () => {
      const contents: Content[] = [
        { type: ContentType.INPUT_TEXT, text: 'What is in this image?' } as InputTextContent,
        {
          type: ContentType.INPUT_IMAGE_URL,
          image_url: { url: 'https://example.com/photo.jpg' },
        } as InputImageContent,
      ];
      const message: Message = {
        type: 'message',
        role: MessageRole.USER,
        content: contents,
      };

      expect(message.content).toHaveLength(2);
      expect(message.content[0].type).toBe(ContentType.INPUT_TEXT);
      expect(message.content[1].type).toBe(ContentType.INPUT_IMAGE_URL);
    });
  });

  describe('Message with empty content', () => {
    it('should allow empty content array', () => {
      const message: Message = {
        type: 'message',
        role: MessageRole.ASSISTANT,
        content: [],
      };

      expect(message.content).toHaveLength(0);
    });
  });

  describe('Message with optional id', () => {
    it('should construct message with id', () => {
      const message: Message = {
        type: 'message',
        id: 'msg_12345',
        role: MessageRole.USER,
        content: [{ type: ContentType.INPUT_TEXT, text: 'Hi' } as InputTextContent],
      };

      expect(message.id).toBe('msg_12345');
    });

    it('should construct message without id', () => {
      const message: Message = {
        type: 'message',
        role: MessageRole.USER,
        content: [],
      };

      expect(message.id).toBeUndefined();
    });
  });

  describe('CompactionItem', () => {
    it('should construct a compaction item', () => {
      const compaction: CompactionItem = {
        type: 'compaction',
        id: 'comp_001',
        encrypted_content: 'base64-encrypted-summary',
      };

      expect(compaction.type).toBe('compaction');
      expect(compaction.id).toBe('comp_001');
      expect(compaction.encrypted_content).toBe('base64-encrypted-summary');
    });
  });

  describe('ReasoningItem', () => {
    it('should construct a reasoning item with all fields', () => {
      const reasoning: ReasoningItem = {
        type: 'reasoning',
        id: 'reason_001',
        effort: 'high',
        summary: 'Detailed analysis performed',
        encrypted_content: 'opaque-reasoning-data',
      };

      expect(reasoning.type).toBe('reasoning');
      expect(reasoning.effort).toBe('high');
      expect(reasoning.summary).toBe('Detailed analysis performed');
    });

    it('should construct a minimal reasoning item', () => {
      const reasoning: ReasoningItem = {
        type: 'reasoning',
        id: 'reason_002',
      };

      expect(reasoning.effort).toBeUndefined();
      expect(reasoning.summary).toBeUndefined();
      expect(reasoning.encrypted_content).toBeUndefined();
    });

    it('should support all effort levels', () => {
      const efforts: Array<'low' | 'medium' | 'high'> = ['low', 'medium', 'high'];
      for (const effort of efforts) {
        const item: ReasoningItem = { type: 'reasoning', id: `r_${effort}`, effort };
        expect(item.effort).toBe(effort);
      }
    });
  });

  describe('InputItem and OutputItem union types', () => {
    it('should accept Message as InputItem', () => {
      const item: InputItem = {
        type: 'message',
        role: MessageRole.USER,
        content: [{ type: ContentType.INPUT_TEXT, text: 'test' } as InputTextContent],
      };
      expect(item.type).toBe('message');
    });

    it('should accept CompactionItem as InputItem', () => {
      const item: InputItem = {
        type: 'compaction',
        id: 'c1',
        encrypted_content: 'data',
      };
      expect(item.type).toBe('compaction');
    });

    it('should accept ReasoningItem as OutputItem', () => {
      const item: OutputItem = {
        type: 'reasoning',
        id: 'r1',
        effort: 'medium',
      };
      expect(item.type).toBe('reasoning');
    });
  });
});
