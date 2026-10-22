import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Connector, Vendor } from '@everworker/oneringai';
import { createNativeFixture } from '../../../../examples/native-compaction/fixture.js';
import { AgentRunner } from '../../../../apps/amos/src/agent/AgentRunner.js';
import { ConfigManager } from '../../../../apps/amos/src/config/ConfigManager.js';
import { ContextCommand } from '../../../../apps/amos/src/commands/commands/ContextCommand.js';
import type { IAmosApp } from '../../../../apps/amos/src/config/types.js';
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });
async function setup(native = false) {
  const directory = await mkdtemp(join(tmpdir(), 'amos-native-test-'));
  const manager = new ConfigManager(directory); const config = await manager.load();
  config.session.autoSave = false; config.defaults.maxOutputTokens = 256; config.modelExecution = { customProviderAttempts: 'single' };
  if (native) config.evidence = { enabled: true, directory: join(directory, 'evidence'), ownerId: 'owner', namespace: 'native-test' };
  const fixture = createNativeFixture(); const name = `amos-native-${cleanups.length}`;
  Connector.create({ name, vendor: Vendor.OpenAI, auth: { type: 'none' }, options: { provider: fixture.provider } });
  const runner = new AgentRunner(config, [], join(directory, 'sessions')); await runner.initialize(name, 'gpt-6-astra');
  const save = vi.fn(async () => { await manager.save(); });
  const app = { getAgent: () => runner, getConfig: () => manager.get(), updateConfig: (value: Parameters<ConfigManager['update']>[0]) => manager.update(value), saveConfig: save } as unknown as IAmosApp;
  const invoke = (args: string[]) => new ContextCommand().execute({ app, args, rawInput: '/context ' + args.join(' ') });
  cleanups.push(async () => { runner.destroy(); Connector.remove(name); await rm(directory, { recursive: true, force: true }); });
  return { manager, config, runner, save, invoke, fixture, directory };
}
describe('AMOS native/plugin composition', () => {
  for (const plugins of ['off', 'auto'] as const) for (const history of ['off', 'native'] as const) {
    it(`persists plugins=${plugins}, history=${history} without enabling unrelated defaults`, async () => {
      const f = await setup(history === 'native');
      expect(f.config.contextStrategy).toBeUndefined();
      expect((await f.invoke(['policy', plugins, history, 'manual'])).success).toBe(true);
      expect(f.runner.getContextCompaction().composition?.config).toEqual({ plugins, history, automatic: false });
      const restored = await new ConfigManager(f.directory).load();
      expect(restored.contextCompaction).toEqual({ plugins, history, automatic: false });
      expect(f.fixture.calls.native).toBe(0); expect(f.fixture.calls.main).toBe(0);
    });
  }
  it('restores absent legacy policy after a failed settings save, including later unrelated saves', async () => {
    const f = await setup(); f.save.mockRejectedValueOnce(new Error('PRIVATE_BACKEND'));
    const result = await f.invoke(['policy', 'auto', 'off']); expect(result.success).toBe(false); expect(result.message).not.toContain('PRIVATE_BACKEND');
    expect(f.runner.getContextCompaction().strategy).toBe('algorithmic');
    expect(Object.hasOwn(f.config, 'contextStrategy')).toBe(false); expect(Object.hasOwn(f.config, 'contextCompaction')).toBe(false);
    f.manager.update({ ui: { ...f.config.ui, showTiming: false } }); await f.manager.save();
    const restored = await new ConfigManager(f.directory).load(); expect(restored.contextCompaction).toBeUndefined(); expect(restored.contextStrategy).toBeUndefined();
  });
  it('validates prerequisites and target arguments without running a native call', async () => {
    const f = await setup();
    expect((await f.invoke(['policy', 'auto', 'native'])).success).toBe(false); expect(f.config.contextStrategy).toBeUndefined();
    expect((await f.invoke(['compact', 'unknown'])).success).toBe(false);
    expect((await f.invoke(['policy', 'auto', 'off', 'invalid'])).success).toBe(false);
    expect(f.fixture.calls.native).toBe(0); expect(f.save).not.toHaveBeenCalled();
  });
  it('keeps configuration and operation ownership usable after transport drift rejects compaction', async () => {
    const f = await setup(true);
    expect((await f.invoke(['policy', 'off', 'native', 'manual'])).success).toBe(true);
    vi.stubEnv('OPENAI_BASE_URL', 'https://changed-service.invalid');
    const result = await f.invoke(['compact', 'history']);
    expect(result.success).toBe(false); expect(f.fixture.calls.native).toBe(0); expect(f.fixture.calls.main).toBe(0);
    expect(f.runner.isRunning()).toBe(false); expect(f.config.contextCompaction?.history).toBe('native');
    vi.unstubAllEnvs(); await f.runner.run('Continue on the original configured transport');
    expect(f.fixture.calls.main).toBe(1); expect(f.runner.isRunning()).toBe(false);
  });
  it('inspects protected/empty results, commits a reduction and prevents incompatible settings changes', async () => {
    const f = await setup(true); expect((await f.invoke(['policy', 'auto', 'native', 'manual'])).success).toBe(true);
    expect((await f.invoke(['compact', 'history'])).success).toBe(true); expect(f.fixture.calls.native).toBe(0);
    for (let i = 0; i < 5; i++) await f.runner.run(`Historical ${i}. ` + 'Progress detail. '.repeat(80));
    expect((await f.invoke(['compact', 'history'])).success).toBe(true); expect(f.fixture.calls.native).toBe(1);
    expect(f.runner.getContextCompaction().composition?.last?.checkpointed).toBe(true);
    await f.runner.run('Continue with native state');
    const counted = f.fixture.calls.counts;
    const budget = await f.runner.getContextBudget(), breakdown = await f.runner.getContextBreakdown();
    expect(budget?.accounting).toBe('provider'); expect(breakdown?.providerCountedInputTokens).toBe(budget?.used);
    expect(f.fixture.calls.counts).toBe(counted);
    expect((await f.invoke(['budget'])).message).toContain('Provider-counted complete input');
    const inspected = await f.invoke(['strategy']); expect(inspected.message).toContain('provider');
    expect((await f.invoke(['policy', 'auto', 'off'])).success).toBe(false);
    expect(f.config.contextCompaction?.history).toBe('native');
    await expect(f.runner.initialize('other-connector', 'other-model')).rejects.toThrow('Native context');
    expect(f.runner.isReady()).toBe(true);
  });
});

describe('AMOS second-review native cancellation', () => {
  it('releases the command and runner while a cancelled proof read is still unresolved', async () => {
    const f = await setup(true); await f.invoke(['policy', 'off', 'native', 'manual']);
    for (let i = 0; i < 5; i++) await f.runner.run(`Historical ${i}. ` + 'Progress detail. '.repeat(80));
    expect((await f.invoke(['compact', 'history'])).success).toBe(true);
    const agent = (f.runner as unknown as { agent: import('@everworker/oneringai').Agent }).agent;
    const storage = agent.context.getPlugin<import('@everworker/oneringai').EvidencePluginNextGen>('evidence')!.storage;
    let entered!: () => void, release!: () => void;
    const ready = new Promise<void>(resolve => { entered = resolve; }), pending = new Promise<void>(resolve => { release = resolve; });
    vi.spyOn(storage, 'readRecord').mockImplementationOnce(async () => { entered(); await pending; return null; });
    const native = f.fixture.calls.native, main = f.fixture.calls.main;
    const command = f.invoke(['compact', 'history']); await ready; f.runner.cancel();
    try {
      const result = await Promise.race([command, new Promise<undefined>(resolve => setTimeout(resolve, 200))]);
      expect(result?.success).toBe(false); expect(f.runner.isRunning()).toBe(false);
      expect(f.fixture.calls.native).toBe(native); expect(f.fixture.calls.main).toBe(main);
      await f.runner.run('RECOVERED'); expect(f.fixture.calls.main).toBe(main + 1);
      expect(f.fixture.calls.native).toBe(native); expect(f.config.contextCompaction?.history).toBe('native');
    } finally { release(); await command; }
  });
});

describe('AMOS third-review manual preservation', () => {
  it('runs the host preservation hook once through the existing command and checkpoints the note', async () => {
    const f = await setup(true); await f.invoke(['policy', 'off', 'native', 'manual']);
    for (let i = 0; i < 5; i++) await f.runner.run(`Historical ${i}. ` + 'Progress detail. '.repeat(80));
    const agent = (f.runner as unknown as { agent: import('@everworker/oneringai').Agent }).agent;
    let hooks = 0;
    agent.setLifecycleHooks({ beforeCompaction: async () => {
      hooks++; agent.context.getPlugin<import('@everworker/oneringai').InContextMemoryPluginNextGen>('in_context_memory')!
        .set('preserved', 'Confirmed host note', 'AMOS_MANUAL_37', 'critical');
    } });
    const result = await f.invoke(['compact', 'history']);
    expect(result.success).toBe(true); expect(hooks).toBe(1); expect(f.fixture.calls.native).toBe(1);
    expect(f.runner.getContextCompaction().composition?.last?.checkpointed).toBe(true);
    expect(JSON.stringify(agent.context.getState().pluginStates.in_context_memory)).toContain('AMOS_MANUAL_37');
    await f.runner.run('Continue with the preserved note');
    expect(hooks).toBe(1); expect(f.runner.isRunning()).toBe(false);
  });
});
