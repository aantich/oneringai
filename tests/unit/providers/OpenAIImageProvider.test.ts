/** Retired operations fail before I/O; GPT Image uploads preserve bytes. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Connector } from '@/core/Connector.js';
import { Vendor } from '@/core/Vendor.js';
import { ImageGeneration } from '@/capabilities/images/ImageGeneration.js';
import type { ImageVariationOptions } from '@/domain/interfaces/IImageProvider.js';
import { getImageModelsByVendor } from '@/domain/entities/ImageModel.js';
import { ProviderError } from '@/domain/errors/AIErrors.js';

const { mockImagesEdit, mockImagesGenerate, mockImagesCreateVariation, mockOpenAI } = vi.hoisted(() => {
  const mockImagesEdit = vi.fn();
  const mockImagesGenerate = vi.fn();
  const mockImagesCreateVariation = vi.fn();
  const mockOpenAI = vi.fn(() => ({
    images: {
      generate: mockImagesGenerate,
      edit: mockImagesEdit,
      createVariation: mockImagesCreateVariation,
    },
  }));
  return { mockImagesEdit, mockImagesGenerate, mockImagesCreateVariation, mockOpenAI };
});

vi.mock('openai', () => ({ default: mockOpenAI }));

import { OpenAIImageProvider } from '@/infrastructure/providers/openai/OpenAIImageProvider.js';

describe('OpenAIImageProvider', () => {
  let provider: OpenAIImageProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    Connector.clear();
    provider = new OpenAIImageProvider({ auth: { type: 'api_key', apiKey: 'test-key' } });
    mockImagesGenerate.mockResolvedValue({ created: 1, data: [{ b64_json: 'AA==' }] });
    mockImagesEdit.mockResolvedValue({ created: 1, data: [{ b64_json: 'AA==' }] });
  });

  afterEach(() => Connector.clear());

  it.each(['dall-e-2', 'dall-e-3'])('rejects retired %s generation and editing before requests or file reads', async (model) => {
    const operations = [
      () => provider.generateImage({ model, prompt: 'A landscape' }),
      () => provider.editImage({ model, image: '/missing-source.png', prompt: 'Add clouds' }),
      () => provider.generateImage({ model: 'gpt-image-2.5-sunburst', prompt: 'A landscape', vendorOptions: { model } }),
      () => provider.editImage({ model: 'gpt-image-2.5-sunburst', image: '/missing-source.png', prompt: 'Add clouds', vendorOptions: { model } }),
    ];
    for (const operation of operations) {
      await expect(operation()).rejects.toMatchObject({
        name: 'ProviderError', statusCode: 410,
        message: expect.stringContaining(`${model} was retired on 2026-05-12`),
      });
    }
    expect(mockImagesGenerate).not.toHaveBeenCalled();
    expect(mockImagesEdit).not.toHaveBeenCalled();
  });

  it.each(['dall-e-2', 'gpt-image-2.5-sunburst'])('rejects variations for %s without SDK calls', async (model) => {
    await expect(provider.createVariation({ model, image: '/missing-source.png' }))
      .rejects.toMatchObject({ statusCode: 410, message: expect.stringContaining('edit() / editImage()') });
    expect(mockImagesCreateVariation).not.toHaveBeenCalled();
    expect(mockImagesEdit).not.toHaveBeenCalled();
  });

  it('the public facade rejects variations with an omitted model and keeps generation/editing usable', async () => {
    Connector.create({ name: 'images', vendor: Vendor.OpenAI, auth: { type: 'api_key', apiKey: 'test-key' } });
    const images = ImageGeneration.create({ connector: 'images' });
    await expect(images.createVariation({ image: '/missing-source.png' } as ImageVariationOptions))
      .rejects.toBeInstanceOf(ProviderError);
    expect(mockImagesCreateVariation).not.toHaveBeenCalled();
    await expect(images.generate({ prompt: 'A landscape' })).resolves.toMatchObject({ data: [{ b64_json: 'AA==' }] });
    await expect(images.edit({ image: Buffer.from('image'), prompt: 'Add clouds' })).resolves.toMatchObject({ created: 1 });
    expect(mockImagesGenerate).toHaveBeenCalledWith(expect.objectContaining({ model: 'gpt-image-2.5-sunburst' }));
    expect(mockImagesEdit).toHaveBeenCalledWith(expect.objectContaining({ model: 'gpt-image-2.5-sunburst' }));
  });

  it('edit preserves the exact image and mask bytes and the GPT Image response contract', async () => {
    const payload = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]);
    const mask = Buffer.from([0x00, 0xff, 0x42]);
    await provider.editImage({ image: payload, mask, prompt: 'Add a circle', model: 'gpt-image-2.5-sunburst' });
    const params = mockImagesEdit.mock.calls[0][0];
    for (const [key, bytes] of [['image', payload], ['mask', mask]] as const) {
      expect(params[key]).toBeInstanceOf(File);
      expect(params[key].size).toBe(bytes.length);
      expect(Buffer.from(await params[key].arrayBuffer())).toEqual(bytes);
    }
    expect(params).not.toHaveProperty('response_format');
  });

  it('lists callable registry models, including the current default', async () => {
    const models = await provider.listModels();
    expect(models).toEqual(getImageModelsByVendor(Vendor.OpenAI).map((model) => model.name));
    expect(models).toContain('gpt-image-2.5-sunburst');
    expect(models).not.toContain('dall-e-2');
    expect(models).not.toContain('dall-e-3');
  });
});
