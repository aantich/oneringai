import { randomUUID } from 'node:crypto';
import { Agent, type RunOptions } from '../Agent.js';
import type { ToolContext, ToolResult } from '../../domain/entities/Tool.js';
import { ToolCallState } from '../../domain/entities/Tool.js';
import type { AgentResponse } from '../../domain/entities/Response.js';
import type { InputItem } from '../../domain/entities/Message.js';
import type { StreamEvent } from '../../domain/entities/StreamEvent.js';
import { StreamEventType } from '../../domain/entities/StreamEvent.js';
import { ModelTask } from '../model-execution/ModelTask.js';
import { acquireComposition, type CompositionLease } from '../execution/composition.js';
import type { CompositionToolObservation } from '../execution/composition.js';
import { ContentType } from '../../domain/entities/Content.js';
import { MessageRole } from '../../domain/entities/Message.js';
import type { ToolExecutionOutcome } from '../tool-execution/outcomes.js';
import { hasUnacknowledgedEvidence } from '../context-nextgen/tool-pairs.js';
import { createExecutionSignal, withAbort } from '../tool-execution/cancellation.js';
import type { EvidenceReference } from '../../domain/interfaces/IEvidenceStorage.js';
import type { OrchestrationToolsContext } from './tools.js';
import { buildWorkspaceDelta } from './tools.js';
import type { OrchestratorFactoryOptions, ChildObservation, OrchestratedAgentConfig } from './factoryTypes.js';
import { FactoryExecution } from './factoryExecution.js';
import type { ParentOperation } from './executionBinding.js';
import { requestOrchestratorAsyncContinuation } from './executionBinding.js';
import { badFactoryConfig, checkFactoryConfig } from './factoryConfig.js';
import { markOrchestratorConstruction } from './construction.js';
import { isContextCompactionStrategy } from '../context-nextgen/strategies/ContextCompactionStrategy.js';

const policies = new WeakMap<OrchestrationToolsContext, FactoryPolicy>();
export const factoryPolicy = (context: OrchestrationToolsContext): FactoryPolicy | undefined => policies.get(context);
export const STORE_NAMES = ['store_get', 'store_set', 'store_delete', 'store_list', 'store_search'];
export const ORCHESTRATION_NAMES = ['assign_turn', 'delegate_interactive', 'send_message', 'list_agents', 'destroy_agent'];
type Child = { agent: Agent; lease: CompositionLease; operation: ParentOperation; id: string; task?: ModelTask; ownsTask: boolean;
  references: EvidenceReference[]; response?: AgentResponse; finished: boolean; aborted: boolean; autoDestroy: boolean; continuation: boolean;
  outcomes: Map<string, ToolExecutionOutcome>;
  releaseParent(): void; stopTools(): void; stopWork(): void; disposeSignal(): void; destroy(): void };
const reasonText = (error: unknown): string => error instanceof Error ? error.message : String(error);

/** Selected policy for the existing five tools and delegation engine. No legacy callback changes. */
export class FactoryPolicy {
  readonly execution = new FactoryExecution();
  private parent?: Agent;
  private closed = false;
  private readonly lifetime = new AbortController();
  private readonly reservations = new Set<string>();
  private readonly identities = new Map<Agent, { agentId: string; sessionId?: string }>();
  private readonly children = new Map<Agent, Child>();
  private readonly configurations = new WeakMap<Agent, OrchestratedAgentConfig>();
  constructor(readonly context: OrchestrationToolsContext, readonly options: OrchestratorFactoryOptions,
    readonly workerBaseline: (type: string) => OrchestratedAgentConfig) { policies.set(context, this); }

  attach(parent: Agent, config: OrchestratedAgentConfig): void {
    this.parent = parent; this.configurations.set(parent, config); this.remember(parent, config);
    this.execution.attach(parent, () => { queueMicrotask(() => {
      if (this.closed || parent.isRunning() || parent.isDestroyed || parent.hasPendingAsyncTools() || !parent.hasPendingAsyncTools(true)) return;
      // Agent's normal auto-continuation gate also honors the returned asyncTools settings.
      requestOrchestratorAsyncContinuation(parent);
    }); });
    const cancel = parent.cancel.bind(parent);
    parent.cancel = reason => { this.execution.cancelCurrent(new DOMException(reason ?? 'Parent operation cancelled', 'AbortError')); cancel(reason); };
  }
  operation(context?: ToolContext): ParentOperation { return this.execution.forInvocation(context); }
  private protected(agent: Agent): boolean {
    if (agent.isDestroyed) return false;
    return [...agent.context.getConversation(), ...agent.context.getCurrentInput()].some(hasUnacknowledgedEvidence);
  }
  busy(agent: Agent): boolean { return this.children.has(agent) || agent.isRunning() || agent.hasPendingAsyncTools(true) || this.protected(agent); }
  private remember(agent: Agent, config: OrchestratedAgentConfig): void { this.identities.set(agent, { agentId: agent.context.agentId, sessionId: config.session?.id ?? agent.context.sessionId ?? undefined }); }
  private validateIdentity(config: OrchestratedAgentConfig): void {
    const agentId = config.context?.agentId, sessionId = config.session?.id;
    for (const [agent, identity] of this.identities) {
      if (agent.isDestroyed) { this.identities.delete(agent); continue; }
      if (agentId && identity.agentId === agentId || sessionId && (agent.context.sessionId ?? identity.sessionId) === sessionId) badFactoryConfig('each live agent requires a distinct conversation/session identity');
    }
  }
  async get(name: string, type: string | undefined, operation: ParentOperation, signal: AbortSignal = operation.controller.signal): Promise<Agent> {
    signal.throwIfAborted(); if (this.closed) return badFactoryConfig('orchestrator is closed');
    const existing = this.context.agents.get(name);
    if (existing) { if (existing.isDestroyed) return badFactoryConfig(`Agent "${name}" is destroyed`); return existing; }
    if (!name || !type || !this.context.agentTypes.has(type)) return badFactoryConfig('a new worker requires a unique name and registered type');
    if (this.reservations.has(name)) return badFactoryConfig(`worker "${name}" is already being configured`);
    if (this.context.agents.size + this.reservations.size >= (this.context.maxAgents ?? 20)) return badFactoryConfig('maximum worker limit reached');
    this.reservations.add(name);
    const joined = createExecutionSignal([signal, this.lifetime.signal]);
    try {
      const returned = await withAbort(Promise.resolve().then(() => { joined.controller.signal.throwIfAborted(); return this.options.configureAgent({ role: 'worker', type, name,
        baseline: this.workerBaseline(type) }); }), joined.controller.signal);
      joined.controller.signal.throwIfAborted();
      const selected = checkFactoryConfig(returned, new Set(STORE_NAMES)); this.validateIdentity(selected);
      const context = { model: selected.model, ...selected.context };
      markOrchestratorConstruction(context, { version: 1, workspace: this.context.workspace, worker: true, registry: selected.registry });
      const worker = Agent.create({ ...selected, context, name, parentAgentId: this.parent?.registryId });
      try { joined.controller.signal.throwIfAborted(); } catch (error) { worker.destroy(); throw error; }
      this.configurations.set(worker, selected); this.context.agents.set(name, worker); this.remember(worker, selected);
      const workerExecution = new FactoryExecution(); workerExecution.attach(worker);
      const destroy = worker.destroy.bind(worker), continueAsync = worker.continueWithAsyncResults.bind(worker);
      worker.destroy = () => {
        const child = this.children.get(worker);
        if (child) { child.autoDestroy = true; child.lease.cancel(); this.settle(child); return; }
        if (worker.hasPendingAsyncTools(true) || this.protected(worker)) return badFactoryConfig('save/acknowledge retained worker observations before destroying the worker');
        workerExecution.close(); destroy(); this.remove(worker); this.destroyWorkspaceWhenUnused();
      };
      worker.continueWithAsyncResults = (results?: ToolResult[]) => {
        const child = this.children.get(worker);
        if (!child) return continueAsync(results);
        if (child.continuation || worker.isRunning() || child.lease.pending || worker.hasPendingAsyncTools()) return Promise.reject(new Error('Worker work has not settled for continuation'));
        child.continuation = true;
        const promise = child.lease.admit(() => continueAsync(results)); child.lease.track(promise);
        return promise.then(response => { child.response = response; return response; }).finally(() => { child.continuation = false; this.schedule(child); });
      };
      return worker;
    } finally { this.reservations.delete(name); joined.dispose(); this.destroyWorkspaceWhenUnused(); }
  }
  private remove(agent: Agent): void {
    this.identities.delete(agent);
    for (const [name, value] of this.context.agents) if (value === agent) { this.context.agents.delete(name); this.context.lastTurnTimestamps.delete(name); }
  }
  private notify(child: Child, state: ChildObservation['state'], late: boolean, reason?: string): void {
    const observation: ChildObservation = Object.freeze({ parentExecutionId: child.operation.id, childExecutionId: child.id,
      childName: child.agent.name, state, reason, response: child.response, accounting: child.operation.modelTask ? 'shared' : 'independent',
      modelTaskId: child.task?.id, invocationIds: Object.freeze(child.task?.snapshot().invocations.filter(record => record.parentInvocationId === child.id).map(record => record.id) ?? []),
      references: Object.freeze([...child.references]), toolOutcomes: Object.freeze([...child.outcomes.values()]), late });
    try { const returned: unknown = this.options.onChildOutcome?.(observation); if (returned && typeof (returned as PromiseLike<unknown>).then === 'function') void Promise.resolve(returned).catch(() => {}); }
    catch { /* Observers never repeat a child action. */ }
  }
  private start(agent: Agent, operation: ParentOperation, autoDestroy: boolean, signal?: AbortSignal): Child {
    if (this.busy(agent)) return badFactoryConfig(`worker "${agent.name}" is still occupied; settle/repair its earlier work first`);
    const selected = this.configurations.get(agent)!;
    const strategy = agent.context.compactionStrategy;
    const ownsTask = !operation.modelTask && !!(selected.modelExecution || isContextCompactionStrategy(strategy) && strategy.config.history !== 'off');
    const task = operation.modelTask ?? (ownsTask ? new ModelTask({ limits: selected.modelExecution?.limits }) : undefined);
    const joined = createExecutionSignal([operation.controller.signal, this.lifetime.signal, signal]);
    let lease: CompositionLease;
    try { lease = acquireComposition(agent, { modelTask: task, signal: joined.controller.signal }); }
    catch (error) { joined.dispose(); if (ownsTask) task?.destroy(); throw error; }
    const child: Child = { agent, lease, operation, task, ownsTask, id: `child_${randomUUID()}`, references: [], outcomes: new Map(), finished: false, aborted: false,
      autoDestroy, continuation: false, releaseParent: this.execution.retainChild(operation), stopTools: () => {}, stopWork: () => {}, disposeSignal: joined.dispose, destroy: agent.destroy.bind(agent) };
    lease.setInvocationParent(child.id); this.children.set(agent, child);
    child.stopTools = lease.onToolObservation(observation => {
      child.outcomes.set(observation.outcome.executionId, observation.outcome);
      if (observation.acknowledgedResult) child.references.push(observation.acknowledgedResult);
      if (observation.late && observation.result && agent.context.hasPlugin('evidence')) {
        this.retainLate(child, observation);
        this.notify(child, 'uncertain', true, 'Late tool observation; inspect its evidence acknowledgement independently');
      }
    });
    child.stopWork = lease.onWorkSettled(() => this.schedule(child));
    return child;
  }
  private retainLate(child: Child, observation: CompositionToolObservation): void {
    const { agent } = child, outcome = observation.outcome, callId = outcome.callId ?? outcome.executionId;
    const content = typeof observation.result!.value === 'string' ? observation.result!.value : JSON.stringify(observation.result!.value);
    const items = [...agent.context.getConversation(), ...agent.context.getCurrentInput()];
    const existing = items.flatMap(item => item.type === 'message' ? item.content : []).find(part => part.type === ContentType.TOOL_RESULT
      && part.tool_use_id === callId && part.evidence?.executionId === outcome.executionId);
    if (existing?.type === ContentType.TOOL_RESULT) {
      existing.content = content; existing.evidence = { version: 1, executionId: outcome.executionId,
        status: observation.acknowledgedResult ? 'stored' : 'storage_failed', ...(observation.acknowledgedResult ? { reference: observation.acknowledgedResult } : {}) };
      return;
    }
    if (observation.acknowledgedResult) return;
    if (!items.some(item => item.type === 'message' && item.content.some(part => part.type === ContentType.TOOL_USE && part.id === callId))) {
      agent.context.addAssistantResponse([{ type: 'message', role: MessageRole.ASSISTANT, content: [{ type: ContentType.TOOL_USE,
        id: callId, name: outcome.toolName, arguments: JSON.stringify(observation.arguments?.value ?? {}) }] }]);
    }
    agent.context.addToolResults([{ tool_use_id: callId, tool_name: outcome.toolName, content: observation.result!.value, outcome, state: ToolCallState.COMPLETED }]);
  }
  private schedule(child: Child): void { setImmediate(() => this.settle(child)); }
  private settle(child: Child): void {
    if (this.children.get(child.agent) !== child || !child.finished || child.continuation || child.lease.pending || child.agent.isRunning()) return;
    if (child.agent.hasPendingAsyncTools(true) || this.protected(child.agent)) {
      if (!child.lease.signal.aborted && !child.agent.hasPendingAsyncTools() && child.agent.hasPendingAsyncTools(true)
        && this.configurations.get(child.agent)?.asyncTools?.autoContinue !== false) {
        void child.agent.continueWithAsyncResults().catch(() => {});
      }
      return;
    }
    child.stopTools(); child.stopWork(); child.lease.release();
    if (!child.lease.released) return;
    this.notify(child, 'settled', child.aborted);
    this.children.delete(child.agent); child.releaseParent(); child.disposeSignal(); if (child.ownsTask) child.task?.destroy();
    if (child.autoDestroy && !child.agent.isDestroyed) child.destroy();
    this.destroyWorkspaceWhenUnused();
  }
  async run(agent: Agent, input: string | InputItem[], options: RunOptions | undefined, operation: ParentOperation, autoDestroy = false, signal?: AbortSignal): Promise<AgentResponse> {
    const child = this.start(agent, operation, autoDestroy, signal);
    try { const pending = child.lease.run(input, options).then(response => { child.response = response; return response; });
      const response = await withAbort(pending, child.lease.signal);
      if (agent.hasPendingAsyncTools(true) || this.protected(agent)) this.notify(child, 'uncertain', false, 'Child retains pending work or unacknowledged evidence');
      return response;
    } catch (error) { child.aborted = true; this.notify(child, child.lease.signal.reason?.name === 'TimeoutError' ? 'timed_out' : child.lease.signal.aborted ? 'cancelled' : 'uncertain', false, reasonText(error)); throw error; }
    finally { child.finished = true; this.schedule(child); }
  }
  async *stream(agent: Agent, input: string | InputItem[], options: RunOptions | undefined, operation: ParentOperation): AsyncIterableIterator<StreamEvent> {
    const child = this.start(agent, operation, false); let complete = false;
    try { for await (const event of child.lease.stream(input, options)) { if (event.type === StreamEventType.RESPONSE_COMPLETE) complete = true; yield event; }
      if (!complete || agent.hasPendingAsyncTools(true) || this.protected(agent)) this.notify(child, 'uncertain', false, 'Stream has no settled complete observation');
    } catch (error) { child.aborted = true; this.notify(child, child.lease.signal.aborted ? 'cancelled' : 'uncertain', false, reasonText(error)); throw error; }
    finally { if (!complete) { child.aborted = true; child.lease.cancel(); } child.finished = true; this.schedule(child); }
  }
  async assign(args: Record<string, unknown>, context?: ToolContext): Promise<Record<string, unknown>> {
    const operation = this.operation(context), joined = createExecutionSignal([operation.controller.signal, context?.signal]);
    const timeout = ((args.timeout as number) ?? 300) * 1000;
    if (!Number.isFinite(timeout) || timeout < 0 || timeout > 2147483647) { joined.dispose(); return { success: false, error: 'timeout must fit a nonnegative timer duration' }; }
    if (timeout === 0) joined.controller.abort(new DOMException('Turn timed out before admission', 'TimeoutError'));
    const timer = setTimeout(() => joined.controller.abort(new DOMException(`Turn timed out after ${timeout / 1000}s`, 'TimeoutError')), timeout);
    try {
      const agent = await this.get(args.agent as string, args.type as string | undefined, operation, joined.controller.signal);
      const instruction = buildWorkspaceDelta(agent.name, this.context.workspace, this.context.lastTurnTimestamps) + (args.instruction as string);
      const response = await this.run(agent, instruction, undefined, operation, args.autoDestroy === true, joined.controller.signal);
      this.context.lastTurnTimestamps.set(agent.name, Date.now());
      return { success: true, agent: agent.name, status: response.status, result: response.output_text, totalTokens: response.usage?.total_tokens, destroyed: agent.isDestroyed };
    } catch (error) { return { success: false, agent: args.agent, error: reasonText(error), destroyed: false }; }
    finally { clearTimeout(timer); joined.dispose(); }
  }
  close(): void {
    if (this.closed) return; this.closed = true; this.lifetime.abort(new DOMException('Orchestrator destroyed', 'AbortError'));
    // Keep the coordinator until retained children have released their original operation.
    for (const agent of [...this.context.agents.values()]) { const child = this.children.get(agent); if (child) { child.autoDestroy = true; child.lease.cancel(); this.schedule(child); } else if (!this.protected(agent) && !agent.hasPendingAsyncTools(true)) agent.destroy(); }
    this.destroyWorkspaceWhenUnused();
  }
  private destroyWorkspaceWhenUnused(): void {
    if (this.closed && !this.context.agents.size && !this.reservations.size) { this.execution.close(); this.context.workspace.destroy(); }
  }
}
