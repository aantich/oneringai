import { describe, expect, it, vi } from 'vitest';
import { AnthropicConverter } from '@/infrastructure/providers/anthropic/AnthropicConverter.js';
import {
  AnthropicTextProvider,
  supportsAnthropicNativeStructuredOutput,
} from '@/infrastructure/providers/anthropic/AnthropicTextProvider.js';
import { OpenAIResponsesConverter } from '@/infrastructure/providers/openai/OpenAIResponsesConverter.js';
import { OpenAITextProvider } from '@/infrastructure/providers/openai/OpenAITextProvider.js';
import { GoogleConverter } from '@/infrastructure/providers/google/GoogleConverter.js';
import { GoogleTextProvider } from '@/infrastructure/providers/google/GoogleTextProvider.js';
import { GrokTextProvider } from '@/infrastructure/providers/grok/GrokTextProvider.js';
import { calculateCost } from '@/domain/entities/Model.js';
import {
  ProviderAmbiguousOperationError,
  ProviderCapabilityNotSupportedError,
} from '@/domain/errors/AIErrors.js';
import { Connector } from '@/core/Connector.js';
import { Vendor } from '@/core/Vendor.js';

const textOptions = (model: string) => ({ model, input: 'hello' });

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of source) items.push(item);
  return items;
}

describe('advanced inference provider contracts', () => {
  it('maps Anthropic cache, native tools, remote MCP, and native schema output', () => {
    const request = new AnthropicConverter().convertRequest({
      ...textOptions('claude-opus-4-6'),
      prompt_cache: { mode: 'auto', ttl: 'extended' },
      native_tools: [
        { capability: 'web_search', options: { max_uses: 2 } },
        {
          capability: 'remote_mcp',
          server: {
            name: 'crm',
            url: 'https://mcp.example.com',
            resolvedAuthorizationToken: 'secret',
            allowedTools: ['lookup'],
          },
        },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'answer',
          schema: { type: 'object', properties: { answer: { type: 'string' } } },
        },
      },
    } as any) as any;

    expect(request.cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
    expect(request.tools).toContainEqual(
      expect.objectContaining({ type: 'web_search_20260318', name: 'web_search', max_uses: 2 }),
    );
    expect(request.tools).toContainEqual(
      expect.objectContaining({ type: 'mcp_toolset', mcp_server_name: 'crm' }),
    );
    expect(request.mcp_servers).toEqual([
      expect.objectContaining({ name: 'crm', url: 'https://mcp.example.com' }),
    ]);
    expect(request.output_config.format.type).toBe('json_schema');
  });

  it('gates Anthropic native structured output by documented model family', () => {
    expect(supportsAnthropicNativeStructuredOutput('claude-opus-4-6')).toBe(true);
    expect(supportsAnthropicNativeStructuredOutput('claude-sonnet-4-5-20250929')).toBe(true);
    expect(supportsAnthropicNativeStructuredOutput('claude-3-7-sonnet-20250219')).toBe(false);
  });

  it('preserves Anthropic cache and native-tool usage', () => {
    const response = new AnthropicConverter().convertResponse({
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      model: 'claude-opus-4-6',
      content: [
        { type: 'text', text: 'ok', citations: [] },
        {
          type: 'web_search_tool_result',
          tool_use_id: 'search_1',
          content: [{ type: 'web_search_result', url: 'https://example.com' }],
        },
      ],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: {
        input_tokens: 100,
        output_tokens: 20,
        cache_read_input_tokens: 80,
        cache_creation_input_tokens: 10,
        cache_creation: {
          ephemeral_5m_input_tokens: 4,
          ephemeral_1h_input_tokens: 6,
        },
        server_tool_use: { web_search_requests: 2, web_fetch_requests: 1 },
        service_tier: 'standard',
        inference_geo: null,
      },
    } as any);

    expect(response.usage.cached_input_tokens).toBe(80);
    expect(response.usage.cache_creation_input_tokens).toBe(10);
    expect(response.usage.input_tokens).toBe(190);
    expect(response.usage.total_tokens).toBe(210);
    expect(response.usage.native_tool_calls).toEqual({ web_search: 2, web_fetch: 1 });
    expect(response.native_tool_events).toContainEqual({
      capability: 'web_search',
      id: 'search_1',
      status: 'completed',
    });
  });

  it('retains Anthropic detailed usage while aggregating streaming continuations', () => {
    const provider = new AnthropicTextProvider({ apiKey: 'test' });
    const target: any = { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
    (provider as any).accumulateTokenUsage(target, {
      input_tokens: 100,
      output_tokens: 20,
      total_tokens: 120,
      cached_input_tokens: 80,
      cache_creation_input_tokens: 10,
      cache_creation_details: {
        short_ttl_input_tokens: 4,
        extended_ttl_input_tokens: 6,
      },
      output_tokens_details: { reasoning_tokens: 7 },
      native_tool_calls: { web_search: 1 },
      service_tier: 'standard',
    });

    expect(target).toEqual(
      expect.objectContaining({
        cache_creation_details: {
          short_ttl_input_tokens: 4,
          extended_ttl_input_tokens: 6,
        },
        output_tokens_details: { reasoning_tokens: 7 },
        native_tool_calls: { web_search: 1 },
      }),
    );
  });

  it('maps OpenAI native tools and cache usage', () => {
    const converter = new OpenAIResponsesConverter();
    expect(
      converter.convertNativeTools([
        { capability: 'web_search' },
        { capability: 'hosted_shell' },
        {
          capability: 'remote_mcp',
          server: { name: 'crm', url: 'https://mcp.example.com', allowedTools: ['lookup'] },
        },
      ]),
    ).toEqual([
      { type: 'web_search' },
      { type: 'shell', environment: { type: 'container_auto' } },
      expect.objectContaining({
        type: 'mcp',
        server_label: 'crm',
        server_url: 'https://mcp.example.com',
        allowed_tools: ['lookup'],
        require_approval: 'never',
      }),
    ]);

    const response = converter.convertResponse({
      id: 'resp_1',
      object: 'response',
      created_at: 1,
      status: 'completed',
      model: 'gpt-5.4',
      output_text: 'ok',
      output: [{ type: 'web_search_call', id: 'ws_1', status: 'completed' }],
      usage: {
        input_tokens: 100,
        output_tokens: 10,
        total_tokens: 110,
        input_tokens_details: { cached_tokens: 75 },
      },
    } as any);
    expect(response.usage.cached_input_tokens).toBe(75);
    expect(response.usage.native_tool_calls).toEqual({ web_search: 1 });
    expect(response.native_tool_events).toEqual([
      { capability: 'web_search', id: 'ws_1', status: 'completed' },
    ]);
  });

  it('normalizes current OpenAI and xAI native tool calls with host-execution payloads', () => {
    const converter = new OpenAIResponsesConverter();
    const output = [
      {
        type: 'computer_call', id: 'computer_1', call_id: 'call_computer',
        status: 'completed', action: { type: 'screenshot' }, pending_safety_checks: [],
      },
      {
        type: 'shell_call', id: 'shell_1', call_id: 'call_shell', status: 'completed',
        action: { commands: ['pwd'], timeout_ms: null, max_output_length: null },
      },
      {
        type: 'apply_patch_call', id: 'patch_1', call_id: 'call_patch', status: 'completed',
        operation: { type: 'delete_file', path: 'tmp.txt' },
      },
      {
        type: 'tool_search_call', id: 'search_1', call_id: 'call_search',
        status: 'completed', execution: 'client', arguments: { query: 'crm' },
      },
      {
        type: 'image_generation_call', id: 'image_1', status: 'completed',
        result: 'base64-image',
      },
      { type: 'x_search_call', id: 'x_1', status: 'completed', query: 'release' },
      { type: 'code_execution_call', id: 'code_1', status: 'completed', code: '1 + 1' },
    ];
    const response = converter.convertResponse({
      id: 'resp_native', object: 'response', created_at: 1, status: 'completed',
      model: 'gpt-6-astra', output_text: '', output,
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    } as any);

    expect(response.usage.native_tool_calls).toEqual({
      computer_use: 1,
      hosted_shell: 1,
      apply_patch: 1,
      tool_search: 1,
      image_generation: 1,
      x_search: 1,
      code_execution: 1,
    });
    expect(response.native_tool_events).toContainEqual(expect.objectContaining({
      capability: 'computer_use',
      call_id: 'call_computer',
      phase: 'call',
      details: output[0],
    }));
    expect(response.native_tool_events).toContainEqual(expect.objectContaining({
      capability: 'apply_patch',
      call_id: 'call_patch',
      phase: 'call',
      details: output[2],
    }));
  });

  it('round-trips typed OpenAI host-executed native tool outputs', () => {
    const converter = new OpenAIResponsesConverter();
    const input = [
      {
        type: 'computer_call_output', call_id: 'call_computer',
        output: { type: 'computer_screenshot', file_id: 'file_screenshot' },
        acknowledged_safety_checks: [{ id: 'safety_1' }],
      },
      {
        type: 'shell_call_output', call_id: 'call_shell', status: 'completed',
        output: [{ stdout: '/tmp\n', stderr: '', outcome: { type: 'exit', exit_code: 0 } }],
      },
      {
        type: 'apply_patch_call_output', call_id: 'call_patch',
        status: 'completed', output: 'Done',
      },
      {
        type: 'tool_search_output', call_id: 'call_search', execution: 'client',
        status: 'completed', tools: [{ type: 'function', name: 'lookup', parameters: {} }],
      },
    ] as any;
    expect(converter.convertInput(input).input).toEqual(input);

    const response = converter.convertResponse({
      id: 'resp_outputs', object: 'response', created_at: 1, status: 'completed',
      model: 'gpt-6-astra', output_text: '', output: [
        { ...input[1], id: 'shell_output_1' },
        { ...input[2], id: 'patch_output_1' },
        { ...input[3], id: 'search_output_1' },
      ],
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    } as any);
    expect(response.usage.native_tool_calls).toBeUndefined();
    expect(response.native_tool_events).toContainEqual(expect.objectContaining({
      capability: 'hosted_shell', call_id: 'call_shell', phase: 'output',
      details: expect.objectContaining(input[1]),
    }));
    expect(response.native_tool_events).toContainEqual(expect.objectContaining({
      capability: 'tool_search', call_id: 'call_search', phase: 'output',
      details: expect.objectContaining(input[3]),
    }));
  });

  it('maps xAI-native tools without leaking OpenAI-only tools', () => {
    const converter = new OpenAIResponsesConverter();
    expect(converter.convertNativeTools([
      { capability: 'web_search' },
      { capability: 'x_search' },
      { capability: 'code_execution' },
    ], 'grok')).toEqual([
      { type: 'web_search' },
      { type: 'x_search' },
      { type: 'code_execution' },
    ]);
    expect(() => converter.convertNativeTools([
      { capability: 'computer_use' },
    ], 'grok')).toThrow(/xAI/);
  });

  it('resolves remote MCP authentication only through a named Connector', async () => {
    Connector.clear();
    Connector.create({
      name: 'mcp-crm',
      vendor: Vendor.Custom,
      auth: { type: 'api_key', apiKey: 'secret' },
    });
    const provider = new OpenAITextProvider({ apiKey: 'test' });
    const resolved = await (provider as any).resolveAdvancedCredentials({
      ...textOptions('gpt-5.4'),
      native_tools: [
        {
          capability: 'remote_mcp',
          server: {
            name: 'crm',
            url: 'https://mcp.example.com',
            authorization: { connector: 'mcp-crm' },
          },
        },
      ],
    });
    expect(resolved.native_tools[0].server.resolvedAuthorizationToken).toBe('secret');
    expect(resolved.native_tools[0].server.authorization).toEqual({ connector: 'mcp-crm' });
    Connector.clear();
  });

  it('honors the request-scoped connector registry for remote MCP credentials', async () => {
    Connector.clear();
    Connector.create({
      name: 'global-secret',
      vendor: Vendor.Custom,
      auth: { type: 'api_key', apiKey: 'must-not-be-read' },
    });
    const scopedRegistry = {
      get: vi.fn(() => {
        throw new Error('connector denied by scope');
      }),
    };
    const provider = new OpenAITextProvider({ apiKey: 'test' });

    await expect(
      (provider as any).resolveAdvancedCredentials({
        ...textOptions('gpt-5.4'),
        credential_context: { connectorRegistry: scopedRegistry },
        native_tools: [
          {
            capability: 'remote_mcp',
            server: {
              name: 'crm',
              url: 'https://mcp.example.com',
              authorization: { connector: 'global-secret' },
            },
          },
        ],
      }),
    ).rejects.toThrow('connector denied by scope');
    expect(scopedRegistry.get).toHaveBeenCalledWith('global-secret');
    Connector.clear();
  });

  it('validates remote MCP policy and URL before touching connector credentials', async () => {
    const scopedRegistry = { get: vi.fn() };
    const provider = new OpenAITextProvider({ apiKey: 'test' });

    await expect(
      provider.generate({
        ...textOptions('gpt-5.4'),
        credential_context: { connectorRegistry: scopedRegistry as any },
        native_tools: [
          {
            capability: 'remote_mcp',
            server: {
              name: 'crm',
              url: 'http://internal.example.com',
              authorization: { connector: 'mcp-crm' },
            },
          },
        ],
        data_handling: { allowThirdPartyTools: true },
        skipContextLimitCheck: true,
      }),
    ).rejects.toMatchObject({ capability: 'remote_mcp_requires_https' });
    expect(scopedRegistry.get).not.toHaveBeenCalled();

    await expect(
      provider.generate({
        ...textOptions('gpt-5.4'),
        credential_context: { connectorRegistry: scopedRegistry as any },
        native_tools: [
          {
            capability: 'remote_mcp',
            server: {
              name: 'crm',
              url: 'https://mcp.example.com',
              authorization: { connector: 'mcp-crm' },
            },
          },
        ],
        skipContextLimitCheck: true,
      }),
    ).rejects.toMatchObject({ capability: 'remote_mcp_blocked_by_data_policy' });
    expect(scopedRegistry.get).not.toHaveBeenCalled();
  });

  it('maps Google native tools, cache usage, and grounding citations', async () => {
    const converter = new GoogleConverter();
    const request = await converter.convertRequest({
      ...textOptions('gemini-2.5-pro'),
      native_tools: [{ capability: 'web_search' }, { capability: 'web_fetch' }],
    });
    expect(request.tools).toEqual([{ googleSearch: {} }, { urlContext: {} }]);

    const response = converter.convertResponse({
      modelVersion: 'gemini-2.5-pro',
      candidates: [
        {
          finishReason: 'STOP',
          content: {
            parts: [
              { text: 'grounded' },
              { executableCode: { language: 'PYTHON', code: 'print(1)' } },
              { codeExecutionResult: { outcome: 'OUTCOME_OK', output: '1' } },
            ],
          },
          groundingMetadata: {
            webSearchQueries: ['query'],
            groundingChunks: [{ web: { uri: 'https://example.com', title: 'Example' } }],
          },
          urlContextMetadata: {
            urlMetadata: [
              {
                retrievedUrl: 'https://example.com',
                urlRetrievalStatus: 'URL_RETRIEVAL_STATUS_SUCCESS',
              },
            ],
          },
        },
      ],
      usageMetadata: {
        promptTokenCount: 100,
        candidatesTokenCount: 10,
        totalTokenCount: 110,
        cachedContentTokenCount: 60,
      },
    });
    expect(response.usage.cached_input_tokens).toBe(60);
    expect(response.usage.native_tool_calls).toEqual({
      web_search: 1,
      web_fetch: 1,
      code_execution: 1,
    });
    expect(response.native_tool_events).toContainEqual({
      capability: 'web_search',
      status: 'completed',
    });
    expect((response.output[0] as any).content[0].annotations[0].url).toBe(
      'https://example.com',
    );
  });

  it('exposes executable capabilities rather than registry-only claims', () => {
    const anthropic = new AnthropicTextProvider({ apiKey: 'test' });
    const openai = new OpenAITextProvider({ apiKey: 'test' });
    const google = new GoogleTextProvider({ apiKey: 'test' });
    const grok = new GrokTextProvider('grok', {
      apiKey: 'test',
      baseURL: 'https://api.x.ai/v1',
    });
    expect(anthropic.getAdvancedCapabilities('claude-opus-4-6').batch.supported).toBe(true);
    expect(anthropic.getAdvancedCapabilities('claude-3-7-sonnet-20250219').structuredOutput.jsonSchema).toBe('prompt');
    expect(openai.getAdvancedCapabilities('gpt-6-astra').nativeTools).toContain('remote_mcp');
    expect(openai.getAdvancedCapabilities('gpt-6-astra').responsesExtensions).toEqual({
      asyncToolCalling: true,
      midTurnSteering: true,
      configurationUpdates: true,
      misalignmentMonitoring: true,
    });
    expect(openai.getAdvancedCapabilities('gpt-5.4').responsesExtensions?.asyncToolCalling).toBe(false);
    expect(openai.getAdvancedCapabilities('gpt-5.4').nativeTools).toContain('remote_mcp');
    expect(openai.getAdvancedCapabilities('gpt-4.1').nativeTools).not.toContain('hosted_shell');
    expect(openai.getAdvancedCapabilities('gpt-4.1').nativeTools).not.toContain('computer_use');
    expect(openai.getAdvancedCapabilities('gpt-5.2').nativeTools).toContain('apply_patch');
    expect(openai.getAdvancedCapabilities('gpt-5.2').nativeTools).not.toContain('tool_search');
    expect(openai.getAdvancedCapabilities('gpt-5.4').nativeTools).toContain('computer_use');
    expect(openai.getAdvancedCapabilities('gpt-5.4').nativeTools).toContain('tool_search');
    expect(openai.getAdvancedCapabilities('gpt-5.4').nativeToolOptions.remoteMcpApproval).toBe(false);
    expect(google.getAdvancedCapabilities('gemini-2.5-pro').nativeTools).toContain('web_search');
    expect(google.getAdvancedCapabilities('gemini-2.5-pro').structuredOutput.nativeWithTools).toBe(false);
    expect(google.getAdvancedCapabilities('gemini-3.1-pro-preview').structuredOutput.nativeWithTools).toBe(true);
    expect(anthropic.getAdvancedCapabilities('claude-opus-4-6').structuredOutput.nativeWithTools).toBe(false);
    expect(google.getAdvancedCapabilities('gemini-3.1-flash-image-preview').nativeTools).toEqual([]);
    expect(anthropic.getAdvancedCapabilities('claude-3-7-sonnet-20250219').nativeTools).toEqual([]);
    expect(anthropic.getAdvancedCapabilities('unknown-claude').batch.supported).toBe(false);
    expect(openai.getAdvancedCapabilities('unknown-openai').promptCaching.mode).toBe('unsupported');
    expect(google.getAdvancedCapabilities('unknown-gemini').batch.supported).toBe(false);
    expect(grok.getAdvancedCapabilities('grok-4.7').nativeTools).toEqual([
      'web_search',
      'x_search',
      'code_execution',
    ]);
    expect(grok.getAdvancedCapabilities('grok-4.6').nativeTools).toEqual([]);
    expect(grok.getAdvancedCapabilities('unknown-grok').nativeTools).toEqual([]);
  });

  it('drops unsupported non-strict caching and fails strict caching before execution', () => {
    const provider = new OpenAITextProvider({ apiKey: 'test' });
    const normalized = (provider as any).applyContextLimitGuardrail({
      ...textOptions('unknown-openai'),
      prompt_cache: { mode: 'auto' },
      data_handling: { allowProviderCaching: true },
      skipContextLimitCheck: true,
    });
    expect(normalized.prompt_cache).toBeUndefined();
    expect(() =>
      (provider as any).applyContextLimitGuardrail({
        ...textOptions('unknown-openai'),
        prompt_cache: { mode: 'auto', strict: true },
        data_handling: { allowProviderCaching: true },
        skipContextLimitCheck: true,
      }),
    ).toThrow(ProviderCapabilityNotSupportedError);
  });

  it('emits OpenAI content cache breakpoints only for enabled GPT-5.6+ requests', () => {
    const provider = new OpenAITextProvider({ apiKey: 'test' });
    const input = [{
      type: 'message',
      role: 'user',
      content: [{
        type: 'input_text',
        text: 'stable prefix',
        promptCacheBreakpoint: true,
      }],
    }];
    const normalize = (model: string, prompt_cache: Record<string, unknown>) =>
      (provider as any).applyContextLimitGuardrail({
        model,
        input,
        prompt_cache,
        data_handling: { allowProviderCaching: true },
        skipContextLimitCheck: true,
      });

    const unsupported = (provider as any).buildBatchBody(normalize('unknown-openai', {
      mode: 'auto',
    }));
    const preBreakpoints = (provider as any).buildBatchBody(normalize('gpt-5.4', {
      mode: 'auto',
      breakpointMode: 'explicit',
    }));
    const enabled = (provider as any).buildBatchBody(normalize('gpt-5.6-luna', {
      mode: 'auto',
      breakpointMode: 'explicit',
    }));
    const astra = (provider as any).buildBatchBody(normalize('gpt-6-astra', {
      mode: 'auto',
      breakpointMode: 'explicit',
    }));
    const implicitWithMarkedContent = (provider as any).buildBatchBody(normalize('gpt-5.6-luna', {
      mode: 'auto',
      breakpointMode: 'implicit',
    }));

    expect(unsupported.input[0].content[0]).not.toHaveProperty('prompt_cache_breakpoint');
    expect(preBreakpoints.input[0].content[0]).not.toHaveProperty('prompt_cache_breakpoint');
    expect(enabled.input[0].content[0].prompt_cache_breakpoint).toEqual({ mode: 'explicit' });
    expect(astra.input[0].content[0].prompt_cache_breakpoint).toEqual({ mode: 'explicit' });
    expect(implicitWithMarkedContent.input[0].content[0].prompt_cache_breakpoint)
      .toEqual({ mode: 'explicit' });
  });

  it('negotiates cache retention controls per concrete model', () => {
    const openai = new OpenAITextProvider({ apiKey: 'test' });
    const google = new GoogleTextProvider({ apiKey: 'test' });
    const downgraded = (openai as any).applyContextLimitGuardrail({
      ...textOptions('gpt-5'),
      prompt_cache: { mode: 'auto', ttl: 'extended', key: 'stable' },
      data_handling: { allowProviderCaching: true },
      skipContextLimitCheck: true,
    });
    expect(downgraded.prompt_cache).toEqual({
      mode: 'auto',
      ttl: undefined,
      key: 'stable',
    });
    expect(() =>
      (google as any).applyContextLimitGuardrail({
        ...textOptions('gemini-2.5-pro'),
        prompt_cache: { mode: 'auto', ttl: 'extended', strict: true },
        data_handling: { allowProviderCaching: true },
        skipContextLimitCheck: true,
      }),
    ).toThrow(ProviderCapabilityNotSupportedError);
  });

  it("treats prompt-cache 'off' as no library cache request, not a no-storage guarantee", () => {
    const openai = new OpenAITextProvider({ apiKey: 'test' });
    const normalized = (openai as any).applyContextLimitGuardrail({
      ...textOptions('gpt-5.4'),
      prompt_cache: { mode: 'off' },
      skipContextLimitCheck: true,
    });
    const body = (openai as any).buildBatchBody(normalized);

    expect(normalized.prompt_cache).toEqual({ mode: 'off' });
    expect(body).not.toHaveProperty('prompt_cache_key');
    expect(body).not.toHaveProperty('prompt_cache_retention');
  });

  it('normalizes unsupported native batch schemas to the prompt fallback', async () => {
    const provider = new AnthropicTextProvider({ apiKey: 'test' });
    const create = vi.fn().mockResolvedValue({
      id: 'batch_structured',
      processing_status: 'in_progress',
      created_at: '2026-07-24T00:00:00.000Z',
      expires_at: '2026-07-25T00:00:00.000Z',
      request_counts: {
        processing: 1,
        succeeded: 0,
        errored: 0,
        canceled: 0,
        expired: 0,
      },
    });
    (provider as any).client.beta.messages.batches.create = create;

    await provider.submitBatch(
      [
        {
          customId: 'legacy-schema',
          options: {
            ...textOptions('claude-3-7-sonnet-20250219'),
            response_format: {
              type: 'json_schema',
              json_schema: {
                name: 'answer',
                schema: {
                  type: 'object',
                  properties: { answer: { type: 'string' } },
                  required: ['answer'],
                },
              },
            },
          },
        },
      ],
      { dataHandling: { allowBatchRetention: true } },
    );

    const params = create.mock.calls[0]![0].requests[0].params;
    expect(params.output_config).toBeUndefined();
    expect(params.system).toContain('Respond with ONLY a single JSON value');
    expect(params.system).toContain('"answer"');
  });

  it('rejects malformed low-level schemas before a batch can be submitted', async () => {
    const provider = new AnthropicTextProvider({ apiKey: 'test' });
    const create = vi.fn();
    (provider as any).client.beta.messages.batches.create = create;

    await expect(
      provider.submitBatch(
        [
          {
            customId: 'invalid-schema',
            options: {
              ...textOptions('claude-opus-4-6'),
              response_format: { type: 'json_schema' },
            },
          },
        ],
        { dataHandling: { allowBatchRetention: true } },
      ),
    ).rejects.toMatchObject({
      capability: 'structured_output:json_schema_requires_schema',
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('puts Anthropic MCP batch beta configuration on the outer request', async () => {
    Connector.clear();
    Connector.create({
      name: 'mcp-batch',
      vendor: Vendor.Custom,
      auth: { type: 'api_key', apiKey: 'secret' },
    });
    const provider = new AnthropicTextProvider({ apiKey: 'test' });
    const create = vi.fn().mockResolvedValue({
      id: 'msgbatch_mcp',
      processing_status: 'in_progress',
      created_at: '2026-07-24T00:00:00.000Z',
      expires_at: '2026-07-25T00:00:00.000Z',
      request_counts: { processing: 1, succeeded: 0, errored: 0, canceled: 0, expired: 0 },
    });
    (provider as any).client.beta.messages.batches.create = create;

    await provider.submitBatch(
      [{
        customId: 'mcp',
        options: {
          ...textOptions('claude-opus-4-6'),
          native_tools: [{
            capability: 'remote_mcp',
            server: {
              name: 'crm',
              url: 'https://mcp.example.com',
              authorization: { connector: 'mcp-batch' },
            },
          }],
          data_handling: { allowThirdPartyTools: true },
        },
      }],
      { dataHandling: { allowBatchRetention: true } },
    );

    const request = create.mock.calls[0]![0];
    expect(request.betas).toEqual(['mcp-client-2025-11-20']);
    expect(request.requests[0].params).not.toHaveProperty('betas');
    expect(request.requests[0].params.mcp_servers).toEqual([
      expect.objectContaining({ name: 'crm', authorization_token: 'secret' }),
    ]);
    Connector.clear();
  });

  it('fails closed when retention-sensitive features lack explicit host permission', async () => {
    const provider = new OpenAITextProvider({ apiKey: 'test' });
    expect(() =>
      (provider as any).applyContextLimitGuardrail({
        ...textOptions('gpt-5.4'),
        prompt_cache: { mode: 'auto' },
        skipContextLimitCheck: true,
      }),
    ).toThrow(ProviderCapabilityNotSupportedError);
    expect(() =>
      (provider as any).applyContextLimitGuardrail({
        ...textOptions('gpt-5.4'),
        native_tools: [{ capability: 'web_search' }],
        skipContextLimitCheck: true,
      }),
    ).toThrow(ProviderCapabilityNotSupportedError);
    await expect(
      provider.submitBatch([{ customId: 'one', options: textOptions('gpt-5.4') }]),
    ).rejects.toMatchObject({ capability: 'batch_blocked_by_data_policy' });
  });

  it('validates required native-tool options before provider execution', () => {
    const openai = new OpenAITextProvider({ apiKey: 'test' });
    expect(() =>
      (openai as any).applyContextLimitGuardrail({
        ...textOptions('gpt-5.4'),
        native_tools: [{ capability: 'file_search' } as any],
        data_handling: { allowProviderTools: true },
        skipContextLimitCheck: true,
      }),
    ).toThrow(/file_search_requires_vector_store_ids/);

    expect(() =>
      (openai as any).applyContextLimitGuardrail({
        ...textOptions('gpt-5.4'),
        native_tools: [{
          capability: 'remote_mcp',
          server: {
            name: 'crm',
            url: 'https://mcp.example.com',
            requireApproval: 'always',
          },
        }],
        data_handling: { allowThirdPartyTools: true },
        skipContextLimitCheck: true,
      }),
    ).toThrow(/remote_mcp_approval_policy/);

    const anthropic = new AnthropicTextProvider({ apiKey: 'test' });
    expect(() =>
      (anthropic as any).applyContextLimitGuardrail({
        ...textOptions('claude-opus-4-8'),
        native_tools: [
          {
            capability: 'remote_mcp',
            server: {
              name: 'crm',
              url: 'https://mcp.example.com',
              requireApproval: 'always',
            },
          },
        ],
        data_handling: { allowThirdPartyTools: true },
        skipContextLimitCheck: true,
      }),
    ).toThrow(/remote_mcp_approval_policy/);
  });

  it('maps batch pricing and mixed cached input without treating all input as cached', () => {
    const standard = calculateCost('gpt-5.4', 1_000_000, 1_000_000);
    const optimized = calculateCost('gpt-5.4', 1_000_000, 1_000_000, {
      cachedInputTokens: 500_000,
      processingMode: 'batch',
    });
    expect(standard).not.toBeNull();
    expect(optimized).not.toBeNull();
    expect(optimized!).toBeLessThan(standard! * 0.5);

    expect(
      calculateCost('claude-opus-4-6', 100, 0, {
        cachedInputTokens: 30,
        cacheCreationInputTokens: 20,
        cacheCreationDetails: {
          shortTtlInputTokens: 10,
          extendedTtlInputTokens: 10,
        },
      }),
    ).toBeCloseTo(0.0004275, 10);
  });

  it('does not auto-retry an ambiguous Anthropic batch submission', async () => {
    const provider = new AnthropicTextProvider({ apiKey: 'test' });
    const create = vi.fn().mockRejectedValue(new Error('socket closed'));
    (provider as any).client.beta.messages.batches.create = create;

    await expect(
      provider.submitBatch(
        [{ customId: 'one', options: textOptions('claude-opus-4-6') }],
        { dataHandling: { allowBatchRetention: true } },
      ),
    ).rejects.toBeInstanceOf(ProviderAmbiguousOperationError);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(expect.any(Object), { maxRetries: 0 });
  });

  it('disables OpenAI SDK retries at the non-idempotent batch boundary', async () => {
    const provider = new OpenAITextProvider({ apiKey: 'test' });
    (provider as any).client.files.create = vi.fn().mockResolvedValue({ id: 'file_in' });
    const create = vi.fn().mockRejectedValue(new Error('socket closed'));
    (provider as any).client.batches.create = create;

    await expect(
      provider.submitBatch(
        [{ customId: 'one', options: textOptions('gpt-5.4') }],
        { dataHandling: { allowBatchRetention: true } },
      ),
    ).rejects.toBeInstanceOf(ProviderAmbiguousOperationError);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(expect.any(Object), { maxRetries: 0 });
  });

  it('preserves normal Responses options in OpenAI batch request bodies', () => {
    const provider = new OpenAITextProvider({ apiKey: 'test' });
    const body = (provider as any).buildBatchBody({
      ...textOptions('custom-openai-model'),
      temperature: 0.25,
      tool_choice: 'required',
      parallel_tool_calls: false,
      previous_response_id: 'resp_previous',
    });
    expect(body).toEqual(
      expect.objectContaining({
        temperature: 0.25,
        tool_choice: 'required',
        parallel_tool_calls: false,
        previous_response_id: 'resp_previous',
      }),
    );
  });

  it('normalizes Anthropic batch status and correlated partial results', async () => {
    const provider = new AnthropicTextProvider({ apiKey: 'test' });
    (provider as any).client.beta.messages.batches.retrieve = vi.fn().mockResolvedValue({
      id: 'batch_a',
      processing_status: 'ended',
      created_at: '2026-07-24T00:00:00.000Z',
      expires_at: '2026-07-25T00:00:00.000Z',
      request_counts: {
        processing: 0,
        succeeded: 1,
        errored: 1,
        canceled: 0,
        expired: 0,
      },
    });
    (provider as any).client.beta.messages.batches.results = vi.fn().mockResolvedValue(
      (async function* () {
        yield {
          custom_id: 'ok',
          result: {
            type: 'succeeded',
            message: {
              id: 'msg_ok',
              type: 'message',
              role: 'assistant',
              model: 'claude-opus-4-6',
              content: [{ type: 'text', text: 'done', citations: [] }],
              stop_reason: 'end_turn',
              stop_sequence: null,
              usage: { input_tokens: 2, output_tokens: 1 },
            },
          },
        };
        yield {
          custom_id: 'bad',
          result: {
            type: 'errored',
            error: { error: { type: 'rate_limit_error', message: 'slow down' } },
          },
        };
      })(),
    );

    expect(await provider.getBatch('batch_a')).toEqual(
      expect.objectContaining({
        id: 'batch_a',
        state: 'completed',
        requestCounts: expect.objectContaining({ total: 2, succeeded: 1, failed: 1 }),
      }),
    );
    const results = await collect(provider.getBatchResults('batch_a'));
    expect(results[0]).toEqual(
      expect.objectContaining({
        customId: 'ok',
        providerRequestId: 'msg_ok',
        response: expect.objectContaining({
          output_text: 'done',
          usage: expect.objectContaining({ processing_mode: 'batch' }),
        }),
      }),
    );
    expect(results[1]).toEqual(
      expect.objectContaining({
        customId: 'bad',
        error: expect.objectContaining({ code: 'rate_limit_error', message: 'slow down' }),
      }),
    );
  });

  it('normalizes OpenAI batch correlation and mixed result lines', async () => {
    const provider = new OpenAITextProvider({ apiKey: 'test' });
    (provider as any).client.batches.retrieve = vi.fn().mockResolvedValue({
      id: 'batch_o',
      status: 'completed',
      created_at: 1,
      output_file_id: 'file_out',
      error_file_id: 'file_err',
      request_counts: { total: 2, completed: 1, failed: 1 },
    });
    (provider as any).client.files.content = vi.fn(async (fileId: string) => ({
      text: async () =>
        fileId === 'file_out'
          ? JSON.stringify({
            custom_id: 'ok',
            response: {
              status_code: 200,
              request_id: 'req_ok',
              body: {
                id: 'resp_ok',
                object: 'response',
                created_at: 1,
                status: 'completed',
                model: 'gpt-5.4',
                output_text: 'done',
                output: [],
                usage: { input_tokens: 2, output_tokens: 1, total_tokens: 3 },
              },
            },
          })
          : JSON.stringify({
            custom_id: 'bad',
            response: { status_code: 429, request_id: 'req_bad' },
            error: { code: 'rate_limit_exceeded', message: 'slow down' },
          }),
    }));

    const results = await collect(provider.getBatchResults('batch_o'));
    expect(results[0]).toEqual(
      expect.objectContaining({
        customId: 'ok',
        providerRequestId: 'req_ok',
        response: expect.objectContaining({
          output_text: 'done',
          usage: expect.objectContaining({ processing_mode: 'batch' }),
        }),
      }),
    );
    expect(results[1]).toEqual(
      expect.objectContaining({
        customId: 'bad',
        error: expect.objectContaining({ code: 'rate_limit_exceeded', statusCode: 429 }),
      }),
    );
    expect((provider as any).client.files.content).toHaveBeenCalledWith('file_out');
    expect((provider as any).client.files.content).toHaveBeenCalledWith('file_err');
  });

  it('normalizes Google batch cancellation states and correlated partial results', async () => {
    const provider = new GoogleTextProvider({ apiKey: 'test' });
    const get = vi.fn().mockResolvedValue({
      name: 'batches/g',
      state: 'JOB_STATE_PARTIALLY_SUCCEEDED',
      completionStats: { successfulCount: '1', failedCount: '1', incompleteCount: '0' },
      dest: {
        inlinedResponses: [
          {
            metadata: { customId: 'ok' },
            response: {
              responseId: 'resp_g',
              modelVersion: 'gemini-2.5-pro',
              candidates: [
                { finishReason: 'STOP', content: { parts: [{ text: 'done' }] } },
              ],
              usageMetadata: {
                promptTokenCount: 2,
                candidatesTokenCount: 1,
                totalTokenCount: 3,
              },
            },
          },
          {
            metadata: { customId: 'bad' },
            error: { code: 429, message: 'slow down' },
          },
        ],
      },
    });
    (provider as any).client.batches.get = get;
    (provider as any).client.batches.cancel = vi.fn().mockResolvedValue(undefined);

    const results = await collect(provider.getBatchResults('batches/g'));
    expect(results[0]).toEqual(
      expect.objectContaining({
        customId: 'ok',
        providerRequestId: 'resp_g',
        response: expect.objectContaining({
          output_text: 'done',
          usage: expect.objectContaining({ processing_mode: 'batch' }),
        }),
      }),
    );
    expect(results[1]).toEqual(
      expect.objectContaining({
        customId: 'bad',
        error: expect.objectContaining({ code: '429', message: 'slow down' }),
      }),
    );
    expect(await provider.cancelBatch('batches/g')).toEqual(
      expect.objectContaining({ state: 'completed' }),
    );
    expect((provider as any).client.batches.cancel).toHaveBeenCalledWith({ name: 'batches/g' });
  });

  it('preserves expiry and cancellation as distinct terminal batch states', () => {
    const anthropic = new AnthropicTextProvider({ apiKey: 'test' });
    const openai = new OpenAITextProvider({ apiKey: 'test' });
    const google = new GoogleTextProvider({ apiKey: 'test' });
    expect(
      (anthropic as any).mapBatch({
        id: 'a',
        processing_status: 'ended',
        created_at: '2026-07-24T00:00:00.000Z',
        expires_at: '2026-07-25T00:00:00.000Z',
        request_counts: {
          processing: 0,
          succeeded: 0,
          errored: 0,
          canceled: 0,
          expired: 1,
        },
      }).state,
    ).toBe('expired');
    expect(
      (openai as any).mapBatch({
        id: 'o',
        status: 'cancelled',
        created_at: 1,
      }).state,
    ).toBe('cancelled');
    expect((google as any).mapGoogleBatchState('JOB_STATE_EXPIRED')).toBe('expired');
  });

  it('rejects unsupported batch completion windows before submission', async () => {
    const provider = new OpenAITextProvider({ apiKey: 'test' });
    const create = vi.fn();
    (provider as any).client.batches.create = create;
    await expect(
      provider.submitBatch(
        [{ customId: 'one', options: textOptions('gpt-5.4') }],
        { completionWindow: '2h' },
      ),
    ).rejects.toBeInstanceOf(ProviderCapabilityNotSupportedError);
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects a batch model not declared executable before submission', async () => {
    const provider = new AnthropicTextProvider({ apiKey: 'test' });
    const create = vi.fn();
    (provider as any).client.beta.messages.batches.create = create;
    await expect(
      provider.submitBatch([{ customId: 'one', options: textOptions('unknown-claude') }]),
    ).rejects.toMatchObject({ capability: 'batch', model: 'unknown-claude' });
    expect(create).not.toHaveBeenCalled();
  });
});
