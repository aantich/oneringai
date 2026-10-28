import type { PluginExecutionContext } from './types.js';

export type { ToolExecutionOutcome, ToolExecutionOptions, ToolExecutionReport } from '../../domain/entities/Tool.js';

export interface PipelineOutcome {
  status: 'succeeded' | 'failed' | 'denied' | 'timed_out';
  executionStarted: boolean;
  error?: Error;
}

// Execution-owned provenance, deliberately separate from arbitrary application data.
const failures = new WeakMap<PluginExecutionContext, Error>();
const reportedFailures = new WeakMap<PluginExecutionContext, Error>();
export function markNormalizedFailure(ctx: PluginExecutionContext, error: Error): void {
  failures.set(ctx, error);
}
export function getNormalizedFailure(ctx: PluginExecutionContext): Error | undefined {
  return failures.get(ctx);
}

/** First report belongs only to this admitted invocation; never inspect result fields. */
export function markReportedFailure(ctx: PluginExecutionContext, error: Error): void {
  if (!reportedFailures.has(ctx)) reportedFailures.set(ctx, new Error(error.message, { cause: error }));
}

export function getReportedFailure(ctx: PluginExecutionContext): Error | undefined {
  return reportedFailures.get(ctx);
}
