/**
 * OpenAISoraProvider Unit Tests
 *
 * Focus areas (matches the recent Sora additions in this library):
 * - extendVideo / remixVideo / editVideo wire to the right SDK calls.
 * - createCharacter / getCharacter map id+name and reject null ids.
 * - durationToSeconds rejects NaN / non-finite / non-positive.
 * - prepareImageInput / prepareVideoInput throw on non-OK fetch responses.
 * - prepareVideoInput infers MIME from path extension.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ProviderError } from '@/domain/errors/AIErrors.js';

const {
  mockVideosCreate,
  mockVideosRetrieve,
  mockVideosExtend,
  mockVideosRemix,
  mockVideosEdit,
  mockVideosCreateCharacter,
  mockVideosGetCharacter,
  mockVideosDelete,
  mockVideosDownloadContent,
  mockOpenAI,
} = vi.hoisted(() => {
  const mockVideosCreate = vi.fn();
  const mockVideosRetrieve = vi.fn();
  const mockVideosExtend = vi.fn();
  const mockVideosRemix = vi.fn();
  const mockVideosEdit = vi.fn();
  const mockVideosCreateCharacter = vi.fn();
  const mockVideosGetCharacter = vi.fn();
  const mockVideosDelete = vi.fn();
  const mockVideosDownloadContent = vi.fn();
  const mockOpenAI = vi.fn(() => ({
    videos: {
      create: mockVideosCreate,
      retrieve: mockVideosRetrieve,
      extend: mockVideosExtend,
      remix: mockVideosRemix,
      edit: mockVideosEdit,
      createCharacter: mockVideosCreateCharacter,
      getCharacter: mockVideosGetCharacter,
      delete: mockVideosDelete,
      downloadContent: mockVideosDownloadContent,
    },
  }));
  return {
    mockVideosCreate,
    mockVideosRetrieve,
    mockVideosExtend,
    mockVideosRemix,
    mockVideosEdit,
    mockVideosCreateCharacter,
    mockVideosGetCharacter,
    mockVideosDelete,
    mockVideosDownloadContent,
    mockOpenAI,
  };
});

vi.mock('openai', () => ({
  default: mockOpenAI,
}));

import { OpenAISoraProvider } from '@/infrastructure/providers/openai/OpenAISoraProvider.js';

const fakeVideoResponse = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: 'video_abc',
  status: 'queued',
  created_at: 1_700_000_000,
  progress: 0,
  seconds: '8',
  size: '1280x720',
  ...overrides,
});

describe('OpenAISoraProvider', () => {
  let provider: OpenAISoraProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new OpenAISoraProvider({
      auth: { type: 'api_key', apiKey: 'test-key' },
    });
  });

  // ---------------------------------------------------------------------------
  // extendVideo — uses SDK videos.extend (not videos.remix)
  // ---------------------------------------------------------------------------
  describe('extendVideo()', () => {
    beforeEach(() => {
      mockVideosExtend.mockResolvedValue(fakeVideoResponse({ id: 'video_ext' }));
    });

    it('calls videos.extend with { video: {id}, prompt, seconds }', async () => {
      await provider.extendVideo({
        model: 'sora-2',
        video: 'video_src',
        prompt: 'continue the scene',
        extendDuration: 8,
      });

      expect(mockVideosExtend).toHaveBeenCalledTimes(1);
      expect(mockVideosExtend).toHaveBeenCalledWith({
        video: { id: 'video_src' },
        prompt: 'continue the scene',
        seconds: '8',
      });
      expect(mockVideosRemix).not.toHaveBeenCalled();
    });

    it('snaps fractional extendDuration to the nearest allowed seconds value', async () => {
      await provider.extendVideo({
        model: 'sora-2',
        video: 'video_src',
        prompt: '...',
        extendDuration: 5,
      });
      expect(mockVideosExtend.mock.calls[0][0].seconds).toBe('8');
    });

    it('uses default prompt when none provided', async () => {
      await provider.extendVideo({
        model: 'sora-2',
        video: 'video_src',
        extendDuration: 4,
      });
      expect(mockVideosExtend.mock.calls[0][0].prompt).toBe('Extend this video seamlessly');
    });

    it('rejects URL refs with a clear error', async () => {
      await expect(
        provider.extendVideo({
          model: 'sora-2',
          video: 'https://example.com/clip.mp4',
          extendDuration: 4,
        })
      ).rejects.toThrow(/requires a video id/i);
      expect(mockVideosExtend).not.toHaveBeenCalled();
    });

    it('rejects Buffer refs with a clear error', async () => {
      await expect(
        provider.extendVideo({
          model: 'sora-2',
          video: Buffer.from('fake'),
          extendDuration: 4,
        })
      ).rejects.toThrow(/requires a video id/i);
      expect(mockVideosExtend).not.toHaveBeenCalled();
    });

    it('rejects NaN extendDuration before hitting the SDK', async () => {
      await expect(
        provider.extendVideo({
          model: 'sora-2',
          video: 'video_src',
          extendDuration: Number.NaN,
        })
      ).rejects.toThrow(/finite positive/i);
      expect(mockVideosExtend).not.toHaveBeenCalled();
    });

    it('rejects negative extendDuration before hitting the SDK', async () => {
      await expect(
        provider.extendVideo({
          model: 'sora-2',
          video: 'video_src',
          extendDuration: -5,
        })
      ).rejects.toThrow(/finite positive/i);
      expect(mockVideosExtend).not.toHaveBeenCalled();
    });

    it('rejects zero extendDuration before hitting the SDK', async () => {
      await expect(
        provider.extendVideo({
          model: 'sora-2',
          video: 'video_src',
          extendDuration: 0,
        })
      ).rejects.toThrow(/finite positive/i);
      expect(mockVideosExtend).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // remixVideo, editVideo
  // ---------------------------------------------------------------------------
  describe('remixVideo()', () => {
    it('calls videos.remix(videoId, { prompt }) once', async () => {
      mockVideosRemix.mockResolvedValue(fakeVideoResponse({ id: 'video_rmx' }));
      const result = await provider.remixVideo({
        videoId: 'video_src',
        prompt: 'golden hour',
      });
      expect(mockVideosRemix).toHaveBeenCalledTimes(1);
      expect(mockVideosRemix).toHaveBeenCalledWith('video_src', { prompt: 'golden hour' });
      expect(result.jobId).toBe('video_rmx');
    });
  });

  describe('editVideo()', () => {
    it('calls videos.edit({ video: {id}, prompt }) once', async () => {
      mockVideosEdit.mockResolvedValue(fakeVideoResponse({ id: 'video_edt' }));
      const result = await provider.editVideo({
        videoId: 'video_src',
        prompt: 'add snow',
      });
      expect(mockVideosEdit).toHaveBeenCalledTimes(1);
      expect(mockVideosEdit).toHaveBeenCalledWith({
        video: { id: 'video_src' },
        prompt: 'add snow',
      });
      expect(result.jobId).toBe('video_edt');
    });
  });

  // ---------------------------------------------------------------------------
  // Character API
  // ---------------------------------------------------------------------------
  describe('createCharacter()', () => {
    it('returns the SDK-issued id and name', async () => {
      mockVideosCreateCharacter.mockResolvedValue({
        id: 'char_123',
        name: 'Hero',
        created_at: 1_700_000_000,
      });

      const result = await provider.createCharacter({
        name: 'Hero',
        video: Buffer.from('fake-mp4-bytes'),
      });

      expect(mockVideosCreateCharacter).toHaveBeenCalledTimes(1);
      const args = mockVideosCreateCharacter.mock.calls[0][0];
      expect(args.name).toBe('Hero');
      expect(args.video).toBeInstanceOf(File);
      expect((args.video as File).type).toBe('video/mp4');
      expect(result).toEqual({ id: 'char_123', name: 'Hero' });
    });

    it('falls back to the caller-supplied name when SDK omits it', async () => {
      mockVideosCreateCharacter.mockResolvedValue({
        id: 'char_456',
        name: null,
        created_at: 1_700_000_000,
      });

      const result = await provider.createCharacter({
        name: 'Hero',
        video: Buffer.from('x'),
      });

      expect(result).toEqual({ id: 'char_456', name: 'Hero' });
    });

    it('throws ProviderError when SDK returns null id', async () => {
      mockVideosCreateCharacter.mockResolvedValue({
        id: null,
        name: 'Hero',
        created_at: 1_700_000_000,
      });

      await expect(
        provider.createCharacter({ name: 'Hero', video: Buffer.from('x') })
      ).rejects.toBeInstanceOf(ProviderError);
    });
  });

  describe('getCharacter()', () => {
    it('returns the SDK-issued id and name', async () => {
      mockVideosGetCharacter.mockResolvedValue({
        id: 'char_123',
        name: 'Hero',
        created_at: 1_700_000_000,
      });
      const result = await provider.getCharacter('char_123');
      expect(mockVideosGetCharacter).toHaveBeenCalledWith('char_123');
      expect(result).toEqual({ id: 'char_123', name: 'Hero' });
    });

    it('throws ProviderError when SDK returns null id', async () => {
      mockVideosGetCharacter.mockResolvedValue({
        id: null,
        name: null,
        created_at: 1_700_000_000,
      });
      await expect(provider.getCharacter('char_x')).rejects.toBeInstanceOf(ProviderError);
    });
  });

  // ---------------------------------------------------------------------------
  // URL fetch error handling — prepareImageInput / prepareVideoInput
  // (exercised indirectly via generateVideo + createCharacter respectively)
  // ---------------------------------------------------------------------------
  describe('URL fetch error handling', () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it('throws ProviderError when generateVideo image URL returns non-OK', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        arrayBuffer: async () => new ArrayBuffer(0),
      }) as unknown as typeof fetch;

      mockVideosCreate.mockResolvedValue(fakeVideoResponse());

      await expect(
        provider.generateVideo({
          model: 'sora-2',
          prompt: 'hi',
          image: 'https://example.com/missing.png',
        })
      ).rejects.toThrow(/Failed to fetch image reference.*404/);
      expect(mockVideosCreate).not.toHaveBeenCalled();
    });

    it('throws ProviderError when createCharacter video URL returns non-OK', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        arrayBuffer: async () => new ArrayBuffer(0),
      }) as unknown as typeof fetch;

      await expect(
        provider.createCharacter({
          name: 'Hero',
          video: 'https://example.com/missing.mp4',
        })
      ).rejects.toThrow(/Failed to fetch video reference.*500/);
      expect(mockVideosCreateCharacter).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // prepareVideoInput MIME inference (exercised via createCharacter)
  // ---------------------------------------------------------------------------
  describe('prepareVideoInput — MIME inference', () => {
    beforeEach(() => {
      mockVideosCreateCharacter.mockResolvedValue({
        id: 'char_x',
        name: 'X',
        created_at: 1,
      });
    });

    it('uses video/mp4 for raw Buffers', async () => {
      await provider.createCharacter({ name: 'X', video: Buffer.from('x') });
      const file = mockVideosCreateCharacter.mock.calls[0][0].video as File;
      expect(file.type).toBe('video/mp4');
    });

    it('preserves the byte content and length of the source Buffer', async () => {
      // Regression guard for the zero-extra-copy upload path: dropping the
      // `new Uint8Array(buffer)` wrapper must not truncate or mangle bytes.
      const payload = Buffer.from([0x00, 0xff, 0x42, 0x13, 0x37, 0xab, 0xcd]);
      await provider.createCharacter({ name: 'X', video: payload });
      const file = mockVideosCreateCharacter.mock.calls[0][0].video as File;
      expect(file.size).toBe(payload.length);
      const roundTrip = Buffer.from(await file.arrayBuffer());
      expect(Buffer.compare(roundTrip, payload)).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Byte-fidelity for the *image* upload paths (generateVideo with image=…).
  // Each path constructs a `File` for OpenAI; we verify size + bytes survive.
  // ---------------------------------------------------------------------------
  describe('prepareImageInput byte fidelity (via generateVideo)', () => {
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
      mockVideosCreate.mockResolvedValue(fakeVideoResponse());
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it('Buffer path: File preserves length + bytes', async () => {
      const payload = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]); // PNG-magic-ish
      await provider.generateVideo({ model: 'sora-2', prompt: 'hi', image: payload });
      const file = mockVideosCreate.mock.calls[0][0].input_reference as File;
      expect(file).toBeInstanceOf(File);
      expect(file.size).toBe(payload.length);
      expect(Buffer.compare(Buffer.from(await file.arrayBuffer()), payload)).toBe(0);
    });

    it('local file path: File preserves length + bytes', async () => {
      const fs = await import('fs/promises');
      const os = await import('os');
      const path = await import('path');
      const payload = Buffer.from([0x42, 0x4d, 0xff, 0x00, 0x13, 0x37, 0xab]); // arbitrary
      const tmpPath = path.join(os.tmpdir(), `sora-img-${Date.now()}-${Math.random().toString(36).slice(2)}.png`);
      await fs.writeFile(tmpPath, payload);
      try {
        await provider.generateVideo({ model: 'sora-2', prompt: 'hi', image: tmpPath });
        const file = mockVideosCreate.mock.calls[0][0].input_reference as File;
        expect(file).toBeInstanceOf(File);
        expect(file.size).toBe(payload.length);
        expect(Buffer.compare(Buffer.from(await file.arrayBuffer()), payload)).toBe(0);
      } finally {
        await fs.unlink(tmpPath).catch(() => {});
      }
    });

    it('URL path: File preserves length + bytes', async () => {
      const payload = Buffer.from([0xde, 0xad, 0xbe, 0xef, 0x00, 0xff]);
      const ab = payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength) as ArrayBuffer;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        arrayBuffer: async () => ab,
      }) as unknown as typeof fetch;

      await provider.generateVideo({
        model: 'sora-2',
        prompt: 'hi',
        image: 'https://example.com/ref.png',
      });

      const file = mockVideosCreate.mock.calls[0][0].input_reference as File;
      expect(file).toBeInstanceOf(File);
      expect(file.size).toBe(payload.length);
      expect(Buffer.compare(Buffer.from(await file.arrayBuffer()), payload)).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Byte-fidelity for the *video* upload paths (createCharacter with video=…).
  // Buffer path already covered above; here we cover fs path + URL path.
  // ---------------------------------------------------------------------------
  describe('prepareVideoInput byte fidelity (via createCharacter)', () => {
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
      mockVideosCreateCharacter.mockResolvedValue({
        id: 'char_x',
        name: 'X',
        created_at: 1,
      });
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it('local .mov path: File preserves length + bytes and infers quicktime MIME', async () => {
      const fs = await import('fs/promises');
      const os = await import('os');
      const path = await import('path');
      const payload = Buffer.from([0x00, 0x00, 0x00, 0x14, 0x66, 0x74, 0x79, 0x70]); // MOV-magic-ish
      const tmpPath = path.join(os.tmpdir(), `sora-vid-${Date.now()}-${Math.random().toString(36).slice(2)}.mov`);
      await fs.writeFile(tmpPath, payload);
      try {
        await provider.createCharacter({ name: 'X', video: tmpPath });
        const file = mockVideosCreateCharacter.mock.calls[0][0].video as File;
        expect(file).toBeInstanceOf(File);
        expect(file.type).toBe('video/quicktime');
        expect(file.size).toBe(payload.length);
        expect(Buffer.compare(Buffer.from(await file.arrayBuffer()), payload)).toBe(0);
      } finally {
        await fs.unlink(tmpPath).catch(() => {});
      }
    });

    it('local .webm path: infers webm MIME', async () => {
      const fs = await import('fs/promises');
      const os = await import('os');
      const path = await import('path');
      const payload = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]); // EBML magic
      const tmpPath = path.join(os.tmpdir(), `sora-vid-${Date.now()}.webm`);
      await fs.writeFile(tmpPath, payload);
      try {
        await provider.createCharacter({ name: 'X', video: tmpPath });
        const file = mockVideosCreateCharacter.mock.calls[0][0].video as File;
        expect(file.type).toBe('video/webm');
        expect(file.size).toBe(payload.length);
      } finally {
        await fs.unlink(tmpPath).catch(() => {});
      }
    });

    it('URL path: File preserves length + bytes', async () => {
      const payload = Buffer.from([0xca, 0xfe, 0xba, 0xbe, 0x42, 0x13, 0x37]);
      const ab = payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength) as ArrayBuffer;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        arrayBuffer: async () => ab,
      }) as unknown as typeof fetch;

      await provider.createCharacter({
        name: 'X',
        video: 'https://example.com/clip.mp4',
      });

      const file = mockVideosCreateCharacter.mock.calls[0][0].video as File;
      expect(file).toBeInstanceOf(File);
      expect(file.size).toBe(payload.length);
      expect(Buffer.compare(Buffer.from(await file.arrayBuffer()), payload)).toBe(0);
    });
  });
});
