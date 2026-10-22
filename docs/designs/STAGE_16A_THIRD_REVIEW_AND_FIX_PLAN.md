# Stage 16A third review and fix plan — 2026-10-22

Status: **T1–T3 corrected and validated on branch.** The user authorized “fix all”.
See [corrective completion](#corrective-completion--2026-10-22). The review below
is historical. Previous R1–R5/S1–S3 corrections remain present; no API break,
release, commit/push or later-stage work is included.

Reviewed the composition coordinator, hook/frame boundary, cancellation and
execution ownership, independent session restoration, evidence/source retention,
provider conversion, thinking configuration, counted requests, AMOS and public
compatibility. All **53 source/build/test/example fingerprints** match the latest
corrective delivery. The existing suite passes **8,507 unit tests / 377 files**;
a separate focused run passes **171 tests / 5 files**. Root types, built consumer
compatibility and **66 native ESM/CJS checks** also pass.

Nine targeted reproduction/control cases establish the findings below. Complete
scripts, intercepted SDK bodies, results and validation hashes are retained in
[review evidence](../evaluations/STAGE_16A_THIRD_REVIEW.json). Probes use the built
public package, actual installed provider SDKs with synthetic intercepted HTTP,
and a deterministic custom provider for the hook comparison. No actual LLM calls,
credentials or external writes were needed. The preceding **199 live tests** remain
historical validation; they do not cover or close these newly reproduced gaps.

## T1 — P2: incompatible nested thinking is silently omitted

Location: `src/infrastructure/providers/shared/nativeCompaction.ts:21–25`.
Related converters: `OpenAIResponsesConverter.ts:233–249` and
`AnthropicConverter.ts:711–725`.

Native admission accepts every nested `THINKING` block, while each converter
only replays its own supported representation. OpenAI requires a provider item
ID and encrypted replay data. Anthropic requires a signature. The previous S3
fix rejects Anthropic top-level `ReasoningItem`, but does not validate these
nested representations.

Reproductions through public `addAssistantResponse()` and `compactContext()`:

- An OpenAI agent receives persisted nested thinking with an Anthropic signature.
- An Anthropic agent receives persisted nested thinking with an OpenAI item ID
  and encrypted content.

Both operations report `compacted`. Neither the actual SDK counting request nor
the native request contains the thinking text or its opaque data. The source is
replaced in active history, despite that data never entering native processing.
The exact archived source remains available: this is silent omission from native
processing, not a claim of unrecoverable archive loss. Matching-provider nested
thinking controls preserve both the text and replay fields.

Fix direction: validate nested thinking against the concrete provider before
discovery/counting, plugin reduction or archival. Reject representations that
cannot be faithfully replayed; do not flatten foreign opaque state or weaken the
existing retained-thinking boundary. Preserve supported OpenAI reasoning,
Anthropic signed thinking, and ordinary non-native converter behavior. No new
required plugin/provider/session fields are necessary.

Regression requirements: both mismatch directions; missing/partial replay fields;
eligible prefix, recent tail and pending input; manual/run/stream admission;
zero HTTP/archive/native calls for known unsupported input; unchanged source;
matching-provider controls using actual intercepted SDK request bodies. The prior
Anthropic top-level rejection must continue to pass.

## T2 — P2: manual compaction skips the preservation hook

Location: `src/core/context-nextgen/AgentContextNextGen.ts:1788–1790`.

`_compactContext()` calls `performComposition()` directly. Automatic composition
goes through `runCompaction()`, which emits the compaction events and awaits the
existing preservation callback. Consequently, the new explicit API bypasses
`lifecycleHooks.beforeCompaction`, even though its public contract says it runs
before context compaction and is the last opportunity to preserve important
information in plugin memory.

Reproduction: configure `automatic: false` and a hook that saves a critical
whiteboard note, then invoke `compactContext()`. Native history is replaced, but
the hook runs **zero times** and the note is absent. `compaction:starting` and
`context:compacted` also run zero times. The equivalent automatic control runs
the hook and events once, preserves the note, and completes normally. Exact
source archival still occurs in the manual case.

Fix direction: share the existing compaction lifecycle between explicit and
automatic operations while retaining the explicit target and manual trigger.
Await the preservation callback once before reductions/source capture. Reuse the
bounded refresh from S1, the same contribution allowance, protected-boundary
checks and execution/context leases. Do not introduce a second preparation or
native attempt. Preserve legacy hook-error handling. This finding concerns the
new explicit path; it does not request unrelated changes to the older unused
`afterCompaction` callback.

Regression requirements: explicit all/history/plugins targets, `automatic: false`,
built-in notes/whiteboard writes, companion revision refresh, event counts,
cancellation/deadline, hook rejection, no-op outcomes and checkpoint failures.
Keep the existing automatic/algorithmic controls and collection bounds. Exercise
the same manual lifecycle through AMOS's existing compaction command.

## T3 — P2: valid Anthropic thinking conflicts with the forced native cap

Locations: `src/core/model-execution/ModelExecutor.ts:126` and
`src/infrastructure/providers/anthropic/AnthropicTextProvider.ts:87–89`.

Both the model executor and native adapter clamp Anthropic compaction output to
4,096 tokens while inheriting the main model's thinking configuration. A supported
fixed-thinking budget of 8,192 tokens then fails the converter's requirement that
the thinking budget be smaller than `max_tokens`.

Reproduction: a `claude-sonnet-4-6` agent with
`thinking: { enabled: true, mode: 'enabled', budgetTokens: 8192 }` completes an
ordinary managed `run()`. Its intercepted SDK request correctly carries that
thinking budget and `max_tokens: 64000`. A subsequent `compactContext()` on text
history successfully counts and archives the source, then fails locally with:

```text
Anthropic thinking budgetTokens must be at least 1024 and less than max_output_tokens (4096)
```

No native HTTP request is sent and original history remains. Adaptive thinking
and a 2,048-token fixed-thinking budget both compact successfully as controls.
This is a conflict introduced by native request construction, rather than an
invalid main configuration or a vendor/API-key failure.

Fix direction: select provider-valid compaction-only thinking/output settings
instead of blindly combining the main generation settings with a hard-coded cap.
Keep the main model configuration unchanged, respect explicit host bounds, and
make ModelTask reservations agree with the actual native request. Validate known
conflicts before archival or model admission. Verify the selected native settings
against the provider's on-demand protocol and real calls during correction; do
not silently lower the main thinking budget or introduce helper routing.

Regression requirements: fixed budgets below/at/above the current cap, default
fixed-budget behavior, adaptive/disabled thinking, explicit output bounds, source
capacity, actual SDK bodies, manual/automatic run/stream, usage/reservation
agreement, and unchanged main/direct behavior. Include a bounded real Anthropic
compaction/continuation case for the corrected configuration.

## Correction and validation order

1. Add reproducing regressions for all three findings, with passing controls.
2. Correct T1 admission before any reduction/archive/native work.
3. Route explicit compaction through the preservation lifecycle for T2, retaining
   the existing bounded refresh and ownership rules.
4. Normalize and preflight Anthropic native thinking/output settings for T3;
   verify reservations and actual provider behavior.
5. Run focused and full units, build/export/types/lint, consumer and ESM/CJS
   compatibility, relevant offline examples/AMOS checks and the required real
   provider gates. Run built-package consumers only after the build completes.
6. Refresh examples and affected standard/generated docs, Version 2 availability,
   adoption/handoff, roadmap and package inventory. Preserve historical evidence
   and publish a distinct corrective validation record.

No public API break is proposed by this plan. If correction reveals that a
supported contract must break, stop that affected work and seek explicit approval
with alternatives and migration details. Stage 16B remains deferred.


## Corrective completion — 2026-10-22

The user authorized all corrections with “fix all”. Existing public signatures,
provider/plugin/storage extension contracts, default non-native behavior and
version-1 session format remain compatible. No new required API or Stage 16B
work is introduced.

- **T1:** First-party native admission validates nested thinking before provider
  discovery/counting, reduction or archival. OpenAI requires its replay item ID
  and encrypted content; Anthropic requires a signature. Foreign/incomplete replay
  fields fail explicitly. Matching-provider wire controls retain exact fields;
  custom native adapters keep their representation contract. Ordinary non-native
  converters are unchanged.
- **T2:** Manual compaction uses the existing compaction lifecycle once, retaining
  its target and manual trigger. Hook memory/revision changes receive the same
  bounded refresh; scope preflight precedes counting/hooks. Measured compaction
  events, best-effort hook errors and mutation-settlement ownership are preserved.
  A failed checkpoint can be saved again without repeating the hook or compaction.
- **T3:** One internal selector resolves Anthropic thinking through the existing
  converter and aligns wire output, source headroom and ModelTask reservation.
  Fixed budgets get 4096 summary tokens in addition by default, bounded by the
  model output ceiling. Explicit host/request caps are respected and conflicting
  caps fail before archival. Main settings and helper routing are unchanged.
  Internal streaming supports high valid caps, closes on cancellation and retains
  acknowledged iteration usage when the returned summary is unusable.

Validation passes **8,584 units / 377 files**, including **77 new regressions**
and **248 focused cases / 5 files**. The full actual-provider matrix passes
**201 tests / 12 suites** across OpenAI, Anthropic and Google. After the final
manual scope-preflight refinement/rebuild, all **11 affected native cases** pass
again on final source. Other matrix paths are unchanged by that native-only
refinement. No required gate has failed/skipped cases. The two new live cases
verify explicit hook preservation on both native providers; Anthropic compacts
and continues with the same 8192-token fixed-thinking configuration.

Build/24 exports, root types/lint, examples/consumer compatibility, strict core/
AMOS, AMOS build, generated API and **158 public ESM/CJS checks** pass. All **34
offline programs/modes** pass. Focused coverage is explicitly narrow, covering
policy/coordinator/fingerprint/native helpers/AMOS inspection; it is not whole
Agent/context/provider or repository coverage. See [validation evidence](../evaluations/STAGE_16A_THIRD_CORRECTIONS_VALIDATION.json)
and [offline transcripts](../evaluations/STAGE_16A_THIRD_CORRECTIONS_OFFLINE.txt).

`npm run example:native-hooks-manual` demonstrates explicit preservation with
`automatic: false`; its bounded live Anthropic mode exercises fixed thinking.
AMOS needs no new UI/configuration: its existing compaction command now preserves
and checkpoints the host note, with regression coverage for continuation. The
native recipe, README/User Guide, generated API, agent instructions, model-task
guide, examples/index, AMOS docs, Changelog, Version 2 availability/adoption/
handoff, roadmap and package inventory are synchronized. Prior review/delivery
records are historical evidence. Package release remains unverified.
