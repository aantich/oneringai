import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Agent } from '@/core/Agent.js';
import { Connector } from '@/core/Connector.js';
import { Vendor } from '@/core/Vendor.js';
import { ModelTask, ModelBudgetExceededError } from '@/core/model-execution/ModelTask.js';
import { generateModel } from '@/core/model-execution/ModelExecutor.js';
import { registerModelTransport, modelExecutionFetch } from '@/core/model-execution/ModelTask.js';
import type { ITextProvider, TextGenerateOptions } from '@/domain/interfaces/ITextProvider.js';
import type { IConnectorRegistry } from '@/domain/interfaces/IConnectorRegistry.js';
import { calculateCost } from '@/domain/entities/Model.js';
import { GoogleConverter } from '@/infrastructure/providers/google/GoogleConverter.js';
import { GoogleInteractionsConverter } from '@/infrastructure/providers/google/GoogleInteractionsConverter.js';
import { StreamEventType } from '@/domain/entities/StreamEvent.js';

const agents: Agent[] = []; const tasks: ModelTask[] = [];
const rawOpenAI = (text = 'VERIFIED') => ({ id: 'resp_fixture', object: 'response', created_at: 1, model: 'gpt-4o-mini', status: 'completed',
  output: [{ type: 'message', id: 'message', role: 'assistant', content: [{ type: 'output_text', text, annotations: [] }] }],
  usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
});
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json', ...headers },
});
const sse = (events: Array<Record<string, unknown>>) => new Response(events.map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(''), {
  headers: { 'content-type': 'text/event-stream' },
});
async function body(input: Request | string | URL, init?: RequestInit): Promise<Record<string, any>> {
  return input instanceof Request ? input.clone().json() : JSON.parse(String(init?.body));
}
function create(vendor: Vendor = Vendor.OpenAI, model = 'gpt-4o-mini') {
  const connector = `transport-${agents.length}`;
  Connector.create({ name: connector, vendor, auth: { type: 'api_key', apiKey: 'offline-model-transport-fixture' }, options: { maxRetries: 1 } });
  const agent = Agent.create({ connector, model, modelExecution: { maxOutputTokensPerCall: 128 },
    context: { model, features: { workingMemory: false, inContextMemory: false } } });
  agents.push(agent); return agent;
}
function shared(maxCalls: number) { const task = new ModelTask({ limits: { maxCalls } }); tasks.push(task); return task; }
beforeEach(() => { Connector.clear(); });
afterEach(() => { agents.splice(0).forEach(a => a.destroy()); tasks.splice(0).forEach(t => t.destroy()); Connector.clear(); vi.unstubAllGlobals(); });

describe('actual SDK model-attempt boundaries with mocked HTTP', () => {
  it.each(['tokens', 'cost'] as const)('rejects a multi-candidate Google request before exceeding its %s ceiling', async ceiling => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const agent = create(Vendor.Google, 'gemini-2.5-flash');
    agent['_config'].modelExecution!.maxOutputTokensPerCall = undefined;
    const input = agent['_provider'].getModelCapabilities(agent.model).maxInputTokens!;
    const task = new ModelTask({ limits: ceiling === 'tokens' ? { maxTokens: input + 4096 } : { maxCostUSD: calculateCost(agent.model, input, 4096)! } }); tasks.push(task);
    await expect(agent.runDirect('fixture', { modelTask: task, maxOutputTokens: 4096,
      vendorOptions: { generationConfig: { candidateCount: 3 } } })).rejects.toThrow(ceiling === 'tokens' ? 'maxTokens' : 'maxCostUSD');
    expect(fetch).not.toHaveBeenCalled(); expect(task.snapshot().totals.calls).toBe(0);
  });

  it.each([undefined, 1, 3])('reserves all candidates and preserves the wire request with count=%s', async candidateCount => {
    const count = candidateCount ?? 1; let during!: ReturnType<ModelTask['snapshot']>; let request!: Record<string, any>;
    const task = shared(1); const agent = create(Vendor.Google, 'gemini-2.5-flash');
    agent['_config'].modelExecution!.maxOutputTokensPerCall = 128 * count;
    vi.stubGlobal('fetch', vi.fn(async (input, init) => {
      during = task.snapshot(); request = await body(input, init);
      return json({ candidates: Array.from({ length: count }, (_, index) => ({ index,
        content: { role: 'model', parts: [{ text: `candidate-${index}` }] }, finishReason: 'STOP' })),
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 * count, totalTokenCount: 10 + 5 * count } });
    }));
    const response = await agent.runDirect('fixture', { modelTask: task, maxOutputTokens: 128, vendorOptions: { generationConfig: { candidateCount } } });
    expect(request.generationConfig.maxOutputTokens).toBe(128);
    expect(request.generationConfig.candidateCount).toBe(candidateCount);
    expect(during.totals.chargedTokens).toBe(1_048_576 + 128 * count);
    expect(response.output_text).toBe('candidate-0'); // Existing normalized return keeps the first candidate.
    expect(task.snapshot().totals).toMatchObject({ outputTokens: 5 * count, totalTokens: 10 + 5 * count, calls: 1 });
  });

  it.each([0, -1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER])('rejects invalid or overflowing candidateCount=%s before dispatch', async candidateCount => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch); const agent = create(Vendor.Google, 'gemini-2.5-flash');
    await expect(agent.runDirect('fixture', { maxOutputTokens: 128, vendorOptions: { generationConfig: { candidateCount } } })).rejects.toThrow(/candidateCount|Aggregate/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([[384, 3, 128], [385, 3, 128], [131072, 2, 65536]])('derives a per-candidate limit from aggregate cap=%s / candidates=%s', async (cap, count, expected) => {
    const agent = create(Vendor.Google, 'gemini-2.5-flash'); const task = shared(1); let sent!: Record<string, any>; let reserved = 0;
    agent['_config'].modelExecution!.maxOutputTokensPerCall = cap;
    vi.stubGlobal('fetch', vi.fn(async (input, init) => {
      sent = await body(input, init); reserved = task.snapshot().totals.chargedTokens;
      return json({ candidates: [{ content: { role: 'model', parts: [{ text: 'VERIFIED' }] }, finishReason: 'STOP' }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 } });
    }));
    await agent.runDirect('fixture', { modelTask: task, vendorOptions: { generationConfig: { candidateCount: count } } });
    expect(sent.generationConfig.candidateCount).toBe(count); expect(sent.generationConfig.maxOutputTokens).toBe(expected);
    expect(reserved).toBe(1_048_576 + count! * expected!);
  });

  it('rejects an aggregate cap too small for even one token per candidate', async () => {
    const agent = create(Vendor.Google, 'gemini-2.5-flash'); agent['_config'].modelExecution!.maxOutputTokensPerCall = 2;
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await expect(agent.runDirect('fixture', { vendorOptions: { generationConfig: { candidateCount: 3 } } })).rejects.toThrow('output bound');
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(['direct', 'direct-stream'] as const)('enforces the configured aggregate output cap on %s', async mode => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch); const agent = create(Vendor.Google, 'gemini-2.5-flash');
    const options = { maxOutputTokens: 128, vendorOptions: { generationConfig: { candidateCount: 3 } } };
    await expect(mode === 'direct' ? agent.runDirect('fixture', options) : agent.streamDirect('fixture', options).next()).rejects.toThrow('output limit');
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([Vendor.Google, Vendor.GoogleVertex])('reserves aggregate capacity for %s streaming with a shared converter contract', async vendor => {
    const fixture: ITextProvider = {
      name: 'stream-fixture', capabilities: { text: true, images: false, videos: false, audio: false },
      generate: vi.fn(async () => { throw new Error('use stream'); }),
      async *streamGenerate() { yield { type: StreamEventType.RESPONSE_COMPLETE, response_id: 'fixture', status: 'completed', iterations: 1,
        usage: { input_tokens: 10, output_tokens: 9, total_tokens: 19 } }; },
      getModelCapabilities: () => ({ supportsTools: false, supportsVision: false, supportsJSON: false, supportsJSONSchema: false,
        maxTokens: 8192, maxInputTokens: 8192, maxOutputTokens: 1024 }), validateConfig: async () => true, listModels: async () => [],
    };
    Connector.create({ name: 'aggregate-stream', vendor, auth: { type: 'none' }, options: { provider: fixture } });
    const agent = Agent.create({ connector: 'aggregate-stream', model: 'gemini-2.5-flash', modelExecution: { customProviderAttempts: 'single' } }); agents.push(agent);
    const task = new ModelTask({ limits: { maxTokens: 8192 + 256 } }); tasks.push(task);
    await expect(agent.streamDirect('fixture', { modelTask: task, maxOutputTokens: 128, vendorOptions: { generationConfig: { candidateCount: 3 } } }).next()).rejects.toThrow('maxTokens');
    expect(task.snapshot().totals.calls).toBe(0);
  });

  it('retains aggregate retry reservations and blocks the next physical dispatch', async () => {
    const fetch = vi.fn(async () => new Response('', { status: 503 })); vi.stubGlobal('fetch', fetch);
    const fixture: ITextProvider = {
      name: 'retry-fixture', capabilities: { text: true, images: false, videos: false, audio: false },
      async generate() { await modelExecutionFetch('https://fixture.invalid/first'); await modelExecutionFetch('https://fixture.invalid/retry'); throw new Error('unexpected retry'); },
      async *streamGenerate() { throw new Error('use generate'); },
      getModelCapabilities: () => ({ supportsTools: false, supportsVision: false, supportsJSON: false, supportsJSONSchema: false,
        maxTokens: 100, maxInputTokens: 100, maxOutputTokens: 32 }), validateConfig: async () => true, listModels: async () => [],
    };
    registerModelTransport(fixture);
    const connector = Connector.create({ name: 'aggregate-retry', vendor: Vendor.Google, auth: { type: 'none' }, options: { provider: fixture } });
    const task = new ModelTask({ limits: { maxTokens: 300 } }); tasks.push(task);
    await expect(generateModel(fixture, connector, { model: 'gemini-2.5-flash', input: 'fixture', max_output_tokens: 32,
      vendorOptions: { generationConfig: { candidateCount: 3 } } }, task)).rejects.toThrow('maxTokens');
    expect(fetch).toHaveBeenCalledTimes(1); expect(task.snapshot().totals.chargedTokens).toBe(196);
    expect(task.snapshot().totals.unknownChargeAttempts).toBe(1);
  });

  it.each(['run', 'stream', 'direct', 'direct-stream'] as const)('captures raw tools and pricing before asynchronous %s dispatch', async mode => {
    const task = new ModelTask({ limits: { maxCostUSD: 1 } }); tasks.push(task); const agent = create();
    const vendorOptions: Record<string, unknown> = {}; let sent!: Record<string, any>;
    const mutate = () => { vendorOptions.tools = [{ type: 'web_search_preview' }]; vendorOptions.service_tier = 'priority'; };
    if (mode === 'run') agent.on('llm:request', () => { queueMicrotask(mutate); });
    if (mode === 'stream' || mode === 'direct-stream') {
      const stream = agent['_provider'].streamGenerate.bind(agent['_provider']);
      vi.spyOn(agent['_provider'], 'streamGenerate').mockImplementation(options => { mutate(); return stream(options); });
    }
    vi.stubGlobal('fetch', vi.fn(async (input, init) => {
      sent = await body(input, init);
      return mode === 'run' || mode === 'direct' ? json(rawOpenAI()) : sse([
        { type: 'response.created', response: { ...rawOpenAI(), status: 'in_progress', output: [], usage: null } },
        { type: 'response.output_text.delta', response_id: 'resp_fixture', item_id: 'message', output_index: 0, content_index: 0, delta: 'VERIFIED', sequence_number: 1 },
        { type: 'response.completed', response: rawOpenAI() },
      ]);
    }));
    const options = { modelTask: task, vendorOptions };
    const pending = mode === 'run' ? agent.run('fixture', options) : mode === 'direct' ? agent.runDirect('fixture', options) : (async () => {
      for await (const _event of mode === 'stream' ? agent.stream('fixture', options) : agent.streamDirect('fixture', options)) { /* consume */ }
    })();
    if (mode === 'direct') mutate();
    await pending;
    expect(sent.tools).toBeUndefined(); expect(sent.service_tier).toBeUndefined();
    expect(vendorOptions.tools).toBeDefined(); expect(task.snapshot().totals.calls).toBe(1);
  });

  it('captures nested class-backed Google options, leaving candidate count and pricing unchanged on the wire', async () => {
    class GenerationConfig { candidateCount = 1; tools: unknown[] = []; serviceTier?: string; }
    const generationConfig = new GenerationConfig(); const agent = create(Vendor.Google, 'gemini-2.5-flash');
    const task = new ModelTask({ limits: { maxCostUSD: 1 } }); tasks.push(task); let sent!: Record<string, any>;
    vi.stubGlobal('fetch', vi.fn(async (input, init) => { sent = await body(input, init); return json({
      candidates: [{ content: { role: 'model', parts: [{ text: 'VERIFIED' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
    }); }));
    const pending = agent.runDirect('fixture', { modelTask: task, vendorOptions: { generationConfig } });
    generationConfig.candidateCount = 3; generationConfig.tools.push({ googleSearch: {} }); generationConfig.serviceTier = 'priority';
    await pending;
    expect(sent.generationConfig.candidateCount).toBe(1); expect(sent.generationConfig.serviceTier).toBeUndefined();
    expect(sent.tools ?? []).toEqual([]);
  });

  it('keeps concurrent calls bound to their own admitted view of reused vendor configuration', async () => {
    const agent = create(); const task = new ModelTask({ limits: { maxCostUSD: 1 } }); tasks.push(task);
    const fetch = vi.fn(async () => json(rawOpenAI())); vi.stubGlobal('fetch', fetch);
    const vendorOptions: Record<string, unknown> = {};
    const admitted = agent.runDirect('first', { modelTask: task, vendorOptions });
    vendorOptions.tools = [{ type: 'web_search_preview' }];
    await expect(agent.runDirect('second', { modelTask: task, vendorOptions })).rejects.toThrow('tool fees');
    await admitted; expect(fetch).toHaveBeenCalledTimes(1);
    const [input, init] = fetch.mock.calls[0]! as unknown as [Request | string, RequestInit]; expect((await body(input, init)).tools).toBeUndefined();
  });

  it('preserves live SDK values, registry identity and functions while isolating serializable request data', async () => {
    const controller = new AbortController(); const callback = () => 'opaque'; const stamp = new Date(); const bytes = new Uint8Array([1]);
    const registry = { get: () => Connector.get('opaque') }; let selected!: TextGenerateOptions;
    const fixture: ITextProvider = {
      name: 'opaque-fixture', capabilities: { text: true, images: false, videos: false, audio: false },
      async generate(options) { selected = options; return { ...rawOpenAI(), object: 'response', status: 'completed', output: [] }; }, async *streamGenerate() { throw new Error('use generate'); },
      getModelCapabilities: () => ({ supportsTools: false, supportsVision: false, supportsJSON: false, supportsJSONSchema: false, maxTokens: 8192, maxOutputTokens: 1024 }),
      validateConfig: async () => true, listModels: async () => [],
    };
    const connector = Connector.create({ name: 'opaque', vendor: Vendor.OpenAI, auth: { type: 'none' }, options: { provider: fixture } });
    const task = shared(1); const vendorOptions = { config: { abortSignal: controller.signal, callback, stamp, bytes, nested: { value: 'original' } } };
    const pending = generateModel(fixture, connector, { model: 'gpt-4o-mini', input: 'fixture', vendorOptions,
      credential_context: { connectorRegistry: registry as unknown as IConnectorRegistry } }, task, { customProviderAttempts: 'single' });
    vendorOptions.config.nested.value = 'mutated'; await pending;
    expect(selected.vendorOptions!.config).toMatchObject({ nested: { value: 'original' } });
    for (const [key, value] of Object.entries({ abortSignal: controller.signal, callback, stamp, bytes })) expect(selected.vendorOptions!.config[key]).toBe(value);
    expect(selected.credential_context!.connectorRegistry).toBe(registry);
  });

  it('preserves legacy untracked vendor-option behavior', async () => {
    Connector.create({ name: 'untracked', vendor: Vendor.OpenAI, auth: { type: 'api_key', apiKey: 'offline-fixture' } });
    const agent = Agent.create({ connector: 'untracked', model: 'gpt-4o-mini' }); agents.push(agent);
    let sent!: Record<string, any>; vi.stubGlobal('fetch', vi.fn(async (input, init) => { sent = await body(input, init); return json(rawOpenAI()); }));
    const vendorOptions: Record<string, unknown> = {};
    const pending = agent.runDirect('fixture', { vendorOptions }); vendorOptions.tools = [{ type: 'web_search_preview' }];
    await pending; expect(sent.tools).toEqual(vendorOptions.tools); expect(agent.getModelUsage()).toBeUndefined();
  });
  it.each(['run', 'stream', 'direct', 'direct-stream'] as const)('rejects raw OpenAI hosted tools under a monetary ceiling before %s dispatch', async mode => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const agent = create(); const task = new ModelTask({ limits: { maxCostUSD: 1 } }); tasks.push(task);
    const options = { modelTask: task, vendorOptions: { tools: [{ type: 'web_search_preview' }] } };
    const invoke = async () => {
      if (mode === 'run') return agent.run('fixture', options);
      if (mode === 'direct') return agent.runDirect('fixture', options);
      for await (const _event of mode === 'stream' ? agent.stream('fixture', options) : agent.streamDirect('fixture', options)) { /* consume */ }
      return undefined;
    };
    await expect(invoke()).rejects.toThrow('tool fees'); expect(fetch).not.toHaveBeenCalled(); expect(task.snapshot().totals.calls).toBe(0);
  });

  it.each([
    { generationConfig: { tools: [{ googleSearch: {} }] } },
    { interactions: { tools: [{ type: 'google_search' }] } },
    { interactions: { generation_config: { tools: [{ type: 'code_execution' }] } } },
    { mcp_servers: [{ type: 'url', url: 'https://fixture.invalid/mcp' }] },
  ])('rejects raw tool option containers for Google: %j', async vendorOptions => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const agent = create(Vendor.Google, 'gemini-2.5-flash'); const task = new ModelTask({ limits: { maxCostUSD: 1 } }); tasks.push(task);
    await expect(agent.runDirect('fixture', { modelTask: task, vendorOptions })).rejects.toThrow('tool fees');
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([{ generationConfig: { serviceTier: 'priority' } }, { interactions: { service_tier: 'priority' } }])('requires host price bounds for nested pricing options: %j', async vendorOptions => {
    const fetch = vi.fn(async () => json({ candidates: [{ content: { role: 'model', parts: [{ text: 'VERIFIED' }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 } }));
    vi.stubGlobal('fetch', fetch); const agent = create(Vendor.Google, 'gemini-2.5-flash');
    const task = new ModelTask({ limits: { maxCostUSD: 100 } }); tasks.push(task);
    await expect(agent.runDirect('fixture', { modelTask: task, vendorOptions })).rejects.toThrow('unknown price');
    expect(fetch).not.toHaveBeenCalled();
    agent['_config'].modelExecution!.priceBound = { inputPerMillion: 10, outputPerMillion: 20 };
    await agent.runDirect('fixture', { modelTask: task, vendorOptions }); expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('preserves raw hosted-tool options when no new monetary limit is selected', async () => {
    const fetch = vi.fn(async () => json(rawOpenAI())); vi.stubGlobal('fetch', fetch);
    const agent = create(); const task = shared(1);
    await agent.runDirect('fixture', { modelTask: task, vendorOptions: { tools: [{ type: 'web_search_preview' }] } });
    const [request, init] = fetch.mock.calls[0]! as unknown as [Request | string, RequestInit | undefined];
    const payload = request instanceof Request ? await request.json() : JSON.parse(String(init?.body));
    expect(payload.tools).toEqual([{ type: 'web_search_preview' }]);
  });

  it.each([['generate', 5], ['generate', 50], ['stream', 5], ['stream', 50]] as const)('accounts for separate Google thinking tokens on %s with visible=%s and preserves public usage', async (mode, visible) => {
    const raw = { candidates: [{ content: { role: 'model', parts: [{ text: 'VERIFIED' }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: visible, thoughtsTokenCount: 20, totalTokenCount: 30 + visible } };
    vi.stubGlobal('fetch', vi.fn(async () => mode === 'generate' ? json(raw) : new Response(`data: ${JSON.stringify(raw)}\n\n`, { headers: { 'content-type': 'text/event-stream' } })));
    const task = shared(1); const agent = create(Vendor.Google, 'gemini-2.5-flash');
    if (mode === 'generate') expect((await agent.runDirect('fixture', { modelTask: task })).usage.output_tokens).toBe(visible);
    else {
      const events = []; for await (const event of agent.streamDirect('fixture', { modelTask: task })) events.push(event);
      expect(events.find(e => e.type === StreamEventType.RESPONSE_COMPLETE)?.usage?.output_tokens).toBe(visible);
    }
    const snapshot = task.snapshot();
    expect(snapshot.invocations[0]?.usage).toMatchObject({ input_tokens: 10, output_tokens: visible + 20, total_tokens: visible + 30 });
    expect(snapshot.totals).toMatchObject({ chargedTokens: visible + 30, reasoningTokens: 20, unknownUsageInvocations: 0 });
    expect(snapshot.invocations[0]?.modelCostUSD).toBeCloseTo(calculateCost('gemini-2.5-flash', 10, visible + 20)!, 12);
  });

  it('normalizes the shared Vertex converter while keeping Interactions inclusive counters unchanged', async () => {
    // Vertex uses GoogleConverter too; accounting follows that converter's usage provenance.
    const google = new GoogleConverter().convertResponse({ candidates: [{ content: { role: 'model', parts: [{ text: 'VERIFIED' }] }, finishReason: 'STOP' }],
      modelVersion: 'gemini-2.5-flash', usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, thoughtsTokenCount: 20, totalTokenCount: 35 } });
    const interaction = new GoogleInteractionsConverter().convertResponse({ id: 'fixture', model: 'gemini-2.5-flash', status: 'completed',
      outputs: [{ type: 'text', text: 'VERIFIED' }], usage: { total_input_tokens: 10, total_output_tokens: 25, total_tokens: 35, total_thought_tokens: 20 } }, 'gemini-2.5-flash');
    const task = shared(2);
    for (const value of [google, interaction]) await task.execute({ purpose: 'main', connector: 'google', model: 'gemini-2.5-flash', inputTokenBound: 100, outputTokenBound: 100 },
      async () => value, { usage: response => response.usage });
    expect(task.snapshot().invocations.map(i => i.usage?.output_tokens)).toEqual([25, 25]);
  });

  it('enforces a helper output ceiling against visible plus thinking usage', async () => {
    const name = 'thinking-helper'; Connector.create({ name, vendor: Vendor.Google, auth: { type: 'api_key', apiKey: 'offline-fixture' } });
    const agent = Agent.create({ connector: name, model: 'gemini-2.5-flash', modelExecution: { helpers: {
      extractor: { connector: name, model: 'gemini-2.5-flash', maxOutputTokens: 32 },
    } } }); agents.push(agent);
    vi.stubGlobal('fetch', vi.fn(async () => json({ candidates: [{ content: { role: 'model', parts: [{ text: '{"answer":"VERIFIED"}' }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10, thoughtsTokenCount: 30, totalTokenCount: 50 } })));
    await expect(agent.invokeHelper('extractor', 'fixture', { schema: { type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'] } })).rejects.toThrow('output allowance');
    expect(agent.getModelUsage()?.totals).toMatchObject({ outputTokens: 40, reasoningTokens: 30 });
  });
  it('observes an OpenAI SDK retry while preserving its normal retry policy', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(json({ error: { message: 'temporary' } }, 503, { 'retry-after-ms': '1' }))
      .mockResolvedValueOnce(json(rawOpenAI())); vi.stubGlobal('fetch', fetch);
    const task = shared(2); const agent = create();
    const response = await agent.runDirect('Read the fixture.', { modelTask: task });
    expect(response.output_text).toBe('VERIFIED'); expect(fetch).toHaveBeenCalledTimes(2);
    expect(task.snapshot().attempts.map(a => a.httpStatus)).toEqual([503, 200]);
    expect(task.snapshot().totals).toMatchObject({ calls: 2, totalTokens: 15, unknownChargeAttempts: 1 });
    expect(task.snapshot().totals.chargedTokens).toBeGreaterThan(128_000);
  });

  it('stops a real SDK retry before dispatch when the task call budget is exhausted', async () => {
    const fetch = vi.fn(async () => json({ error: { message: 'temporary' } }, 503, { 'retry-after-ms': '1' })); vi.stubGlobal('fetch', fetch);
    const task = shared(1); const agent = create();
    await expect(agent.runDirect('Read the fixture.', { modelTask: task })).rejects.toBeInstanceOf(ModelBudgetExceededError);
    expect(fetch).toHaveBeenCalledTimes(1); expect(task.snapshot().totals.calls).toBe(1);
  });

  it('accounts for streaming usage through the SDK fetch adapter and keeps event shapes', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sse([
      { type: 'response.created', response: { ...rawOpenAI(), status: 'in_progress', output: [], usage: null } },
      { type: 'response.output_text.delta', response_id: 'resp_fixture', item_id: 'message', output_index: 0, content_index: 0, delta: 'VERIFIED', sequence_number: 1 },
      { type: 'response.completed', response: rawOpenAI() },
    ])));
    const task = shared(1); const agent = create(); const events = [];
    for await (const event of agent.streamDirect('Stream the fixture.', { modelTask: task })) events.push(event);
    expect(events.some(e => e.type === StreamEventType.OUTPUT_TEXT_DELTA && e.delta === 'VERIFIED')).toBe(true);
    expect(task.snapshot().totals).toMatchObject({ calls: 1, totalTokens: 15, unknownChargeAttempts: 0 });
    expect(task.snapshot().attempts[0]?.boundary).toBe('transport');
  });

  it.each(['generate', 'stream'] as const)('keeps absent wire usage unknown for OpenAI %s despite legacy normalized zero fields', async mode => {
    const raw = { ...rawOpenAI(), usage: undefined };
    vi.stubGlobal('fetch', vi.fn(async () => mode === 'generate' ? json(raw) : sse([
      { type: 'response.created', response: { ...raw, status: 'in_progress', output: [] } },
      { type: 'response.completed', response: raw },
    ])));
    const task = shared(1); const agent = create();
    if (mode === 'generate') expect((await agent.runDirect('Read.', { modelTask: task })).usage.total_tokens).toBe(0);
    else for await (const _event of agent.streamDirect('Read.', { modelTask: task })) { /* preserve old event shape */ }
    expect(task.snapshot().totals).toMatchObject({ calls: 1, unknownUsageInvocations: 1, unknownChargeAttempts: 1 });
    expect(task.snapshot().totals.chargedTokens).toBeGreaterThan(128_000);
    expect(task.snapshot().invocations[0]?.modelCostUSD).toBeNull();
  });

  it('isolates concurrent task accounting through actual SDK awaits and requests', async () => {
    const fetch = vi.fn(async () => { await Promise.resolve(); return json(rawOpenAI()); }); vi.stubGlobal('fetch', fetch);
    const first = shared(1); const second = shared(1); const a = create(); const b = create();
    await Promise.all([a.runDirect('First task.', { modelTask: first }), b.runDirect('Second task.', { modelTask: second })]);
    expect(first.snapshot().totals.calls).toBe(1); expect(second.snapshot().totals.calls).toBe(1);
    expect(first.snapshot().totals.totalTokens).toBe(15); expect(second.snapshot().totals.totalTokens).toBe(15);
    expect(first.snapshot().attempts[0]?.invocationId).not.toBe(second.snapshot().attempts[0]?.invocationId);
  });

  it('passes cancellation into a pending SDK request without delivering a late response', async () => {
    let requestSignal: AbortSignal | undefined; let release!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn(async (_input, init) => {
      requestSignal = init.signal; return new Promise<Response>(resolve => { release = resolve; });
    }));
    const controller = new AbortController(); const task = shared(1); const agent = create();
    const pending = agent.runDirect('Wait.', { modelTask: task, signal: controller.signal }).catch(e => e);
    await vi.waitFor(() => expect(requestSignal).toBeDefined()); controller.abort(new DOMException('host stop', 'AbortError'));
    expect((await pending).name).toBe('AbortError'); expect(requestSignal?.aborted).toBe(true);
    release(json(rawOpenAI('LATE_PRIVATE')));
    await vi.waitFor(() => expect(task.snapshot().invocations[0]?.lateSettlement).toBe(true));
    expect(JSON.stringify(agent.context.getState())).not.toContain('LATE_PRIVATE');
  });

  it('accounts for Anthropic generate using its streaming SDK transport', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sse([
      { type: 'message_start', message: { id: 'msg_fixture', type: 'message', role: 'assistant', model: 'claude-haiku-4-5-20251001', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'VERIFIED' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 5 } },
      { type: 'message_stop' },
    ])));
    const task = shared(1); const agent = create(Vendor.Anthropic, 'claude-haiku-4-5-20251001');
    expect((await agent.runDirect('Read the fixture.', { modelTask: task })).output_text).toBe('VERIFIED');
    expect(task.snapshot().totals).toMatchObject({ calls: 1, totalTokens: 15, unknownChargeAttempts: 0 });
    expect(task.snapshot().attempts[0]?.boundary).toBe('transport');
  });

  it('accounts for Google generate through its documented custom fetch hook', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({
      candidates: [{ content: { role: 'model', parts: [{ text: 'VERIFIED' }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
    })));
    const task = shared(1); const agent = create(Vendor.Google, 'gemini-2.5-flash');
    expect((await agent.runDirect('Read the fixture.', { modelTask: task })).output_text).toBe('VERIFIED');
    expect(task.snapshot().totals).toMatchObject({ calls: 1, totalTokens: 15, unknownChargeAttempts: 0 });
    expect(task.snapshot().attempts[0]?.boundary).toBe('transport');
  });
});
