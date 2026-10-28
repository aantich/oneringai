import type { Agent } from '../Agent.js';
import type { ExecuteRoutineOptions } from '../routineRunner.js';
import type { AgentResponse } from '../../domain/entities/Response.js';
import type { EvidenceReference } from '../../domain/interfaces/IEvidenceStorage.js';
import type { RoutineDefinition } from '../../domain/entities/Routine.js';
import type { ToolContext, ToolExecutionOutcome, ToolFunction } from '../../domain/entities/Tool.js';
import type { ModelTaskSnapshot } from '../model-execution/types.js';
import type { ExecutionBinding } from '../execution/composition.js';
export type { ExecutionBinding } from '../execution/composition.js';

export type VerificationDecision =
  | { kind: 'verified'; references?: readonly EvidenceReference[] }
  | { kind: 'waiting' | 'blocked' | 'uncertain'; reason: string; references?: readonly EvidenceReference[] };

export interface RoutineSource {
  readonly id: string;
  readonly kind: 'response' | 'step' | 'tool' | 'observation';
  readonly retained: 'operation' | 'evidence';
  readonly reference?: Readonly<EvidenceReference>;
  /** Small tool sources can be inline; other bodies use the phase/step fields or a reference. */
  readonly data?: unknown;
}
export interface RoutineTaskSummary {
  readonly id: string;
  readonly executionId?: string;
  readonly name: string;
  readonly state: 'pending' | 'running' | 'settled' | 'skipped' | 'verified' | 'failed';
  readonly verification?: VerificationDecision;
  readonly references?: readonly EvidenceReference[];
}
export interface RoutineStepObservation {
  readonly id: string;
  readonly name: string;
  readonly phase: 'pre' | 'post';
  readonly state: 'succeeded' | 'failed' | 'skipped' | 'uncertain';
  readonly result?: unknown;
  readonly sourceId?: string;
  readonly references?: readonly EvidenceReference[];
}
interface RoutineObservationBase {
  readonly operationId: string;
  /** Disambiguates repeated task IDs in nested/iterated executions. */
  readonly executionId?: string;
  readonly reason: 'settled' | 'reconcile';
  readonly tasks: readonly RoutineTaskSummary[];
  readonly toolOutcomes: readonly Readonly<ToolExecutionOutcome>[];
  readonly stepOutcomes: readonly RoutineStepObservation[];
  /** Exact sources may be retained for host recovery rather than copied into a view. */
  readonly sources: readonly RoutineSource[];
  /** All required source data is inline or explicitly archived, not a semantic truth claim. */
  readonly complete: boolean;
  readonly quality?: { readonly checked: boolean; readonly passed: boolean; readonly warning?: string };
  readonly initialVerification?: VerificationDecision;
  readonly verification?: VerificationDecision;
}
export type RoutineObservation = RoutineObservationBase & (
  | { readonly phase: 'task'; readonly taskId: string; readonly response?: Readonly<AgentResponse> }
  | { readonly phase: 'routine'; readonly taskId?: never; readonly response?: never }
);
export interface VerificationContext {
  readonly execution: Readonly<ExecutionBinding>;
  readonly signal: AbortSignal;
}
declare const continuationBrand: unique symbol;
/** Same-process capability issued by one runner; JSON cannot restore it. */
export interface RoutineContinuation { readonly [continuationBrand]: true }
export interface RoutineReport {
  readonly operationId: string;
  readonly observations: readonly RoutineObservation[];
  readonly usage?: Readonly<ModelTaskSnapshot>;
  readonly usageOmitted?: 'observation_capacity' | 'unavailable';
  readonly accounting: 'shared' | 'independent';
}
export type RoutineRunResult = RoutineReport & (
  | { state: 'completed'; verification: Extract<VerificationDecision, { kind: 'verified' }> }
  | { state: 'waiting' | 'blocked' | 'uncertain'; reason: string; continuation: RoutineContinuation }
  | { state: 'failed' | 'cancelled'; reason: string }
);
export type RoutineRunRequest = Pick<ExecuteRoutineOptions,
  'definition' | 'inputs' | 'initialUserMessage' | 'disableToolScoping' | 'hooks' | 'prompts'> & {
  agent: Agent;
  execution?: ExecutionBinding;
};
export interface RoutineToolOptions {
  definition: RoutineDefinition;
  toolName: string;
  createAgent(): Agent | Promise<Agent>;
  resolveExecution?(args: Record<string, unknown>, context: ToolContext | undefined): ExecutionBinding;
}
export interface RoutineToolResult {
  operationId: string;
  state: RoutineRunResult['state'];
  /** More references remain in the host source index. */
  omittedReferences?: number;
  references: readonly EvidenceReference[];
}
export interface RoutineInspection {
  readonly operationId: string;
  readonly lifecycle: 'running' | 'paused' | 'settling';
  readonly lastResult?: RoutineRunResult;
  readonly accounting: 'shared' | 'independent';
  readonly closed: boolean;
  readonly cleanupError?: string;
  readonly sources: readonly RoutineSource[];
  readonly omittedSources: number;
  readonly sourceIndexId: string;
}
export type RoutineProgress =
  | { kind: 'started'; operationId: string }
  | { kind: 'observation'; observation: RoutineObservation }
  | { kind: 'result'; result: RoutineRunResult };
export interface RoutineRunnerOptions {
  verify(observation: RoutineObservation, context: VerificationContext): VerificationDecision | Promise<VerificationDecision>;
  onProgress?(event: RoutineProgress): void;
  /** Aggregate observation view allowance; default 1 MiB. Unstored sources are retained. */
  maxObservationBytes?: number;
  /** Includes paused and still-settling operations; default 32. */
  maxActiveOperations?: number;
}
export interface RoutineRunner {
  run(request: RoutineRunRequest): Promise<RoutineRunResult>;
  resume(continuation: RoutineContinuation, options: {
    authorize(): boolean | Promise<boolean>;
    execution?: ExecutionBinding;
  }): Promise<RoutineRunResult>;
  asTool(options: RoutineToolOptions): ToolFunction<Record<string, unknown>, RoutineToolResult>;
  inspect(operationId: string): RoutineInspection | null;
  /** Host-only source recovery remains available for retained data after close. */
  readSource(operationId: string, sourceId: string, options?: { maxBytes?: number }): Promise<unknown>;
  /** Host assertion of archival through existing evidence/storage; never resumes actions. */
  acknowledgeSource(operationId: string, sourceId: string, reference: EvidenceReference): void;
  /** Invalidates execution handles and requests cancellation; does not assert work stopped. */
  close(): void;
}
