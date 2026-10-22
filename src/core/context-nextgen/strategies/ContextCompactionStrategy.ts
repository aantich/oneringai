import { InvalidConfigError } from '../../../domain/errors/AIErrors.js';
import type { CompactionContext, CompactionResult, ConsolidationResult, ICompactionStrategy } from '../types.js';
import type { ContextCompactionStrategyConfig } from '../compaction/types.js';
import { COMPOSITION_OPERATION, type CompositionOperation } from '../compaction/types.js';
export type { ContextCompactionStrategyConfig, NativeHistoryCompactionConfig, ContextCompactionReport } from '../compaction/types.js';
const COMPOSITION_POLICY = Symbol.for('@everworker/oneringai/context-composition-policy/v1');

/** @internal Works when a consumer combines the public ESM and CJS package surfaces. */
export function isContextCompactionStrategy(value: ICompactionStrategy): value is ContextCompactionStrategy {
  return (value as unknown as Record<symbol, unknown>)[COMPOSITION_POLICY] === true;
}

/** Explicit plugin-content reduction and native history through the existing strategy API. */
export class ContextCompactionStrategy implements ICompactionStrategy {
  readonly name = 'context-compaction';
  readonly displayName = 'Plugin and history compaction';
  readonly description = 'Compose plugin-owned reductions and provider-native history without replacing context plugins.';
  readonly threshold = .75;
  readonly requiredPlugins: readonly string[];
  readonly config: Readonly<ContextCompactionStrategyConfig>;
  constructor(config: ContextCompactionStrategyConfig) {
    if (!config || !['auto', 'off'].includes(config.plugins)
      || (config.history !== 'off' && config.history !== 'native' && (!config.history || config.history.mode !== 'native'))
      || (config.automatic !== undefined && typeof config.automatic !== 'boolean')) throw new InvalidConfigError('Invalid plugin/history compaction policy');
    const turns = typeof config.history === 'object' ? config.history.preserveRecentTurns : undefined;
    if (turns !== undefined && (!Number.isSafeInteger(turns) || turns < 0)) throw new InvalidConfigError('preserveRecentTurns must be a nonnegative safe integer');
    this.config = Object.freeze({ plugins: config.plugins, history: typeof config.history === 'object' ? Object.freeze({ ...config.history }) : config.history,
      automatic: config.automatic ?? true });
    this.requiredPlugins = Object.freeze(config.history === 'off' ? [] : ['evidence']);
    Object.defineProperty(this, COMPOSITION_POLICY, { value: true });
  }
  async compact(context: CompactionContext, _targetToFree: number): Promise<CompactionResult> {
    const operation = (context as CompactionContext & { [COMPOSITION_OPERATION]?: CompositionOperation })[COMPOSITION_OPERATION];
    if (!operation) throw new InvalidConfigError('ContextCompactionStrategy requires transactional NextGen context');
    return operation(this.config);
  }
  async consolidate(_context: CompactionContext): Promise<ConsolidationResult> {
    return { performed: false, tokensChanged: 0, actions: ['Composition runs at the bounded preparation boundary.'] };
  }
}
