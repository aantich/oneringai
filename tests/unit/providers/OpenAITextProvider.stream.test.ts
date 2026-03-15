/**
 * OpenAITextProvider Stream Abort Behavior Tests
 *
 * Tests that the streamGenerate() method properly cleans up the underlying
 * OpenAI stream when the consumer breaks iteration, encounters errors, or
 * completes normally. The key behavior under test is the finally block that
 * calls streamRef.abort() and streamConverter.clear().
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Create mock functions with vi.hoisted for proper hoisting
const { mockCreate, mockOpenAI, mockConvertStream, mockConverterClear } = vi.hoisted(() => {
  const mockCreate = vi.fn();
  const mockOpenAI = vi.fn(() => ({
    responses: {
      create: mockCreate,
    },
  }));
  const mockConvertStream = vi.fn();
  const mockConverterClear = vi.fn();
  return { mockCreate, mockOpenAI, mockConvertStream, mockConverterClear };
});

// Mock OpenAI SDK
vi.mock('openai', () => ({
  default: mockOpenAI,
}));

// Mock the stream converter so we control what events are yielded
vi.mock('@/infrastructure/providers/openai/OpenAIResponsesStreamConverter.js', () => ({
  OpenAIResponsesStreamConverter: vi.fn(() => ({
    convertStream: mockConvertStream,
    clear: mockConverterClear,
  })),
}));

// Import after mocking
import { OpenAITextProvider } from '@/infrastructure/providers/openai/OpenAITextProvider.js';
import { StreamEventType } from '@/domain/entities/StreamEvent.js';

/**
 * Helper: create a mock OpenAI stream object (async iterable with abort method)
 */
function createMockStream(events: unknown[], abortFn?: () => void) {
  const stream = {
    abort: abortFn ?? vi.fn(),
    [Symbol.asyncIterator]: async function* () {
      for (const event of events) {
        yield event;
      }
    },
  };
  return stream;
}

/**
 * Helper: create a mock async iterable from StreamEvent-like objects
 */
async function* makeAsyncIterable<T>(items: T[]): AsyncIterable<T> {
  for (const item of items) {
    yield item;
  }
}

/**
 * Helper: create a mock async iterable that throws after N items
 */
async function* makeFailingAsyncIterable<T>(items: T[], errorAfter: number, error: Error): AsyncIterable<T> {
  let i = 0;
  for (const item of items) {
    if (i >= errorAfter) {
      throw error;
    }
    yield item;
    i++;
  }
}

describe('OpenAITextProvider — streamGenerate abort behavior', () => {
  let provider: OpenAITextProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new OpenAITextProvider({
      apiKey: 'test-api-key',
    });
  });

  afterEach(() => {
    provider.destroy();
  });

  const defaultOptions = {
    model: 'gpt-4',
    input: 'Hello',
  };

  const sampleEvents = [
    { type: StreamEventType.ContentDelta, delta: 'Hello' },
    { type: StreamEventType.ContentDelta, delta: ' world' },
    { type: StreamEventType.Done, response: { id: 'r1', output: [], output_text: 'Hello world', usage: { input_tokens: 1, output_tokens: 2 } } },
  ];

  it('should call abort() when consumer breaks iteration early', async () => {
    const abortFn = vi.fn();
    const mockStream = createMockStream([], abortFn);
    mockCreate.mockResolvedValue(mockStream);
    mockConvertStream.mockReturnValue(makeAsyncIterable(sampleEvents));

    const iter = provider.streamGenerate(defaultOptions);
    // Consume one event then break
    await iter.next();
    // Force cleanup by calling return (simulates for-await break)
    await iter.return!(undefined);

    expect(abortFn).toHaveBeenCalled();
  });

  it('should call streamConverter.clear() when consumer breaks early', async () => {
    const mockStream = createMockStream([]);
    mockCreate.mockResolvedValue(mockStream);
    mockConvertStream.mockReturnValue(makeAsyncIterable(sampleEvents));

    const iter = provider.streamGenerate(defaultOptions);
    await iter.next();
    await iter.return!(undefined);

    expect(mockConverterClear).toHaveBeenCalled();
  });

  it('should call abort() on normal stream completion', async () => {
    const abortFn = vi.fn();
    const mockStream = createMockStream([], abortFn);
    mockCreate.mockResolvedValue(mockStream);
    mockConvertStream.mockReturnValue(makeAsyncIterable(sampleEvents));

    // Consume all events
    const collected = [];
    for await (const event of provider.streamGenerate(defaultOptions)) {
      collected.push(event);
    }

    expect(collected).toHaveLength(3);
    // abort() is called in the finally block even on normal completion
    expect(abortFn).toHaveBeenCalled();
  });

  it('should call streamConverter.clear() on normal stream completion', async () => {
    const mockStream = createMockStream([]);
    mockCreate.mockResolvedValue(mockStream);
    mockConvertStream.mockReturnValue(makeAsyncIterable(sampleEvents));

    for await (const _event of provider.streamGenerate(defaultOptions)) {
      // consume all
    }

    expect(mockConverterClear).toHaveBeenCalled();
  });

  it('should call abort() when error is thrown during stream iteration', async () => {
    const abortFn = vi.fn();
    const mockStream = createMockStream([], abortFn);
    mockCreate.mockResolvedValue(mockStream);

    const streamError = new Error('Stream processing error');
    mockConvertStream.mockReturnValue(
      makeFailingAsyncIterable(sampleEvents, 1, streamError)
    );

    const collected = [];
    await expect(async () => {
      for await (const event of provider.streamGenerate(defaultOptions)) {
        collected.push(event);
      }
    }).rejects.toThrow('Stream processing error');

    expect(abortFn).toHaveBeenCalled();
  });

  it('should call streamConverter.clear() even when error occurs during iteration', async () => {
    const mockStream = createMockStream([]);
    mockCreate.mockResolvedValue(mockStream);

    const streamError = new Error('Converter failure');
    mockConvertStream.mockReturnValue(
      makeFailingAsyncIterable(sampleEvents, 0, streamError)
    );

    await expect(async () => {
      for await (const _event of provider.streamGenerate(defaultOptions)) {
        // consume
      }
    }).rejects.toThrow('Converter failure');

    expect(mockConverterClear).toHaveBeenCalled();
  });

  it('should handle stream without abort method gracefully', async () => {
    // Stream object without an abort method (graceful degradation)
    const streamWithoutAbort = {
      [Symbol.asyncIterator]: async function* () {
        // no events
      },
    };
    mockCreate.mockResolvedValue(streamWithoutAbort);
    mockConvertStream.mockReturnValue(makeAsyncIterable(sampleEvents));

    // Should not throw even though stream has no abort()
    const collected = [];
    for await (const event of provider.streamGenerate(defaultOptions)) {
      collected.push(event);
    }

    expect(collected).toHaveLength(3);
    expect(mockConverterClear).toHaveBeenCalled();
  });

  it('should not throw when abort() itself throws', async () => {
    const abortFn = vi.fn(() => {
      throw new Error('abort() internal error');
    });
    const mockStream = createMockStream([], abortFn);
    mockCreate.mockResolvedValue(mockStream);
    mockConvertStream.mockReturnValue(makeAsyncIterable(sampleEvents));

    // Should complete without error despite abort() throwing
    const collected = [];
    for await (const event of provider.streamGenerate(defaultOptions)) {
      collected.push(event);
    }

    expect(collected).toHaveLength(3);
    expect(abortFn).toHaveBeenCalled();
    expect(mockConverterClear).toHaveBeenCalled();
  });

  it('should call clear() before abort() (clear happens in finally, abort follows)', async () => {
    const callOrder: string[] = [];
    const abortFn = vi.fn(() => callOrder.push('abort'));
    mockConverterClear.mockImplementation(() => callOrder.push('clear'));

    const mockStream = createMockStream([], abortFn);
    mockCreate.mockResolvedValue(mockStream);
    mockConvertStream.mockReturnValue(makeAsyncIterable(sampleEvents));

    for await (const _event of provider.streamGenerate(defaultOptions)) {
      // consume all
    }

    expect(callOrder).toEqual(['clear', 'abort']);
  });

  it('should yield all events from the stream converter', async () => {
    const mockStream = createMockStream([]);
    mockCreate.mockResolvedValue(mockStream);

    const events = [
      { type: StreamEventType.ContentDelta, delta: 'A' },
      { type: StreamEventType.ContentDelta, delta: 'B' },
      { type: StreamEventType.ContentDelta, delta: 'C' },
      { type: StreamEventType.Done, response: { id: 'r1', output: [], output_text: 'ABC', usage: { input_tokens: 1, output_tokens: 3 } } },
    ];
    mockConvertStream.mockReturnValue(makeAsyncIterable(events));

    const collected = [];
    for await (const event of provider.streamGenerate(defaultOptions)) {
      collected.push(event);
    }

    expect(collected).toHaveLength(4);
    expect(collected[0]).toEqual({ type: StreamEventType.ContentDelta, delta: 'A' });
    expect(collected[3]).toMatchObject({ type: StreamEventType.Done });
  });
});
