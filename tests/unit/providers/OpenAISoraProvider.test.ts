/** Retirement guards cover direct providers and the connector-first facade. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Connector } from '@/core/Connector.js';
import { Vendor } from '@/core/Vendor.js';
import { VideoGeneration } from '@/capabilities/video/VideoGeneration.js';
import { ProviderError } from '@/domain/errors/AIErrors.js';

const { mockOpenAI } = vi.hoisted(() => ({
  mockOpenAI: vi.fn(() => { throw new Error('Retired video must not initialize the SDK'); }),
}));
vi.mock('openai', () => ({ default: mockOpenAI }));

import { OpenAISoraProvider } from '@/infrastructure/providers/openai/OpenAISoraProvider.js';

describe('OpenAISoraProvider retirement', () => {
  let provider: OpenAISoraProvider;
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    Connector.clear();
    vi.stubGlobal('fetch', fetchMock);
    provider = new OpenAISoraProvider({ auth: { type: 'api_key', apiKey: 'test-key' } });
  });

  afterEach(() => {
    expect(mockOpenAI).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    Connector.clear();
    vi.unstubAllGlobals();
  });

  it.each([
    'sora-2', 'sora-2-pro', 'sora-2-2025-10-06',
    'sora-2-2025-12-08', 'sora-2-pro-2025-10-06', 'unknown-video-model',
  ])('rejects %s before creating a job or fetching an image', async (model) => {
    await expect(provider.generateVideo({ model, prompt: 'A landscape', image: 'https://example.com/image.png' }))
      .rejects.toMatchObject({ name: 'ProviderError', statusCode: 410, message: expect.stringContaining('2026-09-24') });
  });

  it('rejects every retired job and character operation with migration guidance', async () => {
    const operations = [
      () => provider.getVideoStatus('video-1'),
      () => provider.downloadVideo('video-1'),
      () => provider.extendVideo({ model: 'sora-2', video: 'video-1', extendDuration: 8 }),
      () => provider.remixVideo({ videoId: 'video-1', prompt: 'Golden hour' }),
      () => provider.editVideo({ videoId: 'video-1', prompt: 'Add snow' }),
      () => provider.createCharacter({ name: 'Hero', video: '/missing-video.mp4' }),
      () => provider.createCharacter({ name: 'Hero', video: 'https://example.com/video.mp4' }),
      () => provider.getCharacter('character-1'),
    ];
    for (const operation of operations) {
      await expect(operation()).rejects.toBeInstanceOf(ProviderError);
      await expect(operation()).rejects.toMatchObject({
        statusCode: 410, message: expect.stringContaining('no replacement; configure a Google or Grok video connector'),
      });
    }
  });

  it('advertises no video capabilities or models and preserves unsuccessful cancellation', async () => {
    expect(provider.capabilities.videos).toBe(false);
    expect(Object.values(provider.capabilities.features!)).not.toContain(true);
    await expect(provider.listModels()).resolves.toEqual([]);
    await expect(provider.cancelJob('video-1')).resolves.toBe(false);
  });

  it('keeps the public facade constructible for discovery and rejects default and explicit models locally', async () => {
    Connector.create({ name: 'videos', vendor: Vendor.OpenAI, auth: { type: 'api_key', apiKey: 'test-key' } });
    const videos = VideoGeneration.create({ connector: 'videos' });
    expect(videos.getProvider()).toBeInstanceOf(OpenAISoraProvider);
    await expect(videos.listModels()).resolves.toEqual([]);
    await expect(videos.generate({ prompt: 'A landscape' })).rejects.toMatchObject({ statusCode: 410 });
    await expect(videos.generate({ prompt: 'A landscape', model: 'sora-2-pro' })).rejects.toMatchObject({ statusCode: 410 });
    await expect(videos.extend({ video: 'video-1', extendDuration: 8 })).rejects.toMatchObject({ statusCode: 410 });
    await expect(videos.getStatus('video-1')).rejects.toMatchObject({ statusCode: 410 });
    await expect(videos.download('video-1')).rejects.toMatchObject({ statusCode: 410 });
    await expect(videos.cancel('video-1')).resolves.toBe(false);
  });
});
