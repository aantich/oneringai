# Stage 06 implementation record

Started 2026-10-13 on `version2`, base `dcc8dad`. User authorized the next stage
with “proceed”. Stage 02 is committed; this work is limited to Stage 06.

## Scope and compatibility

Add optional static helper roles, a process-local shared model task, purpose-based
usage, and bounded calls through existing connector/provider factories. Main model
selection and the shared ToolManager remain unchanged. Existing profiles, sessions,
direct/managed calls and streaming hook semantics remain valid. No breaking change
is authorized. No automatic main-model routing, new context framework, distributed
budget, or Stage 07 automatic compaction strategy is included.

The first compactor integration uses the existing explicit between-executions
rollover. Helpers receive explicit text packets and a bounded JSON schema, have
no tools/native tools, and cannot inherit provider continuation/reasoning state.
Named connector lookup uses the host registry. Helpers and rollover never serialize
credentials or runtime authority. Context transfer to another connector requires
an explicit host setting. Host-requested extraction and verification demonstrate
the same invocation boundary.

## Delivery decisions

- Add optional `modelExecution` configuration and `modelTask` per-call options.
  `ModelTask` shares process-local reservations and immutable diagnostic snapshots
  across explicit main/helper calls. Disabled configuration makes no extra calls.
- Observe SDK transport attempts (including retries) using per-provider fetch
  adapters and invocation-local async context. Do not alter default retry policy.
  Aggregate normalized usage once per logical invocation; retries without reported
  usage remain explicitly unknown and conservatively charged against reservations.
- Use conservative provider input/output capacity for hard reservation bounds,
  rather than treating local token estimates as reliable prepaid cost bounds.
  Hard monetary limits require known conservative token prices; native service fees
  and unobservable custom-provider retries cannot silently bypass a hard ceiling.
- Helpers resolve their connector, model, capabilities and input allowance before
  an optional packet-builder callback runs. Validate JSON locally with existing
  Ajv dependencies. Repair is bounded and shares the same task. Escalation is an
  explicit host call to another configured role, not an implicit model switch.
- Task accounting/reservations are runtime-only. Snapshots can be saved as diagnostic
  data; loading them never restores live authority or replenishes a task's budget.
  Hosts reapply optional helper configuration on session hydration.
- AMOS gets optional helper configuration, explicit helper/rollover commands and a
  purpose-attributed usage view. Existing configurations load without enabling work.
  Help explains extra requests before helper use is enabled.

## Validation scope completed

Budget reservation races, exhaustion, unknown pricing/usage, retries, repair,
cancellation/deadlines, late settlement, stream early exit, external-report
deduplication, scoped connector denial, capability failures, malformed helper JSON,
explicit escalation, native-state isolation, unchanged main state, persistence,
and disabled-feature compatibility. Include public offline and opt-in live examples,
AMOS adapter/config/command tests, built public consumers, all unit tests and live
Stage 00–02 regressions plus Stage 06 real-provider cases. Record actual results
and source fingerprints before marking the stage complete.


## Completion — 2026-10-13

Implemented the selected scope with additive exports and optional configuration;
no breaking API or default change was proposed or required. Main selection and
ToolManager ownership remain unchanged. SDK custom-fetch/request-signal support
was checked against installed SDK types/source and the official
[OpenAI TypeScript reference](https://developers.openai.com/api/reference/typescript).
The adapter forwards ordinary fetch unchanged outside a task and retains SDK retry
policies. Actual SDK/mock-HTTP tests verify transport admission independently of
provider mocks. Helpers intentionally bypass main Agent/context hooks/events.

Final validation passes **7,131 units in 339 files**, including **101 new cases**;
**42 live cases / 54 distinct scenarios** across OpenAI, Anthropic and Google;
all build/type/lint/consumer/example/API/package checks; AMOS build and command/
runner/config/session/failure tests and offline walkthrough. New runtime-module
coverage is **97.93% lines / 84.97% branches**; this is not whole-repository coverage.
See [machine evidence](../evaluations/STAGE_06_VALIDATION.json) for counts, original
failures, actual usage, source fingerprints, support boundaries and uncertainty.

Cleanup review corrected owned-task preflight timers; budget review retained host
upper prices after usage settlement, validated finite bounds and preserved mixed
external-tier uncertainty. All-zero built-in transport usage remains unknown in the
ledger without changing legacy zero-filled response/event shapes. Earlier Google
exact-text answer failures remain recorded, including reproduced unrelated output;
no request defect was found and the subsequent unchanged full suite passed.
Functional samples do not prove model reliability or comparative helper quality.

The Version 2 availability/adoption/handoff, recipe, standard usage docs, generated
API, examples/index, AMOS guide/transcript, Changelog and package inventory are
synced. Availability is the uncommitted `version2` working tree based on `dcc8dad`,
not a verified package release. Stage 03 is next in the dependency-valid sequence
and requires separate authorization. Stage 07 automatic compaction/quality work,
distributed budgets, routing and native-state migration remain deferred.


## Review status 2026-10-13

The subsequent [review and fix plan](STAGE_06_REVIEW_AND_FIX_PLAN.md) reproduced
eight defects (two P1, six P2) absent from the original passing gates. All eight
are now fixed and validated; the original review and validation remain historical.
The [corrective record](STAGE_06_REVIEW_AND_FIX_PLAN.md#correction-completion--2026-10-13)
and [machine evidence](../evaluations/STAGE_06_CORRECTIONS_VALIDATION.json) record
the fixes, 48 new regressions, **7,179 units / 339 files**, **45 live cases / 57
scenarios**, scoped **98.14% line / 88.34% branch** coverage, and all local delivery
checks. Original response/event shapes, schema portability and task ownership are
preserved. The first two new Google thinking fixtures failed their output-format
assertion; explicit native-JSON fixtures and the unchanged established live gates
pass. Failed runs are retained, with no reliability claim or package release.

## Second review status — 2026-10-13

The [second review](STAGE_06_SECOND_REVIEW.md) reproduced four further findings
(two P1, two P2) while all 149 focused cases passed. All four are now fixed:
aggregate candidate reservation/caps, captured request data, sticky mixed-pricing
uncertainty and evidence-preserving bounded repair. The [completion record](STAGE_06_SECOND_REVIEW.md#correction-completion--2026-10-13)
and [evidence](../evaluations/STAGE_06_SECOND_CORRECTIONS_VALIDATION.json) record
**7,228 units / 339 files**, **198 Stage 06 tests / 49 new regressions**, **48 live
cases / 60 scenarios**, scoped **98.24% lines / 90.10% branches**, and local
delivery checks. Offline library/AMOS examples now exercise deliberate repair.
Earlier records remain unchanged history. No API break or release is claimed;
Stage 03 remains separately authorized.
