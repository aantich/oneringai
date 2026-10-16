import { afterEach, describe, expect, it, vi } from 'vitest';
import { Agent, Connector, Vendor, ModelTask, StrategyRegistry, ToolCallState, StructuredSummaryStrategy, InMemoryEvidenceStorage, ContentType, MessageRole, StreamEventType } from '../../../../../src/index.js';
import type { ITextProvider, TextGenerateOptions, ModelExecutionConfig, InputItem, LLMResponse } from '../../../../../src/index.js';
const agents: Agent[] = []; const tasks: ModelTask[] = [];
afterEach(() => { agents.splice(0).forEach(a => a.destroy()); tasks.splice(0).forEach(t => t.destroy()); Connector.remove('stage07-main'); Connector.remove('stage07-helper'); vi.restoreAllMocks(); });
const usage = { input_tokens: 20, output_tokens: 10, total_tokens: 30 };
const response = (text: string, model: string) => ({ id: 'r', object: 'response' as const, created_at: 1, model, status: 'completed' as const, output_text: text,
  output: [{ type: 'message' as const, role: MessageRole.ASSISTANT, content: [{ type: ContentType.OUTPUT_TEXT as const, text }] }], usage });
function provider(generate: (options: TextGenerateOptions) => Promise<LLMResponse>): ITextProvider {
  return { name: 'stage07-fixture', capabilities: { text: true, images: false, videos: false, audio: false }, generate,
    async *streamGenerate(options) { const result = await generate(options); yield { type: StreamEventType.OUTPUT_TEXT_DELTA, response_id: 'r', item_id: 't', output_index: 0, content_index: 0, sequence_number: 1, delta: result.output_text ?? '' };
      yield { type: StreamEventType.RESPONSE_COMPLETE, response_id: 'r', status: 'completed', usage, iterations: 1 }; },
    getModelCapabilities: () => ({ supportsTools: true, supportsVision: false, supportsJSON: true, supportsJSONSchema: true, maxTokens: 32768, maxInputTokens: 32768, maxOutputTokens: 2048 }),
    validateConfig: async () => true, listModels: async () => [] };
}
async function fixture(extra: Partial<ModelExecutionConfig> = {}, strict = false) {
  const main = vi.fn<(o: TextGenerateOptions) => Promise<LLMResponse>>(async (o: TextGenerateOptions) => response('MAIN_DONE', o.model));
  const helper = vi.fn(async (o: TextGenerateOptions) => {
    const schema = o.response_format?.type === 'json_schema' ? o.response_format.json_schema.schema : undefined;
    const id = (schema as { properties: { completedWork: { items: { properties: { sourceIds: { items: { enum: string[] } } } } } } }).properties.completedWork.items.properties.sourceIds.items.enum[0]!;
    return response(JSON.stringify({ completedWork: [{ text: 'Observed SOURCE_07; no writes repeated.', sourceIds: [id] }], activeWork: [], constraints: [], decisions: [], uncertainties: [], artifacts: [], actionReceipts: [] }), o.model);
  });
  Connector.create({ name: 'stage07-main', vendor: Vendor.OpenAI, auth: { type: 'none' }, options: { provider: provider(main) } });
  Connector.create({ name: 'stage07-helper', vendor: Vendor.OpenAI, auth: { type: 'none' }, options: { provider: provider(helper) } });
  const storage = new InMemoryEvidenceStorage({ scope: { ownerId: 'owner', namespace: 'agent-stage07' } });
  const raw = { id: 'SOURCE_07', padding: 'Long source observation. '.repeat(1400) };
  const reference = await storage.put({ version: 1, recordedAt: 1, source: { toolName: 'lookup', callId: 'call', executionId: 'original', arguments: {}, principal: {}, effect: 'read', status: 'succeeded', completion: 'settled', startedAt: 1, durationMs: 1 }, result: raw });
  const agent = Agent.create({ connector: 'stage07-main', model: 'fixture-main', thinking: { enabled: false }, emptyResponseRetry: { enabled: false },
    modelExecution: { customProviderAttempts: 'single', helpers: { compactor: { connector: 'stage07-helper', model: 'fixture-helper', allowContextTransfer: true, maxInputTokens: 20000, maxOutputTokens: 1024 } }, ...extra },
    context: { model: 'fixture-main', maxContextTokens: 5000, responseReserve: 128, criticalCompactionThreshold: 0.8,
      compactionStrategy: new StructuredSummaryStrategy({ preserveRecentTurns: 0, preserveRecentMessages: 0, maxSourceTokens: 20000, fallback: strict ? 'error' : 'mask' }),
      features: { workingMemory: false, inContextMemory: false, evidence: true }, plugins: { evidence: { storage } } },
  }); agents.push(agent);
  const items: InputItem[] = [{ type: 'message', role: MessageRole.USER, content: [{ type: ContentType.INPUT_TEXT, text: 'Never repeat a write. Exact current ID: SOURCE_07.' }] },
    { type: 'message', role: MessageRole.ASSISTANT, content: [{ type: ContentType.TOOL_USE, id: 'call', name: 'lookup', arguments: '{}' }] },
    { type: 'message', role: MessageRole.USER, content: [{ type: ContentType.TOOL_RESULT, tool_use_id: 'call', content: raw, evidence: { version: 1, status: 'stored', executionId: 'original', reference } }] }];
  agent.context.addInputItems(items); return { agent, main, helper, storage, raw };
}
describe('Stage 07 Agent helper integration', () => {
  it.each(['run', 'stream'] as const)('%s repairs the actual Google all-empty summary before main dispatch', async mode => {
    const { agent, main, helper } = await fixture({}, true);
    const valid = helper.getMockImplementation()!;
    helper.mockImplementationOnce(async o => response('{"completedWork":[],"activeWork":[],"constraints":[],"decisions":[],"uncertainties":[],"artifacts":[],"actionReceipts":[]}', o.model));
    helper.mockImplementation(valid);
    const task = new ModelTask({ limits: { maxCalls: 3 } }); tasks.push(task);
    if (mode === 'run') await agent.run('Continue.', { modelTask: task });
    else for await (const _event of agent.stream('Continue.', { modelTask: task })) { /* Drain completion. */ }
    expect(helper).toHaveBeenCalledTimes(2); expect(main).toHaveBeenCalledTimes(1);
    expect(task.snapshot().invocations.map(i => [i.purpose, i.phase, i.outputValidation])).toEqual([
      ['compactor', 'generation', 'failed'], ['compactor', 'repair', 'passed'], ['main', 'generation', undefined],
    ]);
    expect(agent.context.lastPreparation!.compaction).toMatchObject({ applied: true, helperInvoked: true });
    expect(agent.context.lastPreparation!.compaction?.fallback).toBeUndefined();
    expect(JSON.stringify(helper.mock.calls[1]![0].input)).toContain('Original task and evidence');
  });
  it.each(['empty', 'whitespace', 'oversized'] as const)('repairs %s content within the original helper allowance', async invalid => {
    const { agent, helper, main } = await fixture({}, true); const valid = helper.getMockImplementation()!;
    helper.mockImplementationOnce(async o => {
      const good = await valid(o); const value = JSON.parse(good.output_text!);
      if (invalid === 'empty') value.completedWork = [];
      else value.completedWork[0].text = invalid === 'whitespace' ? ' \n\t ' : 'x'.repeat(601);
      return response(JSON.stringify(value), o.model);
    });
    await agent.run('Continue.');
    expect(helper).toHaveBeenCalledTimes(2); expect(main).toHaveBeenCalledTimes(1);
    expect(agent.getModelUsage()!.invocations.filter(i => i.purpose === 'compactor').map(i => i.outputValidation)).toEqual(['failed', 'passed']);
    expect(agent.context.lastPreparation!.compaction?.fallback).toBeUndefined();
  });
  it.each(['completedWork', 'activeWork', 'constraints', 'decisions', 'uncertainties', 'artifacts', 'actionReceipts'])('accepts a nonempty %s section without requiring a new fixed section', async section => {
    const { agent, helper, main } = await fixture({}, true); const valid = helper.getMockImplementation()!;
    helper.mockImplementation(async o => { const good = await valid(o); const value = JSON.parse(good.output_text!); value[section] = value.completedWork; if (section !== 'completedWork') value.completedWork = []; return response(JSON.stringify(value), o.model); });
    await agent.run('Continue.'); expect(helper).toHaveBeenCalledTimes(1); expect(main).toHaveBeenCalledTimes(1);
    expect(agent.context.lastPreparation!.compaction?.fallback).toBeUndefined();
  });
  it.each([false, true])('bounds repeated empty output and preserves fallback=%s', async strict => {
    const { agent, helper, main, raw } = await fixture({}, strict);
    helper.mockImplementation(async o => response('{"completedWork":[],"activeWork":[],"constraints":[],"decisions":[],"uncertainties":[],"artifacts":[],"actionReceipts":[]}', o.model));
    if (strict) {
      await expect(agent.run('Continue.')).rejects.toThrow('bounded repair'); expect(main).not.toHaveBeenCalled();
      expect(JSON.stringify(await agent.getContextState())).toContain(raw.padding);
    } else { await agent.run('Continue.'); expect(main).toHaveBeenCalledTimes(1); expect(agent.context.lastPreparation!.compaction).toMatchObject({ fallback: 'mask', applied: true }); }
    expect(helper).toHaveBeenCalledTimes(2); expect(agent.getModelUsage()!.invocations.filter(i => i.purpose === 'compactor').map(i => i.outputValidation)).toEqual(['failed', 'failed']);
  });
  it('does not dispatch empty-summary repair beyond the shared call budget', async () => {
    const { agent, helper, main, raw } = await fixture({}, true);
    helper.mockImplementation(async o => response('{"completedWork":[],"activeWork":[],"constraints":[],"decisions":[],"uncertainties":[],"artifacts":[],"actionReceipts":[]}', o.model));
    const task = new ModelTask({ limits: { maxCalls: 1 } }); tasks.push(task);
    await expect(agent.run('Continue.', { modelTask: task })).rejects.toThrow();
    expect(helper).toHaveBeenCalledTimes(1); expect(main).not.toHaveBeenCalled();
    expect(task.snapshot().invocations[0]?.outputValidation).toBe('failed'); expect(task.snapshot().totals.calls).toBe(1);
    expect(JSON.stringify(await agent.getContextState())).toContain(raw.padding);
  });
  it('cancels an empty-summary repair without applying or dispatching main', async () => {
    const { agent, helper, main, raw } = await fixture({}, true);
    helper.mockImplementationOnce(async o => response('{"completedWork":[],"activeWork":[],"constraints":[],"decisions":[],"uncertainties":[],"artifacts":[],"actionReceipts":[]}', o.model));
    let entered!: () => void; const ready = new Promise<void>(r => { entered = r; });
    helper.mockImplementation(async () => { entered(); return new Promise(() => {}); });
    const work = agent.run('Continue.'); const rejected = expect(work).rejects.toThrow(); await ready; agent.cancel(); await rejected;
    expect(helper).toHaveBeenCalledTimes(2); expect(main).not.toHaveBeenCalled(); expect(JSON.stringify(await agent.getContextState())).toContain(raw.padding);
  });
  it.each(['run', 'stream'] as const)('%s shares main/helper task accounting without a second compaction owner', async mode => {
    const { agent, main, helper } = await fixture(); const task = new ModelTask({ limits: { maxCalls: 4 } }); tasks.push(task);
    if (mode === 'run') expect((await agent.run('Continue.', { modelTask: task })).output_text).toBe('MAIN_DONE');
    else { let text = ''; for await (const event of agent.stream('Continue.', { modelTask: task })) if (event.type === StreamEventType.OUTPUT_TEXT_DELTA) text += event.delta; expect(text).toBe('MAIN_DONE'); }
    expect(main).toHaveBeenCalledTimes(1); expect(helper).toHaveBeenCalledTimes(1);
    expect(task.snapshot().invocations.map(i => i.purpose)).toEqual(['compactor', 'main']); expect(task.snapshot().totals.calls).toBe(2);
    expect(helper.mock.calls[0]![0].tools).toBeUndefined(); expect(JSON.stringify(main.mock.calls[0]![0].input)).toContain('Earlier context summary');
  });
  it('delivers new source results to the real next request after a summary', async () => {
    const { agent, main } = await fixture();
    agent.tools.register({ definition: { type: 'function', function: { name: 'post_summary_read', parameters: { type: 'object', properties: {}, additionalProperties: false } } }, execute: async () => ({ answer: 'EXACT_POST_SUMMARY_07' }), output: { effect: 'read' } });
    main.mockImplementation(async options => {
      if (main.mock.calls.length === 1) return { ...response('', options.model), output: [{ type: 'message', role: MessageRole.ASSISTANT, content: [{ type: ContentType.TOOL_USE, id: 'after-summary', name: 'post_summary_read', arguments: '{}' }] }] };
      expect(JSON.stringify(options.input)).toContain('EXACT_POST_SUMMARY_07'); return response('MAIN_DONE', options.model);
    });
    expect((await agent.run('Retrieve the exact source fact.')).output_text).toBe('MAIN_DONE'); expect(main).toHaveBeenCalledTimes(2);
  });
  it('one schema repair is accounted; a second invalid output falls back without more helper calls', async () => {
    const { agent, main, helper } = await fixture(); helper.mockImplementation(async o => response('invalid-json', o.model));
    await agent.run('Continue.'); expect(helper).toHaveBeenCalledTimes(2); expect(main).toHaveBeenCalledTimes(1);
    expect(agent.getModelUsage()!.invocations.map(i => i.phase)).toEqual(['generation', 'repair', 'generation']);
    expect(agent.context.lastPreparation!.compaction).toMatchObject({ fallback: 'mask', applied: true });
  });
  it('a call budget exhausted by the helper prevents main dispatch', async () => {
    const { agent, main, helper } = await fixture(); const task = new ModelTask({ limits: { maxCalls: 1 } }); tasks.push(task);
    await expect(agent.run('Continue.', { modelTask: task })).rejects.toThrow(); expect(helper).toHaveBeenCalledTimes(1); expect(main).not.toHaveBeenCalled(); expect(task.snapshot().totals.calls).toBe(1);
  });
  it.each(['transfer', 'input-limit', 'missing-role'] as const)('strict mode rejects %s before helper/main dispatch', async mode => {
    const helpers: ModelExecutionConfig['helpers'] = mode === 'missing-role' ? {} : { compactor: { connector: 'stage07-helper', model: 'fixture-helper', allowContextTransfer: mode !== 'transfer', maxInputTokens: mode === 'input-limit' ? 100 : 20000 } };
    const { agent, main, helper, raw } = await fixture({ helpers }, true);
    await expect(agent.run('Continue.')).rejects.toThrow(); expect(helper).not.toHaveBeenCalled(); expect(main).not.toHaveBeenCalled(); expect(JSON.stringify(await agent.getContextState())).toContain(raw.padding);
  });
  it('cancel propagates during the automatic helper and retains raw state', async () => {
    const { agent, main, helper, raw } = await fixture(); let entered!: () => void; const ready = new Promise<void>(r => { entered = r; });
    helper.mockImplementation(async () => { entered(); return new Promise(() => {}); });
    const run = agent.run('Continue.'); const rejected = expect(run).rejects.toThrow(); await ready; agent.cancel(); await rejected;
    expect(main).not.toHaveBeenCalled(); expect(JSON.stringify(await agent.getContextState())).toContain(raw.padding);
  });
  it('context changes during a real helper boundary reject apply instead of losing new input', async () => {
    const { agent, main, helper, raw } = await fixture(); const impl = helper.getMockImplementation()!;
    helper.mockImplementation(async o => { agent.context.addInputItems([{ type: 'message', role: MessageRole.USER, content: [{ type: ContentType.INPUT_TEXT, text: 'NEW_CORRECTION' }] }]); return impl(o); });
    await expect(agent.run('Continue.')).rejects.toThrow('Context changed'); expect(main).not.toHaveBeenCalled(); const state = JSON.stringify(await agent.getContextState()); expect(state).toContain('NEW_CORRECTION'); expect(state).toContain(raw.padding);
  });
  it('opaque replay items stay exact and never enter the helper packet', async () => {
    const { agent, helper } = await fixture(); agent.context.addInputItems([{ type: 'reasoning', id: 'opaque', summary: 'OPAQUE_SECRET', encrypted_content: 'CIPHER' } as InputItem]);
    await agent.run('Continue.'); expect(JSON.stringify(helper.mock.calls)).not.toContain('OPAQUE_SECRET'); expect(JSON.stringify(await agent.getContextState())).toContain('CIPHER');
  });
  it('compacts real admitted tool results with optional undefined metadata', async () => {
    const { agent, helper, raw } = await fixture(); agent.context.clearConversation();
    agent.tools.register({ definition: { type: 'function', function: { name: 'actual_lookup', parameters: { type: 'object', properties: {}, additionalProperties: false } } }, execute: async () => raw, output: { effect: 'read' } });
    const report = await agent.tools.executeWithOutcome('actual_lookup', {}, { callId: 'actual' });
    agent.context.addInputItems([{ type: 'message', role: MessageRole.ASSISTANT, content: [{ type: ContentType.TOOL_USE, id: 'actual', name: 'actual_lookup', arguments: '{}' }] }]);
    agent.context.addToolResults([{ tool_use_id: 'actual', tool_name: 'actual_lookup', content: report.result, state: ToolCallState.COMPLETED, outcome: report.outcome, evidence: report.evidence }]);
    agent.context.addAssistantResponse([{ type: 'message', role: MessageRole.ASSISTANT, content: [{ type: ContentType.OUTPUT_TEXT, text: 'Read completed.' }] }]);
    await agent.run('Continue.'); expect(helper).toHaveBeenCalledTimes(1); expect(JSON.stringify(await agent.getContextState())).not.toContain(raw.padding);
  });
  it('configuring a compactor alone does not change automatic algorithmic behavior', async () => {
    const { agent, helper } = await fixture(); agent.context.setCompactionStrategy(StrategyRegistry.create('algorithmic')); await agent.run('Continue.'); expect(helper).not.toHaveBeenCalled();
  });

  it.each(['run', 'stream'] as const)('%s: known no-op compaction leaves the sole model-call budget for main', async mode => {
    const { agent, main, helper, storage } = await fixture(); agent.context.clearConversation();
    agent.context.setCompactionStrategy(new StructuredSummaryStrategy());
    const message = (role: MessageRole, text: string): InputItem => ({ type: 'message', role, content: [{ type: role === MessageRole.USER ? ContentType.INPUT_TEXT : ContentType.OUTPUT_TEXT, text }] });
    agent.context.addInputItems([message(MessageRole.USER, 'Exact unchanged user constraint. '.repeat(400)), message(MessageRole.USER, 'Recent first.'), message(MessageRole.ASSISTANT, 'OK.'), message(MessageRole.USER, 'Recent second.'), message(MessageRole.ASSISTANT, 'OK.')]);
    const put = vi.spyOn(storage, 'put'); const task = new ModelTask({ limits: { maxCalls: 1 } }); tasks.push(task);
    if (mode === 'run') expect((await agent.run('Continue.', { modelTask: task })).output_text).toBe('MAIN_DONE');
    else for await (const _event of agent.stream('Continue.', { modelTask: task })) { /* Fully drain to validate settlement. */ }
    expect(main).toHaveBeenCalledTimes(1); expect(helper).not.toHaveBeenCalled(); expect(put).not.toHaveBeenCalled();
    expect(task.snapshot().totals.calls).toBe(1); expect(task.snapshot().invocations.map(i => i.purpose)).toEqual(['main']);
  });
});
