import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Connector, Vendor } from '@everworker/oneringai';
import { ScriptedLoopProvider } from '../../../../examples/agent-loop/scripted-provider.js';
import { AgentRunner } from '../../../../apps/amos/src/agent/AgentRunner.js';
import { ConfigManager } from '../../../../apps/amos/src/config/ConfigManager.js';
import { PresetCommand } from '../../../../apps/amos/src/commands/commands/PresetCommand.js';
import { DEFAULT_CONFIG } from '../../../../apps/amos/src/config/types.js';
import type { AmosConfig, CommandContext } from '../../../../apps/amos/src/config/types.js';
const dirs: string[] = [], runners: AgentRunner[] = [];
afterEach(async () => { runners.splice(0).forEach(r => r.destroy()); Connector.clear(); vi.restoreAllMocks(); await Promise.all(dirs.splice(0).map(d => rm(d, { recursive: true, force: true }))); });
async function fixture(preset?: AmosConfig['preset']) {
  const dir = await mkdtemp(join(tmpdir(), 'amos-preset-')); dirs.push(dir);
  const manager = new ConfigManager(dir); const config = await manager.load(); config.session.autoSave = false;
  if (preset !== undefined) config.preset = preset;
  config.evidence = { enabled: true, directory: join(dir, 'evidence'), ownerId: 'local', namespace: 'stage12' };
  config.taskState = { enabled: true, taskId: 'T42', ownerId: 'local', namespace: 'stage12' };
  const provider = new ScriptedLoopProvider([{ text: 'one' }, { text: 'two' }, { text: 'three' }]);
  Connector.create({ name: 'amos-preset', vendor: Vendor.OpenAI, auth: { type: 'none' }, options: { provider } });
  let runner = new AgentRunner(config, [], join(dir, 'sessions')); runners.push(runner); await runner.initialize('amos-preset', 'gpt-4o-mini');
  const save = vi.fn(async () => manager.save()); const recreate = vi.fn();
  const app = { getAgent: () => runner, getConfig: () => manager.get(), updateConfig: (partial: Partial<AmosConfig>) => manager.update(partial), saveConfig: save, createAgent: recreate } as unknown as CommandContext['app'];
  return { dir, manager, config, provider, get runner() { return runner; }, save, recreate, reinitialize: async () => { const previous = runner; runner = new AgentRunner(manager.get(), [], join(dir, 'sessions')); runners.push(runner); await runner.initialize('amos-preset', 'gpt-4o-mini'); previous.destroy(); }, invoke: (args: string[]) => new PresetCommand().execute({ app, args, rawInput: '/preset ' + args.join(' ') }) };
}
describe('AMOS preset adoption', () => {
  it.each([undefined, null] as const)('loads legacy/plain selection %s without adding preset defaults', async selection => {
    const f = await fixture(selection); const report = f.runner.inspectCapabilities();
    expect(report.activePreset).toBeNull(); expect(report.capabilities.context.strategy).toBe('algorithmic'); expect(report.capabilities.loop.enabled).toBe(false);
    expect(DEFAULT_CONFIG.preset).toBeUndefined();
  });
  it.each(['research', 'workflow'] as const)('initializes %s through the public factory and reports resolved settings', async preset => {
    const f = await fixture(preset); const report = f.runner.inspectCapabilities();
    expect(report.activePreset).toBe(preset); expect(report.capabilities.loop.maxIterations).toBe(preset === 'research' ? 12 : 8);
    expect(report.capabilities.context.strategy).toBe(preset === 'research' ? 'observation-masking' : 'algorithmic');
    expect((await f.invoke(['inspect'])).message).toContain('hostCompletionCheck'); expect(f.provider.requests).toHaveLength(0);
  });
  it('saves next selection without replacing live agent/history and applies it on reinitialization', async () => {
    const f = await fixture(); await f.runner.run('Keep this conversation.');
    expect((await f.invoke(['set', 'research'])).success).toBe(true); expect(f.recreate).not.toHaveBeenCalled();
    expect(f.runner.inspectCapabilities().activePreset).toBeNull(); expect((await f.invoke([])).message).toContain('Saved selection (next initialization): research');
    expect((await new ConfigManager(f.dir).load()).preset).toBe('research'); expect(f.provider.requests).toHaveLength(1);
    const id = await f.runner.saveSession(); f.manager.get().session.activeSessionId = id; await f.reinitialize();
    expect(f.runner.inspectCapabilities().activePreset).toBe('research'); await f.runner.run('Continue.');
    expect(JSON.stringify(f.provider.requests[1])).toContain('Keep this conversation.');
  });
  it.each([undefined, null, 'workflow'] as const)('restores exact %s selection on save failure, including owned config and later reload', async selection => {
    const f = await fixture(selection); f.save.mockRejectedValueOnce(new Error('private storage location'));
    const result = await f.invoke(['set', 'research']); expect(result.success).toBe(false); expect(result.message).not.toContain('private');
    expect(f.config.preset).toBe(selection); expect(f.manager.get().preset).toBe(selection); expect(Object.hasOwn(f.manager.get(), 'preset')).toBe(selection !== undefined);
    await f.manager.save(); expect((await new ConfigManager(f.dir).load()).preset).toBe(selection); expect(f.recreate).not.toHaveBeenCalled();
  });
  it('validates dependencies before saving and rejects active-execution changes', async () => {
    const f = await fixture(); f.config.evidence = undefined;
    expect((await f.invoke(['set', 'research'])).success).toBe(false); expect(f.save).not.toHaveBeenCalled();
    f.config.evidence = { enabled: true, directory: join(f.dir, 'evidence'), ownerId: 'local', namespace: 'stage12' };
    vi.spyOn(f.runner, 'isRunning').mockReturnValue(true);
    expect((await f.invoke(['set', 'workflow'])).success).toBe(false); expect(f.save).not.toHaveBeenCalled();
  });
  it('keeps explicit settings authoritative and off preserves configured features', async () => {
    const f = await fixture('research'); f.config.contextStrategy = 'algorithmic'; f.config.maxIterations = 3; f.config.loopPolicy = null;
    await f.runner.initialize('amos-preset', 'gpt-4o-mini'); const report = f.runner.inspectCapabilities();
    expect(report.capabilities.context.strategy).toBe('algorithmic'); expect(report.capabilities.loop).toEqual({ enabled: false, hostCompletionCheck: false, maxIterations: 3 });
    expect((await f.invoke(['set', 'off'])).success).toBe(true); await f.reinitialize();
    expect(f.runner.inspectCapabilities().activePreset).toBeNull(); expect(f.runner.inspectCapabilities().capabilities.context.plugins).toContain('evidence');
  });
  it('saves descriptive active-preset metadata without changing host policy on load', async () => {
    const f = await fixture('workflow'); await f.runner.run('save'); const id = await f.runner.saveSession('work');
    const files = await import('node:fs/promises').then(fs => fs.readdir(join(f.dir, 'sessions', 'amos', 'sessions'))).catch(() => []);
    expect(id).toBeTruthy(); expect(files.length).toBeGreaterThan(0);
    const path = join(f.dir, 'sessions', 'amos', 'sessions', id + '.json');
    const saved = JSON.parse(await readFile(path, 'utf8')); expect(saved.metadata.agenticPreset).toBe('workflow');
    f.config.preset = null; await f.runner.initialize('amos-preset', 'gpt-4o-mini');
    expect(f.runner.inspectCapabilities().activePreset).toBeNull(); expect(f.runner.inspectCapabilities().capabilities.loop.enabled).toBe(false);
  });
  it('validates current saved settings rather than the live runner configuration', async () => {
    const f = await fixture();
    f.manager.update({ evidence: { ...f.config.evidence!, enabled: false } });
    expect((await f.invoke(['set', 'research'])).success).toBe(false); expect(f.save).not.toHaveBeenCalled();
    expect(f.runner.inspectCapabilities().capabilities.context.features.evidence).toBe(true);
  });
  it('preserves the live agent when invalid persisted next-agent settings fail preflight', async () => {
    const f = await fixture('workflow'); await f.runner.run('Keep exact history.');
    f.config.preset = 'unknown' as AmosConfig['preset'];
    await expect(f.runner.initialize('amos-preset', 'gpt-4o-mini')).rejects.toThrow('Unknown agent preset');
    expect(f.runner.isReady()).toBe(true); expect(f.runner.inspectCapabilities().activePreset).toBe('workflow');
    await f.runner.run('Continue'); expect(JSON.stringify(f.provider.requests[1])).toContain('Keep exact history.');
  });
  it('reports host-only completion overrides without a contradictory default notice', async () => {
    const f = await fixture('workflow'); f.runner.setLoopPolicy({ completion: () => ({ complete: true }) });
    expect(f.runner.inspectCapabilities().capabilities.loop.hostCompletionCheck).toBe(true);
    expect(f.runner.inspectCapabilities().capabilities.notices.join(' ')).not.toContain('No host completion check');
    f.runner.setLoopPolicy(null); expect(f.runner.inspectCapabilities().capabilities.loop.enabled).toBe(false);
    expect(f.runner.inspectCapabilities().capabilities.notices.join(' ')).toContain('No host completion check');
  });
  it('supports legacy adapters without new optional methods and sanitizes inspection failures', async () => {
    const execute = (runner: unknown, args: string[]) => new PresetCommand().execute({ app: { getAgent: () => runner } as CommandContext['app'], args, rawInput: '/preset' });
    expect((await execute(undefined, [])).success).toBe(false); expect((await execute({}, ['set', 'research'])).success).toBe(false);
    const result = await execute({ inspectCapabilities: () => { throw Error('private provider detail'); } }, ['inspect']);
    expect(result.success).toBe(false); expect(result.message).not.toContain('private');
  });
  it('rejects unknown or extra command arguments without saving', async () => {
    const f = await fixture(); for (const args of [['coding'], ['set'], ['set', 'coding'], ['inspect', 'extra'], ['set', 'research', 'extra']]) expect((await f.invoke(args)).success).toBe(false);
    expect(f.save).not.toHaveBeenCalled();
  });
});
