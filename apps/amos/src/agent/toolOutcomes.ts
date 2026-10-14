import type { ToolExecutionOutcome } from '@everworker/oneringai';

/** Explain available evidence without claiming remote effects stopped or were undone. */
export function describeToolOutcome(outcome: ToolExecutionOutcome): string | null {
  const evidenceNotice = outcome.evidence?.status === 'storage_failed'
    ? ' Evidence storage failed; retain the available raw result. Do not repeat the action to recover evidence.'
    : outcome.evidence?.status === 'projection_failed' ? ' Evidence stored; projection failed, raw result retained.' : '';
  if (outcome.status === 'succeeded') {
    if (outcome.evidence?.status === 'storage_failed') return `${outcome.toolName}: tool execution succeeded; evidence storage failed. Raw result retained. Do not repeat the action to recover evidence.`;
    if (outcome.evidence?.status === 'projection_failed') return `${outcome.toolName}: tool execution succeeded; evidence stored, projection failed. Raw result retained.`;
    return null;
  }
  const detail = `${outcome.toolName}: ${outcome.error ?? outcome.status}`;
  if (outcome.completion === 'not_started') return `${detail} (tool was not started)${evidenceNotice}`;
  if (outcome.completion === 'unknown') return `${detail}. Completion is unknown; the operation may still finish. Check external state before retrying.${evidenceNotice}`;
  if (outcome.cancellation !== 'none') return `${detail}. Tool execution settled; external effects may already have occurred.${evidenceNotice}`;
  return detail + evidenceNotice;
}
