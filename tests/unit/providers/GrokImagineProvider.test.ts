/**
 * GrokImagineProvider Unit Tests
 * Tests the Grok video provider implementation with mocked fetch
 * Based on actual xAI API: https://docs.x.ai/docs/api-reference#video-generation
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  ProviderAuthError,
  ProviderRateLimitError,
  ProviderError,
} from '@/domain/errors/AIErrors.js';
import { GrokImagineProvider } from '@/infrastructure/providers/grok/GrokImagineProvider.js';

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('GrokImagineProvider', () => {
  let provider: GrokImagineProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new GrokImagineProvider({
      auth: { type: 'api_key', apiKey: 'test-grok-api-key' },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should use default base URL', () => {
      const p = new GrokImagineProvider({
        auth: { type: 'api_key', apiKey: 'test-key' },
      });
      expect(p).toBeDefined();
    });

    it('should use custom baseURL if provided', () => {
      const p = new GrokImagineProvider({
        auth: { type: 'api_key', apiKey: 'test-key' },
        baseURL: 'https://custom.api.com',
      });
      expect(p).toBeDefined();
    });
  });

  describe('name and capabilities', () => {
    it('should have name "grok-video"', () => {
      expect(provider.name).toBe('grok-video');
    });

    it('should have vendor "grok"', () => {
      expect(provider.vendor).toBe('grok');
    });

    it('should have correct capabilities', () => {
      expect(provider.capabilities).toEqual({
        text: false,
        images: false,
        videos: true,
        audio: false,
        features: {
          videoGeneration: true,
          imageToVideo: true,
        },
      });
    });
  });

  describe('generateVideo()', () => {
    // xAI returns just request_id on create
    const mockCreateResponse = {
      request_id: 'aa87081b-1a29-d8a6-e5bf-5807e3a7a561',
    };

    beforeEach(() => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockCreateResponse),
      });
    });

    it.each(['grok-imagine-video-1.5', 'grok-imagine-video-1.5-lite'])(
      'submits text-to-video without a fabricated reference image for %s', async model => {
        await provider.generateVideo({ model, prompt: 'A paper boat sailing', duration: 6, resolution: '1080p' });
        const body = JSON.parse(mockFetch.mock.calls[0]![1].body);
        expect(body).toMatchObject({ model, prompt: 'A paper boat sailing', duration: 6, resolution: '1080p' });
        expect(body.image).toBeUndefined();
      },
    );

    it('should call API with correct parameters', async () => {
      await provider.generateVideo({
        model: 'grok-imagine-video',
        prompt: 'A rotating cube',
        duration: 5,
        aspectRatio: '16:9',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.x.ai/v1/videos/generations',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-grok-api-key',
            'Content-Type': 'application/json',
          }),
        })
      );

      // Check the body
      const call = mockFetch.mock.calls[0];
      const body = JSON.parse(call[1].body);
      expect(body.model).toBe('grok-imagine-video');
      expect(body.prompt).toBe('A rotating cube');
      expect(body.duration).toBe(5);
      expect(body.aspect_ratio).toBe('16:9');
    });

    it('should return correct response format with request_id as jobId', async () => {
      const response = await provider.generateVideo({
        model: 'grok-imagine-video',
        prompt: 'Test video',
      });

      expect(response.jobId).toBe('aa87081b-1a29-d8a6-e5bf-5807e3a7a561');
      expect(response.status).toBe('pending');
      expect(response.created).toBeDefined();
    });

    it('should use default model if not specified', async () => {
      await provider.generateVideo({
        model: 'grok-imagine-video',
        prompt: 'Test',
      });

      const call = mockFetch.mock.calls[0];
      const body = JSON.parse(call[1].body);
      expect(body.model).toBe('grok-imagine-video');
    });

    it('should handle image-to-video with buffer using image object', async () => {
      const imageBuffer = Buffer.from('test-image-data');

      await provider.generateVideo({
        model: 'grok-imagine-video',
        prompt: 'Animate this',
        image: imageBuffer,
      });

      const call = mockFetch.mock.calls[0];
      const body = JSON.parse(call[1].body);
      // xAI expects image: { url: "..." } object
      expect(body.image).toEqual({
        url: `data:image/png;base64,${imageBuffer.toString('base64')}`,
      });
    });

    it('should pass through http URLs for image', async () => {
      await provider.generateVideo({
        model: 'grok-imagine-video',
        prompt: 'Animate this',
        image: 'https://example.com/image.png',
      });

      const call = mockFetch.mock.calls[0];
      const body = JSON.parse(call[1].body);
      expect(body.image).toEqual({
        url: 'https://example.com/image.png',
      });
    });

    it('should use default duration of 6 seconds', async () => {
      await provider.generateVideo({
        model: 'grok-imagine-video',
        prompt: 'Test',
      });

      const call = mockFetch.mock.calls[0];
      const body = JSON.parse(call[1].body);
      expect(body.duration).toBe(6);
    });
  });

  describe('getVideoStatus()', () => {
    it('should call correct API endpoint /videos/{id}', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            status: 'pending',
          }),
      });

      await provider.getVideoStatus('job-123');

      // Note: endpoint is /videos/{id}
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.x.ai/v1/videos/job-123',
        expect.objectContaining({
          method: 'GET',
        })
      );
    });

    it('should return processing status when xAI status is pending', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            status: 'pending',
          }),
      });

      const response = await provider.getVideoStatus('job-123');

      expect(response.jobId).toBe('job-123');
      expect(response.status).toBe('processing');
    });

    it('should return completed status with video data when done with url', async () => {
      // xAI returns video/model at root level when complete (no 'status' field)
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            model: 'grok-imagine-video',
            video: {
              url: 'https://example.com/video.mp4',
              duration: 5,
              respect_moderation: true,
            },
          }),
      });

      const response = await provider.getVideoStatus('job-123');

      expect(response.jobId).toBe('job-123');
      expect(response.status).toBe('completed');
      expect(response.video).toEqual({
        url: 'https://example.com/video.mp4',
        duration: 5,
        format: 'mp4',
      });
    });

    it('should return failed status when moderation blocks video', async () => {
      // xAI returns video at root level with respect_moderation=false when blocked
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            model: 'grok-imagine-video',
            video: {
              url: '',
              duration: 5,
              respect_moderation: false,
            },
          }),
      });

      const response = await provider.getVideoStatus('job-123');

      expect(response.jobId).toBe('job-123');
      expect(response.status).toBe('failed');
      expect(response.error).toBe('Video blocked by content moderation');
    });

    it('should return failed status when done but no url', async () => {
      // Edge case: video object present but URL is empty
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            model: 'grok-imagine-video',
            video: {
              url: '',
              duration: 5,
              respect_moderation: true,
            },
          }),
      });

      const response = await provider.getVideoStatus('job-123');

      expect(response.jobId).toBe('job-123');
      expect(response.status).toBe('failed');
    });
  });

  describe('downloadVideo()', () => {
    it('should download video when completed', async () => {
      // First call for status check - xAI returns video at root level when complete
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            model: 'grok-imagine-video',
            video: {
              url: 'https://example.com/video.mp4',
              duration: 5,
              respect_moderation: true,
            },
          }),
      });

      // Second call for downloading video
      const videoData = new Uint8Array([1, 2, 3, 4, 5]);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: () => Promise.resolve(videoData.buffer),
      });

      const buffer = await provider.downloadVideo('job-123');

      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBe(5);
    });

    it('should throw error if video not ready', async () => {
      // xAI returns { status: 'pending' } when still processing
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            status: 'pending',
          }),
      });

      await expect(provider.downloadVideo('job-123')).rejects.toThrow(
        'Video not ready'
      );
    });
  });

  describe('listModels()', () => {
    it('should return list of available models', async () => {
      const models = await provider.listModels();

      expect(models).toEqual(['grok-imagine-video-1.5', 'grok-imagine-video-1.5-lite', 'grok-imagine-video']);
    });
  });

  describe('cancelJob()', () => {
    it('should return true on successful cancel', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ deleted: true }),
      });

      const result = await provider.cancelJob('job-123');

      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.x.ai/v1/videos/job-123',
        expect.objectContaining({
          method: 'DELETE',
        })
      );
    });

    it('should return false on failed cancel', async () => {
      mockFetch.mockRejectedValue(new Error('Not found'));

      const result = await provider.cancelJob('job-123');

      expect(result).toBe(false);
    });
  });

  describe('error handling', () => {
    it('should throw ProviderAuthError on 401', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ error: { message: 'Invalid API key' } }),
      });

      await expect(
        provider.generateVideo({ model: 'grok-imagine-video', prompt: 'Test' })
      ).rejects.toThrow(ProviderAuthError);
    });

    it('should throw ProviderRateLimitError on 429', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 429,
        json: () => Promise.resolve({ error: { message: 'Rate limited' } }),
      });

      await expect(
        provider.generateVideo({ model: 'grok-imagine-video', prompt: 'Test' })
      ).rejects.toThrow(ProviderRateLimitError);
    });

    it('should throw ProviderError on content policy violation', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        json: () =>
          Promise.resolve({
            error: { message: 'Content policy violation' },
          }),
      });

      await expect(
        provider.generateVideo({ model: 'grok-imagine-video', prompt: 'Test' })
      ).rejects.toThrow(ProviderError);
    });

    it('should throw ProviderError for bad request', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ error: { message: 'Invalid parameter' } }),
      });

      await expect(
        provider.generateVideo({ model: 'grok-imagine-video', prompt: 'Test' })
      ).rejects.toThrow(ProviderError);
    });

    it('should throw ProviderError for validation error (422)', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 422,
        json: () => Promise.resolve({ detail: 'Validation failed' }),
      });

      await expect(
        provider.generateVideo({ model: 'grok-imagine-video', prompt: 'Test' })
      ).rejects.toThrow(ProviderError);
    });

    it('should throw ProviderError for unknown errors', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({}),
      });

      await expect(
        provider.generateVideo({ model: 'grok-imagine-video', prompt: 'Test' })
      ).rejects.toThrow(ProviderError);
    });
  });

  describe('status mapping', () => {
    it('should map xAI pending to processing', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            status: 'pending',
          }),
      });

      const response = await provider.getVideoStatus('job-123');
      expect(response.status).toBe('processing');
    });

    it('should map xAI complete response with video to completed', async () => {
      // xAI returns video/model at root level when complete (no 'status' field)
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            model: 'grok-imagine-video',
            video: {
              url: 'https://example.com/video.mp4',
              duration: 5,
              respect_moderation: true,
            },
          }),
      });

      const response = await provider.getVideoStatus('job-123');
      expect(response.status).toBe('completed');
    });

    it('should map xAI response with respect_moderation=false to failed', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            model: 'grok-imagine-video',
            video: {
              url: '',
              duration: 5,
              respect_moderation: false,
            },
          }),
      });

      const response = await provider.getVideoStatus('job-123');
      expect(response.status).toBe('failed');
      expect(response.error).toBe('Video blocked by content moderation');
    });

    it('should map xAI response with empty url to failed', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            model: 'grok-imagine-video',
            video: {
              url: '',
              duration: 0,
              respect_moderation: true,
            },
          }),
      });

      const response = await provider.getVideoStatus('job-123');
      expect(response.status).toBe('failed');
    });
  });
});
