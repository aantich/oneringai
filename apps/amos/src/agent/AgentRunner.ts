/**
 * AgentRunner - AMOS adapter for the current OneRingAI Agent API.
 */

import {
  Agent,
  ContentType,
  FileContextStorage,
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
  private readonly config: AmosConfig;
  private tools: ToolFunction[];
  private readonly storage: FileContextStorage;
  private _isRunning = false;
  private _currentModel: string;
  private _currentTemperature: number;
  private _connectorName = '';
  private _instructions: string | null = null;
  private _onApprovalRequired: ((context: ToolApprovalContext) => Promise<ApprovalDecision>) | null = null;

  constructor(config: AmosConfig, tools: ToolFunction[], sessionDir = './data/sessions') {
    this.config = config;
    this.tools = tools;
    this._currentModel = config.activeModel || config.defaults.model;
    this._currentTemperature = config.defaults.temperature;
    this.storage = new FileContextStorage({
      agentId: 'amos',
      baseDirectory: sessionDir,
      prettyPrint: true,
    });
  }

  setInstructions(instructions: string | null): void {
    this._instructions = instructions;
  }

  getInstructions(): string | null {
    return this._instructions;
  }

  async initialize(connectorName: string, model: string): Promise<void> {
    this.destroyAgentOnly();
    this._connectorName = connectorName;
    this._currentModel = model;

    const agentConfig = this.buildAgentConfig(connectorName, model);
    const sessionId = this.config.session.activeSessionId;

    if (sessionId && await this.storage.exists(sessionId)) {
      this.agent = await Agent.resume(sessionId, {
        ...agentConfig,
        session: { storage: this.storage },
      });
      return;
    }

    // Old UniversalAgent session files use a different format and location.
    // Start clean when a configured session no longer exists in current storage.
    if (sessionId) {
      this.config.session.activeSessionId = null;
    }
    this.agent = Agent.create(agentConfig);
  }

  private buildAgentConfig(connectorName: string, model: string) {
    const runtimeOptions = resolveAmosModelRuntimeOptions(
      model,
      this._currentTemperature,
      this.config.defaults.reasoningEffort,
    );
    return {
      name: 'amos',
      connector: connectorName,
      model,
      tools: this.tools,
      ...runtimeOptions,
      instructions: this.buildInstructions(),
      session: {
        storage: this.storage,
        autoSave: this.config.session.autoSave,
        autoSaveIntervalMs: this.config.session.autoSaveIntervalMs,
      },
      permissions: buildPermissionsConfig(
        this.config,
        this._onApprovalRequired ?? undefined,
      ),
    };
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
    const agent = this.requireAgent();
    this._isRunning = true;
    const startedAt = Date.now();
    const toolOutcomes: ToolExecutionOutcome[] = [];
    const collect = (outcome: ToolExecutionOutcome): void => { toolOutcomes.push(outcome); };
    agent.tools.on('tool:outcome', collect);

    try {
      const response = await agent.run(input);
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
      };
      await this.autoSaveIfEnabled();
      return result;
    } finally {
      agent.tools.off('tool:outcome', collect);
      this._isRunning = false;
    }
  }

  async *stream(input: string): AsyncGenerator<StreamEvent> {
    const agent = this.requireAgent();
    this._isRunning = true;

    try {
      for await (const event of agent.stream(input)) {
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
    await agent.saveSession(undefined, name ? { title: name } : undefined);
    const sessionId = agent.getSessionId();
    if (!sessionId) throw new Error('Session storage did not assign an ID');
    if (name) {
      await this.storage.updateMetadata(sessionId, { title: name });
    }
    this.config.session.activeSessionId = sessionId;
    return sessionId;
  }

  async loadSession(sessionId: string): Promise<void> {
    const agent = this.requireAgent();
    const loaded = await agent.loadSession(sessionId);
    if (!loaded) throw new Error(`Session '${sessionId}' not found`);
    this.config.session.activeSessionId = sessionId;
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
            : { type: 'tool:complete', tool: { name: event.tool_name, result: event.result } };
      case StreamEventType.RESPONSE_COMPLETE:
        return {
          type: 'done',
          usage: {
            inputTokens: event.usage.input_tokens,
            outputTokens: event.usage.output_tokens,
            totalTokens: event.usage.total_tokens,
          },
        };
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
