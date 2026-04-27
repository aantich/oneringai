/**
 * OpenAIImageProvider — byte-fidelity tests for the Buffer-source upload path.
 *
 * Why: `prepareImageInput` was changed from `new File([new Uint8Array(buf)], …)`
 * to `new File([buf as BlobPart], …)` to drop a redundant payload copy. We
 * mock the SDK and verify the resulting File has the right size and exact
 * bytes — so we'd catch any future "cleanup" that silently truncates or
 * mangles the upload payload.
 *
 * Live coverage of this path is currently blocked by OpenAI's deprecation of
 * `dall-e-2` createVariation (the only endpoint that took uploaded images for
 * this provider). When `gpt-image-1` edit becomes ergonomic enough to test
 * against, fold a live round-trip into the integration suite.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockImagesEdit, mockImagesCreateVariation, mockOpenAI } = vi.hoisted(() => {
  const mockImagesEdit = vi.fn();
  const mockImagesCreateVariation = vi.fn();
  const mockImagesGenerate = vi.fn();
  const mockOpenAI = vi.fn(() => ({
    images: {
      generate: mockImagesGenerate,
      edit: mockImagesEdit,
      createVariation: mockImagesCreateVariation,
    },
  }));
  return { mockImagesEdit, mockImagesCreateVariation, mockOpenAI };
});

vi.mock('openai', () => ({
  default: mockOpenAI,
}));

import { OpenAIImageProvider } from '@/infrastructure/providers/openai/OpenAIImageProvider.js';

describe('OpenAIImageProvider — Buffer→File byte fidelity', () => {
  let provider: OpenAIImageProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new OpenAIImageProvider({
      auth: { type: 'api_key', apiKey: 'test-key' },
    });
  });

  it('createVariation: File preserves length + bytes from a source Buffer', async () => {
    mockImagesCreateVariation.mockResolvedValue({
      created: 1,
      data: [{ b64_json: 'AA==' }],
    });
    const payload = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff]);

    await provider.createVariation({
      image: payload,
      model: 'dall-e-2',
      size: '256x256',
      n: 1,
    });

    const file = mockImagesCreateVariation.mock.calls[0][0].image as File;
    expect(file).toBeInstanceOf(File);
    expect(file.size).toBe(payload.length);
    expect(Buffer.compare(Buffer.from(await file.arrayBuffer()), payload)).toBe(0);
  });

  it('edit: File preserves length + bytes from a source Buffer', async () => {
    mockImagesEdit.mockResolvedValue({
      created: 1,
      data: [{ b64_json: 'AA==' }],
    });
    const payload = Buffer.from([0x42, 0x4d, 0x36, 0x00, 0x00, 0x00, 0x00, 0x00]);

    await provider.editImage({
      image: payload,
      prompt: 'add a circle',
      model: 'dall-e-2',
      size: '256x256',
    });

    const file = mockImagesEdit.mock.calls[0][0].image as File;
    expect(file).toBeInstanceOf(File);
    expect(file.size).toBe(payload.length);
    expect(Buffer.compare(Buffer.from(await file.arrayBuffer()), payload)).toBe(0);
  });
});
