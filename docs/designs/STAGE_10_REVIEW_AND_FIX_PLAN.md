# Stage 10 review and fix plan — 2026-10-16

Status: all five findings corrected and validated on 2026-10-16; Stage 10 complete
on branch. The original review/findings below describe the pre-fix implementation;
see [corrective completion](#corrective-completion--2026-10-16) for current behavior
and gates. Original delivery/live/review evidence is retained unchanged.

Reviewed the uncommitted Stage 10 tree on `version2`, based on `d8fce94`, including
Agent run/stream/async wiring, controller limits/callbacks, context protocol and
history, exports/public consumers, examples, AMOS and documentation. The delivered
source/build fingerprints still match. Fresh existing validation passes **7,895
units / 359 files**, with zero failures/skips, plus root types/lint, public consumer
compatibility, examples checking and AMOS types. No new live calls were made:
these cases require deterministic lifecycle/shape control rather than another
stochastic provider sample. Earlier 129-case live results are not fresh review
validation. Executable scripts and observations are retained in
[review evidence](../evaluations/STAGE_10_REVIEW.json).

## Findings

### R1 — P1: Normal run injection bypasses uncertain async effect handling

Location: `src/core/Agent.ts:1679–1712`.

`continueWithAsyncResults()` imports delivered outcomes into the new controller,
but `_runAgenticLoop()` injects a queued completion as text and consumes it without
observing its authentic outcome. An async write from an earlier managed execution
can time out with `completion: 'unknown'`, then be consumed by a normal `run()`.
The controller sees no observation and the pending queue is already empty, so
the uncertain-effect guard does not preempt completion checking.

Reproduction: one local noncooperative write; initial response is `pending_async`;
wait for its authentic 500 ms timeout. Explicit continuation correctly returns
`uncertain_effect`/blocked with two total model calls and zero completion checks.
Consuming the same kind of result through a fresh `run()` instead makes a third
model call and invokes the checker with an empty observation array, permitting
`completed`. This is a guard bypass, independent of whether the host's own
predicate would also reject the unknown state. No second external action occurs
in the reproduction.

Fix: import authentic delivered outcomes through one internal path before any
receiving controller dispatch/check, including mid-loop injection and explicit
continuation. Preserve correlation/deduplication and the existing delivery scope,
evidence acknowledgement and cancellation guards. A stopped controller must not
make a further main-model call. Do not add tool replay or public required fields.

Tests: previous-run and same-run completions; ordinary run and explicit
continuation; successful/failed reads, unknown writes, pending batches, duplicate
delivery, cancellation/scope change and evidence failure. Assert exact model/
effect counts and checker preemption, not only a final reason string.

### R2 — P1: Async continuation recomputes effect from mutable registration

Location: `src/core/Agent.ts:4081–4083`.

With evidence disabled, outcome metadata has no evidence receipt/effect, so the
new controller falls back to the tool's *current* registration. Invocation effect
was selected at admission and must not change because a tool is re-registered
while the call is pending.

Reproduction: the same actual async write/unknown timeout, followed by supported
re-registration of its name as a read tool. Explicit continuation now presents
the old write as `effect: 'read'`, invokes the checker and reports `completed`.
Without re-registration, explicit continuation blocks correctly. The new read
tool is not executed; only the old classification is changed. This is separate
from R1: explicit continuation imports the outcome but imports the wrong effect.

Fix: retain the admitted effect with the authentic invocation/delivery envelope
and use it in every receiving policy execution. Reuse existing immutable
invocation/evidence correlation; do not infer past effects from current registry
metadata. Define a conservative legacy fallback when admission metadata is
unavailable, preserving disabled-policy behavior and extension contracts.

Tests: write-to-read, read-to-write, unload/reload and pending late settlements;
evidence enabled/disabled; unchanged registration controls; both delivery paths;
scope/session changes. Assert original effect and actual execution identity.

### R3 — P1: Structured formatting replaces a tool call instead of a final answer

Location: `src/core/Agent.ts:1602–1603`.

Policy stops can return the last tool-producing response directly. The existing
structured-output repair assumes that response is a final assistant answer and
calls `replaceLastAssistantResponse()`. It therefore replaces the assistant's
tool call with JSON while leaving the matching result behind. The assumption was
valid for the previous normal final-answer/wrap-up path, not this new stop path.

Reproduction: `maxIterations: 1`, policy enabled, one write, structured response
format. The formatted response returns, but context contains zero tool uses and
one result. Repeat with evidence storage deliberately unavailable: raw result
remains retained internally, but its tool call/arguments are erased and a later
prepared model request silently omits that unmatched unacknowledged result.
This does **not** claim that the protected raw body was physically deleted; the
observed failure is loss of the connected call and model-visible recovery source.

Fix: distinguish a stopped tool turn from a committed final-answer message.
Preserve its call/result group and append/commit any formatted final answer
separately, using existing context operations. Never replace a protected action
call merely to satisfy output formatting. Keep the run-only repair contract and
its existing model budget/fit enforcement; do not issue another write.

Tests: iteration/failure/repetition/uncertainty stops with response formats;
read/write tools; failed/stored evidence; next input, prepare, file save/load and
host evidence repair. Verify exact original calls/arguments, matching results,
protected raw content in the subsequent prepared request and no repeated effect.

### R4 — P2: Stopped tool turns lose ordinary results on the next input

Locations: `src/core/Agent.ts:1972–1975`, `src/core/Agent.ts:2661–2669`.

The new stop paths leave ordinary tool results in `_currentInput` instead of
committing the complete tool turn to history. `addUserMessage()` preserves
unacknowledged evidence specially, but normally replaces pending input. A next
managed turn thus discards the prior settled observation; request sanitization
removes the now-unmatched call. The previous normal final/wrap-up response had
committed those results before a new input arrived.

Reproduction in both run and stream: one successful write, policy enabled,
`maxIterations: 1`, no structured format or evidence plugin. Its unique raw
receipt is present after stopping, then absent from both context and the next
prepared request after `run('Continue')`. Only one write is executed in this
reproduction. Losing the observation makes subsequent reasoning/resumption
unreliable; this is not a demand for cross-execution exactly-once guarantees.

Fix: commit the settled call/result batch at the policy stop boundary without an
extra LLM call, preserving original input, journal order, cancellation/early
generator closure and saved-session behavior. Share the focused finalization
operation across run/stream. Coordinate with R3's formatting target, but cover
the no-format path independently.

Tests: both modes, all tool-induced stop reasons, mixed/skipped/failed batches,
normal next input and file resume, original input and journal roundtrip. Preserve
the existing owning-generator closure and failed-evidence retention controls.

### R5 — P2: Structurally valid class policy methods are silently ignored

Location: `src/core/agent-loop/LoopController.ts:45–59`.

The constructor validates `policy.completion`/`progressKey`, then invokes them
from a spread copy. Class methods live on the prototype and are absent from that
copy. A class implementing the public `AgentLoopPolicy` interface compiles, but
its completion check is silently omitted; the loop reports `answer_returned`.
Receiver-dependent methods must also retain their host receiver when captured.

Reproduction: an object callback with a false verdict and zero recovery returns
blocked/recovery-exhausted. A class with the same false method is accepted by
the built public TypeScript API, performs zero checks and returns an unchecked
answer. Prototype progress callbacks are affected by the same construction.

Fix: explicitly capture validated callbacks from the supplied host policy,
preserving their receiver. Continue snapshotting numeric options/read allowlists.
Do not narrow the supported structural public type to plain literals or reject
existing valid class consumers as a workaround.

Tests: class/prototype and own methods, private receiver state, bound/arrow
callbacks, inherited progress checks, both managed modes, invalid callbacks and
null disable. Add an unchanged class consumer to the root/`types` fixture.

## Correction sequence and exit gate

1. Add meaningful permanent regressions for all five findings before fixing.
2. Capture admitted async effect/correlation (R2), then share delivery import (R1).
3. Finalize stopped tool history (R4), then repair only the final answer (R3).
4. Preserve host policy methods/receivers (R5) without a public API break.
5. Run focused lifecycle/protocol/compatibility checks, then full units, root
   build/types/lint/examples, public consumer/ESM/CJS controls, AMOS gates, all
   offline examples and appropriate three-provider live regression gates. Do not
   rebuild root dist concurrently with consumers/tests/live calls.
6. Update recipe, generated API if its public documentation changes, standard
   guides/examples/AMOS as needed, evaluation records, availability/adoption and
   handoff before restoring completion. Preserve delivery/review history.

These are corrections to the existing Stage 10 facilities. No new loop engine,
scheduler, workflow system or breaking API is required. Stage 12 stays deferred
until corrections are implemented, validated and separately authorized work is
requested. The review does not implement the plan or authorize later stages.

## Corrective completion — 2026-10-16

User authorization: “fix all” covers R1–R5, their regression tests, examples/AMOS
and documentation. No breaking API, later stage, commit, push or release.

| Finding | Delivered correction |
| --- | --- |
| R1 | One importer observes authentic queued and explicit-continuation outcomes before receiving dispatch/checks, applies failure/recovery limits and deduplicates original execution identities. Evidence acknowledgement, cancellation and scope guards remain; scope is rechecked after awaited progress callbacks. |
| R2 | Internal weak correlation captures admitted effect/outcome before async observers and attaches it to authentic results. Re-registration, unload/reload and omission of optional outcome cannot reclassify an old write. Legacy fallback uses receipt effect or unknown, never current registration. |
| R3 | Structured formatting after a stopped tool or synthetic empty response appends a separate answer, preserving original action calls/arguments and connected ordinary/protected results. Repair retains existing fit/task limits and never repeats the action. |
| R4 | Shared normal-stop finalization commits already-journalled settled input before returning or stream completion events. New input/file resume retains results with no extra model response, duplicated journal entries or changed early-close evidence-retention boundary. |
| R5 | Capture validated callbacks explicitly and bind the original host receiver, including prototype/inherited methods and private fields. Own/arrow/bound functions remain supported; thresholds/allowlists/callback selection are captured per execution. |

No supported public signature, default, required session/storage field, event
discriminant or provider status changes. Correlation/import, history commit and
format-target selection are internal. Callback/async correlation is process-local,
not saved authority. New executions have fresh action counters; this does not add
durable/semantic exactly-once execution. Evidence/state repair never authorizes replay.

Final validation passes **7,950 units / 360 files**, with zero failures/skips.
Stage 10 has **155 cases**: 94 original core, 53 new corrective regressions and
eight AMOS adapter cases. New regressions cover both delivery paths/modes, same-run
and duplicate identities, outcome omission, admitted effect with/without evidence,
failed storage and host repair, scope/account changes/cancellation, stopped JSON
history, file resume/journal order, and prototype/private/own/arrow/bound callbacks.
Policy-module coverage is **96.50% lines / 93.01% branches**; this is not whole-Agent
coverage. Public ESM/CJS controls pass **16 cases**; **18 unchanged legacy controls**
and root/`types` consumer compilation, including a class policy, also pass.

One final unchanged eight-file live batch passes **135 cases / 147 recorded
scenarios** across OpenAI, Anthropic and Google, zero failures/skips/unavailable
providers. Stage 10 includes 18 live cases: recovery/blocked and six new stopped
history/formatting probes. All **22 offline examples** pass. Root build/types/lint,
examples checking, separate project-strict tests, AMOS build/types, generated API,
export verification, whitespace and dry-run package inventory pass.

The first correction live batch was **134/135**: Google returned schema-valid JSON
with every summary array empty in the unchanged Stage 07 helper probe. Semantic
validation rejected it before main dispatch or any source read/action. No prompt,
evaluator, fallback or runtime limit was relaxed; the final unchanged batch passes.
This failure and the original red regressions are retained in the correction records;
functional pilots do not establish deterministic model adherence or general quality/
cost improvements.

The public run/stream equivalence example now verifies retained stopped call/receipt
history and run-only JSON formatting. The actual AMOS walkthrough uses prototype
callbacks/private verification state across a blocked checkpoint and fresh host
verification. Its transcript is captured separately. Recipe, Version 2 availability/
adoption/handoff, standard/generated docs, AGENTS, examples/AMOS, release notes and
package inventory are synchronized. Original delivery/review evidence is unchanged.
Stage 12 remains the next separately authorized core stage; Stage 11 is deferred.

Evidence: [local/public validation](../evaluations/STAGE_10_CORRECTIONS_VALIDATION.json),
[all-provider live history](../evaluations/STAGE_10_CORRECTIONS_LIVE.json), and
[AMOS transcript](../evaluations/STAGE_10_CORRECTIONS_AMOS_OFFLINE.txt).

Subsequent [second review and fixes](STAGE_10_SECOND_REVIEW_AND_FIXES.md) resolves
the recorded Google empty-summary repair gap and stale tool-principal completion
checks. Its latest full gates pass; this first review's results remain historical.
