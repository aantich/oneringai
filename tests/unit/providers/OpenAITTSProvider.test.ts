/**
 * OpenAITTSProvider Unit Tests
 * Focus: voice-id resolution (built-in vs custom voice_* prefix).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockSpeechCreate, mockOpenAI } = vi.hoisted(() => {
  const mockSpeechCreate = vi.fn();
  const mockOpenAI = vi.fn(() => ({
    audio: {
      speech: { create: mockSpeechCreate },
    },
  }));
  return { mockSpeechCreate, mockOpenAI };
});

vi.mock('openai', () => ({
  default: mockOpenAI,
}));

import { OpenAITTSProvider } from '@/infrastructure/providers/openai/OpenAITTSProvider.js';

function makeFakeArrayBufferResponse(): { arrayBuffer: () => Promise<ArrayBuffer> } {
  return { arrayBuffer: async () => new ArrayBuffer(8) };
}

describe('OpenAITTSProvider', () => {
  let provider: OpenAITTSProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new OpenAITTSProvider({
      auth: { type: 'api_key', apiKey: 'test-key' },
    });
  });

  describe('synthesize() — voice resolution', () => {
    beforeEach(() => {
      mockSpeechCreate.mockResolvedValue(makeFakeArrayBufferResponse());
    });

    it('forwards built-in voice names as bare strings', async () => {
      await provider.synthesize({
        model: 'tts-1-hd',
        input: 'hello',
        voice: 'nova',
      });

      expect(mockSpeechCreate).toHaveBeenCalledTimes(1);
      const params = mockSpeechCreate.mock.calls[0][0];
      expect(params.voice).toBe('nova');
    });

    it.each(['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'onyx', 'sage', 'shimmer', 'verse', 'marin', 'cedar'])(
      'forwards built-in voice "%s" as a bare string',
      async (voice) => {
        await provider.synthesize({ model: 'tts-1', input: 'hi', voice });
        expect(mockSpeechCreate.mock.calls.at(-1)![0].voice).toBe(voice);
      }
    );

    it('wraps custom voice ids (voice_* prefix) as { id }', async () => {
      await provider.synthesize({
        model: 'gpt-4o-mini-tts',
        input: 'hello',
        voice: 'voice_1234abcd',
      });

      expect(mockSpeechCreate).toHaveBeenCalledTimes(1);
      const params = mockSpeechCreate.mock.calls[0][0];
      expect(params.voice).toEqual({ id: 'voice_1234abcd' });
    });

    it('forwards an unknown but non-prefixed voice name as a bare string (lets the API decide)', async () => {
      await provider.synthesize({
        model: 'tts-1',
        input: 'hi',
        voice: 'futuristic-voice',
      });
      expect(mockSpeechCreate.mock.calls.at(-1)![0].voice).toBe('futuristic-voice');
    });
  });

  describe('synthesizeStream() — voice resolution', () => {
    it('wraps custom voice ids on the streaming path too', async () => {
      // Body must support async iteration; an empty async iterator suffices.
      const fakeStreamResponse = {
        body: (async function* () {
          /* no chunks */
        })(),
      };
      mockSpeechCreate.mockResolvedValue(fakeStreamResponse);

      const iter = provider.synthesizeStream({
        model: 'gpt-4o-mini-tts',
        input: 'hi',
        voice: 'voice_xyz',
      });
      // Drive the iterator so the SDK call actually happens.
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _chunk of iter) { /* drain */ }

      const params = mockSpeechCreate.mock.calls[0][0];
      expect(params.voice).toEqual({ id: 'voice_xyz' });
    });
  });
});
