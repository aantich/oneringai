/**
 * DelegationPluginNextGen - Multi-agent delegation via a single delegate_task tool
 *
 * Enables an agent to delegate tasks to other pre-configured agents.
 * Each delegation creates a fresh, ephemeral Agent instance with isolated context.
 * Only the final text result returns to the calling agent.
 *
 * Design:
 * - Single `delegate_task` tool (not one tool per agent) for clean tool namespace
 * - Ephemeral sub-agents: create, run, destroy per delegation call
 * - Context isolation: sub-agents get fresh context, no parent conversation
 * - Recursion prevention: sub-agents do NOT receive the delegation plugin
 * - Concurrency control: configurable max concurrent delegations
 * - Timeout: configurable per-delegation timeout with Promise.race
 *
 * Usage:
 * ```typescript
 * const plugin = new DelegationPluginNextGen({
 *   resolveTargets: async () => [
 *     { id: 'researcher', name: 'Research Agent', description: 'Web research', config: { ... } },
 *     { id: 'writer', name: 'Writer Agent', description: 'Content writing', config: { ... } },
 *   ],
 *   timeoutMs: 300_000,
 *   maxConcurrent: 3,
 * });
 * await plugin.initialize();
 * agent.context.registerPlugin(plugin);
 * ```
 *
 * The resolver callback is application-specific. In Everworker, it fetches
 * target agent definitions from MongoDB and resolves their tools.
 */

import { BasePluginNextGen } from '../BasePluginNextGen.js';
import type { ToolFunction } from '../../../domain/entities/Tool.js';
import { Agent } from '../../Agent.js';
import type { AgentConfig } from '../../Agent.js';
import { randomUUID } from 'node:crypto';

// ============================================================================
// Types
// ============================================================================

/**
 * A target agent that can be delegated to.
 * Generic - no dependency on any specific application (Everworker, Hosea, etc.).
 */
export interface DelegationTarget {
    /** Unique identifier for the target agent */
    id: string;
    /** Display name shown to the LLM */
    name: string;
    /** Description of when/why to call this agent */
    description: string;
    /** The AgentConfig to create a fresh Agent instance */
    config: AgentConfig;
}

/**
 * Resolver function that returns available delegation targets.
 * Called once during plugin initialization.
 *
 * The resolver is application-specific:
 * - Everworker: fetches from V25AgentsCollection, resolves tools
 * - Hosea: reads from local config
 * - Tests: returns mock targets
 */
export type DelegationTargetResolver = () => Promise<DelegationTarget[]>;

/**
 * Configuration for the DelegationPlugin.
 */
export interface DelegationPluginConfig {
    /** Function that resolves target agents at initialization time */
    resolveTargets: DelegationTargetResolver;
    /** Hard timeout per delegation call in ms (default: 300_000 = 5 min) */
    timeoutMs?: number;
    /** Maximum concurrent delegations (default: 3) */
    maxConcurrent?: number;
    /** Maximum recursion depth (default: 0 = no nesting) */
    maxDepth?: number;
    /** Current depth (set internally when nesting, not by user) */
    currentDepth?: number;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_TIMEOUT_MS = 300_000; // 5 minutes
const DEFAULT_MAX_CONCURRENT = 3;
const DEFAULT_MAX_DEPTH = 0; // No nesting by default

// ============================================================================
// Plugin Implementation
// ============================================================================

/**
 * DelegationPluginNextGen - Provides a `delegate_task` tool for multi-agent delegation.
 *
 * Lifecycle:
 * 1. Construct with config (resolver, limits)
 * 2. Call `initialize()` to resolve targets (async)
 * 3. Register on agent context: `agent.context.registerPlugin(plugin)`
 * 4. Agent uses `delegate_task` tool during execution
 * 5. Plugin auto-cleans up sub-agents on `destroy()`
 */
export class DelegationPluginNextGen extends BasePluginNextGen {
    readonly name = 'delegation';

    private targets: DelegationTarget[] = [];
    private activeExecutions = new Map<string, { agent: Agent; timer: ReturnType<typeof setTimeout> | undefined }>();
    private config: Required<DelegationPluginConfig>;
    private initialized = false;

    /** Aggregate token usage across all delegation calls */
    private aggregateUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

    constructor(config: DelegationPluginConfig) {
        super();
        this.config = {
            resolveTargets: config.resolveTargets,
            timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
            maxConcurrent: config.maxConcurrent ?? DEFAULT_MAX_CONCURRENT,
            maxDepth: config.maxDepth ?? DEFAULT_MAX_DEPTH,
            currentDepth: config.currentDepth ?? 0,
        };
    }

    /**
     * Initialize targets by calling the resolver.
     * Must be called before the plugin is functional.
     * Safe to call multiple times (idempotent after first call).
     */
    async initialize(): Promise<void> {
        if (this.initialized) return;
        this.targets = await this.config.resolveTargets();
        this.initialized = true;
        this.invalidateTokenCache();
    }

    // ========================================================================
    // BasePluginNextGen implementations
    // ========================================================================

    getInstructions(): string | null {
        if (this.targets.length === 0) return null;

        const targetList = this.targets
            .map(t => `- **${t.name}** (id: \`${t.id}\`): ${t.description}`)
            .join('\n');

        return `## Agent Delegation

You can delegate tasks to specialized agents using the \`delegate_task\` tool. Each agent runs independently with its own tools and context. Only the final result is returned to you.

### Available Agents
${targetList}

### Guidelines
- Delegate when a task matches another agent's specialty.
- Provide clear, self-contained instructions — the target agent has no access to your conversation history.
- The target agent cannot ask you follow-up questions. Include all necessary context in the task description.
- You can run up to ${this.config.maxConcurrent} delegations concurrently.`;
    }

    async getContent(): Promise<string | null> {
        // No dynamic content — instructions cover everything
        return null;
    }

    getContents(): unknown {
        return {
            targets: this.targets.map(t => ({ id: t.id, name: t.name })),
            activeExecutions: this.activeExecutions.size,
            aggregateUsage: { ...this.aggregateUsage },
        };
    }

    getTools(): ToolFunction[] {
        if (this.targets.length === 0) return [];
        return [this.buildDelegateTaskTool()];
    }

    destroy(): void {
        // Cancel and destroy all active sub-agent executions
        for (const [, exec] of this.activeExecutions) {
            if (exec.timer) clearTimeout(exec.timer);
            if (!exec.agent.isDestroyed) {
                try { exec.agent.cancel(); } catch { /* ignore */ }
                try { exec.agent.destroy(); } catch { /* ignore */ }
            }
        }
        this.activeExecutions.clear();
        this.targets = [];
    }

    // ========================================================================
    // Tool builder
    // ========================================================================

    private buildDelegateTaskTool(): ToolFunction {
        const targetIds = this.targets.map(t => t.id);

        return {
            definition: {
                type: 'function',
                function: {
                    name: 'delegate_task',
                    description: 'Delegate a task to a specialized agent. The agent runs independently and returns its final result.',
                    parameters: {
                        type: 'object',
                        properties: {
                            agentId: {
                                type: 'string',
                                description: `ID of the target agent. Available: ${targetIds.join(', ')}`,
                            },
                            task: {
                                type: 'string',
                                description: 'Clear, self-contained task description. Include all necessary context.',
                            },
                        },
                        required: ['agentId', 'task'],
                    },
                },
            },
            descriptionFactory: () => {
                const agents = this.targets
                    .map(t => `- "${t.id}" (${t.name}): ${t.description}`)
                    .join('\n');
                return `Delegate a task to a specialized agent. Available agents:\n${agents}`;
            },
            execute: async (args: Record<string, unknown>) => {
                const agentId = args.agentId as string;
                const task = args.task as string;
                return this.executeDelegation(agentId, task);
            },
            permission: { scope: 'always', riskLevel: 'low' },
            describeCall: (args) => {
                const target = this.targets.find(t => t.id === args.agentId);
                const name = target?.name || args.agentId;
                const taskPreview = typeof args.task === 'string' && args.task.length > 40
                    ? args.task.slice(0, 37) + '...'
                    : args.task;
                return `delegate to ${name}: ${taskPreview}`;
            },
        };
    }

    // ========================================================================
    // Delegation execution
    // ========================================================================

    private async executeDelegation(
        agentId: string,
        task: string,
    ): Promise<Record<string, unknown>> {
        // 1. Find target
        const target = this.targets.find(t => t.id === agentId);
        if (!target) {
            const available = this.targets.map(t => `"${t.id}" (${t.name})`).join(', ');
            return { success: false, error: `Agent "${agentId}" not found. Available: ${available}` };
        }

        // 2. Check concurrency
        if (this.activeExecutions.size >= this.config.maxConcurrent) {
            return {
                success: false,
                error: `Max concurrent delegations (${this.config.maxConcurrent}) reached. Wait for active delegations to complete.`,
            };
        }

        // 3. Create fresh sub-agent (NO delegation plugin — prevents recursion)
        const subAgentConfig: AgentConfig = {
            ...target.config,
            // Ensure sub-agent has reasonable limits
            maxIterations: target.config.maxIterations ?? 50,
            limits: target.config.limits ?? {
                maxExecutionTime: this.config.timeoutMs,
                maxToolCalls: 100,
            },
        };

        let subAgent: Agent;
        try {
            subAgent = Agent.create(subAgentConfig);
        } catch (error) {
            return {
                success: false,
                agentId,
                agentName: target.name,
                error: `Failed to create agent: ${error instanceof Error ? error.message : String(error)}`,
            };
        }

        const execId = randomUUID();
        let timer: ReturnType<typeof setTimeout> | undefined;

        try {
            this.activeExecutions.set(execId, { agent: subAgent, timer: undefined });

            // 4. Execute with timeout (matching orchestrator/tools.ts pattern)
            const response = await Promise.race([
                subAgent.run(task),
                new Promise<never>((_, reject) => {
                    timer = setTimeout(
                        () => reject(new Error(`Delegation to "${target.name}" timed out after ${this.config.timeoutMs / 1000}s`)),
                        this.config.timeoutMs,
                    );
                    // Store timer reference for cleanup
                    const exec = this.activeExecutions.get(execId);
                    if (exec) exec.timer = timer;
                }),
            ]);

            // 5. Track aggregate usage
            const usage = {
                inputTokens: response.usage?.input_tokens ?? 0,
                outputTokens: response.usage?.output_tokens ?? 0,
                totalTokens: response.usage?.total_tokens ?? 0,
            };
            this.aggregateUsage.inputTokens += usage.inputTokens;
            this.aggregateUsage.outputTokens += usage.outputTokens;
            this.aggregateUsage.totalTokens += usage.totalTokens;

            return {
                success: true,
                agentId,
                agentName: target.name,
                result: response.output_text ?? '',
                usage,
            };
        } catch (error) {
            return {
                success: false,
                agentId,
                agentName: target.name,
                error: error instanceof Error ? error.message : String(error),
            };
        } finally {
            // 6. Always cleanup
            if (timer) clearTimeout(timer);
            if (!subAgent.isDestroyed) {
                try { subAgent.destroy(); } catch { /* ignore */ }
            }
            this.activeExecutions.delete(execId);
        }
    }
}
