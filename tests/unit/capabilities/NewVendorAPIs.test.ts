import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Connector } from '@/core/Connector.js';
import { Vendor } from '@/core/Vendor.js';

const {
  mockDecisionCreate,
  mockOpenAIVoiceCreate,
  mockOpenAI,
  mockGoogleVoiceCreate,
  mockGoogleVoiceList,
  mockGoogleVoiceGet,
  mockGoogleVoiceDelete,
  mockGoogleGenAI,
} = vi.hoisted(() => {
  const mockDecisionCreate = vi.fn();
  const mockOpenAIVoiceCreate = vi.fn();
  const mockOpenAI = vi.fn(() => ({
    decisions: { create: mockDecisionCreate },
    audio: { voices: { create: mockOpenAIVoiceCreate } },
  }));
  const mockGoogleVoiceCreate = vi.fn();
  const mockGoogleVoiceList = vi.fn();
  const mockGoogleVoiceGet = vi.fn();
  const mockGoogleVoiceDelete = vi.fn();
  const mockGoogleGenAI = vi.fn(() => ({
    voices: {
      create: mockGoogleVoiceCreate,
      list: mockGoogleVoiceList,
      get: mockGoogleVoiceGet,
      delete: mockGoogleVoiceDelete,
    },
  }));
  return {
    mockDecisionCreate,
    mockOpenAIVoiceCreate,
    mockOpenAI,
    mockGoogleVoiceCreate,
    mockGoogleVoiceList,
    mockGoogleVoiceGet,
    mockGoogleVoiceDelete,
    mockGoogleGenAI,
  };
});

vi.mock('openai', () => ({ default: mockOpenAI }));
vi.mock('@google/genai', () => ({ GoogleGenAI: mockGoogleGenAI }));

import { OpenAIDecisions } from '@/capabilities/openai/OpenAIDecisions.js';
import { OpenAIVoices } from '@/capabilities/openai/OpenAIVoices.js';
import { GoogleVoices } from '@/capabilities/google/GoogleVoices.js';

describe('new connector-first vendor APIs', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => Connector.clear());

  it('uses the named OpenAI connector for Decisions and voice creation', async () => {
    Connector.create({
      name: 'openai-new-api',
      vendor: Vendor.OpenAI,
      auth: { type: 'api_key', apiKey: 'secret-openai-key' },
      options: { project: 'proj_123' },
    });
    const decision = { model: 'gpt-6-luna', answers: [], usage: {} };
    const voice = { id: 'voice_1', name: 'Guide', type: 'prompt' };
    mockDecisionCreate.mockResolvedValue(decision);
    mockOpenAIVoiceCreate.mockResolvedValue(voice);

    await expect(new OpenAIDecisions('openai-new-api').create({
      model: 'gpt-6-luna',
      input: 'classify this',
      questions: [{ type: 'predicate', name: 'safe', prompt: 'Is this safe?' }],
    } as any)).resolves.toBe(decision);
    await expect(new OpenAIVoices('openai-new-api').create({
      type: 'prompt', name: 'Guide', prompt: 'Warm and precise',
    })).resolves.toBe(voice);

    expect(mockOpenAI).toHaveBeenCalledWith(expect.objectContaining({ project: 'proj_123' }));
    await expect(mockOpenAI.mock.calls[0]![0].apiKey()).resolves.toBe('secret-openai-key');
  });

  it('validates empty Decisions requests before calling OpenAI', async () => {
    const connector = Connector.create({
      name: 'openai-new-api',
      vendor: Vendor.OpenAI,
      auth: { type: 'api_key', apiKey: 'secret-openai-key' },
    });

    await expect(new OpenAIDecisions(connector).create({
      model: 'gpt-6-luna', input: 'test', questions: [],
    } as any)).rejects.toThrow(/At least one decision question/);
    expect(mockDecisionCreate).not.toHaveBeenCalled();
  });

  it('uses a named Google connector for the complete custom-voice lifecycle', async () => {
    Connector.create({
      name: 'google-voices',
      vendor: Vendor.Google,
      auth: { type: 'api_key', apiKey: 'secret-google-key' },
    });
    mockGoogleVoiceCreate.mockResolvedValue({ id: 'voices/1' });
    mockGoogleVoiceList.mockResolvedValue({ voices: [] });
    mockGoogleVoiceGet.mockResolvedValue({ id: 'voices/1' });
    mockGoogleVoiceDelete.mockResolvedValue({});

    const voices = new GoogleVoices('google-voices');
    await voices.create({ name: 'Guide' } as any);
    await voices.list();
    await voices.get('voices/1');
    await voices.delete('voices/1');

    expect(mockGoogleGenAI).toHaveBeenCalledWith({ apiKey: 'secret-google-key' });
    expect(mockGoogleVoiceGet).toHaveBeenCalledWith('voices/1', undefined);
    expect(mockGoogleVoiceDelete).toHaveBeenCalledWith('voices/1', undefined);
  });
});
