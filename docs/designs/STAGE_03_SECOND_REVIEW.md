# Stage 03 second review and fix plan

Reviewed 2026-10-14 on `version2`, against Stage 03 plus the first corrective
pass, based on committed Stage 06 revision `a98a498`.

**Current status: all three findings are corrected and validated.** See the
[corrective completion](#corrective-completion--2026-10-14) and
[validation](../evaluations/STAGE_03_SECOND_CORRECTIONS_VALIDATION.json). The original
six corrections remain valid. Findings below describe the review snapshot; no runtime
code or permanent tests were changed during the review itself. The previous
[corrective validation](../evaluations/STAGE_03_CORRECTIONS_VALIDATION.json)
remains historical evidence; it does not cover these newly reproduced paths.

A subsequent [third review](STAGE_03_THIRD_REVIEW.md) records two new P1 findings
and one P2 finding. These second-review corrections remain in place; the
[third corrective completion](STAGE_03_THIRD_REVIEW.md#corrective-completion--2026-10-14)
now resolves those findings and restores overall Stage 03 completion.

At review time validation passed: **7,397 unit tests / 344 files**, including all **169
Stage 03 tests**, and the built public-package compatibility consumer. All 34
fingerprints in the previous corrective record matched at review start. The
[review evidence](../evaluations/STAGE_03_SECOND_REVIEW.json) contains exact
observations, commands, report hashes, the executable reproduction and reviewed
fingerprints. Each defect reproduces against both current source and built public
exports. The script asserts the defective behavior, with a passing protection
control; those confirmations are not successful completion gates.

The review covered storage/serialization, ownership, middleware/settlement,
managed and async delivery, recovery, persistence, hooks, compatibility, examples,
documentation and AMOS integration. No credentials were loaded, billable calls
made, or external actions repeated. These failures occur in deterministic local
boundaries, so the previously recorded 60 live cases were not rerun in this review.

## S1 — P1: Mid-loop async delivery overwrites a protected blocking result

Location: [async insertion](../../src/core/Agent.ts#L1581), through
[current-input replacement](../../src/core/context-nextgen/AgentContextNextGen.ts#L1029).
Also audit [explicit continuation](../../src/core/Agent.ts#L3816).

The loop stores blocking tool results in `_currentInput`. If a native async tool
has also completed, the next iteration formats that completion and calls
`addUserMessage()`. That method replaces `_currentInput`; it does not append or
commit its existing results. The async guard checks only the incoming completions,
so an acknowledged background result can erase a different blocking result whose
evidence write failed. The new compaction/rollover protection never sees the erased
content. Its original tool call remains in history without its result.

**Reproduction:** A controlled model requests one non-blocking tool and one
blocking synthetic write. The blocking tool waits for the background completion,
then returns its exact source once. Its evidence write fails; the background
write succeeds. Immediately before injection, the blocking raw result is present
with failed-storage metadata. The second model request and final retained context
contain no raw source, storage has no observation for that tool, and its original
call remains in history. The run nevertheless returns normally after two model
calls. No private Agent fields are modified or inspected by the reproduction.

This replacement mechanism existed before Stage 03. The defect is its interaction
with Stage 03's new guarantee that unacknowledged source results remain protected.

**Fix:** Preserve the existing pending call/results before adding async input.
Reuse the current conversation/input machinery to commit or append complete
protocol groups in order. If a protected group cannot be kept, reject before
mutating input or consuming the async queue. Apply the same protection to owned
manual/automatic continuation when prior input remains after an interrupted run.
Keep existing scope invalidation and diagnostic-only late-delivery rules. Avoid a
new queue or context transaction framework.

**Regressions:** Mixed acknowledged async/unacknowledged blocking results, both
completion orders and multiple results; raw content and failure metadata retained;
valid call/result ordering; no extra external execution; mid-loop and manual/auto
continuation; interruption followed by continuation; listener errors, cancellation,
identity changes and destruction. Exercise both managed modes where supported,
and verify provider conversion of the combined input. Preserve evidence-disabled
behavior and existing queue-recovery tests.

## S2 — P1: Optional outcome omission silently removes raw-result protection

Location: [metadata admission](../../src/core/context-nextgen/AgentContextNextGen.ts#L1208).

`ToolResult.outcome` and `ToolResult.evidence` are independently optional public
fields. `addToolResults()` uses an authentic delivery for projection, but derives
retention metadata exclusively from `r.outcome.evidence`. A host can legitimately
pass the raw result and its authentic `storage_failed` delivery without passing
the separate outcome. The raw content enters context without protection metadata
and can be removed by ordinary rollover. The public durable-evidence example
already demonstrates this delivery-only construction for the successful case.

**Reproduction:** Execute once against an unavailable evidence store and pass
`{ tool_use_id, content: report.result, evidence: report.evidence, state }` to
`addToolResults()`. After committing the turn, rollover succeeds and removes the
raw source despite zero stored records. A control passing the same report's
`outcome` rejects rollover with the unacknowledged-evidence error and retains the
source.

**Fix:** Derive protection and recovery correlation from the authenticated
delivery when outcome is omitted. Retain original execution/call provenance in
internal delivery metadata, reusing the existing middleware's ownership mechanism.
When both fields exist, make their selection consistent. Projection validity and
raw-retention status must remain separate. Keep `outcome` optional; requiring it
or rejecting previously accepted delivery-only results would change the public
contract and is not proposed. Do not trust a model-created receipt to authorize
discarding source content.

**Regressions:** Delivery only, outcome only, both and neither; successful,
projection-failed and storage-failed receipts; authentic versus copied/forged
delivery objects; original call/execution recovery matching; normal compaction,
spill, emergency truncation and rollover; saved/restored groups; disabled evidence
and legacy callers. Extend the public consumer/example to cover a failed write,
not only successful projection.

## S3 — P1: Saving an interrupted run omits its unacknowledged raw result

Locations: [snapshot construction](../../src/core/context-nextgen/AgentContextNextGen.ts#L2645)
and [Agent session save](../../src/core/BaseAgent.ts#L675).

`getState()` includes committed conversation but omits `_currentInput`. If an
evidence write fails and the next model request also fails, the raw result remains
only in that pending input. `saveSession()` still succeeds, but the resulting
snapshot contains the original call and recent failure receipt without the raw
observation. Loading that explicitly saved session cannot recover it. The history
journal cannot substitute for acknowledged snapshot retention: it is optional,
and its permissive, asynchronous guarantees are intentionally weaker.

**Reproduction:** A synthetic write executes once, its evidence write fails, and
the second controlled model request throws `controlled provider unavailable`.
The pending input still contains the raw source. Public `agent.saveSession()`
succeeds with bundled `FileContextStorage`. A second Agent loads the saved session;
neither the saved state nor the restored context contains that source, and the
evidence store contains zero records. This is an ordinary explicit save/load
failure, not a process-crash or external-action replay claim.

The omission predates Stage 03, but the new failed-evidence retention contract
requires this persistence boundary to preserve or explicitly reject the pending
observation.

**Fix:** Include protected pending call/result groups in the saved view, without
mutating the active conversation or replaying tools. Prefer a detached snapshot
that folds these groups into its existing `conversation` field; this can preserve
the current session schema. If distinct pending state is necessary, make it an
optional, versioned addition with legacy loading. Preserve acknowledgement
metadata and original IDs so host recovery still works after load. A save must
not report success after omitting the only retained observation. Audit subsequent
input replacement after interrupted runs alongside S1.

**Regressions:** Evidence failure followed by model error, cancellation or a fit
error; direct context save and Agent session save/autosave; bundled file storage
and a custom backend without a journal; fresh-instance restore, exact source and
IDs, host acknowledgement, later permitted rollover; repeated saves without
duplicates; snapshots detached from later mutation; old sessions and
evidence-disabled shapes/defaults. Saving must not execute a tool or make another
model call.

## Corrective order and acceptance

1. Add meaningful failing regressions for S1–S3, including built public consumers.
2. Correct async replacement and preserve interrupted pending input (S1).
3. Make delivery-only protection carry authentic recovery correlation (S2).
4. Preserve protected pending groups across explicit session snapshots (S3),
   reusing the input handling from S1 where useful.
5. Extend the recovery example with interruption/save/load. Validate AMOS's real
   save/continuation path and adapt its existing guidance if behavior changes;
   no new command or abstraction is currently justified.
6. Update the recipe, examples index, API documentation if signatures change,
   Version 2 availability/adoption/handoff, roadmap and completion records.
   Package this review and its evidence with the corrective delivery.
7. Run focused regressions, full units, build/type/lint, examples, public ESM/CJS
   compatibility and AMOS checks. Rerun the complete opt-in OpenAI/Anthropic/Google
   live gate after runtime changes, including retrieval and raw fallback. Preserve
   initial failing reports and distinguish new regressions from earlier passing
   validation. Mark Stage 03 complete only when all findings and required checks
   are resolved.

All recommended fixes fit within the existing opt-in feature, optional metadata,
shared tool manager and session machinery. No breaking change is proposed, and
no fix is implemented by this review. If implementation reveals a required public
break, stop that affected change and obtain the user's explicit approval first.
Stage 07 remains separately authorized future work.

## Corrective completion — 2026-10-14

All three findings are fixed on `version2`, without a public API break or action
replay. Protected pending groups are committed before replacement by user/tool
input, including async injection and subsequent runs. Authentic deliveries retain
execution/call/scope correlation in internal metadata; `outcome` stays optional.
Matching delivery receipts take precedence over conflicting outcome metadata, and
foreign-scope/call deliveries cannot authorize projection or correlation.

Snapshots with protected pending input contain a detached copy of conversation
plus that complete input in the existing `conversation` field. Saving leaves live
input untouched. Same-instance load/restore removes exact protected pending copies
already included in restored history, avoiding duplicate final results. Older
sessions, disabled defaults, public return/event shapes and custom storage methods
remain compatible. These fixes add no new public API; delivery provenance and
preservation helpers are internal.

Validation: **7,435 units / 345 files**, including **38 new regressions / 207
Stage 03 cases**; **63 live cases / 75 scenarios**, with zero skips across
OpenAI/Anthropic/Google; **14 offline examples**. All three new live probes restore
a delivery-only pending failed observation and read its exact marker through the
real provider, without another tool execution. Scoped evidence components cover
**99.83% lines / 93.08% branches**; this percentage excludes Agent/context code,
which is exercised by the broader unit and integration suites. Build/export,
strict source/test types, lint, examples, public ESM/CJS compatibility, generated
API and AMOS build/type/save-load checks pass.

The updated public recovery example demonstrates pending save/load, result-bearing
acknowledgement and one action execution. AMOS needs no new command: its real
runner regression verifies saving/reloading an interrupted observation using the
file session backend. Existing evidence listing/preview and persisted settings
remain valid. The recipe, standard guides, agent instructions, examples index,
Version 2 adoption/handoff, roadmap, generated API, release notes and packaged
review/validation are synchronized.

Initial regression evidence is preserved: 22 of 32 new tests failed before the
runtime fixes; two additional same-instance restore regressions failed before
deduplication. An intermediate pair of failures came from using the wrong OpenAI
converter method in the test fixture; that fixture was corrected to its actual
`convertInput()` API. Initial build/loopback-example sandbox `EPERM` failures were
rerun successfully with the necessary local IPC/listener access. No assertion was
weakened and no provider failure occurred in the final live gate. See
[second corrective evidence](../evaluations/STAGE_03_SECOND_CORRECTIONS_VALIDATION.json)
for commands, reports, fingerprints and earlier attempts.

Explicit clearing, destruction and host snapshot overrides remain host-owned;
these changes do not promise crash-resumable external actions. The evidence
backend's process/restart/fsync boundaries remain unchanged. Stage **03 is complete
on branch**; Stage **07** remains separately authorized future work.
