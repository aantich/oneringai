/**
 * Orchestration Tools v2 - Tools given to the orchestrator Agent for managing worker agents.
 *
 * 5 tools:
 * - assign_turn: Assign work to an agent (auto-creates if needed, always async, optional autoDestroy)
 * - delegate_interactive: Hand the user-facing session to a sub-agent
 * - send_message: Inject a message into an agent's context
 * - list_agents: See team status + delegation state
 * - destroy_agent: Remove a worker (auto-reclaims if delegated)
 */

import type { ToolFunction } from '../../domain/entities/Tool.js';
import type { Agent } from '../Agent.js';
import type { SharedWorkspacePluginNextGen } from '../context-nextgen/plugins/SharedWorkspacePluginNextGen.js';
import type { AgentTypeConfig, DelegationDefaults } from './createOrchestrator.js';

// ============================================================================
// Types
// ============================================================================

export interface OrchestrationToolsContext {
  /** Shared workspace plugin instance */
  workspace: SharedWorkspacePluginNextGen;
  /** Live worker agent instances (name → Agent) */
  agents: Map<string, Agent>;
  /** Registered agent type configurations */
  agentTypes: Map<string, AgentTypeConfig>;
  /** Timestamp of each agent's last completed turn (for workspace deltas) */
  lastTurnTimestamps: Map<string, number>;
  /** Factory function to create a worker agent */
  createWorkerAgent: (name: string, type: string) => Agent;
  /** Maximum number of worker agents (default: 20) */
  maxAgents?: number;
  /** Delegation state — shared with createOrchestrator for run()/stream() wrapping */
  delegationState: DelegationState;
  /** Default delegation settings from OrchestratorConfig */
  delegationDefaults?: DelegationDefaults;
}

/**
 * Delegation state — tracks whether the orchestrator has handed
 * the user-facing session to a sub-agent.
 */
export interface DelegationState {
  active: boolean;
  agentName: string;
  monitoring: 'passive' | 'active' | 'event';
  reclaimOn: DelegationReclaimConfig;
  turnCount: number;
}

export interface DelegationReclaimConfig {
  /** User keyword that triggers reclaim (e.g., "done", "back") */
  keyword?: string;
  /** Auto-reclaim after N delegation turns */
  maxTurns?: number;
  /** Reclaim when this workspace key appears */
  workspaceKey?: string;
}

export function createDelegationState(): DelegationState {
  return {
    active: false,
    agentName: '',
    monitoring: 'passive',
    reclaimOn: {},
    turnCount: 0,
  };
}

// ============================================================================
// Workspace Delta Builder
// ============================================================================

/** Maximum entries/log lines in a workspace delta to prevent unbounded growth */
const MAX_DELTA_ENTRIES = 20;
const MAX_DELTA_LOG = 10;

export function buildWorkspaceDelta(
  agentName: string,
  workspace: SharedWorkspacePluginNextGen,
  lastSeen: Map<string, number>,
): string {
  const since = lastSeen.get(agentName) ?? 0;
  let entries = workspace.getAllEntries().filter(e => e.updatedAt > since);
  let recentLog = workspace.getLog().filter(l => l.timestamp > since);

  if (entries.length === 0 && recentLog.length === 0) return '';

  const parts: string[] = ['[Workspace changes since your last turn]'];

  const totalEntries = entries.length;
  if (entries.length > MAX_DELTA_ENTRIES) {
    entries = entries
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_DELTA_ENTRIES);
    parts.push(`(showing ${MAX_DELTA_ENTRIES} of ${totalEntries} changed entries)`);
  }

  for (const entry of entries) {
    const verb = entry.createdAt > since ? 'NEW' : 'UPDATED';
    parts.push(`- ${verb}: "${entry.key}" (v${entry.version}, by ${entry.author}) — ${entry.summary}`);
  }

  if (recentLog.length > 0) {
    const totalLog = recentLog.length;
    if (recentLog.length > MAX_DELTA_LOG) {
      recentLog = recentLog.slice(-MAX_DELTA_LOG);
    }
    parts.push(`Recent log${totalLog > MAX_DELTA_LOG ? ` (last ${MAX_DELTA_LOG} of ${totalLog})` : ''}:`);
    for (const log of recentLog) {
      parts.push(`  [${log.author}] ${log.message}`);
    }
  }

  return parts.join('\n') + '\n\n';
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Get an existing agent or auto-create one from a type config.
 * Returns the agent, or an error object if validation fails.
 */
function getOrCreateAgent(
  ctx: OrchestrationToolsContext,
  name: string,
  type?: string,
): Agent | { error: string } {
  const existing = ctx.agents.get(name);
  if (existing) {
    if (existing.isDestroyed) {
      return { error: `Agent "${name}" is destroyed. Use a different name.` };
    }
    return existing;
  }

  // Agent doesn't exist — need type to auto-create
  if (!type) {
    return { error: `Agent "${name}" not found. Provide a "type" to auto-create it.` };
  }
  if (!ctx.agentTypes.has(type)) {
    const available = Array.from(ctx.agentTypes.keys()).join(', ');
    return { error: `Unknown agent type "${type}". Available: ${available}` };
  }

  // Enforce max agents limit
  const maxAgents = ctx.maxAgents ?? 20;
  if (ctx.agents.size >= maxAgents) {
    return { error: `Maximum agent limit (${maxAgents}) reached. Destroy unused agents first.` };
  }

  const agent = ctx.createWorkerAgent(name, type);
  ctx.agents.set(name, agent);
  return agent;
}

function isAgentError(result: Agent | { error: string }): result is { error: string } {
  return 'error' in result;
}

// ============================================================================
// Tool Builders
// ============================================================================

export function buildOrchestrationTools(ctx: OrchestrationToolsContext): ToolFunction[] {
  return [
    buildAssignTurnTool(ctx),
    buildDelegateInteractiveTool(ctx),
    buildSendMessageTool(ctx),
    buildListAgentsTool(ctx),
    buildDestroyAgentTool(ctx),
  ];
}

// ============================================================================
// assign_turn — Always async, auto-create, optional autoDestroy
// ============================================================================

function buildAssignTurnTool(ctx: OrchestrationToolsContext): ToolFunction {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'assign_turn',
        description: `Assign a task to an agent and continue immediately — the result arrives later as a follow-up message. If the agent doesn't exist yet, it is created automatically (provide "type"). Use this for:
- DIRECT route: quick behind-the-scenes work (set autoDestroy:true so the agent is cleaned up after).
- ORCHESTRATE route: kicking off plan tasks. Results arrive via continuation; chain dependent tasks from there.
You can call this multiple times in one turn to launch several agents concurrently. Each result is delivered separately as it completes.`,
        parameters: {
          type: 'object',
          properties: {
            agent: { type: 'string', description: 'Unique agent name (e.g., "researcher", "dev-1")' },
            instruction: { type: 'string', description: 'What the agent should do this turn' },
            type: { type: 'string', description: 'Agent type (required if agent does not exist yet)' },
            autoDestroy: { type: 'boolean', description: 'Destroy agent after this turn completes (default: false)' },
            timeout: { type: 'number', description: 'Timeout in seconds (default: 300)' },
          },
          required: ['agent', 'instruction'],
        },
      },
      // Non-blocking: result delivered via async continuation
      blocking: false,
      timeout: 300000,
    },
    descriptionFactory: () => {
      const types = Array.from(ctx.agentTypes.entries())
        .map(([id, cfg]) => {
          const desc = cfg.description ?? cfg.systemPrompt.slice(0, 100) + '...';
          return `- "${id}": ${desc}`;
        })
        .join('\n');
      return `Assign work to an agent. Auto-creates if needed. Always async.\n\nAvailable types:\n${types}`;
    },
    execute: async (args: Record<string, unknown>) => {
      const name = args.agent as string;
      const instruction = args.instruction as string;
      const type = args.type as string | undefined;
      const autoDestroy = (args.autoDestroy as boolean) ?? false;
      const timeoutMs = ((args.timeout as number) ?? 300) * 1000;

      const agentOrError = getOrCreateAgent(ctx, name, type);
      if (isAgentError(agentOrError)) {
        return { success: false, error: agentOrError.error };
      }
      const agent = agentOrError;

      const delta = buildWorkspaceDelta(name, ctx.workspace, ctx.lastTurnTimestamps);
      const fullInstruction = delta + instruction;

      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const response = await Promise.race([
          agent.run(fullInstruction),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error(`Turn timed out after ${timeoutMs / 1000}s`)), timeoutMs);
          }),
        ]);

        ctx.lastTurnTimestamps.set(name, Date.now());

        // Auto-destroy if requested
        if (autoDestroy && !agent.isDestroyed) {
          agent.destroy();
          ctx.agents.delete(name);
          ctx.lastTurnTimestamps.delete(name);
        }

        return {
          success: true,
          agent: name,
          status: response.status,
          result: response.output_text,
          totalTokens: response.usage?.total_tokens,
          destroyed: autoDestroy,
        };
      } catch (error) {
        // Auto-destroy on failure too if requested
        if (autoDestroy && !agent.isDestroyed) {
          agent.destroy();
          ctx.agents.delete(name);
          ctx.lastTurnTimestamps.delete(name);
        }

        return {
          success: false,
          agent: name,
          error: error instanceof Error ? error.message : String(error),
          destroyed: autoDestroy,
        };
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
    permission: { scope: 'always', riskLevel: 'low' },
    describeCall: (args) => `assign ${args.agent}`,
  };
}

// ============================================================================
// delegate_interactive — Hand session to sub-agent
// ============================================================================

function buildDelegateInteractiveTool(ctx: OrchestrationToolsContext): ToolFunction {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'delegate_interactive',
        description: `Hand the user-facing conversation to a specialist agent for an interactive session. After delegation, the user's messages go directly to this agent — you step back and monitor. Use this when the user needs an extended back-and-forth with a specialist (e.g. pair-programming, iterative design, tutoring, debugging).

Monitoring modes:
- "passive" (default): exchanges are logged to workspace; you review when control returns.
- "active": after each delegated turn you get a summary and can intervene or attach other agents.
- "event": you are notified only when a specific workspace key appears.

Control returns to you when: the user says a reclaim keyword, maxTurns is reached, a workspace key appears, or you destroy the agent. You then get a summary turn to wrap up for the user.`,
        parameters: {
          type: 'object',
          properties: {
            agent: { type: 'string', description: 'Agent name to delegate to' },
            type: { type: 'string', description: 'Agent type (required if agent does not exist yet)' },
            monitoring: {
              type: 'string',
              enum: ['passive', 'active', 'event'],
              description: 'Monitoring mode: "passive" (log only, default), "active" (you review each turn), "event" (workspace key triggers reclaim)',
            },
            reclaimOn: {
              type: 'object',
              properties: {
                keyword: { type: 'string', description: 'User keyword that ends the session (e.g., "done", "back")' },
                maxTurns: { type: 'number', description: 'Auto-reclaim after N turns' },
                workspaceKey: { type: 'string', description: 'Reclaim when this workspace key appears' },
              },
              description: 'Conditions that automatically end the delegated session',
            },
            briefing: { type: 'string', description: 'Optional context/instructions to give the agent before the user starts talking' },
          },
          required: ['agent'],
        },
      },
    },
    execute: async (args: Record<string, unknown>) => {
      const name = args.agent as string;
      const type = args.type as string | undefined;
      const defaults = ctx.delegationDefaults;
      const monitoring = (args.monitoring as DelegationState['monitoring']) ?? defaults?.monitoring ?? 'passive';
      const reclaimOn = (args.reclaimOn as DelegationReclaimConfig) ?? defaults?.reclaimOn ?? {};
      const briefing = args.briefing as string | undefined;

      // Can't delegate if already delegated
      if (ctx.delegationState.active) {
        return {
          success: false,
          error: `Already delegated to "${ctx.delegationState.agentName}". Reclaim first or destroy that agent.`,
        };
      }

      const agentOrError = getOrCreateAgent(ctx, name, type);
      if (isAgentError(agentOrError)) {
        return { success: false, error: agentOrError.error };
      }
      const agent = agentOrError;

      // Can't delegate to a running agent
      if (agent.isRunning()) {
        return {
          success: false,
          error: `Agent "${name}" is currently running. Wait for it to finish before delegating.`,
        };
      }

      // Send briefing if provided
      if (briefing) {
        agent.inject(briefing, 'developer');
      }

      // Set delegation state
      ctx.delegationState.active = true;
      ctx.delegationState.agentName = name;
      ctx.delegationState.monitoring = monitoring;
      ctx.delegationState.reclaimOn = reclaimOn;
      ctx.delegationState.turnCount = 0;

      return {
        success: true,
        agent: name,
        monitoring,
        reclaimOn,
        message: `Session delegated to "${name}". User messages will now go directly to this agent.`,
      };
    },
    permission: { scope: 'always', riskLevel: 'low' },
    describeCall: (args) => `delegate → ${args.agent}`,
  };
}

// ============================================================================
// send_message — Inject message into agent
// ============================================================================

function buildSendMessageTool(ctx: OrchestrationToolsContext): ToolFunction {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'send_message',
        description: `Inject a message into an agent's context without assigning a new turn. If the agent is currently running, it sees the message on its next loop iteration. If idle, it sees it at the start of the next assign_turn. Use this to:
- Provide mid-turn guidance or corrections to a running agent.
- Send follow-up context that doesn't warrant a full new turn.
- Coordinate between agents (e.g. "Agent B finished — here's what it found: ...").`,
        parameters: {
          type: 'object',
          properties: {
            agent: { type: 'string', description: 'Agent name' },
            message: { type: 'string', description: 'Message to send' },
          },
          required: ['agent', 'message'],
        },
      },
    },
    execute: async (args: Record<string, unknown>) => {
      const name = args.agent as string;
      const message = args.message as string;

      const agent = ctx.agents.get(name);
      if (!agent) {
        return { success: false, error: `Agent "${name}" not found.` };
      }
      if (agent.isDestroyed) {
        return { success: false, error: `Agent "${name}" is destroyed.` };
      }

      agent.inject(message);
      return { success: true, agent: name, message: `Message sent to "${name}".` };
    },
    permission: { scope: 'always', riskLevel: 'low' },
    describeCall: (args) => `message → ${args.agent}`,
  };
}

// ============================================================================
// list_agents — Status + delegation info
// ============================================================================

function buildListAgentsTool(ctx: OrchestrationToolsContext): ToolFunction {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'list_agents',
        description: 'Show all worker agents with their current status (running/idle/paused/destroyed), model, and whether they hold the delegated interactive session. Also shows delegation details (monitoring mode, turn count, reclaim conditions) if a delegation is active.',
        parameters: { type: 'object', properties: {}, required: [] },
      },
    },
    execute: async () => {
      const agents = Array.from(ctx.agents.entries()).map(([name, agent]) => ({
        name,
        model: agent.model,
        status: agent.isRunning() ? 'running' : agent.isPaused() ? 'paused' : 'idle',
        isDestroyed: agent.isDestroyed,
        isDelegated: ctx.delegationState.active && ctx.delegationState.agentName === name,
      }));

      return {
        agents,
        total: agents.length,
        delegation: ctx.delegationState.active
          ? {
              agent: ctx.delegationState.agentName,
              monitoring: ctx.delegationState.monitoring,
              turnCount: ctx.delegationState.turnCount,
              reclaimOn: ctx.delegationState.reclaimOn,
            }
          : null,
      };
    },
    permission: { scope: 'always', riskLevel: 'low' },
    describeCall: () => 'list agents',
  };
}

// ============================================================================
// destroy_agent — With delegation reclaim
// ============================================================================

function buildDestroyAgentTool(ctx: OrchestrationToolsContext): ToolFunction {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'destroy_agent',
        description: 'Destroy a worker agent and free its resources. If this agent currently holds the delegated interactive session, delegation is automatically reclaimed and control returns to you. Cannot destroy a running agent — wait for it to finish first. Destroy agents you no longer need to free up slots (max agent limit applies).',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Name of the agent to destroy' },
          },
          required: ['name'],
        },
      },
    },
    execute: async (args: Record<string, unknown>) => {
      const name = args.name as string;
      const agent = ctx.agents.get(name);
      if (!agent) {
        return { success: false, error: `Agent "${name}" not found.` };
      }
      if (agent.isRunning()) {
        return { success: false, error: `Agent "${name}" is currently running. Wait for it to finish or cancel it first.` };
      }

      // Auto-reclaim delegation if destroying the delegated agent
      const wasDelegated = ctx.delegationState.active && ctx.delegationState.agentName === name;
      if (wasDelegated) {
        ctx.delegationState.active = false;
        ctx.delegationState.agentName = '';
        ctx.delegationState.monitoring = 'passive';
        ctx.delegationState.turnCount = 0;
        ctx.delegationState.reclaimOn = {};
      }

      agent.destroy();
      ctx.agents.delete(name);
      ctx.lastTurnTimestamps.delete(name);

      return {
        success: true,
        name,
        message: `Agent "${name}" destroyed.${wasDelegated ? ' Delegation reclaimed.' : ''}`,
        delegationReclaimed: wasDelegated,
      };
    },
    permission: { scope: 'always', riskLevel: 'low' },
    describeCall: (args) => `destroy ${args.name}`,
  };
}
