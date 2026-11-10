import { beforeEach, describe, expect, it, vi } from 'vitest';
import { chatGPTPlanRequest, checkedChatGPTPlanStream } from '@/infrastructure/providers/openai/chatGPTPlan.js';
import { ProviderErrorMapper } from '@/infrastructure/providers/base/ProviderErrorMapper.js';
const { create, get, ctor } = vi.hoisted(() => {
  const create = vi.fn(); const get = vi.fn();
  return { create, get, ctor: vi.fn(() => ({ responses: { create }, get })) };
});
vi.mock('openai', () => ({ default: ctor }));
import { OpenAITextProvider } from '@/infrastructure/providers/openai/OpenAITextProvider.js';
import { Connector } from '@/core/Connector.js';
import { createProvider, nativeProviderEndpoint } from '@/core/createProvider.js';
import { createEmbeddingProvider } from '@/core/createEmbeddingProvider.js';
import { Vendor } from '@/core/Vendor.js';

const response = (output: unknown[] = []) => ({ id: 'resp_plan', object: 'response', created_at: 1,
  status: 'completed', model: 'gpt-6.1-sol', output, usage: { input_tokens: 2, output_tokens: 1, total_tokens: 3 } });
async function* events(items: unknown[]) { for (const item of items) yield item; }
function provider() { return new OpenAITextProvider({ apiKey: 'runtime', apiKeyProvider: async () => 'oauth-access', openaiAuthMode: 'chatgpt-plan' }); }

describe('ChatGPT plan Responses contract', () => {
  beforeEach(() => { vi.clearAllMocks(); Connector.clear(); });
  it('makes stateless namespaced tools and replay without changing application tool names', () => {
    const tool = { type: 'function', name: 'lookup', parameters: { type: 'object' } };
    const params = { model: 'gpt-6.1-sol', input: [{ type: 'function_call', name: 'lookup', call_id: 'call_1', arguments: '{}' },
      { type: 'function_call_output', call_id: 'call_1', output: 'ok' }], tools: [tool], tool_choice: { type: 'function', name: 'lookup' } };
    const wire = chatGPTPlanRequest(params);
    expect(wire).toMatchObject({ store: false, stream: true, tools: [{ type: 'namespace', name: 'oneringai', tools: [tool] }],
      tool_choice: { type: 'function', name: 'lookup' },
      input: [{ type: 'function_call', namespace: 'oneringai', name: 'lookup' }, { type: 'function_call_output', call_id: 'call_1' }] });
    expect(params.input[0]).not.toHaveProperty('namespace');
  });
  it.each(['temperature', 'max_output_tokens', 'previous_response_id', 'metadata', 'background', 'top_p', 'prompt_cache_retention'])('rejects explicit %s rather than dropping it', key => {
    expect(() => chatGPTPlanRequest({ input: 'hello', [key]: 1 })).toThrow(key);
  });
  it.each(['tool_search', 'image_generation', 'file_search', 'code_interpreter', 'mcp', 'computer', 'programmatic_tool_calling'])('rejects hosted %s', type => {
    expect(() => chatGPTPlanRequest({ input: 'hello', tools: [{ type }] })).toThrow(type);
  });
  it('rejects system messages, uploaded files, audio and redirected credentials', () => {
    expect(() => chatGPTPlanRequest({ input: [{ role: 'system', content: 'x' }] })).toThrow('developer');
    expect(() => chatGPTPlanRequest({ input: [{ role: 'user', content: [{ type: 'input_file', file_id: 'file_1' }] }] })).toThrow('inline');
    expect(() => chatGPTPlanRequest({ input: [{ role: 'user', content: [{ type: 'input_audio' }] }] })).toThrow('audio');
    expect(() => new OpenAITextProvider({ apiKey: 'x', openaiAuthMode: 'chatgpt-plan', baseURL: 'https://example.com' })).toThrow('public OpenAI');
  });
  it('pins the public endpoint and disables transport retries and API organization inheritance', () => {
    provider();
    expect(ctor.mock.calls.at(-1)?.[0]).toMatchObject({ baseURL: 'https://api.openai.com/v1', organization: null, project: null, maxRetries: 0 });
  });
  it('supports ordinary generate() by collecting the required stream to completion', async () => {
    create.mockResolvedValue(events([{ type: 'response.completed', response: response([{ type: 'message', id: 'msg_1', role: 'assistant',
      content: [{ type: 'output_text', text: 'Hello', annotations: [] }], status: 'completed' }]) }]));
    const result = await provider().generate({ model: 'gpt-6.1-sol', input: 'Hi' });
    expect(result.output_text).toBe('Hello');
    expect(create.mock.calls[0][0]).toMatchObject({ store: false, stream: true, input: [{ role: 'user', content: 'Hi' }] });
  });
  it('does not accept truncated streams or late failures as successful output', async () => {
    create.mockResolvedValueOnce(events([{ type: 'response.output_text.delta', item_id: 'msg_1', output_index: 0, content_index: 0, delta: 'partial' }]));
    await expect(provider().generate({ model: 'gpt-6.1-sol', input: 'Hi' })).rejects.toThrow('terminal');
    create.mockResolvedValueOnce(events([{ type: 'response.failed', response: { ...response(), status: 'failed',
      error: { code: 'subscription_sharing_usage_limit_exceeded', message: 'Plan limit' } } }]));
    await expect(provider().generate({ model: 'gpt-6.1-sol', input: 'Hi' })).rejects.toThrow('Manage usage');
  });
  it('preserves incomplete status and rejects an unrecognized namespace', async () => {
    create.mockResolvedValueOnce(events([{ type: 'response.incomplete', response: { ...response(), status: 'incomplete' } }]));
    expect((await provider().generate({ model: 'gpt-6.1-sol', input: 'Hi' })).status).toBe('incomplete');
    await expect(async () => { for await (const _ of checkedChatGPTPlanStream(events([
      { type: 'response.output_item.added', item: { type: 'function_call', namespace: 'foreign', name: 'lookup' } },
    ]) as never)) { /* drain */ } }).rejects.toThrow('namespace');
  });
  it('streamGenerate propagates late limits and requires a terminal event', async () => {
    create.mockResolvedValueOnce(events([{ type: 'response.output_text.delta', item_id: 'msg_1', output_index: 0, content_index: 0, delta: 'partial' }]));
    await expect(async () => { for await (const _ of provider().streamGenerate({ model: 'gpt-6.1-sol', input: 'hi' })) {} }).rejects.toThrow('terminal');
  });
  it('reads account model catalogs in server order and disables unsupported capabilities', async () => {
    get.mockResolvedValue({ models: [{ slug: 'second', visibility: 'list' }, { slug: 'hidden', visibility: 'hide' }, { slug: 'first', visibility: 'list' }] });
    const p = provider();
    expect(await p.listModels()).toEqual(['second', 'first']);
    expect(p.getAdvancedCapabilities('gpt-6.1-sol')).toMatchObject({ batch: { supported: false }, nativeCompaction: { onDemand: 'unsupported' }, nativeTools: ['web_search'] });
    expect(p.getAdvancedCapabilities('unregistered-account-model').structuredOutput).toMatchObject({ jsonSchema: 'prompt', nativeWithTools: false });
    expect(p.getAdvancedCapabilities('unregistered-account-model').nativeTools).toEqual([]);
    await expect(p.compaction.compact({ model: 'gpt-6.1-sol', input: [] })).rejects.toThrow('compaction');
  });
  it('keeps account binding in connector identity and denies media without using tokens', () => {
    const connector = Connector.create({ name: 'shared-plan', vendor: Vendor.OpenAI, auth: { type: 'api_key_provider', getApiKey: async () => 'oauth' },
      options: { openaiAuthMode: 'chatgpt-plan', openaiAccountId: 'profile-1' } });
    const p = createProvider(connector);
    expect(nativeProviderEndpoint(p, connector)).toEqual(expect.any(String));
    connector.config.options!.openaiAccountId = 'profile-2';
    expect(() => nativeProviderEndpoint(p, connector)).toThrow('changed');
    expect(() => createEmbeddingProvider(connector)).toThrow('Media or embeddings');
  });
  it('preserves structured subscription errors instead of replacing them with generic 429/auth errors', () => {
    const original = Object.assign(new Error('Quota'), { status: 429, code: 'subscription_sharing_usage_limit_exceeded', request_id: 'req_plan' });
    const error = ProviderErrorMapper.mapError(original, { providerName: 'openai' });
    expect(error.originalError).toBe(original);
    expect(error.message).toContain(original.code);
    expect(error.statusCode).toBe(429);
  });
});
