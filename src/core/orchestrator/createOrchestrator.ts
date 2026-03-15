/**
 * createOrchestrator - Factory for creating an orchestrator Agent
 *
 * The orchestrator is a regular Agent with:
 * - A SharedWorkspacePlugin (shared with all workers)
 * - 7 orchestration tools for managing worker agents
 * - A system prompt that describes available agent types and coordination patterns
 * - Async tool support for non-blocking turn assignment
 *
 * Workers are persistent Agent instances that remember reasoning across turns.
 * All agents share the same workspace for artifact coordination.
 */

import { Agent } from '../Agent.js';
import type { AgentConfig } from '../Agent.js';
import type { ToolFunction } from '../../domain/entities/Tool.js';
import { SharedWorkspacePluginNextGen } from '../context-nextgen/plugins/SharedWorkspacePluginNextGen.js';
import type { SharedWorkspaceConfig } from '../context-nextgen/plugins/SharedWorkspacePluginNextGen.js';
import type { ContextFeatures, PluginConfigs } from '../context-nextgen/types.js';
import { buildOrchestrationTools } from './tools.js';
import type { OrchestrationToolsContext } from './tools.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Configuration for an agent type that the orchestrator can spawn.
 */
export interface AgentTypeConfig {
  /** System prompt defining this agent's role and behavior */
  systemPrompt: string;
  /** Additional tools specific to this agent type */
  tools?: ToolFunction[];
  /** Model override (defaults to orchestrator's model) */
  model?: string;
  /** Connector override (defaults to orchestrator's connector) */
  connector?: string;
  /** Context features for this agent type */
  features?: Partial<ContextFeatures>;
  /** Plugin configurations for this agent type */
  plugins?: PluginConfigs;
}

/**
 * Configuration for the orchestrator.
 */
export interface OrchestratorConfig {
  /** Connector name for LLM access */
  connector: string;
  /** Model to use for the orchestrator (also default for workers) */
  model: string;
  /** Custom system prompt (overrides the auto-generated one) */
  systemPrompt?: string;
  /** Available agent types that can be spawned */
  agentTypes: Record<string, AgentTypeConfig>;
  /** SharedWorkspace configuration */
  workspace?: Partial<SharedWorkspaceConfig>;
  /** Additional context features for the orchestrator */
  features?: Partial<ContextFeatures>;
  /** Plugin configurations for the orchestrator */
  pluginConfigs?: PluginConfigs;
  /** Agent name for the orchestrator (default: 'orchestrator') */
  name?: string;
  /** Agent ID for session persistence */
  agentId?: string;
  /** Max iterations for the orchestrator's agentic loop (default: 100) */
  maxIterations?: number;
  /** Maximum number of worker agents (default: 20) */
  maxAgents?: number;
}

// ============================================================================
// System Prompt Builder
// ============================================================================

function buildDefaultSystemPrompt(config: OrchestratorConfig): string {
  const typeDescriptions = Object.entries(config.agentTypes)
    .map(([id, cfg]) => {
      const desc = cfg.systemPrompt.length > 200
        ? cfg.systemPrompt.slice(0, 200) + '...'
        : cfg.systemPrompt;
      return `- **"${id}"**: ${desc}`;
    })
    .join('\n');

  return `You are a team lead coordinating specialized AI agents to accomplish complex tasks.

## Available Agent Types
${typeDescriptions}

## How to Work

1. **Create agents** using \`create_agent(name, type)\` — each agent is a persistent worker that remembers its reasoning across turns.
2. **Assign turns** to agents:
   - \`assign_turn(agent, instruction)\` — BLOCKING. Wait for the result before deciding next step. Use for sequential work.
   - \`assign_turn_async(agent, instruction)\` — NON-BLOCKING. Agent works in the background; result delivered later. Use to run multiple agents simultaneously.
   - \`assign_parallel([{agent, instruction}, ...])\` — Run multiple agents at once, wait for ALL results.
3. **Monitor progress** via the shared workspace (\`store_get("workspace", key)\`, \`store_list("workspace")\`).
4. **Communicate** with agents using \`send_message(agent, message)\` — inject instructions into a running or idle agent.

## Shared Workspace
All agents share a workspace for tracking artifacts, plans, and status. Use \`store_set("workspace", key, { summary, content?, references?, status? })\` to post updates. Agents see workspace changes automatically at the start of each turn.

## Coordination Patterns
- **Sequential review cycle**: architect → critic → architect (revise) → developer → critic → developer (fix) → accept
- **Parallel research**: spawn multiple researchers with different focuses, synthesize results
- **Fan-out/fan-in**: assign independent subtasks in parallel, then merge results
- **Iterative refinement**: assign, review result, provide feedback, reassign

## Guidelines
- Create agents only when needed — reuse existing agents across turns.
- Use the workspace to share artifacts between agents — don't relay content manually.
- Each agent has its own context and tools. They read shared artifacts from the workspace.
- When an agent's turn result is unsatisfactory, provide specific feedback and reassign.
- Destroy agents when they're no longer needed to free resources.`;
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create an orchestrator Agent that can coordinate a team of worker agents.
 *
 * @example
 * ```typescript
 * const orchestrator = createOrchestrator({
 *   connector: 'openai',
 *   model: 'gpt-4',
 *   agentTypes: {
 *     architect: {
 *       systemPrompt: 'You are a senior software architect...',
 *       tools: [readFile, writeFile],
 *     },
 *     critic: {
 *       systemPrompt: 'You are a thorough code reviewer...',
 *       tools: [readFile, grep],
 *     },
 *     developer: {
 *       systemPrompt: 'You are a senior developer...',
 *       tools: [readFile, writeFile, editFile, bash],
 *     },
 *   },
 * });
 *
 * const result = await orchestrator.run('Build an auth module with JWT support');
 * ```
 */
export function createOrchestrator(config: OrchestratorConfig): Agent {
  // ---- Closure state ----
  const workspace = new SharedWorkspacePluginNextGen(config.workspace);
  const agents = new Map<string, Agent>();
  const agentTypes = new Map<string, AgentTypeConfig>(Object.entries(config.agentTypes));
  const lastTurnTimestamps = new Map<string, number>();

  // M5: Deferred reference — resolved lazily after orchestratorAgent is created
  let orchestratorRegistryId: string | undefined;

  // ---- Worker factory (closure over shared state) ----
  function createWorkerAgent(name: string, type: string): Agent {
    const typeConfig = agentTypes.get(type);
    if (!typeConfig) {
      throw new Error(`Unknown agent type "${type}"`);
    }

    const agent = Agent.create({
      name,
      connector: typeConfig.connector ?? config.connector,
      model: typeConfig.model ?? config.model,
      instructions: typeConfig.systemPrompt,
      tools: typeConfig.tools,
      context: {
        features: {
          workingMemory: true,
          inContextMemory: true,
          ...typeConfig.features,
          // Workers don't auto-create their own workspace — we register the shared one
          sharedWorkspace: false,
        },
        plugins: typeConfig.plugins,
      },
      parentAgentId: orchestratorRegistryId,
    } as AgentConfig);

    // C2: Register the SHARED workspace plugin on this worker.
    // We skip destroy on this plugin from the worker context — the orchestrator owns it.
    agent.context.registerPlugin(workspace, { skipDestroyOnContextDestroy: true });

    return agent;
  }

  // ---- Build orchestration tools ----
  const toolsContext: OrchestrationToolsContext = {
    workspace,
    agents,
    agentTypes,
    lastTurnTimestamps,
    createWorkerAgent,
    maxAgents: config.maxAgents,
  };

  const orchestrationTools = buildOrchestrationTools(toolsContext);

  // ---- Create orchestrator Agent ----
  const systemPrompt = config.systemPrompt ?? buildDefaultSystemPrompt(config);

  const orchestratorAgent = Agent.create({
    name: config.name ?? 'orchestrator',
    connector: config.connector,
    model: config.model,
    instructions: systemPrompt,
    tools: orchestrationTools,
    maxIterations: config.maxIterations ?? 100,
    asyncTools: {
      autoContinue: true,
      batchWindowMs: 500,
    },
    context: {
      agentId: config.agentId,
      features: {
        workingMemory: true,
        inContextMemory: true,
        ...config.features,
        // Don't auto-create workspace — we register the shared one manually
        sharedWorkspace: false,
      },
      plugins: config.pluginConfigs,
    },
  } as AgentConfig);

  // M5: Now that orchestratorAgent exists, capture its registryId for future workers
  orchestratorRegistryId = orchestratorAgent.registryId;

  // Register the shared workspace on the orchestrator (orchestrator owns it — will destroy on cleanup)
  orchestratorAgent.context.registerPlugin(workspace);

  // C3: Wrap destroy to clean up all workers + shared workspace
  const originalDestroy = orchestratorAgent.destroy.bind(orchestratorAgent);
  orchestratorAgent.destroy = () => {
    // Destroy all worker agents first (collect before iterating to avoid mutation during iteration)
    const workerAgents = Array.from(agents.values());
    for (const worker of workerAgents) {
      if (!worker.isDestroyed) {
        worker.destroy();
      }
    }
    agents.clear();
    lastTurnTimestamps.clear();

    // Now destroy the orchestrator (which will destroy workspace via its context)
    originalDestroy();
  };

  return orchestratorAgent;
}
