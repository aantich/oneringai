# Stage 06 second review and fix plan

Reviewed 2026-10-13 on `version2`, against committed Stage 02 base `dcc8dad` and
the uncommitted Stage 06 implementation plus first corrective pass.

**Current status: all four findings are fixed and validated.** See the completion
record below and [second corrective evidence](../evaluations/STAGE_06_SECOND_CORRECTIONS_VALIDATION.json).
The findings describe the original second-review snapshot, when the previous 48
corrective regressions passed despite these additional gaps. No production code
or permanent tests were changed during that review. The
[recorded reproductions](../evaluations/STAGE_06_SECOND_REVIEW.json) use actual
installed SDKs with mocked HTTP or controlled providers, without loading `.env`
or making billable calls. All 149 focused Stage 06 tests pass in a fresh run.

## S1 — P1: Multiple Google candidates bypass the output reservation

Locations: [single output bound](../../src/core/model-execution/ModelExecutor.ts#L73),
[reservation descriptor](../../src/core/model-execution/ModelExecutor.ts#L80),
[raw Google configuration](../../src/infrastructure/providers/google/GoogleConverter.ts#L108).

`prepare()` reserves one output allowance, but Google accepts
`vendorOptions.generationConfig.candidateCount`. The
[Google GenerationConfig contract](https://ai.google.dev/api/generate-content#v1beta.GenerationConfig)
defines the output limit per candidate, while candidate count controls how many
responses are generated. The provider forwards that option. Aggregate reported
output can therefore exceed the output capacity reserved for this attempt.
Settlement happens after spending, so admitting the next request correctly cannot
prevent the already admitted call from overrunning its token or cost ceiling.

**Reproduction:** The actual Google SDK sends three candidates with an output
limit of 4,096 each. The synthetic usage fixture reports 1,044,480 input tokens
and 12,288 aggregate output tokens; input plus any one candidate is 1,048,576
tokens, within the resolved capacity. The task admits a reservation of 1,052,672 tokens and
`maxCostUSD: 0.3248128` at repository registry rates. It completes with 1,056,768
charged tokens and model cost `0.344064`, exceeding both limits. These are mocked
protocol counts and repository estimates, not a real million-token request or
an invoice claim.

**Fix:** Resolve effective output multiplicity before admission. Reserve the full
aggregate output upper bound with safe arithmetic, or conservatively reject
multiple candidates under token/cost ceilings until supported. Preserve ordinary
unbounded raw-option behavior. Do not silently force the caller's candidate count
to one. Define how the new per-call output cap applies to aggregate output.

**Regressions:** Default/one/multiple candidates; provider aliases where supported;
token and monetary admission before dispatch; retries; Google/Vertex shared
conversion; run/stream restrictions; malformed/overflowing counts; unbounded
compatibility. No new routing abstraction is needed.

## S2 — P1: Mutable vendor options change the request after cost admission

Location: [shallow request snapshot](../../src/core/model-execution/ModelExecutor.ts#L80).

The raw hosted-tool and pricing checks run before the request, but the selected
request keeps the caller's nested `vendorOptions` object. Provider setup awaits
credential normalization and other work before building SDK parameters. A caller
reusing or modifying that object during the await can change cost-affecting
fields after the checks. The wire request then differs from the admitted request.
The earlier direct-task ownership fix protects task cleanup, not request contents.

**Reproduction:** Start `runDirect()` with `maxCostUSD: 1` and an empty shared
`vendorOptions` object. Immediately add
`tools: [{ type: 'web_search_preview' }]` to that same object. With the actual
OpenAI SDK and mocked HTTP, the call completes and the captured wire request
contains the hosted tool. The matching immutable request is rejected by the
existing admission regression. No hosted tool was actually executed in review.

**Fix:** Snapshot the provider request data used for cost/capacity checks and
dispatch before asynchronous work, so validation and execution use one admitted
view. Cover nested tool, pricing, multiplicity and output-affecting options.
Preserve live cancellation signals and legitimate non-JSON SDK values; blindly
`structuredClone`-ing every option can introduce compatibility failures.

**Regressions:** Mutations to empty/existing/nested vendor configuration after
admission; reused configuration across concurrent calls; tools, tiers and
candidate counts; managed request-listener scheduling and direct run/stream;
pre-dispatch rejection or captured original request; unchanged untracked behavior.

## S3 — P2: Final external metadata erases observed mixed pricing

Location: [external usage merge](../../src/core/Agent.ts#L1102).

Incremental reports correctly set `_externalMixedModelPricing`, but completion
spreads `result.usage` after the `mixed_external_tiers` sentinel. A final
`service_tier` replaces that marker, restoring an apparently known price despite
observed mixed tiers. This contradicts the documented mixed-pricing uncertainty
and can make a cost-bounded task admit subsequent work using an unsupported refund.

**Reproduction:** Record two external increments, one standard and one priority,
then complete with aggregate counts and `service_tier: 'standard'`. The task
records the final tier as standard, cost `0.000009` for the 30-token fixture, and
zero unknown-cost invocations. A subsequent cost-bounded call is admitted. Without that final tier field, the existing test
correctly keeps mixed pricing unknown.

**Fix:** Keep observed pricing uncertainty sticky through final merging. Final
count snapshots can override accumulated counts without erasing mixed-tier
evidence. Reconcile mode/speed/tier together and keep legacy external response
fields unchanged. Continue treating external admission as the host's responsibility.

**Regressions:** Mixed tiers/modes/speeds followed by partial and complete final
snapshots, explicit final tier/mode combinations, unknown tiers, count overrides,
deduplication and subsequent bounded admission. Single-tier external reports must
continue to settle normally.

## S4 — P2: Helper repair drops the original evidence packet

Location: [replacement repair input](../../src/core/model-execution/ModelExecutor.ts#L186).

The first call receives the explicit source packet, but the repair replaces it
with schema instructions, the invalid candidate and validation error. The original
task/evidence is absent. A schema-invalid candidate need not retain the facts
required to produce a correct extraction, verification or continuity brief.
The repair can therefore pass local schema validation after losing the only
supplied evidence. For explicit rollover, accepting such a brief can replace
history with an unsupported summary.

**Reproduction:** The source identifier exists only in the original packet. A
controlled provider returns `{ "answer": 7 }`, which fails the required string
schema. Its repair request contains no source identifier; the provider returns
`{ "answer": "SOURCE_UNAVAILABLE" }`. The helper accepts that value with
`outputValidation: 'passed'`. This demonstrates packet loss and schema-only
acceptance, not a measured real-model hallucination rate.

**Fix:** Retain the already selected explicit packet in the one permitted repair,
alongside the invalid candidate and schema error. Recheck the complete repaired
request against the helper input allowance; fail clearly if it cannot fit.
Do not copy additional agent history, trim away evidence silently, add retries or
claim schema validation establishes truth.

**Regressions:** Parse and schema failures, source identifiers/constraints surviving
repair, extractor/verifier/compactor roles, repair overflow, cancellation, shared
call/token budget exhaustion and continued exclusion of tools/opaque state.

## Fix order and delivery gates

1. Resolve request multiplicity and capture the admitted request, S1–S2, using
   the existing invocation boundary and provider option mapping.
2. Preserve mixed external pricing uncertainty, S3.
3. Preserve explicit repair evidence under the same bounded helper allowance, S4.
4. Add permanent regressions and update the recipe, Version 2 adoption/handoff,
   standard docs and relevant examples/AMOS support notes. Regenerate public API
   documentation only when source signatures/comments change.
5. Build, then run full unit/type/lint, built consumers, examples and AMOS checks.
   Revalidate relevant live provider cases after fixes, without weakening existing
   answer/completion gates. Retain prior failed and passing evidence.

The fixes fit existing facilities. No new plugin framework, scheduler, router or
breaking API change is proposed. Preserve disabled defaults, public usage/events,
session/config loading, explicit host task ownership and unbounded vendor options.
If implementation uncovers a concrete compatibility break, stop that affected
change and obtain the user's explicit approval.

The original [validation](../evaluations/STAGE_06_VALIDATION.json), first
[review](../evaluations/STAGE_06_REVIEW.json) and
[corrective validation](../evaluations/STAGE_06_CORRECTIONS_VALIDATION.json) are
unchanged historical evidence. Their full-suite/live successes are not coverage
of these new cases. The review used runtime/test fingerprints from the first
corrective pass. Stage 06 had four open issues at that snapshot; the completion
below supersedes that status.

## Correction completion — 2026-10-13

User authorized all fixes with “fix all”. Delivered within Stage 06 on `version2`,
base `dcc8dad`, without a breaking API change or implementation of another stage.

| Finding | Delivered behavior and permanent regressions |
| --- | --- |
| S1 | Google/Vertex reservations include every requested candidate. Count and aggregate arithmetic are validated before dispatch; retries retain the aggregate reservation. The optional per-call cap is aggregate: absent an explicit per-candidate limit, integer division derives it; explicit limits/count are preserved and excessive aggregate requests fail. Actual SDK/mock-HTTP tests cover counts, token/cost denial, defaults, invalid/overflowing values, wire compatibility and streamed Vertex/shared conversion. |
| S2 | The invocation layer captures request records/arrays before admission; provider dispatch uses that same data. Known class-backed option containers are captured, while live signals, registries, functions and opaque SDK values retain identity. Tests cover all managed/direct run/stream surfaces, nested mutation, reused concurrent configuration, non-JSON values and legacy untracked behavior. |
| S3 | Incremental and final pricing metadata are observed together; mixed uncertainty remains sticky after final count/metadata overrides. Contradictory/composite mode, speed and tier combinations remain unpriced. Tests cover final-only and incremental conflicts, partial snapshots, consistent aliases, execution reset, replay and blocked subsequent bounded admission. Legacy external response fields are unchanged. |
| S4 | One repair retains the original selected evidence plus the invalid answer/error. Its complete request is checked against the original input allowance. Tests cover parse/schema failures across all three roles, explicit compactor history replacement, overflow without trimming, shared budgets, cancellation and late settlement. The builder still runs once and no additional history/tools/native state are copied. |

Final validation passes **7,228 unit tests in 339 files**, including **198 Stage 06
cases** and **49 second-pass regressions** beyond the prior 149. Scoped coverage
for `ModelExecutor` and `ModelTask` is **98.24% lines / 90.10% branches**; this is
not repository-wide coverage. Build/24 exports, source and strict test compilation,
lint, built public compatibility consumers, examples/AMOS types and AMOS build,
generated public API/1,640 items, nine offline examples and the live OpenAI purpose
example pass. Package/artifact checks are recorded in the linked evidence.

Real-provider suites pass **48 cases / 60 distinct scenarios** across OpenAI,
Anthropic and Google: the 34 Stage 00–02 cases/46 scenarios and 14 Stage 06 cases.
Three new cases force a local schema failure after a real helper response, then
verify a second real call retains the source identifier. The controlled wrapper
delegates through the named-connector backend; first-call usage stays intact.
No live multi-candidate ceiling overrun or large billable prompt is attempted;
that boundary is covered by actual SDK/mock-HTTP and safe-arithmetic fixtures.
The final aggregate-default refinement affects multiple candidates only; the
Stage 06 live suite was rerun afterward, while the earlier Stage 00–02 run uses
single-candidate requests with unchanged behavior.

Early new fixtures exposed test errors: a streaming fixture without text deltas
triggered a second legacy empty-response attempt, a batch-cost assertion used the
wrong token total, and an overflow fixture hit the newly derived zero-output guard
first. Each fixture was corrected to isolate its intended contract. Initial strict
fixture typing was also corrected. The final full suite and scoped coverage pass
with zero failures/skips; no established live gate was relaxed. Earlier passing
and failing records remain unchanged history.

The offline public purpose example and real AMOS command/runner walkthrough now
deliberately repair their first schema-invalid answer while retaining `ALPHA_6`.
AMOS shows both failed and passed validation records and cleans up normally; see
the [current transcript](../evaluations/STAGE_06_SECOND_AMOS_OFFLINE.txt).
The Version 2 availability/adoption/handoff, recipe, standard docs, generated API,
examples/index, AMOS guide, release notes and package inventory are synchronized.
No new AMOS command is needed. No released package, comparative quality/savings
or statistical model-reliability claim is made. Stage 03 remains next and requires
separate authorization.
