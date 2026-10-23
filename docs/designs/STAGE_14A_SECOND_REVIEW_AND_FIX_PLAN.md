# Stage 14A — Second review and corrective delivery

- Date: 2026-10-23; branch `version2`, base `cf87b4a`.
- Review request: “do another review pass”; the historical review below made no runtime fixes.
- Corrective authorization: the subsequent user request “fix all” authorizes S1–S3 implementation and validation, preserving compatibility. No later stage or release is authorized.
- Scope: the full pending Stage 14A delivery and its first corrective pass,
  including repair, replay ownership, suspension, task budgets, context/native
  composition, AMOS, public exports and backwards compatibility.
- Review result: **three confirmed findings: two P1 and one P2**. Stage 14A completion was
  reopened at review time; see corrective completion below. Stage 14B/16B, breaking changes and package publication remain deferred.
- Evidence: [eleven asserted observations](../evaluations/STAGE_14A_SECOND_REVIEW.json).

At review time all 60 files matched the first corrective source manifest. That
review-only validation passed **830 focused tests across 19 files**, the built public
TypeScript consumer and **194 ESM/CJS controls**. The probes exercise additional
paths those checks miss. The preceding 8,723-unit / 221-live gate remains historical;
this review does not rerun full units or live providers. No real model call is
needed to establish these deterministic bookkeeping and persistence defects.

## S1 — P1: Structured repair bypasses replay-state origin bookkeeping

Location: `src/core/Agent.ts:3388–3390`, with
`AgentContextNextGen.replaceLastAssistantResponse()` at line 1438.

The normal response path uses `recordAssistantResponse()` to capture the admitted
connector/model/endpoint/principal when provider-bound output appears. Structured
repair instead replaces the last assistant content directly. That replacement can
retain signed thinking or a `provider_state` block without recording its origin or
installing the replay guard. Top-level repair reasoning is dropped by the content
replacement helper, despite remaining in the response returned to the caller.

Public-package reproduction:

1. Create a nonrouting Agent with an injected provider and disabled optional memory.
2. Request JSON; the first response is portable malformed text. The tool-free repair
   returns valid JSON plus persistent signed thinking.
3. The returned JSON parses and saved history contains the signature, but the
   checkpoint has no `providerStateBinding`.
4. A subsequent request hook selects `wrong-owner`. The provider is called with the
   retained signature on that different model instead of failing before dispatch.

The ordinary signed-output control records the origin and blocks the same hook.
A routed repair control also blocks it; a portable-only repair control correctly
allows the legacy override. A Google-style provider-state variant retains unbound
state too. An OpenAI-style top-level reasoning variant returns the opaque item but
omits it from saved history. These are protocol fixtures, not claims that a live
provider necessarily emits malformed native JSON.

Fix plan:

- Route repaired/reformatted output through one protocol-aware replacement/commit
  boundary, preserving ordered provider-owned items and their actual admitted
  origin. Do not append duplicate assistant turns or assign host authority to text.
- Apply origin/guard bookkeeping to retained signed state regardless of routing.
  Preserve portable legacy hooks and optional checkpoint compatibility.
- Cover native and prompt-fallback repair/reformat, persistent thinking,
  provider-state blocks, top-level reasoning, save/load, subsequent run/stream,
  identity drift and zero-dispatch rejection. Retain the parse-only JSON contract.

## S2 — P1: A budget-rejected resume silently loses its original task and route

Location: `src/core/Agent.ts:1794–1798` and execution release.

`_prepareExecution()` clears `_suspendedRoutingOrigin` immediately after restoring
it, before the resumed request is admitted. If admission fails, release clears the
active origin. The next ordinary event retry is treated as fresh work: it selects
again, creates a new task and drops the inherited format.

Public-package reproduction:

1. Suspend on `fast` using an explicitly shared `ModelTask({ limits: { maxCalls: 2 } })`.
   The initial tool call and suspension wrap-up consume both calls.
2. Change the host selector's future choice to `default`.
3. Resume with ordinary event text. It rejects `maxCalls`, with no new provider call.
4. Repeat the same event without options. It succeeds on `main` under a new task ID.
   The selector has run twice, the old task remains at two calls, and the returned
   answer has no inherited `output_parsed`. The wait was registered only once.

Thus an automatic retry of a rejected event obtains a fresh allowance and changes
its owner without an explicit new-task/abandon decision. The rejected-route-override
control preserves the original task, route and format; the gap is after restoration
has succeeded but before model admission succeeds.

Fix plan:

- Preserve or atomically restore suspended ownership and effective options when
  resumption fails before actual dispatch/admission. Do not consume an originating
  task merely by attempting a request that its budget rejects.
- Keep the original allowance/route/format on another event retry. Define intentional
  abandonment through existing explicit host cancellation/lifecycle behavior;
  preserve the observed external registration and never replay it for recovery.
- Cover call/token/cost/deadline rejection, cancellation and preparation/hook
  failures before dispatch, repeated ordinary retries, owned/shared tasks,
  run/stream, explicit overrides and one actual selector decision.
- Preserve deliberate fresh executions after successful completion or explicit
  abandonment. No new required provider/storage API or workflow engine is needed.

## S3 — P2: Suspension is checkpointed and published before JSON finalization

Location: `src/core/Agent.ts:2418–2428`; the outer managed finalization path.

The suspension callback runs before saving only when selective context assembly
produced `lastPreparation.selection`. With ordinary context, session/correlation
saving and `execution:suspended` publication happen before outer formatting/repair.

Public-package observations:

- A malformed wrap-up is repaired to `{"answer":"FORMATTED"}` and `run()` returns
  `status: 'suspended'` with that parsed value. Live history contains `FORMATTED`;
  the actual `FileContextStorage` checkpoint still contains `NOT_JSON` and lacks
  `FORMATTED`. Autosave is disabled, so the stored checkpoint stays stale.
- With a two-call limit, repair cannot dispatch, but a raw checkpoint/correlation
  and one `execution:suspended` event already exist before `run()` throws.
- A Google-style tool/format composition fixture with an already valid JSON
  wrap-up reaches the same publication-before-finalization failure when its required
  prompt-formatting pass cannot be admitted. This case requires no malformed answer.

The registration tool runs once in every case. Saving a checkpoint is not proof
that the response's required structured finalization has completed. A restart can
therefore see different assistant history from the caller, and observers can see
successful suspension publication before a formatting failure.

Fix plan:

- Use the settled suspension finalization boundary for every context mode, while
  retaining the existing single preparation and bounded repair behavior.
- Persist the finalized history before publishing a successfully formatted
  suspension. If finalization fails, durably preserve the already acknowledged wait
  and its recoverable route/task/receipt state with coherent failure diagnostics.
  Do not lose the registration or repeat it to repair checkpoint state.
- Cover native/prompt output, assembly absent/present, valid and malformed answers,
  exhausted repair allowance, cancellation, session/correlation write failures,
  event ordering, restart history and exactly one external registration.

## Corrective order and completion gates

1. Add failing regressions for S1, including signed/state output and portable controls.
2. Fix atomic resume ownership for S2; verify repeated failed resumes cannot obtain
   fresh budgets or silently choose another model.
3. Fix S3's finalization/checkpoint/publication ordering while retaining action proof
   on every failure path. Test composition with S2 rather than masking lost origins.
4. Run focused and full relevant unit/public/AMOS/example gates, then affected real
   provider coverage. Do not count skipped providers as passing or weaken exact
   oracles to close a failure.
5. Update Version 2 availability/adoption/handoff, recipe and standard/generated docs
   where affected. Add this review and corrective evidence to the package inventory
   during corrective delivery, not as an unvalidated release claim.

These fixes should preserve supported APIs/defaults, the existing session version,
custom provider/storage contracts, portable hooks, direct/idle ownership and the
streaming no-repair boundary. Any actual breaking proposal still requires explicit
approval before implementation. No production code, shipped test, example or
package configuration was changed by this review. Temporary probe sessions were
removed; the machine record retains observations and artifact hashes.


## Corrective completion — 2026-10-23

All three findings are corrected and validated. 8,775 units / 385 files, 224 live tests / 13 suites across OpenAI, Anthropic and Google with no required skips, 39 offline modes and 202 public ESM/CJS controls pass.
Build, root/strict/public/example/AMOS types, lint, AMOS build, generated API,
focused coverage, documentation links and package inventory gates pass.
No known required gate fails or is skipped.

- **S1:** Managed repair captures the original assistant response boundary before
  consolidation and replaces its whole ordered output. Signed thinking,
  provider-state, reasoning and compaction retain the actual admitted
  connector/model/endpoint/principal even when routing is absent. Same-text
  reformat still commits new protocol state. Unrelated appended/mutated assistant
  observations reject stale replacement rather than being overwritten. Portable
  legacy model hooks and the public content-only helper keep their contracts.
  Existing journals retain ordered corrections without a required backend method;
  snapshots retain the complete working replay state.
- **S2:** Pending ownership survives preparation/hook/admission failures and repeated
  call/token/cost/deadline rejection, including owned/shared tasks and run/stream.
  Effective resume options remain attached to the same origin. Successful
  completion releases it, including terminal-event stream closure. Existing
  explicit host cancellation abandons task authority without undoing an action
  or removing its observation. No new automatic retry or allowance is introduced.
- **S3:** Every structured managed suspension finalizes before success checkpoint,
  correlation and publication, with or without selected context assembly. A failed
  wrap-up/format attempt checkpoints the already registered wait and correlation
  with optional failed-finalization metadata, then throws. Storage failure never
  emits suspension success; simultaneous finalization/recovery failure retains
  both errors. Recovery never repeats registration. A failed backend still requires
  host repair and cannot promise durability. Session restore does not acquire
  process-local task, policy or authorization authority.

There are 36 new core regression cases and two AMOS runner cases. Three additional
real-provider cases deny formatting after actual wait registration; existing three
suspension cases now corrupt a real wrap-up and verify the repaired checkpoint.
The offline suspension example adds `--failed-finalization`; ESM/CJS consumers
exercise repaired replay binding through the built package. These extend existing
stage examples rather than introducing another execution/storage abstraction.

The final live cost gate found an additional provider bug: explicit Google
`thinking.enabled: false` omitted the wire setting and left dynamic thinking on.
The shared GenerateContent/Vertex converter now sends zero budget for supported
Gemini 2.5 Flash/Flash-Lite and preview aliases. Fourteen converter regressions
preserve absent defaults, enabled configuration, vendor overrides and other models.
The original quality/cost gates remain unchanged; the complete live matrix is rerun.
The controlled-wrap fixture also preserves the original answer and checks removal
of the unformatted body, allowing legitimate strings inside valid repaired JSON.
See [Google's documented opt-out](https://ai.google.dev/gemini-api/docs/generate-content/thinking?hl=en).

Compatibility is behavioral as well as typed: supported signatures, defaults,
provider/storage interfaces, optional session metadata/version, direct/idle model
ownership, portable hooks, parse-only JSON and no-repair streaming remain. No
breaking change is proposed. No new AMOS command/configuration is needed; real
runner adapters exercise repeated rejection and deliberate cancellation.

See [corrective validation](../evaluations/STAGE_14A_SECOND_CORRECTIONS_VALIDATION.json)
and [Version 2 adoption/handoff](../VERSION_2_GUIDE.md#stage-14a-second-corrective-adoption--2026-10-23).
