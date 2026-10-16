import type { TaskStatus } from './Task.js';
import type { ToolExecutionOutcome } from './Tool.js';

export type AgentLoopReason = 'answer_returned' | 'completed' | 'predicate_unmet'
  | 'recovery_exhausted' | 'repeated_results' | 'repeated_action' | 'tool_failures'
  | 'no_progress' | 'uncertain_effect' | 'pending_async' | 'refusal' | 'provider_failed' | 'provider_incomplete'
  | 'iteration_limit' | 'budget_exhausted' | 'checker_error' | 'state_changed' | 'cancelled' | 'suspended';

/** Detached execution diagnostics, independent of provider generation status. */
export interface AgentLoopDiagnostics {
  version: 1;
  executionId: string;
  phase: 'running' | 'recovering' | 'complete' | 'input_needed' | 'stopped';
  /** Existing task vocabulary. Ordinary unchecked answers have no completion status. */
  status?: TaskStatus;
  reason?: AgentLoopReason;
  detail?: string;
  iterations: number;
  recoveryAttempts: number;
  observedToolCalls: number;
  consecutiveToolFailures: number;
  repeatedResults: number;
  stalledIterations: number;
  completion?: { complete: boolean; reason?: string };
  uncertainEffects: Array<{ toolName: string; callId?: string; executionId?: string }>;
}

/** Metadata only; raw arguments/results stay in existing tool/evidence surfaces. */
export interface AgentLoopObservation {
  toolName: string;
  callId?: string;
  effect: 'read' | 'write' | 'unknown';
  outcome?: Omit<ToolExecutionOutcome, 'error'>;
}
