import { describe, expect, it } from 'vitest';
import { Vendor } from '../../../../src/core/Vendor.js';
import { LLM_MODELS, MODEL_REGISTRY, calculateCost, getModelInfo } from '../../../../src/domain/entities/Model.js';
import { IMAGE_MODELS, IMAGE_MODEL_REGISTRY } from '../../../../src/domain/entities/ImageModel.js';
import { VIDEO_MODELS, VIDEO_MODEL_REGISTRY, calculateVideoCost } from '../../../../src/domain/entities/VideoModel.js';
import { TTS_MODELS, TTS_MODEL_REGISTRY } from '../../../../src/domain/entities/TTSModel.js';
import { STT_MODELS, STT_MODEL_REGISTRY } from '../../../../src/domain/entities/STTModel.js';
import { EMBEDDING_MODELS, EMBEDDING_MODEL_REGISTRY } from '../../../../src/domain/entities/EmbeddingModel.js';
import { AnthropicConverter } from '../../../../src/infrastructure/providers/anthropic/AnthropicConverter.js';
import { GoogleConverter } from '../../../../src/infrastructure/providers/google/GoogleConverter.js';
import { GoogleInteractionsConverter } from '../../../../src/infrastructure/providers/google/GoogleInteractionsConverter.js';

const auditedOn = '2026-11-11';

describe('November 2026 model catalog refresh', () => {
  it('resolves every exported model constant across all six catalogs', () => {
    for (const [constants, registry] of [
      [LLM_MODELS, MODEL_REGISTRY], [IMAGE_MODELS, IMAGE_MODEL_REGISTRY],
      [VIDEO_MODELS, VIDEO_MODEL_REGISTRY], [TTS_MODELS, TTS_MODEL_REGISTRY],
      [STT_MODELS, STT_MODEL_REGISTRY], [EMBEDDING_MODELS, EMBEDDING_MODEL_REGISTRY],
    ] as const) {
      for (const [vendor, models] of Object.entries(constants)) {
        for (const name of Object.values(models)) {
          const entry = registry[name as keyof typeof registry];
          // A constant can be an alias, e.g. grok-voice-latest.
          const resolved = entry ?? Object.values(registry).find(model => model.aliases?.includes(name));
          expect(resolved, `${vendor}/${name}`).toBeDefined();
          expect(resolved?.provider, name).toBe(vendor);
        }
      }
    }
  });

  it('does not offer a model whose announced retirement has already passed', () => {
    for (const registry of [MODEL_REGISTRY, IMAGE_MODEL_REGISTRY, VIDEO_MODEL_REGISTRY,
      TTS_MODEL_REGISTRY, STT_MODEL_REGISTRY, EMBEDDING_MODEL_REGISTRY]) {
      for (const model of Object.values(registry)) {
        if (model.retirementDate && model.retirementDate <= auditedOn) {
          expect(model.isActive, model.name).toBe(false);
          expect(model.lifecycle, model.name).toBe('retired');
        }
      }
    }
    // These stable IDs have not retired; old dates incorrectly described them.
    expect(IMAGE_MODEL_REGISTRY['gemini-3.1-flash-image'].isActive).toBe(true);
    expect(IMAGE_MODEL_REGISTRY['gemini-3.1-flash-image'].retirementDate).toBeUndefined();
    expect(IMAGE_MODEL_REGISTRY['gemini-2.5-flash-image'].retirementDate).toBe('2027-03-15');
  });

  it('keeps gated models and unknown output limits explicit', () => {
    expect(getModelInfo('gpt-6-cyber')?.availability).toBe('limited');
    expect(getModelInfo('claude-mythos-5-2')?.availability).toBe('invite_only');
    expect(getModelInfo('mistral-large-4')?.features.output.tokens).toBeNull();
    expect(getModelInfo('perplexity/sonar')?.features.input.tokens).toBeNull();
    expect(getModelInfo('qwen/qwen3.8-27b')?.lifecycle).toBe('preview');
    expect(getModelInfo('lfm3-vl')?.features.video).not.toBe(true);
  });

  it('prices new text models and the exact Haiku long-context boundary', () => {
    expect(calculateCost('gpt-6.1-terra', 1000, 1000)).toBeCloseTo(0.006);
    expect(calculateCost('claude-fable-5-2', 1000, 1000)).toBeCloseTo(0.048);
    expect(calculateCost('claude-haiku-5-5', 100_000, 10_000)).toBeCloseTo(0.015);
    expect(calculateCost('claude-haiku-5-5', 100_001, 10_000)).toBeCloseTo(0.0750005);
    expect(calculateCost('gemini-4-carbon', 1000, 1000)).toBeCloseTo(0.012);
    expect(calculateCost('gemini-4-argon', 1000, 1000)).toBeCloseTo(0.012);
    expect(calculateCost('deepseek-flash', 1000, 1000)).toBeCloseTo(0.0015);
    expect(getModelInfo('claude-sonnet-5-5')?.features.input.cpmCached).toBe(0.1);
  });

  it('moves the floating voice alias without rebinding older versioned IDs', () => {
    expect(getModelInfo('grok-voice-latest')?.name).toBe('grok-voice-3.0');
    expect(getModelInfo('grok-voice-2.0')?.replacementModel).toBe('grok-voice-3.0');
    expect(getModelInfo('grok-voice-think-fast-2.0')?.name).toBe('grok-voice-think-fast-2.0');
    expect(calculateCost('grok-voice-latest', 0, 0, { audioMinutes: 1 })).toBeCloseTo(0.08);
    expect(TTS_MODEL_REGISTRY['tts-1']).toMatchObject({
      isActive: true, lifecycle: 'deprecated', retirementDate: '2027-01-06',
      replacementModel: 'gpt-realtime-2.1-mini',
    });
    // The replacement is a Realtime model, not a Speech API model.
    expect(TTS_MODEL_REGISTRY['gpt-realtime-2.1-mini']).toBeUndefined();
  });

  it('exposes the new image controls and resolution-dependent video prices', () => {
    for (const model of ['gpt-image-2.6-sunburst', 'gpt-image-2.6-flare']) {
      expect(IMAGE_MODEL_REGISTRY[model].capabilities.vendorOptions?.complexity).toMatchObject({
        enum: ['low', 'medium', 'high'], default: 'high',
      });
      expect(IMAGE_MODEL_REGISTRY[model].endpoints).toEqual(['image_generation', 'image_edit']);
      expect(IMAGE_MODEL_REGISTRY[model].capabilities.outputFormats).toContain('svg');
    }
    expect(IMAGE_MODEL_REGISTRY['gemini-nano-banana-2.1'].pricing?.perImageStandard).toBe(0.0336);
    expect(TTS_MODEL_REGISTRY['gemini-3.8-flash-tts'].pricing).toMatchObject({ perMInputTokens: 0.5, perMOutputTokens: 9 });
    expect(VIDEO_MODEL_REGISTRY['gemini-omni-1.2-flash'].capabilities.durations).toContain(15);
    expect(calculateVideoCost('gemini-omni-1.2-flash', 10, { resolution: '720p' })).toBeCloseTo(0.69504);
    expect(calculateVideoCost('gemini-omni-1.2-flash', 10, { resolution: '4k' })).toBeCloseTo(2.08512);
    expect(EMBEDDING_MODEL_REGISTRY['gemini-embedding-2-preview']).toMatchObject({
      isActive: false, replacementModel: 'gemini-embedding-2', retirementDate: '2026-11-06',
    });
  });

  it('keeps the compatible-host provider identities separate from first-party models', () => {
    expect(getModelInfo('openai/gpt-oss-120b')?.provider).toBe(Vendor.Groq);
    expect(getModelInfo('gpt-oss-120b')?.provider).toBe(Vendor.OpenAI);
    expect(getModelInfo('moonshotai/Kimi-K3.1-Pro')?.provider).toBe(Vendor.Together);
    expect(getModelInfo('mistral-large-4')?.endpoints).toContain('chat_completions');
  });

  it('uses adaptive thinking on the new Claude models and rejects unsupported Haiku controls', () => {
    const converter = new AnthropicConverter();
    for (const model of ['claude-fable-5-2', 'claude-mythos-5-2', 'claude-haiku-5-5']) {
      const request = converter.convertRequest({ model, input: 'Hello', thinking: { enabled: true, effort: 'high' } });
      expect(request.thinking?.type, model).toBe('adaptive');
      expect(request.temperature, model).toBeUndefined();
      expect(request.max_tokens, model).toBe(128_000);
    }
    expect(() => converter.convertRequest({ model: 'claude-haiku-5-5', input: 'Hello',
      thinking: { enabled: false, mode: 'disabled', effort: 'max' } })).toThrow(/high or below/);
  });

  it.each(['gemini-4-carbon', 'gemini-4-argon'])('maps %s thinking through both Google endpoints', async model => {
    const options = { model, input: 'Hello', thinking: { enabled: true, effort: 'minimal' as const } };
    expect((await new GoogleConverter().convertRequest(options)).generationConfig?.thinkingConfig).toEqual({ thinkingLevel: 'LOW' });
    expect(((await new GoogleInteractionsConverter().convertRequest(options)).generation_config as Record<string, unknown>)?.thinking_level).toBe('low');
  });
});
