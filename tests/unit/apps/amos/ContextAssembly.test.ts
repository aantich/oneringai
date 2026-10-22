import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentContextNextGen, AgentRegistry, Connector, Vendor, ContentType, MessageRole, type Agent, type InContextMemoryPluginNextGen } from '@everworker/oneringai';
import { AgentRunner } from '../../../../apps/amos/src/agent/AgentRunner.js';
import { ConfigManager } from '../../../../apps/amos/src/config/ConfigManager.js';
import { ContextCommand } from '../../../../apps/amos/src/commands/commands/ContextCommand.js';
import { inspectContext } from '../../../../apps/amos/src/agent/contextInspection.js';
import { ScriptedLoopProvider } from '../../../../examples/agent-loop/scripted-provider.js';
import type { CommandContext, IAmosApp, IAgentRunner } from '../../../../apps/amos/src/config/types.js';
const dirs: string[] = [], runners: AgentRunner[] = [], contexts: AgentContextNextGen[] = [];
afterEach(async () => { runners.splice(0).forEach(runner => runner.destroy()); contexts.splice(0).forEach(ctx => ctx.destroy()); Connector.clear(); await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
function invoke(ctx: AgentContextNextGen) { const runner = { isReady: () => true, getContextBreakdown: async () => (await inspectContext(ctx)).breakdown } as unknown as IAgentRunner;
  return new ContextCommand().execute({ app: { getAgent: () => runner } as unknown as IAmosApp, args: ['breakdown'], rawInput: '/context breakdown' } as CommandContext); }
describe('AMOS Stage 05 selection inspection', () => {
  it('labels unprepared and empty selection without triggering a preparation', async () => {
    const ctx = AgentContextNextGen.create({ model: 'gpt-4o-mini', assembly: {}, features: { workingMemory: false, inContextMemory: false } }); contexts.push(ctx);
    expect((await invoke(ctx)).message).toContain('selection unavailable'); expect(ctx.lastPreparation).toBeNull(); await ctx.prepare();
    const shown = (await invoke(ctx)).message; expect(shown).toContain('No explicit data blocks'); expect(shown).toContain('read unknown, written unknown'); expect(ctx.lastPreparation!.revision).toBe(1);
  });
  it('distinguishes actual zero from unknown provider cache counters', async () => {
    const ctx = AgentContextNextGen.create({ model: 'gpt-4o-mini', assembly: {}, features: { workingMemory: false, inContextMemory: false } }); contexts.push(ctx); await ctx.prepare(); ctx.recordProviderUsage({ input_tokens: 500, cached_input_tokens: 0 });
    const shown = (await invoke(ctx)).message; expect(shown).toContain('read 0, written unknown'); expect(shown).toContain('Distinct from local');
  });
  it('shows native-result uncertainty without exposing source bytes or preparing again', async () => {
    const ctx = AgentContextNextGen.create({ model: 'gpt-4o-mini', assembly: {}, features: { workingMemory: false, inContextMemory: false } }); contexts.push(ctx);
    ctx.addInputItems([{ type: 'message', role: MessageRole.ASSISTANT, content: [{ type: ContentType.TOOL_USE, id: 'c', name: 'read', arguments: '{}' }] },
      { type: 'function_call_output', call_id: 'c', output: [{ type: ContentType.INPUT_IMAGE_URL, image_url: { url: 'data:image/png;base64,PRIVATE_PIXELS', detail: 'low' } }] }]);
    await ctx.prepare(); const before = ctx.lastPreparation!.revision, shown = (await invoke(ctx)).message;
    expect(shown).toContain('opaque or multimodal'); expect(shown).not.toContain('PRIVATE_PIXELS'); expect(ctx.lastPreparation!.revision).toBe(before);
    expect((await inspectContext(ctx)).breakdown.selection!.accounting.opaqueOrMultimodal).toBe(true);
  });
  it('configures actual runner whiteboard selection and shows omitted/protected reasons after managed execution', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'stage05-amos-')); dirs.push(dir); const config = await new ConfigManager(dir).load(); config.session.autoSave = false; config.contextAssembly = { layout: 'stable-prefix', maxDataTokens: 128, selectWhiteboard: true };
    const provider = new ScriptedLoopProvider([{ text: 'A42.' }]); Connector.create({ name: 'fixture', vendor: Vendor.OpenAI, auth: { type: 'none' }, options: { provider } });
    let agent!: Agent; AgentRegistry.once('agent:registered', value => { agent = value.agent as Agent; }); const runner = new AgentRunner(config, [], join(dir, 'sessions')); runners.push(runner); await runner.initialize('fixture', 'gpt-4o-mini');
    const memory = agent.context.getPlugin<InContextMemoryPluginNextGen>('in_context_memory')!; memory.set('answer', 'Keep exact receipt', 'A42', 'critical'); memory.set('bulk', 'Background', 'bulk '.repeat(2000), 'low');
    await runner.run('Return receipt ID.'); const breakdown = await runner.getContextBreakdown();
    expect(breakdown!.selection!.entries.find(entry => entry.id.endsWith('/bulk'))?.status).toBe('omitted'); expect(breakdown!.selection!.entries.find(entry => entry.id.endsWith('/answer'))?.reason).toBe('protected');
    expect(JSON.stringify(provider.requests[0]!.input)).toContain('A42'); expect(JSON.stringify(provider.requests[0]!.input)).not.toContain('bulk bulk bulk'); expect(memory.getContents().size).toBe(2);
    const output = await new ContextCommand().execute({ app: { getAgent: () => runner } as unknown as IAmosApp, args: ['breakdown'], rawInput: '/context breakdown' } as CommandContext);
    expect(output.message).toContain('omitted (budget)'); expect(output.message).toContain('selected (protected)');
  });
  it.each(['run', 'stream'] as const)('shows actual %s wrap-up usage and consistent selected-store guidance', async mode => {
    const dir = await mkdtemp(join(tmpdir(), 'stage05-amos-wrapup-')); dirs.push(dir);
    const config = await new ConfigManager(dir).load(); config.session.autoSave = false; config.maxIterations = 1;
    config.contextAssembly = { layout: 'stable-prefix', maxDataTokens: 128, selectWhiteboard: true };
    const provider = new ScriptedLoopProvider([{ calls: [{ id: 'read-1', name: 'read_receipt', args: {} }] }, { text: 'A42.' }]);
    const generate = provider.generate.bind(provider); provider.generate = async options => { const response = await generate(options); response.usage = { ...response.usage, cached_input_tokens: 0 }; return response; };
    Connector.create({ name: 'wrapup', vendor: Vendor.OpenAI, auth: { type: 'none' }, options: { provider } });
    let agent!: Agent; AgentRegistry.once('agent:registered', value => { agent = value.agent as Agent; }); let reads = 0;
    const runner = new AgentRunner(config, [{ definition: { type: 'function', function: { name: 'read_receipt', parameters: { type: 'object', properties: {} } } },
      output: { effect: 'read' }, execute: async () => { reads++; return { id: 'A42' }; } }], join(dir, 'sessions')); runners.push(runner);
    await runner.initialize('wrapup', 'gpt-4o-mini');
    const memory = agent.context.getPlugin<InContextMemoryPluginNextGen>('in_context_memory')!;
    memory.set('answer', 'Exact receipt', 'A42', 'critical'); memory.set('bulk', 'Omitted source', 'bulk '.repeat(2000), 'low');
    if (mode === 'run') await runner.run('Read once'); else for await (const _ of runner.stream('Read once')) { /* drain */ }
    expect(reads).toBe(1); expect(provider.requests).toHaveLength(2);
    expect(JSON.stringify(provider.requests[0]!.input)).not.toContain('no retrieval needed'); expect(JSON.stringify(provider.requests[0]!.tools)).not.toContain('no retrieval needed');
    const accounting = (await runner.getContextBreakdown())!.selection!.accounting;
    expect(accounting.providerInputTokens).toBe(10); expect(accounting.cachedInputTokens).toBe(0); expect(accounting.cacheCreationInputTokens).toBeNull();
    const output = await new ContextCommand().execute({ app: { getAgent: () => runner } as unknown as IAmosApp, args: ['breakdown'], rawInput: '/context breakdown' } as CommandContext);
    expect(output.message).toContain('Provider input: 10'); expect(output.message).toContain('read 0, written unknown'); expect(output.message).toContain('omitted (budget)');
    expect(memory.getContents().size).toBe(2);
  });
});
