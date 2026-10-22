# Agentic baseline evaluation — Stage 00

Stage 00 establishes reproducible compatibility and task-completion baselines for
the [Version 2 roadmap](./designs/AGENTIC_ARCHITECTURE_EVOLUTION.md). The evaluator
is a repository example/test utility built on existing APIs; it adds no production
exports, model routing, compaction policy, or changed defaults. See the
[Version 2 Guide](./VERSION_2_GUIDE.md) for current delivery and release status.

## Run the offline baseline

From a repository checkout with development dependencies installed:

```bash
npm run example:agentic-baseline
npm run example:agentic-baseline -- --held-out
npm run examples:check
```

The [example](../examples/agentic-evaluation-baseline.ts) runs the real managed,
non-streaming `Agent` loop with a strict injected replay provider and local fixture
tools. No key or network access is needed. Reports include task completion, model
and tool calls, repeated tool calls, correlated runs/steps, durations, and usage
availability. An unsuccessful evaluation exits with code 1.

The supporting code lives in [examples/agentic-baseline](../examples/agentic-baseline/runner.ts).
It is intentionally small and is not a packaged evaluation API. These commands,
tests, and example links require the source checkout; installing the npm package
alone does not install the evaluator or its test fixtures.

Fixture prompts and results are synthetic. Replay responses carry synthetic token
usage (`100` input, `10` output per model call), not estimates of a provider's actual
usage. Measured execution durations and random connector identities can differ
between runs; completion, correlated local IDs, call counts, and synthetic usage
are reproducible. Existing library logs can appear before the JSON report.

## Workloads and completion gates

| Workload | What executes | Completion requires | Offline calls (LLM / tool) |
| --- | --- | --- | --- |
| Chat | A managed call without tools. | The exact requested marker. | 1 / 0 |
| Large observation | Read a roughly 34 KB synthetic document with the answer near its end. | Actual retained tool evidence plus the correct answer and source ID in JSON. | 2 / 1 |
| Research | Read two sources and choose the higher score. | Both reads executed, correct choice, and both source IDs in order in JSON. | 3 / 2 |
| External workflow | Submit one mock job, cancel after acceptance, checkpoint context, advance the mock service, and continue in a fresh agent. | Accepted submission is retained; the original job is checked after the host transition; the completed receipt matches the tool evidence. | 3 / 2 |

All workloads require no event-correlation errors. Live gates also require no
repeated tool calls, observed usage, and the expected execution outcomes. A single
enclosing JSON code fence is accepted as presentation; prose, fabricated evidence,
missing citations, incorrect JSON structure, and invented receipts fail.

Live models may request the two research reads in the same iteration, so their
model-call count can differ from the serial replay recording. Parallel provider
requests do not establish that library tool execution is parallel.

The large-observation fixture measures evidence use; it does not force a context
overflow or claim to exercise every compaction boundary. Those correctness tests
belong to stage 01. Fixture agents explicitly disable working/in-context memory to
isolate the workloads; default plugin behavior is tested separately and is unchanged.

## Strict replay and adding a fixture

The [replay provider](../examples/agentic-baseline/replay-provider.ts) checks each
recorded prompt and tool's availability. Before yielding a recorded future response,
it verifies the originating tool name, call ID, arguments, and returned evidence.
A changed argument or result requires an explicitly modeled branch; the original
future cannot be replayed against it. An exhausted or unmatched recording fails.

To extend a workload:

1. Define fresh state, allowed arguments, local tools, and completion checks in
   [fixtures.ts](../examples/agentic-baseline/fixtures.ts). Derive completion from
   observed effects/evidence, not only the final prose.
2. Record frames for the exact branch in use. Include the prior calls and results
   needed to justify each future response; model counterfactual branches separately.
3. Add development and held-out parameters without tuning against held-out results.
   Add tests for wrong arguments, missing evidence, incorrect output, cancellation,
   and cleanup as applicable.
4. Update the gates, example index, and Version 2 Guide with the actual scope.

The current held-out split changes markers and identifiers; it is a small plumbing
check, not a representative hidden benchmark. Do not use it to claim general model
quality. Future comparisons need richer independently defined workloads and a frozen
split before tuning a strategy.

## Run actual LLMs

Live execution retains the same local tools and completion checks but lets the
provider choose the trajectory. It is not replay and does not contact an external
document, research, or job service. Credentials are loaded from `.env` through
named connectors.

```bash
# One provider, all four workloads; real billable model requests.
npm run example:agentic-baseline -- --live

# Another explicit provider/model pair.
BASELINE_VENDOR=google BASELINE_MODEL=gemini-2.5-flash npm run example:agentic-baseline -- --live --held-out

# Full stage live suite: OpenAI, Anthropic, Google; both splits.
npm run test:agentic:live

# Explicit subset when a provider is unavailable; keep the limitation in the record.
BASELINE_LIVE_PROVIDERS=openai,google BASELINE_REPORT_PATH=/tmp/oneringai-stage00-live.json npm run test:agentic:live
```

The suite uses `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, and `GOOGLE_API_KEY`. Override
its model choices with `BASELINE_OPENAI_MODEL`, `BASELINE_ANTHROPIC_MODEL`, and
`BASELINE_GOOGLE_MODEL`. Defaults are `gpt-4o-mini`,
`claude-haiku-4-5-20251001`, and `gemini-2.5-flash`: test configurations, not universal
recommendations. Check registry support and account access when changing them.
Explicitly enabled providers with missing/invalid credentials fail; they are not
silently skipped. The regular unit suite makes no live calls, and this live suite
requires its opt-in flag/script.

The fixture agent caps iterations at six and tool calls at six, uses a 60-second
execution limit, and requests at most 512 output tokens through an existing
`before:llm` hook. Thinking and empty-output retries are disabled for these extraction
fixtures. For the named Google connector with `gemini-2.5-flash`, the fixture also
sets the existing `vendorOptions.generationConfig.thinkingConfig.thinkingBudget`
to `0`: the current adapter's `thinking.enabled: false` alone leaves Google's
native automatic-thinking default in place. Other model overrides need their own
supported settings; this tested override is not a universal provider policy.
These are fixture settings, not changes to agent defaults or a hard monetary ceiling. Current
execution cancellation does not guarantee abortion of an in-flight provider call.
SIGINT stops the example from starting more fixtures; cleanup removes owned agents,
listeners, and connectors. Host-owned live connectors are retained by the runner.

## What the report establishes

The [reporter](../examples/agentic-baseline/reporter.ts) listens to existing
execution, LLM, and tool events. It assigns stable local run and step IDs, with
parent links to the fixture and iteration. Requested connector/model and the
model reported by each response are recorded. Duplicate response notifications
and final execution aggregates do not add usage a second time.

For each usage field, report `knownSubtotal`, `missingCalls`, and `total`. When a
field is absent, invalid, negative, or a call errors before reporting it, the complete
total is `null`. A known zero remains zero. Unknown prices and external fees are not
estimated; there is no monetary-cost conclusion from these reports.

Reports retain only selected metadata, outcomes, counts, timings, and usage. They
exclude credentials, instructions, prompts, responses, tool arguments/results,
provider error messages, and even internal argument hashes. Caller-injected providers
are labeled `injected`, rather than being presented as actual live LLM calls. This policy applies to
the collected report; it does not change existing application/provider logging.
Report listeners detach before agent destruction so teardown does not alter the
observed execution outcome.

The event boundary matters. This stage observes managed non-streaming calls that
emit these events. It does not claim full accounting of provider-internal retries,
direct repair/wrap-up paths without those events, hosted tools, external service
fees, or another SDK's agent loop. Adapters can normalize unavailable raw usage
into zeros; the reporter cannot infer missing provider data that the adapter has
already replaced. Full task accounting and helper-call budgets are stage 06 work.

`library_completed` records a tool completion event, not proof that a remote job
finished. The workflow fixture's host-owned receipt check establishes its task
completion separately. Accurate semantic tool outcomes are stage 02 work.

## Compatibility inventory

This is a representative inventory of the contracts touched by the next core
stages, not a frozen copy of every public API.

| Contract | Preserved baseline / check |
| --- | --- |
| Public imports and packaging | A [consumer compile fixture](../tests/fixtures/agentic-baseline/consumer.ts) imports only the built package root; ESM/CJS export verification remains part of the build. |
| Connector identity | Explicit vendor and named connector, injected provider for offline runs; evaluator never changes caller-owned live connectors. |
| Managed/direct/streaming APIs | Consumer fixture compiles current run, runDirect, stream, response, event, and session signatures. Live evaluator covers managed non-streaming only. |
| Shared tools | Agent and context retain the same ToolManager; application payloads including `success: false` are returned intact. |
| Default context | Working and in-context memory enabled; other feature flags disabled; algorithmic strategy remains selected. |
| Extensions | Custom plugin content, cache invalidation, state restoration, destruction, and the existing compaction/consolidation interfaces remain usable. |
| Saved sessions | [Pinned format-v1 JSON](../tests/fixtures/agentic-baseline/session-v1.json) restores prompt, conversation, tool pairs, and known plugin state, then round-trips without migration. |
| Malformed sessions | Missing and syntactically corrupt files return false from context load; general schema validation of parseable arbitrary JSON is not claimed. Unknown plugin states retain the existing ignore-on-restore behavior. |
| Cancellation/checkpoint | The host explicitly checkpoints pending input alongside committed history before restoring a fresh context. A mock service transition supplies completion; this is not a durable effect ledger or a universal restart guarantee. |
| AMOS | Existing context command names/help, overview rendering, unavailable statistics, and diagnostics are captured by [AMOS baseline tests](../tests/unit/apps/amos/AgenticBaseline.test.ts). |

Compile the consumer after building:

```bash
npm run build
npm run test:agentic:compat
npm run test:unit
```

The pinned session is synthetic and uses the pre-evolution format. Keep the file
fixed in later stages; do not regenerate it from changed serialization to make a
regression pass. Add distinct migration fixtures if formats evolve.

## AMOS baseline and scope

Existing inspection surfaces are `/context` (`/ctx`), `budget`, `breakdown`,
`cache`, `memory`, `history`, plus `/status`, `/history`, and `/session` save/load.
The current overview displays utilization, used/available tokens, status, mode,
and links to budget/breakdown. The command fixture supplies 100 used and 900
available tokens and verifies the actual renderer's `10% (ok)` overview. This is
a controlled command-output baseline, not a captured user session.

No new AMOS UI or command is needed for test-only evaluation. The tests preserve
current inspection behavior. Stages 01/02/06 should add relevant visible reporting
when they expose new accounting, outcome, and model-role information.

## Statistical protocol for future comparisons

1. Freeze workload versions, development/held-out assignment, completion predicates,
   and safety/compatibility gates before tuning. Run the same tasks against baseline
   and candidate, changing one mechanism at a time.
2. Record repository/package/provider SDK revisions, requested and returned model
   version, all selected settings, seed where supported (otherwise explicitly absent),
   sample count, ordering, and conditions such as warm versus cold cache.
3. A single sample per model/workload/split is a live plumbing pilot. It cannot prove
   improved quality, non-inferiority, cost reduction, or a stable latency percentile.
   The current report marks its uncertainty accordingly.
4. Before a comparative run, choose independent task variants, repetitions, a
   predeclared quality margin, and sample size appropriate to the observed variance
   and decision. Preserve the paired design and randomize execution order; repeated
   calls on one task are not independent tasks.
5. Report completion counts and confidence intervals, paired differences, and
   latency distributions with uncertainty. Cluster resampling at the task level
   avoids treating repetitions as independent. Include unsuccessful and cancelled
   attempts and all known usage; keep unknown cost separate. Do not report a
   workload-weighted aggregate without declaring the weighting.
6. Constraint loss, fabricated evidence, replay against changed arguments, permission
   expansion, duplicate external effects, and compatibility regressions are hard
   failures. Passing a quality average does not waive those gates.

Measured runs and actual validation results belong in the roadmap's stage record.
This protocol is a recipe, not a newly introduced benchmark service.

## Recorded Stage 00 validation

Validated on 2026-10-07 in the `version2` working tree based on commit `43b34cd`,
with package `1.2.0` and Node.js `v24.20.0`. The stage changes are uncommitted;
this is branch validation, not a published release.

- Full unit suite: **6,775 tests in 320 files passed**, including all 33 new
  evaluator, compatibility, and AMOS tests. Coverage for the four evaluator helper
  files was **99.43% lines, 94.81% branches**; this is not repository-wide coverage.
- Build, package export verification, root typecheck/lint, examples typecheck,
  built-package consumer compile, strict checks of new test files, and ESM/CJS
  import smoke checks passed. Both offline splits completed all four workloads.
- The [saved live pilot](./evaluations/STAGE_00_LIVE_PILOT.json) contains 24 successful
  runs: four workloads × two splits × OpenAI/Anthropic/Google. There were 49 observed
  model calls, 30 tool calls, no repeated tool calls, and no event-correlation errors.
  Requested/returned models, observed usage, settings, and SDK versions are recorded.
  OpenAI/Google passed eight selected test cases initially; Anthropic subsequently
  passed its four cases, each covering both splits, with `claude-haiku-4-5-20251001`.
  The pilot combines those two batches, with separate timestamps; unselected
  providers in each invocation were skipped explicitly.
- Another 19 existing OpenAI and **11 existing Anthropic** agent/context integration
  tests passed, including direct, managed, streaming, tools, memory, and continuity
  paths. One Anthropic case checks local context construction without inference.
  The Anthropic command is:

  ```bash
  env -u ANTHROPIC_API_KEY npx vitest run tests/integration/text/Agent.integration.test.ts tests/integration/context-nextgen/ContextNextGenWithAgent.integration.test.ts -t Anthropic
  ```

  Unsetting the inherited key for the child process lets the tests reload the
  refreshed `.env` value. The live baseline was run with
  `BASELINE_LIVE_PROVIDERS=anthropic` and its report saved before combining batches.
- Anthropic's initial invalid key and a subsequent unscoped-key retry failed before
  inference. The user then supplied a workspace-scoped key, resolving authentication.
  The older integration fixtures used `claude-sonnet-4-20250514`, which returned 404;
  they now use `claude-sonnet-4-6`, verified in the registry and live Models API.
  Assertions and production APIs are unchanged. Sonnet 4's retirement is documented
  in [Anthropic's model deprecations](https://platform.claude.com/docs/en/about-claude/model-deprecations).
  Earlier failed attempts are summarized separately in the pilot and are not
  counted among its passing workload runs. A key spanning workspaces requires
  the workspace header described in
  [Anthropic's authentication guide](https://platform.claude.com/docs/en/manage-claude/authentication#select-a-workspace).

The pilot has one sample per model/workload/split and is not a comparative benchmark.
Earlier diagnostic runs informed fixture output framing and the explicit Gemini
thinking setting; they are not included in a claim about success rate or savings.
The report's usage applies to the event boundary described above, not all SDK work.

## Stage 12 fixture calibration — 2026-10-16

The baseline runner now explicitly requests temperature zero when the selected
model registry permits it; unsupported temperature parameters remain omitted.
This controls a previously unspecified sampling input, without changing normal
Agent/preset defaults. Reports include requested/resolved temperature. Historical
pilots used vendor defaults and must not be presented as matched sampling trials.
Google's explicit thinkingBudget=0 and the 512-token output cap remain unchanged.

One uncalibrated Google chat run failed exact completion and reported all 512
output tokens consumed. The old report did not retain response text/status, so
its exact generated body and internal cause cannot be reconstructed. Three exact
configuration probes confirmed the intended thinking budget/cap were sent and
returned the correct five-token marker. This is evidence of an intermittent model
output failure, not proof of a broken provider conversion or a particular token
pattern. Explicit sampling is a fixture calibration, not a guarantee that models
will always comply. See the [generation configuration contract](https://ai.google.dev/api/generate-content#v1beta.GenerationConfig).

Per-model steps now optionally include response status, stop reason, text character
count and SHA256. No prompts or response bodies are added to trajectory reports.
This distinguishes provider completion/length limits from failed fixture semantics.
The evaluator still rejects missing/wrong/truncated output, retains the same tool
and completion checks, uses no automatic retry and does not increase the output cap.
Tests verify actual provider-boundary sampling and that capped wrong output remains
a failure. The Stage 12 evidence records calibration trials and the final full gate.


Stage 12 second-correction regression validation preserves baseline scoring and
provider setup. The final combined gate passes 148 tests / 160 scenarios across
all nine agentic suites with OpenAI, Anthropic and Google; see the
[fresh record](evaluations/STAGE_12_SECOND_CORRECTIONS.json). This includes the
unchanged baseline development/holdout workloads; no new model quality claim.


Stage 12 third-correction validation leaves baseline scoring/provider setup intact.
All nine existing suites pass 148 tests / 160 scenarios; three additional permanent
session-recovery live cases verify actual original-history continuation and blocked
local writes across OpenAI, Anthropic and Google. Total final gates: 151 tests / 163
scenarios, zero failures/skips. See the [latest record](evaluations/STAGE_12_THIRD_CORRECTIONS.json).
The new recovery fixtures do not change the baseline workload or support a general
quality/cost claim.


Stage 05 preserves baseline workload scoring and its calibrated provider setup.
The separate Stage 07 comparison example now records explicit zero-temperature
main/helper sampling and metadata-only scoped notes-key feedback after unavailable
selectors. Exact completion, account/status, no-write/no-repeat, call/output bounds
and failure reporting remain unchanged. Historical failed attempts are retained;
this example calibration changes neither normal Agent defaults nor general model
quality claims. See the Stage 05 implementation and validation record.
