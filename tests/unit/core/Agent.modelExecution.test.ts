import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Agent } from '@/core/Agent.js';
import { Connector } from '@/core/Connector.js';
import { Vendor } from '@/core/Vendor.js';
import { ContentType } from '@/domain/entities/Content.js';
import { MessageRole } from '@/domain/entities/Message.js';
import { StreamEventType } from '@/domain/entities/StreamEvent.js';
import { ModelTask } from '@/core/model-execution/ModelTask.js';
import { HelperOutputError } from '@/core/model-execution/ModelExecutor.js';
import { ConnectorNotFoundError } from '@/domain/errors/AIErrors.js';
import type { ModelExecutionConfig } from '@/core/model-execution/types.js';
import type { TextGenerateOptions } from '@/domain/interfaces/ITextProvider.js';
import type { IConnectorRegistry } from '@/domain/interfaces/IConnectorRegistry.js';
import type { TokenUsage } from '@/domain/entities/Response.js';

const schema = { type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'], additionalProperties: false };
const usage = { input_tokens: 10, output_tokens: 5, total_tokens: 15 };
function response(text = 'MAIN_VALID', model = 'fixture-main') {
  return { id: 'fixture', object: 'response' as const, created_at: 1, model, status: 'completed' as const, output_text: text,
    output: [{ type: 'message' as const, role: MessageRole.ASSISTANT, content: [{ type: ContentType.OUTPUT_TEXT as const, text }] }], usage: { ...usage } };
}
function provider(window: number, text: string) {
  return { name: 'fixture', capabilities: { text: true, images: false, videos: false, audio: false },
    generate: vi.fn(async (options: TextGenerateOptions) => response(text, options.model)),
    streamGenerate: vi.fn(async function* () {
      yield { type: StreamEventType.OUTPUT_TEXT_DELTA as const, response_id: 'fixture', item_id: 'text', output_index: 0, content_index: 0, sequence_number: 1, delta: text };
      yield { type: StreamEventType.RESPONSE_COMPLETE as const, response_id: 'fixture', status: 'completed' as const, usage: { ...usage }, iterations: 1 };
    }),
    getModelCapabilities: () => ({ supportsTools: true, supportsVision: false, supportsJSON: true, supportsJSONSchema: true,
      maxTokens: window, maxInputTokens: window, maxOutputTokens: 1024 }),
    validateConfig: async () => true, listModels: async () => [], destroy: vi.fn(),
  };
}
const agents: Agent[] = []; const tasks: ModelTask[] = [];
let main: ReturnType<typeof provider>; let helper: ReturnType<typeof provider>;
function config(): ModelExecutionConfig {
  return { customProviderAttempts: 'single', helpers: {
    compactor: { connector: 'helper', model: 'fixture-helper', maxOutputTokens: 256, allowContextTransfer: true },
    extractor: { connector: 'helper', model: 'fixture-helper', maxOutputTokens: 256 },
    verifier: { connector: 'main', model: 'fixture-main', maxOutputTokens: 256 },
  } };
}
function create(modelExecution?: ModelExecutionConfig, extra: Partial<Parameters<typeof Agent.create>[0]> = {}) {
  const value = Agent.create({ connector: 'main', model: 'fixture-main', modelExecution,
    context: { model: 'fixture-main', features: { workingMemory: false, inContextMemory: false } },
    thinking: { enabled: false }, emptyResponseRetry: { enabled: false }, ...extra });
  agents.push(value); return value;
}
function shared(limits = {}) { const value = new ModelTask({ limits }); tasks.push(value); return value; }
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}
beforeEach(() => {
  main = provider(8192, 'MAIN_VALID'); helper = provider(1024, '{"answer":"HELPER_VALID"}');
  Connector.create({ name: 'main', vendor: Vendor.OpenAI, auth: { type: 'none' }, options: { provider: main } });
  Connector.create({ name: 'helper', vendor: Vendor.Anthropic, auth: { type: 'none' }, options: { provider: helper } });
});

describe('Stage 06 second review regressions: external pricing and repair evidence', () => {
  it.each([
    [{ service_tier: 'standard' }, { service_tier: 'priority' }, { service_tier: 'standard' }],
    [{ processing_mode: 'interactive' }, { processing_mode: 'batch' }, { processing_mode: 'interactive' }],
    [{ speed: 'standard' }, { speed: 'fast' }, { speed: 'standard' }],
    [{ processing_mode: 'interactive' }, { service_tier: 'priority' }, { service_tier: 'standard' }],
    [{ speed: 'fast' }, { service_tier: 'priority' }, { speed: 'standard', service_tier: 'standard' }],
    [{ service_tier: 'unknown-premium' }, {}, { service_tier: 'standard' }],
  ] as Array<[Partial<TokenUsage>, Partial<TokenUsage>, Partial<TokenUsage>]>)(
    'keeps observed pricing uncertainty through a final override: %j %j %j', async (first, second, final) => {
      const agent = create(config(), { model: 'gpt-4o-mini' }); const task = shared({ maxCostUSD: 1 });
      await agent.beginExternalExecution({ modelTask: task });
      agent.recordExternalUsage({ ...usage, ...first }); agent.recordExternalUsage({ ...usage, ...second });
      const raw = await agent.completeExternalExecution({ usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30, ...final } });
      expect(raw.usage).not.toHaveProperty('service_tier'); // Legacy external response shape is unchanged.
      expect(task.snapshot().invocations[0]?.usage).toMatchObject({ input_tokens: 20, output_tokens: 10, total_tokens: 30, service_tier: 'mixed_external_tiers' });
      expect(task.snapshot().invocations[0]?.modelCostUSD).toBeNull();
      await expect(agent.runDirect('subsequent bounded call', { modelTask: task })).rejects.toThrow('unknown price or charge');
      expect(main.generate).not.toHaveBeenCalled();
    });

  it('observes final-only contradictory pricing and keeps its cost unknown', async () => {
    const agent = create(config(), { model: 'gpt-4o-mini' }); const task = shared();
    await agent.beginExternalExecution({ modelTask: task });
    await agent.completeExternalExecution({ usage: { ...usage, processing_mode: 'interactive', service_tier: 'priority' } });
    expect(task.snapshot().invocations[0]?.usage?.service_tier).toBe('mixed_external_tiers');
    expect(task.snapshot().totals.unknownCostInvocations).toBe(1);
  });

  it('keeps uncertainty through a partial final snapshot while honoring count overrides', async () => {
    const agent = create(config(), { model: 'gpt-4o-mini' }); const task = shared();
    await agent.beginExternalExecution({ modelTask: task });
    agent.recordExternalUsage({ ...usage, service_tier: 'standard' }); agent.recordExternalUsage({ ...usage, service_tier: 'priority' });
    await agent.completeExternalExecution({ usage: { output_tokens: 8, service_tier: 'standard' } });
    expect(task.snapshot().invocations[0]?.usage).toMatchObject({ input_tokens: 20, output_tokens: 8, total_tokens: 30, service_tier: 'mixed_external_tiers' });
    expect(task.snapshot().totals.unknownCostInvocations).toBe(1);
  });

  it('prices consistent modes/tier aliases normally and resets uncertainty for a later execution', async () => {
    const agent = create(config(), { model: 'gpt-4o-mini' }); const task = shared();
    await agent.beginExternalExecution({ modelTask: task });
    agent.recordExternalUsage({ ...usage, service_tier: 'priority' });
    await agent.completeExternalExecution({ usage: { ...usage, service_tier: 'standard' } });
    expect(task.snapshot().invocations[0]?.modelCostUSD).toBeNull();
    await agent.beginExternalExecution({ modelTask: task });
    agent.recordExternalUsage({ ...usage, processing_mode: 'batch', service_tier: 'standard', speed: 'standard' });
    await agent.completeExternalExecution({ usage: { ...usage, processing_mode: 'batch', service_tier: 'standard' } });
    expect(task.snapshot().invocations[1]?.modelCostUSD).toBeCloseTo(0.00000225, 12);
    expect(task.snapshot().invocations[1]?.usage?.service_tier).toBe('standard');
    expect(task.snapshot().totals.unknownCostInvocations).toBe(1);
  });

  it.each(['extractor', 'verifier', 'compactor'] as const)('retains only selected source evidence in %s parse/schema repair', async role => {
    for (const invalid of ['not JSON', '{"answer":7}']) {
      const source = `SOURCE_${role.toUpperCase()}_672`; const constraint = 'PRESERVE_CONSTRAINT_901';
      const agent = create(config()); const task = shared({ maxCalls: 2 });
      agent.context.addInputItems([{ type: 'message', role: MessageRole.USER, content: [{ type: ContentType.INPUT_TEXT, text: 'HISTORY_NOT_SELECTED_123' }] }]);
      const before = JSON.stringify(agent.context.getConversation());
      const selected = role === 'verifier' ? main : helper; const builder = vi.fn(() => `Exact identifier: ${source}. Constraint: ${constraint}.`);
      selected.generate.mockResolvedValueOnce(response(invalid)).mockImplementationOnce(async options => {
        expect(String(options.input)).toContain(source); expect(String(options.input)).toContain(constraint);
        expect(String(options.input)).toContain(invalid); expect(JSON.stringify(options)).not.toContain('HISTORY_NOT_SELECTED_123');
        expect(options.tools).toBeUndefined(); expect(options.native_tools).toBeUndefined();
        return response(JSON.stringify({ answer: source }), options.model);
      });
      const result = await agent.invokeHelper(role, builder, { schema, modelTask: task });
      expect(result.value).toEqual({ answer: source }); expect(builder).toHaveBeenCalledTimes(1);
      expect(task.snapshot().invocations.map(i => [i.phase, i.outputValidation])).toEqual([['generation', 'failed'], ['repair', 'passed']]);
      expect(task.snapshot().totals).toMatchObject({ calls: 2, totalTokens: 30 });
      expect(JSON.stringify(agent.context.getConversation())).toBe(before);
    }
  });

  it('preserves source constraints during a repaired explicit compaction before replacing history', async () => {
    const agent = create(config()); const task = shared({ maxCalls: 2 });
    agent.context.addInputItems([
      { type: 'message', role: MessageRole.USER, content: [{ type: ContentType.INPUT_TEXT, text: 'Preserve EXACT_CONSTRAINT_672. Completed STEP_901; next STEP_902.' }] },
      { type: 'message', role: MessageRole.ASSISTANT, content: [{ type: ContentType.OUTPUT_TEXT, text: 'Recorded.' }] },
    ]);
    helper.generate.mockResolvedValueOnce(response('{"summary":7}')).mockImplementationOnce(async options => {
      expect(String(options.input)).toContain('EXACT_CONSTRAINT_672'); expect(String(options.input)).toContain('STEP_901'); expect(String(options.input)).toContain('STEP_902');
      return response('{"summary":"Preserve EXACT_CONSTRAINT_672. Completed STEP_901; next STEP_902."}', options.model);
    });
    expect((await agent.rolloverContext({ preserveRecentTurns: 0, modelTask: task, maxSummaryTokens: 256 })).performed).toBe(true);
    expect(JSON.stringify(agent.context.getConversation())).toContain('EXACT_CONSTRAINT_672');
    expect(task.snapshot().invocations.map(i => i.outputValidation)).toEqual(['failed', 'passed']);
  });

  it('fails before a repair that cannot fit its original evidence plus candidate, without silently trimming either', async () => {
    const configured = config(); configured.helpers!.extractor!.maxInputTokens = 300;
    const agent = create(configured); const task = shared();
    helper.generate.mockResolvedValueOnce(response('x'.repeat(800)));
    await expect(agent.invokeHelper('extractor', 'SOURCE_672 ' + 'fact '.repeat(85), { schema, modelTask: task })).rejects.toThrow('input allowance');
    expect(helper.generate).toHaveBeenCalledTimes(1); expect(task.snapshot().totals.calls).toBe(1);
    expect(task.snapshot().invocations[0]?.outputValidation).toBe('failed');
  });

  it.each([{ maxCalls: 1 }, { maxTokens: 1280 }])('retains the shared repair budget %j with original evidence included', async limits => {
    const agent = create(config()); const task = shared(limits); helper.generate.mockResolvedValueOnce(response('{"answer":7}'));
    await expect(agent.invokeHelper('extractor', 'SOURCE_BUDGET_672', { schema, modelTask: task })).rejects.toThrow(/maxCalls|maxTokens/);
    expect(helper.generate).toHaveBeenCalledTimes(1); expect(task.snapshot().totals.totalTokens).toBe(15);
  });

  it('cancels a pending evidence-preserving repair and keeps late usage on its original task', async () => {
    const agent = create(config()); const task = shared(); const host = new AbortController(); const gate = deferred<ReturnType<typeof response>>();
    helper.generate.mockResolvedValueOnce(response('{"answer":7}')).mockImplementationOnce(async options => {
      expect(String(options.input)).toContain('SOURCE_CANCEL_672'); return gate.promise;
    });
    const pending = agent.invokeHelper('extractor', 'SOURCE_CANCEL_672', { schema, modelTask: task, signal: host.signal }).catch(e => e);
    await vi.waitFor(() => expect(helper.generate).toHaveBeenCalledTimes(2)); host.abort();
    expect((await pending).name).toBe('AbortError'); expect(task.snapshot().invocations[1]?.status).toBe('cancelled');
    gate.resolve(response('{"answer":"LATE_SOURCE_CANCEL_672"}'));
    await vi.waitFor(() => expect(task.snapshot().invocations[1]?.lateSettlement).toBe(true));
    expect(task.snapshot().totals).toMatchObject({ calls: 2, totalTokens: 30 });
    expect(JSON.stringify(agent.context.getConversation())).not.toContain('LATE_SOURCE_CANCEL_672');
  });
});

describe('Stage 06 review regressions: helpers and execution ownership', () => {
  it('isolates repeated schema IDs across calls and agents, while resolving local refs and formats', async () => {
    const identified = { $id: 'https://fixture.invalid/result', type: 'object', properties: { answer: { $ref: '#/$defs/answer' } },
      $defs: { answer: { type: 'string', format: 'email' } }, required: ['answer'], additionalProperties: false };
    helper.generate.mockResolvedValue(response('{"answer":"a@example.com"}'));
    const first = create(config()); const second = create(config());
    for (let n = 0; n < 12; n++) {
      const result = await (n % 2 ? first : second).invokeHelper('extractor', 'packet', { schema: structuredClone(identified) });
      expect(result.value).toEqual({ answer: 'a@example.com' });
    }
    helper.generate.mockResolvedValueOnce(response('{"answer":7}'));
    await expect(second.invokeHelper('extractor', 'packet', { schema: { ...schema, $id: identified.$id,
      properties: { answer: { type: 'number' } } } })).resolves.toMatchObject({ value: { answer: 7 } });
    helper.generate.mockResolvedValue(response('{"answer":"invalid-email"}'));
    await expect(first.invokeHelper('extractor', 'packet', { schema: identified })).rejects.toThrow('format');
    const builder = vi.fn(() => 'packet');
    await expect(first.invokeHelper('extractor', builder, { schema: { $ref: identified.$id } })).rejects.toThrow('JSON schema');
    expect(builder).not.toHaveBeenCalled(); // Prior helper schemas cannot escape their invocation.
  });

  it.each(['main-first', 'helper-first'] as const)('keeps standalone helper tasks independent of concurrent main completion: %s', async order => {
    const agent = create(config()); const mainResult = deferred<ReturnType<typeof response>>();
    const helperResult = deferred<ReturnType<typeof response>>();
    main.generate.mockImplementationOnce(() => mainResult.promise);
    helper.generate.mockImplementationOnce(() => helperResult.promise);
    const running = agent.run('main');
    await vi.waitFor(() => expect(main.generate).toHaveBeenCalledTimes(1));
    const helping = agent.invokeHelper('extractor', 'packet', { schema });
    await vi.waitFor(() => expect(helper.generate).toHaveBeenCalledTimes(1));
    const mainTaskId = agent['_activeModelTask']!.id;
    if (order === 'main-first') { mainResult.resolve(response()); await running; }
    helperResult.resolve(response('{"answer":"INDEPENDENT"}'));
    const extracted = await helping;
    expect(extracted.value).toEqual({ answer: 'INDEPENDENT' }); expect(extracted.taskId).not.toBe(mainTaskId);
    if (order === 'helper-first') { mainResult.resolve(response()); await running; }
  });

  it('supports an explicitly shared helper in an awaited execution hook without destroying the caller task', async () => {
    const task = shared({ maxCalls: 3 }); let agent!: Agent;
    agent = create(config(), { hooks: { 'after:llm': async () => {
      await agent.invokeHelper('extractor', 'explicit evidence', { schema, modelTask: task }); return {};
    } } });
    await agent.run('main', { modelTask: task });
    expect(task.signal.aborted).toBe(false);
    expect(task.snapshot().invocations.map(i => i.purpose)).toEqual(['main', 'extractor']);
    await agent.runDirect('another call', { modelTask: task });
    expect(task.snapshot().totals.calls).toBe(3);
  });

  it.each(['run', 'stream'] as const)('captures caller task ownership despite mutable %s direct options', async mode => {
    const agent = create(config()); const task = shared(); const replacement = shared();
    const gate = deferred<void>(); const options: { modelTask?: ModelTask } = { modelTask: task };
    if (mode === 'run') main.generate.mockImplementationOnce(async () => { await gate.promise; return response(); });
    else main.streamGenerate.mockImplementationOnce(async function* () { await gate.promise;
      yield { type: StreamEventType.RESPONSE_COMPLETE, response_id: 'fixture', status: 'completed', usage, iterations: 1 };
    });
    const pending = mode === 'run' ? agent.runDirect('packet', options) : (async () => {
      for await (const _event of agent.streamDirect('packet', options)) { /* consume */ }
    })();
    await vi.waitFor(() => expect(mode === 'run' ? main.generate : main.streamGenerate).toHaveBeenCalledTimes(1));
    options.modelTask = replacement; gate.resolve(); await pending;
    expect(task.signal.aborted).toBe(false); expect(replacement.signal.aborted).toBe(false);
    await agent.runDirect('again', { modelTask: task }); expect(task.snapshot().totals.calls).toBe(2);
  });

  it.each(['failed', 'cancelled'] as const)('retains caller ownership on direct %s after the options lose their task reference', async condition => {
    const task = shared(); const agent = create(config()); const gate = deferred<void>();
    const host = new AbortController(); const options: { modelTask?: ModelTask; signal: AbortSignal } = { modelTask: task, signal: host.signal };
    main.generate.mockImplementationOnce(async () => { await gate.promise; throw new Error('fixture failure'); });
    const pending = agent.runDirect('packet', options).catch(e => e);
    await vi.waitFor(() => expect(main.generate).toHaveBeenCalledTimes(1)); options.modelTask = undefined;
    if (condition === 'cancelled') host.abort(); else gate.resolve();
    expect(await pending).toBeInstanceOf(Error); expect(task.signal.aborted).toBe(false);
    gate.resolve(); await agent.runDirect('again', { modelTask: task });
  });

  it.each([
    ['missing', undefined], ['empty', {}], ['metadata', { service_tier: 'priority' }],
    ['input-only', { input_tokens: 10 }], ['total-only', { total_tokens: 15 }],
  ] as const)('preserves unknown external usage for %s reports and blocks further bounded charges', async (_name, partial) => {
    const agent = create(config()); const task = shared({ maxCostUSD: 1 });
    await agent.beginExternalExecution({ modelTask: task });
    if (partial) agent.recordExternalUsage(partial);
    const raw = await agent.completeExternalExecution({ usage: partial });
    expect(raw.usage).toHaveProperty('input_tokens'); // Existing public response defaults remain.
    expect(task.snapshot().invocations[0]?.usage).toBeNull();
    expect(task.snapshot().totals).toMatchObject({ unknownUsageInvocations: 1, unknownChargeAttempts: 1 });
    await expect(agent.runDirect('another', { modelTask: task })).rejects.toThrow('unknown price or charge');
  });

  it.each(['completed', 'failed', 'cancelled', 'incomplete'] as const)('records external %s outcome independently of actual zero counts', async status => {
    const agent = create(config()); const task = shared();
    await agent.beginExternalExecution({ modelTask: task });
    await agent.completeExternalExecution({ usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 }, status });
    expect(task.snapshot().invocations[0]).toMatchObject({ status: status === 'completed' ? 'succeeded' : status === 'cancelled' ? 'cancelled' : 'failed',
      usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 } });
    expect(task.snapshot().totals).toMatchObject({ unknownUsageInvocations: 0, chargedTokens: 0 });
  });

  it('combines incremental count availability and per-field final overrides without inventing missing zeros', async () => {
    const task = shared(); const agent = create(config());
    await agent.beginExternalExecution({ modelTask: task });
    agent.recordExternalUsage({ input_tokens: 8 }); agent.recordExternalUsage({ output_tokens: 2 });
    await agent.completeExternalExecution({ usage: { output_tokens: 5, service_tier: 'standard' } });
    expect(task.snapshot().invocations[0]?.usage).toMatchObject({ input_tokens: 8, output_tokens: 5, total_tokens: 13, service_tier: 'standard' });
  });

  it.each(['claude-haiku-4-5-20251001', 'claude-sonnet-4-5-20250929'])('accepts supported fixed-budget extended thinking for %s', async model => {
    const configured = config(); configured.helpers!.extractor = { connector: 'helper', model, thinking: { enabled: true, budgetTokens: 2048 }, maxOutputTokens: 4096 };
    vi.spyOn(helper, 'getModelCapabilities').mockReturnValue({ supportsTools: true, supportsVision: false, supportsJSON: true,
      supportsJSONSchema: true, maxTokens: 200_000, maxInputTokens: 200_000, maxOutputTokens: 8192 });
    await expect(create(configured).invokeHelper('extractor', 'evidence', { schema })).resolves.toMatchObject({ value: { answer: 'HELPER_VALID' } });
    expect(helper.generate.mock.calls[0]![0]).toMatchObject({ max_output_tokens: 4096, thinking: { enabled: true, budgetTokens: 2048 } });
  });

  it.each([
    { enabled: true, budgetTokens: 512 }, { enabled: true, budgetTokens: 4096 }, { enabled: true, mode: 'adaptive' as const },
  ])('rejects invalid Anthropic thinking before constructing a helper packet: %j', async thinking => {
    const configured = config(); configured.helpers!.extractor = { connector: 'helper', model: 'claude-haiku-4-5-20251001', thinking, maxOutputTokens: 4096 };
    vi.spyOn(helper, 'getModelCapabilities').mockReturnValue({ supportsTools: true, supportsVision: false, supportsJSON: true,
      supportsJSONSchema: true, maxTokens: 200_000, maxInputTokens: 200_000, maxOutputTokens: 8192 });
    const builder = vi.fn(() => 'private evidence');
    await expect(create(configured).invokeHelper('extractor', builder, { schema })).rejects.toThrow(/thinking/);
    expect(builder).not.toHaveBeenCalled(); expect(helper.generate).not.toHaveBeenCalled();
  });
});
afterEach(() => { agents.splice(0).forEach(a => a.destroy()); tasks.splice(0).forEach(t => t.destroy()); Connector.clear(); vi.useRealTimers(); });

describe('optional Agent model execution', () => {
  it.each(['run', 'stream', 'direct', 'direct-stream'] as const)('%s preserves disabled single-model behavior without extra requests', async mode => {
    const agent = create();
    if (mode === 'run') await agent.run('hello');
    else if (mode === 'direct') await agent.runDirect('hello');
    else for await (const _event of mode === 'stream' ? agent.stream('hello') : agent.streamDirect('hello')) { /* consume */ }
    expect(main.generate.mock.calls.length + main.streamGenerate.mock.calls.length).toBe(1);
    expect(helper.generate).not.toHaveBeenCalled(); expect(agent.getModelUsage()).toBeUndefined();
    expect(agent['getProvider']()).toBe(main); expect(agent.tools).toBe(agent.context.tools);
  });

  it('shares extraction/main/verification usage and preserves main context, provider and tool authority', async () => {
    const agent = create(config()); const task = shared({ maxCalls: 3, maxTokens: 30_000 });
    const before = JSON.stringify(agent.context.getConversation());
    const built: unknown[] = [];
    const extracted = await agent.invokeHelper<{ answer: string }>('extractor', packet => { built.push(packet); return 'Extract the marker.'; }, { schema, modelTask: task });
    expect(extracted.value).toEqual({ answer: 'HELPER_VALID' });
    expect(built[0]).toMatchObject({ connector: 'helper', model: 'fixture-helper', maxInputTokens: 768, maxOutputTokens: 256 });
    expect(JSON.stringify(agent.context.getConversation())).toBe(before);
    await agent.run('Use the extraction.', { modelTask: task });
    main.generate.mockResolvedValueOnce(response('{"answer":"VERIFIED"}'));
    await agent.invokeHelper('verifier', 'Verify.', { schema, modelTask: task });
    expect(task.snapshot().invocations.map(call => call.purpose)).toEqual(['extractor', 'main', 'verifier']);
    expect(task.snapshot().totals).toMatchObject({ calls: 3, totalTokens: 45 });
    const packet = helper.generate.mock.calls[0]![0];
    expect(typeof packet.input).toBe('string'); expect(packet.model).toBe('fixture-helper');
    for (const key of ['tools', 'native_tools', 'previous_response_id', 'continuation_token']) expect(packet).not.toHaveProperty(key);
    expect(agent.model).toBe('fixture-main'); expect(agent['getProvider']()).toBe(main);
    expect(helper.destroy).not.toHaveBeenCalled(); expect(main.destroy).not.toHaveBeenCalled();
  });

  it.each(['run', 'stream', 'direct', 'direct-stream'] as const)('%s records its own main-model usage once', async mode => {
    const agent = create(config());
    if (mode === 'run') await agent.run('hello');
    else if (mode === 'direct') await agent.runDirect('hello');
    else for await (const _event of mode === 'stream' ? agent.stream('hello') : agent.streamDirect('hello')) { /* consume */ }
    expect(agent.getModelUsage()?.totals).toMatchObject({ calls: 1, totalTokens: 15, unknownUsageInvocations: 0 });
  });

  it('applies direct structured repair accounting without recounting the merged response', async () => {
    const agent = create(config());
    main.generate.mockResolvedValueOnce(response('not JSON')).mockResolvedValueOnce(response('{"answer":"FIXED"}'));
    const result = await agent.runDirect('JSON please', { responseFormat: { type: 'json_schema', name: 'result', schema } });
    expect(result.output_parsed).toEqual({ answer: 'FIXED' }); expect(result.usage.total_tokens).toBe(30);
    expect(agent.getModelUsage()?.totals.totalTokens).toBe(30);
    expect(agent.getModelUsage()?.invocations.map(i => i.phase)).toEqual(['generation', 'repair']);
  });

  it('accounts for managed JSON repair separately, with no folded-usage double count', async () => {
    const agent = create(config(), { hooks: { 'after:llm': async context => { context.response.output_text = 'bad JSON'; return {}; } } });
    main.generate.mockResolvedValueOnce(response('{"answer":"INITIAL"}')).mockResolvedValueOnce(response('{"answer":"FIXED"}'));
    await agent.run('JSON please', { responseFormat: { type: 'json_schema', name: 'result', schema } });
    expect(agent.getModelUsage()?.totals.totalTokens).toBe(30);
    expect(agent.getModelUsage()?.invocations.map(i => i.phase)).toEqual(['generation', 'repair']);
  });

  it('validates helper JSON schema and bounds repairs rather than accepting parseable wrong shapes', async () => {
    const agent = create(config()); const task = shared({ maxCalls: 2 });
    helper.generate.mockResolvedValue(response('{"wrong":"shape"}', 'fixture-helper'));
    await expect(agent.invokeHelper('extractor', 'Extract.', { schema, modelTask: task })).rejects.toBeInstanceOf(HelperOutputError);
    expect(helper.generate).toHaveBeenCalledTimes(2);
    expect(task.snapshot().invocations.map(i => i.phase)).toEqual(['generation', 'repair']);
    expect(task.snapshot().totals.totalTokens).toBe(30);
  });

  it('repairs once, shares the same task budget and supports explicit escalation to another configured role', async () => {
    const agent = create(config()); const task = shared({ maxCalls: 3 });
    helper.generate.mockResolvedValueOnce(response('broken')).mockResolvedValueOnce(response('{"answer":"REPAIRED"}'));
    const result = await agent.invokeHelper('extractor', 'Extract.', { schema, modelTask: task });
    expect(result.value).toEqual({ answer: 'REPAIRED' });
    main.generate.mockResolvedValueOnce(response('{"answer":"VERIFIED"}'));
    await agent.invokeHelper('verifier', 'Verify repaired data.', { schema, modelTask: task });
    expect(task.snapshot().totals.calls).toBe(3);
    expect(task.snapshot().invocations.map(i => i.purpose)).toEqual(['extractor', 'extractor', 'verifier']);
  });

  it('does not dispatch a repair after exhausting the shared call budget', async () => {
    const agent = create(config()); const task = shared({ maxCalls: 1 });
    helper.generate.mockResolvedValue(response('broken'));
    await expect(agent.invokeHelper('extractor', 'Extract.', { schema, modelTask: task })).rejects.toThrow('maxCalls');
    expect(helper.generate).toHaveBeenCalledTimes(1);
  });

  it('resolves connector access before building a helper packet and preserves scoped denial', async () => {
    const registry = { get: (name: string) => { if (name === 'helper') throw new ConnectorNotFoundError(); return Connector.get(name); } } as unknown as IConnectorRegistry;
    const agent = create(config(), { registry }); const build = vi.fn(() => 'sensitive text');
    await expect(agent.invokeHelper('extractor', build, { schema })).rejects.toBeInstanceOf(ConnectorNotFoundError);
    expect(build).not.toHaveBeenCalled(); expect(helper.generate).not.toHaveBeenCalled();
  });

  it('captures the admitted helper connector even if a packet builder changes the registry', async () => {
    const replacement = provider(1024, '{"answer":"REPLACEMENT"}');
    const original = Connector.get('helper'); let selected = original;
    const registry = { get: (name: string) => name === 'helper' ? selected : Connector.get(name) } as unknown as IConnectorRegistry;
    const agent = create(config(), { registry });
    const result = await agent.invokeHelper('extractor', () => {
      Connector.remove('helper');
      selected = Connector.create({ name: 'helper', vendor: Vendor.Anthropic, auth: { type: 'none' }, options: { provider: replacement } });
      return 'Explicit packet.';
    }, { schema });
    expect(result.value).toEqual({ answer: 'HELPER_VALID' }); expect(replacement.generate).not.toHaveBeenCalled();
  });

  it('rejects unsupported effort, native schema requirements and invalid packets before dispatch', async () => {
    const configured = config(); configured.helpers!.extractor!.thinking = { enabled: true, effort: 'max' };
    const agent = create(configured); const build = vi.fn(() => 'packet');
    await expect(agent.invokeHelper('extractor', build, { schema })).rejects.toThrow('reasoning effort'); expect(build).not.toHaveBeenCalled();
    configured.helpers!.extractor!.thinking = undefined;
    configured.helpers!.extractor!.requireNativeStructuredOutput = true;
    vi.spyOn(helper, 'getModelCapabilities').mockReturnValue({ supportsTools: true, supportsVision: false, supportsJSON: false, supportsJSONSchema: false, maxTokens: 1024, maxInputTokens: 1024, maxOutputTokens: 1024 });
    await expect(agent.invokeHelper('extractor', build, { schema })).rejects.toThrow('native structured'); expect(build).not.toHaveBeenCalled();
    expect(helper.generate).not.toHaveBeenCalled();
  });

  it('rejects native/opaque items and oversized text instead of transferring or silently trimming them', async () => {
    const agent = create(config());
    await expect(agent.invokeHelper('extractor', [{ type: 'reasoning', encrypted_content: 'PRIVATE' }] as never, { schema })).rejects.toThrow('explicit text');
    await expect(agent.invokeHelper('extractor', 'huge '.repeat(3000), { schema })).rejects.toThrow('input allowance');
    expect(helper.generate).not.toHaveBeenCalled();
  });

  it('requires explicit cross-connector context transfer and strips opaque state for rollover', async () => {
    const configured = config(); configured.helpers!.compactor!.allowContextTransfer = false;
    const agent = create(configured);
    agent.context.addInputItems([
      { type: 'message', role: MessageRole.USER, content: [{ type: ContentType.INPUT_TEXT, text: 'Remember SOURCE_123.' }] },
      { type: 'message', role: MessageRole.ASSISTANT, content: [{ type: ContentType.THINKING, persistInHistory: true, thinking: 'PRIVATE_REASONING', signature: 'PRIVATE_SIGNATURE' }, { type: ContentType.OUTPUT_TEXT, text: 'Noted.' }] },
    ]);
    const original = JSON.stringify(agent.context.getConversation());
    await expect(agent.rolloverContext({ preserveRecentTurns: 0 })).rejects.toThrow('allowContextTransfer');
    expect(JSON.stringify(agent.context.getConversation())).toBe(original);
    configured.helpers!.compactor!.allowContextTransfer = true;
    helper.generate.mockResolvedValueOnce(response('{"summary":"Remember SOURCE_123."}'));
    const result = await agent.rolloverContext({ preserveRecentTurns: 0 }); expect(result.performed).toBe(true);
    const packet = JSON.stringify(helper.generate.mock.calls[0]![0]);
    expect(packet).toContain('SOURCE_123'); expect(packet).not.toContain('PRIVATE_REASONING'); expect(packet).not.toContain('PRIVATE_SIGNATURE');
    expect(main.generate).not.toHaveBeenCalled(); expect(agent['getProvider']()).toBe(main);
  });

  it('does not serialize helper credentials, task authority or usage reservations with context', async () => {
    const agent = create(config()); await agent.invokeHelper('extractor', 'packet', { schema });
    const state = JSON.parse(JSON.stringify(agent.context.getState()));
    expect(JSON.stringify(state)).not.toContain('modelExecution'); expect(JSON.stringify(state)).not.toContain('modelTask');
    const restored = create(); restored.context.restoreState(state);
    expect(restored.getModelUsage()).toBeUndefined();
    await expect(restored.invokeHelper('extractor', 'packet', { schema })).rejects.toThrow('not configured');
  });

  it('cancels an asynchronous packet builder before dispatch when its task expires', async () => {
    vi.useFakeTimers(); const agent = create(config()); const task = shared({ deadline: Date.now() + 10 });
    const failure = agent.invokeHelper('extractor', async () => new Promise<string>(() => undefined), { schema, modelTask: task }).catch(e => e);
    await vi.advanceTimersByTimeAsync(11); expect((await failure).name).toBe('TimeoutError'); expect(helper.generate).not.toHaveBeenCalled();
  });

  it('destroy cancels a helper that ignores its signal and observes late settlement without updating context', async () => {
    const agent = create(config()); let release!: (value: ReturnType<typeof response>) => void;
    helper.generate.mockImplementationOnce(async () => new Promise(resolve => { release = resolve; }));
    const pending = agent.invokeHelper('extractor', 'packet', { schema }).catch(e => e);
    await vi.waitFor(() => expect(helper.generate).toHaveBeenCalledTimes(1));
    agent.destroy(); expect((await pending).name).toBe('AbortError'); release(response('{"answer":"PRIVATE_LATE"}'));
    await vi.waitFor(() => expect(agent.getModelUsage()?.invocations[0]?.lateSettlement).toBe(true));
  });

  it('attributes external final usage once even when incremental usage and a final snapshot both arrive', async () => {
    const agent = create(config()); const task = shared();
    await agent.beginExternalExecution({ modelTask: task });
    agent.recordExternalUsage(usage);
    await agent.completeExternalExecution({ usage });
    expect(task.snapshot().totals).toMatchObject({ calls: 1, totalTokens: 15 });
    expect(task.snapshot().invocations[0]).toMatchObject({ purpose: 'external', external: true });
  });

  it('preserves unknown or mixed external pricing metadata without changing the legacy response usage', async () => {
    const agent = create(config()); const task = shared();
    await agent.beginExternalExecution({ modelTask: task });
    agent.recordExternalUsage({ ...usage, service_tier: 'standard' });
    agent.recordExternalUsage({ ...usage, service_tier: 'priority' });
    const response = await agent.completeExternalExecution();
    expect(response.usage.total_tokens).toBe(30); expect(response.usage.service_tier).toBeUndefined();
    expect(task.snapshot().invocations[0]?.usage?.service_tier).toBe('mixed_external_tiers');
    expect(task.snapshot().invocations[0]?.modelCostUSD).toBeNull();
    await agent.beginExternalExecution({ modelTask: task });
    await agent.completeExternalExecution({ usage: { ...usage, service_tier: 'unknown-premium' } });
    expect(task.snapshot().totals).toMatchObject({ calls: 2, totalTokens: 45, unknownCostInvocations: 2 });
  });

  it('inherits restrictive host data policy and never requests helper cache state', async () => {
    const configured = config(); configured.helpers!.extractor!.dataHandling = { allowProviderCaching: true, allowProviderTools: true };
    const agent = create(configured, { dataHandling: { allowProviderCaching: false, allowProviderTools: false } });
    await agent.invokeHelper('extractor', 'packet', { schema });
    expect(helper.generate.mock.calls[0]![0]).toMatchObject({ prompt_cache: { mode: 'off' },
      data_handling: { allowProviderCaching: false, allowProviderTools: false } });
  });

  it('rejects unrequested helper tools even alongside valid JSON, without dispatching or retrying them', async () => {
    const agent = create(config()); const execute = vi.fn(async () => 'forbidden'); const task = shared();
    agent.tools.register({ definition: { type: 'function', function: { name: 'dangerous', parameters: { type: 'object', properties: {} } } }, execute });
    const raw = response('{"answer":"claimed"}');
    raw.output = [{ type: 'message', role: MessageRole.ASSISTANT, content: [
      { type: ContentType.TOOL_USE, id: 'unexpected', name: 'dangerous', arguments: '{}' },
    ] }] as unknown as typeof raw.output;
    helper.generate.mockResolvedValueOnce(raw);
    await expect(agent.invokeHelper('extractor', 'packet', { schema, modelTask: task })).rejects.toThrow('tool-free');
    expect(execute).not.toHaveBeenCalled(); expect(helper.generate).toHaveBeenCalledTimes(1);
    expect(task.snapshot().invocations[0]?.outputValidation).toBe('failed');
  });

  it('validates output formats locally and permits only a tighter per-call helper output cap', async () => {
    const agent = create(config());
    const result = await agent.invokeHelper('extractor', 'packet', { schema, maxOutputTokens: 16 });
    expect(result.value).toEqual({ answer: 'HELPER_VALID' });
    expect(helper.generate.mock.calls[0]![0].max_output_tokens).toBe(16);
    await expect(agent.invokeHelper('extractor', 'packet', { maxRepairAttempts: 0,
      schema: { ...schema, properties: { answer: { type: 'string', format: 'date-time' } } } })).rejects.toBeInstanceOf(HelperOutputError);
  });

  it('fails hard-budget admission for opaque custom providers unless the host attests single attempts', async () => {
    const configured = config(); delete configured.customProviderAttempts;
    const agent = create(configured); const task = shared({ maxCalls: 1 });
    await expect(agent.runDirect('hello', { modelTask: task })).rejects.toThrow('host attestation');
    expect(main.generate).not.toHaveBeenCalled();
    configured.customProviderAttempts = 'single';
    await agent.runDirect('hello', { modelTask: task }); expect(task.snapshot().totals.calls).toBe(1);
  });

  it('agent.cancel binds to a standalone helper, while a late result cannot contaminate the next main task', async () => {
    const agent = create(config()); const task = shared(); let release!: (value: ReturnType<typeof response>) => void;
    helper.generate.mockImplementationOnce(async () => new Promise(resolve => { release = resolve; }));
    const pending = agent.invokeHelper('extractor', 'packet', { schema, modelTask: task }).catch(e => e);
    await vi.waitFor(() => expect(helper.generate).toHaveBeenCalledTimes(1)); agent.cancel();
    expect((await pending).name).toBe('AbortError');
    await agent.run('new task'); release(response('{"answer":"LATE_PRIVATE"}'));
    await vi.waitFor(() => expect(task.snapshot().invocations[0]?.lateSettlement).toBe(true));
    expect(agent.getModelUsage()?.totals.totalTokens).toBe(15);
    expect(JSON.stringify(agent.context.getState())).not.toContain('LATE_PRIVATE');
  });

  it.each(['direct', 'direct-stream'] as const)('%s cleans up its owned task when structured preflight fails', async mode => {
    vi.useFakeTimers();
    const agent = create({ ...config(), limits: { deadline: Date.now() + 60_000 } });
    const capabilities = vi.spyOn(main, 'getModelCapabilities').mockImplementation(() => { throw new Error('preflight failed'); });
    const options = { responseFormat: { type: 'json_schema' as const, schema } };
    if (mode === 'direct') await expect(agent.runDirect('packet', options)).rejects.toThrow('preflight failed');
    else await expect(agent.streamDirect('packet', options).next()).rejects.toThrow('preflight failed');
    expect(vi.getTimerCount()).toBe(0); expect(main.generate).not.toHaveBeenCalled();
    capabilities.mockRestore();
  });

  it.each([
    { type: 'object', unknownKeyword: true }, { type: 'not-a-json-schema-type' }, { $async: true, type: 'object' },
  ])('rejects unsupported host schemas before building or dispatching the packet: %j', async invalidSchema => {
    const agent = create(config()); const builder = vi.fn(() => 'packet');
    await expect(agent.invokeHelper('extractor', builder, { schema: invalidSchema })).rejects.toThrow();
    expect(builder).not.toHaveBeenCalled(); expect(helper.generate).not.toHaveBeenCalled();
  });

  it.each(['incomplete', 'refusal', 'oversized'] as const)('rejects %s helper output without implicit escalation', async condition => {
    const agent = create(config()); const task = shared(); const raw = response('{"answer":"claimed"}');
    if (condition === 'incomplete') Object.assign(raw, { status: 'incomplete' });
    else if (condition === 'refusal') Object.assign(raw, { stop_reason: 'refusal' });
    else raw.usage.output_tokens = 257;
    helper.generate.mockResolvedValueOnce(raw);
    await expect(agent.invokeHelper('extractor', 'packet', { schema, modelTask: task })).rejects.toBeInstanceOf(HelperOutputError);
    expect(helper.generate).toHaveBeenCalledTimes(1); expect(main.generate).not.toHaveBeenCalled();
    expect(task.snapshot().invocations[0]?.outputValidation).toBe('failed');
  });

  it.each([0, 2048])('rejects invalid main output bounds %s before dispatch', async cap => {
    const agent = create({ ...config(), maxOutputTokensPerCall: cap });
    await expect(agent.runDirect('packet')).rejects.toThrow(/output/i); expect(main.generate).not.toHaveBeenCalled();
  });

  it('rejects an explicit cap increase, unknown capacity and native-service fees under a monetary ceiling', async () => {
    const agent = create({ ...config(), maxOutputTokensPerCall: 128 }); const task = shared({ maxCostUSD: 1 });
    await expect(agent.runDirect('packet', { maxOutputTokens: 256 })).rejects.toThrow('output limit');
    await expect(agent.runDirect('packet', { modelTask: task, nativeTools: [{ capability: 'web_search' }] as never })).rejects.toThrow('tool fees');
    vi.spyOn(main, 'getModelCapabilities').mockReturnValue({ supportsTools: false, supportsVision: false, supportsJSON: false,
      supportsJSONSchema: false, maxTokens: 0, maxInputTokens: 0, maxOutputTokens: 0 });
    await expect(agent.runDirect('packet')).rejects.toThrow('capacity'); expect(main.generate).not.toHaveBeenCalled();
  });

  it('checks registered vendor identity and enabled reasoning before evaluating a helper packet', async () => {
    const configured = config(); const agent = create(configured); const builder = vi.fn(() => 'packet');
    configured.helpers!.extractor!.model = 'gpt-4o-mini';
    await expect(agent.invokeHelper('extractor', builder, { schema })).rejects.toThrow('vendor');
    configured.helpers!.extractor!.model = 'fixture-helper'; configured.helpers!.extractor!.thinking = { enabled: true };
    await expect(agent.invokeHelper('extractor', builder, { schema })).rejects.toThrow('reasoning');
    expect(builder).not.toHaveBeenCalled(); expect(helper.generate).not.toHaveBeenCalled();
  });

  it('rejects nonpositive helper capacity and out-of-contract repair configuration before dispatch', async () => {
    const configured = config(); const agent = create(configured); const builder = vi.fn(() => 'packet');
    configured.helpers!.extractor!.maxInputTokens = 0;
    await expect(agent.invokeHelper('extractor', builder, { schema })).rejects.toThrow('limits');
    configured.helpers!.extractor!.maxInputTokens = undefined;
    await expect(agent.invokeHelper('extractor', builder, { schema, maxRepairAttempts: 2 as never })).rejects.toThrow('0 or 1');
    expect(builder).not.toHaveBeenCalled(); expect(helper.generate).not.toHaveBeenCalled();
  });
});
