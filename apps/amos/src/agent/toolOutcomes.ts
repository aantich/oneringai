import type { ToolExecutionOutcome } from '@everworker/oneringai';

/** Explain the evidence available locally without claiming that remote effects stopped. */
export function describeToolOutcome(outcome: ToolExecutionOutcome): string | null {
  if (outcome.status === 'succeeded') return null;
  const detail = `${outcome.toolName}: ${outcome.error ?? outcome.status}`;
  if (outcome.completion === 'not_started') return `${detail} (tool was not started)`;
  if (outcome.completion === 'unknown') return `${detail}. Completion is unknown; the operation may still finish. Check external state before retrying.`;
  if (outcome.cancellation !== 'none') return `${detail}. Tool execution settled; external effects may already have occurred.`;
  return detail;
}
