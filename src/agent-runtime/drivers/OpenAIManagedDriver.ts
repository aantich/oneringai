import { managedFetch } from '../ManagedTransport.js';
import type OpenAI from 'openai';
import type { ClientOptions } from 'openai';
import type { AgentSession, AgentSessionEvent, AgentSessionInputParam, AgentToolParam, EnvironmentParam, TokenUsage } from 'openai/resources/beta/agents/agents';
import type { Turn } from 'openai/resources/beta/agents/sessions/turns/turns';
import { portableFilename, checkFileMetadata, artifactResponse } from '../RuntimeFileTransfers.js';
import { Vendor } from '../../core/Vendor.js';
import { getModelInfo } from '../../domain/entities/Model.js';
import type { AgentDriver, DriverOpenSessionRequest, DriverSession, DriverRunRequest, DriverRun, DriverEvent, DriverRunResult } from '../AgentDriver.js';
import { AgentDriverConfigurationError, AgentPolicyUnsupportedError } from '../errors.js';
import { controlJson, runtimeScope } from '../RuntimeSessionStorage.js';
import { bufferManagedEvents } from '../ManagedEventBuffer.js';
import { definitionDigest } from '../RuntimeHostTools.js';
import { createDeferred, runtimeTokenProvider, errorMessage, toJsonObject } from '../internal.js';
import { parseAndValidateStructuredOutput } from '../StructuredOutputValidator.js';
import type { JsonObject, RuntimeReasoningConfig, RuntimeResponseFormat, RuntimeSessionSnapshot } from '../types.js';

type EventStream = AsyncIterable<AgentSessionEvent> & { controller: AbortController };
export interface OpenAIManagedDriverOptions {
  createClient?: (options: ClientOptions) => OpenAI;
  /** Endpoint-specific host assertions for models beyond the documented quickstart. */
  modelEfforts?: Readonly<Record<string, readonly string[]>>;
  /** Trusted hosted templates whose inherited provisioning configuration was reviewed by the host. */
  environmentTemplates?: readonly string[];
  maxReconnects?: number;
}

/** Official managed Codex harness. This is distinct from the client-side OpenAI Agents SDK. */
export class OpenAIManagedDriver implements AgentDriver {
  readonly id = 'openai.agents.api';
  constructor(private readonly options: OpenAIManagedDriverOptions = {}) {
    if (options.maxReconnects !== undefined && (!Number.isSafeInteger(options.maxReconnects) || options.maxReconnects < 0 || options.maxReconnects > 10)) throw new AgentDriverConfigurationError('maxReconnects must be between 0 and 10');
  }
  async inspect(request: Parameters<AgentDriver['inspect']>[0]) {
    const spec = request.spec;
    if (!spec.definition || !spec.connector || !spec.model) throw new AgentDriverConfigurationError('OpenAI managed execution requires a logical definition, connector and model');
    const connector = request.connectorRegistry.get(spec.connector);
    if (connector.vendor !== Vendor.OpenAI || !['api_key','api_key_provider'].includes(connector.config.auth.type)) throw new AgentDriverConfigurationError('OpenAI managed execution requires an OpenAI API-key connector');
    this.validateModel(spec.model, spec.reasoning);
    if (request.durability !== 'durable') throw new AgentDriverConfigurationError('Managed execution requires durable runtime control storage');
    if (Object.keys(spec.driverConfig ?? {}).length) throw new AgentDriverConfigurationError('Unknown OpenAI managed driverConfig fields');
    if (request.workspace || spec.environment?.type === 'local-directory') throw new AgentPolicyUnsupportedError('Managed execution cannot use a local directory as its sandbox');
    const environment = spec.environment?.type === 'provider-managed' ? 'hosted' : 'none';
    const reference = spec.environment?.type === 'provider-managed' ? spec.environment.reference : undefined;
    if (reference && !this.options.environmentTemplates?.includes(reference)) throw new AgentPolicyUnsupportedError('Hosted template must be explicitly reviewed/allowed by the host');
    if (request.policy) {
      if (request.policy.approvals !== 'deny') throw new AgentPolicyUnsupportedError('Managed interactive approvals are not enabled by this profile');
      if (environment === 'none' && (request.policy.commands !== 'denied' || request.policy.filesystem !== 'denied')) throw new AgentPolicyUnsupportedError('No-environment execution requires native commands/filesystem denied');
      if (environment === 'hosted' && (request.policy.commands !== 'sandboxed' || request.policy.filesystem !== 'workspace-write')) throw new AgentPolicyUnsupportedError('Hosted execution requires sandboxed commands and workspace-write filesystem policy');
    }
    const ids = ['agent.definition','tools.host','environment.provider-managed','session.continue','session.restore','run.cancel','run.structured_output','run.model_override','run.reasoning_override','event.live','event.message','event.reasoning','event.tool','files.download', ...(environment === 'hosted' ? ['files.upload'] : [])];
    return { inspection: { toolNamePrefix: '', enforcement: { nativeFilesystem: 'native' as const, nativeCommands: 'native' as const, sandboxNetwork: 'native' as const, providerWebSearch: 'native' as const }, notes: ['Account entitlement is checked only by native requests.'] }, capabilities: { driverId: this.id, configuration: { model: spec.model, ...(spec.reasoning ? { reasoning: spec.reasoning } : {}) }, capabilities: Object.fromEntries(ids.map(id => [id, { id, support: (id === 'run.structured_output' ? 'emulated' : 'native') as 'emulated' | 'native', ...(id === 'agent.definition' ? { constraints: { profile: 'owned-session-v1', environment, nativeDelegation: false, memory: false, format: 'fixed-at-first-turn' } } : {}) }])) } };
  }
  async openSession(request: DriverOpenSessionRequest): Promise<DriverSession> {
    await this.inspect(request);
    return new OpenAIManagedSession(request, await this.client(request), this.options.maxReconnects ?? 3, (model, reasoning) => this.validateModel(model, reasoning));
  }
  async restoreSession(request: DriverOpenSessionRequest & { checkpoint: JsonObject }): Promise<{ session: DriverSession; activeRun?: DriverRun }> {
    await this.inspect(request);
    if (request.checkpoint.kind !== 'openai-managed-v1') throw new AgentDriverConfigurationError('Invalid OpenAI managed checkpoint');
    const session = new OpenAIManagedSession(request, await this.client(request), this.options.maxReconnects ?? 3, (model, reasoning) => this.validateModel(model, reasoning), request.checkpoint);
    await session.reconcileOwnership();
    return { session, ...(request.control?.data.activeRunId ? { activeRun: session.observeExisting() } : {}) };
  }
  async deleteSession(request: DriverOpenSessionRequest & { checkpoint: JsonObject }): Promise<void> {
    const session = new OpenAIManagedSession(request, await this.client(request), 0, (model, reasoning) => this.validateModel(model, reasoning), request.checkpoint);
    await session.deleteOwned();
  }
  private validateModel(model: string, reasoning?: RuntimeReasoningConfig): void {
    const info = getModelInfo(model);
    const efforts = this.options.modelEfforts?.[model] ?? (model === 'gpt-6-astra' ? ['low','medium','high','xhigh','max'] : undefined);
    if (!info?.isActive || info.provider !== Vendor.OpenAI || !efforts) throw new AgentDriverConfigurationError(`Model '${model}' has no verified OpenAI managed endpoint profile`);
    if ((reasoning?.effort && !['none','minimal','low','medium','high','xhigh','max'].includes(reasoning.effort)) || reasoning?.budgetTokens !== undefined || reasoning?.enabled === false || (reasoning?.effort && !efforts.includes(reasoning.effort))) throw new AgentDriverConfigurationError('Unsupported managed OpenAI reasoning control');
  }
  private async client(request: DriverOpenSessionRequest): Promise<OpenAI> {
    const connector = request.connectorRegistry.get(request.spec.connector!);
    if (connector.vendor !== Vendor.OpenAI || !['api_key','api_key_provider'].includes(connector.config.auth.type)) throw new AgentDriverConfigurationError('Cleanup/restore requires the original OpenAI API-key connector');
    const token = runtimeTokenProvider(request.connectorRegistry, request.spec.connector!);
    const options: ClientOptions = { apiKey: token, organization: connector.config.options?.organization ?? null, project: connector.config.options?.project ?? null, logLevel: 'off', baseURL: connector.baseURL || 'https://api.openai.com/v1', maxRetries: 0, timeout: 10000, fetch: managedFetch(fetch, connector.baseURL || 'https://api.openai.com/v1') };
    if (this.options.createClient) return this.options.createClient(options);
    const { default: Client } = await import('openai'); return new Client(options);
  }
}

class OpenAIManagedSession implements DriverSession {
  private destroyed = false;
  private detached = false;
  private nativeId?: string;
  private turnId?: string;
  private runId?: string;
  private inputState = 'not_sent';
  private uploadIntent?: { path: string; bytes: number };
  private format?: RuntimeResponseFormat;
  private stream?: EventStream;
  private active?: { resolve: (result: DriverRunResult) => void; request?: DriverRunRequest };
  private readonly seenEvents = new Set<string>();
  private readonly finalItems = new Set<string>();
  private baseline = new Set<string>();
  private lastResult?: DriverRunResult;
  constructor(private readonly request: DriverOpenSessionRequest, private readonly client: OpenAI, private readonly maxReconnects: number, private readonly validateModel: (model: string, reasoning?: RuntimeReasoningConfig) => void, checkpoint?: JsonObject) {
    if (checkpoint) {
      this.nativeId = typeof checkpoint.nativeId === 'string' ? checkpoint.nativeId : undefined;
      this.turnId = typeof checkpoint.turnId === 'string' ? checkpoint.turnId : undefined;
      this.runId = typeof checkpoint.runId === 'string' ? checkpoint.runId : undefined;
      this.uploadIntent = checkpoint.uploadIntent as typeof this.uploadIntent;
      this.inputState = String(checkpoint.inputState ?? 'not_sent');
      this.format = checkpoint.format as RuntimeResponseFormat | undefined;
      this.baseline = new Set((checkpoint.baseline as string[] | undefined) ?? []);
    }
  }
  readonly observationIndependent = true;
  get isDestroyed() { return this.destroyed; }
  get nativeSessionId() { return this.nativeId; }
  async checkpoint(): Promise<JsonObject> { return controlJson({ kind: 'openai-managed-v1', nativeId: this.nativeId, turnId: this.turnId, runId: this.runId, inputState: this.inputState, format: this.format, uploadIntent: this.uploadIntent, baseline: [...this.baseline] }); }
  private async save(): Promise<void> { const checkpoint = await this.checkpoint(); await this.request.control?.update(data => { data.checkpoint = checkpoint; }); }
  async run(request: DriverRunRequest): Promise<DriverRun> {
    if (this.destroyed || this.detached || this.active) throw new AgentDriverConfigurationError('Managed session is unavailable/busy');
    this.validateModel(request.model ?? this.request.spec.model!, request.reasoning ?? this.request.spec.reasoning);
    if (typeof request.input !== 'string' && request.input.parts.some(p => p.type !== 'text')) throw new AgentDriverConfigurationError('Managed profile accepts text input only');
    if (this.nativeId && JSON.stringify(request.responseFormat ?? { type: 'text' }) !== JSON.stringify(this.format ?? { type: 'text' })) throw new AgentDriverConfigurationError('Managed OpenAI output format is fixed at the first turn');
    this.format = request.responseFormat ?? { type: 'text' };
    this.runId = String(this.request.control?.data.activeRunId);
    this.turnId = undefined; this.inputState = 'not_sent'; this.finalItems.clear(); this.seenEvents.clear();
    return this.createRun(request);
  }
  observeExisting(): DriverRun { this.runId = String(this.request.control?.data.activeRunId); return this.createRun(); }
  private createRun(request?: DriverRunRequest): DriverRun {
    const deferred = createDeferred<DriverRunResult>();
    this.active = { resolve: deferred.resolve, request };
    void deferred.promise.then(() => { this.active = undefined; });
    return { events: this.observe(request), result: deferred.promise, cancel: () => this.cancelActiveRun() };
  }
  private async *observe(input?: DriverRunRequest): AsyncGenerator<DriverEvent> {
    try {
      const baseline = input ? new Set<string>() : this.baseline;
      if (this.nativeId && input) for await (const turn of this.client.beta.agents.sessions.turns.list(this.nativeId, { order: 'desc' })) { baseline.add(turn.id); if (baseline.size > 1024) throw new Error('Turn-history admission bound exceeded'); }
      this.baseline = baseline;
      if (!input && this.inputState === 'not_sent') throw new Error('Original input was admitted but not dispatched; do not match an older native turn');
      if (!this.nativeId && input) {
        input.signal.throwIfAborted(); this.inputState = 'submission_unknown'; await this.save();
        const environment: EnvironmentParam = this.request.spec.environment?.type === 'provider-managed'
          ? { type: 'openai_hosted', ...(this.request.spec.environment.reference ? { environment_template_id: this.request.spec.environment.reference } : {}), network: { access: this.request.policy.sandboxNetwork === 'allowed' ? 'enabled' : 'disabled' }, desktop: { enabled: false }, plugins: [], skills: [], capability_directories: [], setup_commands: [], packages: { npm: [], python: [], system: [] } }
          : { type: 'none' };
        const tools: AgentToolParam[] = (this.request.hostTools?.definitions ?? []).map(t => ({ type: 'function', ...t, defer_loading: false }));
        if (this.request.policy.providerWebSearch === 'allowed') tools.push({ type: 'web_search' });
        this.stream = await this.client.beta.agents.sessions.create({ environment, agent: { model: input.model ?? this.request.spec.model!, instructions: this.request.spec.definition!.instructions,
          multi_agent: { enabled: false }, tools, ...(this.reasoning(input) ? { reasoning: this.reasoning(input) } : {}),
          ...(this.format?.type === 'json_schema' ? { text: { format: { type: 'json_schema', schema: this.format.schema } } } : {}) },
          metadata: this.metadata(), input: this.text(input), stream: true }, { idempotencyKey: `onering-create-${this.request.sessionId}`, maxRetries: 0 });
      } else {
        await this.reconcileOwnership();
        this.stream = await this.client.beta.agents.sessions.events.stream(this.nativeId!);
        if (input) {
          await this.client.beta.agents.sessions.update(this.nativeId!, { agent: { model: input.model ?? this.request.spec.model!, reasoning: { effort: this.reasoning(input)?.effort ?? null } } });
          input.signal.throwIfAborted(); this.inputState = 'submission_unknown'; await this.save();
          try { await this.send([{ type: 'agent.session.input.message', input: [{ role: 'user', content: [{ type: 'input_text', text: this.text(input) }] }] }], `input-${this.runId}`); this.inputState = 'accepted'; await this.save(); }
          catch (error) { yield { type: 'diagnostic', data: { code: 'INPUT_ACCEPTANCE_UNKNOWN', message: errorMessage(error) } }; }
        }
      }
      for (let reconnect = 0; reconnect <= this.maxReconnects; reconnect++) {
        if (reconnect > 0) {
          this.stream?.controller.abort();
          this.stream = await this.client.beta.agents.sessions.events.stream(this.nativeId!);
          yield { type: 'diagnostic', data: { code: 'OBSERVATION_RECONNECT', attempt: reconnect } };
        }
        // Start reading immediately so events buffer while canonical state/items are reconciled.
        const buffered = bufferManagedEvents(this.stream!, this.request.policy.limits?.eventBufferBytes ?? 1024 * 1024);
        try {
        if (this.nativeId) {
          const session = await this.client.beta.agents.sessions.retrieve(this.nativeId);
          this.assertOwner(session);
          if (!this.turnId) await this.findTurn(baseline);
          if (this.turnId) {
            yield* this.restoreItems();
            const turn = await this.client.beta.agents.sessions.turns.retrieve(this.turnId, { session_id: this.nativeId });
            if (await this.finish(turn)) { yield* this.restoreItems(); if (this.lastResult?.usage) yield { type: 'usage.updated', data: toJsonObject(this.lastResult.usage) }; return; }
          }
          yield* this.handleActions(session);
        }
          for await (const event of buffered) {
            if (this.detached) return;
            if (this.seenEvents.has(event.event_id)) continue;
            this.seenEvents.add(event.event_id); if (this.seenEvents.size > 10000) this.seenEvents.delete(this.seenEvents.values().next().value!);
            if (event.type === 'agent.session.created') { this.nativeId = event.session.id; this.assertOwner(event.session); this.inputState = 'accepted'; await this.save(); }
            if (!this.nativeId) continue;
            if ('turn' in event && event.turn.subagent_id === null && !baseline.has(event.turn.id)) {
              if (!this.turnId) { this.turnId = event.turn.id; this.inputState = 'accepted'; await this.save(); }
              if (event.turn.id !== this.turnId) throw new Error('Concurrent foreign root turn detected');
              if (await this.finish(event.turn)) { yield* this.restoreItems(); if (this.lastResult?.usage) yield { type: 'usage.updated', data: toJsonObject(this.lastResult.usage) }; return; }
            }
            if ('turn_id' in event && event.turn_id && this.turnId && event.turn_id !== this.turnId) continue;
            if (event.type === 'agent.session.turn.output_text.delta' && !this.finalItems.has(event.item_id)) yield { type: 'agent.message.delta', data: { text: event.delta, itemId: event.item_id, contentIndex: event.content_index } };
            if (event.type === 'agent.session.turn.output_text.done' && !this.finalItems.has(event.item_id)) yield { type: 'agent.message.completed', data: { text: event.text, itemId: event.item_id, contentIndex: event.content_index } };
            if (event.type === 'agent.session.turn.reasoning_summary_text.delta') yield { type: 'reasoning.delta', data: { text: event.delta } };
            if (event.type === 'agent.session.requires_action') yield* this.handleActions(await this.client.beta.agents.sessions.retrieve(this.nativeId));
            if (event.type === 'agent.session.failed' || event.type === 'agent.session.environment.failed' || event.type === 'error') throw new Error(`Managed lifecycle error: ${event.type}; retrieve original state`);
          }
        } catch (error) { if (this.detached) return; if (reconnect === this.maxReconnects) throw error; }
        if (!this.nativeId) { await this.reconcileOwnership(); if (!this.nativeId) throw new Error('Native creation acceptance is unknown; do not resend input'); }
      }
      throw new Error('Managed observation ended before a verified root-turn terminal state');
    } finally { this.stream?.controller.abort(); }
  }
  private async *handleActions(session: AgentSession): AsyncGenerator<DriverEvent> {
    this.assertOwner(session);
    for (const action of session.required_actions) {
      if (action.type !== 'function_call') { yield { type: 'diagnostic', data: { code: 'NATIVE_WAITING', reason: action.type } }; continue; }
      if (this.turnId && action.turn_id !== this.turnId) throw new Error('Required action belongs to another turn');
      this.turnId = action.turn_id; await this.save();
      yield { type: 'tool.started', data: { name: action.name, callId: action.call_id } };
      const report = await this.request.hostTools!.execute(action.name, action.arguments, action.call_id);
      const current = await this.client.beta.agents.sessions.retrieve(this.nativeId!); this.assertOwner(current);
      if (!current.required_actions.some(a => a.type === 'function_call' && a.call_id === action.call_id && a.turn_id === action.turn_id)) continue;
      await this.send([{ type: 'agent.session.input.tool_result', call_id: action.call_id, turn_id: action.turn_id, success: report.outcome.status === 'succeeded', ...(report.outcome.status === 'succeeded' ? { output: report.modelText } : { error: report.modelText }) }], `tool-${action.turn_id}-${action.call_id}`);
      yield { type: 'tool.completed', data: { name: action.name, callId: action.call_id, status: report.outcome.status } };
    }
  }
  private async *restoreItems(): AsyncGenerator<DriverEvent> {
    let count = 0;
    for await (const item of this.client.beta.agents.sessions.turns.items.list(this.turnId!, { session_id: this.nativeId!, order: 'asc' })) {
      if (++count > 10000) throw new Error('Saved-item reconciliation bound exceeded');
      if (item.type === 'message' && item.role === 'assistant' && item.status === 'completed' && item.id && !this.finalItems.has(item.id)) {
        this.finalItems.add(item.id);
        for (const part of item.content) if (part.type === 'output_text') yield { type: 'agent.message.completed', data: { text: part.text, itemId: item.id, phase: item.phase, recovered: true } };
      }
      if (this.finalItems.size > 10000) throw new Error('Saved-item reconciliation bound exceeded');
    }
  }
  private async finish(turn: Turn): Promise<boolean> {
    if (turn.subagent_id !== null || turn.id !== this.turnId || !['completed','failed','cancelled'].includes(turn.status)) return false;
    let outputText = ''; let count = 0; let outputTruncated = false;
    const outputLimit = this.request.policy.limits?.outputBytes ?? 1024 * 1024;
    for await (const item of this.client.beta.agents.sessions.turns.items.list(turn.id, { session_id: this.nativeId!, order: 'asc' })) {
      if (++count > 10000) throw new Error('Turn output reconciliation bound exceeded');
      if (item.type === 'message' && item.role === 'assistant' && item.phase === 'final_answer') {
        const text = item.content.filter(p => p.type === 'output_text').map(p => p.text).join('');
        const remaining = Math.max(0, outputLimit - Buffer.byteLength(outputText));
        if (Buffer.byteLength(text) > remaining) { outputText += new TextDecoder().decode(Buffer.from(text).subarray(0, remaining), { stream: true }); outputTruncated = true; break; }
        outputText += text;
      }
    }
    const result: DriverRunResult = { status: turn.status as 'completed' | 'failed' | 'cancelled', outputText, finishReason: turn.status, ...(turn.error ? { error: { code: 'OPENAI_MANAGED_TURN', message: turn.error.message } } : {}), ...(turn.usage ? { usage: usage(turn.usage) } : {}) };
    if (outputTruncated) { result.status = 'incomplete'; result.finishReason = 'runtime_output_limit'; result.native = { outputCoverage: 'bounded-partial' }; }
    if (this.request.spec.environment?.type === 'provider-managed') {
      result.artifacts = [];
      try {
        let inventoryCount = 0;
        for await (const artifact of this.client.beta.agents.sessions.artifacts.list(this.nativeId!, { order: 'asc' })) {
          if (++inventoryCount > 1000) throw new Error('Native artifact inventory bound exceeded');
          if (artifact.session_id !== this.nativeId) throw new Error('Foreign native artifact');
          if (artifact.turn_id !== turn.id) continue;
          result.artifacts.push({ type: 'reference', name: artifact.path.split('/').at(-1) || artifact.id, reference: `openai-artifact:${this.nativeId}:${artifact.id}` });
        }
      } catch (error) { result.status = 'incomplete'; result.finishReason = 'artifact_inventory_incomplete'; result.error = { code: 'AGENT_ARTIFACT_INVENTORY', message: errorMessage(error) }; }
    }
    if (this.format?.type === 'json_schema' && result.status === 'completed') {
      try { result.outputParsed = parseAndValidateStructuredOutput(outputText, this.format); }
      catch (error) { result.status = 'failed'; result.error = { code: 'AGENT_STRUCTURED_OUTPUT', message: errorMessage(error) }; }
    }
    this.inputState = 'terminal'; this.lastResult = result; await this.save(); this.active?.resolve(result); return true;
  }
  private async findTurn(baseline: Set<string>): Promise<void> {
    if (this.turnId || !this.nativeId) return;
    let count = 0;
    for await (const turn of this.client.beta.agents.sessions.turns.list(this.nativeId, { order: 'desc' })) {
      if (++count > 1024) throw new Error('Turn reconciliation bound exceeded');
      if (turn.subagent_id === null && !baseline.has(turn.id)) { this.turnId = turn.id; await this.save(); return; }
    }
  }
  async reconcileOwnership(): Promise<void> {
    if (!this.nativeId && this.inputState !== 'not_sent') {
      let count = 0; const matches: AgentSession[] = [];
      for await (const session of this.client.beta.agents.sessions.list()) {
        if (++count > 1024) throw new Error('Owned-session reconciliation bound exceeded');
        if (session.metadata.onering_session === this.request.sessionId && session.metadata.onering_scope === runtimeScope(this.request.context)) matches.push(session);
      }
      if (matches.length !== 1) throw new Error('Native session creation cannot be uniquely reconciled; keep the original reference');
      this.nativeId = matches[0]!.id; this.assertOwner(matches[0]!); await this.save();
    }
    if (this.nativeId) this.assertOwner(await this.client.beta.agents.sessions.retrieve(this.nativeId));
  }
  async uploadFile(file: { name: string; data: Uint8Array; mediaType: string }) {
    if (this.active || this.detached || this.destroyed) throw new AgentDriverConfigurationError('Transfer requires an attached idle session');
    await this.reconcileOwnership();
    if (!this.nativeId) throw new AgentDriverConfigurationError('OpenAI hosted files require a provisioned environment; complete the first turn before upload');
    const session = await this.client.beta.agents.sessions.retrieve(this.nativeId); this.assertOwner(session);
    if (session.environment.type !== 'openai_hosted') throw new AgentDriverConfigurationError('File upload requires an OpenAI hosted environment');
    if (this.uploadIntent) throw new AgentDriverConfigurationError('A prior inline upload has unknown acceptance; preserve its reference for owned environment cleanup');
    const target = `/workspace/${portableFilename(file.name)}`;
    this.uploadIntent = { path: target, bytes: file.data.byteLength }; await this.save();
    const result = await this.client.beta.agents.environments.files.create(session.environment.id, { type: 'inline', path: target, data: Buffer.from(file.data).toString('base64') });
    if (result.environment_id !== session.environment.id || result.path !== target || result.size_bytes !== file.data.byteLength) throw new AgentDriverConfigurationError('Native environment-file acknowledgement differs from the explicit upload');
    const accepted = this.uploadIntent; this.uploadIntent = undefined;
    try { await this.save(); } catch (error) { this.uploadIntent = accepted; throw error; }
    return { type: 'reference' as const, name: file.name, mediaType: file.mediaType, reference: `openai-environment-file:${this.nativeId}:${file.name}` };
  }
  async downloadArtifact(reference: string, limits: { maxBytes: number; mediaTypes: readonly string[] }): Promise<Response> {
    await this.reconcileOwnership();
    const prefix = `openai-artifact:${this.nativeId}:`;
    if (!this.nativeId || !reference.startsWith(prefix) || !/^[a-zA-Z0-9_-]{1,256}$/.test(reference.slice(prefix.length))) throw new AgentDriverConfigurationError('Foreign or invalid artifact reference');
    const id = reference.slice(prefix.length);
    const metadata = await this.client.beta.agents.sessions.artifacts.retrieve(id, { session_id: this.nativeId });
    if (metadata.id !== id || metadata.session_id !== this.nativeId) throw new AgentDriverConfigurationError('Foreign native artifact metadata');
    checkFileMetadata(metadata.size_bytes, limits.mediaTypes[0] ?? '', limits);
    return artifactResponse(await this.client.beta.agents.sessions.artifacts.content(id, { session_id: this.nativeId }), metadata.size_bytes);
  }
  async inspectState(): Promise<RuntimeSessionSnapshot> {
    if (this.uploadIntent) return { connection: this.detached ? 'reconnecting' : 'attached', activity: 'unknown', waitReason: 'inline-upload-acceptance', unresolvedEffects: true };
    if (!this.nativeId) return { connection: this.detached ? 'reconnecting' : 'attached', activity: this.inputState === 'not_sent' ? 'ready' : 'unknown', activeRunId: this.request.control?.data.activeRunId as string | undefined, unresolvedEffects: this.inputState !== 'not_sent' };
    const session = await this.client.beta.agents.sessions.retrieve(this.nativeId); this.assertOwner(session);
    return { connection: this.detached ? 'reconnecting' : 'attached', activity: this.request.control?.data.activeRunId ? session.status === 'requires_action' ? 'waiting' : session.status === 'idle' ? 'unknown' : 'running' : 'ready', activeRunId: this.request.control?.data.activeRunId as string | undefined, ...(session.status === 'requires_action' ? { waitReason: 'native-required-action' } : {}), unresolvedEffects: false };
  }
  async cancelActiveRun(): Promise<void> {
    if (!this.nativeId || !this.active) return;
    this.assertOwner(await this.client.beta.agents.sessions.retrieve(this.nativeId));
    await this.send([{ type: 'agent.session.input.cancel' }], `cancel-${this.runId}`);
    if (this.turnId) await this.finish(await this.client.beta.agents.sessions.turns.retrieve(this.turnId, { session_id: this.nativeId }));
  }
  async detach(): Promise<void> { this.detached = true; this.stream?.controller.abort(); }
  async destroy(): Promise<void> { if (this.destroyed) return; this.destroyed = true; try { if (!this.detached) await this.cancelActiveRun(); } finally { this.stream?.controller.abort(); } }
  async deleteOwned(): Promise<void> {
    try { await this.reconcileOwnership(); } catch (error) { if (this.nativeId && (error as { status?: number }).status === 404) return; throw error; }
    if (!this.nativeId) { if (this.inputState !== 'not_sent') throw new Error('Unresolved native creation'); return; }
    const session = await this.client.beta.agents.sessions.retrieve(this.nativeId); this.assertOwner(session);
    if (session.status === 'in_progress' || session.status === 'requires_action') throw new Error('Cancel and confirm the active native turn before deletion');
    await this.client.beta.agents.sessions.delete(this.nativeId);
  }
  private metadata() { return { onering_session: this.request.sessionId!, onering_scope: runtimeScope(this.request.context), onering_definition: definitionDigest(this.request.spec.definition!) }; }
  private assertOwner(session: AgentSession): void {
    const expected = this.metadata();
    if (Object.entries(expected).some(([key, value]) => session.metadata[key] !== value)
      || session.agent.instructions !== this.request.spec.definition!.instructions || session.agent.multi_agent.enabled) throw new AgentDriverConfigurationError('Foreign or changed native session ownership/configuration');
    const environment = this.request.spec.environment?.type === 'provider-managed' ? 'openai_hosted' : 'none';
    if (session.environment.type !== environment) throw new AgentDriverConfigurationError('Native environment placement changed');
    if (session.environment.type === 'openai_hosted' && ((this.request.policy.sandboxNetwork === 'denied' && session.environment.network.access !== 'disabled') || session.environment.skills.length || session.environment.plugins.length || session.environment.capability_directories.length)) throw new AgentPolicyUnsupportedError('Native hosted environment expanded network/skill/plugin access');
    const selected = new Set(this.request.hostTools?.definitions.map(tool => tool.name) ?? this.request.spec.definition?.tools ?? []);
    for (const tool of session.agent.tools) {
      if (tool.type === 'function' && selected.delete(tool.name)) continue;
      if (tool.type === 'web_search' && this.request.policy.providerWebSearch === 'allowed') continue;
      throw new AgentDriverConfigurationError('Unapproved native tool addition');
    }
    if (selected.size) throw new AgentDriverConfigurationError('Native session is missing selected host tools');
  }
  private reasoning(input: DriverRunRequest) { const value = input.reasoning ?? this.request.spec.reasoning; return value?.effort ? { effort: value.effort as 'low' | 'medium' | 'high' | 'xhigh' | 'max' } : undefined; }
  private text(input: DriverRunRequest): string { return typeof input.input === 'string' ? input.input : input.input.parts.map(p => p.type === 'text' ? p.text : '').join('\n'); }
  private send(events: AgentSessionInputParam[], key: string) { return this.client.beta.agents.sessions.events.create(this.nativeId!, { events, 'Idempotency-Key': key }, { maxRetries: 0 }); }
}
function usage(value: TokenUsage) { return { inputTokens: value.input_tokens, outputTokens: value.output_tokens, cachedInputTokens: value.input_tokens_details.cached_tokens, reasoningTokens: value.output_tokens_details.reasoning_tokens, totalTokens: value.total_tokens, native: toJsonObject({ coverage: 'native-root-turn' }) }; }

