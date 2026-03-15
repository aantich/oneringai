/**
 * Orchestration Tools - Tools given to the orchestrator Agent for managing worker agents.
 *
 * 7 tools:
 * - create_agent: Spawn a worker agent from predefined types
 * - list_agents: See team status
 * - destroy_agent: Remove a worker
 * - assign_turn: Assign a turn and wait for result (blocking)
 * - assign_turn_async: Assign a turn without waiting (non-blocking, result delivered via async continuation)
 * - assign_parallel: Fan-out to multiple agents, wait for all
 * - send_message: Inject a message into an agent's context
 */

import type { ToolFunction } from '../../domain/entities/Tool.js';
import type { Agent } from '../Agent.js';
import type { SharedWorkspacePluginNextGen } from '../context-nextgen/plugins/SharedWorkspacePluginNextGen.js';
import type { AgentTypeConfig } from './createOrchestrator.js';

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
  /** Maximum number of worker agents (M2, default: 20) */
  maxAgents?: number;
}

// ============================================================================
// Workspace Delta Builder
// ============================================================================

/** Maximum entries/log lines in a workspace delta to prevent unbounded growth (L1) */
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

  // L1: Cap delta entries to prevent very large deltas
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
// Tool Builders
// ============================================================================

export function buildOrchestrationTools(ctx: OrchestrationToolsContext): ToolFunction[] {
  return [
    buildCreateAgentTool(ctx),
    buildListAgentsTool(ctx),
    buildDestroyAgentTool(ctx),
    buildAssignTurnTool(ctx),
    buildAssignTurnAsyncTool(ctx),
    buildAssignParallelTool(ctx),
    buildSendMessageTool(ctx),
  ];
}

// ============================================================================
// Team Management Tools
// ============================================================================

function buildCreateAgentTool(ctx: OrchestrationToolsContext): ToolFunction {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'create_agent',
        description: 'Spawn a new worker agent from a predefined type.',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Unique name for this agent instance (e.g., "architect", "reviewer-1")' },
            type: { type: 'string', description: 'Agent type from available types' },
          },
          required: ['name', 'type'],
        },
      },
    },
    descriptionFactory: () => {
      const types = Array.from(ctx.agentTypes.entries())
        .map(([id, cfg]) => `- "${id}": ${cfg.systemPrompt.slice(0, 100)}...`)
        .join('\n');
      return `Spawn a new worker agent from a predefined type.\n\nAvailable types:\n${types}`;
    },
    execute: async (args: Record<string, unknown>) => {
      const name = args.name as string;
      const type = args.type as string;

      if (ctx.agents.has(name)) {
        return { success: false, error: `Agent "${name}" already exists. Use a different name.` };
      }
      if (!ctx.agentTypes.has(type)) {
        const available = Array.from(ctx.agentTypes.keys()).join(', ');
        return { success: false, error: `Unknown agent type "${type}". Available: ${available}` };
      }

      // M2: Enforce max agents limit
      const maxAgents = ctx.maxAgents ?? 20;
      if (ctx.agents.size >= maxAgents) {
        return { success: false, error: `Maximum agent limit (${maxAgents}) reached. Destroy unused agents first.` };
      }

      const agent = ctx.createWorkerAgent(name, type);
      ctx.agents.set(name, agent);

      return { success: true, name, type, message: `Agent "${name}" (type: ${type}) created and ready.` };
    },
    permission: { scope: 'always', riskLevel: 'low' },
    describeCall: (args) => `create ${args.name} (${args.type})`,
  };
}

function buildListAgentsTool(ctx: OrchestrationToolsContext): ToolFunction {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'list_agents',
        description: 'List all worker agents and their current status.',
        parameters: { type: 'object', properties: {}, required: [] },
      },
    },
    execute: async () => {
      const agents = Array.from(ctx.agents.entries()).map(([name, agent]) => ({
        name,
        model: agent.model,
        status: agent.isRunning() ? 'running' : agent.isPaused() ? 'paused' : 'idle',
        isDestroyed: agent.isDestroyed,
      }));
      return { agents, total: agents.length };
    },
    permission: { scope: 'always', riskLevel: 'low' },
    describeCall: () => 'list agents',
  };
}

function buildDestroyAgentTool(ctx: OrchestrationToolsContext): ToolFunction {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'destroy_agent',
        description: 'Destroy a worker agent and free its resources.',
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
      // M1: Don't destroy a running agent — cancel first
      if (agent.isRunning()) {
        return { success: false, error: `Agent "${name}" is currently running. Wait for it to finish or cancel it first.` };
      }
      agent.destroy();
      ctx.agents.delete(name);
      ctx.lastTurnTimestamps.delete(name);
      return { success: true, name, message: `Agent "${name}" destroyed.` };
    },
    permission: { scope: 'always', riskLevel: 'low' },
    describeCall: (args) => `destroy ${args.name}`,
  };
}

// ============================================================================
// Turn Assignment Tools
// ============================================================================

function buildAssignTurnTool(ctx: OrchestrationToolsContext): ToolFunction {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'assign_turn',
        description: 'Assign a turn to an agent and WAIT for the result. Use this for sequential work where you need the result before deciding the next step.',
        parameters: {
          type: 'object',
          properties: {
            agent: { type: 'string', description: 'Agent name' },
            instruction: { type: 'string', description: 'What the agent should do this turn' },
            timeout: { type: 'number', description: 'Timeout in seconds (default: 300)' },
          },
          required: ['agent', 'instruction'],
        },
      },
    },
    execute: async (args: Record<string, unknown>) => {
      const name = args.agent as string;
      const instruction = args.instruction as string;
      const timeoutMs = ((args.timeout as number) ?? 300) * 1000;

      const agent = ctx.agents.get(name);
      if (!agent) {
        return { success: false, error: `Agent "${name}" not found. Create it first with create_agent.` };
      }
      if (agent.isDestroyed) {
        return { success: false, error: `Agent "${name}" is destroyed.` };
      }

      const delta = buildWorkspaceDelta(name, ctx.workspace, ctx.lastTurnTimestamps);
      const fullInstruction = delta + instruction;

      // C1: Track timer so we can clear it when agent.run() resolves first
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const response = await Promise.race([
          agent.run(fullInstruction),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error(`Turn timed out after ${timeoutMs / 1000}s`)), timeoutMs);
          }),
        ]);

        ctx.lastTurnTimestamps.set(name, Date.now());

        return {
          success: true,
          agent: name,
          result: response.output_text,
          totalTokens: response.usage?.total_tokens,
        };
      } catch (error) {
        return {
          success: false,
          agent: name,
          error: error instanceof Error ? error.message : String(error),
        };
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
    permission: { scope: 'always', riskLevel: 'low' },
    describeCall: (args) => `assign ${args.agent} (blocking)`,
  };
}

function buildAssignTurnAsyncTool(ctx: OrchestrationToolsContext): ToolFunction {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'assign_turn_async',
        description: 'Assign a turn to an agent WITHOUT waiting. The result will be delivered later as a follow-up message. Use this to run multiple agents in parallel or to continue planning while an agent works.',
        parameters: {
          type: 'object',
          properties: {
            agent: { type: 'string', description: 'Agent name' },
            instruction: { type: 'string', description: 'What the agent should do this turn' },
            timeout: { type: 'number', description: 'Timeout in seconds (default: 300)' },
          },
          required: ['agent', 'instruction'],
        },
      },
      // Non-blocking: result delivered via async tool continuation
      blocking: false,
      timeout: 300000,
    },
    execute: async (args: Record<string, unknown>) => {
      const name = args.agent as string;
      const instruction = args.instruction as string;
      const timeoutMs = ((args.timeout as number) ?? 300) * 1000;

      const agent = ctx.agents.get(name);
      if (!agent) {
        // Return error immediately — even async tools return synchronously on validation errors
        return { success: false, error: `Agent "${name}" not found. Create it first with create_agent.` };
      }
      if (agent.isDestroyed) {
        return { success: false, error: `Agent "${name}" is destroyed.` };
      }

      const delta = buildWorkspaceDelta(name, ctx.workspace, ctx.lastTurnTimestamps);
      const fullInstruction = delta + instruction;

      // This runs the full worker agentic loop.
      // Because the tool is blocking: false, the orchestrator gets a placeholder
      // immediately, and this promise resolving triggers auto-continuation.
      // C1: Track timer so we can clear it when agent.run() resolves first
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const response = await Promise.race([
          agent.run(fullInstruction),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error(`Turn timed out after ${timeoutMs / 1000}s`)), timeoutMs);
          }),
        ]);

        ctx.lastTurnTimestamps.set(name, Date.now());

        return {
          success: true,
          agent: name,
          result: response.output_text,
          totalTokens: response.usage?.total_tokens,
        };
      } catch (error) {
        return {
          success: false,
          agent: name,
          error: error instanceof Error ? error.message : String(error),
        };
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
    permission: { scope: 'always', riskLevel: 'low' },
    describeCall: (args) => `assign ${args.agent} (async)`,
  };
}

function buildAssignParallelTool(ctx: OrchestrationToolsContext): ToolFunction {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'assign_parallel',
        description: 'Assign turns to multiple agents simultaneously and wait for ALL results. Use this for independent tasks that can run in parallel.',
        parameters: {
          type: 'object',
          properties: {
            assignments: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  agent: { type: 'string', description: 'Agent name' },
                  instruction: { type: 'string', description: 'What this agent should do' },
                },
                required: ['agent', 'instruction'],
              },
              description: 'Array of { agent, instruction } assignments',
            },
            timeout: { type: 'number', description: 'Timeout in seconds for each agent (default: 300)' },
          },
          required: ['assignments'],
        },
      },
    },
    execute: async (args: Record<string, unknown>) => {
      const assignments = args.assignments as Array<{ agent: string; instruction: string }>;
      const timeoutMs = ((args.timeout as number) ?? 300) * 1000;

      if (!assignments || assignments.length === 0) {
        return { success: false, error: 'No assignments provided.' };
      }

      // L2: Validate no duplicate agents (would cause concurrent runs on same context)
      const agentNames = assignments.map(a => a.agent);
      const uniqueNames = new Set(agentNames);
      if (uniqueNames.size !== agentNames.length) {
        const duplicates = agentNames.filter((n, i) => agentNames.indexOf(n) !== i);
        return { success: false, error: `Duplicate agents in assignments: ${[...new Set(duplicates)].join(', ')}. Each agent can only appear once.` };
      }

      // Validate all agents exist first
      for (const a of assignments) {
        if (!ctx.agents.has(a.agent)) {
          return { success: false, error: `Agent "${a.agent}" not found. Create it first.` };
        }
      }

      // Run all in parallel
      const promises = assignments.map(async (a) => {
        const agent = ctx.agents.get(a.agent)!;
        const delta = buildWorkspaceDelta(a.agent, ctx.workspace, ctx.lastTurnTimestamps);
        const fullInstruction = delta + a.instruction;

        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const response = await Promise.race([
            agent.run(fullInstruction),
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => reject(new Error(`Timed out after ${timeoutMs / 1000}s`)), timeoutMs);
            }),
          ]);

          ctx.lastTurnTimestamps.set(a.agent, Date.now());

          return {
            agent: a.agent,
            success: true,
            result: response.output_text,
            totalTokens: response.usage?.total_tokens,
          };
        } catch (error) {
          return {
            agent: a.agent,
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
        } finally {
          if (timer) clearTimeout(timer);
        }
      });

      const results = await Promise.allSettled(promises);
      const outcomes = results.map(r => r.status === 'fulfilled' ? r.value : { success: false, error: 'Unexpected error' });

      return {
        success: outcomes.every(o => o.success),
        results: outcomes,
        total: outcomes.length,
        succeeded: outcomes.filter(o => o.success).length,
        failed: outcomes.filter(o => !o.success).length,
      };
    },
    permission: { scope: 'always', riskLevel: 'low' },
    describeCall: (args) => {
      const assignments = args.assignments as Array<{ agent: string }> | undefined;
      return `parallel: ${assignments?.map(a => a.agent).join(', ') ?? '?'}`;
    },
  };
}

// ============================================================================
// Communication Tools
// ============================================================================

function buildSendMessageTool(ctx: OrchestrationToolsContext): ToolFunction {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'send_message',
        description: 'Send a message to an agent. If the agent is running, the message will be injected into its context on the next iteration. If idle, it will be seen on the next turn.',
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
