import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGenerateContent, mockGenerateImages, mockEditImage, mockGoogleGenAI } = vi.hoisted(() => {
  const mockGenerateContent = vi.fn();
  const mockGenerateImages = vi.fn();
  const mockEditImage = vi.fn();
  const mockGoogleGenAI = vi.fn(() => ({
    models: {
      generateContent: mockGenerateContent,
      generateImages: mockGenerateImages,
      editImage: mockEditImage,
    },
  }));
  return { mockGenerateContent, mockGenerateImages, mockEditImage, mockGoogleGenAI };
});

vi.mock('@google/genai', () => ({
  GoogleGenAI: mockGoogleGenAI,
  Modality: { IMAGE: 'IMAGE' },
}));

import { GoogleImageProvider } from '@/infrastructure/providers/google/GoogleImageProvider.js';

describe('GoogleImageProvider', () => {
  let provider: GoogleImageProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new GoogleImageProvider({ apiKey: 'test-google-api-key' });
    mockGenerateContent.mockResolvedValue({
      candidates: [{ content: { parts: [{ inlineData: { data: 'generated' } }] } }],
    });
  });

  it.each([
    ['512x512', '512'],
    ['1024x1024', '1K'],
    ['2048x2048', '2K'],
    ['4096x4096', '4K'],
  ])('translates public size %s to native Gemini size %s', async (size, imageSize) => {
    await provider.generateImage({
      model: 'gemini-3.1-flash-image',
      prompt: 'A lighthouse',
      size,
      n: 3,
    });

    expect(mockGenerateContent).toHaveBeenCalledTimes(3);
    expect(mockGenerateContent).toHaveBeenCalledWith(expect.objectContaining({
      config: expect.objectContaining({
        imageConfig: expect.objectContaining({ imageSize }),
      }),
    }));
  });

  it('omits native imageSize when the public size is auto', async () => {
    await provider.generateImage({
      model: 'gemini-3.1-flash-image',
      prompt: 'A lighthouse',
      size: 'auto',
    });

    expect(mockGenerateContent.mock.calls[0][0].config.imageConfig).not.toHaveProperty('imageSize');
  });

  it('routes Nano Banana 2.1 through Gemini native image generation', async () => {
    await provider.generateImage({
      model: 'gemini-nano-banana-2.1',
      prompt: 'A lighthouse',
    });

    expect(mockGenerateContent).toHaveBeenCalledOnce();
    expect(mockGenerateImages).not.toHaveBeenCalled();
  });

  it('detects JPEG edit input instead of labelling every source as PNG', async () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

    await provider.editImage({
      model: 'gemini-3.1-flash-image',
      image: jpeg,
      prompt: 'Add clouds',
    });

    expect(mockGenerateContent.mock.calls[0][0].contents[0].parts[1]).toEqual({
      inlineData: {
        data: jpeg.toString('base64'),
        mimeType: 'image/jpeg',
      },
    });
  });
});
