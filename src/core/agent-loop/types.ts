import type { TaskStateSnapshot } from '../context-nextgen/plugins/TaskStatePluginNextGen.js';
import type { AgentLoopObservation } from '../../domain/entities/AgentLoop.js';
export type { AgentLoopReason, AgentLoopDiagnostics, AgentLoopObservation } from '../../domain/entities/AgentLoop.js';

type ReadonlyData<T> = T extends object ? { readonly [K in keyof T]: ReadonlyData<T[K]> } : T;

export interface AgentLoopCheckContext {
  executionId: string;
  iteration: number;
  /** Bounded candidate text, not proof that any action completed. */
  outputText: string;
  outputTruncated: boolean;
  /** Last 100 observed executions, as detached metadata. */
  observations: readonly ReadonlyData<AgentLoopObservation>[];
  observedToolCalls: number;
  observationsTruncated: boolean;
  taskState?: ReadonlyData<TaskStateSnapshot>;
  signal: AbortSignal;
}

export interface AgentLoopCompletionResult {
  complete: boolean;
  /** Human-readable host verdict; maximum 400 characters. */
  reason?: string;
  /** Explicit host feedback for another bounded model turn; maximum 2000 characters. */
  feedback?: string;
}

/** Opt-in managed text-loop policy. Host callbacks are never restored from sessions. */
export interface AgentLoopPolicy {
  /** Shared allowance for failure/progress/completion recovery; default 2. */
  maxRecoveryAttempts?: number;
  /** Identical normalized read call/results before intervention; default 3. */
  maxRepeatedResults?: number;
  /** Consecutive failed tool observations before stopping; default 3. */
  maxConsecutiveToolFailures?: number;
  /** Unchanged host progress keys before intervention; default 3. Requires progressKey. */
  maxStalledIterations?: number;
  /** Explicitly permit repeated results for these host-declared read tools. */
  repeatableReadTools?: readonly string[];
  /** Host-owned progress state; never infer semantic progress from model prose. */
  progressKey?: (context: Readonly<AgentLoopCheckContext>) => string | Promise<string>;
  /** Host verifies its required evidence/state. Omission adds no workflow verifier. */
  completion?: (context: Readonly<AgentLoopCheckContext>) => AgentLoopCompletionResult | Promise<AgentLoopCompletionResult>;
  /** Deadline for each host callback; default 10000 ms, at most 60000 ms. */
  callbackTimeoutMs?: number;
}
