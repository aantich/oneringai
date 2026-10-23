import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Connector, Vendor, ContentType, MessageRole, SuspendSignal, StorageRegistry, FileCorrelationStorage } from '@everworker/oneringai';
import { offlineRoutingConnector } from '../../../../examples/model-routing/fixture.js';
import { AgentRunner } from '../../../../apps/amos/src/agent/AgentRunner.js';
import { ConfigManager } from '../../../../apps/amos/src/config/ConfigManager.js';
import { RoutingCommand } from '../../../../apps/amos/src/commands/commands/RoutingCommand.js';
import { HelpersCommand } from '../../../../apps/amos/src/commands/commands/HelpersCommand.js';
import { describeRouting, resolveAmosModelExecution } from '../../../../apps/amos/src/agent/routing.js';
import type { AmosConfig, IAmosApp } from '../../../../apps/amos/src/config/types.js';
const cleanup: Array<() => Promise<unknown> | void> = [];
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose(); Connector.clear(); });
async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'amos-routing-')); cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const manager = new ConfigManager(directory); await manager.load();
  manager.update({ activeConnector: 'amos-route-primary', activeModel: 'gpt-4.1-mini', session: { ...manager.get().session, autoSave: false }, modelExecution: { customProviderAttempts: 'single' } });
  const fixture = offlineRoutingConnector('amos-route-primary');
  let runner = new AgentRunner(manager.get(), [], join(directory, 'sessions')); await runner.initialize(fixture.connector.name, 'gpt-4.1-mini');
  cleanup.push(() => runner.destroy());
  const save = vi.fn(() => manager.save());
  const create = vi.fn(async () => {
    const candidate = new AgentRunner(manager.get(), [], join(directory, 'sessions'));
    await candidate.initialize(fixture.connector.name, 'gpt-4.1-mini'); runner.destroy(); runner = candidate; return runner;
  });
  const app = { getConfig: () => manager.get(), getAgent: () => runner, updateConfig: (changes: Partial<AmosConfig>) => manager.update(changes),
    saveConfig: save, createAgent: create,
    getConnectorManager: () => ({ get: (name: string) => name === fixture.connector.name ? { name, vendor: Vendor.OpenAI } : null, registerConnector: vi.fn() }),
  } as unknown as IAmosApp;
  const command = new RoutingCommand();
  const invoke = (args: string[]) => command.execute({ app, args, rawInput: `/routing ${args.join(' ')}` });
  return { directory, manager, fixture, invoke, save, create, app, runner: () => runner };
}
describe('AMOS declarative model routing', () => {
  it.each(['run', 'stream'] as const)('keeps the spent suspension task on repeated %s attempts until host cancellation', async mode => {
    const f = await setup();
    const correlations = new FileCorrelationStorage({ baseDirectory: join(f.directory, 'correlations') });
    StorageRegistry.configure({ correlations }); cleanup.push(() => StorageRegistry.reset());
    const fixture = offlineRoutingConnector('amos-suspended');
    let calls = 0, waits = 0;
    const generate = fixture.provider.generate.bind(fixture.provider);
    fixture.provider.generate = async options => {
      const response = await generate(options);
      if (++calls === 1) return { ...response, output_text: '', output: [{ type: 'message', role: MessageRole.ASSISTANT,
        content: [{ type: ContentType.TOOL_USE, id: 'amos-wait', name: 'wait_event', arguments: '{}' }] }] };
      return response;
    };
    const config = f.manager.get();
    config.modelExecution = { customProviderAttempts: 'single', limits: { maxCalls: 2 }, routing: { routes: { fast: { model: fixture.fastModel } } } };
    const runner = new AgentRunner(config, [{ definition: { type: 'function', function: { name: 'wait_event', description: 'Register wait', parameters: { type: 'object', properties: {} } } },
      execute: async () => { waits++; return SuspendSignal.create({ result: 'AMOS_WAIT_REGISTERED', correlationId: `amos:${mode}` }); } }], join(f.directory, 'suspended'));
    cleanup.push(() => runner.destroy()); await runner.initialize(fixture.connector.name, fixture.mainModel);
    await runner.run('Wait'); const original = runner.getModelUsage()!.id;
    for (let retry = 0; retry < 2; retry++) {
      const resume = async () => { if (mode === 'run') await runner.run('Event'); else for await (const _ of runner.stream('Event')) { /* consume */ } };
      await expect(resume()).rejects.toThrow('maxCalls');
    }
    expect(runner.getModelUsage()?.id).toBe(original); expect(calls).toBe(2); expect(waits).toBe(1);
    runner.cancel(); runner.setRoutingOptions(null); await runner.run('Explicit new work');
    expect(runner.getModelUsage()?.id).not.toBe(original); expect(calls).toBe(3); expect(waits).toBe(1);
  });
  it('keeps legacy settings free of routing behavior/callbacks', async () => {
    const f = await setup(); const result = await f.invoke([]);
    expect(result.success).toBe(true); expect(result.message).toContain('Configured default'); expect(f.manager.get().routing).toBeUndefined();
    await f.runner().run('ordinary chat'); expect(f.runner().getRoutingDiagnostics()).toBeUndefined();
  });
  it('configures explicit named selection and displays actual run/stream decisions', async () => {
    const f = await setup(); expect((await f.invoke(['set', 'fast', f.fixture.connector.name, 'gpt-4o-mini'])).success).toBe(true);
    expect(f.fixture.requests).toHaveLength(0); expect((await f.invoke(['use', 'fast'])).success).toBe(true);
    const response = await f.runner().run('ack'); expect(response.routing?.selectedRoute).toBe('fast');
    expect(f.fixture.requests.at(-1)!.model).toBe('gpt-4o-mini');
    const events = []; for await (const event of f.runner().stream('ack')) events.push(event);
    expect(events.find(e => e.type === 'done')?.routing?.model).toBe('gpt-4o-mini');
    expect((await f.invoke([])).message).toContain('gpt-4o-mini'); expect(describeRouting(response.routing!)).toContain('explicit');
  });
  it('persists a category table and reconstitutes host rules without serializing callbacks', async () => {
    const f = await setup(); await f.invoke(['set', 'fast', f.fixture.connector.name, 'gpt-4o-mini']);
    await f.invoke(['use', 'fast']); await f.invoke(['rule', 'lookup', 'fast']); await f.invoke(['use', 'auto']); await f.invoke(['hints', 'lookup', 'gather']);
    expect(f.manager.get().routing).toEqual({ taskType: 'lookup', phase: 'gather' });
    const loaded = await new ConfigManager(f.directory).load();
    expect(JSON.stringify(loaded.modelExecution?.routing)).not.toContain('select');
    const response = await f.runner().run('ack'); expect(response.routing?.selectedRoute).toBe('fast');
    await f.invoke(['hints', 'unknown']); const fallback = await f.runner().run('ack'); expect(fallback.routing?.selectedRoute).toBe('default');
  });
  it.each([['set', 'default', 'amos-route-primary', 'gpt-4o-mini'], ['set', 'fast', 'hidden', 'gpt-4o-mini'],
    ['set', 'fast', 'amos-route-primary', 'claude-sonnet-4-6'], ['set', '__proto__', 'amos-route-primary', 'gpt-4o-mini'],
    ['rule', 'lookup', 'missing'], ['hints', 'x'], ['use', 'missing']].map(args => ({ args })))('rejects invalid routes/authority/hints $args without config/model calls', async ({ args }) => {
    const f = await setup(); expect((await f.invoke(args)).success).toBe(false); expect(f.fixture.requests).toHaveLength(0); expect(f.save).not.toHaveBeenCalled();
  });
  it('requires an explicit transfer token and removes stale authorization when replaced', async () => {
    const f = await setup(); await f.invoke(['set', 'fast', f.fixture.connector.name, 'gpt-4o-mini', 'allow-transfer']);
    expect(f.manager.get().modelExecution?.routing?.routes.fast?.allowContextTransfer).toBe(true);
    await f.invoke(['set', 'fast', f.fixture.connector.name, 'gpt-4o-mini']);
    expect(f.manager.get().modelExecution?.routing?.routes.fast?.allowContextTransfer).toBe(false);
  });
  it('disables routing without dropping separately configured helpers', async () => {
    const f = await setup(); await f.invoke(['set', 'fast', f.fixture.connector.name, 'gpt-4o-mini']);
    f.manager.update({ modelExecution: { helpers: { extractor: { connector: f.fixture.connector.name, model: 'gpt-4o-mini' } } } });
    await f.invoke(['off']); expect(f.manager.get().modelExecution?.helpers?.extractor).toBeDefined(); expect(f.manager.get().modelExecution?.routing).toBeNull();
    await f.runner().run('ordinary default'); expect(f.fixture.requests.at(-1)!.model).toBe('gpt-4.1-mini');
  });
  it('does not turn routing off as a side effect of /helpers off', async () => {
    const f = await setup(); await f.invoke(['set', 'fast', f.fixture.connector.name, 'gpt-4o-mini']);
    const command = new HelpersCommand(); const result = await command.execute({ app: f.app, args: ['off'], rawInput: '/helpers off' });
    expect(result.success).toBe(true); expect(f.manager.get().modelExecution?.routing?.routes.fast).toBeDefined();
  });
  it('rolls back failed persistence through the real deep-merging settings adapter', async () => {
    const f = await setup(); f.save.mockRejectedValueOnce(new Error('PRIVATE_STORAGE_DETAIL'));
    const result = await f.invoke(['set', 'fast', f.fixture.connector.name, 'gpt-4o-mini']);
    expect(result.success).toBe(false); expect(result.message).not.toContain('PRIVATE_STORAGE_DETAIL');
    expect(f.manager.get().modelExecution?.routing).toBeUndefined(); expect(f.manager.get().routing).toBeUndefined();
    await f.runner().run('default after rollback'); expect(f.fixture.requests.at(-1)!.model).toBe('gpt-4.1-mini');
  });
  it('rejects invalid restored category tables before creating a selector', async () => {
    const f = await setup(); await f.invoke(['set', 'fast', f.fixture.connector.name, 'gpt-4o-mini']);
    expect(() => resolveAmosModelExecution({ ...f.manager.get(), routingRules: { lookup: 'missing' } })).toThrow('Invalid');
  });
  it('admits a native alternative when the unused configured default has no adapter', async () => {
    const f = await setup();
    const { compaction: _adapter, ...portable } = f.fixture.provider;
    const defaultConnector = Connector.create({ name: 'amos-portable-default', vendor: Vendor.Google, auth: { type: 'none' }, options: { provider: portable } });
    const native = offlineRoutingConnector('amos-native-alternative');
    const config = f.manager.get();
    config.defaults.maxOutputTokens = 256;
    config.contextStrategy = 'context-compaction';
    config.contextCompaction = { plugins: 'off', history: { mode: 'native' } };
    config.evidence = { enabled: true, directory: join(f.directory, 'evidence'), ownerId: 'owner', namespace: 'routing' };
    config.modelExecution = { customProviderAttempts: 'single', routing: { routes: {
      native: { connector: native.connector.name, model: 'gpt-4o-mini', allowContextTransfer: true },
    } } };
    config.routing = { route: 'native' };
    const runner = new AgentRunner(config, [], join(f.directory, 'native-sessions')); cleanup.push(() => runner.destroy());
    await runner.initialize(defaultConnector.name, 'gemini-2.5-flash');
    const response = await runner.run('Continue on the supported native route.');
    expect(response.routing?.selectedRoute).toBe('native'); expect(f.fixture.requests).toHaveLength(0);
    expect(native.requests.at(-1)?.model).toBe('gpt-4o-mini');
  });
});
