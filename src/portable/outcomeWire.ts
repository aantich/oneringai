import { createHash } from 'node:crypto';
import { json, validateReference } from '../core/evidence/validation.js';
import { AgentPackageCompatibilityError, assertAgentPackageCompatible, createPortableToolImplementationFingerprint } from './AgentPackage.js';
import type { FunctionToolDefinition } from '../domain/entities/Tool.js';
import { AGENT_PACKAGE_OUTCOME_PROTOCOL } from './outcomeTypes.js';
import type { OutcomeAgentPackage, OutcomePackageRequest, OutcomeExecuteRequest, OutcomeRequestIdentity,
  OutcomeCancelRequest, OutcomeEvidenceRequest, OutcomeNegotiation, RemoteOutcomeReceipt,
  OutcomeExecuteResponse, OutcomeCancelResponse, OutcomeEvidenceResponse } from './outcomeTypes.js';
import type { ToolExecutionOutcome } from '../domain/entities/Tool.js';

export const OUTCOME_MAX_REQUESTS = 1000;
export const OUTCOME_MAX_INLINE_BYTES = 1_000_000;
export const OUTCOME_MAX_ARGUMENT_BYTES = 1_000_000;
export const OUTCOME_MAX_READ_CHARS = 65536;
export const OUTCOME_MAX_PACKAGE_BYTES = 12_000_000;
const baseKeys = ['protocol', 'packageId'], identityKeys = [...baseKeys, 'sessionId', 'requestId'];
const receiptKeys = [...identityKeys, 'observedSessionId', 'state', 'admission', 'toolName', 'argumentsFingerprint', 'effect', 'serverOutcome', 'source', 'error'];
const outcomeKeys = ['executionId', 'toolName', 'callId', 'runId', 'status', 'startedAt', 'durationMs', 'executionStarted', 'completion', 'cancellation', 'timeoutMs', 'error', 'evidence'];
type Data = Record<string, any>;
const invalid = (field: string): never => { throw new AgentPackageCompatibilityError(`Invalid remote outcome ${field}`); };
const object = (value: unknown, field: string): Data => value && typeof value === 'object' && !Array.isArray(value) ? value as Data : invalid(field);
const keys = (value: Data, allowed: readonly string[], field: string): void => { if (Object.keys(value).some(key => !allowed.includes(key))) invalid(`${field} fields`); };
const string = (value: unknown, field: string, maximum = 256): void => { if (typeof value !== 'string' || !value || value.length > maximum) invalid(field); };
const integer = (value: unknown, field: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): void => { if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) invalid(field); };
const effect = (value: unknown): void => { if (!['read', 'write', 'unknown'].includes(value as string)) invalid('effect'); };
const fingerprint = (value: unknown): void => { if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) invalid('argument fingerprint'); };
const reference = (value: unknown): void => { const r = object(value, 'reference'); keys(r, ['version', 'id', 'sha256', 'bytes', 'durability'], 'reference'); try { validateReference(r as any); } catch { invalid('reference'); } };
export function copyOutcomeData<T>(value: T, maximum = OUTCOME_MAX_ARGUMENT_BYTES): T {
  try { return JSON.parse(json(value, maximum)) as T; } catch { return invalid('JSON data or capacity'); }
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Data)[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
export function outcomeArgumentsFingerprint(toolName: string, args: Record<string, unknown>): string {
  string(toolName, 'tool name'); const data = copyOutcomeData(args);
  object(data, 'arguments');
  return createHash('sha256').update('oneringai.remote-arguments/1\0').update(toolName).update('\0').update(canonical(data)).digest('hex');
}
/** Negotiated callable schema, excluding dynamic presentation; admission also pins executable identity. */
export function outcomeDefinitionFingerprint(definition: FunctionToolDefinition): string {
  return createPortableToolImplementationFingerprint(definition, 'oneringai-remote-callable-contract/1');
}
export function outcomeToolFingerprint(definitionFingerprint: string, selectedEffect: 'read' | 'write' | 'unknown'): string {
  return createHash('sha256').update('oneringai.remote-tool/1\0').update(definitionFingerprint).update('\0').update(selectedEffect).digest('hex');
}
function packageIdentity(value: Data, expectedPackage?: string): void {
  if (value.protocol !== AGENT_PACKAGE_OUTCOME_PROTOCOL) invalid('protocol'); string(value.packageId, 'package ID');
  if (expectedPackage !== undefined && value.packageId !== expectedPackage) invalid('package correlation');
}
function identity(value: Data, expectedPackage?: string): void { packageIdentity(value, expectedPackage); string(value.sessionId, 'session ID'); string(value.requestId, 'request ID'); }
interface Requests {
  negotiate: OutcomePackageRequest; execute: OutcomeExecuteRequest; getReceipt: OutcomeRequestIdentity;
  cancel: OutcomeCancelRequest; readEvidence: OutcomeEvidenceRequest;
}
export function parseOutcomeRequest<K extends keyof Requests>(input: unknown, operation: K, expectedPackage?: string): Requests[K] {
  const value = object(copyOutcomeData(input, OUTCOME_MAX_ARGUMENT_BYTES + 8192), 'request'); packageIdentity(value, expectedPackage);
  if (operation === 'negotiate') keys(value, baseKeys, 'negotiate');
  else if (operation === 'readEvidence') {
    keys(value, [...baseKeys, 'sessionId', 'reference', 'offset', 'limit'], 'readEvidence'); string(value.sessionId, 'session ID'); reference(value.reference);
    if (value.offset !== undefined) integer(value.offset, 'offset'); if (value.limit !== undefined) integer(value.limit, 'limit', 1, OUTCOME_MAX_READ_CHARS);
  } else {
    identity(value, expectedPackage);
    if (operation === 'execute') {
      keys(value, [...identityKeys, 'toolName', 'toolFingerprint', 'arguments', 'argumentsFingerprint'], 'execute'); string(value.toolName, 'tool name'); object(value.arguments, 'arguments'); fingerprint(value.argumentsFingerprint); fingerprint(value.toolFingerprint);
      if (value.argumentsFingerprint !== outcomeArgumentsFingerprint(value.toolName, value.arguments)) invalid('argument correlation');
    } else if (operation === 'cancel') { keys(value, [...identityKeys, 'reason'], 'cancel'); if (value.reason !== undefined) string(value.reason, 'reason', 512); }
    else keys(value, identityKeys, 'receipt lookup');
  }
  return value as Requests[K];
}
export function parseOutcomePackage(input: unknown): OutcomeAgentPackage {
  const value = object(copyOutcomeData(input, OUTCOME_MAX_PACKAGE_BYTES), 'package'); keys(value, ['protocol', 'package', 'checkpoint'], 'package');
  if (value.protocol !== AGENT_PACKAGE_OUTCOME_PROTOCOL) invalid('package protocol'); assertAgentPackageCompatible(value.package);
  if (value.checkpoint !== undefined) {
    const checkpoint = object(value.checkpoint, 'checkpoint'); keys(checkpoint, ['version', 'operations'], 'checkpoint');
    if (checkpoint.version !== 1 || !Array.isArray(checkpoint.operations) || checkpoint.operations.length > OUTCOME_MAX_REQUESTS) invalid('checkpoint');
    const seen = new Set<string>();
    for (const item of checkpoint.operations) {
      const operation = object(item, 'checkpoint operation'); keys(operation, ['operationId', 'sessionId', 'toolName', 'argumentsFingerprint', 'admission', 'proxyReceipt', 'reference'], 'checkpoint operation');
      for (const key of ['operationId', 'sessionId', 'toolName']) string(operation[key], key); fingerprint(operation.argumentsFingerprint); reference(operation.admission);
      if (operation.reference !== undefined) reference(operation.reference); if (operation.proxyReceipt !== undefined) reference(operation.proxyReceipt);
      if (seen.has(operation.operationId)) invalid('duplicate checkpoint operation'); seen.add(operation.operationId);
    }
  }
  return value as OutcomeAgentPackage;
}
export function parseOutcomeNegotiation(input: unknown, packageId: string): OutcomeNegotiation {
  const value = object(copyOutcomeData(input), 'negotiation'); keys(value, [...baseKeys, 'sessionId', 'tools', 'limits'], 'negotiation'); packageIdentity(value, packageId); string(value.sessionId, 'session ID');
  if (!Array.isArray(value.tools) || value.tools.length > 512) invalid('tools'); const seen = new Set<string>();
  for (const item of value.tools) {
    const tool = object(item, 'tool'); keys(tool, ['name', 'definitionFingerprint', 'effect'], 'tool'); string(tool.name, 'tool name');
    if (typeof tool.definitionFingerprint !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(tool.definitionFingerprint)) invalid('definition fingerprint');
    effect(tool.effect); if (seen.has(tool.name)) invalid('duplicate tool'); seen.add(tool.name);
  }
  const limits = object(value.limits, 'limits'); keys(limits, ['maxRequests', 'maxInlineBytes', 'maxReadChars'], 'limits');
  integer(limits.maxRequests, 'max requests', 1, OUTCOME_MAX_REQUESTS); integer(limits.maxInlineBytes, 'inline bytes', 0, OUTCOME_MAX_INLINE_BYTES); integer(limits.maxReadChars, 'read characters', 1, OUTCOME_MAX_READ_CHARS);
  return value as OutcomeNegotiation;
}
/** Copy only actual defined outcome fields, omitting private companions and raw error text. */
export function outcomeForWire(value: ToolExecutionOutcome): ToolExecutionOutcome {
  const copied = Object.fromEntries(outcomeKeys.filter(key => key !== 'error' && (value as any)[key] !== undefined).map(key => [key, (value as any)[key]]));
  if (value.error !== undefined) copied.error = 'Tool operation failed';
  return copyOutcomeData(copied) as unknown as ToolExecutionOutcome;
}
function actualOutcome(input: unknown): Data {
  const value = object(input, 'server outcome'); keys(value, outcomeKeys, 'server outcome'); string(value.executionId, 'execution ID'); string(value.toolName, 'tool name');
  for (const key of ['callId', 'runId']) if (value[key] !== undefined) string(value[key], key);
  if (!['succeeded', 'failed', 'denied', 'cancelled', 'timed_out'].includes(value.status) || !['settled', 'unknown', 'not_started'].includes(value.completion)
    || !['none', 'requested', 'acknowledged'].includes(value.cancellation) || typeof value.executionStarted !== 'boolean') invalid('outcome state');
  for (const key of ['startedAt', 'durationMs']) if (typeof value[key] !== 'number' || !Number.isFinite(value[key]) || value[key] < 0) invalid(key);
  if (value.executionStarted === false && value.completion !== 'not_started' || value.completion === 'not_started' && value.executionStarted !== false
    || value.status === 'succeeded' && (value.completion !== 'settled' || !value.executionStarted)) invalid('outcome completion');
  if (value.timeoutMs !== undefined) integer(value.timeoutMs, 'timeout', 0, 2147483647);
  if (value.error !== undefined) string(value.error, 'error', 512);
  if (value.evidence !== undefined) {
    const evidence = object(value.evidence, 'outcome evidence'); keys(evidence, ['status', 'effect', 'reference', 'errorCode'], 'outcome evidence'); effect(evidence.effect);
    if (!['stored', 'storage_failed', 'projection_failed'].includes(evidence.status)) invalid('evidence status');
    if (evidence.reference !== undefined) reference(evidence.reference); if (evidence.errorCode !== undefined) string(evidence.errorCode, 'evidence error', 128);
  }
  return value;
}
export function parseOutcomeReceipt(input: unknown, expected?: OutcomeRequestIdentity): RemoteOutcomeReceipt {
  const value = object(copyOutcomeData(input), 'receipt'); keys(value, receiptKeys, 'receipt'); identity(value, expected?.packageId); string(value.observedSessionId, 'observing session');
  if (expected && (value.requestId !== expected.requestId || value.sessionId !== expected.sessionId)) invalid('receipt correlation');
  if (!['pending', 'settled', 'unknown'].includes(value.state) || !['not_started', 'started', 'unknown'].includes(value.admission)) invalid('receipt state');
  if (value.toolName !== undefined) string(value.toolName, 'tool name'); if (value.argumentsFingerprint !== undefined) fingerprint(value.argumentsFingerprint); if (value.effect !== undefined) effect(value.effect);
  if (value.error !== undefined) { const error = object(value.error, 'error'); keys(error, ['code', 'message'], 'error'); string(error.code, 'error code', 128); string(error.message, 'error message', 512); }
  if (value.source !== undefined) reference(value.source);
  if (value.serverOutcome !== undefined) {
    const outcome = actualOutcome(value.serverOutcome);
    if (value.state === 'unknown' || outcome.toolName !== value.toolName || outcome.callId !== value.requestId
      || value.observedSessionId !== value.sessionId || value.admission !== (outcome.executionStarted ? 'started' : 'not_started')
      || value.state === 'settled' && outcome.completion === 'unknown' || value.state === 'pending' && outcome.completion !== 'unknown') invalid('server outcome correlation');
  } else if (value.state === 'settled' && (value.admission !== 'not_started' || !value.error)) invalid('missing settled outcome');
  if (value.state === 'unknown' && value.admission !== 'unknown') invalid('unknown admission');
  if (value.state !== 'unknown' && (!value.toolName || !value.argumentsFingerprint || !value.effect)) invalid('admitted metadata');
  return value as RemoteOutcomeReceipt;
}
export function parseOutcomeExecuteResponse(input: unknown, request: OutcomeExecuteRequest, inlineMaximum: number): OutcomeExecuteResponse {
  const value = object(copyOutcomeData(input, inlineMaximum + 32768), 'execute response'); keys(value, ['receipt', 'hasResult', 'result'], 'execute response');
  const receipt = parseOutcomeReceipt(value.receipt, request);
  if (receipt.toolName !== undefined && receipt.toolName !== request.toolName || receipt.argumentsFingerprint !== undefined && receipt.argumentsFingerprint !== request.argumentsFingerprint) invalid('response arguments');
  if (typeof value.hasResult !== 'boolean' || value.hasResult !== Object.hasOwn(value, 'result')) invalid('result presence');
  if (value.hasResult) copyOutcomeData(value.result, inlineMaximum);
  return { ...value, receipt } as OutcomeExecuteResponse;
}
export function parseOutcomeCancelResponse(input: unknown, request: OutcomeRequestIdentity): OutcomeCancelResponse {
  const value = object(copyOutcomeData(input), 'cancel response'); keys(value, ['receipt', 'cancellationRequested'], 'cancel response');
  if (typeof value.cancellationRequested !== 'boolean') invalid('cancellation acknowledgement');
  return { receipt: parseOutcomeReceipt(value.receipt, request), cancellationRequested: value.cancellationRequested };
}
export function parseOutcomeEvidenceResponse(input: unknown, request: OutcomeEvidenceRequest, maximum: number): OutcomeEvidenceResponse {
  const value = object(copyOutcomeData(input, maximum * 6 + 8192), 'evidence response'); keys(value, [...baseKeys, 'chunk', 'contentSha256', 'contentBytes'], 'evidence response'); packageIdentity(value, request.packageId);
  if (value.chunk === null) { if (value.contentSha256 !== undefined || value.contentBytes !== undefined) invalid('missing chunk digest'); return value as OutcomeEvidenceResponse; }
  fingerprint(value.contentSha256); integer(value.contentBytes, 'content bytes', 1, 64_000_000);
  const chunk = object(value.chunk, 'chunk'); keys(chunk, ['reference', 'text', 'nextOffset', 'totalChars'], 'chunk'); reference(chunk.reference);
  if (canonical(chunk.reference) !== canonical(request.reference) || typeof chunk.text !== 'string' || chunk.text.length > Math.min(maximum, request.limit ?? maximum)) invalid('chunk data');
  integer(chunk.totalChars, 'total characters'); const offset = request.offset ?? 0, end = offset + chunk.text.length;
  if (end < chunk.totalChars) { if (!chunk.text.length || chunk.nextOffset !== end) invalid('chunk progress'); }
  else if (chunk.nextOffset !== undefined || chunk.text.length && end !== chunk.totalChars) invalid('chunk end');
  return value as OutcomeEvidenceResponse;
}
