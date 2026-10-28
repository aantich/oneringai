import type { ToolContext, ToolFunction } from '../domain/entities/Tool.js';
import { InvalidConfigError } from '../domain/errors/AIErrors.js';
import { attachOutcomeCapture } from './tool-execution/outcomeInvocation.js';

/** Invocation-local diagnostics, separate from the tool's application result. */
export interface OutcomeInvocation {
  readonly context: ToolContext | undefined;
  /** Report an operational failure. First report wins; inactive after callback settlement. */
  reportFailure(error: Error): void;
}

/** All ordinary tool options, with an explicitly selected invocation callback. */
export type OutcomeToolOptions<TArgs = any, TResult = any> = Omit<ToolFunction<TArgs, TResult>, 'execute'> & {
  execute: (args: TArgs, invocation: OutcomeInvocation) => Promise<TResult>;
};

/**
 * Create a standard ToolFunction with invocation-owned operational failure reporting.
 * Raw returns and existing tool callback signatures are unchanged. Direct execute()
 * calls run the callback but do not publish a framework outcome. Register the tool
 * with the shared ToolManager to observe a reported failure via executeWithOutcome().
 */
export function createOutcomeTool<TArgs = any, TResult = any>(
  options: OutcomeToolOptions<TArgs, TResult>,
): ToolFunction<TArgs, TResult> {
  const { execute: callback, ...toolOptions } = options;
  if (typeof callback !== 'function') throw new InvalidConfigError('createOutcomeTool requires an execute callback');

  const tool: ToolFunction<TArgs, TResult> = {
    ...toolOptions,
    execute: async function(args, context) {
      return callback.call(this, args, { context, reportFailure: () => {} });
    },
  };
  attachOutcomeCapture(tool.execute, () => async function(args, context, report) {
    let reporter: ((error: Error) => void) | undefined = report;
    const invocation: OutcomeInvocation = {
      context,
      reportFailure: error => {
        if (!reporter) return;
        // Invalid JS input must not turn an already performed action into a throw/retry.
        reporter(error instanceof Error ? error : new InvalidConfigError('reportFailure requires an Error'));
      },
    };
    try { return await callback.call(this, args as TArgs, invocation); }
    finally { reporter = undefined; }
  });
  return tool;
}
