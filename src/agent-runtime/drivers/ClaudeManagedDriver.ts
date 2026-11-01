import { managedFetch } from '../ManagedTransport.js';
import type Anthropic from '@anthropic-ai/sdk';
import type { ClientOptions } from '@anthropic-ai/sdk';
import type { BetaManagedAgentsSession, BetaManagedAgentsSessionUsage } from '@anthropic-ai/sdk/resources/beta/sessions/sessions';
import type { BetaManagedAgentsSessionEvent, BetaManagedAgentsStreamSessionEvents, BetaManagedAgentsAgentCustomToolUseEvent, BetaManagedAgentsSessionStatusIdleEvent } from '@anthropic-ai/sdk/resources/beta/sessions/events';
import type { AgentCreateParams, BetaManagedAgentsAgent, BetaManagedAgentsAgentToolConfigParams } from '@anthropic-ai/sdk/resources/beta/agents/agents';
import type { BetaEnvironment } from '@anthropic-ai/sdk/resources/beta/environments/environments';
import { randomUUID } from 'node:crypto';
import { portableFilename, checkFileMetadata, artifactResponse } from '../RuntimeFileTransfers.js';
import { Vendor } from '../../core/Vendor.js';
import { getModelInfo } from '../../domain/entities/Model.js';
import type { AgentDriver, DriverOpenSessionRequest, DriverSession, DriverRunRequest, DriverRun, DriverRunResult, DriverEvent } from '../AgentDriver.js';
import { AgentDriverConfigurationError, AgentPolicyUnsupportedError } from '../errors.js';
import { controlJson, runtimeScope } from '../RuntimeSessionStorage.js';
import { definitionDigest } from '../RuntimeHostTools.js';
import { bufferManagedEvents } from '../ManagedEventBuffer.js';
import { createDeferred, runtimeTokenProvider, errorMessage, toJsonObject } from '../internal.js';
import type { AgentArtifact, JsonObject, RuntimeSessionSnapshot, RuntimeReasoningConfig } from '../types.js';

type NativeTool = 'bash' | 'read' | 'write' | 'edit' | 'glob' | 'grep' | 'web_search' | 'web_fetch';
type NativeStream = AsyncIterable<BetaManagedAgentsStreamSessionEvents> & { controller: AbortController };
export interface ClaudeManagedDriverOptions {
  createClient?: (options: ClientOptions) => Anthropic;
  nativeTools?: readonly NativeTool[];
  environmentIds?: readonly string[];
  workspaceId?: string;
  modelEfforts?: Readonly<Record<string, readonly string[]>>;
  maxReconnects?: number;
}
const defaultEfforts: Readonly<Record<string, readonly string[]>> = { 'claude-sonnet-4-6': ['low','medium','high'], 'claude-opus-4-6': ['low','medium','high','max'], 'claude-opus-5-5': ['low','medium','high','xhigh','max'], 'claude-sonnet-5-5': ['low','medium','high','xhigh','max'] };

export class ClaudeManagedDriver implements AgentDriver {
  readonly id = 'anthropic.managed.api';
  constructor(private readonly options: ClaudeManagedDriverOptions = {}) {
    if (options.maxReconnects !== undefined && (!Number.isSafeInteger(options.maxReconnects) || options.maxReconnects < 0 || options.maxReconnects > 10)) throw new AgentDriverConfigurationError('maxReconnects must be between 0 and 10');
    if (options.nativeTools && (new Set(options.nativeTools).size !== options.nativeTools.length || options.nativeTools.some(name => !['bash','read','write','edit','glob','grep','web_search','web_fetch'].includes(name)))) throw new AgentDriverConfigurationError('Invalid or duplicate Claude native tools');
  }
  async inspect(request: Parameters<AgentDriver['inspect']>[0]) {
    const { spec, policy } = request;
    if (!spec.definition || !spec.connector || !spec.model) throw new AgentDriverConfigurationError('Claude managed execution requires a logical definition, connector and model');
    this.connector(request);
    this.validateModel(spec.model, spec.reasoning);
    if (request.durability !== 'durable') throw new AgentDriverConfigurationError('Managed execution requires durable runtime control storage');
    if (request.workspace || spec.environment?.type !== 'provider-managed') throw new AgentPolicyUnsupportedError('Claude Managed Agents requires a provider-managed environment');
    if (spec.environment.reference && !this.options.environmentIds?.includes(spec.environment.reference)) throw new AgentPolicyUnsupportedError('Borrowed Claude environment must be explicitly reviewed/allowed by the host');
    const config = spec.driverConfig ?? {};
    if (Object.keys(config).some(key => key !== 'maxListCostUsdCents')) throw new AgentDriverConfigurationError('Unknown Claude managed driverConfig field');
    if (config.maxListCostUsdCents !== undefined && (typeof config.maxListCostUsdCents !== 'string' || !/^(0|[1-9][0-9]{0,11})$/.test(config.maxListCostUsdCents))) throw new AgentDriverConfigurationError('maxListCostUsdCents must be an integer decimal string in USD minor units');
    const native = this.options.nativeTools ?? [];
    if ((spec.definition.tools?.length ?? 0) + native.length > 128) throw new AgentDriverConfigurationError('Claude managed tool capacity exceeds the native 128-tool limit');
    if (policy) {
      if (policy.approvals !== 'deny') throw new AgentPolicyUnsupportedError('Interactive native approvals are not enabled');
      if (native.includes('bash') && (policy.commands !== 'sandboxed' || policy.filesystem !== 'workspace-write')) throw new AgentPolicyUnsupportedError('Native bash requires sandboxed commands and workspace-write');
      if (native.some(name => ['write','edit'].includes(name)) && policy.filesystem !== 'workspace-write') throw new AgentPolicyUnsupportedError('Native write/edit requires workspace-write');
      if (native.some(name => ['read','glob','grep'].includes(name)) && policy.filesystem === 'denied') throw new AgentPolicyUnsupportedError('Native reads require filesystem access');
      if (native.some(name => ['web_search','web_fetch'].includes(name)) && policy.providerWebSearch !== 'allowed') throw new AgentPolicyUnsupportedError('Native web tools require explicit provider-web policy');
    }
    const ids = ['agent.definition','tools.host','environment.provider-managed','session.continue','session.restore','run.cancel','event.live','event.message','event.tool','files.upload','files.download'];
    return { inspection: { toolNamePrefix: '', enforcement: { nativeFilesystem: 'native' as const, nativeCommands: 'native' as const, sandboxNetwork: 'native' as const, providerWebSearch: 'native' as const }, notes: ['Account entitlement is checked only by native requests.'] }, capabilities: { driverId: this.id, configuration: { model: spec.model, ...(spec.reasoning ? { reasoning: spec.reasoning } : {}) }, capabilities: { ...Object.fromEntries(ids.map(id => [id, { id, support: 'native' as const, ...(id === 'agent.definition' ? { constraints: { profile: 'managed-agents-2026-04-01', nativeTools: [...native], workspaceId: this.options.workspaceId ?? null, delegation: false, memory: false, workflow: false } } : {}) }])), 'event.reasoning': { id: 'event.reasoning', support: 'unsupported' as const, reason: 'Native thinking events are activity signals without reasoning text' } } } };
  }
  async openSession(request: DriverOpenSessionRequest): Promise<DriverSession> {
    await this.inspect(request);
    const session = new ClaudeManagedSession(request, await this.client(request), this.options);
    await session.initialize(); return session;
  }
  async restoreSession(request: DriverOpenSessionRequest & { checkpoint: JsonObject }): Promise<{ session: DriverSession; activeRun?: DriverRun }> {
    await this.inspect(request);
    if (request.checkpoint.kind !== 'claude-managed-v1') throw new AgentDriverConfigurationError('Invalid Claude managed checkpoint');
    const session = new ClaudeManagedSession(request, await this.client(request), this.options, request.checkpoint);
    await session.reconcileResources(); if (!session.nativeSessionId) throw new AgentDriverConfigurationError('Native setup never became ready; preserve the reference for owned cleanup'); await session.reconcileUploads(); await session.verifySession();
    return { session, ...(request.control?.data.activeRunId ? { activeRun: session.observeExisting() } : {}) };
  }
  async deleteSession(request: DriverOpenSessionRequest & { checkpoint: JsonObject }): Promise<void> {
    const session = new ClaudeManagedSession(request, await this.client(request), this.options, request.checkpoint); await session.deleteOwned();
  }
  private connector(request: Pick<DriverOpenSessionRequest, 'spec' | 'connectorRegistry'>) {
    const connector = request.connectorRegistry.get(request.spec.connector!);
    if (connector.vendor !== Vendor.Anthropic || !['api_key','api_key_provider'].includes(connector.config.auth.type)) throw new AgentDriverConfigurationError('Claude managed execution requires an Anthropic API-key connector');
    return connector;
  }
  private validateModel(model: string, reasoning?: RuntimeReasoningConfig): void {
    const info = getModelInfo(model); const efforts = this.options.modelEfforts?.[model] ?? defaultEfforts[model];
    if (!info?.isActive || info.provider !== Vendor.Anthropic || !efforts) throw new AgentDriverConfigurationError('Model has no verified Claude managed endpoint profile');
    if (reasoning?.budgetTokens !== undefined || reasoning?.enabled === false || (reasoning?.effort && (!efforts.includes(reasoning.effort) || !['low','medium','high','xhigh','max'].includes(reasoning.effort)))) throw new AgentDriverConfigurationError('Unsupported Claude managed reasoning control');
  }
  private async client(request: DriverOpenSessionRequest): Promise<Anthropic> {
    const connector = this.connector(request);
    const token = runtimeTokenProvider(request.connectorRegistry, request.spec.connector!);
    const options: ClientOptions = { apiKey: await token(), authToken: null, logLevel: 'off', middleware: [async (request, next) => {
      // SDK 0.131 declarations accept an async apiKey, but its runtime drops it.
      // Keep explicit connector auth, refresh through supported SDK middleware, and prevent ambient auth/workspace headers.
      const headers = new Headers(request.headers as InstanceType<typeof Headers>);
      for (const key of [...headers.keys()]) if (!['accept','content-type','content-length','user-agent','anthropic-version','anthropic-beta','anthropic-workspace-id','x-api-key'].includes(key.toLowerCase()) && !key.toLowerCase().startsWith('x-stainless-')) headers.delete(key);
      headers.set('anthropic-beta', /(?:^|\/)v1\/files(?:\/|$)/.test(new URL(request.url).pathname) ? 'files-api-2025-04-14' : 'managed-agents-2026-04-01');
      headers.set('anthropic-version', connector.config.options?.anthropicVersion ?? '2023-06-01');
      headers.set('x-api-key', await token()); headers.delete('authorization');
      if (this.options.workspaceId) headers.set('anthropic-workspace-id', this.options.workspaceId); else headers.delete('anthropic-workspace-id');
      request.headers = headers; return next(request);
    }], baseURL: connector.baseURL || 'https://api.anthropic.com', maxRetries: 0, timeout: 10000, fetch: managedFetch(fetch, connector.baseURL || 'https://api.anthropic.com') };
    if (this.options.createClient) return this.options.createClient(options);
    const { default: Client } = await import('@anthropic-ai/sdk'); return new Client(options);
  }
}

class ClaudeManagedSession implements DriverSession {
  private destroyed = false; private detached = false;
  private agentId?: string; private agentVersion?: number; private environmentId?: string; private nativeId?: string;
  private environmentOwned = false; private phase = 'new'; private inputState = 'not_sent';
  private baselineId?: string; private inputId?: string; private inputText?: string; private cancelId?: string; private cancelIntent = false; private cancelBoundaryId?: string;
  private usageBefore?: BetaManagedAgentsSessionUsage; private waitReason?: string;
  private uploads: { name: string; size: number; mediaType: string; fileId?: string; resourceId?: string; mountPath: string }[] = [];
  private stream?: NativeStream;
  private active?: { resolve: (value: DriverRunResult) => void };
  private readonly observed = new Set<string>();
  constructor(private readonly request: DriverOpenSessionRequest, private readonly client: Anthropic, private readonly options: ClaudeManagedDriverOptions, checkpoint?: JsonObject) {
    if (checkpoint) {
      this.agentId = checkpoint.agentId as string | undefined; this.agentVersion = checkpoint.agentVersion as number | undefined;
      this.environmentId = checkpoint.environmentId as string | undefined; this.nativeId = checkpoint.nativeId as string | undefined;
      this.environmentOwned = checkpoint.environmentOwned === true; this.phase = String(checkpoint.phase ?? 'new');
      this.inputState = String(checkpoint.inputState ?? 'not_sent'); this.baselineId = checkpoint.baselineId as string | undefined;
      this.inputId = checkpoint.inputId as string | undefined; this.inputText = checkpoint.inputText as string | undefined; this.cancelId = checkpoint.cancelId as string | undefined; this.cancelIntent = checkpoint.cancelIntent === true; this.cancelBoundaryId = checkpoint.cancelBoundaryId as string | undefined;
      this.uploads = structuredClone((checkpoint.uploads as unknown as typeof this.uploads | undefined) ?? []);
      this.usageBefore = checkpoint.usageBefore as BetaManagedAgentsSessionUsage | undefined;
    }
  }
  readonly observationIndependent = true;
  get isDestroyed() { return this.destroyed; }
  get nativeSessionId() { return this.nativeId; }
  private params() { return this.options.workspaceId ? { workspace_id: this.options.workspaceId } : {}; }
  private metadata() { return { onering_session: this.request.sessionId!, onering_scope: runtimeScope(this.request.context), onering_definition: definitionDigest(this.request.spec.definition!) }; }
  private owner(metadata: Record<string,string>): void { if (Object.entries(this.metadata()).some(([key, value]) => metadata[key] !== value)) throw new AgentDriverConfigurationError('Foreign or changed native resource ownership'); }
  async checkpoint(): Promise<JsonObject> { return controlJson({ kind: 'claude-managed-v1', agentId: this.agentId, agentVersion: this.agentVersion, environmentId: this.environmentId, environmentOwned: this.environmentOwned, nativeId: this.nativeId, phase: this.phase, inputState: this.inputState, baselineId: this.baselineId, inputId: this.inputId, inputText: this.inputText, cancelId: this.cancelId, cancelIntent: this.cancelIntent, cancelBoundaryId: this.cancelBoundaryId, usageBefore: this.usageBefore, uploads: this.uploads }); }
  private async save(): Promise<void> { const checkpoint = await this.checkpoint(); await this.request.control?.update(data => { data.checkpoint = checkpoint; }); }
  async initialize(): Promise<void> {
    this.phase = 'agent_intent'; await this.save();
    const native = this.options.nativeTools ?? [];
    const tools: NonNullable<AgentCreateParams['tools']> = (this.request.hostTools?.definitions ?? []).map(tool => ({ type: 'custom', name: tool.name, description: tool.description, input_schema: tool.parameters as { type: 'object' } }));
    // The native toolset otherwise defaults to all enabled. Always make denial explicit.
    tools.unshift({ type: 'agent_toolset_20260401', default_config: { enabled: false, permission_policy: { type: 'always_allow' } }, configs: native.map(name => ({ name, enabled: true, permission_policy: { type: 'always_allow' } } as BetaManagedAgentsAgentToolConfigParams)) });
    const reasoning = this.request.spec.reasoning;
    const agent = await this.client.beta.agents.create({ ...this.params(), name: `OneRingAI ${this.request.sessionId}`, model: { id: this.request.spec.model!, ...(reasoning?.effort ? { effort: reasoning.effort as 'low' | 'medium' | 'high' | 'xhigh' | 'max' } : {}) }, system: this.request.spec.definition!.instructions, tools, mcp_servers: [], skills: [], multiagent: null, metadata: this.metadata() });
    this.owner(agent.metadata); this.agentId = agent.id; this.agentVersion = agent.version; this.phase = 'agent_created'; await this.save();
    const reference = this.request.spec.environment?.type === 'provider-managed' ? this.request.spec.environment.reference : undefined;
    if (reference) { this.environmentId = reference; this.environmentOwned = false; await this.verifyEnvironment(await this.client.beta.environments.retrieve(reference, this.params())); }
    else {
      this.phase = 'environment_intent'; this.environmentOwned = true; await this.save();
      const environment = await this.client.beta.environments.create({ ...this.params(), name: `OneRingAI ${this.request.sessionId}`, metadata: this.metadata(), config: { type: 'cloud', networking: this.request.policy.sandboxNetwork === 'allowed' ? { type: 'unrestricted' } : { type: 'limited', allowed_hosts: [], allow_mcp_servers: false, allow_package_managers: false } } });
      this.owner(environment.metadata); this.environmentId = environment.id; await this.verifyEnvironment(environment);
    }
    this.phase = 'session_intent'; await this.save();
    const amount = this.request.spec.driverConfig?.maxListCostUsdCents;
    const session = await this.client.beta.sessions.create({ ...this.params(), agent: { type: 'agent', id: this.agentId, version: this.agentVersion }, environment_id: this.environmentId!, resources: [], vault_ids: [], metadata: this.metadata(), ...(typeof amount === 'string' ? { budget: { type: 'limit', max_list_cost: { currency: 'USD', amount } } } : {}) });
    this.nativeId = session.id; this.phase = 'ready'; this.assertSession(session); await this.save();
  }
  private async verifyEnvironment(environment: BetaEnvironment): Promise<void> {
    if (environment.config.type !== 'cloud') throw new AgentPolicyUnsupportedError('Self-hosted Claude environments require a separate execution owner');
    if (this.environmentOwned) this.owner(environment.metadata);
    const network = environment.config.networking;
    if (this.request.policy.sandboxNetwork === 'denied' && (network.type !== 'limited' || network.allowed_hosts.length || network.allow_mcp_servers || network.allow_package_managers)) throw new AgentPolicyUnsupportedError('Claude environment does not enforce network denial');
  }
  private assertAgent(agent: Pick<BetaManagedAgentsAgent, 'system' | 'model' | 'multiagent' | 'tools' | 'skills' | 'mcp_servers'>): void {
    if (agent.system !== this.request.spec.definition!.instructions || agent.model.id !== this.request.spec.model || agent.multiagent || agent.skills.length || agent.mcp_servers.length) throw new AgentDriverConfigurationError('Native agent configuration changed');
    if (this.request.spec.reasoning?.effort && agent.model.effort?.type !== this.request.spec.reasoning.effort) throw new AgentDriverConfigurationError('Native reasoning configuration changed');
    const selected = new Set(this.request.spec.definition?.tools ?? []); const native = new Set(this.options.nativeTools ?? []);
    for (const tool of agent.tools) {
      if (tool.type === 'custom' && selected.delete(tool.name)) continue;
      if (tool.type !== 'agent_toolset_20260401' || tool.default_config.enabled) throw new AgentDriverConfigurationError('Unapproved native toolset');
      for (const config of tool.configs) {
        if (config.enabled && !native.delete(config.name)) throw new AgentDriverConfigurationError('Unapproved native tool addition');
        if (config.enabled && config.permission_policy.type !== 'always_allow') throw new AgentPolicyUnsupportedError('Unsupported native permission interaction');
      }
    }
    if (selected.size || native.size) throw new AgentDriverConfigurationError('Native agent is missing selected tools');
  }
  private assertSession(session: BetaManagedAgentsSession): void {
    this.owner(session.metadata);
    if (session.environment_id !== this.environmentId || session.agent.id !== this.agentId || session.agent.version !== this.agentVersion || session.vault_ids.length || session.resources.some(resource => resource.type !== 'file' || !this.uploads.some(upload => upload.fileId === resource.file_id && upload.mountPath === resource.mount_path)) || session.agent.multiagent) throw new AgentDriverConfigurationError('Native session resources/version changed');
    this.assertAgent(session.agent);
  }
  async verifySession(): Promise<BetaManagedAgentsSession> {
    const session = await this.client.beta.sessions.retrieve(this.nativeId!, this.params()); this.assertSession(session);
    await this.verifyEnvironment(await this.client.beta.environments.retrieve(this.environmentId!, this.params())); return session;
  }
  async reconcileResources(): Promise<void> {
    const find = async <T extends { id: string; metadata: Record<string,string> }>(values: AsyncIterable<T>): Promise<T> => {
      let count = 0; const matches: T[] = [];
      for await (const resource of values) { if (++count > 1024) throw new Error('Native resource reconciliation bound exceeded'); if (Object.entries(this.metadata()).every(([key, value]) => resource.metadata[key] === value)) matches.push(resource); }
      if (matches.length !== 1) throw new Error('Native creation cannot be uniquely reconciled; preserve the original reference'); return matches[0]!;
    };
    if (!this.agentId && this.phase === 'agent_intent') { const agent = await find(this.client.beta.agents.list(this.params())); this.agentId = agent.id; this.agentVersion = agent.version; await this.save(); }
    if (!this.environmentId && this.phase === 'environment_intent') { const environment = await find(this.client.beta.environments.list(this.params())); this.environmentId = environment.id; this.environmentOwned = true; await this.save(); }
    if (!this.nativeId && this.phase === 'session_intent') { this.nativeId = (await find(this.client.beta.sessions.list(this.params()))).id; await this.save(); }
    if (!this.nativeId && this.phase === 'ready') throw new Error('Incomplete native session checkpoint');
  }
  async run(request: DriverRunRequest): Promise<DriverRun> {
    if (this.destroyed || this.detached || this.active) throw new AgentDriverConfigurationError('Claude managed session unavailable/busy');
    if (request.model || request.reasoning || request.responseFormat?.type === 'json_schema') throw new AgentDriverConfigurationError('Claude managed session model/reasoning are fixed; structured output is not exposed by this endpoint profile');
    if (typeof request.input !== 'string' && request.input.parts.some(p => p.type !== 'text')) throw new AgentDriverConfigurationError('Claude managed profile accepts text only');
    this.inputText = typeof request.input === 'string' ? request.input : request.input.parts.map(p => p.type === 'text' ? p.text : '').join('\n');
    this.inputId = undefined; this.cancelId = undefined; this.cancelIntent = false; this.cancelBoundaryId = undefined; this.inputState = 'not_sent'; this.observed.clear();
    return this.createRun(request);
  }
  observeExisting(): DriverRun { return this.createRun(); }
  private createRun(request?: DriverRunRequest): DriverRun {
    const deferred = createDeferred<DriverRunResult>(); this.active = { resolve: deferred.resolve };
    void deferred.promise.then(() => { this.active = undefined; });
    return { events: this.observe(request), result: deferred.promise, cancel: () => this.cancelActiveRun() };
  }
  private async history(): Promise<BetaManagedAgentsSessionEvent[]> {
    const events: BetaManagedAgentsSessionEvent[] = []; let bytes = 0;
    for await (const event of this.client.beta.sessions.events.list(this.nativeId!, { ...this.params(), order: 'asc' })) {
      bytes += Buffer.byteLength(JSON.stringify(event)); if (events.length >= 10000 || bytes > 4 * 1024 * 1024) throw new Error('Native event-history reconciliation bound exceeded'); events.push(event);
    }
    return events;
  }
  private epoch(history: BetaManagedAgentsSessionEvent[]): BetaManagedAgentsSessionEvent[] {
    const boundary = this.baselineId ? history.findIndex(event => event.id === this.baselineId) : -1;
    if (this.baselineId && boundary === -1) throw new Error('Native input boundary is missing from retained history');
    const current = history.slice(boundary + 1);
    if (!this.inputId) {
      const inputs = current.filter(event => event.type === 'user.message');
      const matches = inputs.filter(event => event.type === 'user.message' && event.content.filter(part => part.type === 'text').map(part => part.text).join('\n') === this.inputText);
      if (inputs.length !== 1 || matches.length !== 1) throw new Error('Native input acceptance cannot be uniquely reconciled; do not resend it');
      this.inputId = matches[0]!.id; this.inputState = 'accepted';
    }
    const index = current.findIndex(event => event.id === this.inputId);
    if (index === -1) throw new Error('Native input echo is missing');
    if (current.slice(index + 1).some(event => event.type === 'user.message')) throw new Error('Concurrent foreign native input detected');
    return current.slice(index);
  }
  private async *observe(request?: DriverRunRequest): AsyncGenerator<DriverEvent> {
    try {
      let buffered: AsyncIterable<BetaManagedAgentsStreamSessionEvents>;
      this.stream = await this.client.beta.sessions.events.stream(this.nativeId!, { ...this.params(), event_deltas: ['agent.message','agent.thinking'] });
      buffered = bufferManagedEvents(this.stream, this.request.policy.limits?.eventBufferBytes ?? 1024 * 1024);
      if (request) {
        const session = await this.verifySession(); const before = await this.history();
        this.baselineId = before.at(-1)?.id; this.usageBefore = session.usage; this.inputState = 'submission_unknown'; await this.save(); request.signal.throwIfAborted();
        try {
          const sent = await this.client.beta.sessions.events.send(this.nativeId!, { ...this.params(), events: [{ type: 'user.message', content: [{ type: 'text', text: this.inputText! }] }] });
          this.inputId = sent.data?.find(event => event.type === 'user.message')?.id;
          if (this.inputId) this.inputState = 'accepted'; await this.save();
        } catch (error) { yield { type: 'diagnostic', data: { code: 'INPUT_ACCEPTANCE_UNKNOWN', message: errorMessage(error) } }; }
      } else if (this.inputState === 'not_sent') throw new Error('Admitted input was not dispatched; explicit host reconciliation required');
      for (let attempt = 0; attempt <= (this.options.maxReconnects ?? 3); attempt++) {
        if (attempt) { this.stream?.controller.abort(); this.stream = await this.client.beta.sessions.events.stream(this.nativeId!, this.params()); buffered = bufferManagedEvents(this.stream); yield { type: 'diagnostic', data: { code: 'OBSERVATION_RECONNECT', attempt } }; }
        try {
        const session = await this.verifySession(); const current = this.epoch(await this.history()); await this.save();
        for (const event of current) if (!this.observed.has(event.id)) { this.observed.add(event.id); yield* this.display(event); }
        if (await this.finish(session, current)) return;
        const idle = this.latestIdle(current);
        if (session.status === 'idle' && idle?.stop_reason.type === 'requires_action') for (const id of idle.stop_reason.event_ids) {
          const call = current.find(event => event.id === id); if (call?.type === 'agent.custom_tool_use') yield* this.handleTool(call, false);
        }
          for await (const event of buffered) {
            if (this.detached) return;
            if (event.type === 'event_delta') { yield { type: 'agent.message.delta', data: { text: event.delta.content.text, itemId: event.event_id, contentIndex: event.delta.index ?? 0 } }; continue; }
            if (event.type === 'event_start') { if (event.event.type === 'agent.thinking') yield { type: 'diagnostic', data: { code: 'NATIVE_THINKING', eventId: event.event.id } }; continue; }
            if (this.observed.has(event.id)) continue; this.observed.add(event.id);
            yield* this.display(event);
            if (event.type === 'agent.custom_tool_use') { if (!this.inputId) this.epoch(await this.history()); yield* this.handleTool(event, true); }
            if (event.type === 'session.status_idle' || event.type === 'session.status_terminated') {
              const state = await this.verifySession(); const events = this.epoch(await this.history());
              if (await this.finish(state, events)) return;
              if (event.type === 'session.status_idle') { this.waitReason = event.stop_reason.type; yield { type: 'diagnostic', data: { code: 'NATIVE_WAITING', reason: this.waitReason } }; }
            }
            if (this.observed.size > 10000) throw new Error('Native observation event bound exceeded');
          }
        } catch (error) { if (this.detached) return; if (attempt === (this.options.maxReconnects ?? 3)) throw error; }
      }
      throw new Error('Native observation closed without a terminal turn; preserve the original session reference');
    } finally { this.stream?.controller.abort(); }
  }
  private async *display(event: BetaManagedAgentsSessionEvent): AsyncGenerator<DriverEvent> {
    if (event.type === 'agent.message') yield { type: 'agent.message.completed', data: { text: event.content.filter(part => part.type === 'text').map(part => part.text).join(''), itemId: event.id } };
    else if (event.type === 'agent.thinking') yield { type: 'diagnostic', data: { code: 'NATIVE_THINKING', eventId: event.id } };
    else if (event.type === 'session.error') yield { type: 'diagnostic', data: { code: 'NATIVE_SESSION_ERROR', error: toJsonObject(event.error) } };
    else if (event.type === 'session.status_rescheduled') yield { type: 'diagnostic', data: { code: 'NATIVE_RESCHEDULING' } };
  }
  private latestIdle(events: BetaManagedAgentsSessionEvent[]): BetaManagedAgentsSessionStatusIdleEvent | undefined { return events.slice().reverse().find(event => event.type === 'session.status_idle') as BetaManagedAgentsSessionStatusIdleEvent | undefined; }
  private async *handleTool(call: BetaManagedAgentsAgentCustomToolUseEvent, live: boolean): AsyncGenerator<DriverEvent> {
    if (call.session_thread_id) throw new AgentPolicyUnsupportedError('Unexpected native delegation');
    const session = await this.verifySession(); const current = this.epoch(await this.history()); const idle = this.latestIdle(current);
    const resultExists = current.some(event => event.type === 'user.custom_tool_result' && event.custom_tool_use_id === call.id);
    const pending = session.status === 'idle' && idle?.stop_reason.type === 'requires_action' && idle.stop_reason.event_ids.includes(call.id);
    if (resultExists || (!pending && !(live && session.status === 'running' && current.some(event => event.id === call.id)))) return;
    yield { type: 'tool.started', data: { name: call.name, callId: call.id } };
    const report = await this.request.hostTools!.execute(call.name, call.input, call.id);
    const refreshed = this.epoch(await this.history());
    if (refreshed.some(event => event.type === 'user.custom_tool_result' && event.custom_tool_use_id === call.id)) return;
    await this.client.beta.sessions.events.send(this.nativeId!, { ...this.params(), events: [{ type: 'user.custom_tool_result', custom_tool_use_id: call.id, content: [{ type: 'text', text: report.modelText }], is_error: report.outcome.status !== 'succeeded' }] });
    yield { type: 'tool.completed', data: { name: call.name, callId: call.id, status: report.outcome.status } };
  }
  private async finish(session: BetaManagedAgentsSession, current: BetaManagedAgentsSessionEvent[]): Promise<boolean> {
    const idle = this.latestIdle(current); const stopped = session.status === 'idle' && idle && ['end_turn','refusal','retries_exhausted'].includes(idle.stop_reason.type);
    if (!stopped && session.status !== 'terminated') return false;
    if (this.cancelIntent && !this.cancelId) {
      const boundary = this.cancelBoundaryId ? current.findIndex(event => event.id === this.cancelBoundaryId) : -1;
      const echo = current.slice(boundary + 1).filter(event => event.type === 'user.interrupt');
      if (echo.length === 1) this.cancelId = echo[0]!.id;
    }
    const cancelIndex = this.cancelId ? current.findIndex(event => event.id === this.cancelId) : -1;
    const stopIndex = idle ? current.findIndex(event => event.id === idle.id) : current.length;
    const cancelled = cancelIndex >= 0 && stopIndex > cancelIndex;
    const message = current.slice().reverse().find(event => event.type === 'agent.message');
    let outputText = message?.type === 'agent.message' ? message.content.filter(part => part.type === 'text').map(part => part.text).join('') : '';
    const limit = this.request.policy.limits?.outputBytes ?? 1024 * 1024; const truncated = Buffer.byteLength(outputText) > limit;
    if (truncated) outputText = new TextDecoder().decode(Buffer.from(outputText).subarray(0, limit), { stream: true });
    const status = cancelled ? 'cancelled' : truncated ? 'incomplete' : idle?.stop_reason.type === 'end_turn' || idle?.stop_reason.type === 'refusal' ? 'completed' : idle?.stop_reason.type === 'retries_exhausted' ? 'failed' : 'incomplete';
    const subtract = (key: 'input_tokens' | 'output_tokens' | 'cache_read_input_tokens'): number | undefined => { const value = session.usage[key]; const before = this.usageBefore?.[key]; return value !== undefined && before !== undefined && value >= before ? value - before : undefined; };
    const result: DriverRunResult = { status, outputText, finishReason: truncated ? 'runtime_output_limit' : cancelled ? 'interrupted' : idle?.stop_reason.type ?? 'native_terminated_without_end_turn', usage: { inputTokens: subtract('input_tokens'), outputTokens: subtract('output_tokens'), cachedInputTokens: subtract('cache_read_input_tokens'), native: toJsonObject({ sessionCumulative: session.usage, coverage: 'difference-of-native-session-snapshots', externalFeesIncluded: false }) }, native: { outputSelection: 'last-complete-agent-message' } };
    try { result.artifacts = await this.generatedFiles(); }
    catch (error) { result.status = 'incomplete'; result.finishReason = 'artifact_inventory_incomplete'; result.error = { code: 'AGENT_ARTIFACT_INVENTORY', message: errorMessage(error) }; }
    this.inputState = 'terminal'; this.waitReason = undefined; await this.save(); this.active?.resolve(result); return true;
  }
  private async generatedFiles(): Promise<AgentArtifact[]> {
    const artifacts: AgentArtifact[] = []; let count = 0;
    for await (const file of this.client.beta.files.list({ ...this.params(), scope_id: this.nativeId! })) {
      if (++count > 1000) throw new AgentDriverConfigurationError('Session file inventory exceeds the bound');
      if (file.scope?.type !== 'session' || file.scope.id !== this.nativeId) throw new AgentDriverConfigurationError('Foreign native file scope');
      if (file.downloadable && (!file.expires_at || Date.parse(file.expires_at) > Date.now())) artifacts.push({ type: 'reference', name: file.filename, mediaType: file.mime_type, reference: `claude-file:${this.nativeId}:${file.id}` });
    }
    return artifacts;
  }
  /** Discover an uncertain upload by its durable random intent, never repeat an upload. */
  async reconcileUploads(): Promise<void> {
    for (const upload of this.uploads) {
      if (!upload.fileId) {
        let count = 0; const matches: string[] = [];
        for await (const file of this.client.beta.files.list(this.params())) {
          if (++count > 1000) throw new AgentDriverConfigurationError('Upload intent reconciliation exceeds the bound');
          if (file.filename === upload.name && file.size_bytes === upload.size && file.mime_type === upload.mediaType) matches.push(file.id);
        }
        if (matches.length !== 1) throw new AgentDriverConfigurationError('Upload acceptance is unknown; retain its original session reference and reconcile the native file');
        upload.fileId = matches[0]; await this.save();
      }
      if (this.nativeId && !upload.resourceId) {
        let count = 0;
        for await (const resource of this.client.beta.sessions.resources.list(this.nativeId, this.params())) {
          if (++count > 128) throw new AgentDriverConfigurationError('Native resource inventory exceeds the bound');
          if (resource.type === 'file' && resource.file_id === upload.fileId && resource.mount_path === upload.mountPath) { upload.resourceId = resource.id; await this.save(); }
        }
      }
    }
  }
  async uploadFile(file: { name: string; data: Uint8Array; mediaType: string }) {
    if (this.active || this.detached || this.destroyed) throw new AgentDriverConfigurationError('Transfer requires an attached idle session');
    await this.verifySession();
    if (this.uploads.some(upload => !upload.fileId || !upload.resourceId)) throw new AgentDriverConfigurationError('Reconcile the prior upload before adding another file');
    const name = portableFilename(file.name); const upload: typeof this.uploads[number] = { name: `${randomUUID()}-${name}`, size: file.data.byteLength, mediaType: file.mediaType, mountPath: `/mnt/session/uploads/${name}` };
    if (this.uploads.length >= 128 || this.uploads.some(item => item.mountPath === upload.mountPath)) throw new AgentDriverConfigurationError('Upload capacity or duplicate mount path');
    this.uploads.push(upload); await this.save();
    const { toFile } = await import('@anthropic-ai/sdk');
    const metadata = await this.client.beta.files.upload({ ...this.params(), file: await toFile(file.data, upload.name, { type: file.mediaType }), expires_in_seconds: 86400 });
    if (metadata.filename !== upload.name || metadata.size_bytes !== upload.size || metadata.mime_type !== upload.mediaType) throw new AgentDriverConfigurationError('Native file acknowledgement differs from the explicit upload intent');
    upload.fileId = metadata.id; await this.save();
    const resource = await this.client.beta.sessions.resources.add(this.nativeId!, { ...this.params(), type: 'file', file_id: upload.fileId, mount_path: upload.mountPath });
    if (resource.file_id !== upload.fileId || resource.mount_path !== upload.mountPath) throw new AgentDriverConfigurationError('Unexpected native upload mount');
    upload.resourceId = resource.id; await this.save();
    return { type: 'reference' as const, name, mediaType: file.mediaType, reference: `claude-file:${this.nativeId}:${upload.fileId}` };
  }
  async downloadArtifact(reference: string, limits: { maxBytes: number; mediaTypes: readonly string[] }): Promise<Response> {
    await this.verifySession();
    const prefix = `claude-file:${this.nativeId}:`;
    if (!reference.startsWith(prefix) || !/^[a-zA-Z0-9_-]{1,256}$/.test(reference.slice(prefix.length))) throw new AgentDriverConfigurationError('Foreign or invalid artifact reference');
    const id = reference.slice(prefix.length); const file = await this.client.beta.files.retrieveMetadata(id, this.params());
    if (file.id !== id || (!this.uploads.some(upload => upload.fileId === id) && (file.scope?.type !== 'session' || file.scope.id !== this.nativeId))) throw new AgentDriverConfigurationError('File does not belong to this session');
    if (file.expires_at && (!Number.isFinite(Date.parse(file.expires_at)) || Date.parse(file.expires_at) <= Date.now())) throw new AgentDriverConfigurationError('Artifact has expired');
    if (!file.downloadable) throw new AgentDriverConfigurationError('Native file is not downloadable');
    checkFileMetadata(file.size_bytes, file.mime_type, limits);
    return artifactResponse(await this.client.beta.files.download(id, this.params()), file.size_bytes);
  }
  async inspectState(): Promise<RuntimeSessionSnapshot> {
    const session = await this.verifySession();
    if (this.uploads.some(upload => !upload.fileId || !upload.resourceId)) return { connection: 'attached', activity: 'unknown', waitReason: 'file-upload-reconciliation', unresolvedEffects: true };
    if (this.request.control?.data.activeRunId && !this.inputId && this.inputState !== 'accepted' && this.inputState !== 'terminal') return { connection: this.detached ? 'reconnecting' : 'attached', activity: 'unknown', activeRunId: String(this.request.control.data.activeRunId), waitReason: 'input-submission', unresolvedEffects: true };
    if (this.request.control?.data.activeRunId) { const current = this.epoch(await this.history()); const idle = this.latestIdle(current); this.waitReason = session.status === 'idle' ? idle?.stop_reason.type : undefined; }
    return { connection: this.detached ? 'reconnecting' : 'attached', activity: this.request.control?.data.activeRunId ? session.status === 'idle' ? 'waiting' : session.status === 'terminated' ? 'terminal' : 'running' : 'ready', activeRunId: this.request.control?.data.activeRunId as string | undefined, ...(this.waitReason ? { waitReason: this.waitReason } : {}), unresolvedEffects: false };
  }
  async cancelActiveRun(): Promise<void> {
    if (!this.active || !this.nativeId) return;
    await this.verifySession();
    this.cancelIntent = true; this.cancelBoundaryId = (await this.history()).at(-1)?.id; await this.save();
    const response = await this.client.beta.sessions.events.send(this.nativeId, { ...this.params(), events: [{ type: 'user.interrupt' }] });
    this.cancelId = response.data?.find(event => event.type === 'user.interrupt')?.id; await this.save();
    const session = await this.verifySession(); await this.finish(session, this.epoch(await this.history()));
  }
  async detach(): Promise<void> { this.detached = true; this.stream?.controller.abort(); }
  async destroy(): Promise<void> { if (this.destroyed) return; this.destroyed = true; try { if (!this.detached) await this.cancelActiveRun(); } finally { this.stream?.controller.abort(); } }
  async deleteOwned(): Promise<void> {
    await this.reconcileResources();
    await this.reconcileUploads();
    if (this.nativeId) {
      try { const session = await this.client.beta.sessions.retrieve(this.nativeId, this.params()); this.owner(session.metadata); if (session.status === 'running' || session.status === 'rescheduling') throw new Error('Native execution must be interrupted and confirmed before deletion'); await this.client.beta.sessions.delete(this.nativeId, this.params()); }
      catch (error) { if ((error as { status?: number }).status !== 404) throw error; }
    } else if (this.phase === 'session_intent') throw new Error('Unresolved session creation');
    for (const upload of this.uploads) {
      if (!upload.fileId) throw new AgentDriverConfigurationError('Unresolved file ownership');
      try { await this.client.beta.files.delete(upload.fileId, this.params()); }
      catch (error) { if ((error as { status?: number }).status !== 404) throw error; }
    }
    if (this.agentId) { const agent = await this.client.beta.agents.retrieve(this.agentId, this.params()); this.owner(agent.metadata); if (!agent.archived_at) await this.client.beta.agents.archive(this.agentId, this.params()); }
    if (this.environmentOwned && this.environmentId) {
      try { const environment = await this.client.beta.environments.retrieve(this.environmentId, this.params()); this.owner(environment.metadata); await this.client.beta.environments.delete(this.environmentId, this.params()); }
      catch (error) { if ((error as { status?: number }).status !== 404) throw error; }
    }
  }
}
