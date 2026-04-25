/**
 * Integration tests for ImageGeneration (requires API keys)
 * These tests make real API calls to verify functionality
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Connector } from '../../../src/core/Connector.js';
import { ImageGeneration } from '../../../src/capabilities/images/ImageGeneration.js';
import { Vendor } from '../../../src/core/Vendor.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const XAI_API_KEY = process.env.XAI_API_KEY;
const HAS_OPENAI_KEY = Boolean(OPENAI_API_KEY);
const HAS_GOOGLE_KEY = Boolean(GOOGLE_API_KEY);
const HAS_XAI_KEY = Boolean(XAI_API_KEY);

// Skip tests if no API key
const describeIfOpenAI = HAS_OPENAI_KEY ? describe : describe.skip;
const describeIfGoogle = HAS_GOOGLE_KEY ? describe : describe.skip;
const describeIfGrok = HAS_XAI_KEY ? describe : describe.skip;

// ============================================================================
// OpenAI Image Generation Tests
// ============================================================================

describeIfOpenAI('ImageGeneration Integration (OpenAI)', () => {
  const tempFiles: string[] = [];

  beforeAll(() => {
    if (!OPENAI_API_KEY) {
      console.warn('⚠️  OPENAI_API_KEY not set, skipping OpenAI image integration tests');
      return;
    }

    Connector.create({
      name: 'openai-image-test',
      vendor: Vendor.OpenAI,
      auth: { type: 'api_key', apiKey: OPENAI_API_KEY },
    });
  });

  afterAll(async () => {
    // Cleanup temp files
    for (const file of tempFiles) {
      try {
        await fs.unlink(file);
      } catch {
        // Ignore errors
      }
    }

    try {
      Connector.clear();
    } catch {
      // Ignore if already cleared
    }
  });

  describe('Basic generation with DALL-E 3', () => {
    it('should generate an image from a prompt', async () => {
      const imageGen = ImageGeneration.create({
        connector: 'openai-image-test',
      });

      const response = await imageGen.generate({
        prompt: 'A simple red circle on a white background',
        model: 'dall-e-3',
        size: '1024x1024',
        quality: 'standard',
      });

      expect(response.created).toBeGreaterThan(0);
      expect(response.data).toHaveLength(1);
      expect(response.data[0].b64_json).toBeDefined();
      expect(response.data[0].b64_json!.length).toBeGreaterThan(1000);

      // DALL-E 3 often revises prompts
      if (response.data[0].revised_prompt) {
        expect(response.data[0].revised_prompt.length).toBeGreaterThan(0);
      }
    }, 60000); // 60s timeout for image generation

    it('should generate with vivid style', async () => {
      const imageGen = ImageGeneration.create({
        connector: 'openai-image-test',
      });

      const response = await imageGen.generate({
        prompt: 'A sunset over mountains',
        model: 'dall-e-3',
        size: '1024x1024',
        style: 'vivid',
      });

      expect(response.data).toHaveLength(1);
      expect(response.data[0].b64_json).toBeDefined();
    }, 60000);

    it('should generate with natural style', async () => {
      const imageGen = ImageGeneration.create({
        connector: 'openai-image-test',
      });

      const response = await imageGen.generate({
        prompt: 'A forest path in autumn',
        model: 'dall-e-3',
        size: '1024x1024',
        style: 'natural',
      });

      expect(response.data).toHaveLength(1);
      expect(response.data[0].b64_json).toBeDefined();
    }, 60000);
  });

  describe('DALL-E 2 generation', () => {
    it('should generate an image with DALL-E 2', async () => {
      const imageGen = ImageGeneration.create({
        connector: 'openai-image-test',
      });

      const response = await imageGen.generate({
        prompt: 'A blue square',
        model: 'dall-e-2',
        size: '512x512',
      });

      expect(response.data).toHaveLength(1);
      expect(response.data[0].b64_json).toBeDefined();
    }, 60000);

    it('should generate multiple images with DALL-E 2', async () => {
      const imageGen = ImageGeneration.create({
        connector: 'openai-image-test',
      });

      const response = await imageGen.generate({
        prompt: 'A green triangle',
        model: 'dall-e-2',
        size: '256x256',
        n: 2,
      });

      expect(response.data).toHaveLength(2);
      expect(response.data[0].b64_json).toBeDefined();
      expect(response.data[1].b64_json).toBeDefined();
    }, 60000);
  });

  describe('HD quality', () => {
    it('should generate HD quality image', async () => {
      const imageGen = ImageGeneration.create({
        connector: 'openai-image-test',
      });

      const response = await imageGen.generate({
        prompt: 'A detailed cityscape at night',
        model: 'dall-e-3',
        size: '1024x1024',
        quality: 'hd',
      });

      expect(response.data).toHaveLength(1);
      expect(response.data[0].b64_json).toBeDefined();
      // HD images should generally be larger
      expect(response.data[0].b64_json!.length).toBeGreaterThan(10000);
    }, 90000); // Longer timeout for HD
  });

  describe('Different aspect ratios', () => {
    it('should generate landscape image', async () => {
      const imageGen = ImageGeneration.create({
        connector: 'openai-image-test',
      });

      const response = await imageGen.generate({
        prompt: 'A panoramic mountain view',
        model: 'dall-e-3',
        size: '1792x1024', // Landscape
      });

      expect(response.data).toHaveLength(1);
      expect(response.data[0].b64_json).toBeDefined();
    }, 60000);

    it('should generate portrait image', async () => {
      const imageGen = ImageGeneration.create({
        connector: 'openai-image-test',
      });

      const response = await imageGen.generate({
        prompt: 'A tall waterfall',
        model: 'dall-e-3',
        size: '1024x1792', // Portrait
      });

      expect(response.data).toHaveLength(1);
      expect(response.data[0].b64_json).toBeDefined();
    }, 60000);
  });

  describe('Save to file', () => {
    it('should save generated image to file', async () => {
      const imageGen = ImageGeneration.create({
        connector: 'openai-image-test',
      });

      const response = await imageGen.generate({
        prompt: 'A simple star shape',
        model: 'dall-e-2',
        size: '256x256',
      });

      expect(response.data[0].b64_json).toBeDefined();

      // Save to file
      const outputPath = path.join(__dirname, 'test-output-openai.png');
      tempFiles.push(outputPath);

      const buffer = Buffer.from(response.data[0].b64_json!, 'base64');
      await fs.writeFile(outputPath, buffer);

      const stats = await fs.stat(outputPath);
      expect(stats.size).toBeGreaterThan(0);

      // Verify PNG header
      const fileBuffer = await fs.readFile(outputPath);
      expect(fileBuffer.slice(0, 4).toString('hex')).toBe('89504e47'); // PNG magic
    }, 60000);
  });

  describe('List models', () => {
    it('should list available models', async () => {
      const imageGen = ImageGeneration.create({
        connector: 'openai-image-test',
      });

      const models = await imageGen.listModels();

      expect(models).toContain('dall-e-3');
      expect(models).toContain('dall-e-2');
      expect(models).toContain('gpt-image-1');
    });
  });

  describe('Model info', () => {
    it('should get model info', () => {
      const imageGen = ImageGeneration.create({
        connector: 'openai-image-test',
      });

      const info = imageGen.getModelInfo('dall-e-3');

      expect(info).toBeDefined();
      expect(info?.name).toBe('dall-e-3');
      expect(info?.capabilities.features.styleControl).toBe(true);
      expect(info?.capabilities.features.promptRevision).toBe(true);
    });
  });

  describe('Image editing (DALL-E 2)', () => {
    // Note: DALL-E 2 edit requires images with alpha channel (RGBA/PNG format)
    // Generated images from DALL-E are RGB, so we skip real edit tests
    // In production, you would need to provide properly formatted RGBA images
    it.skip('should edit an image with a mask (requires RGBA image)', async () => {
      const imageGen = ImageGeneration.create({
        connector: 'openai-image-test',
      });

      // Note: This test is skipped because DALL-E 2 edit requires RGBA images
      // Generated images are RGB format which causes: "format must be in ['RGBA', 'LA', 'L'], got RGB"
      const baseResponse = await imageGen.generate({
        prompt: 'A simple white square on a light gray background',
        model: 'dall-e-2',
        size: '256x256',
      });

      expect(baseResponse.data[0].b64_json).toBeDefined();
      const imageBuffer = Buffer.from(baseResponse.data[0].b64_json!, 'base64');

      const editResponse = await imageGen.edit({
        image: imageBuffer,
        prompt: 'Add a small red circle in the center',
        model: 'dall-e-2',
        size: '256x256',
      });

      expect(editResponse.data).toHaveLength(1);
      expect(editResponse.data[0].b64_json).toBeDefined();
    }, 120000);
  });

  // DALL-E 2 is a legacy model and the variations endpoint is no longer reliably
  // available (returns 404). Skipped — we don't ship DALL-E 2 as a current option.
  describe.skip('Image variations (DALL-E 2)', () => {
    it('should create a variation of an image', async () => {
      const imageGen = ImageGeneration.create({
        connector: 'openai-image-test',
      });

      // First generate a base image
      const baseResponse = await imageGen.generate({
        prompt: 'A colorful abstract pattern',
        model: 'dall-e-2',
        size: '256x256',
      });

      expect(baseResponse.data[0].b64_json).toBeDefined();
      const imageBuffer = Buffer.from(baseResponse.data[0].b64_json!, 'base64');

      // Create a variation
      const variationResponse = await imageGen.createVariation({
        image: imageBuffer,
        model: 'dall-e-2',
        size: '256x256',
      });

      expect(variationResponse.data).toHaveLength(1);
      expect(variationResponse.data[0].b64_json).toBeDefined();
      expect(variationResponse.data[0].b64_json!.length).toBeGreaterThan(1000);
    }, 120000);

    it('should create multiple variations', async () => {
      const imageGen = ImageGeneration.create({
        connector: 'openai-image-test',
      });

      // First generate a base image
      const baseResponse = await imageGen.generate({
        prompt: 'A simple geometric shape',
        model: 'dall-e-2',
        size: '256x256',
      });

      expect(baseResponse.data[0].b64_json).toBeDefined();
      const imageBuffer = Buffer.from(baseResponse.data[0].b64_json!, 'base64');

      // Create 2 variations
      const variationResponse = await imageGen.createVariation({
        image: imageBuffer,
        model: 'dall-e-2',
        size: '256x256',
        n: 2,
      });

      expect(variationResponse.data).toHaveLength(2);
      expect(variationResponse.data[0].b64_json).toBeDefined();
      expect(variationResponse.data[1].b64_json).toBeDefined();
    }, 120000);
  });

  describe('Image editing (gpt-image-1)', () => {
    // Note: gpt-image-1 has different API requirements:
    // - Doesn't support response_format parameter (returns URLs by default)
    // - May have different image format requirements
    // This test is skipped until we can properly handle gpt-image-1 specifics
    it.skip('should edit an image with gpt-image-1 (requires URL handling)', async () => {
      const imageGen = ImageGeneration.create({
        connector: 'openai-image-test',
      });

      // First generate a base image with gpt-image-1
      const baseResponse = await imageGen.generate({
        prompt: 'A simple blue circle on white background',
        model: 'gpt-image-1',
        size: '1024x1024',
      });

      // Note: gpt-image-1 may return URL instead of b64_json
      const imageData = baseResponse.data[0].b64_json || baseResponse.data[0].url;
      expect(imageData).toBeDefined();

      // Edit would require downloading the image first if URL
      const editResponse = await imageGen.edit({
        image: Buffer.from(baseResponse.data[0].b64_json || '', 'base64'),
        prompt: 'Change the circle to red',
        model: 'gpt-image-1',
        size: '1024x1024',
      });

      expect(editResponse.data).toHaveLength(1);
    }, 180000);
  });
});

// ============================================================================
// Google Imagen Tests
// ============================================================================

describeIfGoogle('ImageGeneration Integration (Google)', () => {
  const tempFiles: string[] = [];

  beforeAll(() => {
    if (!GOOGLE_API_KEY) {
      console.warn('⚠️  GOOGLE_API_KEY not set, skipping Google image integration tests');
      return;
    }

    Connector.create({
      name: 'google-image-test',
      vendor: Vendor.Google,
      auth: { type: 'api_key', apiKey: GOOGLE_API_KEY },
    });
  });

  afterAll(async () => {
    // Cleanup temp files
    for (const file of tempFiles) {
      try {
        await fs.unlink(file);
      } catch {
        // Ignore errors
      }
    }

    try {
      Connector.clear();
    } catch {
      // Ignore if already cleared
    }
  });

  describe('Basic generation with Imagen 4.0', () => {
    it('should generate an image from a prompt', async () => {
      const imageGen = ImageGeneration.create({
        connector: 'google-image-test',
      });

      const response = await imageGen.generate({
        prompt: 'A simple red apple on a white background',
        model: 'imagen-4.0-generate-001',
      });

      expect(response.created).toBeGreaterThan(0);
      expect(response.data).toHaveLength(1);
      expect(response.data[0].b64_json).toBeDefined();
      expect(response.data[0].b64_json!.length).toBeGreaterThan(1000);
    }, 60000);

    it('should generate multiple images', async () => {
      const imageGen = ImageGeneration.create({
        connector: 'google-image-test',
      });

      const response = await imageGen.generate({
        prompt: 'A colorful butterfly',
        model: 'imagen-4.0-generate-001',
        n: 2,
      });

      expect(response.data.length).toBeGreaterThanOrEqual(1);
      expect(response.data[0].b64_json).toBeDefined();
    }, 60000);
  });

  describe('Imagen 4.0 Fast model', () => {
    it('should generate with fast model', async () => {
      const imageGen = ImageGeneration.create({
        connector: 'google-image-test',
      });

      const response = await imageGen.generate({
        prompt: 'A simple blue circle',
        model: 'imagen-4.0-fast-generate-001',
      });

      expect(response.data).toHaveLength(1);
      expect(response.data[0].b64_json).toBeDefined();
    }, 60000);
  });

  describe('Save to file', () => {
    it('should save generated image to file', async () => {
      const imageGen = ImageGeneration.create({
        connector: 'google-image-test',
      });

      const response = await imageGen.generate({
        prompt: 'A simple green square',
        model: 'imagen-4.0-fast-generate-001',
      });

      expect(response.data[0].b64_json).toBeDefined();

      // Save to file
      const outputPath = path.join(__dirname, 'test-output-google.png');
      tempFiles.push(outputPath);

      const buffer = Buffer.from(response.data[0].b64_json!, 'base64');
      await fs.writeFile(outputPath, buffer);

      const stats = await fs.stat(outputPath);
      expect(stats.size).toBeGreaterThan(0);
    }, 60000);
  });

  describe('List models', () => {
    it('should list available models', async () => {
      const imageGen = ImageGeneration.create({
        connector: 'google-image-test',
      });

      const models = await imageGen.listModels();

      expect(models).toContain('imagen-4.0-generate-001');
      expect(models).toContain('imagen-4.0-fast-generate-001');
      expect(models).toContain('imagen-4.0-ultra-generate-001');
    });
  });

  describe('Model info', () => {
    it('should get model info', () => {
      const imageGen = ImageGeneration.create({
        connector: 'google-image-test',
      });

      const info = imageGen.getModelInfo('imagen-4.0-generate-001');

      expect(info).toBeDefined();
      expect(info?.name).toBe('imagen-4.0-generate-001');
      expect(info?.capabilities.aspectRatios).toBeDefined();
      expect(info?.capabilities.aspectRatios).toContain('16:9');
    });
  });
});

// ============================================================================
// xAI Grok Image Generation Tests
// ============================================================================

describeIfGrok('ImageGeneration Integration (Grok)', () => {
  const tempFiles: string[] = [];

  beforeAll(() => {
    if (!XAI_API_KEY) {
      console.warn('⚠️  XAI_API_KEY not set, skipping Grok image integration tests');
      return;
    }

    Connector.create({
      name: 'grok-image-test',
      vendor: Vendor.Grok,
      auth: { type: 'api_key', apiKey: XAI_API_KEY },
    });
  });

  afterAll(async () => {
    // Cleanup temp files
    for (const file of tempFiles) {
      try {
        await fs.unlink(file);
      } catch {
        // Ignore errors
      }
    }

    try {
      Connector.clear();
    } catch {
      // Ignore if already cleared
    }
  });

  describe('Basic generation with Grok Imagine', () => {
    it('should generate an image from a prompt', async () => {
      const imageGen = ImageGeneration.create({
        connector: 'grok-image-test',
      });

      const response = await imageGen.generate({
        prompt: 'A simple red circle on a white background',
        model: 'grok-imagine-image',
        size: '1024x1024',
      });

      // Grok API may not return 'created' field - check for response data instead
      expect(response.data).toHaveLength(1);
      expect(response.data[0].b64_json || response.data[0].url).toBeDefined();
    }, 60000);

    it('should generate multiple images', async () => {
      const imageGen = ImageGeneration.create({
        connector: 'grok-image-test',
      });

      const response = await imageGen.generate({
        prompt: 'A colorful abstract pattern',
        model: 'grok-imagine-image',
        size: '1024x1024',
        n: 2,
      });

      expect(response.data.length).toBeGreaterThanOrEqual(1);
    }, 90000);
  });

  describe('HD quality', () => {
    it('should generate HD quality image', async () => {
      const imageGen = ImageGeneration.create({
        connector: 'grok-image-test',
      });

      const response = await imageGen.generate({
        prompt: 'A detailed cityscape at night',
        model: 'grok-imagine-image',
        size: '1024x1024',
        quality: 'hd',
      });

      expect(response.data).toHaveLength(1);
      expect(response.data[0].b64_json || response.data[0].url).toBeDefined();
    }, 90000);
  });

  describe('Different aspect ratios', () => {
    it('should generate landscape image', async () => {
      const imageGen = ImageGeneration.create({
        connector: 'grok-image-test',
      });

      const response = await imageGen.generate({
        prompt: 'A panoramic mountain view',
        model: 'grok-imagine-image',
        size: '1536x1024', // Landscape
      });

      expect(response.data).toHaveLength(1);
    }, 60000);

    it('should generate portrait image', async () => {
      const imageGen = ImageGeneration.create({
        connector: 'grok-image-test',
      });

      const response = await imageGen.generate({
        prompt: 'A tall waterfall',
        model: 'grok-imagine-image',
        size: '1024x1536', // Portrait
      });

      expect(response.data).toHaveLength(1);
    }, 60000);
  });

  describe('Save to file', () => {
    it('should save generated image to file', async () => {
      const imageGen = ImageGeneration.create({
        connector: 'grok-image-test',
      });

      const response = await imageGen.generate({
        prompt: 'A simple star shape',
        model: 'grok-imagine-image',
        size: '1024x1024',
      });

      expect(response.data[0].b64_json || response.data[0].url).toBeDefined();

      if (response.data[0].b64_json) {
        // Save to file
        const outputPath = path.join(__dirname, 'test-output-grok.png');
        tempFiles.push(outputPath);

        const buffer = Buffer.from(response.data[0].b64_json, 'base64');
        await fs.writeFile(outputPath, buffer);

        const stats = await fs.stat(outputPath);
        expect(stats.size).toBeGreaterThan(0);
      }
    }, 60000);
  });

  describe('List models', () => {
    it('should list available models', async () => {
      const imageGen = ImageGeneration.create({
        connector: 'grok-image-test',
      });

      const models = await imageGen.listModels();

      expect(models).toContain('grok-imagine-image');
      // Note: Only grok-imagine-image is registered in the model registry
    });
  });

  describe('Model info', () => {
    it('should get model info', () => {
      const imageGen = ImageGeneration.create({
        connector: 'grok-image-test',
      });

      const info = imageGen.getModelInfo('grok-imagine-image');

      expect(info).toBeDefined();
      expect(info?.name).toBe('grok-imagine-image');
      expect(info?.capabilities.features.generation).toBe(true);
      expect(info?.capabilities.features.editing).toBe(true);
      expect(info?.capabilities.maxImagesPerRequest).toBe(10);
    });
  });
});
