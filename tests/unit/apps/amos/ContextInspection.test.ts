import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentContextNextGen } from '@/core/context-nextgen/AgentContextNextGen.js';
import { inspectContext } from '../../../../apps/amos/src/agent/contextInspection.js';
import { ContextCommand } from '../../../../apps/amos/src/commands/commands/ContextCommand.js';
import type { CommandContext, IAgentRunner, IAmosApp } from '../../../../apps/amos/src/config/types.js';

const contexts: AgentContextNextGen[] = [];
afterEach(() => contexts.splice(0).forEach(context => context.destroy()));
function create() {
  const ctx = AgentContextNextGen.create({ model: 'gpt-4o-mini', maxContextTokens: 3000, responseReserve: 100,
    features: { workingMemory: false, inContextMemory: false } });
  contexts.push(ctx); return ctx;
}
function commandContext(ctx: AgentContextNextGen, subcommand: string): CommandContext {
  const runner = { isReady: () => true, getContextBudget: async () => (await inspectContext(ctx)).budget,
    getContextBreakdown: async () => (await inspectContext(ctx)).breakdown } as unknown as IAgentRunner;
  return { app: { getAgent: () => runner } as unknown as IAmosApp, args: [subcommand], rawInput: `/context ${subcommand}` };
}
describe('AMOS prepared context inspection', () => {
  it('labels an estimate before any request is prepared', async () => {
    const ctx = create(); ctx.addUserMessage('hello');
    const snapshot = await inspectContext(ctx);
    expect(snapshot.budget.source).toBe('estimate');
    expect(snapshot.budget.revision).toBeUndefined();
    expect(ctx.lastPreparation).toBeNull();
    const command = new ContextCommand();
    for (const subcommand of ['budget', 'breakdown']) {
      expect((await command.execute(commandContext(ctx, subcommand))).message).toContain('Estimate before first preparation');
    }
  });
  it('reads the last selected revision without recalculation or another compaction', async () => {
    const ctx = create(); ctx.addUserMessage('selected'); await ctx.prepare();
    const calculate = vi.spyOn(ctx, 'calculateBudget');
    const preparation = vi.spyOn(ctx, 'prepare');
    ctx.addUserMessage('later state that has not been prepared');
    const snapshot = await inspectContext(ctx);
    expect(snapshot.budget.source).toBe('prepared');
    expect(snapshot.budget.revision).toBe(1);
    expect(snapshot.budget.used).toBe(ctx.lastPreparation!.budget.totalUsed);
    expect(calculate).not.toHaveBeenCalled();
    expect(preparation).not.toHaveBeenCalled();
    for (const subcommand of ['budget', 'breakdown']) {
      const output = (await new ContextCommand().execute(commandContext(ctx, subcommand))).message;
      expect(output).toContain('Last prepared revision: 1');
      expect(output).toContain('estimated tokens, not provider usage');
    }
  });
  it('accounts for overhead so breakdown components sum to the displayed total', async () => {
    const ctx = create(); ctx.systemPrompt = 'system'; ctx.addUserMessage('hello'); await ctx.prepare();
    const snapshot = await inspectContext(ctx);
    expect(snapshot.breakdown.components.some(component => component.name === 'systemOverhead')).toBe(true);
    expect(snapshot.breakdown.components.reduce((sum, component) => sum + component.tokens, 0)).toBe(snapshot.budget.used);
    expect(snapshot.breakdown.components.reduce((sum, component) => sum + component.percent, 0)).toBeCloseTo(100);
  });
  it('displays the selected provider capacity and known schema contribution', async () => {
    const ctx = create(); ctx.addUserMessage('hello');
    await ctx.prepare({ modelMaxContextTokens: 1000, getRequestOptions: () => ({ response_format: {
      type: 'json_schema', json_schema: { name: 'inspection', schema: { type: 'object', description: 'schema '.repeat(50) } },
    } }) });
    const snapshot = await inspectContext(ctx);
    expect(snapshot.budget.total).toBe(1000); expect(ctx.maxContextTokens).toBe(3000);
    expect(snapshot.breakdown.components.find(component => component.name === 'tools')!.tokens).toBeGreaterThan(100);
    const selected = ctx.lastPreparation; const prepare = vi.spyOn(ctx, 'prepare');
    const output = await new ContextCommand().execute(commandContext(ctx, 'budget'));
    expect(output.success).toBe(true); expect(output.message).toContain('1,000');
    expect(prepare).not.toHaveBeenCalled(); expect(ctx.lastPreparation).toEqual(selected);
  });
});
