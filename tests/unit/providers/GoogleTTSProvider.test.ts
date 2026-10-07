import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGenerateContent, mockGoogleGenAI } = vi.hoisted(() => {
  const mockGenerateContent = vi.fn();
  const mockGoogleGenAI = vi.fn(() => ({
    models: { generateContent: mockGenerateContent },
  }));
  return { mockGenerateContent, mockGoogleGenAI };
});

vi.mock('@google/genai', () => ({ GoogleGenAI: mockGoogleGenAI }));

import { GEMINI_VOICES } from '@/domain/entities/SharedVoices.js';
import { GoogleTTSProvider } from '@/infrastructure/providers/google/GoogleTTSProvider.js';

describe('GoogleTTSProvider', () => {
  let provider: GoogleTTSProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new GoogleTTSProvider({ apiKey: 'test-key' });
    mockGenerateContent.mockResolvedValue({
      candidates: [{
        content: {
          parts: [{
            inlineData: {
              data: Buffer.from('RIFFwave').toString('base64'),
              mimeType: 'audio/wav',
            },
          }],
        },
      }],
    });
  });

  it.each(['voice_custom', 'voicekey_custom', 'voices/voice_custom', 'voices/voicekey_custom'])(
    'passes custom voice id %s through the custom-voice field',
    async (voice) => {
      await provider.synthesize({ model: 'gemini-2.5-flash-preview-tts', input: 'hello', voice });

      expect(mockGenerateContent.mock.calls.at(-1)?.[0].config.speechConfig.voiceConfig).toEqual({
        voice: voice.replace(/^voices\//, ''),
      });
    },
  );

  it('uses prebuiltVoiceConfig for built-in Gemini voices', async () => {
    await provider.synthesize({
      model: 'gemini-2.5-flash-preview-tts',
      input: 'hello',
      voice: 'Kore',
    });

    expect(mockGenerateContent.mock.calls[0][0].config.speechConfig.voiceConfig).toEqual({
      prebuiltVoiceConfig: { voiceName: 'Kore' },
    });
  });

  it('lists only the deterministic built-in synthesis catalog', async () => {
    await expect(provider.listVoices()).resolves.toEqual(GEMINI_VOICES);
    expect(mockGenerateContent).not.toHaveBeenCalled();
  });
});
