import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Agent } from '@/core/Agent.js';
import { Connector } from '@/core/Connector.js';
import { createProvider } from '@/core/createProvider.js';
import { Vendor } from '@/core/Vendor.js';
import { ContentType } from '@/domain/entities/Content.js';
import { MessageRole } from '@/domain/entities/Message.js';

const { get, create, createClient } = vi.hoisted(() => {
  const get = vi.fn();
  const create = vi.fn();
  return { get, create, createClient: vi.fn(() => ({ get, responses: { create } })) };
});
vi.mock('openai', () => ({ default: createClient }));

const name = 'omlx-under-test';
const model = 'Inkling-2-Mini-oQ4e-mtp';

describe('oMLX Responses provider', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    createClient.mockImplementation(() => ({ get, responses: { create } }));
    get.mockResolvedValue({ data: [
      { id: model, model_type: 'vlm', max_model_len: 131072 },
      { id: 'local-text', model_type: 'llm', max_model_len: 8192 },
      { id: 'embedding', model_type: 'embedding' },
    ] });
    create.mockResolvedValue({
      id: 'resp_probe', model, status: 'completed',
      output: [{ id: 'msg_probe', type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '42' }] }],
      usage: { input_tokens: 20, output_tokens: 1, total_tokens: 21 },
    });
    Connector.create({ name, vendor: Vendor.OMLX, auth: { type: 'api_key', apiKey: 'test-local-token' } });
  });

  afterEach(() => Connector.remove(name));

  it('discovers installed text and vision models and scopes capabilities to the connector', async () => {
    const provider = createProvider(Connector.get(name));
    expect(await provider.listModels()).toEqual([model, 'local-text']);
    expect(createClient).toHaveBeenCalledWith(expect.objectContaining({
      baseURL: 'http://127.0.0.1:8000/v1', apiKey: 'test-local-token',
    }));
    expect(provider.getModelCapabilities(model)).toMatchObject({
      supportsVision: true, supportsTools: true, supportsJSONSchema: true, maxInputTokens: 131072,
    });
    expect(provider.getModelCapabilities('local-text')).toMatchObject({
      supportsVision: false, supportsTools: false, maxInputTokens: 8192,
    });
    expect(createProvider(Connector.get(name)).getModelCapabilities(model).supportsVision).toBe(false);
    expect(provider.batch).toBeUndefined();
    expect(provider.compaction).toBeUndefined();
  });

  it('sends typed images through the managed Agent with an explicit stateless request', async () => {
    const agent = Agent.create({ connector: name, model });
    try {
      const response = await agent.run([{
        type: 'message', role: MessageRole.USER, content: [
          { type: ContentType.INPUT_TEXT, text: 'Read the number.' },
          { type: ContentType.INPUT_IMAGE_URL, image_url: { url: 'data:image/png;base64,AAAA' } },
        ],
      }], { thinking: { enabled: false } });
      expect(response.output_text).toBe('42');
      expect(get).toHaveBeenCalledTimes(1);
      expect(create.mock.calls[0]![0]).toMatchObject({
        model, store: false, reasoning: { effort: 'none' },
        input: expect.arrayContaining([expect.objectContaining({
          role: 'user', content: expect.arrayContaining([
            expect.objectContaining({ type: 'input_image', image_url: 'data:image/png;base64,AAAA' }),
          ]),
        })]),
      });
    } finally {
      agent.destroy();
    }
  });

  it('keeps text-only managed models usable and rejects unsupported wire controls', async () => {
    const agent = Agent.create({ connector: name, model: 'local-text' });
    try {
      expect((await agent.run('Say 42.')).output_text).toBe('42');
      expect(create.mock.calls[0][0].tools).toBeUndefined();
      const provider = createProvider(Connector.get(name));
      const options = { model, input: 'Say 42.' };
      await expect(provider.generate({ ...options, vendorOptions: { store: true } })).rejects.toThrow('store');
      await expect(provider.generate({ ...options, parallel_tool_calls: false })).rejects.toThrow('parallel tool-call');
      await expect(provider.generate({ ...options, tool_choice: 'required' })).rejects.toThrow('forced tool choice');
      await expect(provider.generate({ ...options, model: 'embedding' })).rejects.toThrow('not installed');
      expect(create).toHaveBeenCalledTimes(1);
    } finally {
      agent.destroy();
    }
  });
});
