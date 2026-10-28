import type { Agent } from '../core/Agent.js';
import type { ToolExecutionOutcome } from '../domain/entities/Tool.js';
import type { ToolFunction } from '../domain/entities/Tool.js';
import type { EvidenceChunk, EvidenceReference, IEvidenceStorage } from '../domain/interfaces/IEvidenceStorage.js';
import type { ExportAgentPackageOptions, HydrateAgentPackageOptions, SerializedAgentPackage } from './types.js';

/** Independent negotiated protocol. The existing portable protocol stays literal 2. */
export const AGENT_PACKAGE_OUTCOME_PROTOCOL = 'oneringai.tool-outcomes/1' as const;
export type AgentPackageOutcomeProtocol = typeof AGENT_PACKAGE_OUTCOME_PROTOCOL;
export type RemoteOutcomeEffect = 'read' | 'write' | 'unknown';
export interface OutcomePackageRequest { protocol: AgentPackageOutcomeProtocol; packageId: string }
export interface OutcomeRequestIdentity extends OutcomePackageRequest { sessionId: string; requestId: string }
export interface OutcomeExecuteRequest extends OutcomeRequestIdentity {
  toolName: string;
  /** Expected negotiated callable/effect contract, never a grant of permission. */
  toolFingerprint: string;
  arguments: Record<string, unknown>;
  argumentsFingerprint: string;
}
export interface OutcomeEvidenceRequest extends OutcomePackageRequest {
  sessionId: string;
  reference: EvidenceReference;
  offset?: number;
  limit?: number;
}
export interface OutcomeCancelRequest extends OutcomeRequestIdentity { reason?: string }
export interface OutcomeNegotiation extends OutcomePackageRequest {
  /** Server-instance epoch. A restart does not restore process-local request authority. */
  sessionId: string;
  tools: Array<{ name: string; definitionFingerprint: string; effect: RemoteOutcomeEffect }>;
  limits: { maxRequests: number; maxInlineBytes: number; maxReadChars: number };
}
export interface RemoteOutcomeReceipt extends OutcomeRequestIdentity {
  /** Actual server instance answering this lookup; may differ after restart. */
  observedSessionId: string;
  state: 'pending' | 'settled' | 'unknown';
  admission: 'not_started' | 'started' | 'unknown';
  toolName?: string;
  /** Actual current server registration metadata, selected independently of the request hint. */
  effect?: RemoteOutcomeEffect;
  argumentsFingerprint?: string;
  serverOutcome?: ToolExecutionOutcome;
  source?: EvidenceReference;
  error?: { code: string; message: string };
}
export interface OutcomeExecuteResponse {
  receipt: RemoteOutcomeReceipt;
  /** True means a complete JSON result is present, including null/false/zero. */
  hasResult: boolean;
  result?: unknown;
}
export interface OutcomeCancelResponse { receipt: RemoteOutcomeReceipt; cancellationRequested: boolean }
export interface OutcomeEvidenceResponse extends OutcomePackageRequest { chunk: EvidenceChunk | null; contentSha256?: string; contentBytes?: number }

/** Host-supplied authenticated transport; none of these fields supply tenant authority. */
export interface RemoteOutcomeTransport {
  negotiate(request: OutcomePackageRequest, options?: { signal?: AbortSignal }): Promise<OutcomeNegotiation>;
  execute(request: OutcomeExecuteRequest, options?: { signal?: AbortSignal }): Promise<OutcomeExecuteResponse>;
  getReceipt(request: OutcomeRequestIdentity, options?: { signal?: AbortSignal }): Promise<RemoteOutcomeReceipt>;
  cancel(request: OutcomeCancelRequest, options?: { signal?: AbortSignal }): Promise<OutcomeCancelResponse>;
  readEvidence(request: OutcomeEvidenceRequest, options?: { signal?: AbortSignal }): Promise<OutcomeEvidenceResponse>;
}
export interface RemoteOutcomeAccess {
  operation: keyof RemoteOutcomeTransport;
  packageId: string;
  sessionId?: string;
  requestId?: string;
  toolName?: string;
  /** Actual current registration effect; supplied by the server, never wire hints. */
  effect?: RemoteOutcomeEffect;
  arguments?: Readonly<Record<string, unknown>>;
  reference?: Readonly<EvidenceReference>;
}
export interface AgentPackageOutcomeServerOptions<TContext = unknown> {
  storage: IEvidenceStorage;
  /** Rechecked before every operation/cache result. Context comes from the trusted transport host. */
  authorize(access: Readonly<RemoteOutcomeAccess>, context: TContext): boolean | Promise<boolean>;
  maxRequests?: number;
  maxInlineBytes?: number;
  maxReadChars?: number;
}
export interface RemoteOutcomeReport {
  operationId: string;
  sessionId: string;
  toolName: string;
  argumentsFingerprint: string;
  state: 'pending' | 'settled' | 'unknown';
  receipt?: Readonly<RemoteOutcomeReceipt>;
  /** Actual proxy observation; never overwritten with server IDs/time/completion. */
  proxyOutcome?: Readonly<ToolExecutionOutcome>;
  /** Immutable scoped binding of proxy invocation, remote request and argument fingerprint. */
  admission?: Readonly<EvidenceReference>;
  reference?: Readonly<EvidenceReference>;
  pendingSource: boolean;
  /** Tool/service charges and nested remote models are not silently charged as local LLM calls. */
  accounting: 'external_unknown';
}
export interface RemoteOutcomeCheckpoint {
  version: 1;
  /** Metadata is a recovery hint; the owning scoped backend must establish observation proof. */
  operations: Array<{
    operationId: string; sessionId: string; toolName: string; argumentsFingerprint: string;
    admission: EvidenceReference;
    proxyReceipt?: EvidenceReference;
    reference?: EvidenceReference;
  }>;
}
/** Separate outer envelope prevents an old loader from silently dropping required observations. */
export interface OutcomeAgentPackage {
  protocol: AgentPackageOutcomeProtocol;
  package: SerializedAgentPackage;
  checkpoint?: RemoteOutcomeCheckpoint;
}
type WithoutLegacyTransport<T> = T extends unknown ? Omit<T, 'remoteToolTransport'> : never;
export type HydrateAgentPackageWithOutcomesOptions = WithoutLegacyTransport<HydrateAgentPackageOptions> & {
  transport: RemoteOutcomeTransport;
  remoteToolTransport?: never;
  maxRequests?: number;
  onObservation?(report: Readonly<RemoteOutcomeReport>): void;
};
export interface RemoteOutcomeSession {
  /** Pure bounded detached metadata. No model, service, backend or receipt lookup. */
  inspect(operationId?: string): ReadonlyArray<Readonly<RemoteOutcomeReport>>;
  getReceipt(operationId: string, options?: { signal?: AbortSignal }): Promise<RemoteOutcomeReport>;
  cancel(operationId: string, options?: { signal?: AbortSignal; reason?: string }): Promise<RemoteOutcomeReport>;
  readEvidence(reference: EvidenceReference, options?: { offset?: number; limit?: number; signal?: AbortSignal }): Promise<EvidenceChunk | null>;
  /** New envelope; does not serialize callbacks, live task authority or a workflow cursor. */
  checkpoint(options?: ExportAgentPackageOptions): OutcomeAgentPackage;
  /** Tools-first construction supplies its owning Agent explicitly. */
  checkpoint(agent: Agent, options?: ExportAgentPackageOptions): OutcomeAgentPackage;
  close(): void;
}
export interface OutcomeHydratedAgent { agent: Agent; session: RemoteOutcomeSession }
/** Build tools before Agent/C6 factory construction, using the same evidence backend handle. */
export interface AgentPackageOutcomeToolOptions {
  transport: RemoteOutcomeTransport;
  storage: IEvidenceStorage;
  maxRequests?: number;
  onObservation?(report: Readonly<RemoteOutcomeReport>): void;
}
export interface AgentPackageOutcomeTools { tools: ToolFunction[]; session: RemoteOutcomeSession }
