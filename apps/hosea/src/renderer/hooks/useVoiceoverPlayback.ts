/**
 * useVoiceoverPlayback - Browser-side ordered audio playback for voice pseudo-streaming
 *
 * Listens for 'hosea:voice-chunk' CustomEvents, buffers out-of-order chunks,
 * and plays them sequentially via HTML5 Audio.
 */

import { useState, useEffect, useRef, useCallback } from 'react';

interface VoiceChunkDetail {
  instanceId: string;
  chunkIndex: number;
  audioBase64: string;
  format: string;
  durationSeconds?: number;
  text: string;
}

interface PlaybackState {
  isPlaying: boolean;
}

export function useVoiceoverPlayback(
  instanceId: string | null,
  enabled: boolean,
): PlaybackState {
  const [isPlaying, setIsPlaying] = useState(false);

  // Refs for mutable state that doesn't need re-renders
  const nextPlayIndex = useRef(0);
  const buffer = useRef<Map<number, VoiceChunkDetail>>(new Map());
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playingRef = useRef(false);
  const enabledRef = useRef(enabled);
  const instanceIdRef = useRef(instanceId);

  // Keep refs in sync
  enabledRef.current = enabled;
  instanceIdRef.current = instanceId;

  // Play the next chunk in sequence
  const playNext = useCallback(() => {
    if (!enabledRef.current) return;

    const chunk = buffer.current.get(nextPlayIndex.current);
    if (!chunk) {
      // No more chunks ready
      playingRef.current = false;
      setIsPlaying(false);
      return;
    }

    // Remove from buffer and advance index
    buffer.current.delete(nextPlayIndex.current);
    nextPlayIndex.current++;

    // Decode base64 → Blob → URL
    const byteChars = atob(chunk.audioBase64);
    const byteArray = new Uint8Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) {
      byteArray[i] = byteChars.charCodeAt(i);
    }
    const mimeType = chunk.format === 'mp3' ? 'audio/mpeg'
      : chunk.format === 'opus' ? 'audio/opus'
      : chunk.format === 'wav' ? 'audio/wav'
      : chunk.format === 'aac' ? 'audio/aac'
      : chunk.format === 'flac' ? 'audio/flac'
      : `audio/${chunk.format}`;

    const blob = new Blob([byteArray], { type: mimeType });
    const url = URL.createObjectURL(blob);

    // Clean up previous audio element
    if (audioRef.current) {
      audioRef.current.pause();
      if (audioRef.current.src) {
        URL.revokeObjectURL(audioRef.current.src);
      }
    }

    const audio = new Audio(url);
    audioRef.current = audio;

    audio.onended = () => {
      URL.revokeObjectURL(url);
      playNext();
    };

    audio.onerror = () => {
      console.error(`Voice playback error for chunk ${chunk.chunkIndex}`);
      URL.revokeObjectURL(url);
      playNext(); // Skip errored chunk, continue with next
    };

    playingRef.current = true;
    setIsPlaying(true);
    audio.play().catch((err) => {
      console.error('Audio play failed:', err);
      URL.revokeObjectURL(url);
      playNext();
    });
  }, []);

  // Handle incoming voice chunks
  useEffect(() => {
    if (!enabled || !instanceId) return;

    const handleChunk = (e: Event) => {
      const detail = (e as CustomEvent<VoiceChunkDetail>).detail;
      if (detail.instanceId !== instanceIdRef.current) return;
      if (!enabledRef.current) return;

      // Buffer the chunk
      buffer.current.set(detail.chunkIndex, detail);

      // If not currently playing, try to start
      if (!playingRef.current) {
        playNext();
      }
    };

    window.addEventListener('hosea:voice-chunk', handleChunk);
    return () => {
      window.removeEventListener('hosea:voice-chunk', handleChunk);
    };
  }, [enabled, instanceId, playNext]);

  // Clean up when disabled or instanceId changes
  useEffect(() => {
    if (!enabled) {
      // Stop playback
      if (audioRef.current) {
        audioRef.current.pause();
        if (audioRef.current.src) {
          URL.revokeObjectURL(audioRef.current.src);
        }
        audioRef.current = null;
      }
      buffer.current.clear();
      nextPlayIndex.current = 0;
      playingRef.current = false;
      setIsPlaying(false);
    }
  }, [enabled]);

  // Reset on instanceId change
  useEffect(() => {
    buffer.current.clear();
    nextPlayIndex.current = 0;
    if (audioRef.current) {
      audioRef.current.pause();
      if (audioRef.current.src) {
        URL.revokeObjectURL(audioRef.current.src);
      }
      audioRef.current = null;
    }
    playingRef.current = false;
    setIsPlaying(false);
  }, [instanceId]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        if (audioRef.current.src) {
          URL.revokeObjectURL(audioRef.current.src);
        }
      }
    };
  }, []);

  return { isPlaying };
}
