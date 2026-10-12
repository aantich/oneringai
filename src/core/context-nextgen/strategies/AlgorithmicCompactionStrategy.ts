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

import { removableMessageGroups, toolProtocolKeys } from '../tool-pairs.js';
import { isDeepStrictEqual } from 'node:util';
import type { InputItem } from '../../../domain/entities/Message.js';
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

  /** Namespaced protocol identity (function and custom IDs may coincide). */
  protocolKey: string;

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
    const beforeConsolidation = context.conversation.length;
    const consolidateResult = await this.consolidate(context);
    messagesRemoved += beforeConsolidation - context.conversation.length;
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
      messagesRemoved += result.messagesRemoved;
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
    const conversation = context.conversation;
    const toolPairs = this.findToolPairs(conversation);
    const groups = removableMessageGroups(conversation, context.currentInput)
      .filter(group => !memory || this.canStoreGroup(conversation, group, toolPairs));
    const eligible = new Set(groups.flat());
    const pairs = toolPairs.filter(pair => eligible.has(pair.toolUseIndex) && eligible.has(pair.toolResultIndex));
    const selected = new Set<number>();
    const select = (pair: ToolPair) => {
      const group = groups.find(indices => indices.includes(pair.toolUseIndex));
      group?.forEach(index => selected.add(index));
    };
    if (memory) pairs.filter(pair => pair.resultSizeBytes > this.toolResultSizeThreshold).forEach(select);
    const remaining = pairs.filter(pair => !selected.has(pair.toolUseIndex));
    remaining.slice(0, Math.max(0, remaining.length - this.maxToolPairs)).forEach(select);
    if (selected.size === 0) return { performed: false, tokensChanged: 0, actions: [] };

    // Resolve the entire removal component before writing anything. Every result
    // (including native outputs and attachments) must be recoverable first.
    if (memory) {
      const stored: Array<{ key: string; value: unknown }> = [];
      const keys = new Map<string, string>();
      // Stored entries survive earlier compaction passes and session restoration.
      const used = new Set((await memory.query({ tier: 'raw' })).entries.map(entry => entry.key));
      for (const pair of pairs) {
        const base = this.generateKey(pair.toolName, pair.toolUseId);
        let key = base;
        let suffix = 0;
        while (used.has(`raw.${key}`)) key = `${base}.${pair.protocolKey.split(':')[0]}.${++suffix}`;
        used.add(`raw.${key}`); keys.set(pair.protocolKey, key);
      }
      for (const pair of pairs.filter(pair => selected.has(pair.toolUseIndex))) {
        const key = keys.get(pair.protocolKey)!;
        await memory.store(key, this.generateDescription(pair.toolName, pair.toolArgs, context), pair.resultContent, {
          tier: 'raw', priority: pair.resultSizeBytes > this.toolResultSizeThreshold ? 'normal' : 'low',
        });
        stored.push({ key: `raw.${key}`, value: pair.resultContent });
        log.push(pair.resultSizeBytes > this.toolResultSizeThreshold
          ? `Moved ${pair.toolName} result (${this.formatBytes(pair.resultSizeBytes)}) to memory: ${key}`
          : `Spilled connected or aged tool pair to memory: ${pair.toolName} → ${key}`);
      }
      // A later write may evict an earlier one from a capacity-limited store.
      // Retain history if the complete group is no longer recoverable.
      for (const { key, value } of stored) {
        if (!isDeepStrictEqual(await memory.retrieve(key), value)) throw new Error(`Cannot remove tool results: working memory did not retain ${key}`);
      }
    }
    const before = context.conversation.length;
    tokensChanged = -(await context.removeMessages([...selected]));
    const removed = before - context.conversation.length;
    log.push(`Removed ${removed} messages, freed ~${Math.abs(tokensChanged)} tokens`);
    return { performed: removed > 0, tokensChanged, actions: log };
  }

  private canStoreGroup(conversation: readonly InputItem[], group: number[], pairs: ToolPair[]): boolean {
    const represented = new Set(pairs.filter(pair => group.includes(pair.toolUseIndex) && group.includes(pair.toolResultIndex))
      .filter(pair => {
        try { return JSON.stringify(pair.resultContent) !== undefined; } catch { return false; }
      }).map(pair => pair.protocolKey));
    return group.every(index => toolProtocolKeys(conversation[index]!).every(key => represented.has(key)));
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
  private findToolPairs(conversation: readonly InputItem[]): ToolPair[] {
    // Map: tool_use_id -> tool_use info
    const toolUses = new Map<
      string,
      { index: number; id: string; toolName: string; toolArgs: unknown }
    >();

    // Map: tool_use_id -> tool_result info
    const toolResults = new Map<
      string,
      { index: number; content: unknown; sizeBytes: number }
    >();

    // Scan conversation for tool_use and tool_result content blocks
    for (let i = 0; i < conversation.length; i++) {
      const item = conversation[i] as unknown as Record<string, unknown>;
      if (item?.type === 'function_call_output' || item?.type === 'custom_tool_call_output') {
        toolResults.set(toolProtocolKeys(conversation[i]!)[0]!, {
          index: i, content: item.output, sizeBytes: this.estimateSize(item.output),
        });
        continue;
      }
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
            toolUses.set(`${block.type === 'custom_tool_use' ? 'custom' : 'function'}:${toolUseId}`, {
              index: i,
              id: toolUseId,
              toolName: (block.name as string) || 'unknown',
              toolArgs,
            });
          }
        } else if (block.type === 'tool_result' || block.type === 'custom_tool_result') {
          const toolUseId = block.tool_use_id as string;
          if (toolUseId) {
            const resultContent = block.__images || block.error
              ? { content: block.content, ...(block.__images ? { __images: block.__images } : {}), ...(block.error ? { error: block.error } : {}) }
              : block.content;
            const sizeBytes = this.estimateSize(resultContent);
            toolResults.set(`${block.type === 'custom_tool_result' ? 'custom' : 'function'}:${toolUseId}`, {
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
    for (const [protocolKey, useInfo] of toolUses) {
      const resultInfo = toolResults.get(protocolKey);
      if (resultInfo) {
        pairs.push({
          toolUseId: useInfo.id,
          protocolKey,
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

    // Preserve the existing non-tool-first policy, skipping protected groups
    // before estimating savings so they cannot prematurely satisfy the target.
    const memory = this.getWorkingMemory(context);
    const groups = removableMessageGroups(conversation, context.currentInput)
      .filter(group => !memory || this.canStoreGroup(conversation, group, toolPairs));
    const containsPair = (group: number[]) => group.some(index => pairIndices.has(index));
    const ordered = [...groups.filter(group => !containsPair(group)), ...groups.filter(containsPair)];
    let tokensFreed = 0;
    const indicesToRemove: number[] = [];
    for (const group of ordered) {
      if (tokensFreed >= targetToFree) break;
      indicesToRemove.push(...group);
      tokensFreed += group.reduce((sum, index) => sum + context.estimateTokens(conversation[index]!), 0);
    }
    if (indicesToRemove.length > 0) {
      tokensFreed = await context.removeMessages(indicesToRemove);
      log.push(`Rolling window removed ${indicesToRemove.length} messages`);
    }

    return {
      tokensFreed,
      messagesRemoved: indicesToRemove.length,
    };
  }

}
