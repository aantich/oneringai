import type { EvidenceRecord, EvidenceReference, IEvidenceStorage } from '../domain/interfaces/IEvidenceStorage.js';
import type { ToolExecutionOutcome } from '../domain/entities/Tool.js';
import type { RemoteInvocationIdentity } from '../core/tool-execution/remoteObservation.js';
import type { OutcomeExecuteRequest, RemoteOutcomeReceipt } from './outcomeTypes.js';
import { copyOutcomeData, outcomeForWire, parseOutcomeReceipt } from './outcomeWire.js';
import { isDeepStrictEqual } from 'node:util';

export const ADMISSION_KIND = 'oneringai.remote-admission/1';
export const SOURCE_KIND = 'oneringai.remote-source/1';
export const OBSERVATION_KIND = 'oneringai.remote-observation/1';
export interface Admission {
  kind: typeof ADMISSION_KIND;
  request: Omit<OutcomeExecuteRequest, 'arguments'>;
  proxy: RemoteInvocationIdentity;
}
export interface SourceBody { kind: typeof SOURCE_KIND; receipt: RemoteOutcomeReceipt; payload: { hasResult: true; result: unknown } }
export interface ObservationBody {
  kind: typeof OBSERVATION_KIND; admission: EvidenceReference; request: Admission['request'];
  proxy: ToolExecutionOutcome; initialProxy?: ToolExecutionOutcome; receipt: RemoteOutcomeReceipt; payload: { hasResult: true; result: unknown };
}
export function requestMetadata(request: OutcomeExecuteRequest): Admission['request'] {
  const { arguments: _args, ...metadata } = request; return copyOutcomeData(metadata);
}
export function admissionRecord(admission: Admission): EvidenceRecord {
  const p = admission.proxy;
  return { version: 1, recordedAt: Date.now(), source: { toolName: '$oneringai.remote-admission', executionId: `admission:${admission.request.requestId}`,
    arguments: {}, principal: { ...p.principal }, effect: 'read', status: 'succeeded', completion: 'settled', startedAt: p.startedAt, durationMs: 0 }, result: admission };
}
export function sourceRecord(outcome: ToolExecutionOutcome, args: unknown, principal: EvidenceRecord['source']['principal'], effect: EvidenceRecord['source']['effect'], body: unknown): EvidenceRecord {
  const { executionId, toolName, startedAt, durationMs, status, completion, executionStarted, cancellation, callId, runId } = outcome;
  return { version: 1, recordedAt: Date.now(), source: { executionId, toolName, startedAt, durationMs, status, completion, executionStarted, cancellation,
    ...(callId === undefined ? {} : { callId }), ...(runId === undefined ? {} : { runId }), arguments: args, principal, effect }, result: body };
}
export async function readAdmission(storage: IEvidenceStorage, reference: EvidenceReference, expected: Admission['request']): Promise<Admission> {
  const record = await storage.readRecord(reference), a = record?.result as Admission | undefined;
  if (!record || record.source.toolName !== '$oneringai.remote-admission' || a?.kind !== ADMISSION_KIND || !isDeepStrictEqual(a.request, expected)
    || !a.proxy?.executionId || a.proxy.toolName !== expected.toolName || record.source.executionId !== `admission:${expected.requestId}`) throw new Error('Remote admission proof is unavailable');
  return copyOutcomeData(a);
}
export function validateSource(record: EvidenceRecord | null, request: Admission['request']): SourceBody {
  const body = record?.result as SourceBody | undefined;
  if (body?.kind !== SOURCE_KIND || body.payload?.hasResult !== true) throw new Error('Remote source proof is unavailable');
  const receipt = parseOutcomeReceipt(body.receipt, request);
  if (!receipt.serverOutcome || receipt.effect !== record!.source.effect || receipt.toolName !== request.toolName || receipt.argumentsFingerprint !== request.argumentsFingerprint
    || !isDeepStrictEqual(outcomeForWire(receipt.serverOutcome), outcomeForWire({ ...receipt.serverOutcome, ...record!.source } as ToolExecutionOutcome))) throw new Error('Remote source correlation failed');
  return body;
}
export async function validateObservation(storage: IEvidenceStorage, reference: EvidenceReference, metadata: Admission['request'], admissionRef: EvidenceReference, proxy: RemoteInvocationIdentity): Promise<ObservationBody> {
  await readAdmission(storage, admissionRef, metadata);
  const record = await storage.readRecord(reference), b = record?.result as ObservationBody | undefined;
  if (!record || b?.kind !== OBSERVATION_KIND || b.payload?.hasResult !== true || !isDeepStrictEqual(b.admission, admissionRef) || !isDeepStrictEqual(b.request, metadata)
    || b.proxy.executionId !== proxy.executionId || b.proxy.callId !== proxy.callId || b.proxy.runId !== proxy.runId || b.proxy.toolName !== proxy.toolName
    || record.source.executionId !== proxy.executionId || record.source.callId !== proxy.callId || record.source.runId !== proxy.runId
    || record.source.status !== b.proxy.status || record.source.completion !== b.proxy.completion) throw new Error('Remote observation proof is unavailable');
  const receipt = parseOutcomeReceipt(b.receipt, metadata);
  if (receipt.state !== 'settled' || receipt.serverOutcome?.completion === 'unknown' || !receipt.serverOutcome && receipt.admission !== 'not_started' || receipt.toolName !== metadata.toolName || receipt.argumentsFingerprint !== metadata.argumentsFingerprint) throw new Error('Remote observation is unresolved');
  return b;
}
