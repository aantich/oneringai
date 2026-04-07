/**
 * StreamState - Accumulates streaming events to reconstruct complete response
 */

import { TokenUsage } from './Response.js';
import { ToolCall } from './Tool.js';

/**
 * Buffer for accumulating tool call arguments
 */
export interface ToolCallBuffer {
  toolName: string;
  argumentChunks: string[];
  isComplete: boolean;
  startTime: Date;
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
  accumulateTextDelta(itemId: string, delta: string): void {
    if (!this.textBuffers.has(itemId)) {
      this.textBuffers.set(itemId, []);
    }
    this.textBuffers.get(itemId)!.push(delta);
    this.totalTextDeltas++;
    this.totalChunks++;
  }

  /**
   * Get complete accumulated text for an item
   */
  getCompleteText(itemId: string): string {
    const chunks = this.textBuffers.get(itemId);
    return chunks ? chunks.join('') : '';
  }

  /**
   * Get all accumulated text (all items concatenated)
   */
  getAllText(): string {
    const allText: string[] = [];
    for (const chunks of this.textBuffers.values()) {
      allText.push(chunks.join(''));
    }
    return allText.join('');
  }

  /**
   * Accumulate reasoning delta for a specific item
   */
  accumulateReasoningDelta(itemId: string, delta: string): void {
    if (!this.reasoningBuffers.has(itemId)) {
      this.reasoningBuffers.set(itemId, []);
    }
    this.reasoningBuffers.get(itemId)!.push(delta);
    this.totalChunks++;
  }

  /**
   * Get complete accumulated reasoning for an item
   */
  getCompleteReasoning(itemId: string): string {
    const chunks = this.reasoningBuffers.get(itemId);
    return chunks ? chunks.join('') : '';
  }

  /**
   * Get all accumulated reasoning (all items concatenated)
   */
  getAllReasoning(): string {
    const allReasoning: string[] = [];
    for (const chunks of this.reasoningBuffers.values()) {
      allReasoning.push(chunks.join(''));
    }
    return allReasoning.join('');
  }

  /**
   * Check if stream has any accumulated reasoning
   */
  hasReasoning(): boolean {
    return this.reasoningBuffers.size > 0;
  }

  /**
   * Start accumulating tool call arguments
   */
  startToolCall(toolCallId: string, toolName: string): void {
    this.toolCallBuffers.set(toolCallId, {
      toolName,
      argumentChunks: [],
      isComplete: false,
      startTime: new Date(),
    });
  }

  /**
   * Accumulate tool argument delta
   */
  accumulateToolArguments(toolCallId: string, delta: string): void {
    const buffer = this.toolCallBuffers.get(toolCallId);
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
    const buffer = this.toolCallBuffers.get(toolCallId);
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
    const buffer = this.toolCallBuffers.get(toolCallId);
    if (!buffer) {
      throw new Error(`Tool call buffer not found for id: ${toolCallId}`);
    }
    return buffer.argumentChunks.join('');
  }

  /**
   * Check if tool call is complete
   */
  isToolCallComplete(toolCallId: string): boolean {
    const buffer = this.toolCallBuffers.get(toolCallId);
    return buffer ? buffer.isComplete : false;
  }

  /**
   * Get tool name for a tool call
   */
  getToolName(toolCallId: string): string | undefined {
    return this.toolCallBuffers.get(toolCallId)?.toolName;
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
  }

  /**
   * Accumulate text, reasoning, and statistics from another StreamState.
   * Used to merge per-iteration state into the global execution state,
   * so that the final response built from the global state has full text.
   */
  accumulateFrom(other: StreamState): void {
    // Merge text buffers
    for (const [itemId, chunks] of other.textBuffers) {
      if (!this.textBuffers.has(itemId)) {
        this.textBuffers.set(itemId, []);
      }
      this.textBuffers.get(itemId)!.push(...chunks);
    }
    this.totalTextDeltas += other.totalTextDeltas;

    // Merge reasoning buffers
    for (const [itemId, chunks] of other.reasoningBuffers) {
      if (!this.reasoningBuffers.has(itemId)) {
        this.reasoningBuffers.set(itemId, []);
      }
      this.reasoningBuffers.get(itemId)!.push(...chunks);
    }

    // Merge statistics
    this.totalChunks += other.totalChunks;

    // Propagate provider status from the last iteration that reported one
    if (other.providerStatus !== 'incomplete') {
      this.providerStatus = other.providerStatus;
    }
    if (other.stopReason) {
      this.stopReason = other.stopReason;
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
    this.toolCallBuffers.clear();
    this.completedToolCalls = [];
    this.toolResults.clear();
    this.providerStatus = 'incomplete';
    this.stopReason = undefined;
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
      toolCallBuffers: new Map(this.toolCallBuffers),
      completedToolCalls: [...this.completedToolCalls],
      toolResults: new Map(this.toolResults),
      currentIteration: this.currentIteration,
      usage: { ...this.usage },
      status: this.status,
      providerStatus: this.providerStatus,
      stopReason: this.stopReason,
      startTime: this.startTime,
      endTime: this.endTime,
    };
  }
}
