import { describe, expect, it, vi } from 'vitest';
import { assessModelParameters } from '../../../../src/capabilities/metadata/parameters.js';
import { Vendor } from '../../../../src/core/Vendor.js';
import { calculateCost, getActiveModels, getModelInfo, LLM_MODELS } from '../../../../src/domain/entities/Model.js';
import { GoogleConverter } from '../../../../src/infrastructure/providers/google/GoogleConverter.js';
import { GoogleInteractionsConverter } from '../../../../src/infrastructure/providers/google/GoogleInteractionsConverter.js';
import { validateOpenAIResponsesRequest } from '../../../../src/infrastructure/providers/openai/OpenAIRequestValidator.js';

const sdk = vi.hoisted(() => ({ generateContent: vi.fn(), createInteraction: vi.fn() }));
vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn(() => ({
    models: { generateContent: sdk.generateContent },
    interactions: { create: sdk.createInteraction },
  })),
}));
import { GoogleTextProvider } from '../../../../src/infrastructure/providers/google/GoogleTextProvider.js';

describe('November 23 major-vendor model registry', () => {
  it.each([
    [LLM_MODELS[Vendor.OpenAI].GPT_6_2_ASTRA, 8, 0.4, 10, 40],
    [LLM_MODELS[Vendor.OpenAI].GPT_6_2_SOL, 2, 0.1, 2.5, 10],
  ] as const)('records %s limits and prices at the 272K boundary', (model, input, cachedInput, cacheWrite, output) => {
    expect(getModelInfo(model)).toMatchObject({
      provider: Vendor.OpenAI, endpoints: ['responses', 'chat_completions', 'batch'],
      features: { input: { tokens: 922_000 }, output: { tokens: 128_000 },
        pricing: { text: { input, cachedInput, cacheWrite, output } },
        nativeTools: expect.arrayContaining(['web_search', 'computer_use', 'remote_mcp', 'tool_search']) },
    });
    expect(calculateCost(model, 272_000, 10_000)).toBeCloseTo(0.272 * input + 0.01 * output);
    expect(calculateCost(model, 272_001, 10_000)).toBeCloseTo(0.272001 * 2 * input + 0.01 * 1.5 * output);
    expect(calculateCost(model, 10_000, 10_000, { processingMode: 'ultrafast' })).toBeCloseTo(0.03 * (input + output));
    expect(calculateCost(model, 10_000, 10_000, { processingMode: 'flex' })).toBeNull();
  });

  it.each(['gpt-6.2-astra', 'gpt-6.2-sol'])('enforces %s Responses controls without blocking Fast on EU', model => {
    const options = { model };
    expect(assessModelParameters({ vendor: Vendor.OpenAI, endpoint: 'responses', model, reasoningEffort: 'none' }).reasoningEffort).toBe('unsupported');
    expect(() => validateOpenAIResponsesRequest(options, { reasoning: { effort: 'none' } })).toThrow(/does not support reasoning effort 'none'/);
    expect(() => validateOpenAIResponsesRequest(options, { top_p: 0.5 })).toThrow(/does not support top_p/);
    expect(() => validateOpenAIResponsesRequest(options, { service_tier: 'fast' }, 'https://eu.api.openai.com/v1')).not.toThrow();
  });

  it('estimates the documented Fast and Flex rates of existing models', () => {
    expect(calculateCost('claude-fable-5-2', 1_000, 1_000, { processingMode: 'fast' })).toBeCloseTo(0.096);
    expect(calculateCost('claude-mythos-5-2', 1_000, 1_000, { processingMode: 'fast' })).toBeCloseTo(0.096);
    expect(calculateCost('claude-opus-5-5', 1_000, 1_000, { processingMode: 'fast' })).toBeCloseTo(0.048);
    expect(calculateCost('gpt-5.6-sol', 1_000, 1_000, { processingMode: 'flex' })).toBeCloseTo(0.012);
    expect(calculateCost('gpt-5.6-terra', 1_000, 1_000, { processingMode: 'flex' })).toBeCloseTo(0.007);
    expect(calculateCost('gpt-5.6-luna', 1_000, 1_000, { processingMode: 'flex' })).toBeCloseTo(0.0007);
  });

  it('keeps voice and lifecycle information on the documented identifiers', () => {
    for (const model of [LLM_MODELS[Vendor.OpenAI].GPT_LIVE_1, LLM_MODELS[Vendor.OpenAI].GPT_LIVE_1_1]) {
      expect(getModelInfo(model)).toMatchObject({
        endpoints: ['live'],
        features: { realtime: false, input: { audio: true }, output: { audio: true, tokens: null }, pricing: { audioDurationPerMinute: 0.05 } },
      });
    }
    expect(getModelInfo('claude-sonnet-4-5')).toMatchObject({
      name: 'claude-sonnet-4-5-20250929', isActive: true, lifecycle: 'deprecated', retirementDate: '2026-11-30', replacementModel: 'claude-sonnet-5-5',
    });
    expect(getModelInfo('grok-build-0.1')).toMatchObject({ isActive: false, lifecycle: 'retired', retirementDate: '2026-11-19' });
    expect(getActiveModels().some(model => model.name === 'grok-build-0.1')).toBe(false);
  });

  it.each([
    [undefined, 'HIGH', 'high'], ['minimal', 'LOW', 'low'], ['xhigh', 'XHIGH', 'xhigh'],
  ] as const)('maps Gemini 4 Neon thinking effort %s on both endpoints', async (effort, generateLevel, interactionLevel) => {
    const options = { model: LLM_MODELS[Vendor.Google].GEMINI_4_NEON, input: 'Hello', thinking: { enabled: true, effort }, temperature: 0.2 };
    const generated = await new GoogleConverter().convertRequest(options);
    const interaction = await new GoogleInteractionsConverter().convertRequest(options);
    expect(generated.generationConfig.thinkingConfig).toEqual({ thinkingLevel: generateLevel });
    expect(generated.generationConfig.temperature).toBeUndefined();
    expect(interaction.generation_config).toEqual({ thinking_level: interactionLevel });
  });

  it('dispatches Gemini 4 Neon through Interactions by default', async () => {
    const model = LLM_MODELS[Vendor.Google].GEMINI_4_NEON;
    sdk.createInteraction.mockResolvedValueOnce({ id: 'int_neon', model, status: 'completed',
      steps: [{ type: 'model_output', content: [{ type: 'text', text: 'Hello' }] }] });
    const provider = new GoogleTextProvider({ apiKey: 'offline-only' });
    const response = await provider.generate({ model, input: 'Hello', thinking: { enabled: true, effort: 'xhigh' } });
    expect(sdk.generateContent).not.toHaveBeenCalled();
    expect(sdk.createInteraction).toHaveBeenCalledWith(expect.objectContaining({ model, generation_config: expect.objectContaining({ thinking_level: 'xhigh' }) }));
    expect(response.output_text).toBe('Hello');
    expect(provider.getAdvancedCapabilities(model)).toMatchObject({ structuredOutput: { nativeWithTools: true }, nativeTools: expect.arrayContaining(['file_search', 'computer_use']) });
    expect(calculateCost(model, 1_000_000, 0, { useCachedInput: true, processingMode: 'flex' })).toBeCloseTo(0.075);
  });
});
