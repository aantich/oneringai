import { createInContextMemoryContributor, InContextMemoryPluginNextGen } from '@everworker/oneringai';
/**
 * AgentRunner - AMOS adapter for the current OneRingAI Agent API.
 */

import {
  Agent,
  createAgentPreset,
  type AgentPresetName,
  type AgentConfig,
  ContentType,
  FileEvidenceStorage,
  EvidencePluginNextGen,
  TaskStatePluginNextGen,
  type TaskStateSnapshot,
  type TaskStateHostDelta,
  StrategyRegistry,
  type ConversationCompactionReport,
  MessageRole,
  StreamEventType,
  getModelInfo,
  type ApprovalDecision,
  type InputItem,
  type ReasoningEffort,
  type StreamEvent as LibraryStreamEvent,
  type ThinkingConfig,
  type ToolFunction,
  type ToolExecutionOutcome,
  type EvidenceReference,
  type HelperRole,
  type ModelTaskSnapshot,
  type AgentLoopPolicy,
  type AgentLoopDiagnostics,
} from '@everworker/oneringai';
import type {
  AgentResponse,
  AstraAsyncToolResponse,
  AstraDirectResponse,
  AstraReasoningEffort,
  AmosConfig,
  CacheStatsInfo,
  ContextBreakdownInfo,
  ContextBudgetInfo,
  ContextMetrics,
  HistoryEntry,
  IAgentRunner,
  MemoryEntryInfo,
  SessionSummaryInfo,
  StreamEvent,
  TokenUsage,
  ToolApprovalContext,
} from '../config/types.js';
import { inspectContext } from './contextInspection.js';
import { buildPermissionsConfig } from './permissionUtils.js';
import { describeToolOutcome } from './toolOutcomes.js';
import { AmosSessionStorage } from './AmosSessionStorage.js';

export interface AmosModelRuntimeOptions {
  temperature?: number;
  thinking?: ThinkingConfig;
}

/** Resolve only parameters that the selected model actually accepts. */
export function resolveAmosModelRuntimeOptions(
  model: string,
  temperature: number,
  requestedEffort: ReasoningEffort,
): AmosModelRuntimeOptions {
  const info = getModelInfo(model);
  const isAstra = /^gpt-6-astra(?:-|$)/.test(model);
  const options: AmosModelRuntimeOptions = {};

  if (!isAstra && info?.features.parameters?.temperature !== false) {
    options.temperature = temperature;
  } else if (!isAstra && !info) {
    options.temperature = temperature;
  }

  const allowedEfforts = info?.features.reasoningEfforts ?? (isAstra
    ? ['low', 'medium', 'high', 'xhigh', 'max'] as ReasoningEffort[]
    : []);
  if (info?.features.reasoning || isAstra) {
    const effort = allowedEfforts.includes(requestedEffort)
      ? requestedEffort
      : allowedEfforts.includes('medium')
        ? 'medium'
        : allowedEfforts[0];
    if (effort) options.thinking = { enabled: true, effort };
  }

  return options;
}

export class AgentRunner implements IAgentRunner {
  private agent: Agent | null = null;
  private activePreset: AgentPresetName | null = null;
  private readonly config: AmosConfig;
  private tools: ToolFunction[];
  private readonly storage: AmosSessionStorage;
  private _isRunning = false;
  private _loopPolicyOverride?: AgentLoopPolicy | null;
  private _currentModel: string;
  private _currentTemperature: number;
  private _connectorName = '';
  private _instructions: string | null = null;
  private _onApprovalRequired: ((context: ToolApprovalContext) => Promise<ApprovalDecision>) | null = null;

  constructor(config: AmosConfig, tools: ToolFunction[], sessionDir = './data/sessions', private readonly onSessionChange?: (id: string | null) => void) {
    this.config = config;
    this.tools = tools;
    this._currentModel = config.activeModel || config.defaults.model;
    this._currentTemperature = config.defaults.temperature;
    this.storage = new AmosSessionStorage({
      agentId: 'amos',
      baseDirectory: sessionDir,
      prettyPrint: true,
    }, () => this.activePreset);
  }

  setInstructions(instructions: string | null): void {
    this._instructions = instructions;
  }

  getInstructions(): string | null {
    return this._instructions;
  }

  async initialize(connectorName: string, model: string): Promise<void> {
    this.assertReplaceable();
    // Build/load first so invalid next-agent settings cannot destroy a live session.
    const agentConfig = this.buildAgentConfig(connectorName, model);
    const sessionId = this.config.session.activeSessionId;
    if (this.config.contextStrategy && this.config.contextStrategy !== 'algorithmic' && !this.config.evidence?.enabled) throw new Error('Selected context strategy requires enabled evidence');
    if (this.config.contextStrategy === 'structured-summary' && !this.config.modelExecution?.helpers?.compactor) throw new Error('Selected summary strategy requires a compactor helper');
    const resumed = !!sessionId && await this.storage.exists(sessionId);
    const next = resumed ? await Agent.resume(sessionId!, { ...agentConfig, session: { ...agentConfig.session, storage: this.storage } }) : Agent.create(agentConfig);
    try {
      if (this.config.contextAssembly?.selectWhiteboard) {
        const memory = next.context.getPlugin('in_context_memory');
        if (!(memory instanceof InContextMemoryPluginNextGen)) throw new Error('Whiteboard selection requires the built-in in-context memory plugin');
        next.context.registerContextContributor(memory.name, createInContextMemoryContributor(memory));
      }
    } catch (error) { next.destroy(); throw error; }
    this.destroyAgentOnly();
    this.agent = next;
    this._connectorName = connectorName;
    this._currentModel = model;
    this.activePreset = this.config.preset ?? null;
    // Historical UniversalAgent session files use a different format/location.
    if (sessionId && !resumed) this.config.session.activeSessionId = null;
  }

  /** AMOS cannot transfer still-running or queued background tool deliveries. */
  assertReplaceable(): void {
    if (this.isRunning() || this.agent?.hasPendingAsyncTools()) throw new Error('Cannot replace an agent with active execution or pending asynchronous tools');
  }

  /** A fresh session still checkpoints unstored observations before releasing their raw copy. */
  hasUnstoredObservations(): boolean {
    const context = this.agent?.context;
    return !!context?.features.evidence && [...context.getConversation(), ...context.getCurrentInput()].some(item =>
      item.type === 'message' && item.content.some(content =>
        (content.type === ContentType.TOOL_RESULT || content.type === ContentType.CUSTOM_TOOL_RESULT)
        && content.evidence?.version === 1 && content.evidence.status === 'storage_failed'));
  }

  private buildAgentConfig(connectorName: string, model: string, preset = this.config.preset, settings = this.config): AgentConfig {
    const task = settings.taskState?.enabled ? settings.taskState : undefined;
    const evidence = settings.evidence?.enabled ? settings.evidence : undefined;
    if (task && evidence && task.ownerId !== evidence.ownerId) throw new Error('Task-state and evidence owners must match');
    const runtimeOptions = resolveAmosModelRuntimeOptions(
      model,
      this._currentTemperature,
      settings.defaults.reasoningEffort,
    );
    const config = {
      name: 'amos',
      connector: connectorName,
      model,
      ...(settings.maxIterations === undefined ? {} : { maxIterations: settings.maxIterations }),
      tools: this.tools,
      modelExecution: settings.modelExecution ?? undefined,
      ...(settings.loopPolicy === undefined ? {} : { loopPolicy: settings.loopPolicy }),
      ...runtimeOptions,
      ...(settings.evidence || settings.taskState || settings.contextStrategy || settings.contextAssembly ? {
        ...(evidence || task ? { userId: evidence?.ownerId ?? task!.ownerId } : {}),
        context: { model, agentId: 'amos', strategy: settings.contextStrategy, assembly: settings.contextAssembly,
          ...(settings.contextStrategy ? { compactionStrategy: this.createContextStrategy(settings.contextStrategy, settings) } : {}),
          features: { ...(settings.evidence ? { evidence: !!evidence } : {}), ...(settings.taskState ? { taskState: !!task } : {}) },
          plugins: {
            ...(evidence ? { evidence: {
              scope: { ownerId: evidence.ownerId, namespace: evidence.namespace },
              storage: new FileEvidenceStorage({ directory: evidence.directory,
                scope: { ownerId: evidence.ownerId, namespace: evidence.namespace } }), retentionMs: evidence.retentionMs,
            } } : {}),
            ...(task ? { taskState: { taskId: task.taskId, scope: { ownerId: task.ownerId, namespace: task.namespace },
              ...(task.association === undefined ? {} : { association: task.association }) } } : {}),
          },
        },
      } : {}),
      instructions: this.buildInstructions(),
      session: {
        storage: this.storage,
        autoSave: settings.session.autoSave,
        autoSaveIntervalMs: settings.session.autoSaveIntervalMs,
      },
      permissions: buildPermissionsConfig(
        this.config,
        this._onApprovalRequired ?? undefined,
      ),
    } satisfies AgentConfig;
    return preset == null ? config : createAgentPreset(preset, config);
  }

  validatePreset(preset: AgentPresetName | null, settings = this.config): void {
    if (this.isRunning()) throw new Error('Wait for the active execution before changing a preset.');
    this.buildAgentConfig(this._connectorName, this._currentModel, preset, settings);
  }

  inspectCapabilities() {
    const capabilities = this.requireAgent().inspectCapabilities();
    if (this._loopPolicyOverride !== undefined) {
      capabilities.loop.enabled = !!this._loopPolicyOverride;
      capabilities.loop.hostCompletionCheck = typeof this._loopPolicyOverride?.completion === 'function';
      if (capabilities.loop.hostCompletionCheck) capabilities.notices = capabilities.notices.filter(notice => !notice.startsWith('No host completion check'));
      else if (!capabilities.notices.some(notice => notice.startsWith('No host completion check'))) capabilities.notices.push('No host completion check is configured; model completion does not establish workflow completion.');
    }
    return { activePreset: this.activePreset, capabilities };
  }

  getTaskState(): TaskStateSnapshot | undefined {
    const plugin = this.agent?.context.getPlugin('task_state');
    return plugin instanceof TaskStatePluginNextGen ? plugin.getState() : undefined;
  }

  getLoopDiagnostics(): AgentLoopDiagnostics | undefined { return this.agent?.getLoopDiagnostics(); }

  setLoopPolicy(policy: AgentLoopPolicy | null): void {
    if (this.isRunning()) throw new Error('Cannot change a loop policy during execution');
    this._loopPolicyOverride = policy;
  }

  updateTaskState(delta: TaskStateHostDelta, expectedRevision: number): TaskStateSnapshot {
    if (this.isRunning()) throw new Error('Cannot edit task state during an execution');
    const plugin = this.agent?.context.getPlugin('task_state');
    if (!(plugin instanceof TaskStatePluginNextGen)) throw new Error('Task state is disabled; enable taskState in AMOS config and reload');
    return plugin.updateHost(delta, expectedRevision);
  }

  /**
   * UniversalAgent's structured planner was removed before 1.0. AMOS keeps its
   * planning toggle as model guidance: complex work is planned conversationally,
   * and approval is requested before state-changing execution when configured.
   */
  private buildInstructions(): string | undefined {
    const parts: string[] = [];
    if (this._instructions?.trim()) parts.push(this._instructions.trim());

    if (this.config.planning.enabled && this.config.planning.autoDetect) {
      parts.push([
        'For complex multi-step requests, first present a concise numbered plan.',
        this.config.planning.requireApproval
          ? 'Before executing state-changing steps or tools, ask the user to approve the plan and wait for their next message.'
          : 'After presenting the plan, proceed with its steps.',
        'Simple requests should be answered directly without unnecessary planning.',
      ].join(' '));
    }

    return parts.length > 0 ? parts.join('\n\n') : undefined;
  }

  /** Bounded inspection; listing is metadata-only and previews require an explicit ID. */
  async inspectEvidence(id?: string, offset = 0): Promise<string> {
    const plugin = this.agent?.context.getPlugin<EvidencePluginNextGen>('evidence');
    if (!plugin) return 'Evidence is disabled. Enable the evidence settings in AMOS config.json and reload the agent.';
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('Evidence offset must be a non-negative integer');
    if (!id) {
      const page = await plugin.storage.list({ limit: 20 });
      return `Evidence acknowledgement: ${plugin.storage.durability} (local, not replicated).\n`
        + page.entries.map(e => `${e.reference.id} ${e.toolName} ${e.status}/${e.completion} effect=${e.effect}`).join('\n')
        + (page.next ? '\nMore records exist; use evidence_list in the agent or the storage API for pagination.' : '')
        + '\nExplicit preview: /context evidence <id> [character-offset]';
    }
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('Invalid evidence ID');
    const preview = async (reference: EvidenceReference): Promise<string> => {
      const chunk = await plugin.storage.read(reference, { offset, limit: 1024 });
      return chunk ? `${chunk.text}\n${chunk.nextOffset === undefined ? '[End of evidence]' : `Next offset: ${chunk.nextOffset}`}` : 'Evidence missing or expired.';
    };
    if (plugin.storage.getReference) {
      const reference = await plugin.storage.getReference(id);
      return reference ? preview(reference) : 'Evidence missing or expired.';
    }
    let after: string | undefined;
    for (let pageIndex = 0; pageIndex < 10; pageIndex++) {
      const page = await plugin.storage.list({ after, limit: 100 });
      const entry = page.entries.find(e => e.reference.id === id);
      if (entry) return preview(entry.reference);
      if (!page.next) return 'Evidence missing or expired.';
      after = page.next;
    }
    throw new Error('Evidence lookup budget exhausted; configure backend ID lookup.');
  }

  isReady(): boolean {
    return this.agent !== null;
  }

  isRunning(): boolean {
    return this._isRunning || (this.agent?.isRunning() ?? false);
  }

  isPaused(): boolean {
    return this.agent?.isPaused() ?? false;
  }

  async run(input: string): Promise<AgentResponse> {
    if (this.isRunning()) throw new Error('An operation is already running');
    const agent = this.requireAgent();
    this._isRunning = true;
    const startedAt = Date.now();
    const toolOutcomes: ToolExecutionOutcome[] = [];
    const collect = (outcome: ToolExecutionOutcome): void => { toolOutcomes.push(outcome); };
    agent.tools.on('tool:outcome', collect);

    try {
      const response = await (this._loopPolicyOverride === undefined ? agent.run(input) : agent.run(input, { loopPolicy: this._loopPolicyOverride }));
      const usage: TokenUsage = {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        totalTokens: response.usage.total_tokens,
      };

      const result: AgentResponse = {
        text: response.output_text ?? '',
        mode: 'interactive',
        usage,
        duration: Date.now() - startedAt,
        toolOutcomes,
        ...(response.loop ? { loop: response.loop } : {}),
      };
      await this.autoSaveIfEnabled();
      return result;
    } finally {
      agent.tools.off('tool:outcome', collect);
      this._isRunning = false;
    }
  }

  async *stream(input: string): AsyncGenerator<StreamEvent> {
    if (this.isRunning()) throw new Error('An operation is already running');
    const agent = this.requireAgent();
    this._isRunning = true;

    try {
      const events = this._loopPolicyOverride === undefined ? agent.stream(input) : agent.stream(input, { loopPolicy: this._loopPolicyOverride });
      for await (const event of events) {
        const mapped = this.mapStreamEvent(event);
        if (mapped) yield mapped;
      }
      await this.autoSaveIfEnabled();
    } finally {
      this._isRunning = false;
    }
  }

  pause(): void {
    this.agent?.pause();
  }

  resume(): void {
    this.agent?.resume();
  }

  cancel(): void {
    this.agent?.cancel();
  }

  setModel(model: string): void {
    this._currentModel = model;
  }

  getModel(): string {
    return this._currentModel;
  }

  private createContextStrategy(strategy: NonNullable<AmosConfig['contextStrategy']>, settings = this.config) {
    return StrategyRegistry.create(strategy, strategy === 'structured-summary' ? {
      maxSummaryTokens: Math.max(1024, settings.modelExecution?.helpers?.compactor?.maxOutputTokens ?? 512),
    } : undefined);
  }

  getContextCompaction(): { strategy: string; last?: ConversationCompactionReport } {
    const context = this.requireAgent().context;
    return { strategy: context.compactionStrategy.name, last: context.lastPreparation?.compaction };
  }

  setContextStrategy(strategy: NonNullable<AmosConfig['contextStrategy']>): void {
    if (this.isRunning()) throw new Error('Cannot change strategy during an execution');
    const context = this.requireAgent().context;
    if (strategy !== 'algorithmic' && !(context.getPlugin('evidence') instanceof EvidencePluginNextGen)) throw new Error('Enable evidence in AMOS configuration and reload before selecting this strategy');
    if (strategy === 'structured-summary' && !this.config.modelExecution?.helpers?.compactor) throw new Error('Configure the compactor helper first');
    context.setCompactionStrategy(this.createContextStrategy(strategy));
    this.config.contextStrategy = strategy;
  }

  getModelUsage(): ModelTaskSnapshot | undefined { return this.agent?.getModelUsage(); }

  async invokeHelper(role: HelperRole, input: string): Promise<string> {
    if (this.isRunning()) throw new Error('An operation is already running');
    this._isRunning = true;
    try {
      const result = await this.requireAgent().invokeHelper<{ answer: string }>(role, input, {
        schema: { type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'], additionalProperties: false },
      });
      return result.value.answer;
    } finally { this._isRunning = false; }
  }

  async compactWithHelper(): Promise<string> {
    if (this.isRunning()) throw new Error('An operation is already running');
    if (!this.config.modelExecution?.helpers?.compactor) throw new Error('Configure a compactor helper first');
    this._isRunning = true;
    try {
      const result = await this.requireAgent().rolloverContext({ preserveRecentTurns: 2, reason: 'Explicit AMOS helper command' });
      return result.performed ? `Summarized ${result.itemsSummarized} older items; estimated tokens freed: ${result.tokensFreed}.`
        : 'No older turns need summarizing; no helper call was made.';
    } finally { this._isRunning = false; }
  }

  setTemperature(temp: number): void {
    this._currentTemperature = temp;
  }

  getTemperature(): number {
    return this._currentTemperature;
  }

  getReasoningEffort(): ReasoningEffort | null {
    return resolveAmosModelRuntimeOptions(
      this._currentModel,
      this._currentTemperature,
      this.config.defaults.reasoningEffort,
    ).thinking?.effort ?? null;
  }

  async runAstraDirect(
    input: string | InputItem[],
    options: { previousResponseId?: string; effort?: AstraReasoningEffort } = {},
  ): Promise<AstraDirectResponse> {
    this.assertAstraCapability('configurationUpdates');
    const response = await this.requireAgent().runDirect(input, {
      instructions: this.buildInstructions(),
      maxOutputTokens: this.config.defaults.maxOutputTokens,
      ...(options.previousResponseId ? { previousResponseId: options.previousResponseId } : {}),
      ...(options.effort ? { thinking: { enabled: true, effort: options.effort } } : {}),
    });
    return { responseId: response.id, text: response.output_text ?? '' };
  }

  async runAstraAsyncTool(toolName: string, prompt: string): Promise<AstraAsyncToolResponse> {
    this.assertAstraCapability('asyncToolCalling');
    const agent = this.requireAgent();
    const tool = agent.tools.get(toolName);
    if (!tool) throw new Error(`Tool '${toolName}' is not registered or enabled`);

    const asyncDefinition = { ...tool.definition, async: true as const };
    const effort = this.getReasoningEffort() as AstraReasoningEffort | null;
    const startedAt = Date.now();
    const first = await agent.runDirect(prompt, {
      instructions: this.buildInstructions(),
      tools: [asyncDefinition],
      toolChoice: { type: 'function', function: { name: toolName } },
      maxOutputTokens: this.config.defaults.maxOutputTokens,
      ...(effort ? { thinking: { enabled: true, effort } } : {}),
    });

    const call = first.output
      .filter((item) => item.type === 'message')
      .flatMap((item) => item.content)
      .find((content) => content.type === ContentType.TOOL_USE && content.name === toolName);
    if (!call || call.type !== ContentType.TOOL_USE) {
      throw new Error(`Astra did not return the required '${toolName}' call`);
    }
    if (call.async !== true) {
      throw new Error(`OpenAI returned '${toolName}' without the Astra async protocol marker`);
    }

    let args: Record<string, unknown>;
    try {
      const parsed = JSON.parse(call.arguments) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('arguments were not a JSON object');
      }
      args = parsed as Record<string, unknown>;
    } catch (error) {
      throw new Error(
        `Astra returned invalid arguments for '${toolName}': ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    await agent.beginExternalExecution({ source: 'amos:astra-async-tool' });
    let result: unknown;
    try {
      const toolResult = await agent.executeExternalToolCall({
        id: call.id,
        name: toolName,
        arguments: args,
      });
      result = toolResult.content;
      await agent.completeExternalExecution();
    } catch (error) {
      await agent.completeExternalExecution({
        error: error instanceof Error ? error : new Error(String(error)),
      });
      throw error;
    }
    const output = typeof result === 'string'
      ? result
      : JSON.stringify(result) ?? 'null';
    const final = await agent.runDirect([
      { type: 'function_call_output', call_id: call.id, output },
    ], {
      previousResponseId: first.id,
      instructions: this.buildInstructions(),
      tools: [asyncDefinition],
      maxOutputTokens: this.config.defaults.maxOutputTokens,
      ...(effort ? { thinking: { enabled: true, effort } } : {}),
    });

    return {
      responseId: final.id,
      text: final.output_text ?? '',
      initialText: first.output_text ?? '',
      callId: call.id,
      toolName,
      arguments: args,
      result,
      duration: Date.now() - startedAt,
    };
  }

  updateTools(tools: ToolFunction[]): void {
    if (this.agent) {
      const nextNames = new Set(tools.map((tool) => tool.definition.function.name));
      for (const oldTool of this.tools) {
        const name = oldTool.definition.function.name;
        if (!nextNames.has(name)) this.agent.tools.unregister(name);
      }
      for (const tool of tools) {
        const name = tool.definition.function.name;
        if (this.agent.tools.has(name)) this.agent.tools.unregister(name);
        this.agent.addTool(tool);
      }
    }
    this.tools = tools;
  }

  getMode(): 'interactive' | 'planning' | 'executing' {
    return 'interactive';
  }

  async saveSession(name?: string): Promise<string> {
    const agent = this.requireAgent();
    await agent.saveSession(undefined, { ...(name ? { title: name } : {}), agenticPreset: this.activePreset });
    const sessionId = agent.getSessionId();
    if (!sessionId) throw new Error('Session storage did not assign an ID');
    this.config.session.activeSessionId = sessionId;
    this.onSessionChange?.(sessionId);
    return sessionId;
  }

  async loadSession(sessionId: string): Promise<void> {
    const agent = this.requireAgent();
    const loaded = await agent.loadSession(sessionId);
    if (!loaded) throw new Error(`Session '${sessionId}' not found`);
    this.config.session.activeSessionId = sessionId;
    this.onSessionChange?.(sessionId);
  }

  async listSessions(): Promise<SessionSummaryInfo[]> {
    const sessions = await this.storage.list();
    return sessions.map((session) => ({
      id: session.sessionId,
      title: session.metadata?.title,
      createdAt: session.createdAt,
      lastSavedAt: session.lastSavedAt,
      messageCount: session.messageCount,
      memoryEntryCount: session.memoryEntryCount,
    }));
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.storage.delete(sessionId);
    if (this.config.session.activeSessionId === sessionId) {
      this.config.session.activeSessionId = null;
      this.onSessionChange?.(null);
    }
  }

  getSessionId(): string | null {
    return this.agent?.getSessionId() ?? null;
  }

  async getContextMetrics(): Promise<ContextMetrics | null> {
    const context = this.agent?.context;
    if (!context) return null;

    try {
      const memory = context.memory;
      const state = memory?.getState();
      return {
        historyMessageCount: context.getConversationLength(),
        memoryStats: {
          totalEntries: state?.entries.length ?? 0,
          totalSizeBytes: state?.entries.reduce((sum, entry) => sum + entry.sizeBytes, 0) ?? 0,
        },
        mode: 'interactive',
        hasPlan: false,
      };
    } catch {
      return null;
    }
  }

  async getConversationHistory(count?: number): Promise<HistoryEntry[]> {
    const context = this.agent?.context;
    if (!context) return [];

    try {
      const sessionId = this.getSessionId();
      if (sessionId && context.journal) {
        const journalEntries = await context.journal.read(sessionId, {
          types: ['user', 'assistant', 'system'],
        });
        const entries = journalEntries
          .map((entry) => this.mapHistoryItem(entry.item, entry.timestamp))
          .filter((entry): entry is HistoryEntry => entry !== null);
        return count ? entries.slice(-count) : entries;
      }

      const entries = context.getConversation()
        .map((item) => this.mapHistoryItem(item))
        .filter((entry): entry is HistoryEntry => entry !== null);
      return count ? entries.slice(-count) : entries;
    } catch {
      return [];
    }
  }

  async getContextBudget(): Promise<ContextBudgetInfo | null> {
    const context = this.agent?.context;
    if (!context) return null;

    try {
      return (await inspectContext(context)).budget;
    } catch {
      return null;
    }
  }

  async getContextBreakdown(): Promise<ContextBreakdownInfo | null> {
    const context = this.agent?.context;
    if (!context) return null;

    try {
      return (await inspectContext(context)).breakdown;
    } catch {
      return null;
    }
  }

  async getCacheStats(): Promise<CacheStatsInfo | null> {
    return null;
  }

  async getMemoryEntries(): Promise<MemoryEntryInfo[]> {
    const context = this.agent?.context;
    if (!context) return [];

    try {
      const state = context.memory?.getState();
      if (!state) return [];
      return state.entries.map((entry) => ({
        key: entry.key,
        description: entry.description,
        sizeBytes: entry.sizeBytes,
        scope: typeof entry.scope === 'string'
          ? entry.scope
          : entry.scope.type === 'task'
            ? `task (${entry.scope.taskIds?.length ?? 0} tasks)`
            : entry.scope.type,
        priority: entry.basePriority ?? 'normal',
      }));
    } catch {
      return [];
    }
  }

  setApprovalHandler(handler: ((context: ToolApprovalContext) => Promise<ApprovalDecision>) | null): void {
    this._onApprovalRequired = handler;
  }

  approveToolForSession(toolName: string): void {
    this.agent?.policyManager.approve(toolName, { scope: 'session' });
  }

  revokeToolApproval(toolName: string): void {
    this.agent?.policyManager.revoke(toolName);
  }

  allowlistTool(toolName: string): void {
    this.agent?.policyManager.allowlistAdd(toolName);
  }

  blocklistTool(toolName: string): void {
    this.agent?.policyManager.blocklistAdd(toolName);
  }

  removeFromAllowlist(toolName: string): void {
    this.agent?.policyManager.allowlistRemove(toolName);
  }

  removeFromBlocklist(toolName: string): void {
    this.agent?.policyManager.blocklistRemove(toolName);
  }

  getApprovedTools(): string[] {
    const approvals = this.agent?.policyManager.getState().approvals ?? {};
    return Object.keys(approvals);
  }

  getAllowlist(): string[] {
    return this.agent?.policyManager.getState().allowlist ?? this.config.permissions.allowlist;
  }

  getBlocklist(): string[] {
    return this.agent?.policyManager.getState().blocklist ?? this.config.permissions.blocklist;
  }

  toolNeedsApproval(toolName: string): boolean {
    const tool = this.tools.find((candidate) => candidate.definition.function.name === toolName);
    if (!tool || this.toolIsBlocked(toolName) || this.getAllowlist().includes(toolName)) return false;
    if (this.getApprovedTools().includes(toolName)) return false;
    return tool.permission?.scope === 'once' || tool.permission?.scope === 'session';
  }

  toolIsBlocked(toolName: string): boolean {
    return this.getBlocklist().includes(toolName)
      || this.tools.find((tool) => tool.definition.function.name === toolName)?.permission?.scope === 'never';
  }

  destroy(): void {
    this.destroyAgentOnly();
    this._isRunning = false;
  }

  private destroyAgentOnly(): void {
    this.agent?.destroy();
    this.agent = null;
  }

  private requireAgent(): Agent {
    if (!this.agent) throw new Error('Agent not initialized');
    return this.agent;
  }

  private assertAstraCapability(
    capability: 'asyncToolCalling' | 'configurationUpdates',
  ): void {
    const info = getModelInfo(this._currentModel);
    if (info?.features[capability] !== true) {
      throw new Error(
        `Model '${this._currentModel}' does not support ${capability}; switch with /astra use`,
      );
    }
  }

  private async autoSaveIfEnabled(): Promise<void> {
    if (this.config.session.autoSave) {
      await this.saveSession();
    }
  }

  private mapStreamEvent(event: LibraryStreamEvent): StreamEvent | null {
    switch (event.type) {
      case StreamEventType.OUTPUT_TEXT_DELTA:
        return { type: 'text:delta', delta: event.delta };
      case StreamEventType.OUTPUT_TEXT_DONE:
        return { type: 'text:done', text: event.text };
      case StreamEventType.TOOL_EXECUTION_START:
        return { type: 'tool:start', tool: { name: event.tool_name, args: event.arguments } };
      case StreamEventType.TOOL_EXECUTION_DONE:
        return event.outcome && event.outcome.status !== 'succeeded'
          ? { type: 'error', error: new Error(describeToolOutcome(event.outcome) ?? event.error) }
          : event.error
            ? { type: 'error', error: new Error(`${event.tool_name}: ${event.error}`) }
            : { type: 'tool:complete', tool: { name: event.tool_name, result: event.result }, notice: event.outcome ? describeToolOutcome(event.outcome) ?? undefined : undefined };
      case StreamEventType.RESPONSE_COMPLETE:
        return {
          type: 'done',
          ...(event.loop ? { loop: event.loop } : {}),
          usage: {
            inputTokens: event.usage.input_tokens,
            outputTokens: event.usage.output_tokens,
            totalTokens: event.usage.total_tokens,
          },
        };
      case StreamEventType.ITERATION_COMPLETE:
        // Reuse the app's existing non-text notification surface; no public
        // stream/event discriminant is added for policy progress.
        return event.loop ? { type: 'tool:complete', loop: event.loop } : null;
      case StreamEventType.ERROR:
        // Agent.stream throws after emitting its terminal provider error. Let the
        // app's catch path render it once instead of showing duplicate errors.
        return null;
      default:
        return null;
    }
  }

  private mapHistoryItem(item: InputItem, timestamp = Date.now()): HistoryEntry | null {
    if (item.type !== 'message') return null;

    const role = item.role === MessageRole.USER
      ? 'user'
      : item.role === MessageRole.ASSISTANT
        ? 'assistant'
        : 'system';
    const content = item.content.map((part) => {
      switch (part.type) {
        case ContentType.INPUT_TEXT:
        case ContentType.OUTPUT_TEXT:
          return part.text;
        case ContentType.TOOL_USE:
          return `[tool call: ${part.name}]`;
        case ContentType.TOOL_RESULT:
          return `[tool result] ${typeof part.content === 'string' ? part.content : JSON.stringify(part.content)}`;
        case ContentType.INPUT_IMAGE_URL:
          return '[image]';
        case ContentType.INPUT_FILE:
          return `[file: ${part.file_id}]`;
        case ContentType.THINKING:
          return '[reasoning]';
      }
    }).filter(Boolean).join('\n');

    return {
      id: item.id ?? `msg-${timestamp}-${role}`,
      role,
      content,
      timestamp: new Date(timestamp),
    };
  }

}
