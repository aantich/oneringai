# Stage 16A second review and fix plan — 2026-10-22

Status: **S1–S3 corrected and validated on branch.** The user authorized “fix all”.
See [corrective completion](#corrective-completion--2026-10-22). The review below
is historical. First-review R1–R5 remain corrected; no breaking change, release,
commit/push or additional stage is included.

Reviewed the corrected composition lifecycle, cached frames, provider request
normalization, history boundaries, evidence verification, cancellation, task
budgets, persistence, structured repair, AMOS and public compatibility. All **52**
source/build/test/example fingerprints matched the prior corrective record before
this review's documentation updates.

Fresh validation passes **8,454 unit tests / 377 files**, including **118 focused
tests**. The separate public runtime, consumer compatibility and type checks are
recorded in [review evidence](../evaluations/STAGE_16A_SECOND_REVIEW.json). Eight
targeted reproduction/control cases expose gaps that the existing tests do not
cover. Passing those existing tests does not close the findings below.

The evidence contains complete synthetic reproduction scripts. S1/S2 use the built
public package and deterministic providers/backends. S3 uses the installed
Anthropic SDK with intercepted HTTP and synthetic responses. No credentials,
external writes or actual LLM calls were needed. The prior **197 live tests** are
historical validation, not coverage of these newly reproduced paths.

## S1 — P2: preserving memory in beforeCompaction rejects automatic execution

Locations: `src/core/context-nextgen/AgentContextNextGen.ts:2178`, `:2505`;
`src/core/context-nextgen/compaction/coordinator.ts:114`.

The initial composition frame captures plugin state before `runCompaction()`
invokes the documented `beforeCompaction` lifecycle hook. Saving important data
to working/in-context memory is an intended use of that hook. The coordinator
subsequently asserts the pre-hook frame, treats the hook's memory write as a
concurrent stale-state change and aborts the turn.

Reproduction: a `beforeCompaction` hook calls the built-in in-context memory
plugin's `set()` to preserve one short fact. Both `run()` and `stream()` fail with
`CONTEXT_COMPACTION_STALE`, after the hook runs and before any native or main
model call. The saved fact remains. An unchanged native control completes, and
the same memory-preserving hook succeeds under the existing algorithmic strategy.

Fix direction: retain cached-frame reuse when the lifecycle boundary leaves it
unchanged, but permit one bounded rebuild/recount after a legitimate hook changes
plugin contributions. Capture native source authority after that boundary. Keep
the same contribution deadline and one compaction operation; do not weaken checks
for mutation during archival, counting, native execution or dispatch. Do not
remove the supported memory-preservation hook behavior.

Regression requirements: managed run/stream with built-in whiteboard and notes
writes; hook-associated contributor revision changes; pressure disappearing after
the hook; unchanged-frame collection bounds; timeout/cancellation during the
bounded refresh; genuine later concurrent mutation still rejected. Keep
algorithmic and custom-strategy hook controls passing.

## S2 — P2: native proof reads can outlive cancellation and task deadlines

Location: `src/core/context-nextgen/AgentContextNextGen.ts:1689`.

Every managed use of active native history verifies retained source records.
`verifyNativeSources()` awaits `storage.readRecord()` without the execution signal
or an abort race. A remote/custom backend that stalls therefore blocks the whole
Agent even after the host cancels or its ModelTask deadline expires.

Reproduction after one successful native compaction:

- Hold the next proof read pending. Cancel `run()`: it remains pending after
  50 ms and another run is rejected because the execution slot remains occupied.
- Supply a 30 ms ModelTask deadline: its signal is aborted, but the run is still
  pending after 70 ms.
- Cancel manual `compactContext()` through its supplied signal: it also remains
  pending after 50 ms.

All three reject only when the synthetic read is manually released. No additional
native or main invocation is sent. A permanently stalled read would never release
the operation through those cancellation/deadline mechanisms.

Fix direction: propagate the effective execution signal into native source proof
verification and bound read-only proof waits using the existing cancellation
helper. Check cancellation before and after each read and ensure a late read
cannot commit or resume execution. Audit the other newly introduced proof reads
for the same omission. Preserve the intentional settlement/ownership rules for
backend writes and uncooperative mutating plugins. Existing custom storage
adapters must not acquire a new required method or parameter.

Regression requirements: run, stream and manual operations; already-aborted
signals; explicit cancellation and ModelTask deadlines during the first/later
proof; late resolution/rejection without dispatch or unhandled rejection;
unchanged native history and reusable execution slot; missing-source validation
still fails closed. Distinguish read cancellation from write settlement.

## S3 — P2: Anthropic silently omits unsupported top-level reasoning

Locations: `src/infrastructure/providers/shared/nativeCompaction.ts:19`;
`src/infrastructure/providers/anthropic/AnthropicConverter.ts:596`.

The shared native guard accepts top-level `ReasoningItem` for every provider.
Anthropic's message converter handles message and compaction items but has no
representation for that top-level reasoning item. The native prefix planner also
allows it into the replaceable source. Counting and compaction thus silently omit
the item instead of preserving it or rejecting the unsupported protocol state.

Reproduction: seed a text conversation through public `addAssistantResponse()`
with a top-level reasoning item containing a summary and opaque content. Select
Anthropic native history with zero exact recent turns. Intercepted actual SDK
requests for counting and on-demand compaction contain neither field. The
operation reports `compacted` and replaces the active history with the returned
continuation. The exact archived source still contains the original item, so this
is silent omission from native processing/active history, not a claim that the
archive is irrecoverably lost.

This matters for host-supplied or reused histories containing another provider's
opaque reasoning. The approved design requires unsupported protocol state to be
protected or explicitly rejected; a successful count must not depend on dropping
it. Anthropic's existing retained-thinking check runs too late for this prefix
case and addresses a different, nested thinking representation.

Fix direction: apply provider-specific native input validation before discovery,
counting or archival. Explicitly reject Anthropic top-level reasoning unless a
faithful provider-supported representation is implemented and verified. Preserve
OpenAI reasoning support and ordinary non-native converter behavior; do not
flatten opaque state to text or guess a cross-provider translation.

Regression requirements: reasoning in eligible prefix, recent tail and pending
input; automatic/manual run/stream admission; summary-only and encrypted variants;
zero archive/native/main calls on known unsupported shapes; unchanged history;
OpenAI reasoning and valid Anthropic signed/nested thinking controls.

## Correction and validation order

1. Add reproducing regressions, then fix S1's lifecycle boundary without removing
   bounded refresh or stale-frame protections.
2. Fix S2's read cancellation using existing signal helpers, with late completion
   and execution-slot recovery coverage.
3. Fix S3's provider-specific admission and verify actual intercepted SDK bodies.
4. Run focused tests, the full unit suite, public consumer/runtime checks and
   build/type/lint/examples/AMOS checks appropriate to the affected files. Recheck
   necessary native live paths with the existing credentials, including automatic
   compaction and continuation. Do not count a skip as validation.
5. Update the native recipe, Version 2 availability/adoption/handoff, roadmap and
   correction evidence with actual results. Keep this review historical after
   closure. No breaking API change is required by this fix direction.


## Corrective completion — 2026-10-22

The user authorized “fix all”. **S1–S3 are fixed and validated on branch.**
No public signature, default, required extension member, event/return shape or
version-1 checkpoint format changed. No API break, release, commit/push or later
stage is included.

- **S1:** The initial frame is reused when stable. One refresh/recount is allowed
  after a pre-compaction hook changes plugin memory or a companion revision,
  within the existing allowance. Source, authority, prompt/input/task state, tools,
  policy, scope and plugin/storage identities remain guarded. No hook rerun or
  second compaction pass is introduced; genuine later mutations still fail closed.
- **S2:** Preparation carries the execution and ModelTask signals. Read-only
  retained-source, action-acknowledgement and archive-readback proofs use the
  existing abort helper. Late reads cannot resume dispatch/commit. Admitted writes
  and mutating plugins retain settlement ownership. A cancelled run/stream/manual
  wait on an already-started session load releases its execution without poisoning
  or bypassing the independent restore; the next turn waits for that checkpoint.
  This is internal plumbing, with no new required storage/provider member.
- **S3:** Anthropic rejects top-level reasoning at native admission before discovery,
  counting or archival. Actual intercepted SDK tests preserve OpenAI reasoning and
  valid Anthropic nested signed thinking; ordinary non-native conversion is unchanged.

Added **53 unit regressions** and **two live cases**. Fresh final validation passes
**8,507 units / 377 files**, **199 live tests / 12 suites** across OpenAI, Anthropic
and Google, **33 offline programs**, **158 public ESM/CJS controls**, and all
build/24-export/type/lint/examples/strict core/AMOS/generated-documentation gates.
The 171-case focused run meets its narrow coverage thresholds; it is not whole
Agent/context/provider coverage. No failed or skipped required gate is counted
as validation.

The new live cases preserve exact hook/source facts through automatic native
compaction, cancel a synthetic proof without another model attempt, then resume
against the actual provider while the old read is still pending. The existing
nine native live cases also cover manual reduction, repeat/restart/stream, selected
data and actual oversized-raw-input counting. Five deterministic startup cases
cover run, stream, manual, explicit abort signal and task deadline, preserving the
original checkpoint and excluding cancelled input.

The new [hook example](../../examples/native-context-hooks.ts) demonstrates the
existing lifecycle API with offline defaults and bounded opt-in provider calls.
AMOS needs no new UI/configuration surface: its existing command/cancel adapter
consumes the library correction. A real runner/command regression verifies slot
recovery before the old file-backed proof returns; AMOS documentation is updated.
Native recipe, standard guides/generated API, examples/index, agent instructions,
Changelog, Version 2 availability/adoption/handoff and the roadmap are synchronized.
See [final validation](../evaluations/STAGE_16A_SECOND_CORRECTIONS_VALIDATION.json)
and [offline transcripts](../evaluations/STAGE_16A_SECOND_CORRECTIONS_OFFLINE.txt).
The original second-review repro evidence and earlier passing/failing phases remain
historical records. There are no known outstanding findings from this review.
