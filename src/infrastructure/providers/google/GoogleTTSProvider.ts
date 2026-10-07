/**
 * Google Gemini Text-to-Speech provider
 * Supports: gemini-2.5-flash-preview-tts, gemini-2.5-pro-preview-tts
 */

import { GoogleGenAI } from '@google/genai';
import { BaseMediaProvider } from '../base/BaseMediaProvider.js';
import type { ITextToSpeechProvider, TTSOptions, TTSResponse } from '../../../domain/interfaces/IAudioProvider.js';
import type { ProviderCapabilities } from '../../../domain/interfaces/IProvider.js';
import type { GoogleConfig } from '../../../domain/types/ProviderConfig.js';
import type { IVoiceInfo } from '../../../domain/entities/SharedVoices.js';
import { GEMINI_VOICES } from '../../../domain/entities/SharedVoices.js';
import {
  ProviderAuthError,
  ProviderRateLimitError,
  ProviderError,
} from '../../../domain/errors/AIErrors.js';

export class GoogleTTSProvider extends BaseMediaProvider implements ITextToSpeechProvider {
  readonly name: string = 'google-tts';
  readonly vendor = 'google' as const;
  readonly capabilities: ProviderCapabilities = {
    text: false,
    images: false,
    videos: false,
    audio: true,
    features: {
      textToSpeech: true,
    },
  };

  private client: GoogleGenAI;

  constructor(config: GoogleConfig) {
    super(config);

    this.client = new GoogleGenAI({
      apiKey: config.apiKey,
      ...(config.baseURL ? { httpOptions: { baseUrl: config.baseURL } } : {}),
    });
  }

  /**
   * Synthesize speech from text using Gemini TTS
   */
  async synthesize(options: TTSOptions): Promise<TTSResponse> {
    return this.executeWithCircuitBreaker(
      async () => {
        try {
          this.logOperationStart('tts.synthesize', {
            model: options.model,
            voice: options.voice,
            inputLength: options.input.length,
          });

          // Build the request with speech config
          const stylePrompt = options.vendorOptions?.stylePrompt;
          const input = typeof stylePrompt === 'string'
            ? `${stylePrompt}\n\n${options.input}`
            : options.input;
          const result = await this.client.models.generateContent({
            model: options.model,
            contents: [
              {
                parts: [{ text: input }],
              },
            ],
            config: {
              responseModalities: ['AUDIO'],
              speechConfig: {
                voiceConfig: this.toVoiceConfig(options.voice),
              },
            },
          });

          // Extract audio data from response
          const audioData = this.extractAudioData(result);

          if (!audioData) {
            throw new ProviderError('google', 'No audio data in response');
          }

          this.logOperationComplete('tts.synthesize', {
            model: options.model,
            audioSize: audioData.length,
          });

          return {
            audio: audioData,
            format: 'wav', // Gemini outputs PCM 24kHz 16-bit, we convert to WAV
            charactersUsed: options.input.length,
          };
        } catch (error: any) {
          this.handleError(error);
          throw error; // TypeScript needs this
        }
      },
      'tts.synthesize',
      { model: options.model, voice: options.voice }
    );
  }

  /** List the built-in synthesis voices. Use GoogleVoices for the remote custom-voice catalog. */
  async listVoices(): Promise<IVoiceInfo[]> {
    return GEMINI_VOICES;
  }

  private toVoiceConfig(voice: string): Record<string, unknown> {
    const normalized = voice.startsWith('voices/') ? voice.slice('voices/'.length) : voice;
    if (normalized.startsWith('voice_') || normalized.startsWith('voicekey_')) {
      return { voice: normalized };
    }
    return { prebuiltVoiceConfig: { voiceName: normalized || 'Kore' } };
  }

  /**
   * Extract audio data from Gemini response
   * Gemini returns raw PCM data (24kHz, 16-bit, mono), we wrap it in WAV format
   */
  private extractAudioData(result: any): Buffer | null {
    const candidates = result.candidates;
    if (!candidates || candidates.length === 0) {
      return null;
    }

    const content = candidates[0]?.content;
    if (!content?.parts || content.parts.length === 0) {
      return null;
    }

    // Find the audio part
    for (const part of content.parts) {
      if (part.inlineData?.data) {
        // Decode base64 audio data
        const audio = Buffer.from(part.inlineData.data, 'base64');

        if (part.inlineData.mimeType === 'audio/wav' || audio.subarray(0, 4).toString() === 'RIFF') {
          return audio;
        }

        // Wrap PCM in WAV format
        return this.pcmToWav(audio, 24000, 1, 16);
      }
    }

    return null;
  }

  /**
   * Convert raw PCM data to WAV format
   * @param pcmData - Raw PCM data buffer
   * @param sampleRate - Sample rate in Hz (default 24000 for Gemini)
   * @param channels - Number of channels (default 1 for mono)
   * @param bitsPerSample - Bits per sample (default 16)
   */
  private pcmToWav(
    pcmData: Buffer,
    sampleRate: number = 24000,
    channels: number = 1,
    bitsPerSample: number = 16
  ): Buffer {
    const byteRate = (sampleRate * channels * bitsPerSample) / 8;
    const blockAlign = (channels * bitsPerSample) / 8;
    const dataSize = pcmData.length;
    const headerSize = 44;
    const fileSize = headerSize + dataSize;

    const header = Buffer.alloc(headerSize);

    // RIFF header
    header.write('RIFF', 0);
    header.writeUInt32LE(fileSize - 8, 4); // File size - 8
    header.write('WAVE', 8);

    // fmt sub-chunk
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16); // Sub-chunk size (16 for PCM)
    header.writeUInt16LE(1, 20); // Audio format (1 = PCM)
    header.writeUInt16LE(channels, 22); // Number of channels
    header.writeUInt32LE(sampleRate, 24); // Sample rate
    header.writeUInt32LE(byteRate, 28); // Byte rate
    header.writeUInt16LE(blockAlign, 32); // Block align
    header.writeUInt16LE(bitsPerSample, 34); // Bits per sample

    // data sub-chunk
    header.write('data', 36);
    header.writeUInt32LE(dataSize, 40); // Data size

    return Buffer.concat([header, pcmData]);
  }

  /**
   * Handle Google API errors
   */
  private handleError(error: any): never {
    const message = error.message || 'Unknown Google API error';
    const status = error.status || error.code;

    if (status === 401 || message.includes('API key not valid')) {
      throw new ProviderAuthError('google', 'Invalid API key');
    }

    if (status === 429 || message.includes('Resource exhausted')) {
      throw new ProviderRateLimitError('google', message);
    }

    if (status === 400) {
      throw new ProviderError('google', `Bad request: ${message}`);
    }

    throw new ProviderError('google', message);
  }
}
