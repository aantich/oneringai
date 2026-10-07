/**
 * AlgorithmicCompactionStrategy - Intelligent tool result management
 *
 * This strategy:
 * 1. Moves large tool results to Working Memory (preserving them for later retrieval)
 * 2. Limits the number of tool pairs in conversation
 * 3. Applies rolling window compaction for remaining messages
 *
 * Requires the working_memory plugin to be enabled.
 */

import type {
  ICompactionStrategy,
  CompactionContext,
  CompactionResult,
  ConsolidationResult,
} from '../types.js';
import type { WorkingMemoryPluginNextGen } from '../plugins/WorkingMemoryPluginNextGen.js';

/**
 * Default threshold (75%)
 */
const DEFAULT_THRESHOLD = 0.75;

/**
 * Default size threshold for moving tool results to memory (1KB)
 */
const DEFAULT_TOOL_RESULT_SIZE_THRESHOLD = 1024;

/**
 * Default maximum number of tool pairs to keep in conversation
 */
const DEFAULT_MAX_TOOL_PAIRS = 10;

/**
 * Configuration for AlgorithmicCompactionStrategy
 */
export interface AlgorithmicCompactionStrategyConfig {
  /** Custom threshold (default: 0.75 = 75%) */
  threshold?: number;

  /** Size threshold in bytes for moving tool results to memory (default: 1024 = 1KB) */
  toolResultSizeThreshold?: number;

  /** Maximum number of tool pairs to keep in conversation (default: 10) */
  maxToolPairs?: number;
}

/**
 * Represents a matched tool_use/tool_result pair in conversation
 */
interface ToolPair {
  /** Index of message containing tool_use */
  toolUseIndex: number;

  /** Index of message containing tool_result */
  toolResultIndex: number;

  /** The tool_use_id that links the pair */
  toolUseId: string;

  /** Name of the tool */
  toolName: string;

  /** Arguments passed to the tool */
  toolArgs: unknown;

  /** Content of the tool result */
  resultContent: unknown;

  /** Size of the result in bytes */
  resultSizeBytes: number;
}

/**
 * Algorithmic compaction strategy.
 *
 * Behavior:
 * - consolidate(): Moves large tool results to Working Memory, limits tool pairs
 * - compact(): Runs consolidate() first, then applies rolling window
 *
 * This strategy is ideal for agents that make many tool calls with potentially
 * large results (file reads, API responses, etc.).
 */
export class AlgorithmicCompactionStrategy implements ICompactionStrategy {
  readonly name = 'algorithmic';
  readonly displayName = 'Algorithmic';
  readonly description =
    'Moves large tool results to working memory, limits tool pairs, applies rolling window. Ideal for tool-heavy agents.';
  readonly threshold: number;
  readonly requiredPlugins = ['working_memory'] as const;

  private readonly toolResultSizeThreshold: number;
  private readonly maxToolPairs: number;

  constructor(config?: AlgorithmicCompactionStrategyConfig) {
    this.threshold = config?.threshold ?? DEFAULT_THRESHOLD;
    this.toolResultSizeThreshold = config?.toolResultSizeThreshold ?? DEFAULT_TOOL_RESULT_SIZE_THRESHOLD;
    this.maxToolPairs = config?.maxToolPairs ?? DEFAULT_MAX_TOOL_PAIRS;
  }

  /**
   * Emergency compaction when context exceeds threshold.
   *
   * Strategy:
   * 1. Run consolidate() first to move tool results to memory (if working memory available)
   * 2. If still need space, apply rolling window (remove oldest messages)
   *
   * Gracefully degrades: if working memory plugin is not registered,
   * skips step 1 and only uses rolling window compaction.
   */
  async compact(context: CompactionContext, targetToFree: number): Promise<CompactionResult> {
    const log: string[] = [];
    let tokensFreed = 0;
    let messagesRemoved = 0;
    const pluginsCompacted: string[] = [];

    log.push(`Algorithmic compaction started: need to free ~${targetToFree} tokens`);

    // 1. Run consolidate first to move large tool results to memory (if available)
    const consolidateResult = await this.consolidate(context);
    if (consolidateResult.performed) {
      tokensFreed += Math.abs(consolidateResult.tokensChanged);
      log.push(...consolidateResult.actions);
    }

    // 2. If still need more space, apply rolling window
    const remaining = targetToFree - tokensFreed;
    if (remaining > 0 && context.conversation.length > 0) {
      log.push(`Rolling window: need to free ~${remaining} more tokens`);
      const result = await this.applyRollingWindow(context, remaining, log);
      tokensFreed += result.tokensFreed;
      messagesRemoved = result.messagesRemoved;
    }

    log.push(`Algorithmic compaction complete: freed ~${tokensFreed} tokens total`);

    return { tokensFreed, messagesRemoved, pluginsCompacted, log };
  }

  /**
   * Post-cycle consolidation.
   *
   * 1. Find all tool pairs in conversation
   * 2. Move large tool results (> threshold) to Working Memory (if available)
   * 3. Limit remaining tool pairs to maxToolPairs
   *
   * Gracefully degrades: if working memory is not available, skips step 2
   * and only limits tool pairs + removes excess via rolling window.
   */
  async consolidate(context: CompactionContext): Promise<ConsolidationResult> {
    const log: string[] = [];
    let tokensChanged = 0;

    const memory = this.getWorkingMemory(context);
    const toolPairs = this.findToolPairs(context.conversation);

    if (toolPairs.length === 0) {
      return { performed: false, tokensChanged: 0, actions: [] };
    }

    const indicesToRemove: number[] = [];
    const storedToolUseIds = new Set<string>();

    // 1. Move large results to memory (only if working memory is available)
    if (memory) {
      for (const pair of toolPairs) {
        if (pair.resultSizeBytes > this.toolResultSizeThreshold) {
          const key = this.generateKey(pair.toolName, pair.toolUseId);
          const desc = this.generateDescription(pair.toolName, pair.toolArgs, context);

          await memory.store(key, desc, pair.resultContent, {
            tier: 'raw',
            priority: 'normal',
          });
          storedToolUseIds.add(pair.toolUseId);

          // Mark both messages for removal
          if (!indicesToRemove.includes(pair.toolUseIndex)) {
            indicesToRemove.push(pair.toolUseIndex);
          }
          if (!indicesToRemove.includes(pair.toolResultIndex)) {
            indicesToRemove.push(pair.toolResultIndex);
          }

          log.push(
            `Moved ${pair.toolName} result (${this.formatBytes(pair.resultSizeBytes)}) to memory: ${key}`
          );
        }
      }
    }

    // 2. Limit remaining tool pairs
    const remainingPairs = toolPairs.filter(
      p => !indicesToRemove.includes(p.toolUseIndex) && !indicesToRemove.includes(p.toolResultIndex)
    );

    if (remainingPairs.length > this.maxToolPairs) {
      // Age-based eviction — oldest pairs first. When working memory is
      // available, spill the content there before dropping the pair from
      // context so the agent can still retrieve it via memory lookup.
      // Without WM, we drop to stay under the pair cap; this is the only
      // place in the path where content is genuinely unrecoverable, and it
      // requires the host to deliberately disable WM.
      const toRemove = remainingPairs.slice(0, remainingPairs.length - this.maxToolPairs);
      for (const pair of toRemove) {
        if (memory) {
          const key = this.generateKey(pair.toolName, pair.toolUseId);
          const desc = this.generateDescription(pair.toolName, pair.toolArgs, context);
          await memory.store(key, desc, pair.resultContent, {
            tier: 'raw',
            priority: 'low',
          });
          storedToolUseIds.add(pair.toolUseId);
          log.push(
            `Spilled aged tool pair to memory: ${pair.toolName} → ${key} (exceeds ${this.maxToolPairs} pair limit)`,
          );
        } else {
          log.push(
            `Dropped aged tool pair: ${pair.toolName} (exceeds ${this.maxToolPairs} pair limit, no working memory available)`,
          );
        }
        if (!indicesToRemove.includes(pair.toolUseIndex)) {
          indicesToRemove.push(pair.toolUseIndex);
        }
        if (!indicesToRemove.includes(pair.toolResultIndex)) {
          indicesToRemove.push(pair.toolResultIndex);
        }
      }
    }

    // A message may contain several tool calls, while their results can live
    // in separate messages. Expand every selected pair to its whole connected
    // component so removing one pair never strands (or silently sanitizes)
    // another result. Preserve any newly pulled-in results in memory too.
    let expanded = true;
    while (expanded) {
      expanded = false;
      for (const pair of toolPairs) {
        const intersects = indicesToRemove.includes(pair.toolUseIndex)
          || indicesToRemove.includes(pair.toolResultIndex);
        if (!intersects) continue;
        if (memory && !storedToolUseIds.has(pair.toolUseId)) {
          const key = this.generateKey(pair.toolName, pair.toolUseId);
          const desc = this.generateDescription(pair.toolName, pair.toolArgs, context);
          await memory.store(key, desc, pair.resultContent, {
            tier: 'raw',
            priority: 'low',
          });
          storedToolUseIds.add(pair.toolUseId);
          log.push(`Spilled connected tool pair to memory: ${pair.toolName} → ${key}`);
        }
        for (const index of [pair.toolUseIndex, pair.toolResultIndex]) {
          if (!indicesToRemove.includes(index)) {
            indicesToRemove.push(index);
            expanded = true;
          }
        }
      }
    }

    // 3. Remove all marked messages
    if (indicesToRemove.length > 0) {
      tokensChanged = -(await context.removeMessages(indicesToRemove));
      log.push(`Removed ${indicesToRemove.length} messages, freed ~${Math.abs(tokensChanged)} tokens`);
    }

    return {
      performed: indicesToRemove.length > 0,
      tokensChanged,
      actions: log,
    };
  }

  /**
   * Get the Working Memory plugin from context, or null if not available.
   * When null, the strategy degrades gracefully (skips memory operations).
   */
  private getWorkingMemory(context: CompactionContext): WorkingMemoryPluginNextGen | null {
    const plugin = context.plugins.find(p => p.name === 'working_memory');
    return plugin ? (plugin as WorkingMemoryPluginNextGen) : null;
  }

  /**
   * Find all tool_use/tool_result pairs in conversation.
   * Returns pairs sorted by oldest first (lowest index).
   */
  private findToolPairs(conversation: ReadonlyArray<unknown>): ToolPair[] {
    // Map: tool_use_id -> tool_use info
    const toolUses = new Map<
      string,
      { index: number; toolName: string; toolArgs: unknown }
    >();

    // Map: tool_use_id -> tool_result info
    const toolResults = new Map<
      string,
      { index: number; content: unknown; sizeBytes: number }
    >();

    // Scan conversation for tool_use and tool_result content blocks
    for (let i = 0; i < conversation.length; i++) {
      const item = conversation[i] as Record<string, unknown>;
      if (item?.type !== 'message') continue;

      const content = item.content as Array<Record<string, unknown>> | undefined;
      if (!Array.isArray(content)) continue;

      for (const block of content) {
        if (block.type === 'tool_use' || block.type === 'custom_tool_use') {
          const toolUseId = block.id as string;
          if (toolUseId) {
            // Tool args may be in `input` (OpenAI/raw format) or `arguments` (our Content type, JSON string)
            let toolArgs: unknown = block.input;
            if (toolArgs === undefined && typeof block.arguments === 'string') {
              try { toolArgs = JSON.parse(block.arguments); } catch { toolArgs = undefined; }
            } else if (toolArgs === undefined && typeof block.arguments === 'object') {
              toolArgs = block.arguments;
            }
            toolUses.set(toolUseId, {
              index: i,
              toolName: (block.name as string) || 'unknown',
              toolArgs,
            });
          }
        } else if (block.type === 'tool_result' || block.type === 'custom_tool_result') {
          const toolUseId = block.tool_use_id as string;
          if (toolUseId) {
            const resultContent = block.content;
            const sizeBytes = this.estimateSize(resultContent);
            toolResults.set(toolUseId, {
              index: i,
              content: resultContent,
              sizeBytes,
            });
          }
        }
      }
    }

    // Match pairs
    const pairs: ToolPair[] = [];
    for (const [toolUseId, useInfo] of toolUses) {
      const resultInfo = toolResults.get(toolUseId);
      if (resultInfo) {
        pairs.push({
          toolUseId,
          toolUseIndex: useInfo.index,
          toolResultIndex: resultInfo.index,
          toolName: useInfo.toolName,
          toolArgs: useInfo.toolArgs,
          resultContent: resultInfo.content,
          resultSizeBytes: resultInfo.sizeBytes,
        });
      }
    }

    // Sort by oldest first (lowest toolUseIndex)
    pairs.sort((a, b) => a.toolUseIndex - b.toolUseIndex);

    return pairs;
  }

  /**
   * Generate a key for storing tool result in memory.
   * Format: tool_result.<tool_name>.<short_id>
   */
  private generateKey(toolName: string, toolUseId: string): string {
    // Use last 8 chars of tool_use_id for uniqueness
    const shortId = toolUseId.slice(-8);
    // Sanitize tool name (replace non-alphanumeric with underscore)
    const safeName = toolName.replace(/[^a-zA-Z0-9_]/g, '_');
    return `tool_result.${safeName}.${shortId}`;
  }

  /**
   * Generate a description for the stored tool result.
   * Uses tool's describeCall for rich arg summaries (e.g., "grep: \"TODO\" in *.ts"),
   * falls back to generic key=value summary.
   */
  private generateDescription(toolName: string, toolArgs: unknown, context?: CompactionContext): string {
    // Tool's own describeCall produces rich descriptions like
    // 'src/core/Agent.ts [lines 100-200]' or '"TODO|FIXME" in *.ts (src/)'.
    // Use it verbatim — the tool author decided how to describe its own call
    // and we shouldn't second-guess that with a char cap.
    const toolDesc = context?.describeToolCall?.(toolName, toolArgs);
    if (toolDesc) {
      return `${toolName}: ${toolDesc}`;
    }

    // Fallback to generic arg summary
    const argSummary = this.summarizeArgs(toolArgs);
    if (!argSummary) {
      return `Result of ${toolName}()`;
    }
    return `${toolName}(${argSummary})`;
  }

  /**
   * Summarize arguments for description. Full key=value rendering — the
   * compaction placeholder needs to remain readable, not shorter-is-better.
   */
  private summarizeArgs(args: unknown): string {
    if (args === undefined || args === null) {
      return '';
    }

    try {
      if (typeof args === 'object') {
        const entries = Object.entries(args as Record<string, unknown>);
        const parts: string[] = [];

        for (const [key, value] of entries) {
          let valueStr: string;
          if (typeof value === 'string') {
            valueStr = `"${value}"`;
          } else if (typeof value === 'object' && value !== null) {
            valueStr = Array.isArray(value) ? `[${value.length} items]` : '{...}';
          } else {
            valueStr = String(value);
          }

          parts.push(`${key}=${valueStr}`);
        }

        return parts.join(', ');
      }

      return String(args);
    } catch {
      return '...';
    }
  }

  /**
   * Estimate the size of a value in bytes.
   */
  private estimateSize(value: unknown): number {
    if (value === undefined || value === null) {
      return 0;
    }

    try {
      const json = JSON.stringify(value);
      // UTF-8 byte length approximation
      return new TextEncoder().encode(json).length;
    } catch {
      // Fallback: rough estimate
      return String(value).length * 2;
    }
  }

  /**
   * Format bytes for logging.
   */
  private formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  }

  /**
   * Apply rolling window compaction - remove oldest messages until target is met.
   */
  private async applyRollingWindow(
    context: CompactionContext,
    targetToFree: number,
    log: string[]
  ): Promise<{ tokensFreed: number; messagesRemoved: number }> {
    const conversation = context.conversation;
    if (conversation.length === 0) {
      return { tokensFreed: 0, messagesRemoved: 0 };
    }

    // Find tool pairs to avoid breaking them
    const toolPairs = this.findToolPairs(conversation);
    const pairIndices = new Set<number>();
    for (const pair of toolPairs) {
      pairIndices.add(pair.toolUseIndex);
      pairIndices.add(pair.toolResultIndex);
    }

    // Build removal order: non-tool messages first, then complete tool pairs
    const nonToolIndices: number[] = [];
    for (let i = 0; i < conversation.length; i++) {
      if (!pairIndices.has(i)) {
        nonToolIndices.push(i);
      }
    }

    // Collect indices to remove, tracking freed tokens
    let tokensFreed = 0;
    const indicesToRemove: number[] = [];

    // First, try removing non-tool messages (oldest first)
    for (const idx of nonToolIndices) {
      if (tokensFreed >= targetToFree) break;

      const item = conversation[idx];
      if (item) {
        tokensFreed += context.estimateTokens(item);
        indicesToRemove.push(idx);
      }
    }

    // If still need more, remove complete tool pairs (oldest first)
    if (tokensFreed < targetToFree) {
      for (const pair of toolPairs) {
        if (tokensFreed >= targetToFree) break;

        for (const connected of this.getConnectedToolPairs(pair, toolPairs)) {
          for (const index of [connected.toolUseIndex, connected.toolResultIndex]) {
            const item = conversation[index];
            if (item && !indicesToRemove.includes(index)) {
              tokensFreed += context.estimateTokens(item);
              indicesToRemove.push(index);
            }
          }
        }
      }
    }

    // Actually remove the messages
    if (indicesToRemove.length > 0) {
      await context.removeMessages(indicesToRemove);
      log.push(`Rolling window removed ${indicesToRemove.length} messages`);
    }

    return {
      tokensFreed,
      messagesRemoved: indicesToRemove.length,
    };
  }

  /** Return all pairs connected through a shared tool-use/result message. */
  private getConnectedToolPairs(seed: ToolPair, pairs: ToolPair[]): ToolPair[] {
    const connected = new Set<ToolPair>([seed]);
    const indices = new Set([seed.toolUseIndex, seed.toolResultIndex]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const pair of pairs) {
        if (connected.has(pair)) continue;
        if (indices.has(pair.toolUseIndex) || indices.has(pair.toolResultIndex)) {
          connected.add(pair);
          indices.add(pair.toolUseIndex);
          indices.add(pair.toolResultIndex);
          changed = true;
        }
      }
    }
    return [...connected];
  }
}
