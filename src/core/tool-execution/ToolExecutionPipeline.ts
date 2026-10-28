/**
 * ToolExecutionPipeline
 *
 * Orchestrates the execution of tools through a chain of plugins.
 * Each plugin can intercept and modify the execution at different phases:
 * - beforeExecute: Modify args, abort execution, or pass through
 * - afterExecute: Transform results
 * - onError: Handle or recover from errors
 *
 * @module tool-execution
 */

import type { ToolFunction } from '../../domain/entities/Tool.js';
import type {
  IToolExecutionPlugin,
  IToolExecutionPipeline,
  PluginExecutionContext,
  ToolExecutionPipelineOptions,
  PipelineExecutionOptions,
} from './types.js';
import { getNormalizedFailure, getReportedFailure, markReportedFailure } from './outcomes.js';
import { captureOutcomeExecutor } from './outcomeInvocation.js';
import { isConnectorPolicyDenial } from '../connector-execution/profile.js';
import { getCompositionDenial } from '../execution/composition.js';
import { ToolPermissionDeniedError, ToolTimeoutError } from '../../domain/errors/AIErrors.js';

/**
 * Default plugin priority
 */
const DEFAULT_PRIORITY = 100;

/**
 * Counter for generating simple execution IDs when crypto.randomUUID is not available
 */
let executionCounter = 0;

/**
 * Generate a unique execution ID
 */
function generateExecutionId(useRandomUUID: boolean): string {
  if (useRandomUUID && typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback: timestamp + counter
  return `exec_${Date.now()}_${++executionCounter}`;
}

/**
 * Deep clone an object for creating mutable args copy.
 * Uses structuredClone if available, otherwise falls back to JSON parse/stringify.
 */
function deepClone<T>(value: T): T {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch {
      // Fall through to JSON approach for non-cloneable values
    }
  }
  // Fallback for environments without structuredClone or for non-cloneable values
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    // If JSON fails, return the original value
    // This handles cases like functions or circular references
    return value;
  }
}

/**
 * Tool Execution Pipeline
 *
 * Manages a chain of plugins that can intercept and modify tool execution.
 *
 * @example
 * ```typescript
 * const pipeline = new ToolExecutionPipeline();
 *
 * // Add plugins
 * pipeline.use(new LoggingPlugin());
 * pipeline.use(new AnalyticsPlugin());
 *
 * // Execute tool
 * const result = await pipeline.execute(myTool, { arg: 'value' });
 * ```
 */
export class ToolExecutionPipeline implements IToolExecutionPipeline {
  private plugins: Map<string, IToolExecutionPlugin> = new Map();
  private sortedPlugins: IToolExecutionPlugin[] = [];
  private useRandomUUID: boolean;

  constructor(options: ToolExecutionPipelineOptions = {}) {
    this.useRandomUUID = options.useRandomUUID ?? true;
  }

  /**
   * Register a plugin with the pipeline.
   *
   * If a plugin with the same name is already registered, it will be
   * unregistered first (calling its onUnregister hook) and replaced.
   *
   * @param plugin - Plugin to register
   * @returns this for chaining
   */
  use(plugin: IToolExecutionPlugin): this {
    if (this.plugins.has(plugin.name)) {
      // Remove existing plugin first
      this.remove(plugin.name);
    }

    this.plugins.set(plugin.name, plugin);
    this.rebuildSortedList();

    // Call onRegister hook if provided
    plugin.onRegister?.(this);

    return this;
  }

  /**
   * Remove a plugin by name.
   *
   * @param pluginName - Name of the plugin to remove
   * @returns true if the plugin was found and removed, false otherwise
   */
  remove(pluginName: string): boolean {
    const plugin = this.plugins.get(pluginName);
    if (!plugin) {
      return false;
    }

    // Call onUnregister hook if provided
    plugin.onUnregister?.();

    this.plugins.delete(pluginName);
    this.rebuildSortedList();

    return true;
  }

  /**
   * Check if a plugin is registered.
   *
   * @param pluginName - Name of the plugin to check
   */
  has(pluginName: string): boolean {
    return this.plugins.has(pluginName);
  }

  /**
   * Get a registered plugin by name.
   *
   * @param pluginName - Name of the plugin to get
   */
  get(pluginName: string): IToolExecutionPlugin | undefined {
    return this.plugins.get(pluginName);
  }

  /**
   * List all registered plugins, sorted by priority.
   */
  list(): IToolExecutionPlugin[] {
    return [...this.sortedPlugins];
  }

  /**
   * Execute a tool through the plugin pipeline.
   *
   * Execution phases:
   * 1. beforeExecute hooks (in priority order, lowest first)
   * 2. Tool execution (if not aborted)
   * 3. afterExecute hooks (in reverse priority order for proper unwinding)
   * 4. onError hooks if any phase fails
   *
   * @param tool - Tool function to execute
   * @param args - Arguments for the tool
   * @returns Result from tool execution (possibly transformed by plugins)
   */
  async execute(tool: ToolFunction, args: unknown, options: PipelineExecutionOptions = {}): Promise<unknown> {
    const outcomeExecute = captureOutcomeExecutor(tool.execute);
    const compositionDenial = getCompositionDenial(tool.execute);
    // Create execution context
    const ctx: PluginExecutionContext = {
      toolName: tool.definition.function.name,
      args,
      mutableArgs: deepClone(args),
      metadata: new Map(),
      startTime: Date.now(),
      tool,
      executionId: options.executionId ?? generateExecutionId(this.useRandomUUID),
      toolContext: options.toolContext,
      registration: options.registration,
    };
    const plugins = [...this.sortedPlugins];
    let executionStarted = false;
    let failure: Error | undefined;
    let reportedCause: Error | undefined;
    const report = (): void => {
      const reported = getReportedFailure(ctx);
      const cause = getNormalizedFailure(ctx) ?? reportedCause ?? failure;
      const error = reported && cause && reported.cause !== cause
        ? new AggregateError([reported, cause], reported.message, { cause }) : reported ?? cause;
      try {
        options.onOutcome?.({
          status: reported ? 'failed' : (error instanceof ToolPermissionDeniedError || isConnectorPolicyDenial(error)) ? 'denied' : error instanceof ToolTimeoutError ? 'timed_out' : error ? 'failed' : 'succeeded',
          executionStarted,
          error,
        });
      } catch {
        // Outcome observers are diagnostics, never a reason to repeat an effect.
      }
    };

    try {
      if (compositionDenial) throw compositionDenial;
      options.toolContext?.signal?.throwIfAborted();
      // Phase 1: beforeExecute hooks
      for (const plugin of plugins) {
        options.toolContext?.signal?.throwIfAborted();
        if (plugin.beforeExecute) {
          const hookResult = await plugin.beforeExecute(ctx);

          // Check for abort
          if (hookResult && 'abort' in hookResult && hookResult.abort) {
            return hookResult.result;
          }

          // Check for modified args
          if (hookResult && 'modifiedArgs' in hookResult) {
            ctx.mutableArgs = hookResult.modifiedArgs;
          }
        }
      }

      // Phase 2: Execute the tool
      options.toolContext?.signal?.throwIfAborted();
      executionStarted = true;
      let result = await (outcomeExecute
        ? outcomeExecute.call(tool, ctx.mutableArgs, options.toolContext, error => markReportedFailure(ctx, error))
        : options.toolContext
        ? tool.execute(ctx.mutableArgs, options.toolContext)
        : tool.execute(ctx.mutableArgs));

      // Phase 3: afterExecute hooks (reverse order for proper unwinding)
      const reversedPlugins = [...plugins].reverse();
      for (const plugin of reversedPlugins) {
        if (plugin.afterExecute) {
          result = await plugin.afterExecute(ctx, result);
        }
      }

      return result;
    } catch (error) {
      // Phase 4: onError hooks
      const err = error instanceof Error ? error : new Error(String(error));
      if (getReportedFailure(ctx)) reportedCause = err;

      for (const plugin of plugins) {
        if (plugin.onError) {
          try {
            const recovered = await plugin.onError(ctx, err);
            // If plugin returns a value (not undefined), treat it as recovery
            if (recovered !== undefined) {
              return recovered;
            }
          } catch {
            // Plugin's onError threw, continue to next plugin
          }
        }
      }

      // No plugin recovered, re-throw the original error
      failure = err;
      throw error;
    } finally {
      report();
    }
  }

  /**
   * Rebuild the sorted plugin list after registration changes.
   */
  private rebuildSortedList(): void {
    this.sortedPlugins = [...this.plugins.values()].sort(
      (a, b) => (a.priority ?? DEFAULT_PRIORITY) - (b.priority ?? DEFAULT_PRIORITY)
    );
  }
}
