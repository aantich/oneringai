import type { PluginExecutionContext } from './types.js';

export type { ToolExecutionOutcome, ToolExecutionOptions, ToolExecutionReport } from '../../domain/entities/Tool.js';

export interface PipelineOutcome {
  status: 'succeeded' | 'failed' | 'denied' | 'timed_out';
  executionStarted: boolean;
  error?: Error;
}

// Execution-owned provenance, deliberately separate from arbitrary application data.
const failures = new WeakMap<PluginExecutionContext, Error>();
export function markNormalizedFailure(ctx: PluginExecutionContext, error: Error): void {
  failures.set(ctx, error);
}
export function getNormalizedFailure(ctx: PluginExecutionContext): Error | undefined {
  return failures.get(ctx);
}
