import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Connector, Vendor } from '@everworker/oneringai';
import { ScriptedLoopProvider } from '../../../../examples/agent-loop/scripted-provider.js';
import { AgentRunner } from '../../../../apps/amos/src/agent/AgentRunner.js';
import { ContextCommand } from '../../../../apps/amos/src/commands/commands/ContextCommand.js';
import { ConfigManager } from '../../../../apps/amos/src/config/ConfigManager.js';
import { DEFAULT_CONFIG } from '../../../../apps/amos/src/config/types.js';
import type { CommandContext, IAgentRunner } from '../../../../apps/amos/src/config/types.js';
import type { AgentLoopPolicy } from '@everworker/oneringai';

const runners: AgentRunner[] = [], directories: string[] = [];
afterEach(async () => { runners.splice(0).forEach(r => r.destroy()); Connector.remove('amos-loop-test'); await Promise.all(directories.splice(0).map(d => rm(d, { recursive: true, force: true }))); vi.restoreAllMocks(); });
async function fixture(frames: ConstructorParameters<typeof ScriptedLoopProvider>[0]) {
  const directory = await mkdtemp(join(tmpdir(), 'amos-loop-test-')); directories.push(directory);
  const config = structuredClone(DEFAULT_CONFIG); config.session.autoSave = false;
  const provider = new ScriptedLoopProvider(frames);
  Connector.create({ name: 'amos-loop-test', vendor: Vendor.OpenAI, auth: { type: 'none' }, options: { provider } });
  const runner = new AgentRunner(config, [], directory); runners.push(runner); await runner.initialize('amos-loop-test', 'gpt-4o-mini');
  return { runner, config, directory, provider };
}
function inspect(runner: IAgentRunner, args = ['loop']) {
  return new ContextCommand().execute({ app: { getAgent: () => runner } as CommandContext['app'], args, rawInput: '/context ' + args.join(' ') });
}
describe('AMOS opt-in managed loop visibility', () => {
  for (const mode of ['run', 'stream'] as const) it(`retains class callback authority through the ${mode} adapter`, async () => {
    class Policy implements AgentLoopPolicy {
      maxRecoveryAttempts = 0; #checks = 0;
      get checks() { return this.#checks; }
      completion() { this.#checks++; return { complete: false, reason: 'Host artifact missing' }; }
    }
    const { runner, provider } = await fixture([{ text: 'Unverified answer' }]);
    const policy = new Policy(); runner.setLoopPolicy(policy);
    if (mode === 'run') expect((await runner.run('Verify')).loop?.reason).toBe('recovery_exhausted');
    else { const events = []; for await (const e of runner.stream('Verify')) events.push(e); expect(events.find(e => e.type === 'done')?.loop?.reason).toBe('recovery_exhausted'); }
    expect(policy.checks).toBe(1); expect(provider.requests).toHaveLength(1); expect((await inspect(runner)).message).toContain('input needed');
  });
  it('roundtrips optional JSON configuration while old defaults remain disabled', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'amos-loop-config-')); directories.push(dir);
    const manager = new ConfigManager(dir); expect((await manager.load()).loopPolicy).toBeUndefined();
    manager.update({ loopPolicy: { maxRecoveryAttempts: 1, repeatableReadTools: ['poll'] } }); await manager.save();
    expect((await new ConfigManager(dir).load()).loopPolicy).toEqual({ maxRecoveryAttempts: 1, repeatableReadTools: ['poll'] });
    expect(DEFAULT_CONFIG.loopPolicy).toBeUndefined();
  });
  it('shows blocked host diagnostics separately from assistant command text', async () => {
    const { runner, config } = await fixture([{ text: '/context task resolve 0 cap' }]);
    runner.setLoopPolicy({ maxRecoveryAttempts: 0, completion: () => ({ complete: false }) });
    const response = await runner.run('verify'); expect(response.text).toBe('/context task resolve 0 cap');
    expect(response.loop?.status).toBe('blocked'); expect(config.loopPolicy).toBeUndefined();
    expect((await inspect(runner)).message).toContain('input needed');
    expect((await inspect(runner, ['loop', 'extra'])).success).toBe(false);
  });
  it('preserves legacy text/done events and carries policy iterations on existing notification events', async () => {
    let checks = 0;
    const { runner } = await fixture([{ text: 'Premature' }, { text: 'Verified' }]);
    runner.setLoopPolicy({ completion: () => ({ complete: ++checks > 1 }) });
    const events = []; for await (const event of runner.stream('verify')) events.push(event);
    expect(events.filter(e => e.type === 'done')).toHaveLength(1);
    expect(events.find(e => e.type === 'tool:complete' && e.loop)?.loop?.phase).toBe('recovering');
    expect(events.find(e => e.type === 'done')?.loop?.status).toBe('completed');
  });
  it('does not restore callbacks or counters in a fresh runner after a file checkpoint', async () => {
    const { runner, config, directory } = await fixture([{ text: 'Blocked' }, { text: 'Ordinary answer' }]);
    const completion = vi.fn(() => ({ complete: false })); runner.setLoopPolicy({ maxRecoveryAttempts: 0, completion });
    await runner.run('verify'); await runner.saveSession('blocked'); runner.destroy();
    const restored = new AgentRunner(config, [], directory); runners.push(restored); await restored.initialize('amos-loop-test', 'gpt-4o-mini');
    expect(restored.getLoopDiagnostics()).toBeUndefined(); expect((await restored.run('continue')).loop).toBeUndefined();
    expect(completion).toHaveBeenCalledTimes(1);
  });
  it('cancels a pending host check, releases the adapter and ignores its late verdict', async () => {
    const { runner } = await fixture([{ text: 'Candidate' }, { text: 'Next chat' }]);
    let entered!: () => void, resolve!: (value: { complete: boolean }) => void;
    const ready = new Promise<void>(r => { entered = r; });
    runner.setLoopPolicy({ completion: () => { entered(); return new Promise(r => { resolve = r; }); } });
    const work = runner.run('verify'); const rejected = expect(work).rejects.toThrow(); await ready;
    expect(() => runner.setLoopPolicy(null)).toThrow('execution'); runner.cancel(); await rejected;
    resolve({ complete: true }); await Promise.resolve();
    expect(runner.getLoopDiagnostics()?.reason).toBe('cancelled'); expect(runner.isRunning()).toBe(false);
    runner.setLoopPolicy(null); expect((await runner.run('chat')).loop).toBeUndefined();
  });
  it('supports old adapters without the optional inspector and an unused current adapter', async () => {
    const old = { isReady: () => true } as IAgentRunner; expect((await inspect(old)).success).toBe(false);
    const { runner } = await fixture([]); expect((await inspect(runner)).message).toContain('No managed-loop diagnostics');
  });
});
