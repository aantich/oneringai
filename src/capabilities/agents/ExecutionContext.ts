/**
 * Execution context - tracks state, metrics, and history for agent execution
 * Includes memory safety (circular buffers) and resource limits
 */

import { AgentResponse } from '../../domain/entities/Response.js';
import { TextGenerateOptions } from '../../domain/interfaces/ITextProvider.js';
import { ToolCall, ToolResult, ToolCallState } from '../../domain/entities/Tool.js';

export type HistoryMode = 'none' | 'summary' | 'full';

export interface ExecutionContextConfig {
  maxHistorySize?: number; // Max iterations to store (default: 10)
  historyMode?: HistoryMode; // What to store (default: 'summary')
  maxAuditTrailSize?: number; // Max audit entries (default: 1000)
}

export interface IterationRecord {
  iteration: number;
  request: TextGenerateOptions;
  response: AgentResponse;
  toolCalls: ToolCall[];
  toolResults: ToolResult[];
  startTime: Date;
  endTime: Date;
}

export interface IterationSummary {
  iteration: number;
  tokens: number;
  toolCount: number;
  duration: number;
  timestamp: Date;
}

export interface ExecutionMetrics {
  // Timing
  totalDuration: number;
  llmDuration: number;
  toolDuration: number;
  hookDuration: number;

  // Counts
  iterationCount: number;
  toolCallCount: number;
  toolSuccessCount: number;
  toolFailureCount: number;
  toolTimeoutCount: number;

  // Tokens
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** Optional for source compatibility; ExecutionContext instances always initialize this to 0. */
  cachedInputTokens?: number;
  /** Optional for source compatibility; ExecutionContext instances always initialize this to 0. */
  cacheCreationInputTokens?: number;
  /** Optional for source compatibility; ExecutionContext instances always initialize this to 0. */
  reasoningTokens?: number;
  /** Optional for source compatibility; ExecutionContext instances always initialize this to {}. */
  nativeToolCalls?: Record<string, number>;

  // Errors
  errors: Array<{ type: string; message: string; timestamp: Date }>;
}

export interface AuditEntry {
  timestamp: Date;
  type:
    | 'hook_executed'
    | 'tool_modified'
    | 'tool_skipped'
    | 'execution_paused'
    | 'execution_resumed'
    | 'tool_approved'
    | 'tool_rejected'
    | 'tool_blocked'
    | 'tool_permission_approved';
  hookName?: string;
  toolName?: string;
  details: any;
}

export class ExecutionContext {
  // Execution metadata
  readonly executionId: string;
  readonly startTime: Date;
  iteration: number = 0;

  // Tool tracking
  readonly toolCalls: Map<string, ToolCall> = new Map();
  readonly toolResults: Map<string, ToolResult> = new Map();

  // Control state
  paused: boolean = false;
  pauseReason?: string;
  cancelled: boolean = false;
  cancelReason?: string;

  // User data (for hooks to share state)
  readonly metadata: Map<string, any> = new Map();

  // History storage (memory-safe)
  private readonly config: ExecutionContextConfig;
  private readonly iterations: IterationRecord[] = [];
  private readonly iterationSummaries: IterationSummary[] = [];

  // Metrics
  readonly metrics: ExecutionMetrics = {
    totalDuration: 0,
    llmDuration: 0,
    toolDuration: 0,
    hookDuration: 0,
    iterationCount: 0,
    toolCallCount: 0,
    toolSuccessCount: 0,
    toolFailureCount: 0,
    toolTimeoutCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cachedInputTokens: 0,
    cacheCreationInputTokens: 0,
    reasoningTokens: 0,
    nativeToolCalls: {},
    errors: [],
  };

  // Audit trail
  private readonly auditTrail: AuditEntry[] = [];

  constructor(
    executionId: string,
    config: ExecutionContextConfig = {}
  ) {
    this.executionId = executionId;
    this.startTime = new Date();
    this.config = {
      maxHistorySize: config.maxHistorySize || 10,
      historyMode: config.historyMode || 'summary',
      maxAuditTrailSize: config.maxAuditTrailSize || 1000,
    };
  }

  /**
   * Add iteration to history (memory-safe)
   */
  addIteration(record: IterationRecord): void {
    switch (this.config.historyMode) {
      case 'none':
        // Don't store anything
        break;

      case 'summary':
        // Store lightweight summary only
        this.iterationSummaries.push({
          iteration: record.iteration,
          tokens: record.response.usage.total_tokens,
          toolCount: record.toolCalls.length,
          duration: record.endTime.getTime() - record.startTime.getTime(),
          timestamp: record.startTime,
        });

        // Keep circular buffer
        if (this.iterationSummaries.length > this.config.maxHistorySize!) {
          this.iterationSummaries.shift();
        }
        break;

      case 'full':
        // Store full iteration data
        this.iterations.push(record);

        // Keep circular buffer
        if (this.iterations.length > this.config.maxHistorySize!) {
          this.iterations.shift();
        }
        break;
    }
  }

  /**
   * Get iteration history
   */
  getHistory(): IterationRecord[] | IterationSummary[] {
    return this.config.historyMode === 'full' ? this.iterations : this.iterationSummaries;
  }

  /**
   * Add audit entry
   */
  audit(type: AuditEntry['type'], details: any, hookName?: string, toolName?: string): void {
    this.auditTrail.push({
      timestamp: new Date(),
      type,
      hookName,
      toolName,
      details,
    });

    // Keep circular buffer
    if (this.auditTrail.length > this.config.maxAuditTrailSize!) {
      this.auditTrail.shift();
    }
  }

  /**
   * Get audit trail
   */
  getAuditTrail(): readonly AuditEntry[] {
    return this.auditTrail;
  }

  /**
   * Update metrics
   */
  updateMetrics(update: Partial<ExecutionMetrics>): void {
    Object.assign(this.metrics, update);
  }

  /**
   * Add tool call to tracking
   */
  addToolCall(toolCall: ToolCall): void {
    this.toolCalls.set(toolCall.id, toolCall);
    this.metrics.toolCallCount++;
  }

  /**
   * Add tool result to tracking
   */
  addToolResult(result: ToolResult): void {
    this.toolResults.set(result.tool_use_id, result);

    // An async acceptance placeholder is not successful completion.
    if (result.pending) return;
    // Update metrics
    if (result.state === ToolCallState.COMPLETED) {
      this.metrics.toolSuccessCount++;
    } else if (result.state === ToolCallState.FAILED) {
      this.metrics.toolFailureCount++;
    } else if (result.state === ToolCallState.TIMEOUT) {
      this.metrics.toolTimeoutCount++;
    }
  }

  /**
   * Check resource limits
   */
  checkLimits(limits?: {
    maxExecutionTime?: number;
    maxToolCalls?: number;
    maxContextSize?: number;
  }): void {
    if (!limits) return;

    // Check execution time
    if (limits.maxExecutionTime) {
      const elapsed = Date.now() - this.startTime.getTime();
      if (elapsed > limits.maxExecutionTime) {
        throw new Error(
          `Execution time limit exceeded: ${elapsed}ms > ${limits.maxExecutionTime}ms`
        );
      }
    }

    // Check tool call count
    if (limits.maxToolCalls && this.toolCalls.size > limits.maxToolCalls) {
      throw new Error(
        `Tool call limit exceeded: ${this.toolCalls.size} > ${limits.maxToolCalls}`
      );
    }

    // Check context size
    if (limits.maxContextSize) {
      const size = this.estimateSize();
      if (size > limits.maxContextSize) {
        throw new Error(
          `Context size limit exceeded: ${size} bytes > ${limits.maxContextSize} bytes`
        );
      }
    }
  }

  /**
   * Estimate memory usage (rough approximation)
   */
  private estimateSize(): number {
    try {
      const data = {
        toolCalls: Array.from(this.toolCalls.values()),
        toolResults: Array.from(this.toolResults.values()),
        iterations: this.config.historyMode === 'full' ? this.iterations : this.iterationSummaries,
        auditTrail: this.auditTrail,
      };
      return JSON.stringify(data).length;
    } catch {
      return 0; // Error estimating, return 0
    }
  }

  /**
   * Cleanup resources and release memory
   * Clears all internal arrays and maps to allow garbage collection
   */
  cleanup(): void {
    // Store execution summary before clearing
    const summary = {
      executionId: this.executionId,
      totalIterations: this.iteration,
      totalToolCalls: this.metrics.toolCallCount,
      totalDuration: Date.now() - this.startTime.getTime(),
      success: !this.cancelled && this.metrics.errors.length === 0,
    };

    // Clear all maps
    this.toolCalls.clear();
    this.toolResults.clear();
    this.metadata.clear();

    // Clear all arrays (modify length to allow GC of items)
    this.iterations.length = 0;
    this.iterationSummaries.length = 0;
    this.auditTrail.length = 0;
    this.metrics.errors.length = 0;

    // Store summary after clearing (for final access if needed)
    this.metadata.set('execution_summary', summary);
  }

  /**
   * Get execution summary
   */
  getSummary() {
    return {
      executionId: this.executionId,
      startTime: this.startTime,
      currentIteration: this.iteration,
      paused: this.paused,
      cancelled: this.cancelled,
      metrics: { ...this.metrics },
      totalDuration: Date.now() - this.startTime.getTime(),
    };
  }
}
