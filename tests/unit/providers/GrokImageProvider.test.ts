/**
 * GrokImageProvider Unit Tests
 * Tests the Grok image provider implementation with mocked OpenAI SDK
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ProviderAuthError,
  ProviderRateLimitError,
  ProviderError,
} from '@/domain/errors/AIErrors.js';

// Create mock functions with vi.hoisted for proper hoisting
const { mockGenerate, mockEdit, mockOpenAI } = vi.hoisted(() => {
  const mockGenerate = vi.fn();
  const mockEdit = vi.fn();
  const mockOpenAI = vi.fn(() => ({
    images: {
      generate: mockGenerate,
      edit: mockEdit,
    },
  }));
  return { mockGenerate, mockEdit, mockOpenAI };
});

// Mock OpenAI SDK
vi.mock('openai', () => ({
  default: mockOpenAI,
}));

// Import after mocking
import { GrokImageProvider } from '@/infrastructure/providers/grok/GrokImageProvider.js';

describe('GrokImageProvider', () => {
  let provider: GrokImageProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new GrokImageProvider({
      auth: { type: 'api_key', apiKey: 'test-grok-api-key' },
    });
  });

  describe('constructor', () => {
    it('should create OpenAI client with Grok base URL', () => {
      expect(mockOpenAI).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKey: 'test-grok-api-key',
          baseURL: 'https://api.x.ai/v1',
        })
      );
    });

    it('should use custom baseURL if provided', () => {
      new GrokImageProvider({
        auth: { type: 'api_key', apiKey: 'test-key' },
        baseURL: 'https://custom.api.com',
      });

      expect(mockOpenAI).toHaveBeenCalledWith(
        expect.objectContaining({
          baseURL: 'https://custom.api.com',
        })
      );
    });

    it('should pass timeout and maxRetries', () => {
      new GrokImageProvider({
        auth: { type: 'api_key', apiKey: 'test-key' },
        timeout: 30000,
        maxRetries: 5,
      });

      expect(mockOpenAI).toHaveBeenCalledWith(
        expect.objectContaining({
          timeout: 30000,
          maxRetries: 5,
        })
      );
    });
  });

  describe('name and capabilities', () => {
    it('should have name "grok-image"', () => {
      expect(provider.name).toBe('grok-image');
    });

    it('should have vendor "grok"', () => {
      expect(provider.vendor).toBe('grok');
    });

    it('should have correct capabilities', () => {
      expect(provider.capabilities).toEqual({
        text: false,
        images: true,
        videos: false,
        audio: false,
        features: {
          imageGeneration: true,
          imageEditing: true,
        },
      });
    });
  });

  describe('generateImage()', () => {
    const mockResponse = {
      created: 1234567890,
      data: [
        {
          url: 'https://example.com/image.png',
          b64_json: 'base64encodeddata',
          revised_prompt: 'A beautiful sunset over mountains',
        },
      ],
    };

    beforeEach(() => {
      mockGenerate.mockResolvedValue(mockResponse);
    });

    it('should call images.generate with correct parameters', async () => {
      await provider.generateImage({
        model: 'grok-imagine-image',
        prompt: 'A sunset over mountains',
        aspectRatio: '16:9',
        n: 1,
      });

      expect(mockGenerate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'grok-imagine-image',
          prompt: 'A sunset over mountains',
          aspect_ratio: '16:9',
          n: 1,
          response_format: 'b64_json',
        })
      );
    });

    it('should use default model if not specified', async () => {
      await provider.generateImage({
        model: 'grok-imagine-image',
        prompt: 'Test prompt',
      });

      expect(mockGenerate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'grok-imagine-image',
        })
      );
    });

    it('should return correct response format', async () => {
      const response = await provider.generateImage({
        model: 'grok-imagine-image',
        prompt: 'Test prompt',
      });

      expect(response).toEqual({
        created: 1234567890,
        data: [
          {
            url: 'https://example.com/image.png',
            b64_json: 'base64encodeddata',
            revised_prompt: 'A beautiful sunset over mountains',
          },
        ],
      });
    });

    it('should handle multiple images', async () => {
      mockGenerate.mockResolvedValue({
        created: 1234567890,
        data: [
          { b64_json: 'image1' },
          { b64_json: 'image2' },
          { b64_json: 'image3' },
        ],
      });

      const response = await provider.generateImage({
        model: 'grok-imagine-image',
        prompt: 'Test',
        n: 3,
      });

      expect(response.data).toHaveLength(3);
    });

    it('should not pass quality parameter (xAI does not support it)', async () => {
      await provider.generateImage({
        model: 'grok-imagine-image',
        prompt: 'Test',
        quality: 'hd', // Should be ignored
      });

      // Verify quality is NOT in the call (xAI doesn't support it)
      expect(mockGenerate).toHaveBeenCalledWith(
        expect.not.objectContaining({
          quality: expect.anything(),
        })
      );
    });
  });

  describe('editImage()', () => {
    const mockEditResponse = {
      created: 1234567890,
      data: [
        {
          b64_json: 'editedimagedata',
        },
      ],
    };

    beforeEach(() => {
      mockEdit.mockResolvedValue(mockEditResponse);
    });

    it('should call images.edit with correct parameters', async () => {
      const imageBuffer = Buffer.from('test-image-data');

      await provider.editImage({
        model: 'grok-imagine-image',
        image: imageBuffer,
        prompt: 'Make it blue',
        size: '1024x1024',
      });

      expect(mockEdit).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'grok-imagine-image',
          prompt: 'Make it blue',
          size: '1024x1024',
          response_format: 'b64_json',
        })
      );
    });

    it('should return correct response format', async () => {
      const response = await provider.editImage({
        model: 'grok-imagine-image',
        image: Buffer.from('test'),
        prompt: 'Edit this',
      });

      expect(response).toEqual({
        created: 1234567890,
        data: [{ b64_json: 'editedimagedata' }],
      });
    });

    it('byte-fidelity: File preserves length + bytes from a source Buffer', async () => {
      // Regression guard for the zero-extra-copy upload path:
      // `prepareImageInput` was changed from `new File([new Uint8Array(buf)], …)`
      // to `new File([buf as BlobPart], …)`. We verify the resulting File has
      // the right size and exact bytes — catches truncation if anyone reverts.
      const payload = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]); // JPEG-ish
      await provider.editImage({
        model: 'grok-imagine-image',
        image: payload,
        prompt: 'edit',
      });
      const file = mockEdit.mock.calls[0][0].image as File;
      expect(file).toBeInstanceOf(File);
      expect(file.size).toBe(payload.length);
      expect(Buffer.compare(Buffer.from(await file.arrayBuffer()), payload)).toBe(0);
    });
  });

  describe('listModels()', () => {
    it('should return list of available models', async () => {
      const models = await provider.listModels();

      expect(models).toEqual(['grok-imagine-image']);
    });
  });

  describe('error handling', () => {
    it('should throw ProviderAuthError on 401', async () => {
      mockGenerate.mockRejectedValue({ status: 401 });

      await expect(
        provider.generateImage({ model: 'grok-imagine-image', prompt: 'Test' })
      ).rejects.toThrow(ProviderAuthError);
    });

    it('should throw ProviderRateLimitError on 429', async () => {
      mockGenerate.mockRejectedValue({ status: 429, message: 'Rate limited' });

      await expect(
        provider.generateImage({ model: 'grok-imagine-image', prompt: 'Test' })
      ).rejects.toThrow(ProviderRateLimitError);
    });

    it('should throw ProviderError on content policy violation', async () => {
      mockGenerate.mockRejectedValue({
        status: 400,
        message: 'Content policy violation: safety filter triggered',
      });

      await expect(
        provider.generateImage({ model: 'grok-imagine-image', prompt: 'Test' })
      ).rejects.toThrow(ProviderError);
    });

    it('should throw ProviderError for bad request', async () => {
      mockGenerate.mockRejectedValue({
        status: 400,
        message: 'Invalid parameter',
      });

      await expect(
        provider.generateImage({ model: 'grok-imagine-image', prompt: 'Test' })
      ).rejects.toThrow(ProviderError);
    });

    it('should throw ProviderError for unknown errors', async () => {
      mockGenerate.mockRejectedValue(new Error('Unknown error'));

      await expect(
        provider.generateImage({ model: 'grok-imagine-image', prompt: 'Test' })
      ).rejects.toThrow(ProviderError);
    });
  });
});
