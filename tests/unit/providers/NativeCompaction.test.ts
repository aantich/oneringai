import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenAITextProvider } from '../../../src/infrastructure/providers/openai/OpenAITextProvider.js';
import { AnthropicTextProvider } from '../../../src/infrastructure/providers/anthropic/AnthropicTextProvider.js';
import { OpenAIResponsesConverter } from '../../../src/infrastructure/providers/openai/OpenAIResponsesConverter.js';
import { AnthropicConverter } from '../../../src/infrastructure/providers/anthropic/AnthropicConverter.js';
import { nativeCompactionUsage, openAICompactedWindow } from '../../../src/infrastructure/providers/shared/nativeCompaction.js';
import { Agent, Connector, ContextCompactionStrategy, ContentType, MessageRole, ModelTask, Vendor, InMemoryEvidenceStorage } from '../../../src/index.js';
import type { TextGenerateOptions, InputItem } from '../../../src/index.js';

const request: TextGenerateOptions = { model: 'fixture', input: [{ type: 'message', role: MessageRole.USER,
  content: [{ type: ContentType.INPUT_TEXT, text: 'SOURCE' }] }] };
function anthropicSSE(value: Record<string, any>): Response {
  const events = [
    { type: 'message_start', message: { type: 'message', role: 'assistant', model: 'claude-sonnet-4-6', ...value, content: [], stop_reason: null, stop_sequence: null } },
    ...(value.content ?? []).flatMap((content_block: unknown, index: number) => [{ type: 'content_block_start', index, content_block }, { type: 'content_block_stop', index }]),
    { type: 'message_delta', delta: { stop_reason: value.stop_reason, stop_sequence: null }, usage: { output_tokens: 0, ...value.usage } },
    { type: 'message_stop' },
  ];
  return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });
}
const json = (value: unknown, status = 200) => (value as { stop_reason?: string })?.stop_reason === 'compaction'
  ? anthropicSSE(value as Record<string, any>)
  : new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const wireBody = async (input: RequestInfo | URL, init?: RequestInit) => input instanceof Request ? input.clone().json() : JSON.parse(String(init?.body));
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); Connector.clear(); });

describe('16A provider-native wire adapters', () => {
  it('preserves the complete OpenAI canonical window and exact replay fields', async () => {
    const output = [
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'RETAIN_USER' }] },
      { type: 'message', id: 'msg_a', role: 'assistant', phase: 'commentary', status: 'completed',
        content: [{ type: 'output_text', text: 'RETAIN_ASSISTANT', annotations: [], logprobs: [] }] },
      { type: 'compaction', id: 'cmp_a', encrypted_content: 'EXACT_CIPHERTEXT' },
    ];
    const sent: Record<string, unknown>[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input, init) => {
      sent.push(await wireBody(input, init));
      return String(input instanceof Request ? input.url : input).includes('input_tokens') ? json({ input_tokens: 120 })
        : json({ id: 'cmp_response', output, usage: { input_tokens: 1000, output_tokens: 50, total_tokens: 1050 } });
    }));
    const provider = new OpenAITextProvider({ apiKey: 'offline-fixture', maxRetries: 0 });
    const result = await provider.compaction.compact(request);
    expect(new OpenAIResponsesConverter().convertInput(result.input).input).toEqual(output);
    expect(result.usage).toMatchObject({ input_tokens: 1000, output_tokens: 50 });
    expect(provider.getAdvancedCapabilities('fixture').nativeCompaction!.onDemand).toBe('supported');
    expect(await provider.compaction.countInput({ ...request, input: result.input })).toBe(120);
    expect(sent[1]!.input).toEqual(output); expect(sent[0]).not.toHaveProperty('previous_response_id');
  });
  it('counts the same local tools/schema/reasoning controls used for OpenAI generation', async () => {
    let sent!: Record<string, any>;
    vi.stubGlobal('fetch', vi.fn(async (input, init) => { sent = await wireBody(input, init); return json({ input_tokens: 100 }); }));
    const provider = new OpenAITextProvider({ apiKey: 'offline-fixture' });
    await provider.compaction.countInput({ ...request, model: 'gpt-6-astra', thinking: { enabled: false }, parallel_tool_calls: false,
      tool_choice: 'required', tools: [{ type: 'function', function: { name: 'lookup', description: 'Read', parameters: { type: 'object', properties: {} } } }],
      response_format: { type: 'json_schema', json_schema: { name: 'answer', schema: { type: 'object', properties: {} }, strict: true } } });
    expect(sent.tools[0].name).toBe('lookup'); expect(sent.text.format.type).toBe('json_schema');
    expect(sent.tool_choice).toBe('required'); expect(sent.parallel_tool_calls).toBe(false);
  });
  it.each([
    { previous_response_id: 'server' }, { continuation_token: 'opaque' }, { native_tools: [{ type: 'web_search' }] },
    { vendorOptions: { context_management: [] } }, { vendorOptions: { compaction: true } }, { max_output_tokens: 200 },
  ])('rejects unsupported OpenAI ownership/caps before dispatch: %j', async extra => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const provider = new OpenAITextProvider({ apiKey: 'offline-fixture' });
    await expect(provider.compaction.compact({ ...request, ...extra } as TextGenerateOptions)).rejects.toThrow(); expect(fetch).not.toHaveBeenCalled();
  });
  it('discovers Anthropic capability and preserves its signed block, tool changes and beta exactly', async () => {
    const block = { type: 'compaction', content: 'SIGNED_SUMMARY', signature: 'EXACT_SIGNATURE', encrypted_content: 'EXACT_ENCRYPTED',
      tool_changes: { removed: ['old_tool'] } };
    const sent: Array<{ url: string; body: Record<string, any>; headers: Headers }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes('/models/')) return json({ id: 'fixture', type: 'model', capabilities: { compaction: { supported: true, summarize: { supported: true } } } });
      sent.push({ url, body: await wireBody(input, init), headers: new Headers(input instanceof Request ? input.headers : init?.headers) });
      if (url.includes('count_tokens')) return json({ input_tokens: 140 });
      return json({ id: 'msg_compact', type: 'message', role: 'assistant', model: 'fixture', stop_reason: 'compaction', content: [block],
        usage: { input_tokens: 0, output_tokens: 0, iterations: [{ type: 'compaction', input_tokens: 900, cache_read_input_tokens: 100, cache_creation_input_tokens: 10, output_tokens: 40 }] } });
    }));
    const provider = new AnthropicTextProvider({ apiKey: 'offline-fixture', maxRetries: 0 });
    const result = await provider.compaction.compact(request);
    expect(result.usage).toEqual({ input_tokens: 1010, output_tokens: 40, total_tokens: 1050, cached_input_tokens: 100, cache_creation_input_tokens: 10 });
    const replay = { ...request, nativeContext: true, input: [
      { type: 'message' as const, role: MessageRole.DEVELOPER, content: [{ type: ContentType.INPUT_TEXT as const, text: 'FRESH_HOST_CONTROLS' }] },
      { type: 'message' as const, role: MessageRole.USER, content: [{ type: ContentType.INPUT_TEXT as const, text: 'FRESH_SELECTED_DATA' }] }, ...result.input,
      { type: 'message' as const, role: MessageRole.USER, content: [{ type: ContentType.INPUT_TEXT as const, text: 'CURRENT_USER' }] },
    ] };
    expect(await provider.compaction.countInput(replay)).toBe(140);
    const converted = new AnthropicConverter().convertRequest(replay) as unknown as Record<string, any>;
    expect(converted.messages[0].content).toEqual([block]);
    expect(JSON.stringify(converted.system)).toContain('FRESH_HOST_CONTROLS');
    expect(JSON.stringify(converted.messages)).toContain('FRESH_SELECTED_DATA');
    expect(sent[0]!.body.compaction).toEqual({ type: 'summarize' });
    expect(sent[0]!.headers.get('anthropic-beta')).toContain('compact-2026-09-04');
    expect(sent[1]!.body.messages).toEqual(converted.messages);
    expect(sent[1]!.headers.get('anthropic-beta')).not.toContain('compact-2026-01-12');
  });
  it('rejects unverified Anthropic support before summary dispatch', async () => {
    const fetch = vi.fn(async () => json({ id: 'fixture', capabilities: { compaction: { supported: false } } })); vi.stubGlobal('fetch', fetch);
    const provider = new AnthropicTextProvider({ apiKey: 'offline-fixture' });
    await expect(provider.compaction.compact(request)).rejects.toThrow('on-demand compaction'); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each([undefined, {}, { input_tokens: 0, output_tokens: 0 }, { iterations: [] },
    { iterations: [{ type: 'compaction', input_tokens: 10 }] }, { iterations: [{ type: 'message', input_tokens: 10, output_tokens: 10 }] },
  ])('keeps absent/partial Anthropic native usage unknown: %j', value => { expect(nativeCompactionUsage(value, 'anthropic')).toBeNull(); });
  it('sums native iterations, retains cache TTL and pricing metadata, and ignores top-level zero usage', () => {
    expect(nativeCompactionUsage({ input_tokens: 0, output_tokens: 0, service_tier: 'priority', speed: 'fast', iterations: [
      { type: 'compaction', input_tokens: 10, output_tokens: 2, cache_read_input_tokens: 5, cache_creation_input_tokens: 6,
        cache_creation: { ephemeral_5m_input_tokens: 2, ephemeral_1h_input_tokens: 4 } },
      { type: 'compaction', input_tokens: 20, output_tokens: 3, cache_read_input_tokens: 2, cache_creation_input_tokens: 0, cache_creation: null },
    ] }, 'anthropic')).toEqual({ input_tokens: 43, output_tokens: 5, total_tokens: 48, service_tier: 'priority', speed: 'fast',
      cached_input_tokens: 7, cache_creation_input_tokens: 6, cache_creation_details: { short_ttl_input_tokens: 2, extended_ttl_input_tokens: 4 } });
  });
  it.each([
    { output: [] }, { output: [{ type: 'unknown' }] },
    { output: [{ type: 'compaction', id: 'a', encrypted_content: 'x', future: true }] },
  ])('refuses unsupported canonical output without dropping it: %j', ({ output }) => {
    expect(() => openAICompactedWindow(output)).toThrow();
  });
  it('counts auxiliary HTTP calls separately from billable native attempts in the shared ModelTask', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input, init) => {
      const url = String(input instanceof Request ? input.url : input); urls.push(url);
      const body = await wireBody(input, init);
      if (url.includes('input_tokens')) return json({ input_tokens: body.input.some((i: { type: string }) => i.type === 'compaction') ? 200 : 1000 });
      if (!url.includes('/compact')) throw new Error('Main dispatch must be denied');
      return json({ id: 'cmp_response', output: [{ type: 'compaction', id: 'cmp', encrypted_content: 'OPAQUE' }], usage: { input_tokens: 1000, output_tokens: 50, total_tokens: 1050 } });
    }));
    Connector.create({ name: 'native-wire', vendor: Vendor.OpenAI, auth: { type: 'api_key', apiKey: 'offline-fixture' } });
    const agent = Agent.create({ connector: 'native-wire', model: 'gpt-6-astra', context: { model: 'gpt-6-astra', features: { workingMemory: false, inContextMemory: false, evidence: true },
      compactionStrategy: new ContextCompactionStrategy({ plugins: 'off', history: { mode: 'native', preserveRecentTurns: 0 } }) } });
    const task = new ModelTask({ limits: { maxCalls: 1 } });
    try {
      agent.context.addUserMessage('Previous task'); agent.context.addAssistantResponse([{ type: 'message', role: MessageRole.ASSISTANT, content: [{ type: ContentType.OUTPUT_TEXT, text: 'Old details' }] }]);
      await agent.compactContext({ modelTask: task });
      await expect(agent.run('Next', { modelTask: task })).rejects.toThrow('maxCalls');
      expect(task.snapshot().totals.calls).toBe(1); expect(task.snapshot().invocations.map(i => i.purpose)).toEqual(['compactor']);
      expect(task.snapshot().attempts).toHaveLength(1);
      expect(urls.filter(url => url.includes('input_tokens')).length).toBeGreaterThan(3);
      expect(urls.filter(url => url.endsWith('/responses'))).toHaveLength(0);
    } finally { agent.destroy(); task.destroy(); }
  });
  it('rejects a stale native source before an SDK retry transport, without replacing history', async () => {
    let compactions = 0; let agent!: Agent;
    vi.stubGlobal('fetch', vi.fn(async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      await wireBody(input, init);
      if (url.includes('input_tokens')) return json({ input_tokens: 1000 });
      compactions++; agent.context.systemPrompt = 'CHANGED_DURING_RETRY';
      return json({ error: { type: 'server_error', message: 'Synthetic retry' } }, 503);
    }));
    Connector.create({ name: 'native-retry', vendor: Vendor.OpenAI, auth: { type: 'api_key', apiKey: 'offline-fixture' }, options: { maxRetries: 1 } });
    agent = Agent.create({ connector: 'native-retry', model: 'gpt-6-astra', context: { model: 'gpt-6-astra', features: { workingMemory: false, inContextMemory: false, evidence: true },
      compactionStrategy: new ContextCompactionStrategy({ plugins: 'off', history: { mode: 'native', preserveRecentTurns: 0 } }) } });
    try {
      agent.context.addUserMessage('Previous'); agent.context.addAssistantResponse([{ type: 'message', role: MessageRole.ASSISTANT, content: [{ type: ContentType.OUTPUT_TEXT, text: 'Old details' }] }]);
      await expect(agent.compactContext()).rejects.toThrow(); expect(compactions).toBe(1);
      expect(agent.context.getState()).not.toHaveProperty('nativeContinuation');
      expect(agent.getModelUsage()!.attempts.filter(a => a.dispatched)).toHaveLength(1);
    } finally { agent.destroy(); }
  });
  it('retains acknowledged usage when a billed native response cannot be normalized', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input, init) => {
      const url = String(input instanceof Request ? input.url : input); await wireBody(input, init);
      return url.includes('input_tokens') ? json({ input_tokens: 1000 })
        : json({ id: 'bad-native', output: [{ type: 'unverified_future_item' }], usage: { input_tokens: 1000, output_tokens: 50, total_tokens: 1050 } });
    }));
    Connector.create({ name: 'native-invalid', vendor: Vendor.OpenAI, auth: { type: 'api_key', apiKey: 'offline-fixture' } });
    const agent = Agent.create({ connector: 'native-invalid', model: 'gpt-6-astra', context: { model: 'gpt-6-astra', features: { workingMemory: false, inContextMemory: false, evidence: true },
      compactionStrategy: new ContextCompactionStrategy({ plugins: 'off', history: { mode: 'native', preserveRecentTurns: 0 } }) } });
    try {
      agent.context.addUserMessage('Previous task'); agent.context.addAssistantResponse([{ type: 'message', role: MessageRole.ASSISTANT, content: [{ type: ContentType.OUTPUT_TEXT, text: 'Old details' }] }]);
      await expect(agent.compactContext()).rejects.toThrow('Unsupported');
      expect(agent.context.getState()).not.toHaveProperty('nativeContinuation');
      expect(agent.getModelUsage()!.invocations[0]).toMatchObject({ status: 'failed', usage: { input_tokens: 1000, output_tokens: 50 } });
      expect(agent.getModelUsage()!.totals.unknownUsageInvocations).toBe(0);
    } finally { agent.destroy(); }
  });
});

describe('16A review corrections: SDK transport identity and complete counts', () => {
  const response = { id: 'resp_fixture', object: 'response', created_at: 1, model: 'gpt-6-astra', status: 'completed',
    output: [{ type: 'message', id: 'msg_fixture', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'DONE', annotations: [] }] }],
    usage: { input_tokens: 200, output_tokens: 10, total_tokens: 210 } };
  const nativeAgent = (vendor: Vendor, storage: InMemoryEvidenceStorage, name = 'native-scope', extra = {}) => Agent.create({
    connector: name, model: vendor === Vendor.Anthropic ? 'claude-sonnet-4-6' : 'gpt-6-astra', userId: 'owner', ...extra,
    context: { model: vendor === Vendor.Anthropic ? 'claude-sonnet-4-6' : 'gpt-6-astra', maxContextTokens: 3000, responseReserve: 100,
      features: { workingMemory: false, inContextMemory: false, evidence: true }, plugins: { evidence: { storage } },
      compactionStrategy: new ContextCompactionStrategy({ plugins: 'off', history: { mode: 'native', preserveRecentTurns: 0 }, automatic: false }) },
  });
  function nativeHTTP(vendor: Vendor) {
    const sent: Array<{ url: string; body: any; headers: Headers }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      const body = url.includes('/models/') ? undefined : await wireBody(input, init);
      sent.push({ url, body, headers: new Headers(input instanceof Request ? input.headers : init?.headers) });
      if (url.includes('/models/')) return json({ id: 'fixture', capabilities: { compaction: { supported: true, summarize: { supported: true } } } });
      if (url.includes('input_tokens') || url.includes('count_tokens')) return json({ input_tokens: JSON.stringify(body).includes('"type":"compaction"') ? 200 : 1000 });
      if (vendor === Vendor.OpenAI) return json({ id: 'cmp_fixture', output: [{ type: 'compaction', id: 'cmp', encrypted_content: 'STATE_FROM_A' }],
        usage: { input_tokens: 1000, output_tokens: 10, total_tokens: 1010 } });
      return json({ id: 'msg_compact', type: 'message', role: 'assistant', model: 'claude-sonnet-4-6', stop_reason: 'compaction',
        content: [{ type: 'compaction', content: 'SUMMARY_FROM_A', signature: 'SIGNATURE_FROM_A' }],
        usage: { iterations: [{ type: 'compaction', input_tokens: 1000, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }] } });
    }));
    return sent;
  }
  const scopeCases = [
    [Vendor.OpenAI, 'environment-url'], [Vendor.Anthropic, 'environment-url'],
    [Vendor.OpenAI, 'configured-url'], [Vendor.Anthropic, 'configured-url'],
    [Vendor.OpenAI, 'environment-project'], [Vendor.OpenAI, 'environment-organization'],
    [Vendor.OpenAI, 'configured-project'], [Vendor.OpenAI, 'configured-organization'],
  ] as const;
  it.each(scopeCases)('%s keeps the SDK scope and saved binding aligned across %s changes', async (vendor, kind) => {
    const urlVariable = vendor === Vendor.OpenAI ? 'OPENAI_BASE_URL' : 'ANTHROPIC_BASE_URL';
    vi.stubEnv(urlVariable, 'https://service-a.invalid');
    vi.stubEnv('OPENAI_PROJECT_ID', 'project-a'); vi.stubEnv('OPENAI_ORG_ID', 'org-a');
    const sent = nativeHTTP(vendor);
    const connector = Connector.create({ name: 'native-scope', vendor, auth: { type: 'api_key', apiKey: 'offline-fixture' },
      ...(kind === 'configured-url' ? { baseURL: 'https://service-a.invalid' } : {}),
      options: { maxRetries: 0, ...(kind === 'configured-project' ? { project: 'project-a' } : {}),
        ...(kind === 'configured-organization' ? { organization: 'org-a' } : {}) } });
    const storage = new InMemoryEvidenceStorage({ scope: { ownerId: 'owner', namespace: 'native-scope' } });
    const agent = nativeAgent(vendor, storage); let next: Agent | undefined;
    try {
      agent.context.addUserMessage('Old task'); agent.context.addAssistantResponse([{ type: 'message', role: MessageRole.ASSISTANT,
        content: [{ type: ContentType.OUTPUT_TEXT, text: 'Historical facts '.repeat(40) }] }]);
      expect((await agent.compactContext()).history.status).toBe('compacted'); const saved = structuredClone(agent.context.getState());
      expect(sent.every(item => item.url.startsWith('https://service-a.invalid/'))).toBe(true);
      if (vendor === Vendor.OpenAI) for (const item of sent) {
        expect(item.headers.get('openai-project')).toBe('project-a'); expect(item.headers.get('openai-organization')).toBe('org-a');
      }
      const before = sent.length;
      if (kind === 'environment-url') vi.stubEnv(urlVariable, 'https://service-b.invalid');
      if (kind === 'configured-url') connector.config.baseURL = 'https://service-b.invalid';
      if (kind === 'environment-project') vi.stubEnv('OPENAI_PROJECT_ID', 'project-b');
      if (kind === 'environment-organization') vi.stubEnv('OPENAI_ORG_ID', 'org-b');
      if (kind === 'configured-project') connector.config.options = { ...connector.config.options, project: 'project-b' };
      if (kind === 'configured-organization') connector.config.options = { ...connector.config.options, organization: 'org-b' };
      await expect(agent.compactContext()).rejects.toThrow('transport configuration changed');
      expect(sent).toHaveLength(before); expect(agent.context.getState().nativeContinuation).toEqual(saved.nativeContinuation);
      expect(agent.getModelUsage()!.totals.calls).toBe(0);
      next = nativeAgent(vendor, storage);
      expect(() => next!.context.restoreState(saved)).toThrow('binding');
      expect(next.context.getConversation()).toHaveLength(0); expect(sent).toHaveLength(before);
    } finally { agent.destroy(); next?.destroy(); }
  });
  it.each([Vendor.OpenAI, Vendor.Anthropic])('%s rejects drift before the first compaction, without relabelling an unused SDK', async vendor => {
    const variable = vendor === Vendor.OpenAI ? 'OPENAI_BASE_URL' : 'ANTHROPIC_BASE_URL';
    vi.stubEnv(variable, 'https://service-a.invalid'); const sent = nativeHTTP(vendor);
    Connector.create({ name: 'native-scope', vendor, auth: { type: 'api_key', apiKey: 'offline-fixture' }, options: { maxRetries: 0 } });
    const storage = new InMemoryEvidenceStorage({ scope: { ownerId: 'owner', namespace: 'native-scope' } });
    const agent = nativeAgent(vendor, storage); const put = vi.spyOn(storage, 'put');
    try {
      agent.context.addUserMessage('Old task'); agent.context.addAssistantResponse([{ type: 'message', role: MessageRole.ASSISTANT,
        content: [{ type: ContentType.OUTPUT_TEXT, text: 'Historical facts' }] }]);
      vi.stubEnv(variable, 'https://service-b.invalid');
      await expect(agent.compactContext()).rejects.toThrow('transport configuration changed');
      expect(sent).toHaveLength(0); expect(put).not.toHaveBeenCalled(); expect(agent.context.getState().nativeContinuation).toBeUndefined();
      vi.stubEnv(variable, 'https://service-a.invalid'); await agent.compactContext();
      expect(sent.every(item => item.url.startsWith('https://service-a.invalid/'))).toBe(true);
    } finally { agent.destroy(); }
  });
  for (const mode of ['run', 'stream'] as const) it.each([false, true])(`${mode} counts raw prompt controls with normalized precedence=%s`, async normalized => {
    const sent: Record<string, any>[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input, init) => {
      const body = await wireBody(input, init); sent.push(body);
      if (String(input instanceof Request ? input.url : input).includes('input_tokens')) return json({ input_tokens: 100 });
      if (body.stream) return new Response(`event: response.completed\ndata: ${JSON.stringify({ type: 'response.completed', response })}\n\n`, { headers: { 'content-type': 'text/event-stream' } });
      return json(response);
    }));
    const provider = new OpenAITextProvider({ apiKey: 'offline-fixture', maxRetries: 0 });
    const options: TextGenerateOptions = { model: 'gpt-6-astra', input: 'SOURCE', nativeContext: true, skipContextLimitCheck: true,
      vendorOptions: { instructions: 'RAW_INSTRUCTIONS', text: { format: { type: 'json_object' }, verbosity: 'low' },
        reasoning: { effort: 'low' }, tool_choice: 'none', parallel_tool_calls: false, personality: 'pragmatic' },
      ...(normalized ? { instructions: 'NORMALIZED_INSTRUCTIONS', thinking: { enabled: true, effort: 'medium' }, tool_choice: 'auto', parallel_tool_calls: true,
        response_format: { type: 'json_schema', json_schema: { name: 'answer', schema: { type: 'object', properties: {}, additionalProperties: false }, strict: true } } } as Partial<TextGenerateOptions> : {}) };
    await provider.compaction.countInput(options);
    if (mode === 'run') await provider.generate(options); else for await (const _event of provider.streamGenerate(options)) { /* drain */ }
    const projection = Object.fromEntries(Object.keys(sent[0]!).map(key => [key, sent[1]![key]]));
    expect(sent[0]).toEqual(projection); expect(sent[0]!.instructions).toBe(normalized ? 'NORMALIZED_INSTRUCTIONS' : 'RAW_INSTRUCTIONS');
    expect(sent[0]!.text.format.type).toBe(normalized ? 'json_schema' : 'json_object');
    expect(sent[0]!.reasoning.effort).toBe(normalized ? 'medium' : 'low'); expect(sent[0]!.parallel_tool_calls).toBe(normalized);
  });
  it.each(['prompt', 'future_input', 'background', 'max_output_tokens'])('rejects uncountable raw %s on the opted-in native path and preserves legacy use', async key => {
    const bodies: any[] = []; const fetch = vi.fn(async (input, init) => { bodies.push(await wireBody(input, init)); return json(response); }); vi.stubGlobal('fetch', fetch);
    const provider = new OpenAITextProvider({ apiKey: 'offline-fixture', maxRetries: 0 });
    const options = { model: 'gpt-6-astra', input: 'SOURCE', skipContextLimitCheck: true, vendorOptions: { [key]: 'RAW_CONTROL' } };
    await expect(provider.compaction.countInput(options)).rejects.toThrow('faithfully counted'); expect(fetch).not.toHaveBeenCalled();
    await provider.generate(options); expect(bodies[0][key]).toBe('RAW_CONTROL');
  });
  it.each(['run', 'stream'] as const)('%s stops an oversized effective frame after a raw-instructions hook', async mode => {
    const bodies: any[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input, init) => { const body = await wireBody(input, init); bodies.push(body);
      return String(input instanceof Request ? input.url : input).includes('input_tokens') ? json({ input_tokens: body.instructions?.length > 10000 ? 12000 : 500 }) : json(response); }));
    Connector.create({ name: 'native-scope', vendor: Vendor.OpenAI, auth: { type: 'api_key', apiKey: 'offline-fixture' }, options: { maxRetries: 0 } });
    const storage = new InMemoryEvidenceStorage({ scope: { ownerId: 'owner', namespace: 'native-scope' } });
    const agent = nativeAgent(Vendor.OpenAI, storage); const put = vi.spyOn(storage, 'put');
    agent.registerHook('before:llm', async ({ options }: { options: TextGenerateOptions }) => { options.vendorOptions = { instructions: 'RAW_OVERSIZE '.repeat(2500) }; });
    try {
      const operation = mode === 'run' ? agent.run('Next') : (async () => { for await (const _event of agent.stream('Next')) { /* drain */ } })();
      await expect(operation).rejects.toThrow('cannot fit'); expect(bodies.some(body => body.instructions?.length > 10000)).toBe(true);
      expect(bodies.every(body => body.store === undefined)).toBe(true); expect(put).not.toHaveBeenCalled(); expect(agent.getModelUsage()!.totals.calls).toBe(0);
    } finally { agent.destroy(); }
  });
});

describe('16A second-review provider admission', () => {
  const reasoning = [
    { type: 'reasoning' as const, id: 'reason', summary: 'EXACT_REASONING_FACT' },
    { type: 'reasoning' as const, id: 'reason', encrypted_content: 'OPAQUE_REASONING_STATE' },
    { type: 'reasoning' as const, id: 'reason', summary: 'EXACT_REASONING_FACT', encrypted_content: 'OPAQUE_REASONING_STATE' },
  ];
  for (const operation of ['countInput', 'compact'] as const) it.each(reasoning)(`rejects Anthropic ${operation} before discovery for %j`, async item => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const provider = new AnthropicTextProvider({ apiKey: 'synthetic-offline', maxRetries: 0 });
    await expect(provider.compaction[operation]({ ...request, model: 'claude-sonnet-4-6', input: [item, ...(request.input as InputItem[])] })).rejects.toThrow('top-level reasoning');
    expect(fetch).not.toHaveBeenCalled();
  });
  for (const mode of ['manual', 'run', 'stream'] as const) for (const position of ['prefix', 'recent'] as const) {
    it.each(reasoning.slice(0, 2))(`rejects unsupported reasoning in ${position} before managed ${mode}: %j`, async item => {
      const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
      const connector = Connector.create({ name: 'anthropic-reasoning', vendor: Vendor.Anthropic, auth: { type: 'api_key', apiKey: 'synthetic-offline' }, options: { maxRetries: 0 } });
      const storage = new InMemoryEvidenceStorage({ scope: { ownerId: 'owner', namespace: 'reasoning' } }); const put = vi.spyOn(storage, 'put');
      const agent = Agent.create({ connector: connector.name, model: 'claude-sonnet-4-6', userId: 'owner',
        context: { model: 'claude-sonnet-4-6', maxContextTokens: 5000, responseReserve: 100, criticalCompactionThreshold: .3,
          features: { workingMemory: false, inContextMemory: false, evidence: true }, plugins: { evidence: { storage } },
          compactionStrategy: new ContextCompactionStrategy({ plugins: 'auto', history: 'native' }) } });
      try {
        for (let index = 0; index < 4; index++) {
          agent.context.addUserMessage(`USER_${index}`);
          agent.context.addAssistantResponse([...(index === (position === 'prefix' ? 0 : 3) ? [item] : []),
            { type: 'message', role: MessageRole.ASSISTANT, content: [{ type: ContentType.OUTPUT_TEXT, text: 'Historical details. '.repeat(200) }] }]);
        }
        const before = structuredClone(agent.context.getConversation());
        const operation = mode === 'manual' ? agent.compactContext()
          : mode === 'run' ? agent.run('Next') : (async () => { for await (const _event of agent.stream('Next')) { /* drain */ } })();
        await expect(operation).rejects.toThrow('top-level reasoning');
        expect(agent.context.getConversation()).toEqual(before); expect(agent.context.getState().nativeContinuation).toBeUndefined();
        expect(put).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled(); expect(agent.getModelUsage()!.totals.calls).toBe(0);
      } finally { agent.destroy(); }
    });
  }
  it('preserves OpenAI reasoning in the actual count and compact request bodies', async () => {
    const sent: Record<string, any>[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input, init) => {
      sent.push(await wireBody(input, init));
      return String(input instanceof Request ? input.url : input).includes('input_tokens') ? json({ input_tokens: 300 })
        : json({ id: 'cmp_response', output: [{ type: 'compaction', id: 'cmp', encrypted_content: 'OPAQUE' }], usage: { input_tokens: 1000, output_tokens: 50, total_tokens: 1050 } });
    }));
    const provider = new OpenAITextProvider({ apiKey: 'synthetic-offline', maxRetries: 0 });
    const options = { ...request, model: 'gpt-6-astra', input: [...(request.input as InputItem[]), reasoning[2]!] };
    await provider.compaction.countInput(options); await provider.compaction.compact(options);
    for (const wire of sent) expect(wire.input.find((item: InputItem) => item.type === 'reasoning')).toMatchObject({
      type: 'reasoning', id: 'reason', summary: [{ type: 'summary_text', text: 'EXACT_REASONING_FACT' }], encrypted_content: 'OPAQUE_REASONING_STATE' });
  });
  it('preserves valid Anthropic nested signed thinking when counting native input', async () => {
    const sent: Record<string, any>[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input, init) => {
      if (String(input instanceof Request ? input.url : input).includes('/models/')) return json({ id: 'claude-sonnet-4-6', capabilities: { compaction: { supported: true, summarize: { supported: true } } } });
      sent.push(await wireBody(input, init)); return json({ input_tokens: 300 });
    }));
    const provider = new AnthropicTextProvider({ apiKey: 'synthetic-offline', maxRetries: 0 });
    await provider.compaction.countInput({ ...request, model: 'claude-sonnet-4-6', input: [
      ...(request.input as InputItem[]), { type: 'message', role: MessageRole.ASSISTANT,
        content: [{ type: ContentType.THINKING, thinking: 'SIGNED_THINKING', signature: 'EXACT_SIGNATURE', persistInHistory: true }, { type: ContentType.OUTPUT_TEXT, text: 'Answer' }] },
      { type: 'message', role: MessageRole.USER, content: [{ type: ContentType.INPUT_TEXT, text: 'Next' }] },
    ] });
    expect(sent[0]!.messages[1].content[0]).toMatchObject({ type: 'thinking', thinking: 'SIGNED_THINKING', signature: 'EXACT_SIGNATURE' });
    // Ordinary conversion retains its existing behavior; native admission is opt-in.
    expect(() => new AnthropicConverter().convertRequest({ ...request, input: [reasoning[0]!, ...(request.input as InputItem[])] })).not.toThrow();
  });
});

describe('16A third-review nested replay and native thinking limits', () => {
  const signed = { type: ContentType.THINKING as const, thinking: 'SIGNED_FACT_37', signature: 'SIGNED_OPAQUE', persistInHistory: true };
  const encrypted = { type: ContentType.THINKING as const, thinking: 'ENCRYPTED_FACT_37', providerItemId: 'rs_fact', providerMetadata: { encrypted_content: 'ENCRYPTED_OPAQUE' }, persistInHistory: true };
  const variants = [
    [Vendor.OpenAI, signed], [Vendor.Anthropic, encrypted],
    [Vendor.OpenAI, { ...encrypted, providerItemId: '' }], [Vendor.OpenAI, { ...encrypted, providerMetadata: { encrypted_content: '' } }],
    [Vendor.Anthropic, { ...signed, signature: '' }], [Vendor.Anthropic, { ...signed, signature: undefined }],
    [Vendor.OpenAI, { ...encrypted, signature: 'FOREIGN_SIGNATURE' }], [Vendor.Anthropic, { ...signed, providerItemId: 'FOREIGN_ID' }],
  ] as const;
  for (const [vendor, block] of variants) for (const operation of ['countInput', 'compact'] as const) {
    it(`${vendor} rejects unreplayable nested thinking before ${operation}: ${JSON.stringify(block)}`, async () => {
      const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
      const provider = vendor === Vendor.OpenAI ? new OpenAITextProvider({ apiKey: 'synthetic-offline' }) : new AnthropicTextProvider({ apiKey: 'synthetic-offline' });
      const input: InputItem[] = [...request.input as InputItem[], { type: 'message', role: MessageRole.ASSISTANT, content: [block, { type: ContentType.OUTPUT_TEXT, text: 'Answer' }] }];
      await expect(provider.compaction[operation]({ ...request, input })).rejects.toThrow(/nested thinking/);
      expect(fetch).not.toHaveBeenCalled();
    });
  }
  for (const vendor of [Vendor.OpenAI, Vendor.Anthropic]) for (const mode of ['manual', 'run', 'stream'] as const) for (const position of ['prefix', 'recent', 'pending'] as const) {
    it(`${vendor} rejects foreign thinking in ${position} before ${mode} mutates or bills`, async () => {
      const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
      const connector = Connector.create({ name: 'nested-replay', vendor, auth: { type: 'api_key', apiKey: 'synthetic-offline' } });
      const model = vendor === Vendor.OpenAI ? 'gpt-6-astra' : 'claude-sonnet-4-6';
      const storage = new InMemoryEvidenceStorage({ scope: { ownerId: 'owner', namespace: 'nested' } }); const put = vi.spyOn(storage, 'put');
      const agent = Agent.create({ connector: connector.name, model, userId: 'owner', context: { model, maxContextTokens: 5000, responseReserve: 100, criticalCompactionThreshold: .3,
        features: { workingMemory: false, inContextMemory: false, evidence: true }, plugins: { evidence: { storage } },
        compactionStrategy: new ContextCompactionStrategy({ plugins: 'auto', history: 'native' }) } });
      try {
        const thinking = vendor === Vendor.OpenAI ? signed : encrypted;
        for (let i = 0; i < 4; i++) {
          agent.context.addUserMessage(`USER_${i}`);
          agent.context.addAssistantResponse([{ type: 'message', role: MessageRole.ASSISTANT, content: [
            ...(i === (position === 'prefix' ? 0 : position === 'recent' ? 3 : -1) ? [thinking] : []), { type: ContentType.OUTPUT_TEXT, text: 'Historical detail. '.repeat(200) }] }]);
        }
        if (position === 'pending') agent.context.addUserMessage([thinking, { type: ContentType.INPUT_TEXT, text: 'Pending' }]);
        const before = structuredClone(agent.context.getConversation());
        let hooks = 0; agent.context.setBeforeCompactionCallback(async () => { hooks++; });
        const input: InputItem[] | string = position === 'pending' ? [] : 'Next';
        const action = mode === 'manual' ? agent.compactContext() : mode === 'run' ? agent.run(input) : (async () => { for await (const _event of agent.stream(input)) { /* drain */ } })();
        await expect(action).rejects.toThrow(/nested thinking/);
        expect(agent.context.getConversation()).toEqual(before); expect(agent.context.getState().nativeContinuation).toBeUndefined();
        expect(hooks).toBe(0); expect(fetch).not.toHaveBeenCalled(); expect(put).not.toHaveBeenCalled(); expect(agent.getModelUsage()!.totals.calls).toBe(0);
      } finally { agent.destroy(); }
    });
  }
  it.each([1024, 4096, 8192, 10000])('allocates fixed thinking budget %i plus summary space on Anthropic native requests', async budgetTokens => {
    const sent: Record<string, any>[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input, init) => {
      if (String(input instanceof Request ? input.url : input).includes('/models/')) return json({ id: 'claude-sonnet-4-6', capabilities: { compaction: { supported: true, summarize: { supported: true } } } });
      sent.push(await wireBody(input, init));
      return json({ id: 'msg_native', stop_reason: 'compaction', content: [{ type: 'compaction', content: 'SUMMARY', signature: 'EXACT_SIGNATURE' }], usage: { iterations: [{ type: 'compaction', input_tokens: 1000, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }] } });
    }));
    const provider = new AnthropicTextProvider({ apiKey: 'synthetic-offline', maxRetries: 0 });
    const thinking = { enabled: true, mode: 'enabled' as const, budgetTokens };
    await provider.compaction.compact({ ...request, model: 'claude-sonnet-4-6', thinking });
    expect(sent[0]!.thinking).toEqual({ type: 'enabled', budget_tokens: budgetTokens }); expect(sent[0]!.max_tokens).toBe(budgetTokens + 4096);
    expect(thinking.budgetTokens).toBe(budgetTokens);
  });
  it('respects an explicit native output cap above 4096 instead of clamping it', async () => {
    let sent: Record<string, any> = {};
    vi.stubGlobal('fetch', vi.fn(async (input, init) => {
      if (String(input instanceof Request ? input.url : input).includes('/models/')) return json({ id: 'claude-sonnet-4-6', capabilities: { compaction: { supported: true, summarize: { supported: true } } } });
      sent = await wireBody(input, init); return json({ id: 'msg_native', stop_reason: 'compaction', content: [{ type: 'compaction', content: 'SUMMARY', signature: 'SIGNED' }], usage: {} });
    }));
    const provider = new AnthropicTextProvider({ apiKey: 'synthetic-offline' });
    await provider.compaction.compact({ ...request, model: 'claude-sonnet-4-6', thinking: { enabled: true, mode: 'enabled', budgetTokens: 8192 }, max_output_tokens: 10000 });
    expect(sent.max_tokens).toBe(10000);
  });
});

describe('16A third-review managed Anthropic output admission', () => {
  function http() {
    const sent: Array<{ url: string; body: Record<string, any> }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes('/models/')) return json({ id: 'claude-sonnet-4-6', capabilities: { compaction: { supported: true, summarize: { supported: true } } } });
      const body = await wireBody(input, init); sent.push({ url, body });
      if (url.includes('count_tokens')) return json({ input_tokens: JSON.stringify(body).includes('"type":"compaction"') ? 200 : 4800 });
      if (body.compaction) return json({ id: 'msg_native', stop_reason: 'compaction', content: [{ type: 'compaction', content: 'SUMMARY_FACT_37', signature: 'SIGNED' }],
        usage: { iterations: [{ type: 'compaction', input_tokens: 1000, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }] } });
      const events = [
        { type: 'message_start', message: { id: 'msg_main', type: 'message', role: 'assistant', model: body.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 200, output_tokens: 0 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ANSWER_37' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 10 } }, { type: 'message_stop' },
      ];
      return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });
    }));
    return sent;
  }
  function fixture(limits: { maxOutputTokensPerCall?: number } = {}, thinking: NonNullable<TextGenerateOptions['thinking']> = { enabled: true, mode: 'enabled', budgetTokens: 8192 }) {
    const connector = Connector.create({ name: 'thinking-admission', vendor: Vendor.Anthropic, auth: { type: 'api_key', apiKey: 'synthetic-offline' } });
    const storage = new InMemoryEvidenceStorage({ scope: { ownerId: 'owner', namespace: 'thinking' } });
    const agent = Agent.create({ connector: connector.name, model: 'claude-sonnet-4-6', userId: 'owner', thinking, modelExecution: limits,
      context: { model: 'claude-sonnet-4-6', maxContextTokens: 5000, responseReserve: 100, criticalCompactionThreshold: .3,
        features: { workingMemory: false, inContextMemory: false, evidence: true }, plugins: { evidence: { storage } },
        compactionStrategy: new ContextCompactionStrategy({ plugins: 'off', history: { mode: 'native', preserveRecentTurns: 0 } }) } });
    agent.context.addUserMessage('Prior user'); agent.context.addAssistantResponse([{ type: 'message', role: MessageRole.ASSISTANT, content: [{ type: ContentType.OUTPUT_TEXT, text: 'Historical detail. '.repeat(80) }] }]);
    return { agent, storage };
  }
  it.each(['manual', 'run', 'stream'] as const)('uses the same native wire/reservation bound and preserves main thinking: %s', async mode => {
    const sent = http(), f = fixture(); const task = new ModelTask({ limits: { maxCalls: 3 } });
    const execute = vi.spyOn(task, 'execute');
    try {
      if (mode === 'manual') await f.agent.compactContext({ modelTask: task });
      else if (mode === 'run') expect((await f.agent.run('Next', { modelTask: task })).output_text).toBe('ANSWER_37');
      else for await (const _event of f.agent.stream('Next', { modelTask: task })) { /* drain */ }
      const native = sent.find(item => !item.url.includes('/count_tokens') && item.body.compaction)!.body;
      expect(native.max_tokens).toBe(12288); expect(native.thinking).toEqual({ type: 'enabled', budget_tokens: 8192 });
      expect(execute.mock.calls.find(([descriptor]) => descriptor.purpose === 'compactor')![0].outputTokenBound).toBe(native.max_tokens);
      if (mode !== 'manual') {
        const main = sent.find(item => item.body.stream && !item.body.compaction)!.body;
        expect(main.max_tokens).toBe(64000); expect(main.thinking).toEqual(native.thinking);
      }
      expect(task.snapshot().totals.unknownUsageInvocations).toBe(0); expect(f.agent.context.getState().nativeContinuation).toBeDefined();
    } finally { f.agent.destroy(); task.destroy(); }
  });
  it.each([4096, 8192])('rejects a conflicting host cap of %i before hooks, counting and archive', async cap => {
    const sent = http(), f = fixture({ maxOutputTokensPerCall: cap }, { enabled: false }); const put = vi.spyOn(f.storage, 'put');
    let hooks = 0; f.agent.context.setBeforeCompactionCallback(async () => { hooks++; });
    try {
      await expect(f.agent.run('Next', { thinking: { enabled: true, mode: 'enabled', budgetTokens: 8192 } })).rejects.toThrow(/thinking budgetTokens/);
      expect(sent).toHaveLength(0); expect(put).not.toHaveBeenCalled(); expect(hooks).toBe(0); expect(f.agent.getModelUsage()!.totals.calls).toBe(0);
      await f.agent.compactContext(); expect(sent.find(item => !item.url.includes('/count_tokens') && item.body.compaction)!.body.max_tokens).toBe(cap);
    } finally { f.agent.destroy(); }
  });
  it('respects a valid host cap rather than increasing it for the summary allowance', async () => {
    const sent = http(), f = fixture({ maxOutputTokensPerCall: 10000 });
    try { await f.agent.compactContext(); expect(sent.find(item => !item.url.includes('/count_tokens') && item.body.compaction)!.body.max_tokens).toBe(10000); }
    finally { f.agent.destroy(); }
  });
  it('reserves native source headroom for fixed thinking before archival', async () => {
    const sent = http(), f = fixture(); const put = vi.spyOn(f.storage, 'put');
    const provider = (f.agent as unknown as { _provider: AnthropicTextProvider })._provider;
    const original = provider.getModelCapabilities.bind(provider);
    vi.spyOn(provider, 'getModelCapabilities').mockImplementation(model => ({ ...original(model), maxInputTokens: 16000, maxTokens: 16000 }));
    try {
      await expect(f.agent.compactContext()).rejects.toThrow('source cannot fit');
      expect(put).not.toHaveBeenCalled(); expect(sent.some(item => !item.url.includes('/count_tokens') && item.body.compaction)).toBe(false);
    } finally { f.agent.destroy(); }
  });
});

describe('16A third-review compatible replay and default controls', () => {
  it.each([Vendor.OpenAI, Vendor.Anthropic])('%s preserves supported nested thinking through both native wire operations', async vendor => {
    const bodies: Record<string, any>[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes('/models/')) return json({ id: 'fixture', capabilities: { compaction: { supported: true, summarize: { supported: true } } } });
      const body = await wireBody(input, init); bodies.push(body);
      if (url.includes('count_tokens') || url.includes('input_tokens')) return json({ input_tokens: 1000 });
      return vendor === Vendor.OpenAI ? json({ id: 'cmp', output: [{ type: 'compaction', id: 'cmp', encrypted_content: 'OPAQUE' }], usage: { input_tokens: 1000, output_tokens: 20, total_tokens: 1020 } })
        : json({ id: 'msg', stop_reason: 'compaction', content: [{ type: 'compaction', content: 'SUMMARY', signature: 'SIGNED' }], usage: {} });
    }));
    const provider = vendor === Vendor.OpenAI ? new OpenAITextProvider({ apiKey: 'synthetic-offline' }) : new AnthropicTextProvider({ apiKey: 'synthetic-offline' });
    const block = { type: ContentType.THINKING as const, thinking: 'SUPPORTED_EXACT_37', persistInHistory: true,
      ...(vendor === Vendor.OpenAI ? { providerItemId: 'rs_exact', providerMetadata: { encrypted_content: 'EXACT_OPAQUE' } } : { signature: 'EXACT_OPAQUE' }) };
    const input: InputItem[] = [...request.input as InputItem[], { type: 'message', role: MessageRole.ASSISTANT, content: [block, { type: ContentType.OUTPUT_TEXT, text: 'Answer' }] }];
    await provider.compaction.countInput({ ...request, input }); await provider.compaction.compact({ ...request, input });
    expect(bodies).toHaveLength(2);
    for (const body of bodies) { expect(JSON.stringify(body)).toContain('SUPPORTED_EXACT_37'); expect(JSON.stringify(body)).toContain('EXACT_OPAQUE'); }
  });
  it.each([
    [{ enabled: false }, 4096], [{ enabled: true, mode: 'adaptive' }, 4096],
    [{ enabled: true, mode: 'enabled' }, 14096], [{ enabled: true, mode: 'enabled', budgetTokens: 63000 }, 64000],
  ] as const)('keeps native output defaults/provider ceiling for %j', async (thinking, expected) => {
    let sent: Record<string, any> = {};
    vi.stubGlobal('fetch', vi.fn(async (input, init) => {
      if (String(input instanceof Request ? input.url : input).includes('/models/')) return json({ id: 'claude-sonnet-4-6', capabilities: { compaction: { supported: true, summarize: { supported: true } } } });
      sent = await wireBody(input, init); return json({ id: 'msg', stop_reason: 'compaction', content: [{ type: 'compaction', content: 'SUMMARY', signature: 'SIGNED' }], usage: {} });
    }));
    await new AnthropicTextProvider({ apiKey: 'synthetic-offline' }).compaction.compact({ ...request, model: 'claude-sonnet-4-6', thinking });
    expect(sent.max_tokens).toBe(expected);
  });
  it.each([0, -1, 8192, 64001])('rejects invalid explicit native output %i before model discovery', async max_output_tokens => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await expect(new AnthropicTextProvider({ apiKey: 'synthetic-offline' }).compaction.compact({ ...request, model: 'claude-sonnet-4-6', max_output_tokens,
      thinking: { enabled: true, mode: 'enabled', budgetTokens: 8192 } })).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('16A third-review native streaming settlement', () => {
  it('keeps billed usage when a native stream returns no usable summary', async () => {
    vi.stubGlobal('fetch', vi.fn(async input => String(input instanceof Request ? input.url : input).includes('/models/')
      ? json({ id: 'claude-sonnet-4-6', capabilities: { compaction: { supported: true, summarize: { supported: true } } } })
      : anthropicSSE({ id: 'msg_failed', stop_reason: 'max_tokens', content: [], usage: { input_tokens: 0, output_tokens: 0,
        iterations: [{ type: 'compaction', input_tokens: 1000, output_tokens: 12288, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }] } })));
    const connector = Connector.create({ name: 'failed-summary', vendor: Vendor.Anthropic, auth: { type: 'api_key', apiKey: 'synthetic-offline' } });
    const agent = Agent.create({ connector: connector.name, model: 'claude-sonnet-4-6', thinking: { enabled: true, mode: 'enabled', budgetTokens: 8192 },
      context: { model: 'claude-sonnet-4-6', features: { workingMemory: false, inContextMemory: false, evidence: true },
        compactionStrategy: new ContextCompactionStrategy({ plugins: 'off', history: { mode: 'native', preserveRecentTurns: 0 } }) } });
    // Counting is independent auxiliary I/O; return its dedicated shape.
    const originalFetch = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn(async (input, init) => String(input instanceof Request ? input.url : input).includes('count_tokens') ? json({ input_tokens: 1000 }) : originalFetch(input, init)));
    try {
      agent.context.addUserMessage('Prior user'); agent.context.addAssistantResponse([{ type: 'message', role: MessageRole.ASSISTANT, content: [{ type: ContentType.OUTPUT_TEXT, text: 'Prior answer' }] }]);
      const before = structuredClone(agent.context.getConversation());
      await expect(agent.compactContext()).rejects.toThrow('no valid signed native summary');
      expect(agent.context.getConversation()).toEqual(before); expect(agent.context.getState().nativeContinuation).toBeUndefined();
      expect(agent.getModelUsage()!.invocations[0]).toMatchObject({ status: 'failed', usage: { input_tokens: 1000, output_tokens: 12288 } });
      expect(agent.getModelUsage()!.totals.unknownUsageInvocations).toBe(0);
    } finally { agent.destroy(); }
  });
  it('aborts a stalled native stream without committing partial signed state', async () => {
    let entered!: () => void; const ready = new Promise<void>(resolve => { entered = resolve; });
    vi.stubGlobal('fetch', vi.fn(async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes('/models/')) return json({ id: 'claude-sonnet-4-6', capabilities: { compaction: { supported: true, summarize: { supported: true } } } });
      if (url.includes('count_tokens')) return json({ input_tokens: 1000 });
      const signal = input instanceof Request ? input.signal : init!.signal!;
      const stream = new ReadableStream<Uint8Array>({ start(controller) {
        controller.enqueue(new TextEncoder().encode('event: message_start\ndata: {"type":"message_start","message":{"id":"msg_pending","type":"message","role":"assistant","model":"claude-sonnet-4-6","content":[],"usage":{"input_tokens":0,"output_tokens":0}}}\n\n'));
        signal.addEventListener('abort', () => controller.error(signal.reason), { once: true }); entered();
      } });
      return new Response(stream, { headers: { 'content-type': 'text/event-stream' } });
    }));
    const connector = Connector.create({ name: 'cancel-native-stream', vendor: Vendor.Anthropic, auth: { type: 'api_key', apiKey: 'synthetic-offline' } });
    const agent = Agent.create({ connector: connector.name, model: 'claude-sonnet-4-6', context: { model: 'claude-sonnet-4-6',
      features: { workingMemory: false, inContextMemory: false, evidence: true },
      compactionStrategy: new ContextCompactionStrategy({ plugins: 'off', history: { mode: 'native', preserveRecentTurns: 0 } }) } });
    try {
      agent.context.addUserMessage('Prior user'); agent.context.addAssistantResponse([{ type: 'message', role: MessageRole.ASSISTANT, content: [{ type: ContentType.OUTPUT_TEXT, text: 'Prior answer' }] }]);
      const before = structuredClone(agent.context.getConversation());
      const operation = agent.compactContext().then(() => undefined, error => error);
      await ready; agent.cancel('CANCEL_NATIVE_STREAM'); expect((await operation).message).toBe('CANCEL_NATIVE_STREAM');
      expect(agent.context.getConversation()).toEqual(before); expect(agent.context.getState().nativeContinuation).toBeUndefined();
      expect(agent.isRunning()).toBe(false);
    } finally { agent.destroy(); }
  });
});
