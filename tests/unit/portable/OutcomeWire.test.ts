import { afterEach, describe, expect, it } from 'vitest';
import { Connector, AGENT_PACKAGE_PROTOCOL_VERSION, exportAgentPackage, assertAgentPackageCompatible } from '@/index.js';
import { fixture } from '../core/routing/fixture.js';
import { AGENT_PACKAGE_OUTCOME_PROTOCOL as protocol } from '@/portable/outcomeTypes.js';
import { copyOutcomeData, outcomeArgumentsFingerprint, outcomeDefinitionFingerprint, outcomeForWire, parseOutcomeRequest,
  parseOutcomePackage, parseOutcomeNegotiation, parseOutcomeReceipt, parseOutcomeExecuteResponse, parseOutcomeCancelResponse, parseOutcomeEvidenceResponse } from '@/portable/outcomeWire.js';
import type { OutcomeExecuteRequest, RemoteOutcomeReceipt } from '@/portable/outcomeTypes.js';
import type { Agent } from '@/index.js';
const agents: Agent[] = [];
afterEach(() => { agents.splice(0).forEach(agent => agent.destroy()); Connector.clear(); });
const reference = { version: 1 as const, id: '9c2a6e3e-8647-4e95-98ca-1ebcd370c38f', sha256: 'a'.repeat(64), bytes: 123, durability: 'process' as const };
const request = (args = {}): OutcomeExecuteRequest => ({ protocol, packageId: 'package', sessionId: 'server', requestId: 'request', toolName: 'probe', toolFingerprint: 'a'.repeat(64), arguments: args, argumentsFingerprint: outcomeArgumentsFingerprint('probe', args) });
const receipt = (): RemoteOutcomeReceipt => ({ protocol, packageId: 'package', sessionId: 'server', observedSessionId: 'server', requestId: 'request', state: 'settled', admission: 'started', toolName: 'probe', argumentsFingerprint: request().argumentsFingerprint, effect: 'write',
  serverOutcome: { executionId: 'actual-server-execution', callId: 'request', runId: 'actual-external-run', toolName: 'probe', status: 'succeeded', executionStarted: true, completion: 'settled', cancellation: 'none', startedAt: 4, durationMs: 2 } });
describe('separate outcome protocol data boundary', () => {
  it('keeps literal v2 and rejects mixed package envelopes before hydration', () => {
    const f = fixture(); agents.push(f.agent); const old = exportAgentPackage(f.agent); const modern = { protocol, package: old };
    expect(AGENT_PACKAGE_PROTOCOL_VERSION).toBe(2); expect(() => assertAgentPackageCompatible(old)).not.toThrow(); expect(parseOutcomePackage(modern).package.protocolVersion).toBe(2);
    expect(() => assertAgentPackageCompatible(modern as any)).toThrow(); expect(() => parseOutcomePackage(old)).toThrow();
  });
  it('validates checkpoint shape without treating its mutable hints as backend proof', () => {
    const f = fixture(); agents.push(f.agent); const envelope = { protocol, package: exportAgentPackage(f.agent), checkpoint: { version: 1, operations: [{ operationId: 'request', sessionId: 'old-server', toolName: 'probe', argumentsFingerprint: request().argumentsFingerprint, admission: reference }] } };
    expect(parseOutcomePackage(envelope).checkpoint?.operations).toHaveLength(1);
    expect(() => parseOutcomePackage({ ...envelope, checkpoint: { ...envelope.checkpoint, operations: [...envelope.checkpoint.operations, ...envelope.checkpoint.operations] } })).toThrow(/duplicate/);
    expect(() => parseOutcomePackage({ ...envelope, checkpoint: { version: 1, modelTask: {}, operations: [] } })).toThrow(/fields/);
  });
  it('hashes complete nested arguments independently of object order while retaining array/scalar distinctions', () => {
    expect(outcomeArgumentsFingerprint('probe', { a: 0, b: [{ d: null, c: false }] })).toBe(outcomeArgumentsFingerprint('probe', { b: [{ c: false, d: null }], a: 0 }));
    expect(outcomeArgumentsFingerprint('probe', { rows: [1, 2] })).not.toBe(outcomeArgumentsFingerprint('probe', { rows: [2, 1] }));
    expect(outcomeArgumentsFingerprint('probe', {})).not.toBe(outcomeArgumentsFingerprint('other', {}));
  });
  it('excludes dynamic descriptions from callable compatibility without ignoring schema changes', () => {
    const definition = { type: 'function' as const, function: { name: 'probe', description: 'before', parameters: { type: 'object', properties: {} } } };
    expect(outcomeDefinitionFingerprint(definition)).toBe(outcomeDefinitionFingerprint({ ...definition, function: { ...definition.function, description: 'current host rendering' } }));
    expect(outcomeDefinitionFingerprint(definition)).not.toBe(outcomeDefinitionFingerprint({ ...definition, function: { ...definition.function, parameters: { type: 'object', properties: { id: { type: 'string' } } } } }));
  });
  it.each(['protocol', 'packageId', 'sessionId', 'requestId', 'argumentsFingerprint'])('rejects forged %s correlation', field => {
    expect(() => parseOutcomeRequest({ ...request(), [field]: field === 'argumentsFingerprint' ? 'b'.repeat(64) : '' }, 'execute', 'package')).toThrow();
  });
  it('does not execute getters/toJSON or accept cyclic/non-JSON data', () => {
    let calls = 0; const getter = Object.defineProperty({}, 'token', { enumerable: true, get: () => { calls++; return 'SYNTHETIC_ONLY'; } });
    expect(() => copyOutcomeData(getter)).toThrow(); expect(() => copyOutcomeData({ toJSON: () => { calls++; return {}; } })).toThrow(); expect(calls).toBe(0);
    const cycle: any = {}; cycle.self = cycle; expect(() => copyOutcomeData(cycle)).toThrow(); expect(() => copyOutcomeData({ number: NaN })).toThrow(); expect(() => copyOutcomeData({ number: 1n })).toThrow();
  });
  it('bounds serialization before oversized input allocation and rejects unknown authority fields', () => {
    expect(() => copyOutcomeData({ body: 'x'.repeat(100_000) }, 128)).toThrow(/capacity/);
    expect(() => parseOutcomeRequest({ ...request(), tenantId: 'model-selected' }, 'execute')).toThrow(/fields/);
    expect(() => parseOutcomeRequest({ protocol, packageId: 'package', modelTask: { authority: true } }, 'negotiate')).toThrow(/fields/);
  });
  it('validates all five request shapes and exact bounded evidence references', () => {
    expect(parseOutcomeRequest({ protocol, packageId: 'package' }, 'negotiate')).toEqual({ protocol, packageId: 'package' });
    const identity = { protocol, packageId: 'package', sessionId: 'server', requestId: 'request' };
    expect(parseOutcomeRequest(identity, 'getReceipt')).toEqual(identity); expect(parseOutcomeRequest({ ...identity, reason: 'host requested' }, 'cancel')).toHaveProperty('reason');
    const read = { protocol, packageId: 'package', sessionId: 'server', reference, offset: 0, limit: 1 };
    expect(parseOutcomeRequest(read, 'readEvidence')).toEqual(read); expect(() => parseOutcomeRequest({ ...read, url: 'https://arbitrary.invalid' }, 'readEvidence')).toThrow();
    expect(() => parseOutcomeRequest({ ...read, limit: 0 }, 'readEvidence')).toThrow();
  });
  it('requires explicit complete negotiated limits and rejects duplicate tool metadata', () => {
    const negotiation = { protocol, packageId: 'package', sessionId: 'server', tools: [{ name: 'probe', definitionFingerprint: `sha256:${'a'.repeat(64)}`, effect: 'unknown' }], limits: { maxRequests: 10, maxInlineBytes: 1024, maxReadChars: 64 } };
    expect(parseOutcomeNegotiation(negotiation, 'package').tools[0]?.effect).toBe('unknown');
    expect(() => parseOutcomeNegotiation({ ...negotiation, tools: [...negotiation.tools, ...negotiation.tools] }, 'package')).toThrow();
    expect(() => parseOutcomeNegotiation({ ...negotiation, limits: { ...negotiation.limits, maxRequests: 0 } }, 'package')).toThrow();
  });
  it.each([null, false, 0, { success: false, reason: 'business declined' }])('retains a valid JSON business result %j independently of operation semantics', result => {
    const parsed = parseOutcomeExecuteResponse({ receipt: receipt(), hasResult: true, result }, request(), 4096);
    expect(parsed.result).toEqual(result); expect(parsed.receipt.serverOutcome?.status).toBe('succeeded');
  });
  it('keeps actual server IDs and times distinct from the transport session identity', () => {
    const parsed = parseOutcomeReceipt(receipt(), request()); expect(parsed.serverOutcome).toMatchObject({ executionId: 'actual-server-execution', runId: 'actual-external-run', startedAt: 4, durationMs: 2 });
    expect(() => parseOutcomeReceipt({ ...receipt(), serverOutcome: { ...receipt().serverOutcome, callId: 'unrelated' } }, request())).toThrow(/correlation/);
    expect(() => parseOutcomeReceipt({ ...receipt(), serverOutcome: { ...receipt().serverOutcome, completion: 'unknown' } }, request())).toThrow();
  });
  it('allows honest unknown restart lookup without inventing a server outcome', () => {
    const unknown = { protocol, packageId: 'package', sessionId: 'old-server', observedSessionId: 'new-server', requestId: 'request', state: 'unknown', admission: 'unknown' };
    expect(parseOutcomeReceipt(unknown).state).toBe('unknown'); expect(() => parseOutcomeReceipt({ ...unknown, serverOutcome: receipt().serverOutcome })).toThrow();
  });
  it('does not equate cancellation acknowledgement with completion or rollback', () => {
    const pending = { ...receipt(), state: 'pending', serverOutcome: { ...receipt().serverOutcome!, status: 'cancelled', completion: 'unknown', cancellation: 'requested' } };
    expect(parseOutcomeCancelResponse({ receipt: pending, cancellationRequested: true }, request()).receipt.state).toBe('pending');
  });
  it('requires actual result presence and rejects a forged response fingerprint', () => {
    expect(() => parseOutcomeExecuteResponse({ receipt: receipt(), hasResult: true }, request(), 4096)).toThrow(/presence/);
    expect(() => parseOutcomeExecuteResponse({ receipt: receipt(), hasResult: false, result: null }, request(), 4096)).toThrow(/presence/);
    expect(() => parseOutcomeExecuteResponse({ receipt: { ...receipt(), argumentsFingerprint: 'b'.repeat(64) }, hasResult: false }, request(), 4096)).toThrow(/arguments/);
  });
  it('rejects skipped/stalled/forged chunks while permitting exact UTF-16 reassembly', () => {
    const read = { protocol, packageId: 'package', sessionId: 'server', reference, offset: 0, limit: 3 }, text = '😀XYZ';
    const first = { protocol, packageId: 'package', contentSha256: 'a'.repeat(64), contentBytes: 7, chunk: { reference, text: text.slice(0, 3), nextOffset: 3, totalChars: text.length } };
    expect(parseOutcomeEvidenceResponse(first, read, 3).chunk?.nextOffset).toBe(3);
    const last = parseOutcomeEvidenceResponse({ ...first, chunk: { reference, text: text.slice(3), totalChars: text.length } }, { ...read, offset: 3 }, 3);
    expect(first.chunk.text + last.chunk?.text).toBe(text);
    expect(() => parseOutcomeEvidenceResponse({ ...first, chunk: { ...first.chunk, nextOffset: 4 } }, read, 3)).toThrow();
    expect(() => parseOutcomeEvidenceResponse({ ...first, chunk: { ...first.chunk, reference: { ...reference, sha256: 'b'.repeat(64) } } }, read, 3)).toThrow();
    expect(() => parseOutcomeEvidenceResponse({ ...first, chunk: { ...first.chunk, text: '', nextOffset: 0 } }, read, 3)).toThrow();
  });
  it('copies actual defined outcome metadata without leaking private companions or raw exception secrets', () => {
    const outcome = { ...receipt().serverOutcome!, error: 'SYNTHETIC_AUTH_SECRET_DO_NOT_FORWARD', [Symbol('private')]: { task: true } };
    expect(outcomeForWire(outcome)).toMatchObject({ executionId: outcome.executionId, error: 'Tool operation failed' }); expect(Object.getOwnPropertySymbols(outcomeForWire(outcome))).toHaveLength(0);
  });
});
