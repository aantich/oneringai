import { describe, expect, it, vi } from 'vitest';
import { Vendor } from '../../../../src/core/Vendor.js';
import { calculateCost, getModelInfo, LLM_MODELS } from '../../../../src/domain/entities/Model.js';
import { calculateVideoCost, getVideoModelInfo } from '../../../../src/domain/entities/VideoModel.js';
import { GoogleConverter } from '../../../../src/infrastructure/providers/google/GoogleConverter.js';
import { GoogleInteractionsConverter } from '../../../../src/infrastructure/providers/google/GoogleInteractionsConverter.js';
import { GrokTextProvider } from '../../../../src/infrastructure/providers/grok/GrokTextProvider.js';

const sdk = vi.hoisted(() => ({ interactions: vi.fn(), generate: vi.fn() }));
vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn(() => ({
    interactions: { create: sdk.interactions },
    models: { generateContent: sdk.generate },
  })),
}));
import { GoogleTextProvider } from '../../../../src/infrastructure/providers/google/GoogleTextProvider.js';

describe('November 17 vendor model review', () => {
  it('keeps Hydrogen context, synchronous output, implicit cache pricing and modalities separate', () => {
    expect(LLM_MODELS[Vendor.Google].GEMINI_4_HYDROGEN).toBe('gemini-4-hydrogen');
    expect(getModelInfo('gemini-4-hydrogen')).toMatchObject({
      provider: Vendor.Google, releaseDate: '2026-11-12',
      features: {
        reasoningEfforts: ['low', 'medium', 'high', 'xhigh'],
        input: { tokens: 1_048_576, image: true, audio: true, video: true },
        output: { tokens: 65_536, text: true },
      },
    });
    expect(calculateCost('gemini-4-hydrogen', 1_000_000, 1_000_000)).toBe(9);
    expect(calculateCost('gemini-4-hydrogen', 1_000_000, 1_000_000, { useCachedInput: true })).toBe(7.575);
    expect(calculateCost('gemini-4-hydrogen', 1_000_000, 1_000_000, { processingMode: 'batch' })).toBe(4.5);
    expect(getModelInfo('gemini-4-hydrogen')?.features.output.audio).toBeUndefined();
  });

  it.each([
    [undefined, 'HIGH', 'high'], ['minimal', 'LOW', 'low'],
    ['medium', 'MEDIUM', 'medium'], ['xhigh', 'XHIGH', 'xhigh'], ['max', 'XHIGH', 'xhigh'],
  ] as const)('maps Hydrogen thinking effort %s across both endpoints', async (effort, generateLevel, interactionLevel) => {
    const options = { model: 'gemini-4-hydrogen', input: 'Hello', thinking: { enabled: true, effort } };
    const generate = await new GoogleConverter().convertRequest(options);
    const interaction = await new GoogleInteractionsConverter().convertRequest(options);
    expect(generate.generationConfig.thinkingConfig).toEqual({ thinkingLevel: generateLevel });
    expect((interaction.generation_config as Record<string, unknown>).thinking_level).toBe(interactionLevel);
  });

  it.each(['gemini-4-carbon', 'gemini-4-argon'])('preserves %s default and maximum reasoning levels', async model => {
    const options = { model, input: 'Hello', thinking: { enabled: true } };
    expect((await new GoogleConverter().convertRequest(options)).generationConfig.thinkingConfig).toEqual({ thinkingLevel: 'MEDIUM' });
    expect(((await new GoogleInteractionsConverter().convertRequest(options)).generation_config as Record<string, unknown>).thinking_level).toBe('medium');
    expect((await new GoogleConverter().convertRequest({ ...options, thinking: { enabled: true, effort: 'xhigh' } })).generationConfig.thinkingConfig).toEqual({ thinkingLevel: 'HIGH' });
  });

  it('omits unsupported sampling on Hydrogen without changing legacy model sampling', async () => {
    for (const converter of [new GoogleConverter(), new GoogleInteractionsConverter()]) {
      const current = await converter.convertRequest({ model: 'gemini-4-hydrogen', input: 'Hello', temperature: 0 });
      const legacy = await converter.convertRequest({ model: 'gemini-2.0-flash', input: 'Hello', temperature: 0 });
      expect(((current as Record<string, any>).generationConfig ?? (current as Record<string, any>).generation_config)?.temperature).toBeUndefined();
      expect(((legacy as Record<string, any>).generationConfig ?? (legacy as Record<string, any>).generation_config)?.temperature).toBe(0);
    }
  });

  it('routes Hydrogen through Interactions and retains xhigh in the dispatched SDK request', async () => {
    sdk.interactions.mockResolvedValueOnce({ id: 'int_hydrogen', model: 'gemini-4-hydrogen', status: 'completed',
      steps: [{ type: 'model_output', content: [{ type: 'text', text: 'Hello' }] }] });
    const provider = new GoogleTextProvider({ apiKey: 'offline-only' });
    const response = await provider.generate({ model: 'gemini-4-hydrogen', input: 'Hello', thinking: { enabled: true, effort: 'xhigh' } });
    expect(sdk.generate).not.toHaveBeenCalled();
    expect(sdk.interactions).toHaveBeenCalledWith(expect.objectContaining({ model: 'gemini-4-hydrogen', generation_config: expect.objectContaining({ thinking_level: 'xhigh' }) }));
    expect(response.output_text).toBe('Hello');
    expect(provider.getAdvancedCapabilities('gemini-4-hydrogen').structuredOutput.nativeWithTools).toBe(true);
  });

  it('keeps cloud and hosted models distinct, including paid Ollama cloud aliases', () => {
    expect(getModelInfo('thinkingmachines/Inkling-2-Small')?.provider).toBe(Vendor.Together);
    expect(getModelInfo('inkling-2-small:cloud')).toBe(getModelInfo('inkling-2-small'));
    expect(getModelInfo('inkling-2-small')?.provider).toBe(Vendor.Ollama);
    expect(calculateCost('inkling-2-small:cloud', 1_000_000, 1_000_000)).toBe(1.3);
    expect(calculateCost('thinkingmachines/Inkling-2-Small', 1_000_000, 1_000_000)).toBe(1.3);
    expect(calculateCost('elorian-labs/glimpse-1.0', 1_000_000, 1_000_000)).toBe(3.6);
    expect(calculateCost('openai/gpt-oss-20b', 1_000_000, 1_000_000)).toBe(0.375);
    expect(getModelInfo('google/gemini-4-hydrogen')?.provider).toBe(Vendor.Perplexity);
    expect(getModelInfo('google/gemini-4-hydrogen')?.features.input.tokens).toBeNull();
    expect(getModelInfo('thinkingmachines/Inkling-2-Small')?.features.output.tokens).toBeNull();
  });

  it('does not infer Together Responses support from the serverless catalog', () => {
    for (const model of ['thinkingmachines/Inkling-2-Small', 'elorian-labs/glimpse-1.0', 'moonshotai/Kimi-K3.1-Pro', 'MiniMaxAI/MiniMax-M3.1-Flash']) {
      expect(getModelInfo(model)?.endpoints).toEqual(['chat_completions']);
    }
    expect(getModelInfo('zai-org/GLM-5.3-Flash')?.endpoints).toContain('responses');
    expect(getModelInfo('deepseek-ai/DeepSeek-V4.1-Flash-1017')?.endpoints).toContain('messages');
    for (const model of ['deepseek-ai/DeepSeek-V4.1-Flash-1017', 'zai-org/GLM-5.3-Flash']) {
      expect(getModelInfo(model)?.features).toMatchObject({ vision: true, input: { image: true } });
    }
  });

  it('retains gated Rosalind access, unknown limits and the exact long-price boundary', () => {
    expect(getModelInfo('gpt-6-rosalind')).toMatchObject({ availability: 'invite_only', features: { input: { tokens: null }, output: { tokens: null } } });
    expect(calculateCost('gpt-6-rosalind', 272_000, 1_000)).toBeCloseTo(4.155);
    expect(calculateCost('gpt-6-rosalind', 272_001, 1_000)).toBeCloseTo(8.27253);
    expect(getModelInfo('gpt-6-rosalind')?.features.vision).toBeUndefined();
  });

  it('distinguishes vendor Grok batch prices from the unimplemented normalized batch transport', () => {
    for (const model of ['grok-4.7', 'grok-4.6']) {
      expect(getModelInfo(model)?.features.batchAPI).toBe(true);
      expect(calculateCost(model, 1_000, 1_000, { processingMode: 'batch' })).toBeCloseTo(0.0064);
      const provider = new GrokTextProvider('grok-offline', { apiKey: 'offline-only', baseURL: 'https://api.x.ai/v1' });
      expect(provider.getAdvancedCapabilities(model).batch.supported).toBe(false);
    }
  });

  it('prices Lite by resolution and keeps its unsupported modes and unknown FPS explicit', () => {
    const model = getVideoModelInfo('grok-imagine-video-1.5-lite');
    expect(model?.capabilities).toMatchObject({ audio: true, textToVideo: true, imageToVideo: true, frameControl: false, videoExtension: false, maxFps: 0 });
    expect(model?.capabilities.durations).toContain(6);
    expect(calculateVideoCost('grok-imagine-video-1.5-lite', 10, { resolution: '480p' })).toBeCloseTo(0.2);
    expect(calculateVideoCost('grok-imagine-video-1.5-lite', 10, { resolution: '720p' })).toBeCloseTo(0.3);
    expect(calculateVideoCost('grok-imagine-video-1.5-lite', 10, { resolution: '1080p' })).toBeCloseTo(1.4);
    expect(getVideoModelInfo('grok-imagine-video-1.5')?.capabilities.frameControl).toBe(true);
  });

  it('records Mistral Large 4 always-on reasoning without inventing an output ceiling', () => {
    expect(getModelInfo('mistral-large-4')?.features).toMatchObject({ reasoning: true, reasoningEfforts: ['low', 'medium', 'high'], output: { tokens: null } });
  });
});
