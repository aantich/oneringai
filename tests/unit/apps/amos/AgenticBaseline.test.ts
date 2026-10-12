import { describe, expect, it } from 'vitest';
import { ContextCommand } from '../../../../apps/amos/src/commands/commands/ContextCommand.js';
import type { CommandContext, IAgentRunner, IAmosApp } from '../../../../apps/amos/src/config/types.js';

describe('AMOS pre-evolution inspection baseline', () => {
  const command = new ContextCommand();
  function context(args: string[], ready = true): CommandContext {
    const agent = {
      isReady: () => ready,
      getContextBudget: async () => ({ used: 100, available: 900, utilizationPercent: 10, status: 'ok' }),
      getContextMetrics: async () => ({ mode: 'conversational', hasPlan: false }),
      getCacheStats: async () => null,
    } as unknown as IAgentRunner;
    const app = { getAgent: () => agent } as unknown as IAmosApp;
    return { app, args, rawInput: `/context ${args.join(' ')}`.trim() };
  }

  it('preserves command names, subcommands, and rendered overview fields', async () => {
    expect(command.name).toBe('context');
    expect(command.aliases).toContain('ctx');
    expect(command.detailedHelp).toContain('/context history [n]');
    const result = await command.execute(context([]));
    expect(result.success).toBe(true);
    expect(result.message).toBe([
      'Context Overview', '────────────────────────────────────',
      'Utilization: █░░░░░░░░░ 10% (ok)', 'Tokens: 100 / 1,000 available', '',
      'Status: ✅  OK', 'Mode: 💬 conversational', '',
      'Use /context budget for detailed budget', 'Use /context breakdown for token breakdown',
    ].join('\n'));
  });

  it('does not claim cache statistics when the library does not expose them', async () => {
    const result = await command.execute(context(['cache']));
    expect(result.success).toBe(true);
    expect(result.message).toContain('The OneRingAI Agent API does not expose tool-cache statistics.');
  });

  it('keeps unavailable-agent and unsupported-subcommand diagnostics', async () => {
    expect((await command.execute(context([], false))).message).toContain('Agent not initialized');
    const result = await command.execute(context(['made-up']));
    expect(result.success).toBe(false);
    expect(result.message).toContain('Unknown subcommand: made-up');
  });
});
