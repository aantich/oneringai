import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentRunner } from '../../../../apps/amos/src/agent/AgentRunner.js';
import { ConfigManager } from '../../../../apps/amos/src/config/ConfigManager.js';
import { DEFAULT_CONFIG } from '../../../../apps/amos/src/config/types.js';
import { Agent } from '@everworker/oneringai';

const fake = vi.hoisted(() => ({ invokeHelper: vi.fn(), rolloverContext: vi.fn(), getModelUsage: vi.fn(),
  cancel: vi.fn(), destroy: vi.fn(), isRunning: () => false }));
vi.mock('@everworker/oneringai', async importActual => ({ ...await importActual<Record<string, unknown>>(),
  Agent: { create: vi.fn(() => fake) },
}));
const runners: AgentRunner[] = []; const directories: string[] = [];
beforeEach(() => { vi.clearAllMocks(); });
afterEach(async () => { runners.splice(0).forEach(r => r.destroy()); for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true }); });

describe('AMOS helper adapter and configuration persistence', () => {
  it('keeps old configuration disabled and passes optional role profiles from trusted host configuration', async () => {
    const config = structuredClone(DEFAULT_CONFIG); const runner = new AgentRunner(config, []); runners.push(runner);
    await runner.initialize('main', 'gpt-4o-mini');
    expect(Agent.create).toHaveBeenLastCalledWith(expect.objectContaining({ modelExecution: undefined }));
    expect(fake.invokeHelper).not.toHaveBeenCalled();
    config.modelExecution = { helpers: { extractor: { connector: 'helper', model: 'gpt-4o-mini' } } };
    await runner.initialize('main', 'gpt-4o-mini');
    expect(Agent.create).toHaveBeenLastCalledWith(expect.objectContaining({ modelExecution: config.modelExecution }));
  });

  it('tracks helper busy state, routes cancellation, prevents overlap and clears busy state after rejection', async () => {
    const runner = new AgentRunner(structuredClone(DEFAULT_CONFIG), []); runners.push(runner); await runner.initialize('main', 'gpt-4o-mini');
    let reject!: (error: Error) => void;
    fake.invokeHelper.mockImplementationOnce(async () => new Promise((_resolve, no) => { reject = no; }));
    const pending = runner.invokeHelper('extractor', 'packet').catch(e => e);
    expect(runner.isRunning()).toBe(true); runner.cancel(); expect(fake.cancel).toHaveBeenCalled();
    await expect(runner.run('overlap')).rejects.toThrow('already running');
    reject(new Error('cancelled')); expect((await pending).message).toBe('cancelled'); expect(runner.isRunning()).toBe(false);
  });

  it('uses explicit rollover and reports a no-op without promising a helper request', async () => {
    const config = structuredClone(DEFAULT_CONFIG); config.modelExecution = { helpers: { compactor: { connector: 'helper', model: 'gpt-4o-mini' } } };
    const runner = new AgentRunner(config, []); runners.push(runner); await runner.initialize('main', 'gpt-4o-mini');
    fake.rolloverContext.mockResolvedValueOnce({ performed: false });
    expect(await runner.compactWithHelper()).toContain('no helper call');
    expect(fake.rolloverContext).toHaveBeenCalledWith(expect.objectContaining({ preserveRecentTurns: 2 }));
    expect(runner.isRunning()).toBe(false);
  });

  it('loads old files unchanged and round-trips only static helper configuration', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'oneringai-stage06-amos-')); directories.push(dir);
    await writeFile(join(dir, 'config.json'), JSON.stringify({ activeModel: 'gpt-4o-mini' }));
    const old = new ConfigManager(dir); expect((await old.load()).modelExecution).toBeUndefined();
    old.update({ modelExecution: { helpers: { extractor: { connector: 'helper-account', model: 'gpt-4o-mini', thinking: { enabled: false } } } } });
    await old.save(); const next = new ConfigManager(dir); const loaded = await next.load();
    expect(loaded.modelExecution?.helpers?.extractor?.connector).toBe('helper-account');
    expect(JSON.stringify(loaded.modelExecution)).not.toContain('modelTask'); expect(JSON.stringify(loaded.modelExecution)).not.toContain('apiKey');
  });
});
