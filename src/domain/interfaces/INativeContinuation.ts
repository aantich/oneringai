import type { EvidenceReference, EvidenceScope } from './IEvidenceStorage.js';

/** Secret-free configured identity; metadata does not authenticate an account. */
export interface NativeContinuationBinding {
  provider: string;
  connector: string;
  endpoint: string;
  model: string;
  userId?: string;
  accountId?: string;
  /** Secret-free host principal/account selection fingerprint. */
  authority?: string;
  scope: EvidenceScope;
}

/** Optional checkpoint envelope. Never restores policy, credentials or a ModelTask. */
export interface NativeContinuationSnapshot {
  version: 1;
  binding: NativeContinuationBinding;
  protocol: string;
  prefixLength: number;
  prefixHash: string;
  sourceReferences: EvidenceReference[];
  state?: Record<string, unknown>;
}
