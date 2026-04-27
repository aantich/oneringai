import { describe, it, expect } from 'vitest';
import {
  MODEL_REGISTRY,
  LLM_MODELS,
  getModelInfo,
  getModelsByVendor,
  getActiveModels,
  calculateCost,
} from '../../../../src/domain/entities/Model.js';
import { Vendor } from '../../../../src/core/Vendor.js';

describe('Model Registry', () => {
  describe('MODEL_REGISTRY', () => {
    it('should have all models', () => {
      const modelCount = Object.keys(MODEL_REGISTRY).length;
      expect(modelCount).toBe(65);
    });

    it('should have 40 OpenAI models', () => {
      const openAIModels = Object.values(MODEL_REGISTRY).filter(
        (model) => model.provider === Vendor.OpenAI
      );
      expect(openAIModels).toHaveLength(40);
    });

    it('should have 10 Anthropic models', () => {
      const anthropicModels = Object.values(MODEL_REGISTRY).filter(
        (model) => model.provider === Vendor.Anthropic
      );
      expect(anthropicModels).toHaveLength(10);
    });

    it('should have 10 Google models', () => {
      const googleModels = Object.values(MODEL_REGISTRY).filter(
        (model) => model.provider === Vendor.Google
      );
      expect(googleModels).toHaveLength(10);
    });

    it('should have 5 Grok models', () => {
      const grokModels = Object.values(MODEL_REGISTRY).filter(
        (model) => model.provider === Vendor.Grok
      );
      expect(grokModels).toHaveLength(5);
    });

    it('should have all models marked as active', () => {
      const activeCount = Object.values(MODEL_REGISTRY).filter(
        (model) => model.isActive
      ).length;
      expect(activeCount).toBe(65);
    });

    it('should have valid pricing for all models', () => {
      Object.values(MODEL_REGISTRY).forEach((model) => {
        // Open-weight models (gpt-oss-*) have cpm: 0
        expect(model.features.input.cpm).toBeGreaterThanOrEqual(0);
        expect(model.features.output.cpm).toBeGreaterThanOrEqual(0);
      });
    });

    it('should have valid context windows for all models', () => {
      Object.values(MODEL_REGISTRY).forEach((model) => {
        expect(model.features.input.tokens).toBeGreaterThan(0);
        expect(model.features.output.tokens).toBeGreaterThan(0);
      });
    });
  });

  describe('LLM_MODELS constants', () => {
    it('should have OpenAI model constants', () => {
      expect(LLM_MODELS[Vendor.OpenAI].GPT_5_2).toBe('gpt-5.2');
      expect(LLM_MODELS[Vendor.OpenAI].GPT_5_2_PRO).toBe('gpt-5.2-pro');
      expect(LLM_MODELS[Vendor.OpenAI].GPT_5_2_CODEX).toBe('gpt-5.2-codex');
      expect(LLM_MODELS[Vendor.OpenAI].GPT_5_2_CHAT).toBe('gpt-5.2-chat-latest');
      expect(LLM_MODELS[Vendor.OpenAI].GPT_5_3_CODEX).toBe('gpt-5.3-codex');
      expect(LLM_MODELS[Vendor.OpenAI].GPT_5_3_CHAT).toBe('gpt-5.3-chat-latest');
      expect(LLM_MODELS[Vendor.OpenAI].GPT_5_1).toBe('gpt-5.1');
      expect(LLM_MODELS[Vendor.OpenAI].GPT_5_1_CODEX).toBe('gpt-5.1-codex');
      expect(LLM_MODELS[Vendor.OpenAI].GPT_5_1_CODEX_MAX).toBe('gpt-5.1-codex-max');
      expect(LLM_MODELS[Vendor.OpenAI].GPT_5_1_CODEX_MINI).toBe('gpt-5.1-codex-mini');
      expect(LLM_MODELS[Vendor.OpenAI].GPT_5_1_CHAT).toBe('gpt-5.1-chat-latest');
      expect(LLM_MODELS[Vendor.OpenAI].GPT_5).toBe('gpt-5');
      expect(LLM_MODELS[Vendor.OpenAI].GPT_5_CHAT).toBe('gpt-5-chat-latest');
      expect(LLM_MODELS[Vendor.OpenAI].O3_MINI).toBe('o3-mini');
    });

    it('should have Anthropic model constants', () => {
      expect(LLM_MODELS[Vendor.Anthropic].CLAUDE_OPUS_4_7).toBe('claude-opus-4-7');
      expect(LLM_MODELS[Vendor.Anthropic].CLAUDE_OPUS_4_6).toBe('claude-opus-4-6');
      expect(LLM_MODELS[Vendor.Anthropic].CLAUDE_SONNET_4_6).toBe('claude-sonnet-4-6');
      expect(LLM_MODELS[Vendor.Anthropic].CLAUDE_OPUS_4_5).toBe(
        'claude-opus-4-5-20251101'
      );
      expect(LLM_MODELS[Vendor.Anthropic].CLAUDE_SONNET_4_5).toBe(
        'claude-sonnet-4-5-20250929'
      );
      expect(LLM_MODELS[Vendor.Anthropic].CLAUDE_HAIKU_4_5).toBe(
        'claude-haiku-4-5-20251001'
      );
      expect(LLM_MODELS[Vendor.Anthropic].CLAUDE_OPUS_4).toBe('claude-opus-4-20250514');
    });

    it('should have Google model constants', () => {
      expect(LLM_MODELS[Vendor.Google].GEMINI_3_1_PRO_PREVIEW).toBe('gemini-3.1-pro-preview');
      expect(LLM_MODELS[Vendor.Google].GEMINI_3_1_FLASH_LITE_PREVIEW).toBe('gemini-3.1-flash-lite-preview');
      expect(LLM_MODELS[Vendor.Google].GEMINI_3_1_FLASH_IMAGE_PREVIEW).toBe('gemini-3.1-flash-image-preview');
      expect(LLM_MODELS[Vendor.Google].GEMINI_3_1_FLASH_LIVE_PREVIEW).toBe('gemini-3.1-flash-live-preview');
      expect(LLM_MODELS[Vendor.Google].GEMINI_3_FLASH_PREVIEW).toBe('gemini-3-flash-preview');
      expect(LLM_MODELS[Vendor.Google].GEMINI_2_5_PRO).toBe('gemini-2.5-pro');
    });

    it('should have Grok model constants', () => {
      expect(LLM_MODELS[Vendor.Grok].GROK_4_20_0309_REASONING).toBe('grok-4.20-0309-reasoning');
      expect(LLM_MODELS[Vendor.Grok].GROK_4_20_0309_NON_REASONING).toBe('grok-4.20-0309-non-reasoning');
      expect(LLM_MODELS[Vendor.Grok].GROK_4_20_MULTI_AGENT_0309).toBe('grok-4.20-multi-agent-0309');
      expect(LLM_MODELS[Vendor.Grok].GROK_4_1_FAST_REASONING).toBe('grok-4-1-fast-reasoning');
      expect(LLM_MODELS[Vendor.Grok].GROK_4_1_FAST_NON_REASONING).toBe('grok-4-1-fast-non-reasoning');
    });

    it('should have all model constants registered in MODEL_REGISTRY', () => {
      const openAIModels = Object.values(LLM_MODELS[Vendor.OpenAI]);
      const anthropicModels = Object.values(LLM_MODELS[Vendor.Anthropic]);
      const googleModels = Object.values(LLM_MODELS[Vendor.Google]);
      const grokModels = Object.values(LLM_MODELS[Vendor.Grok]);

      openAIModels.forEach((modelName) => {
        expect(MODEL_REGISTRY[modelName]).toBeDefined();
      });

      anthropicModels.forEach((modelName) => {
        expect(MODEL_REGISTRY[modelName]).toBeDefined();
      });

      googleModels.forEach((modelName) => {
        expect(MODEL_REGISTRY[modelName]).toBeDefined();
      });

      grokModels.forEach((modelName) => {
        expect(MODEL_REGISTRY[modelName]).toBeDefined();
      });
    });
  });

  describe('getModelInfo()', () => {
    it('should return model info for valid model name', () => {
      const model = getModelInfo('gpt-5.2');
      expect(model).toBeDefined();
      expect(model?.name).toBe('gpt-5.2');
      expect(model?.provider).toBe(Vendor.OpenAI);
    });

    it('should return undefined for invalid model name', () => {
      const model = getModelInfo('invalid-model-name');
      expect(model).toBeUndefined();
    });

    it('should return correct pricing for GPT-5.2 with cached pricing', () => {
      const model = getModelInfo('gpt-5.2');
      expect(model?.features.input.cpm).toBe(1.75);
      expect(model?.features.output.cpm).toBe(14);
      expect(model?.features.input.cpmCached).toBe(0.175);
    });

    it('should return correct pricing for Claude Opus 4.5', () => {
      const model = getModelInfo('claude-opus-4-5-20251101');
      expect(model?.features.input.cpm).toBe(5);
      expect(model?.features.output.cpm).toBe(25);
      expect(model?.features.input.cpmCached).toBe(0.5);
    });

    it('should return correct context window for Gemini 3 Flash', () => {
      const model = getModelInfo('gemini-3-flash-preview');
      expect(model?.features.input.tokens).toBe(1048576);
      expect(model?.features.output.tokens).toBe(65536);
    });
  });

  describe('getModelsByVendor()', () => {
    it('should filter models by OpenAI vendor', () => {
      const models = getModelsByVendor(Vendor.OpenAI);
      expect(models).toHaveLength(40);
      expect(models.every((m) => m.provider === Vendor.OpenAI)).toBe(true);
    });

    it('should filter models by Anthropic vendor', () => {
      const models = getModelsByVendor(Vendor.Anthropic);
      expect(models).toHaveLength(10);
      expect(models.every((m) => m.provider === Vendor.Anthropic)).toBe(true);
    });

    it('should filter models by Google vendor', () => {
      const models = getModelsByVendor(Vendor.Google);
      expect(models).toHaveLength(10);
      expect(models.every((m) => m.provider === Vendor.Google)).toBe(true);
    });

    it('should filter models by Grok vendor', () => {
      const models = getModelsByVendor(Vendor.Grok);
      expect(models).toHaveLength(5);
      expect(models.every((m) => m.provider === Vendor.Grok)).toBe(true);
    });

    it('should return empty array for vendor with no models', () => {
      const models = getModelsByVendor(Vendor.Ollama);
      expect(models).toHaveLength(0);
    });

    it('should include all expected OpenAI models', () => {
      const models = getModelsByVendor(Vendor.OpenAI);
      const modelNames = models.map((m) => m.name);

      expect(modelNames).toContain('gpt-5.3-codex');
      expect(modelNames).toContain('gpt-5.3-chat-latest');
      expect(modelNames).toContain('gpt-5.2');
      expect(modelNames).toContain('gpt-5.2-pro');
      expect(modelNames).toContain('gpt-5.2-codex');
      expect(modelNames).toContain('gpt-5.2-chat-latest');
      expect(modelNames).toContain('gpt-5.1');
      expect(modelNames).toContain('gpt-5.1-codex');
      expect(modelNames).toContain('gpt-5.1-codex-max');
      expect(modelNames).toContain('gpt-5.1-codex-mini');
      expect(modelNames).toContain('gpt-5.1-chat-latest');
      expect(modelNames).toContain('gpt-5');
      expect(modelNames).toContain('gpt-5-mini');
      expect(modelNames).toContain('gpt-5-nano');
      expect(modelNames).toContain('gpt-5-chat-latest');
      expect(modelNames).toContain('gpt-4.1');
      expect(modelNames).toContain('gpt-4.1-mini');
      expect(modelNames).toContain('gpt-4.1-nano');
      expect(modelNames).toContain('gpt-4o');
      expect(modelNames).toContain('gpt-4o-mini');
      expect(modelNames).toContain('o3-mini');
      expect(modelNames).toContain('o1');
    });
  });

  describe('getActiveModels()', () => {
    it('should return all active models', () => {
      const models = getActiveModels();
      expect(models).toHaveLength(65);
      expect(models.every((m) => m.isActive)).toBe(true);
    });

    it('should include models from all vendors', () => {
      const models = getActiveModels();
      const providers = new Set(models.map((m) => m.provider));

      expect(providers.has(Vendor.OpenAI)).toBe(true);
      expect(providers.has(Vendor.Anthropic)).toBe(true);
      expect(providers.has(Vendor.Google)).toBe(true);
      expect(providers.has(Vendor.Grok)).toBe(true);
    });
  });

  describe('calculateCost()', () => {
    it('should calculate cost correctly for GPT-5.2', () => {
      // $1.75/M input + $14/M output
      const cost = calculateCost('gpt-5.2', 1_000_000, 1_000_000);
      expect(cost).toBe(15.75);
    });

    it('should calculate cost correctly for small token counts', () => {
      // 50K input tokens = $0.0875, 2K output tokens = $0.028
      const cost = calculateCost('gpt-5.2', 50_000, 2_000);
      expect(cost).toBeCloseTo(0.1155, 4);
    });

    it('should calculate cost with cache discount for GPT-5.2', () => {
      // gpt-5.2 now has cached pricing: $0.175/M cached + $14/M output
      const cost = calculateCost('gpt-5.2', 1_000_000, 1_000_000, {
        useCachedInput: true,
      });
      expect(cost).toBe(14.175);
    });

    it('should calculate cost correctly for Claude Opus 4.5', () => {
      // $5/M input + $25/M output
      const cost = calculateCost('claude-opus-4-5-20251101', 1_000_000, 1_000_000);
      expect(cost).toBe(30);
    });

    it('should calculate cost with cache for Claude models', () => {
      // $0.5/M cached + $25/M output
      const cost = calculateCost('claude-opus-4-5-20251101', 1_000_000, 1_000_000, {
        useCachedInput: true,
      });
      expect(cost).toBe(25.5);
    });

    it('should calculate cost correctly for Gemini 2.5 Flash', () => {
      // $0.30/M input + $2.50/M output
      const cost = calculateCost('gemini-2.5-flash', 1_000_000, 1_000_000);
      expect(cost).toBeCloseTo(2.80, 2);
    });

    it('should calculate cost for very cheap models (GPT-5-nano)', () => {
      // $0.05/M input + $0.4/M output
      const cost = calculateCost('gpt-5-nano', 1_000_000, 1_000_000);
      expect(cost).toBeCloseTo(0.45, 2);
    });

    it('should calculate cost for expensive models (GPT-5.2-pro)', () => {
      // $21/M input + $168/M output
      const cost = calculateCost('gpt-5.2-pro', 1_000_000, 1_000_000);
      expect(cost).toBe(189);
    });

    it('should return null for invalid model', () => {
      const cost = calculateCost('invalid-model', 1_000_000, 1_000_000);
      expect(cost).toBeNull();
    });

    it('should handle zero tokens', () => {
      const cost = calculateCost('gpt-5.2', 0, 0);
      expect(cost).toBe(0);
    });

    it('should calculate cost accurately for fractional tokens', () => {
      // 123 input tokens, 456 output tokens
      const cost = calculateCost('gpt-5.2', 123, 456);
      const expectedCost = (123 / 1_000_000) * 1.75 + (456 / 1_000_000) * 14;
      expect(cost).toBeCloseTo(expectedCost, 6);
    });

    it('should use cached pricing for o3-mini when available', () => {
      // o3-mini now has cached pricing: $0.55/M cached + $4.4/M output
      const cost = calculateCost('o3-mini', 1_000_000, 1_000_000, {
        useCachedInput: true,
      });
      expect(cost).toBeCloseTo(4.95, 2);
    });
  });

  describe('Model data accuracy', () => {
    it('should have correct GPT-5.2 series pricing', () => {
      const gpt52 = getModelInfo('gpt-5.2');
      const pro = getModelInfo('gpt-5.2-pro');

      expect(gpt52?.features.input.cpm).toBe(1.75);
      expect(pro?.features.input.cpm).toBe(21);

      expect(gpt52?.features.output.cpm).toBe(14);
      expect(pro?.features.output.cpm).toBe(168);
    });

    it('should have correct Claude 4.5 series pricing', () => {
      const opus = getModelInfo('claude-opus-4-5-20251101');
      const sonnet = getModelInfo('claude-sonnet-4-5-20250929');
      const haiku = getModelInfo('claude-haiku-4-5-20251001');

      expect(opus?.features.input.cpm).toBe(5);
      expect(sonnet?.features.input.cpm).toBe(3);
      expect(haiku?.features.input.cpm).toBe(1);

      expect(opus?.features.output.cpm).toBe(25);
      expect(sonnet?.features.output.cpm).toBe(15);
      expect(haiku?.features.output.cpm).toBe(5);
    });

    it('should have correct Gemini 3 Flash preview pricing', () => {
      const flash = getModelInfo('gemini-3-flash-preview');
      expect(flash?.features.input.cpm).toBe(0.50);
      expect(flash?.features.output.cpm).toBe(3.00);
      expect(flash?.features.input.cpmCached).toBe(0.05);
    });

    it('should have reasoning flag for appropriate models', () => {
      const gpt52 = getModelInfo('gpt-5.2');
      const o3mini = getModelInfo('o3-mini');
      const gemini3Flash = getModelInfo('gemini-3-flash-preview');

      expect(gpt52?.features.reasoning).toBe(true);
      expect(o3mini?.features.reasoning).toBe(true);
      expect(gemini3Flash?.features.reasoning).toBe(true);
    });

    it('should have extended thinking for Claude 4.5 models', () => {
      const opus = getModelInfo('claude-opus-4-5-20251101');
      const sonnet = getModelInfo('claude-sonnet-4-5-20250929');
      const haiku = getModelInfo('claude-haiku-4-5-20251001');

      expect(opus?.features.extendedThinking).toBe(true);
      expect(sonnet?.features.extendedThinking).toBe(true);
      expect(haiku?.features.extendedThinking).toBe(true);
    });

    it('should have vision support for modern models', () => {
      const gpt52 = getModelInfo('gpt-5.2');
      const claude = getModelInfo('claude-opus-4-5-20251101');
      const gemini = getModelInfo('gemini-3-flash-preview');

      expect(gpt52?.features.vision).toBe(true);
      expect(claude?.features.vision).toBe(true);
      expect(gemini?.features.vision).toBe(true);
    });

    it('should have correct context windows', () => {
      const gpt52 = getModelInfo('gpt-5.2');
      const claude = getModelInfo('claude-opus-4-5-20251101');
      const gemini = getModelInfo('gemini-3-flash-preview');

      expect(gpt52?.features.input.tokens).toBe(400000);
      expect(claude?.features.input.tokens).toBe(200000);
      expect(gemini?.features.input.tokens).toBe(1048576);
    });

    it('should have preferred flag on recommended models', () => {
      const gpt55 = getModelInfo('gpt-5.5');
      const gpt54 = getModelInfo('gpt-5.4');
      const gpt52 = getModelInfo('gpt-5.2');
      const gpt5 = getModelInfo('gpt-5');
      const opus47 = getModelInfo('claude-opus-4-7');
      const opus46 = getModelInfo('claude-opus-4-6');
      const sonnet46 = getModelInfo('claude-sonnet-4-6');

      expect(gpt55?.preferred).toBe(true);
      expect(gpt54?.preferred).toBeUndefined();
      expect(gpt52?.preferred).toBeUndefined();
      expect(gpt5?.preferred).toBeUndefined();
      expect(opus47?.preferred).toBe(true);
      expect(opus46?.preferred).toBeUndefined();
      expect(sonnet46?.preferred).toBe(true);
    });

    it('should have correct Claude 4.6 series data', () => {
      const opus = getModelInfo('claude-opus-4-6');
      const sonnet = getModelInfo('claude-sonnet-4-6');

      expect(opus?.features.input.cpm).toBe(5);
      expect(opus?.features.output.cpm).toBe(25);
      expect(opus?.features.input.cpmCached).toBe(0.5);
      expect(opus?.features.output.tokens).toBe(128000);
      expect(opus?.knowledgeCutoff).toBe('2025-05-01');
      expect(opus?.features.extendedThinking).toBe(true);

      expect(sonnet?.features.input.cpm).toBe(3);
      expect(sonnet?.features.output.cpm).toBe(15);
      expect(sonnet?.features.input.cpmCached).toBe(0.3);
      expect(sonnet?.features.output.tokens).toBe(64000);
      expect(sonnet?.knowledgeCutoff).toBe('2025-08-01');
    });

    it('should have Claude Opus 4 in registry', () => {
      const opus4 = getModelInfo('claude-opus-4-20250514');
      expect(opus4).toBeDefined();
      expect(opus4?.features.input.cpm).toBe(15);
      expect(opus4?.features.output.cpm).toBe(75);
      expect(opus4?.features.output.tokens).toBe(32000);
      expect(opus4?.knowledgeCutoff).toBe('2025-01-01');
    });

    it('should have correct knowledge cutoffs for GPT-4.1 series', () => {
      expect(getModelInfo('gpt-4.1')?.knowledgeCutoff).toBe('2024-06-01');
      expect(getModelInfo('gpt-4.1-mini')?.knowledgeCutoff).toBe('2024-06-01');
      expect(getModelInfo('gpt-4.1-nano')?.knowledgeCutoff).toBe('2024-06-01');
    });

    it('should have correct knowledge cutoffs for legacy models', () => {
      expect(getModelInfo('gpt-4o')?.knowledgeCutoff).toBe('2023-10-01');
      expect(getModelInfo('gpt-4o-mini')?.knowledgeCutoff).toBe('2023-10-01');
      expect(getModelInfo('o3-mini')?.knowledgeCutoff).toBe('2023-10-01');
      expect(getModelInfo('o1')?.knowledgeCutoff).toBe('2023-10-01');
    });

    it('should not have audio on gpt-4o and gpt-4o-mini', () => {
      const gpt4o = getModelInfo('gpt-4o');
      const gpt4oMini = getModelInfo('gpt-4o-mini');

      expect(gpt4o?.features.audio).toBe(false);
      expect(gpt4o?.features.input.audio).toBeUndefined();
      expect(gpt4o?.features.output.audio).toBeUndefined();

      expect(gpt4oMini?.features.audio).toBe(false);
      expect(gpt4oMini?.features.input.audio).toBeUndefined();
      expect(gpt4oMini?.features.output.audio).toBeUndefined();
    });

    it('should not have vision on o3-mini', () => {
      const o3mini = getModelInfo('o3-mini');
      expect(o3mini?.features.vision).toBe(false);
      expect(o3mini?.features.input.image).toBeUndefined();
    });

    it('should have structuredOutput false on gpt-5.2-pro', () => {
      const pro = getModelInfo('gpt-5.2-pro');
      expect(pro?.features.structuredOutput).toBe(false);
    });

    it('should have cached pricing on GPT-4.1 series', () => {
      expect(getModelInfo('gpt-4.1')?.features.input.cpmCached).toBe(0.50);
      expect(getModelInfo('gpt-4.1-mini')?.features.input.cpmCached).toBe(0.10);
      expect(getModelInfo('gpt-4.1-nano')?.features.input.cpmCached).toBe(0.025);
    });

    it('should have cached pricing on GPT-5.1 codex series', () => {
      expect(getModelInfo('gpt-5.1')?.features.input.cpmCached).toBe(0.125);
      expect(getModelInfo('gpt-5.1-codex')?.features.input.cpmCached).toBe(0.125);
      expect(getModelInfo('gpt-5.1-codex-mini')?.features.input.cpmCached).toBe(0.025);
    });
  });
});
