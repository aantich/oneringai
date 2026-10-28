# Verified routines (C3, branch availability)

`createRoutineRunner` is an opt-in facade over the existing routine engine. Existing
`executeRoutine`, `createRoutineTool`, task unions and session formats retain their
contracts. Import all consumer APIs from `@everworker/oneringai`.

```typescript
const runner = createRoutineRunner({
  verify: async (observation, { execution, signal }) => {
    // Trusted application/provider checks; model text is not business completion.
    const ready = observation.phase === 'task'
      ? await checkTaskReadiness(observation, signal)
      : await checkFinalArtifact(observation, signal);
    return ready ? { kind: 'verified' } : { kind: 'waiting', reason: 'Remote work pending' };
  },
});
const result = await runner.run({ definition, agent, execution: { modelTask, signal } });
if ('continuation' in result) {
  const next = await runner.resume(result.continuation, {
    authorize: () => authorizeCurrentHost(),
    execution: { signal: newCallerSignal }, // Original ModelTask/deadline retained.
  });
}
// On shutdown: invalidates continuations and requests cancellation.
runner.close();
```

Task verification gates dependencies; final verification occurs after applicable
post-steps. A settled tool, provider acceptance or high reflection score cannot
substitute for these checks. Strict reflection requires both `isComplete === true`
and a finite sufficient score. `warn` preserves a failed quality result separately.
Authorized reconciliation may recheck the retained response through stateless
reflection; it never resubmits the settled task prompt or repeats its action.
Negative/missing expected managed verdicts, refusal, suspension, pending async work
and failed execution require explicit reconciliation. Async queue continuation uses
the original Agent/task. Unacknowledged context evidence must be repaired through
its existing acknowledgement API before progression/completion.

The required verifier returns `verified`, or `waiting`/`blocked`/`uncertain` with a
reason. Its inputs are frozen detached JSON views; malformed/throwing callbacks
produce an uncertain recovery result. Verifier truth remains the host's responsibility.
The second argument includes the current signal (including nested deadlines) and
explicit binding. Forward both to any host helper call to share accounting; hidden
external model calls are not automatically counted. Progress callback failures are
isolated. Observations include `executionId` to disambiguate repeated nested task IDs and retain initial/latest decisions, real tool outcomes, step
results and source references. Small tool sources include exact argument/result
JSON; full response/step bodies occupy their phase/step fields rather than every
metadata entry. A tool's business `success: false` payload is not itself a framework
failure; deterministic steps consume semantic outcomes.

The borrowed Agent remains exclusively leased while paused. Ordinary run/stream,
direct and maintenance calls fail before dispatch during that lease. Tools and
context share the original manager. Fixed required-tool scopes filter visible
definitions and deny guessed/extraneously enabled names at dispatch; nested scopes
intersect. Existing host permissions still apply. The host must not independently
mutate that borrowed Agent/context/manager or execute its separate backend handles
during ownership, except explicit source/evidence/state repair. Temporary hooks and
routine memory slots restore at terminal cleanup, including overwritten parent
slots; ordinary task memory persists. Cleanup recovery retries bookkeeping only.

Preflight detaches the definition/inputs and validates the whole nested static DAG,
required tools/plugins, scopes and supported settings before pre-steps. Supported:
sequential FIFO static tasks, templates, conditions, map/fold/until and deterministic
pre/post-steps. False wait conditions pause before submission; skipped tasks are
reported as skipped and their host-approved omission can satisfy dependencies.
`postStepsTrigger: 'always'` runs once after a terminal task outcome, never on each
wait or after cancellation. Omitted/one outer attempt submits once. Explicit replay
attempts, dynamic/parallel scheduling, model approval, custom validator dispatch and
external-dependency scheduling reject before action; use the host verifier for
external completion. Existing APIs retain their old behavior.

Positive routine/iteration deadlines span waiting; zero disables the respective
deadline and omission adds no routine cap. Step defaults remain 30 seconds. Supported
timer values are at most 2,147,483,647 ms. Preflight bounds definitions to 32 nested
levels and 1,000 static tasks per definition. Control-flow retains the existing 1,000
iteration protection; an implicitly larger source fails explicitly. An explicit
`maxIterations` selects bounded work; the host owns coverage requirements. These
are execution protections, not proof that an external collection is exhausted.

Continuations are opaque same-process capabilities, bound to one runner, Agent and
current generation. JSON/context snapshots cannot recreate them. Resume serializes
host authorization; rejection, callback failure, pre-abort or a different task does
not consume the paused handle. An uncooperative authorization stays locked until
actual settlement. Successful admission consumes it and any further wait issues one
successor. Caller signal replacement cannot replace the ModelTask or reset deadlines.
Borrowed Agents/tasks are never destroyed. Cancellation does not establish whether
an external action happened. A terminated execution with retained effects can be
reconciled at a final receipt check; it has no cursor for unstarted tasks.

## Bounded sources and host recovery

`maxObservationBytes` defaults to 1 MiB (8 KiB–64 MiB); it bounds detached JSON view
construction, not the heap already owned by caller/provider/tool implementations.
`maxActiveOperations` defaults to 32 (1–1,000), including paused/settling operations.
No silent truncation becomes proof. Oversized/nonprojectable observations retain
raw sources and pause before further actions. Already admitted concurrent work can
still settle and remains correlated. `inspect(id)` is local and bounded, exposing
24 source headers plus omitted count and a source-index ID; it makes no model call.
Terminal safely delivered operations retire, so inspection can return null. A usage
snapshot exceeding the view allowance is omitted with `usageOmitted`; the host's
original ModelTask retains full accounting.

1. Call host-only `readSource(operationId, sourceId, { maxBytes })` with an explicit
   copy allowance; the source-index ID retrieves complete source metadata.
2. Archive exact allowed/redacted data through your existing acknowledged backend.
3. Call `acknowledgeSource(operationId, sourceId, reference)` with that backend's
   `EvidenceReference`, then explicitly authorize resume. Acknowledgements are
   immutable and correlated; the runner validates shape, not backend truth. A bundled
   view reference includes the original source IDs/index inside that archived view.
4. Repair any actual context tool-evidence failure separately through
   `agent.context.acknowledgeToolEvidence`. Source archival cannot waive it.

Recovery reads/acknowledgements remain available after `close()` revokes execution
handles. Sources arriving after the last delivered report remain protected at close; queued
async delivery is cancelled locally without a further model call. Late sources have distinct IDs and cannot overwrite an earlier archived
receipt. Call close again after host repairs if closed cleanup needs release.
Never rerun an action to regenerate a lost observation. There is no new journal,
backend, restart cursor, distributed lease or exactly-once effect guarantee.

## Model-facing adapter and examples

`runner.asTool({ definition, toolName, createAgent, resolveExecution? })` requires a
fresh host-built child. It returns operation/state and at most 32 distinct references
(with explicit `omittedReferences` when needed; the full host source index remains available); host
progress/inspection owns the continuation. Concurrent/repeated invocations while
waiting reuse the existing operation. The child survives waiting and is destroyed
once after safe terminal cleanup; a rejected active caller is never destroyed.
Resolver task authority is host-owned and its signal cannot remove ToolContext
cancellation. No model argument contains a live Agent, task or continuation.

Build, then run `npm run example:verified-routines` for an offline submission,
wait/reconcile and post-step artifact demonstration with one submission/model call.
AMOS `/routine demo` demonstrates the same host gate with synthetic local actions
and **one billable selected-model call**. `/routine inspect`, `/routine confirm` and
`/routine cancel` inspect, reconcile and revoke it. Confirmation applies only to
this synthetic demo. No AMOS saved configuration/session migration is required.

Durable workflow restore (C3-R), production provider checks and ICOS adoption remain
outside this slice. Branch availability is not a verified package release.
