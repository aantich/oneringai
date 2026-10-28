import type { ToolContext, ToolFunction } from '../../domain/entities/Tool.js';

// A function-owned, versioned bridge survives ESM/CJS and duplicate bundles.
// It is deliberately absent from tool definitions, contexts and raw results.
const OUTCOME_CAPTURE = Symbol.for('@everworker/oneringai/outcome-invocation/v1');

export type OutcomeExecutor = (
  this: ToolFunction,
  args: unknown,
  context: ToolContext | undefined,
  reportFailure: (error: Error) => void,
) => Promise<unknown>;

type Capture = () => OutcomeExecutor | undefined;

/** Capture before awaiting admission hooks; wrappers must capture their inner call too. */
export function captureOutcomeExecutor(execute: ToolFunction['execute']): OutcomeExecutor | undefined {
  let capture: unknown;
  try { capture = Object.getOwnPropertyDescriptor(execute, OUTCOME_CAPTURE)?.value; }
  catch { return undefined; } // Legacy callable proxies need not support metadata reflection.
  return typeof capture === 'function' ? (capture as Capture)() : undefined;
}

/** Private opt-in protocol; replacing an execute function does not inherit it. */
export function attachOutcomeCapture(execute: ToolFunction['execute'], capture: Capture): void {
  Object.defineProperty(execute, OUTCOME_CAPTURE, { value: capture });
}
