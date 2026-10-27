import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VideoGeneration } from '../../../src/capabilities/video/VideoGeneration.js';
import { Connector } from '../../../src/core/Connector.js';
import { Vendor } from '../../../src/core/Vendor.js';
import type { IVideoProvider } from '../../../src/domain/interfaces/IVideoProvider.js';

vi.mock('../../../src/core/createVideoProvider.js', () => ({
  createVideoProvider: vi.fn(),
}));

import { createVideoProvider } from '../../../src/core/createVideoProvider.js';

const mockCreateProvider = vi.mocked(createVideoProvider);

function mockProvider(): IVideoProvider {
  const response = { jobId: 'job-1', status: 'pending' as const, created: 1 };
  return {
    name: 'mock-video',
    capabilities: { text: false, images: false, videos: true, audio: false },
    validateConfig: vi.fn().mockResolvedValue(true),
    generateVideo: vi.fn().mockResolvedValue(response),
    getVideoStatus: vi.fn().mockResolvedValue(response),
    extendVideo: vi.fn().mockResolvedValue(response),
  };
}

describe('VideoGeneration', () => {
  let provider: IVideoProvider;

  beforeEach(() => {
    Connector.clear();
    provider = mockProvider();
    mockCreateProvider.mockReturnValue(provider);
  });

  afterEach(() => {
    Connector.clear();
    vi.clearAllMocks();
  });

  it.each([
    [Vendor.Google, 'gemini-omni-1.1-flash'],
    [Vendor.Grok, 'grok-imagine-video-1.5'],
  ])('uses the correct default generation model for %s', async (vendor, model) => {
    Connector.create({ name: `video-${vendor}`, vendor, auth: { type: 'api_key', apiKey: 'test' } });
    const videos = VideoGeneration.create({ connector: `video-${vendor}` });

    await videos.generate({ prompt: 'A slow camera move', duration: 6 });

    expect(provider.generateVideo).toHaveBeenCalledWith(expect.objectContaining({ model }));
  });

  it('rejects the retired OpenAI default before dispatch and filters registry fallback models', async () => {
    Connector.create({ name: 'video-openai', vendor: Vendor.OpenAI, auth: { type: 'api_key', apiKey: 'test' } });
    const videos = VideoGeneration.create({ connector: 'video-openai' });
    await expect(videos.generate({ prompt: 'A slow camera move' })).rejects.toMatchObject({ statusCode: 410 });
    await expect(videos.extend({ video: 'job-source', extendDuration: 8 })).rejects.toMatchObject({ statusCode: 410 });
    expect(provider.generateVideo).not.toHaveBeenCalled();
    expect(provider.extendVideo).not.toHaveBeenCalled();
    await expect(videos.listModels()).resolves.toEqual([]);
  });

  it.each([
    [Vendor.Google, 'veo-3.1-generate-preview'],
  ])('allows the default extension model to be omitted for %s', async (vendor, model) => {
    Connector.create({ name: `extend-${vendor}`, vendor, auth: { type: 'api_key', apiKey: 'test' } });
    const videos = VideoGeneration.create({ connector: `extend-${vendor}` });

    await videos.extend({ video: 'job-source', extendDuration: 8 });

    expect(provider.extendVideo).toHaveBeenCalledWith(expect.objectContaining({ model }));
  });
});
