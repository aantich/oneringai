import type { CompactionContext, CompactionResult, ConsolidationResult, ICompactionStrategy } from '../types.js';
import { validateCompactionConfig } from './conversation-compaction.js';
import type { ObservationMaskingStrategyConfig } from './conversation-compaction.js';
export type { ObservationMaskingStrategyConfig } from './conversation-compaction.js';

/** Opt-in observation masking; retains exact calls, receipts and recoverable sources. */
export class ObservationMaskingStrategy implements ICompactionStrategy {
  readonly name = 'observation-masking';
  readonly displayName = 'Observation masking';
  readonly description = 'Retain exact actions and user messages; replace older observation bodies with evidence references. No helper model.';
  readonly requiredPlugins = ['evidence'] as const;
  readonly threshold: number;
  private readonly config: ObservationMaskingStrategyConfig;
  constructor(config: ObservationMaskingStrategyConfig = {}) {
    validateCompactionConfig(config); this.config = { ...config }; this.threshold = config.threshold ?? 0.75;
  }
  async compact(context: CompactionContext, _targetToFree: number): Promise<CompactionResult> {
    if (!context.compactConversation) throw new Error('Observation masking requires transactional context preparation');
    return context.compactConversation({ ...this.config, mode: 'observation-masking' });
  }
  async consolidate(_context: CompactionContext): Promise<ConsolidationResult> {
    return { performed: false, tokensChanged: 0, actions: ['Observation masking runs only during pre-call preparation.'] };
  }
}
