/**
 * OpenAISTTProvider — byte-fidelity test for the Buffer-source upload path.
 *
 * Why: `prepareAudioFile` was changed from `new File([new Uint8Array(buf)], …)`
 * to `new File([buf as BlobPart], …)` (where `buf` is a 44-byte WAV header
 * followed by the input PCM). We verify the resulting File's size equals
 * 44 + payload length and that the PCM payload bytes survive verbatim.
 *
 * Live coverage of this same path already exists in
 * `tests/integration/audio/SpeechToText.integration.test.ts` ("should
 * transcribe from Buffer"), which round-trips real audio through OpenAI
 * Whisper and checks the transcript content. This unit test is a fast
 * regression guard that runs in CI without an API key.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockTranscriptionsCreate, mockOpenAI } = vi.hoisted(() => {
  const mockTranscriptionsCreate = vi.fn();
  const mockTranslationsCreate = vi.fn();
  const mockOpenAI = vi.fn(() => ({
    audio: {
      transcriptions: { create: mockTranscriptionsCreate },
      translations: { create: mockTranslationsCreate },
    },
  }));
  return { mockTranscriptionsCreate, mockOpenAI };
});

vi.mock('openai', () => ({
  default: mockOpenAI,
}));

import { OpenAISTTProvider } from '@/infrastructure/providers/openai/OpenAISTTProvider.js';

describe('OpenAISTTProvider — Buffer→File byte fidelity', () => {
  let provider: OpenAISTTProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new OpenAISTTProvider({
      auth: { type: 'api_key', apiKey: 'test-key' },
    });
    mockTranscriptionsCreate.mockResolvedValue({
      text: 'fake transcript',
    });
  });

  it('transcribe(Buffer): WAV header + PCM bytes survive verbatim', async () => {
    // Use a tiny PCM-shaped payload so we can byte-compare cheaply.
    const pcm = Buffer.from([0x00, 0x10, 0x20, 0x30, 0x40, 0x50, 0x60, 0x70, 0x80, 0x90]);

    await provider.transcribe({
      model: 'whisper-1',
      audio: pcm,
    });

    const file = mockTranscriptionsCreate.mock.calls[0][0].file as File;
    expect(file).toBeInstanceOf(File);
    expect(file.type).toBe('audio/wav');

    // 44-byte WAV header + PCM payload.
    expect(file.size).toBe(44 + pcm.length);

    const bytes = Buffer.from(await file.arrayBuffer());
    // RIFF/WAVE signature in the header.
    expect(bytes.subarray(0, 4).toString('latin1')).toBe('RIFF');
    expect(bytes.subarray(8, 12).toString('latin1')).toBe('WAVE');
    // PCM payload at offset 44 must equal the input bytes verbatim.
    expect(Buffer.compare(bytes.subarray(44), pcm)).toBe(0);
  });
});
