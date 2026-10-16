# OneRingAI Version 2 Guide

This is the living, user-facing guide to OneRingAI's Version 2 initiative. It
explains what each delivered stage enables, how to adopt it, and what must reach
the standard documentation before release. Read the
[architecture roadmap](./designs/AGENTIC_ARCHITECTURE_EVOLUTION.md) for implementation
scope, dependencies, research, and acceptance criteria.

- **Status:** Stages 00–04 and 06 complete on branch. Both Stage 04 reviews' findings are fixed and validated, including legacy public typing and external plugin configuration. Stage 07 is complete on branch as an experimental opt-in delivery, including all three validated review corrections. No package release is claimed.
- **Stage 03 review:** All findings fixed and validated: 7,473 units / 245 Stage 03 cases, 66 live cases / 78 scenarios and 15 offline examples pass. See the [third corrective completion](./designs/STAGE_03_THIRD_REVIEW.md#corrective-completion--2026-10-14).
- **Stage 06 review:** All findings corrected and validated: 7,228 units and 48 live cases/60 scenarios pass. See the [latest completion](./designs/STAGE_06_SECOND_REVIEW.md#correction-completion--2026-10-13).
- **Created / last updated:** 2026-10-07 / 2026-10-16.
- **Repository package version at creation:** `1.2.0`.
- **Implemented stages:** 00 — evaluation and compatibility baselines;
  01 — fresh request accounting and safe compaction;
  02 — tool outcomes and per-execution cancellation;
  03 — durable evidence, scoped retrieval and opt-in projections;
  04 — protected host task state, explicit receipts and separate workflow confirmations;
  06 — explicit helper roles and process-local model tasks/budgets;
  07 — experimental observation masking and source-backed historical summaries, including review corrections.
- **Version 2 release:** Not announced by this document.

“Version 2” names the development initiative. It does not mean that an npm `2.0.0`
release exists, that the features below are available, or that existing APIs will
break. Package versioning and any breaking change require separate decisions.

## Reading this guide

For an integration today, use the [README](../README.md),
[User Guide](../USER_GUIDE.md), [public API reference](../API_REFERENCE.md), and
[runnable examples](../examples/README.md). This guide adds the evolving adoption
story; those documents remain the reference for existing APIs.

Each new capability will have one of these availability labels:

| Label | Meaning |
| --- | --- |
| Planned | Part of the core roadmap; no delivered API or behavior is claimed. |
| In development | Work has started; it has not passed the stage's completion gate. |
| Available on branch | Implemented and validated at an identified revision; not necessarily published. |
| Released | Included in an identified published package version, with verified documentation and examples. |
| Conditional / deferred | An optional extension requiring a concrete workload and separately selected scope; no delivery promise. |

Stage completion and package release are separate. Do not turn “available on branch”
into “released” until the package version and release have been verified. Existing
foundation APIs below are not new Version 2 features.

## What Version 2 aims to improve

Long tasks should keep their constraints, retain useful evidence, and finish with
results the host can verify. Applications should be able to use an evaluated,
inexpensive model for a bounded helper task while retaining their chosen main
model. These improvements should be easy to configure and inspect, with clear
limits on cost, recovery, persistence, and provider support.

The first delivery path has nine core stages:
**00 → 01 → 02 → 06 → 03 → 07 → 04 → 10 → 12**. Stage IDs are stable identifiers;
they are not a requirement to implement every intervening number. Conditional
extensions do not block the core path.

| User need | Existing foundation | Planned core improvement |
| --- | --- | --- |
| Run the same application against different providers | Named connectors, explicit vendors, model registries | Keep that foundation while adding explicit helper-model roles and capability checks. |
| Keep long conversations usable | Plugin context, algorithmic compaction, working and in-context memory | Correct final request accounting, protected task state, structured summaries, and observation masking. |
| Revisit the source behind a short observation | Conversation history, history logging, working memory | Acknowledged evidence references and recoverable projections with documented retention. |
| Know whether an action succeeded | Tool execution, permissions, timeouts, execution plugins | Accurate semantic outcomes and cancellation attributed to the original execution. |
| Spend less on routine helper work | Existing per-model calls and usage information | A fixed main model plus bounded helper calls, with aggregate usage and explicit unknown costs. |
| Finish a workflow with evidence | Agent loops, tools, existing task and memory facilities | Optional task-state views, bounded recovery, and host-defined completion checks. |
| Adopt the improvements without extensive wiring | `Agent.create()` and plugin configuration | Two small opt-in presets with resolved-capability inspection. |

No cost reduction or quality improvement is promised before the relevant workload
has been evaluated. Fewer prompt tokens can still lead to more calls, repeated
searches, or worse results; comparisons must include the whole task.

## The foundation you continue to use

Version 2 builds on the current integration model:

- Create named `Connector` instances for provider credentials and external accounts.
  Provider connectors declare an explicit `Vendor`; model names do not determine
  authentication or vendor identity.
- Use `Agent.create()` with `run()` or `stream()` for managed context and tools.
  Use `runDirect()` or `streamDirect()` deliberately when a direct call is appropriate.
- Add context capabilities through plugins. The agent and context share one
  `ToolManager`: `agent.tools === agent.context.tools`.
- Use the model registries for capabilities and limits. The host supplies trusted
  user, tenant, group, connector, and account scope.
- Continue using `MemorySystem` for long-term entity/fact knowledge and its existing
  ingestion and permission model. Execution observations do not automatically
  become permanent facts.
- Save and load managed context when needed, and destroy disposable agents, plugins,
  and clients during teardown.

Start with the [basic agent example](../examples/basic-agent.ts). For external
accounts and tool sources, use the [Connector & Tool Catalog](./CONNECTOR_TOOL_CATALOG.md).
For long-term knowledge, use the [Memory Guide](./MEMORY_GUIDE.md) and
[Memory Permissions](./MEMORY_PERMISSIONS.md). For interchangeable agent harnesses,
use the [Agent Runtime guide](../USER_GUIDE.md#agent-runtime-preview) and
[local runtime example](../examples/agent-runtime-local.ts).

Provider-hosted tools and external SDK agent harnesses have their own execution
boundaries. A control supported by OneRingAI's local loop must not be presented as
available in every runtime driver. Each delivered feature will state which paths
and drivers support it.

## Evaluate a change against the current behavior

**Availability: Available on branch — stage 00.** Validated on 2026-10-07 in the
`version2` working tree based on `43b34cd`; the stage changes are uncommitted and
no package release is claimed.

Stage 00 delivers a small repository evaluator, not a new production API. It runs
four workloads through the existing managed Agent loop: chat, a large tool
observation, research with retained source IDs, and an external-workflow simulation
with host cancellation, checkpointing, and continuation in a fresh agent. Completion
requires the requested answer and actual tool evidence where relevant.

From a checkout with development dependencies installed:

```bash
npm run example:agentic-baseline
npm run example:agentic-baseline -- --held-out
npm run build
npm run test:agentic:compat
```

Offline runs need no keys and use strict replay: changed tool arguments or results
cannot receive a future response from the original branch. Both splits should
report four passing workloads, correlated runs/steps, call counts, and usage
availability. Offline usage is synthetic; durations may vary. See the
[evaluation guide](./AGENTIC_BASELINE_EVALUATION.md) for the fixture contract,
completion gates, extension steps, and separately opt-in live commands using
named provider connectors and `.env` credentials.

Existing integrations need no changes. Public signatures, defaults, algorithmic
compaction, tool result shapes, and shared tool ownership are unchanged. A consumer
compile fixture checks built-package imports, and a pinned synthetic format-v1
session checks restoration and round-tripping. Reports collect metadata rather
than prompts, credentials, arguments, results, or provider errors. Unknown usage
stays unknown; this does not change existing application logging.

The [recorded live pilot](./evaluations/STAGE_00_LIVE_PILOT.json) combines 24 passing
OpenAI/Anthropic/Google workload/split runs using `gpt-4o-mini`,
`claude-haiku-4-5-20251001`, and `gemini-2.5-flash`. Anthropic passed after the user
provided a workspace-scoped key. The two validation batches have separate timestamps;
earlier failed configuration/model attempts are recorded separately. The pilot has
one sample per model/workload/split and makes no comparative quality or savings
claim. It observes managed non-streaming events; complete helper/retry accounting
and model routing remain future work. The small held-out marker/identifier variants
are a plumbing check, not an independently representative benchmark.

The workflow demonstration uses local mock tools and an explicit host transition.
It preserves pending input alongside committed context; it does not supply a
durable effect ledger or guarantee that cancellation stops an in-flight request.
Consumers can keep existing behavior by not running the evaluator. Evaluator-owned
agents, listeners, and connectors are cleaned up; caller-owned connectors remain.
Existing AMOS inspection commands are tested without adding an app feature.

## Better continuity during long tasks

**Availability: Stage 01 available on branch; Stage 03 available on branch; Stage 07 available on branch, experimental; review corrections validated.**

Stage 01 rebuilds the working-memory index, plugin instructions, catalog schemas,
and token estimates after compaction. Its budget counts the sanitized request,
including visible dynamic definitions and separate instructions. Both managed
`run()` and `stream()` use the selected snapshot and check hook-modified requests
before dispatch. The corrective pass also covers synchronous request listeners,
actual dispatch-model capacity, structured formatting/repair and replay signatures.
The second corrective pass brings known schemas/native tools and initial provider
capacity into the compaction decision, counts function-result errors, and prevents
separate spills from overwriting existing keys, including after saved-state restore.

Existing agents need no configuration changes. The default critical trigger remains
90% and algorithmic compaction remains the default. Preparation invokes a strategy
at most once; protected current input, its tool dependencies, and outstanding native async
calls remain intact. A request that still cannot fit fails clearly. Duplicate final
results are reported as invalid tool protocol; supported asynchronous text updates
remain available. Legacy plugin and strategy interfaces and session format are
preserved.

Inspect `agent.context.lastPreparation` for its revision, selection timestamp, and
estimated budget. AMOS `/context budget` and `/context breakdown` label that revision
and distinguish estimates from provider usage. The breakdown includes overhead.
An inspection does not select another request or trigger compaction.

Run `npm run example:context-freshness`, `npm run example:context-budget`, and
`npm run example:amos-context` after
building for offline demonstrations. See [context preparation](./CONTEXT_PREPARATION.md)
for the additive low-level options, fit errors, race handling, estimate limitations,
and legacy side-effect boundaries. Live checks require actual evidence retrieval,
not only successful provider responses; their record covers OpenAI, Anthropic,
and Google through both managed paths.

Stage 03 implements large-tool projections. Stage 07 adds opt-in experimental observation masking and structured summaries. Its initial functional gate and all three [review corrections](./designs/STAGE_07_REVIEW_AND_FIX_PLAN.md#corrective-completion--2026-10-15) pass:

- **Observation masking:** Keep a useful preview or projection of a large tool
  result in the prompt, with a reference to its retained source where available.
- **Structured summaries:** Carry forward task-relevant findings, source references,
  unresolved questions, and constraints through a bounded helper-model operation.

Algorithmic compaction remains the compatibility baseline. Selecting a new strategy
must state its helper-model needs, failure behavior, and retention guarantees.
Schema validation and valid references do not establish that a generated summary
is semantically accurate; examples and evaluations must show what happens when a
summary omits or misstates information.

A smaller active prompt and retained evidence serve different purposes. Evidence
references state whether they survive only within a process or across a
restart, which backend acknowledges storage, and when records expire or are deleted.
Existing nonblocking history logging alone is not an acknowledgment guarantee.
Applications must be able to inspect the original result rather than receive only
the model-facing projection.

Stage 03's [evidence recipe](./DURABLE_EVIDENCE.md) documents acknowledgement,
retention, bounded retrieval, missing/expired/corrupt references, host recovery,
save/load, cleanup and AMOS views. Its [offline example](../examples/durable-tool-evidence.ts)
verifies exact recovery in a separate Node process. Stage 07 adds automatic
strategies and a bounded functional comparison; see [Context Strategies](./CONTEXT_STRATEGIES.md).
Statistical quality promotion remains future work.

## Reliable tool outcomes and cancellation

**Availability: Stage 02 available on branch; Stage 03 durable evidence available on branch.**

Applications need to distinguish a successful action from a tool execution that
returned a normalized error. Stage 02 makes those outcomes inspectable in the
execution pipeline while preserving existing raw result shapes and public behavior
wherever possible. An arbitrary application payload containing `success: false`
must not automatically be reinterpreted as a library execution failure.

Cancellation belongs to the individual execution. A timeout does not prove that
an external operation stopped, and an accepted asynchronous request does not prove
that the requested workflow completed. Unknown outcomes, particularly writes,
need an explicit recovery or reconciliation path. Late results must stay attached
to the original execution and must not double-count usage or outcomes.

An evidence-storage or projection failure must not turn a completed external
action into a failed action, or cause that action to run again just to recreate
its evidence. Durable replay and effect reconciliation are separately scoped
conditional work in stage 11.

**Adopt now:** `agent.tools.executeWithOutcome()` returns `{ result, outcome }`;
`execute()` retains raw returns and the existing extension point. Optional execution
options supply signals, deadlines, call/run IDs, and a host observer. Results,
stream events, and managed errors expose optional outcome metadata. The existing
`ToolContext.signal` reaches cooperative calls; host/account bindings are captured
per invocation. Async acceptance placeholders no longer count as completed work.

Connector defaults remain header timeouts and legacy retries. Opt in to
`timeoutScope: 'operation'` and `retryPolicy: 'safe'` where appropriate. A timeout
is local uncertainty, not evidence that an external write was prevented. See the
[complete recipe](./TOOL_OUTCOMES_AND_CANCELLATION.md) for public signatures,
raw-result compatibility, cleanup, persistence, extension and provider boundaries.

After building, run `npm run example:tool-outcomes` and
`npm run example:amos-tool-outcomes` for offline demonstrations. OpenAI and Google
live validation and the initial
[Anthropic revalidation](./evaluations/STAGE_02_ANTHROPIC_REVALIDATION.json)
remain historical. The named-tool correction described below passes all three
providers: **34 live test cases / 46 scenarios, with no failures or skips**.
See [final validation](./evaluations/STAGE_02_FINAL_VALIDATION.json).
No skipped provider is counted as passing. Earlier live scenarios
had two initial completion failures that passed unchanged targeted reruns; both
attempts remain in the [validation evidence](./evaluations/STAGE_02_VALIDATION.json).

## A main model with bounded helper models

**Availability: Available on branch — stage 06.** Validated on 2026-10-13 in the
`version2` working tree based on `dcc8dad`; changes are uncommitted and no package
release is claimed.

Optional `modelExecution.helpers` configures stateless `compactor`, `extractor`
and `verifier` roles through named connectors. `invokeHelper()` accepts an explicit
text packet or a builder invoked after model/capability resolution, plus a host
JSON schema. Helpers have no tools, history or opaque provider state. The main
model and shared ToolManager remain fixed. Defaults are 512 output tokens and at
most one locally validated repair; escalation requires an explicit host decision.

Share a host-owned `ModelTask` through `{ modelTask }` for managed/direct calls,
helpers and explicit rollover. It reserves call/token/deadline and model token-cost
capacity across concurrent in-process calls, counts physical SDK retries and
logical repair/wrap-up invocations, and reports known usage once with explicit
unknowns. Reservations use full provider capacity, so a small prompt can still
need a large temporary allowance. Cost bounds apply to model tokens under known
upper rates; external fees and external-runtime admission remain host-owned.

A configured compactor is used by explicit `rolloverContext()` between executions.
Cross-connector history transfer requires `allowContextTransfer: true`. Algorithmic
remains the automatic default; selecting a Stage 07 structured strategy explicitly
uses the role during bounded pre-call preparation. Its comparison is a functional
pilot, not proof of general quality preservation or cost savings. No helper is invoked by merely configuring a role.

The [complete recipe](./MODEL_TASKS_AND_HELPERS.md) covers public options, defaults,
unknown pricing, scope, failures, cancellation, persistence and support boundaries.
Run `npm run example:purpose-models` and `npm run example:shared-budget` after
building for offline demonstrations. The purpose example's explicit `-- --live`
mode uses `gpt-4.1` plus `gpt-4o-mini` and `.env` OpenAI credentials; small marker
checks make no comparative quality/cost claim. AMOS adds `/helpers` role selection,
explicit calls/rollover and purpose usage, plus an offline command walkthrough.

## Task state that survives compaction

**Availability: Stage 04 complete on branch; both reviews' findings fixed and validated.**

All four original runtime findings are [fixed and validated](./designs/STAGE_04_REVIEW_AND_FIX_PLAN.md#corrective-completion--2026-10-15).
The [second corrective completion](./designs/STAGE_04_SECOND_REVIEW_AND_FIX_PLAN.md#corrective-completion--2026-10-16)
also restores legacy resolved-feature values and external registry configuration.
Fresh [validation](./evaluations/STAGE_04_SECOND_CORRECTIONS_VALIDATION.json) passes
7,795 units, unchanged root/`types` consumers, public ESM/CJS controls and both
task-state examples. Live contexts retain their defaults; constructed legacy
feature values can omit later optional additions. Generic plugin configuration
accepts external records; use `TaskStatePluginConfig` for strict built-in declarations.
Earlier
[corrective validation](./evaluations/STAGE_04_CORRECTIONS_VALIDATION.json) remains
historical evidence of 7,784 units, 117 live cases / 129 scenarios in one batch and
19 offline examples. No new billable provider run was needed for the second
pass's type-contract fixes; the earlier live results remain historical.

The opt-in `context.features.taskState` enables a host-selected
`TaskStatePluginNextGen` (`plugins.taskState` supplies scope/task/optional association).
Revision-checked host APIs preserve objective, constraint/correction, decision,
question and artifact records with sources. `propose`/`assume` remain unconfirmed
and cannot supersede host state. There are no model-facing mutation/store tools.

Explicit `recordAction` stores a ToolManager execution receipt independently of
`confirmAction`, the host workflow confirmation. Succeeded/settled submission can
remain `waiting_external`; unknown timeout never proves whether a write happened.
Recording is host-driven, with no implicit action subscription/replay. A failed
notebook admission never authorizes repeating an action.

The full bounded view is noncompactable, counted in managed requests, and checked
after hooks/listeners, including JSON repair. Version-1 optional plugin snapshots
preflight scope/task/association/binding before replacing history. Legacy snapshots
clear the enabled view. Existing Task/routine statuses are reused; MemorySystem
remains the lifecycle authority for linked memory tasks, refreshed explicitly with
host permissions. Direct calls bypass the view.

Defaults: disabled; 100 notes/actions, 8,000 estimated content tokens, 256 KiB strict
JSON. No automatic eviction/extraction or semantic truth/model-obedience guarantee.
Hosts explicitly resolve/prune; snapshots are trusted host checkpoints, not signed
authority imports. [Complete recipe](./TASK_STATE.md),
[offline workflow](../examples/task-state-workflow.ts) and AMOS `/context task`
document source/uncertainty, recovery, capacities and support limits.

## Bounded recovery and verifiable completion

**Availability: Planned — stage 10.**

When a tool fails, an agent repeats an unproductive step, or required evidence is
missing, the loop should have bounded recovery behavior and a clear stopping
reason. Shared decision helpers will improve the existing loop incrementally.

Workflow hosts can define completion checks against their own required results.
Ordinary chat must remain usable without a workflow completion predicate. Checks
should distinguish produced output, accepted work, pending external work, and
confirmed completion. Retrying an uncertain write requires explicit handling;
repetition by itself is not evidence of progress.

Streaming and non-streaming paths may retain their intentional differences,
including structured-output repair. Their documentation must say which guarantees
apply to each path.

**Adoption material to add at delivery:** Recovery limits and stopping reasons;
completion-check APIs and ownership; missing-evidence and repeated-failure examples;
run/stream behavior; user-visible AMOS progress and unresolved outcomes.

## Easier configuration and capability inspection

**Availability: Planned — stage 12.**

The first presets are a long-running assistant/research composition and an
evidence-aware workflow composition. Plain `Agent` configuration remains the chat
baseline. Presets will be small configurations over delivered plugins and policies,
with explicit overrides and inspection of the resolved capabilities.

A preset must work without installing conditional stages. Unsupported features
must be reported rather than silently substituted or claimed across incompatible
runtime drivers. Additional presets, including coding, require a demonstrated
need and appropriate fixtures.

**Adoption material to add at delivery:** Verified preset factory names and imports;
both presets beside plain `Agent`; override precedence; resolved capability output;
provider/driver support; saved-setting migration; AMOS selection and help.

## Conditional extensions

These remain **Conditional / deferred**. Existing memory, tool catalogs,
orchestration, asynchronous tools, and provider options remain usable; the entries
below describe possible enhancements to those foundations.

| Stage | Potential user benefit | Scope to keep explicit |
| --- | --- | --- |
| 05 | Select useful context contributions and improve cache reuse. | Optional typed contributions and selective layout; not a mandatory replacement for plugin APIs. |
| 08 | Recall relevant earlier episodes without treating every trace as permanent knowledge. | Retrieval and ingestion, with ownership, retention, and permissions; reuse existing memory facilities. |
| 09 | Find individual relevant tools in a large catalog. | Ranked discovery beyond existing category loading; provider-native search is a separate integration. |
| 11 | Reduce independent read latency and support selected resumable effects. | Parallel reads and durable effect handling are separate scopes; no universal exactly-once promise. |
| 13 | Reuse procedures supported by verified outcomes. | Curated learning with provenance, approval, expiry, and rollback; no automatic promotion of unverified instructions. |
| 14 | Route selected work to another model or specialist. | Adaptive routing and specialist delegation are separate scopes with explicit state, authority, and budget boundaries. |
| 15 | Inspect large data or compose tools through a bounded program. | Deterministic queries first; programmatic execution requires a real sandbox, restricted authority, and bounded resources. |
| 16 | Use supported provider-native compaction or evaluate improved retention policies. | Native adapters and learned retention are separate scopes; provider contracts and experiments need different validation. |

New sections and runnable recipes belong here only when a conditional scope is
selected. Research evidence for a technique does not establish its availability
or effectiveness in OneRingAI.

## Compatibility and adoption

Existing supported APIs and defaults are the starting point. New configuration
should be optional, new behavior opt-in where it changes semantics, and existing
custom plugins, tool results, event consumers, settings, and saved sessions should
continue to work. Correctness fixes still need their behavior and compatibility
effects documented.

Disabled new features must contribute no prompt content, tools, helper calls, or
background activity attributable to those features. This does not disable or
change existing default plugins. Provider and runtime support must be stated per
feature; selecting a preset does not make an unsupported capability available.

For each available stage, this guide will explain how to keep the existing setup,
enable the new capability, verify it, and disable or roll it back. If persistence
changes, document old-snapshot loading, any optional migration, backend requirements,
retention, and cleanup before recommending adoption.

**No breaking API change is approved.** A concrete breaking proposal requires
stopping the affected work, explaining the reason, affected API/behavior,
alternatives and migration, and obtaining the user's explicit approval before
implementation. The Version 2 label, roadmap acceptance, and stage authorization
do not provide that approval.

## Stage availability register

Update this register when a stage starts, passes its completion gate, or appears
in a verified release. The roadmap owns execution details and dependencies; this
table owns the reader-facing availability record. Replace each dash with an actual
revision, version, or link only when that evidence exists.

| Stage | Capability | Track | Availability | First validated revision | First released version | Adoption entry / example |
| --- | --- | --- | --- | --- | --- | --- |
| 00 | Compatibility and trajectory baselines | Core | Available on branch | `version2` working tree, base `43b34cd` (uncommitted) | — | [Recipe](./AGENTIC_BASELINE_EVALUATION.md); [example](../examples/agentic-evaluation-baseline.ts) |
| 01 | Final request accounting and safe compaction | Core | Available on branch | `version2` working tree, base `43b34cd` (uncommitted) | — | [Preparation guide](./CONTEXT_PREPARATION.md); [example](../examples/context-compaction-freshness.ts) |
| 02 | Accurate tool outcomes and cancellation | Core | Available on branch | `version2` working tree, base `fa8f911` (uncommitted); full local and three-provider live gate passed 2026-10-12 | — | [Recipe](./TOOL_OUTCOMES_AND_CANCELLATION.md); [example](../examples/tool-outcomes-and-cancellation.ts); [final validation](./evaluations/STAGE_02_FINAL_VALIDATION.json) |
| 03 | Evidence references and projections | Core | Available on branch; all three corrective passes validated | `version2` working tree, base `a98a498` | — | [Recipe](./DURABLE_EVIDENCE.md); [restart example](../examples/durable-tool-evidence.ts); [recovery example](../examples/evidence-recovery.ts); [implementation](./designs/STAGE_03_IMPLEMENTATION.md); [third review](./designs/STAGE_03_THIRD_REVIEW.md) |
| 04 | Task-state view and protected constraints | Core | Complete on branch; both reviews' findings validated | `version2` working tree based on `152a0a3`; latest local/public corrective gates passed 2026-10-16 | — | [Recipe](./TASK_STATE.md); [workflow](../examples/task-state-workflow.ts); [latest completion](./designs/STAGE_04_SECOND_REVIEW_AND_FIX_PLAN.md#corrective-completion--2026-10-16); [evidence](./evaluations/STAGE_04_SECOND_CORRECTIONS_VALIDATION.json) |
| 05 | Typed context and selective assembly | Conditional | Conditional / deferred | — | — | — |
| 06 | Helper roles and task budgets | Core | Complete on branch; all review corrections validated | `version2` working tree, base `dcc8dad` (uncommitted); latest full local/live gates passed 2026-10-13 | — | [Recipe](./MODEL_TASKS_AND_HELPERS.md); [purpose example](../examples/purpose-specific-models.ts); [budget example](../examples/shared-run-budget.ts) |
| 07 | Structured summaries and observation masking | Core | Available on branch; experimental, all review corrections validated | `version2` working tree, base `224e395` | — | [Recipe](./CONTEXT_STRATEGIES.md); [comparison](../examples/context-strategy-comparison.ts); [stage record](./designs/STAGE_07_IMPLEMENTATION.md) |
| 08 | Episodic retrieval and ingestion | Conditional | Conditional / deferred | — | — | — |
| 09 | Ranked tool discovery | Conditional | Conditional / deferred | — | — | — |
| 10 | Bounded recovery and completion checks | Core | Planned | — | — | — |
| 11 | Parallel reads and selected resumable effects | Conditional | Conditional / deferred | — | — | — |
| 12 | Opt-in presets and capability inspection | Core | Planned | — | — | — |
| 13 | Verified procedures and curated learning | Conditional | Conditional / deferred | — | — | — |
| 14 | Routing and selected specialist delegation | Conditional | Conditional / deferred | — | — | — |
| 15 | Sandboxed programmatic tools | Conditional | Conditional / deferred | — | — | — |
| 16 | Native compaction and selected retention experiments | Conditional | Conditional / deferred | — | — | — |

An internal stage such as baseline evaluation may have no new consumer API.
Record that explicitly, together with any visible diagnostic or example benefit;
do not invent an API to fill the table.

## Delivered-stage adoption record

Append one record per delivered stage or separately delivered conditional scope.
Update the relevant capability section above to describe actual behavior. Until a
public signature and example are verified, keep them as pending entries rather
than copyable speculative code.

```text
Stage and delivered scope:
Availability; first validated revision; first published package version:
User problem and resulting behavior:
How an existing application adopts or keeps its current behavior:
Verified public exports, signatures, options, and defaults:
Minimal runnable recipe or tested example link and exact command:
Required setup; offline versus opt-in live behavior; expected output:
Supported providers, models/capabilities, drivers, and execution paths:
Unsupported configurations and preflight diagnostics:
Host permissions and account/tenant scope:
Usage, budgets, helper calls, and unknown/external costs:
Persistence, retention, old-session compatibility, and cleanup:
Failure, cancellation, retry, fallback, and recovery behavior:
Known limitations and rollback/disable steps:
Tests and evaluations supporting the claims:
AMOS walkthrough and help links, or why no app change applies:
Canonical-document handoff rows and their current status:
Deferred extensions that this delivery does not include:
```

The record is a user-adoption checklist. Keep implementation decisions and raw
validation logs in the roadmap's stage record, linking them where useful.

### Stage 00 adoption record — 2026-10-07

- **Delivered scope and availability:** Repository-only evaluator and compatibility
  fixtures; available on `version2` in the validated working tree based on `43b34cd`.
  No first published version or new public export. Existing applications retain
  their configuration and behavior.
- **Recipe and setup:** The two offline commands above require a source checkout
  and development dependencies; expected result is four passing workloads per
  split. Live modes require explicit named provider/model selection and the matching
  credential, and make billable calls. No external job/service is contacted by the
  mock workflow. The host owns connector and tool scope.
- **Support and accounting:** Managed, non-streaming Agent execution. The observed
  pilot covers OpenAI/Anthropic/Google; Anthropic uses a workspace-scoped key.
  Fixtures limit
  iterations, tool calls, execution time, and output tokens, with thinking disabled
  and a model-specific explicit Gemini setting. Recorded usage covers emitted
  calls; unknown prices, provider-internal retries, external fees, and helper/hosted
  work are not a complete task cost. No hard monetary ceiling is claimed.
- **Persistence, failure, and cleanup:** Pinned old-session loading and round-trip
  checks; explicit pending-input checkpoint for the cancelled mock workflow. False
  completion, changed replay branches, missing usage, correlation errors, aborts,
  and cleanup are tested. Failed runs exit unsuccessfully; there is no automatic
  effect retry/reconciliation policy. Running the evaluator is optional.
- **Evidence:** 33 new tests pass; full unit suite 6,775/6,775 across 320 files;
  evaluator-helper coverage 99.43% lines and 94.81% branches. Build/type/lint,
  public-consumer compile, examples, and ESM/CJS smoke checks pass. The live pilot
  has 24 passing runs with 49 model and 30 tool calls; 19 existing OpenAI and 11
  existing Anthropic integration tests also pass. Anthropic's legacy test model was
  refreshed to available Sonnet 4.6 without changing assertions or production code.
  These are compatibility/plumbing findings, not a powered quality
  comparison. Detailed commands and limits are in the
  [roadmap record](./designs/AGENTIC_ARCHITECTURE_EVOLUTION.md#stage-00-completion-record--2026-10-07).
- **AMOS and handoff:** Current context help/overview/statistics behavior has regression
  tests. No app update applies to repository-only evaluation. README discovery,
  User Guide recipe, examples index, agent instructions, Changelog, and packaged
  evaluation documentation are synced below. API regeneration and specialist guide
  updates are not applicable because production contracts are unchanged.
- **Deferred:** All production correctness, context, helper-model, outcome,
  recovery, and preset stages remained planned at Stage 00 closeout. Stage 01 was
  subsequently authorized; its delivery record follows.

### Stage 01 adoption record — 2026-10-07

- **Delivered scope and availability:** Fresh final request accounting, bounded
  compaction, protected protocol groups, and prepared-revision diagnostics.
  Available on `version2`, base `43b34cd`, in the validated uncommitted working
  tree; no published package version is claimed. Existing managed agents adopt
  the correctness fixes without changing configuration. Strategies, features,
  plugin interfaces, shared tool manager, hook semantics, and session format remain.
- **Public surface and recipe:** Additive exported `ContextPrepareOptions` and
  `ContextPreparation`, optional `PreparedContext.tools`,
  `agent.context.lastPreparation`, and `validateRequestBudget()` for adapters.
  Existing no-argument `prepare()` remains supported. The
  [preparation guide](./CONTEXT_PREPARATION.md) documents exact signatures,
  critical/reclaim behavior, adapter integration, supported async protocol, and
  limits. After `npm run build`, run `npm run example:context-freshness`; it shows
  the new source index, retained pending call/result, and fitting estimated budget.
  This source-checkout example requires no credentials or model calls.
- **Support and scope:** Managed `run()` and `stream()` and their tool-free
  wrap-ups. Live checks pass on OpenAI `gpt-4o-mini`, Anthropic
  `claude-haiku-4-5-20251001`, and Google `gemini-2.5-flash`; this is tested scope,
  not a claim that every provider/native-tool configuration was exercised. Direct
  APIs retain their existing context policy. Host connector identity/tenant scope
  remains host-owned; no additional permissions or storage backend are required.
- **Estimates and failure behavior:** Counts describe the last selected request
  revision, using the existing estimator. They include rendered contributions,
  actual visible schemas, sanitized history, pending input, and separate
  instructions, and remain distinct from provider usage. Preparation invokes its
  compaction strategy at most once and then either returns a fitting estimate or
  reports overflow. Protected dependencies cannot be reclaimed; duplicate final
  results/call IDs within one namespace report invalid protocol. Native async
  calls and library completion messages remain supported. Rendering churn and
  stale index proposals fail with clear retry errors. Arbitrary plugin/backend
  side effects are not rolled back. Remote file contents and hidden provider
  state are outside the local estimate. Existing emergency tool-text truncation
  and oversized-user rejection remain; no valid current input is truncated merely
  to reach a reclaim target.
- **Persistence and inspection:** No session migration or new durable format.
  Revisions are process-local diagnostics and reset with a new context.
  `lastPreparation` returns a detached snapshot; later mutation or consolidation
  does not relabel it as current mutable state. Legacy cached budget APIs remain.
  Disposable agents and contexts still require `destroy()`.
- **AMOS:** `/context budget` and `/context breakdown` show either the initial
  estimate or the last prepared revision, explicitly label estimates, and include
  overhead in totals. Inspection does not prepare or compact again. Run
  `npm run example:amos-context` for the actual offline command rendering; see
  the [transcript](./evaluations/STAGE_01_AMOS_OFFLINE.txt) and
  [AMOS guide](../apps/amos/README.md). Existing overview and subcommands remain.
- **Evidence and limits:** 50 new unit regressions pass; full suite
  **6,825 tests / 324 files** passes. Scoped coverage passes at **86.92% lines**,
  including 100% lines for protocol grouping and AMOS inspection. Build, types,
  lint, examples, unchanged public-consumer/session compatibility, and AMOS checks
  pass. The final six real-provider retrieval checks plus a new 24-scenario
  Stage 00 live regression pass: **30 scenarios / 61 observed managed model calls**
  in the two retained batches. Initial stream-collector mistakes and rerun limits
  are recorded in the [validation record](./evaluations/STAGE_01_LIVE_VALIDATION.json).
  One sample per configuration supports compatibility and retrieval claims;
  it does not establish quality/cost/latency improvements or full monetary cost.
  Full commands and decisions are in the
  [roadmap record](./designs/AGENTIC_ARCHITECTURE_EVOLUTION.md#stage-01-completion-record--2026-10-07).
- **Handoff and deferred work:** Relevant current documentation, generated public
  API, examples, AMOS, Changelog, and packaged records are synced below. No new
  configuration needs disabling to retain the existing compaction strategy or
  feature defaults. Helpers, summaries, acknowledged evidence storage, typed
  contributions, and retention/routing policies remain separate planned stages.

### Stage 01 corrective adoption record — 2026-10-08

- **Availability:** All five review fixes are validated on `version2`; no package
  release is claimed. Earlier adoption/validation entries above remain history.
- **Recovery:** Mixed message/native function/custom results sharing an assistant
  message are stored together before spill removal, including small results and
  multimodal attachments. Failed/evicted writes leave history intact; unsupported
  serialization groups are retained. The working-memory index exposes each key,
  including disambiguated collisions. Ordinary rolling retention and the existing
  emergency tool-text truncation policy remain in place; this is not durable
  evidence acknowledgment or a backend/session migration.
- **Dispatch and compatibility:** Existing synchronous request listener and hook
  mutations remain usable. The final check runs after them and captures counted
  fields before budget-event reentrancy. It checks the dispatched model's provider
  capacity while respecting explicit host limits and preserving the owning model.
  Direct APIs, event shapes, plugin/strategy interfaces, defaults and format-v1
  sessions remain compatible. Streaming keeps its existing hook-return semantics.
- **Optional validator fields:** `model`, `response_format`, and `native_tools`
  participate in final estimates. The optional second argument accepts
  `modelMaxContextTokens` and `recordPreparation`. The default updates diagnostics
  for the same preparation; `recordPreparation: false` checks auxiliary fit without
  mutating context state. Managed JSON formatting/repair uses that policy, stops
  oversized auxiliary requests before dispatch, and preserves fitting output,
  history replacement and aggregate usage. This adds no helper-routing API.
- **Signature policy:** Tool-call thought signatures and thinking signatures use
  the same conservative local replay estimate and keep their bytes. Estimates do
  not assert provider tokenization/billing. Real Google signature replay after
  serialized context passed; it is not a durable remote-session guarantee.
- **Examples and AMOS:** `npm run example:context-freshness` now recovers connected
  native evidence. `npm run example:structured-budget` demonstrates fitting/rejected
  repair offline with public exports and cleanup. AMOS inspection is tested against
  the final dispatched budget and keeps the main revision through auxiliary calls.
  No new AMOS option or command is required.
- **Validation:** 38 new regression cases; **325 files / 6,863 unit tests**, plus
  **10 live correction cases / 24 baseline scenarios** across OpenAI, Anthropic and
  Google passed. Build/types/lint, examples, pinned consumer compatibility, AMOS,
  generated API and scoped coverage passed. The
  [corrective record](./evaluations/STAGE_01_CORRECTIONS_VALIDATION.json) retains
  the initial retrieval-fixture failure and the final passing evidence. One sample
  per configuration supports functional claims only. Standard documentation and
  this handoff ledger are synced; Stage 02 still needs separate authorization.

### Stage 01 second corrective adoption record — 2026-10-08

- **Availability and scope:** S1–S4 from the
  [second review](./designs/STAGE_00_01_SECOND_REVIEW.md) are fixed and validated
  in the `version2` working tree, base `43b34cd`. Package remains `1.2.0`; no
  published Version 2 release is claimed. Stage 02 remains separately authorized.
- **Existing applications:** Managed `run()`/`stream()`, suspend/final wrap-up,
  and later dispatch checks use the existing connector and shared ToolManager.
  Known structured constraints/native tools and the initial provider capacity
  now guide compaction, so fitting-after-eviction requests can proceed. Hook
  model changes still receive a final check without another preparation pass.
- **Verified additive adapter options:** `ContextPrepareOptions.getRequestOptions`
  is a synchronous callback receiving selected function definitions and returning
  `instructions`, `response_format`, and/or `native_tools`. It is resolved again
  after compaction. `modelMaxContextTokens` supplies initially known provider
  capacity with explicit host limits retained. Old no-argument preparation,
  `instructions`, and `getTools` remain supported. No new feature flag/default,
  direct-call behavior, extension interface, or session format change is required.
- **Evidence and failures:** Stored raw keys participate in collision allocation
  across passes and restored state. Ordinary unused keys/values keep their format;
  collisions use distinct namespace suffixes visible in the notes index. Spill
  values are verified before history removal. A failed partial attempt can leave
  earlier writes and a retry can leave a duplicate copy. Normal capacity eviction
  still applies; no atomic transaction with concurrent external writes is claimed.
  Function-result error text is counted alongside content/images. An oversized
  protected error is preserved and rejected before dispatch.
- **Recipe and cleanup:** Build, then run `npm run example:context-budget` without
  credentials. It demonstrates one schema/capacity-driven compaction and one model
  call, retrieves both colliding source markers, and rejects a protected error.
  Fixture agents, contexts, and connector are destroyed/removed. The existing
  AMOS offline example shows the smaller selected window and schema contribution
  through `/context budget` and `/context breakdown`; no new command/setting.
- **Evidence and handoff:** **326 files / 6,895 unit tests**, including **32 new
  regressions**, passed. Scoped context/AMOS coverage passed (**806 tests**, 85.13%
  lines / 85.34% branches); Agent behavior tests are included but Agent.ts is not
  part of that coverage denominator. **16 context live cases and 24 Stage 00 live
  workload/split scenarios** passed across OpenAI, Anthropic, and Google. Build,
  types, lint, examples, strict core/live-test compilation, pinned built consumer,
  AMOS, and generated API documentation passed. See the
  [validation record](./evaluations/STAGE_01_SECOND_CORRECTIONS_VALIDATION.json).
  Current usage docs and the handoff ledger are synced; release-wide edits remain
  tracked separately. One sample per configuration is functional evidence, not a
  comparative quality/cost result. The main routing/helper/retention redesigns
  remain future work.

### Stage 02 adoption record — 2026-10-12

- **Scope/revision:** Existing pipeline and shared ToolManager, managed Agent
  run/stream/external tools, background execution, generic connector API tools,
  and AMOS. Branch `version2`, base `fa8f911`; no published release verified.
- **Public additions:** `ToolExecutionOutcome`, `ToolExecutionOptions`,
  `ToolExecutionReport`, `PipelineExecutionOptions`; `executeWithOutcome()`; optional
  execution options/observer;
  `tool:outcome` and `tool:late-complete`; optional result/stream/error `outcome`;
  async `ToolResult.pending`; connector `timeoutScope` and `retryPolicy`.
- **Defaults and compatibility:** Existing raw values, normalizer payloads,
  default-disabled manager deadline, header timeout/retry defaults, breaker
  settlement policy, saved formats, two-argument pipeline implementations, and
  execute overrides remain supported. Legacy async override deadlines are retained.
  No breaking change proposed or approved.
- **Corrections:** Framework-normalized failures and streaming counters are
  accurate. Async placeholders defer success counts. `skipRetry` now skips status
  retries as documented. Manager safety nets still constrain async calls.
- **Lifecycle/security:** Trusted identity/correlation snapshots, per-call signals,
  disposed listeners/timers, one initial outcome, separately correlated late
  settlement, no duplicate late accounting, and no cross-account background delivery.
  Noncooperative tools can still perform effects; no remote rollback is claimed.
- **Persistence/support:** Controllers/provenance are process-local. No new
  session/config schema, durable outcome/effect ledger, automatic tool retry, or
  origin restriction. Existing pinned consumers and saved sessions remain valid.
  Generic API tools forward signals; specialized tools/transports need their own
  support. Provider-hosted tools/external drivers have independent lifecycle controls.
- **Review corrections:** All seven findings in the [review](./designs/STAGE_02_REVIEW_AND_FIX_PLAN.md)
  are implemented: execution-bound connector authority and tool/permission selection,
  delivery-time scope checks, contained async observers, settlement before streamed
  completion, abort-aware cleanup, and metadata-preserving chained clones. Internal
  registry capture introduces no mandatory custom-registry API. Existing counters,
  explicit host continuations, formats, raw results, and defaults remain supported.
  Existing injection notification ordering is retained. Reentrant scope changes clear
  invalid pending input and stop delivery before the provider call.
- **Examples/app:** The offline library example now demonstrates replacement during
  a plugin wait and the replacement's use by the next invocation. Existing AMOS
  outcome rendering remains appropriate; its build, adapter tests, and offline example
  pass without adding a new UI for these library corrections.
- **Validation:** **7,010 unit tests / 332 files** pass, including **53 corrective
  regressions** in addition to the original 62 Stage 02 cases. Scoped coverage is
  **83.45% lines / 90.48% branches / 83.33% functions**; Agent and the large AMOS
  adapter remain outside that denominator and have mock integration coverage.
  Build, strict types, lint, examples, public consumers, AMOS, package checks and
  offline examples pass. See [corrective evidence](./evaluations/STAGE_02_CORRECTIONS_VALIDATION.json);
  [original evidence](./evaluations/STAGE_02_VALIDATION.json) remains historical.
  **30 unique OpenAI/Google live scenarios pass**. One existing OpenAI separate-spill
  retrieval scenario failed twice unchanged, returning index keys/descriptions rather
  than source markers; the Google counterpart passes. Anthropic was attempted in both
  Stage 02 modes and remains unvalidated because the current key returns 401.
  This is not an all-provider/all-scenario passing result or a release claim.
  Follow-up diagnosis identified misleading keyless `store_get` guidance: notes
  returns index metadata, while the tool description implies full retrieval.
  A description-only diagnostic intervention passed five trials. The production
  correction and its passing revalidation are recorded below; the diagnosis and
  earlier failed attempts remain historical evidence.
- **Next:** The corrections and all-provider validation below complete Stage 02. Separately
  authorize Stage 06 — fixed main model, bounded helper roles,
  and aggregate task usage/budgets. Stage 03 follows its dependency sequence.

### Stage 02 notes retrieval correction — 2026-10-12

- **Delivered:** Accurate keyed/keyless retrieval guidance in tool definitions,
  store overview, notes instructions and memory index. Notes keyless reads return
  metadata; pass each exact index key to `store_get` for source contents, and use
  `store_list` for omitted entries. The original optional key, return shapes,
  custom-store behavior and legacy WorkingMemory formatting are preserved.
- **Adoption:** Existing managed agents receive the corrected prompt automatically.
  No configuration, saved-state migration or new public package API is required.
  The formatter's optional store selector is internal to the library. See the
  [preparation guide](./CONTEXT_PREPARATION.md#using-the-library) and updated
  `npm run example:context-freshness`, which demonstrates metadata versus content.
  AMOS uses this library guidance automatically; existing adapter tests, typecheck
  and offline context inspection example pass without a new UI control.
- **Validation:** **7,016 unit tests / 333 files**, including six new retrieval
  regressions, pass. Build, types, lint, consumers, examples, AMOS, generated API
  and package checks pass. The original OpenAI collision scenario passes in all
  **six production trials**, with both keyed reads and source markers. There are
  **31 distinct passing OpenAI/Google live scenarios**; repetitions are not counted
  as additional scenarios. Both Anthropic Stage 02 modes still fail with 401 before
  validating behavior. Full stage completion remains pending that blocker.
  See [retrieval-fix evidence](./evaluations/STAGE_02_RETRIEVAL_FIX_VALIDATION.json) and
  [correction record](./designs/STAGE_02_REVIEW_AND_FIX_PLAN.md#openai-retrieval-correction-and-validation--2026-10-12).

### Anthropic authentication and live revalidation — 2026-10-12

The user's updated `.env` key authenticates successfully: a direct Messages API
call returns HTTP 200. The unchanged Anthropic live suites pass **10 of 11 test
cases**: eight Stage 00 workload/split scenarios, all five Stage 01 context
scenarios, and the Stage 02 stream case. The Stage 02 run case fails because its
observed outcome order is `failed, succeeded` rather than `succeeded, failed`.
The 23 filtered OpenAI/Google test cases are not passes in this follow-up.

A diagnostic confirms correct classification by tool name, but also observes a
repeated failure-probe call. The dispatched named choice is `domain_probe`, yet
the response selects `failure_probe`. A separate direct request to
`api.anthropic.com/v1/messages`, bypassing OneRingAI and the SDK, reproduces that
selection with HTTP 200. This remains an unresolved validation failure, not an
authentication blocker or an all-provider passing result. No source, assertion,
model, prompt, or limit was changed, and no retry-until-pass was performed.

The previous 7,016 passing unit tests and 31 passing OpenAI/Google scenarios are
retained validation; their recorded source/test/example fingerprints still match.
They were not rerun after this credential-only change. See
[Anthropic evidence](./evaluations/STAGE_02_ANTHROPIC_REVALIDATION.json) for the
failure, correct tool/status correlation, repeated execution, and direct API probe.

### Stage 02 final correction and validation — 2026-10-12

- **Delivered:** Explicit Anthropic named choices advertise the selected local
  function while retaining native tools and history. A mismatched local response
  raises the existing `ProviderError` before execution, in both generated and
  streamed paths. The provider stream is cleaned up, and no automatic retry or
  model switch is added. Default `auto`/`required` behavior remains unchanged.
- **Fixture correction:** Both live modes now mutate `before:llm` options in
  place, preserving existing streaming hook return semantics. Single-call
  requests are explicit; the original marker, order, call-count and metric
  assertions remain, with stricter tool/status correlation. A separate live
  diagnostic using the original failing request configuration passes as well.
- **Compatibility/adoption:** No public signature, default, raw return, event
  shape or saved format changes, and no breaking change needed. Existing agents
  receive the provider correction automatically. Named-tool requests on
  unsupported models/settings retain their existing rejection. See the
  [selection contract](./TOOL_OUTCOMES_AND_CANCELLATION.md#explicit-anthropic-tool-selection).
- **Examples/AMOS:** `npm run example:tool-outcomes` remains offline by default.
  With `.env` credentials, `-- --live-anthropic` adds real calls in both managed
  modes and verifies exact probe names/statuses and markers. Both modes pass.
  Existing AMOS provider-error rendering needs no new controls; its unit/type
  checks and both offline demonstrations pass.
- **Final validation:** **334 files / 7,030 unit tests**, including **14 new
  provider/Agent regressions**, pass. The full live suite passes **34 test cases /
  46 distinct scenarios**: 24 baseline workload/splits, 16 context scenarios and
  six tool-outcome modes across OpenAI, Anthropic and Google. There are **zero
  failures and zero skipped cases** in both final suites. Build/24 exports,
  source/strict/examples/AMOS types, lint, original/additive public consumers,
  generated API, public offline/live examples and package checks pass.
- **Availability:** Stage 02 is complete on the current branch; no package has
  been published. Earlier failures and reports remain historical evidence. The
  [final evidence](./evaluations/STAGE_02_FINAL_VALIDATION.json) records current
  checks and source fingerprints. These are functional samples, not a statistical
  reliability or comparative model-quality claim. Stage 06 still requires
  separate authorization.

### Stage 06 adoption record — 2026-10-13

**Review status:** The [subsequent review](./designs/STAGE_06_REVIEW_AND_FIX_PLAN.md)
reproduced eight defects absent from the original passing suite. All eight are
fixed and validated in the [corrective evidence](./evaluations/STAGE_06_CORRECTIONS_VALIDATION.json).
The original validation below remains historical; the corrective adoption record
following it gives current totals and support details.

- **Scope:** Optional static role profiles and a shared process-local model task;
  explicit helpers/rollover and AMOS controls. No main-model routing, new context
  framework, automatic summary strategy or distributed budget.
- **Public APIs:** `ModelTask`, `ModelBudgetExceededError`, `HelperOutputError`, role/
  configuration/result/snapshot types; optional `modelExecution` and `modelTask`;
  `agent.invokeHelper()` and `getModelUsage()`. All root package exports are additive.
- **Defaults and adoption:** Omitted configuration preserves old single-model
  behavior with no new calls/tools/prompt content. Helpers require named connectors,
  a text packet and a synchronous schema. Output defaults to 512 tokens, at most
  one repair. Share the same task explicitly to aggregate calls; otherwise enabled
  configuration creates owned per-execution tasks. Main provider and tools stay fixed.
- **Accounting and failures:** Physical built-in SDK attempts are admitted separately;
  logical usage is copied before hook/repair mutation. Unknown charges remain
  conservatively reserved; known cache/reasoning subsets are not double-counted.
  Host price bounds survive settlement. Unsupported capability/scope, malformed
  output, deadlines and budget exhaustion fail explicitly. Late settlements remain
  diagnostic on their original task. External final usage is recorded once; mixed
  pricing remains unknown and external admission is outside local enforcement.
- **Persistence/compatibility:** Context, old AMOS configuration/session loading,
  events, raw returns and custom provider signatures remain compatible. Reapply
  profiles from trusted host configuration; neither snapshots nor context hydration
  restore task authority. No break was required or approved.
- **Support:** Native OneRingAI run/stream/direct/repair/wrap-up and helpers integrate.
  OpenAI/Anthropic/Google are live-tested; Vertex/DeepSeek/inherited OpenAI-compatible
  adapters have local regressions. Injected providers need a single-attempt host
  attestation for hard limits. External SDK internals, batches/media and raw provider
  use remain outside automatic admission. Service fees and invoice accuracy are
  not model token-cost guarantees.
- **Examples/AMOS:** Public offline extract/main/verify and concurrent-budget demos;
  opt-in OpenAI stronger-main/smaller-helper example; AMOS `/helpers` with no-call
  profile changes, busy/rollback handling, usage/unknown display and explicit rollover.
  Static connector names, not keys, are persisted. Independent commands have separate tasks.
- **Validation:** **339 files / 7,131 unit tests**, including **101 new Stage 06
  tests**, pass. Final live suites pass **42 cases / 54 distinct scenarios** across
  OpenAI, Anthropic and Google, with zero failures/skips in those final runs.
  Scoped new-runtime-module coverage is **97.93% lines / 84.97% branches**. Build/24
  exports, strict/source/examples/AMOS types, lint, original/additive public
  consumers, generated API (1,640 items), AMOS build, public offline/live examples,
  package inventory and artifact checks pass. See [evidence](./evaluations/STAGE_06_VALIDATION.json).
  Earlier Google development-chat exact-text failures include unrelated model
  output; wire checks found no request defect and the subsequent unchanged full
  suite passed. Those failures remain evidence, not a claimed model reliability fix.
  No published release, statistically measured reliability or comparative quality claim.
- **Next:** Separately authorize Stage 03 — acknowledged evidence references and
  projections. Stage 07 structured compaction follows Stage 03 and Stage 06.

### Stage 06 corrective adoption record — 2026-10-13

- **Availability:** All R1–R8 fixes are available on the uncommitted `version2`
  branch, base `dcc8dad`; no release or breaking API change.
- **Budget/accounting:** The cost guard covers raw hosted-tool/MCP aliases and
  nested request configurations. Tier overrides require host price bounds.
  Google GenerateContent/Vertex output is inclusive of thinking in the ledger and
  helper output checks, with legacy response/event counts preserved. Terminal
  stream usage survives subsequent failure/cancellation; unknown retry charges
  remain reserved and duplicate conflicting terminal reports fail explicitly.
- **Helpers/lifecycle:** Ajv is invocation-scoped; IDs/local references/formats
  work without a global schema registry or clone retention. Standalone helpers
  own independent tasks even during a main execution; pass `modelTask` explicitly
  to share. Direct cleanup preserves caller ownership despite options mutation.
  Anthropic extended thinking is supported with provider mode/budget preflight.
- **External usage:** Empty/metadata-only/partial core counts stay unknown.
  Explicit zero counts and split incremental counts work; final fields override
  accumulated counterparts. `recordExternal` adds optional outcome `status`,
  defaulting to `succeeded`; Agent completion records actual failure/cancellation.
  Legacy response defaults and external host-owned admission remain unchanged.
- **Validation:** **7,179 units / 339 files**, including **149 Stage 06 cases**
  and **48 corrective regressions**; **45 live cases / 57 distinct scenarios**
  across OpenAI/Anthropic/Google, with no failures/skips in final runs. Scoped
  runtime coverage: **98.14% lines / 88.34% branches**. Build/exports, all type/lint,
  built-package compatibility, generated API, examples and AMOS checks pass.
  The initial two new Google thinking fixtures returned prose instead of the
  requested numeral. Explicit native-JSON fixtures now validate the exact answer
  and accounting. Those failures and all earlier evidence remain recorded;
  established gates were not weakened and no reliability rate is claimed.
- **Handoff/AMOS:** Recipe, standard docs, generated API, example/index and AMOS
  support notes, release notes and package inventory are synchronized. Existing
  AMOS helper/usage commands require no new UI; adapter/command tests and the
  offline walkthrough pass against the corrected runtime. Stage 03 remains next
  and separately authorized; Stage 07 automatic compaction is deferred.

### Stage 06 second review — 2026-10-13

The [second review](./designs/STAGE_06_SECOND_REVIEW.md) reproduces four further
gaps: multi-candidate output reservations, post-admission vendor-option mutation,
final external metadata overwriting mixed pricing, and helper repair losing its
original packet. All 149 focused tests passed at that snapshot; the missing cases are documented
in [review evidence](./evaluations/STAGE_06_SECOND_REVIEW.json). Runtime/test
fingerprints match the prior corrective pass. No production fix, new stage or
breaking change was implemented in that review. The subsequent corrective adoption
below records their resolution; prior validation remains historical evidence.

### Stage 06 second corrective adoption — 2026-10-13

All S1–S4 findings are fixed and validated. Google/Vertex reservations include all
candidates; the optional per-call output cap is aggregate. Without an explicit
per-candidate limit, divide that cap by candidate count and round down; preserve
explicit limits/counts and reject excessive or unsafe bounds. Tracked requests
capture records/arrays before admission while preserving live signals, registries
and opaque SDK values. Default untracked behavior remains unchanged.

Mixed external pricing uncertainty survives final metadata/count snapshots;
contradictory/composite modes cannot receive a known registry cost. Helper repair
retains the selected evidence and rechecks its complete input fit, without extra
history, silent trimming or additional retries. Public signatures, legacy returns/
events, old sessions and host task ownership remain compatible. No API break was
needed. Internal request capture and pricing normalization add no public API.

Current validation: **7,228 units / 339 files**, including **198 Stage 06 cases**
and **49 second-pass regressions**; **48 live cases / 60 scenarios** across
OpenAI/Anthropic/Google, with no final failures/skips. Scoped runtime coverage is
**98.24% lines / 90.10% branches**. Build/exports, all static/consumer checks,
generated API, examples and AMOS gates pass. Three new controlled helper-repair
cases use real model calls; the library and AMOS offline demos now exercise
deliberate schema repair with preserved source IDs. Earlier failed/passing records
remain history. See [second corrective evidence](./evaluations/STAGE_06_SECOND_CORRECTIONS_VALIDATION.json).

The recipe, standard guides, generated API, examples/index, AMOS guide/transcript,
Changelog and package inventory are synchronized. Existing AMOS helper/usage
commands demonstrate the fixes; no additional command or config migration is
needed. Availability remains branch-only, with no release or comparative model
quality/savings claim. Stage 03 remains separately authorized.

### Stage 03 adoption record — 2026-10-13

- **Availability:** Implemented on `version2`, working tree based on Stage 06
  commit `a98a498`. All six [review findings](./designs/STAGE_03_REVIEW_AND_FIX_PLAN.md)
  are corrected and validated on 2026-10-14. The [second review](./designs/STAGE_03_SECOND_REVIEW.md)
  findings are also corrected and validated. The [third review](./designs/STAGE_03_THIRD_REVIEW.md)
  findings are now corrected and validated as well. Stage 03 is complete on branch;
  original and intermediate validation remain historical evidence.
  No published release claimed.
- **Public APIs:** `IEvidenceStorage`, scoped record/reference/chunk types,
  `InMemoryEvidenceStorage`, `FileEvidenceStorage`, optional `StorageRegistry.evidence`,
  `EvidencePluginNextGen`, `ToolEvidenceMiddleware`, delivery/receipt configuration,
  `ToolOutputHints.effect`, optional execution evidence callbacks/reports and
  `AgentContextNextGen.acknowledgeToolEvidence()`. Enabled plugin tools are
  `evidence_read` and `evidence_list`; ID lookup is optional on custom backends,
  and full-reference reads remain valid. No new required tool/plugin methods.
- **Setup/defaults:** Enable `context.features.evidence` and configure a stable
  host-owned owner/tenant/namespace and backend. Without one, a new in-memory store
  is process-local. File default is ordinary restart; optional fsync is local,
  filesystem-dependent acknowledgement, never replication. Defaults: 4 MiB blob,
  64 MiB/1000 records per scope, 8192-character chunks, 8 read slots, 32 queued
  mutations, 20 metadata receipts, 8192-byte projection threshold, 2000-character
  summary and 4096-character envelope caps, 5000ms write deadline, no default expiry.
- **Usage:** `output.summarize` receives detached redacted JSON and preserves
  essential IDs/status. Projection is acknowledged and opt-in; raw application
  returns, managed result content and execution events remain raw. Outcomes expose
  storage diagnostics separately from actual tool status. Index/listing contain
  metadata, never source blobs; model reads prefer scoped IDs and storage resolves
  integrity metadata. Reads verify integrity and respect configured scope.
- **Persistence/cleanup:** Optional version-1 plugin/content fields supplement the
  existing session format. Configuration/authority/credentials/functions are not
  restored. Old sessions load; a smaller current index truncates valid older state.
  Scratch eviction, context compaction, teardown and session deletion do not remove
  evidence. Expiry pruning/deletion are explicit host policy; missing/expired reads
  are distinct from corrupt data. Source data may remain sensitive after key redaction.
- **Failures/recovery:** Serialization/storage/projection error does not turn a
  successful effect into failure or repeat an action. Unacknowledged raw groups
  remain protected, or dispatch stops explicitly if retention cannot fit. Async
  storage failure stops before lossy text injection. The host can persist a retained
  observation and acknowledge the original invocation without executing it again.
  Unknown write completion and later observations remain separate immutable receipts.
- **Compatibility/support:** Disabled features add no prompt/tools/storage/model
  work and preserve legacy result/hook/override shapes. Existing external `evidence`
  feature factories and arbitrary configuration remain valid. Bundled stores
  require strict JSON, do not encrypt/replicate data, and coordinate writer admission
  only within one process. Legacy overrides bypassing ToolManager also bypass
  evidence handling. No new automatic compaction, distributed effects or replay.
- **Examples/AMOS:** [Durable search and separate-process recovery](../examples/durable-tool-evidence.ts),
  [ambiguous local action](../examples/ambiguous-action-evidence.ts), and AMOS offline
  runner/command walkthrough all pass. AMOS persisted host settings enable scoped
  file storage, `/context evidence` lists metadata, explicit previews cap at 1024
  characters, and run views distinguish storage failure from unknown effects.
- **Original validation (2026-10-13):** 7,337 units / 343 files pass, including 109 new Stage 03 cases.
  New evidence-component coverage: 99.81% lines / 91.48% branches. All 13 offline
  stage examples, build/exports, root/AMOS/example/test types, lint, built public
  compatibility and generated API pass. The full 57-case / 69-scenario live gate passes across OpenAI/Anthropic/Google,
  including all nine evidence probes. Earlier failed attempts remain recorded.
  ESM/CJS public runtime and declaration checks pass; no package release is claimed.
- **Corrective adoption (2026-10-14):** Queued async completions survive failed
  delivery and pause automatic retries until host repair/explicit continuation.
  `acknowledgeToolEvidence()` requires a result-bearing matching invocation;
  function/custom call-ID namespaces remain independent. Complete evidence snapshot
  preflight leaves active context intact on rejection. Mutable hooks and retained
  result changes invalidate stale projections without freezing application objects.
  Cancellation settlement preserves returned observations and original IDs.
- **Serialization options:** Optional `IEvidenceStorage.serializationLimitBytes`
  lets bundled/custom backends supply an early byte budget. Optional
  `ToolEvidenceConfig.maxSerializationBytes` (also in `plugins.evidence`) can set
  the source/redaction budget independently of the final backend quota. Existing
  custom adapters need no new required member and retain their own capacity policy
  without either setting. Incremental encoding and admission replace unbounded
  pre-quota expansion; no automatic model call or new storage framework is added.
- **Corrective validation:** 7,397 units / 344 files pass, including 60 new
  regressions and 169 total Stage 03 cases. Four evidence components have 99.83%
  line / 92.36% branch coverage. The 60-case / 72-scenario live gate passes across
  OpenAI/Anthropic/Google; all 12 evidence cases pass again on final source.
  All 14 offline examples, local checks and public ESM/CJS consumers pass. The
  initial Google chat completion failure and three bounded diagnostic calls remain
  in [corrective evidence](./evaluations/STAGE_03_CORRECTIONS_VALIDATION.json).
  The [recovery example](../examples/evidence-recovery.ts), usage/API/agent guides,
  AMOS support notes and package records are synchronized; no release is claimed.
- **Second corrective adoption (2026-10-14):** Protected pending groups survive
  async insertion and follow-up runs. Authentic deliveries carry original recovery
  correlation internally when optional `outcome` is omitted; their scope/call is
  checked before projection/admission. Pending failed observations are included
  in detached snapshots using the existing conversation field, with no live-input
  commit or required schema addition. Same-instance restoration avoids duplicates.
- **Second corrective validation:** 7,435 units / 345 files, 38 new regressions /
  207 Stage 03 cases, 63 live cases / 75 scenarios and 14 offline examples pass.
  All three providers read restored exact markers without repeating the action.
  Public ESM/CJS, source/test types, build/lint, examples, AMOS real interrupted
  save/load, generated API and package checks pass. The extended recovery example
  demonstrates delivery-only pending save/load and later acknowledgement.
  [Second corrective evidence](./evaluations/STAGE_03_SECOND_CORRECTIONS_VALIDATION.json)
  preserves initial failures. New provenance/preservation methods are internal;
  no release, new public API or changed evidence durability is claimed.
- **Third corrective adoption (2026-10-14):** Completed unacknowledged batches
  survive managed fail-fast exits and stream closure at a completion event, retaining
  their original assistant state and correlation. Receipt-only delivery is diagnostic;
  it does not authorize dropping the retained raw observation or async continuation.
  Store the result body and acknowledge it through the host recovery API. Restore/load
  reconciles by content namespace, call and execution identity across acknowledgement
  changes; the loaded checkpoint owns matching invocations and unrelated pending
  blocks survive. Older failed checkpoints can require acknowledgement again.
  All new provenance/settlement helpers are private, with unchanged saved-session
  schema, public signatures, default behavior and raw return/event shapes.
- **Third corrective validation:** 7,473 units / 346 files, 38 new regressions /
  245 Stage 03 cases, 66 live cases / 78 scenarios and 15 offline examples pass.
  Three live stream-closure probes recover exact markers without repeating their
  action. AMOS real-runner run/stream interruption and file save/load/save pass;
  no new command is required. Public ESM/CJS, build/types/lint/compatibility,
  examples, AMOS, regenerated API and package checks pass. Run
  `npm run example:evidence-interruption` for the credential-free public example.
  [Third corrective evidence](./evaluations/STAGE_03_THIRD_CORRECTIONS_VALIDATION.json)
  preserves initial failures, including the AMOS stale-build check and successful
  rerun, the initial 65/66 live batch, four actual Google diagnostic answers, and
  the final unchanged 66/66 live rerun. The original failed Google answer was not
  captured; one fresh diagnostic violated the required exact text format. No
  completion rule was relaxed or provider reliability guarantee added.
- **Handoff/internal changes:** Standard guides, agent instructions, connector/tool
  catalog, context-preparation notes, examples/index, AMOS, Changelog and generated
  API are synchronized in this stage. Internal-only changes capture execution-owned
  projections, protect unacknowledged protocol groups, and preserve original late
  outcomes; they create no new default pipeline. Earlier rejected Google schema,
  legacy-message regression and live fixture output/extra-turn failures remain
  recorded rather than counted as passing. See [implementation](./designs/STAGE_03_IMPLEMENTATION.md)
  and [validation](./evaluations/STAGE_03_VALIDATION.json). Stage 07 is the next
  suggested core stage and remains separately authorized.

### Stage 07 adoption record — 2026-10-14

- **Availability:** Implemented on `version2`, based on Stage 03 commit `224e395`;
  initial and corrective gates validated 2026-10-15. All three review findings are
  fixed; see the [corrective completion](./designs/STAGE_07_REVIEW_AND_FIX_PLAN.md#corrective-completion--2026-10-15)
  and [evidence](./evaluations/STAGE_07_CORRECTIONS_VALIDATION.json). No package release or default promotion is claimed.
- **Public APIs:** `ObservationMaskingStrategy`, `StructuredSummaryStrategy`, their
  optional constructor settings, `StructuredContextSummary`, `ContextSummaryEntry`,
  `ContextSummaryRequest`, `ContextSummaryGenerator`, `ConversationCompactionOptions`
  and `ConversationCompactionReport`. Two new StrategyRegistry registrations.
  Optional `ContextPrepareOptions.signal/summarize`, `ContextPreparation.compaction`,
  `CompactionResult.report` and `CompactionContext.compactConversation` preserve old
  callers and extension implementations.
- **Defaults/behavior:** Algorithmic remains default. New strategies are opt-in,
  pre-call only and require the enabled built-in evidence plugin. Sources are
  retained through its existing storage/redaction/acknowledgement policy. Helpers
  use a two-entry-per-section compact schema, local safety checks and the active
  ModelTask. No new backend, role, prompt content or tool is mandatory for old agents.
- **Retention/security:** User messages and call/receipt metadata remain exact;
  only matched settled read observations are masked. Redacted mismatches protect
  the source instead of silently creating an unredacted archive. Unknown/write
  effects, pending dependencies, recent turns/items and opaque/multimodal groups
  remain protected. Source expiry/eviction and stale history/input/scope/strategy
  reject apply. Internal source bookkeeping is visible through evidence_list/read.
  Summary capsules are assistant data, not host rules or semantic proof.
- **Budgets/failure:** One bounded transaction, at most one schema repair, one
  masking fallback and a final recount/fit check. A valid partial reduction can
  remain on a later fit error. The helper callback can be requested without a
  model dispatch; actual usage comes from the task ledger. Google helper reasoning
  can remain active despite a unified disable request; its functional probe uses
  explicit output headroom and records inclusive reasoning usage.
- **Persistence/compatibility:** Existing session schema, raw return/event shapes,
  custom strategies and explicit between-execution rollover remain supported.
  Capsules/references persist as ordinary history; diagnostics, helper roles,
  storage authority and task budgets are host configuration. Process-local sources
  do not gain restart durability merely by saving a session.
- **Examples/AMOS:** Deterministic development/held-out comparison and a real AMOS
  masking/selection walkthrough. Live comparison freezes six independent local
  task variants, two repetitions and three strategies in seeded shuffled order.
  AMOS persists optional contextStrategy, switches without recreating the agent,
  reports last transaction and points to complete helper accounting. Selection
  makes no immediate helper request; failed settings persistence restores selection.
- **Original validation (2026-10-15, before review):** 7,594 units / 349 files, 121 new Stage 07
  cases, 66 retained baseline plus 39 fresh new live cases (117 distinct scenarios),
  17 offline examples and 18 held-out scripted cases pass. Build/types/lint,
  compatibility, strict tests, public ESM/CJS, AMOS and regenerated API (1,671 items)
  pass. Three strategy modules have 97.22% line / 88.70% branch / 100% function
  coverage; integration code is outside that percentage scope.
  [Validation](./evaluations/STAGE_07_VALIDATION.json) and
  [comparison evidence](./evaluations/STAGE_07_LIVE_COMPARISON.json) preserve earlier
  failed/unknown-charge batches, actual source/answer traces, consumed splits and
  diagnostic artifact limits. The final 12/12 per strategy uses 24/24/36 model
  attempts respectively, with 12 source reads each. Historical notes now follow
  their source and explicitly defer to current instructions; exact observed facts
  take priority over progress chatter. Full tenant/namespace and configured AMOS
  headroom/config roundtrip regressions pass.
- **Corrective validation:** All R1–R3 fixes pass 7,631 units / 350 files, including
  158 Stage 07 cases and 37 new regressions; 105 live cases / 117 scenarios in one
  batch; 17 offline examples and 18 retained scripted regression cases. Strategy
  module coverage is 97.59% lines / 92.01% branches / 100% functions. Exact users
  no longer consume standalone source allowance, known no-ops avoid writes/helpers,
  and AMOS restores absent settings across actual save/reload. Public signatures,
  defaults, sessions, raw returns/events and partial merge behavior are unchanged.
  The reused comparison is regression evidence, not a fresh held-out quality claim.
  All standard docs/API, examples/AMOS and corrective package records are synced.
- **Evaluation limits:** Offline answers/usage are scripted. The bounded live pilot
  checks exact completion and hard constraints; it does not establish statistical
  non-inferiority, a reliability rate, general savings or a cheapest-model recommendation.
  Alternatives ship experimental under the roadmap's explicit limited-scope rule.
  Actual final results and initial failures are recorded in the stage evidence.
- **Handoff:** Recipe, standard guides, agent instructions, examples/index, AMOS,
  Changelog and generated API are synchronized. Final validation and package/
  documentation checks are recorded below. Internal-only changes are private source retention, canonical
  JSON and revision-guarded pre-call planning; no new execution framework is added.
  Stage 04 remains separately authorized future work.

## Handoff to the standard documentation

This ledger prevents improvements, changed guarantees, and limitations from being
lost during the final documentation refresh. Its initial rows are pending targets,
not claims that the corresponding pages already contain Version 2 instructions.

Use **Pending**, **Synced** (with destination/revision), or **Not applicable** (with
a reason) for each applicable destination. Split the rows by delivered scope and
destination as stages progress so that partially completed handoffs remain visible.
Documentation describing current behavior must be corrected in
the delivering stage; a later broad README refresh is not a reason to leave
incorrect usage instructions in place.

| Stages / topic | Required reader guidance | Destinations to update | Status / evidence |
| --- | --- | --- | --- |
| 00: recipe and discovery | Repository-only setup, exact commands, completion gates, and offline/live limits. | [README](../README.md#documentation); [User Guide](../USER_GUIDE.md#agentic-evaluation-baselines); [examples index](../examples/README.md); [agent instructions](../AGENTS.md). | Synced in the validated Stage 00 working tree, base `43b34cd`. |
| 00: validation and release distinction | Actual pilot, accounting boundary, uncertainty, provider limitation, and unchanged runtime behavior. | [Evaluation guide](./AGENTIC_BASELINE_EVALUATION.md#recorded-stage-00-validation); [pilot](./evaluations/STAGE_00_LIVE_PILOT.json); [Changelog](../CHANGELOG.md#unreleased); package documentation inventory. | Synced in the same working tree; no published release claimed. |
| 00: production API and app surfaces | Preserve existing signatures, defaults, and AMOS behavior. | Generated API; AMOS user guide; connector/memory specialist guides. | Not applicable: no production changes or new app commands. Consumer/session and existing AMOS regression fixtures provide compatibility evidence. |
| 01: preparation and final accounting | Fresh counts, bounded compaction, protected groups, additive inspection/adapter APIs, estimates, failure limits, and old-session compatibility. | [Preparation guide](./CONTEXT_PREPARATION.md); [README](../README.md); [User Guide](../USER_GUIDE.md); [generated API](../API_REFERENCE.md); [agent instructions](../AGENTS.md); [examples](../examples/README.md); [AMOS](../apps/amos/README.md); [Changelog](../CHANGELOG.md); package guide/record inventory. | Synced in the validated Stage 01 working tree, base `43b34cd`; documented examples and AMOS transcript verified. |
| 01: unaffected specialist surfaces | Connector identity, memory permissions, and storage contracts remain intact. | Connector/tool and memory specialist guides. | Not applicable: no contract, authorization, or backend migration change. |
| 01 corrective pass: recovery and final dispatch | Mixed native spill, attachments/failure recovery, listener changes, actual model capacity, schema/native/signature estimates, and auxiliary diagnostics. | Preparation guide; README; User Guide; generated API; agent instructions; examples; AMOS; Changelog; packaged corrective validation. | Synced on 2026-10-08; 6,863 unit tests and 34 live scenarios pass; existing records retained. |
| 01 second corrective pass: initial constraints and spill collisions | Existing memory key allocation, partial-write retry limits, known schema/native/capacity preparation, additive adapter options, error accounting, and AMOS inspection. | Preparation guide; README; User Guide; generated API; agent instructions; example/index; AMOS; Changelog; second review and validation record inventory. | Synced on 2026-10-08; 6,895 unit tests and 40 live scenarios pass; prior records retained; no release claimed. |
| 03: durable evidence and projections | Scope, acknowledgement strength, exact recovery, protected raw failures, host recovery, JSON/retention/backpressure limits, versioned save/load, raw/legacy compatibility and AMOS inspection. | [Recipe](./DURABLE_EVIDENCE.md); README; User Guide; generated API; agent guide; connector catalog; context guide; examples/AMOS; Changelog; packaged validation/transcript. | All three corrective passes synced; all findings resolved. Final 7,473 units, 66 live cases / 78 scenarios and 15 offline examples pass. Earlier records retained; no release claimed. |
| 03 corrective pass: R1–R6 | Preserve queued/settled observations, require result recovery, preflight full evidence snapshots, respect mutable hooks and bound serialization work. | Evidence recipe; README/User Guide/agent guide; recovery example/index; AMOS support notes; regenerated API; review/stage records; validation/transcript and package inventory. | Synced: 7,397 units, 60 live cases/72 scenarios, 14 offline examples and all local gates pass; [corrective evidence](./evaluations/STAGE_03_CORRECTIONS_VALIDATION.json) retains prior failures. |
| 03 second review: S1–S3 | Preserve protected input during async insertion, derive retention from authentic delivery without requiring outcome, and retain pending observations in session snapshots. | [Review/fix plan](./designs/STAGE_03_SECOND_REVIEW.md); [executable evidence](./evaluations/STAGE_03_SECOND_REVIEW.json); availability, recipe warning and roadmap. | Synced: all three findings fixed; 38 new regressions, 7,435 units, 63 live cases / 75 scenarios and 14 offline examples pass. Public compatibility, recovery example, AMOS save/load, docs/API and package evidence synchronized; no release claimed. |
| 03 third review: T1–T3 | Retain partial settled batches on stream closure/fail-fast exits, distinguish receipt from result acknowledgement, and reconcile restored invocation identity after recovery. | [Completion](./designs/STAGE_03_THIRD_REVIEW.md#corrective-completion--2026-10-14); [corrective evidence](./evaluations/STAGE_03_THIRD_CORRECTIONS_VALIDATION.json); recipe, standard guides, new example/index, AMOS notes, generated API, roadmap and package inventory. | Synced: all three fixed; 38 new regressions, 7,473 units, 66 live cases / 78 scenarios and 15 offline examples pass. AMOS real stream closure and public ESM/CJS verified; earlier failures retained; no release claimed. |
| 07: summaries and broader masking | Opt-in strategies, scoped source matching, exact protected content, bounded helper/fallback, defaults, persistence, diagnostics and experimental evaluation limits. | [Recipe](./CONTEXT_STRATEGIES.md); README; User Guide; generated API; agent instructions; comparison/index; AMOS selection/walkthrough; Changelog; stage/evidence/package records. | Synced: 7,594 units / 121 new cases, 66 baseline + 39 new live cases and 17 offline examples pass. Public ESM/CJS, AMOS and package/evidence checked. Algorithmic default and legacy extension/rollover contracts preserved; experimental, no release or statistical promotion. |
| 07 review: R1–R3 | Eligible-source allocation, zero-work no-op preparation and exact AMOS restore-to-absence semantics. | [Review/fix plan](./designs/STAGE_07_REVIEW_AND_FIX_PLAN.md); [executable evidence](./evaluations/STAGE_07_REVIEW.json); recipe, stage status and roadmap. | Synced: all three fixed; 37 new regressions, 7,631 units, 105 live cases / 117 scenarios and 17 offline examples pass. Source/public ESM/CJS, real AMOS configuration, documentation and package checks pass. Prior review/pilot evidence retained; no default promotion or release. |
| 02: tool outcomes | Semantic provenance, cancellation/deadlines, late/account isolation, legacy overrides, counters, raw shapes, defaults, process-local limits, truthful keyed/keyless notes retrieval and explicit Anthropic named-tool selection. | [Recipe](./TOOL_OUTCOMES_AND_CANCELLATION.md); [preparation guide](./CONTEXT_PREPARATION.md); README; User Guide; generated API; agent guide; connector catalog; library/AMOS examples and indexes; Changelog; package inventory. | Synced: 7,030 unit tests and all 46 distinct three-provider live scenarios pass. Offline examples and the opt-in Anthropic example verified; [final evidence](./evaluations/STAGE_02_FINAL_VALIDATION.json) packaged. Stage complete on branch; no release claimed. |
| 06: helper models | Connector setup, static roles, budgets/reservations, known subtotals/unknowns, fallback, capability/scope failures, persistence and provider boundaries. | [Recipe](./MODEL_TASKS_AND_HELPERS.md); README; User Guide; generated API; agent guide; examples/index; AMOS roles/usage/offline transcript; Changelog; package inventory. | Synced on 2026-10-13: recipe, standard docs, generated API, examples/AMOS and packaged evidence verified. 7,131 units and final 54 live scenarios pass; earlier Google answer failures retained. No release claimed. |
| 06 corrective pass: R1–R8 | Raw budget options, inclusive Google thinking, schema isolation, stream settlement, immutable task ownership, explicit helper sharing, honest external reports and supported Anthropic thinking. | Recipe; User Guide; agent guide; generated API; examples/AMOS support notes; Changelog; review/stage records; packaged corrective evidence. | Synced on 2026-10-13: 7,179 units, 45 live cases/57 scenarios, all local delivery gates pass. Earlier failures retained; no release or breaking API change. |
| 06 second corrective pass: S1–S4 | Effective output multiplicity, aggregate cap defaults, captured request data, sticky pricing uncertainty and evidence-preserving repair. | Recipe; standard guides; generated API; public/AMOS repair demos and indexes; Changelog; stage/review completion; corrective evidence and transcript; package inventory. | Synced: all four fixed, 7,228 units and 48 live cases/60 scenarios pass, prior records retained. No release or API break. |
| 04: task state | Host notes/proposals, revision/scoped recovery, receipt versus workflow confirmation, protected fit/repair, limits, explicit memory authority, host edits and legacy public feature/plugin configuration typing. | [Recipe](./TASK_STATE.md); README; User Guide; generated API; AGENTS; workflow/AMOS examples/index; Changelog; package records. | Synced: both reviews' corrections, additive recovery API/commands and legacy consumers; latest 7,795 units, root/`types` compatibility, ESM/CJS and library/AMOS examples pass. API regenerated. Earlier live evidence remains historical; complete on branch, no release. |
| 10: bounded recovery/completion | Host policies, stopping reasons, run/stream differences and existing task compatibility. | README; User Guide; generated API; recovery examples; AMOS; Changelog. | Planned; not implemented by Stage 04. |
| 12: presets | Both presets, plain Agent baseline, overrides, capability/driver support, old-setting migration, and help. | README quickstarts; User Guide/runtime guide; generated API; preset example/index; AMOS selection/settings/help; Changelog. | Pending |
| Selected conditional scopes | Delivered benefit, separate recipe, support limits, exact scope, availability, and migration. | README; User Guide; generated API; affected specialist guides; examples; AMOS where useful; Changelog. | Pending |

Cross-cutting release handoffs must also be checked:

- [README](../README.md): Quickstart, feature claims, requirements, and documentation links.
- [User Guide](../USER_GUIDE.md): Copyable recipes, defaults, lifecycle, persistence,
  supported paths, failure behavior, and upgrade guidance.
- [API Reference](../API_REFERENCE.md): Regenerate from implemented public exports
  with the repository generator; do not hand-edit generated signatures.
- [Examples index](../examples/README.md): Exact run commands, setup, credentials,
  expected behavior, side effects, and cleanup. Verify consumer-facing snippets
  through documented package exports.
- [AMOS documentation](../apps/amos/README.md): Relevant settings, commands,
  walkthroughs, limitations, and old-setting/session migration.
- [Connector & Tool Catalog](./CONNECTOR_TOOL_CATALOG.md),
  [Memory Guide](./MEMORY_GUIDE.md), and [Memory Permissions](./MEMORY_PERMISSIONS.md):
  Update only where delivered behavior affects them; check related specialist docs.
- [Agent Guide](../AGENTS.md): Current API routing, invariants, and verified patterns.
- [Changelog](../CHANGELOG.md): Actual delivered changes and release versions;
  distinguish planned work from released functionality.
- Package documentation inventory: Include guides referenced by installed-package
  documentation, and check which example links require the source repository.

## Stage-by-stage maintenance

Before calling a stage complete, update its availability row, relevant capability
text, adoption record, and handoff status. Record an explicit “no externally visible
change” entry for internal-only work. A required example, test, or applicable AMOS
demonstration cannot be replaced by a documentation placeholder.

At each delivery, verify the public signatures against exports and tests, run the
documented examples in their stated modes, and check links and support claims.
Model/provider recommendations need current primary-source checks when introduced
or refreshed. Report measured findings with their workload, comparison, costs,
quality limits, and uncertainty; do not generalize offline mock results into
model-quality claims.

Before a Version 2 release, audit every delivered scope against this guide and its
handoff rows. Ensure that all applicable standard-document destinations are synced,
generated API docs are current, examples and AMOS help match the release, compatibility
and migration notes are complete, and package inventory includes the referenced
public guides. Deferred scopes must remain visibly deferred. Retain this guide as
the adoption/release record or explicitly document its successor after handoff.

## Update log

| Date | Change | Availability effect | Documentation handoff |
| --- | --- | --- | --- |
| 2026-10-07 | Started the outward-facing guide after acceptance of the roadmap direction. Added capability outlines, all 17 stage rows, adoption records, and the canonical-document ledger. | Documentation only; no implementation stage or new runtime API delivered. | Linked from README, agent instructions, and roadmap; added to package documentation inventory. |
| 2026-10-07 | Delivered Stage 00 evaluator, completion gates, strict replay, compatibility/AMOS fixtures, and a live pilot. | Stage 00 available on branch in the validated working tree; later stages remain planned/deferred; no npm release or new runtime API. | Recipe/discovery and validation handoffs synced; production API/app/specialist updates explicitly not applicable. |
| 2026-10-07 | Retried Anthropic after the user refreshed its key. Model requests require an explicit workspace header (HTTP 400); workspace selection requested. | OpenAI/Google validation retained; Anthropic still unvalidated. | Failed retry summarized in the pilot and evaluation guide; no runtime change. |
| 2026-10-07 | Validated Anthropic with the user's workspace-scoped key: eight workload/split runs and 11 existing integration tests pass. Replaced retired Sonnet 4 IDs in integration fixtures with available Sonnet 4.6. | All three selected providers validated for the recorded scope; no runtime/API change. | Combined pilot and current adoption/validation guidance synced; failed attempts retained as history. |
| 2026-10-07 | Delivered Stage 01 fresh final accounting, bounded compaction/protocol protection, additive diagnostics, offline examples, and AMOS revision/estimate inspection. | Stage 01 available on branch; 6,825 unit tests and 30 live scenarios pass; no npm release or valid API break. | Preparation guide, standard documentation, generated API, AMOS, examples, Changelog, and packaged validation records synced; later scopes remain pending. |
| 2026-10-08 | Corrected all five Stage 00/01 review findings, added recovery/dispatch/repair regressions and examples, and revalidated real providers. | Corrective Stage 01 complete on branch; 6,863 unit tests and 34 live scenarios pass; no breaking API change or release. | Standard docs, generated API, AMOS, examples and corrective validation record synced; prior reports remain historical evidence. |
| 2026-10-12 | Delivered Stage 02 semantic outcomes, cancellation, connector deadline/retry options, truthful AMOS rendering, and legacy extension regressions. | Available on branch; local gates pass; OpenAI/Google live checks recorded, Anthropic credential rejected. No release or approved API break. | Recipe, standard guides, generated API, examples/AMOS, Changelog, compatibility fixtures, and validation inventory synced. |
| 2026-10-12 | Corrected all seven Stage 02 review findings and added 53 regressions. | Branch-only; local checks pass; live limitations retained explicitly. | Recipe, standard docs, generated API, examples/AMOS, review completion and corrective evidence synced. |
| 2026-10-12 | Retested the user's updated Anthropic key and all selected Stage 00–02 Anthropic cases; investigated the remaining failure with a direct API request. | Authentication resolved; 10/11 cases pass. One named-tool selection failure remains; Stage 02 completion pending. | Current availability, handoff, roadmap and review record updated; revalidation evidence packaged. Earlier reports retained. |
| 2026-10-12 | Corrected explicit Anthropic named-tool requests and added pre-execution response checks, 14 regressions, and an opt-in live example. | Stage 02 complete on branch: 7,030 unit tests and all 46 distinct three-provider live scenarios pass; no failures/skips in final suites. | Recipe, User Guide, generated API, examples/index, Changelog, stage records, final evidence and package inventory synced; no release or API break. |

| 2026-10-13 | Implemented Stage 06 static helpers, shared model-task admission/accounting and AMOS commands. | Available on branch: 7,131 units and final 54 live scenarios pass; initial Google answer failures retained. No release or API break. | Recipe, generated API, adoption/standard guides, examples/AMOS, package inventory and evidence synced. |
| 2026-10-13 | Corrected all eight Stage 06 review findings and added 48 regressions plus live Google/Anthropic thinking checks. | Complete on branch: 7,179 units and final 45 live cases/57 scenarios pass. Initial new Google output-format failures retained; no release or API break. | Corrective adoption, recipe, standard docs, generated API, AMOS support notes, review/stage records, release notes and packaged evidence synced. |
| 2026-10-13 | Reviewed Stage 06 again and reproduced four further cases with controlled providers and actual SDK/mock HTTP. | Available on branch with two P1/two P2 findings open; fresh 149 focused tests pass. No production fix or API break. | Second review/evidence and current availability/stage records updated; earlier evidence retained. |
| 2026-10-13 | Corrected all four second-review findings with 49 regressions and three new live helper-repair cases. | Complete on branch: 7,228 units and 48 live cases/60 scenarios pass; no release or API break. | Second corrective adoption, standard docs/API, library/AMOS repair demos, stage/review records, release notes and packaged evidence/transcript synchronized. |
| 2026-10-13 | Completed Stage 03 scoped evidence, ID/full-reference reads, opt-in projections, protected failure/recovery and AMOS inspection. | Available on branch: 7,337 units, 57 live cases/69 scenarios and 13 offline examples pass; earlier schema/model/fixture failures retained. No API break or release. | Recipe, standard guides/API, outward adoption/handoff, examples/AMOS, package inventory and validation/transcript synced. |
| 2026-10-13 | Reviewed Stage 03 and reproduced six recovery, cancellation, snapshot, hook and serialization defects. | Three P1/three P2 findings open; 109 existing focused tests and the built consumer pass. Original full/live evidence retained; no runtime fixes or release. | Review/fix plan, executable evidence, current availability/adoption/handoff and package documentation inventory synchronized. Corrections precede Stage 07. |
| 2026-10-14 | Corrected all six Stage 03 review findings and added bounded capture settings plus failed-write recovery example. | Complete on branch: 7,397 units, 60 live cases/72 scenarios and 14 offline examples pass; prior failures retained. No release or API break. | Corrective availability/adoption/handoff, standard docs/API, examples/AMOS support notes, review/stage records and packaged validation/transcript synchronized. |
| 2026-10-14 | Reviewed Stage 03 again and reproduced loss of protected input during async insertion, delivery-only retention and interrupted-run save/load. | Three P1 findings open; fresh 7,397 units and public compatibility pass. No runtime fixes, new live validation or release. | Second review/fix plan and executable evidence recorded; availability, recipe warning, roadmap and adoption/handoff updated. Corrections precede Stage 07. |
| 2026-10-14 | Corrected all three Stage 03 second-review findings and added interrupted save/load coverage. | Complete on branch: 7,435 units, 63 live cases / 75 scenarios, 14 offline examples and all local gates pass; no API break or release. | Recovery example, AMOS real runner save/load, standard docs/API, outward adoption/handoff, roadmap and packaged second corrective evidence synchronized. |
| 2026-10-14 | Reviewed Stage 03 after its second corrective pass and reproduced partial-batch data loss, receipt-only admission and post-recovery restore duplication. | Two P1/one P2 findings open; fresh 7,435 units and public compatibility pass. No runtime fixes or new live gate. | Third review/fix plan, executable evidence, current availability/adoption/handoff, recipe warning and roadmap recorded; corrections precede Stage 07. |
| 2026-10-15 | Completed Stage 07 opt-in masking and historical structured summaries with full scope guards and AMOS selection/headroom. | Complete on branch: 7,594 units, 66 baseline + 39 new live cases, 17 offline examples and local/public gates pass. Earlier failed pilots retained; experimental, no default promotion or release. | Recipe, standard guides/API, adoption/handoff, comparison/example/AMOS, package records and validation synchronized. |
| 2026-10-15 | Reviewed Stage 07 and reproduced source-budget starvation, repeated no-op retention/helper work and failed AMOS restore-to-absence. | Three P2 findings open; fresh 7,594 units and local public/type/lint gates pass. No runtime fixes or new live calls. | Review/fix plan and executable evidence, current availability/adoption/handoff, recipe, roadmap and package document inventory synchronized. Corrections precede Stage 04. |
| 2026-10-15 | Fixed all three Stage 07 review findings: eligible source allocation, known no-op preflight and exact AMOS setting rollback. | Complete on branch: 7,631 units, 105 live cases / 117 scenarios in one batch and 17 offline examples pass. No API break, default promotion or release. | Corrective completion/evidence, recipe, standard guides/API, examples/AMOS, adoption/handoff and package records synchronized. |


### Stage 04 adoption record — 2026-10-15

- **Availability/revision:** Implemented in the uncommitted `version2` tree based on
  `152a0a3`; all four review findings are now fixed and validated. No npm release
  or later-stage delivery is claimed.
- **Verified surface:** Public `TaskStatePluginNextGen` plus ten note/source/action/
  lifecycle/snapshot/config/delta types; optional `features.taskState` (false) and
  required enabled-plugin host configuration. One task per context, immutable
  scope/task/optional association/lifecycle binding. No new required session or
  storage member. Third-party same-name plugins keep their existing contract.
- **Usage/authority:** Atomic `updateHost`, unconfirmed `propose`/`assume`, explicit
  `recordAction`, separate host `confirmAction`, guarded pruning and detached
  inspection. Source and uncertainty stay with proposals. No model mutation/store
  tools; hosts route authentic outcomes and never blindly promote external text.
- **Capacity/failure:** Defaults 100 combined records, 8,000 estimated content tokens,
  256 KiB strict JSON; no eviction. Active/unknown state survives compaction/rollover
  or fit fails. Generation/presence checks cover final managed hooks/listeners and
  JSON repair. Revision/capacity failure never authorizes action replay; host retains
  original outcomes/evidence. Direct calls bypass the view; in-flight requests cannot
  be revoked. Structural protection is not proof of obedience/semantic truth.
- **Recovery/lifecycle:** Optional version-1 plugin state preflights scope/task/
  association/binding before history mutation. Legacy snapshots clear enabled
  state. Host checkpoints are trusted, not signed authority imports. Existing Task/
  routine status types and MemorySystem transitions keep authority; explicit memory
  refresh uses host scope/principals, rejects cancellation/stale results, and does
  not restore clients or create parallel state facts.
- **AMOS/examples:** Optional config and `/context task` inspection/add/correct/
  resolve; revision checks and busy rejection; edits in memory, checkpoint through
  `/session save`. Model commands stay text. Actual runner/command transcript and
  public offline workflow demonstrate correction, pending action, rollover, file
  restart and separate-process recovery. No automatic AMOS receipt/memory linkage.
- **Original completion validation (before review):** 7,743 units / 354 files; 112 Stage 04 cases; plugin coverage 99.55%
  lines/statements, 85.81% branches, 100% functions. Full local/public/type/AMOS gates,
  generated API (1,682 items), 19 offline scripts, CJS smoke and 18 retained scripted
  comparison cases pass. Final real-provider gates: 117 tests / 129 scenarios, no
  final failures/skips, OpenAI/Anthropic/Google all verified. The initial combined
  batch's legacy Google chat marker failure, exact-output diagnostics and unchanged
  full baseline revalidation are retained. Final counts span the successful six
  initial files and baseline revalidation, not one all-green batch. No predicate
  was weakened; the original failing output/cause is unknown. Previously consumed
  comparison tasks are regression coverage, not fresh held-out research.
- **Handoff:** [Recipe](./TASK_STATE.md), README, User Guide, generated API, AGENTS,
  memory guide, examples/index, AMOS, Changelog, roadmap and package inventory are
  synchronized. [Evidence](./evaluations/STAGE_04_VALIDATION.json) and
  [AMOS transcript](./evaluations/STAGE_04_AMOS_OFFLINE.txt) accompany the branch.
- **Limits/next:** Host APIs first; automatic extraction remains deferred, with
  explicitly invoked extractor proposals verified as a synthetic pilot only. No
  action journal, duplicate-effect guarantee, new workflow engine or completion-
  policy loop. Stage 10 is next and needs separate authorization. No breaking change.

| Date | Change | Availability/validation | Documentation handoff |
| --- | --- | --- | --- |
| 2026-10-15 | Completed Stage 04 host-controlled task view, protected dispatch/recovery and AMOS host edits. | 7,743 units; final 117 live cases/129 scenarios across successful scoped gates; 19 offline examples pass. Initial Google marker failure retained; no release or Stage 10. | Recipe, standard guides/generated API, examples/AMOS, package records, roadmap and adoption/handoff synchronized. |


### Stage 04 review — 2026-10-15

Four defects are reproduced against unchanged delivery source/public builds:

- **P1:** A final `budget:updated` listener can change protected host state after
  validation; both run and stream dispatch the obsolete constraint.
- **P2:** Reusing a pruned correction ID can save a checkpoint that cannot restore.
- **P2:** At exact token/byte capacity, resolution growth fails while pruning
  rejects the still-active record; the default 8,000-token boundary is reproduced.
- **P2:** AMOS has no safe prune/recovery command after its 100-entry task cap, even
  for resolved records.

Fresh 7,743 units / 354 files, types, lint and built public compatibility pass.
[Executable evidence](./evaluations/STAGE_04_REVIEW.json) records 31 defect/control
observations, source/public ESM/CJS, real file recovery and actual AMOS commands.
No billable/live calls were needed; the original live evidence and earlier failed
attempts remain preserved. A successful reproduction script asserts existing
defects, not fixed behavior. See the [fix plan](./designs/STAGE_04_REVIEW_AND_FIX_PLAN.md).

Availability, recipe/standard-guide notices, adoption/handoff, roadmap, implementation
record and packaged review records now show corrections pending. No runtime fixes,
permanent tests, API changes, commit, push or release are included in this review.
Corrective tests/examples/docs and fresh local/live validation are required before
restoring completion or proceeding to the separately authorized Stage 10.

| Date | Change | Availability/validation | Documentation handoff |
| --- | --- | --- | --- |
| 2026-10-15 | Reviewed Stage 04 and reproduced final-event stale dispatch, pruned-ID checkpoint failure, capacity recovery deadlock and missing AMOS reclamation. | One P1/three P2 findings open; fresh 7,743 existing units and local/public gates pass. No runtime fixes or new live validation. | Review/fix plan and executable evidence, recipe/standard-guide notices, availability/adoption/handoff, roadmap, implementation status and package inventory synchronized. |


### Stage 04 corrective work in progress — 2026-10-15

User authorized all four fixes. Final managed admission now spans budget observers;
ID reuse detaches obsolete links while preserving inactive history; optional
`TaskStateHostDelta.confirmActions`/`prune` supply atomic bounded recovery; AMOS
exposes explicit prune/resolve-prune/prune-action/confirm-prune commands. Existing
signatures, defaults, limits and host authority remain supported. Regression tests,
workflow/restart examples and current recipe are updated; full final gates are in
progress. No completion, API break, release or Stage 10 delivery is claimed yet.


### Stage 04 corrective adoption — 2026-10-15

All four findings are fixed and validated; Stage 04 is complete on branch again.
[Corrective completion](./designs/STAGE_04_REVIEW_AND_FIX_PLAN.md#corrective-completion--2026-10-15)
and [evidence](./evaluations/STAGE_04_CORRECTIONS_VALIDATION.json) preserve earlier
delivery/review artifacts and their failed attempts without relabeling them.

- **Additive API:** Optional `TaskStateHostDelta.confirmActions` (executionId,
  TaskStatus, source) and `prune` (noteIds/executionIds). Notes, resolutions, host
  confirmations and explicit pruning form one atomic revision-checked candidate;
  the final snapshot must fit, and input bounds still apply. No automatic eviction,
  completion, external action or replay. Archive proof before explicit reclamation.
- **Correctness:** Final protected task validation spans budget observers and repair.
  Reuse detaches obsolete correction/conflict links, keeps historical predecessors
  inactive, and never retargets them to unrelated data. All committed snapshots
  pass restoration consistency checks. IDs remain reusable after pruning.
- **AMOS:** Existing host adapter now accepts the optional delta fields; no required
  runner member. Explicit `prune`, `resolve-prune`, `prune-action`, `confirm-prune`
  commands reject stale/busy/invalid/unsafe operations and provide actionable
  capacity recovery. Terminal confirmation requires host proof. Commands make no
  model call; existing checkpoint semantics persist recovered state.
- **Compatibility/defaults:** Disabled by default; 100 records, 8,000 content tokens,
  256 KiB JSON unchanged. Existing signatures, version-1/legacy snapshots, raw
  returns/events, lifecycle authority and one tool manager remain supported. No
  API break, configuration migration, new required backend/session field or release.
- **Validation:** 7,784 units / 356 files; 153 Stage 04 cases and 41 new regressions;
  plugin coverage 99.61% lines/statements, 88.21% branches, 100% functions. One final
  seven-file live batch passes 117 cases / 129 scenarios with no failures/skips;
  OpenAI, Anthropic and Google all verified. Twelve task probes add ID reuse and
  post-response atomic recovery without extra model/submission calls. All local/
  public/type/AMOS gates, API generation (1,682 items), 19 offline scripts, 18 fixed
  source/ESM/CJS observations and 18 retained scripted comparisons pass. Comparisons
  use previously consumed fixtures, not fresh held-out quality/cost evidence.
- **Handoff/examples:** Recipe, README, User Guide, generated API, AGENTS, examples/
  index, AMOS, Changelog, implementation/roadmap and package records synchronized.
  The workflow reclaims/reuses an ID and restores a second checkpoint. Actual AMOS
  recovers at 100 records, adds a constraint and reloads with one total synthetic
  response; [transcript](./evaluations/STAGE_04_CORRECTIONS_AMOS_OFFLINE.txt) included.
- **Limits/next:** Host-controlled bounded notebook, not an audit archive or proof of
  remote completion/model obedience. Automatic extraction/replay/completion-policy
  loops remain deferred. Stage 10 is next and requires separate authorization.

| Date | Change | Availability/validation | Documentation handoff |
| --- | --- | --- | --- |
| 2026-10-15 | Fixed all four Stage 04 findings: final observer guard, checkpoint-safe ID reuse and library/AMOS atomic bounded host recovery. | Complete on branch: 7,784 units, 117 live cases/129 scenarios in one batch, 19 offline examples pass. No failure/skip in final gates; no release. | Recipe, standard/generated docs, examples/AMOS, additive API, package evidence, roadmap and adoption/handoff synchronized; historical artifacts unchanged. |


### Stage 04 second review — 2026-10-15

The four runtime corrections remain validated. Two public TypeScript compatibility
regressions are now reproduced; stage completion is provisional pending compatible
fixes. See the [review and fix plan](./designs/STAGE_04_SECOND_REVIEW_AND_FIX_PLAN.md)
and [executable evidence](./evaluations/STAGE_04_SECOND_REVIEW.json).

- **P2:** Adding an optional known feature makes `taskState` required through the
  exported `ResolvedContextFeatures` mapped type. Unchanged legacy feature objects
  fail compilation even with the new capability disabled.
- **P2:** The known `plugins.taskState` property narrows arbitrary configuration
  previously accepted for an external registry factory using that feature key.
  The extension still works at runtime, but its unchanged TypeScript consumer fails.
- **Validation:** Fresh 7,784 units / 356 files and a separate 153-case Stage 04 run
  pass; root typecheck, lint, existing built-package fixture and example types pass.
  Both task-state offline examples and source/public ESM/CJS registry controls pass.
  New adversarial consumers reproduce two diagnostics that disappear when only the
  two new declaration members are removed in memory. The first full unit attempt
  hit four sandbox localhost errors; the unchanged full rerun passed with socket
  access. No fresh LLM calls, source/build changes or permanent tests in this review.
- **Adoption/handoff:** Existing runtime defaults, snapshot/recovery behavior,
  commands and examples remain as documented. Consumers constructing legacy
  resolved feature values or configuring an existing external `taskState` factory
  should wait for the compatible correction. Do not adopt a workaround requiring
  an API break or irrelevant built-in configuration. Recipe, README/User Guide,
  stage/roadmap/current availability and packaged review records track this status;
  generated API remains unchanged because source declarations were not edited.
- **Next:** Fix these two contracts, add unchanged public consumers, validate and
  regenerate affected documentation before restoring completion. Stage 10 remains
  separately authorized; no breaking API change or release is approved.

| Date | Change | Availability/validation | Documentation handoff |
| --- | --- | --- | --- |
| 2026-10-15 | Second Stage 04 review reproduces two public TypeScript compatibility regressions. | Completion provisional; fresh 7,784 units pass, but the two newly exercised legacy consumer shapes fail compilation. No fresh live run or runtime fix. | Current status, adoption/handoff, recipe/standard guides, stage/roadmap and packaged review/evidence synchronized; prior artifacts remain historical. |


### Stage 04 second corrective adoption — 2026-10-16

Both TypeScript compatibility findings are fixed and validated; Stage 04 completion
is restored on branch. See the [completion](./designs/STAGE_04_SECOND_REVIEW_AND_FIX_PLAN.md#corrective-completion--2026-10-16)
and [evidence](./evaluations/STAGE_04_SECOND_CORRECTIONS_VALIDATION.json).

- **Public types:** `ResolvedContextFeatures` retains the original eight required
  keys. New known additions remain optional in constructed feature/snapshot values,
  preserving old consumers as future opt-in features are added. Live context
  defaults remain unchanged. Inspect potentially older values with
  `features.taskState ?? false`.
- **Extension configuration:** `KnownPluginConfigs.taskState` accepts the explicit
  `TaskStatePluginConfig` or an existing factory's record. A registered external
  `taskState` factory retains precedence and can use its own configuration without
  irrelevant built-in fields. Use the explicit type/`satisfies` for strict built-in
  declarations; built-in runtime scope/task validation still applies when no
  external factory is registered. No new mutation tool or authority is added.
- **Compatibility evidence:** The new pinned root/`types` consumers construct old
  feature values and snapshot fragments and supply custom configuration without
  spreading current defaults or suppressing their type errors. They reproduce
  nine diagnostics before the fix and compile against the rebuilt package after it.
  The original review consumer also compiles unchanged; the intentional negative
  built-in type assertion continues to reject missing scope/task fields.
- **Validation:** 7,795 units / 357 files, including 164 Stage 04 cases and 11 new
  default/registry/checkpoint/failure/lifecycle regressions, pass with no final
  failures/skips. Eighteen source/public ESM/CJS observations, build/export checks,
  root/strict/example/AMOS types, expanded public consumer gate, lint, AMOS build,
  both task examples and API regeneration (1,682 items) pass. The expected pre-fix
  compiler failure and initial sandbox IPC build failure are retained; final build
  passes with local IPC access. No new live run for type-only production changes;
  earlier 117 live cases / 129 scenarios remain historical evidence.
- **Handoff/examples/AMOS:** Recipe, README/User Guide, generated API, example index,
  Changelog, stage/roadmap, package records and current availability/adoption/handoff
  are synchronized. Existing library/AMOS walkthroughs remain current. These type
  contracts need no new AMOS command/configuration or example behavior; actual app
  tests/types/build/session recovery and its offline workflow pass.
- **Boundaries/next:** No execution implementation, runtime default, limit, required
  storage/session/runner member or host authority changes. Tool generation refreshes
  transitive implementation fingerprints. No API break, package release, commit,
  push or Stage 10 implementation; Stage 10 remains separately authorized.

| Date | Change | Availability/validation | Documentation handoff |
| --- | --- | --- | --- |
| 2026-10-16 | Fixed both Stage 04 public feature/configuration typing regressions and pinned unchanged legacy consumers. | Complete on branch: 7,795 units, root/`types` and unchanged review consumers, 18 source/ESM/CJS controls, both offline task examples and all local/AMOS gates pass. Earlier live evidence remains historical. | Recipe/standard docs/API, examples index, release notes, stage/roadmap, packaged evidence and current adoption/handoff synchronized; no release or API break. |
