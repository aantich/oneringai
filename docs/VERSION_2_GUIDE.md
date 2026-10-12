# OneRingAI Version 2 Guide

This is the living, user-facing guide to OneRingAI's Version 2 initiative. It
explains what each delivered stage enables, how to adopt it, and what must reach
the standard documentation before release. Read the
[architecture roadmap](./designs/AGENTIC_ARCHITECTURE_EVOLUTION.md) for implementation
scope, dependencies, research, and acceptance criteria.

- **Status:** Work in progress; stages 00 and 01 complete and available on branch.
- **Created / last updated:** 2026-10-07 / 2026-10-08.
- **Repository package version at creation:** `1.2.0`.
- **Completed implementation stages:** 00 — evaluation and compatibility baselines;
  01 — fresh request accounting and safe compaction.
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

**Availability: Stage 01 available on branch; stages 03 and 07 planned.**

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

Later stages add two opt-in ways to keep the active prompt manageable:

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
references will state whether they survive only within a process or across a
restart, which backend acknowledges storage, and when records expire or are deleted.
Existing nonblocking history logging alone is not an acknowledgment guarantee.
Applications must be able to inspect the original result rather than receive only
the model-facing projection.

**Remaining adoption material for stages 03 and 07:** New strategy options and defaults;
an offline large-result projection example; an opt-in live
summary comparison; source recovery and missing/expired-reference behavior;
save/load and cleanup instructions; relevant AMOS context/evidence views.

## Reliable tool outcomes and cancellation

**Availability: Planned — stage 02, extended by stage 03.**

Applications need to distinguish a successful action from a tool execution that
returned a normalized error. Version 2 will make those outcomes consistent in the
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

**Adoption material to add at delivery:** Verified outcome and cancellation APIs;
unchanged raw-result examples; normalized error, timeout, and late-result scenarios;
retry limitations; provider/local execution boundaries; AMOS outcome display.

## A main model with bounded helper models

**Availability: Planned — stage 06.**

The first multi-model capability keeps the main model fixed for an execution and
adds explicit helper invocations. Compaction is the first intended helper role;
extraction can be added when selected and validated. Automatic switching of the
main provider during a trajectory is a conditional extension, not a prerequisite.

A helper uses a named connector and a supported model configuration. Credentials
remain in the connector, and capabilities must be checked before unsupported
settings or oversized input reach a provider. A helper does not acquire the main
agent's entire tool authority merely because it processes some of its context.

Usage reporting must include helper calls, retries, repairs, and any other model
work in the selected task scope, counted once. Missing prices or usage are unknown,
not zero. A hard monetary ceiling requires a conservative, known estimate; token,
call, and time limits remain useful when price information is unavailable. External
service fees must be distinguished from model usage. Background work needs its own
explicit budget and lifecycle.

**Adoption material to add at delivery:** Public helper-role configuration; named
connector examples; supported options and capability failures; budget and fallback
behavior; all-call usage reporting; a measured quality/cost comparison; AMOS role
and usage settings. Model choices and prices must be checked at publication time.

## Task state that survives compaction

**Availability: Planned — stage 04.**

A long-running assistant should retain the user's objective, confirmed constraints,
current progress, outstanding questions, and the evidence behind completed work.
The planned task-state view reuses existing task facilities instead of asking
applications to maintain a second workflow system.

Host-confirmed structured constraints can be protected mechanically. Extracting
constraints from free text is fallible: proposals must retain their source and
must not silently become host authorization. Likewise, model-written state cannot
declare an external workflow complete without the host's required evidence.

**Adoption material to add at delivery:** Task-state view and update contracts;
host versus model ownership; confirmed versus proposed constraints; compaction
and restart examples; compatibility with existing task types and memory state
transitions; AMOS progress and pending-work views.

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
| 02 | Accurate tool outcomes and cancellation | Core | Planned | — | — | — |
| 03 | Evidence references and projections | Core | Planned | — | — | — |
| 04 | Task-state view and protected constraints | Core | Planned | — | — | — |
| 05 | Typed context and selective assembly | Conditional | Conditional / deferred | — | — | — |
| 06 | Helper roles and task budgets | Core | Planned | — | — | — |
| 07 | Structured summaries and observation masking | Core | Planned | — | — | — |
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
| 03, 07: evidence and summaries | Evidence recovery, acknowledgment/retention, save/load, summaries, failure, defaults, and adoption. | README; User Guide; generated API; large-result/summary examples; AMOS evidence views; Changelog. | Pending |
| 02: tool outcomes | Reliability guarantees, errors, cancellation, timeouts, late outcomes, compatible shapes, and observable corrections. | README; User Guide; generated API; connector/tool guide where affected; failure example; AMOS outcome display; Changelog. | Pending |
| 06: helper models | Connector setup, role options, budgets, all-call usage, fallback, unsupported configurations, and unknown-price limits. | README; User Guide; generated API; model-role example; AMOS role/usage controls; Changelog. | Pending |
| 04, 10: task state and completion | Host-owned state, constraints, recovery, completion, run/stream differences, existing task compatibility, and enabling policies. | README; User Guide; generated API; memory guides where affected; state/recovery examples; AMOS progress; Changelog. | Pending |
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
