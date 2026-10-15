/**
 * Compaction Strategies
 *
 * Pluggable strategies for context compaction and consolidation.
 */

export {
  DefaultCompactionStrategy,
  type DefaultCompactionStrategyConfig,
} from './DefaultCompactionStrategy.js';

export {
  AlgorithmicCompactionStrategy,
  type AlgorithmicCompactionStrategyConfig,
} from './AlgorithmicCompactionStrategy.js';

export {
  StrategyRegistry,
  type StrategyClass,
  type StrategyInfo,
  type StrategyRegistryEntry,
  type StrategyRegisterOptions,
} from './StrategyRegistry.js';

export { ObservationMaskingStrategy } from './ObservationMaskingStrategy.js';
export { StructuredSummaryStrategy } from './StructuredSummaryStrategy.js';
export type { ObservationMaskingStrategyConfig, StructuredSummaryStrategyConfig, StructuredContextSummary,
  ContextSummaryEntry, ContextSummaryRequest, ContextSummaryGenerator, ConversationCompactionReport,
  ConversationCompactionOptions } from './conversation-compaction.js';
