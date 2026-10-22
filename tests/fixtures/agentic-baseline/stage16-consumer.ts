import { Agent, ContextCompactionStrategy } from '@everworker/oneringai';
import type { ContextCompactionStrategyConfig, ContextCompactionReport, AgentContextCompactionOptions,
  ITextProvider, ICompactionStrategy, CompactionContext, NativeContinuationSnapshot } from '@everworker/oneringai';
import type { ContextCompactionTarget } from '@everworker/oneringai/types';

export const config: ContextCompactionStrategyConfig = { plugins: 'auto', history: { mode: 'native', preserveRecentTurns: 2 }, automatic: false };
export const strategy: ICompactionStrategy = new ContextCompactionStrategy(config);
export async function compact(agent: Agent, target: ContextCompactionTarget): Promise<ContextCompactionReport> {
  const options: AgentContextCompactionOptions = { target, checkpoint: false };
  return agent.compactContext(options);
}
// Old implementations with an unrelated same-named method remain structurally valid.
export function legacyContext(context: CompactionContext): CompactionContext {
  const old = { ...context, compactContext: (_oldShape: string): number => 42 };
  return old;
}
export const oldProvider: Pick<ITextProvider, 'name'> = { name: 'legacy' };
export function optionalNativeState(agent: Agent): NativeContinuationSnapshot | undefined { return agent.context.getState().nativeContinuation; }
