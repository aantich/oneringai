# Stage 16A review and fix plan — 2026-10-22

Status: **R1–R5 fixed and validated on branch** (2026-10-22). The review below
is historical; see [corrective completion](#corrective-completion--2026-10-22).
The subsequent [second-review S1–S3 corrections](STAGE_16A_SECOND_REVIEW_AND_FIX_PLAN.md#corrective-completion--2026-10-22) are also fixed and validated.
The user authorized all corrections with “fix all”. No API break, publication,
commit/push or later-stage work was authorized. Stage 16B remains deferred.

Reviewed the composition policy/coordinator, provider adapters and exact replay,
source archival, native bindings, checkpoint/recovery, shared model accounting,
selection/task protection, cancellation, AMOS, public compatibility and docs.
All **46** source/build/test/example fingerprints match the delivery record.
Reproductions and their complete synthetic fixture sources are retained in
[review evidence](../evaluations/STAGE_16A_REVIEW.json).

The full suite passes **8,420 tests / 377 files** with localhost networking
allowed. The restricted run passes 8,416 and fails four because the sandbox
rejects localhost HTTP/WebSocket listeners with `EPERM`; the unrestricted run
uses the same tests and code. Built consumer types and **66 native ESM/CJS
checks** pass. A separate focused run passes 79/80 and exposes R5. Its subsequent
passing result does not remove that clock race.

No real model calls were needed for this review. R1/R2/R4 use the actual installed
OpenAI SDK with intercepted HTTP and synthetic responses. R3 uses a deterministic
custom provider. No credentials or external service writes were used. The prior
194 live tests remain historical delivery evidence, not coverage of these new
cases. A passing existing suite does not establish that these findings are fixed.

## R1 — P1: binding can describe a different transport from the SDK in use

Locations: `src/core/Agent.ts:318`, `:978`, `:1014`.

`nativeEndpoint()` derives identity from the current connector/environment every
time a native driver is bound. The provider SDK captures its effective endpoint,
project and organization when constructed. Rebinding the driver does not rebuild
that SDK. A change before the next operation is therefore accepted as a new
binding even though the request still goes to the original service.

Reproduction:

1. Construct an Agent while `OPENAI_BASE_URL` is synthetic endpoint A.
2. Change that process environment variable to synthetic endpoint B.
3. Call `compactContext()`: intercepted SDK traffic goes to **A**; the saved
   native envelope describes **B**.
4. Construct another Agent under B, using the same connector name/evidence scope.
   Restore the saved snapshot and run it. Admission succeeds and the A-origin
   native block is sent to **B**.

This defeats the advertised endpoint binding. Reading current OpenAI project/org
configuration has the same structural mismatch with a previously created SDK.
The during-operation freshness check does not catch a change that occurred before
driver rebinding.

Fix direction: bind native envelopes to an immutable description of the effective
provider transport, captured with SDK construction. Detect configuration drift
against that description rather than relabelling an existing client. Reconstruct
a provider only through an explicit compatible lifecycle. Keep secret-free
metadata, named connectors and existing credential-rotation contracts; introduce
no new required custom-provider members.

Regression requirements: environment and configured URL changes between Agent
creation and the first native operation; project/organization changes; both
first-party adapters; save/load and separately constructed Agents; unchanged
configuration controls and existing in-flight/retry freshness tests. Assert the
actual SDK URL/headers agree with the saved binding.

## R2 — P1: counted OpenAI frames omit accepted raw generation inputs

Locations: `src/infrastructure/providers/openai/OpenAITextProvider.ts:99`, `:181`.

Generation spreads `getVendorRequestOptions()` into the wire request. Native
counting constructs a separate narrower object and omits those raw fields.
`assertNativeCompactionOptions()` does not reject all omitted prompt-bearing
options. For example, with no normalized top-level instructions, raw
`vendorOptions.instructions` reaches generation but never reaches counting.
Raw `text`/schema and reasoning/tool-choice controls also need reconciliation
with their normalized counterparts.

The fixture supplies **47,500 characters** of raw instructions and a host input
allowance of 2,800 tokens. Both counting requests omit the instructions; framework
diagnostics report 556 input tokens and admit generation with all 47,500
characters. Applying the same synthetic counting rule to the transmitted frame
gives 12,439 tokens. These are fixture counts, not a real tokenizer measurement;
the defect is that different frames reach the two endpoints.

Fix direction: share normalization and precedence for all supported
prompt-bearing fields between generation and counting. For fields a counting
endpoint cannot represent faithfully, reject the combination before native work.
Preserve existing raw vendor-option behavior outside the explicitly selected
managed native path. Avoid a second independent request builder with a partial
allowlist that can drift again.

Regression requirements: compare actual intercepted generation/count bodies for
raw instructions, raw text/schema, reasoning and tool choice, including normalized
override precedence, run and stream, final host hooks, and auxiliary formatting.
An oversized effective frame must stop before generation; legacy/direct escape
hatches must retain their supported behavior.

## R3 — P2: automatic composition loses the assembly deadline signal

Location: `src/core/context-nextgen/AgentContextNextGen.ts:1906`.
Related redundant work: `:1752` and
`src/core/context-nextgen/compaction/coordinator.ts:113`.

`prepare()` builds `selectedOptions` with the assembly controller's signal, but
passes the original `options` to `runCompaction()`. The new composition operation
then calls `materializeRequest()` and contributors using that original signal.
The contribution timer aborts the assembly controller, which no longer controls
the nested contribution promise. A contributor that correctly observes its
provided signal can remain pending indefinitely.

With a **40 ms** contribution allowance, the fixture's initial contribution
returns immediately and its next contribution waits for its supplied abort
signal. Automatic preparation is still pending at **130 ms**, with no native or
main call. Only explicit host cancellation releases it. The same nested
contribution under manual `compactContext()` receives the proper signal and
rejects with `CONTEXT_ASSEMBLY_TIMEOUT` without host cancellation.

There is also avoidable repeated collection: a successful automatic reduction
with no plugin phase collects the same unchanged contributor **four times** and
counts **eleven times** before its one main call. At 350 ms per contribution, the
default 1,000 ms allowance expires on the third collection before any native
call. The non-compacting control collects once and completes. This repetition
amplifies the deadline problem and adds latency for remote retrieval sources.

Fix direction: carry the composed signal through the entire bounded operation
and reuse the already materialized frame until a mutation requires a rebuild.
Keep revision/authority checks and one shared contribution allowance. This needs
a small preparation-lifecycle correction, not another cache or orchestration
abstraction.

Regression requirements: a signal-observing hung contributor during automatic
composition; explicit timeout vs host cancellation; manual/automatic controls;
no dispatch after expiry; bounded collections/counts with unchanged state;
rebuild after actual plugin/native mutation; changed contributor revisions and
scope still fail closed.

## R4 — P2: ownership conflicts can fail after billed compaction commits

Locations: `src/core/Agent.ts:951`, `:1000`, `:3266`.

Manual compaction builds its continuation frame without configured `nativeTools`.
Automatic preparation does not include the pending per-call continuation token.
Those omissions let the reduction run before the adapter sees the conflict it
will reject on the actual managed request.

Two intercepted SDK reproductions:

- An Agent configured with hosted web search and explicit data-policy permission
  completes a native compaction and commits a native envelope. Its next ordinary
  managed run immediately rejects the hosted-tool/native combination.
- A pressured managed run with `continuationToken: 'server-token'` performs one
  billable compaction and replaces older history. Final generation admission then
  rejects server-owned state. No main generation is sent.

The problem is admission order and incomplete effective options, not missing
support for those deliberately deferred combinations. The conflict was known
before archival or summarization.

Fix direction: preflight effective configured/per-call ownership and supported
request shape before any reduction phase or native call. Use a shared effective
continuation-frame builder for manual and managed preparation, without consuming
a one-shot token as a side effect of preflight. Keep deferred combinations
explicitly unsupported and preserve legacy/direct behavior.

Regression requirements: configured hosted tools on manual targets; continuation
tokens on pressured run and stream; no native invocation, archive or history swap
on rejection; plugin phase does not run first; supported local-tool and
client-owned continuation controls continue to pass. Retain data-policy checks
independently of native support checks.

## R5 — P2: compatibility test depends on staying within one clock second

Location: `tests/unit/core/context-nextgen/Stage16Compatibility.test.ts:56`.

The fixture compares two complete prepared prompts across a save/load round-trip.
Both contain `CURRENT DATE AND TIME`, generated from the live clock. The focused
run fails only because the first prompt says **1:50:41 PM** and the second says
**1:50:42 PM**. State restoration and compatibility are otherwise unchanged. The
full run later passes without an edit, illustrating the nondeterminism.

Fix direction: freeze the fixture's Date value or otherwise isolate the intended
stable comparison while retaining assertions over the restored plugin/history
and prompt contract. Do not remove those assertions or increase timeouts to hide
the race. Exercise clock advancement deliberately where dynamic time is tested.

## Correction sequence and completion gates

1. Correct effective transport binding and whole-frame wire normalization (R1/R2).
2. Correct assembly signal/frame reuse and early ownership admission (R3/R4).
3. Make the compatibility fixture deterministic (R5), with substantive regressions
   for each reproduced defect.
4. Run focused failure/lifecycle/compatibility tests, then build/type/lint/full
   units, built public consumers, native ESM/CJS controls, runnable examples and
   AMOS checks. Keep failures visible; distinguish sandbox restrictions from
   runtime assertions and do not replace failing evidence with silent retries.
5. Revalidate actual OpenAI/Anthropic compact/continue/repeat/restart/stream
   paths and the relevant three-provider baseline after runtime corrections.
   Update the native recipe, roadmap, Version 2 adoption/handoff and corrective
   evidence with actual results. Keep historical delivery/review records intact.

All proposed corrections fit the existing additive API. No public breaking
change or later-stage work is proposed or approved.

## Corrective completion — 2026-10-22

All five findings are corrected on `version2` with the existing public API,
algorithmic defaults, optional native envelope and session version preserved.

- **R1:** The provider factory captures secret-free service/account selection
  with SDK construction. Native binding checks configuration drift against that
  captured value; it cannot relabel an existing client. Model switches preflight
  before mutation, and failed execution admission cleans up owned model tasks.
  Actual SDK URL/header tests cover OpenAI/Anthropic endpoints, OpenAI project/org,
  environment/configuration variants, first use, checkpoint restoration, original
  service recovery and AMOS operation-slot recovery.
- **R2:** OpenAI generation/streaming/counting use one normalization builder.
  Count requests preserve supported raw instructions/schema/reasoning/tool choice,
  parallel calls/personality and normalized precedence. Uncountable raw controls
  reject on the opted-in native path; legacy/direct forwarding stays supported.
  Actual OpenAI counting rejects an oversized raw-instruction frame with zero
  model invocations. Post-hook overflow and wire-parity cases pass.
- **R3:** Composition reuses the initial materialized frame, rebuilds after
  mutations and carries the composed assembly signal/shared contribution allowance.
  History-only automatic composition collects twice; explicit history collects
  once. Plugin reduction requires an additional rebuild. Deadline/host cancellation,
  revision freshness and live selected-data preservation pass. A plugin-only
  policy can change models after clearing native history without invoking a stale
  native driver.
- **R4:** Manual and managed preparation share effective continuation options;
  known configured hosted tools and pending server tokens fail before reductions,
  archival or native billing. Token preflight does not consume the one-shot value.
  All manual targets, run/stream and a subsequent supported execution are covered.
  The runnable native example now asserts rejection without another model call or
  history swap.
- **R5:** The compatibility fixture freezes Date only, keeps real async timers and
  retains its exact restored-prompt/plugin/history assertions. The full suite and
  focused controls no longer depend on staying within one clock second.

Final checks pass **8,454 unit tests / 377 files**, **197 live tests / 12 suites**
across OpenAI/Anthropic/Google, **32 offline programs**, and **158 public ESM/CJS
checks**. There are **34 additional unit cases** and **three additional live
cases**, including automatic native-plus-selection on both native providers and
real OpenAI raw-input counting. All seven native live cases pass, including
repeat compaction, separate-process resume/stream and trusted checkpoint recovery.
Build/24 exports, type/lint, strict core/AMOS, examples, AMOS build, generated API
and public consumer gates pass. Focused coverage passes 118 cases with 99.02%
lines/statements and 84.03% branches over the policy/coordinator, native
fingerprint/wire helpers and AMOS inspection; these are not whole-Agent figures.

Validation also corrected an older live fixture: its 128-token plaintext cap let
Anthropic spend the response on analysis and stop before the requested values.
The test now uses a three-field JSON schema without expected values encoded in
the schema, a 256-token fixture allowance, and removes the host-only submission
tool before structured-output selection. Exact cap/job/pending interpretation,
forbidden stale/proposed markers, immutable host state and no-repeat assertions
remain. All 12 task-state cases and the final full 197-case run pass. No library
streaming guarantee, output default or retry behavior was changed to achieve it.
The offline loopback demo was rerun with localhost permission; no failure or skip
is counted as success. Intermediate failures and resolutions remain in the
corrective evidence rather than being reported as outstanding limitations.

See [corrective validation](../evaluations/STAGE_16A_CORRECTIONS_VALIDATION.json)
and [offline transcripts](../evaluations/STAGE_16A_CORRECTIONS_OFFLINE.txt).
The native recipe, README/User Guide, generated API, examples, AMOS documentation,
AGENTS, Changelog, package inventory, roadmap and Version 2 adoption/handoff are
updated. Initial delivery and review evidence remain historical. No package
release, commit/push, breaking API change or additional stage is included.
