/**
 * createOrchestrator v2 - Factory for creating a conversational orchestrator Agent
 *
 * The orchestrator is a regular Agent with:
 * - A SharedWorkspacePlugin (shared with all workers)
 * - 6 orchestration tools for managing worker agents
 * - 3-tier routing: DIRECT / DELEGATE / ORCHESTRATE
 * - All-async execution model (orchestrator never blocks on sub-agents)
 * - Interactive delegation with monitoring and auto-reclaim
 * - Rich agent type descriptions for intelligent routing
 * - Optional LLM-generated descriptions (autoDescribe)
 *
 * Workers are persistent Agent instances that remember reasoning across turns.
 * All agents share the same workspace for artifact coordination.
 */

import { Agent } from '../Agent.js';
import { FactoryPolicy, STORE_NAMES, ORCHESTRATION_NAMES } from './factoryPolicy.js';
import { checkFactoryConfig, detachFactoryConfig } from './factoryConfig.js';
import { markOrchestratorConstruction } from './construction.js';
import type { OrchestratedAgentConfig, OrchestratorFactoryOptions } from './factoryTypes.js';
import type { ExecutionBinding } from '../execution/composition.js';
import type { AgentConfig, RunOptions } from '../Agent.js';
import type { AgentResponse } from '../../domain/entities/Response.js';
import { StreamEventType } from '../../domain/entities/StreamEvent.js';
import type { StreamEvent } from '../../domain/entities/StreamEvent.js';
import type { InputItem } from '../../domain/entities/Message.js';
import type { ToolFunction } from '../../domain/entities/Tool.js';
import { SharedWorkspacePluginNextGen } from '../context-nextgen/plugins/SharedWorkspacePluginNextGen.js';
import type { SharedWorkspaceConfig } from '../context-nextgen/plugins/SharedWorkspacePluginNextGen.js';
import type { ContextFeatures, PluginConfigs } from '../context-nextgen/types.js';
import { buildOrchestrationTools, createDelegationState } from './tools.js';
import type { OrchestrationToolsContext, DelegationState } from './tools.js';
import { logger } from '../../infrastructure/observability/Logger.js';
import { parseJsonPermissive } from '../../utils/jsonRepair.js';

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

  // ---- Rich descriptions for orchestrator routing ----

  /** One-liner describing the agent's role (e.g., "Senior developer who writes and tests code") */
  description?: string;
  /** Typical scenarios when this agent should be used (e.g., ["implementing features", "fixing bugs"]) */
  scenarios?: string[];
  /** What this agent can do / what tools it has (e.g., ["read/write files", "run shell commands"]) */
  capabilities?: string[];
}

/**
 * Delegation defaults that apply when delegate_interactive is called
 * without explicit monitoring/reclaimOn parameters.
 */
export interface DelegationDefaults {
  /** Default monitoring mode (default: 'passive') */
  monitoring?: 'passive' | 'active' | 'event';
  /** Default reclaim conditions */
  reclaimOn?: {
    keyword?: string;
    maxTurns?: number;
    workspaceKey?: string;
  };
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
  /** Skip the planning workflow (UNDERSTAND/PLAN/APPROVE phases) and execute directly (default: false) */
  skipPlanning?: boolean;
  /** Additional tools available to the orchestrator itself (for DIRECT route tasks) */
  tools?: ToolFunction[];
  /** Default delegation settings */
  delegationDefaults?: DelegationDefaults;
  /**
   * Auto-generate rich descriptions for agent types that lack explicit description/scenarios/capabilities.
   * Runs a single LLM call at creation time. Makes createOrchestrator return a Promise.
   * Default: false
   */
  autoDescribe?: boolean;
}

// ============================================================================
// System Prompt Builder
// ============================================================================

/**
 * Build the agent types section for the system prompt.
 * Uses rich descriptions when available, falls back to truncated systemPrompt.
 */
function buildAgentTypesSection(agentTypes: Record<string, AgentTypeConfig>): string {
  return Object.entries(agentTypes)
    .map(([id, cfg]) => {
      const parts: string[] = [`### "${id}"`];

      if (cfg.description) {
        parts.push(cfg.description);
      } else {
        // Fallback: full system prompt. A verbose systemPrompt is exactly
        // what helps the orchestrator pick the right agent; clipping it at
        // 200 chars silently hid the agent's specialization. Hosts who want
        // a tight orchestrator view should set `description` explicitly.
        parts.push(cfg.systemPrompt);
      }

      if (cfg.scenarios && cfg.scenarios.length > 0) {
        parts.push(`**Use for:** ${cfg.scenarios.join(', ')}`);
      }

      if (cfg.capabilities && cfg.capabilities.length > 0) {
        parts.push(`**Can:** ${cfg.capabilities.join(', ')}`);
      }

      // If no rich descriptions, show tool names as a hint
      if (!cfg.scenarios && !cfg.capabilities && cfg.tools && cfg.tools.length > 0) {
        const toolNames = cfg.tools.map(t => t.definition.function.name).join(', ');
        parts.push(`**Tools:** ${toolNames}`);
      }

      return parts.join('\n');
    })
    .join('\n\n');
}

/**
 * Build the routing section of the system prompt.
 */
function buildRoutingSection(): string {
  return `## Routing

For EVERY user message, decide the route:

1. **DIRECT** — You can answer this yourself, or handle it with a quick behind-the-scenes agent task.
   - Simple questions you can answer from your own knowledge → respond directly, no agents.
   - Tasks needing specialist tools (research, file operations, etc.) → use \`assign_turn\` with \`autoDestroy: true\`. Present the result as your own — the user doesn't need to know about the sub-agent.
   - This is the default route. When in doubt, start here.

2. **DELEGATE** — The user needs an extended interactive session with a specialist.
   - The user will go back-and-forth with the specialist (pair-programming, iterative design, tutoring, debugging).
   - Use \`delegate_interactive\`. You step back and monitor. Control returns to you when the session ends.
   - Only use this when the interaction genuinely requires multiple turns of user ↔ specialist dialogue.

3. **ORCHESTRATE** — This is a complex multi-step task requiring coordination of multiple agents.
   - Break the work into a plan, get user approval, execute with multiple agents.
   - All agent execution is async — stay conversational between task completions.
   - Tell the user what's running and offer to help with other things while agents work.

**Decision heuristics:**
- One agent, one task, no user interaction needed → DIRECT
- One specialist, extended user dialogue needed → DELEGATE
- Multiple agents, dependencies, complex coordination → ORCHESTRATE`;
}

/**
 * Build the ORCHESTRATE workflow section.
 */
function buildOrchestrateSection(skipPlanning: boolean): string {
  if (skipPlanning) {
    return `## ORCHESTRATE Mode — Direct Execution

When you choose the ORCHESTRATE route:

1. Break the user's request into logical tasks with dependencies.
2. Kick off all independent tasks with multiple \`assign_turn\` calls. Results arrive as follow-up messages.
3. Stay conversational — tell the user what's running, offer to help with other things.
4. As results arrive, evaluate each one:
   - Task complete → update workspace, check if dependent tasks are now unblocked.
   - Task needs clarification → answer from context or ask the user.
   - Task failed → retry with better instructions, try a different agent type, or escalate.
5. Chain dependent tasks: when a prerequisite completes, kick off the tasks that depended on it.
6. When all done, summarize results for the user.

**Coordination Patterns:**
- **Sequential review cycle**: assign architect → review result → assign critic → use feedback → assign developer
- **Parallel research**: multiple assign_turn calls with different researchers on different angles, synthesize results
- **Fan-out/fan-in**: independent subtasks in parallel, then merge results
- **Iterative refinement**: assign, review result, provide feedback via send_message, re-assign`;
  }

  return `## ORCHESTRATE Mode — Planning Workflow

When you choose the ORCHESTRATE route, follow these phases:

### Phase: UNDERSTAND
1. Analyze the user's request.
2. If clear enough to plan → proceed to PLAN.
3. If ambiguous → ask specific questions. Do NOT create agents yet.
4. **FAST-TRACK**: If it maps to a single obvious task → treat as DIRECT instead.

### Phase: PLAN
1. Design the plan. Store it in the workspace:
\`\`\`
store_set("workspace", "plan", {
  summary: "Plan: <goal in ~10 words>",
  status: "proposed",
  content: JSON.stringify({
    goal: "...",
    tasks: [
      { id: "t1", name: "task_name", description: "...", agentType: "type_alias", dependsOn: [], status: "pending" },
      { id: "t2", name: "task_name", description: "...", agentType: "type_alias", dependsOn: ["t1"], status: "pending" }
    ],
    concurrency: { maxParallel: 3 }
  }),
  author: "orchestrator"
})
\`\`\`
2. Present a human-readable summary: goal, numbered tasks with dependency arrows, which run in parallel.
3. Ask: "Shall I proceed, or would you like to modify the plan?"
4. **STOP. Do not create agents or assign turns yet.**

### Phase: APPROVE
The user has replied:
- **Approval** ("go", "yes", "proceed") → Update plan status to "approved", proceed to EXECUTE.
- **Modification** → Revise plan, re-present.
- **Cancel** → Acknowledge, return to conversation.

### Phase: EXECUTE
All execution is **async** — you stay conversational between task completions.

1. Read the plan. Find executable tasks: status "pending" AND all dependsOn "completed".
2. Kick off ready tasks: call \`assign_turn\` for each ready task (multiple calls run concurrently).
3. Tell the user what's running. Offer to help with other things while agents work.
4. As results arrive (follow-up messages), classify each response:
   - **COMPLETE** → Update task status. Check if dependent tasks are now unblocked → kick them off.
   - **QUESTION YOU CAN ANSWER** → Answer and re-assign immediately.
   - **QUESTION REQUIRING HUMAN INPUT** → Ask the user, pause that task.
   - **STUCK/FAILED** → Retry with better instructions, try different agent type, or escalate.
   - **PARTIAL PROGRESS** → Re-assign: "Continue from where you left off: [specific next step]."
5. When all tasks are done → proceed to REPORT.

**3-STRIKE RULE**: After 3 failed re-assignments of the same task: try a different agent type, break it down, or escalate.

### Phase: REPORT
1. Summarize what was accomplished, key outputs, and any items needing attention.
2. Destroy agents no longer needed.`;
}

/**
 * Build the complete system prompt for the orchestrator.
 */
function buildDefaultSystemPrompt(config: OrchestratorConfig): string {
  const agentTypesSection = buildAgentTypesSection(config.agentTypes);
  const routingSection = buildRoutingSection();
  const orchestrateSection = buildOrchestrateSection(config.skipPlanning ?? false);

  return `You are a team lead coordinating specialized AI agents to accomplish tasks for the user. You handle everything from simple questions to complex multi-agent projects.

You are the user's single point of contact. For simple things, answer directly. For tool-heavy tasks, delegate silently. For complex projects, plan and coordinate a team. For specialist interactions, hand off the session.

## Available Agent Types

${agentTypesSection}

## Tools

- \`assign_turn(agent, instruction, type?, autoDestroy?)\` — Kick off work on an agent (async, result arrives later). Auto-creates agent if needed. Call multiple times in one turn to run agents concurrently.
- \`delegate_interactive(agent, type?, monitoring?, reclaimOn?)\` — Hand session to specialist for interactive dialogue.
- \`send_message(agent, message)\` — Inject guidance into a running or idle agent.
- \`list_agents()\` — Show team status.
- \`destroy_agent(name)\` — Remove a worker.

## Shared Workspace
All agents share a workspace. Use \`store_set("workspace", key, { summary, content?, references?, status?, author?, tags? })\` to post updates. Agents see changes automatically at the start of each turn.

| Key pattern | Purpose | Status values |
|------------|---------|---------------|
| \`plan\` | The execution plan (JSON in content) | proposed, approved, executing, completed, failed, cancelled |
| \`task:<id>\` | Individual task tracking | pending, in_progress, completed, failed, skipped |
| \`artifact:<name>\` | Deliverables from workers | draft, final |
| \`delegation:turn:<N>\` | Delegated session exchange log | — |

${routingSection}

${orchestrateSection}

## Async Execution Model

All agent work is non-blocking. When you assign a turn:
1. The agent starts working immediately.
2. You get to continue your conversation with the user.
3. When the agent finishes, the result arrives as a follow-up message.
4. You evaluate the result and decide next steps.

This means you should ALWAYS tell the user what you've started and invite them to continue the conversation:
- "I've started a researcher on that. Anything else while we wait?"
- "Three agents are working on the plan. Want to discuss the design in the meantime?"

## Handling Agent Responses

When an agent result arrives, classify it:

1. **TASK COMPLETE** — Accept, update status, proceed to next step or report to user.
2. **QUESTION YOU CAN ANSWER** — Answer from context/knowledge and re-assign. Do NOT relay to user.
3. **QUESTION REQUIRING HUMAN INPUT** — Ask the user. This should be RARE.
4. **AGENT IS STUCK** — Reformulate instructions, break into smaller steps, or try different agent type.
5. **PARTIAL PROGRESS** — Re-assign with specific continuation instructions.

**DEFAULT TO AUTONOMY**: If you can answer a question or make a decision, DO IT. You are the team lead.

## Guidelines
- Reuse existing agents across turns — don't create and destroy for every task.
- Use autoDestroy only for truly one-shot tasks (DIRECT route).
- Use the workspace to share artifacts — don't relay content manually between agents.
- When re-assigning with feedback, be specific: quote what was wrong, state exactly what to fix.
- Destroy agents when no longer needed to free up slots.`;
}

// ============================================================================
// Auto-Describe (optional LLM-generated agent type descriptions)
// ============================================================================

/**
 * Generate rich descriptions for agent types that lack them.
 * Uses a single LLM call to describe all types at once.
 */
async function autoDescribeAgentTypes(
  orchestrator: Agent,
  agentTypes: Record<string, AgentTypeConfig>,
  execution?: ExecutionBinding,
): Promise<void> {
  // Find types that need descriptions
  const needsDescription = Object.entries(agentTypes)
    .filter(([, cfg]) => !cfg.description);

  if (needsDescription.length === 0) return;

  const typesSummary = needsDescription.map(([id, cfg]) => {
    const toolNames = cfg.tools?.map(t => t.definition.function.name).join(', ') ?? 'none';
    return `Type "${id}":
- System prompt: ${cfg.systemPrompt}
- Tools: ${toolNames}`;
  }).join('\n\n');

  const prompt = `For each agent type below, generate a JSON object with:
- "description": one-sentence role description
- "scenarios": array of 3-5 short phrases describing when to use this agent
- "capabilities": array of 3-5 short phrases describing what this agent can do

Return a JSON object mapping type ID to its description object. No markdown, just JSON.

${typesSummary}`;

  try {
    const response = await orchestrator.runDirect(prompt, {
      temperature: 0.3,
      ...execution,
    });

    const text = response.output_text ?? '';
    const descriptions = parseAutoDescribeResponse(text);
    if (!descriptions) return;

    // Apply generated descriptions to config (mutate in place)
    for (const [id, desc] of Object.entries(descriptions)) {
      const cfg = agentTypes[id];
      if (cfg && !cfg.description) {
        cfg.description = desc.description;
        cfg.scenarios = desc.scenarios;
        cfg.capabilities = desc.capabilities;
      }
    }
  } catch (error) {
    logger.warn({ error }, 'autoDescribe: LLM call failed, using fallback descriptions');
  }
}

/**
 * Describe-object shape returned by the auto-describe LLM call.
 * Exported for unit testing of the response parser.
 */
export interface AgentTypeDescription {
  description?: string;
  scenarios?: string[];
  capabilities?: string[];
}

/**
 * Parse the auto-describe LLM response into a `{ typeId: description }` map.
 *
 * Robust against markdown fences, explanatory prose wrappers, trailing
 * commas, and single-quoted strings that slip through the `json_object`
 * response-format hint on some providers. Returns `undefined` when the
 * response is empty or unparseable — callers treat that as "no descriptions
 * to apply" and fall back to the config-provided defaults.
 *
 * Exported for unit testing; callers should invoke `autoDescribeAgentTypes`
 * instead of calling this directly.
 */
export function parseAutoDescribeResponse(
  text: string,
): Record<string, AgentTypeDescription> | undefined {
  if (!text.trim()) {
    logger.warn('autoDescribe: LLM response was empty');
    return undefined;
  }

  try {
    return parseJsonPermissive(text) as Record<string, AgentTypeDescription>;
  } catch (parseErr) {
    logger.warn(
      { error: (parseErr as Error).message },
      'autoDescribe: could not parse LLM response',
    );
    return undefined;
  }
}

// ============================================================================
// Delegation Handling — run() / stream() wrapping
// ============================================================================

/**
 * Check if any reclaim conditions are met for the current delegation.
 */
function shouldReclaimDelegation(
  delegationState: DelegationState,
  userInput: string,
  workspace: SharedWorkspacePluginNextGen,
): boolean {
  const { reclaimOn, turnCount } = delegationState;

  // Keyword match (case-insensitive, word boundary)
  if (reclaimOn.keyword) {
    const escaped = reclaimOn.keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\b${escaped}\\b`, 'i');
    if (regex.test(userInput)) {
      return true;
    }
  }

  // Max turns reached
  if (reclaimOn.maxTurns && turnCount >= reclaimOn.maxTurns) {
    return true;
  }

  // Workspace key trigger
  if (reclaimOn.workspaceKey && workspace.getEntry(reclaimOn.workspaceKey)) {
    return true;
  }

  return false;
}

/**
 * Reclaim delegation and prepare orchestrator summary turn.
 */
function reclaimDelegation(
  delegationState: DelegationState,
  workspace: SharedWorkspacePluginNextGen,
): string {
  const summary = `Interactive session with "${delegationState.agentName}" ended after ${delegationState.turnCount} turn(s). Check the workspace for delegation:turn:* entries with the full exchange log. Summarize what was accomplished for the user.`;

  // Clean up delegation log entries to prevent workspace bloat
  const entries = workspace.getAllEntries().filter(e => e.key.startsWith('delegation:turn:'));
  for (const entry of entries) {
    workspace.storeDelete(entry.key).catch(() => {});
  }

  delegationState.active = false;
  delegationState.agentName = '';
  delegationState.monitoring = 'passive';
  delegationState.turnCount = 0;
  delegationState.reclaimOn = {};
  return summary;
}

/**
 * Log a delegation exchange to the workspace.
 */
function logDelegationExchange(
  workspace: SharedWorkspacePluginNextGen,
  delegationState: DelegationState,
  userInput: string,
  agentResponse: string,
): void {
  const turnNum = delegationState.turnCount;
  const key = `delegation:turn:${turnNum}`;
  // Use the store API directly (no ToolContext needed)
  // Full delegation turn content — clipping at 500 chars silently dropped
  // the substance of long user prompts / agent responses from the workspace
  // log. See feedback_no_truncation.md.
  workspace.storeSet(key, {
    summary: `Turn ${turnNum}: user asked, agent responded`,
    content: JSON.stringify({
      user: userInput,
      agent: agentResponse,
    }),
    author: 'orchestrator',
    status: 'logged',
  }).catch(() => { /* best-effort logging */ });
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create an orchestrator Agent that can coordinate a team of worker agents.
 *
 * The orchestrator serves as the single point of contact for the user and supports
 * 3 routing modes: DIRECT (answer or silently delegate), DELEGATE (interactive session
 * with a specialist), and ORCHESTRATE (complex multi-agent plans).
 *
 * All agent execution is async — the orchestrator never blocks waiting for sub-agents.
 *
 * @example
 * ```typescript
 * const orchestrator = await createOrchestrator({
 *   connector: 'openai',
 *   model: 'gpt-4',
 *   agentTypes: {
 *     developer: {
 *       systemPrompt: 'You are a senior developer...',
 *       description: 'Senior developer who writes clean, tested code.',
 *       scenarios: ['implementing features', 'fixing bugs', 'writing tests'],
 *       capabilities: ['read/write files', 'run shell commands', 'search code'],
 *       tools: [readFile, writeFile, bash],
 *     },
 *     researcher: {
 *       systemPrompt: 'You are a research specialist...',
 *       description: 'Research specialist with web access.',
 *       scenarios: ['finding documentation', 'comparing libraries'],
 *       capabilities: ['web search', 'web scrape', 'summarize findings'],
 *       tools: [webSearch, webScrape],
 *     },
 *   },
 * });
 *
 * // Simple question → DIRECT
 * const result = await orchestrator.run('What is JWT?');
 *
 * // Tool-heavy task → DIRECT (silently delegates)
 * const result = await orchestrator.run('Research the top 3 auth libraries for Node.js');
 *
 * // Interactive session → DELEGATE
 * const result = await orchestrator.run('Help me debug this auth flow step by step');
 *
 * // Complex task → ORCHESTRATE
 * const result = await orchestrator.run('Build an auth module with JWT, tests, and docs');
 * ```
 */
export async function createOrchestrator(config: OrchestratorConfig): Promise<Agent> {
  return createOrchestratorImplementation(config);
}

/** Complete host configuration before one owned construction. Existing factories remain unchanged. */
export async function createOrchestratorWithFactory(config: OrchestratorConfig, options: OrchestratorFactoryOptions): Promise<Agent> {
  if (!options || typeof options.configureAgent !== 'function') throw new Error('configureAgent is required');
  return createOrchestratorImplementation(detachFactoryConfig(config), options);
}

async function createOrchestratorImplementation(config: OrchestratorConfig, factory?: OrchestratorFactoryOptions): Promise<Agent> {
  // ---- Closure state ----
  const workspace = new SharedWorkspacePluginNextGen(config.workspace);
  const agents = new Map<string, Agent>();
  const agentTypes = new Map<string, AgentTypeConfig>(Object.entries(config.agentTypes));
  const lastTurnTimestamps = new Map<string, number>();
  const delegationState = createDelegationState();

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

    // Register the SHARED workspace plugin on this worker.
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
    delegationState,
    delegationDefaults: config.delegationDefaults,
  };

  const selected = factory ? new FactoryPolicy(toolsContext, factory, type => {
    const own = agentTypes.get(type)!;
    return detachFactoryConfig({ connector: own.connector ?? config.connector, model: own.model ?? config.model,
      instructions: own.systemPrompt, tools: own.tools, context: { model: own.model ?? config.model, features: { workingMemory: true, inContextMemory: true,
        ...own.features, sharedWorkspace: false }, plugins: own.plugins } });
  }) : undefined;
  const orchestrationTools = buildOrchestrationTools(toolsContext);

  // ---- Create orchestrator Agent ----
  const systemPrompt = config.systemPrompt ?? buildDefaultSystemPrompt(config);

  const parentBaseline: OrchestratedAgentConfig = {
    connector: config.connector,
    model: config.model,
    instructions: systemPrompt,
    tools: selected ? config.tools : config.tools ? [...orchestrationTools, ...config.tools] : orchestrationTools,
    maxIterations: config.maxIterations ?? 100,
    asyncTools: {
      autoContinue: true,
      batchWindowMs: 500,
    },
    context: {
      model: config.model,
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
  };
  let effective = parentBaseline;
  if (factory) {
    try { effective = checkFactoryConfig(await factory.configureAgent({ role: 'parent', name: config.name ?? 'orchestrator',
      baseline: detachFactoryConfig(parentBaseline) }), new Set([...STORE_NAMES, ...ORCHESTRATION_NAMES])); }
    catch (error) { workspace.destroy(); throw error; }
  }
  // Baseline excludes reserved tools; the host returns a complete configuration.
  const parentContext = { model: effective.model, ...effective.context };
  if (selected) markOrchestratorConstruction(parentContext, { version: 1, workspace, worker: false, deferWorkspaceDestroy: true, registry: effective.registry });
  let orchestratorAgent: Agent;
  try { orchestratorAgent = Agent.create({ ...effective, name: config.name ?? 'orchestrator',
    tools: selected ? [...(effective.tools ?? []), ...orchestrationTools] : effective.tools,
    context: parentContext }); }
  catch (error) { workspace.destroy(); throw error; }

  // M5: Now that orchestratorAgent exists, capture its registryId for future workers
  orchestratorRegistryId = orchestratorAgent.registryId;

  // Register the shared workspace on the orchestrator (orchestrator owns it — will destroy on cleanup)
  if (selected) selected.attach(orchestratorAgent, effective);
  else orchestratorAgent.context.registerPlugin(workspace);

  // ---- Auto-describe agent types if requested ----
  if (config.autoDescribe) {
    await autoDescribeAgentTypes(orchestratorAgent, config.agentTypes, factory?.descriptionExecution);
    // Rebuild system prompt with generated descriptions if we didn't get a custom one
    if (!config.systemPrompt && (!selected || effective.instructions === systemPrompt && effective.context?.systemPrompt === undefined)) {
      // Update the orchestrator's instructions with the enriched descriptions
      orchestratorAgent.context.systemPrompt = buildDefaultSystemPrompt(config);
    }
  }

  // This owned call is part of the selected parent's execution. Public runDirect
  // and legacy monitoring keep their ordinary defaults.
  const monitorOptions = selected ? { instructions: effective.instructions, temperature: effective.temperature,
    thinking: effective.thinking, vendorOptions: effective.vendorOptions, promptCache: effective.promptCache,
    nativeTools: effective.nativeTools, dataHandling: effective.dataHandling } : {};

  // ---- Wrap run() for delegation support ----
  const originalRun = orchestratorAgent.run.bind(orchestratorAgent);

  orchestratorAgent.run = async (
    input: string | InputItem[],
    options?: RunOptions,
  ): Promise<AgentResponse> => {
    if (!delegationState.active) {
      return originalRun(input, options);
    }

    // --- Delegated mode ---
    const userText = typeof input === 'string' ? input : '[complex input]';

    // Check reclaim conditions BEFORE forwarding
    if (shouldReclaimDelegation(delegationState, userText, workspace)) {
      const summary = reclaimDelegation(delegationState, workspace);
      // Orchestrator processes the reclaim summary + original user message
      return originalRun(summary + '\n\nThe user said: ' + userText, options);
    }

    // Forward to delegated agent
    const delegatedAgent = agents.get(delegationState.agentName);
    if (!delegatedAgent || delegatedAgent.isDestroyed) {
      const summary = reclaimDelegation(delegationState, workspace);
      logger.warn({ agent: delegationState.agentName }, 'Delegated agent not found or destroyed, reclaiming');
      return originalRun(summary + '\n\nThe user said: ' + userText, options);
    }

    const operation = selected?.execution.currentOperation();
    const response = selected ? await selected.run(delegatedAgent, input, options, operation!) : await delegatedAgent.run(input, options);
    delegationState.turnCount++;

    // Log exchange to workspace
    logDelegationExchange(workspace, delegationState, userText, response.output_text ?? '');

    // Active monitoring: orchestrator reviews after each delegated turn
    if (delegationState.monitoring === 'active') {
      const turnSummary = `[Delegation Monitor] Turn ${delegationState.turnCount} with "${delegationState.agentName}".
User said: ${userText}
Agent responded: ${response.output_text ?? ''}

Should you intervene, attach other agents, or let the session continue? If no action needed, respond with just "continue".`;

      try {
        const monitorResponse = await orchestratorAgent.runDirect(turnSummary, {
          ...monitorOptions,
          includeTools: true,
          ...(operation ? { modelTask: operation.modelTask, signal: operation.controller.signal } : {}),
        });
        const monitorText = (monitorResponse.output_text ?? '').trim().toLowerCase();

        // If orchestrator wants to intervene (anything other than "continue")
        if (monitorText !== 'continue') {
          const summary = reclaimDelegation(delegationState, workspace);
          // Run the orchestrator with the intervention context
          // We don't await this — just inject for the next interaction
          orchestratorAgent.inject(summary + '\n\nYou decided to intervene: ' + (monitorResponse.output_text ?? ''), 'developer');
        }
      } catch (error) {
        logger.warn({ error }, 'Active monitoring LLM call failed, continuing delegation');
      }
    }

    // Event monitoring: check workspace key
    if (delegationState.monitoring === 'event' && delegationState.reclaimOn.workspaceKey) {
      const triggerKey = delegationState.reclaimOn.workspaceKey;
      if (workspace.getEntry(triggerKey)) {
        // Delete trigger key so it doesn't fire again on future delegations
        workspace.storeDelete(triggerKey).catch(() => {});
        const summary = reclaimDelegation(delegationState, workspace);
        orchestratorAgent.inject(summary, 'developer');
      }
    }

    return response;
  };

  // ---- Wrap stream() for delegation support ----
  const originalStream = orchestratorAgent.stream.bind(orchestratorAgent);

  orchestratorAgent.stream = async function* (
    input: string | InputItem[],
    options?: RunOptions,
  ): AsyncIterableIterator<StreamEvent> {
    if (!delegationState.active) {
      yield* originalStream(input, options);
      return;
    }

    // --- Delegated mode ---
    const userText = typeof input === 'string' ? input : '[complex input]';

    // Check reclaim conditions BEFORE forwarding
    if (shouldReclaimDelegation(delegationState, userText, workspace)) {
      const summary = reclaimDelegation(delegationState, workspace);
      yield* originalStream(summary + '\n\nThe user said: ' + userText, options);
      return;
    }

    // Forward to delegated agent
    const delegatedAgent = agents.get(delegationState.agentName);
    if (!delegatedAgent || delegatedAgent.isDestroyed) {
      const summary = reclaimDelegation(delegationState, workspace);
      logger.warn({ agent: delegationState.agentName }, 'Delegated agent not found or destroyed, reclaiming');
      yield* originalStream(summary + '\n\nThe user said: ' + userText, options);
      return;
    }

    // Collect response text for logging while yielding events
    let responseText = '';

    const operation = selected?.execution.currentOperation();
    const events = selected ? selected.stream(delegatedAgent, input, options, operation!) : delegatedAgent.stream(input, options);
    for await (const event of events) {
      // Capture text deltas for exchange logging (only output text, not tool call arguments)
      if (event.type === StreamEventType.OUTPUT_TEXT_DELTA && 'delta' in event) {
        responseText += (event as { delta: string }).delta;
      }
      yield event;
    }

    delegationState.turnCount++;

    // Log exchange to workspace
    logDelegationExchange(workspace, delegationState, userText, responseText);

    // Post-stream monitoring (same as run() but after stream completes)
    if (delegationState.monitoring === 'active') {
      const turnSummary = `[Delegation Monitor] Turn ${delegationState.turnCount} with "${delegationState.agentName}".
User said: ${userText}
Agent responded: ${responseText}

Should you intervene, attach other agents, or let the session continue? If no action needed, respond with just "continue".`;

      try {
        const monitorResponse = await orchestratorAgent.runDirect(turnSummary, { ...monitorOptions, includeTools: true, ...(operation ? { modelTask: operation.modelTask, signal: operation.controller.signal } : {}) });
        const monitorText = (monitorResponse.output_text ?? '').trim().toLowerCase();
        if (monitorText !== 'continue') {
          const summary = reclaimDelegation(delegationState, workspace);
          orchestratorAgent.inject(summary + '\n\nYou decided to intervene: ' + (monitorResponse.output_text ?? ''), 'developer');
        }
      } catch (error) {
        logger.warn({ error }, 'Active monitoring LLM call failed, continuing delegation');
      }
    }

    if (delegationState.monitoring === 'event' && delegationState.reclaimOn.workspaceKey) {
      const triggerKey = delegationState.reclaimOn.workspaceKey;
      if (workspace.getEntry(triggerKey)) {
        workspace.storeDelete(triggerKey).catch(() => {});
        const summary = reclaimDelegation(delegationState, workspace);
        orchestratorAgent.inject(summary, 'developer');
      }
    }
  };

  if (selected) {
    const engineRun = orchestratorAgent.run, engineStream = orchestratorAgent.stream;
    orchestratorAgent.run = async (input, options) => {
      const frame = selected.execution.beginPublic(options?.modelTask);
      try { return await engineRun(input, options); } finally { frame.release(); }
    };
    orchestratorAgent.stream = async function* (input, options) {
      const frame = selected.execution.beginPublic(options?.modelTask);
      try { yield* engineStream(input, options); } finally { frame.release(); }
    };
  }

  // ---- Wrap destroy to clean up all workers + shared workspace ----
  const originalDestroy = orchestratorAgent.destroy.bind(orchestratorAgent);
  orchestratorAgent.destroy = () => {
    // Reclaim delegation if active
    if (delegationState.active) {
      delegationState.active = false;
      delegationState.agentName = '';
      delegationState.turnCount = 0;
    }

    if (selected) { selected.close(); originalDestroy(); return; }

    // Destroy all worker agents first
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
