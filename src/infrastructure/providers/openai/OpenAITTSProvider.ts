/**
 * OpenAI Text-to-Speech provider
 * Supports: tts-1, tts-1-hd, gpt-4o-mini-tts
 */

import OpenAI from 'openai';
import { BaseMediaProvider } from '../base/BaseMediaProvider.js';
import type {
  IStreamingTextToSpeechProvider,
  TTSOptions,
  TTSResponse,
  TTSStreamChunk,
} from '../../../domain/interfaces/IAudioProvider.js';
import type { AudioFormat } from '../../../domain/types/SharedTypes.js';
import type { ProviderCapabilities } from '../../../domain/interfaces/IProvider.js';
import type { OpenAIMediaConfig } from '../../../domain/types/ProviderConfig.js';
import type { IVoiceInfo } from '../../../domain/entities/SharedVoices.js';
import { OPENAI_VOICES } from '../../../domain/entities/SharedVoices.js';
import {
  ProviderAuthError,
  ProviderRateLimitError,
  ProviderError,
} from '../../../domain/errors/AIErrors.js';

export class OpenAITTSProvider extends BaseMediaProvider implements IStreamingTextToSpeechProvider {
  readonly name: string = 'openai-tts';
  readonly vendor = 'openai' as const;
  readonly capabilities: ProviderCapabilities = {
    text: false,
    images: false,
    videos: false,
    audio: true,
    features: {
      textToSpeech: true,
    },
  };

  private client: OpenAI;

  constructor(config: OpenAIMediaConfig) {
    super({ apiKey: config.auth.apiKey, ...config });

    this.client = new OpenAI({
      apiKey: config.auth.apiKey,
      baseURL: config.baseURL,
      organization: config.organization,
      timeout: config.timeout ?? 60000,
      maxRetries: config.maxRetries ?? 2,
    });
  }

  /**
   * Synthesize speech from text
   */
  async synthesize(options: TTSOptions): Promise<TTSResponse> {
    return this.executeWithCircuitBreaker(
      async () => {
        try {
          // Map semantic format to OpenAI format
          const format = this.mapFormat(options.format);

          // Build request parameters
          const requestParams: OpenAI.Audio.SpeechCreateParams = {
            model: options.model,
            input: options.input,
            voice: this.resolveVoice(options.voice),
            response_format: format,
            speed: options.speed,
          };

          // Add instruction steering if available (gpt-4o-mini-tts)
          if (options.vendorOptions?.instructions) {
            (requestParams as any).instructions = options.vendorOptions.instructions;
          }

          this.logOperationStart('tts.synthesize', {
            model: options.model,
            voice: options.voice,
            inputLength: options.input.length,
          });

          const response = await this.client.audio.speech.create(requestParams);

          // Convert response to Buffer
          const arrayBuffer = await response.arrayBuffer();
          const audio = Buffer.from(arrayBuffer);

          this.logOperationComplete('tts.synthesize', {
            model: options.model,
            audioSize: audio.length,
          });

          return {
            audio,
            format: options.format || 'mp3',
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

  /**
   * Check if streaming is supported for the given format
   */
  supportsStreaming(format?: AudioFormat): boolean {
    // OpenAI supports chunked transfer for all formats, but PCM and WAV
    // are best suited (no container framing issues)
    if (!format) return true;
    return ['pcm', 'wav', 'mp3', 'opus', 'aac', 'flac'].includes(format);
  }

  /**
   * Stream TTS audio chunks as they arrive from the API
   */
  async *synthesizeStream(options: TTSOptions): AsyncIterableIterator<TTSStreamChunk> {
    const format = this.mapFormat(options.format);

    const requestParams: OpenAI.Audio.SpeechCreateParams = {
      model: options.model,
      input: options.input,
      voice: this.resolveVoice(options.voice),
      response_format: format,
      speed: options.speed,
    };

    if (options.vendorOptions?.instructions) {
      (requestParams as any).instructions = options.vendorOptions.instructions;
    }

    this.logOperationStart('tts.synthesizeStream', {
      model: options.model,
      voice: options.voice,
      inputLength: options.input.length,
      format,
    });

    try {
      const response = await this.client.audio.speech.create(requestParams);

      // response.body is a ReadableStream (Web) — iterate via async iterator
      const body = response.body as any;
      if (!body) {
        throw new Error('No response body from OpenAI TTS API');
      }

      // Node.js Readable or Web ReadableStream — both support async iteration
      let totalBytes = 0;
      for await (const chunk of body) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        totalBytes += buf.length;
        yield { audio: buf, isFinal: false };
      }

      // Signal final
      yield { audio: Buffer.alloc(0), isFinal: true };

      this.logOperationComplete('tts.synthesizeStream', {
        model: options.model,
        totalBytes,
      });
    } catch (error: any) {
      this.handleError(error);
      throw error;
    }
  }

  /**
   * List available voices (returns static list for OpenAI)
   */
  async listVoices(): Promise<IVoiceInfo[]> {
    return OPENAI_VOICES;
  }

  /**
   * Resolve a voice identifier to OpenAI's voice parameter shape.
   * - Built-in voice names (e.g. 'alloy', 'nova') pass through as strings.
   * - Custom voice IDs (prefix `voice_`, returned by OpenAI when a custom voice
   *   is created in the dashboard) are wrapped as `{ id }` per the SDK contract.
   */
  private resolveVoice(voice: string): OpenAI.Audio.SpeechCreateParams['voice'] {
    if (voice.startsWith('voice_')) {
      return { id: voice };
    }
    return voice as OpenAI.Audio.SpeechCreateParams['voice'];
  }

  /**
   * Map semantic audio format to OpenAI format
   */
  private mapFormat(
    format?: string
  ): OpenAI.Audio.SpeechCreateParams['response_format'] {
    switch (format) {
      case 'mp3':
        return 'mp3';
      case 'opus':
        return 'opus';
      case 'aac':
        return 'aac';
      case 'flac':
        return 'flac';
      case 'wav':
        return 'wav';
      case 'pcm':
        return 'pcm';
      default:
        return 'mp3';
    }
  }

  /**
   * Handle OpenAI API errors
   */
  private handleError(error: any): never {
    if (error instanceof OpenAI.APIError) {
      const status = error.status;
      const message = error.message || 'Unknown OpenAI API error';

      if (status === 401) {
        throw new ProviderAuthError('openai', 'Invalid API key');
      }

      if (status === 429) {
        throw new ProviderRateLimitError('openai');
      }

      if (status === 400) {
        throw new ProviderError('openai', `Bad request: ${message}`);
      }

      throw new ProviderError('openai', message);
    }

    throw error;
  }
}
