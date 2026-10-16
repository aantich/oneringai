# Stage 10 — Bounded recovery and verifiable completion

Status: complete on branch after both review passes and expanded validation on
2026-10-16, including actual Google recovery from the recorded empty summary.
See the [latest review/fix](STAGE_10_SECOND_REVIEW_AND_FIXES.md) and
[latest evidence](../evaluations/STAGE_10_SECOND_CORRECTIONS_VALIDATION.json).
Original delivery results below remain historical; latest gates are appended.
No package release is claimed.
Authorized by the user's “proceed” on 2026-10-16, on `version2` based on
`d8fce94` (Stage 04). Only Stage 10 is authorized. No breaking change, commit,
push or later-stage implementation is implied.

## Delivery scope

Reuse the existing managed loops, ToolManager, context preparation, evidence,
task-state view, ModelTask budgets and execution leases. Extract focused shared
response/empty-retry decisions and introduce one opt-in host policy for bounded
recovery/progress and a host completion predicate. Do not replace provider,
realtime, external SDK or session controllers.

Delivered additive surface: `AgentConfig.loopPolicy` and per-run override (including
explicit null to disable it), public policy/check/diagnostic types, a detached
`agent.getLoopDiagnostics()` snapshot and optional `loop` metadata on existing
responses/stream completion/iteration events. No new stream discriminant or
provider response status. An ordinary unconfigured run gains no prompt content,
callback, recovery attempt or mandatory verifier.

Policy decisions use actual framework outcomes and declared tool effects, not
application `success: false` conventions. Normalized bounded argument/result
fingerprints detect repetition; explicit repeatable read tools permit polling.
Repeated writes and unknown effects stop before replay; recovery asks the model
to choose a safe next step through the existing permission/hook/tool pipeline.
Recovery feedback and completion retries share a bounded per-execution allowance,
as well as existing iteration/model/task limits. No automatic tool replay,
retrieval, escalation, model routing or new workflow engine.

Host completion checks receive a detached bounded candidate/evidence/task view
and cancellation signal. Checks are bounded, locally validated and revision/owner
checked before use; pending asynchronous work and uncertain effects cannot become
confirmed completion merely because final prose or a tool reports success.
Callback functions and per-execution counters are host/runtime authority and are
not restored from sessions. Checkpointed task/evidence state remains available
through the existing configured plugins on a new execution.

Keep intentional legacy run/stream differences, including nonstream JSON repair,
provider-visible partial stream text, existing hook order and execution ownership.
Parity tests compare shared decisions under equivalent blocking-tool inputs.
External/realtime loops retain their existing owner; text-loop policies do not
claim to control their remote internal steps. An observer of AgentRuntime events
does not own runtime cancellation; closing the owning `Agent.stream()` generator
retains its existing lifecycle contract and settled evidence protection.

## Examples, AMOS and validation

Deliver deterministic `feedback-driven-agent.ts` and `run-stream-equivalence.ts`
walkthroughs, an AMOS adapter/inspection/progress demonstration, explicit opt-in
three-provider live tests, and public legacy/new consumer fixtures. Preserve
existing events, raw tool outputs, statuses, session fields and defaults.

Test semantic run/stream traces, normalized calls/results and valid repeated
reads, failure/repair budgets, uncertain/duplicate effects, permission/hook order,
callback validation/timeouts/cancellation/staleness, partial output/refusal,
structured-output repair, suspend/resume, async deliveries, leases/disconnects,
file recovery, and relevant realtime/external bridge regressions. Build before
public consumers/AMOS; never clean/rebuild root dist concurrently with tests,
examples or live calls. Record every final gate and unavailable provider honestly.

Update the Version 2 Guide, recipe, standard guides, generated API, example index,
AMOS, release notes and this record before marking the stage complete.

## Research check — 2026-10-16

[Anthropic's agent-evaluation guidance](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)
distinguishes environment outcomes from transcripts; deterministic state/effect
checks and trajectory review are complementary. The
[original tau-bench paper](https://arxiv.org/abs/2406.12045) evaluates final state
and repeated-trial reliability. These motivate host-owned completion checks and
semantic action-trace tests, not a claim that arbitrary model prose verifies a
workflow or that this stage improves benchmark scores. Newer benchmark variants
do not replace this library's existing workload-specific baseline.

## Design decisions and compatibility

- `LoopController` is a private per-execution policy component. Shared helpers
  classify responses/empty retries and prepare before-tool hooks; the existing
  managed loops, preparation, ToolManager, event transport and leases remain.
- Explicit opt-in avoids changing ordinary chat's default prompt/verification
  cost. No required callback, new event discriminant, TaskStatus member, session
  field, storage method, runtime-driver capability or resolved-feature key.
- The policy performs no automatic helper/model routing, retrieval, delegation,
  write replay or workflow transition. Host callbacks own semantic verification
  and authorization. They are bounded and cooperative; JavaScript cannot preempt
  a synchronous callback that blocks the event loop.
- A shared recovery allowance defaults to two interventions. Read observation
  repetition and actual framework failures differ from application `success:false`.
  Declared write/unknown calls are protected against identical replay in the same
  execution; this is not durable/semantic exactly-once execution. Explicit read
  polling is allowlisted. Admission, signature, observation and failure tracking
  have hard bounds, including calls still pending asynchronously.
- With a policy, stream uses the shared `before:tool` skip/argument preparation;
  unconfigured stream keeps its legacy trace. Run-only final JSON repair remains
  run-only and precedes the host predicate. Partial stream output remains
  provisional. Provider status remains independent of host workflow diagnostics.
- Callback packets are detached/frozen with bounded text, last-100 observation
  metadata, explicit omission counts/flags and optional full built-in task state.
  Callback deadlines/cancellation and owner/plugin/task generation/conversation
  identity guards prevent stale/late verdicts. Host feedback is appended without
  replacing original input or pending tool results.
- Policy functions/counters are excluded from saved runtime/session authority.
  Same-agent load retains live host configuration/latest diagnostic; fresh agents
  need explicit policy configuration. Evidence/task-state recovery keeps its
  existing scope/checkpoint contracts. Async continuation creates a fresh policy
  execution; pending work is not automatically repeated or cancelled.

The complete verified API/default/support recipe is
[Loop Policies](../AGENT_LOOP_POLICIES.md). Examples use public package exports;
unchanged legacy consumers and new root/`types` policy consumers compile against
the built package. No breaking API change was proposed or approved.

## Tests and AMOS

The permanent Stage 10 suite covers 94 core cases and six AMOS adapter cases.
It exercises failure/semantic trace equivalence, legacy trace controls, canonical
arguments, read polling, duplicate writes, uncertain timeouts, budgets including
explicit helper admission, permission denial, bounded tracking, callback
validation/cancellation/timeouts/stale restores, refusal/incomplete responses,
run-only repaired candidates, suspension/checkpoints, async continuation, early
owning-stream closure and retained raw evidence, and external-loop ownership.
Full unit gates also retain existing realtime/external bridge, runtime observer
detach, lease and persistence regressions. Coverage is scoped to the new policy
module; it is not a whole-Agent coverage claim.

AMOS adds optional JSON thresholds, host-only in-memory policy override, optional
runner inspector and `/context loop`. Phase/reason/recovery/final status are
rendered separately from assistant prose. Stream progress uses optional metadata
on the app's existing notification/done surfaces, preserving discriminants.
Actual runner tests cover disabled/config roundtrip, blocked prose, stream
notices, fresh file recovery, busy rejection, cancellation and late verdicts.
The offline walkthrough saves a blocked task and restores a fresh runner before
the host supplies a new verified completion predicate.

## Validation history (before final gate)

- Initial core/legacy focused gates passed. The offline example and two new
  helper-budget tests initially omitted the existing custom-provider single-attempt
  attestation; their setup now explicitly supplies it, with no relaxation of hard
  limits. A test harness used a nonexistent external finalization method, then
  corrected it to `completeExternalExecution`.
- An exploratory combined strict configuration applied root-only flags to AMOS
  and reported existing AMOS diagnostics. Separate strict configurations now use
  each project's own compiler contract. The new owning-stream test also corrected
  its optional iterator `return` typing.
- The first Stage 10 live probe passed 10/12. Two Anthropic blocked probes did not
  reach the predicate; the initial report did not capture their final stop reason,
  so no exact cause is asserted. A bounded short-answer instruction and 256-token
  cap replaced the 128-token probe; both focused Anthropic checks and the next
  all-provider Stage 10 checks passed. The policy still refuses incomplete
  candidates; no provider/default behavior was loosened.
- The first eight-gate batch passed 128/129. The unchanged Google chat development
  fixture failed its exact-text completion marker while its call/usage completed.
  Both unchanged chat splits passed on a focused recheck. Preserve both results;
  this functional pilot does not establish deterministic model adherence.
- The first 22-example batch passed 21; the existing tool-outcomes HTTP fixture
  was denied its local socket by the sandbox. The final batch runs with authorized
  local-server access. This was an environment failure, not a silent skip.
- Final review added a hard admission bound for unsettled async calls and bounded
  rejected/delivered identity tracking. All 94 focused core cases pass. Final
  build/full-unit/public/offline/live gates run against this corrected source.

## Original completion gates — 2026-10-16 (historical)

The original delivery passed the gates below before the expanded review
reproductions. They do not close the newly identified findings.

| Gate | Result |
| --- | --- |
| Full units | 7,895 tests / 359 files; zero failures/skips. |
| Stage 10 coverage | 94 core + 6 actual AMOS adapter cases; new policy-module lines 96.46%, branches 91.70%. |
| Live regression | One final eight-file batch: 129 cases / 141 recorded scenarios; zero failures/skips; OpenAI, Anthropic and Google. Includes 12 Stage 10 run/stream recovery/blocked probes. |
| Offline examples | All 22 staged examples pass, including the three new Stage 10 examples and actual AMOS checkpoint/inspection walkthrough. |
| Public compatibility | Built root/`types` old/new consumers, eight Stage 10 ESM/CJS runtime controls, and eighteen unchanged prior source/ESM/CJS plugin controls pass. |
| Local gates | Root build/typecheck/lint/examples check; separate strict core/live and AMOS tests/examples; AMOS typecheck/build; generated public API; export verification and whitespace checks pass. |
| Packaging | Dry-run package inventory includes the recipe, stage/live validation records, AMOS transcript and public examples/support provider. No publish performed. |

The [validation record](../evaluations/STAGE_10_VALIDATION.json) contains actual
commands/results, coverage, source/build fingerprints, public proof and retained
initial failures. The [live record](../evaluations/STAGE_10_LIVE.json) retains all
eight final reports and earlier probe/batch/recheck evidence. Functional pilot
results are not a statistical quality, reliability or cost claim. No provider
was unavailable in the final gate; no failures were converted into skips.

Version 2 availability/adoption/handoff, recipe, README, User Guide, generated API,
AGENTS, examples index, AMOS docs and Changelog are synchronized. Generated tool
fingerprints were refreshed by the normal build, not hand-edited. Existing
historical stage records remain unchanged. No breaking API change, package
release, commit or push. **Stage 12** is next in the dependency-valid core sequence
and requires separate authorization; conditional Stage 11 remains deferred.

## Corrective completion — 2026-10-16

All five findings are fixed: authentic async observation import and admitted-effect
correlation, scope rechecks after awaited progress callbacks, stopped connected
history/journal preservation, separate stopped-turn JSON answers, and original
class/prototype host callback receivers. These corrections are internal and add
no required public/session/storage fields, defaults or event discriminants.

Final gates pass **7,950 units / 360 files**, including **155 Stage 10/AMOS cases**,
**135 live cases / 147 scenarios** across all three providers, **22 examples**,
**16 ESM/CJS** and **18 unchanged legacy controls**. Policy-module coverage is
**96.50% lines / 93.01% branches**. Root/AMOS builds, types/lint/examples/strict
checks, generated API and package inventory pass. The first corrective batch's
Google empty-summary rejection is retained; final evaluators/prompts are unchanged.

The [detailed completion](STAGE_10_REVIEW_AND_FIX_PLAN.md#corrective-completion--2026-10-16),
[local/public evidence](../evaluations/STAGE_10_CORRECTIONS_VALIDATION.json),
[live history](../evaluations/STAGE_10_CORRECTIONS_LIVE.json) and
[AMOS transcript](../evaluations/STAGE_10_CORRECTIONS_AMOS_OFFLINE.txt) supersede
preceding historical delivery/review results for the current tree. Version 2
availability/adoption/handoff and all affected guides/examples/AMOS/release notes
are synchronized. No breaking API, commit, push or release. Stage 12 requires
separate authorization; conditional Stage 11 remains deferred.

### Second review fixes and Google recovery — 2026-10-16

The [second review/fixes](STAGE_10_SECOND_REVIEW_AND_FIXES.md) resolves the recorded
Google failure with optional local helper validation inside the existing repair
allowance, preserving native schema and source/task bounds. Pending loop verdicts
also bind tool principal/account/identity/role/session and connector authority.
Both findings are fixed; no breaking API, new defaults, outer retries or action replay.

Latest validation passes **7,988 units / 360 files**, **38 new regressions**,
**136 live cases / 148 scenarios** across all three providers, **22 offline examples**,
**18 ESM/CJS** and **18 legacy controls**. A real Google repair succeeds after
explicit injection of the recorded empty body, with exact source/constraints and
no masking fallback. Builds/types/lint/examples, strict/public/AMOS checks,
generated API and package inventory pass. Version 2/standard guides and handoff
are synchronized; historical evidence remains. No later stage, commit or release.
See [latest validation](../evaluations/STAGE_10_SECOND_CORRECTIONS_VALIDATION.json)
and [live recovery](../evaluations/STAGE_10_SECOND_CORRECTIONS_LIVE.json).
