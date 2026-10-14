import type { ToolContext, ToolFunction, ToolExecutionOutcome } from '../../domain/entities/Tool.js';
import type { EvidenceReference, EvidenceRecord, EvidenceScope, IEvidenceStorage } from '../../domain/interfaces/IEvidenceStorage.js';
import { EvidenceError, integer, json, validateReference, containAsyncRejection, hash } from './validation.js';

/** Metadata is diagnostic; storage/projection failures never change tool-effect status. */
export interface ToolEvidenceReceipt {
  status: 'stored' | 'storage_failed' | 'projection_failed';
  reference?: EvidenceReference;
  effect: 'read' | 'write' | 'unknown';
  errorCode?: string;
}
/** Projection belongs only to the managed prompt view. Raw returns/events stay raw. */
export interface ToolEvidenceDelivery extends ToolEvidenceReceipt { projection?: string }
export interface ToolEvidenceConfig {
  storage: IEvidenceStorage;
  /** Only hinted tools with summarize() and results at least this large are projected. Default 8192 bytes. */
  projectThresholdBytes?: number;
  /** Summary cap, default 2000 characters; an oversized summary falls back to raw. */
  maxSummaryChars?: number;
  /** Whole model-facing envelope cap, default 4096 characters. */
  maxProjectionChars?: number;
  /** Deadline for acknowledgement; default 5000ms. Late writes do not authorize projection. */
  writeTimeoutMs?: number;
  retentionMs?: number;
  /** Optional pre-storage UTF-8 serialization cap; inherits storage.serializationLimitBytes when available.
   * Custom stores without a hint retain their own capacity policy unless this option is supplied. */
  maxSerializationBytes?: number;
  /** Synchronous host storage policy. Applied separately to arguments and results after credential-key redaction. */
  redact?: (value: unknown, kind: 'arguments' | 'result') => unknown;
}
interface DeliveryProvenance {
  readonly executionId: string;
  readonly callId?: string;
  readonly scope: Readonly<EvidenceScope>;
  readonly hasResult: boolean;
}
const deliveries = new WeakMap<object, DeliveryProvenance>();
const projectionSources = new WeakMap<object, { sha256: string; bytes: number }>();
export function isEvidenceDelivery(value: unknown): value is ToolEvidenceDelivery {
  return !!value && typeof value === 'object' && deliveries.has(value);
}
/** Internal correlation survives optional outcome omission without exposing new public fields. */
export function evidenceProvenance(value: unknown): DeliveryProvenance | undefined {
  return isEvidenceDelivery(value) ? deliveries.get(value) : undefined;
}
/** Internal: a mutable host result must still match the observation used to create its projection. */
export function evidenceProjection(value: unknown, result: unknown): string | undefined {
  if (!isEvidenceDelivery(value) || !value.projection) return undefined;
  const source = projectionSources.get(value);
  if (!source) return undefined;
  try { return hash(json(result, source.bytes)) === source.sha256 ? value.projection : undefined; }
  catch { return undefined; }
}
/** Strict clone first: getters/toJSON hooks must never run while persisting a result. */
function redactKeys(serialized: string): unknown {
  const copied = JSON.parse(serialized) as unknown;
  const redact = (v: unknown): void => {
    if (!v || typeof v !== 'object') return;
    for (const key of Object.keys(v)) {
      if (/^(authorization|proxy.authorization|(?:x[-_])?api.?key|access.?token|refresh.?token|id.?token|password|client.?secret|secret|cookie|set.cookie)$/i.test(key)) {
        (v as Record<string, unknown>)[key] = '[REDACTED]';
      } else redact((v as Record<string, unknown>)[key]);
    }
  };
  redact(copied);
  return copied;
}

/** Opt-in post-settlement middleware, deliberately outside the execution plugin/error pipeline. */
export class ToolEvidenceMiddleware {
  readonly storage: IEvidenceStorage;
  private readonly threshold: number;
  private readonly summaryLimit: number;
  private readonly projectionLimit: number;
  private readonly timeout: number;
  private readonly retention?: number;
  private readonly redact?: ToolEvidenceConfig['redact'];
  private readonly serializationLimit: number;
  constructor(config: ToolEvidenceConfig) {
    this.storage = config.storage;
    this.threshold = integer(config.projectThresholdBytes ?? 8192, 0);
    this.summaryLimit = integer(config.maxSummaryChars ?? 2000);
    this.projectionLimit = integer(config.maxProjectionChars ?? 4096);
    this.timeout = integer(config.writeTimeoutMs ?? 5000);
    this.retention = config.retentionMs === undefined ? undefined : integer(config.retentionMs);
    this.redact = config.redact;
    const limit = config.maxSerializationBytes ?? config.storage.serializationLimitBytes;
    this.serializationLimit = limit === undefined ? Infinity : integer(limit);
  }
  /** @internal Capture dispatched arguments under the same storage policy before a tool can mutate them. */
  _captureArguments(value: unknown): unknown {
    try { return JSON.parse(json(value === undefined ? null : value, this.serializationLimit)); }
    catch (error) { return error instanceof EvidenceError ? error : new EvidenceError('invalid'); }
  }
  private delivery(value: ToolEvidenceDelivery, provenance: DeliveryProvenance, source?: { sha256: string; bytes: number }): ToolEvidenceDelivery {
    const frozen = Object.freeze(value);
    deliveries.set(frozen, provenance);
    if (source && value.projection) projectionSources.set(frozen, source);
    return frozen;
  }
  async record(tool: ToolFunction, args: unknown, context: ToolContext, outcome: ToolExecutionOutcome,
    result?: { value: unknown }, late = false): Promise<ToolEvidenceDelivery> {
    const provenance: DeliveryProvenance = Object.freeze({ executionId: outcome.executionId,
      ...(outcome.callId === undefined ? {} : { callId: outcome.callId }), scope: Object.freeze({ ...this.storage.scope }), hasResult: !!result });
    const deliver = (value: ToolEvidenceDelivery, source?: { sha256: string; bytes: number }): ToolEvidenceDelivery => this.delivery(value, provenance, source);
    const effect = tool.output?.effect ?? 'unknown';
    let reference: EvidenceReference;
    let redacted: unknown;
    let projectionSource: { sha256: string; bytes: number } | undefined;
    try {
      if (args instanceof EvidenceError) throw args;
      if (context.userId !== undefined && context.userId !== this.storage.scope.ownerId) throw new EvidenceError('invalid');
      const clean = (value: unknown, kind: 'arguments' | 'result'): unknown => {
        const serialized = json(value, this.serializationLimit);
        if (kind === 'result') projectionSource = { sha256: hash(serialized), bytes: Buffer.byteLength(serialized) };
        const safe = redactKeys(serialized);
        // Reapply key policy after the host hook; neither mutable caller inputs nor hooks own the persisted copy.
        const transformed = this.redact ? this.redact(safe, kind) : safe;
        containAsyncRejection(transformed);
        return redactKeys(json(transformed, this.serializationLimit));
      };
      const accountId = tool.connectorAccountId ?? context.accountId ?? (tool.connectorName ? context.connectorAccounts?.[tool.connectorName] : undefined);
      const source: EvidenceRecord['source'] = {
        toolName: outcome.toolName, executionId: outcome.executionId, arguments: clean(args, 'arguments'),
        principal: {
          ...(context.userId === undefined ? {} : { userId: context.userId }),
          ...(accountId === undefined ? {} : { accountId }),
          ...(context.agentId === undefined ? {} : { agentId: context.agentId }),
        }, effect, status: outcome.status, completion: outcome.completion,
        startedAt: outcome.startedAt, durationMs: outcome.durationMs, executionStarted: outcome.executionStarted, cancellation: outcome.cancellation,
        ...(outcome.timeoutMs === undefined ? {} : { timeoutMs: outcome.timeoutMs }),
        ...(tool.connectorName === undefined ? {} : { connectorName: tool.connectorName }),
        ...(outcome.callId === undefined ? {} : { callId: outcome.callId }),
        ...(outcome.runId === undefined ? {} : { runId: outcome.runId }), ...(late ? { late: true } : {}),
      };
      const recordedAt = Date.now();
      const record: EvidenceRecord = { version: 1, recordedAt, source,
        ...(this.retention === undefined ? {} : { expiresAt: recordedAt + this.retention }) };
      if (result) { redacted = clean(result.value, 'result'); record.result = redacted; }
      // Bound the full observation (not just each field) before passing it to a custom backend.
      if (this.serializationLimit !== Infinity) json(record, this.serializationLimit);
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        reference = await Promise.race([this.storage.put(record), new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new EvidenceError('storage')), this.timeout);
        })]);
      } finally { clearTimeout(timer); }
      validateReference(reference);
      reference = Object.freeze({ version: 1, id: reference.id, sha256: reference.sha256, bytes: reference.bytes, durability: reference.durability });
    } catch (error) {
      return deliver({ status: 'storage_failed', effect, errorCode: error instanceof EvidenceError ? error.code : 'storage' });
    }
    if (!result || !tool.output?.summarize || Buffer.byteLength(json(redacted, this.serializationLimit)) < this.threshold || late || outcome.cancellation !== 'none') {
      return deliver({ status: 'stored', effect, reference });
    }
    try {
      // A detached redacted copy prevents a projector from modifying application returns or stored data.
      const summary: unknown = tool.output.summarize(JSON.parse(json(redacted, this.serializationLimit)));
      if (typeof summary !== 'string') {
        // JS callers can accidentally supply an async projector. Reject it without
        // allowing a later rejected promise to crash after the tool effect settled.
        containAsyncRejection(summary);
        throw new EvidenceError('invalid');
      }
      if (!summary.trim() || summary.length > this.summaryLimit) throw new EvidenceError('invalid');
      const projection = JSON.stringify({ evidence: reference, tool: outcome.toolName, callId: outcome.callId,
        status: outcome.status, completion: outcome.completion, effect, summary });
      if (projection.length > this.projectionLimit) throw new EvidenceError('capacity');
      return deliver({ status: 'stored', effect, reference, projection }, projectionSource);
    } catch {
      return deliver({ status: 'projection_failed', effect, reference, errorCode: 'projection' });
    }
  }
}
