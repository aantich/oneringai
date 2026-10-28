# Consumer execution hardening — validated gaps and delivery plan

- Date: 2026-10-23.
- Library baseline: `version2`, `dff238759c41431bd24712d3b045dd38fc800b37` (`stage 14a`).
- Original request: validate the ICOS reports and plan improvements. Revision 5
  is approved; the subsequent implementation request selects C1 first.
- Status: **revision 5 implemented on branch; offline completion gates passed**.
  Follow the [live delivery ledger](CONSUMER_DELIVERY_LEDGER.md) for C2–C9.
  Current delivery: C1–C9-C are implemented in order, with per-slice review/fixes. Live testing was paused by the user on 2026-10-28; outstanding live failures are explicitly unverified. No release or consumer upgrade is claimed.
  See [C1 delivery](CONSUMER_C1_DELIVERY.md). C2–C9 are authorized for sequential delivery;
  no consumer/dependency upgrade, breaking change or package release is included.
- Compatibility revision: the user's subsequent instruction rejects breaking old
  agents. **No breaking option is proposed by this plan.** New APIs adapt to old
  contracts; old contracts do not migrate to new semantics. See the
  [compatibility-first API design](CONSUMER_COMPATIBLE_APIS.md).
- Holistic corrections: [review decisions](CONSUMER_PLAN_HOLISTIC_REVIEW.md) and
  [revision-3 evidence](../evaluations/CONSUMER_PLAN_HOLISTIC_REVIEW_2026_10_23.json).
- Additional consumer input: [validated registry follow-up](CONSUMER_REGISTRY_FOLLOWUP.md)
  and [revision-4 evidence](../evaluations/CONSUMER_REGISTRY_FOLLOWUP_2026_10_23.json).
  The earlier review records retain their historical artifact hashes.
- Final pass: [simplicity and regression review](CONSUMER_PLAN_FINAL_SIMPLICITY_REVIEW.md)
  and [revision-5 evidence](../evaluations/CONSUMER_PLAN_FINAL_SIMPLICITY_REVIEW_2026_10_23.json).
- Original investigation evidence: [review record](../evaluations/CONSUMER_EXECUTION_REVIEW_2026_10_23.json)
  and [executable characterization](../evaluations/consumer-execution-review-probes.mjs).
- Parent documents: [architecture roadmap](AGENTIC_ARCHITECTURE_EVOLUTION.md),
  [Version 2 guide](../VERSION_2_GUIDE.md), and
  [distributed execution design](DISTRIBUTED_AGENT_EXECUTION.md).

## 1. Recommendation

Connect the existing execution contracts across routines, connector tools,
orchestration and remote execution before adding more autonomous behavior.
The report is substantially correct about these integration gaps. It does not
establish that managed `Agent.run()` lacks the delivered v2 facilities, that all
fixed capacities are defects, or that a new orchestration platform is needed.

Reuse `ToolManager`, `ModelTask`, `ToolExecutionOutcome`, `AgentLoopDiagnostics`,
context plugins, evidence storage, routine/task state and host construction.
Avoid a second execution loop, outcome system, tool pipeline, model router or
workflow scheduler. ICOS supplies business verification and current authority;
OneRingAI carries and reports them consistently.

The completed first slice is **C1**, using the revised invocation
contract and frozen compatibility fixtures. Its [delivery record](CONSUMER_C1_DELIVERY.md)
records all passing local, public-package and three-provider gates. The next
recommended slice is C2; it is now authorized by the full-sequence request. C2 supplies the execution binding needed by later composite work; C3
then addresses the most consequential business-completion defect. C4/C5 connector work depends on C1, not routine continuation. C6 and C7 have
independent dependencies; neither must wait for the other. C8 tests grow throughout. Only an explicitly selected
slice should be implemented next.

The registry follow-up strengthens C6 to accept complete root/worker configuration
before construction. It adds three independent small tracks: C9-A endpoint-specific
Realtime/transcription capabilities, C9-B opt-in parameter assessment/normalization,
and C9-C browser-safe vendor presentation. They do not delay C1–C8 or authorize a
new runtime, registry rewrite, default validation change or consumer upgrade.

### Document ownership

Keep one normative owner for each decision. This plan owns scope, dependencies,
release/validation gates and consumer boundaries. The
[API design](CONSUMER_COMPATIBLE_APIS.md) owns C1–C7 contracts and the C6 field/
precedence table. The [registry follow-up](CONSUMER_REGISTRY_FOLLOWUP.md) owns C9
constraints and provider evidence. Version 2/AGENTS/roadmap carry availability,
adoption and concise links rather than competing contract copies. Review documents
record decisions; their old proposed signatures are historical, not alternatives.

## 2. What was checked

This review read the supplied report, current library implementations and relevant
ICOS working files. It ran **334 existing tests across eight files**, the existing
built-package TypeScript consumer, **202 public ESM/CJS controls** and **17
asserted local characterization scenarios**. All existing checks pass; the probes
reproduce gaps and verify controls that those tests do not cover. A matched gap
is evidence of a defect or missing capability, not a claim it has been fixed.

No real LLM/service request, external write, service startup or application change
was needed. Previous 8,775-unit / 224-live Stage 14A results remain historical;
they were not rerun or claimed as fresh validation for this plan.

The backend and web app currently select the immutable Git revision
`991a977b769eabe6c43ec8eff6d057b20f0663d9`; both inspected lockfiles label it
`1.1.8`. The reported desktop `1.1.1` lock could not be independently located in
the inspected workspaces. Obtain its exact manifest during adoption intake rather
than treating that version assertion as verified. The library's branch version
and a consumer's installed revision are separate facts.

The subsequent registry follow-up identifies backend `70fad29d` and desktop
`33d70ade5` as using `991a977b769eabe6c43ec8eff6d057b20f0663d9` / 1.1.8.
That supersedes its author's earlier desktop-version claim, but the desktop
manifest and application test results remain report-attributed, not independently
rerun here. Its current ICOS source confirms the temperature/context mappings and
limited worker mapping. See the follow-up for the exact pinned/current comparison,
provider evidence and fresh validation; do not combine historical test totals.

### Report disposition

| Report item | Verdict and evidence | Planned response |
| --- | --- | --- |
| 1. Routine completion | **Confirmed gap.** `executeRoutine()` reduces `AgentResponse` to text and default reflection validation auto-passes. P01 reproduces a false host completion verdict followed by a completed routine. | C3: explicit verified mode, retained diagnostics, honest waiting/uncertainty and host continuation. |
| 2. Shared accounting | **Confirmed missing integration.** Options and internal calls do not carry a shared `ModelTask`; P02 observes different task IDs for two tasks in one routine. Nested control flow, reflection and extraction have the same source-level gap. | C2: explicit forwarding without default hard spending limits or ambient inheritance. |
| 3. Failure provenance | **Confirmed.** P14 observes an admitted Microsoft read returning an operational error but a succeeded framework outcome. P03 shows valid negative business data succeeding locally and failing remotely. | C1: selected-tool invocation provenance; C7: negotiated remote classification. Preserve old semantics/raw data. |
| 4. Cancellation/retries | **Confirmed in inspected paths.** Microsoft helper options omit a signal; P05 confirms no signal reaches fetch. P06 shows `assign_turn` returning timeout while its retained worker continues and finishes later. | C2/C4: explicit execution binding and enhanced-helper forwarding; C6: selected child lifecycle. Preserve legacy defaults and late correlation. |
| 5. Effects/projections | **Confirmed for the audited families.** Forty definition-bearing files across Microsoft, Google, Slack and GitHub declare neither `effect:` nor `summarize:`. This is a source inventory, not a count of every generated runtime tool. | C4: enhanced factory contracts with effects and opt-in projections; old factories unchanged and mixed methods conservative. |
| 6. Pagination | **Confirmed.** P07–P11 show discarded provider continuations, missing thread continuation, a ten-page helper stop without resume, and false `hasMore` at an exact final limit. Google also drops `incompleteSearch`. | C5: resumable pages, honest completeness and stable query/account binding. |
| 7. Worker construction | **Confirmed missing extension.** The orchestrator and worker builders select a reduced config; a parent relationship alone does not supply user, registry, permissions or execution policy. | C6: one trusted host extension while preserving default construction and tool isolation. |
| 8. Remote outcomes/evidence | **Confirmed.** P04 observes a server outcome and a result-only wire response. Descriptors omit effect hints. P17 proves current protocol v2 rejects an added outcome field. | C7: negotiated extension with legacy v2 retained; authenticated metadata and evidence resolution. |
| 9. Truncation/capacities | **Partly confirmed; needs classification.** Topic slicing is silent, but 250 characters is Slack's documented provider constraint. Prompt views, parser bounds, source quotas and total-data cutoffs have different purposes. | C5: audit each category; preserve recoverable source and explicit errors. Do not simply raise or remove all bounds. |
| 10. Evidence backends | **Useful extension, not missing fundamentals.** Existing storage tests already cover integrity, scope, chunked retrieval, quotas, expiration, restart through a new instance and concurrent instances. | C8: extract a reusable conformance harness and add actual process/backend profiles. No production database choice in this plan. |
| 11. Inspectable guarantees | **Partly present.** P16 confirms managed inspection already reports features, verifier configuration and ownership notices without IO. `RuntimeAgent.inspect()` also exists. Configured verification is not an observed verified result. | C8: extend inspection with explicit composition support/unknowns and actual invocation diagnostics. |
| 12. Composition evaluation | **Validated coverage opportunity.** Passing existing tests coexist with these executable counterexamples. The baseline evaluator is intentionally a small repository utility. | Add regression fixtures in every slice and composed evaluation in C8, using the existing evaluator. |
| 13. Deferred enhancements | **Reasonable follow-on proposals, not fixes required for this plan.** | Keep Stages 09, 11, 14B, 08/13 conditional and separately authorized; require workload evidence before Stage 15. |

### Additional findings and constraints

1. **Reflection boolean ignored:** P13 returns `isComplete: false` with score 100;
   the routine completes because validation uses the score alone. Fix in C3's
   verified path; preserve legacy reflection semantics in the existing runner.
2. **Overfull-page loss:** P15 fetches six Slack items, returns five and exposes no
   way to recover the sixth. Merely returning the provider's next cursor would
   still lose an unread tail inside the already fetched page.
3. **Waiting persistence is incomplete:** `TaskStatus` already contains
   `waiting_external`, but `RoutineTaskSnapshot.status` does not. The runner starts
   a new execution each call; its existing execution log is not a resumable workflow
   checkpoint. C3 must design and validate continuation rather than just add a status.
4. **Remote extensions are not automatically additive:** current response/package
   validators use exact key allowlists. An optional TypeScript field alone does not
   make an older process accept a new wire message.
5. **Accounting is not duplicate prevention:** sharing a task constrains and counts
   model calls. It does not make external writes idempotent or make a new routine
   retry safe after an uncertain tool outcome.

## 3. Source map and provider checks

| Area | Current source |
| --- | --- |
| Routine options, validation, dispatch and retries | [routineRunner.ts](../../src/core/routineRunner.ts) — options near 94, reflection near 685, execution near 1238 |
| Nested map/fold/until and extraction | [routineControlFlow.ts](../../src/core/routineControlFlow.ts) — direct extraction near 503, recursive execution near 683/753/831 |
| Routine tool lifecycle | [createRoutineTool.ts](../../src/core/createRoutineTool.ts) — factory near 121; invocation ignores execution context |
| Worker construction and monitor calls | [createOrchestrator.ts](../../src/core/orchestrator/createOrchestrator.ts) — worker near 587; parent near 636 |
| Delegated timeout | [orchestrator/tools.ts](../../src/core/orchestrator/tools.ts) — `assign_turn` near 218–274 |
| Existing failure provenance | [outcomes.ts](../../src/core/tool-execution/outcomes.ts), [ResultNormalizerPlugin.ts](../../src/core/tool-execution/plugins/ResultNormalizerPlugin.ts), [ToolManager.ts](../../src/core/ToolManager.ts) |
| Remote execution, parsing and business-data misclassification | [AgentPackage.ts](../../src/portable/AgentPackage.ts) — execution near 504, parsing near 769, classifier near 1511; [types.ts](../../src/portable/types.ts) |
| Cancellation and retry foundation | [Connector.ts](../../src/core/Connector.ts), [Microsoft helpers](../../src/tools/microsoft/types.ts), [Google helpers](../../src/tools/google/types.ts), [Slack helpers](../../src/tools/slack/types.ts) |
| Incomplete collections | [Microsoft files](../../src/tools/microsoft/listFiles.ts), [Microsoft meetings](../../src/tools/microsoft/listMeetings.ts), [Google files](../../src/tools/google/listFiles.ts), [Slack thread](../../src/tools/slack/getThread.ts) |
| Silent input mutation | [setChannelTopic.ts](../../src/tools/slack/setChannelTopic.ts) |
| Existing evidence contract/tests | [IEvidenceStorage](../../src/domain/interfaces/IEvidenceStorage.ts), [storage tests](../../tests/unit/core/evidence/EvidenceStorage.test.ts) |
| Existing inspection/evaluation | [Agent inspection](../../src/core/Agent.ts), [inspection projections](../../src/core/capabilityInspection.ts), [baseline guide](../AGENTIC_BASELINE_EVALUATION.md) |

Provider documentation independently confirms the paging/constraint interpretation:

- Graph requires following the complete opaque `@odata.nextLink` until absent;
  keep required headers across page requests. Never reconstruct a skip token or
  accept an arbitrary model-supplied destination. [Microsoft paging guidance](https://learn.microsoft.com/en-us/graph/paging),
  [response handling](https://learn.microsoft.com/en-us/graph/best-practices-concept).
- Drive exposes `pageToken`, `nextPageToken` and `incompleteSearch`. Exhausting a
  cursor does not resolve an incomplete search; mutations can change expected
  results. [Drive files.list](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/list).
- Slack replies exposes cursor pagination; page sizes/rate limits can vary with
  app distribution. A hardcoded assumption that 200 items always arrive is unsafe.
  [Slack replies](https://docs.slack.dev/reference/methods/conversations.replies/).
- Slack currently documents a 250-character topic constraint. Preserve intent by
  reporting overlength input rather than silently rewriting it; do not replace
  250 with another invented limit. [Slack setTopic](https://docs.slack.dev/reference/methods/conversations.setTopic/).

Complete traversal tests must use stable collections or a provider's snapshot/delta
guarantees. A generic cursor wrapper cannot promise no omissions or duplicates
while an arbitrary remote collection is concurrently changing.

## 4. Compatibility and ownership rules

1. Preserve existing overloads/types, default configuration, raw results/events,
   supported extensions and session loading. `createOrchestrator()` already returns
   `Promise<Agent>`; its existing worker callback returns `Agent` synchronously.
   Preserve both. Use separate additive entry points/types where extending an old
   union, callback, schema or result would change supported consumer behavior.
2. Keep named connectors authoritative for authentication; principal/account,
   registry, permissions, evidence scope and task authority come from the host.
   A package, cursor, model argument, summary or child label grants no permission.
3. Sharing `ModelTask` remains explicit. No implicit `AsyncLocalStorage` inheritance,
   surprise helper-model selection or new default hard budget. A borrowed task is
   never destroyed by a child; one child timeout must not cancel unrelated siblings.
4. Local task handles are process-local authority. Across HTTP, send correlated
   identifiers and authenticated observations, not serialized live task objects.
   Distributed hard-budget enforcement needs a separately approved authority design.
5. Keep framework settlement, business acceptance and verified workflow completion
   distinct. Cancellation/timeout does not establish that an external write did not
   happen. A failed projection/checkpoint must not replay its source action.
6. Preserve bounded prompt/diagnostic views when complete source remains reachable.
   Missing data, unknown usage and unsupported capabilities must remain explicit.
   Do not equate a record being acknowledged locally with replicated durability.
7. Every slice ships meaningful tests, a runnable offline example, relevant AMOS
   coverage, and Version 2 adoption/documentation handoff. Real model calls validate
   affected transport paths when implementation warrants them; they do not replace
   deterministic failure/concurrency tests.

### Required API separation

The [API design](CONSUMER_COMPATIBLE_APIS.md) replaces the initial draft's possible
legacy switches. Its new identifiers are proposals, not available exports.

| Decision | Required compatible path | Existing contract that stays unchanged |
| --- | --- | --- |
| Routine completion and reflection | New `createRoutineRunner()` facade requires phase-aware host verification. No duplicate legacy mode. | `executeRoutine()`, its auto-pass/score behavior, return values and callback traces. |
| Routine/task statuses and continuation | New result types and same-process, single-use handles; durable workflow resume is deferred C3-R. | Existing status unions, `paused` meaning, snapshot fields and storage adapter requirements. |
| Failure reporting | New `createOutcomeTool()` callback receives an invocation-owned reporter; returns an ordinary `ToolFunction`. Enhanced built-ins select this contract explicitly. | Existing `ToolContext`, `ToolFunction.execute`, raw returns and classification of unmarked tools. |
| Topic overflow and pagination | New `ConnectorTools.enhanced()` tool set, with distinct names for changed schemas/results; strict input validation is selected there. | Existing `ConnectorTools.for()`/individual factories, truncation, pagination schemas, counts and result keys. |
| Delegated cancellation/construction | New `createOrchestratorWithFactory()` path selects cooperative lifecycle and host construction. | Existing `createOrchestrator()`, worker callback, timeout/reuse behavior and tool results. |
| Remote metadata | Separate negotiated outcome server/hydration APIs, separate DTO types/constants. | Protocol v2 literal `2`, exact allowlists, server behavior, package shapes and legacy transports. |
| Inspection/capacity | Existing inspectors plus operation-owned reports, and explicit new-path continuation/source controls. | Existing inspection shapes, budget defaults, protective admission limits and retention policies. |

An upgrade alone must activate none of these paths. No global compatibility switch,
automatic preset change, session migration or future default flip is proposed.
If a guarantee cannot fit this separation, redesign or defer it; do not ask old
agents to change to accommodate it. API review selects a compatible design, not an
exception to this constraint.

## 5. Proposed delivery slices

| Slice | Scope / report mapping | Dependencies | Release condition |
| --- | --- | --- | --- |
| C1 — complete on branch | Opt-in invocation-owned failure provenance — R3 | Existing Stage 02 | Explicitly selected tools report operational failures; legacy raw data and classification stay unchanged. Remote parity follows in C7. |
| C2 — implemented on branch | Private composite accounting and cancellation foundations — R2/R4 | C1 where failures are reported | Internal tests prove binding across nested calls; public facade follows in C3 and child lifecycle in C6. No legacy API/default changes. |
| C3 — implemented on branch | Verified routine completion and same-process continuation — R1 plus P13 | C1/C2 | Phase-aware final verification; no effect replay; public C2/C3 facade released together. Durable restart is not included. |
| C4 — implemented on branch | Specialized connector cancellation, safe retry/effect metadata and projections — R3/R4/R5 | C1 | Audited tools expose accurate effects, cancellable work and non-destructive result handling. |
| C5 — implemented on branch | Recoverable pagination, honest completeness and truncation audit — R6/R9 | C4 helper forwarding | Entire stable result set remains traversable; no unread tail discarded or silent input mutation in the selected mode. |
| C6 — complete on branch | Trusted parent/worker construction and child diagnostics — R7 | C1/C2 | Narrow host-selected child authority, shared local accounting and accurate completion/late results. |
| C7 — implemented on branch | Negotiated remote outcomes/evidence and trusted metadata — R8 | C1/C4; stage-entry wire-schema review | Mixed-version compatibility and authenticated local/remote semantic parity. |
| C8 — implemented on branch | Backend conformance, composition inspection, end-to-end evaluation and adoption handoff — R10/R11/R12 | Harness grows throughout; final gate after C3–C7 | Reusable backend tests and demonstrated composed contracts, with consumer work explicitly separated. |
| C9-A — implemented on branch | Endpoint/model-specific Realtime reasoning and input-transcription capability companion | Independent; verified provider contract required | Explicit supported/unsupported/unknown records; old registry/session behavior unchanged. |
| C9-B — implemented on branch | Public parameter assessment and opt-in neutral temperature normalization | Independent; effective request/routing semantics reviewed first | Consistent selected generation/stream/count/batch assessment; strict legacy validation and explicit vendor controls preserved. |
| C9-C — implemented on branch | Browser-safe vendor presentation catalog | Independent | Host-adopted names/colors; unchanged vendor IDs, service classification and authentication. |

Each row is separately selected for implementation. C2 is private foundation work;
its public release boundary is C3, not an intermediate API release. If a slice
proves too large,
split its implementation record at the stated acceptance boundaries rather than
quietly weakening validation or claiming the entire consumer report is delivered.

### C1 — Invocation-owned failure provenance

**Implementation:** Extend existing internal provenance once behind a new
`createOutcomeTool()` helper returning a normal `ToolFunction`. Only its new
callback receives `reportFailure`; do not add fields to the existing `ToolContext`
or change the old execute callback. Library-owned enhanced factories opt into the
helper in C4. Direct execution keeps the supported raw return; invocation-owned
diagnostics are consumed only by the admitted managed invocation.

Distinguish declined business decisions from denied authorization, operational
errors, cancellation and timeout without inspecting arbitrary payload fields.
Sanitize errors and retain correlation/cancellation precedence/late diagnostics.
Keep the old portable classifier unchanged; C7 introduces provenance semantics
only through its explicitly negotiated path. C1 does not claim remote parity.

**Coverage:** Valid `success:false` data, caught HTTP failures, thrown errors,
normalizer errors/nulls, denied admission, aborted calls, late settlement,
concurrent identical payloads and primitive/frozen results. Assert unchanged raw
`execute()` returns, unmarked-tool behavior, legacy server classification and
public consumer fixtures. C7 adds negotiated local/server parity.

**Example/AMOS:** One synthetic declined decision and one operational failure with
the same raw shape but different framework outcomes. AMOS shows semantic status
without translating every negative business value into a red failure.

**Done:** Provenance is per invocation, never attached by a forgeable payload key;
unknown/error results do not cause automatic replay of a possible external write.

### C2 — Explicit execution binding and cooperative cancellation

**Implementation:** Introduce the new routine facade's optional `execution:
{ modelTask, signal }` binding; leave `ExecuteRoutineOptions` unchanged. Thread it through
task attempts, reflection, LLM extraction, recursive map/fold/until and deterministic
steps. Automatic compaction already uses an Agent's active task: make the outer
binding reach it rather than create a second compactor accounting path.
Keep this new routine plumbing private in C2; publish the complete facade in C3
after freezing its result/verification/continuation types. Do not expose incomplete unions
that C3 would have to widen. C2 is an internal foundation, not a public routine API
availability claim.

Define how library-owned composite tools receive the caller-authorized binding.
`ToolContext` currently has a signal but no `ModelTask`; preserve that contract.
Use an explicitly bound new routine-tool adapter, not global ambient state or the
whole parent Agent. Existing zero-argument factories
must compile and behave unchanged. Explicit helper invocations outside that binding
retain their documented independent-task default.

Forward only the options that belong to a nested operation. Do not blindly copy
parent routing/native state, credentials, tools or authority into a child.
Keep creator-owned versus borrowed agents/tasks explicit. Cancelling one waiter
must not abort another caller's shared token refresh or destroy a shared task.
Managed `RunOptions` does not accept `signal`. Use a private invocation-bound
bridge under the Agent execution lease for managed run/stream only. Direct calls
already accept `signal`/`modelTask`; reuse those options, as with helpers/tools/
connectors. Never spread unsupported fields or
call `Agent.cancel()` against an unrelated run. A host-shared cancellation signal
can intentionally stop all children; a child timeout uses a derived controller.

Specify cooperative child timeout ownership for C6's new path: cancellation request,
busy ownership until settlement and correlated late diagnostics. Do not change the
existing `assign_turn` timeout, scheduling or retained-worker behavior in C2.

**Coverage:** Same object/task ID through standard tasks, retries, reflection,
extraction and all control-flow operators; no new reservation on rejected retries;
exact-once accounting of each invocation; partial/unknown external usage retained.
Cancel before dispatch, during generation/helper/compaction/auth wait, between
iterations and during child teardown. Check deadlines, borrowed ownership, sibling
isolation, late completion and fresh work after explicit abandonment.

**Example/AMOS:** A deterministic internal composition fixture and a public example
of explicitly sharing ModelTask across host-managed calls and supported helper/tool
signals. It does not invent a public managed-run signal option.
The facade/AMOS operation view ships with C3, and child integration with C6; record
C2's internal-only status rather than exposing a temporary API.

**Done:** Private composition coverage proves one explicit binding reaches local
nested calls; all public legacy gates remain green. Public facade availability is
C3. Hard limits remain explicitly selected and separately approved where required.

### C3 — Verified routine completion and same-process continuation

**API:** Deliver the complete `createRoutineRunner({ verify, onProgress? })` facade
from the [revised API design](CONSUMER_COMPATIBLE_APIS.md#3-explicit-execution-binding-and-verified-routines).
One required host callback receives task/routine phase and settled/reconcile reason.
There is no new legacy-completion mode or optional workflow storage abstraction.

**Execution:** Keep relevant AgentResponse/loop, tool and deterministic-step
observations before deciding completion. Verify task readiness before dependencies;
verify the final artifact after applicable post-steps. A false/missing expected
managed verdict, refusal, suspension or uncertainty cannot silently pass. Strict
reflection checks both boolean and score; warning-mode quality stays explicitly
separate from host-confirmed business completion.

Preflight the complete nested definition/options before any pre-step. Reuse static
DAG/templates/conditions and sequential map/fold/until. Keep one tool manager.
The new contract makes one outer task submission; explicit `maxAttempts > 1`,
dynamic tasks, parallel settings and model-led approval scheduling reject before
I/O rather than being silently approximated. Old runner behavior stays unchanged.
Post-step `always` means once at a terminal task-execution boundary, not each wait;
cancellation does not authorize new side-effecting cleanup. Host verification sees
continued step errors and cannot mistake them for succeeded execution.

**Continuation:** Waiting/blocked/uncertain results retain an opaque same-process
handle, original observations/receipts, next unstarted work and an exclusive Agent
lease. Resume requires renewed host authorization and atomically claims the handle.
Rejected/throwing authorization, cancellation before admission or an invalid
binding must leave a paused handle usable; successful admission consumes it and
a subsequent wait returns one successor. Preserve one bounded observation set with
source references, rather than repeated full task/tool bodies in every report.
It reconciles first, then advances only unstarted work; it never resubmits the
settled task/action or repeats completed pre/post steps. Preserve original native
async binding/task/delivery authority. Supplied ModelTask/deadline is not replaced
to bypass a limit. Borrowed agents/tasks remain host-owned.

The new routine-tool adapter retains its owned child across waiting and destroys
it once after terminal cleanup. Model-facing JSON never contains continuation
capabilities or live Agent/task objects. `close()` invalidates handles and requests
cancellation without claiming uncooperative work stopped; occupancy/late evidence
remain associated until settlement. Test normal, failure and abandoned teardown.

**Deferred C3-R:** Durable routine restore, cross-process resume and workflow
CAS/leases/fencing are not part of C3. Existing audit/evidence/context snapshots do
not establish those guarantees. After process loss recover acknowledged evidence,
report uncertainty and require host reconciliation; never automatically rerun a
write. Select a separate design only when a real workload justifies durable resume.

**Coverage:** Missing artifact; final artifact created by a post-step; task readiness
versus final verification; negative reflection/high score; false managed verdict;
accepted versus remotely completed action; host resolution of an earlier wait;
throwing/malformed verifier; definition rejection before any action; nested flow;
no outer replay after uncertainty; concurrent/stale/foreign handles; revoked resume
authorization; absolute deadline; borrowed ownership; waiting child retained;
observer failure; source retention; process loss safely refusing workflow restore.

**Example/AMOS:** A synthetic submission waits, then a host-driven verification
completes the same operation with one submission. A second example creates the
artifact in a post-step. AMOS exposes wait/reconcile/cancel and accurate phase/result
views; no durable-resume command or default config migration is introduced.

**Done:** Required phase-aware host evidence gates completion. Existing agents and
routine contracts remain unchanged; same-process recovery is demonstrated without
claiming workflow restart or exactly-once external effects.

### C4 — Specialized connector execution contracts

**Implementation:** Inventory every owning factory/helper, starting with the
audited Microsoft/Google/Slack/GitHub families. `ConnectorTools.enhanced()` explicitly
selects the new contracts; existing factories and their outputs remain unchanged.
Use isolated definitions/cache entries, not mutation of cached legacy tools.
Add signal forwarding in the selected path
through authentication waits, retry delays, requests, response consumption and
multi-request operations. Reuse `Connector.fetch()` operation deadlines and safe
retry policy; do not implement another HTTP client or silently change global
legacy retry defaults. Expose host controls rather than model-controlled deadlines.
Freeze C4's `execution-v1` profile inventory. C5's `collections-v1` profile reuses
those mechanics and replaces affected operations; no second public factory registry.
Use `profile`, distinct `_exec`/`_page`/`_strict` names and isolated definitions.
Existing profiles and legacy factory outputs stay fixed.

Classify real reads as `read`, mutations as `write`, and mixed/arbitrary requests
as `unknown`. Classification must follow the actual operation, not just the HTTP
verb: some API searches use POST. `idempotency.cacheable` is not effect metadata.
Generic APIs supporting arbitrary methods remain conservative.

Where output is large, supply deterministic projections that preserve IDs,
acceptance/final state, source references, continuation and completeness. Evidence
must acknowledge the complete allowed/redacted source before replacing its body.
If source was never retained, a small projection cannot repair the data loss.
Failure to store/project a settled action must not trigger an action retry.

**Coverage:** Aborts at auth/header/body/backoff and between requests; concurrent
auth waiters; safe read retry versus uncertain mutation; output/error provenance;
effect inventory assertions at actual factories; full raw return/event preservation;
projection failure and exact source retrieval after compaction.

**Example/AMOS:** Synthetic read/write/unknown tools, cooperative cancellation and
one oversized observation recovered from evidence. AMOS uses existing outcome and
evidence presentation; add adapter tests, not another policy system.

**Done:** Publish the actual supported factory inventory and any explicit exceptions.
Do not infer complete connector coverage from one generic tool's implementation.
Follow the [registration contract](CONSUMER_COMPATIBLE_APIS.md#4-connector-profiles-and-page-contracts):
source-tagged registration and real enabled-definition assertions are required.
C4's static adoption uses existing identity filters and disables catalog loading;
it must not accidentally expose legacy aliases. C5 adds the required manager-local
catalog gate using the same fixed manifest; a returned tool array does not select
an entire Agent/catalog's profile. No global factory/category replacement.

### C5 — Reachable pagination and honest capacities

**API:** `ConnectorTools.enhanced(name, { profile: 'collections-v1', ... })` selects
page-aware tools and strict changed-input tools. Old listing/count/result/limit
contracts stay unchanged. No optional keys are appended to legacy results.

Each page call fetches one logical provider page, allowing only C4's observed safe
read/auth retries, and returns the whole allowed fetched page. It does not fetch
a second page automatically. `pageSize` is a provider hint; never slice off an unread tail. Use
explicit `more`/`end`/`unknown` position plus independent search coverage, returned
count and optional provider total. Drive incomplete-search history survives later
pages. A full or empty page alone never proves another page or complete traversal.

Use bounded stateless authenticated encrypted opaque tokens scoped to the managed context,
connector/account/principal, query and order. Validate current authorization and
provider origin/path at each use. Preserve the complete opaque Graph position and
required headers. A private registration companion keeps the codec through catalog
unload/reload and temporary tool scoping; no model-call-per-page requirement.
Recreating the owning manager/process invalidates its ephemeral codec;
return explicit invalid/expired continuation without dispatch. No new cursor
backend, item-tail store or hidden restart promise is included.

Audit fixed capacities across inputs/results, loop packets, task state, workspace,
evidence, presets and portable messages. Record owner/rationale/configuration,
overflow and exact-source retrieval. Preserve admission/storage/view protections;
remove selected-path silent loss through full pages, acknowledged source or
explicit failure. Strict topic validation follows Slack's documented constraint;
old normalization remains unchanged. This is not a larger arbitrary total cutoff.
The inventory is not a mandate to redesign every bound; unrelated protections stay
unchanged unless a reproduced selected-path failure warrants a separately tested fix.

**Coverage:** Empty/intermediate/final partial pages, exact boundaries, more than ten
pages, provider over-return without slicing, missing/repeated/invalid/forged cursors,
query/account/order changes, catalog reload/scoping, instance loss, cancellation/backoff, Drive incomplete
search and Slack thread parent/reply handling. Compare exact stable-fixture IDs;
mutable collections require provider snapshot/delta guarantees. Test Unicode input,
source admission/projection failure and complete evidence retrieval.

**Example/AMOS:** Traverse a stable synthetic collection beyond old boundaries,
including over-return and final partial page; compare IDs/hashes. AMOS distinguishes
returned count, position and search coverage. It never announces a false total.

**Done:** All requested stable-fixture results remain reachable through the selected
page contract, including the C5 manager-local catalog integration gate. Source never disappears at a page/work limit; legacy tools retain
supported behavior and no new workflow/cursor database has been introduced.

### C6 — Trusted parent and worker construction

**API:** Add `createOrchestratorWithFactory()` with one host-owned
`configureAgent` callback for parent and workers. Reuse existing orchestration internals; keep the original
`createOrchestrator(config): Promise<Agent>` and its synchronous worker callback
unchanged. The new callback may be async because its type is separate. Do not
spread arbitrary config into old builders or introduce two competing builder systems.

A separately typed callback receives role/name/type and detached baseline config,
and returns complete Agent configuration, synchronously or asynchronously. The
library composes required tools/workspace before plugin and lifecycle initialization,
then constructs the Agent once. Returning an already built Agent, live context or
tool manager is excluded on this new path; those cannot guarantee creation-time
integration. Ordinary Agent construction and old orchestration stay unchanged.
The [API design](CONSUMER_COMPATIBLE_APIS.md#5-trusted-orchestration-and-per-operation-ownership)
and [follow-up](CONSUMER_REGISTRY_FOLLOWUP.md#c6-complete-configuration-before-construction)
freeze field coverage, ownership and precedence. No post-construction private mutation.

Use the API's single configuration-ownership table rather than another merge
scheme. Preserve full saved settings, zero/false/absence, context without memory,
explicit shared evidence/task scope and distinct conversation identity. Successful
host worker configuration also grants shared-board membership; it is not tenant
isolation. Preflight conflicting identity channels and statically known tool names;
construction-time collisions roll back without a trial Agent construction.

Return child loop/verification diagnostics, usage correlation and evidence
references through the new path's result/observer types. Apply C2's cooperative
timeout ownership specification only here; preserve existing tool result shapes.
Capture binding per parent operation/child admission from an explicitly supplied
`parent.run(..., { modelTask })`; never capture a live task/signal for all future
runs in the constructor. `descriptionExecution` is for creation-time descriptions
only. Account monitors/async delivery under their original operation. Quarantine
an abandoned worker; never make its still-running instance reusable.

**Coverage:** Old factories/overloads; actual mocked provider request bodies for root
and workers with different providers/accounts; every forwarded field and precedence;
creation-time plugin/tool/hooks and session storage; reserve/strategy with no memory;
zero/false/absence; identity and permission isolation/revocation; shared workspace
ownership/collisions; foreign evidence; construction failure and pending callback
teardown; concurrent workers; timeout/late completion; borrowed backend/task cleanup;
monitor accounting; child verification false/waiting. Snapshot-only checks are insufficient.

**Example/AMOS:** Narrow reader/verifier specialists configured by a host callback with
one explicit local task. Inspect their actual allowed tools and correlated results.
Update AMOS only if it exposes this orchestration path; otherwise record why a
library example plus adapter tests is the applicable reference surface.

**Done:** Host builders can preserve v2 settings without copying OneRingAI internals.
This is hardening of existing orchestration, not authorization for Stage 14B.

**Consumer adoption:** Later ICOS PRs must pass prepared root config from
`createAgentWithHooks` and each authorized effective child definition from
`resolveOrchestratorChildAgents`; upgrade normal immutable dependency pins in both
consumers. Measure context preparation reads before changing that path. No cast,
private patch, copied orchestrator, new database or permission cache is a solution.

### C7 — Negotiated remote outcome and evidence parity

**Stage-entry wire-schema review:** P17 rules out adding fields to v2 responses.
Use `hydrateAgentPackageWithOutcomes()` to match existing `hydrateAgentPackage()`
vocabulary; the old draft's `restore...` name is withdrawn.
Use separate outcome server/hydration entry points and an explicitly negotiated
envelope while retaining old v2 DTOs, classifier, literal types and default
behavior. Never broaden `AgentPackageProtocolVersion` or change its constant.
Reuse the executor and tool manager behind both representations; do not fork the
execution pipeline.

Carry bounded authenticated server receipts, invocation/call/run correlation,
semantic status, cancellation/uncertainty and evidence references separately from
raw business results. Keep proxy settlement and server operation observations
separate; do not overwrite
IDs/time/completion or infer remote success from transport success. The selected
managed bridge consumes validated server uncertainty for policy decisions. Expose
both observations through the new session report without changing old DTOs.
Carry remote uncertainty into evidence/compaction/restart guards, not just the UI.
Persist acknowledged observation envelopes through existing evidence interfaces
without changing raw returns or old schemas; missing/unacknowledged metadata remains
unknown and cannot release protected source or justify repeating a write.

Resolve effects and permissions from the trusted host's current registrations.
A mutable package is descriptive, and `output.effect: read` inside it cannot grant
repetition rights to an actual remote mutation. Recheck tenancy/current authority
on execution and every remote evidence read. A server evidence reference needs a
scoped remote resolver; a local store cannot automatically dereference it.

Negotiate, execute, getReceipt, cancel and readEvidence have explicit authenticated
semantics; client HTTP abort alone does not cancel server work. Cancellation and
receipt lookup recheck authority. Preserve correlation/deduplication during
reconnect. Inspect an
uncertain remote write before allocating a fresh request ID and trying again.
Audit bounded replay caches and result sizes without evicting in-flight receipt
authority or pretending process-local deduplication is durable exactly-once delivery.
Use acknowledged references/chunked retrieval for large sources on capable peers;
older peers fail explicitly where no compatible representation exists.

Remote accounting shares logical correlation, not a live JavaScript `ModelTask`.
Report server observations into a host-authorized aggregate with stable invocation
IDs and unknowns preserved. Any distributed budget reservation/enforcement protocol
is a separate approval, not an implied property of extra usage fields.

**Coverage:** v2↔v2, negotiated peers, mixed versions, downgrade/unknown fields,
forged outcomes/effects/references, cross-tenant reads, duplicated/reordered/late
responses, disconnection after submission, cancellation, oversized observations,
server restart and renewed authorization. Compare authoritative local operation
and server outcomes for the same fixture;
assert proxy transport settlement remains separately visible. Keep old raw shapes.

**Example/AMOS:** In-memory authenticated transport runs a read, a valid declined
decision and an uncertain synthetic write; recover exact evidence without another
write. AMOS gets library transport diagnostics if supported; desktop-specific SSE
and UI wiring remains an explicitly separate ICOS change.

**Done:** Supported peers preserve provenance without trusting model/package data;
unsupported peers expose the missing capability before dispatch rather than
claiming full parity or automatically retrying through legacy execution.

### C8 — Conformance, inspection and composed evaluation

**Implementation:** Extract the existing evidence tests into a reusable factory-
driven harness, retaining adapter-specific tests. Required delivery covers existing
in-memory/process-local and file/restart profiles, including actual child-process
file recovery. Shared-backend profiles are optional until a concrete adapter is
selected; an unrun or skipped profile is not verified support and is not a hidden
production-backend prerequisite. Cover acknowledgements, immutable
integrity, exact bounded reconstruction, isolation, expiration/deletion, admission,
concurrency and actual child-process recovery where a durability claim requires it.
Do not promise shared-instance recovery from an in-memory store or a locally
acknowledged file. A new production database/index/retention design is not included.
Keep the reusable harness runner-independent and test-only; no new test-runner
dependency or eager testing import belongs in the production root package.

Use existing Agent/runtime inspection plus operation-owned routine/remote reports
and explicit child observers, leaving old report shapes intact. No universal
polymorphic inspector or global execution registry. Report loop owner,
configured versus actually observed verification, evidence/task-state activation,
explicit accounting binding, remote outcome support, cancellation and compaction
support. Distinguish unsupported from unknown/unverified. Inspect per-invocation
decisions alongside configuration; direct, Realtime and external drivers keep
their existing loop owners. Inspection is not proof of business completion.

Grow the existing evaluator with held-out synthetic compositions:

| Workload | Required observation |
| --- | --- |
| Routine → connector → uncertain write → verification | One submission; receipt retained; false completion blocked; host verification required. |
| Parent → child → timeout → late result | Cooperative cancellation; busy ownership retained until safe release; original correlation on late diagnostics. |
| Local ↔ remote | Same domain result and semantic status; trusted effects; evidence reachable; no double accounting. |
| Long research → projection → compaction | Exact source IDs/quotes/hash recovered after prompt reduction; no unsupported completion claim. |
| Evidence/context → restart → reauthorization | Exact stored observations recover; no workflow cursor/task authority invented; uncertain effects are not replayed. Durable workflow resume remains C3-R. |
| Complete pagination | Exact stable-fixture ID set, including empty pages, unread tails and final partial page. |

Measure verified completion, false-completion rate, exact-source accuracy,
duplicate effects, redundant calls, latency distribution and whole-operation
known/unknown model cost. Require zero false verified completions, duplicate
synthetic writes and unauthorized disclosures in the deterministic acceptance set.
Define any live quality/latency/cost comparison before running it; smaller prompts
alone are not an improvement claim. No arbitrary product spending cap is introduced.

**Example/AMOS:** A composed synthetic meeting-preparation workflow with citations,
an artifact and host verification; run same-process continuation and local/remote
variants. After a process restart,
show safe evidence recovery and explicit workflow uncertainty rather than fake resume.
AMOS displays the same evidence/completion/accounting distinctions as the library.

**Done:** Reusable conformance and composed contract evidence exist; the supported
surface matrix and adoption boundaries are accurately documented.

### C9 — Independent registry and parameter follow-ups

Implement only an explicitly selected subtrack. The
[follow-up design](CONSUMER_REGISTRY_FOLLOWUP.md#independent-c9-subtracks)
contains source validation, provider evidence, API constraints, tests/examples,
AMOS applicability and adoption gates. These are additive companion/policy surfaces,
not a second model registry, automatic request sanitizer or service taxonomy rewrite.
C9-A may split reasoning and transcription delivery if their provider evidence is
not equally complete; no slice may claim all requested models verified while any
remain unknown. C9-B must distinguish current intentional generation rejection from
the pinned filtering issue and native-count validation inconsistency.

## 6. Per-slice validation and documentation gates

Before implementation, freeze the selected additive API and legacy contract fixtures.
Convert the applicable characterization probes into ordinary regression tests;
the supplied probe characterizes legacy behavior that must remain unchanged.
Preserve those legacy assertions and add separate acceptance assertions for the
explicit new path. Never make a compatibility test green by rewriting its old
expected behavior to match a new default.

For each slice:

1. Add meaningful success, failure, cancellation, concurrency, authorization,
   persistence, late-result and compatibility coverage where that slice crosses
   those boundaries. Test actual factories/runners and composed failure paths.
   Require paired legacy-equivalence and enhanced-contract tests from the
   [compatibility matrix](CONSUMER_COMPATIBLE_APIS.md#8-compatibility-gates).
2. Ship a deterministic offline public-API example with setup, expected output and
   cleanup. Add opt-in live mode only where real model/provider transport matters.
   Do not exercise real external writes merely to test orchestration mechanics.
3. Update AMOS when users can use/inspect the feature; otherwise record the precise
   applicability reason. Test real adapters/commands rather than only a mock UI.
4. Run focused checks, then the appropriate build, root/consumer/strict/example and
   AMOS types, lint, full unit gate and built ESM/CJS compatibility checks. Serialize
   builds before consumers that import `dist`. Run affected live suites with all
   required providers enabled; report skips/failures honestly and resolve required
   failures before completion.
5. Update Version 2 availability, adoption and documentation handoff; affected
   README/User Guide/recipes/AGENTS/examples/AMOS/release notes; regenerate public
   API documentation when APIs change. Verify local links and package inventory.
6. Record exact source/commit, commands, results, defaults, support limits, examples,
   compatibility evidence, resolved incidents and remaining work. Separate branch
   availability from an approved immutable package release.

## 7. ICOS adoption boundary

The local checks confirm the routine injector requests only 50 definitions, source
loading truncates before evidence can retain the complete source, and the event
bridge reconstructs payloads without the newer outcome/loop details. These are
consumer changes, not library fixes. Exact consumer file hashes and locations are
recorded in the review evidence; no application files were edited.

| Owner | Adoption responsibility |
| --- | --- |
| OneRingAI | Composed execution mechanics, provenance, cancellation, pagination, trusted metadata, conformance, diagnostics and examples in the selected slices. |
| ICOS builders | Preserve selected v2 settings through existing shared factories; bind current user/account/registry/permissions and explicit model tasks. |
| ICOS product | Supply business artifact/provider-state predicates, event scheduling, product behavior and human approval requirements. |
| ICOS storage owners | Approve the production evidence backend, tenancy, retention/deletion and multi-instance recovery design. History logging is not automatically acknowledged evidence. |
| ICOS backend/desktop/web | Carry optional outcome/loop/usage/evidence diagnostics through supported bridges; remove application-level total-data loss; negotiate protocol support. |
| Release owners | Verify every consumer's exact manifest/lock and install the reviewed immutable revision; stage independent application PRs and regression gates. |

Keep ICOS changes outside this library implementation authorization. For
`icos-app`, the standing rule requires a feature branch and PR targeting `dev`;
never edit or push directly on `dev`. Do not revive retired product automation.

After these contracts are demonstrated in a real consumer workload, revisit
ranked tool discovery (09), explicitly independent parallel reads (the selected
part of 11), narrow specialist delegation (14B) and episodic/procedural memory
(08/13) in the roadmap's dependency-valid order. Stage 15 and retention research
(16B) remain deferred. This plan grants none of those implementation approvals.

## 8. Final approval checkpoint

The user approved revision 5 of this roadmap and selected the recommended C1
implementation by saying “proceed with full implementation.” Its [API design](CONSUMER_COMPATIBLE_APIS.md)
and the [registry follow-up](CONSUMER_REGISTRY_FOLLOWUP.md) remain the staged direction.
The [final simplicity review](CONSUMER_PLAN_FINAL_SIMPLICITY_REVIEW.md) records
the current corrections; the earlier [holistic review](CONSUMER_PLAN_HOLISTIC_REVIEW.md) records
removed abstractions and explicit exclusions. The recommended implementation order
is C1 → C2/C3 → C4 → C5 → C6 → C7 → C8; C6 and C7 can be selected independently
once their actual dependencies pass. C8 coverage starts with C1. C2/C3 have one
public facade release boundary, avoiding a temporary API.

C9-A/C9-B/C9-C are independently selectable and need not wait for that sequence.
Their exact API contracts are reviewed at their stage entry. C6's updated callback
returns configuration before construction, replacing only an unimplemented proposal.

Approval covers this additive direction, stage boundaries and acceptance gates.
It does not automatically implement every slice or approve unreviewed C7 wire
bytes. The subsequent full-sequence request selects C2–C9 in order, with review
and fixes after each slice; do not stop for routine selection approvals. No breaking change, automatic
migration/default flip, durable routine/cursor restart, production backend,
distributed budget, consumer upgrade, Stage 14B/16B or release is included.

C6 is now [complete on branch](CONSUMER_C6_DELIVERY.md); its delivery record and Version 2 guide distinguish validated branch availability from publication. C7 remains the next sequential slice.
