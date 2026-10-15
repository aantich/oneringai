import type { CompactionContext, CompactionResult, ConsolidationResult, ICompactionStrategy } from '../types.js';
import { validateCompactionConfig } from './conversation-compaction.js';
import type { StructuredSummaryStrategyConfig } from './conversation-compaction.js';
export type { StructuredSummaryStrategyConfig } from './conversation-compaction.js';

/** Opt-in bounded summaries with exact user/action retention and one masking fallback. */
export class StructuredSummaryStrategy implements ICompactionStrategy {
  readonly name = 'structured-summary';
  readonly displayName = 'Structured summary';
  readonly description = 'Summarize older assistant narrative and observations with a bounded compactor; retain exact user messages and action receipts.';
  readonly requiredPlugins = ['evidence'] as const;
  readonly threshold: number;
  private readonly config: StructuredSummaryStrategyConfig;
  constructor(config: StructuredSummaryStrategyConfig = {}) {
    validateCompactionConfig(config); this.config = { ...config }; this.threshold = config.threshold ?? 0.75;
  }
  async compact(context: CompactionContext, _targetToFree: number): Promise<CompactionResult> {
    if (!context.compactConversation) throw new Error('Structured summaries require transactional context preparation');
    return context.compactConversation({ ...this.config, mode: 'structured-summary' });
  }
  async consolidate(_context: CompactionContext): Promise<ConsolidationResult> {
    return { performed: false, tokensChanged: 0, actions: ['Structured summaries run only during pre-call preparation.'] };
  }
}
