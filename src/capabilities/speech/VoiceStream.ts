/**
 * VoiceStream - Voice pseudo-streaming capability
 *
 * Wraps an agent's text stream and interleaves audio events by chunking text
 * into sentences and synthesizing them via TTS in parallel. Produces the
 * illusion of real-time speech streaming.
 *
 * @example
 * ```typescript
 * const voice = VoiceStream.create({
 *   ttsConnector: 'openai',
 *   ttsModel: 'tts-1-hd',
 *   voice: 'nova',
 * });
 *
 * for await (const event of voice.wrap(agent.stream('Tell me a story'))) {
 *   if (event.type === StreamEventType.OUTPUT_TEXT_DELTA) {
 *     process.stdout.write(event.delta);
 *   } else if (event.type === StreamEventType.AUDIO_CHUNK_READY) {
 *     playbackQueue.enqueue(event);
 *   }
 * }
 * ```
 */

import { EventEmitter } from 'events';
import { TextToSpeech } from '../../core/TextToSpeech.js';
import { StreamEventType } from '../../domain/entities/StreamEvent.js';
import type {
  StreamEvent,
  AudioChunkReadyEvent,
  AudioChunkErrorEvent,
  AudioStreamCompleteEvent,
} from '../../domain/entities/StreamEvent.js';
import type { IDisposable } from '../../domain/interfaces/IDisposable.js';
import type { VoiceStreamConfig } from './types.js';
import { SentenceChunkingStrategy } from './SentenceSplitter.js';
import type { IChunkingStrategy } from './types.js';

// =============================================================================
// Internal Types
// =============================================================================

interface TTSJob {
  index: number;
  text: string;
  promise: Promise<void>;
}

// =============================================================================
// VoiceStream
// =============================================================================

export class VoiceStream extends EventEmitter implements IDisposable {
  private tts: TextToSpeech;
  private chunker: IChunkingStrategy;
  private format: string;
  private speed: number;
  private maxConcurrentTTS: number;
  private maxQueuedChunks: number;
  private vendorOptions?: Record<string, unknown>;

  // Pipeline state
  private chunkIndex = 0;
  private totalCharacters = 0;
  private totalDuration = 0;
  private activeJobs: Map<number, TTSJob> = new Map();
  private activeTTSCount = 0;
  private interrupted = false;
  private lastResponseId = '';
  private _isDestroyed = false;

  // Semaphore for TTS concurrency control
  private slotWaiters: Array<() => void> = [];

  // Audio event buffer for interleaving with text events
  private audioEventBuffer: StreamEvent[] = [];

  // Queue backpressure
  private queueWaiters: Array<() => void> = [];

  /**
   * Create a new VoiceStream instance
   */
  static create(config: VoiceStreamConfig): VoiceStream {
    return new VoiceStream(config);
  }

  private constructor(config: VoiceStreamConfig) {
    super();

    this.tts = TextToSpeech.create({
      connector: config.ttsConnector,
      model: config.ttsModel,
      voice: config.voice,
    });

    this.chunker = config.chunkingStrategy ?? new SentenceChunkingStrategy(config.chunkingOptions);
    this.format = config.format ?? 'mp3';
    this.speed = config.speed ?? 1.0;
    this.maxConcurrentTTS = config.maxConcurrentTTS ?? 2;
    this.maxQueuedChunks = config.maxQueuedChunks ?? 5;
    this.vendorOptions = config.vendorOptions;
  }

  // ======================== Public API ========================

  /**
   * Transform an agent text stream into an augmented stream with audio events.
   * Original text events pass through unchanged; audio events are interleaved.
   *
   * The generator yields events in this order:
   * 1. All original StreamEvents (pass-through)
   * 2. AudioChunkReady/AudioChunkError events as TTS completes
   * 3. AudioStreamComplete as the final audio event
   */
  async *wrap(
    textStream: AsyncIterableIterator<StreamEvent>
  ): AsyncIterableIterator<StreamEvent> {
    this.reset();

    try {
      for await (const event of textStream) {
        // Always yield the original event (pass-through)
        yield event;

        // Track response_id for audio events
        if (event.response_id) {
          this.lastResponseId = event.response_id;
        }

        // Process text deltas for TTS
        if (event.type === StreamEventType.OUTPUT_TEXT_DELTA && !this.interrupted) {
          const completedChunks = this.chunker.feed(event.delta);
          for (const chunk of completedChunks) {
            await this.scheduleTTS(chunk);
          }
        }

        // On text done, flush remaining text from chunker
        if (
          (event.type === StreamEventType.OUTPUT_TEXT_DONE ||
            event.type === StreamEventType.RESPONSE_COMPLETE) &&
          !this.interrupted
        ) {
          const remaining = this.chunker.flush();
          if (remaining) {
            await this.scheduleTTS(remaining);
          }
        }

        // Drain any ready audio events between text events
        yield* this.drainAudioBuffer();
      }

      // Drain audio events as each pending TTS job completes (low latency)
      while (this.activeJobs.size > 0) {
        // Wait for the next job to finish
        await Promise.race(Array.from(this.activeJobs.values()).map((j) => j.promise));
        // Immediately yield any audio events that became ready
        yield* this.drainAudioBuffer();
      }

      // Yield audio stream complete
      if (this.chunkIndex > 0) {
        const completeEvent: AudioStreamCompleteEvent = {
          type: StreamEventType.AUDIO_STREAM_COMPLETE,
          response_id: this.lastResponseId,
          total_chunks: this.chunkIndex,
          total_characters: this.totalCharacters,
          total_duration_seconds: this.totalDuration > 0 ? this.totalDuration : undefined,
        };
        yield completeEvent;

        this.emit('audio:complete', {
          totalChunks: this.chunkIndex,
          totalDurationSeconds: this.totalDuration > 0 ? this.totalDuration : undefined,
        });
      }
    } finally {
      // Cleanup on early exit (break, throw)
      this.cleanup();
    }
  }

  /**
   * Interrupt audio generation. Cancels pending TTS and flushes queue.
   * Call this when the user sends a new message mid-speech.
   * Active HTTP requests cannot be cancelled but their results will be discarded.
   */
  interrupt(): void {
    this.interrupted = true;
    const pendingCount = this.activeJobs.size;

    // Clear all pending jobs
    this.activeJobs.clear();
    this.activeTTSCount = 0;
    this.audioEventBuffer = [];

    // Release all waiters
    this.releaseAllWaiters();

    // Reset chunker
    this.chunker.reset();

    this.emit('audio:interrupted', { pendingChunks: pendingCount });
  }

  /**
   * Reset state for a new stream. Called automatically by wrap().
   */
  reset(): void {
    this.chunkIndex = 0;
    this.totalCharacters = 0;
    this.totalDuration = 0;
    this.activeJobs.clear();
    this.activeTTSCount = 0;
    this.interrupted = false;
    this.lastResponseId = '';
    this.audioEventBuffer = [];
    this.slotWaiters = [];
    this.queueWaiters = [];
    this.chunker.reset();
  }

  destroy(): void {
    this.interrupt();
    this._isDestroyed = true;
    this.removeAllListeners();
  }

  get isDestroyed(): boolean {
    return this._isDestroyed;
  }

  // ======================== Private Methods ========================

  /**
   * Schedule a text chunk for TTS synthesis.
   * Awaits a free queue slot if backpressure is active (lossless).
   */
  private async scheduleTTS(text: string): Promise<void> {
    if (this.interrupted || this._isDestroyed) return;

    const cleanText = text.trim();
    if (cleanText.length === 0) return;

    // Lossless backpressure: wait for a free queue slot
    while (this.activeJobs.size >= this.maxQueuedChunks && !this.interrupted) {
      await this.waitForQueueSlot();
    }

    if (this.interrupted) return;

    const index = this.chunkIndex++;
    this.totalCharacters += cleanText.length;

    const job: TTSJob = {
      index,
      text: cleanText,
      promise: this.executeTTS(index, cleanText),
    };

    this.activeJobs.set(index, job);
    job.promise.finally(() => {
      this.activeJobs.delete(index);
      this.releaseQueueWaiter();
    });
  }

  /**
   * Execute TTS for a single text chunk.
   * Respects concurrency semaphore.
   */
  private async executeTTS(index: number, text: string): Promise<void> {
    // Wait for a TTS concurrency slot
    while (this.activeTTSCount >= this.maxConcurrentTTS && !this.interrupted) {
      await this.waitForTTSSlot();
    }

    if (this.interrupted) return;

    this.activeTTSCount++;

    try {
      const response = await this.tts.synthesize(text, {
        format: this.format as any,
        speed: this.speed,
        vendorOptions: this.vendorOptions,
      });

      if (this.interrupted) return;

      if (response.durationSeconds) {
        this.totalDuration += response.durationSeconds;
      }

      const audioEvent: AudioChunkReadyEvent = {
        type: StreamEventType.AUDIO_CHUNK_READY,
        response_id: this.lastResponseId,
        chunk_index: index,
        text,
        audio_base64: response.audio.toString('base64'),
        format: response.format,
        duration_seconds: response.durationSeconds,
        characters_used: response.charactersUsed,
      };

      this.audioEventBuffer.push(audioEvent);
      this.emit('audio:ready', {
        chunkIndex: index,
        text,
        durationSeconds: response.durationSeconds,
      });
    } catch (error) {
      if (this.interrupted) return;

      const errorEvent: AudioChunkErrorEvent = {
        type: StreamEventType.AUDIO_CHUNK_ERROR,
        response_id: this.lastResponseId,
        chunk_index: index,
        text,
        error: (error as Error).message,
      };

      this.audioEventBuffer.push(errorEvent);
      this.emit('audio:error', {
        chunkIndex: index,
        text,
        error: error as Error,
      });
    } finally {
      this.activeTTSCount--;
      this.releaseTTSSlot();
    }
  }

  /**
   * Drain the audio event buffer, yielding all ready events.
   */
  private *drainAudioBuffer(): Generator<StreamEvent> {
    while (this.audioEventBuffer.length > 0) {
      yield this.audioEventBuffer.shift()!;
    }
  }

  /**
   * Wait for all active TTS jobs to complete.
   */
  private async waitForAllJobs(): Promise<void> {
    while (this.activeJobs.size > 0) {
      const jobs = Array.from(this.activeJobs.values());
      await Promise.allSettled(jobs.map((j) => j.promise));
    }
  }

  // ======================== Semaphore / Backpressure ========================

  private waitForTTSSlot(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.slotWaiters.push(resolve);
    });
  }

  private releaseTTSSlot(): void {
    const waiter = this.slotWaiters.shift();
    if (waiter) waiter();
  }

  private waitForQueueSlot(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.queueWaiters.push(resolve);
    });
  }

  private releaseQueueWaiter(): void {
    const waiter = this.queueWaiters.shift();
    if (waiter) waiter();
  }

  private releaseAllWaiters(): void {
    for (const waiter of this.slotWaiters) waiter();
    this.slotWaiters = [];
    for (const waiter of this.queueWaiters) waiter();
    this.queueWaiters = [];
  }

  private cleanup(): void {
    this.releaseAllWaiters();
  }
}
