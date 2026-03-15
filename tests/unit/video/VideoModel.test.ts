/**
 * Unit tests for Video Model Registry
 */

import { describe, it, expect } from 'vitest';
import {
  VIDEO_MODEL_REGISTRY,
  getVideoModelInfo,
  getVideoModelsByVendor,
  getActiveVideoModels,
  getVideoModelsWithFeature,
  getVideoModelsWithAudio,
  calculateVideoCost,
  VIDEO_MODELS,
} from '../../../src/domain/entities/VideoModel.js';
import { Vendor } from '../../../src/core/Vendor.js';

describe('VideoModel Registry', () => {
  describe('Registry structure', () => {
    it('should have all declared OpenAI models', () => {
      expect(VIDEO_MODEL_REGISTRY['sora-2']).toBeDefined();
      expect(VIDEO_MODEL_REGISTRY['sora-2-pro']).toBeDefined();
    });

    it('should have all declared Google models', () => {
      expect(VIDEO_MODEL_REGISTRY['veo-2.0-generate-001']).toBeDefined();
      expect(VIDEO_MODEL_REGISTRY['veo-3.1-fast-generate-preview']).toBeDefined();
      expect(VIDEO_MODEL_REGISTRY['veo-3.1-generate-preview']).toBeDefined();
    });

    it('should have all declared Grok models', () => {
      expect(VIDEO_MODEL_REGISTRY['grok-imagine-video']).toBeDefined();
    });

    it('should have consistent structure', () => {
      const model = VIDEO_MODEL_REGISTRY['sora-2'];
      expect(model).toHaveProperty('name');
      expect(model).toHaveProperty('displayName');
      expect(model).toHaveProperty('provider');
      expect(model).toHaveProperty('isActive');
      expect(model).toHaveProperty('sources');
      expect(model).toHaveProperty('capabilities');
      expect(model.sources).toHaveProperty('lastVerified');
    });

    it('should have valid capabilities', () => {
      const model = VIDEO_MODEL_REGISTRY['sora-2'];
      expect(model.capabilities).toHaveProperty('durations');
      expect(model.capabilities).toHaveProperty('resolutions');
      expect(model.capabilities).toHaveProperty('maxFps');
      expect(model.capabilities).toHaveProperty('audio');
      expect(model.capabilities).toHaveProperty('imageToVideo');
      expect(model.capabilities).toHaveProperty('features');
    });
  });

  describe('getVideoModelInfo', () => {
    it('should return model info for valid model', () => {
      const model = getVideoModelInfo('sora-2');
      expect(model).toBeDefined();
      expect(model?.name).toBe('sora-2');
    });

    it('should return undefined for unknown model', () => {
      const model = getVideoModelInfo('unknown-model');
      expect(model).toBeUndefined();
    });
  });

  describe('getVideoModelsByVendor', () => {
    it('should return OpenAI models', () => {
      const models = getVideoModelsByVendor(Vendor.OpenAI);
      expect(models.length).toBeGreaterThan(0);
      expect(models.every((m) => m.provider === Vendor.OpenAI)).toBe(true);
      expect(models.every((m) => m.isActive)).toBe(true);
    });

    it('should return Google models', () => {
      const models = getVideoModelsByVendor(Vendor.Google);
      expect(models.length).toBeGreaterThan(0);
      expect(models.every((m) => m.provider === Vendor.Google)).toBe(true);
    });

    it('should return Grok models', () => {
      const models = getVideoModelsByVendor(Vendor.Grok);
      expect(models.length).toBeGreaterThan(0);
      expect(models.every((m) => m.provider === Vendor.Grok)).toBe(true);
    });

    it('should return empty for unsupported vendor', () => {
      const models = getVideoModelsByVendor(Vendor.Anthropic);
      expect(models.length).toBe(0);
    });
  });

  describe('getActiveVideoModels', () => {
    it('should return all active models', () => {
      const models = getActiveVideoModels();
      expect(models.length).toBeGreaterThan(0);
      expect(models.every((m) => m.isActive)).toBe(true);
    });
  });

  describe('getVideoModelsWithFeature', () => {
    it('should find models with upscaling support', () => {
      const models = getVideoModelsWithFeature('upscaling');
      expect(models.length).toBeGreaterThan(0);
      expect(models.some((m) => m.name === 'sora-2-pro')).toBe(true);
      expect(models.some((m) => m.name === 'veo-3.1-generate-preview')).toBe(true);
    });

    it('should find models with style control', () => {
      const models = getVideoModelsWithFeature('styleControl');
      expect(models.length).toBeGreaterThan(0);
      expect(models.some((m) => m.name === 'sora-2-pro')).toBe(true);
    });

    it('should find models with seed support', () => {
      const models = getVideoModelsWithFeature('seed');
      expect(models.length).toBeGreaterThan(0);
      // All models should support seed
      expect(models.some((m) => m.name === 'sora-2')).toBe(true);
      expect(models.some((m) => m.name === 'veo-2.0-generate-001')).toBe(true);
      expect(models.some((m) => m.name === 'grok-imagine-video')).toBe(true);
    });
  });

  describe('getVideoModelsWithAudio', () => {
    it('should find models with audio generation', () => {
      const models = getVideoModelsWithAudio();
      expect(models.length).toBeGreaterThan(0);
      expect(models.some((m) => m.name === 'sora-2')).toBe(true);
      expect(models.some((m) => m.name === 'veo-3.1-generate-preview')).toBe(true);
      expect(models.some((m) => m.name === 'grok-imagine-video')).toBe(true);
    });

    it('should not include models without audio', () => {
      const models = getVideoModelsWithAudio();
      expect(models.some((m) => m.name === 'veo-2.0-generate-001')).toBe(false);
      // Note: Veo 3.1 Fast now has audio according to updated API docs
    });
  });

  describe('calculateVideoCost', () => {
    it('should calculate cost for sora-2', () => {
      const cost = calculateVideoCost('sora-2', 8);
      expect(cost).toBe(0.80); // 8 * 0.10
    });

    it('should calculate cost for sora-2-pro', () => {
      const cost = calculateVideoCost('sora-2-pro', 12);
      expect(cost).toBeCloseTo(3.60, 2); // 12 * 0.30
    });

    it('should calculate cost for Google Veo', () => {
      const cost = calculateVideoCost('veo-3.1-generate-preview', 8);
      expect(cost).toBeCloseTo(3.20, 2); // 8 * 0.40
    });

    it('should return null for unknown model', () => {
      const cost = calculateVideoCost('unknown', 1);
      expect(cost).toBeNull();
    });
  });

  describe('Model constants', () => {
    it('should have VIDEO_MODELS constants for OpenAI', () => {
      expect(VIDEO_MODELS[Vendor.OpenAI].SORA_2).toBe('sora-2');
      expect(VIDEO_MODELS[Vendor.OpenAI].SORA_2_PRO).toBe('sora-2-pro');
    });

    it('should have VIDEO_MODELS constants for Google', () => {
      expect(VIDEO_MODELS[Vendor.Google].VEO_2).toBe('veo-2.0-generate-001');
      expect(VIDEO_MODELS[Vendor.Google].VEO_3_1_FAST).toBe('veo-3.1-fast-generate-preview');
      expect(VIDEO_MODELS[Vendor.Google].VEO_3_1).toBe('veo-3.1-generate-preview');
    });

    it('should have VIDEO_MODELS constants for Grok', () => {
      expect(VIDEO_MODELS[Vendor.Grok].GROK_IMAGINE_VIDEO).toBe('grok-imagine-video');
    });
  });

  describe('Model capabilities', () => {
    it('should have correct durations for Sora 2', () => {
      const model = getVideoModelInfo('sora-2');
      expect(model?.capabilities.durations).toContain(4);
      expect(model?.capabilities.durations).toContain(8);
      expect(model?.capabilities.durations).toContain(12);
    });

    it('should have correct resolutions for Sora 2', () => {
      const model = getVideoModelInfo('sora-2');
      expect(model?.capabilities.resolutions).toContain('1280x720');
      expect(model?.capabilities.resolutions).toContain('720x1280');
    });

    it('should mark Sora 2 as having audio', () => {
      const model = getVideoModelInfo('sora-2');
      expect(model?.capabilities.audio).toBe(true);
    });

    it('should mark Veo 3.1 as having video extension', () => {
      const model = getVideoModelInfo('veo-3.1-generate-preview');
      expect(model?.capabilities.videoExtension).toBe(true);
    });

    it('should mark Veo 3.1 Fast as having audio', () => {
      const model = getVideoModelInfo('veo-3.1-fast-generate-preview');
      expect(model?.capabilities.audio).toBe(true);
    });

    it('should mark Veo 2 as supporting frame control', () => {
      const model = getVideoModelInfo('veo-2.0-generate-001');
      expect(model?.capabilities.frameControl).toBe(true);
    });

    it('should have correct durations for Grok Imagine Video', () => {
      const model = getVideoModelInfo('grok-imagine-video');
      expect(model?.capabilities.durations).toContain(1);
      expect(model?.capabilities.durations).toContain(5);
      expect(model?.capabilities.durations).toContain(15);
    });

    it('should have correct resolutions for Grok Imagine Video', () => {
      const model = getVideoModelInfo('grok-imagine-video');
      expect(model?.capabilities.resolutions).toContain('480p');
      expect(model?.capabilities.resolutions).toContain('720p');
    });

    it('should mark Grok Imagine Video as having audio', () => {
      const model = getVideoModelInfo('grok-imagine-video');
      expect(model?.capabilities.audio).toBe(true);
    });

    it('should mark Grok Imagine Video as supporting image-to-video', () => {
      const model = getVideoModelInfo('grok-imagine-video');
      expect(model?.capabilities.imageToVideo).toBe(true);
    });

    it('should show Grok Imagine Video aspect ratios', () => {
      const model = getVideoModelInfo('grok-imagine-video');
      expect(model?.capabilities.aspectRatios).toBeDefined();
      expect(model?.capabilities.aspectRatios).toContain('16:9');
      expect(model?.capabilities.aspectRatios).toContain('9:16');
      expect(model?.capabilities.aspectRatios).toContain('1:1');
    });

    it('should mark Grok Imagine Video as supporting seed', () => {
      const model = getVideoModelInfo('grok-imagine-video');
      expect(model?.capabilities.features.seed).toBe(true);
    });
  });

  describe('Grok video cost calculation', () => {
    it('should calculate cost for grok-imagine-video', () => {
      const cost = calculateVideoCost('grok-imagine-video', 10);
      expect(cost).toBe(0.50); // 10 * 0.05
    });

    it('should calculate cost for short grok video', () => {
      const cost = calculateVideoCost('grok-imagine-video', 5);
      expect(cost).toBe(0.25); // 5 * 0.05
    });
  });
});
