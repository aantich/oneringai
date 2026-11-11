import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockInteractionsCreate, mockGoogleGenAI } = vi.hoisted(() => {
  const mockInteractionsCreate = vi.fn();
  const mockGoogleGenAI = vi.fn(() => ({
    interactions: { create: mockInteractionsCreate },
    models: {},
  }));
  return { mockInteractionsCreate, mockGoogleGenAI };
});

vi.mock('@google/genai', () => ({ GoogleGenAI: mockGoogleGenAI }));

import { GoogleVeoProvider } from '@/infrastructure/providers/google/GoogleVeoProvider.js';

describe('GoogleVeoProvider Gemini Omni requests', () => {
  let provider: GoogleVeoProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new GoogleVeoProvider({ auth: { type: 'api_key', apiKey: 'test-key' } });
    mockInteractionsCreate.mockResolvedValue({
      id: 'int_video',
      output_video: { data: Buffer.from('video').toString('base64') },
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('fetches URL images, preserves JPEG MIME, and puts duration in response_format', async () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(jpeg, {
      headers: { 'content-type': 'image/jpeg' },
    })));

    await provider.generateVideo({
      model: 'gemini-omni-flash-preview',
      prompt: 'Animate this scene',
      image: 'https://example.test/source.jpg',
      duration: 8,
      aspectRatio: '16:9',
    });

    expect(mockInteractionsCreate).toHaveBeenCalledWith({
      model: 'gemini-omni-flash-preview',
      input: [
        { type: 'image', data: jpeg.toString('base64'), mime_type: 'image/jpeg' },
        { type: 'text', text: 'Animate this scene' },
      ],
      response_format: { type: 'video', aspect_ratio: '16:9', duration: '8s' },
      generation_config: { video_config: { task: 'image_to_video' } },
    });
  });
  it('routes Omni 1.2 through Interactions with its 15-second duration', async () => {
    await provider.generateVideo({ model: 'gemini-omni-1.2-flash', prompt: 'A continuous scene', duration: 15 });
    expect(mockInteractionsCreate).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gemini-omni-1.2-flash',
      response_format: expect.objectContaining({ duration: '15s' }),
    }));
    expect(await provider.listModels()).toContain('gemini-omni-1.2-flash');
  });

});
