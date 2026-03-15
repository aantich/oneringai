/**
 * AgentRegistry - Global registry for tracking, observing, and controlling active Agent instances.
 *
 * Provides:
 * - Automatic tracking of all Agent instances (register on create, unregister on destroy)
 * - Lightweight info snapshots and deep async inspection (full context, conversation, plugins, tools)
 * - Parent/child relationship tracking for agent hierarchies
 * - Status tracking via agent event subscriptions
 * - Event fan-in: receive all events from all agents through a single listener
 * - External control: pause, resume, cancel, destroy agents by ID or filter
 * - Aggregate statistics and metrics across all tracked agents
 */

import { EventEmitter } from 'eventemitter3';
import type { InputItem } from '../domain/entities/Message.js';
import type { IContextSnapshot } from './context-nextgen/snapshot.js';
import type { ExecutionMetrics, AuditEntry } from '../capabilities/agents/ExecutionContext.js';
import type { ToolManagerStats } from './ToolManager.js';
import type { CircuitState } from '../infrastructure/resilience/CircuitBreaker.js';

// ============================================================================
// Types
// ============================================================================

/** Agent lifecycle status from the registry's perspective */
export type AgentStatus = 'idle' | 'running' | 'paused' | 'cancelled' | 'destroyed';

/** Lightweight snapshot of an agent's state */
export interface AgentInfo {
  /** Registry ID (UUID, unique) */
  id: string;
  /** Agent name (NOT unique — user-provided or auto-generated) */
  name: string;
  /** Model identifier */
  model: string;
  /** Connector name */
  connector: string;
  /** Current status */
  status: AgentStatus;
  /** When the agent was registered */
  createdAt: Date;
  /** Parent agent's registryId (undefined if root agent) */
  parentAgentId: string | undefined;
  /** IDs of child agents spawned by this agent (live lookup) */
  childAgentIds: string[];
}

/** Filter criteria for querying agents (all fields optional, AND logic) */
export interface AgentFilter {
  /** Exact match on agent name */
  name?: string;
  /** Exact match on model */
  model?: string;
  /** Exact match on connector name */
  connector?: string;
  /** Match any of these statuses */
  status?: AgentStatus | AgentStatus[];
  /** Filter by parent agent ID */
  parentAgentId?: string;
}

/** Aggregate statistics across all tracked agents */
export interface AgentRegistryStats {
  total: number;
  byStatus: Record<AgentStatus, number>;
  byModel: Record<string, number>;
  byConnector: Record<string, number>;
}

/** Aggregate metrics across all tracked agents */
export interface AggregateMetrics {
  totalAgents: number;
  activeExecutions: number;
  totalTokens: number;
  totalToolCalls: number;
  totalErrors: number;
  byModel: Record<string, { agents: number; tokens: number }>;
  byConnector: Record<string, { agents: number; tokens: number }>;
}

/** Recursive tree node for parent/child visualization */
export interface AgentTreeNode {
  info: AgentInfo;
  children: AgentTreeNode[];
}

/** Deep inspection of a single agent */
export interface AgentInspection extends AgentInfo {
  /** Full context snapshot (plugins, tools, budget, features, systemPrompt) */
  context: IContextSnapshot;
  /** Full conversation history */
  conversation: ReadonlyArray<InputItem>;
  /** Pending input (about to go to LLM) */
  currentInput: ReadonlyArray<InputItem>;
  /** Current execution state */
  execution: {
    id: string | null;
    iteration: number;
    metrics: ExecutionMetrics | null;
    auditTrail: readonly AuditEntry[];
  };
  /** Tool manager statistics */
  toolStats: ToolManagerStats;
  /** Circuit breaker states per tool */
  circuitBreakers: Map<string, CircuitState>;
  /** Child agent info snapshots */
  children: AgentInfo[];
}

/** Events emitted by the registry */
export interface AgentRegistryEvents {
  'agent:registered': { agent: IRegistrableAgent; info: AgentInfo };
  'agent:unregistered': { id: string; name: string; reason: 'destroyed' | 'manual' };
  'agent:statusChanged': { id: string; name: string; previous: AgentStatus; current: AgentStatus };
  'registry:empty': Record<string, never>;
}

/** Callback type for agent event fan-in */
export type AgentEventListener = (agentId: string, agentName: string, event: string, data: unknown) => void;

/**
 * Minimal interface an agent must satisfy to be tracked.
 * Agent already satisfies this — avoids circular import with Agent.ts.
 */
export interface IRegistrableAgent {
  readonly registryId: string;
  readonly name: string;
  readonly model: string;
  readonly connector: { name: string };
  readonly parentAgentId: string | undefined;
  readonly isDestroyed: boolean;

  isRunning(): boolean;
  isPaused(): boolean;
  isCancelled(): boolean;

  // Observability
  getMetrics(): ExecutionMetrics | null;
  getExecutionContext(): import('../capabilities/agents/ExecutionContext.js').ExecutionContext | null;
  getAuditTrail(): readonly AuditEntry[];
  getSnapshot(): Promise<IContextSnapshot>;

  // Context access
  readonly context: {
    tools: { getStats(): ToolManagerStats; getCircuitBreakerStates(): Map<string, CircuitState> };
    getConversation(): ReadonlyArray<InputItem>;
    getCurrentInput(): ReadonlyArray<InputItem>;
  };

  // Control
  destroy(): void;
  pause?(): void;
  resume?(): void;
  cancel?(reason?: string): void;
  inject?(message: string, role?: 'user' | 'developer'): void;

  // Events
  on(event: string, listener: (...args: unknown[]) => void): this;
  off(event: string, listener: (...args: unknown[]) => void): this;
  eventNames(): (string | symbol)[];
}

// ============================================================================
// Internal entry stored per agent
// ============================================================================

interface RegistryEntry {
  agent: IRegistrableAgent;
  info: AgentInfo;
  /** Cleanup function that removes event listeners from the agent */
  cleanup: () => void;
}

// ============================================================================
// AgentRegistry
// ============================================================================

export class AgentRegistry {
  // --- Internal state ---
  private static agents = new Map<string, RegistryEntry>();
  private static childIndex = new Map<string, Set<string>>(); // parentId → Set<childId>
  private static emitter = new EventEmitter<AgentRegistryEvents>();
  private static fanInListeners = new Set<AgentEventListener>();
  /** Per-agent fan-in cleanup functions (only populated when fanInListeners.size > 0) */
  private static fanInCleanups = new Map<string, () => void>();

  // ==================== Registration (called by Agent internals) ====================

  /**
   * Register an agent. Called automatically by Agent constructor.
   * @internal
   */
  static register(agent: IRegistrableAgent): void {
    if (AgentRegistry.agents.has(agent.registryId)) {
      return; // already registered
    }

    const info: AgentInfo = {
      id: agent.registryId,
      name: agent.name,
      model: agent.model,
      connector: agent.connector.name,
      status: 'idle',
      createdAt: new Date(),
      parentAgentId: agent.parentAgentId,
      childAgentIds: [], // computed dynamically via childIndex
    };

    // Wire status tracking (always)
    const cleanup = AgentRegistry.wireStatusTracking(agent, info);

    AgentRegistry.agents.set(agent.registryId, { agent, info, cleanup });

    // Wire fan-in only if there are active fan-in listeners
    if (AgentRegistry.fanInListeners.size > 0) {
      AgentRegistry.wireFanInForAgent(agent, info);
    }

    // Update parent's child index
    if (agent.parentAgentId) {
      let children = AgentRegistry.childIndex.get(agent.parentAgentId);
      if (!children) {
        children = new Set();
        AgentRegistry.childIndex.set(agent.parentAgentId, children);
      }
      children.add(agent.registryId);
    }

    AgentRegistry.emitter.emit('agent:registered', { agent, info: { ...info, childAgentIds: [] } });
  }

  /**
   * Unregister an agent. Called automatically by Agent.destroy().
   * @internal
   */
  static unregister(id: string, reason: 'destroyed' | 'manual' = 'destroyed'): void {
    const entry = AgentRegistry.agents.get(id);
    if (!entry) return;

    // Cleanup status tracking listeners
    entry.cleanup();

    // Cleanup fan-in listeners if wired
    const fanInCleanup = AgentRegistry.fanInCleanups.get(id);
    if (fanInCleanup) {
      fanInCleanup();
      AgentRegistry.fanInCleanups.delete(id);
    }

    const name = entry.info.name;
    const parentId = entry.info.parentAgentId;

    // Remove from parent's child index
    if (parentId) {
      const siblings = AgentRegistry.childIndex.get(parentId);
      if (siblings) {
        siblings.delete(id);
        if (siblings.size === 0) {
          AgentRegistry.childIndex.delete(parentId);
        }
      }
    }

    // Remove this agent's child index entry (children become orphans)
    AgentRegistry.childIndex.delete(id);

    AgentRegistry.agents.delete(id);

    AgentRegistry.emitter.emit('agent:unregistered', { id, name, reason });

    if (AgentRegistry.agents.size === 0) {
      AgentRegistry.emitter.emit('registry:empty', {});
    }
  }

  // ==================== Query ====================

  /** Get agent by registry ID (unique) */
  static get(id: string): IRegistrableAgent | undefined {
    return AgentRegistry.agents.get(id)?.agent;
  }

  /** Get all agents with a given name (names are NOT unique) */
  static getByName(name: string): IRegistrableAgent[] {
    const result: IRegistrableAgent[] = [];
    for (const entry of AgentRegistry.agents.values()) {
      if (entry.info.name === name) result.push(entry.agent);
    }
    return result;
  }

  /** Check if an agent exists in the registry */
  static has(id: string): boolean {
    return AgentRegistry.agents.has(id);
  }

  /** List all tracked registry IDs */
  static list(): string[] {
    return Array.from(AgentRegistry.agents.keys());
  }

  /** Return agents matching all provided filter criteria */
  static filter(filter: AgentFilter): IRegistrableAgent[] {
    const result: IRegistrableAgent[] = [];
    for (const entry of AgentRegistry.agents.values()) {
      if (AgentRegistry.matchesFilter(entry.info, filter)) {
        result.push(entry.agent);
      }
    }
    return result;
  }

  /** Number of currently tracked agents */
  static get count(): number {
    return AgentRegistry.agents.size;
  }

  // ==================== Info (lightweight snapshots) ====================

  /** Lightweight info for all agents */
  static listInfo(): AgentInfo[] {
    return Array.from(AgentRegistry.agents.values()).map(e => AgentRegistry.enrichInfo(e.info));
  }

  /** Lightweight info for agents matching filter */
  static filterInfo(filter: AgentFilter): AgentInfo[] {
    const result: AgentInfo[] = [];
    for (const entry of AgentRegistry.agents.values()) {
      if (AgentRegistry.matchesFilter(entry.info, filter)) {
        result.push(AgentRegistry.enrichInfo(entry.info));
      }
    }
    return result;
  }

  // ==================== Inspection (deep, async) ====================

  /** Deep inspection of a single agent */
  static async inspect(id: string): Promise<AgentInspection | null> {
    const entry = AgentRegistry.agents.get(id);
    if (!entry) return null;
    return AgentRegistry.buildInspection(entry);
  }

  /** Deep inspection of all agents */
  static async inspectAll(): Promise<AgentInspection[]> {
    const results: AgentInspection[] = [];
    for (const entry of AgentRegistry.agents.values()) {
      results.push(await AgentRegistry.buildInspection(entry));
    }
    return results;
  }

  /** Deep inspection of agents matching filter */
  static async inspectMatching(filter: AgentFilter): Promise<AgentInspection[]> {
    const results: AgentInspection[] = [];
    for (const entry of AgentRegistry.agents.values()) {
      if (AgentRegistry.matchesFilter(entry.info, filter)) {
        results.push(await AgentRegistry.buildInspection(entry));
      }
    }
    return results;
  }

  // ==================== Aggregates ====================

  /** Aggregate counts by status/model/connector */
  static getStats(): AgentRegistryStats {
    const stats: AgentRegistryStats = {
      total: AgentRegistry.agents.size,
      byStatus: { idle: 0, running: 0, paused: 0, cancelled: 0, destroyed: 0 },
      byModel: {},
      byConnector: {},
    };

    for (const entry of AgentRegistry.agents.values()) {
      const { status, model, connector } = entry.info;
      stats.byStatus[status]++;
      stats.byModel[model] = (stats.byModel[model] ?? 0) + 1;
      stats.byConnector[connector] = (stats.byConnector[connector] ?? 0) + 1;
    }

    return stats;
  }

  /** Aggregate metrics across all agents (tokens, tool calls, errors) */
  static getAggregateMetrics(): AggregateMetrics {
    const result: AggregateMetrics = {
      totalAgents: AgentRegistry.agents.size,
      activeExecutions: 0,
      totalTokens: 0,
      totalToolCalls: 0,
      totalErrors: 0,
      byModel: {},
      byConnector: {},
    };

    for (const entry of AgentRegistry.agents.values()) {
      const { model, connector, status } = entry.info;
      if (status === 'running') result.activeExecutions++;

      const metrics = entry.agent.getMetrics();
      const tokens = metrics?.totalTokens ?? 0;
      const toolCalls = metrics?.toolCallCount ?? 0;
      const errors = metrics?.errors?.length ?? 0;

      result.totalTokens += tokens;
      result.totalToolCalls += toolCalls;
      result.totalErrors += errors;

      if (!result.byModel[model]) result.byModel[model] = { agents: 0, tokens: 0 };
      result.byModel[model].agents++;
      result.byModel[model].tokens += tokens;

      if (!result.byConnector[connector]) result.byConnector[connector] = { agents: 0, tokens: 0 };
      result.byConnector[connector].agents++;
      result.byConnector[connector].tokens += tokens;
    }

    return result;
  }

  // ==================== Parent/Child ====================

  /** Get child agents of a parent */
  static getChildren(parentId: string): IRegistrableAgent[] {
    const childIds = AgentRegistry.childIndex.get(parentId);
    if (!childIds) return [];
    const result: IRegistrableAgent[] = [];
    for (const childId of childIds) {
      const entry = AgentRegistry.agents.get(childId);
      if (entry) result.push(entry.agent);
    }
    return result;
  }

  /** Get parent agent of a child */
  static getParent(childId: string): IRegistrableAgent | undefined {
    const entry = AgentRegistry.agents.get(childId);
    if (!entry?.info.parentAgentId) return undefined;
    return AgentRegistry.agents.get(entry.info.parentAgentId)?.agent;
  }

  /** Get recursive tree starting from a root agent */
  static getTree(rootId: string): AgentTreeNode | null {
    const entry = AgentRegistry.agents.get(rootId);
    if (!entry) return null;
    return AgentRegistry.buildTree(entry);
  }

  // ==================== Events ====================

  /** Subscribe to registry lifecycle events */
  static on<K extends keyof AgentRegistryEvents>(
    event: K,
    listener: (data: AgentRegistryEvents[K]) => void,
  ): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    AgentRegistry.emitter.on(event, listener as any);
  }

  /** Unsubscribe from registry lifecycle events */
  static off<K extends keyof AgentRegistryEvents>(
    event: K,
    listener: (data: AgentRegistryEvents[K]) => void,
  ): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    AgentRegistry.emitter.off(event, listener as any);
  }

  /** Subscribe once to a registry lifecycle event */
  static once<K extends keyof AgentRegistryEvents>(
    event: K,
    listener: (data: AgentRegistryEvents[K]) => void,
  ): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    AgentRegistry.emitter.once(event, listener as any);
  }

  /** Fan-in: receive ALL events from ALL agents through one listener */
  static onAgentEvent(listener: AgentEventListener): void {
    const wasEmpty = AgentRegistry.fanInListeners.size === 0;
    AgentRegistry.fanInListeners.add(listener);

    // First fan-in listener: wire fan-in on all existing agents
    if (wasEmpty && AgentRegistry.fanInListeners.size > 0) {
      for (const entry of AgentRegistry.agents.values()) {
        AgentRegistry.wireFanInForAgent(entry.agent, entry.info);
      }
    }
  }

  /** Remove a fan-in listener */
  static offAgentEvent(listener: AgentEventListener): void {
    AgentRegistry.fanInListeners.delete(listener);

    // Last fan-in listener removed: unwire fan-in from all agents
    if (AgentRegistry.fanInListeners.size === 0 && AgentRegistry.fanInCleanups.size > 0) {
      for (const cleanup of AgentRegistry.fanInCleanups.values()) {
        cleanup();
      }
      AgentRegistry.fanInCleanups.clear();
    }
  }

  // ==================== Control ====================

  /** Pause a specific agent. Returns true if found and paused. */
  static pauseAgent(id: string): boolean {
    const entry = AgentRegistry.agents.get(id);
    if (!entry || !entry.agent.pause) return false;
    entry.agent.pause();
    return true;
  }

  /** Resume a specific agent. Returns true if found and resumed. */
  static resumeAgent(id: string): boolean {
    const entry = AgentRegistry.agents.get(id);
    if (!entry || !entry.agent.resume) return false;
    entry.agent.resume();
    return true;
  }

  /** Cancel a specific agent. Returns true if found and cancelled. */
  static cancelAgent(id: string, reason?: string): boolean {
    const entry = AgentRegistry.agents.get(id);
    if (!entry || !entry.agent.cancel) return false;
    entry.agent.cancel(reason);
    return true;
  }

  /** Destroy a specific agent. Returns true if found and destroyed. */
  static destroyAgent(id: string): boolean {
    const entry = AgentRegistry.agents.get(id);
    if (!entry) return false;
    entry.agent.destroy(); // triggers unregister via Agent.destroy()
    return true;
  }

  /** Pause all agents matching filter. Returns count paused. */
  static pauseMatching(filter: AgentFilter): number {
    return AgentRegistry.bulkControl(filter, (agent) => agent.pause?.());
  }

  /** Cancel all agents matching filter. Returns count cancelled. */
  static cancelMatching(filter: AgentFilter, reason?: string): number {
    return AgentRegistry.bulkControl(filter, (agent) => agent.cancel?.(reason));
  }

  /** Destroy all agents matching filter. Returns count destroyed. */
  static destroyMatching(filter: AgentFilter): number {
    // Collect IDs first to avoid mutating map during iteration
    const ids: string[] = [];
    for (const entry of AgentRegistry.agents.values()) {
      if (AgentRegistry.matchesFilter(entry.info, filter)) {
        ids.push(entry.info.id);
      }
    }
    let count = 0;
    for (const id of ids) {
      if (AgentRegistry.destroyAgent(id)) count++;
    }
    return count;
  }

  /** Pause all agents. Returns count paused. */
  static pauseAll(): number {
    let count = 0;
    for (const entry of AgentRegistry.agents.values()) {
      if (entry.agent.pause) {
        entry.agent.pause();
        count++;
      }
    }
    return count;
  }

  /** Cancel all agents. Returns count cancelled. */
  static cancelAll(reason?: string): number {
    let count = 0;
    for (const entry of AgentRegistry.agents.values()) {
      if (entry.agent.cancel) {
        entry.agent.cancel(reason);
        count++;
      }
    }
    return count;
  }

  /** Destroy ALL tracked agents. Returns count destroyed. */
  static destroyAll(): number {
    const ids = Array.from(AgentRegistry.agents.keys());
    let count = 0;
    for (const id of ids) {
      if (AgentRegistry.destroyAgent(id)) count++;
    }
    return count;
  }

  // ==================== Housekeeping ====================

  /** Clear registry without destroying agents (for testing) */
  static clear(): void {
    // Cleanup all status tracking listeners
    for (const entry of AgentRegistry.agents.values()) {
      entry.cleanup();
    }
    // Cleanup all fan-in listeners
    for (const cleanup of AgentRegistry.fanInCleanups.values()) {
      cleanup();
    }
    AgentRegistry.agents.clear();
    AgentRegistry.childIndex.clear();
    AgentRegistry.fanInCleanups.clear();
    AgentRegistry.emitter.removeAllListeners();
    AgentRegistry.fanInListeners.clear();
  }

  // ==================== Private helpers ====================

  /** Known agent events for fan-in forwarding */
  private static readonly KNOWN_EVENTS = [
    'execution:start', 'execution:complete', 'execution:error',
    'execution:paused', 'execution:resumed', 'execution:cancelled',
    'execution:maxIterations', 'execution:empty_output', 'execution:retry',
    'iteration:start', 'iteration:complete',
    'llm:request', 'llm:response', 'llm:error',
    'tool:detected', 'tool:start', 'tool:complete', 'tool:error', 'tool:timeout',
    'hook:error',
    'circuit:opened', 'circuit:half-open', 'circuit:closed',
    'async:tool:started', 'async:tool:complete', 'async:tool:error', 'async:tool:timeout',
    'async:continuation:start',
  ];

  /**
   * Wire status tracking listeners on an agent (always done on register).
   * Returns a cleanup function that removes the listeners.
   */
  private static wireStatusTracking(agent: IRegistrableAgent, info: AgentInfo): () => void {
    const updateStatus = (newStatus: AgentStatus) => {
      const prev = info.status;
      if (prev !== newStatus) {
        info.status = newStatus;
        AgentRegistry.emitter.emit('agent:statusChanged', {
          id: info.id,
          name: info.name,
          previous: prev,
          current: newStatus,
        });
      }
    };

    const onStart = () => updateStatus('running');
    const onComplete = () => updateStatus('idle');
    const onError = () => updateStatus('idle');
    const onPaused = () => updateStatus('paused');
    const onResumed = () => updateStatus('running');
    const onCancelled = () => updateStatus('cancelled');

    agent.on('execution:start', onStart);
    agent.on('execution:complete', onComplete);
    agent.on('execution:error', onError);
    agent.on('execution:paused', onPaused);
    agent.on('execution:resumed', onResumed);
    agent.on('execution:cancelled', onCancelled);

    return () => {
      agent.off('execution:start', onStart);
      agent.off('execution:complete', onComplete);
      agent.off('execution:error', onError);
      agent.off('execution:paused', onPaused);
      agent.off('execution:resumed', onResumed);
      agent.off('execution:cancelled', onCancelled);
    };
  }

  /**
   * Wire fan-in event forwarding on a single agent.
   * Only called when fanInListeners.size > 0 (lazy wiring).
   * Stores cleanup in fanInCleanups map.
   */
  private static wireFanInForAgent(agent: IRegistrableAgent, info: AgentInfo): void {
    if (AgentRegistry.fanInCleanups.has(info.id)) return; // already wired

    const handlers = new Map<string, (...args: unknown[]) => void>();

    for (const eventName of AgentRegistry.KNOWN_EVENTS) {
      const handler = (data: unknown) => {
        for (const listener of AgentRegistry.fanInListeners) {
          try {
            listener(info.id, info.name, eventName, data);
          } catch {
            // Don't let fan-in listener errors affect the agent
          }
        }
      };
      handlers.set(eventName, handler);
      agent.on(eventName, handler);
    }

    AgentRegistry.fanInCleanups.set(info.id, () => {
      for (const [eventName, handler] of handlers) {
        agent.off(eventName, handler);
      }
      handlers.clear();
    });
  }

  /** Enrich AgentInfo with live childAgentIds from the index */
  private static enrichInfo(info: AgentInfo): AgentInfo {
    const children = AgentRegistry.childIndex.get(info.id);
    return {
      ...info,
      childAgentIds: children ? Array.from(children) : [],
    };
  }

  /** Build a deep AgentInspection from a registry entry */
  private static async buildInspection(entry: RegistryEntry): Promise<AgentInspection> {
    const { agent, info } = entry;

    // Get child agent info (safe — only reads registry state)
    const childIds = AgentRegistry.childIndex.get(info.id);
    const children: AgentInfo[] = [];
    if (childIds) {
      for (const childId of childIds) {
        const childEntry = AgentRegistry.agents.get(childId);
        if (childEntry) {
          children.push(AgentRegistry.enrichInfo(childEntry.info));
        }
      }
    }

    // Guard: if agent is destroyed, return degraded inspection
    if (agent.isDestroyed) {
      return {
        ...AgentRegistry.enrichInfo(info),
        context: {
          available: false,
          agentId: info.id,
          model: info.model,
          features: { workingMemory: false, inContextMemory: false, persistentInstructions: false, userInfo: false, toolCatalog: false, sharedWorkspace: false },
          budget: { maxTokens: 0, responseReserve: 0, systemMessageTokens: 0, toolsTokens: 0, conversationTokens: 0, currentInputTokens: 0, totalUsed: 0, available: 0, utilizationPercent: 0, breakdown: { systemPrompt: 0, persistentInstructions: 0, pluginInstructions: 0, pluginContents: {}, tools: 0, conversation: 0, currentInput: 0 } },
          strategy: 'unknown',
          messagesCount: 0,
          toolCallsCount: 0,
          systemPrompt: null,
          plugins: [],
          tools: [],
        },
        conversation: [],
        currentInput: [],
        execution: { id: null, iteration: 0, metrics: null, auditTrail: [] },
        toolStats: { totalTools: 0, enabledTools: 0, disabledTools: 0, namespaces: [], toolsByNamespace: {}, mostUsed: [], totalExecutions: 0 },
        circuitBreakers: new Map(),
        children,
      };
    }

    // Agent is alive — safe to inspect
    try {
      const context = await agent.getSnapshot();
      const execCtx = agent.getExecutionContext();
      const toolStats = agent.context.tools.getStats();
      const circuitBreakers = agent.context.tools.getCircuitBreakerStates();
      const conversation = agent.context.getConversation();
      const currentInput = agent.context.getCurrentInput();
      const auditTrail = agent.getAuditTrail();
      const metrics = agent.getMetrics();

      return {
        ...AgentRegistry.enrichInfo(info),
        context,
        conversation,
        currentInput,
        execution: {
          id: execCtx?.executionId ?? null,
          iteration: execCtx?.iteration ?? 0,
          metrics,
          auditTrail,
        },
        toolStats,
        circuitBreakers,
        children,
      };
    } catch {
      // Agent was destroyed between the check and the access — return degraded
      return AgentRegistry.buildInspection({ ...entry, agent: { ...agent, isDestroyed: true } as IRegistrableAgent });
    }
  }

  /** Build recursive tree from an entry (with cycle protection) */
  private static buildTree(entry: RegistryEntry, visited = new Set<string>()): AgentTreeNode {
    visited.add(entry.info.id);

    const childIds = AgentRegistry.childIndex.get(entry.info.id);
    const children: AgentTreeNode[] = [];

    if (childIds) {
      for (const childId of childIds) {
        if (visited.has(childId)) continue; // cycle detected — skip
        const childEntry = AgentRegistry.agents.get(childId);
        if (childEntry) {
          children.push(AgentRegistry.buildTree(childEntry, visited));
        }
      }
    }

    return {
      info: AgentRegistry.enrichInfo(entry.info),
      children,
    };
  }

  /** Check if an AgentInfo matches a filter (AND logic) */
  private static matchesFilter(info: AgentInfo, filter: AgentFilter): boolean {
    if (filter.name !== undefined && info.name !== filter.name) return false;
    if (filter.model !== undefined && info.model !== filter.model) return false;
    if (filter.connector !== undefined && info.connector !== filter.connector) return false;
    if (filter.parentAgentId !== undefined && info.parentAgentId !== filter.parentAgentId) return false;

    if (filter.status !== undefined) {
      const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
      if (!statuses.includes(info.status)) return false;
    }

    return true;
  }

  /** Bulk control helper — applies action to all matching agents */
  private static bulkControl(
    filter: AgentFilter,
    action: (agent: IRegistrableAgent) => void,
  ): number {
    let count = 0;
    for (const entry of AgentRegistry.agents.values()) {
      if (AgentRegistry.matchesFilter(entry.info, filter)) {
        action(entry.agent);
        count++;
      }
    }
    return count;
  }
}
