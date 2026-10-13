import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HelpersCommand } from '../../../../apps/amos/src/commands/commands/HelpersCommand.js';
import { DEFAULT_CONFIG } from '../../../../apps/amos/src/config/types.js';
import type { AmosConfig, CommandContext, IAmosApp, IAgentRunner } from '../../../../apps/amos/src/config/types.js';
import { ModelTask } from '@/core/model-execution/ModelTask.js';

describe('AMOS helper configuration and usage', () => {
  let command: HelpersCommand; let config: AmosConfig; let app: IAmosApp; let runner: IAgentRunner;
  const invokeHelper = vi.fn(); const compact = vi.fn(); const createAgent = vi.fn(); const register = vi.fn(); const save = vi.fn();
  const context = (args: string[]): CommandContext => ({ app, args, rawInput: `/helpers ${args.join(' ')}` });
  beforeEach(() => {
    vi.clearAllMocks(); command = new HelpersCommand(); config = structuredClone(DEFAULT_CONFIG);
    runner = { isReady: () => true, isRunning: () => false, invokeHelper, compactWithHelper: compact } as unknown as IAgentRunner;
    app = { getConfig: () => config, getAgent: () => runner, updateConfig: (changes: Partial<AmosConfig>) => { Object.assign(config, changes); },
      saveConfig: save, createAgent, getConnectorManager: () => ({ get: (name: string) => name === 'openai-main' ? { name, vendor: 'openai' } : null, registerConnector: register }),
    } as unknown as IAmosApp;
  });

  it('keeps existing configuration disabled and explains extra requests before enabling', async () => {
    const result = await command.execute(context([]));
    expect(config.modelExecution).toBeUndefined(); expect(result.success).toBe(true);
    expect(result.message).toContain('compactor: disabled'); expect(result.message).toContain('at most one JSON repair');
    expect(result.message).toContain('older conversation text'); expect(invokeHelper).not.toHaveBeenCalled(); expect(compact).not.toHaveBeenCalled();
  });

  it('saves a static connector/model profile, authorizes explicit rollover transfer and makes no model call', async () => {
    const result = await command.execute(context(['set', 'compactor', 'openai-main', 'gpt-4o-mini']));
    expect(result.success).toBe(true);
    expect(config.modelExecution?.helpers?.compactor).toMatchObject({ connector: 'openai-main', model: 'gpt-4o-mini', allowContextTransfer: true });
    expect(register).toHaveBeenCalledWith('openai-main'); expect(createAgent).toHaveBeenCalledTimes(1); expect(save).toHaveBeenCalledTimes(1);
    expect(invokeHelper).not.toHaveBeenCalled(); expect(compact).not.toHaveBeenCalled();
  });

  it.each([
    ['set', 'extractor', 'hidden', 'gpt-4o-mini'], ['set', 'extractor', 'openai-main', 'claude-haiku-4-5-20251001'],
    ['set', 'extractor', 'openai-main', 'gpt-4o-mini', 'max'], ['budget', '-1', '100'], ['budget', '2', 'NaN'],
  ])('rejects inaccessible/incompatible/invalid settings %j before updating the host', async (...args: string[]) => {
    const result = await command.execute(context(args)); expect(result.success).toBe(false);
    expect(config.modelExecution).toBeUndefined(); expect(createAgent).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled();
  });

  it('loads and persists optional budgets without adding runtime tasks or secrets to configuration', async () => {
    const result = await command.execute(context(['budget', '5', '2000000'])); expect(result.success).toBe(true);
    expect(config.modelExecution?.limits).toEqual({ maxCalls: 5, maxTokens: 2_000_000 });
    expect(JSON.stringify(config.modelExecution)).not.toContain('modelTask');
  });

  it('turns helper/task configuration off explicitly while preserving ordinary app defaults', async () => {
    await command.execute(context(['set', 'extractor', 'openai-main', 'gpt-4o-mini']));
    await command.execute(context(['off']));
    expect(config.modelExecution).toBeNull(); expect(config.defaults).toEqual(DEFAULT_CONFIG.defaults);
  });

  it('invokes only explicitly requested helpers and explicit rollover', async () => {
    invokeHelper.mockResolvedValueOnce('VERIFIED'); compact.mockResolvedValueOnce('Summarized older items.');
    expect((await command.execute(context(['run', 'extractor', 'explicit', 'packet']))).message).toBe('VERIFIED');
    expect(invokeHelper).toHaveBeenCalledWith('extractor', 'explicit packet');
    expect((await command.execute(context(['compact']))).message).toContain('Summarized'); expect(compact).toHaveBeenCalledTimes(1);
  });

  it('rejects reconfiguration and extra work during a running operation', async () => {
    runner.isRunning = () => true;
    expect((await command.execute(context(['set', 'extractor', 'openai-main', 'gpt-4o-mini']))).success).toBe(false);
    expect((await command.execute(context(['compact']))).success).toBe(false);
    expect(createAgent).not.toHaveBeenCalled(); expect(compact).not.toHaveBeenCalled();
  });

  it('distinguishes absent usage, unknown model prices and purpose attribution', async () => {
    expect((await command.execute(context(['usage']))).message).toContain('No model-task usage recorded');
    const task = new ModelTask();
    task.recordExternal({ id: 'helper-call', purpose: 'compactor', connector: 'helper-account', model: 'unknown-model', usage: null });
    runner.getModelUsage = () => task.snapshot();
    const result = await command.execute(context(['usage']));
    expect(result.message).toContain('compactor/generation'); expect(result.message).toContain('usage unknown');
    expect(result.message).toContain('model cost unknown'); expect(result.message).toContain('Unknown/pending model costs: 1');
    task.destroy();
  });

  it('surfaces helper failures without reporting successful output or saving a changed configuration', async () => {
    invokeHelper.mockRejectedValueOnce(new Error('Helper packet exceeds the resolved input allowance'));
    const result = await command.execute(context(['run', 'extractor', 'packet']));
    expect(result.success).toBe(false); expect(result.message).toContain('input allowance'); expect(save).not.toHaveBeenCalled();
  });

  it('restores previous helper settings when applying the new profile fails', async () => {
    createAgent.mockRejectedValueOnce(new Error('cannot load profile')).mockResolvedValueOnce(undefined);
    const result = await command.execute(context(['set', 'extractor', 'openai-main', 'gpt-4o-mini']));
    expect(result.success).toBe(false); expect(config.modelExecution).toBeNull();
    expect(createAgent).toHaveBeenCalledTimes(2); expect(save).not.toHaveBeenCalled();
  });
});
