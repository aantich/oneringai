# Stage 06 review and fix plan

Reviewed 2026-10-13 on `version2`, against committed Stage 02 base `dcc8dad`.
Scope includes the uncommitted Stage 06 invocation/task layer, provider adapters,
Agent lifecycle, AMOS, exports, examples, tests and documentation.

**Current status:** All eight findings (two P1, six P2) are fixed and validated in
the `version2` working tree. See the correction record below and
[corrective evidence](../evaluations/STAGE_06_CORRECTIONS_VALIDATION.json).
The findings and reproductions below describe the original review snapshot,
when all 101 focused cases passed despite these gaps. No production code or tests
were changed during that review. The subsequent authorized fixes preserve public
defaults, provider response/event shapes and saved formats; no API break was needed.

**Subsequent review:** The [second review](STAGE_06_SECOND_REVIEW.md) reproduces four
further gaps after this corrective pass. All four are now fixed and validated in
its [completion record](STAGE_06_SECOND_REVIEW.md#correction-completion--2026-10-13);
the first correction record below remains historical evidence for its own scope.

## Findings

### R1 P1 Raw vendor tools bypass cost admission

Locations: [cost admission](../../src/core/model-execution/ModelExecutor.ts#L45)
and [OpenAI vendor options](../../src/infrastructure/providers/openai/OpenAITextProvider.ts#L601).

The new hard-cost guard checks only `options.native_tools`. OpenAI also accepts
raw `vendorOptions.tools`, which the provider spreads into its wire request when
ordinary `tools` is absent. Consequently the same native tool rejected through
the typed API is admitted through the raw API. This bypasses the stage's explicit
native-service-fee restriction. Raw vendor options predate Stage 06; the new
admission policy does not account for their effective request.

**Reproduction:** Configure `maxCostUSD: 1` and call `runDirect()` with
`vendorOptions: { tools: [{ type: 'web_search_preview' }] }`. With the actual OpenAI
SDK and mocked HTTP, the call succeeds and the captured request contains the native
tool. The matching typed `nativeTools` path rejects before dispatch.

**Compatible fix:** Validate the effective provider request for cost-affecting
options, or conservatively reject relevant raw overrides under the new hard-cost
mode. Cover alternate native-tool and service-tier spellings supported by each
adapter. Preserve unrestricted legacy behavior when the new ceiling is omitted.
This is a model-token budget, not an invoice guarantee; that distinction must
remain explicit even after closing the bypass.

**Required coverage:** Typed/raw equivalence, aliases and nested options, run and
stream, main/direct calls, no dispatch on rejected admission, and unchanged
unbounded raw-option compatibility.

### R2 P1 Google thinking usage is discarded or underpriced

Locations: [usage validation](../../src/core/model-execution/ModelTask.ts#L33),
[cost calculation](../../src/core/model-execution/ModelTask.ts#L55),
[Google response usage](../../src/infrastructure/providers/google/GoogleConverter.ts#L480),
and [Google stream usage](../../src/infrastructure/providers/google/GoogleStreamConverter.ts#L160).

The task layer assumes reasoning tokens are already included in `output_tokens`.
The existing Google adapters populate that field from `candidatesTokenCount` and
report `thoughtsTokenCount` separately. When thinking exceeds visible output,
`copyUsage()` rejects valid reported usage as malformed and retains a full-window
reservation. When thinking is smaller, validation succeeds but cost settlement
omits thinking tokens. Thus enabling task accounting on a thinking Google model
can exhaust budgets unnecessarily or refund too much monetary capacity. The
Google normalization convention predates Stage 06; the new shared ledger assumes
a different convention without adapting it.

**Reproduction:** Use the actual Google SDK with mocked HTTP. Input 10, visible
output 5, thinking 20, total 35 becomes entirely unknown in the task ledger and
keeps 1,048,704 reserved tokens. Input 10, visible output 50, thinking 20, total 80
is accepted, but reports model cost `0.000128` instead of `0.000178` using the
current repository registry and 70 inclusive output tokens. These are fixture
calculations, not assertions about a current provider invoice.

**Compatible fix:** Normalize provider-specific usage into one inclusive accounting
convention before task validation/cost settlement. Preserve legacy public response
and stream fields unless a separate compatibility decision approves changing them.
Avoid adding reasoning twice for providers whose output count already includes it.

**Required coverage:** Google generate/stream and Vertex reuse, thinking above and
below visible output, output/cost ceilings, actual SDK fixtures, and OpenAI/Anthropic
reasoning-subset regressions. Add a bounded live thinking-enabled Stage 06 check;
the delivered Google Stage 06 live cases deliberately disable thinking.

### R3 P2 The shared schema compiler breaks reuse and retains every clone

Locations: [global Ajv instance](../../src/core/model-execution/ModelExecutor.ts#L17)
and [schema cloning and compilation](../../src/core/model-execution/ModelExecutor.ts#L108).

Each helper invocation clones its schema and compiles it with one module-global
Ajv instance. Ajv caches by object identity and registers schema IDs globally.
The second invocation with the same valid `$id` fails before model dispatch,
including when it uses the same caller schema object. Schemas without IDs create
a new strongly retained cache entry on every invocation. A long-lived process
therefore accumulates validators across agents, even for one repeatedly used schema.

**Reproduction:** Invoke the same helper twice with a valid object schema whose
`$id` is `urn:oneringai:review:reused`. The first succeeds; the second raises
`Invalid helper JSON schema: schema with key or id ... already exists`. Five calls
with one ID-free schema grow the compiler cache through sizes 2, 3, 4, 5 and 6.

**Compatible fix:** Give compilation an isolated lifetime or a bounded cache keyed
by schema content, with deliberate ID/reference isolation. Avoid introducing a
new global schema registry. Preserve legitimate local refs, formats and strict
schema rejection, without cross-agent collisions or retention after disposal.

**Required coverage:** Repeated same-object/cloned schemas with IDs, different
agents using the same ID, different content under the same ID, local refs, formats,
bounded repeated compilation and cleanup.

### R4 P2 A stream error loses usage already observed

Locations: [stream usage capture and error path](../../src/core/model-execution/ModelTask.ts#L269)
and [failed operation settlement](../../src/core/model-execution/ModelTask.ts#L225).

`iterate()` retains final usage locally, but on a later iterator error it rejects
the completion promise. `execute()` then calls `settle()` without that value.
Previously observed usage disappears from the ledger and a known 15-token charge
becomes unknown with the original 100-token reservation retained. Execution failure
and usage availability are separate facts and should remain separate.

**Reproduction:** Yield final usage `{ input_tokens: 10, output_tokens: 5,
total_tokens: 15 }`, then throw on the next iterator pull. The caller receives the
error, but the ledger reports zero known tokens and one unknown-usage invocation.

**Compatible fix:** Retain the latest validated usage independently of successful
iterator completion. On failure/cancellation, settle that observed usage once while
retaining the failed/cancelled status and unknown reservations for other attempts.

**Required coverage:** Error/cancellation after final usage, consumer exit at the
completion event, errors before any usage, duplicate terminal reports, physical
retry uncertainty and late settlement on the original task.

### R5 P2 Mutable direct options can destroy a caller owned task

Locations: [direct cleanup](../../src/core/BaseAgent.ts#L1130)
and [direct stream cleanup](../../src/core/BaseAgent.ts#L1194).

Direct calls capture the task at entry but determine ownership in `finally` by
comparing it with the current `options.modelTask`. If the host reuses or changes
that options object while the call is pending, cleanup destroys the original
caller-owned shared task. Other calls sharing it can then be cancelled unexpectedly.

**Reproduction:** Start a delayed direct call with `options.modelTask = shared`.
Change the same options object to another task before resolving the provider.
The call completes, but `shared.signal.aborted` becomes true with reason
`Model task destroyed`; the replacement remains active.

**Compatible fix:** Capture ownership at admission, just as the helper path already
does. Cleanup must use that immutable decision and retain host ownership of supplied
tasks regardless of later options mutation.

**Required coverage:** Run/stream direct calls, success/error/cancellation, mutation
to another task or `undefined`, and another concurrent call using the original task.

### R6 P2 A completed main call cancels an independent helper

Locations: [helper task selection](../../src/core/BaseAgent.ts#L1252)
and [main task disposal](../../src/core/BaseAgent.ts#L1208).

A host-initiated helper without an explicit task silently borrows the agent-wide
active main task. If the main call finishes first, it destroys that owned task and
cancels the helper. No host cancellation or exhausted budget is needed. This
contradicts the documented separate owned task for a standalone helper and makes
concurrent host calls depend on completion timing.

**Reproduction:** Start a delayed `agent.run()`, then independently invoke a delayed
extractor without `modelTask`. Resolve the main model successfully. The main run
completes; the helper rejects with `Model task destroyed` before its response arrives.

**Compatible fix:** Give standalone calls their own task unless the host explicitly
supplies a shared task. If implicit nesting is retained, bind it to a real parent
invocation and ensure that parent owns and awaits its children. Reuse the explicit
task already passed by rollover; avoid another scheduling framework.

**Required coverage:** Main/helper completion in both orders, standalone helpers,
explicitly shared host tasks, awaited hook helpers, rollover, cancellation, destroy
and late-result isolation.

### R7 P2 External reports invent successful zero usage

Locations: [usage presence flag](../../src/core/Agent.ts#L1008),
[final report construction](../../src/core/Agent.ts#L1090),
and [external status](../../src/core/model-execution/ModelTask.ts#L297).

`recordExternalUsage()` marks usage present even for metadata-only input. Completion
then copies the legacy response's zero-filled counters into the ledger as known
usage. In addition, `recordExternal()` always labels the invocation `succeeded`,
even when `completeExternalExecution()` explicitly reports failure or cancellation.
The observation boundary loses both usage presence and the known source outcome.

**Reproduction:** Begin an external execution for the registered Haiku model, report
only `{ service_tier: 'standard' }`, and complete with `status: 'failed'`. The Agent
response correctly says failed; the task says succeeded, known zero tokens, known
zero model cost and no unknown usage/charge. No token counts were reported.

**Compatible fix:** Track actual count availability separately from metadata and
legacy response defaults. Carry the final external outcome into the diagnostic
record through an optional additive field or internal adapter. Keep explicit complete
zero-usage reports valid, usage deduplication intact and external admission host-owned.

**Required coverage:** Absent/empty/metadata-only/partial/full usage, explicit zeros,
incremental counts plus final snapshots, failed/cancelled outcomes, mixed pricing,
late observation and repeated/conflicting reports.

### R8 P2 Supported Anthropic extended thinking is rejected

Location: [helper thinking gate](../../src/core/model-execution/ModelExecutor.ts#L103).

The helper gate requires `features.reasoning`, overlooking the registry's separate
`extendedThinking` capability. Haiku 4.5 and Sonnet 4.5 are active and advertise
extended thinking while `reasoning` is false. Their existing Anthropic converter
accepts a valid explicit thinking budget, but the new helper path rejects the same
supported configuration before packet construction.

**Reproduction:** For `claude-haiku-4-5-20251001`, configure output 4,096 and
`thinking: { enabled: true, budgetTokens: 2048 }`. The normal converter produces
`{ type: 'enabled', budget_tokens: 2048 }`; `invokeHelper()` rejects capability
`reasoning`. This does not involve an invalid default 512-token thinking budget.

**Compatible fix:** Interpret the registry's existing reasoning/extended-thinking
capabilities correctly and validate the selected provider's thinking mode/budget
against the output cap before calling the packet builder. Keep unsupported effort
and provider-specific combinations rejected.

**Required coverage:** Valid legacy Anthropic budget thinking, adaptive thinking,
unsupported effort/mode, invalid budget/output combinations and no packet build or
wire dispatch for invalid configurations.

## Fix order and validation

1. Correct budget admission and provider usage normalization first, R1 and R2.
2. Isolate/bound schema compilation and accept supported thinking, R3 and R8.
3. Correct stream settlement and task ownership, R4 through R6.
4. Preserve external usage presence/outcomes, R7.
5. Add the missing regressions, update support/default/failure documentation and
   regenerate the public API if optional signatures change. Revalidate the original
   compatibility consumers, examples and AMOS commands.
6. Build before full tests that import the built package. Run full unit, type/lint,
   examples/AMOS checks and the relevant Stage 00–02/06 live suites, including an
   actual thinking-enabled Google accounting case. Preserve earlier failures and
   provider limits in the corrective validation record.

These fixes can use the existing connector/provider factories, task boundary and
Ajv dependency. A new router, plugin framework or scheduler is unnecessary. Main
model selection, the shared ToolManager, legacy public usage/events and saved-state
loading should remain compatible. A concrete breaking change would still require
the user's explicit approval before implementation.

## Review evidence

[Recorded reproductions](../evaluations/STAGE_06_REVIEW.json) contain deterministic
observed outputs, source fingerprints and the fresh focused-suite result. SDK
cases use actual installed clients with mocked HTTP; other cases use controlled
providers/iterators. No real credentials or billable requests were needed to
establish these defects. The focused 101-test suite passed during the review; its
missing cases must become permanent regressions in the fix stage. The prior
[Stage 06 validation](../evaluations/STAGE_06_VALIDATION.json), including historical
Google answer failures, remains unchanged.

## Correction completion — 2026-10-13

User authorized all fixes with “fix all”. The scope remains Stage 06, based on
`dcc8dad`; no new stage, routing framework or distributed budget was added.

| Finding | Delivered correction and permanent regression evidence |
| --- | --- |
| R1 | Cost admission checks typed native tools and raw supported vendor-option containers/aliases, including nested Google options. Pricing overrides require host upper rates. Actual SDK mocked HTTP covers all four managed/direct run/stream surfaces, rejected dispatch, nested aliases and unrestricted raw compatibility. |
| R2 | Google GenerateContent/Vertex usage is marked internally and normalized only for accounting and helper output checks. Visible output plus thinking is charged once; public usage remains unchanged. SDK generate/stream fixtures cover thinking above/below visible output, costs/refunds, Interactions inclusive counters and helper output ceilings. Live Google run/stream checks verify known inclusive counts; existing cache/reasoning subset tests protect other providers. |
| R3 | Each invocation owns one Ajv compiler for generation/repair. Repeated/cloned IDs across agents, a changed schema with the same ID, local references, format rejection and isolation from previous-call schemas are tested. There is no retained global schema registry. |
| R4 | Captured terminal usage survives iterator failure, cancellation and consumer exit. Outcomes remain failed/cancelled, retry uncertainty stays reserved, identical reports count once, conflicting reports fail, and reordered metadata is treated as the same report. |
| R5 | Both direct entry points capture ownership before asynchronous work. Tests mutate or remove options during success/failure/cancellation, then reuse the surviving caller-owned task. |
| R6 | Standalone helpers own independent tasks/signals unless explicitly shared. Tests cover either main/helper completion order and an awaited hook with explicit sharing. Existing rollover, cancel, destroy and late-isolation tests remain green. |
| R7 | External core-count availability is separate from response defaults and pricing metadata. Absent/empty/metadata/partial reports stay unknown; explicit zeros and split incremental input/output remain valid. Final fields override accumulated counterparts. Optional external `status` preserves failure/cancellation without changing default usage-only callers. Replay, mixed pricing, late diagnostics and bounded-admission regressions pass. |
| R8 | Helper capability checks accept reasoning or extended thinking. The existing Anthropic converter validates effective modes/budgets before packet construction. Valid Haiku/Sonnet fixed budgets and invalid modes/budgets are covered; a real Anthropic extended-thinking helper passes. |

Final local validation passes **7,179 tests in 339 files**, including **149 Stage 06
cases** (**48 corrective regressions** beyond the original 101). Scoped runtime
coverage is **98.14% lines / 88.34% branches** for `ModelExecutor` and `ModelTask`;
this is not repository-wide coverage. Build/24 package exports, source and strict
test types, lint, old/additive built-package consumers, examples/AMOS types and
build, generated public API/1,640 items, nine offline examples and the live
OpenAI stronger-main/smaller-helper example pass. Package and artifact checks
are recorded in the linked corrective evidence.

Final live suites pass **45 cases / 57 distinct scenarios** across OpenAI,
Anthropic and Google: 34 Stage 00–02 cases/46 scenarios plus 11 Stage 06 cases.
There are no failures or skips in those final runs. The first new Google thinking
fixtures failed their exact numeral-only output assertion because the model
returned prose. Their ledgers already showed known thinking usage. The fixtures
now explicitly request native JSON and validate the exact `{ answer: "23" }`
result plus accounting; the unchanged original eight Stage 06 gates still pass.
Both first failed attempts and final passing observations are retained. The final
metadata-order normalization has an offline regression and full-suite validation;
the live samples contain no native-tool count maps and do not exercise that ordering.

The recipe, Version 2 adoption/handoff, standard usage docs, generated API,
examples, AMOS support notes, Changelog and package inventory are synchronized.
Earlier validation/review evidence is unchanged. AMOS needs no new command for
these fixes: its existing helper/usage adapter, command tests and offline walkthrough
exercise the corrected shared runtime. Availability remains branch-only; no
package release, reliability rate, comparative savings or quality claim is made.
Stage 03 remains the next separately authorized stage.
