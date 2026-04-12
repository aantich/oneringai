/**
 * Routine-as-Tool Factory
 *
 * Converts a RoutineDefinition into a non-blocking ToolFunction that spawns
 * a fresh Agent, runs executeRoutine(), and returns the results.
 *
 * The tool is created with `blocking: false` so it executes asynchronously —
 * the calling agent gets a placeholder immediately and receives the routine's
 * results mid-loop when they complete.
 *
 * @example
 * ```typescript
 * const tool = createRoutineTool({
 *   definition: myRoutine,
 *   createAgent: () => Agent.create({ connector: 'openai', model: 'gpt-4' }),
 * });
 * agent.tools.register(tool);
 * ```
 */

import type { ToolFunction } from '../domain/entities/Tool.js';
import type { RoutineDefinition } from '../domain/entities/Routine.js';
import type { Agent } from './Agent.js';
import { executeRoutine } from './routineRunner.js';
import { ToolCatalogRegistry } from './ToolCatalogRegistry.js';

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_ROUTINE_TIMEOUT = 3_600_000; // 1 hour — matches routineRunner default
const TOOL_NAME_PREFIX = 'routine_';

// ============================================================================
// Types
// ============================================================================

export interface CreateRoutineToolOptions {
  /** The routine definition to wrap as a tool. */
  definition: RoutineDefinition;

  /**
   * Factory that creates a fresh Agent for each routine invocation.
   * Called every time the tool is executed — the agent is destroyed after the routine completes.
   */
  createAgent: () => Agent | Promise<Agent>;

  /**
   * Override tool name. Default: 'routine_{sanitized_definition_name}'.
   * Must be unique among all registered tools.
   */
  toolName?: string;
}

export interface RoutineToolCatalogOptions {
  /** Routine definitions to register as a tool catalog category. */
  definitions: RoutineDefinition[];

  /**
   * Shared agent factory — receives the specific definition being executed.
   * Called per-invocation; the agent is destroyed after the routine completes.
   */
  createAgent: (definition: RoutineDefinition) => Agent | Promise<Agent>;

  /** Category name for ToolCatalogRegistry. Default: 'routines:executable' */
  categoryName?: string;

  /** Category display name. Default: 'Executable Routines' */
  categoryDisplayName?: string;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Sanitize a routine name into a valid tool name.
 * Converts to lowercase, replaces non-alphanumeric runs with underscores, trims trailing underscores.
 */
function sanitizeToolName(name: string): string {
  return TOOL_NAME_PREFIX + name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/_+$/, '');
}

/**
 * Build a JSON schema `properties` object from RoutineParameter[].
 */
function buildParameterSchema(definition: RoutineDefinition): {
  properties: Record<string, unknown>;
  required: string[];
} {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const param of definition.parameters ?? []) {
    properties[param.name] = {
      type: 'string',
      description: param.description,
      ...(param.default !== undefined ? { default: param.default } : {}),
    };
    if (param.required) {
      required.push(param.name);
    }
  }

  return { properties, required };
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a non-blocking ToolFunction from a RoutineDefinition.
 *
 * The tool:
 * - Has `blocking: false` — executes asynchronously
 * - Spawns a fresh agent via `createAgent()` per invocation
 * - Runs `executeRoutine()` with the definition and input args
 * - Destroys the agent after completion (success or failure)
 * - Returns task results as the tool output
 */
export function createRoutineTool(options: CreateRoutineToolOptions): ToolFunction {
  const { definition, createAgent } = options;
  const toolName = options.toolName ?? sanitizeToolName(definition.name);
  const { properties, required } = buildParameterSchema(definition);
  const timeout = definition.timeoutMs !== undefined ? definition.timeoutMs : DEFAULT_ROUTINE_TIMEOUT;

  return {
    definition: {
      type: 'function',
      function: {
        name: toolName,
        description: definition.description,
        parameters: {
          type: 'object',
          properties,
          ...(required.length > 0 ? { required } : {}),
        },
      },
      blocking: false,
      timeout,
    },

    execute: async (args: Record<string, unknown>) => {
      const agent = await createAgent();
      try {
        const execution = await executeRoutine({
          definition,
          agent,
          inputs: args,
        });

        return {
          success: execution.status === 'completed',
          routineName: definition.name,
          status: execution.status,
          results: execution.plan.tasks
            .filter(t => t.status === 'completed' && t.result?.output)
            .map(t => ({ task: t.name, output: t.result!.output })),
          error: execution.error,
        };
      } finally {
        try { agent.destroy(); } catch { /* already destroyed */ }
      }
    },

    describeCall: (args: Record<string, unknown>) => {
      const paramSummary = Object.entries(args)
        .map(([k, v]) => `${k}=${typeof v === 'string' && v.length > 50 ? v.slice(0, 50) + '...' : v}`)
        .join(', ');
      return `${definition.name}(${paramSummary})`;
    },
  };
}

// ============================================================================
// ToolCatalog Integration
// ============================================================================

/**
 * Register routine definitions as a ToolCatalog category.
 *
 * Each routine becomes a CatalogToolEntry with a `createTool` factory
 * for lazy instantiation when loaded via `tool_catalog_load`.
 *
 * @example
 * ```typescript
 * registerRoutineToolCategory({
 *   definitions: [routineA, routineB],
 *   createAgent: (def) => Agent.create({
 *     connector: def.metadata?.connector as string ?? 'openai',
 *     model: def.metadata?.model as string ?? 'gpt-4',
 *   }),
 * });
 * // Agents can now: tool_catalog_search → tool_catalog_load('routines:executable')
 * ```
 */
export function registerRoutineToolCategory(options: RoutineToolCatalogOptions): void {
  const categoryName = options.categoryName ?? 'routines:executable';
  const displayName = options.categoryDisplayName ?? 'Executable Routines';

  ToolCatalogRegistry.registerCategory({
    name: categoryName,
    displayName,
    description: `Routines that can be executed as tools. ${options.definitions.length} routine(s) available.`,
  });

  const entries = options.definitions.map((definition) => {
    const toolName = sanitizeToolName(definition.name);

    return {
      name: toolName,
      displayName: definition.name,
      description: definition.description,
      safeByDefault: false,
      source: 'routine' as const,
      createTool: (): ToolFunction => createRoutineTool({
        definition,
        createAgent: () => options.createAgent(definition),
        toolName,
      }),
    };
  });

  ToolCatalogRegistry.registerTools(categoryName, entries);
}
