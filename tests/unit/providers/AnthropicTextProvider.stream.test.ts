/**
 * AnthropicTextProvider Stream Abort/Cleanup Tests
 * Tests the finally-block cleanup in streamGenerate() that ensures
 * stream converter is cleared and underlying stream is aborted on early break.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StreamEventType } from '@/domain/entities/StreamEvent.js';

// Create mock functions with vi.hoisted for proper hoisting
const { mockCreate, mockAnthropic } = vi.hoisted(() => {
  const mockCreate = vi.fn();
  const mockAnthropic = vi.fn(() => ({
    messages: {
      create: mockCreate,
    },
  }));
  return { mockCreate, mockAnthropic };
});

// Mock Anthropic SDK
vi.mock('@anthropic-ai/sdk', () => ({
  default: mockAnthropic,
}));

// Import after mocking
import { AnthropicTextProvider } from '@/infrastructure/providers/anthropic/AnthropicTextProvider.js';

/**
 * Helper: creates a mock Anthropic stream response that yields standard events.
 * Returns the stream object so tests can attach spies to controller.abort / abort.
 */
function createMockStreamResponse(opts?: {
  abortFn?: (() => void) | null;
  controllerAbortFn?: (() => void) | null;
  yieldCount?: number;
  throwOnIteration?: Error;
}) {
  const {
    abortFn,
    controllerAbortFn,
    yieldCount = 1,
    throwOnIteration,
  } = opts ?? {};

  const stream: any = {
    [Symbol.asyncIterator]: async function* () {
      // message_start
      yield {
        type: 'message_start',
        message: {
          id: 'msg_stream',
          type: 'message',
          role: 'assistant',
          content: [],
          model: 'claude-3-5-sonnet-20241022',
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 5, output_tokens: 0 },
        },
      };
      yield {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' },
      };

      for (let i = 0; i < yieldCount; i++) {
        if (throwOnIteration) {
          throw throwOnIteration;
        }
        yield {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: `chunk${i}` },
        };
      }

      yield { type: 'content_block_stop', index: 0 };
      yield {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn', stop_sequence: null },
        usage: { output_tokens: yieldCount },
      };
      yield { type: 'message_stop' };
    },
  };

  // Attach abort methods based on options
  if (controllerAbortFn !== undefined) {
    stream.controller = controllerAbortFn !== null ? { abort: controllerAbortFn } : {};
  }
  if (abortFn !== undefined) {
    if (abortFn !== null) {
      stream.abort = abortFn;
    }
  }

  return stream;
}

describe('AnthropicTextProvider streamGenerate() cleanup', () => {
  let provider: AnthropicTextProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new AnthropicTextProvider({
      apiKey: 'test-key-stream',
    });
  });

  it('should call stream converter clear() on normal completion', async () => {
    const stream = createMockStreamResponse({ yieldCount: 2 });
    mockCreate.mockResolvedValue(stream);

    const events: any[] = [];
    for await (const event of provider.streamGenerate({
      model: 'claude-3-5-sonnet-20241022',
      input: 'Hello',
    })) {
      events.push(event);
    }

    // Stream completed normally — we just verify no errors thrown
    // The finally block runs clear() internally; we verify indirectly by
    // confirming the stream completes without error
    expect(events.length).toBeGreaterThan(0);
    expect(events.some((e) => e.type === StreamEventType.RESPONSE_COMPLETE)).toBe(true);
  });

  it('should call controller.abort() on early break', async () => {
    const controllerAbort = vi.fn();
    const stream = createMockStreamResponse({
      yieldCount: 10,
      controllerAbortFn: controllerAbort,
    });
    mockCreate.mockResolvedValue(stream);

    const events: any[] = [];
    for await (const event of provider.streamGenerate({
      model: 'claude-3-5-sonnet-20241022',
      input: 'Hello',
    })) {
      events.push(event);
      // Break after first text delta to simulate early consumer exit
      if (event.type === StreamEventType.OUTPUT_TEXT_DELTA) {
        break;
      }
    }

    // controller.abort() should have been called in the finally block
    expect(controllerAbort).toHaveBeenCalled();
  });

  it('should fall back to stream.abort() when controller.abort is not available', async () => {
    const streamAbort = vi.fn();
    const stream = createMockStreamResponse({
      abortFn: streamAbort,
      // No controller at all
    });
    mockCreate.mockResolvedValue(stream);

    const events: any[] = [];
    for await (const event of provider.streamGenerate({
      model: 'claude-3-5-sonnet-20241022',
      input: 'Hello',
    })) {
      events.push(event);
      if (event.type === StreamEventType.OUTPUT_TEXT_DELTA) {
        break;
      }
    }

    expect(streamAbort).toHaveBeenCalled();
  });

  it('should prefer controller.abort over stream.abort', async () => {
    const controllerAbort = vi.fn();
    const streamAbort = vi.fn();
    const stream = createMockStreamResponse({
      controllerAbortFn: controllerAbort,
      abortFn: streamAbort,
    });
    mockCreate.mockResolvedValue(stream);

    for await (const event of provider.streamGenerate({
      model: 'claude-3-5-sonnet-20241022',
      input: 'Hello',
    })) {
      if (event.type === StreamEventType.OUTPUT_TEXT_DELTA) {
        break;
      }
    }

    // controller.abort preferred — stream.abort should NOT be called
    expect(controllerAbort).toHaveBeenCalled();
    expect(streamAbort).not.toHaveBeenCalled();
  });

  it('should not error when stream has no abort method at all', async () => {
    // Stream with neither controller nor abort
    const stream = createMockStreamResponse({ yieldCount: 5 });
    // Explicitly ensure no abort methods
    delete stream.controller;
    delete stream.abort;
    mockCreate.mockResolvedValue(stream);

    const events: any[] = [];
    // Should not throw even on early break
    for await (const event of provider.streamGenerate({
      model: 'claude-3-5-sonnet-20241022',
      input: 'Hello',
    })) {
      events.push(event);
      if (event.type === StreamEventType.OUTPUT_TEXT_DELTA) {
        break;
      }
    }

    // No error — cleanup ran gracefully
    expect(events.length).toBeGreaterThan(0);
  });

  it('should suppress errors thrown by controller.abort()', async () => {
    const controllerAbort = vi.fn(() => {
      throw new Error('Abort failed: already closed');
    });
    const stream = createMockStreamResponse({
      controllerAbortFn: controllerAbort,
    });
    mockCreate.mockResolvedValue(stream);

    // Should not throw despite controller.abort() throwing
    const events: any[] = [];
    for await (const event of provider.streamGenerate({
      model: 'claude-3-5-sonnet-20241022',
      input: 'Hello',
    })) {
      events.push(event);
      if (event.type === StreamEventType.OUTPUT_TEXT_DELTA) {
        break;
      }
    }

    expect(controllerAbort).toHaveBeenCalled();
    expect(events.length).toBeGreaterThan(0);
  });

  it('should suppress errors thrown by stream.abort()', async () => {
    const streamAbort = vi.fn(() => {
      throw new Error('Stream abort error');
    });
    const stream = createMockStreamResponse({
      abortFn: streamAbort,
    });
    mockCreate.mockResolvedValue(stream);

    const events: any[] = [];
    for await (const event of provider.streamGenerate({
      model: 'claude-3-5-sonnet-20241022',
      input: 'Hello',
    })) {
      events.push(event);
      if (event.type === StreamEventType.OUTPUT_TEXT_DELTA) {
        break;
      }
    }

    expect(streamAbort).toHaveBeenCalled();
    expect(events.length).toBeGreaterThan(0);
  });

  it('should run cleanup on stream iteration error', async () => {
    const controllerAbort = vi.fn();
    const iterationError = new Error('Network connection lost');

    // Create a stream that throws during iteration
    const stream: any = {
      [Symbol.asyncIterator]: async function* () {
        yield {
          type: 'message_start',
          message: {
            id: 'msg_err',
            type: 'message',
            role: 'assistant',
            content: [],
            model: 'claude-3-5-sonnet-20241022',
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 5, output_tokens: 0 },
          },
        };
        throw iterationError;
      },
      controller: { abort: controllerAbort },
    };
    mockCreate.mockResolvedValue(stream);

    // The error should propagate but cleanup should still run
    await expect(async () => {
      for await (const _event of provider.streamGenerate({
        model: 'claude-3-5-sonnet-20241022',
        input: 'Hello',
      })) {
        // consume
      }
    }).rejects.toThrow();

    // controller.abort should have been called in finally
    expect(controllerAbort).toHaveBeenCalled();
  });

  it('should handle controller without abort function gracefully', async () => {
    const streamAbort = vi.fn();
    const stream = createMockStreamResponse({
      controllerAbortFn: null, // controller exists but has no abort
      abortFn: streamAbort,
    });
    mockCreate.mockResolvedValue(stream);

    for await (const event of provider.streamGenerate({
      model: 'claude-3-5-sonnet-20241022',
      input: 'Hello',
    })) {
      if (event.type === StreamEventType.OUTPUT_TEXT_DELTA) {
        break;
      }
    }

    // controller.abort is not a function, so it should fall through to stream.abort
    expect(streamAbort).toHaveBeenCalled();
  });

  it('should allow subsequent streams after cleanup', async () => {
    const stream1 = createMockStreamResponse({ yieldCount: 1 });
    const stream2 = createMockStreamResponse({ yieldCount: 1 });
    mockCreate.mockResolvedValueOnce(stream1).mockResolvedValueOnce(stream2);

    // First stream — consume fully
    const events1: any[] = [];
    for await (const event of provider.streamGenerate({
      model: 'claude-3-5-sonnet-20241022',
      input: 'First',
    })) {
      events1.push(event);
    }

    // Second stream — should work without issues (converter was cleared)
    const events2: any[] = [];
    for await (const event of provider.streamGenerate({
      model: 'claude-3-5-sonnet-20241022',
      input: 'Second',
    })) {
      events2.push(event);
    }

    expect(events1.some((e) => e.type === StreamEventType.RESPONSE_COMPLETE)).toBe(true);
    expect(events2.some((e) => e.type === StreamEventType.RESPONSE_COMPLETE)).toBe(true);
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });
});
