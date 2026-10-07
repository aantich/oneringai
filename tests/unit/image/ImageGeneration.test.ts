import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImageGeneration } from '../../../src/capabilities/images/ImageGeneration.js';
import { Connector } from '../../../src/core/Connector.js';
import { Vendor } from '../../../src/core/Vendor.js';
import type { IImageProvider } from '../../../src/domain/interfaces/IImageProvider.js';

vi.mock('../../../src/core/createImageProvider.js', () => ({
  createImageProvider: vi.fn(),
}));

import { createImageProvider } from '../../../src/core/createImageProvider.js';

const mockCreateProvider = vi.mocked(createImageProvider);

function mockProvider(): IImageProvider {
  return {
    name: 'mock-image',
    capabilities: { text: false, images: true, videos: false, audio: false },
    validateConfig: vi.fn().mockResolvedValue(true),
    generateImage: vi.fn().mockResolvedValue({ created: 1, data: [] }),
    editImage: vi.fn().mockResolvedValue({ created: 1, data: [] }),
  };
}

describe('ImageGeneration', () => {
  let provider: IImageProvider;

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
    [Vendor.OpenAI, 'gpt-image-2.5-sunburst'],
    [Vendor.Google, 'gemini-nano-banana-2.1'],
    [Vendor.Grok, 'grok-imagine-image-2.0'],
  ])('uses the current default generation model for %s', async (vendor, model) => {
    Connector.create({ name: `image-${vendor}`, vendor, auth: { type: 'api_key', apiKey: 'test' } });
    const images = ImageGeneration.create({ connector: `image-${vendor}` });

    await images.generate({
      prompt: 'A geometric landscape',
      aspectRatio: '16:9',
      quality: 'high',
      vendorOptions: { output_format: 'webp' },
    });

    expect(provider.generateImage).toHaveBeenCalledWith(expect.objectContaining({
      model,
      aspectRatio: '16:9',
      quality: 'high',
      vendorOptions: { output_format: 'webp' },
    }));
  });

  it.each([
    [Vendor.OpenAI, 'gpt-image-2.5-sunburst'],
    [Vendor.Google, 'gemini-nano-banana-2.1'],
    [Vendor.Grok, 'grok-imagine-image-2.0'],
  ])('uses the current default edit model for %s', async (vendor, model) => {
    Connector.create({ name: `edit-${vendor}`, vendor, auth: { type: 'api_key', apiKey: 'test' } });
    const images = ImageGeneration.create({ connector: `edit-${vendor}` });

    await images.edit({ image: Buffer.from('image'), prompt: 'Add clouds' });

    expect(provider.editImage).toHaveBeenCalledWith(expect.objectContaining({ model }));
  });
});
