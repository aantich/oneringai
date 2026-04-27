/**
 * Audio provider interfaces for Text-to-Speech and Speech-to-Text
 */

import type { IProvider } from './IProvider.js';
import type { AudioFormat } from '../types/SharedTypes.js';
import type { IVoiceInfo } from '../entities/SharedVoices.js';

// =============================================================================
// Text-to-Speech (TTS)
// =============================================================================

/**
 * Options for text-to-speech synthesis
 */
export interface TTSOptions {
  /** Model to use (e.g., 'tts-1', 'gpt-4o-mini-tts') */
  model: string;

  /** Text to synthesize */
  input: string;

  /**
   * Voice ID to use.
   * For OpenAI: a built-in name (`alloy`, `ash`, `ballad`, `coral`, `echo`,
   * `fable`, `onyx`, `nova`, `sage`, `shimmer`, `verse`, `marin`, `cedar`) or
   * a custom-voice ID with the `voice_` prefix (e.g. `voice_1234`). Custom IDs
   * are forwarded to the SDK as `{ id }` automatically.
   */
  voice: string;

  /** Audio output format */
  format?: AudioFormat;

  /** Speech speed (0.25 to 4.0, vendor-dependent) */
  speed?: number;

  /** Vendor-specific options passthrough */
  vendorOptions?: Record<string, unknown>;
}

/**
 * Response from text-to-speech synthesis
 */
export interface TTSResponse {
  /** Audio data as Buffer */
  audio: Buffer;

  /** Format of the audio */
  format: AudioFormat;

  /** Duration in seconds (if available) */
  durationSeconds?: number;

  /** Number of characters used (for billing) */
  charactersUsed?: number;
}

/**
 * Text-to-Speech provider interface
 */
export interface ITextToSpeechProvider extends IProvider {
  /**
   * Synthesize speech from text
   */
  synthesize(options: TTSOptions): Promise<TTSResponse>;

  /**
   * List available voices (optional - some providers return static list)
   */
  listVoices?(): Promise<IVoiceInfo[]>;
}

/**
 * A single chunk of streamed TTS audio
 */
export interface TTSStreamChunk {
  /** Audio data for this chunk */
  audio: Buffer;
  /** True when this is the last chunk */
  isFinal: boolean;
}

/**
 * Streaming Text-to-Speech provider interface (opt-in extension)
 * Providers that support chunked transfer implement this alongside ITextToSpeechProvider.
 */
export interface IStreamingTextToSpeechProvider extends ITextToSpeechProvider {
  /**
   * Check if streaming is supported for the given format
   */
  supportsStreaming(format?: AudioFormat): boolean;

  /**
   * Stream TTS audio chunks as they arrive from the API
   */
  synthesizeStream(options: TTSOptions): AsyncIterableIterator<TTSStreamChunk>;
}

// =============================================================================
// Speech-to-Text (STT)
// =============================================================================

/**
 * STT output format types
 */
export type STTOutputFormat = 'json' | 'text' | 'srt' | 'vtt' | 'verbose_json';

/**
 * Options for speech-to-text transcription
 */
export interface STTOptions {
  /** Model to use (e.g., 'whisper-1', 'gpt-4o-transcribe') */
  model: string;

  /** Audio data as Buffer or file path */
  audio: Buffer | string;

  /** Language code (ISO-639-1), optional for auto-detection */
  language?: string;

  /** Output format */
  outputFormat?: STTOutputFormat;

  /** Include word/segment timestamps */
  includeTimestamps?: boolean;

  /** Timestamp granularity if timestamps enabled */
  timestampGranularity?: 'word' | 'segment';

  /** Optional prompt to guide the model */
  prompt?: string;

  /** Temperature for sampling (0-1) */
  temperature?: number;

  /** Vendor-specific options passthrough */
  vendorOptions?: Record<string, unknown>;
}

/**
 * Word-level timestamp
 */
export interface WordTimestamp {
  word: string;
  start: number;
  end: number;
}

/**
 * Segment-level timestamp
 */
export interface SegmentTimestamp {
  id: number;
  text: string;
  start: number;
  end: number;
  tokens?: number[];
}

/**
 * Response from speech-to-text transcription
 */
export interface STTResponse {
  /** Transcribed text */
  text: string;

  /** Detected or specified language */
  language?: string;

  /** Audio duration in seconds */
  durationSeconds?: number;

  /** Word-level timestamps (if requested) */
  words?: WordTimestamp[];

  /** Segment-level timestamps (if requested) */
  segments?: SegmentTimestamp[];
}

/**
 * Speech-to-Text provider interface
 */
export interface ISpeechToTextProvider extends IProvider {
  /**
   * Transcribe audio to text
   */
  transcribe(options: STTOptions): Promise<STTResponse>;

  /**
   * Translate audio to English text (optional, Whisper-specific)
   */
  translate?(options: STTOptions): Promise<STTResponse>;
}
