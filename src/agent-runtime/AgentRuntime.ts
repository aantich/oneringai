import type { AgentExecutionBackend } from './AgentExecutionBackend.js';
import { AgentDriverConfigurationError, AgentSessionRecoveryError } from './errors.js';
import { definitionDigest } from './RuntimeHostTools.js';
import { cloneAndFreezeJson, cloneAndFreezeSpec } from './internal.js';
import type {
  AgentInspectionRequest,
  AgentSession,
  OpenAgentSessionOptions,
  ResolvedAgentCapabilities,
  RuntimeAgent,
  RuntimeAgentSpec,
  RuntimeAgentDefinition, RuntimeDefinitionAgent, RuntimeInspection, RuntimeSession, RuntimeSessionOptions, RuntimeSessionReference, RuntimeResumeOptions,
} from './types.js';

export interface AgentRuntimeOptions {
  backend: AgentExecutionBackend;
  backendOwnership?: 'owned' | 'borrowed';
}

export class AgentRuntime {
  private readonly backend: AgentExecutionBackend;
  private readonly ownsBackend: boolean;
  private readonly sessions = new Set<AgentSession>();
  private readonly definitionSessions = new Map<string, { source: RuntimeSession; tracked: RuntimeSession }>();
  private _isDestroyed = false;

  constructor(options: AgentRuntimeOptions) {
    this.backend = options.backend;
    this.ownsBackend = (options.backendOwnership ?? 'owned') === 'owned';
  }

  get isDestroyed(): boolean {
    return this._isDestroyed;
  }

  agent(spec: RuntimeAgentSpec): RuntimeAgent {
    this.assertActive();
    return new RuntimeAgentHandle(cloneAndFreezeSpec(spec), this.backend, () => this.assertActive(), (session) => {
      let tracked!: TrackedAgentSession;
      tracked = new TrackedAgentSession(session, () => this.sessions.delete(tracked));
      this.sessions.add(tracked);
      return tracked;
    });
  }

  createAgent(definition: RuntimeAgentDefinition): RuntimeDefinitionAgent {
    this.assertActive();
    if (!definition || typeof definition.id !== 'string' || !definition.id.trim() || typeof definition.instructions !== 'string') {
      throw new AgentDriverConfigurationError('Definition requires id and instructions');
    }
    if (Object.keys(definition).some(key => !['id','revision','name','instructions','tools','requiredCapabilities','metadata'].includes(key))) throw new AgentDriverConfigurationError('Definition contains an execution-owned or unknown field');
    if (definition.revision !== undefined && (typeof definition.revision !== 'string' || !definition.revision.trim())) throw new AgentDriverConfigurationError('Definition revision must be a non-empty string');
    if (definition.tools && (!Array.isArray(definition.tools) || definition.tools.some(t => typeof t !== 'string' || !t.trim()) || new Set(definition.tools).size !== definition.tools.length)) {
      throw new AgentDriverConfigurationError('Definition tools must be unique exact names');
    }
    const frozen = cloneAndFreezeJson(definition, 'Agent definition');
    const bind = (options: RuntimeSessionOptions) => {
      if (Object.keys(options.execution ?? {}).some(key => !['driver','connector','model','reasoning','driverConfig'].includes(key))) throw new AgentDriverConfigurationError('Execution binding contains a definition-owned or unknown field');
      if (typeof options.execution?.connector !== 'string' || !options.execution.connector.trim() || typeof options.execution.model !== 'string' || !options.execution.model.trim()) throw new AgentDriverConfigurationError('Execution requires a named connector and model');
      if (options.workspace && options.environment) throw new AgentDriverConfigurationError('Select workspace or environment, not both');
      const workspace = options.environment?.type === 'local-directory' ? options.environment : options.workspace;
      const spec = cloneAndFreezeSpec(cloneAndFreezeJson({ id: frozen.id, name: frozen.name, definition: frozen, ...options.execution,
        environment: options.environment,
        requiredCapabilities: [...(frozen.requiredCapabilities ?? []), { id: 'agent.definition' }, ...(frozen.tools?.length ? [{ id: 'tools.host' }] : [])],
      }, 'Execution binding'));
      return { spec, options: { ...options, workspace } };
    };
    return {
      definition: frozen,
      inspect: async (options): Promise<RuntimeInspection> => {
        this.assertActive();
        const bound = bind(options);
        const capabilities = await this.backend.inspect(bound.spec, bound.options);
        return { ...capabilities, definitionDigest: definitionDigest(frozen), recovery: capabilities.capabilities['runtime.control']?.constraints?.durability === 'durable' ? 'durable' : 'process' };
      },
      openSession: async options => {
        this.assertActive();
        const bound = bind(options);
        const session = await this.backend.openSession(bound.spec, bound.options);
        if (!('reference' in session)) { await session.destroy(); throw new AgentDriverConfigurationError('Backend does not implement definition sessions'); }
        if (this._isDestroyed) { await session.destroy(); this.assertActive(); }
        return this.trackDefinition(session as RuntimeSession);
      },
    };
  }

  async resumeSession(reference: RuntimeSessionReference, options: RuntimeResumeOptions): Promise<RuntimeSession> {
    this.assertActive();
    if (!this.backend.resumeSession) throw new AgentDriverConfigurationError('Backend does not support recovery');
    const session = await this.backend.resumeSession(reference, options);
    if (this._isDestroyed) {
      // Recovery acquires observation, not authority to cancel independent work.
      // In particular, do not use destroy() as rollback of a late managed resume.
      if (!session.isDestroyed) {
        try { await session.detach(); }
        catch { throw new AgentSessionRecoveryError('AgentRuntime was destroyed during recovery; late observer detach failed, recover the original reference', reference); }
      }
      this.assertActive();
    }
    return this.trackDefinition(session);
  }

  async deleteSession(reference: RuntimeSessionReference, options: RuntimeResumeOptions): Promise<void> {
    this.assertActive();
    if (!this.backend.deleteSession) throw new AgentDriverConfigurationError('Backend does not support deletion');
    await this.backend.deleteSession(reference, options);
  }

  private trackDefinition(session: RuntimeSession): RuntimeSession {
    const prior = this.definitionSessions.get(session.id);
    if (prior?.source === session) return prior.tracked;
    if (prior) this.sessions.delete(prior.tracked);
    let tracked!: TrackedRuntimeSession;
    tracked = new TrackedRuntimeSession(session, () => {
      this.sessions.delete(tracked);
      if (this.definitionSessions.get(session.id)?.tracked === tracked) this.definitionSessions.delete(session.id);
    });
    this.definitionSessions.set(session.id, { source: session, tracked });
    this.sessions.add(tracked);
    return tracked;
  }

  async destroy(): Promise<void> {
    if (this._isDestroyed) return;
    this._isDestroyed = true;
    await Promise.allSettled([...this.sessions].map((session) => session.destroy()));
    this.sessions.clear();
    this.definitionSessions.clear();
    if (this.ownsBackend) await this.backend.destroy();
  }

  private assertActive(): void {
    if (this._isDestroyed) throw new Error('AgentRuntime has been destroyed');
  }
}

class RuntimeAgentHandle implements RuntimeAgent {
  constructor(
    readonly spec: Readonly<RuntimeAgentSpec>,
    private readonly backend: AgentExecutionBackend,
    private readonly assertActive: () => void,
    private readonly onSession: (session: AgentSession) => AgentSession,
  ) {}

  async inspect(request?: AgentInspectionRequest): Promise<ResolvedAgentCapabilities> {
    this.assertActive();
    const capabilities = await this.backend.inspect(this.spec, request);
    this.assertActive();
    return capabilities;
  }

  async openSession(options: OpenAgentSessionOptions): Promise<AgentSession> {
    this.assertActive();
    const session = await this.backend.openSession(this.spec, options);
    try {
      this.assertActive();
    } catch (error) {
      await session.destroy();
      throw error;
    }
    return this.onSession(session);
  }
}

class TrackedAgentSession implements AgentSession {
  private _isDestroyed = false;

  constructor(
    private readonly session: AgentSession,
    private readonly onDestroy: () => void,
  ) {}

  get id() { return this.session.id; }
  get agentId() { return this.session.agentId; }
  get capabilities() { return this.session.capabilities; }
  get state() { return this.session.state; }
  get isDestroyed() { return this._isDestroyed || this.session.isDestroyed; }

  run(...args: Parameters<AgentSession['run']>) {
    return this.session.run(...args);
  }

  cancelActiveRun(reason?: string): Promise<void> {
    return this.session.cancelActiveRun(reason);
  }

  async destroy(): Promise<void> {
    if (this._isDestroyed) return;
    this._isDestroyed = true;
    try {
      await this.session.destroy();
    } finally {
      this.onDestroy();
    }
  }
}

class TrackedRuntimeSession extends TrackedAgentSession implements RuntimeSession {
  constructor(private readonly runtimeSession: RuntimeSession, onDestroy: () => void) { super(runtimeSession, onDestroy); }
  override run(input: import('./types.js').AgentRunInput, options?: import('./types.js').RuntimeRunOptions) { return this.runtimeSession.run(input, options); }
  reference() { return this.runtimeSession.reference(); }
  inspectState() { return this.runtimeSession.inspectState(); }
  getRun(runId: string) { return this.runtimeSession.getRun(runId); }
  detach() { return this.runtimeSession.detach(); }
  uploadFile(request: import('./types.js').RuntimeFileUpload) { return this.runtimeSession.uploadFile(request); }
  downloadArtifact(request: import('./types.js').RuntimeArtifactDownload) { return this.runtimeSession.downloadArtifact(request); }
}
