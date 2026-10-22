import { afterEach, describe, expect, it, vi } from 'vitest';
import { Agent, AgentContextNextGen, BasePluginNextGen, Connector, Vendor, ContentType, MessageRole, StreamEventType, InMemoryEvidenceStorage, TaskStatePluginNextGen } from '../../../src/index.js';
import type { AgentConfig, ContextAssemblyConfig, ContextBlock } from '../../../src/index.js';
import { ScriptedLoopProvider } from '../../../examples/agent-loop/scripted-provider.js';
const agents: Agent[] = [], contexts: AgentContextNextGen[] = [];
afterEach(() => { agents.splice(0).forEach(agent => agent.destroy()); contexts.splice(0).forEach(ctx => ctx.destroy()); Connector.clear(); vi.useRealTimers(); });
class Source extends BasePluginNextGen {
  name = 'source'; revision = 0; async getContent() { return 'LEGACY_DATA'; } getInstructions() { return 'Trusted source usage.'; } getContents() { return null; }
}
function context(config: ContextAssemblyConfig = {}) {
  const ctx = AgentContextNextGen.create({ model: 'gpt-4o-mini', maxContextTokens: 4000, responseReserve: 100, features: { workingMemory: false, inContextMemory: false }, assembly: config }); contexts.push(ctx);
  return ctx;
}
const stringify = (value: unknown) => JSON.stringify(value);
describe('Stage 05 layout/accounting/managed boundaries', () => {
  it('keeps stable instructions ahead of changing data/date and deterministically orders tools', async () => {
    vi.useFakeTimers(); const ctx = context({ layout: 'stable-prefix' }); const source = new Source(); ctx.registerPlugin(source);
    let value = 'FIRST'; ctx.registerContextContributor('source', { getRevision: () => value, contribute: () => [{ id: 'A', text: value }] });
    const tools = ['z', 'a'].map(name => ({ type: 'function' as const, function: { name, description: 'Tool', parameters: { type: 'object', properties: {} } } }));
    const before = await ctx.prepare({ getTools: () => tools }); value = 'SECOND'; await vi.advanceTimersByTimeAsync(2000);
    const after = await ctx.prepare({ getTools: () => [...tools].reverse() });
    expect(before.input[0]).toEqual(after.input[0]); expect(stringify(before.input[0])).not.toContain('CURRENT DATE'); expect(before.input[1]).not.toEqual(after.input[1]);
    expect(after.tools!.map(tool => tool.function.name)).toEqual(['a', 'z']); expect(tools.map(tool => tool.function.name)).toEqual(['z', 'a']);
    const checked = ctx.validateRequestBudget({ model: 'gpt-4o-mini', input: after.input, tools: after.tools }); expect(checked.totalUsed).toBe(after.budget.totalUsed);
  });
  it('reserves extra reasoning headroom, counts known schemas/native definitions, and uses actual provider limits', async () => {
    const ctx = context({ reasoningReserveTokens: 100 }); const base = await ctx.prepare();
    const schema = { type: 'json_schema' as const, json_schema: { name: 'large', schema: { type: 'object', description: 'schema '.repeat(80) } } };
    const prepared = await ctx.prepare({ modelMaxContextTokens: 1500, getRequestOptions: () => ({ response_format: schema }) });
    expect(prepared.budget.maxTokens).toBe(1500); expect(prepared.budget.responseReserve).toBe(200); expect(prepared.budget.toolsTokens).toBeGreaterThan(base.budget.toolsTokens);
    expect(ctx.lastPreparation!.selection!.accounting.capacitySource).toBe('provider');
    expect(() => ctx.validateRequestBudget({ model: 'gpt-4o-mini', input: prepared.input, response_format: { ...schema, json_schema: { ...schema.json_schema, schema: { description: 'huge '.repeat(5000) } } } }, { modelMaxContextTokens: 1500 })).toThrow();
  });
  it('reports unknown provider/cache usage, including opaque/multimodal estimation uncertainty', async () => {
    const ctx = context(); ctx.addInputItems([{ type: 'message', role: MessageRole.USER, content: [{ type: ContentType.INPUT_IMAGE_URL, image_url: { url: 'data:image/png;base64,abc', detail: 'low' } }] }]);
    await ctx.prepare(); const accounting = ctx.lastPreparation!.selection!.accounting; expect(accounting.opaqueOrMultimodal).toBe(true); expect(accounting.cachedInputTokens).toBeNull();
    ctx.recordProviderUsage({ input_tokens: 999, cached_input_tokens: 0 }); const measured = ctx.lastPreparation!.selection!.accounting;
    expect(measured.inputTokenDelta).toBe(999 - measured.estimatedInputTokens); expect(measured.cachedInputTokens).toBe(0); expect(measured.cacheCreationInputTokens).toBeNull();
    await ctx.prepare(); expect(ctx.lastPreparation!.selection!.accounting.providerInputTokens).toBeNull();
  });
  it('isolates fingerprints across scopes, roles, models, schemas, and account selections', async () => {
    const first = context(), second = context(); const a = await first.prepare(), b = await second.prepare();
    expect(first.lastPreparation!.selection!.requestFingerprint).not.toBe(second.lastPreparation!.selection!.requestFingerprint);
    const fingerprint = first.lastPreparation!.selection!.requestFingerprint;
    first.tools.setToolContext({ userId: 'different', identities: [{ connector: 'account-B' }], roles: ['reviewer'] });
    expect(() => first.validateRequestBudget({ model: 'gpt-4o-mini', input: a.input })).toThrow('authority');
    await first.prepare(); expect(first.lastPreparation!.selection!.requestFingerprint).not.toBe(fingerprint); expect(b.input).toBeDefined();
  });
  it('retains legacy plugin content and task-state authority in stable layout', async () => {
    const scope = { ownerId: 'host', namespace: 'stage05' };
    const ctx = AgentContextNextGen.create({ model: 'gpt-4o-mini', userId: 'host', assembly: { layout: 'stable-prefix' }, features: { workingMemory: false, inContextMemory: false, evidence: true, taskState: true },
      plugins: { evidence: { scope, storage: new InMemoryEvidenceStorage({ scope }) }, taskState: { scope, taskId: 'T42' } } }); contexts.push(ctx);
    ctx.registerPlugin(new Source()); const task = ctx.getPlugin<TaskStatePluginNextGen>('task_state')!;
    task.updateHost({ notes: [{ id: 'objective', category: 'objective', text: 'Keep objective A42.', source: { label: 'host' } }] }, 0);
    const prepared = await ctx.prepare(); expect(stringify(prepared.input)).toContain('LEGACY_DATA'); expect(stringify(prepared.input)).toContain('Keep objective A42.');
    expect(ctx.validateRequestBudget({ model: 'gpt-4o-mini', input: prepared.input, tools: prepared.tools }).breakdown.pluginContents.source).toBeGreaterThan(0);
    task.updateHost({ notes: [{ id: 'constraint', category: 'constraint', text: 'Host correction.', source: { label: 'host' } }] }, 1);
    expect(() => ctx.validateRequestBudget({ model: 'gpt-4o-mini', input: prepared.input, tools: prepared.tools })).toThrow();
  });
  it.each(['run', 'stream'] as const)('uses the existing managed %s loop and one ToolManager across a real tool boundary', async mode => {
    const provider = new ScriptedLoopProvider([{ calls: [{ id: 'read-1', name: 'read', args: {} }] }, { text: 'Exact A42.' }]);
    Connector.create({ name: 'main', vendor: Vendor.OpenAI, auth: { type: 'none' }, options: { provider } });
    let reads = 0; const config: AgentConfig = { connector: 'main', model: 'gpt-4o-mini', context: { model: 'gpt-4o-mini', assembly: { layout: 'stable-prefix' }, features: { workingMemory: false, inContextMemory: false } },
      tools: [{ definition: { type: 'function', function: { name: 'read', parameters: { type: 'object', properties: {} } } }, execute: async () => { reads++; return { id: 'A42' }; } }] };
    const agent = Agent.create(config); agents.push(agent); const source = new Source(); agent.context.registerPlugin(source); agent.context.registerContextContributor('source', { getRevision: () => source.revision, contribute: () => [{ id: 'A', text: 'EXACT_SOURCE', protected: true }] });
    if (mode === 'run') expect((await agent.run('Read A42.')).output_text).toBe('Exact A42.');
    else { let output = ''; for await (const event of agent.stream('Read A42.')) if (event.type === StreamEventType.OUTPUT_TEXT_DELTA) output += event.delta; expect(output).toBe('Exact A42.'); }
    expect(reads).toBe(1); expect(provider.requests).toHaveLength(2); expect(agent.tools).toBe(agent.context.tools);
    expect(stringify(provider.requests[0]!.input)).toContain('EXACT_SOURCE'); expect(agent.context.lastPreparation!.selection!.accounting.providerInputTokens).not.toBeNull();
  });
  it('keeps direct execution independent of managed contributions', async () => {
    const provider = new ScriptedLoopProvider([{ text: 'Direct answer.' }]); Connector.create({ name: 'main', vendor: Vendor.OpenAI, auth: { type: 'none' }, options: { provider } });
    const agent = Agent.create({ connector: 'main', model: 'gpt-4o-mini', context: { model: 'gpt-4o-mini', assembly: {} } }); agents.push(agent); const source = new Source(); agent.context.registerPlugin(source);
    const contribute = vi.fn(() => [] as ContextBlock[]); agent.context.registerContextContributor('source', { getRevision: () => 1, contribute });
    await agent.runDirect('Direct'); expect(contribute).not.toHaveBeenCalled(); expect(agent.context.lastPreparation).toBeNull();
  });
});

describe('assembly composition with existing preparation', () => {
  it('charges the contribution deadline only for contributors, preserving slow legacy preparation', async () => {
    vi.useFakeTimers(); const ctx = context({ timeoutMs: 10 }); const source = new Source(); ctx.registerPlugin(source);
    ctx.registerContextContributor('source', { getRevision: () => 1, contribute: () => [{ id: 'A', text: 'DATA' }] });
    class Slow extends Source { override name = 'slow_legacy'; override async getContent() { await new Promise(resolve => setTimeout(resolve, 20)); return 'LEGACY'; } }
    ctx.registerPlugin(new Slow()); const outcome = ctx.prepare().then(value => ({ ok: true, value }), error => ({ ok: false, error }));
    await vi.advanceTimersByTimeAsync(30); expect((await outcome).ok).toBe(true);
  });
  it('attributes capacity to the host when its explicit limit is lower than provider capacity', async () => {
    const ctx = context(); await ctx.prepare({ modelMaxContextTokens: 8000 });
    expect(ctx.lastPreparation!.budget.maxTokens).toBe(4000); expect(ctx.lastPreparation!.selection!.accounting.capacitySource).toBe('host');
  });
  it('rejects switching the submitted model after model-dependent selection', async () => {
    const ctx = context(); const prepared = await ctx.prepare();
    expect(() => ctx.validateRequestBudget({ model: 'different-model', input: prepared.input })).toThrow('model');
  });
});

describe('explicit model-aware estimation', () => {
  it('uses the host tokenizer for blocks, messages and schemas while preserving its class receiver', async () => {
    class Estimator { #factor = 2; estimateTokens(value: string) { return value.length * this.#factor; } estimateDataTokens(value: unknown) { return this.estimateTokens(JSON.stringify(value)); } estimateImageTokens() { return this.#factor * 7; } }
    const ctx = AgentContextNextGen.create({ model: 'gpt-4o-mini', maxContextTokens: 20000, responseReserve: 100, assembly: { tokenEstimator: new Estimator() }, features: { workingMemory: false, inContextMemory: false } }); contexts.push(ctx);
    const source = new Source(); ctx.registerPlugin(source); ctx.registerContextContributor('source', { getRevision: () => 1, contribute: () => [{ id: 'A', text: 'DATA' }] });
    const prepared = await ctx.prepare({ getRequestOptions: () => ({ response_format: { type: 'json_schema', json_schema: { name: 'answer', schema: { description: 'SCHEMA' } } } }) });
    expect(ctx.lastPreparation!.selection!.entries[0]!.estimatedTokens).toBe(8); expect(prepared.budget.toolsTokens).toBeGreaterThan(100);
    expect(ctx.validateRequestBudget({ input: prepared.input, tools: prepared.tools }).available).toBeGreaterThanOrEqual(0);
    ctx.addInputItems([{ type: 'message', role: MessageRole.USER, content: [{ type: ContentType.INPUT_IMAGE_URL, image_url: { url: 'data:image/png;base64,fixture', detail: 'low' } }] }]);
    const image = await ctx.prepare(); expect(image.budget.conversationTokens - ctx.lastPreparation!.selection!.selectedDataTokens).toBe(18);
  });
  it('rejects invalid tokenizer output rather than admitting negative or unknown counts', async () => {
    const ctx = context({ tokenEstimator: { estimateTokens: () => -1, estimateDataTokens: () => NaN } }); await expect(ctx.prepare()).rejects.toThrow('nonnegative');
  });
});
