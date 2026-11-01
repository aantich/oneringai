import type { RuntimeControl } from './RuntimeSessionStorage.js';
import { controlJson } from './RuntimeSessionStorage.js';
import { ToolManager } from '../core/ToolManager.js';
import type { IConnectorRegistry } from '../domain/interfaces/IConnectorRegistry.js';
import type { ToolContext } from '../domain/interfaces/IToolContext.js';
import type { Agent, ExternalExecutionResult } from '../core/Agent.js';
import type { ToolFunction, ToolExecutionReport } from '../domain/entities/Tool.js';
import type { PermissionPolicyManager } from '../core/permissions/PermissionPolicyManager.js';
import { evidenceProjection } from '../core/evidence/ToolEvidenceMiddleware.js';
import { ToolExecutionError } from '../domain/errors/AIErrors.js';
import { AgentDriverConfigurationError } from './errors.js';
import { cloneAndFreezeJson, contentDigest } from './internal.js';
import type { JsonObject, RuntimeAgentDefinition, TrustedRuntimeContext } from './types.js';

/** Executable host objects never enter a saved definition or provider request. */
export interface RuntimeToolResolution {
  tools: readonly ToolFunction[];
  /** Includes host authorization, connector selections, implementation and evidence revisions. */
  fingerprint: string;
  /** Retain an existing C7 manager and its evidence handle; never clone its proxies. */
  manager?: ToolManager;
  owner?: Agent;
  ownership?: 'owned' | 'borrowed';
  permissionManager?: PermissionPolicyManager;
  toolContext?: Omit<ToolContext, 'userId' | 'signal'>;
  /** Trusted receipt/source reconciliation only; never a fresh execution/retry. */
  reconcile?: (call: { name: string; args: unknown; callId: string; runId: string; runtimeRunId?: string }, context: TrustedRuntimeContext) => Promise<ToolExecutionReport | undefined>;
  onRetainedObservation?: (callId: string, report: ToolExecutionReport) => void;
}
export interface RuntimeHostToolResult {
  modelText: string;
  outcome: ToolExecutionReport['outcome'];
  evidence?: ToolExecutionReport['evidence'];
  /** Ephemeral raw return; durable replay uses only the acknowledged model payload. */
  rawResult?: unknown;
}
export type RuntimeToolResolver = (
  names: readonly string[],
  context: Readonly<TrustedRuntimeContext>,
) => RuntimeToolResolution | Promise<RuntimeToolResolution>;

export function definitionDigest(definition: RuntimeAgentDefinition): string {
  return contentDigest(definition);
}

/** Serialized blocking execution through the existing manager, not a second tool pipeline. */
export class RuntimeHostTools {
  readonly definitions: readonly { name: string; description: string; parameters: JsonObject }[];
  readonly fingerprint: string;
  private manager?: ToolManager;
  private ownsManager = false;
  private tail: Promise<unknown> = Promise.resolve();
  private closed = false;
  control?: RuntimeControl;
  private run?: { id: string; signal: AbortSignal; stop?: (error: Error) => void };
  private ownerExecutionStarted = false;
  private ownerExecutionId?: string;
  private readonly processCalls = new Map<string, { digest: string; result: Promise<RuntimeHostToolResult> }>();
  private readonly retained = new Map<string, ToolExecutionReport>();

  constructor(readonly resolution: RuntimeToolResolution, private readonly context: TrustedRuntimeContext, private readonly connectorRegistry?: IConnectorRegistry) {
    const names = new Set<string>();
    this.definitions = resolution.tools.map(tool => {
      if (tool.definition.type !== 'function' || tool.definition.blocking === false || tool.definition.async) {
        throw new AgentDriverConfigurationError('Runtime host tools require blocking function tools');
      }
      const fn = tool.definition.function;
      if (fn.parameters && fn.parameters.type !== 'object') throw new AgentDriverConfigurationError('Common harness tools require an object-root JSON schema without coercion');
      if (!/^[a-zA-Z0-9_-]{1,64}$/.test(fn.name)) throw new AgentDriverConfigurationError(`Host tool '${fn.name}' cannot be represented by the common harness tool profile`);
      if (names.has(fn.name)) throw new AgentDriverConfigurationError(`Duplicate host tool '${fn.name}'`);
      names.add(fn.name);
      return cloneAndFreezeJson({ name: fn.name, description: fn.description ?? '', parameters: fn.parameters ?? { type: 'object', properties: {} } }, 'Host tool definition');
    });
    if (!resolution.fingerprint?.trim()) throw new AgentDriverConfigurationError('Host tool resolution requires a fingerprint');
    if (resolution.owner && resolution.manager && resolution.owner.tools !== resolution.manager) {
      throw new AgentDriverConfigurationError('Host owner and manager must share one ToolManager');
    }
    const manager = resolution.owner?.tools ?? resolution.manager;
    if (manager && resolution.tools.some(tool => manager.get(tool.definition.function.name) !== tool)) throw new AgentDriverConfigurationError('Resolved tools must retain their exact original manager registrations');
    if (resolution.owner && resolution.owner.userId !== context.userId) throw new AgentDriverConfigurationError('External Agent owner must match the trusted runtime user scope');
    this.fingerprint = resolution.fingerprint;
  }

  /** Called by the native driver after complete Agent construction. */
  attachNative(agent: Agent): void {
    if (this.manager || this.resolution.manager || this.resolution.owner) {
      throw new AgentDriverConfigurationError('Native materialization cannot clone an existing manager/Agent; configure a fresh native session');
    }
    this.manager = agent.tools;
  }

  async beginRun(id: string, signal: AbortSignal, stop?: (error: Error) => void, input?: string): Promise<void> {
    signal.throwIfAborted(); this.run = { id, signal, stop };
    try {
      if (this.resolution.owner) {
        this.ownerExecutionId = await this.resolution.owner.beginExternalExecution(); this.ownerExecutionStarted = true;
        if (input !== undefined) this.resolution.owner.recordExternalUserInput(input);
      }
    } catch (error) {
      if (this.ownerExecutionStarted) { try { await this.resolution.owner!.completeExternalExecution({ status: 'failed', error: error instanceof Error ? error : new Error(String(error)) }); } finally { this.ownerExecutionStarted = false; } }
      this.run = undefined; throw error;
    }
  }
  async endRun(result: ExternalExecutionResult = {}): Promise<void> {
    try { if (this.ownerExecutionStarted) await this.resolution.owner!.completeExternalExecution(result); }
    finally { this.ownerExecutionStarted = false; this.ownerExecutionId = undefined; this.run = undefined; }
  }

  execute(name: string, args: unknown, callId: string): Promise<RuntimeHostToolResult> {
    if (!this.definitions.some(t => t.name === name)) return Promise.reject(new AgentDriverConfigurationError(`Host tool '${name}' was not selected`));
    const run = this.run;
    if (!run || this.closed) return Promise.reject(new AgentDriverConfigurationError('Host tool invocation requires an attached active run'));
    const digest = contentDigest({ name, args });
    const processKey = `${run.id}:${callId}`;
    const prior = !this.control ? this.processCalls.get(processKey) : undefined;
    const legacy = (this.control?.data.outbox as JsonObject | undefined)?.[callId] as JsonObject | undefined;
    const legacyCall = legacy?.call as JsonObject | undefined;
    const ledgerKey = legacyCall && (legacyCall.runtimeRunId ?? legacyCall.runId) !== run.id ? processKey : callId;
    if (prior) return prior.digest === digest ? prior.result : Promise.reject(new AgentDriverConfigurationError('Native call ID conflict'));
    if (!this.control && this.processCalls.size >= 4096) return Promise.reject(new AgentDriverConfigurationError('Process tool-call ledger is full; create a new session'));
    const sourceRunId = this.ownerExecutionId ?? run.id;
    const invoke = async (): Promise<ToolExecutionReport<unknown>> => {
      if (run.signal.aborted) throw run.signal.reason;
      if (this.closed || this.run !== run) throw new AgentDriverConfigurationError('Host tool run has ended');
      if (this.resolution.owner) {
        const result = await this.resolution.owner.executeExternalToolCall({ id: callId, name, arguments: args as Record<string, unknown> }, { signal: run.signal });
        if (!result.outcome) throw new AgentDriverConfigurationError('External Agent tool execution did not expose authoritative outcome metadata');
        return { result: result.content, outcome: result.outcome, evidence: result.evidence };
      }
      const manager = this.getManager();
      return manager.executeWithOutcome(name, args, { callId, runId: run.id, signal: run.signal });
    };
    let raw: ToolExecutionReport | undefined;
    const project = async (): Promise<JsonObject> => {
      try { raw = await invoke(); }
      catch (error) {
        if (!(error instanceof ToolExecutionError) || !error.outcome) throw error;
        raw = { result: { error: error.message }, outcome: error.outcome };
      }
      this.retained.set(callId, raw);
      if (raw.evidence && raw.evidence.status !== 'stored') {
        const error = new AgentDriverConfigurationError('Tool observation requires evidence storage/projection repair; its raw result is retained and its action must not repeat');
        throw error;
      }
      const projection = evidenceProjection(raw.evidence, raw.result);
      if (raw.evidence?.projection && projection === undefined) {
        const error = new AgentDriverConfigurationError('Original source evidence projection cannot be verified; retain its observation and source module/handle');
        throw error;
      }
      const modelText = projection ?? JSON.stringify(raw.result) ?? 'null';
      return controlJson({ modelText, outcome: raw.outcome, evidence: raw.evidence });
    };
    const result = this.tail.then(async () => {
      const data = this.control
        ? await this.control.outbox(ledgerKey, project, digest, async priorCall => {
          const original = priorCall as { name: string; args: unknown; callId: string; runId: string; runtimeRunId?: string } | undefined;
          if (!original || original.name !== name || original.callId !== callId || contentDigest(original.args) !== contentDigest(args)) throw new AgentDriverConfigurationError('Missing/conflicting original invocation identity');
          const report = await this.resolution.reconcile?.(original, this.context);
          if (!report) return undefined;
          if (report.outcome.callId !== callId || report.outcome.toolName !== name || report.outcome.runId !== original.runId || report.outcome.completion !== 'settled' || (report.evidence && report.evidence.status !== 'stored')) throw new AgentDriverConfigurationError('Reconciled receipt does not match the original invocation');
          if (report.evidence?.projection && evidenceProjection(report.evidence, report.result) === undefined) throw new AgentDriverConfigurationError('Reconciled source projection lost its original provenance');
          raw = report;
          return controlJson({ modelText: evidenceProjection(report.evidence, report.result) ?? JSON.stringify(report.result), outcome: report.outcome, evidence: report.evidence });
        }, controlJson({ name, args, callId, runId: sourceRunId, runtimeRunId: run.id }))
        : await project();
      const report = { ...data, ...(raw ? { rawResult: raw.result } : {}) } as unknown as RuntimeHostToolResult;
      if (report.outcome.completion === 'unknown') {
        const error = new AgentDriverConfigurationError('Tool execution has an unresolved external effect; reconcile the original source receipt');
        throw error;
      }
      this.retained.delete(callId);
      return report;
    }).catch(error => {
      // An action may have settled even when its control acknowledgement failed.
      // Stop the native harness before it can interpret a broker error as permission to repeat it.
      run.stop?.(error instanceof Error ? error : new AgentDriverConfigurationError(String(error)));
      const retained = this.retained.get(callId);
      if (retained) {
        try { this.resolution.onRetainedObservation?.(callId, retained); }
        catch { /* The original observation remains retained; notification is not acknowledgement. */ }
      }
      throw error;
    });
    if (!this.control) this.processCalls.set(processKey, { digest, result });
    this.tail = result.catch(() => undefined);
    return result;
  }

  /** Reconcile retained effects even when a stopped native turn no longer requests their results. */
  async reconcilePending(reconcile = this.resolution.reconcile): Promise<void> {
    if (!this.control || !reconcile) return;
    const outbox = (this.control.data.outbox ?? {}) as JsonObject;
    for (const [ledgerKey, value] of Object.entries(outbox)) {
      const record = value as JsonObject;
      const outcome = (record.report as JsonObject | undefined)?.outcome as JsonObject | undefined;
      if (record.state === 'settled' && outcome?.completion !== 'unknown') continue;
      const call = record.call as { name: string; args: unknown; callId: string; runId: string; runtimeRunId?: string } | undefined;
      if (!call || !this.definitions.some(tool => tool.name === call.name)) continue;
      if (!(this.control.data.runs as JsonObject | undefined)?.[call.runtimeRunId ?? call.runId]) throw new AgentDriverConfigurationError('Retained invocation lost its original runtime run correlation');
      const report = await reconcile(call, this.context);
      if (!report) continue;
      if (report.outcome.callId !== call.callId || report.outcome.runId !== call.runId || report.outcome.toolName !== call.name || report.outcome.completion !== 'settled' || (report.evidence && report.evidence.status !== 'stored')) throw new AgentDriverConfigurationError('Source reconciliation does not prove the original settled invocation');
      if (report.evidence?.projection && evidenceProjection(report.evidence, report.result) === undefined) throw new AgentDriverConfigurationError('Reconciled source projection lost its original provenance');
      const saved = controlJson({ modelText: evidenceProjection(report.evidence, report.result) ?? JSON.stringify(report.result) ?? 'null', outcome: report.outcome, evidence: report.evidence });
      await this.control.update(data => { (data.outbox as JsonObject)[ledgerKey] = { ...record, state: 'settled', report: saved }; });
      this.retained.delete(call.callId);
    }
  }

  /** Host-only recovery inspection; never serialize this raw source into credentials/control config. */
  retainedObservation(callId: string): ToolExecutionReport | undefined { return this.retained.get(callId); }

  async close(): Promise<void> {
    this.closed = true;
    await this.tail;
    if (this.resolution.ownership === 'owned' && this.resolution.owner) this.resolution.owner.destroy();
    else if (this.ownsManager || this.resolution.ownership === 'owned') this.manager?.destroy();
  }

  private getManager(): ToolManager {
    if (this.manager) return this.manager;
    this.manager = this.resolution.owner?.tools ?? this.resolution.manager;
    if (!this.manager) {
      this.manager = new ToolManager();
      this.ownsManager = true;
      this.manager.setToolContext({ ...this.resolution.toolContext, userId: this.context.userId, connectorRegistry: this.resolution.toolContext?.connectorRegistry ?? this.connectorRegistry });
      for (const tool of this.resolution.tools) this.manager.register(tool);
      if (this.resolution.permissionManager) this.manager.setPermissionManager(this.resolution.permissionManager);
    }
    return this.manager;
  }
}
