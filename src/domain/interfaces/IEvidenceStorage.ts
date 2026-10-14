/** Host-bound evidence ownership. Never accept this scope from a model tool argument. */
export interface EvidenceScope {
  ownerId: string;
  namespace: string;
  tenantId?: string;
}

/** Acknowledgement strength; fsync is local filesystem durability, not replication. */
export type EvidenceDurability = 'process' | 'restart' | 'fsync';

export interface EvidenceReference {
  version: 1;
  id: string;
  sha256: string;
  bytes: number;
  durability: EvidenceDurability;
}

/** Immutable JSON observation, including receipts with unknown completion. */
export interface EvidenceRecord {
  version: 1;
  recordedAt: number;
  expiresAt?: number;
  source: {
    toolName: string;
    executionId: string;
    connectorName?: string;
    callId?: string;
    runId?: string;
    arguments: unknown;
    principal: { userId?: string; accountId?: string; agentId?: string };
    effect: 'read' | 'write' | 'unknown';
    status: 'succeeded' | 'failed' | 'denied' | 'cancelled' | 'timed_out';
    completion: 'settled' | 'unknown' | 'not_started';
    startedAt: number;
    durationMs: number;
    executionStarted?: boolean;
    cancellation?: 'none' | 'requested' | 'acknowledged';
    timeoutMs?: number;
    late?: boolean;
  };
  /** Absent for unresolved/error receipts. Exact JSON result after host redaction. */
  result?: unknown;
}

export interface EvidenceReadOptions {
  /** UTF-16 character offset in serialized JSON. */
  offset?: number;
  /** Maximum characters, capped at the store's maxReadChars (default 8192). */
  limit?: number;
  signal?: AbortSignal;
}
export interface EvidenceChunk {
  reference: EvidenceReference;
  text: string;
  nextOffset?: number;
  totalChars: number;
}
export interface EvidenceEntry {
  reference: EvidenceReference;
  recordedAt: number;
  expiresAt?: number;
  toolName: string;
  callId?: string;
  status: EvidenceRecord['source']['status'];
  completion: EvidenceRecord['source']['completion'];
  effect: EvidenceRecord['source']['effect'];
}

/** Scoped immutable records. Missing/expired references return null; corruption throws. */
export interface IEvidenceStorage {
  readonly scope: Readonly<EvidenceScope>;
  readonly durability: EvidenceDurability;
  /** Optional middleware serialization budget. Bundled stores expose their effective record/scope byte cap. */
  readonly serializationLimitBytes?: number;
  put(record: EvidenceRecord): Promise<EvidenceReference>;
  /** Optional efficient scoped ID lookup; implementations verify stored integrity before returning metadata. */
  getReference?(id: string, signal?: AbortSignal): Promise<EvidenceReference | null>;
  /** Integrity checks cover the entire bounded blob even when reading a chunk. */
  read(reference: EvidenceReference, options?: EvidenceReadOptions): Promise<EvidenceChunk | null>;
  /** Host-only full read, still bounded by maxRecordBytes (default 4 MiB). */
  readRecord(reference: EvidenceReference): Promise<EvidenceRecord | null>;
  list(options?: { after?: string; limit?: number; signal?: AbortSignal }): Promise<{ entries: EvidenceEntry[]; next?: string }>;
  delete(reference: EvidenceReference): Promise<boolean>;
  /** Explicit host maintenance; no scratch eviction or compaction deletes evidence. */
  pruneExpired(now?: number): Promise<number>;
}
