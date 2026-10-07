/**
 * StreamState - Accumulates streaming events to reconstruct complete response
 */

import { TokenUsage } from './Response.js';
import { ToolCall } from './Tool.js';
import { ProviderStopDetails } from './StreamEvent.js';
import type { CompactionItem } from './Message.js';
import type { ProviderStateContent } from './Content.js';

/**
 * Buffer for accumulating tool call arguments
 */
export interface ToolCallBuffer {
  toolName: string;
  argumentChunks: string[];
  isComplete: boolean;
  startTime: Date;
  toolType?: 'function' | 'custom';
  async?: boolean;
}

export interface StreamOutputPosition {
  outputIndex?: number;
  contentIndex?: number;
  sequenceNumber?: number;
}

export type OrderedStreamOutputEntry =
  | {
      kind: 'text';
      itemId: string;
      outputIndex?: number;
      contentIndex?: number;
      text: string;
    }
  | {
      kind: 'reasoning';
      itemId: string;
      outputIndex?: number;
      thinking: string;
      signature?: string;
      encryptedContent?: string;
      effort?: import('../interfaces/ITextProvider.js').ReasoningEffort;
    }
  | { kind: 'compaction'; itemId: string; outputIndex?: number; item: CompactionItem }
  | {
      kind: 'provider_state';
      itemId: string;
      outputIndex?: number;
      state: ProviderStateContent;
    }
  | {
      kind: 'tool_call';
      itemId: string;
      outputIndex?: number;
      toolCallId: string;
      toolName: string;
      arguments: string;
      toolType?: 'function' | 'custom';
      async?: boolean;
    };

interface OrderedOutputRef {
  kind: OrderedStreamOutputEntry['kind'];
  key: string;
  dataKey: string;
  itemId: string;
  toolCallId?: string;
  outputIndex?: number;
  contentIndex?: number;
  ordinal: number;
}

/**
 * StreamState tracks all accumulated data during streaming
 */
export class StreamState {
  // Core identifiers
  public responseId: string;
  public model: string;
  public createdAt: number;

  // Text accumulation: item_id -> text chunks
  private textBuffers: Map<string, string[]>;

  // Reasoning accumulation: item_id -> reasoning chunks
  private reasoningBuffers: Map<string, string[]>;
  private reasoningMetadata: Map<string, {
    signature?: string;
    encryptedContent?: string;
    effort?: import('../interfaces/ITextProvider.js').ReasoningEffort;
  }>;

  // Provider-signed compaction state for stateless continuation replay.
  private compactions: Map<string, CompactionItem>;
  private providerStates: Map<string, ProviderStateContent>;

  // Provider output order. Typed buffers above hold the data; this ledger keeps
  // the original cross-type sequence needed for exact stateless replay.
  private orderedOutputs: Map<string, OrderedOutputRef>;
  private nextOutputOrdinal = 0;

  // Tool call accumulation: tool_call_id -> buffer
  private toolCallBuffers: Map<string, ToolCallBuffer>;

  // Completed tool calls
  private completedToolCalls: ToolCall[];

  // Tool execution results
  private toolResults: Map<string, any>;

  // Metadata
  public currentIteration: number;
  public usage: TokenUsage;
  public status: 'in_progress' | 'completed' | 'incomplete' | 'failed';
  /** Status reported by the provider's RESPONSE_COMPLETE event. Defaults to 'incomplete' (safe if never received). */
  public providerStatus: 'completed' | 'incomplete' | 'failed' = 'incomplete';
  /** Raw stop reason from provider (e.g., 'end_turn', 'max_tokens', 'SAFETY') */
  public stopReason?: string;
  /** Opaque provider token used to resume an incomplete long decode. */
  public continuationToken?: string;
  /** Structured stop detail (Anthropic refusals: which classifier fired + why). */
  public stopDetails?: ProviderStopDetails;
  public startTime: Date;
  public endTime?: Date;

  // Statistics
  public totalChunks: number;
  public totalTextDeltas: number;
  public totalToolCalls: number;

  constructor(responseId: string, model: string, createdAt?: number) {
    this.responseId = responseId;
    this.model = model;
    this.createdAt = createdAt || Date.now();

    this.textBuffers = new Map();
    this.reasoningBuffers = new Map();
    this.reasoningMetadata = new Map();
    this.compactions = new Map();
    this.providerStates = new Map();
    this.orderedOutputs = new Map();
    this.toolCallBuffers = new Map();
    this.completedToolCalls = [];
    this.toolResults = new Map();

    this.currentIteration = 0;
    this.usage = {
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
    };
    this.status = 'in_progress';
    this.startTime = new Date();

    this.totalChunks = 0;
    this.totalTextDeltas = 0;
    this.totalToolCalls = 0;
  }

  /**
   * Accumulate text delta for a specific item
   */
  accumulateTextDelta(itemId: string, delta: string, position: StreamOutputPosition = {}): void {
    // A provider message can contain more than one output_text content block.
    // Keep those buffers distinct even though they share the same item_id.
    const dataKey = position.outputIndex !== undefined
      ? `${itemId}:output:${position.outputIndex}:content:${position.contentIndex ?? 0}`
      : itemId;
    const ref = this.trackOutput('text', dataKey, itemId, position);
    if (!this.textBuffers.has(ref.dataKey)) {
      this.textBuffers.set(ref.dataKey, []);
    }
    this.textBuffers.get(ref.dataKey)!.push(delta);
    this.totalTextDeltas++;
    this.totalChunks++;
  }

  /**
   * Get complete accumulated text for an item
   */
  getCompleteText(itemId: string): string {
    return this.getOrderedOutputEntries()
      .flatMap((entry) => (
        entry.kind === 'text' && entry.itemId === itemId ? [entry.text] : []
      ))
      .join('');
  }

  /**
   * Get all accumulated text (all items concatenated)
   */
  getAllText(): string {
    return this.getOrderedOutputEntries()
      .flatMap((entry) => entry.kind === 'text' ? [entry.text] : [])
      .join('');
  }

  /**
   * Accumulate reasoning delta for a specific item
   */
  accumulateReasoningDelta(
    itemId: string,
    delta: string,
    position: StreamOutputPosition = {},
  ): void {
    const ref = this.trackOutput('reasoning', itemId, itemId, position);
    if (!this.reasoningBuffers.has(ref.dataKey)) {
      this.reasoningBuffers.set(ref.dataKey, []);
    }
    this.reasoningBuffers.get(ref.dataKey)!.push(delta);
    this.totalChunks++;
  }

  /**
   * Get complete accumulated reasoning for an item
   */
  getCompleteReasoning(itemId: string): string {
    return this.getOrderedOutputEntries()
      .flatMap((entry) => (
        entry.kind === 'reasoning' && entry.itemId === itemId ? [entry.thinking] : []
      ))
      .join('');
  }

  /**
   * Get all accumulated reasoning (all items concatenated)
   */
  getAllReasoning(): string {
    return this.getOrderedOutputEntries()
      .flatMap((entry) => entry.kind === 'reasoning' ? [entry.thinking] : [])
      .join('');
  }

  /** Reasoning blocks with provider item IDs, used by stateless replay APIs. */
  completeReasoning(
    itemId: string,
    metadata: { signature?: string; encryptedContent?: string; effort?: import('../interfaces/ITextProvider.js').ReasoningEffort },
    position: StreamOutputPosition = {},
  ): void {
    const ref = this.trackOutput('reasoning', itemId, itemId, position);
    if (!this.reasoningBuffers.has(ref.dataKey)) {
      this.reasoningBuffers.set(ref.dataKey, []);
    }
    this.reasoningMetadata.set(ref.dataKey, {
      ...this.reasoningMetadata.get(ref.dataKey),
      ...metadata,
    });
  }

  getReasoningEntries(): Array<{
    itemId: string;
    thinking: string;
    signature?: string;
    encryptedContent?: string;
    effort?: import('../interfaces/ITextProvider.js').ReasoningEffort;
  }> {
    return this.getOrderedOutputEntries().flatMap((entry) => (
      entry.kind === 'reasoning' ? [entry] : []
    ));
  }

  /**
   * Check if stream has any accumulated reasoning
   */
  hasReasoning(): boolean {
    return this.reasoningBuffers.size > 0;
  }

  accumulateCompaction(item: CompactionItem, position: StreamOutputPosition = {}): void {
    this.compactions.set(item.id, item);
    this.trackOutput('compaction', item.id, item.id, position);
    this.totalChunks++;
  }

  getCompactions(): CompactionItem[] {
    return [...this.compactions.values()];
  }

  hasCompactions(): boolean {
    return this.compactions.size > 0;
  }

  accumulateProviderState(
    itemId: string,
    state: ProviderStateContent,
    position: StreamOutputPosition = {},
  ): void {
    this.providerStates.set(itemId, state);
    this.trackOutput('provider_state', itemId, itemId, position);
    this.totalChunks++;
  }

  getProviderStates(): ProviderStateContent[] {
    return [...this.providerStates.values()];
  }

  hasProviderStates(): boolean {
    return this.providerStates.size > 0;
  }

  /**
   * Start accumulating tool call arguments
   */
  startToolCall(
    toolCallId: string,
    toolName: string,
    itemId = toolCallId,
    position: StreamOutputPosition = {},
    metadata: { toolType?: 'function' | 'custom'; async?: boolean } = {},
  ): void {
    this.toolCallBuffers.set(toolCallId, {
      toolName,
      argumentChunks: [],
      isComplete: false,
      startTime: new Date(),
      ...metadata,
    });
    this.trackOutput('tool_call', toolCallId, itemId, position);
  }

  /** Reconstruct every streamed provider output item in its original order. */
  getOrderedOutputEntries(): OrderedStreamOutputEntry[] {
    const refs = [...this.orderedOutputs.values()].sort((a, b) => {
      if (
        a.outputIndex !== undefined
        && b.outputIndex !== undefined
        && a.outputIndex !== b.outputIndex
      ) {
        return a.outputIndex - b.outputIndex;
      }
      if (
        a.outputIndex === b.outputIndex
        && a.contentIndex !== undefined
        && b.contentIndex !== undefined
        && a.contentIndex !== b.contentIndex
      ) {
        return a.contentIndex - b.contentIndex;
      }
      return a.ordinal - b.ordinal;
    });

    return refs.flatMap((ref): OrderedStreamOutputEntry[] => {
      if (ref.kind === 'text') {
        return [{
          kind: 'text',
          itemId: ref.itemId,
          outputIndex: ref.outputIndex,
          contentIndex: ref.contentIndex,
          text: this.textBuffers.get(ref.dataKey)?.join('') ?? '',
        }];
      }
      if (ref.kind === 'reasoning') {
        return [{
          kind: 'reasoning',
          itemId: ref.itemId,
          outputIndex: ref.outputIndex,
          thinking: this.reasoningBuffers.get(ref.dataKey)?.join('') ?? '',
          ...this.reasoningMetadata.get(ref.dataKey),
        }];
      }
      if (ref.kind === 'compaction') {
        const item = this.compactions.get(ref.dataKey);
        return item ? [{ kind: 'compaction', itemId: ref.itemId, outputIndex: ref.outputIndex, item }] : [];
      }
      if (ref.kind === 'provider_state') {
        const state = this.providerStates.get(ref.dataKey);
        return state ? [{ kind: 'provider_state', itemId: ref.itemId, outputIndex: ref.outputIndex, state }] : [];
      }
      const buffer = this.toolCallBuffers.get(ref.dataKey);
      return buffer ? [{
        kind: 'tool_call',
        itemId: ref.itemId,
        outputIndex: ref.outputIndex,
        toolCallId: ref.toolCallId ?? ref.dataKey,
        toolName: buffer.toolName,
        arguments: buffer.argumentChunks.join(''),
        ...(buffer.toolType ? { toolType: buffer.toolType } : {}),
        ...(buffer.async !== undefined ? { async: buffer.async } : {}),
      }] : [];
    });
  }

  private trackOutput(
    kind: OrderedStreamOutputEntry['kind'],
    dataKey: string,
    itemId: string,
    position: StreamOutputPosition,
  ): OrderedOutputRef {
    const positionKey = position.outputIndex !== undefined
      ? `${kind}:output:${position.outputIndex}${kind === 'text' ? `:${position.contentIndex ?? 0}` : ''}`
      : `${kind}:item:${dataKey}`;
    const existing = this.orderedOutputs.get(positionKey);
    if (existing) {
      existing.itemId = itemId || existing.itemId;
      existing.outputIndex ??= position.outputIndex;
      existing.contentIndex ??= position.contentIndex;
      return existing;
    }
    const ref: OrderedOutputRef = {
      kind,
      key: positionKey,
      dataKey,
      itemId,
      ...(kind === 'tool_call' ? { toolCallId: dataKey } : {}),
      outputIndex: position.outputIndex,
      contentIndex: position.contentIndex,
      ordinal: position.sequenceNumber ?? this.nextOutputOrdinal,
    };
    this.nextOutputOrdinal = Math.max(this.nextOutputOrdinal + 1, ref.ordinal + 1);
    this.orderedOutputs.set(positionKey, ref);
    return ref;
  }

  /**
   * Accumulate tool argument delta
   */
  accumulateToolArguments(toolCallId: string, delta: string): void {
    const buffer = this.findToolCallBuffer(toolCallId);
    if (!buffer) {
      throw new Error(`Tool call buffer not found for id: ${toolCallId}`);
    }
    buffer.argumentChunks.push(delta);
    this.totalChunks++;
  }

  /**
   * Mark tool call arguments as complete
   */
  completeToolCall(toolCallId: string): void {
    const buffer = this.findToolCallBuffer(toolCallId);
    if (!buffer) {
      throw new Error(`Tool call buffer not found for id: ${toolCallId}`);
    }
    buffer.isComplete = true;
    this.totalToolCalls++;
  }

  /**
   * Get complete tool arguments (joined chunks)
   */
  getCompleteToolArguments(toolCallId: string): string {
    const buffer = this.findToolCallBuffer(toolCallId);
    if (!buffer) {
      throw new Error(`Tool call buffer not found for id: ${toolCallId}`);
    }
    return buffer.argumentChunks.join('');
  }

  /**
   * Check if tool call is complete
   */
  isToolCallComplete(toolCallId: string): boolean {
    const buffer = this.findToolCallBuffer(toolCallId);
    return buffer ? buffer.isComplete : false;
  }

  /**
   * Get tool name for a tool call
   */
  getToolName(toolCallId: string): string | undefined {
    return this.findToolCallBuffer(toolCallId)?.toolName;
  }

  /** Resolve a semantic tool-call ID even after per-response buffers are namespaced. */
  private findToolCallBuffer(toolCallId: string): ToolCallBuffer | undefined {
    const direct = this.toolCallBuffers.get(toolCallId);
    if (direct) return direct;
    const refs = [...this.orderedOutputs.values()].sort((a, b) => b.ordinal - a.ordinal);
    const ref = refs.find((candidate) => (
      candidate.kind === 'tool_call'
      && (candidate.toolCallId ?? candidate.dataKey) === toolCallId
    ));
    return ref ? this.toolCallBuffers.get(ref.dataKey) : undefined;
  }

  /**
   * Add completed tool call
   */
  addCompletedToolCall(toolCall: ToolCall): void {
    this.completedToolCalls.push(toolCall);
  }

  /**
   * Get all completed tool calls
   */
  getCompletedToolCalls(): ToolCall[] {
    return [...this.completedToolCalls];
  }

  /**
   * Store tool execution result
   */
  setToolResult(toolCallId: string, result: any): void {
    this.toolResults.set(toolCallId, result);
  }

  /**
   * Get tool execution result
   */
  getToolResult(toolCallId: string): any {
    return this.toolResults.get(toolCallId);
  }

  /**
   * Update token usage (replaces values, doesn't accumulate)
   */
  updateUsage(usage: Partial<TokenUsage>): void {
    if (usage.input_tokens !== undefined) {
      this.usage.input_tokens = usage.input_tokens;
    }
    if (usage.output_tokens !== undefined) {
      this.usage.output_tokens = usage.output_tokens;
    }
    if (usage.total_tokens !== undefined) {
      this.usage.total_tokens = usage.total_tokens;
    } else {
      // Calculate total if not provided
      this.usage.total_tokens = this.usage.input_tokens + this.usage.output_tokens;
    }
    this.copyDetailedUsage(usage, false);
  }

  /**
   * Accumulate text, reasoning, and statistics from another StreamState.
   * Used to merge per-iteration state into the global execution state,
   * so that the final response built from the global state has full text.
   */
  accumulateFrom(other: StreamState): void {
    // Namespace every imported buffer. Provider item IDs and output indices are
    // scoped to one response and may repeat across agent iterations; pointing
    // two ledger entries at a merged buffer would duplicate both outputs.
    const refs = [...other.orderedOutputs.values()].sort((a, b) => a.ordinal - b.ordinal);
    for (const ref of refs) {
      const ordinal = this.nextOutputOrdinal++;
      const dataKey = `merged:${ordinal}:${ref.dataKey}`;
      if (ref.kind === 'text') {
        this.textBuffers.set(dataKey, [...(other.textBuffers.get(ref.dataKey) ?? [])]);
      } else if (ref.kind === 'reasoning') {
        this.reasoningBuffers.set(dataKey, [...(other.reasoningBuffers.get(ref.dataKey) ?? [])]);
        const metadata = other.reasoningMetadata.get(ref.dataKey);
        if (metadata) this.reasoningMetadata.set(dataKey, { ...metadata });
      } else if (ref.kind === 'compaction') {
        const compaction = other.compactions.get(ref.dataKey);
        if (compaction) this.compactions.set(dataKey, compaction);
      } else if (ref.kind === 'provider_state') {
        const state = other.providerStates.get(ref.dataKey);
        if (state) this.providerStates.set(dataKey, state);
      } else {
        const buffer = other.toolCallBuffers.get(ref.dataKey);
        if (buffer) {
          this.toolCallBuffers.set(dataKey, {
            ...buffer,
            argumentChunks: [...buffer.argumentChunks],
          });
        }
      }
      const key = `${ref.key}:merged:${ordinal}`;
      this.orderedOutputs.set(key, {
        ...ref,
        key,
        dataKey,
        outputIndex: undefined,
        contentIndex: undefined,
        ordinal,
      });
    }
    this.totalTextDeltas += other.totalTextDeltas;
    this.completedToolCalls.push(...other.completedToolCalls);
    for (const [toolCallId, result] of other.toolResults) {
      this.toolResults.set(toolCallId, result);
    }

    // Merge statistics
    this.totalChunks += other.totalChunks;
    this.totalToolCalls += other.totalToolCalls;

    // Propagate provider status from the last iteration that reported one
    if (other.providerStatus !== 'incomplete') {
      this.providerStatus = other.providerStatus;
    }
    if (other.stopReason) {
      this.stopReason = other.stopReason;
    }
    if (other.stopDetails) {
      this.stopDetails = other.stopDetails;
    }
    if (other.continuationToken) {
      this.continuationToken = other.continuationToken;
    }
  }

  /**
   * Accumulate token usage (adds to existing values)
   */
  accumulateUsage(usage: Partial<TokenUsage>): void {
    if (usage.input_tokens !== undefined) {
      this.usage.input_tokens += usage.input_tokens;
    }
    if (usage.output_tokens !== undefined) {
      this.usage.output_tokens += usage.output_tokens;
    }
    if (usage.total_tokens !== undefined) {
      this.usage.total_tokens += usage.total_tokens;
    } else {
      // Recalculate total
      this.usage.total_tokens = this.usage.input_tokens + this.usage.output_tokens;
    }
    this.copyDetailedUsage(usage, true);
  }

  private copyDetailedUsage(usage: Partial<TokenUsage>, accumulate: boolean): void {
    for (const key of ['cached_input_tokens', 'cache_creation_input_tokens'] as const) {
      const value = usage[key];
      if (value !== undefined) {
        this.usage[key] = accumulate ? (this.usage[key] ?? 0) + value : value;
      }
    }
    const reasoning = usage.output_tokens_details?.reasoning_tokens;
    if (reasoning !== undefined) {
      this.usage.output_tokens_details = {
        reasoning_tokens: accumulate
          ? (this.usage.output_tokens_details?.reasoning_tokens ?? 0) + reasoning
          : reasoning,
      };
    }
    if (usage.cache_creation_details) {
      const prior = accumulate ? this.usage.cache_creation_details : undefined;
      this.usage.cache_creation_details = {
        short_ttl_input_tokens:
          (prior?.short_ttl_input_tokens ?? 0) +
          (usage.cache_creation_details.short_ttl_input_tokens ?? 0),
        extended_ttl_input_tokens:
          (prior?.extended_ttl_input_tokens ?? 0) +
          (usage.cache_creation_details.extended_ttl_input_tokens ?? 0),
      };
    }
    if (usage.native_tool_calls) {
      const prior = accumulate ? this.usage.native_tool_calls : undefined;
      this.usage.native_tool_calls = { ...(prior ?? {}) };
      for (const [name, count] of Object.entries(usage.native_tool_calls)) {
        const key = name as keyof NonNullable<TokenUsage['native_tool_calls']>;
        this.usage.native_tool_calls[key] =
          (this.usage.native_tool_calls[key] ?? 0) + (count ?? 0);
      }
    }
    if (usage.processing_mode) this.usage.processing_mode = usage.processing_mode;
    if (usage.service_tier) this.usage.service_tier = usage.service_tier;
    if (usage.cost_usd_ticks !== undefined) {
      this.usage.cost_usd_ticks = accumulate
        ? (this.usage.cost_usd_ticks ?? 0) + usage.cost_usd_ticks
        : usage.cost_usd_ticks;
    }
  }

  /**
   * Mark stream as complete
   */
  markComplete(status: 'completed' | 'incomplete' | 'failed' = 'completed'): void {
    this.status = status;
    this.endTime = new Date();
  }

  /**
   * Get duration in milliseconds
   */
  getDuration(): number {
    const end = this.endTime || new Date();
    return end.getTime() - this.startTime.getTime();
  }

  /**
   * Increment iteration counter
   */
  incrementIteration(): void {
    this.currentIteration++;
  }

  /**
   * Get summary statistics
   */
  getStatistics() {
    return {
      responseId: this.responseId,
      model: this.model,
      status: this.status,
      iterations: this.currentIteration,
      totalChunks: this.totalChunks,
      totalTextDeltas: this.totalTextDeltas,
      totalToolCalls: this.totalToolCalls,
      textItemsCount: this.textBuffers.size,
      toolCallBuffersCount: this.toolCallBuffers.size,
      completedToolCallsCount: this.completedToolCalls.length,
      durationMs: this.getDuration(),
      usage: { ...this.usage },
      providerStatus: this.providerStatus,
      stopReason: this.stopReason,
      stopDetails: this.stopDetails,
    };
  }

  /**
   * Check if stream has any accumulated text
   */
  hasText(): boolean {
    return this.textBuffers.size > 0;
  }

  /**
   * Check if stream has any tool calls
   */
  hasToolCalls(): boolean {
    return this.toolCallBuffers.size > 0;
  }

  /**
   * Clear all buffers (for memory management)
   */
  clear(): void {
    this.textBuffers.clear();
    this.reasoningBuffers.clear();
    this.reasoningMetadata.clear();
    this.compactions.clear();
    this.providerStates.clear();
    this.orderedOutputs.clear();
    this.nextOutputOrdinal = 0;
    this.toolCallBuffers.clear();
    this.completedToolCalls = [];
    this.toolResults.clear();
    this.providerStatus = 'incomplete';
    this.stopReason = undefined;
    this.stopDetails = undefined;
    this.continuationToken = undefined;
  }

  /**
   * Create a snapshot for checkpointing (error recovery)
   */
  createSnapshot() {
    return {
      responseId: this.responseId,
      model: this.model,
      createdAt: this.createdAt,
      textBuffers: new Map(this.textBuffers),
      reasoningBuffers: new Map(this.reasoningBuffers),
      reasoningMetadata: new Map(this.reasoningMetadata),
      compactions: new Map(this.compactions),
      providerStates: new Map(this.providerStates),
      orderedOutputs: new Map(this.orderedOutputs),
      nextOutputOrdinal: this.nextOutputOrdinal,
      toolCallBuffers: new Map(this.toolCallBuffers),
      completedToolCalls: [...this.completedToolCalls],
      toolResults: new Map(this.toolResults),
      currentIteration: this.currentIteration,
      usage: { ...this.usage },
      status: this.status,
      providerStatus: this.providerStatus,
      stopReason: this.stopReason,
      stopDetails: this.stopDetails,
      continuationToken: this.continuationToken,
      startTime: this.startTime,
      endTime: this.endTime,
    };
  }
}
