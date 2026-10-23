import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnthropicTextProvider } from '@/infrastructure/providers/anthropic/AnthropicTextProvider.js';
import { ContentType } from '@/domain/entities/Content.js';
import { MessageRole } from '@/domain/entities/Message.js';
import type { InputItem } from '@/domain/entities/Message.js';
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('native source counting uses the actual compaction operation mode', () => {
  it('preserves trailing assistant whitespace and counts source mode without changing ordinary frames', async () => {
    const sent: Record<string, unknown>[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.includes('/models/')) return new Response(JSON.stringify({ id: 'claude-sonnet-4-6', capabilities: { compaction: { supported: true, summarize: { supported: true } } } }), { headers: { 'content-type': 'application/json' } });
      expect(url).toContain('/count_tokens');
      const body = input instanceof Request ? await input.clone().json() : JSON.parse(String(init?.body)); sent.push(body);
      return new Response(JSON.stringify({ input_tokens: 100 }), { headers: { 'content-type': 'application/json' } });
    }));
    const provider = new AnthropicTextProvider({ apiKey: 'synthetic-offline', maxRetries: 0 });
    const history: InputItem[] = [
      { type: 'message', role: MessageRole.USER, content: [{ type: ContentType.INPUT_TEXT, text: 'Original source' }] },
      { type: 'message', role: MessageRole.ASSISTANT, content: [{ type: ContentType.OUTPUT_TEXT, text: 'Preserve exact whitespace \n' }] },
    ];
    expect(await provider.compaction.countInput({ model: 'claude-sonnet-4-6', input: history, nativeCompactionSource: true })).toBe(100);
    expect(sent[0]?.compaction).toEqual({ type: 'summarize' });
    expect(JSON.stringify(sent[0]?.messages)).toContain('Preserve exact whitespace \\n');
    expect(history[1]).toMatchObject({ content: [{ text: 'Preserve exact whitespace \n' }] });
    await provider.compaction.countInput({ model: 'claude-sonnet-4-6', input: [...history,
      { type: 'message', role: MessageRole.USER, content: [{ type: ContentType.INPUT_TEXT, text: 'Current actual user turn' }] }] });
    expect(sent[1]).not.toHaveProperty('compaction'); expect(JSON.stringify(sent[1])).toContain('Current actual user turn');
  });
});
