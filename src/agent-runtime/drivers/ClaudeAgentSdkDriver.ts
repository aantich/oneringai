import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { Options, Query, SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { Vendor } from '../../core/Vendor.js';
import { getModelInfo } from '../../domain/entities/Model.js';
import type { AgentDriver, DriverSession, DriverOpenSessionRequest, DriverRunRequest, DriverRun, DriverEvent, DriverRunResult } from '../AgentDriver.js';
import { AgentDriverConfigurationError, AgentPolicyUnsupportedError, AgentRuntimeDependencyError } from '../errors.js';
import { type NativeCheckpointVerifier, createNativeStateDirectory, verifyNativeStateDirectory, deleteNativeStateDirectory } from '../NativeStateDirectory.js';
import { createDeferred, toJsonObject, errorMessage } from '../internal.js';
import { parseAndValidateStructuredOutput } from '../StructuredOutputValidator.js';
import { createRedactor, redactJson, StreamingSecretRedactor } from '../SecretRedactor.js';
import type { JsonObject, RuntimeReasoningConfig } from '../types.js';

type ClaudeSdk = Pick<typeof import('@anthropic-ai/claude-agent-sdk'), 'query' | 'createSdkMcpServer'>;
export interface ClaudeAgentSdkDriverOptions {
  /** Required before restoring idle native history after observer/process restart. */
  verifyNativeCheckpoint?: NativeCheckpointVerifier;
  loadSdk?: () => Promise<ClaudeSdk>;
  /** Explicit endpoint/model reasoning controls; unsupported/unknown efforts fail closed. */
  modelEfforts?: Readonly<Record<string, readonly ('low' | 'medium' | 'high' | 'xhigh' | 'max')[]>>;
}
const DEFAULT_EFFORTS = { 'claude-sonnet-4-6': ['low','medium','high'], 'claude-opus-4-6': ['low','medium','high','max'], 'claude-opus-5-5': ['low','medium','high','xhigh','max'], 'claude-sonnet-5-5': ['low','medium','high','xhigh','max'] } as const;

/** Local, tools-only profile. No native shell, file, web, delegation or ambient plugins. */
export class ClaudeAgentSdkDriver implements AgentDriver {
  readonly id = 'anthropic.agent.sdk';
  constructor(private readonly options: ClaudeAgentSdkDriverOptions = {}) {}
  async inspect(request: Parameters<AgentDriver['inspect']>[0]) {
    const { spec, policy } = request;
    if (!spec.definition || !spec.connector || !spec.model) throw new AgentDriverConfigurationError('Claude Agent SDK requires a logical definition, connector and model');
    if (Object.keys(spec.driverConfig ?? {}).length) throw new AgentDriverConfigurationError('Unknown Claude Agent SDK driverConfig fields');
    const connector = request.connectorRegistry.get(spec.connector);
    if (connector.vendor !== Vendor.Anthropic || !['api_key', 'api_key_provider'].includes(connector.config.auth.type)) throw new AgentDriverConfigurationError('Claude Agent SDK requires an Anthropic API-key connector');
    const model = getModelInfo(spec.model);
    if (!model?.isActive || model.provider !== Vendor.Anthropic) throw new AgentDriverConfigurationError(`Unsupported Claude model '${spec.model}'`);
    this.validateReasoning(spec.model, spec.reasoning);
    if (policy && (policy.filesystem !== 'denied' || policy.commands !== 'denied' || policy.providerWebSearch !== 'denied' || policy.approvals !== 'deny')) throw new AgentPolicyUnsupportedError('Claude Agent SDK initially supports only host tools with native filesystem, commands, web and approvals denied');
    await this.loadSdk();
    const ids = [...(this.options.verifyNativeCheckpoint && request.durability ? ['session.restore'] : []), 'agent.definition','tools.host','session.continue','run.cancel','run.structured_output','run.model_override','run.reasoning_override','event.live','event.message','event.reasoning','event.tool','event.tool_progress'];
    return { inspection: { toolNamePrefix: 'mcp__onering_host__', enforcement: { nativeFilesystem: 'native' as const, nativeCommands: 'native' as const, sandboxNetwork: 'native' as const, providerWebSearch: 'native' as const }, notes: ['Account entitlement is checked only by native requests.'] }, capabilities: { driverId: this.id, configuration: { model: spec.model, ...(spec.reasoning ? { reasoning: spec.reasoning } : {}) }, capabilities: Object.fromEntries(ids.map(id => [id, { id, support: 'native' as const, ...(id === 'agent.definition' ? { constraints: { nativeTools: [], profile: 'host-tools-only' } } : {}) }])) } };
  }
  async openSession(request: DriverOpenSessionRequest): Promise<DriverSession> { return this.openNative(request); }
  async restoreSession(request: DriverOpenSessionRequest & { checkpoint: JsonObject }): Promise<{ session: DriverSession }> {
    if (request.checkpoint.kind !== 'claude-sdk-v1') throw new AgentDriverConfigurationError('Incomplete Claude SDK checkpoint');
    if (typeof request.checkpoint.nativeSessionId === 'string') {
      if (!this.options.verifyNativeCheckpoint) throw new AgentDriverConfigurationError('Restoring native Claude history requires a host verifyNativeCheckpoint assertion; preserve the original reference');
      const directory = await verifyNativeStateDirectory(request.checkpoint.home, 'oneringai-claude-', request.sessionId);
      await this.options.verifyNativeCheckpoint({ directory, nativeSessionId: request.checkpoint.nativeSessionId }, request);
    }
    return { session: await this.openNative(request, request.checkpoint) };
  }
  async deleteSession(request: DriverOpenSessionRequest & { checkpoint: JsonObject }): Promise<void> {
    if (request.checkpoint.kind !== 'claude-sdk-v1') throw new AgentDriverConfigurationError('Invalid Claude SDK checkpoint');
    await deleteNativeStateDirectory(request.checkpoint.home, 'oneringai-claude-', request.sessionId);
  }
  private async openNative(request: DriverOpenSessionRequest, checkpoint?: JsonObject): Promise<DriverSession> {
    await this.inspect(request);
    const sdk = await this.loadSdk();
    const connector = request.connectorRegistry.get(request.spec.connector!);
    const key = await connector.getToken();
    const home = checkpoint ? await verifyNativeStateDirectory(checkpoint.home, 'oneringai-claude-', request.sessionId) : await createNativeStateDirectory('oneringai-claude-', request.sessionId);
    try { return new ClaudeSdkSession(request, sdk, home, key, connector.baseURL, (model, reasoning) => this.validateReasoning(model, reasoning), typeof checkpoint?.nativeSessionId === 'string' ? checkpoint.nativeSessionId : undefined); }
    catch (error) { if (!checkpoint) await rm(home, { recursive: true, force: true }); throw error; }
  }
  private async loadSdk(): Promise<ClaudeSdk> {
    try {
      const sdk = this.options.loadSdk ? await this.options.loadSdk() : await import('@anthropic-ai/claude-agent-sdk');
      if (typeof sdk.query !== 'function' || typeof sdk.createSdkMcpServer !== 'function') throw new Error('Unsupported Claude SDK interface');
      return sdk;
    }
    catch (error) { throw new AgentRuntimeDependencyError('@anthropic-ai/claude-agent-sdk', errorMessage(error)); }
  }
  private validateReasoning(model: string, config?: RuntimeReasoningConfig): void {
    if (!config) return;
    if (config.budgetTokens !== undefined) throw new AgentDriverConfigurationError('Claude SDK fixed thinking budgets are not exposed by this profile');
    const efforts: readonly string[] = this.options.modelEfforts?.[model] ?? DEFAULT_EFFORTS[model as keyof typeof DEFAULT_EFFORTS] ?? [];
    if (config.effort && !efforts.includes(config.effort)) throw new AgentDriverConfigurationError(`Unverified Claude SDK effort '${config.effort}' for '${model}'`);
    if (config.enabled === false && config.effort) throw new AgentDriverConfigurationError('Disabled thinking cannot also select an effort');
  }
}

class ClaudeSdkSession implements DriverSession {
  private readonly redact: (text: string) => string;
  private destroyed = false;
  private sessionId?: string;
  private active?: Query;
  private readonly mcp: ReturnType<ClaudeSdk['createSdkMcpServer']>;
  constructor(private readonly request: DriverOpenSessionRequest, private readonly sdk: ClaudeSdk, private readonly home: string, private readonly key: string, private readonly baseURL: string | undefined, private readonly validateReasoning: (model: string, reasoning?: RuntimeReasoningConfig) => void, nativeSessionId?: string) {
    this.redact = createRedactor([key]);
    this.sessionId = nativeSessionId;
    // Register raw schemas on the SDK's real in-process MCP instance, avoiding lossy JSON->Zod conversion.
    this.mcp = sdk.createSdkMcpServer({ name: 'onering_host', version: '1', tools: [], alwaysLoad: true });
    this.mcp.instance.server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: (request.hostTools?.definitions ?? []).map(t => ({ name: t.name, description: t.description, inputSchema: t.parameters as { type: 'object' }, _meta: { 'anthropic/alwaysLoad': true } })) }));
    this.mcp.instance.server.setRequestHandler(CallToolRequestSchema, async call => {
      try {
        const report = await request.hostTools!.execute(call.params.name, call.params.arguments ?? {}, randomUUID());
        return { content: [{ type: 'text', text: report.modelText }], isError: report.outcome.status !== 'succeeded' };
      } catch (error) { return { content: [{ type: 'text', text: this.redact(errorMessage(error)) }], isError: true }; }
    });
  }
  get nativeSessionId() { return this.sessionId; }
  get isDestroyed() { return this.destroyed; }
  async run(request: DriverRunRequest): Promise<DriverRun> {
    if (this.destroyed || this.active) throw new AgentDriverConfigurationError('Claude SDK session is unavailable/busy');
    if (typeof request.input !== 'string' && request.input.parts.some(p => p.type !== 'text')) throw new AgentDriverConfigurationError('Claude SDK profile supports text input only');
    const model = request.model ?? this.request.spec.model!;
    const info = getModelInfo(model);
    if (!info?.isActive || info.provider !== Vendor.Anthropic) throw new AgentDriverConfigurationError('Claude SDK model override must be an active Anthropic model');
    const reasoning = request.reasoning ?? this.request.spec.reasoning;
    this.validateReasoning(model, reasoning);
    const controller = new AbortController();
    const abort = () => controller.abort(request.signal.reason);
    request.signal.addEventListener('abort', abort, { once: true });
    if (request.signal.aborted) abort();
    const options: Options = {
      model, cwd: this.request.workspace?.root ?? this.home,
      systemPrompt: this.request.spec.definition!.instructions,
      env: { PATH: process.env.PATH, HOME: this.home, TMPDIR: tmpdir(), CLAUDE_CONFIG_DIR: this.home, ANTHROPIC_API_KEY: this.key, ...(this.baseURL ? { ANTHROPIC_BASE_URL: this.baseURL } : {}) },
      settingSources: [], plugins: [], agents: {}, tools: [], settings: { autoMemoryEnabled: false },
      disallowedTools: ['Agent','Task','Skill','ToolSearch','WebSearch','WebFetch','Bash','Read','Write','Edit','Glob','Grep','NotebookEdit','AskUserQuestion','TodoWrite'],
      strictMcpConfig: true, mcpServers: this.request.hostTools ? { onering_host: this.mcp } : {},
      allowedTools: (this.request.hostTools?.definitions ?? []).map(t => `mcp__onering_host__${t.name}`),
      canUseTool: async () => ({ behavior: 'deny', message: 'Unselected native tool denied by OneRingAI' }),
      permissionMode: 'default', permissionPrompts: 'none',
      includePartialMessages: true, abortController: controller,
      ...(this.sessionId ? { resume: this.sessionId } : {}),
      ...(reasoning?.enabled === false ? { thinking: { type: 'disabled' as const } } : {}),
      ...(reasoning?.effort ? { effort: reasoning.effort as Options['effort'] } : {}),
      ...(request.responseFormat?.type === 'json_schema' ? { outputFormat: { type: 'json_schema' as const, schema: request.responseFormat.schema } } : {}),
    };
    let query: Query;
    try { query = this.sdk.query({ prompt: typeof request.input === 'string' ? request.input : request.input.parts.map(p => p.type === 'text' ? p.text : '').join('\n'), options }); } catch (error) { request.signal.removeEventListener('abort', abort); throw error; }
    this.active = query;
    const deferred = createDeferred<DriverRunResult>();
    const self = this;
    const events = (async function* (): AsyncGenerator<DriverEvent> {
      let terminal: SDKResultMessage | undefined;
      const deltas = new Map<string, { type: 'agent.message.delta' | 'reasoning.delta'; redactor: StreamingSecretRedactor }>();
      function* flush(index?: number): Generator<DriverEvent> {
        for (const [id, state] of deltas) if (index === undefined || id.endsWith(`:${index}`)) {
          const text = state.redactor.finish();
          if (text) yield { type: state.type, data: { text } };
          deltas.delete(id);
        }
      }
      try {
        try { for await (const message of query) {
          if ('session_id' in message && message.session_id) self.sessionId = message.session_id;
          if (message.type === 'stream_event') {
            if (message.event.type === 'message_start' || message.event.type === 'message_stop') yield* flush();
            if (message.event.type === 'content_block_stop') yield* flush(message.event.index);
            if (message.event.type === 'content_block_delta') {
              const delta = message.event.delta;
              if (delta.type === 'text_delta' || delta.type === 'thinking_delta') {
                const id = `${delta.type}:${message.event.index}`;
                const state = deltas.get(id) ?? { type: delta.type === 'text_delta' ? 'agent.message.delta' as const : 'reasoning.delta' as const, redactor: new StreamingSecretRedactor([self.key]) };
                deltas.set(id, state);
                const text = state.redactor.push(delta.type === 'text_delta' ? delta.text : delta.thinking);
                if (text) yield { type: state.type, data: { text } };
              }
            }
          } else if (message.type === 'assistant') {
            yield* flush();
            for (const part of message.message.content) {
              if (part.type === 'text') yield { type: 'agent.message.completed', data: { text: self.redact(part.text) } };
              if (part.type === 'tool_use') yield { type: 'tool.started', data: { callId: part.id, name: part.name } };
            }
          } else if (message.type === 'tool_progress') yield { type: 'tool.progress', data: { callId: message.tool_use_id, name: message.tool_name, elapsedSeconds: message.elapsed_time_seconds } };
          else if (message.type === 'result') terminal = message;
        } } catch (error) { if (!terminal) throw error; yield { type: 'diagnostic', data: { code: 'CLAUDE_SDK_STREAM_TAIL', message: self.redact(errorMessage(error)) } }; }
        yield* flush();
        if (!terminal) throw new Error('Claude SDK ended without a terminal result');
        const outputText = terminal.subtype === 'success' ? self.redact(terminal.result) : '';
        const usage = terminal.usage;
        const result: DriverRunResult = {
          status: controller.signal.aborted ? 'cancelled' : terminal.subtype === 'success' && !terminal.is_error ? 'completed' : terminal.subtype === 'error_max_turns' || terminal.subtype === 'error_max_budget_usd' ? 'incomplete' : 'failed',
          outputText, finishReason: terminal.subtype,
          configuration: { model, ...(reasoning ? { reasoning } : {}) },
          usage: { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens, reasoningTokens: usage.output_tokens_details?.thinking_tokens, cachedInputTokens: usage.cache_read_input_tokens, cacheWriteInputTokens: usage.cache_creation_input_tokens, native: toJsonObject({ modelUsage: terminal.modelUsage, estimatedCostUsd: terminal.total_cost_usd, coverage: 'sdk-reported-query-pipeline' }) },
          ...(terminal.subtype !== 'success' ? { error: { code: 'CLAUDE_SDK_RESULT', message: self.redact(terminal.errors.join('; ')) } } : {}),
        };
        if (request.responseFormat?.type === 'json_schema' && terminal.subtype === 'success') {
          try { result.outputParsed = parseAndValidateStructuredOutput(terminal.structured_output !== undefined ? JSON.stringify(terminal.structured_output) : terminal.result, request.responseFormat, value => redactJson(value, self.redact)); }
          catch (error) { result.status = 'failed'; result.error = { code: 'AGENT_STRUCTURED_OUTPUT', message: self.redact(errorMessage(error)) }; }
        }
        yield { type: 'usage.updated', data: toJsonObject(result.usage) };
        deferred.resolve(result);
      } catch (error) {
        // A broken native stream is not proof of terminal completion. The backend quarantines it.
        throw new Error(self.redact(errorMessage(error)));
      } finally { request.signal.removeEventListener('abort', abort); self.active = undefined; query.close(); }
    })();
    return { events, result: deferred.promise, cancel: async () => { controller.abort('Cancelled'); await query.interrupt(); } };
  }
  async cancelActiveRun(): Promise<void> { await this.active?.interrupt(); }
  async checkpoint(): Promise<JsonObject> { return { kind: 'claude-sdk-v1', home: this.home, ...(this.sessionId ? { nativeSessionId: this.sessionId } : {}) }; }
  async detach(): Promise<void> {
    if (!this.request.control || this.active) throw new AgentDriverConfigurationError('Claude SDK detach requires durable control storage and an idle native session');
    this.destroyed = true;
    await this.mcp.instance.close();
  }
  async destroy(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;
    try { await this.active?.interrupt(); }
    finally { try { this.active?.close(); await this.mcp.instance.close(); } finally { await rm(this.home, { recursive: true, force: true }); } }
  }
}
