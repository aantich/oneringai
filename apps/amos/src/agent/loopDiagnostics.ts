import type { AgentLoopDiagnostics } from '@everworker/oneringai';

/** Human-readable policy state, kept separate from assistant prose. */
export function describeLoopDiagnostics(value: AgentLoopDiagnostics): string {
  const reasons: Record<string, string> = {
    completed: 'Host completion check passed', answer_returned: 'Answer returned; no workflow completion check configured',
    predicate_unmet: 'Required completion evidence is missing', recovery_exhausted: 'Recovery allowance exhausted; input needed',
    repeated_results: 'Repeated reads returned no new observation', repeated_action: 'Repeated action stopped before execution',
    tool_failures: 'Tool failure requires recovery', no_progress: 'Host progress state is unchanged',
    uncertain_effect: 'Action outcome is uncertain; verify it before continuing', pending_async: 'Waiting for asynchronous work',
    refusal: 'Provider refused the request', provider_failed: 'Provider execution failed', provider_incomplete: 'Provider response is incomplete',
    iteration_limit: 'Iteration limit reached', budget_exhausted: 'Model task budget exhausted',
    checker_error: 'Host check failed or exceeded its bound', state_changed: 'Host state changed during the check',
    cancelled: 'Execution cancelled', suspended: 'Waiting for the suspended workflow',
  };
  return `Loop ${value.phase}: ${value.reason ? reasons[value.reason] ?? value.reason : 'Execution in progress'}. Recovery attempts: ${value.recoveryAttempts}.`;
}
