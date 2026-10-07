import { describe, expect, it, vi } from 'vitest';
import { DefaultCompactionStrategy } from '@/core/context-nextgen/strategies/DefaultCompactionStrategy.js';
import type { CompactionContext } from '@/core/context-nextgen/types.js';

describe('DefaultCompactionStrategy', () => {
  it('removes every pair connected through a shared assistant message', async () => {
    const conversation = [
      {
        type: 'message',
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'call-1', name: 'first', arguments: '{}' },
          { type: 'custom_tool_use', id: 'call-2', name: 'second', input: 'run' },
        ],
      },
      {
        type: 'message',
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'call-1', content: 'one' }],
      },
      {
        type: 'message',
        role: 'user',
        content: [{ type: 'custom_tool_result', tool_use_id: 'call-2', content: 'two' }],
      },
    ];
    const removeMessages = vi.fn().mockResolvedValue(30);
    const context = {
      conversation,
      currentInput: [],
      plugins: [],
      compactPlugin: vi.fn(),
      removeMessages,
      estimateTokens: vi.fn().mockReturnValue(10),
    } as unknown as CompactionContext;

    const result = await new DefaultCompactionStrategy().compact(context, 10);

    expect(removeMessages).toHaveBeenCalledOnce();
    expect(removeMessages.mock.calls[0][0].sort((a: number, b: number) => a - b)).toEqual([0, 1, 2]);
    expect(result.messagesRemoved).toBe(3);
    expect(result.tokensFreed).toBe(30);
  });
});
