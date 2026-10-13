/**
 * ResultNormalizerPlugin
 *
 * Guarantees every tool execution returns a valid, serializable result.
 * Converts undefined/null to error objects, wraps primitives optionally,
 * and recovers from exceptions.
 *
 * This plugin runs LAST in afterExecute (priority 0) to normalize after
 * all other plugins have processed the result.
 *
 * @module tool-execution
 */

import type {
  IToolExecutionPlugin,
  PluginExecutionContext,
} from '../types.js';
import { markNormalizedFailure } from '../outcomes.js';

/**
 * Configuration options for ResultNormalizerPlugin
 */
export interface ResultNormalizerPluginOptions {
  /**
   * Whether to wrap primitive values in { success: true, result: value }.
   * Default: false (primitives pass through as-is)
   */
  wrapPrimitives?: boolean;

  /**
   * Whether to add success: true to objects that don't have it.
   * Default: false
   */
  addSuccessField?: boolean;
}

/**
 * Normalized error result returned when a tool returns undefined/null or throws.
 */
export interface NormalizedErrorResult {
  success: false;
  error: string;
  errorType?: string;
  toolName?: string;
}

/**
 * ResultNormalizerPlugin - Guarantees valid tool execution results.
 *
 * This is a built-in plugin that ensures every tool execution returns a valid,
 * serializable result. It prevents the "No tool output found" error that can
 * occur when tools return undefined/null or throw exceptions.
 *
 * @example
 * ```typescript
 * // Registered automatically by ToolManager
 * // To customize or remove:
 * toolManager.executionPipeline.remove('result-normalizer');
 *
 * // Or with custom options:
 * toolManager.executionPipeline.use(new ResultNormalizerPlugin({
 *   wrapPrimitives: true,
 *   addSuccessField: true,
 * }));
 * ```
 */
export class ResultNormalizerPlugin implements IToolExecutionPlugin {
  readonly name = 'result-normalizer';
  readonly priority = 0; // Run LAST in afterExecute (reverse order)

  private options: Required<ResultNormalizerPluginOptions>;

  constructor(options: ResultNormalizerPluginOptions = {}) {
    this.options = {
      wrapPrimitives: options.wrapPrimitives ?? false,
      addSuccessField: options.addSuccessField ?? false,
    };
  }

  /**
   * Normalize result after all other plugins have processed it.
   * Converts undefined/null to error objects, optionally wraps primitives.
   */
  async afterExecute(ctx: PluginExecutionContext, result: unknown): Promise<unknown> {
    if (result === undefined || result === null) {
      markNormalizedFailure(ctx, new Error(`Tool '${ctx.toolName}' returned no result`));
    }
    return this.normalize(result, ctx.toolName);
  }

  /**
   * Convert exceptions to error result objects (recovery).
   * This allows the tool call to return a valid result instead of throwing.
   */
  async onError(ctx: PluginExecutionContext, error: Error): Promise<NormalizedErrorResult> {
    markNormalizedFailure(ctx, error);
    return {
      success: false,
      error: error.message,
      errorType: error.name,
      toolName: ctx.toolName,
    };
  }

  /**
   * Normalize a result to ensure it's valid and serializable.
   */
  private normalize(result: unknown, toolName: string): unknown {
    // Case 1: undefined or null → error response
    if (result === undefined || result === null) {
      return {
        success: false,
        error: `Tool '${toolName}' returned no result`,
      } satisfies NormalizedErrorResult;
    }

    // Case 2: Already a proper object with success field → pass through
    if (typeof result === 'object' && 'success' in (result as object)) {
      return result;
    }

    // Case 3: Primitive values
    if (typeof result !== 'object') {
      if (this.options.wrapPrimitives) {
        return { success: true, result };
      }
      return result; // Pass through as-is
    }

    // Case 4: Object without success field
    if (this.options.addSuccessField) {
      return { success: true, ...(result as object) };
    }
    return result; // Pass through as-is
  }
}
