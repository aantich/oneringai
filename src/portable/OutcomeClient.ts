import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { Agent } from '../core/Agent.js';
import { createOutcomeTool } from '../core/createOutcomeTool.js';
import { containAsyncRejection } from '../core/evidence/validation.js';
import { trackCompositionWork } from '../core/execution/composition.js';
import { withAbort } from '../core/tool-execution/cancellation.js';
import { remoteInvocation, remoteManagerContext, remoteManagerStorage, selectRemoteProxy } from '../core/tool-execution/remoteObservation.js';
import type { RemoteInvocationIdentity, RemoteInvocationObservation, RemoteToolOwner } from '../core/tool-execution/remoteObservation.js';
import type { EvidenceRecord, EvidenceReference, IEvidenceStorage } from '../domain/interfaces/IEvidenceStorage.js';
import type { ToolExecutionOutcome } from '../domain/entities/Tool.js';
import { AgentPackageCompatibilityError, exportAgentPackage, hydrateAgentPackageWithToolFactory } from './AgentPackage.js';
import { AGENT_PACKAGE_OUTCOME_PROTOCOL as protocol } from './outcomeTypes.js';
import type { AgentPackageOutcomeToolOptions, AgentPackageOutcomeTools } from './outcomeTypes.js';
import type { HydrateAgentPackageWithOutcomesOptions, OutcomeAgentPackage, OutcomeExecuteRequest, OutcomeNegotiation, RemoteOutcomeCheckpoint, RemoteOutcomeReport, RemoteOutcomeSession, RemoteOutcomeTransport, OutcomeHydratedAgent } from './outcomeTypes.js';
import type { ExportAgentPackageOptions, PortableToolDescriptor } from './types.js';
import { copyOutcomeData, outcomeArgumentsFingerprint, outcomeDefinitionFingerprint, outcomeForWire, outcomeToolFingerprint, parseOutcomeCancelResponse, parseOutcomeEvidenceResponse, parseOutcomeExecuteResponse, parseOutcomeNegotiation, parseOutcomePackage, parseOutcomeReceipt } from './outcomeWire.js';
import { ADMISSION_KIND, OBSERVATION_KIND, admissionRecord, readAdmission, requestMetadata, sourceRecord, validateObservation, validateSource } from './outcomeRecords.js';
import type { Admission, ObservationBody } from './outcomeRecords.js';

interface Operation {
  metadata: Admission['request']; effect: 'read' | 'write' | 'unknown'; proxy: RemoteInvocationIdentity; report: RemoteOutcomeReport;
  admission?: EvidenceReference; proxyReceipt?: EvidenceReference; localRejected?: boolean; payload?: { value: unknown }; proxyOutcome?: ToolExecutionOutcome;
  reconciliation?: Promise<void>;
}
class OutcomeSession implements RemoteOutcomeSession, RemoteToolOwner {
  private manager?: object;
  private agent?: Agent;
  private closed = false;
  private readonly operations = new Map<string, Operation>();
  private readonly invocations = new Map<string, Operation>();
  readonly tools: import('../domain/entities/Tool.js').ToolFunction[];
  constructor(private readonly envelope: OutcomeAgentPackage, private readonly transport: RemoteOutcomeTransport, private storage: IEvidenceStorage | undefined,
    private readonly negotiation: OutcomeNegotiation, private readonly maximum: number, private readonly observer?: AgentPackageOutcomeToolOptions['onObservation']) {
    this.tools = envelope.package.agent.tools.filter(t => t.placement === 'remote').map(descriptor => this.createTool(descriptor));
  }
  bind(agent: Agent): void { this.agent = agent; this.storage ??= remoteManagerStorage(agent.tools); this.assertStorage(agent.tools); }
  attach(manager: object): void {
    if (this.closed || this.manager && this.manager !== manager) throw new AgentPackageCompatibilityError('Remote outcome session owns one tool manager; create a fresh toolset for another Agent');
    // Hydration creates its enabled evidence middleware after registering initial tools.
    if (this.storage && remoteManagerStorage(manager) && this.storage !== remoteManagerStorage(manager)) throw new AgentPackageCompatibilityError('Remote tools and context must share the same evidence storage handle');
    this.manager = manager;
  }
  detach(manager: object): void { if (this.manager === manager) { this.manager = undefined; if (this.operations.size) this.closed = true; } }
  private assertStorage(manager: object): IEvidenceStorage {
    const storage = remoteManagerStorage(manager);
    if (!storage || !this.storage || storage !== this.storage) throw new AgentPackageCompatibilityError('Enable evidence with the remote session evidence storage handle');
    return storage;
  }
  private work<T>(promise: Promise<T>): Promise<T> { if (this.manager) trackCompositionWork(this.manager, promise); return promise; }
  private emit(op: Operation): void { try { containAsyncRejection(this.observer?.(copyOutcomeData(op.report))); } catch { /* Observer cannot retry work. */ } }
  hasTool(name: string): boolean { return this.tools.some(t => t.definition.function.name === name); }
  claims(executionId: string): boolean { return this.invocations.has(executionId); }
  issue(manager: object): Error | undefined {
    try { this.assertStorage(manager); } catch (error) { return error as Error; }
    if (this.closed) return new Error('Remote outcome session is closed');
    if ([...this.operations.values()].some(op => op.report.pendingSource && ((op.report.receipt?.serverOutcome ? op.report.receipt.effect : op.effect)) !== 'read')) return new Error('Remote action requires receipt and source reconciliation before continuing');
    return undefined;
  }
  private createTool(descriptor: PortableToolDescriptor): import('../domain/entities/Tool.js').ToolFunction {
    const negotiated = this.negotiation.tools.find(t => t.name === descriptor.definition.function.name);
    if (!negotiated || negotiated.definitionFingerprint !== outcomeDefinitionFingerprint(descriptor.definition)) throw new AgentPackageCompatibilityError('Remote callable definition did not negotiate');
    const tool = createOutcomeTool({ definition: descriptor.definition, output: { effect: negotiated.effect }, execute: async (args, invocation) => {
      const companion = remoteInvocation(invocation.context) as (RemoteInvocationObservation & { operation?: Operation }) | undefined;
      const op = companion?.operation;
      if (!op || !this.manager) throw new Error('Remote tools require their owning ToolManager');
      const storage = this.assertStorage(this.manager), blocked = this.issue(this.manager);
      // The current admitted invocation is not a previous uncertain action.
      if (blocked && [...this.operations.values()].some(other => other !== op && other.report.pendingSource && ((other.report.receipt?.serverOutcome ? other.report.receipt.effect : other.effect)) !== 'read')) throw blocked;
      const request: OutcomeExecuteRequest = { ...op.metadata, arguments: copyOutcomeData(args ?? {}) };
      request.argumentsFingerprint = outcomeArgumentsFingerprint(request.toolName, request.arguments); op.metadata = requestMetadata(request); op.report.argumentsFingerprint = request.argumentsFingerprint;
      const admission: Admission = { kind: ADMISSION_KIND, request: op.metadata, proxy: op.proxy };
      try {
        const reference = await this.work(storage.put(admissionRecord(admission)));
        await this.work(readAdmission(storage, reference, op.metadata));
        op.admission = reference; op.report.admission = reference;
      } catch { op.localRejected = true; op.report.state = 'settled'; op.report.pendingSource = false; throw new Error('Remote admission could not be acknowledged; no action submitted'); }
      try { invocation.context?.signal?.throwIfAborted(); } catch (error) { op.localRejected = true; op.report.state = 'settled'; op.report.pendingSource = false; throw error; }
      try {
        const response = parseOutcomeExecuteResponse(await this.work(this.transport.execute(request, { signal: invocation.context?.signal })), request, this.negotiation.limits.maxInlineBytes);
        op.report.receipt = response.receipt; op.report.state = response.receipt.state;
        if (response.hasResult) op.payload = { value: response.result };
        else if (response.receipt.source) await this.loadSource(op, response.receipt.source, invocation.context?.signal);
        op.report.pendingSource = !this.known(op);
        if (response.receipt.serverOutcome?.status !== 'succeeded') invocation.reportFailure(new Error('Remote source tool did not succeed'));
        this.emit(op);
        if (op.payload) return op.payload.value;
        throw new Error(response.receipt.state === 'unknown' ? 'Remote outcome is unknown' : 'Remote tool has no complete result');
      } catch (error) { if (!op.report.receipt) op.report.state = 'unknown'; this.emit(op); throw error; }
    } });
    selectRemoteProxy(tool, (identity, _context, manager) => {
      const proxy = Object.fromEntries(Object.entries({ ...identity, principal: Object.fromEntries(Object.entries(identity.principal).filter(([, value]) => value !== undefined)) }).filter(([, value]) => value !== undefined)) as unknown as RemoteInvocationIdentity;
      const selectedStorage = this.assertStorage(manager);
      if (proxy.principal.userId !== undefined && proxy.principal.userId !== selectedStorage.scope.ownerId) throw new Error('Remote evidence ownership differs from the invoking user');
      const issue = this.issue(manager); if (issue) throw issue;
      if (this.operations.size >= this.maximum) throw new Error('Remote session request capacity reached');
      const requestId = randomUUID(), metadata: Admission['request'] = { protocol, packageId: this.envelope.package.packageId, sessionId: this.negotiation.sessionId, requestId,
        toolName: proxy.toolName, toolFingerprint: outcomeToolFingerprint(negotiated.definitionFingerprint, negotiated.effect), argumentsFingerprint: outcomeArgumentsFingerprint(proxy.toolName, {}) };
      const op: Operation = { metadata, effect: negotiated.effect, proxy, report: { operationId: requestId, sessionId: metadata.sessionId, toolName: proxy.toolName, argumentsFingerprint: metadata.argumentsFingerprint, state: 'pending', pendingSource: true, accounting: 'external_unknown' } };
      this.operations.set(requestId, op); this.invocations.set(proxy.executionId, op);
      return {
        version: 1 as const, operation: op,
        get effect() { return op.report.receipt?.effect ?? negotiated.effect; },
        get serverOutcome() { return op.report.receipt?.serverOutcome; },
        get notStarted() { return op.report.receipt?.state === 'settled' && op.report.receipt.admission === 'not_started'; },
        evidenceResult: (outcome, result) => {
          if (!this.known(op) || !op.admission || !result) return undefined;
          return { value: this.body(op, outcome, result.value) };
        },
        validateEvidence: async (_outcome, reference) => { try { await this.work(validateObservation(storageOf(this), reference, op.metadata, op.admission!, op.proxy)); return true; } catch { return false; } },
        observeProxy: (outcome, reference) => {
          if (!op.admission) { op.localRejected = true; op.report.state = 'settled'; }
          op.proxyOutcome ??= outcomeForWire(outcome); op.report.proxyOutcome = op.proxyOutcome;
          if (!op.proxyReceipt && outcome.evidence?.status === 'stored' && outcome.evidence.reference) op.proxyReceipt = outcome.evidence.reference;
          if (reference) op.report.reference = reference;
          op.report.pendingSource = !op.localRejected && (!this.known(op) || !!op.payload && !reference);
          this.emit(op);
        },
        issue: () => this.issue(manager),
      };
    }, this);
    return tool;
  }
  private known(op: Operation): boolean { const r = op.report.receipt; return !!r && r.state === 'settled' && (r.admission === 'not_started' || !!r.serverOutcome && r.serverOutcome.completion !== 'unknown' && (!!op.payload || r.serverOutcome.status !== 'succeeded')); }
  private body(op: Operation, proxy: ToolExecutionOutcome, result: unknown): ObservationBody { return { kind: OBSERVATION_KIND, admission: op.admission!, request: op.metadata, proxy: outcomeForWire(proxy), ...(op.proxyOutcome ? { initialProxy: op.proxyOutcome } : {}), receipt: op.report.receipt!, payload: { hasResult: true, result } }; }
  private async loadSource(op: Operation, reference: EvidenceReference, signal?: AbortSignal): Promise<void> {
    const parts: string[] = []; let offset = 0, total: number | undefined, digest: string | undefined, bytes: number | undefined;
    for (;;) {
      const response = await this.readRemoteResponse(reference, op.metadata.sessionId, { offset, limit: this.negotiation.limits.maxReadChars, signal });
      const chunk = response.chunk;
      if (digest !== undefined && (digest !== response.contentSha256 || bytes !== response.contentBytes)) throw new Error('Remote source digest changed');
      digest = response.contentSha256; bytes = response.contentBytes;
      if (!chunk || total !== undefined && total !== chunk.totalChars) throw new Error('Remote source is unavailable');
      total = chunk.totalChars;
      if (total > (this.storage?.serializationLimitBytes ?? 4_194_304) || (bytes ?? Infinity) > (this.storage?.serializationLimitBytes ?? 4_194_304)) throw new Error('Remote source exceeds local evidence capacity');
      parts.push(chunk.text); if (chunk.nextOffset === undefined) break; offset = chunk.nextOffset;
    }
    const text = parts.join('');
    if (Buffer.byteLength(text) !== bytes || createHash('sha256').update(text).digest('hex') !== digest) throw new Error('Remote source integrity failed');
    const record = JSON.parse(text) as EvidenceRecord, body = validateSource(record, op.metadata);
    op.payload = { value: body.payload.result }; op.report.receipt = { ...body.receipt, source: reference }; op.report.state = body.receipt.state;
  }
  inspect(id?: string): ReadonlyArray<Readonly<RemoteOutcomeReport>> { return copyOutcomeData([...this.operations.values()].filter(op => !id || op.metadata.requestId === id).map(op => op.report), 8_000_000); }
  private operation(id: string): Operation { const op = this.operations.get(id); if (!op) throw new Error('Unknown remote operation'); return op; }
  async getReceipt(id: string, options: { signal?: AbortSignal } = {}): Promise<RemoteOutcomeReport> {
    options = { ...options };
    const op = this.operation(id);
    options.signal?.throwIfAborted();
    // Serialize proof commits for one invocation. Every lookup still calls the
    // authenticated transport; concurrent readers must not append duplicate records.
    const pending = (op.reconciliation ?? Promise.resolve()).then(() => this.refreshReceipt(op, options));
    const settled = pending.then(() => undefined, () => undefined); op.reconciliation = settled;
    void settled.then(() => { if (op.reconciliation === settled) delete op.reconciliation; });
    return withAbort(this.work(pending), options.signal);
  }
  private async refreshReceipt(op: Operation, options: { signal?: AbortSignal }): Promise<RemoteOutcomeReport> {
    options.signal?.throwIfAborted();
    if (!op.admission) throw new Error('Missing remote admission proof');
    await this.work(readAdmission(storageOf(this), op.admission, op.metadata));
    const receipt = parseOutcomeReceipt(await this.work(this.transport.getReceipt({ protocol, packageId: op.metadata.packageId, sessionId: op.metadata.sessionId, requestId: op.metadata.requestId }, options)), op.metadata);
    if (receipt.toolName !== undefined && receipt.toolName !== op.metadata.toolName || receipt.argumentsFingerprint !== undefined && receipt.argumentsFingerprint !== op.metadata.argumentsFingerprint) throw new Error('Remote receipt arguments differ');
    // A restarted server's missing cache does not erase acknowledged historical proof.
    if (!(receipt.state === 'unknown' && op.report.reference && this.known(op))) { op.report.receipt = receipt; op.report.state = receipt.state; }
    let acknowledged = false;
    if (op.report.reference) {
      try {
        const body = await this.work(validateObservation(storageOf(this), op.report.reference, op.metadata, op.admission, op.proxy));
        acknowledged = isDeepStrictEqual(body.receipt, op.report.receipt);
      } catch { /* A missing/expired proof can be repaired from the current source. */ }
    }
    if (!acknowledged) {
      op.report.pendingSource = true;
      if (receipt.source) await this.loadSource(op, receipt.source, options.signal);
    }
    if (this.known(op) && op.payload && op.proxyOutcome) {
      if (!acknowledged) {
        const record = sourceRecord(op.proxyOutcome, {}, { ...op.proxy.principal }, op.report.receipt!.effect!, this.body(op, op.proxyOutcome, op.payload.value));
        const reference = await this.work(storageOf(this).put(record));
        await this.work(validateObservation(storageOf(this), reference, op.metadata, op.admission, op.proxy));
        op.report.reference = reference;
      }
      const reference = op.report.reference!;
      const context = this.manager && remoteManagerContext(this.manager);
      if (context && op.proxy.callId && [...context.getConversation(), ...context.getCurrentInput()].some(item => item.type === 'message' && item.content.some(content => 'tool_use_id' in content && content.tool_use_id === op.proxy.callId && 'evidence' in content && content.evidence?.status === 'storage_failed' && content.evidence.executionId === op.proxy.executionId))) await this.work(context.acknowledgeToolEvidence(op.proxy.callId, reference));
    }
    op.report.pendingSource = !this.known(op) || !!op.payload && !op.report.reference; this.emit(op); return copyOutcomeData(op.report);
  }
  async cancel(id: string, options: { signal?: AbortSignal; reason?: string } = {}): Promise<RemoteOutcomeReport> {
    const op = this.operation(id), request = { protocol, packageId: op.metadata.packageId, sessionId: op.metadata.sessionId, requestId: id, ...(options.reason ? { reason: options.reason } : {}) };
    const response = parseOutcomeCancelResponse(await this.work(this.transport.cancel(request, { signal: options.signal })), request);
    if (!this.known(op)) { op.report.receipt = response.receipt; op.report.state = response.receipt.state; }
    this.emit(op); return copyOutcomeData(op.report);
  }
  private async readRemoteResponse(reference: EvidenceReference, sessionId: string, options: { offset?: number; limit?: number; signal?: AbortSignal } = {}) {
    const request = { protocol, packageId: this.envelope.package.packageId, sessionId, reference, ...(options.offset === undefined ? {} : { offset: options.offset }), ...(options.limit === undefined ? {} : { limit: options.limit }) };
    return parseOutcomeEvidenceResponse(await this.work(this.transport.readEvidence(request, { signal: options.signal })), request, this.negotiation.limits.maxReadChars);
  }
  async readEvidence(reference: EvidenceReference, options: { offset?: number; limit?: number; signal?: AbortSignal } = {}) {
    const op = [...this.operations.values()].find(op => isDeepStrictEqual(op.report.receipt?.source, reference));
    if (!op) throw new Error('Remote reference was not observed by this session'); return (await this.readRemoteResponse(reference, op.metadata.sessionId, options)).chunk;
  }
  async validateRecord(record: EvidenceRecord, reference: EvidenceReference, callId: string): Promise<void> {
    const op = this.invocations.get(record.source.executionId);
    if (!op?.admission || op.proxy.callId !== callId) throw new Error('Remote invocation proof differs');
    await this.work(validateObservation(storageOf(this), reference, op.metadata, op.admission, op.proxy));
  }
  checkpoint(agentOrOptions?: Agent | ExportAgentPackageOptions, options?: ExportAgentPackageOptions): OutcomeAgentPackage {
    const agent = agentOrOptions && 'context' in agentOrOptions ? agentOrOptions as Agent : this.agent;
    if (!agent || agent.tools !== this.manager) throw new Error('Checkpoint requires the owning Agent');
    const exportOptions = agentOrOptions && 'context' in agentOrOptions ? options : agentOrOptions as ExportAgentPackageOptions | undefined;
    const checkpoint: RemoteOutcomeCheckpoint = { version: 1, operations: [...this.operations.values()].filter(op => op.admission).map(op => ({ operationId: op.metadata.requestId, sessionId: op.metadata.sessionId,
      toolName: op.metadata.toolName, argumentsFingerprint: op.metadata.argumentsFingerprint, admission: op.admission!, ...(op.proxyReceipt ? { proxyReceipt: op.proxyReceipt } : {}), ...(op.report.reference ? { reference: op.report.reference } : {}) })) };
    return parseOutcomePackage({ protocol, package: exportAgentPackage(agent, { ...exportOptions, packageId: this.envelope.package.packageId }), checkpoint });
  }
  async restore(): Promise<void> {
    if ((this.envelope.checkpoint?.operations.length ?? 0) > this.maximum) throw new Error('Remote checkpoint exceeds selected request capacity');
    for (const hint of this.envelope.checkpoint?.operations ?? []) {
      // Hints never establish action authority; only the owning scoped backend can bind them.
      const record = await storageOf(this).readRecord(hint.admission), admission = record?.result as Admission | undefined;
      if (admission?.kind !== ADMISSION_KIND || admission.request.packageId !== this.envelope.package.packageId || admission.request.requestId !== hint.operationId || admission.request.sessionId !== hint.sessionId
        || admission.request.toolName !== hint.toolName || admission.request.argumentsFingerprint !== hint.argumentsFingerprint) throw new Error('Remote checkpoint admission proof differs');
      await readAdmission(storageOf(this), hint.admission, admission.request);
      const op: Operation = { metadata: admission.request, effect: 'unknown', proxy: admission.proxy, admission: hint.admission, report: { operationId: hint.operationId, sessionId: hint.sessionId, toolName: hint.toolName,
        argumentsFingerprint: hint.argumentsFingerprint, admission: hint.admission, state: 'unknown', pendingSource: true, accounting: 'external_unknown' } };
      this.operations.set(hint.operationId, op); this.invocations.set(op.proxy.executionId, op);
      if (hint.proxyReceipt) {
        const proxyRecord = await storageOf(this).readRecord(hint.proxyReceipt);
        if (!proxyRecord || proxyRecord.source.executionId !== op.proxy.executionId || proxyRecord.source.toolName !== op.proxy.toolName || proxyRecord.source.callId !== op.proxy.callId || proxyRecord.source.runId !== op.proxy.runId) throw new Error('Remote checkpoint proxy receipt differs');
        op.proxyReceipt = hint.proxyReceipt; op.proxyOutcome = outcomeForWire(proxyRecord.source as ToolExecutionOutcome); op.report.proxyOutcome = op.proxyOutcome;
      }
      if (hint.reference) {
        const body = await validateObservation(storageOf(this), hint.reference, op.metadata, op.admission!, op.proxy);
        op.proxyOutcome = body.initialProxy ?? body.proxy; op.payload = { value: body.payload.result }; op.report = { ...op.report, proxyOutcome: body.initialProxy ?? body.proxy, receipt: body.receipt, reference: hint.reference, state: body.receipt.state, pendingSource: false };
      }
    }
  }
  close(): void { this.closed = true; /* Borrowed transport/backend and outstanding server work remain host-owned. */ }
  getStorage(): IEvidenceStorage | undefined { return this.storage; }
}
function storageOf(session: OutcomeSession): IEvidenceStorage { const storage = session.getStorage(); if (!storage) throw new Error('Remote session has no evidence storage'); return storage; }
async function createSession(input: OutcomeAgentPackage, options: { transport: RemoteOutcomeTransport; storage?: IEvidenceStorage; maxRequests?: number; onObservation?: AgentPackageOutcomeToolOptions['onObservation'] }): Promise<OutcomeSession> {
  const envelope = parseOutcomePackage(input), negotiation = parseOutcomeNegotiation(await options.transport.negotiate({ protocol, packageId: envelope.package.packageId }), envelope.package.packageId);
  const maximum = options.maxRequests ?? negotiation.limits.maxRequests;
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > negotiation.limits.maxRequests) throw new AgentPackageCompatibilityError('Invalid remote session request capacity');
  return new OutcomeSession(envelope, options.transport, options.storage, negotiation, maximum, options.onObservation);
}
export async function createAgentPackageOutcomeTools(input: OutcomeAgentPackage, options: AgentPackageOutcomeToolOptions): Promise<AgentPackageOutcomeTools> {
  const session = await createSession(input, options); await session.restore(); return { tools: session.tools, session };
}
export async function hydrateAgentPackageWithOutcomes(input: OutcomeAgentPackage, options: HydrateAgentPackageWithOutcomesOptions): Promise<OutcomeHydratedAgent> {
  const session = await createSession(input, options);
  const { transport: _transport, maxRequests: _maximum, onObservation: _observer, ...legacyOptions } = options;
  let agent: Agent | undefined;
  try {
    agent = await hydrateAgentPackageWithToolFactory(parseOutcomePackage(input).package, legacyOptions, (_packageId, descriptor) => {
      const tool = session.tools.find(tool => tool.definition.function.name === descriptor.definition.function.name); if (!tool) throw new Error('Remote tool did not negotiate'); return tool;
    });
    session.bind(agent); await session.restore(); return { agent, session };
  } catch (error) { agent?.destroy(); session.close(); throw error; }
}
