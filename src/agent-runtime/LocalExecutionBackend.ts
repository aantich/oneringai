import { constants as fsConstants } from 'node:fs';
import { access, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { RuntimeHostTools, type RuntimeToolResolver } from './RuntimeHostTools.js';
import { RuntimeFileTransfers, type RuntimeFileTransferAccess } from './RuntimeFileTransfers.js';
import { DefinitionSession } from './DefinitionSession.js';
import { StorageRegistry } from '../core/StorageRegistry.js';
import { RuntimeControl, controlJson, type IRuntimeSessionStorage } from './RuntimeSessionStorage.js';
import { Connector } from '../core/Connector.js';
import type { IConnectorRegistry } from '../domain/interfaces/IConnectorRegistry.js';
import type { AgentDriver, DriverDescriptor, DriverEvent, DriverRun, DriverRunResult, DriverSession } from './AgentDriver.js';
import type { AgentExecutionBackend } from './AgentExecutionBackend.js';
import { AsyncEventHub } from './AsyncEventHub.js';
import {
  AgentBusyError,
  AgentCapabilityUnsupportedError,
  AgentDriverConfigurationError,
  AgentDriverNotFoundError,
  AgentNativeExecutionError,
  AgentRunTimeoutError,
  AgentSessionRecoveryError,
  AgentWorkspaceError,
} from './errors.js';
import { cloneAndFreezeJson, contentDigest, runtimeConnectorIdentity, createDeferred, errorMessage, mergeRequirements, toJsonValue, cloneAndFreezeSpec, raceWithAbort } from './internal.js';
import type {
  AgentCapabilityRequirement,
  AgentEventSubscriptionOptions,
  AgentExecutionPolicy,
  AgentInspectionRequest,
  AgentInteractionResponse,
  AgentObservationOptions,
  AgentRun,
  AgentRunInput,
  AgentRunOptions,
  AgentRunResult,
  AgentSession,
  AgentSessionState,
  OpenAgentSessionOptions,
  ResolvedAgentCapabilities,
  ResolvedWorkspace,
  RuntimeAgentSpec,
  JsonValue,
  JsonObject,
  WorkspaceRequest,
} from './types.js';

const DEFAULT_EVENT_BUFFER_BYTES = 1024 * 1024;
const DEFAULT_SESSION_JOURNAL_BYTES = 4 * DEFAULT_EVENT_BUFFER_BYTES;
const DEFAULT_CLEANUP_TIMEOUT_MS = 2_000;

export interface LocalExecutionBackendOptions {
  drivers: AgentDriver[];
  connectorRegistry?: IConnectorRegistry;
  maxSessionJournalBytes?: number;
  resolveTools?: RuntimeToolResolver;
  sessionStorage?: IRuntimeSessionStorage;
  /** Host-selected per-scope directory; absent means transfers are disabled. */
  fileTransfer?: (context: Readonly<import('./types.js').TrustedRuntimeContext>) => RuntimeFileTransferAccess | Promise<RuntimeFileTransferAccess>;

}

export class LocalExecutionBackend implements AgentExecutionBackend {
  private readonly drivers = new Map<string, AgentDriver>();
  private readonly connectorRegistry: IConnectorRegistry;
  private readonly maxSessionJournalBytes: number;
  private readonly sessions = new Set<LocalAgentSession>();
  private readonly workspaceLeases = new Map<string, string>();
  private readonly definitionSessions = new Map<string, { session: DefinitionSession; scope: string; spec: Readonly<RuntimeAgentSpec>; options: OpenAgentSessionOptions; hostTools?: RuntimeHostTools; control?: RuntimeControl }>();
  private _isDestroyed = false;

  constructor(private readonly options: LocalExecutionBackendOptions) {
    if (options.maxSessionJournalBytes !== undefined && (
      !Number.isSafeInteger(options.maxSessionJournalBytes) || options.maxSessionJournalBytes < 1024
    )) {
      throw new AgentDriverConfigurationError('maxSessionJournalBytes must be a safe integer of at least 1024');
    }
    for (const driver of options.drivers) {
      if (this.drivers.has(driver.id)) throw new Error(`Duplicate agent driver id '${driver.id}'`);
      this.drivers.set(driver.id, driver);
    }
    this.connectorRegistry = options.connectorRegistry ?? staticConnectorRegistry;
    this.maxSessionJournalBytes = options.maxSessionJournalBytes ?? DEFAULT_SESSION_JOURNAL_BYTES;
  }

  get isDestroyed(): boolean {
    return this._isDestroyed;
  }

  async inspect(
    spec: Readonly<RuntimeAgentSpec>,
    request: AgentInspectionRequest = {},
  ): Promise<ResolvedAgentCapabilities> {
    this.assertActive();
    if (request.policy) validatePolicy(request.policy);
    const hostTools = await this.resolveHostTools(spec, request.context ?? {});
    const driver = this.getDriver(spec.driver);
    const workspace = request.workspace
      ? await this.resolveWorkspace(request.workspace, request.policy)
      : undefined;
    this.assertActive();
    const requiredCapabilities = mergeRequirements(spec, [...(request.requiredCapabilities ?? []), ...(spec.environment?.type === 'provider-managed' ? [{ id: 'environment.provider-managed' }] : [])]);
    const descriptor = await driver.inspect({
      spec,
      context: request.context,
      workspace,
      policy: request.policy,
      requiredCapabilities,
      connectorRegistry: this.connectorRegistry,
      durability: this.getStorage(request.context ?? {})?.durability,
    });
    this.assertActive();
    const capabilities = this.describe(spec, request, workspace, hostTools, descriptor);
    this.assertCapabilities(capabilities, requiredCapabilities);
    return capabilities;
  }

  private describe(spec: Readonly<RuntimeAgentSpec>, request: AgentInspectionRequest, workspace: ResolvedWorkspace | undefined, hostTools: RuntimeHostTools | undefined, descriptor: DriverDescriptor): ResolvedAgentCapabilities {
    if (!spec.definition) return descriptor.capabilities;
    const transferCapabilities = Object.fromEntries(['files.upload', 'files.download'].filter(id => descriptor.capabilities.capabilities[id] && !this.options.fileTransfer).map(id => [id, { id, support: 'unsupported' as const, reason: 'Host fileTransfer access is disabled' }]));
    return { ...descriptor.capabilities, inspection: {
      executionDigest: contentDigest({ spec, policy: request.policy, workspace: workspace?.identity, tools: hostTools?.fingerprint, schemas: hostTools?.definitions, connector: this.connectorIdentity(spec), configuration: descriptor.capabilities.configuration, profile: descriptor.capabilities.capabilities['agent.definition']?.constraints }),
      tools: (hostTools?.definitions ?? []).map(tool => ({ name: tool.name, schemaDigest: contentDigest(tool.parameters), ...(descriptor.inspection?.toolNamePrefix !== undefined ? { transportName: `${descriptor.inspection.toolNamePrefix}${tool.name}` } : {}) })),
      environment: spec.environment ?? (workspace ? { type: 'local-directory', path: workspace.root } : { type: 'unspecified' }),
      enforcement: { hostTools: 'host', nativeFilesystem: 'unknown', nativeCommands: 'unknown', sandboxNetwork: 'unknown', providerWebSearch: 'unknown', ...descriptor.inspection?.enforcement },
      accountAccess: 'unknown', usageCoverage: 'native-reported-partial', activityReplay: 'bounded-process-history',
      notes: ['Inspection creates no native resources and grants no authorization.', 'Durable control does not prove native checkpoint availability. Restored activity history may have gaps.', ...(descriptor.inspection?.notes ?? [])],
    }, capabilities: { ...descriptor.capabilities.capabilities, ...transferCapabilities,
      'runtime.control': { id: 'runtime.control', support: 'emulated', constraints: { durability: this.getStorage(request.context ?? {})?.durability ?? 'process' } },
      ...(hostTools && descriptor.capabilities.capabilities['tools.host'] ? { 'tools.host': { ...descriptor.capabilities.capabilities['tools.host']!, constraints: { ...descriptor.capabilities.capabilities['tools.host']?.constraints, fingerprint: hostTools.fingerprint, selected: hostTools.definitions.map(t => t.name) } } } : {}),
    } };
  }

  async openSession(
    spec: Readonly<RuntimeAgentSpec>,
    options: OpenAgentSessionOptions,
  ): Promise<AgentSession> {
    this.assertActive();
    validateSessionOptions(options);
    const immutableOptions = cloneAndFreezeJson(options, 'Agent session options') as Readonly<OpenAgentSessionOptions>;
    const driver = this.getDriver(spec.driver);
    const workspace = immutableOptions.workspace
      ? await this.resolveWorkspace(immutableOptions.workspace, immutableOptions.policy)
      : undefined;
    this.assertActive();
    const requestedCapabilities = [
      ...(immutableOptions.requiredCapabilities ?? []),
      ...(spec.environment?.type === 'provider-managed' ? [{ id: 'environment.provider-managed' }] : []),
      ...(immutableOptions.controlMode === 'steerable' ? [{ id: 'run.steer' as const }] : []),
    ];
    const requiredCapabilities = mergeRequirements(spec, requestedCapabilities);
    const descriptor = await driver.inspect({
      spec,
      context: immutableOptions.context,
      workspace,
      policy: immutableOptions.policy,
      requiredCapabilities,
      connectorRegistry: this.connectorRegistry,
      durability: this.getStorage(immutableOptions.context)?.durability,
    });
    this.assertActive();
    const hostTools = await this.resolveHostTools(spec, immutableOptions.context);
    const capabilities = this.describe(spec, immutableOptions, workspace, hostTools, descriptor);
    this.assertCapabilities(capabilities, requiredCapabilities);
    const id = `session_${randomUUID()}`;
    const storage = spec.definition ? this.getStorage(immutableOptions.context) : undefined;
    const lease = storage ? await storage.acquire(id, immutableOptions.context) : undefined;
    let control: RuntimeControl | undefined;
    if (lease) {
      try {
        const record = await lease.write(controlJson({ spec, options: immutableOptions, capabilities,
          connectorIdentity: this.connectorIdentity(spec), toolsSchemaDigest: contentDigest(hostTools?.definitions ?? []), toolsFingerprint: hostTools?.fingerprint ?? '', workspaceIdentity: workspace?.identity ?? null, state: 'opening', requests: {}, runs: {}, outbox: {} }), 0);
        control = new RuntimeControl(lease, record);
      } catch (error) { await lease.release(); throw error; }
    }
    if (hostTools) hostTools.control = control;
    const request = { spec, context: immutableOptions.context, workspace, policy: immutableOptions.policy,
      requiredCapabilities, connectorRegistry: this.connectorRegistry, metadata: immutableOptions.metadata,
      hostTools, sessionId: id, control, durability: storage?.durability };
    let native: DriverSession | undefined;
    try {
      native = await driver.openSession(request);
      const checkpoint = control ? await native.checkpoint?.() : undefined;
      await control?.update(data => { data.state = 'ready'; if (checkpoint) data.checkpoint = checkpoint; });
      this.assertActive();
      const prepared = this.prepareSession(spec, immutableOptions, capabilities, native, hostTools, control, id, workspace);
      prepared.register();
      return prepared.session;
    } catch (error) {
      await settleWithin(Promise.resolve().then(() => native?.destroy()), DEFAULT_CLEANUP_TIMEOUT_MS);
      await hostTools?.close();
      await control?.release();
      if (control) throw new AgentSessionRecoveryError(`Session open failed; inspect/reconcile or delete its recorded resources: ${errorMessage(error)}`, { version: 1, id });
      throw error;
    }
  }

  private prepareSession(
    spec: Readonly<RuntimeAgentSpec>, options: OpenAgentSessionOptions, capabilities: ResolvedAgentCapabilities,
    nativeSession: DriverSession, hostTools: RuntimeHostTools | undefined, control: RuntimeControl | undefined,
    id: string, workspace?: ResolvedWorkspace,
  ): { session: DefinitionSession | LocalAgentSession; local: LocalAgentSession; register: () => void } {
    const session = new LocalAgentSession({
      id, agentId: spec.id, driverId: spec.driver, nativeSession, hostTools,
      definitionMode: !!spec.definition, capabilities: cloneAndFreezeJson(capabilities, 'Resolved agent capabilities'),
      policy: options.policy, observation: normalizeObservation(options.observation), workspace,
      maxSessionJournalBytes: this.maxSessionJournalBytes,
      onNativeAccepted: control ? async runId => {
        const checkpoint = await nativeSession.checkpoint?.();
        await control.update(data => {
          const run = (data.runs as JsonObject)[runId] as JsonObject;
          if (run) run.state = 'observing';
          if (checkpoint) data.checkpoint = checkpoint;
        });
      } : undefined,
      acquireWorkspace: (identity, runId) => this.acquireWorkspace(identity, runId),
      releaseWorkspace: (identity, runId) => this.releaseWorkspace(identity, runId),
      onDestroy: () => this.sessions.delete(session),
    });
    let expanded: DefinitionSession | undefined;
    if (spec.definition) {
      const connectorStamp = this.connectorIdentity(spec);
      expanded = new DefinitionSession(session, nativeSession, {
        files: this.options.fileTransfer ? new RuntimeFileTransfers(async () => {
          if (this.connectorIdentity(spec) !== connectorStamp) throw new AgentDriverConfigurationError('File transfer connector authorization changed');
          return this.options.fileTransfer!(options.context);
        }, nativeSession, options.policy.limits?.artifactBytes) : undefined,
        control, start: (input, runOptions, runId) => session.run(input, runOptions, { id: runId }),
        detachObserver: () => session.detachObserver(),
        drainTools: () => hostTools?.close() ?? Promise.resolve(),
        onDetach: control ? () => { this.sessions.delete(session); this.definitionSessions.delete(id); } : undefined,
      });
    }
    return { session: expanded ?? session, local: session, register: () => {
      this.sessions.add(session);
      if (expanded) this.definitionSessions.set(id, { session: expanded, scope: scopeKey(options.context), spec, options, hostTools, control });
    } };
  }

  async resumeSession(reference: import('./types.js').RuntimeSessionReference, options: import('./types.js').RuntimeResumeOptions): Promise<import('./types.js').RuntimeSession> {
    this.assertActive();
    if (reference.version !== 1) throw new AgentDriverConfigurationError('Unsupported session reference version');
    const entry = this.definitionSessions.get(reference.id);
    if (entry && entry.scope !== scopeKey(options.context)) throw new AgentDriverConfigurationError('Session reference is unavailable in this scope');
    if (entry && entry.session.state === 'failed' && entry.session.canReobserve) await entry.session.detach();
    if (entry && !entry.session.isDestroyed && !entry.session.isDetached) {
      if (entry.scope !== scopeKey(options.context)) throw new AgentDriverConfigurationError('Session reference is unavailable in this scope');
      const host = await this.resolveHostTools(entry.spec, options.context);
      await this.inspect(entry.spec, { ...entry.options, context: options.context });
      if ((host?.fingerprint ?? '') !== (entry.hostTools?.fingerprint ?? '')) throw new AgentDriverConfigurationError('Host authorization/tool fingerprint changed');
      await entry.hostTools?.reconcilePending(host?.resolution.reconcile);
      return entry.session;
    }
    if (entry && !this.getStorage(options.context)) {
      if (entry.scope !== scopeKey(options.context)) throw new AgentDriverConfigurationError('Session reference is unavailable in this scope');
      entry.session.reattach(); return entry.session;
    }
    const storage = this.getStorage(options.context);
    if (!storage) throw new AgentDriverConfigurationError('Session reference is unavailable in this scope/process');
    const lease = await storage.acquire(reference.id, options.context);
    let control: RuntimeControl | undefined;
    let native: DriverSession | undefined;
    let hostTools: RuntimeHostTools | undefined;
    let local: LocalAgentSession | undefined;
    try {
      const record = await lease.read();
      if (!record) throw new AgentDriverConfigurationError('Session reference is unavailable in this scope');
      control = new RuntimeControl(lease, record);
      const spec = cloneAndFreezeSpec(record.data.spec as unknown as RuntimeAgentSpec);
      const savedOptions = cloneAndFreezeJson(record.data.options, 'Saved runtime options') as unknown as OpenAgentSessionOptions;
      validateSessionOptions(savedOptions);
      const restoredOptions = { ...savedOptions, context: options.context, ...(options.observation ? { observation: options.observation } : {}) };
      const capabilities = await this.inspect(spec, restoredOptions);
      if (record.data.connectorIdentity && this.connectorIdentity(spec) !== record.data.connectorIdentity) throw new AgentDriverConfigurationError('Connector endpoint/account configuration changed since checkpoint');
      const oldCapabilities = record.data.capabilities as unknown as ResolvedAgentCapabilities;
      const stamp = (value: unknown) => contentDigest(value ?? {});
      if (stamp(oldCapabilities.capabilities['agent.definition']?.constraints) !== stamp(capabilities.capabilities['agent.definition']?.constraints)) throw new AgentDriverConfigurationError('Native configuration changed since checkpoint');
      hostTools = await this.resolveHostTools(spec, options.context);
      if (record.data.toolsSchemaDigest && contentDigest(hostTools?.definitions ?? []) !== record.data.toolsSchemaDigest) throw new AgentDriverConfigurationError('Selected tool schemas changed since checkpoint');
      if ((hostTools?.fingerprint ?? '') !== record.data.toolsFingerprint) throw new AgentDriverConfigurationError('Host tool/schema/authorization fingerprint changed; reauthorize migration explicitly');
      if (hostTools) { hostTools.control = control; await hostTools.reconcilePending(); }
      const workspace = savedOptions.workspace ? await this.resolveWorkspace(savedOptions.workspace, savedOptions.policy) : undefined;
      if ((workspace?.identity ?? null) !== record.data.workspaceIdentity) throw new AgentDriverConfigurationError('Workspace identity changed since checkpoint');
      const driver = this.getDriver(spec.driver);
      if (!driver.restoreSession || !record.data.checkpoint) throw new AgentSessionRecoveryError('Driver has no complete native checkpoint; do not resubmit recorded input', reference, record.data.activeRunId as string | undefined);
      const restored = await driver.restoreSession({ spec, context: options.context, workspace,
        policy: savedOptions.policy, requiredCapabilities: mergeRequirements(spec, savedOptions.requiredCapabilities),
        connectorRegistry: this.connectorRegistry, hostTools, control, sessionId: reference.id, durability: storage.durability,
        checkpoint: record.data.checkpoint as JsonObject });
      native = restored.session;
      this.assertActive();
      const prepared = this.prepareSession(spec, restoredOptions, capabilities, native, hostTools, control, reference.id, workspace);
      const expanded = prepared.session as DefinitionSession;
      local = prepared.local;
      if (record.data.activeRunId && restored.activeRun) {
        const runId = String(record.data.activeRunId);
        const savedRun = (record.data.runs as JsonObject)[runId] as JsonObject;
        const payload = savedRun.payload as JsonObject;
        const previousHighWater = Number(savedRun.sequenceHighWater ?? 0);
        await control.update(data => { ((data.runs as JsonObject)[runId] as JsonObject).sequenceHighWater = previousHighWater + 1000000; });
        this.assertActive();
        const run = await local.run(payload.input as AgentRunInput, (payload.options ?? {}) as AgentRunOptions,
          { id: runId, driverRun: restored.activeRun, sequenceStart: previousHighWater });
        expanded.trackRun(run);
      } else if (record.data.activeRunId) {
        // Local native snapshots cannot prove what an interrupted input did.
        local.markUnknown();
      }
      // Publish only after persistence and active-run adoption succeed. Concurrent
      // restoration must contend on the storage lease, never borrow a partial observer.
      this.assertActive();
      prepared.register();
      return expanded;
    } catch (error) {
      local?.detachObserver();
      // Restoring observation is not authorization to cancel existing native work.
      await settleWithin(Promise.resolve().then(async () => {
        if (native?.detach) await native.detach();
        else if (!native?.observationIndependent) await native?.destroy();
      }), DEFAULT_CLEANUP_TIMEOUT_MS);
      try { await hostTools?.close(); }
      finally { if (control) await control.release(); else await lease.release(); }
      throw error;
    }
  }

  async deleteSession(reference: import('./types.js').RuntimeSessionReference, options: import('./types.js').RuntimeResumeOptions): Promise<void> {
    const entry = this.definitionSessions.get(reference.id);
    if (entry) {
      if (entry.scope !== scopeKey(options.context)) throw new AgentDriverConfigurationError('Session reference is unavailable in this scope');
      await entry.session.destroy(); this.definitionSessions.delete(reference.id);
      if (!this.getStorage(options.context)) return;
    }
    const storage = this.getStorage(options.context);
    if (!storage || reference.version !== 1) throw new AgentDriverConfigurationError('Session reference is unavailable in this scope');
    const lease = await storage.acquire(reference.id, options.context);
    try {
      const record = await lease.read(); if (!record) return;
      const unresolved = Object.values((record.data.outbox ?? {}) as JsonObject).some(value => (value as JsonObject).state !== 'settled' || (((value as JsonObject).report as JsonObject | undefined)?.outcome as JsonObject | undefined)?.completion === 'unknown');
      if (unresolved) throw new AgentSessionRecoveryError('Reconcile retained tool effects before deleting their control record', reference);
      const spec = record.data.spec as unknown as RuntimeAgentSpec;
      const saved = record.data.options as unknown as OpenAgentSessionOptions;
      cloneAndFreezeSpec(spec); validateSessionOptions(saved);
      if (spec.connector) this.connectorRegistry.get(spec.connector);
      if (record.data.connectorIdentity && this.connectorIdentity(spec) !== record.data.connectorIdentity) throw new AgentDriverConfigurationError('Connector endpoint/account configuration changed since checkpoint');
      const driver = this.getDriver(spec.driver);
      const cleanupControl = new RuntimeControl(lease, record);
      if (driver.deleteSession && record.data.checkpoint) await driver.deleteSession({ spec, context: options.context, control: cleanupControl, durability: storage.durability,
        workspace: saved.workspace ? await this.resolveWorkspace(saved.workspace, saved.policy) : undefined,
        policy: saved.policy, requiredCapabilities: mergeRequirements(spec, saved.requiredCapabilities), connectorRegistry: this.connectorRegistry,
        sessionId: reference.id, checkpoint: record.data.checkpoint as JsonObject });
      else if (record.data.activeRunId) throw new AgentSessionRecoveryError('Native execution must be reconciled before deletion', reference, String(record.data.activeRunId));
      await lease.delete();
    } finally { await lease.release(); }
  }

  private getStorage(context: import('./types.js').TrustedRuntimeContext): IRuntimeSessionStorage | undefined {
    return this.options.sessionStorage ?? StorageRegistry.get('runtimeSessions')?.(context);
  }

  private connectorIdentity(spec: Readonly<RuntimeAgentSpec>): string {
    if (!spec.connector) return '';
    return runtimeConnectorIdentity(this.connectorRegistry.get(spec.connector));
  }
  private async resolveHostTools(spec: Readonly<RuntimeAgentSpec>, context: import('./types.js').TrustedRuntimeContext): Promise<RuntimeHostTools | undefined> {
    if (!spec.definition) return undefined;
    if (!spec.connector || !spec.model) throw new AgentDriverConfigurationError('Definition execution requires a named connector and model');
    this.connectorRegistry.get(spec.connector);
    if (spec.instructions !== undefined || spec.driverConfig?.source !== undefined) throw new AgentDriverConfigurationError('Definition mode cannot also select legacy instructions/source');
    const names = spec.definition.tools ?? [];
    if (!names.length) return undefined;
    if (!this.options.resolveTools) throw new AgentDriverConfigurationError('Selected tools require a host tool resolver');
    const resolution = await this.options.resolveTools(names, context);
    const resolved = resolution.tools.map(t => t.definition.type === 'function' ? t.definition.function.name : '');
    if (resolved.length !== names.length || names.some(name => !resolved.includes(name))) throw new AgentDriverConfigurationError('Host resolver must return exactly the selected tools');
    return new RuntimeHostTools(resolution, context, this.connectorRegistry);
  }

  async destroy(): Promise<void> {
    if (this._isDestroyed) return;
    this._isDestroyed = true;
    await Promise.allSettled([...this.definitionSessions.values()].map(entry => entry.session.destroy()));
    await Promise.allSettled([...this.sessions].map((session) => session.destroy()));
    this.sessions.clear();
    this.workspaceLeases.clear();
  }

  private getDriver(id: string): AgentDriver {
    const driver = this.drivers.get(id);
    if (!driver) throw new AgentDriverNotFoundError(id);
    return driver;
  }

  private async resolveWorkspace(
    request: WorkspaceRequest,
    policy?: AgentExecutionPolicy,
  ): Promise<ResolvedWorkspace> {
    if (request.type !== 'local-directory') {
      throw new AgentWorkspaceError("The local backend does not support managed workspaces");
    }
    try {
      const root = await realpath(request.path);
      const info = await stat(root);
      if (!info.isDirectory()) throw new AgentWorkspaceError(`Workspace '${root}' is not a directory`);
      if (path.parse(root).root === root) {
        throw new AgentWorkspaceError('Filesystem roots cannot be used as agent workspaces');
      }
      await access(root, fsConstants.R_OK);
      if (policy?.filesystem === 'workspace-write') await access(root, fsConstants.W_OK);
      return { type: 'local-directory', root, identity: root };
    } catch (error) {
      if (error instanceof AgentWorkspaceError) throw error;
      throw new AgentWorkspaceError(`Cannot resolve workspace '${request.path}': ${errorMessage(error)}`, error as Error);
    }
  }

  private assertCapabilities(
    resolved: ResolvedAgentCapabilities,
    requirements: AgentCapabilityRequirement[],
  ): void {
    for (const requirement of requirements) {
      const capability = resolved.capabilities[requirement.id];
      if (!capability || !['native', 'emulated'].includes(capability.support)) {
        throw new AgentCapabilityUnsupportedError(requirement.id, capability?.reason);
      }
      if (requirement.minimum === 'native' && capability.support !== 'native') {
        throw new AgentCapabilityUnsupportedError(requirement.id, 'native support is required');
      }
    }
  }

  private acquireWorkspace(identity: string | undefined, runId: string): void {
    if (!identity) return;
    const owner = this.workspaceLeases.get(identity);
    if (owner) throw new AgentBusyError(`Workspace '${identity}' is already used by run '${owner}'`);
    this.workspaceLeases.set(identity, runId);
  }

  private releaseWorkspace(identity: string | undefined, runId: string): void {
    if (identity && this.workspaceLeases.get(identity) === runId) this.workspaceLeases.delete(identity);
  }

  private assertActive(): void {
    if (this._isDestroyed) throw new Error('LocalExecutionBackend has been destroyed');
  }
}

interface LocalAgentSessionOptions {
  id?: string;
  definitionMode?: boolean;
  onNativeAccepted?: (runId: string) => Promise<void>;
  agentId: string;
  driverId: string;
  nativeSession: DriverSession;
  hostTools?: RuntimeHostTools;
  capabilities: ResolvedAgentCapabilities;
  policy: AgentExecutionPolicy;
  observation: Required<AgentObservationOptions>;
  workspace?: ResolvedWorkspace;
  maxSessionJournalBytes: number;
  acquireWorkspace: (identity: string | undefined, runId: string) => void;
  releaseWorkspace: (identity: string | undefined, runId: string) => void;
  onDestroy: () => void;
}

class LocalAgentSession implements AgentSession {
  readonly id: string;
  readonly agentId: string;
  readonly capabilities: ResolvedAgentCapabilities;
  private _state: AgentSessionState = 'ready';
  private observer?: AbortController;
  private activeRun?: LocalAgentRun;
  private readonly completedHubs: AsyncEventHub[] = [];
  private _isDestroyed = false;

  constructor(private readonly options: LocalAgentSessionOptions) {
    this.id = options.id ?? `session_${randomUUID()}`;
    this.agentId = options.agentId;
    this.capabilities = options.capabilities;
  }

  get state(): AgentSessionState {
    return this._state;
  }

  get isDestroyed(): boolean {
    return this._isDestroyed;
  }

  markUnknown(): void { this._state = 'failed'; }
  detachObserver(): void { this.observer?.abort(new Error('Observer detached')); }

  async run(input: AgentRunInput, options: AgentRunOptions = {}, adoption?: { id: string; driverRun?: DriverRun; sequenceStart?: number }): Promise<AgentRun> {
    if (this._isDestroyed) throw new Error('AgentSession has been destroyed');
    if (this._state === 'failed') throw new Error('AgentSession cannot run again after unconfirmed native termination');
    if (this.activeRun) throw new AgentBusyError();
    if (options.signal?.aborted) throw options.signal.reason ?? new Error('Run aborted before start');
    const immutableInput = typeof input === 'string'
      ? input
      : cloneAndFreezeJson(input, 'Agent run input') as Readonly<AgentRunInput>;
    const runOptions = cloneAndFreezeJson({
      ...(options.model !== undefined ? { model: options.model } : {}),
      ...(options.reasoning !== undefined ? { reasoning: options.reasoning } : {}),
      ...(options.responseFormat !== undefined ? { responseFormat: options.responseFormat } : {}),
      ...(options.metadata !== undefined ? { metadata: options.metadata } : {}),
    }, 'Agent run options') as Readonly<Omit<AgentRunOptions, 'signal'>>;
    if (runOptions.model !== undefined) {
      if (typeof runOptions.model !== 'string' || !runOptions.model.trim()) {
        throw new AgentDriverConfigurationError('Run model override must be a non-empty string');
      }
      this.assertRunCapability('run.model_override');
    }
    if (runOptions.reasoning !== undefined) {
      validateReasoning(runOptions.reasoning);
      this.assertRunCapability('run.reasoning_override');
    }
    if (runOptions.responseFormat !== undefined) {
      validateResponseFormat(runOptions.responseFormat);
      if (runOptions.responseFormat.type === 'json_schema') {
        this.assertRunCapability('run.structured_output');
      }
    }
    if (hasWorkspaceFileInput(immutableInput as AgentRunInput)) {
      if (this.options.hostTools?.resolution.owner) throw new AgentCapabilityUnsupportedError('owner.input.image', 'External Agent lifecycle ownership currently requires text input');
      this.assertRunCapability('input.image');
    }

    const runId = adoption?.id ?? `run_${randomUUID()}`;
    this.options.acquireWorkspace(this.options.workspace?.identity, runId);
    const controller = new AbortController();
    const observer = new AbortController(); this.observer = observer;
    let timedOut = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const onExternalAbort = () => controller.abort(options.signal?.reason);
    options.signal?.addEventListener('abort', onExternalAbort, { once: true });

    const wallTimeMs = this.options.policy.limits?.wallTimeMs;
    if (wallTimeMs && wallTimeMs > 0) {
      timeout = setTimeout(() => {
        timedOut = true;
        controller.abort(new AgentRunTimeoutError(wallTimeMs));
      }, wallTimeMs);
    }

    const eventBufferBytes = Math.min(
      this.options.policy.limits?.eventBufferBytes ?? DEFAULT_EVENT_BUFFER_BYTES,
      this.options.maxSessionJournalBytes,
    );
    const hub = new AsyncEventHub(runId, this.id, eventBufferBytes, eventBufferBytes, adoption?.sequenceStart ?? 0, this.options.onNativeAccepted ? (adoption?.sequenceStart ?? 0) + 1000000 : Number.MAX_SAFE_INTEGER);
    const deferred = createDeferred<AgentRunResult>();
    const run = new LocalAgentRun(runId, this.id, hub, deferred.promise, controller, this.capabilities);
    this.activeRun = run;
    this._state = 'running';

    const effectiveConfiguration = {
      ...this.capabilities.configuration,
      ...(runOptions.model !== undefined ? { model: runOptions.model } : {}),
      ...(runOptions.reasoning !== undefined ? { reasoning: runOptions.reasoning } : {}),
    };
    hub.publish('run.started', {
      driver: this.options.driverId,
      configuration: toJsonValue(effectiveConfiguration),
      observation: toJsonValue(this.options.observation),
    });

    const onRuntimeAbort = () => {
      const reason = controller.signal.reason;
      const message = reason instanceof Error ? reason.message : String(reason ?? 'Runtime abort signal');
      void run.cancelNative(message, this.options.nativeSession).catch(() => undefined);
    };
    controller.signal.addEventListener('abort', onRuntimeAbort, { once: true });

    let finished = false;
    const finish = (result: AgentRunResult) => {
      if (finished) return;
      finished = true;

      if (timeout) clearTimeout(timeout);
      controller.signal.removeEventListener('abort', onRuntimeAbort);
      options.signal?.removeEventListener('abort', onExternalAbort);
      if (this.activeRun === run) this.activeRun = undefined;
      this.observer = undefined;
      const nativeTerminationIsUnconfirmed = !run.nativeTerminationConfirmed;
      if (nativeTerminationIsUnconfirmed) {
        // A native process may still be mutating the workspace. Keep the lease
        // until the backend itself is destroyed rather than allowing overlap.
      } else {
        this.options.releaseWorkspace(this.options.workspace?.identity, runId);
      }
      if (!this._isDestroyed) this._state = nativeTerminationIsUnconfirmed ? 'failed' : 'ready';
      this.retainHub(hub);
      if (this.options.definitionMode && nativeTerminationIsUnconfirmed) result = { ...result, status: 'incomplete', finishReason: 'native_state_unknown', error: { code: 'AGENT_SESSION_RECOVERY_REQUIRED', message: 'Native termination is unconfirmed; recover the original run' } };
      deferred.resolve(result);
    };

    void this.executeRun(run, immutableInput as AgentRunInput, runOptions, hub, controller, () => timedOut, wallTimeMs, observer.signal, adoption?.driverRun).then(
      async (result) => {
        try { await this.options.hostTools?.endRun({ status: run.nativeTerminationConfirmed ? result.status : 'incomplete', outputText: result.outputText, ...(result.error ? { error: new Error(result.error.message) } : {}) }); }
        catch (error) { result = { ...result, status: 'failed', error: { code: 'AGENT_EXTERNAL_LIFECYCLE', message: errorMessage(error) } }; }
        try {
          if (!this.options.definitionMode || run.nativeTerminationConfirmed) hub.publish('run.finished', { status: result.status, finishReason: result.finishReason ?? null });
          else hub.publish('diagnostic', { code: 'NATIVE_TERMINATION_UNKNOWN', message: 'Recover the original native run; no terminal event is asserted' });
          hub.complete();
        } finally {
          hub.complete();
          finish(result);
        }
      },
      async (error) => {
        try { await this.options.hostTools?.endRun({ status: 'failed', error: error instanceof Error ? error : new Error(String(error)) }); } catch { /* Keep original failure. */ }
        const nativeError = new AgentNativeExecutionError(this.options.driverId, errorMessage(error), error as Error);
        const result: AgentRunResult = {
          runId,
          sessionId: this.id,
          status: 'failed',
          outputText: '',
          artifacts: [],
          finishReason: 'native_error',
          error: { code: nativeError.code, message: nativeError.message, retryable: false },
          configuration: effectiveConfiguration,
        };
        try {
          if (!this.options.definitionMode || run.nativeTerminationConfirmed) hub.publish('run.finished', { status: 'failed', finishReason: 'native_error' });
          hub.complete();
        } catch {
          // Preserve the original failure.
        } finally {
          hub.complete();
          finish(result);
        }
      },
    );
    return run;
  }

  async cancelActiveRun(reason?: string): Promise<void> {
    await this.activeRun?.cancel(reason);
  }

  async destroy(): Promise<void> {
    if (this._isDestroyed) return;
    this._isDestroyed = true;
    this._state = 'destroying';
    await this.activeRun?.cancel('Session destroyed');
    await settleWithin(
      Promise.resolve().then(() => this.options.nativeSession.destroy()),
      DEFAULT_CLEANUP_TIMEOUT_MS,
    );
    await this.options.hostTools?.close();
    for (const hub of this.completedHubs) hub.expire();
    this.completedHubs.length = 0;
    this._state = 'destroyed';
    this.options.onDestroy();
  }

  private async executeRun(
    run: LocalAgentRun,
    input: AgentRunInput,
    options: Readonly<Omit<AgentRunOptions, 'signal'>>,
    hub: AsyncEventHub,
    controller: AbortController,
    timedOut: () => boolean,
    wallTimeMs?: number,
    observationSignal?: AbortSignal,
    adoptedRun?: DriverRun,
  ): Promise<AgentRunResult> {
    let driverResult: DriverRunResult;
    let activeDriverRun: DriverRun | undefined;
    let nativeCompletion: Promise<DriverRunResult> | undefined;
    let nativeStartup: Promise<DriverRun> | undefined;
    try {
      if (this.options.definitionMode) run.setNativeTerminationConfirmed(false);
      await this.options.hostTools?.beginRun(run.id, controller.signal, error => controller.abort(error), typeof input === 'string' ? input : input.parts.filter(part => part.type === 'text').map(part => part.text).join('\n'));
      nativeStartup = adoptedRun ? Promise.resolve(adoptedRun) : this.options.nativeSession.run({
        input,
        model: options.model,
        reasoning: options.reasoning,
        responseFormat: options.responseFormat,
        signal: controller.signal,
        metadata: mergeRunMetadata(input, options.metadata),
      });
      activeDriverRun = await raceWithAbort(nativeStartup, observationSignal ? AbortSignal.any([controller.signal, observationSignal]) : controller.signal);
      run.attachDriverRun(activeDriverRun);
      await this.options.onNativeAccepted?.(run.id);
      nativeCompletion = this.collectDriverRun(activeDriverRun, hub);
      driverResult = await raceWithAbort(nativeCompletion, observationSignal ? AbortSignal.any([controller.signal, observationSignal]) : controller.signal);
      run.setNativeTerminationConfirmed(true);
    } catch (error) {
      if (observationSignal?.aborted) {
        run.setNativeTerminationConfirmed(false);
      } else if (controller.signal.aborted) {
        const reason = controller.signal.reason;
        await run.cancelNative(
          reason instanceof Error ? reason.message : String(reason ?? 'Runtime abort signal'),
          this.options.nativeSession,
        );
        let terminationConfirmed = false;
        if (activeDriverRun) {
          terminationConfirmed = await confirmDriverRunTermination(activeDriverRun, nativeCompletion);
        } else if (nativeStartup) {
          const startup = await settleOutcomeWithin(nativeStartup, DEFAULT_CLEANUP_TIMEOUT_MS);
          if (startup.status === 'rejected') {
            terminationConfirmed = true;
          } else if (startup.status === 'fulfilled') {
            activeDriverRun = startup.value;
            run.attachDriverRun(activeDriverRun);
            await run.cancelNative(
              reason instanceof Error ? reason.message : String(reason ?? 'Runtime abort signal'),
              this.options.nativeSession,
            );
            nativeCompletion = this.collectDriverRun(activeDriverRun, hub);
            terminationConfirmed = await confirmDriverRunTermination(activeDriverRun, nativeCompletion);
          }
        }
        run.setNativeTerminationConfirmed(terminationConfirmed);
      } else if (this.options.definitionMode && this.options.nativeSession.observationIndependent) {
        run.setNativeTerminationConfirmed(false);
      } else if (activeDriverRun) {
        await run.cancelNative(errorMessage(error), this.options.nativeSession);
        run.setNativeTerminationConfirmed(await confirmDriverRunTermination(activeDriverRun, nativeCompletion));
      }
      const nativeError = timedOut()
        ? new AgentRunTimeoutError(wallTimeMs ?? 0)
        : new AgentNativeExecutionError(this.options.driverId, errorMessage(error), error as Error);
      driverResult = {
        status: controller.signal.aborted && !timedOut() ? 'cancelled' : 'failed',
        outputText: '',
        error: {
          code: nativeError.code,
          message: nativeError.message,
          retryable: false,
        },
        finishReason: timedOut() ? 'timeout' : controller.signal.aborted ? 'cancelled' : 'native_error',
      };
    }

    if (timedOut() && (!this.options.definitionMode || !run.nativeTerminationConfirmed)) {
      const timeoutError = new AgentRunTimeoutError(wallTimeMs ?? 0);
      driverResult = {
        ...driverResult,
        status: 'failed',
        error: { code: timeoutError.code, message: timeoutError.message, retryable: false },
        finishReason: 'timeout',
      };
    } else if ((controller.signal.aborted || run.wasCancelled) && (!this.options.definitionMode || !run.nativeTerminationConfirmed)) {
      driverResult = {
        ...driverResult,
        status: 'cancelled',
        error: undefined,
        finishReason: 'cancelled',
      };
    }

    const outputTruncated = isTextOverLimit(driverResult.outputText, this.options.policy.limits?.outputBytes);
    const artifactsTruncated = areArtifactsOverLimit(
      driverResult.artifacts ?? [],
      this.options.policy.limits?.artifactBytes,
    );
    const parsedTruncated = isJsonOverLimit(driverResult.outputParsed, this.options.policy.limits?.outputBytes);
    const result: AgentRunResult = {
      runId: run.id,
      sessionId: this.id,
      status: driverResult.status,
      outputText: boundText(driverResult.outputText, this.options.policy.limits?.outputBytes),
      outputParsed: parsedTruncated ? undefined : driverResult.outputParsed,
      artifacts: boundArtifacts(driverResult.artifacts ?? [], this.options.policy.limits?.artifactBytes),
      usage: driverResult.usage,
      finishReason: driverResult.finishReason,
      error: driverResult.error,
      configuration: driverResult.configuration ?? {
        ...this.capabilities.configuration,
        ...(options.model !== undefined ? { model: options.model } : {}),
        ...(options.reasoning !== undefined ? { reasoning: options.reasoning } : {}),
      },
      enforcement: driverResult.enforcement,
      native: driverResult.native === undefined
        ? undefined
        : {
            driver: this.options.driverId,
            sanitized: boundJsonValue(
              driverResult.native,
              this.options.policy.limits?.outputBytes ?? DEFAULT_EVENT_BUFFER_BYTES,
            ),
          },
    };
    if ((outputTruncated || artifactsTruncated || parsedTruncated) && result.status === 'completed') {
      result.status = 'incomplete';
      result.finishReason = 'runtime_limit';
    }
    return result;
  }

  private async collectDriverRun(driverRun: DriverRun, hub: AsyncEventHub): Promise<DriverRunResult> {
    for await (const event of driverRun.events) {
      if (shouldPublishEvent(event.type, this.options.observation)) {
        hub.publish(event.type, event.data, event.timestamp);
      }
    }
    return driverRun.result;
  }

  private assertRunCapability(id: string): void {
    const capability = this.capabilities.capabilities[id];
    if (!capability || !['native', 'emulated'].includes(capability.support)) {
      throw new AgentCapabilityUnsupportedError(id, capability?.reason);
    }
  }

  private retainHub(hub: AsyncEventHub): void {
    this.completedHubs.push(hub);
    let retained = this.completedHubs.reduce((sum, item) => sum + item.retainedBytes, 0);
    while (retained > this.options.maxSessionJournalBytes && this.completedHubs.length > 0) {
      const expired = this.completedHubs.shift();
      if (!expired) break;
      retained -= expired.retainedBytes;
      expired.expire();
    }
  }
}

class LocalAgentRun implements AgentRun {
  private cancellationRequested = false;
  private driverRun?: DriverRun;
  private _nativeTerminationConfirmed = true;

  constructor(
    readonly id: string,
    readonly sessionId: string,
    private readonly hub: AsyncEventHub,
    readonly result: Promise<AgentRunResult>,
    private readonly controller: AbortController,
    private readonly capabilities: ResolvedAgentCapabilities,
  ) {}

  get wasCancelled(): boolean {
    return this.cancellationRequested;
  }

  get nativeTerminationConfirmed(): boolean {
    return this._nativeTerminationConfirmed;
  }

  events(options?: AgentEventSubscriptionOptions) {
    return this.hub.subscribe(options);
  }

  async cancel(reason?: string): Promise<void> {
    if (!this.cancellationRequested) {
      this.cancellationRequested = true;
      this.controller.abort(reason);
    }
    await this.result;
  }

  async steer(input: AgentRunInput): Promise<void> {
    this.assertControlCapability('run.steer');
    if (!this.driverRun?.steer) throw new AgentBusyError('The native run is not ready to accept steering');
    await this.driverRun.steer(input);
  }

  async respondToInteraction(interactionId: string, response: AgentInteractionResponse): Promise<void> {
    this.assertControlCapability('run.interaction');
    if (!this.driverRun?.respondToInteraction) {
      throw new AgentBusyError('The native run is not ready to accept an interaction response');
    }
    await this.driverRun.respondToInteraction(interactionId, response);
  }

  attachDriverRun(driverRun: DriverRun): void {
    this.driverRun = driverRun;
  }

  setNativeTerminationConfirmed(confirmed: boolean): void {
    this._nativeTerminationConfirmed = confirmed;
  }

  async cancelNative(reason: string, nativeSession: DriverSession): Promise<void> {
    const driverRun = this.driverRun;
    if (driverRun) {
      await settleWithin(
        Promise.resolve().then(() => driverRun.cancel(reason)),
        DEFAULT_CLEANUP_TIMEOUT_MS,
      );
      return;
    }
    await settleWithin(
      Promise.resolve().then(() => nativeSession.cancelActiveRun(reason)),
      DEFAULT_CLEANUP_TIMEOUT_MS,
    );
  }

  private assertControlCapability(id: string): void {
    const capability = this.capabilities.capabilities[id];
    if (!capability || !['native', 'emulated'].includes(capability.support)) {
      throw new AgentCapabilityUnsupportedError(id, capability?.reason);
    }
  }
}

function boundText(text: string, maxBytes?: number): string {
  if (!maxBytes || Buffer.byteLength(text, 'utf8') <= maxBytes) return text;
  const suffix = '\n[output truncated by Agent Runtime]';
  const suffixBytes = Buffer.byteLength(suffix, 'utf8');
  if (maxBytes <= suffixBytes) return truncateUtf8(text, maxBytes);
  return `${truncateUtf8(text, maxBytes - suffixBytes)}${suffix}`;
}

function isTextOverLimit(text: string, maxBytes?: number): boolean {
  return maxBytes !== undefined && maxBytes > 0 && Buffer.byteLength(text, 'utf8') > maxBytes;
}

function areArtifactsOverLimit<T>(artifacts: T[], maxBytes?: number): boolean {
  if (!maxBytes) return false;
  let bytes = 0;
  for (const artifact of artifacts) {
    bytes += Buffer.byteLength(JSON.stringify(artifact), 'utf8');
    if (bytes > maxBytes) return true;
  }
  return false;
}

function isJsonOverLimit(value: JsonValue | undefined, maxBytes?: number): boolean {
  return value !== undefined
    && maxBytes !== undefined
    && maxBytes > 0
    && Buffer.byteLength(JSON.stringify(value), 'utf8') > maxBytes;
}

function boundJsonValue(value: JsonValue, maxBytes: number): JsonValue {
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, 'utf8') <= maxBytes) return value;
  const marker = { truncated: true };
  if (Buffer.byteLength(JSON.stringify(marker), 'utf8') <= maxBytes) return marker;
  return maxBytes >= 4 ? null : 0;
}

function truncateUtf8(text: string, maxBytes: number): string {
  if (maxBytes <= 0) return '';
  let truncated = Buffer.from(text, 'utf8').subarray(0, maxBytes).toString('utf8');
  if (truncated.endsWith('\uFFFD')) truncated = truncated.slice(0, -1);
  return truncated;
}

function boundArtifacts<T>(artifacts: T[], maxBytes?: number): T[] {
  if (!maxBytes) return artifacts;
  const result: T[] = [];
  let bytes = 0;
  for (const artifact of artifacts) {
    const size = Buffer.byteLength(JSON.stringify(artifact), 'utf8');
    if (bytes + size > maxBytes) break;
    result.push(artifact);
    bytes += size;
  }
  return result;
}

function validatePolicyLimits(policy: AgentExecutionPolicy): void {
  if (policy.limits !== undefined && (
    !policy.limits || typeof policy.limits !== 'object' || Array.isArray(policy.limits)
  )) {
    throw new AgentDriverConfigurationError('Agent execution policy limits must be an object');
  }
  for (const [name, value] of Object.entries(policy.limits ?? {})) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new AgentDriverConfigurationError(`Agent execution policy limit '${name}' must be a positive safe integer`);
    }
    if (name === 'eventBufferBytes' && value < 1024) {
      throw new AgentDriverConfigurationError("Agent execution policy limit 'eventBufferBytes' must be at least 1024");
    }
  }
}

function validatePolicy(policy: AgentExecutionPolicy): void {
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) {
    throw new AgentDriverConfigurationError('Agent execution policy must be an object');
  }
  validateChoice(policy.filesystem, ['denied', 'read-only', 'workspace-write'], 'policy.filesystem');
  validateChoice(policy.commands, ['denied', 'sandboxed'], 'policy.commands');
  validateChoice(policy.sandboxNetwork, ['denied', 'allowed'], 'policy.sandboxNetwork');
  validateChoice(policy.providerWebSearch, ['denied', 'allowed'], 'policy.providerWebSearch');
  validateChoice(policy.approvals, ['deny', 'interactive'], 'policy.approvals');
  validatePolicyLimits(policy);
}

function validateSessionOptions(options: OpenAgentSessionOptions): void {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new AgentDriverConfigurationError('Agent session options must be an object');
  }
  if (!options.context || typeof options.context !== 'object' || Array.isArray(options.context)) {
    throw new AgentDriverConfigurationError('Agent session context must be an object');
  }
  validatePolicy(options.policy);
  if (options.controlMode !== undefined) {
    validateChoice(options.controlMode, ['observe-only', 'steerable'], 'controlMode');
  }
  if (options.observation !== undefined) {
    if (!options.observation || typeof options.observation !== 'object' || Array.isArray(options.observation)) {
      throw new AgentDriverConfigurationError('Agent observation options must be an object');
    }
    if (options.observation.mode !== undefined) {
      validateChoice(options.observation.mode, ['live', 'final-only'], 'observation.mode');
    }
    if (options.observation.detail !== undefined) {
      validateChoice(options.observation.detail, ['status', 'activity', 'reasoning'], 'observation.detail');
    }
  }
}

function validateChoice(value: unknown, choices: readonly string[], label: string): void {
  if (typeof value !== 'string' || !choices.includes(value)) {
    throw new AgentDriverConfigurationError(`Agent ${label} must be one of: ${choices.join(', ')}`);
  }
}

function validateReasoning(reasoning: NonNullable<AgentRunOptions['reasoning']>): void {
  if (!reasoning || typeof reasoning !== 'object' || Array.isArray(reasoning)) {
    throw new AgentDriverConfigurationError('Reasoning override must be an object');
  }
  if (reasoning.enabled !== undefined && typeof reasoning.enabled !== 'boolean') {
    throw new AgentDriverConfigurationError('Reasoning enabled must be a boolean');
  }
  if (reasoning.budgetTokens !== undefined && (
    !Number.isSafeInteger(reasoning.budgetTokens) || reasoning.budgetTokens <= 0
  )) {
    throw new AgentDriverConfigurationError('Reasoning budgetTokens must be a positive safe integer');
  }
  const efforts = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
  if (reasoning.effort !== undefined && !efforts.has(reasoning.effort)) {
    throw new AgentDriverConfigurationError(`Invalid reasoning effort '${reasoning.effort}'`);
  }
}

function validateResponseFormat(format: NonNullable<AgentRunOptions['responseFormat']>): void {
  if (!format || typeof format !== 'object' || Array.isArray(format)) {
    throw new AgentDriverConfigurationError('Response format must be an object');
  }
  if (format.type === 'text') return;
  if (format.type !== 'json_schema') {
    throw new AgentDriverConfigurationError("Response format type must be 'text' or 'json_schema'");
  }
  if (!format.schema || typeof format.schema !== 'object' || Array.isArray(format.schema)) {
    throw new AgentDriverConfigurationError('JSON Schema response format requires an object schema');
  }
  if (format.name !== undefined && (typeof format.name !== 'string' || !format.name.trim())) {
    throw new AgentDriverConfigurationError('JSON Schema response format name must be a non-empty string');
  }
  if (format.strict !== undefined && typeof format.strict !== 'boolean') {
    throw new AgentDriverConfigurationError('JSON Schema response format strict must be a boolean');
  }
}

function hasWorkspaceFileInput(input: AgentRunInput): boolean {
  return typeof input !== 'string' && input.parts.some((part) => part.type === 'workspace-file');
}

function normalizeObservation(observation?: AgentObservationOptions): Required<AgentObservationOptions> {
  return {
    mode: observation?.mode ?? 'live',
    detail: observation?.detail ?? 'reasoning',
  };
}

function shouldPublishEvent(
  type: DriverEvent['type'],
  observation: Required<AgentObservationOptions>,
): boolean {
  const essential = type === 'agent.message.completed'
    || type === 'usage.updated'
    || type === 'diagnostic'
    || type === 'interaction.requested'
    || type === 'interaction.resolved';
  if (observation.mode === 'final-only') return essential;
  if (observation.detail === 'status') return essential;
  if (observation.detail === 'activity' && (type === 'reasoning.delta' || type === 'reasoning.completed')) {
    return false;
  }
  return true;
}

async function settleWithin(promise: Promise<unknown> | void, timeoutMs: number): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    Promise.resolve(promise).then(() => undefined, () => undefined),
    new Promise<void>((resolve) => {
      timeout = setTimeout(resolve, timeoutMs);
    }),
  ]);
  if (timeout) clearTimeout(timeout);
}

type Settlement<T> =
  | { status: 'fulfilled'; value: T }
  | { status: 'rejected' }
  | { status: 'timed-out' };

async function settleOutcomeWithin<T>(promise: Promise<T>, timeoutMs: number): Promise<Settlement<T>> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const outcome = await Promise.race<Settlement<T>>([
    promise.then<Settlement<T>, Settlement<T>>(
      (value) => ({ status: 'fulfilled', value }),
      () => ({ status: 'rejected' }),
    ),
    new Promise<Settlement<T>>((resolve) => {
      timeout = setTimeout(() => resolve({ status: 'timed-out' }), timeoutMs);
    }),
  ]);
  if (timeout) clearTimeout(timeout);
  return outcome;
}

async function confirmDriverRunTermination(
  driverRun: DriverRun,
  nativeCompletion?: Promise<DriverRunResult>,
): Promise<boolean> {
  const terminal = nativeCompletion
    ? Promise.allSettled([driverRun.result, nativeCompletion]).then(() => undefined)
    : driverRun.result.then(() => undefined, () => undefined);
  return (await settleOutcomeWithin(terminal, DEFAULT_CLEANUP_TIMEOUT_MS)).status !== 'timed-out';
}

function mergeRunMetadata(input: AgentRunInput, metadata: AgentRunOptions['metadata']): AgentRunOptions['metadata'] {
  const inputMetadata = typeof input === 'string' ? undefined : input.metadata;
  if (!inputMetadata) return metadata;
  if (!metadata) return inputMetadata;
  return { ...inputMetadata, ...metadata };
}

const staticConnectorRegistry: IConnectorRegistry = {
  get: (name) => Connector.get(name),
  has: (name) => Connector.has(name),
  list: () => Connector.list(),
  listAll: () => Connector.listAll(),
  size: () => Connector.size(),
  getDescriptionsForTools: () => Connector.getDescriptionsForTools(),
  getInfo: () => Connector.getInfo(),
  getById: (id) => Connector.getById(id),
  warmup: () => Connector.warmup(),
};

function scopeKey(context: import('./types.js').TrustedRuntimeContext): string {
  return JSON.stringify([context.tenantId ?? null, context.userId ?? null, context.groupId ?? null]);
}
