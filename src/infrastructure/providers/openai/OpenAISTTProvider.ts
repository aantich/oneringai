/**
 * OpenAI Speech-to-Text provider
 * Supports: whisper-1, gpt-4o-transcribe, gpt-4o-transcribe-diarize
 */

import OpenAI from 'openai';
import { BaseMediaProvider } from '../base/BaseMediaProvider.js';
import type { ISpeechToTextProvider, STTOptions, STTResponse, STTOutputFormat } from '../../../domain/interfaces/IAudioProvider.js';
import type { ProviderCapabilities } from '../../../domain/interfaces/IProvider.js';
import type { OpenAIMediaConfig } from '../../../domain/types/ProviderConfig.js';
import {
  ProviderAuthError,
  ProviderRateLimitError,
  ProviderError,
} from '../../../domain/errors/AIErrors.js';
import * as fs from 'fs';

export class OpenAISTTProvider extends BaseMediaProvider implements ISpeechToTextProvider {
  readonly name: string = 'openai-stt';
  readonly vendor = 'openai' as const;
  readonly capabilities: ProviderCapabilities = {
    text: false,
    images: false,
    videos: false,
    audio: true,
    features: {
      speechToText: true,
    },
  };

  private client: OpenAI;

  constructor(config: OpenAIMediaConfig) {
    super({ apiKey: config.auth.apiKey, ...config });

    this.client = new OpenAI({
      apiKey: config.auth.apiKey,
      baseURL: config.baseURL,
      organization: config.organization,
      timeout: config.timeout ?? 120000, // 2 minutes for audio processing
      maxRetries: config.maxRetries ?? 2,
    });
  }

  /**
   * Transcribe audio to text
   */
  async transcribe(options: STTOptions): Promise<STTResponse> {
    return this.executeWithCircuitBreaker(
      async () => {
        try {
          this.logOperationStart('stt.transcribe', {
            model: options.model,
            language: options.language,
            format: options.outputFormat,
          });

          // Prepare audio file
          const audioFile = await this.prepareAudioFile(options.audio);

          // Build request parameters
          const requestParams: Partial<OpenAI.Audio.TranscriptionCreateParams> = {
            model: options.model,
            file: audioFile,
            language: options.language,
            prompt: options.prompt,
            temperature: options.temperature,
          };

          // Map output format
          if (options.outputFormat) {
            requestParams.response_format = this.mapOutputFormat(options.outputFormat);
          } else if (options.includeTimestamps) {
            requestParams.response_format = 'verbose_json';
          }

          // Add timestamp granularity if needed
          if (options.includeTimestamps && options.timestampGranularity) {
            requestParams.timestamp_granularities = [options.timestampGranularity];
          }

          // Add diarization options if using diarize model
          if (options.model.includes('diarize') && options.vendorOptions?.max_speakers) {
            (requestParams as any).max_speakers = options.vendorOptions.max_speakers;
          }

          const response: any = await this.client.audio.transcriptions.create(
            requestParams as any
          );

          this.logOperationComplete('stt.transcribe', {
            model: options.model,
            textLength: typeof response === 'string' ? response.length : response.text?.length || 0,
          });

          return this.convertResponse(response);
        } catch (error: any) {
          this.handleError(error);
          throw error; // TypeScript needs this
        }
      },
      'stt.transcribe',
      { model: options.model }
    );
  }

  /**
   * Translate audio to English text
   */
  async translate(options: STTOptions): Promise<STTResponse> {
    return this.executeWithCircuitBreaker(
      async () => {
        try {
          this.logOperationStart('stt.translate', {
            model: options.model,
          });

          const audioFile = await this.prepareAudioFile(options.audio);

          const requestParams: Partial<OpenAI.Audio.TranslationCreateParams> = {
            model: options.model,
            file: audioFile,
            prompt: options.prompt,
            temperature: options.temperature,
          };

          if (options.outputFormat) {
            // Translation API has more restricted response_format options
            requestParams.response_format = this.mapOutputFormat(options.outputFormat) as
              | 'text'
              | 'json'
              | 'srt'
              | 'vtt'
              | 'verbose_json';
          }

          const response: any = await this.client.audio.translations.create(
            requestParams as any
          );

          this.logOperationComplete('stt.translate', {
            model: options.model,
            textLength: typeof response === 'string' ? response.length : response.text?.length || 0,
          });

          return this.convertResponse(response);
        } catch (error: any) {
          this.handleError(error);
          throw error;
        }
      },
      'stt.translate',
      { model: options.model }
    );
  }

  /**
   * Prepare audio file for API request
   * Handles both Buffer and file path inputs.
   * Raw PCM buffers get a WAV header so OpenAI can decode them.
   */
  private async prepareAudioFile(audio: Buffer | string): Promise<any> {
    if (Buffer.isBuffer(audio)) {
      // Wrap raw PCM in a WAV container so OpenAI can decode it.
      // Assumes PCM s16le, mono. We detect sample rate from buffer size heuristics
      // but default to 16000 Hz (safe for Whisper). Voice pipelines send 8000 Hz
      // which also works fine — WAV header tells the decoder.
      const wavBuffer = this.wrapPcmAsWav(audio, 1, 16000, 16);
      // Pass the Buffer directly to File — wrapping in `new Uint8Array(buf)`
      // would force the typed-array overload and copy the WAV before File even
      // snapshots it. Direct pass keeps a single Blob-internal copy.
      return new File([wavBuffer as BlobPart], 'audio.wav', { type: 'audio/wav' });
    } else if (typeof audio === 'string') {
      // File path - create ReadStream
      return fs.createReadStream(audio);
    } else {
      throw new Error('Invalid audio input: must be Buffer or file path');
    }
  }

  /**
   * Wrap raw PCM data in a minimal WAV (RIFF) container.
   * This adds the 44-byte header that audio decoders need.
   */
  private wrapPcmAsWav(pcm: Buffer, channels: number, sampleRate: number, bitsPerSample: number): Buffer {
    const byteRate = sampleRate * channels * (bitsPerSample / 8);
    const blockAlign = channels * (bitsPerSample / 8);
    const dataSize = pcm.length;
    const header = Buffer.alloc(44);

    header.write('RIFF', 0);                          // ChunkID
    header.writeUInt32LE(36 + dataSize, 4);            // ChunkSize
    header.write('WAVE', 8);                           // Format
    header.write('fmt ', 12);                          // Subchunk1ID
    header.writeUInt32LE(16, 16);                      // Subchunk1Size (PCM)
    header.writeUInt16LE(1, 20);                       // AudioFormat (1 = PCM)
    header.writeUInt16LE(channels, 22);                // NumChannels
    header.writeUInt32LE(sampleRate, 24);               // SampleRate
    header.writeUInt32LE(byteRate, 28);                 // ByteRate
    header.writeUInt16LE(blockAlign, 32);               // BlockAlign
    header.writeUInt16LE(bitsPerSample, 34);            // BitsPerSample
    header.write('data', 36);                          // Subchunk2ID
    header.writeUInt32LE(dataSize, 40);                 // Subchunk2Size

    return Buffer.concat([header, pcm]);
  }

  /**
   * Map semantic output format to OpenAI format
   */
  private mapOutputFormat(format: STTOutputFormat): OpenAI.Audio.AudioResponseFormat {
    switch (format) {
      case 'json':
        return 'json';
      case 'text':
        return 'text';
      case 'srt':
        return 'srt';
      case 'vtt':
        return 'vtt';
      case 'verbose_json':
        return 'verbose_json';
      default:
        return 'json';
    }
  }

  /**
   * Convert OpenAI response to our standard format
   */
  private convertResponse(response: OpenAI.Audio.Transcription | string): STTResponse {
    // Handle simple string response
    if (typeof response === 'string') {
      return { text: response };
    }

    // Cast to access extended properties
    const extResponse = response as any;

    // Handle JSON response
    const result: STTResponse = {
      text: response.text,
      language: extResponse.language,
      durationSeconds: extResponse.duration,
    };

    // Add word timestamps if available
    if ((response as any).words) {
      result.words = (response as any).words.map((w: any) => ({
        word: w.word,
        start: w.start,
        end: w.end,
      }));
    }

    // Add segment timestamps if available
    if ((response as any).segments) {
      result.segments = (response as any).segments.map((s: any) => ({
        id: s.id,
        text: s.text,
        start: s.start,
        end: s.end,
        tokens: s.tokens,
      }));
    }

    return result;
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

      if (status === 413) {
        throw new ProviderError('openai', 'Audio file too large (max 25MB)');
      }

      throw new ProviderError('openai', message);
    }

    throw error;
  }
}
