import { it, expect } from 'vitest';
import { runMeetingComposition, compositionSummary } from '../../../examples/agentic-baseline/composition.js';
it('composes public local/remote routines, exact evidence, explicit host verification and shared accounting on held-out data', async () => {
  const results = [];
  for (const fixture of ['held-out-a-735', 'held-out-b-947']) for (const variant of ['local', 'remote'] as const) results.push(await runMeetingComposition(variant, fixture));
  const report = compositionSummary(results); expect(report).toMatchObject({ samples: 4, passed: true, falseVerifiedCompletions: 0, duplicateEffects: 0, unauthorizedDisclosures: 0 });
  for (const result of results) { expect(result.observed).toMatchObject({ initialState: 'waiting', routineVerification: 'completed', modelCalls: 1, submissions: 1, artifactWrites: 1 }); expect(result.configured.hostCompletionCheck).toBe(false); }
  expect(results[0]!.observed.sourceHash).toBe(results[1]!.observed.sourceHash); expect(results[2]!.observed.sourceHash).toBe(results[3]!.observed.sourceHash);
  expect(results.filter(r => r.variant === 'remote').every(r => r.observed.remote.every(op => !op.pendingSource && op.accounting === 'external_unknown'))).toBe(true);
}, 30_000);
