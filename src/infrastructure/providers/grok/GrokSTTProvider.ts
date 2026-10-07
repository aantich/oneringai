import * as fs from 'fs';
import * as path from 'path';
import { BaseMediaProvider } from '../base/BaseMediaProvider.js';
import type {
  IStreamingSpeechToTextProvider,
  STTOptions,
  STTResponse,
  STTStreamEvent,
  STTStreamOptions,
} from '../../../domain/interfaces/IAudioProvider.js';
import type { ProviderCapabilities } from '../../../domain/interfaces/IProvider.js';
import type { GrokMediaConfig } from '../../../domain/types/ProviderConfig.js';
import {
  ProviderAuthError,
  ProviderRateLimitError,
  ProviderError,
} from '../../../domain/errors/AIErrors.js';
import { detectAudioContainer } from '../../../utils/audioUtils.js';
import { loadWebSocketModule } from '../../websocket/loadWebSocket.js';

export class GrokSTTProvider extends BaseMediaProvider implements IStreamingSpeechToTextProvider {
  readonly name = 'grok-stt';
  readonly vendor = 'grok' as const;
  readonly capabilities: ProviderCapabilities = {
    text: false,
    images: false,
    videos: false,
    audio: true,
    features: { speechToText: true },
  };

  private readonly apiKey: string;
  private readonly baseURL: string;

  constructor(config: GrokMediaConfig) {
    super({ apiKey: config.auth.apiKey, ...config });
    this.apiKey = config.auth.apiKey;
    this.baseURL = (config.baseURL || 'https://api.x.ai/v1').replace(/\/$/, '');
  }

  async transcribe(options: STTOptions): Promise<STTResponse> {
    return this.executeWithCircuitBreaker(async () => {
      const form = new FormData();
      const vendorOptions = options.vendorOptions ?? {};
      form.append('model', this.resolveModel(options.model));
      this.appendOptions(form, { ...vendorOptions, language: options.language });
      const { bytes, filename, mimeType, isRaw } = await this.readAudio(options.audio, options.encoding);
      if (isRaw) {
        if (!vendorOptions.audio_format) form.append('audio_format', options.encoding ?? 'pcm');
        if (!vendorOptions.sample_rate) form.append('sample_rate', String(options.sampleRate ?? 16000));
      }
      // xAI requires the file field to be last.
      form.append('file', new Blob([bytes as BlobPart], { type: mimeType }), filename);

      const response = await fetch(`${this.baseURL}/stt`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}` },
        body: form,
      });
      if (!response.ok) await this.throwResponseError(response);
      const payload = await response.json() as any;
      return {
        text: payload.text ?? '',
        language: payload.language,
        durationSeconds: payload.duration,
        words: payload.words?.map((word: any) => ({
          word: word.text ?? word.word,
          start: word.start,
          end: word.end,
          speaker: word.speaker,
          channel: word.channel_index,
        })),
      };
    }, 'stt.transcribe', { model: options.model });
  }

  supportsStreaming(): boolean {
    return true;
  }

  async *transcribeStream(options: STTStreamOptions): AsyncIterableIterator<STTStreamEvent> {
    const vendorOptions = options.vendorOptions ?? {};
    const multichannelValue = vendorOptions.multichannel;
    const multichannel = multichannelValue === true
      || multichannelValue === 'true'
      || multichannelValue === 1
      || multichannelValue === '1';
    const requestedChannels = Number(vendorOptions.channels ?? 2);
    const expectedDoneEvents = multichannel
      ? Math.min(8, Math.max(2, Number.isFinite(requestedChannels) ? Math.trunc(requestedChannels) : 2))
      : 1;
    const url = new URL(`${this.baseURL}/stt`);
    url.protocol = url.protocol === 'http:' ? 'ws:' : 'wss:';
    url.searchParams.set('sample_rate', String(options.sampleRate ?? 16000));
    url.searchParams.set('model', this.resolveModel(options.model));
    url.searchParams.set('encoding', options.encoding ?? 'pcm');
    url.searchParams.set('interim_results', String(options.interimResults ?? false));
    if (options.language) url.searchParams.set('language', options.language);
    const queryKeys = [
      'endpointing', 'multichannel', 'channels', 'diarize', 'filler_words',
      'smart_turn', 'smart_turn_timeout', 'vad_threshold',
    ];
    for (const key of queryKeys) {
      if (vendorOptions[key] !== undefined) url.searchParams.set(key, String(vendorOptions[key]));
    }
    const keyterms = vendorOptions.keyterm ?? vendorOptions.keyterms;
    if (Array.isArray(keyterms)) {
      for (const keyterm of keyterms) url.searchParams.append('keyterm', String(keyterm));
    } else if (keyterms !== undefined) {
      url.searchParams.append('keyterm', String(keyterms));
    }

    type Socket = {
      readyState: number;
      on(event: string, listener: (...args: any[]) => void): void;
      send(data: string | Buffer): void;
      close(): void;
    };
    const factory = vendorOptions.webSocketFactory as
      | ((url: string, options: { headers: Record<string, string> }) => Socket | Promise<Socket>)
      | undefined;
    const socket = factory
      ? await factory(url.toString(), { headers: { Authorization: `Bearer ${this.apiKey}` } })
      : await this.createSocket(url.toString());
    const queued: Array<Record<string, any>> = [];
    const waiters: Array<(event: Record<string, any>) => void> = [];
    let finished = false;
    let completedChannels = 0;
    const push = (event: Record<string, any>): void => {
      const waiter = waiters.shift();
      if (waiter) waiter(event);
      else queued.push(event);
    };
    socket.on('message', (data: Buffer | string) => {
      try {
        push(JSON.parse(typeof data === 'string' ? data : data.toString()) as Record<string, any>);
      } catch (error) {
        push({ type: '__client_error', message: error instanceof Error ? error.message : String(error) });
      }
    });
    socket.on('error', (error: Error) => push({ type: '__client_error', message: error.message }));
    socket.on('close', () => {
      if (!finished) push({ type: '__closed' });
    });
    if (socket.readyState !== 1) {
      await new Promise<void>((resolve, reject) => {
        socket.on('open', resolve);
        socket.on('error', reject);
      });
    }

    let producer: Promise<void> | undefined;
    try {
      while (!finished) {
        const raw = queued.shift() ?? await new Promise<Record<string, any>>((resolve) => waiters.push(resolve));
        if (raw.type === 'transcript.created') {
          producer = (async () => {
            try {
              for await (const chunk of options.audio) {
                socket.send(Buffer.isBuffer(chunk)
                  ? chunk
                  : JSON.stringify({ type: 'Finalize', ...(chunk.channel === undefined ? {} : { channel: chunk.channel }) }));
              }
              socket.send(JSON.stringify({ type: 'audio.done' }));
            } catch (error) {
              push({ type: '__client_error', message: error instanceof Error ? error.message : String(error) });
            }
          })();
          yield { type: 'created', raw };
        } else if (raw.type === 'transcript.partial') {
          yield this.toStreamEvent('transcript', raw);
        } else if (raw.type === 'transcript.done') {
          completedChannels += 1;
          finished = completedChannels >= expectedDoneEvents;
          yield this.toStreamEvent('done', raw);
        } else if (raw.type === 'error' || raw.type === '__client_error') {
          throw new ProviderError('grok', raw.error?.message ?? raw.message ?? 'xAI streaming STT failed');
        } else if (raw.type === '__closed') {
          throw new ProviderError('grok', 'xAI streaming STT connection closed before transcript.done');
        }
      }
      await producer;
    } finally {
      socket.close();
    }
  }

  private appendOptions(form: FormData, options: Record<string, unknown>): void {
    for (const [key, value] of Object.entries(options)) {
      if (value === undefined || value === null) continue;
      if (Array.isArray(value)) {
        for (const item of value) form.append(key, String(item));
      } else if (typeof value !== 'object') {
        form.append(key, String(value));
      }
    }
  }

  private resolveModel(model: string): string {
    return model === 'xai-stt' ? 'grok-voice-transcribe-2.0' : model;
  }

  private toStreamEvent(type: 'transcript' | 'done', raw: Record<string, any>): STTStreamEvent {
    return {
      type,
      text: raw.text ?? raw.transcript,
      isFinal: raw.is_final ?? type === 'done',
      speechFinal: raw.speech_final ?? type === 'done',
      channel: raw.channel ?? raw.channel_index,
      durationSeconds: raw.duration,
      endOfTurnConfidence: raw.end_of_turn_confidence,
      words: raw.words?.map((word: any) => ({
        word: word.text ?? word.word,
        start: word.start,
        end: word.end,
        speaker: word.speaker,
        channel: word.channel_index,
      })),
      raw,
    };
  }

  private async createSocket(url: string): Promise<{
    readyState: number;
    on(event: string, listener: (...args: any[]) => void): void;
    send(data: string | Buffer): void;
    close(): void;
  }> {
    const { default: WebSocket } = await loadWebSocketModule();
    return new WebSocket(url, { headers: { Authorization: `Bearer ${this.apiKey}` } });
  }

  private async readAudio(audio: Buffer | string, rawEncoding?: STTOptions['encoding']): Promise<{
    bytes: Buffer;
    filename: string;
    mimeType: string;
    isRaw: boolean;
  }> {
    if (Buffer.isBuffer(audio)) {
      const detected = rawEncoding ? undefined : detectAudioContainer(audio);
      if (detected) {
        return {
          bytes: audio,
          filename: `audio.${detected.extension}`,
          mimeType: detected.mimeType,
          isRaw: false,
        };
      }
      return { bytes: audio, filename: 'audio.pcm', mimeType: 'audio/pcm', isRaw: true };
    }
    const extension = path.extname(audio).toLowerCase();
    const mimeType = extension === '.mp3' ? 'audio/mpeg'
      : extension === '.wav' ? 'audio/wav'
        : extension === '.webm' ? 'audio/webm'
          : extension === '.ogg' ? 'audio/ogg'
            : extension === '.flac' ? 'audio/flac'
              : extension === '.m4a' || extension === '.mp4' ? 'audio/mp4'
                : extension === '.aac' ? 'audio/aac'
                  : 'application/octet-stream';
    return {
      bytes: await fs.promises.readFile(audio),
      filename: path.basename(audio),
      mimeType,
      isRaw: false,
    };
  }

  private async throwResponseError(response: Response): Promise<never> {
    const message = await response.text();
    if (response.status === 401) throw new ProviderAuthError('grok', 'Invalid API key');
    if (response.status === 429) throw new ProviderRateLimitError('grok');
    throw new ProviderError('grok', `xAI STT error ${response.status}: ${message}`);
  }
}
