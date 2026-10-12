import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Agent } from '@/core/Agent.js';
import { Connector } from '@/core/Connector.js';
import { Vendor } from '@/core/Vendor.js';
import { BasePluginNextGen } from '@/core/context-nextgen/BasePluginNextGen.js';
import { DEFAULT_FEATURES } from '@/core/context-nextgen/types.js';
import { ContentType } from '@/domain/entities/Content.js';
import { MessageRole } from '@/domain/entities/Message.js';
import { StreamEventType } from '@/domain/entities/StreamEvent.js';
import type { TextGenerateOptions } from '@/domain/interfaces/ITextProvider.js';
import type { ICompactionStrategy } from '@/core/context-nextgen/types.js';
import { inspectContext } from '../../../apps/amos/src/agent/contextInspection.js';
import { DefaultCompactionStrategy } from '@/core/context-nextgen/strategies/DefaultCompactionStrategy.js';
import { ToolCallState } from '@/domain/entities/Tool.js';

const provider = vi.hoisted(() => ({ generate: vi.fn(), streamGenerate: vi.fn(), name: 'fixture',
  capabilities: { text: true, images: true, videos: false, audio: false },
  getModelCapabilities: () => ({ supportsTools: true, supportsVision: true, supportsJSON: true,
    supportsJSONSchema: true, maxTokens: 128000, maxOutputTokens: 4096 }) }));
vi.mock('@/core/createProvider.js', () => ({ createProvider: () => provider }));
const agents: Agent[] = [];
beforeEach(() => {
  vi.clearAllMocks();
  Connector.create({ name: 'freshness', vendor: Vendor.OpenAI, auth: { type: 'api_key', apiKey: 'fixture-key' } });
  provider.generate.mockImplementation(async (options: TextGenerateOptions) => ({ id: 'fixture', object: 'response', created_at: 1,
    model: options.model, status: 'completed', output_text: 'done',
    output: [{ type: 'message', role: MessageRole.ASSISTANT, content: [{ type: ContentType.OUTPUT_TEXT, text: 'done' }] }],
    usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } }));
  provider.streamGenerate.mockImplementation(async function* () {
    yield { type: StreamEventType.OUTPUT_TEXT_DELTA, response_id: 'fixture', item_id: 'message', output_index: 0,
      content_index: 0, delta: 'done', sequence_number: 1 };
    yield { type: StreamEventType.RESPONSE_COMPLETE, response_id: 'fixture', status: 'completed',
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 }, iterations: 1 };
  });
});
afterEach(() => { agents.splice(0).forEach(agent => agent.destroy()); Connector.remove('freshness'); vi.restoreAllMocks(); });
class Contribution extends BasePluginNextGen {
  readonly name = 'freshness'; value = 'old index';
  getInstructions() { return `Index: ${this.value}`; }
  async getContent() { return this.value; }
  getContents() { return this.value; }
}
function create(hooks?: Parameters<typeof Agent.create>[0]['hooks']) {
  const agent = Agent.create({ connector: 'freshness', model: 'gpt-4o-mini', instructions: 'Be accurate.', hooks,
    emptyResponseRetry: { enabled: false }, context: { model: 'gpt-4o-mini', maxContextTokens: 900, responseReserve: 100,
      features: { ...DEFAULT_FEATURES, workingMemory: false, inContextMemory: false } } });
  agents.push(agent); return agent;
}

describe('managed request context freshness', () => {
  it.each(['run', 'stream'] as const)('%s dispatches the rebuilt prompt and frozen, recounted tool definitions', async mode => {
    const agent = create();
    const plugin = new Contribution();
    agent.context.registerPlugin(plugin);
    let description = 'old schema';
    agent.tools.register({ definition: { type: 'function', function: { name: 'dynamic', parameters: { type: 'object', properties: {} } } },
      descriptionFactory: () => description, execute: async () => 'ok' });
    const compact = vi.fn(async (context: Parameters<ICompactionStrategy['compact']>[0]) => {
      plugin.value = 'fresh index'; description = 'fresh schema '.repeat(20);
      return { tokensFreed: await context.removeMessages([0]), messagesRemoved: 1, pluginsCompacted: [], log: [] };
    });
    agent.context.setCompactionStrategy({ name: 'legacy', displayName: 'Legacy', description: 'Fixture', threshold: 0.8,
      compact, consolidate: async () => ({ performed: false, tokensChanged: 0, actions: [] }) });
    agent.context.addInputItems([{ type: 'message', role: MessageRole.USER,
      content: [{ type: ContentType.INPUT_TEXT, text: 'old history '.repeat(220) }] }]);
    if (mode === 'run') await agent.run('continue');
    else for await (const _event of agent.stream('continue')) { /* consume */ }
    const options = (mode === 'run' ? provider.generate : provider.streamGenerate).mock.calls[0]![0] as TextGenerateOptions;
    expect(JSON.stringify(options.input)).toContain('fresh index');
    expect(JSON.stringify(options.input)).not.toContain('old index');
    expect(JSON.stringify(options.tools)).toContain('fresh schema');
    expect(compact).toHaveBeenCalledTimes(1);
    const budget = agent.context.lastPreparation!.budget;
    expect(budget.toolsTokens).toBeGreaterThan(70);
    expect(budget.available).toBeGreaterThanOrEqual(0);
    expect(agent.tools).toBe(agent.context.tools);
  });

  it('uses visible identity-filtered schemas for both budgeting and dispatch', async () => {
    const agent = create();
    agent.context.identities = [];
    agent.tools.register({ definition: { type: 'function', function: { name: 'hidden', description: 'large '.repeat(500),
      parameters: { type: 'object', properties: {} } } }, execute: async () => 'ok' }, { source: 'connector:hidden' });
    await agent.run('continue');
    expect(provider.generate.mock.calls[0]![0].tools).toEqual([]);
    expect(agent.context.lastPreparation!.budget.toolsTokens).toBe(0);
  });

  it('recounts a before:llm replacement and preserves existing run hook behavior', async () => {
    const agent = create({ 'before:llm': async () => ({ modified: { instructions: 'host instruction '.repeat(15) } }) });
    await agent.run('continue');
    expect(agent.context.lastPreparation!.budget.systemMessageTokens).toBeGreaterThan(100);
    expect(provider.generate.mock.calls[0]![0].instructions).toContain('host instruction');
  });

  it('prevents an oversized hook replacement from reaching the provider', async () => {
    const agent = create({ 'before:llm': async () => ({ modified: { instructions: 'host instruction '.repeat(400) } }) });
    await expect(agent.run('continue')).rejects.toThrow('Context overflow');
    expect(provider.generate).not.toHaveBeenCalled();
  });

  it('checks mutations made by llm:request listeners and correlates the rejected call', async () => {
    const agent = create();
    const errors = vi.fn(); agent.on('llm:error', errors);
    agent.on('llm:request', (event: { options: TextGenerateOptions }) => {
      event.options.instructions = 'event replacement '.repeat(1000);
    });
    await expect(agent.run('Continue')).rejects.toThrow('Context overflow');
    expect(provider.generate).not.toHaveBeenCalled();
    expect(errors).toHaveBeenCalledTimes(1);
  });

  it('rejects an oversized structured-output repair before a second provider call', async () => {
    const agent = create();
    provider.generate.mockResolvedValueOnce({ id: 'invalid', object: 'response', created_at: 1,
      model: agent.model, status: 'completed', output_text: 'not json '.repeat(500), output: [],
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } });
    await expect(agent.run('Return JSON', { responseFormat: { type: 'json_schema', name: 'value', strict: true,
      schema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false } } }))
      .rejects.toThrow('Context overflow');
    expect(provider.generate).toHaveBeenCalledTimes(1);
  });

  it('uses the actual smaller model window for a per-call hook override', async () => {
    vi.spyOn(provider, 'getModelCapabilities').mockImplementation((model?: string) => ({ supportsTools: true,
      supportsVision: true, supportsJSON: true, supportsJSONSchema: true,
      maxTokens: model === 'gpt-4.1' ? 1000000 : 128000, maxOutputTokens: 4096 }));
    const agent = Agent.create({ connector: 'freshness', model: 'gpt-4.1', instructions: 'Be accurate.',
      emptyResponseRetry: { enabled: false }, hooks: { 'before:llm': async () => ({ modified: { model: 'gpt-4o-mini' } }) },
      context: { model: 'gpt-4.1', responseReserve: 100,
        features: { ...DEFAULT_FEATURES, workingMemory: false, inContextMemory: false } } });
    agents.push(agent);
    await expect(agent.run('content '.repeat(65000))).rejects.toThrow('Context overflow');
    expect(provider.generate).not.toHaveBeenCalled();
    expect(agent.model).toBe('gpt-4.1');
    expect(agent.context.maxContextTokens).toBe(1000000);
  });

  it.each(['input', 'tools', 'instructions'] as const)('preserves fitting event changes to %s and reports the dispatched budget in AMOS', async field => {
    const agent = create();
    agent.on('llm:request', (event: { options: TextGenerateOptions }) => {
      if (field === 'input') event.options.input = 'Listener replaced input';
      if (field === 'instructions') event.options.instructions = 'Listener instructions '.repeat(10);
      if (field === 'tools') event.options.tools = [{ type: 'function', function: { name: 'listener_tool',
        description: 'Listener tool description', parameters: { type: 'object', properties: {} } } }];
    });
    await agent.run('Continue');
    const dispatch = provider.generate.mock.calls[0]![0] as TextGenerateOptions;
    expect(JSON.stringify(dispatch[field])).toContain(field === 'tools' ? 'listener_tool' : 'Listener');
    const diagnostic = agent.context.lastPreparation!;
    const budget = agent.context.validateRequestBudget(dispatch, { recordPreparation: false });
    expect(diagnostic.budget).toEqual(budget);
    const amos = await inspectContext(agent.context);
    expect(amos.budget.used).toBe(budget.totalUsed);
    expect(amos.budget.revision).toBe(diagnostic.revision);
    expect(amos.breakdown.components.reduce((sum, item) => sum + item.tokens, 0)).toBe(budget.totalUsed);
  });

  it.each(['input', 'tools'] as const)('rejects oversized event changes to %s', async field => {
    const agent = create();
    agent.on('llm:request', (event: { options: TextGenerateOptions }) => {
      if (field === 'input') event.options.input = 'oversized input '.repeat(1000);
      else event.options.tools = [{ type: 'function', function: { name: 'large', description: 'large schema '.repeat(1000),
        parameters: { type: 'object', properties: {} } } }];
    });
    await expect(agent.run('Continue')).rejects.toThrow('Context overflow');
    expect(provider.generate).not.toHaveBeenCalled();
  });

  it.each(['run', 'stream'] as const)('%s snapshots the counted dispatch before budget-event reentrancy', async mode => {
    let retained: TextGenerateOptions | undefined;
    const agent = create({ 'before:llm': async context => {
      retained = context.options; retained.instructions = 'fitting hook instructions '.repeat(10); return {};
    } });
    agent.context.on('budget:updated', (event: { budget: { totalUsed: number } }) => {
      if (retained) retained.instructions = 'late oversized mutation '.repeat(1000);
      event.budget.totalUsed = 0;
    });
    if (mode === 'run') await agent.run('Continue');
    else for await (const _event of agent.stream('Continue')) { /* consume */ }
    const dispatch = (mode === 'run' ? provider.generate : provider.streamGenerate).mock.calls[0]![0] as TextGenerateOptions;
    expect(dispatch.instructions).toContain('fitting hook'); expect(dispatch.instructions).not.toContain('late oversized');
    expect(agent.context.lastPreparation!.budget.totalUsed).toBeGreaterThan(0);
  });

  it('checks a retained streaming hook reference after the request event', async () => {
    let retained: TextGenerateOptions | undefined;
    const agent = create({ 'before:llm': async context => { retained = context.options; return {}; } });
    agent.on('llm:request', () => { retained!.instructions = 'stream event instructions '.repeat(1000); });
    let error: unknown;
    try { for await (const _event of agent.stream('Continue')) { /* consume */ } } catch (caught) { error = caught; }
    expect(String(error)).toContain('Context overflow'); expect(provider.streamGenerate).not.toHaveBeenCalled();
  });

  it.each(['gpt-4o-mini', 'gpt-4.1', 'custom-window'] as const)('uses provider capacity for %s without persisting a per-call override', async model => {
    vi.spyOn(provider, 'getModelCapabilities').mockImplementation((selected?: string) => ({ supportsTools: true,
      supportsVision: true, supportsJSON: true, supportsJSONSchema: true,
      maxTokens: selected === 'gpt-4.1' ? 1000000 : selected === 'custom-window' ? 60000 : 128000, maxOutputTokens: 4096 }));
    const agent = Agent.create({ connector: 'freshness', model: 'gpt-4o-mini',
      emptyResponseRetry: { enabled: false }, hooks: { 'before:llm': async () => ({ modified: { model } }) },
      context: { model: 'gpt-4o-mini', responseReserve: 100,
        features: { ...DEFAULT_FEATURES, workingMemory: false, inContextMemory: false } } });
    agents.push(agent); await agent.run('Continue');
    expect(provider.generate.mock.calls[0]![0].model).toBe(model);
    expect(agent.context.lastPreparation!.budget.maxTokens).toBe(model === 'gpt-4.1' ? 1000000 : model === 'custom-window' ? 60000 : 128000);
    expect(agent.model).toBe('gpt-4o-mini'); expect(agent.context.maxContextTokens).toBe(128000);
  });

  it('rejects a streaming model override using a smaller provider input capacity', async () => {
    vi.spyOn(provider, 'getModelCapabilities').mockImplementation((model?: string) => ({ supportsTools: true,
      supportsVision: true, supportsJSON: true, supportsJSONSchema: true, maxTokens: 128000,
      maxInputTokens: model === 'custom-small' ? 200 : 128000, maxOutputTokens: 100 }));
    const agent = create({ 'before:llm': async context => { context.options.model = 'custom-small'; return {}; } });
    let error: unknown;
    try { for await (const _event of agent.stream('moderate '.repeat(50))) { /* consume */ } } catch (caught) { error = caught; }
    expect(String(error)).toContain('Context overflow'); expect(provider.streamGenerate).not.toHaveBeenCalled();
  });

  it.each([true, false])('keeps fitting structured repair output, usage, history and context diagnostics (native=%s)', async native => {
    vi.spyOn(provider, 'getModelCapabilities').mockImplementation(() => ({ supportsTools: true,
      supportsVision: true, supportsJSON: true, supportsJSONSchema: native, maxTokens: 128000, maxOutputTokens: 4096 }));
    const agent = create();
    const original = provider.generate.getMockImplementation()!;
    provider.generate.mockImplementation(async options => {
      const response = await original(options);
      const text = provider.generate.mock.calls.length === 1 ? 'not json' : '{"value":"Done"}';
      return { ...response, output_text: text,
        output: [{ type: 'message', role: MessageRole.ASSISTANT, content: [{ type: ContentType.OUTPUT_TEXT, text }] }] };
    });
    const revisions: number[] = []; agent.context.on('budget:updated', () => { revisions.push(agent.context.lastPreparation!.revision); });
    const response = await agent.run('Return JSON', { responseFormat: { type: 'json_schema', name: 'value', strict: true,
      schema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false } } });
    expect(response.output_parsed).toEqual({ value: 'Done' }); expect(response.usage!.total_tokens).toBe(4);
    expect(provider.generate).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(agent.context.getConversation())).toContain('Done');
    expect(JSON.stringify(agent.context.getConversation())).not.toContain('not json');
    expect(new Set(revisions)).toEqual(new Set([1]));
  });

  it('checks oversized prompt formatting after a managed turn with tools', async () => {
    vi.spyOn(provider, 'getModelCapabilities').mockImplementation(() => ({ supportsTools: true,
      supportsVision: true, supportsJSON: true, supportsJSONSchema: false, maxTokens: 128000, maxOutputTokens: 4096 }));
    const agent = create();
    agent.tools.register({ definition: { type: 'function', function: { name: 'lookup',
      parameters: { type: 'object', properties: {} } } }, execute: async () => 'evidence' });
    provider.generate.mockResolvedValueOnce({ id: 'prose', object: 'response', created_at: 1,
      model: agent.model, status: 'completed', output_text: 'long prose '.repeat(500), output: [],
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } });
    await expect(agent.run('Return JSON', { responseFormat: { type: 'json_schema', name: 'value', strict: true,
      schema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false } } }))
      .rejects.toThrow('Context overflow');
    expect(provider.generate).toHaveBeenCalledTimes(1);
    expect(agent.context.lastPreparation!.revision).toBe(1);
  });

  it.each(['unavailable', 'invalid'] as const)('preserves ordinary custom-provider execution with %s capacity metadata', async mode => {
    vi.spyOn(provider, 'getModelCapabilities').mockImplementation(() => {
      if (mode === 'unavailable') throw new Error('No capability metadata for custom model');
      return { supportsTools: true, supportsVision: true, supportsJSON: true, supportsJSONSchema: true,
        maxInputTokens: 0, maxTokens: Number.NaN, maxOutputTokens: 4096 };
    });
    const agent = create({ 'before:llm': async () => ({ modified: { model: 'custom-unknown' } }) });
    await agent.run('Continue');
    expect(provider.generate.mock.calls[0]![0].model).toBe('custom-unknown');
    expect(agent.context.lastPreparation!.budget.maxTokens).toBe(900);
  });

  it('falls back to a valid provider total capacity when input capacity is invalid', async () => {
    vi.spyOn(provider, 'getModelCapabilities').mockImplementation(() => ({ supportsTools: true,
      supportsVision: true, supportsJSON: true, supportsJSONSchema: true,
      maxInputTokens: 0, maxTokens: 700, maxOutputTokens: 4096 }));
    const agent = create(); await agent.run('Continue');
    expect(agent.context.lastPreparation!.budget.maxTokens).toBe(700);
  });

  for (const mode of ['run', 'stream'] as const) {
    it.each([true, false])(`${mode} compacts evictable history using the known JSON constraint (native=%s)`, async native => {
      vi.spyOn(provider, 'getModelCapabilities').mockImplementation(() => ({ supportsTools: true,
        supportsVision: true, supportsJSON: true, supportsJSONSchema: native, maxTokens: 128000, maxOutputTokens: 4096 }));
      const agent = create(); const strategy = new DefaultCompactionStrategy(); const compact = vi.spyOn(strategy, 'compact');
      agent.context.setCompactionStrategy(strategy);
      agent.context.addInputItems([{ type: 'message', role: MessageRole.USER,
        content: [{ type: ContentType.INPUT_TEXT, text: 'old observation '.repeat(110) }] }]);
      const original = provider.generate.getMockImplementation()!;
      provider.generate.mockImplementation(async options => ({ ...await original(options), output_text: '{"value":"Done"}',
        output: [{ type: 'message', role: MessageRole.ASSISTANT, content: [{ type: ContentType.OUTPUT_TEXT, text: '{"value":"Done"}' }] }] }));
      const options = { responseFormat: { type: 'json_schema' as const, name: 'value', strict: true,
        schema: { type: 'object', description: 'schema terms '.repeat(70), properties: { value: { type: 'string' } },
          required: ['value'], additionalProperties: false } } };
      if (mode === 'run') expect((await agent.run('Return JSON', options)).output_parsed).toEqual({ value: 'Done' });
      else for await (const _event of agent.stream('Return JSON', options)) { /* consume */ }
      const dispatch = (mode === 'run' ? provider.generate : provider.streamGenerate).mock.calls[0]![0] as TextGenerateOptions;
      expect(JSON.stringify(dispatch.input)).not.toContain('old observation');
      if (native) expect(JSON.stringify(dispatch.response_format)).toContain('schema terms');
      else expect(dispatch.instructions).toContain('schema terms');
      expect(compact).toHaveBeenCalledTimes(1);
      expect(agent.context.lastPreparation!.budget.available).toBeGreaterThanOrEqual(0);
    });

    it(`${mode} includes configured native tools before deciding to compact`, async () => {
      const agent = create(); const strategy = new DefaultCompactionStrategy(); const compact = vi.spyOn(strategy, 'compact');
      agent.context.setCompactionStrategy(strategy);
      agent.context.addInputItems([{ type: 'message', role: MessageRole.USER,
        content: [{ type: ContentType.INPUT_TEXT, text: 'old observation '.repeat(110) }] }]);
      const options = { nativeTools: [{ capability: 'web_search' as const, options: { description: 'tool terms '.repeat(100) } }] };
      if (mode === 'run') await agent.run('Continue', options);
      else for await (const _event of agent.stream('Continue', options)) { /* consume */ }
      const dispatch = (mode === 'run' ? provider.generate : provider.streamGenerate).mock.calls[0]![0] as TextGenerateOptions;
      expect(dispatch.native_tools).toEqual(options.nativeTools);
      expect(JSON.stringify(dispatch.input)).not.toContain('old observation'); expect(compact).toHaveBeenCalledTimes(1);
      expect(agent.context.lastPreparation!.budget.toolsTokens).toBeGreaterThan(200);
    });

    it.each(['schema', 'native tool'] as const)(`${mode} rejects a known oversized %s before dispatch`, async contribution => {
      const agent = create(); const compact = vi.spyOn(agent.context.compactionStrategy, 'compact');
      const options = contribution === 'schema'
        ? { responseFormat: { type: 'json_schema' as const, name: 'value', strict: true, schema: { type: 'object',
          description: 'schema terms '.repeat(1000), properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false } } }
        : { nativeTools: [{ capability: 'web_search' as const, options: { description: 'tool terms '.repeat(1000) } }] };
      let caught: unknown;
      try {
        if (mode === 'run') await agent.run('Continue', options);
        else for await (const _event of agent.stream('Continue', options)) { /* consume */ }
      } catch (failure) { caught = failure; }
      expect(caught).toMatchObject({ code: 'CONTEXT_OVERFLOW' });
      expect(provider.generate).not.toHaveBeenCalled(); expect(provider.streamGenerate).not.toHaveBeenCalled();
      expect(compact).not.toHaveBeenCalled();
    });

    it(`${mode} compacts using the initial custom provider's smaller input window`, async () => {
      vi.spyOn(provider, 'getModelCapabilities').mockImplementation(() => ({ supportsTools: true, supportsVision: true,
        supportsJSON: true, supportsJSONSchema: true, maxTokens: 128000, maxInputTokens: 800, maxOutputTokens: 100 }));
      const agent = Agent.create({ connector: 'freshness', model: 'custom-window', emptyResponseRetry: { enabled: false },
        context: { model: 'custom-window', responseReserve: 100,
          features: { workingMemory: false, inContextMemory: false } } }); agents.push(agent);
      const strategy = new DefaultCompactionStrategy(); const compact = vi.spyOn(strategy, 'compact');
      agent.context.setCompactionStrategy(strategy);
      agent.context.addInputItems([{ type: 'message', role: MessageRole.USER,
        content: [{ type: ContentType.INPUT_TEXT, text: 'old observation '.repeat(250) }] }]);
      if (mode === 'run') await agent.run('Continue');
      else for await (const _event of agent.stream('Continue')) { /* consume */ }
      expect(compact).toHaveBeenCalledTimes(1);
      expect(agent.context.lastPreparation!.budget.maxTokens).toBe(800);
      expect(agent.context.lastPreparation!.budget.available).toBeGreaterThanOrEqual(0);
      expect(agent.context.maxContextTokens).toBe(128000); expect(agent.context.getState().metadata.model).toBe('custom-window');
    });

    it(`${mode} rejects an oversized protected function error before provider dispatch`, async () => {
      const agent = create(); const error = 'ERROR_DIAGNOSTIC '.repeat(1000);
      const calls = [{ type: 'message' as const, role: MessageRole.ASSISTANT, content: [
        { type: ContentType.TOOL_USE as const, id: 'error-call', name: 'lookup', arguments: '{}', async: true }] }];
      // Inject the pending result immediately before preparation, after Agent sets current user input.
      const prepare = agent.context.prepare.bind(agent.context);
      vi.spyOn(agent.context, 'prepare').mockImplementation(options => {
        agent.context.addToolResults([{ tool_use_id: 'error-call', content: '', error, state: ToolCallState.FAILED }]);
        return prepare(options);
      });
      agent.context.addInputItems(calls);
      let caught: unknown;
      try {
        if (mode === 'run') await agent.run('Continue');
        else for await (const _event of agent.stream('Continue')) { /* consume */ }
      } catch (failure) { caught = failure; }
      expect(caught).toMatchObject({ code: 'CONTEXT_OVERFLOW' });
      expect(provider.generate).not.toHaveBeenCalled(); expect(provider.streamGenerate).not.toHaveBeenCalled();
      expect(JSON.stringify(agent.context.getCurrentInput())).toContain('ERROR_DIAGNOSTIC');
    });
  }

  it.each([false, true])('preserves smaller explicit host limits with larger provider capacity (explicit=%s)', async explicit => {
    vi.spyOn(provider, 'getModelCapabilities').mockImplementation(() => ({ supportsTools: true, supportsVision: true,
      supportsJSON: true, supportsJSONSchema: true, maxInputTokens: 256000, maxTokens: 512000, maxOutputTokens: 100 }));
    const agent = Agent.create({ connector: 'freshness', model: 'custom-large', emptyResponseRetry: { enabled: false },
      context: { model: 'custom-large', responseReserve: 100, ...(explicit ? { maxContextTokens: 900 } : {}),
        features: { workingMemory: false, inContextMemory: false } } }); agents.push(agent);
    await agent.run(explicit ? 'Continue' : 'content '.repeat(65000));
    expect(agent.context.lastPreparation!.budget.maxTokens).toBe(explicit ? 900 : 256000);
    expect(agent.context.maxContextTokens).toBe(explicit ? 900 : 128000);
  });

  it('reselects prompt/native constraints when compaction changes enabled catalog tools', async () => {
    vi.spyOn(provider, 'getModelCapabilities').mockImplementation(() => ({ supportsTools: true, supportsVision: true,
      supportsJSON: true, supportsJSONSchema: false, maxTokens: 128000, maxOutputTokens: 100 }));
    const agent = create();
    agent.tools.register({ definition: { type: 'function', function: { name: 'dynamic', parameters: { type: 'object', properties: {} } } }, execute: async () => 'ok' });
    const compact = vi.fn(async (context: Parameters<ICompactionStrategy['compact']>[0]) => {
      agent.tools.disable('dynamic');
      return { tokensFreed: await context.removeMessages([0]), messagesRemoved: 1, pluginsCompacted: [], log: [] };
    });
    agent.context.setCompactionStrategy({ name: 'selection', displayName: 'Fixture', description: 'Disable loaded tool', threshold: 0.7,
      compact, consolidate: async () => ({ performed: false, tokensChanged: 0, actions: [] }) });
    agent.context.addInputItems([{ type: 'message', role: MessageRole.USER, content: [{ type: ContentType.INPUT_TEXT, text: 'old observations '.repeat(210) }] }]);
    const original = provider.generate.getMockImplementation()!;
    provider.generate.mockImplementation(async options => ({ ...await original(options), output_text: '{"value":"Done"}',
      output: [{ type: 'message', role: MessageRole.ASSISTANT, content: [{ type: ContentType.OUTPUT_TEXT, text: '{"value":"Done"}' }] }] }));
    const observed: number[] = []; agent.context.on('context:prepared', event => observed.push(event.budget.systemMessageTokens));
    await agent.run('Return JSON', { responseFormat: { type: 'json_schema', name: 'value', strict: true,
      schema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false } } });
    const dispatch = provider.generate.mock.calls[0]![0];
    expect(dispatch.tools).toEqual([]); expect(dispatch.instructions).toContain('value');
    expect(observed[0]).toBe(agent.context.lastPreparation!.budget.systemMessageTokens);
    expect(compact).toHaveBeenCalledTimes(1); expect(provider.generate).toHaveBeenCalledTimes(1);
  });

  it('counts the tool-free wrap-up schema before compacting a final answer', async () => {
    vi.spyOn(provider, 'getModelCapabilities').mockImplementation(() => ({ supportsTools: true, supportsVision: true,
      supportsJSON: true, supportsJSONSchema: false, maxTokens: 128000, maxOutputTokens: 100 }));
    const agent = Agent.create({ connector: 'freshness', model: 'gpt-4o-mini', maxIterations: 1, emptyResponseRetry: { enabled: false },
      context: { model: 'gpt-4o-mini', maxContextTokens: 1200, responseReserve: 100,
        features: { workingMemory: false, inContextMemory: false } } }); agents.push(agent);
    const strategy = new DefaultCompactionStrategy(); const compact = vi.spyOn(strategy, 'compact'); agent.context.setCompactionStrategy(strategy);
    agent.tools.register({ definition: { type: 'function', function: { name: 'lookup', parameters: { type: 'object', properties: {} } } }, execute: async () => 'evidence' });
    agent.context.addInputItems([{ type: 'message', role: MessageRole.USER,
      content: [{ type: ContentType.INPUT_TEXT, text: 'old observation '.repeat(160) }] }]);
    provider.generate.mockResolvedValueOnce({ id: 'tool', object: 'response', created_at: 1, model: agent.model,
      status: 'completed', output_text: '', output: [{ type: 'message', role: MessageRole.ASSISTANT,
        content: [{ type: ContentType.TOOL_USE, id: 'lookup01', name: 'lookup', arguments: '{}' }] }],
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } }).mockResolvedValueOnce({
        id: 'wrap', object: 'response', created_at: 1, model: agent.model, status: 'completed', output_text: '{"value":"Done"}',
        output: [{ type: 'message', role: MessageRole.ASSISTANT, content: [{ type: ContentType.OUTPUT_TEXT, text: '{"value":"Done"}' }] }],
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } }).mockResolvedValue({
        id: 'formatted', object: 'response', created_at: 1, model: agent.model, status: 'completed', output_text: '{"value":"Done"}',
        output: [{ type: 'message', role: MessageRole.ASSISTANT, content: [{ type: ContentType.OUTPUT_TEXT, text: '{"value":"Done"}' }] }],
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } });
    const result = await agent.run('Return JSON', { responseFormat: { type: 'json_schema', name: 'value', strict: true,
      schema: { type: 'object', description: 'schema terms '.repeat(70), properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false } } });
    expect(result.output_parsed).toEqual({ value: 'Done' }); expect(provider.generate).toHaveBeenCalledTimes(3);
    const wrap = provider.generate.mock.calls[1]![0]; expect(wrap.tools).toEqual([]);
    expect(wrap.instructions).toContain('schema terms'); expect(JSON.stringify(wrap.input)).not.toContain('old observation');
    expect(compact).toHaveBeenCalledTimes(1); expect(agent.context.lastPreparation!.budget.available).toBeGreaterThanOrEqual(0);
  });
});
