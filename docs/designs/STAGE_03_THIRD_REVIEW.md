# Stage 03 third review and fix plan

Reviewed 2026-10-14 on `version2`, against Stage 03 and its two corrective passes,
based on committed Stage 06 revision `a98a498`.

**Current status: T1–T3 are fixed and validated.** See the
[corrective completion](#corrective-completion--2026-10-14) and
[validation record](../evaluations/STAGE_03_THIRD_CORRECTIONS_VALIDATION.json).
The findings below describe the review snapshot. Earlier corrections remain in
place; no runtime code, permanent tests or package inventory changed during the
review itself. The subsequent corrective delivery is recorded separately below.

At review time, gates passed: **7,435 units / 345 files**, including **207 Stage 03 cases**,
and public-package compatibility. All **35** recorded source/consumer fingerprints
match. The [executable review evidence](../evaluations/STAGE_03_THIRD_REVIEW.json)
contains the exact observations, commands, script and hashes. Every defect
reproduces against both current source and built public exports. Synthetic tools
and controlled providers use no credentials, billable calls or external writes.
The prior 63-case live gate was not rerun because these defects occur in local
settlement, receipt admission and restoration boundaries; no runtime changed.

The review covered the complete evidence implementation and its latest input,
metadata and snapshot changes, including storage/serialization, middleware,
managed/streaming/async delivery, recovery, persistence, authorization, plugin
lifecycle, compatibility, examples, documentation and AMOS integration. Passing
existing tests do not resolve the additional failures below.

## T1 — P1: Early exits lose settled results before context batching commits

Locations: [stream completion yield](../../src/core/Agent.ts#L2458),
[later context commit](../../src/core/Agent.ts#L2471), and
[fail-fast batch exit](../../src/core/Agent.ts#L3267).

Streaming accumulates completed results locally and yields `TOOL_EXECUTION_DONE`
before committing assistant/tool messages to context. A consumer that closes the
iterator at that event skips the later commit. Execution cleanup then leaves the
raw result outside both context and its saved view. The completion event contains
the raw object, so a host that separately retains it can recover; framework context
retention does not provide that copy. The new pending-input snapshot fix cannot
help because these results never reached pending input.

The non-streaming batch has the same gap when `toolFailureMode: 'fail'` throws for
a later tool. Earlier settled results are still in the batch's local array when
execution exits, before the caller's `addToolResults()` call.

**Reproductions:**

- One synthetic write succeeds while evidence storage is unavailable. The stream
  emits its raw completion with `storage_failed`; the consumer breaks immediately.
  There is one tool execution and one model call. Neither retained context nor its
  snapshot contains the raw source, and the store has zero records. A control
  draining the stream fully retains the exact source in both views.
- A controlled model requests a write followed by a cooperative tool. The write
  succeeds once but cannot be stored. The second tool reaches the real manager's
  30 ms deadline, and fail-fast mode throws. One model call and one execution of
  each tool occur; the earlier raw source is absent from context and snapshots,
  with zero evidence records. The fixture uses a real deadline: ordinary thrown
  tool errors are normalized by default and are not assumed to escape the manager.

**Fix:** Give settled observations a retained context owner on every exit path.
Commit partial completed batches exactly once on iterator closure, cancellation,
timeout and fail-fast exits, or commit before an externally observable yield.
Reuse the existing batching and pending-input machinery. Preserve the associated
assistant calls, original IDs, reasoning/opaque provider state and valid ordering;
avoid duplicate results when the loop subsequently completes normally. Flush
retained observations before execution cleanup. Keep unexecuted calls distinct
from completed results, and preserve existing disabled-feature/event contracts.
No new tool scheduler, journal substitute or replay mechanism is needed.

**Regressions:** Iterator `return()`/`break` at each tool completion, first/last
results of multi-tool batches, consumer exceptions, cancellation/deadlines, later
fail-fast errors and observer failures; raw preservation and exact save/load
recovery; valid protocol and one final result per invocation; fully drained
run/stream controls; unchanged accounting, event payloads and disabled behavior.
Assert one original action and no extra model request during recovery.

## T2 — P1: A receipt-only delivery can remove failed-result protection

Locations: [delivery provenance](../../src/core/evidence/ToolEvidenceMiddleware.ts#L31)
and [receipt precedence](../../src/core/context-nextgen/AgentContextNextGen.ts#L1215).

The middleware supports receipt-only records for unresolved/error observations.
Those deliveries are authentic and carry execution/call/scope provenance, but that
provenance does not indicate whether the acknowledged record contains a result.
Context admission lets a matching authentic delivery override the supplied outcome's
`storage_failed` receipt. A successful status-only write can therefore mark actual
raw content as stored and make it removable, although the stored record cannot
recover that content. The earlier `acknowledgeToolEvidence()` guard rejects the
same receipt; the admission path bypasses it.

**Reproduction:** Execute a local write with storage unavailable, repair storage,
and create a matching receipt using `record(tool, args, context, outcome)` without
the result argument. Pass its authentic delivery alongside the original failed
outcome and raw content to `addToolResults()`. Rollover succeeds and removes the
raw source. The only stored record has no `result` property. A separate control
passes that reference to `acknowledgeToolEvidence()`; it rejects and retains the
failed-storage protection as intended.

**Fix:** Distinguish acknowledgement of a receipt from acknowledgement of an
observation in the existing private provenance. A status-only delivery must not
release protection for raw result content. Preserve result-bearing recovery,
including explicit `null` and deliberate host redaction. Apply the same rule to
managed admission and async recovery/continuation, retaining existing failures
until an actual observation is acknowledged. Keep receipt-only diagnostics valid
and `outcome` optional. Preserve supported legacy outcome-only inputs and older
saved metadata; no new required public field or backend method is necessary.

**Regressions:** Matching receipt-only delivery with both/omitted outcome,
conflicting receipt statuses, normal/error/unknown-completion receipts, redacted
and null result-bearing recovery; queued and explicit async recovery; rollover,
compaction, truncation and snapshots; original correlation/scope and one external
execution. The direct acknowledgement rejection must remain effective, and a
failed recovery must leave the existing raw group protected.

## T3 — P2: Recovery between checkpoint and restore creates duplicate results

Location: [pending-input reconciliation](../../src/core/context-nextgen/AgentContextNextGen.ts#L1023).

Same-instance reconciliation runs only while current input contains a
`storage_failed` item and compares complete JSON. A valid host acknowledgement
changes the pending item's receipt to `stored`. Restoring the earlier checkpoint
then installs its old failed result in history while leaving the now-stored pending
copy in place. Preparation rejects the two final results for the same call. Raw
content is retained, but the restored session cannot continue normally.

**Reproduction:** Snapshot pending failed evidence, store its observation, and
acknowledge the pending result. Restore the original snapshot into the same context.
There are two final results for `call`; `prepare()` throws `Duplicate final tool
result for function:call`. Both public `restoreState()` and `save()` followed by
`load()` with bundled `FileContextStorage` reproduce the failure. The existing
same-instance regressions restore unchanged receipts and miss this transition.

**Fix:** Reconcile folded pending observations by their protocol/invocation
identity, accounting for receipt evolution after a checkpoint. Define which saved
or live view owns the matching invocation, and ensure one final result. Retain
unrelated pending input and distinct function/custom namespaces. Preserve source
content/protection where it has not been acknowledged, and keep the existing
session format and legacy loading behavior. Avoid introducing a general state
transaction or blanket change to all pending-input restoration semantics.

**Regressions:** Checkpoint, recovery acknowledgement and same-instance
restore/load; stored-to-failed and failed-to-stored receipt transitions; differing
references, mixed batches and repeated restoration; separate call namespaces,
original IDs and exact raw data; `prepare()` success without duplicate results;
acknowledgement after restore and later permitted rollover; legacy/disabled sessions.

## Corrective order and acceptance

1. Add failing regressions for all three findings, including public-package cases.
2. Close the partial-batch retention gap across streaming and fail-fast execution
   (T1), using one commit owner per batch/exit path.
3. Carry result-bearing acknowledgement proof through existing private delivery
   metadata and its admission/recovery paths (T2).
4. Reconcile saved/live invocation identity across receipt transitions (T3).
5. Extend the public recovery demonstration and validate AMOS's interruption and
   session behavior where relevant. Update the recipe and standard guides, examples
   index, Version 2 adoption/handoff, roadmap and generated API if needed. Package
   this review and its evidence with the corrective delivery.
6. Rerun focused regressions, full units, build/type/lint, examples, ESM/CJS public
   consumers and AMOS checks. Run the full opt-in OpenAI/Anthropic/Google live gate
   after runtime changes. Retain earlier failing evidence and report final required
   checks explicitly before restoring Stage 03 completion.

No breaking API change or implementation is proposed by this review. If a required
public break emerges, stop that affected change and obtain explicit approval under
the user's standing rule. Stage 07 remains separately authorized future work.

## Corrective completion — 2026-10-14

All three findings are fixed without a public API or saved-session schema change:

- **T1:** Managed execution retains completed unacknowledged observations before
  a later batch failure, completion-listener exception, cancellation or consumer
  closure of a stream. Streaming cleanup commits the associated assistant output,
  opaque provider state and settled results once. Fully drained and evidence-disabled
  behavior remains covered; external transports continue to own their history.
- **T2:** Private authenticated-delivery provenance records whether storage
  acknowledged a result body. A receipt-only delivery remains a valid execution
  diagnostic, but cannot release context protection or authorize async continuation.
  Store and acknowledge the retained observation to recover without replaying the
  external action. Actual redacted or explicit-null result bodies remain supported;
  optional `outcome`, legacy metadata and backend contracts remain compatible.
- **T3:** Restore/load reconciles folded pending results by content namespace,
  tool-call ID and execution ID across acknowledgement changes. The loaded
  checkpoint owns a matching invocation; unrelated pending blocks and separate
  invocations survive. Legacy metadata without execution IDs keeps the previous
  exact-copy fallback. Restoring an older failed receipt can require acknowledgement
  again; it cannot introduce a second final result.

Final gates pass: **7,473 units / 346 files**, including **245 Stage 03 cases**
and **38 new regressions** (37 core, one AMOS); **66 live cases / 78 distinct
scenarios**, with zero skips across OpenAI, Anthropic and Google; and **15 offline
examples**. Three new live probes close a stream after local tool completion,
retain and save its failed-storage observation, recover through the checkpoint
and read its exact marker with one original action. The AMOS real-runner tests
cover both run and stream interruption with explicit file save/load/save; all
seven AMOS evidence tests pass. No new app command is needed.

Build (24 public export files), root and strict test types, lint, public consumer
compatibility, example types, AMOS types/build, public ESM/CJS, and generated API
(1,661 items) pass. Four evidence components have **99.83% line / 93.30% branch /
98.63% function coverage**. These percentages exclude Agent/context; their
integration is exercised by the regression and live cases. Package inventory,
local documentation links, credential-pattern scanning and recorded fingerprints
are checked in the validation record.

The new public [stream interruption example](../../examples/evidence-stream-interruption.ts)
is deterministic and requires no credentials. It demonstrates closure, receipt-only
protection, recovery, restoration and exact retrieval with one local action and
one synthetic model call. The recipe, standard guides, examples, AMOS notes,
Changelog, roadmap and Version 2 handoff are synchronized.

Earlier attempts remain recorded: 29 regressions failed before the runtime fixes;
a mock-reset fixture was corrected without weakening the exact-once assertion.
An AMOS test and its typecheck were incorrectly overlapped with the root rebuild,
so they read the previous/missing bundle; both were rerun after the completed
build, and the full final unit gate passes. Initial fixture/type errors are retained.

The initial full live batch passed 65/66 cases; Google's baseline chat/development
case failed `completion_not_proven`. Its original answer was not captured. Four
bounded diagnostic calls retained their actual answers: one returned a fenced
JSON `tool_code` wrapper instead of the required exact text, while three passed.
That demonstrates format noncompliance in a fresh call, but does not establish the
original failed answer. A complete unchanged live rerun passed all 66 cases.
No completion rule was relaxed and no library retry was added; these are functional
probes, not a reliability guarantee. All reports and diagnostic answers are preserved
in [corrective evidence](../evaluations/STAGE_03_THIRD_CORRECTIONS_VALIDATION.json).

Stage 03 is complete in the `version2` working tree based on `a98a498`; no commit,
push, package release or breaking API approval is claimed. Stage 07 remains
separately authorized future work.
