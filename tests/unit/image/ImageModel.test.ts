/**
 * Unit tests for Image Model Registry
 */

import { describe, it, expect } from 'vitest';
import {
  IMAGE_MODEL_REGISTRY,
  getImageModelInfo,
  getImageModelsByVendor,
  getActiveImageModels,
  getImageModelsWithFeature,
  calculateImageCost,
  IMAGE_MODELS,
} from '../../../src/domain/entities/ImageModel.js';
import { Vendor } from '../../../src/core/Vendor.js';

describe('ImageModel Registry', () => {
  describe('Registry structure', () => {
    it('should have all declared OpenAI models', () => {
      expect(IMAGE_MODEL_REGISTRY['gpt-image-1']).toBeDefined();
      expect(IMAGE_MODEL_REGISTRY['dall-e-3']).toBeDefined();
      expect(IMAGE_MODEL_REGISTRY['dall-e-2']).toBeDefined();
    });

    it('should have all declared Google models', () => {
      expect(IMAGE_MODEL_REGISTRY['imagen-4.0-generate-001']).toBeDefined();
      expect(IMAGE_MODEL_REGISTRY['imagen-4.0-ultra-generate-001']).toBeDefined();
      expect(IMAGE_MODEL_REGISTRY['imagen-4.0-fast-generate-001']).toBeDefined();
      // Nano Banana (Gemini native image) models
      expect(IMAGE_MODEL_REGISTRY['gemini-3.1-flash-image-preview']).toBeDefined();
      expect(IMAGE_MODEL_REGISTRY['gemini-3-pro-image-preview']).toBeDefined();
      expect(IMAGE_MODEL_REGISTRY['gemini-2.5-flash-image']).toBeDefined();
    });

    it('should have all declared Grok models', () => {
      expect(IMAGE_MODEL_REGISTRY['grok-imagine-image']).toBeDefined();
      expect(IMAGE_MODEL_REGISTRY['grok-2-image-1212']).toBeDefined();
    });

    it('should have consistent structure', () => {
      const model = IMAGE_MODEL_REGISTRY['dall-e-3'];
      expect(model).toHaveProperty('name');
      expect(model).toHaveProperty('displayName');
      expect(model).toHaveProperty('provider');
      expect(model).toHaveProperty('isActive');
      expect(model).toHaveProperty('sources');
      expect(model).toHaveProperty('capabilities');
      expect(model.sources).toHaveProperty('lastVerified');
    });

    it('should have valid capabilities', () => {
      const model = IMAGE_MODEL_REGISTRY['dall-e-3'];
      expect(model.capabilities).toHaveProperty('sizes');
      expect(model.capabilities).toHaveProperty('maxImagesPerRequest');
      expect(model.capabilities).toHaveProperty('outputFormats');
      expect(model.capabilities).toHaveProperty('features');
      expect(model.capabilities).toHaveProperty('limits');
    });
  });

  describe('getImageModelInfo', () => {
    it('should return model info for valid model', () => {
      const model = getImageModelInfo('dall-e-3');
      expect(model).toBeDefined();
      expect(model?.name).toBe('dall-e-3');
    });

    it('should return undefined for unknown model', () => {
      const model = getImageModelInfo('unknown-model');
      expect(model).toBeUndefined();
    });
  });

  describe('getImageModelsByVendor', () => {
    it('should return OpenAI models', () => {
      const models = getImageModelsByVendor(Vendor.OpenAI);
      expect(models.length).toBeGreaterThan(0);
      expect(models.every((m) => m.provider === Vendor.OpenAI)).toBe(true);
      expect(models.every((m) => m.isActive)).toBe(true);
    });

    it('should return Google models', () => {
      const models = getImageModelsByVendor(Vendor.Google);
      expect(models.length).toBeGreaterThan(0);
      expect(models.every((m) => m.provider === Vendor.Google)).toBe(true);
    });

    it('should return Grok models', () => {
      const models = getImageModelsByVendor(Vendor.Grok);
      expect(models.length).toBeGreaterThan(0);
      expect(models.every((m) => m.provider === Vendor.Grok)).toBe(true);
    });

    it('should return empty for unsupported vendor', () => {
      const models = getImageModelsByVendor(Vendor.Anthropic);
      expect(models.length).toBe(0);
    });
  });

  describe('getActiveImageModels', () => {
    it('should return all active models', () => {
      const models = getActiveImageModels();
      expect(models.length).toBeGreaterThan(0);
      expect(models.every((m) => m.isActive)).toBe(true);
    });
  });

  describe('getImageModelsWithFeature', () => {
    it('should find models with generation support', () => {
      const models = getImageModelsWithFeature('generation');
      expect(models.length).toBeGreaterThan(0);
      expect(models.some((m) => m.name === 'gpt-image-1.5')).toBe(true);
      expect(models.some((m) => m.name === 'imagen-4.0-generate-001')).toBe(true);
    });

    it('should find models with editing support', () => {
      const models = getImageModelsWithFeature('editing');
      expect(models.length).toBeGreaterThan(0);
      expect(models.some((m) => m.name === 'gpt-image-1')).toBe(true);
      expect(models.some((m) => m.name === 'grok-imagine-image')).toBe(true);
    });

    it('should find no active models with variation support', () => {
      // dall-e-2 was the only model with variations but is now deprecated
      const models = getImageModelsWithFeature('variations');
      expect(models.length).toBe(0);
    });

    it('should find models with style control', () => {
      const models = getImageModelsWithFeature('styleControl');
      expect(models.length).toBeGreaterThan(0);
      expect(models.some((m) => m.name === 'gemini-3-pro-image-preview')).toBe(true);
    });

    it('should find models with prompt revision', () => {
      const models = getImageModelsWithFeature('promptRevision');
      expect(models.length).toBeGreaterThan(0);
      expect(models.some((m) => m.name === 'grok-imagine-image')).toBe(true);
    });
  });

  describe('calculateImageCost', () => {
    it('should calculate cost for dall-e-3 standard', () => {
      const cost = calculateImageCost('dall-e-3', 1, 'standard');
      expect(cost).toBe(0.040);
    });

    it('should calculate cost for dall-e-3 hd', () => {
      const cost = calculateImageCost('dall-e-3', 1, 'hd');
      expect(cost).toBe(0.080);
    });

    it('should calculate cost for multiple images', () => {
      const cost = calculateImageCost('dall-e-2', 5);
      expect(cost).toBe(0.100); // 5 * 0.020
    });

    it('should calculate cost for Google Imagen', () => {
      const cost = calculateImageCost('imagen-4.0-generate-001', 2);
      expect(cost).toBe(0.080); // 2 * 0.04
    });

    it('should return null for unknown model', () => {
      const cost = calculateImageCost('unknown', 1);
      expect(cost).toBeNull();
    });
  });

  describe('Model constants', () => {
    it('should have IMAGE_MODELS constants for OpenAI', () => {
      expect(IMAGE_MODELS[Vendor.OpenAI].GPT_IMAGE_1).toBe('gpt-image-1');
      expect(IMAGE_MODELS[Vendor.OpenAI].DALL_E_3).toBe('dall-e-3');
      expect(IMAGE_MODELS[Vendor.OpenAI].DALL_E_2).toBe('dall-e-2');
    });

    it('should have IMAGE_MODELS constants for Google', () => {
      expect(IMAGE_MODELS[Vendor.Google].IMAGEN_4_GENERATE).toBe('imagen-4.0-generate-001');
      expect(IMAGE_MODELS[Vendor.Google].IMAGEN_4_ULTRA).toBe('imagen-4.0-ultra-generate-001');
      expect(IMAGE_MODELS[Vendor.Google].IMAGEN_4_FAST).toBe('imagen-4.0-fast-generate-001');
      expect(IMAGE_MODELS[Vendor.Google].GEMINI_3_1_FLASH_IMAGE).toBe('gemini-3.1-flash-image-preview');
      expect(IMAGE_MODELS[Vendor.Google].GEMINI_3_PRO_IMAGE).toBe('gemini-3-pro-image-preview');
      expect(IMAGE_MODELS[Vendor.Google].GEMINI_2_5_FLASH_IMAGE).toBe('gemini-2.5-flash-image');
    });

    it('should have IMAGE_MODELS constants for Grok', () => {
      expect(IMAGE_MODELS[Vendor.Grok].GROK_IMAGINE_IMAGE).toBe('grok-imagine-image');
      expect(IMAGE_MODELS[Vendor.Grok].GROK_2_IMAGE_1212).toBe('grok-2-image-1212');
    });
  });

  describe('Model features', () => {
    it('should mark DALL-E 3 as having style control', () => {
      const model = getImageModelInfo('dall-e-3');
      expect(model?.capabilities.features.styleControl).toBe(true);
    });

    it('should mark DALL-E 3 as having prompt revision', () => {
      const model = getImageModelInfo('dall-e-3');
      expect(model?.capabilities.features.promptRevision).toBe(true);
    });

    it('should mark DALL-E 2 as supporting variations', () => {
      const model = getImageModelInfo('dall-e-2');
      expect(model?.capabilities.features.variations).toBe(true);
    });

    it('should mark gpt-image-1 as supporting transparency', () => {
      const model = getImageModelInfo('gpt-image-1');
      expect(model?.capabilities.features.transparency).toBe(true);
    });

    it('should show Google Imagen aspect ratios', () => {
      const model = getImageModelInfo('imagen-4.0-generate-001');
      expect(model?.capabilities.aspectRatios).toBeDefined();
      expect(model?.capabilities.aspectRatios).toContain('16:9');
      expect(model?.capabilities.aspectRatios).toContain('9:16');
    });

    it('should mark grok-imagine-image as supporting generation', () => {
      const model = getImageModelInfo('grok-imagine-image');
      expect(model?.capabilities.features.generation).toBe(true);
    });

    it('should mark grok-imagine-image as supporting editing', () => {
      const model = getImageModelInfo('grok-imagine-image');
      expect(model?.capabilities.features.editing).toBe(true);
    });

    it('should mark grok-imagine-image as supporting prompt revision', () => {
      const model = getImageModelInfo('grok-imagine-image');
      expect(model?.capabilities.features.promptRevision).toBe(true);
    });

    it('should show Grok image aspect ratios', () => {
      const model = getImageModelInfo('grok-imagine-image');
      expect(model?.capabilities.aspectRatios).toBeDefined();
      expect(model?.capabilities.aspectRatios).toContain('16:9');
      expect(model?.capabilities.aspectRatios).toContain('9:16');
      expect(model?.capabilities.aspectRatios).toContain('1:1');
    });

    it('should show Grok image max 10 images per request', () => {
      const model = getImageModelInfo('grok-imagine-image');
      expect(model?.capabilities.maxImagesPerRequest).toBe(10);
    });
  });

  describe('Grok image cost calculation', () => {
    it('should calculate cost for grok-imagine-image', () => {
      // Grok uses flat rate pricing, quality not supported
      const cost = calculateImageCost('grok-imagine-image', 1);
      expect(cost).toBe(0.02);
    });

    it('should calculate cost for multiple Grok images', () => {
      const cost = calculateImageCost('grok-imagine-image', 5);
      expect(cost).toBe(0.10);
    });

    it('should calculate cost for grok-2-image-1212', () => {
      const cost = calculateImageCost('grok-2-image-1212', 1);
      expect(cost).toBe(0.07);
    });

    it('should calculate cost for multiple grok-2-image-1212', () => {
      const cost = calculateImageCost('grok-2-image-1212', 3);
      expect(cost).toBeCloseTo(0.21, 2);
    });
  });

  describe('grok-2-image-1212 features', () => {
    it('should mark grok-2-image-1212 as supporting generation', () => {
      const model = getImageModelInfo('grok-2-image-1212');
      expect(model?.capabilities.features.generation).toBe(true);
    });

    it('should mark grok-2-image-1212 as NOT supporting editing', () => {
      const model = getImageModelInfo('grok-2-image-1212');
      expect(model?.capabilities.features.editing).toBe(false);
    });

    it('should mark grok-2-image-1212 as NOT supporting prompt revision', () => {
      const model = getImageModelInfo('grok-2-image-1212');
      expect(model?.capabilities.features.promptRevision).toBe(false);
    });

    it('should show Grok 2 image aspect ratios', () => {
      const model = getImageModelInfo('grok-2-image-1212');
      expect(model?.capabilities.aspectRatios).toBeDefined();
      expect(model?.capabilities.aspectRatios).toContain('16:9');
      expect(model?.capabilities.aspectRatios).toContain('9:16');
      expect(model?.capabilities.aspectRatios).toContain('1:1');
    });

    it('should show Grok 2 image max 10 images per request', () => {
      const model = getImageModelInfo('grok-2-image-1212');
      expect(model?.capabilities.maxImagesPerRequest).toBe(10);
    });
  });

  describe('Google Nano Banana (Gemini native image) models', () => {
    it('should have Nano Banana 2 (Gemini 3.1 Flash Image) with 4K support', () => {
      const model = getImageModelInfo('gemini-3.1-flash-image-preview');
      expect(model).toBeDefined();
      expect(model?.provider).toBe(Vendor.Google);
      expect(model?.capabilities.features.generation).toBe(true);
      expect(model?.capabilities.features.editing).toBe(true);
      expect(model?.capabilities.features.qualityControl).toBe(true);
    });

    it('should have Nano Banana Pro (Gemini 3 Pro Image) with reasoning', () => {
      const model = getImageModelInfo('gemini-3-pro-image-preview');
      expect(model).toBeDefined();
      expect(model?.provider).toBe(Vendor.Google);
      expect(model?.capabilities.features.generation).toBe(true);
      expect(model?.capabilities.features.editing).toBe(true);
      expect(model?.capabilities.features.styleControl).toBe(true);
    });

    it('should have Nano Banana (Gemini 2.5 Flash Image) for fast workflows', () => {
      const model = getImageModelInfo('gemini-2.5-flash-image');
      expect(model).toBeDefined();
      expect(model?.provider).toBe(Vendor.Google);
      expect(model?.capabilities.features.generation).toBe(true);
      expect(model?.capabilities.features.editing).toBe(true);
    });

    it('should calculate cost for Nano Banana Pro', () => {
      const cost = calculateImageCost('gemini-3-pro-image-preview', 1, 'standard');
      expect(cost).toBe(0.134);
    });

    it('should calculate cost for Nano Banana Pro 4K', () => {
      const cost = calculateImageCost('gemini-3-pro-image-preview', 1, 'hd');
      expect(cost).toBe(0.24);
    });

    it('should calculate cost for Nano Banana (flat rate)', () => {
      const cost = calculateImageCost('gemini-2.5-flash-image', 2);
      expect(cost).toBeCloseTo(0.078, 3); // 2 * 0.039
    });

    it('should have Imagen 4 Ultra at $0.06 per image', () => {
      const cost = calculateImageCost('imagen-4.0-ultra-generate-001', 1);
      expect(cost).toBe(0.06);
    });
  });
});
