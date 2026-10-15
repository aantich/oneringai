import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigManager } from '../../../../apps/amos/src/config/ConfigManager.js';
import type { InputItem } from '@everworker/oneringai';
import { Agent, StrategyRegistry, AgentContextNextGen, InMemoryEvidenceStorage, MessageRole, ContentType } from '@everworker/oneringai';
import { AgentRunner } from '../../../../apps/amos/src/agent/AgentRunner.js';
import { ContextCommand } from '../../../../apps/amos/src/commands/commands/ContextCommand.js';
import { DEFAULT_CONFIG } from '../../../../apps/amos/src/config/types.js';
import type { CommandContext, IAgentRunner } from '../../../../apps/amos/src/config/types.js';
afterEach(() => vi.restoreAllMocks());
describe('AMOS Stage 07 strategy selection', () => {
  it.each(['observation-masking', 'structured-summary'] as const)('constructs %s with evidence and keeps a single context/tool manager', async strategy => {
    const create = vi.spyOn(Agent, 'create').mockReturnValue({ destroy: vi.fn() } as unknown as Agent);
    const config = structuredClone(DEFAULT_CONFIG); config.contextStrategy = strategy; config.evidence = { enabled: true, directory: '/tmp/amos-stage07-evidence', ownerId: 'local', namespace: 'stage07' };
    if (strategy === 'structured-summary') config.modelExecution = { helpers: { compactor: { connector: 'main', model: 'gpt-4o-mini' } } };
    const runner = new AgentRunner(config, []); try { await runner.initialize('main', 'gpt-4o-mini'); const selected = create.mock.calls[0]![0]; expect(selected.context?.strategy).toBe(strategy); expect(selected.context?.features?.evidence).toBe(true); expect(selected.userId).toBe('local'); } finally { runner.destroy(); }
  });
  it.each(['observation-masking', 'structured-summary'] as const)('rejects persisted %s without its required explicit configuration', async strategy => {
    const create = vi.spyOn(Agent, 'create'); const config = structuredClone(DEFAULT_CONFIG); config.contextStrategy = strategy;
    const runner = new AgentRunner(config, []); try { await expect(runner.initialize('main', 'gpt-4o-mini')).rejects.toThrow('evidence'); expect(create).not.toHaveBeenCalled(); } finally { runner.destroy(); }
  });
  it('roundtrips optional strategy and helper headroom through actual config storage', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'amos-stage07-config-'));
    try {
      const first = new ConfigManager(directory); expect((await first.load()).contextStrategy).toBeUndefined();
      first.update({ contextStrategy: 'structured-summary', modelExecution: { helpers: { compactor: { connector: 'main', model: 'gpt-4o-mini', maxOutputTokens: 4096 } } } }); await first.save();
      const restored = await new ConfigManager(directory).load(); expect(restored.contextStrategy).toBe('structured-summary'); expect(restored.modelExecution?.helpers?.compactor?.maxOutputTokens).toBe(4096); expect(restored.defaults).toEqual(DEFAULT_CONFIG.defaults);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it('uses configured helper output headroom at the actual summary callback boundary', async () => {
    const create = vi.spyOn(Agent, 'create').mockReturnValue({ destroy: vi.fn() } as unknown as Agent);
    const config = structuredClone(DEFAULT_CONFIG); config.contextStrategy = 'structured-summary'; config.evidence = { enabled: true, directory: '/tmp/amos-stage07-evidence', ownerId: 'local', namespace: 'headroom' };
    config.modelExecution = { helpers: { compactor: { connector: 'main', model: 'gpt-4o-mini', maxOutputTokens: 4096 } } };
    const runner = new AgentRunner(config, []); await runner.initialize('main', 'gpt-4o-mini');
    const storage = new InMemoryEvidenceStorage({ scope: { ownerId: 'local', namespace: 'headroom' } });
    const context = AgentContextNextGen.create({ ...create.mock.calls[0]![0].context!, model: 'gpt-4o-mini', maxContextTokens: 3000, responseReserve: 128, criticalCompactionThreshold: 0.8, features: { workingMemory: false, inContextMemory: false, evidence: true }, plugins: { evidence: { storage } } });
    const msg = (role: MessageRole, text: string): InputItem => ({ type: 'message', role, content: [{ type: role === MessageRole.ASSISTANT ? ContentType.OUTPUT_TEXT : ContentType.INPUT_TEXT, text }] });
    let observed = 0;
    try {
      context.addInputItems([msg(MessageRole.USER, 'Original task.'), msg(MessageRole.ASSISTANT, 'Older narrative. '.repeat(1000)), msg(MessageRole.USER, 'Recent one.'), msg(MessageRole.ASSISTANT, 'OK.'), msg(MessageRole.USER, 'Recent two.'), msg(MessageRole.ASSISTANT, 'OK.')]);
      await context.prepare({ summarize: async request => { observed = request.maxOutputTokens; return { summary: { completedWork: [{ text: 'Earlier source retained.', sourceIds: [request.reference.id] }], activeWork: [], constraints: [], decisions: [], uncertainties: [], artifacts: [], actionReceipts: [] } }; } });
      expect(observed).toBe(4096); expect(context.lastPreparation?.compaction?.applied).toBe(true);
    } finally { context.destroy(); runner.destroy(); }
  });
  it('preserves old config default and switches an existing context without recreating the agent', async () => {
    let strategy = StrategyRegistry.create('algorithmic'); const context = { get compactionStrategy() { return strategy; }, setCompactionStrategy: (next: typeof strategy) => { strategy = next; }, getPlugin: () => undefined, lastPreparation: undefined };
    const create = vi.spyOn(Agent, 'create').mockReturnValue({ context, isRunning: () => false, destroy: vi.fn() } as unknown as Agent);
    const runner = new AgentRunner(structuredClone(DEFAULT_CONFIG), []); await runner.initialize('main', 'gpt-4o-mini');
    try { expect(create.mock.calls[0]![0].context).toBeUndefined(); expect(runner.getContextCompaction().strategy).toBe('algorithmic'); expect(() => runner.setContextStrategy('observation-masking')).toThrow('Enable evidence'); runner.setContextStrategy('algorithmic'); expect(create).toHaveBeenCalledTimes(1); expect(strategy.name).toBe('algorithmic'); } finally { runner.destroy(); }
  });
  it('inspects diagnostics without making helper calls and validates command arguments', async () => {
    const select = vi.fn(); const runner = { isReady: () => true, setContextStrategy: select, getContextCompaction: () => ({ strategy: 'structured-summary', last: { strategy: 'structured-summary', applied: true, tokensFreed: 1200, helperInvoked: true, fallback: 'mask', sourceReferences: [{ id: 'source-id' }] } }) } as unknown as IAgentRunner;
    const app = { getAgent: () => runner, updateConfig: vi.fn(), saveConfig: vi.fn(async () => {}) } as unknown as CommandContext['app']; const command = new ContextCommand();
    const invoke = (args: string[]) => command.execute({ app, args, rawInput: '/context ' + args.join(' ') });
    const listing = await invoke(['strategy']); expect(listing.success).toBe(true); expect(listing.message).toContain('1200'); expect(listing.message).toContain('source-id'); expect(listing.message).toContain('/helpers usage'); expect(select).not.toHaveBeenCalled();
    for (const args of [['strategy', 'unknown'], ['strategy', 'algorithmic', 'extra']]) expect((await invoke(args)).success).toBe(false);
  });
  it('restores runtime/config selection when persistence fails', async () => {
    const select = vi.fn(); const update = vi.fn();
    const runner = { isReady: () => true, setContextStrategy: select, getContextCompaction: () => ({ strategy: 'algorithmic' }) } as unknown as IAgentRunner;
    const app = { getAgent: () => runner, getConfig: () => structuredClone(DEFAULT_CONFIG), updateConfig: update, saveConfig: async () => { throw new Error('private backend detail'); } } as unknown as CommandContext['app'];
    const result = await new ContextCommand().execute({ app, args: ['strategy', 'observation-masking'], rawInput: '/context strategy observation-masking' });
    expect(result.success).toBe(false); expect(result.message).not.toContain('private backend'); expect(select.mock.calls.map(c => c[0])).toEqual(['observation-masking', 'algorithmic']); expect(update).toHaveBeenLastCalledWith({ contextStrategy: undefined });
  });
  it('selects and persists only an explicit strategy command', async () => {
    const runner = { isReady: () => true, setContextStrategy: vi.fn(), getContextCompaction: () => ({ strategy: 'observation-masking' }) } as unknown as IAgentRunner;
    const app = { getAgent: () => runner, updateConfig: vi.fn(), saveConfig: vi.fn(async () => {}), getConfig: () => structuredClone(DEFAULT_CONFIG) } as unknown as CommandContext['app'];
    const result = await new ContextCommand().execute({ app, args: ['strategy', 'observation-masking'], rawInput: '/context strategy observation-masking' });
    expect(result.success).toBe(true); expect(runner.setContextStrategy).toHaveBeenCalledWith('observation-masking'); expect(app.updateConfig).toHaveBeenCalledWith({ contextStrategy: 'observation-masking' }); expect(app.saveConfig).toHaveBeenCalledTimes(1);
  });
});

describe('AMOS Stage 07 review correction: real configuration ownership', () => {
  async function setup(initial: 'absent' | 'algorithmic', selected: 'observation-masking' | 'structured-summary') {
    const directory = await mkdtemp(join(tmpdir(), 'amos-stage07-rollback-'));
    const manager = new ConfigManager(directory); const config = await manager.load();
    if (initial === 'algorithmic') config.contextStrategy = 'algorithmic';
    config.evidence = { enabled: true, directory: join(directory, 'evidence'), ownerId: 'owner', namespace: 'rollback' };
    if (selected === 'structured-summary') config.modelExecution = { helpers: { compactor: { connector: 'synthetic', model: 'gpt-4o-mini' } } };
    const context = AgentContextNextGen.create({ model: 'gpt-4o-mini', features: { evidence: true }, plugins: { evidence: { storage: new InMemoryEvidenceStorage({ scope: { ownerId: 'owner', namespace: 'rollback' } }) } } });
    context.addInputItems([{ type: 'message', role: MessageRole.USER, content: [{ type: ContentType.INPUT_TEXT, text: 'Keep this existing session.' }] }]);
    let running = false;
    const create = vi.spyOn(Agent, 'create').mockReturnValue({ context, tools: context.tools, isRunning: () => running, destroy: () => context.destroy() } as unknown as Agent);
    const runner = new AgentRunner(config, [], join(directory, 'sessions')); await runner.initialize('synthetic', 'gpt-4o-mini');
    const save = vi.fn(async () => { await manager.save(); });
    const app = { getAgent: () => runner, getConfig: () => manager.get(), updateConfig: (partial: Parameters<ConfigManager['update']>[0]) => manager.update(partial), saveConfig: save } as unknown as CommandContext['app'];
    return { directory, manager, originalConfig: config, context, runner, create, save, setRunning: (value: boolean) => { running = value; }, invoke: () => new ContextCommand().execute({ app, args: ['strategy', selected], rawInput: '/context strategy ' + selected }), cleanup: async () => { runner.destroy(); await rm(directory, { recursive: true, force: true }); } };
  }
  for (const initial of ['absent', 'algorithmic'] as const) for (const selected of ['observation-masking', 'structured-summary'] as const) {
    it(`restores ${initial} after failed ${selected} save, including a later unrelated save/reload`, async () => {
      const f = await setup(initial, selected); const history = f.context.getState().conversation;
      try {
        f.save.mockRejectedValueOnce(new Error('private settings failure'));
        const result = await f.invoke(); expect(result.success).toBe(false); expect(result.message).toContain('previous selection restored'); expect(result.message).not.toContain('private');
        expect(f.runner.getContextCompaction().strategy).toBe('algorithmic');
        expect(f.manager.get().contextStrategy).toBe(initial === 'absent' ? undefined : 'algorithmic');
        expect(Object.hasOwn(f.manager.get(), 'contextStrategy')).toBe(initial !== 'absent');
        expect(Object.hasOwn(f.originalConfig, 'contextStrategy')).toBe(initial !== 'absent');
        f.manager.update({ defaults: { ...f.manager.get().defaults, temperature: 0.3 } }); await f.manager.save();
        const reloaded = await new ConfigManager(f.directory).load();
        expect(reloaded.contextStrategy).toBe(initial === 'absent' ? undefined : 'algorithmic'); expect(reloaded.defaults.temperature).toBe(0.3);
        expect(f.context.getState().conversation).toEqual(history); expect(f.create).toHaveBeenCalledTimes(1);
      } finally { await f.cleanup(); }
    });
  }
  it.each(['observation-masking', 'structured-summary'] as const)('persists successful %s selection without recreating context', async selected => {
    const f = await setup('absent', selected); const history = f.context.getState().conversation;
    try {
      expect((await f.invoke()).success).toBe(true); expect(f.runner.getContextCompaction().strategy).toBe(selected);
      expect((await new ConfigManager(f.directory).load()).contextStrategy).toBe(selected);
      expect(f.context.getState().conversation).toEqual(history); expect(f.create).toHaveBeenCalledTimes(1); expect(f.save).toHaveBeenCalledTimes(1);
    } finally { await f.cleanup(); }
  });
  it('rejects changes during an execution without changing or saving configuration', async () => {
    const f = await setup('absent', 'observation-masking');
    try { f.setRunning(true); expect((await f.invoke()).success).toBe(false); expect(f.save).not.toHaveBeenCalled(); expect(Object.hasOwn(f.manager.get(), 'contextStrategy')).toBe(false); expect(f.runner.getContextCompaction().strategy).toBe('algorithmic'); }
    finally { await f.cleanup(); }
  });
  it('reports a failed runtime rollback truthfully and still restores configuration', async () => {
    const f = await setup('absent', 'observation-masking');
    try {
      f.save.mockRejectedValueOnce(new Error('save failed')); const original = f.runner.setContextStrategy.bind(f.runner);
      vi.spyOn(f.runner, 'setContextStrategy').mockImplementation(strategy => { if (strategy === 'algorithmic') throw new Error('private rollback failure'); original(strategy); });
      const result = await f.invoke(); expect(result.success).toBe(false); expect(result.message).toContain('could not be fully restored'); expect(result.message).not.toContain('private');
      expect(f.manager.get().contextStrategy).toBeUndefined(); expect(f.runner.getContextCompaction().strategy).toBe('observation-masking');
    } finally { await f.cleanup(); }
  });
});
