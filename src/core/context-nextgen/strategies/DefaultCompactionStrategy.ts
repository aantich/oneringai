/**
 * DefaultCompactionStrategy - Standard compaction behavior
 *
 * Implements the default compaction strategy:
 * - compact(): Plugins first (by priority), then conversation history
 * - consolidate(): No-op for now (returns performed: false)
 *
 * This strategy preserves the original AgentContextNextGen behavior.
 */

import { removableMessageGroups } from '../tool-pairs.js';
import type {
  ICompactionStrategy,
  CompactionContext,
  CompactionResult,
  ConsolidationResult,
} from '../types.js';

/**
 * Default threshold (70%)
 */
const DEFAULT_THRESHOLD = 0.70;

/**
 * Configuration for DefaultCompactionStrategy
 */
export interface DefaultCompactionStrategyConfig {
  /** Custom threshold (default: 0.70 = 70%) */
  threshold?: number;
}

/**
 * Default compaction strategy.
 *
 * Behavior:
 * - compact(): First compacts plugins (in_context_memory first, then working_memory),
 *   then removes oldest messages from conversation while preserving tool pairs.
 * - consolidate(): No-op - returns performed: false
 *
 * This strategy is fast and suitable for most use cases.
 * Default threshold is 70%.
 */
export class DefaultCompactionStrategy implements ICompactionStrategy {
  readonly name = 'default';
  readonly displayName = 'Dumb';
  readonly description = 'Do not use';
  readonly threshold: number;

  constructor(config?: DefaultCompactionStrategyConfig) {
    this.threshold = config?.threshold ?? DEFAULT_THRESHOLD;
  }

  /**
   * Emergency compaction when thresholds exceeded.
   *
   * Strategy:
   * 1. Compact plugins first (in_context_memory, then working_memory)
   * 2. If still needed, remove oldest conversation messages (preserving tool pairs)
   */
  async compact(context: CompactionContext, targetToFree: number): Promise<CompactionResult> {
    const log: string[] = [];
    const pluginsCompacted: string[] = [];
    let tokensFreed = 0;
    let messagesRemoved = 0;
    let remaining = targetToFree;

    log.push(`Compaction started: need to free ~${targetToFree} tokens`);

    // Step 1: Compact plugins (in order of priority - most expendable first)
    const compactablePlugins = [...context.plugins]
      .filter(p => p.isCompactable())
      .sort((a, b) => {
        // InContextMemory first, then WorkingMemory
        const order: Record<string, number> = {
          'in_context_memory': 1,
          'working_memory': 2,
        };
        return (order[a.name] ?? 10) - (order[b.name] ?? 10);
      });

    for (const plugin of compactablePlugins) {
      if (remaining <= 0) break;

      const freed = await context.compactPlugin(plugin.name, remaining);
      if (freed > 0) {
        tokensFreed += freed;
        remaining -= freed;
        pluginsCompacted.push(plugin.name);
        log.push(`Compacted ${plugin.name}: freed ~${freed} tokens`);
      }
    }

    // Step 2: Compact conversation if still needed
    if (remaining > 0 && context.conversation.length > 0) {
      const conversationResult = await this.compactConversation(context, remaining, log);
      tokensFreed += conversationResult.tokensFreed;
      messagesRemoved = conversationResult.messagesRemoved;
      remaining -= conversationResult.tokensFreed;
    }

    log.push(`Compaction complete: freed ~${tokensFreed} tokens total`);

    return {
      tokensFreed,
      messagesRemoved,
      pluginsCompacted,
      log,
    };
  }

  /**
   * Post-cycle consolidation.
   *
   * Default strategy does nothing - override in subclasses for:
   * - Conversation summarization
   * - Memory deduplication
   * - Data promotion to persistent storage
   */
  async consolidate(_context: CompactionContext): Promise<ConsolidationResult> {
    // Default: no consolidation
    return {
      performed: false,
      tokensChanged: 0,
      actions: [],
    };
  }

  /**
   * Compact conversation by removing oldest messages.
   * Preserves tool pairs (tool_use + tool_result).
   */
  private async compactConversation(
    context: CompactionContext,
    targetToFree: number,
    log: string[]
  ): Promise<{ tokensFreed: number; messagesRemoved: number }> {
    const conversation = context.conversation;
    if (conversation.length === 0) {
      return { tokensFreed: 0, messagesRemoved: 0 };
    }

    let tokensFreed = 0;
    const indicesToRemove: number[] = [];
    // Oldest-first policy stays intact, with one shared protocol grouping rule.
    for (const group of removableMessageGroups(conversation, context.currentInput)) {
      if (tokensFreed >= targetToFree) break;
      indicesToRemove.push(...group);
      tokensFreed += group.reduce((sum, index) => sum + context.estimateTokens(conversation[index]!), 0);
    }
    if (indicesToRemove.length > 0) {
      tokensFreed = await context.removeMessages(indicesToRemove);
      log.push(`Removed ${indicesToRemove.length} messages from conversation: freed ~${tokensFreed} tokens`);
    }

    return {
      tokensFreed,
      messagesRemoved: indicesToRemove.length,
    };
  }

}
