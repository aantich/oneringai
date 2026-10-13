# Stage 02 review and fix plan

Reviewed: 2026-10-12. Scope: the uncommitted Stage 02 implementation on branch
`version2`, relative to `fa8f911`, including shared execution, Agent run/stream/
background calls, connectors, AMOS, public exports, examples, and documentation.

This records the original review and fix plan. All seven findings are now corrected;
see the completion record below. No production code or permanent tests were changed
during the original review. The earlier [Stage 02 validation](../evaluations/STAGE_02_VALIDATION.json)
remains historical evidence of the checks actually run. The findings below are
deterministic cases those checks do not cover. Some mechanisms predate Stage 02;
their origin is identified rather than attributing every defect to the new code.

**Current completion:** All seven findings and the subsequent OpenAI retrieval
and Anthropic named-tool issues are corrected. Final full validation passes
7,030 unit tests and all 46 distinct three-provider live scenarios; see the final
record below. Earlier pending/failure records are historical.

## Findings

### R1 — P1: queued background results can reach a different account

Locations: [completion guard](../../src/core/Agent.ts#L3475),
[queue insertion](../../src/core/Agent.ts#L3572),
[run delivery](../../src/core/Agent.ts#L1486), and
[manual continuation](../../src/core/Agent.ts#L3638).

The new identity check runs when a background operation settles. The queue then
stores only a `ToolResult`, losing its originating identity/registry scope. Neither
the normal run's queue drain nor continuation checks that scope before injecting
the result into a model request. The unscoped queue predates Stage 02; the new
settlement guard does not complete the stage's cross-account isolation requirement.

**Reproduction:** Start a nonblocking tool under Alice/work with auto-continuation
disabled. Finish it with `ALICE_PRIVATE_QUEUED_VALUE`, wait for it to leave the
pending tracker, and verify that the value is not yet in conversation history.
Rebind the tool context to Bob/personal and run another request. The actual mock
provider input contains Alice's value as an injected async result.

**Compatible fix:** Retain an internal queue envelope with original call/run IDs,
trusted scope, and result. Share a delivery-time check across mid-loop injection,
automatic continuation, and manual draining of the internal queue. Recheck after
reentrant host callbacks. Keep the public `ToolResult` and explicit host-supplied
`continueWithAsyncResults(results)` contract; supplied results are a separate trusted
host input, not evidence of the ownership of an internal queue entry.

**Required coverage:** Change user/account/identities/registry after completion but
before delivery; batching and active-owner delays; manual and automatic drains;
reentrant completion listeners; same-scope later-run delivery; cancellation and
destroy. Assert the actual provider input excludes another scope's result.

### R2 — P1: a captured connector registry still follows the next user's authority

Locations: [shallow context snapshot](../../src/core/ToolManager.ts#L1034) and
[live registry closures](../../src/core/context-nextgen/AgentContextNextGen.ts#L601).

Copying `ToolContext` preserves its `connectorRegistry` reference. That registry's
methods resolve `this._userId`, identities, account bindings, and the base registry
at lookup time. The old reference therefore changes authority when the agent is
rebound. A captured old user ID can coexist with the next user's connector access.
Reference equality in the background guard cannot make such a view immutable.

**Reproduction:** Configure the access policy so Alice can access only
`alice-private` and Bob only `bob-private`. Start a tool as Alice and pause inside
it. Before rebinding, its captured registry denies Bob's connector. Set
`agent.userId = 'bob'` and resume. That same tool still receives `userId: 'alice'`,
but its registry now allows `bob-private` and denies `alice-private`.

The dynamic registry is an existing, intentional facility for host bindings and
custom registries. Stage 02's shallow snapshot leaves this authorization boundary
open; globally freezing the existing registry would also break legitimate use.

**Compatible fix:** Bind an execution's registry access to the trusted principal,
allowed connectors/accounts, and resolved registry scope at admission. Keep the
existing live agent registry behavior for bindings installed before new calls.
Reuse existing scoped-registry facilities where possible; custom registries whose
lookup depends on ambient tenant state must retain the original scope or resolved
connector instances, not merely the same registry object. Preserve not-found
privacy, authentication/configuration error propagation, and optional ID lookup.
Use additive optional hooks if a custom provider needs scope capture; do not make
a new public registry method mandatory without breaking-change approval.

**Required coverage:** User and identity changes while a tool/plugin is awaiting;
late-bound account maps installed before execution; access policy principal capture;
custom ambient-tenant registries and registry replacement; lookup by name/ID;
unavailable versus authentication-error behavior. Verify access inside the original
tool, not only whether its final result is delivered.

### R3 — P1: replacing a registered tool can change the action after approval

Locations: [in-place registration update](../../src/core/ToolManager.ts#L406) and
[deferred implementation lookup](../../src/core/ToolManager.ts#L1097).

`executeWithOutcome()` retains a mutable registration object. Its wrapper reads
`registration.tool.execute` after asynchronous plugin/permission work. Calling
`register()` again for that name updates the same object, so an admitted call can
execute another implementation under the original approval and tracing data.
The new replacement-registration regression covers unregister/reinsert, which
creates a different object; it misses this supported in-place update path.

**Reproduction:** A permission policy permits `safe-read` source and denies
`forbidden-write`. Admit `probe` with the read implementation and hold a plugin
after approval. Register a write implementation under the same name with the
forbidden source, then release the plugin. The policy checked `safe-read` once,
the read function was never called, and the write function executed successfully.

This mutable lookup predates Stage 02. It is a remaining gap in the per-execution
snapshot and replacement-isolation work, with an approval/action mismatch.

**Compatible fix:** Capture the selected implementation and relevant definition/
permission/source metadata for that invocation. Use that selection throughout
permission evaluation and dispatch; later registrations affect future calls.
Keep the existing registration API and document how its cumulative usage counters
are attributed. Do not add another permission pipeline or execute the replacement
silently under a previous approval.

**Required coverage:** Update under the same name during a permission wait and
another plugin wait; changed source/permission metadata; unregister/reinsert;
argument/definition consistency; original correlation and once-only counters;
the replacement being used by a subsequent call.

### R4 — P2: an async observer exception becomes a tool failure and double-counts

Locations: [success notification](../../src/core/Agent.ts#L3501) and
[shared rejection handler](../../src/core/Agent.ts#L3512).

The `.catch()` handles both execution rejection and exceptions thrown by the
success handler. A throwing `async:tool:complete` listener runs after success is
counted but before queue insertion/removal. The catch sees the invocation still
pending, counts a failure too, and queues the observer error as the tool result.
The rejection-chain problem predates Stage 02; the added final-result accounting
now also makes the once-only counter guarantee fail.

**Reproduction:** Complete one background tool successfully, and have its completion
listener throw `UI disconnected`. ToolManager reports one execution/one success/
zero failures. Agent reports one call/one success/one failure. Continuation sends
the UI exception to the provider and loses `EXTERNAL_EFFECT_SUCCEEDED`.

**Compatible fix:** Separate execution settlement from delivery/notification
failures. Finalize the original result and accounting once; contain/log observer
errors without treating them as a second tool rejection. Use the same boundary
for async error/timeout notifications, so a failing observer cannot strand a
tracked call or produce an unhandled rejected notification chain. Preserve event
names and normal payloads.

**Required coverage:** Throwing complete/error/timeout listeners; retained original
body and semantic outcome; counters and queue delivery exactly once; cancellation
or rebinding inside a listener; no automatic retry or unhandled rejection.

### R5 — P2: streaming counts depend on consuming past the completion event

Location: [batch-delayed result accounting](../../src/core/Agent.ts#L2396).

Streaming adds each call to the execution counters immediately, but records results
only after the entire tool batch and its yielded completion events. A consumer
can stop after `TOOL_EXECUTION_DONE`, or `toolFailureMode: 'fail'` can throw first.
The completed operation then has no matching outcome in the Agent counters.
The stream previously omitted these counters entirely; Stage 02's correction is
incomplete on these exit paths.

**Reproductions:**

- Remove the normalizer and use fail mode. A tool throws; ToolManager counts its
  failure, the stream throws, and Agent reports one call/zero failures.
- Keep the normalizer, throw from the tool, and break consumption after its done
  event. That event reports failure, but Agent again reports one call/zero failures.

**Compatible fix:** Record each settled result before yielding its done event or
propagating fail mode. Remove the later duplicate accounting. Keep conversation
protocol-group construction separate so early termination does not append dangling
call/result groups. Do not count a tool that was never actually processed merely
because its provider call was in the same batch.

**Required coverage:** Success/failure/timeout; invalid JSON; fail and continue modes;
early consumer return; cancellation; multiple-call partial batches; exactly-once
counts after a fully consumed stream and valid persisted conversation protocol.

### R6 — P2: safe retry cleanup can ignore cancellation and the operation deadline

Location: [awaited body cancellation](../../src/core/Connector.ts#L775).

The new safe retry path awaits `response.body.cancel()` without racing the operation
signal. Cancellation can be asynchronous: a cancelled branch of a teed response
can wait for the other branch. While this await is pending, neither host abort nor
the operation deadline settles the connector call, despite other waits being
abort-aware.

**Reproduction:** A mock fetch returns one clone of an open 503 response, leaving
the other tee branch open. Use safe GET retries, an operation deadline of 10ms,
and a host signal. After 40ms and host abort, fetch is still unsettled and has
made one attempt. It settles only after the other branch closes and drains.
This reproduces slow response cancellation; it does not claim every native HTTP
body cancellation hangs or that the remote request was prevented.

**Compatible fix:** Make retry-body cleanup observe the operation signal, retaining
a rejection handler for cleanup that settles later. Avoid allowing cleanup to
strand the caller or start another attempt after abort. Keep legacy retry defaults
and the safe method allowlist; add no retries for ambiguous writes.

**Required coverage:** Pending/rejecting body cancellation, cloned/teed bodies,
host abort and operation timeout while cleanup waits, eventual cleanup settlement,
no later dispatch, and timer/listener cleanup.

### R7 — P2: operation response clones lose URL and redirect/type metadata

Location: [operation response wrapper](../../src/core/Connector.ts#L864).

The wrapper shadows `url`, `redirected`, and `type` on a newly constructed Response.
Native `clone()` copies the Response's internal state, not those own properties.
Clones therefore return an empty URL, `redirected: false`, and `type: 'default'`.
The current clone test reads the bodies but checks metadata only on the wrapper.
This is introduced by the new opt-in operation wrapper.

**Reproduction:** Use a real loopback HTTP redirect to a final body. An ordinary
native Response clone keeps the final URL, `redirected: true`, and `type: 'basic'`.
The operation wrapper reports those values too, but its clone loses all three.
Both original and cloned bodies still read successfully.

**Compatible fix:** Preserve metadata on wrapper clones and chained clones while
retaining native teeing, body-used/locked checks, cancellation, and the single
operation deadline. A small wrapper helper is sufficient; a new transport or
Response class hierarchy is unnecessary.

**Required coverage:** Native redirect and plain HTTP responses; first and chained
clones; URL/type/redirect/status/headers; consumed/locked body clone errors; body
deadline and cancellation with multiple branches.

## Fix order and scope

1. Address R1 and R2 first: preserve invocation authority through execution,
   queueing, and actual delivery. Share the scope comparison/delivery path and
   preserve existing late-binding behavior before execution admission.
2. Close R3's approval/action race with an invocation-local selection. Test the
   normal register-update path as well as unregister/reinsert.
3. Address R4's settlement/notification boundary before expanding accounting
   coverage. Then fix R5 so counts are complete before a stream exposes completion.
4. Correct R6's cancellable cleanup and R7's Response clone behavior locally in
   the connector implementation.
5. Add permanent regressions for the observed failures plus the boundaries above;
   run focused tests, full units, build/types/lint/examples, built-package consumer
   compatibility, and relevant AMOS checks. Re-run affected real-provider cases
   after fixes; unavailable credentials remain explicit, never passing skips.
6. Update the recipe, Version 2 adoption/handoff, stage completion/correction record,
   and validation evidence to describe the corrected guarantees and limitations.
   Regenerate API documentation only if public declarations change.

The architecture and stage scope remain appropriate. Reuse the shared manager,
existing queue/lifecycle, and registry facilities. These fixes do not need a new
scheduler, outcome store, permission engine, retry framework, or changes to later
stage ordering. No breaking API change is proposed. If a fix would require a
mandatory extension-contract change, stop that affected work and request explicit
approval under the existing compatibility rule.

The P1 findings should block Stage 02 approval and progression to Stage 06. The
remaining findings should be included in the same corrective pass.

## Validation during this review

- **8 existing files / 201 tests passed**, covering Stage 02, original pipeline/
  ToolManager/Connector behavior, background tools, and AMOS.
- **10 temporary probes** confirmed the seven findings, including two streaming
  exits and a native loopback redirect comparison. Their assertions deliberately
  describe the observed defects; passing probes are not passing regressions for
  the intended contract. Combined run: **9 files / 211 tests passed**.
- Source typecheck and original/additive built-package consumer compatibility
  passed. The consumer check used the existing Stage 02 build.
- All source/test/example fingerprints in the implementation validation record
  still match. Production code, permanent tests, generated files, and original
  validation evidence were not changed during this review.
- No full rebuild, full unit suite, or billable LLM calls were repeated. The
  implementation's earlier full-suite/live results remain historical evidence;
  Anthropic is still recorded as unvalidated because of the rejected credential.
- Reproduction source/logs are retained in the local temporary directory.
  Findings, measured behavior, and required permanent coverage are recorded here.

The original review is complete. Its observations above describe the pre-fix state.

## Corrective implementation — 2026-10-12; validation incomplete

User authorization: “fix all issues.” R1–R7 are implemented in the existing working
branch. No breaking change, new permission engine, scheduler, or later-stage work.

| Finding | Delivered correction | Permanent regression evidence |
| --- | --- | --- |
| R1 | Internal scope envelopes and shared delivery checks, including reentrant listeners, ambient registry changes, batches and owner delays. Explicit host results remain trusted. | `Stage02Corrections.test.ts`: manual/automatic/mid-loop delivery, rebinding, batching, cancellation, destroy and explicit host input. |
| R2 | Admission-time accessible connector resolution; later admissions remain live. Name/ID lookup, principal and account snapshots, error propagation, no mandatory registry hook. | `ConnectorScope.test.ts` and `Stage02Corrections.test.ts`: actual tool access after rebinding, custom ambient registry, late bindings, IDs and errors. |
| R3 | Selected implementation/definition/permission metadata captured once and used throughout admission and dispatch. | `Stage02Corrections.test.ts`: in-place update during approval/plugin waits, denied future action, original arguments/IDs/counters; existing unregister/reinsert regression retained. |
| R4 | Separate rejection and fulfillment handlers, contained notifications, original settlement counted/queued once. | `Stage02Corrections.test.ts`: throwing complete/error/timeout observers, retained successful body, original errors and reentrant cancellation/rebinding. |
| R5 | Per-result accounting before yields/throws; conversation groups remain batch-atomic. | `Stage02Corrections.test.ts`: fail/continue, early return, success/failure/timeout/invalid JSON, partial multi-call batches and no partial history groups. |
| R6 | Abort-aware safe-retry cleanup, with late rejection observed and no redispatch after abort. The same deadline is retained while operation-body cancellation waits on an upstream tee. | `ConnectorCancellation.test.ts` and `Stage02Corrections.test.ts`: pending/rejecting cleanup, host/deadline abort, native tee, eventual cleanup and timer disposal. |
| R7 | Small metadata decorator on original and chained native clones; single shared body/deadline. | `ConnectorCancellation.test.ts` and `Stage02Corrections.test.ts`: native redirect, chained metadata, body-used/locked errors, host/deadline read failures and branch cancellation. |

**Validation:** 332 files / 7,010 unit tests pass, with 53 additional corrective
cases. Build, source/strict/examples/AMOS types, lint, original/additive built consumers,
generated API, package inventory and offline demonstrations pass. Scoped coverage is
83.45% lines / 90.48% branches / 83.33% functions (Agent/large AMOS adapter outside
the denominator; their changed paths have mock integration coverage).

**Live qualifications:** 30 unique OpenAI/Google scenarios pass. One prior-stage
OpenAI separate-spill retrieval scenario failed twice unchanged, returning keys/index
descriptions instead of source markers. Anthropic run and stream return 401 with the
current key. These failures are retained and are not passing skips. See
[corrective validation](../evaluations/STAGE_02_CORRECTIONS_VALIDATION.json) for attempts,
source fingerprints, scope and limitations. All seven reproduced findings have passing
regressions; an all-provider/all-scenario passing result is not claimed.

The Version 2 Guide, recipe, standard documentation, generated API, examples,
AMOS documentation and Changelog are synced. Existing AMOS UI remains appropriate;
its adapter/build/offline checks pass. Stage 06 still requires separate authorization.

## OpenAI retrieval diagnosis — 2026-10-12

**Status at diagnosis:** The seven review fixes are implemented, but the stage's full
validation gate has not passed. The unresolved functional live failure cannot be
treated as a harmless qualification or a passing rerun. This corrects the earlier
completion wording. Anthropic validation remains authentication-blocked.

The source is a misleading model-facing retrieval contract. In `store-tools.ts`,
the static/dynamic `store_get` descriptions and `key` description advertise getting
all entries when `key` is omitted; the overview repeats that claim. However,
`WorkingMemoryPluginNextGen.storeGet(undefined)` returns only the notes index
(keys, descriptions, tiers), never the stored source values.

Captured requests immediately before the OpenAI SDK dispatch show the failure:

1. Both source values survive separate spills and JSON state restoration. Host
   control reads through the same ToolManager recover both original markers.
   Their results are not injected into the conversation.
2. The actual provider request contains both index keys and the retrieval tools.
3. OpenAI calls `store_get({ store: "notes" })` without a key. The handler correctly
   returns metadata, and Stage 02 correctly classifies that execution as successful.
4. The next model response reports index keys as verification markers. Neither
   source's full content was read. The loop accepts the final answer because it
   does not enforce task-specific source-retrieval completion evidence.

Five original-description diagnostic trials produced two passes and three
failures; all three failures followed this exact keyless path. Adding only accurate
`store_get`/`key` descriptions, through a diagnostic hook, passed five of five
trials with both keyed reads, both markers and nonnegative budgets. An independent
instruction clarification passed three of three. An initial exploratory original
trial also passed. These are small functional samples, not a reliability estimate.
The exact unmodified live test was then rerun and **still failed**. The four
affected offline test files pass **126 tests**; no production fix or test weakening
was applied during diagnosis.

There is a second confirmed prompt defect: the memory index footer recommends
`memory_query`, `memory_retrieve`, and `memory_persist`, although this integration
exposes the unified `store_*` tools. The stale instructions reach the actual
provider request. No unsupported-tool call occurred in the captured failures, so
their additional causal impact is unmeasured.

`git blame` traces the contradictory description and keyless behavior to
`6730ca3b` (2026-03-14), before stages 01/02. This establishes the source's age;
it does not excuse the current failing validation gate.

**Recommended narrow correction:** Make the generic retrieval guidance truthful
about store-specific keyless behavior, explicitly explain keyed reads for notes,
and replace stale index tool guidance in this integration. Preserve optional key,
return shapes, tool names/defaults, and saved formats. Add regression coverage for
the model-visible contract and keyed/keyless retrieval after spill/restore, then
rerun the original live assertions and affected compatibility/budget checks.
Forcing tool use or merely loosening the test would conceal the defect.

The [diagnostic evidence](../evaluations/STAGE_02_OPENAI_RETRIEVAL_DIAGNOSIS.json)
retains the converted failing request/tool result, per-trial retrieval paths,
interventions, exact unmodified test failure, source fingerprints and limitations.
Historical validation reports remain unchanged.

## OpenAI retrieval correction and validation — 2026-10-12

User authorization: “fix it.” The diagnosed retrieval defect is corrected and
validated. Stage-wide Anthropic validation remains authentication-blocked; this
record does not declare all providers validated or the overall stage complete.

- Generic `store_get` static/dynamic descriptions, its key parameter and the
  store overview now explain that a keyless view is store-specific and may be
  metadata only. Dynamic descriptions reuse each handler's existing schema
  description, including the notes store's explicit keyed-read contract.
- Notes instructions and both index-rendering paths use
  `store_get({ store: "notes", key: "<exact index key>" })`. Omitted entries point
  to `store_list`. The shared formatter accepts an optional internal store ID;
  omitting it preserves the older WorkingMemory formatter's exact legacy guidance.
- No tool names, required arguments, raw return shapes, defaults, saved formats,
  keyless behavior, or permission/loop behavior changed. Custom keyless stores
  may still return values. No forced tool choice, model replacement, retry policy
  or weakened live assertion was introduced.
- Six new offline regressions cover real collision spill/JSON restore and the
  converted OpenAI request, metadata/keyed/missing-key results, truncated indexes,
  legacy formatting, dynamic custom handlers and disabled notes guidance.
  Live failure reports now retain retrieval arguments/counts and model-call counts.
- The public offline example demonstrates keyless metadata versus keyed source
  recovery, using the same shared ToolManager. Existing AMOS views need no new
  controls for this prompt correction; its adapter unit tests, typecheck and
  offline context example pass. The library supplies the corrected notes guidance
  to AMOS automatically.

**Final checks:** **333 files / 7,016 unit tests pass**, including six new retrieval
regressions. Build/24 package exports, source/strict-test/examples/AMOS types, lint,
original/additive public-consumer compatibility, generated public API, offline
baseline/context/budget/AMOS examples and package inventory pass. Historical
coverage percentages above were not recomputed or claimed for this correction.

**Live:** All six production trials of the original OpenAI collision scenario
pass: the initial check, four independent repetitions and the full context-suite
check. Every trial reads both exact original keys, recovers both markers and
satisfies the original budget assertion. The user prompt, seed data, limits and
success assertions are unchanged. The broader checks pass **31 distinct
OpenAI/Google scenarios**: 16 Stage 00 workload/splits, 11 Stage 01 context
scenarios and four Stage 02 modes. Repeated collision checks are not counted as
additional distinct scenarios. Both Anthropic Stage 02 modes were retried and
still fail before behavioral validation with **401 `invalid x-api-key`**.
Filtered Anthropic context/baseline cases are not counted as passes. Functional
samples do not establish a model reliability rate.

The first full unit attempt overlapped a dist-cleaning build and could not import
the package in three AMOS files; after build completion, the complete suite passed.
A strict-test compilation issue in the new test was corrected before the final
checks. Neither earlier attempt is counted as a passing validation run.

[Final retrieval-fix evidence](../evaluations/STAGE_02_RETRIEVAL_FIX_VALIDATION.json)
records the final checks, live attempts, remaining auth blocker and source
fingerprints. Diagnosis/original validation artifacts remain historical evidence.

## Anthropic key revalidation — 2026-10-12

User authorization: “ok i changed the key, run tests again.” Direct authentication
with `ANTHROPIC_API_KEY` read from `.env` succeeds with HTTP 200. There is no
inherited override. The unchanged Stage 00–02 Anthropic live suites pass **10/11
test cases** (14 passing scenarios, one failed scenario): eight baseline
workload/splits, five context scenarios and the Stage 02 stream mode pass.
Twenty-three other-provider cases are filtered, not counted as passes.

The remaining Stage 02 run failure is exact:

```text
AssertionError: expected [ 'failed', 'succeeded' ] to deeply equal [ 'succeeded', 'failed' ]
```

A separate diagnostic captures correct outcome classification by tool name:
`failure_probe` fails and `domain_probe` succeeds despite its domain payload's
`success: false`. However, the dispatched named choice `domain_probe` returns
`failure_probe`; the next forced failure probe executes it again. This diagnostic
uses four model calls and three tool executions, so merely sorting the assertion
would not address repeated execution or the test's call-count requirements.

A direct `POST https://api.anthropic.com/v1/messages`, bypassing OneRingAI and the
SDK, also sends `tool_choice: { type: "tool", name: "domain_probe" }` but receives
`failure_probe` with HTTP 200, request ID `req_011Cfxk4wHTuSyasgnsGko8c`.
This establishes a provider-response selection discrepancy independent of the
library; it does not establish its underlying service cause or a safe fallback.

**Current status:** Authentication resolved; Stage 02 validation still incomplete
because the named-tool case fails. No source/test changes, assertion weakening,
retry-until-pass or additional stage implementation. Previous local and
OpenAI/Google validation is retained, and all recorded source/test/example
fingerprints match; those checks were not rerun after the credential-only change.
The [new evidence](../evaluations/STAGE_02_ANTHROPIC_REVALIDATION.json) preserves
the initial batch, managed diagnostic and direct API request/response. Earlier
authentication failures and validation artifacts remain historical evidence.

## Final correction and validation — 2026-10-12

User authorization: “so fix everythinig properly!” The production correction
narrows explicit Anthropic local-function choices to the selected definition,
preserving native tools, replay messages, metadata and caller-owned definitions.
Responses are checked against the dispatched name in both generate/stream paths.
A mismatch raises the existing `ProviderError` before a local call can execute,
and cleanup still aborts/closes the underlying stream. No retry, renaming or
model substitution hides a discrepancy. Default auto/required choice remains.

The live fixture previously returned request modifications that streaming does
not apply. It now uses the supported in-place `context.options` contract in both
modes and requests a single call explicitly. No library hook semantics changed.
The original marker, outcome-order, call-count and metric assertions remain;
tool/status correlation is additionally asserted. A separate live run using the
original failing configuration passes with exactly three model calls, one
successful domain probe, one failed failure probe, and both markers.

Fourteen new regressions cover request narrowing/metadata/immutability, default
and required behavior, native tools and prior-tool replay, unknown choices,
on-demand compaction, real Agent-to-provider execution in both modes, rejection
before execution, cleanup/no retry, reuse after failure, and a streamed batch
whose later mismatch must prevent even its earlier valid local call.

**Final gates:** Build and 24 exports, typecheck, strict test compilation, lint,
examples/AMOS types, original/additive public consumers, generated API, all
**334 files / 7,030 unit tests**, and the complete live suites pass. Live coverage
is **34 test cases / 46 distinct scenarios** across OpenAI, Anthropic and Google:
24 baseline workload/splits, 16 context scenarios and six outcome modes. Both
final suites have zero failures and skips; repetitions and additional diagnostic
calls are not counted as new distinct scenarios. The offline demonstrations and
opt-in public Anthropic example pass. Historical scoped coverage remains historical.

No public signatures, default choice, raw results, event shapes, legacy hook
semantics or saved formats changed. No breaking API change was needed. The new
guard corrects a provider violation of an explicitly requested named choice; it
does not create an effect ledger, universal deduplication or a provider-hosted
side-effect guarantee. The recipe documents boundaries and cleanup. AMOS needs
no additional UI; its existing provider-error rendering and adapters are verified.

**Status:** Stage 02 is complete on branch, with no package publication claimed.
The [final validation](../evaluations/STAGE_02_FINAL_VALIDATION.json) contains
current checks, exact reports and source fingerprints. Previous failures are
retained, rather than overwritten or counted as passes. Stage 06 remains separately
authorized work.
