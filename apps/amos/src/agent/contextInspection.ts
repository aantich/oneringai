import type { AgentContextNextGen } from '@everworker/oneringai';
import type { ContextBudgetInfo, ContextBreakdownInfo } from '../config/types.js';

/** Read one diagnostic revision without triggering another preparation/compaction. */
export async function inspectContext(context: AgentContextNextGen): Promise<{
  budget: ContextBudgetInfo; breakdown: ContextBreakdownInfo;
}> {
  const prepared = context.lastPreparation;
  const budget = prepared?.budget ?? await context.calculateBudget();
  const metadata = {
    source: prepared ? 'prepared' as const : 'estimate' as const,
    ...(prepared ? { revision: prepared.revision, preparedAt: prepared.preparedAt } : {}),
  };
  const flat: Record<string, number> = {
    systemPrompt: budget.breakdown.systemPrompt,
    persistentInstructions: budget.breakdown.persistentInstructions,
    pluginInstructions: budget.breakdown.pluginInstructions,
    tools: budget.toolsTokens,
    conversation: budget.conversationTokens,
    currentInput: budget.currentInputTokens,
    ...Object.fromEntries(Object.entries(budget.breakdown.pluginContents).map(([name, tokens]) => [`plugin:${name}`, tokens])),
  };
  // Wrappers, date/time, message overhead and independent estimator rounding.
  flat.systemOverhead = budget.totalUsed - Object.values(flat).reduce((sum, tokens) => sum + tokens, 0);
  const used = budget.providerCountedInputTokens ?? budget.totalUsed;
  const utilization = budget.providerCountedInputTokens === undefined ? budget.utilizationPercent : used / (budget.maxTokens - budget.responseReserve) * 100;
  return {
    budget: { ...metadata, ...(budget.providerCountedInputTokens === undefined ? {} : { accounting: 'provider' as const }), total: budget.maxTokens, reserved: budget.responseReserve, used,
      available: Math.max(0, budget.providerCountedInputTokens === undefined ? budget.available : budget.maxTokens - budget.responseReserve - used), utilizationPercent: utilization,
      status: utilization >= 90 ? 'critical' : utilization >= 75 ? 'warning' : 'ok' },
    breakdown: { ...metadata, ...(budget.providerCountedInputTokens === undefined ? {} : { providerCountedInputTokens: budget.providerCountedInputTokens }),
      ...(prepared?.selection ? { selection: prepared.selection } : {}), totalUsed: budget.totalUsed, components: Object.entries(flat)
      .filter(([, tokens]) => tokens !== 0)
      .map(([name, tokens]) => ({ name, tokens, percent: budget.totalUsed > 0 ? tokens / budget.totalUsed * 100 : 0 }))
      .sort((a, b) => b.tokens - a.tokens) },
  };
}
