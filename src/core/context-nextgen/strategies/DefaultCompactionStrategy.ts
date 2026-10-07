/**
 * DefaultCompactionStrategy - Standard compaction behavior
 *
 * Implements the default compaction strategy:
 * - compact(): Plugins first (by priority), then conversation history
 * - consolidate(): No-op for now (returns performed: false)
 *
 * This strategy preserves the original AgentContextNextGen behavior.
 */

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

    // Find tool pairs (tool_use_id -> indices)
    const toolPairs = this.findToolPairs(conversation);

    // Build set of indices that are part of pairs
    const inPair = new Set<number>();
    for (const indices of toolPairs.values()) {
      for (const idx of indices) {
        inPair.add(idx);
      }
    }

    // Find safe indices to remove (from oldest first)
    const safeToRemove: number[] = [];

    // First pass: find messages not in pairs
    for (let i = 0; i < conversation.length; i++) {
      if (!inPair.has(i)) {
        safeToRemove.push(i);
      }
    }

    // Second pass: add complete pairs (both tool_use and tool_result present)
    for (const [, indices] of toolPairs) {
      if (indices.length >= 2) {
        for (const idx of indices) {
          if (!safeToRemove.includes(idx)) {
            safeToRemove.push(idx);
          }
        }
      }
    }

    // Sort by index (oldest first)
    safeToRemove.sort((a, b) => a - b);

    // Remove messages until we've freed enough tokens
    let tokensFreed = 0;
    const indicesToRemove: number[] = [];

    for (const idx of safeToRemove) {
      if (tokensFreed >= targetToFree) break;

      const item = conversation[idx];
      if (!item) continue;

      // Check if this message is part of a tool pair
      const pairComponent = this.getToolPairComponent(idx, conversation, toolPairs);
      if (pairComponent) {
        // Remove the entire connected component. A single assistant message
        // may contain several tool calls whose results live in separate
        // messages; removing only the first pair would orphan the others.
        for (const pairIdx of pairComponent) {
          if (!indicesToRemove.includes(pairIdx)) {
            indicesToRemove.push(pairIdx);
            const pairItem = conversation[pairIdx];
            if (pairItem) {
              tokensFreed += context.estimateTokens(pairItem);
            }
          }
        }
        continue;
      }

      // Not part of a pair, remove single message
      if (!indicesToRemove.includes(idx)) {
        indicesToRemove.push(idx);
        tokensFreed += context.estimateTokens(item);
      }
    }

    // Actually remove the messages
    if (indicesToRemove.length > 0) {
      await context.removeMessages(indicesToRemove);
      log.push(`Removed ${indicesToRemove.length} messages from conversation: freed ~${tokensFreed} tokens`);
    }

    return {
      tokensFreed,
      messagesRemoved: indicesToRemove.length,
    };
  }

  /**
   * Find tool_use/tool_result pairs in conversation.
   * Returns Map<tool_use_id, array of message indices>.
   */
  private findToolPairs(conversation: ReadonlyArray<unknown>): Map<string, number[]> {
    const pairs = new Map<string, number[]>();

    for (let i = 0; i < conversation.length; i++) {
      const item = conversation[i] as Record<string, unknown>;
      if (item?.type !== 'message') continue;

      const content = item.content as Array<Record<string, unknown>> | undefined;
      if (!content) continue;

      for (const c of content) {
        if (c.type === 'tool_use' || c.type === 'custom_tool_use') {
          const toolUseId = c.id as string;
          if (toolUseId) {
            const existing = pairs.get(toolUseId) ?? [];
            existing.push(i);
            pairs.set(toolUseId, existing);
          }
        } else if (c.type === 'tool_result' || c.type === 'custom_tool_result') {
          const toolUseId = c.tool_use_id as string;
          if (toolUseId) {
            const existing = pairs.get(toolUseId) ?? [];
            existing.push(i);
            pairs.set(toolUseId, existing);
          }
        }
      }
    }

    return pairs;
  }

  /** Get every function/custom tool ID referenced by one message. */
  private getToolUseIds(item: unknown): string[] {
    const msg = item as Record<string, unknown>;
    if (msg?.type !== 'message') return [];

    const content = msg.content as Array<Record<string, unknown>> | undefined;
    if (!content) return [];

    const ids: string[] = [];
    for (const c of content) {
      if (c.type === 'tool_use' || c.type === 'custom_tool_use') {
        if (typeof c.id === 'string') ids.push(c.id);
      } else if (c.type === 'tool_result' || c.type === 'custom_tool_result') {
        if (typeof c.tool_use_id === 'string') ids.push(c.tool_use_id);
      }
    }
    return ids;
  }

  /**
   * Return every message connected to a complete tool pair at `startIndex`.
   * Returns null for non-tool messages or components containing an orphan.
   */
  private getToolPairComponent(
    startIndex: number,
    conversation: ReadonlyArray<unknown>,
    toolPairs: Map<string, number[]>,
  ): number[] | null {
    const pending = [startIndex];
    const component = new Set<number>();
    let containsTool = false;

    while (pending.length > 0) {
      const index = pending.pop()!;
      if (component.has(index)) continue;
      component.add(index);
      const item = conversation[index];
      if (!item) continue;
      for (const id of this.getToolUseIds(item)) {
        containsTool = true;
        const pairIndices = toolPairs.get(id);
        if (!pairIndices || pairIndices.length < 2) return null;
        for (const pairIndex of pairIndices) {
          if (!component.has(pairIndex)) pending.push(pairIndex);
        }
      }
    }

    return containsTool ? [...component] : null;
  }
}
