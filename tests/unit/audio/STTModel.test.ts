/**
 * Unit tests for STT Model Registry
 */

import { describe, it, expect } from 'vitest';
import {
  STT_MODEL_REGISTRY,
  getSTTModelInfo,
  getSTTModelsByVendor,
  getActiveSTTModels,
  getSTTModelsWithFeature,
  calculateSTTCost,
  STT_MODELS,
} from '../../../src/domain/entities/STTModel.js';
import { Vendor } from '../../../src/core/Vendor.js';

describe('STTModel Registry', () => {
  describe('Registry structure', () => {
    it('should have all declared models', () => {
      expect(STT_MODEL_REGISTRY['whisper-1']).toBeDefined();
      expect(STT_MODEL_REGISTRY['gpt-4o-transcribe']).toBeDefined();
      expect(STT_MODEL_REGISTRY['gpt-4o-transcribe-diarize']).toBeDefined();
      expect(STT_MODEL_REGISTRY['gpt-realtime-whisper']).toBeDefined();
      expect(STT_MODEL_REGISTRY['gpt-live-transcribe']).toBeDefined();
      expect(STT_MODEL_REGISTRY['whisper-large-v3']).toBeDefined();
    });

    it('should have consistent structure', () => {
      const model = STT_MODEL_REGISTRY['whisper-1'];
      expect(model).toHaveProperty('name');
      expect(model).toHaveProperty('displayName');
      expect(model).toHaveProperty('provider');
      expect(model).toHaveProperty('isActive');
      expect(model).toHaveProperty('sources');
      expect(model).toHaveProperty('capabilities');
      expect(model.sources).toHaveProperty('lastVerified');
    });

    it('should have valid capabilities', () => {
      const model = STT_MODEL_REGISTRY['whisper-1'];
      expect(model.capabilities).toHaveProperty('inputFormats');
      expect(model.capabilities).toHaveProperty('outputFormats');
      expect(model.capabilities).toHaveProperty('languages');
      expect(model.capabilities).toHaveProperty('timestamps');
      expect(model.capabilities).toHaveProperty('features');
      expect(model.capabilities).toHaveProperty('limits');
    });
  });

  describe('getSTTModelInfo', () => {
    it('should return model info for valid model', () => {
      const model = getSTTModelInfo('whisper-1');
      expect(model).toBeDefined();
      expect(model?.name).toBe('whisper-1');
    });

    it('should return undefined for unknown model', () => {
      const model = getSTTModelInfo('unknown-model');
      expect(model).toBeUndefined();
    });

    it('keeps the legacy xai-stt endpoint distinct from Grok Voice Transcribe 2.0', () => {
      expect(getSTTModelInfo('xai-stt')?.name).toBe('xai-stt');
      expect(getSTTModelInfo('grok-voice-transcribe-2.0')).toMatchObject({
        name: 'grok-voice-transcribe-2.0',
        releaseDate: '2026-09-17',
      });
      expect(getSTTModelInfo('grok-voice-transcribe-2.0')?.aliases).toBeUndefined();
    });
  });

  describe('getSTTModelsByVendor', () => {
    it('should return OpenAI models', () => {
      const models = getSTTModelsByVendor(Vendor.OpenAI);
      expect(models.length).toBeGreaterThan(0);
      expect(models.every((m) => m.provider === Vendor.OpenAI)).toBe(true);
      expect(models.every((m) => m.isActive)).toBe(true);
    });

    it('should return Groq models', () => {
      const models = getSTTModelsByVendor(Vendor.Groq);
      expect(models.length).toBeGreaterThan(0);
      expect(models.every((m) => m.provider === Vendor.Groq)).toBe(true);
    });

    it('should return empty for unsupported vendor', () => {
      const models = getSTTModelsByVendor(Vendor.Anthropic);
      expect(models.length).toBe(0);
    });
  });

  describe('getActiveSTTModels', () => {
    it('should return all active models', () => {
      const models = getActiveSTTModels();
      expect(models.length).toBeGreaterThan(0);
      expect(models.every((m) => m.isActive)).toBe(true);
    });
  });

  describe('getSTTModelsWithFeature', () => {
    it('should find models with translation', () => {
      const models = getSTTModelsWithFeature('translation');
      expect(models.length).toBeGreaterThan(0);
      expect(models.every((m) => m.capabilities.features.translation)).toBe(true);
    });

    it('should find models with diarization', () => {
      const models = getSTTModelsWithFeature('diarization');
      expect(models.length).toBeGreaterThan(0);
      expect(models.some((m) => m.name === 'gpt-4o-transcribe-diarize')).toBe(true);
    });

    it('should find models with streaming', () => {
      const models = getSTTModelsWithFeature('streaming');
      expect(models.map((model) => model.name)).toContain('gpt-realtime-whisper');
      expect(models.map((model) => model.name)).toContain('gpt-live-transcribe');
    });

    it('should find models with punctuation', () => {
      const models = getSTTModelsWithFeature('punctuation');
      expect(models.length).toBeGreaterThan(0);
    });
  });

  describe('calculateSTTCost', () => {
    it('should calculate cost for whisper-1', () => {
      const cost = calculateSTTCost('whisper-1', 60); // 1 minute
      expect(cost).toBe(0.006);
    });

    it('should calculate cost for gpt-4o-transcribe-diarize', () => {
      const cost = calculateSTTCost('gpt-4o-transcribe-diarize', 60);
      expect(cost).toBe(0.012); // 2x cost for diarization
    });

    it('should calculate cost for Groq (ultra cheap)', () => {
      const cost = calculateSTTCost('whisper-large-v3', 60);
      expect(cost).toBe(0.00185);
    });

    it('should calculate cost for partial minutes', () => {
      const cost = calculateSTTCost('whisper-1', 30); // 30 seconds
      expect(cost).toBe(0.003);
    });

    it('should return null for model without pricing', () => {
      // If we add a model without pricing in the future
      const cost = calculateSTTCost('unknown', 60);
      expect(cost).toBeNull();
    });

    it('uses xAI streaming pricing when requested', () => {
      expect(calculateSTTCost('xai-stt', 60)).toBeCloseTo(0.0016666667);
      expect(calculateSTTCost('xai-stt', 60, { streaming: true })).toBeCloseTo(0.0033333333);
    });
  });

  describe('Model constants', () => {
    it('should have STT_MODELS constants', () => {
      expect(STT_MODELS[Vendor.OpenAI].WHISPER_1).toBe('whisper-1');
      expect(STT_MODELS[Vendor.OpenAI].GPT_4O_TRANSCRIBE).toBe('gpt-4o-transcribe');
      expect(STT_MODELS[Vendor.OpenAI].GPT_REALTIME_WHISPER).toBe('gpt-realtime-whisper');
      expect(STT_MODELS[Vendor.OpenAI].GPT_LIVE_TRANSCRIBE).toBe('gpt-live-transcribe');
      expect(STT_MODELS[Vendor.Groq].WHISPER_LARGE_V3).toBe('whisper-large-v3');
      expect(STT_MODELS[Vendor.Groq].WHISPER_LARGE_V3_TURBO).toBe('whisper-large-v3-turbo');
      expect(STT_MODELS[Vendor.Google].GEMINI_3_5_TRANSCRIBE).toBe('gemini-3.5-transcribe');
    });
  });

  describe('Capability presets (DRY)', () => {
    it('should share base capabilities across Whisper models', () => {
      const whisper1 = getSTTModelInfo('whisper-1');
      const gpt4o = getSTTModelInfo('gpt-4o-transcribe');

      // Both should support same output formats (from WHISPER_BASE_CAPABILITIES)
      expect(whisper1?.capabilities.outputFormats).toEqual(
        expect.arrayContaining(['json', 'text', 'srt', 'vtt', 'verbose_json'])
      );
      expect(gpt4o?.capabilities.outputFormats).toEqual(
        expect.arrayContaining(['json', 'text', 'srt', 'vtt', 'verbose_json'])
      );

      // Both should support timestamps
      expect(whisper1?.capabilities.timestamps.supported).toBe(true);
      expect(gpt4o?.capabilities.timestamps.supported).toBe(true);
    });
  });

  describe('Vendor-specific options', () => {
    it('should have vendor options for diarization model', () => {
      const model = getSTTModelInfo('gpt-4o-transcribe-diarize');
      expect(model?.capabilities.vendorOptions).toBeDefined();
      expect(model?.capabilities.vendorOptions?.max_speakers).toBeDefined();
      expect(model?.capabilities.vendorOptions?.max_speakers.type).toBe('number');
      expect(model?.capabilities.vendorOptions?.max_speakers.min).toBe(2);
      expect(model?.capabilities.vendorOptions?.max_speakers.max).toBe(10);
    });

    it('describes Gemini native transcription accurately', () => {
      const model = getSTTModelInfo('gemini-3.5-transcribe');
      expect(model?.endpoints).toEqual(['interactions']);
      expect(model?.capabilities.outputFormats).toEqual(['text']);
      expect(model?.capabilities.timestamps).toEqual({ supported: true, granularities: ['word', 'segment'] });
      expect(model?.capabilities.features.diarization).toBe(true);
      expect(model?.capabilities.inputFormats).toEqual(['wav', 'mp3', 'aiff', 'aac', 'ogg', 'flac']);
    });
  });
});
