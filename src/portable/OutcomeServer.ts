import { createHash, randomUUID } from 'node:crypto';
import type { Agent } from '../core/Agent.js';
import type { ToolFunction, ToolExecutionOptions } from '../domain/entities/Tool.js';
import type { EvidenceReference, EvidenceRecord } from '../domain/interfaces/IEvidenceStorage.js';
import { acquireComposition, type CompositionLease, type CompositionToolObservation } from '../core/execution/composition.js';
import { selectRemoteSourceAdmission } from '../core/tool-execution/remoteObservation.js';
import { assertAgentPackageCompatible, AgentPackageCompatibilityError } from './AgentPackage.js';
import { AGENT_PACKAGE_OUTCOME_PROTOCOL as protocol } from './outcomeTypes.js';
import type { AgentPackageOutcomeServerOptions, OutcomeAgentPackage, OutcomeExecuteRequest, OutcomeExecuteResponse, OutcomeNegotiation, RemoteOutcomeAccess, RemoteOutcomeReceipt, OutcomeCancelResponse, OutcomeEvidenceResponse } from './outcomeTypes.js';
import type { SerializedAgentPackage } from './types.js';
import { copyOutcomeData, outcomeDefinitionFingerprint, outcomeForWire, outcomeToolFingerprint, parseOutcomeRequest, OUTCOME_MAX_INLINE_BYTES, OUTCOME_MAX_READ_CHARS, OUTCOME_MAX_REQUESTS } from './outcomeWire.js';
import { json } from '../core/evidence/validation.js';
import { SOURCE_KIND, sourceRecord, validateSource, requestMetadata } from './outcomeRecords.js';

interface Operation {
  request: OutcomeExecuteRequest; controller: AbortController; receipt: RemoteOutcomeReceipt;
  promise?: Promise<void>; capture?: Promise<void>; result?: { value: unknown }; retained?: EvidenceRecord;
}
function bounded(value: number | undefined, fallback: number, maximum: number, minimum = 1): number {
  const selected = value ?? fallback;
  if (!Number.isSafeInteger(selected) || selected < minimum || selected > maximum) throw new AgentPackageCompatibilityError('Invalid remote outcome limit');
  return selected;
}
/** Explicit authenticated facade over the ordinary Agent tool lifecycle. No HTTP server or credentials are supplied by a package. */
export class AgentPackageOutcomeServer<TContext = unknown> {
  private readonly epoch = randomUUID();
  private readonly pkg: SerializedAgentPackage;
  private readonly names: Set<string>;
  private readonly operations = new Map<string, Operation>();
  private readonly limits: OutcomeNegotiation['limits'];
  private lease?: CompositionLease;
  private starting?: Promise<void>;
  private closed = false;
  private closing?: Promise<void>;
  constructor(private readonly agent: Agent, pkg: SerializedAgentPackage, private readonly options: AgentPackageOutcomeServerOptions<TContext>) {
    assertAgentPackageCompatible(pkg); this.pkg = copyOutcomeData(pkg, 12_000_000);
    if (!options.storage || typeof options.authorize !== 'function') throw new AgentPackageCompatibilityError('Scoped storage and host authorization are required');
    this.names = new Set(pkg.agent.tools.filter(t => t.placement === 'remote').map(t => t.definition.function.name));
    if ([...this.names].some(name => agent.context.getContextToolNames().includes(name))) throw new AgentPackageCompatibilityError('Remote source conflicts with a context tool');
    this.limits = { maxRequests: bounded(options.maxRequests, 1000, OUTCOME_MAX_REQUESTS), maxInlineBytes: bounded(options.maxInlineBytes, 65536, OUTCOME_MAX_INLINE_BYTES, 0), maxReadChars: bounded(options.maxReadChars, 8192, OUTCOME_MAX_READ_CHARS) };
  }
  package(): OutcomeAgentPackage { return { protocol, package: copyOutcomeData(this.pkg, 12_000_000) }; }
  private async authorize(access: RemoteOutcomeAccess, host: TContext): Promise<void> {
    if (!await this.options.authorize(Object.freeze(copyOutcomeData(access, 1_010_000)), host)) throw new Error('Remote outcome access denied');
  }
  private tool(name: string): ToolFunction | undefined { return this.names.has(name) && this.agent.tools.isEnabled(name) ? this.agent.tools.get(name) : undefined; }
  async negotiate(input: unknown, host: TContext): Promise<OutcomeNegotiation> {
    const request = parseOutcomeRequest(input, 'negotiate', this.pkg.packageId);
    await this.authorize({ operation: 'negotiate', ...request }, host);
    if (this.closed) throw new Error('Remote outcome server is closed');
    return { ...request, sessionId: this.epoch, tools: [...this.names].flatMap(name => { const tool = this.tool(name); return tool ? [{ name, definitionFingerprint: outcomeDefinitionFingerprint(tool.definition), effect: tool.output?.effect ?? 'unknown' }] : []; }), limits: { ...this.limits } };
  }
  private access(operation: RemoteOutcomeAccess['operation'], op: Operation): RemoteOutcomeAccess {
    return { operation, packageId: this.pkg.packageId, sessionId: op.request.sessionId, requestId: op.request.requestId, toolName: op.request.toolName, effect: op.receipt.effect ?? 'unknown', arguments: op.request.arguments };
  }
  private unknown(sessionId: string, requestId: string): RemoteOutcomeReceipt { return { protocol, packageId: this.pkg.packageId, sessionId, requestId, observedSessionId: this.epoch, state: 'unknown', admission: 'unknown' }; }
  private async start(): Promise<void> {
    if (this.starting) return this.starting;
    this.lease = acquireComposition(this.agent);
    this.lease.onToolObservation(observation => {
      const op = observation.outcome.callId ? this.operations.get(observation.outcome.callId) : undefined;
      if (!op) return;
      op.capture = this.capture(op, observation); this.lease!.track(op.capture);
    });
    this.starting = this.lease.admit(() => this.agent.beginExternalExecution({ source: 'agent-package-outcomes' })).then(() => undefined);
    try { await this.starting; } catch (error) { this.lease.release(); this.lease = undefined; this.starting = undefined; throw error; }
  }
  private async capture(op: Operation, observation: CompositionToolObservation): Promise<void> {
    const outcome = outcomeForWire(observation.outcome);
    const receipt: RemoteOutcomeReceipt = { protocol, packageId: this.pkg.packageId, sessionId: this.epoch, observedSessionId: this.epoch, requestId: op.request.requestId,
      state: outcome.completion === 'unknown' ? 'pending' : 'settled', admission: outcome.executionStarted ? 'started' : 'not_started', toolName: op.request.toolName,
      effect: observation.effect, argumentsFingerprint: op.request.argumentsFingerprint, serverOutcome: outcome };
    op.receipt = receipt;
    if (!observation.result || outcome.completion === 'unknown') return;
    try {
      // Serialization is bounded by the selected backend, never by the inline transport limit.
      const result = observation.result.value;
      const record = sourceRecord(outcome, observation.arguments?.value ?? op.request.arguments, { ...this.agent.tools.getToolContext()?.userId ? { userId: this.agent.tools.getToolContext()!.userId } : {} }, observation.effect,
        { kind: SOURCE_KIND, receipt, payload: { hasResult: true, result } });
      op.retained = record; op.result = { value: result };
      copyOutcomeData(record, this.options.storage.serializationLimitBytes ?? 4_194_304);
      const writing = this.options.storage.put(record); this.lease?.track(writing);
      const reference = await writing;
      validateSource(await this.options.storage.readRecord(reference), requestMetadata(op.request));
      // A late observation supersedes its own earlier receipt only.
      if (op.receipt === receipt) { op.receipt = { ...receipt, source: reference }; op.retained = undefined; }
    } catch { /* Retained source is recoverable; storage failure never repeats an action. */ }
  }
  async execute(input: unknown, host: TContext): Promise<OutcomeExecuteResponse> {
    const request = parseOutcomeRequest(input, 'execute', this.pkg.packageId), tool = this.tool(request.toolName), effect = tool?.output?.effect ?? 'unknown';
    const selectedFingerprint = tool && outcomeToolFingerprint(outcomeDefinitionFingerprint(tool.definition), effect);
    const access: RemoteOutcomeAccess = { operation: 'execute', packageId: request.packageId, sessionId: request.sessionId, requestId: request.requestId, toolName: request.toolName, effect, arguments: request.arguments };
    await this.authorize(access, host);
    if (request.sessionId !== this.epoch) return { receipt: this.unknown(request.sessionId, request.requestId), hasResult: false };
    const existing = this.operations.get(request.requestId);
    if (existing) {
      if (existing.request.toolName !== request.toolName || existing.request.argumentsFingerprint !== request.argumentsFingerprint || existing.request.toolFingerprint !== request.toolFingerprint) throw new Error('Remote request identity was already used');
      await existing.promise; await existing.capture; await this.authorize(this.access('execute', existing), host); return this.response(existing);
    }
    if (this.operations.size >= this.limits.maxRequests) throw new Error('Remote request capacity reached');
    if ([...this.operations.values()].some(op => op.retained)) throw new Error('Remote source requires evidence repair');
    const receipt: RemoteOutcomeReceipt = { ...this.unknown(this.epoch, request.requestId), state: 'pending', admission: 'not_started', toolName: request.toolName, effect, argumentsFingerprint: request.argumentsFingerprint };
    const op: Operation = { request, controller: new AbortController(), receipt }; this.operations.set(request.requestId, op);
    const reject = (code: string): void => { op.receipt = { ...receipt, state: 'settled', error: { code, message: 'Remote tool was not admitted' } }; };
    const uncertain = (): void => { op.receipt = { ...this.unknown(this.epoch, request.requestId), toolName: request.toolName, effect, argumentsFingerprint: request.argumentsFingerprint }; };
    const fingerprint = selectedFingerprint;
    if (this.closed || !tool || fingerprint !== request.toolFingerprint || this.tool(request.toolName)?.execute !== tool.execute || tool && outcomeToolFingerprint(outcomeDefinitionFingerprint(tool.definition), tool.output?.effect ?? 'unknown') !== fingerprint) reject('admission_rejected');
    else {
      op.promise = (async () => {
        let handedOff = false;
        try {
          await this.start();
          const options: ToolExecutionOptions = { signal: op.controller.signal };
          selectRemoteSourceAdmission(options, (selected, _context, admittedEffect) => {
            if (selected.execute !== tool.execute || admittedEffect !== effect || outcomeToolFingerprint(outcomeDefinitionFingerprint(selected.definition), admittedEffect) !== fingerprint) throw new Error('Remote tool registration changed');
          });
          handedOff = true;
          await this.agent.executeExternalToolCall({ id: request.requestId, name: request.toolName, arguments: request.arguments }, options);
          await op.capture;
          // Legacy execution overrides may perform work without publishing an
          // outcome. Missing observation after handoff cannot prove non-admission.
          if (!op.receipt.serverOutcome) uncertain();
        } catch {
          if (!op.receipt.serverOutcome) {
            if (handedOff) uncertain();
            else reject('admission_rejected');
          }
        }
      })();
      await op.promise;
    }
    await this.authorize(this.access('execute', op), host); return this.response(op);
  }
  private response(op: Operation): OutcomeExecuteResponse {
    let inline = false;
    if (op.result) { try { copyOutcomeData(op.result.value, this.limits.maxInlineBytes); inline = true; } catch { /* Use exact source reference. */ } }
    return copyOutcomeData({ receipt: op.receipt, hasResult: inline, ...(inline ? { result: op.result!.value } : {}) }, this.limits.maxInlineBytes + 32768);
  }
  async getReceipt(input: unknown, host: TContext): Promise<RemoteOutcomeReceipt> {
    const request = parseOutcomeRequest(input, 'getReceipt', this.pkg.packageId), op = request.sessionId === this.epoch ? this.operations.get(request.requestId) : undefined;
    await this.authorize(op ? this.access('getReceipt', op) : { operation: 'getReceipt', ...request }, host);
    if (op?.capture) await op.capture;
    await this.authorize(op ? this.access('getReceipt', op) : { operation: 'getReceipt', ...request }, host);
    return copyOutcomeData(op?.receipt ?? this.unknown(request.sessionId, request.requestId));
  }
  async cancel(input: unknown, host: TContext): Promise<OutcomeCancelResponse> {
    const request = parseOutcomeRequest(input, 'cancel', this.pkg.packageId), op = request.sessionId === this.epoch ? this.operations.get(request.requestId) : undefined;
    await this.authorize(op ? this.access('cancel', op) : { operation: 'cancel', ...request }, host);
    const requested = !!op && op.receipt.state === 'pending'; if (requested) op!.controller.abort(new Error('Remote cancellation requested'));
    return { receipt: copyOutcomeData(op?.receipt ?? this.unknown(request.sessionId, request.requestId)), cancellationRequested: requested };
  }
  async readEvidence(input: unknown, host: TContext): Promise<OutcomeEvidenceResponse> {
    const request = parseOutcomeRequest(input, 'readEvidence', this.pkg.packageId), access: RemoteOutcomeAccess = { operation: 'readEvidence', packageId: request.packageId, sessionId: request.sessionId, reference: request.reference };
    await this.authorize(access, host);
    const record = await this.options.storage.readRecord(request.reference), body = record?.result as { kind?: string; receipt?: RemoteOutcomeReceipt } | undefined;
    if (body?.kind !== SOURCE_KIND || body.receipt?.packageId !== this.pkg.packageId || body.receipt?.sessionId !== request.sessionId) throw new Error('Remote evidence is outside this package session');
    await this.authorize({ ...access, toolName: body.receipt.toolName, effect: body.receipt.effect }, host);
    validateSource(record, { ...body.receipt, toolFingerprint: '', toolName: body.receipt.toolName!, argumentsFingerprint: body.receipt.argumentsFingerprint! });
    const chunk = await this.options.storage.read(request.reference, { offset: request.offset, limit: Math.min(request.limit ?? this.limits.maxReadChars, this.limits.maxReadChars) });
    await this.authorize({ ...access, toolName: body.receipt.toolName, effect: body.receipt.effect }, host); const content = json(record); return { protocol, packageId: request.packageId, chunk, ...(chunk ? { contentSha256: createHash('sha256').update(content).digest('hex'), contentBytes: Buffer.byteLength(content) } : {}) };
  }
  /** Host-only exact retained record. No action is resubmitted. */
  readRetainedSource(requestId: string): EvidenceRecord | undefined { const record = this.operations.get(requestId)?.retained; return record ? copyOutcomeData(record, 64_000_000) : undefined; }
  async acknowledgeSource(requestId: string, reference: EvidenceReference): Promise<void> {
    const op = this.operations.get(requestId); if (!op?.retained) throw new Error('No retained remote source');
    const record = await this.options.storage.readRecord(reference); validateSource(record, requestMetadata(op.request));
    if (JSON.stringify(record) !== JSON.stringify(op.retained)) throw new Error('Remote source acknowledgement differs');
    op.receipt = { ...op.receipt, source: reference }; op.retained = undefined;
  }
  close(): Promise<void> {
    if (this.closing) return this.closing; this.closed = true;
    return this.closing = (async () => { await Promise.allSettled([...this.operations.values()].flatMap(op => op.promise ? [op.promise] : []));
      const lease = this.lease;
      if (lease) {
        await new Promise<void>(resolve => { if (!lease.pending) resolve(); else { const off = lease.onWorkSettled(() => { if (!lease.pending) { off(); resolve(); } }); } });
        try { await this.agent.completeExternalExecution(); }
        finally { lease.release(); await lease.whenReleased; }
      }
    })();
  }
}
