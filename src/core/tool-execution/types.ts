/**
 * Tool Execution Plugin System Types
 *
 * Provides a pluggable architecture for extending tool execution with
 * custom behavior like logging, analytics, permission prompts, UI updates, etc.
 *
 * @module tool-execution
 */

import type { ToolFunction } from '../../domain/entities/Tool.js';
import type { ToolContext } from '../../domain/interfaces/IToolContext.js';
import type { PipelineOutcome } from './outcomes.js';
import type { ToolRegistrationInfo } from '../permissions/PermissionEnforcementPlugin.js';

export interface PipelineExecutionOptions {
  executionId?: string;
  toolContext?: ToolContext;
  /** Admission-time registration metadata; later registrations apply to future calls. */
  registration?: ToolRegistrationInfo;
  onOutcome?: (outcome: PipelineOutcome) => void;
}

/**
 * Context passed through the execution pipeline.
 * Contains all information about the current tool execution.
 */
export interface PluginExecutionContext {
  /** Name of the tool being executed */
  toolName: string;

  /** Original arguments passed to the tool (immutable) */
  readonly args: unknown;

  /** Mutable arguments that plugins can modify */
  mutableArgs: unknown;

  /** Metadata for passing data between plugins */
  metadata: Map<string, unknown>;

  /** Timestamp when execution started (ms since epoch) */
  startTime: number;

  /** The tool function being executed */
  tool: ToolFunction;

  /** Unique execution ID for tracing */
  executionId: string;
  /** Snapshot belonging to this invocation, including its composed signal. */
  toolContext?: ToolContext;
  /** Admission-time registration metadata; later registrations apply to future calls. */
  registration?: ToolRegistrationInfo;
}

/**
 * Result of a plugin's beforeExecute hook.
 *
 * - `void` or `undefined`: Continue execution with original args
 * - `{ abort: true, result: ... }`: Abort and return this result immediately
 * - `{ modifiedArgs: ... }`: Continue with modified arguments
 */
export type BeforeExecuteResult =
  | void
  | undefined
  | { abort: true; result: unknown }
  | { modifiedArgs: unknown };

/**
 * Plugin interface for extending tool execution.
 *
 * Plugins can hook into the execution lifecycle to:
 * - Modify arguments before execution
 * - Transform results after execution
 * - Handle errors
 * - Emit side effects (logging, UI updates, analytics)
 *
 * @example
 * ```typescript
 * class MyPlugin implements IToolExecutionPlugin {
 *   readonly name = 'my-plugin';
 *   readonly priority = 100;
 *
 *   async beforeExecute(ctx: PluginExecutionContext) {
 *     console.log(`Starting ${ctx.toolName}`);
 *   }
 *
 *   async afterExecute(ctx: PluginExecutionContext, result: unknown) {
 *     console.log(`Finished ${ctx.toolName} in ${Date.now() - ctx.startTime}ms`);
 *     return result;
 *   }
 * }
 * ```
 */
export interface IToolExecutionPlugin {
  /** Unique plugin name (used for registration and lookup) */
  readonly name: string;

  /**
   * Execution priority. Lower values run earlier in beforeExecute,
   * later in afterExecute (for proper unwinding).
   * Default: 100
   */
  readonly priority?: number;

  /**
   * Called before tool execution.
   *
   * Can:
   * - Return void to continue with original args
   * - Return `{ modifiedArgs }` to continue with modified args
   * - Return `{ abort: true, result }` to short-circuit and return immediately
   *
   * @param ctx - Execution context with tool info and mutable args
   */
  beforeExecute?(ctx: PluginExecutionContext): Promise<BeforeExecuteResult>;

  /**
   * Called after successful tool execution.
   *
   * Can transform or replace the result. Must return the (possibly modified) result.
   * Hooks run in reverse priority order for proper stack-like unwinding.
   *
   * @param ctx - Execution context
   * @param result - Result from tool execution (or previous plugin)
   * @returns The result to pass to the next plugin or return to caller
   */
  afterExecute?(ctx: PluginExecutionContext, result: unknown): Promise<unknown>;

  /**
   * Called when tool execution fails.
   *
   * Can:
   * - Return undefined to let error propagate to next plugin/caller
   * - Return a value to recover from the error (returned as the result)
   * - Throw a different error
   *
   * @param ctx - Execution context
   * @param error - The error that occurred
   * @returns Recovery value or undefined to propagate error
   */
  onError?(ctx: PluginExecutionContext, error: Error): Promise<unknown>;

  /**
   * Called when plugin is registered with a pipeline.
   * Use for setup that requires pipeline reference.
   *
   * @param pipeline - The pipeline this plugin is registered with
   */
  onRegister?(pipeline: IToolExecutionPipeline): void;

  /**
   * Called when plugin is unregistered from a pipeline.
   * Use for cleanup.
   */
  onUnregister?(): void;
}

/**
 * Pipeline interface for managing and executing plugins.
 */
export interface IToolExecutionPipeline {
  /**
   * Register a plugin with the pipeline.
   * If a plugin with the same name exists, it will be replaced.
   *
   * @param plugin - Plugin to register
   * @returns this for chaining
   */
  use(plugin: IToolExecutionPlugin): this;

  /**
   * Remove a plugin by name.
   *
   * @param pluginName - Name of plugin to remove
   * @returns true if removed, false if not found
   */
  remove(pluginName: string): boolean;

  /**
   * Check if a plugin is registered.
   *
   * @param pluginName - Name of plugin to check
   */
  has(pluginName: string): boolean;

  /**
   * Get a registered plugin by name.
   *
   * @param pluginName - Name of plugin to get
   */
  get(pluginName: string): IToolExecutionPlugin | undefined;

  /**
   * List all registered plugins (sorted by priority).
   */
  list(): IToolExecutionPlugin[];

  /**
   * Execute a tool through the plugin pipeline.
   *
   * @param tool - Tool function to execute
   * @param args - Arguments for the tool
   * @returns Result from tool execution (possibly transformed by plugins)
   */
  execute(tool: ToolFunction, args: unknown, options?: PipelineExecutionOptions): Promise<unknown>;
}

/**
 * Options for creating a ToolExecutionPipeline
 */
export interface ToolExecutionPipelineOptions {
  /**
   * Whether to generate unique execution IDs using crypto.randomUUID().
   * If false, uses a simpler counter-based ID.
   * Default: true (if crypto.randomUUID is available)
   */
  useRandomUUID?: boolean;
}
