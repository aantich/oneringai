/**
 * Behavior tests for structured (JSON) output wired through the public
 * Agent APIs (runDirect + run), using a mocked provider. Complements the
 * pure-function coverage in StructuredOutput.test.ts.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Agent } from '@/core/Agent.js';
import { Connector } from '@/core/Connector.js';
import { Vendor } from '@/core/Vendor.js';
import { MessageRole } from '@/domain/entities/Message.js';
import { ContentType } from '@/domain/entities/Content.js';
import { LLMResponse } from '@/domain/entities/Response.js';
import { StructuredOutputError, type ResponseFormat } from '@/core/StructuredOutput.js';
import type { ModelCapabilities, TextGenerateOptions } from '@/domain/interfaces/ITextProvider.js';
import type { AdvancedTextCapabilities } from '@/domain/interfaces/IAdvancedInference.js';

const mockGenerate = vi.fn();
let mockCaps: ModelCapabilities;
let mockAdvanced: AdvancedTextCapabilities;

const mockProvider = {
  name: 'openai',
  capabilities: { text: true, images: false, videos: false, audio: false },
  generate: mockGenerate,
  streamGenerate: vi.fn(),
  getModelCapabilities: vi.fn(() => mockCaps),
  getAdvancedCapabilities: vi.fn(() => mockAdvanced),
  listModels: vi.fn(async () => []),
};

vi.mock('@/core/createProvider.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/core/createProvider.js')>(),
  createProvider: vi.fn(() => mockProvider),
}));

function textResponse(text: string): LLMResponse {
  return {
    id: 'resp_1',
    object: 'response',
    created_at: 1,
    status: 'completed',
    model: 'gpt-4.1',
    output: [
      {
        type: 'message',
        role: MessageRole.ASSISTANT,
        content: [{ type: ContentType.OUTPUT_TEXT, text }],
      },
    ],
    output_text: text,
    usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
  };
}

const SCHEMA: ResponseFormat = {
  type: 'json_schema',
  name: 'contact',
  schema: {
    type: 'object',
    properties: { name: { type: 'string' } },
    required: ['name'],
    additionalProperties: false,
  },
};

function baseCaps(over: Partial<ModelCapabilities> = {}): ModelCapabilities {
  return {
    supportsTools: true,
    supportsVision: false,
    supportsJSON: true,
    supportsJSONSchema: true,
    maxTokens: 128000,
    maxOutputTokens: 16384,
    ...over,
  };
}

function advancedCaps(
  over: Partial<AdvancedTextCapabilities> = {},
): AdvancedTextCapabilities {
  return {
    promptCaching: { mode: 'unsupported', ttlModes: [], reportsCacheUsage: false },
    batch: { supported: false, cancellable: false },
    structuredOutput: {
      jsonObject: 'native',
      jsonSchema: 'native',
      nativeWithTools: true,
    },
    nativeTools: ['web_search'],
    nativeToolOptions: { remoteMcpApproval: false },
    dataHandling: { promptCaching: 'none', batch: 'none', remoteMcp: 'none' },
    ...over,
  };
}

describe('Structured output — behavior (runDirect)', () => {
  let agent: Agent;

  beforeEach(() => {
    vi.clearAllMocks();
    Connector.clear();
    Connector.create({ name: 'c', vendor: Vendor.OpenAI, auth: { type: 'api_key', apiKey: 'k' } });
    mockCaps = baseCaps();
    mockAdvanced = advancedCaps();
    agent = Agent.create({ connector: 'c', model: 'gpt-4.1' });
  });

  afterEach(() => {
    agent.destroy();
    Connector.clear();
  });

  it('native path: passes response_format and attaches output_parsed', async () => {
    mockGenerate.mockResolvedValue(textResponse('{"name":"Jane"}'));

    const res = await agent.runDirect('Extract the contact', {
      responseFormat: SCHEMA,
      nativeTools: [{ capability: 'web_search' }],
      dataHandling: { allowProviderTools: true },
    });

    expect(res.output_parsed).toEqual({ name: 'Jane' });
    expect(res.structured_output_enforcement).toBe('native');
    const opts = mockGenerate.mock.calls[0][0] as TextGenerateOptions;
    expect(opts.response_format).toBeDefined();
    expect(opts.response_format?.type).toBe('json_schema');
    // native → no prompt-fallback instruction injected
    expect(opts.instructions ?? '').not.toContain('JSON Schema:');
  });

  it('prompt fallback (no native schema support): injects instruction, no response_format', async () => {
    mockCaps = baseCaps({ supportsJSONSchema: false });
    mockGenerate.mockResolvedValue(textResponse('```json\n{"name":"Jane"}\n```'));

    const res = await agent.runDirect('Extract the contact', {
      responseFormat: SCHEMA,
      nativeTools: [{ capability: 'web_search' }],
      dataHandling: { allowProviderTools: true },
    });

    expect(res.output_parsed).toEqual({ name: 'Jane' }); // permissive parse strips fences
    expect(res.structured_output_enforcement).toBe('prompt');
    const opts = mockGenerate.mock.calls[0][0] as TextGenerateOptions;
    expect(opts.response_format).toBeUndefined();
    expect(opts.instructions ?? '').toContain('JSON Schema:');
  });

  it('parse failure triggers exactly one re-ask, then succeeds', async () => {
    const first = textResponse('not json at all');
    first.usage = {
      ...first.usage,
      cached_input_tokens: 4,
      cache_creation_input_tokens: 3,
      cache_creation_details: { short_ttl_input_tokens: 3 },
      output_tokens_details: { reasoning_tokens: 2 },
      native_tool_calls: { web_search: 1 },
      service_tier: 'standard',
    };
    const repaired = textResponse('{"name":"Jane"}');
    repaired.usage = {
      ...repaired.usage,
      cached_input_tokens: 5,
      cache_creation_input_tokens: 7,
      cache_creation_details: {
        short_ttl_input_tokens: 2,
        extended_ttl_input_tokens: 5,
      },
      output_tokens_details: { reasoning_tokens: 3 },
      native_tool_calls: { web_search: 2, code_execution: 1 },
      service_tier: 'priority',
    };
    mockGenerate.mockResolvedValueOnce(first).mockResolvedValueOnce(repaired);

    const res = await agent.runDirect('Extract the contact', {
      responseFormat: SCHEMA,
      nativeTools: [{ capability: 'web_search' }],
      dataHandling: { allowProviderTools: true },
    });

    expect(res.output_parsed).toEqual({ name: 'Jane' });
    expect(mockGenerate).toHaveBeenCalledTimes(2); // initial + 1 re-ask
    expect(res.structured_output_enforcement).toBe('repair');
    // re-ask is tool-free
    const reask = mockGenerate.mock.calls[1][0] as TextGenerateOptions;
    expect(reask.tools).toBeUndefined();
    expect(reask.native_tools).toBeUndefined();
    // usage accumulated across both calls
    expect(res.usage.total_tokens).toBe(30);
    expect(res.usage.cached_input_tokens).toBe(9);
    expect(res.usage.cache_creation_input_tokens).toBe(10);
    expect(res.usage.cache_creation_details).toEqual({
      short_ttl_input_tokens: 5,
      extended_ttl_input_tokens: 5,
    });
    expect(res.usage.output_tokens_details?.reasoning_tokens).toBe(5);
    expect(res.usage.native_tool_calls).toEqual({ web_search: 3, code_execution: 1 });
    expect(res.usage.service_tier).toBe('priority');
  });

  it('throws StructuredOutputError when JSON never parses (bounded re-ask)', async () => {
    mockGenerate.mockResolvedValue(textResponse('still not json'));

    await expect(agent.runDirect('Extract the contact', { responseFormat: SCHEMA })).rejects.toBeInstanceOf(
      StructuredOutputError,
    );
    // initial + exactly one re-ask, then give up (STRUCTURED_OUTPUT_MAX_REPAIR_ATTEMPTS = 1)
    expect(mockGenerate).toHaveBeenCalledTimes(2);
  });
});

describe('Structured output — behavior (run)', () => {
  let agent: Agent;

  beforeEach(() => {
    vi.clearAllMocks();
    Connector.clear();
    Connector.create({ name: 'c', vendor: Vendor.OpenAI, auth: { type: 'api_key', apiKey: 'k' } });
    mockCaps = baseCaps();
    mockAdvanced = advancedCaps();
    agent = Agent.create({ connector: 'c', model: 'gpt-4.1' });
  });

  afterEach(() => {
    agent.destroy();
    Connector.clear();
  });

  it('native inline: final answer already JSON, no extra reformat call', async () => {
    mockGenerate.mockResolvedValue(textResponse('{"name":"Jane"}'));

    const res = await agent.run('Extract the contact', { responseFormat: SCHEMA });

    expect(res.output_parsed).toEqual({ name: 'Jane' });
    expect(res.structured_output_enforcement).toBe('native');
    expect(mockGenerate).toHaveBeenCalledTimes(1); // no reformat pass needed
    const opts = mockGenerate.mock.calls[0][0] as TextGenerateOptions;
    expect(opts.response_format?.type).toBe('json_schema');
  });

  it('prompt fallback: prose answer is reformatted tool-free into JSON', async () => {
    mockCaps = baseCaps({ supportsJSONSchema: false });
    mockGenerate
      .mockResolvedValueOnce(textResponse('The contact is Jane.')) // loop answer (prose)
      .mockResolvedValueOnce(textResponse('{"name":"Jane"}')); // tool-free reformat

    const res = await agent.run('Extract the contact', { responseFormat: SCHEMA });

    expect(res.output_parsed).toEqual({ name: 'Jane' });
    expect(res.output_text).toBe('{"name":"Jane"}');
    expect(mockGenerate).toHaveBeenCalledTimes(2);
    const reformat = mockGenerate.mock.calls[1][0] as TextGenerateOptions;
    expect(reformat.tools).toBeUndefined(); // reformat pass is tool-free
  });

  it('forces a constrained tool-free pass when native tools cannot compose with schema output', async () => {
    mockAdvanced = advancedCaps({
      structuredOutput: {
        jsonObject: 'native',
        jsonSchema: 'native',
        nativeWithTools: false,
      },
    });
    mockGenerate
      .mockResolvedValueOnce(textResponse('{"name":"Accidental JSON"}'))
      .mockResolvedValueOnce(textResponse('{"name":"Jane"}'));

    const res = await agent.run('Extract the contact', {
      responseFormat: SCHEMA,
      nativeTools: [{ capability: 'web_search' }],
      dataHandling: { allowProviderTools: true },
    });

    expect(mockGenerate).toHaveBeenCalledTimes(2);
    expect((mockGenerate.mock.calls[0][0] as TextGenerateOptions).response_format).toBeUndefined();
    expect((mockGenerate.mock.calls[1][0] as TextGenerateOptions).native_tools).toBeUndefined();
    expect(res.output_parsed).toEqual({ name: 'Jane' });
    expect(res.structured_output_enforcement).toBe('prompt');
    expect(res.usage.total_tokens).toBe(30);
    expect(agent.getMetrics()).toEqual(
      expect.objectContaining({ inputTokens: 20, outputTokens: 10, totalTokens: 30 }),
    );
  });

  it('reformat is written back to conversation history (context matches the returned JSON)', async () => {
    mockCaps = baseCaps({ supportsJSONSchema: false });
    mockGenerate
      .mockResolvedValueOnce(textResponse('The contact is Jane.')) // committed to context by the loop
      .mockResolvedValueOnce(textResponse('{"name":"Jane"}')); // reformat

    const res = await agent.run('Extract the contact', { responseFormat: SCHEMA });
    expect(res.output_text).toBe('{"name":"Jane"}');

    const convo = [...agent.context.getConversation()];
    const lastAssistant = convo
      .reverse()
      .find((m): m is typeof m & { content: Array<{ text?: string }> } =>
        (m as { type?: string; role?: string }).type === 'message' &&
        (m as { role?: string }).role === MessageRole.ASSISTANT,
      );
    const text = (lastAssistant?.content ?? []).map((c) => c.text ?? '').join('');
    expect(text).toContain('{"name":"Jane"}'); // history holds the reformatted JSON
    expect(text).not.toContain('The contact is Jane.'); // not the pre-reformat prose
  });
});
