import type { ThinkingConfig } from '../../domain/interfaces/ITextProvider.js';
import type { DataHandlingPolicy } from '../../domain/interfaces/IAdvancedInference.js';
import type { TokenUsage, LLMResponse } from '../../domain/entities/Response.js';
import type { ModelTask } from './ModelTask.js';

export type HelperRole = 'compactor' | 'extractor' | 'verifier';

/** Limits apply to one explicitly shared, process-local task. */
export interface ModelTaskLimits {
  maxCalls?: number;
  /** Conservative reservations use provider capacity, not estimated prompt size. */
  maxTokens?: number;
  /** Model token charges only. Requires a known conservative price bound. */
  maxCostUSD?: number;
  /** Absolute Unix time in milliseconds. */
  deadline?: number;
}

/** Host-supplied upper rates, including any service tier or cache-write premium. */
export interface ModelPriceBound {
  inputPerMillion: number;
  outputPerMillion: number;
}

export interface HelperModelConfig {
  connector: string;
  model: string;
  instructions?: string;
  thinking?: ThinkingConfig;
  temperature?: number;
  /** Defaults to 512. */
  maxOutputTokens?: number;
  /** Packet estimate limit, bounded by the helper's resolved capacity. */
  maxInputTokens?: number;
  dataHandling?: DataHandlingPolicy;
  /** Require native JSON schema support instead of the validated prompt fallback. */
  requireNativeStructuredOutput?: boolean;
  /** Required for automatic explicit-rollover transfer to another connector. */
  allowContextTransfer?: boolean;
  priceBound?: ModelPriceBound;
}

export interface ModelExecutionConfig {
  helpers?: Partial<Record<HelperRole, HelperModelConfig>>;
  limits?: ModelTaskLimits;
  /** Optional aggregate main-call output cap across candidates. Omitted preserves provider defaults. */
  maxOutputTokensPerCall?: number;
  /** Main-model upper rates when registry prices do not bound this deployment. */
  priceBound?: ModelPriceBound;
  /** Trusted host attestation for injected providers that make exactly one attempt. */
  customProviderAttempts?: 'single';
}

export interface HelperInputContext {
  readonly connector: string;
  readonly model: string;
  readonly maxInputTokens: number;
  readonly maxOutputTokens: number;
}

export interface HelperCallOptions {
  /** Optional tighter output cap; cannot increase the configured role limit. */
  maxOutputTokens?: number;
  /** @internal Explicit rollover marks automatic context transfer for admission checks. */
  contextTransfer?: boolean;
  /** Host-supplied JSON schema, validated locally after generation. */
  schema: Record<string, unknown>;
  /** Additional local JSON-schema constraints supplied as prompt guidance; both schemas must pass within the same repair allowance. */
  validationSchema?: Record<string, unknown>;
  /** Explicit sharing only; omission creates an independent owned helper task. */
  modelTask?: ModelTask;
  parentInvocationId?: string;
  signal?: AbortSignal;
  /** Defaults to one repair; supported values are 0 or 1. */
  maxRepairAttempts?: 0 | 1;
}

export interface HelperResult<T = unknown> {
  value: T;
  response: LLMResponse;
  invocationId: string;
  taskId: string;
}

export interface ModelCallDescriptor {
  purpose: string;
  phase?: 'generation' | 'repair' | 'wrapup';
  connector: string;
  model: string;
  parentInvocationId?: string;
  inputTokenBound: number;
  outputTokenBound: number;
  priceBound?: ModelPriceBound;
}

export interface ModelAttemptRecord {
  id: string;
  invocationId: string;
  boundary: 'transport' | 'provider';
  status: 'reserved' | 'received' | 'failed' | 'not_dispatched';
  httpStatus?: number;
  dispatched: boolean;
  reservedTokens: number;
  reservedCostUSD: number | null;
  /** Aggregate successful-attempt usage is recorded once on the invocation. */
  usageCoveredByInvocation: boolean;
}

export interface ModelInvocationRecord {
  id: string;
  parentInvocationId?: string;
  purpose: string;
  phase: 'generation' | 'repair' | 'wrapup';
  connector: string;
  model: string;
  status: 'running' | 'succeeded' | 'failed' | 'cancelled';
  usage: TokenUsage | null;
  modelCostUSD: number | null;
  lateSettlement: boolean;
  external: boolean;
  /** Helper output validation is distinct from receiving a model response. */
  outputValidation?: 'passed' | 'failed';
}

export interface ModelTaskSnapshot {
  id: string;
  limits: ModelTaskLimits;
  invocations: ModelInvocationRecord[];
  attempts: ModelAttemptRecord[];
  totals: {
    calls: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cachedInputTokens: number;
    reasoningTokens: number;
    knownModelCostUSD: number;
    unknownUsageInvocations: number;
    unknownCostInvocations: number;
    unknownChargeAttempts: number;
    chargedTokens: number;
    chargedCostUSD: number | null;
  };
}
