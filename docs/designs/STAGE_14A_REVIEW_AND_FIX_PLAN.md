# Stage 14A — Review and fix plan

- Date: 2026-10-22; branch `version2`, base `cf87b4a`.
- Request: “do a review pass”. The review reported findings; the subsequent “fix all” instruction authorized the corrections below.
- Scope: the complete pending Stage 14A delivery, including routing, context/native
  integration, structured output, lifecycle, budgets, AMOS, public exports and docs.
- Result: **three confirmed findings: two P1, one P2**. All three are now corrected; see the corrective completion below. Stage 14B and breaking changes remain unauthorized.
- Evidence: [executable review record](../evaluations/STAGE_14A_REVIEW.json).

## Historical review observations

At review time, the implementation matched all 44 files in its delivery manifest.
Fresh focused checks passed **275 tests across eight files**, with no skipped cases;
the built public TypeScript compatibility consumer also passes. These tests miss
the counterexamples below. They do not close the findings. The earlier 8,688-unit /
216-live delivery evidence remains historical. No new live LLM calls were required
to establish these deterministic dispatch/lifecycle defects.

## R1 — P1: Opaque replay loses its final guard when routing is absent

Location: `src/core/Agent.ts:1062–1064`; final managed dispatch and tracked-call guards.

`prepareRouting()` checks a restored `providerStateBinding` once, then returns
without installing a binding when the new Agent has no routing policy. A later
public `llm:request` or `before:llm` hook can replace the model. The managed request
then dispatches opaque state from the saved owner to the different model. The
equivalent operation with routing enabled is correctly rejected.

Reproduction through the built public package:

1. A routed `main` Agent selects `fast` and receives encrypted reasoning.
2. Save the context; create an Agent configured with the same connector and `fast`,
   omit routing, and restore that valid checkpoint.
3. A request listener changes `options.model` to `different-model`.
4. `run()` succeeds in the fixture and dispatches `OPAQUE_FAST_STATE` to that model.
   A routing-enabled control rejects before provider generation.

This bypasses the promised exact-owner replay guard when an application turns
routing off after restoring a routed checkpoint. It can issue incompatible provider
protocol requests; source ownership must not depend on policy being enabled.

Fix plan:

- Retain final replay/identity/scope checks whenever a managed context has bound
  provider state, independently of configured routing and optional diagnostics.
- Validate the actual post-hook request at every supported dispatch boundary,
  including tracked/native retries and budget observers.
- Preserve legacy hook flexibility for portable history and direct-call ownership;
  do not turn this into a blanket ban on nonrouted model overrides.
- Cover run/stream, policy omitted/opted out, matching-owner success, hook model
  replacement, scope/endpoint drift, saved checkpoints and zero-dispatch failures.

## R2 — P1: Suspended structured runs bypass output and completion checks

Locations: `src/core/Agent.ts:1745–1749`, `2038–2057`, `2281–2282`.

Resuming a suspended routed execution restores the originating `RunOptions` into
`_runOptions`. The inner loop consequently sees the old `responseFormat` and
defers its completion check to the outer structured-output path. `run()` instead
looks at the new caller's `options.responseFormat`. A normal `run(eventText)`
resumption has no new format option, so neither JSON finalization/repair nor the
host completion predicate runs.

Reproduction: start a routed JSON run, execute a `SuspendSignal` tool and return
a valid structured suspension. Resume with ordinary event text. The fixture sends
`NOT_JSON`; the Agent returns `status: 'completed'`, `output_text: 'NOT_JSON'`, no
`output_parsed`, and only three provider calls rather than a bounded repair. All
three requests did carry the original schema. An enabled host completion callback
is called **zero times** on resumption, and the returned loop diagnostic remains
`phase: 'running'`. Thus native formatting hints alone do not preserve the local
validation or host-check contract. A second probe returns valid native JSON and
still has no `output_parsed` and zero completion checks, so this finding does not
depend on a provider violating its schema promise.

Fix plan:

- Resolve effective resume options once and use that same format/policy view for
  inline constraints, suspension formatting, local coercion/repair and the final
  host completion check. Preserve supported caller override behavior explicitly.
- Reuse the bounded managed finalization flow already used for ordinary runs and
  authentic async continuations, retaining the original route/task and allowances.
- Cover native and prompt-fallback structured output, valid/malformed and parseable wrong-shape
  resumed answers (preserving the existing parse-only contract), completion true/false/error, recovery exhaustion, cancellation,
  original call/token limits, no extra preparation, and explicit format overrides.
- Keep streaming's existing no-repair boundary; do not silently promise run-only
  validation on a streaming resumption.

## R3 — P2: Native routing requires the unused default adapter at construction

Locations: `src/core/Agent.ts:881`, `1178–1182`.

The constructor always binds native compaction to the configured default provider.
If it lacks a compaction adapter, construction throws before the selector can choose
an authorized, native-capable alternative. A Google default with an OpenAI or
Anthropic native route is consequently unusable under a native history policy,
even when the policy always selects that supported route.

The built-package probe configures an unsupported default and a supported alternative,
with explicit connector-transfer permission and `select: () => 'native'`. Construction
throws `Provider review-default-false does not support managed native compaction`;
neither provider is called. Adding a compaction adapter to the otherwise unused
default makes the identical selected-route run work. The default still receives
zero generation calls.

Fix plan:

- Defer managed native-adapter binding/support checks to the selected execution
  when routing is configured. Preserve host-authorized checkpoint preflight and
  ordinary nonrouting constructor contracts.
- Keep explicit idle maintenance bound to its existing owner and fail clearly
  when an actually selected default cannot support native compaction.
- Cover unsupported default/supported alternative, the opposite direction, explicit
  overrides and selector fallback, run/stream, cross-connector permission, checkpoint
  restore and cleanup after rejected selection.

## Correction and validation order

1. Add failing regression cases for all three counterexamples through supported APIs.
2. Correct R1 and R2, then R3; keep changes internal/additive. Any actual breaking
   proposal still requires the user's explicit approval before implementation.
3. Run focused lifecycle/protocol/structured/context/AMOS tests and the public
   compatibility controls; run build, types, lint and examples.
4. Broaden to the full unit suite and relevant real-provider gates, including
   native/opaque continuation, suspended structured completion and accounting.
   Count fixes as complete only when their final-source checks pass.
5. Update the recipe, implementation record, roadmap and Version 2 availability,
   adoption and handoff with corrective evidence. Regenerate API docs only for
   affected exported documentation. Add review/corrective evidence to the package
   inventory during corrective delivery; no package release is implied.

No production file, shipped example, test or package configuration was changed by
this review. Probe programs and temporary session/correlation files are isolated;
temporary session data is removed. These review-only observations are historical; the corrective completion below closes the findings.

## Corrective completion — 2026-10-22

The user authorized all fixes with “fix all”. R1, R2 and R3 are implemented and
validated without a breaking API change. Stage 14B, Stage 16B and publication remain
deferred. The original delivery/review evidence remains historical.

- **R1:** Final replay guards operate independently of routing and survive hooks,
  budget observers and tracked transport retries. Newly observed opaque output
  retains its admitted request identity, including a portable legacy model hook.
  Matching owners and portable legacy/direct calls remain supported.
- **R2:** Ordinary runs, explicit suspended resumption and automatic async delivery
  use one effective structured-finalization flow. Supported resume overrides apply
  consistently; original route/task ownership and data prohibitions remain intact.
  Parsing/repair precedes the host completion check. Local JSON validation remains
  parse-only, not full JSON Schema conformance; streaming retains no repair.
- **R3:** Routed native binding waits for route selection. A supported alternative
  runs with an unsupported default and restores its exact native owner. Actually
  selected unsupported routes fail before generation/new input; nonrouting
  construction and explicit idle maintenance retain their configured owner.

35 new regression cases cover run/stream, post-hook identity, reservation/retry
guards, scope changes, first opaque output in legacy tool loops, format/policy
overrides, malformed and parseable wrong-shape answers, completion failure/errors/
recovery, cancellation and exhausted task calls. AMOS exercises a native
alternative with a Google default. Existing provider mocks retain actual module
exports; temporary journal cleanup uses bounded filesystem retries.

8,723 units / 383 files, 221 live cases / 13 suites, 38 offline modes and 194 public ESM/CJS controls. Build/export checks, root and AMOS types/build, strict changed-surface
types, lint, public compatibility, examples and regenerated API documentation pass.
The focused routing module has 100% lines/statements/functions and 92.89% branches;
this is not whole-Agent coverage. The final live gate uses a full matrix plus the entire context-freshness suite rerun after a deterministic fixture correction. It includes OpenAI,
Anthropic and Google suspended structured repair/checks and both supported native
providers with a Google default, save/restore and incompatible-route controls.
No final required test is skipped.

The initial Google suspension fixture replaced the answer's meaning; its formatter
preserved that replacement. The corrected fixture damages JSON syntax while
retaining the actual candidate's semantics. The affected targeted case and the
whole final routing suite pass. Separately, an older Google streaming retrieval
fixture omitted one marker suffix in the full matrix. All 52 instrumented controls
matched raw SDK text to Agent output; the original miss did not recur, so its exact
cause is unproven. The fixture now uses temperature zero, direct hook edits for
its intended stream output cap, and termination diagnostics. The whole affected
16-case suite passes with unchanged exact marker oracles. Earlier red probes, intermediate mock/cleanup failures
and this fixture failure remain recorded as resolved validation incidents.

`example:routing-suspension` demonstrates one wait, four synthetic calls including
repair, inherited format and one resumed host check. `example:routing-context`
illustrates plugin/native composition with an unsupported default. No new AMOS
command is necessary; the adapter inherits the corrected Agent behavior.

[Corrective evidence](../evaluations/STAGE_14A_CORRECTIONS_VALIDATION.json) records
final gates, artifact hashes, source manifest and pilot limitations. Recipe,
Version 2 availability/adoption/handoff, roadmap, README/User Guide, generated API,
AGENTS, examples/index, AMOS docs/tests, Changelog and package inventory are
synchronized. All supported signatures/defaults and legacy session versions remain
intact; no required provider/storage member, new event kind or release is added.
