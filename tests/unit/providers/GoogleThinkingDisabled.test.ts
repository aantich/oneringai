import { describe, expect, it } from 'vitest';
import { GoogleConverter } from '@/infrastructure/providers/google/GoogleConverter.js';
import type { TextGenerateOptions } from '@/domain/interfaces/ITextProvider.js';

const converter = new GoogleConverter();
const request = (model: string, options: Partial<TextGenerateOptions> = {}) => converter.convertRequest({ model, input: 'Reply ACK', ...options });

describe('Google GenerateContent explicit thinking opt-out (shared with Vertex)', () => {
  it.each(['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-flash-preview-05-20', 'gemini-2.5-flash-lite-preview-06-17'])('sends a zero budget for explicit false on %s', async model => {
    const result = await request(model, { thinking: { enabled: false } });
    expect(result.generationConfig.thinkingConfig).toEqual({ thinkingBudget: 0 });
  });
  it.each(['gemini-2.5-flash', 'gemini-2.5-flash-lite'])('leaves absent/default thinking unchanged on %s', async model => {
    expect((await request(model)).generationConfig).not.toHaveProperty('thinkingConfig');
  });
  it.each(['gemini-2.5-pro', 'gemini-3-pro-preview', 'gemini-2.0-flash', 'gemini-2.5-flash-image', 'unknown-model'])('does not invent a disable capability on %s', async model => {
    expect((await request(model, { thinking: { enabled: false } })).generationConfig).not.toHaveProperty('thinkingConfig');
  });
  it('preserves the existing explicit vendor level precedence', async () => {
    const result = await request('gemini-2.5-flash', { thinking: { enabled: false }, vendorOptions: { thinkingLevel: 'low' } });
    expect(result.generationConfig.thinkingConfig).toEqual({ thinkingLevel: 'low' });
  });
  it('preserves a raw vendor generation configuration rather than overwriting its escape hatch', async () => {
    const generationConfig = { thinkingConfig: { thinkingBudget: 1024, includeThoughts: true } };
    const result = await request('gemini-2.5-flash', { thinking: { enabled: false }, vendorOptions: { generationConfig } });
    expect(result.generationConfig.thinkingConfig).toEqual(generationConfig.thinkingConfig);
    expect(generationConfig).toEqual({ thinkingConfig: { thinkingBudget: 1024, includeThoughts: true } });
  });
  it('preserves enabled budget conversion and does not leak it into the next request', async () => {
    expect((await request('gemini-2.5-flash', { thinking: { enabled: true, budgetTokens: 1024 } })).generationConfig.thinkingConfig).toEqual({ thinkingBudget: 1024 });
    expect((await request('gemini-2.5-flash', { thinking: { enabled: false } })).generationConfig.thinkingConfig).toEqual({ thinkingBudget: 0 });
    expect((await request('gemini-2.5-flash')).generationConfig).not.toHaveProperty('thinkingConfig');
  });
});
