import { Agent, AgentContextNextGen, FileEvidenceStorage, ObservationMaskingStrategy, StructuredSummaryStrategy, StrategyRegistry } from '@everworker/oneringai';
import type { CompactionContext, CompactionResult, ContextPrepareOptions, ContextSummaryGenerator, ConversationCompactionReport, ICompactionStrategy } from '@everworker/oneringai';
const storage = new FileEvidenceStorage({ directory: '/tmp/consumer-evidence', scope: { ownerId: 'host-user', namespace: 'consumer' } });
export const masking: ICompactionStrategy = new ObservationMaskingStrategy({ preserveRecentTurns: 2 });
export const summaries: ICompactionStrategy = new StructuredSummaryStrategy({ maxSummaryTokens: 1024, fallback: 'mask' });
export const legacyResult: CompactionResult = { tokensFreed: 0, messagesRemoved: 0, pluginsCompacted: [], log: [] };
export const generator: ContextSummaryGenerator = async request => ({ summary: { completedWork: [{ text: 'Source retained.', sourceIds: [request.reference.id] }], activeWork: [], constraints: [], decisions: [], uncertainties: [], artifacts: [], actionReceipts: [] } });
export const options: ContextPrepareOptions = { summarize: generator, signal: new AbortController().signal };
export function legacyContextCapabilityRemainsOptional(context: CompactionContext): void { void context.compactConversation; }
export function createOptInConsumer() {
  return Agent.create({ connector: 'main', model: 'gpt-4o', userId: 'host-user', modelExecution: { helpers: { compactor: { connector: 'helper', model: 'gpt-4o-mini', allowContextTransfer: true } } }, context: { model: 'gpt-4o', features: { evidence: true }, plugins: { evidence: { storage } }, compactionStrategy: summaries } });
}
export async function standalone(): Promise<ConversationCompactionReport | undefined> {
  const context = AgentContextNextGen.create({ model: 'gpt-4o', features: { evidence: true }, plugins: { evidence: { storage } }, compactionStrategy: StrategyRegistry.create('structured-summary') });
  try { await context.prepare(options); return context.lastPreparation?.compaction; } finally { context.destroy(); }
}
