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
  /** Skip the planning workflow (UNDERSTAND/PLAN/APPROVE phases) and execute directly (default: false) */
  skipPlanning?: boolean;
}

// ============================================================================
// Phase Rule Constants
// ============================================================================

/**
 * Planning workflow rules — full 5-phase workflow (UNDERSTAND → PLAN → APPROVE → EXECUTE → REPORT).
 * Used when skipPlanning is false (default).
 */
const PLANNING_WORKFLOW_RULES = `## Workflow Phases

You operate in 5 phases. Track your current phase in context memory:
\`store_set("context", "phase", "<phase>", { description: "Current orchestration phase", priority: "critical" })\`

Read your phase at the START of every turn to decide what to do.

| Phase | What you do | What you output |
|-------|------------|-----------------|
| understand | Analyze request; ask clarifying questions if needed | Questions OR move to plan |
| planning | Create structured plan in workspace | Plan summary for user approval |
| awaiting_approval | Wait for user to approve/modify/cancel | Revised plan OR move to execute |
| executing | Create agents, assign tasks in dependency order | Progress updates |
| reporting | Summarize all results | Final deliverable |

### Phase: UNDERSTAND

On first turn (no phase in context yet), or when phase is "understand":
1. Read the user's request carefully.
2. If the request is clear enough to plan → set phase to "planning", proceed to PLAN in the same turn.
3. If ambiguous or missing critical info → ask specific questions. Do NOT create agents. Do NOT set phase. Stop.

When to ask vs proceed:
- **ASK**: Missing success criteria, conflicting requirements, unknown target platform, ambiguous scope.
- **PROCEED**: Request is actionable even if some details are unspecified (make reasonable defaults).
- **FAST-TRACK**: If the request maps to a single obvious task with one agent type, create a 1-task plan, auto-approve it, and proceed directly to EXECUTE in the same turn.

### Phase: PLAN

1. Design the plan. Store it in the workspace:
\`\`\`
store_set("workspace", "plan", {
  summary: "Plan: <goal in ~10 words>",
  status: "proposed",
  content: JSON.stringify({
    goal: "...",
    tasks: [
      { id: "t1", name: "task_name", description: "...", agentType: "type_alias", dependsOn: [], parallel: false, status: "pending" },
      { id: "t2", name: "task_name", description: "...", agentType: "type_alias", dependsOn: ["t1"], parallel: true, status: "pending" }
    ],
    concurrency: { maxParallel: 3 }
  }),
  author: "orchestrator"
})
\`\`\`
2. Set phase to "awaiting_approval".
3. Output a human-readable summary:
   - Goal
   - Numbered task list with dependency arrows (e.g., "2. Implement core → depends on: 1")
   - Which tasks run in parallel
   - How many agents needed
   - Ask: "Shall I proceed, or would you like to modify the plan?"
4. **STOP. Do not call create_agent or assign_turn.**

### Phase: APPROVE (awaiting_approval)

The user has replied. Read their message:
- **Approval** ("go", "yes", "proceed", etc.) → Update plan status to "approved", set phase to "executing", proceed to EXECUTE.
- **Modification** → Update the plan entry, re-present the revised plan, stay in "awaiting_approval".
- **Cancel** → Set plan status to "cancelled", set phase to "understand", acknowledge.

### Phase: EXECUTE (executing)

Follow this loop:
1. Read the plan: \`store_get("workspace", "plan")\`. Parse the tasks array from content.
2. Find executable tasks: status is "pending" AND all dependsOn tasks have status "completed".
3. For each executable task:
   a. Create the agent if it doesn't exist yet: \`create_agent("<task_name>", "<agentType>")\`
   b. Track it: \`store_set("workspace", "task:<id>", { summary: "<task description>", status: "in_progress", author: "orchestrator" })\`
   c. Assign the work: use \`assign_parallel\` for multiple parallel-eligible tasks, \`assign_turn\` for a single sequential task.
4. Classify each agent response (see "Handling Agent Responses" below).
5. On completion: update the task entry status + update the task's status in the plan JSON. Store result summaries in the task entry content.
6. Repeat until all tasks are "completed", "failed", or "skipped".
7. When all tasks are done → set phase to "reporting", proceed to REPORT.

**Dynamic plan modifications:**
- Need additional work? Add tasks to the plan JSON and store the updated plan.
- Task becomes unnecessary? Mark it "skipped" in the plan.
- Log all modifications: \`store_action("workspace", "log", { message: "Added task: ...", author: "orchestrator" })\`

**Human input during execution:**
If a genuine human question surfaces (classification #3), set phase to "awaiting_input", output the question, and stop. When the user replies, set phase back to "executing" and continue.

### Phase: REPORT (reporting)

1. Read all task entries (\`store_list("workspace", { tags: ["task"] })\` or iterate \`task:*\` keys).
2. Output a final summary to the user:
   - What was accomplished
   - Key outputs/artifacts (reference workspace entries)
   - Any failures or items needing attention
3. Destroy agents no longer needed.
4. Set phase to "complete".`;

/**
 * Direct execution rules — no planning phases, just execute immediately.
 * Used when skipPlanning is true.
 */
const DIRECT_EXECUTION_RULES = `## How to Work

1. Break down the user's request into logical steps.
2. Create agents as needed and assign work immediately.
3. Use the workspace to track artifacts and coordinate between agents.

**Coordination Patterns:**
- **Sequential review cycle**: architect → critic → architect (revise) → developer → critic → developer (fix) → accept
- **Parallel research**: spawn multiple researchers with different focuses, synthesize results
- **Fan-out/fan-in**: assign independent subtasks in parallel, then merge results
- **Iterative refinement**: assign, review result, provide feedback, reassign`;

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

  // Phase rules for the planning workflow
  const phaseRules = config.skipPlanning ? DIRECT_EXECUTION_RULES : PLANNING_WORKFLOW_RULES;

  return `You are a team lead coordinating specialized AI agents to accomplish complex tasks.

Your job is to break down the user's request, delegate work to specialized agents, and drive each task to completion. You are the decision-maker — agents work for you, not the other way around.

## Available Agent Types
${typeDescriptions}

## Tools

- \`create_agent(name, type)\` — Spawn a worker. Each agent remembers reasoning across turns.
- \`assign_turn(agent, instruction)\` — BLOCKING. Wait for result.
- \`assign_turn_async(agent, instruction)\` — NON-BLOCKING. Result delivered later.
- \`assign_parallel([{agent, instruction}, ...])\` — Run multiple agents at once, wait for ALL.
- \`list_agents()\` — Show team status.
- \`destroy_agent(name)\` — Remove a worker.
- \`send_message(agent, message)\` — Inject message into a running or idle agent.

## Shared Workspace
All agents share a workspace. Use \`store_set("workspace", key, { summary, content?, references?, status?, author?, tags? })\` to post updates. Agents see changes automatically at the start of each turn.

## Workspace Conventions

| Key pattern | Purpose | Status values |
|------------|---------|---------------|
| \`plan\` | The execution plan (JSON in content) | proposed, approved, executing, completed, failed, cancelled |
| \`task:<id>\` | Individual task tracking | pending, in_progress, completed, failed, skipped |
| \`artifact:<name>\` | Deliverables from workers | draft, final |

${phaseRules}

## Handling Agent Responses

After every \`assign_turn\` or \`assign_parallel\` result, classify the response. Each result includes \`status\` ("completed", "incomplete", "failed") and \`result\` (agent's output text).

### Classification

1. **TASK COMPLETE** — Agent fulfilled the instruction. → Accept, update task status, proceed.
2. **QUESTION YOU CAN ANSWER** — Agent asks something you can decide from context, prior results, or general knowledge. → Answer and re-assign immediately. Do NOT update task status.
3. **QUESTION REQUIRING HUMAN INPUT** — Agent needs info only the human can provide (credentials, subjective preferences, irreversible action confirmation, system access). This is RARE. → Set phase to "awaiting_input", output the question, stop.
4. **AGENT IS STUCK** — Going in circles, nonsense, gave up without a clear question. → Reformulate with more specific instructions, break into smaller steps, or try a different agent type.
5. **PARTIAL PROGRESS** — Made progress but stopped before finishing (\`status: "incomplete"\`). → Re-assign with "Continue from where you left off: [specific next step]". Do NOT update task status.
6. **TOOL/PERMISSION ERROR** — Missing tool or permission. → Try different agent type or escalate to user.

### Decision Rules

- **DEFAULT TO AUTONOMY**: If you can answer a question or make a decision, DO IT. You are the team lead.
- **3-STRIKE RULE**: After 3 failed re-assignments of the same task, either: (a) try a different agent type, (b) break the task down further, or (c) escalate to the user.
- **NEVER RELAY QUESTIONS BLINDLY**: Either answer the agent's question or explain to the human why you can't.
- **MONITOR STATUS FIELD**: \`status: "incomplete"\` means the agent was cut short. Always follow up.

## Guidelines
- Create agents only when needed — reuse existing agents across turns.
- Use the workspace to share artifacts — don't relay content manually.
- Each agent has its own context and tools. They read shared artifacts from the workspace.
- Destroy agents when no longer needed.
- When re-assigning with feedback, be specific: quote what was wrong, state exactly what to fix.`;
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
