import type { EvidenceReference } from '../../../domain/interfaces/IEvidenceStorage.js';
import type { NativeContinuationBinding } from '../../../domain/interfaces/INativeContinuation.js';
export type { NativeContinuationBinding, NativeContinuationSnapshot } from '../../../domain/interfaces/INativeContinuation.js';
import type { TextGenerateOptions, TextCompactionResponse } from '../../../domain/interfaces/ITextProvider.js';
import type { CompactionResult } from '../types.js';

/** @internal Symbol capability avoids adding a collision-prone member to legacy contexts. */
export const COMPOSITION_OPERATION = Symbol.for('@everworker/oneringai/context-composition-operation/v1');
export type CompositionOperation = (config: Readonly<ContextCompactionStrategyConfig>) => Promise<CompactionResult>;

export interface NativeHistoryCompactionConfig {
  mode: 'native';
  /** Keep this many completed user turns exact. Default 2. */
  preserveRecentTurns?: number;
}

export interface ContextCompactionStrategyConfig {
  /** Reduction only; off does not disable a plugin or its tools. */
  plugins: 'auto' | 'off';
  history: 'native' | 'off' | NativeHistoryCompactionConfig;
  /** Default true; explicit host operations remain available when false. */
  automatic?: boolean;
}

export type ContextCompactionTarget = 'all' | 'plugins' | 'history';

export interface ContextCompactionReport {
  status: 'compacted' | 'skipped';
  trigger: 'manual' | 'pre-call';
  inputTokensBefore: number | null;
  inputTokensAfter: number | null;
  accounting: 'provider' | 'local' | 'unavailable';
  plugins: {
    status: 'compacted' | 'skipped';
    reason?: 'disabled' | 'not_selected' | 'not_needed' | 'no_reduction';
    compacted: readonly string[];
  };
  history: {
    mode: 'native' | 'off';
    status: 'compacted' | 'skipped';
    reason?: 'disabled' | 'not_selected' | 'not_needed' | 'empty' | 'protected' | 'no_reduction';
    provider?: string;
    sourceReferences: readonly EvidenceReference[];
    invocationId?: string;
  };
  checkpointed: boolean;
}

/** @internal Agent-owned native adapter and admission, not a plugin SDK client. */
export interface NativeCompactionDriver {
  binding: Omit<NativeContinuationBinding, 'scope'>;
  /** Physical provider source window; the host's smaller request budget is a separate limit. */
  maxSourceTokens?: number;
  assertCurrent(): void;
  countInput(request: TextGenerateOptions): Promise<number | null>;
  compact(request: TextGenerateOptions): Promise<{ response: TextCompactionResponse; invocationId: string }>;
}

