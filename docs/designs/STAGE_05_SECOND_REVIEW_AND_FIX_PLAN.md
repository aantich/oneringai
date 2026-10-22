# Stage 05 second review and fix plan — 2026-10-21

Status: **all S2-R1/S2-R2/S2-R3 findings corrected and validated on branch**
(2026-10-22). See [corrective completion](#corrective-completion--2026-10-22).
The review below is historical; prior R1–R5 corrections remain implemented. No
release, breaking API change or other stage.

Reviewed the corrected assembly/selection, dependency and projection logic,
registration, prompt/store overlays, final-input reconciliation, budgets,
cancellation, scope, persistence, structured formatting, consolidation, suspension,
usage accounting, AMOS lifecycle/inspection, public consumers and documentation.
All **34** recorded source/build/test/example fingerprints match the prior
[corrective validation](../evaluations/STAGE_05_CORRECTIONS_VALIDATION.json).

Fresh checks pass **241 tests in eight files**, the built public compatibility
consumer and **82 ESM/CJS controls** (28 Stage 05 and 54 retained preset controls).
Ten assertion-backed offline observations reproduce the findings and controls;
see [review evidence](../evaluations/STAGE_05_SECOND_REVIEW.json). The prior
8,291-unit / 184-live-test / 196-scenario result remains historical evidence for
its covered cases. Full units/live suites were not rerun in this review: the new
failures are deterministic framework logic, independent of model interpretation.
No credentials, network model calls or external service writes were used.

## S2-R1 — P2: post-cycle consolidation invalidates structured formatting

Primary location: `src/core/context-nextgen/AgentContextNextGen.ts:1061–1064`.
Coordinator: `src/core/Agent.ts:2110`, before `run()` performs structured coercion.

The auxiliary guard correctly rejects host edits to the prompt and earlier input.
However, it also requires the original raw history prefix to remain unchanged
after the library's own post-cycle consolidation. `_runAgenticLoop()` consolidates
before returning the candidate to `run()`. Algorithmic consolidation can spill
complete older tool pairs and remove them from the live conversation. The ensuing
tool-free formatting/repair then mistakes that authorized history maintenance for
a host task/input change.

Reproduction uses the default algorithmic strategy and working memory, an older
completed read/result pair, an 8,000-token window and 2,300-token response reserve.
The main candidate is ordinary prose of about 2,058 estimated tokens, within the
reserve. Initial selected request use is 3,185 tokens. The answer raises post-cycle
utilization above the existing critical threshold; consolidation stores/removes
the old pair. No host callback edits the prompt, input, scope or source policy.
With `assembly: {}`, formatting rejects before the second model call:

```text
CONTEXT_ASSEMBLY_STALE: Context input or host prompt changed before formatting; prepare again
```

The same fixture with assembly absent consolidates successfully and returns
`output_parsed: { ok: true }` after two model calls. This affects assembly even
without a contributor; the combination of normal compaction and structured
responses is sufficient. Request fit is not the failure.

Fix plan: coordinate structured finalization with framework-owned consolidation.
Prefer a small lifecycle/order correction or explicit internal transition tracking
over relaxing raw-history checks for arbitrary mutations. Preserve current host
prompt/input/scope/revision/task-state rejection, frozen selected evidence, bounded
compaction/contribution work and default behavior. Do not catch-and-ignore stale
errors, replay the tool loop, or run another unbounded preparation cycle.

Regression requirements:

- Real default algorithmic spill/removal triggered by a final answer, followed by
  both mandatory prompt formatting and a native-output parse repair.
- A selected source that is unchanged, a source changed by legitimate
  consolidation, custom consolidation extensions and no-op consolidation.
- Actual host changes during these boundaries still reject; protected evidence
  and tool groups survive failed storage, cancellation and capacity errors.
- The local action runs once; frozen evidence is not recollected unnecessarily;
  main usage diagnostics and ModelTask charges retain their existing meaning.
- Unconfigured run and stream behavior, persistence and event contracts remain
  compatible. Streaming has no new JSON repair path.

## S2-R2 — P2: first suspension changes session authority before formatting

Primary locations: `src/core/context-nextgen/AgentContextNextGen.ts:1047–1048`
and `1066`. Coordinator: `src/core/Agent.ts:1996–2000`.

Selection binds the canonical session ID as part of authority. A fresh agent has
no ID when its suspension wrap-up is prepared. The suspension branch then creates
an ID, saves the session and correlation, emits suspension, and returns to `run()`.
If a structured output requires its tool-free formatting pass, authority now
differs solely because of this framework-owned initial persistence transition.

Reproduction executes one local submission returning `SuspendSignal`, followed by
a wrap-up that already contains valid `{"ok":true}`. The provider uses the supported
prompt-fallback contract with tools, so final formatting is mandatory even though
the wrap-up parses. With assembly enabled, the call rejects after two model calls:

```text
CONTEXT_ASSEMBLY_STALE: Context contribution authority changed; prepare again
```

The submission ran exactly once, and both the session ID and correlation were
successfully persisted before rejection. With assembly absent, the same fixture
makes the formatting call and returns `status: suspended` and parsed JSON. An
application instead receives an execution error after the operation was accepted
and its resumable state exists. Retrying the original task is not a safe recovery.

Fix plan: make initial suspension persistence and structured finalization agree
on the expected session binding. Establish the intended identity before selecting
the relevant frame, order formatting/persistence coherently, or narrowly track the
framework-owned transition. Do not remove session scope from authority, allow an
arbitrary host session switch, add required portable state fields, or replay the
submission. Preserve correlation/session recovery and the existing suspension
result/event contract, including failure paths.

Regression requirements:

- Fresh and previously assigned sessions; prompt formatting and native repair;
  both layouts and explicit contributors, plus empty assembly and disabled controls.
- One local submission; valid parsed suspended response; persisted correlation,
  session contents and restored continuation agree with the result.
- Failed save/correlation writes, cancelled formatting and actual host scope/session
  changes still fail accurately and retain already accepted effects for recovery.
- No extra tool calls, hidden contributor refresh, required session members or
  cross-scope admission. Account/task/registry guards remain covered.

## S2-R3 — P3: uncertainty metadata misses native results and tool signatures

Location: `src/core/context-nextgen/AgentContextNextGen.ts:1130–1132`.

`describeAssemblyRequest()` checks top-level opaque/computer items and selected
message content types, but does not inspect `function_call_output.output` or
`custom_tool_call_output.output` content arrays. Both public types explicitly
support images and provider-resolved files. It also omits the opaque Google
`ToolUseContent.thoughtSignature` field.

All five valid, complete call/result fixtures survive preparation and final
validation with their image/file/signature intact, but report
`lastPreparation.selection.accounting.opaqueOrMultimodal: false`. A plain-text
control correctly reports false. Token counting already traverses native result
arrays; this finding concerns the new uncertainty diagnostic, not an observed
overflow or an unsupported claim that text estimates become exact.

Fix plan: traverse the supported content-bearing protocol forms consistently when
describing estimation uncertainty. Reuse a small content predicate where useful;
do not add provider calls, tokenizers or new required APIs. Keep null cache/usage
counters distinct from measured zero, and do not mutate input or provider state.

Regressions: function/custom result arrays containing images/files, plain-text
arrays/strings, signed tool calls, existing message image/file/provider state and
computer/reasoning/compaction controls, final-input refresh and public ESM/CJS
consumers. Ordinary text-only packets must remain false.

## Correction order and completion gate

1. Correct S2-R1/S2-R2 through the existing managed-run lifecycle and preparation
   bookkeeping; retain the first review's freshness and compatibility guarantees.
2. Correct S2-R3 metadata traversal. Add meaningful lifecycle/failure/integration
   regressions and extend a relevant deterministic example where useful. AMOS must
   continue to display accurate metadata without triggering contributor work.
3. Build first, then full units, types, lint, examples, public/strict consumers and
   AMOS validation. Run the affected real-provider assembly/structured/tool/loop
   suites with OpenAI, Anthropic and Google, alongside the staged baselines needed
   for the final completion gate. Record each result without waivers or silently
   treating skipped cases as validated.
4. Synchronize the Version 2 availability/adoption/handoff, recipe, stage execution
   records and affected standard/generated documentation. Preserve historical
   evidence; record new validation before restoring completion.

No breaking API change is proposed. If a fix would narrow an existing supported
extension, event, session, result or default behavior contract, stop that affected
work, explain alternatives/migration and obtain the user's explicit approval.

## Corrective completion — 2026-10-22

All **S2-R1, S2-R2 and S2-R3** findings are fixed on `version2`, base `539bbd1`.
The review above remains historical. No new public options, required extension or
session members, result/event shapes, main-model routing or other stage was added.

Selected structured `run()` now finalizes the settled answer before post-cycle
consolidation. The existing formatter is shared with selected structured suspension,
which formats once before its existing session/correlation save and suspended event.
This keeps the admitted source/history/session frame valid without relaxing any
host prompt/input/source/scope/task-state check. Normal unconfigured structured runs,
streaming and async continuations retain their maintenance ownership and order.
No additional prepare, contribution, compaction or model retry loop was introduced.
If a short formatted answer removes context pressure, consolidation can legitimately
skip a spill; tests also force actual default algorithmic spill with a large final
JSON answer and exercise a custom strategy and failed-store recovery.

Suspension checkpoints now contain the formatted history. The local submission runs
once. A formatting/cancellation failure before persistence retains the accepted
observation in live context, but does not establish durable storage or a saved
correlation. Checkpoint that observation explicitly before destruction; never repeat
the action to recover formatting or storage. No unwritten session ID is reserved,
no arbitrary host session switch is accepted, and no new portable authority is saved.
Storage/correlation failures and restored continuation are covered.

Uncertainty accounting now traverses function/custom result content arrays for
images/files and recognizes opaque tool-call thought signatures. Ordinary text
controls remain false, input/source state is unchanged, and usage/cache counters
retain null versus zero. AMOS breakdown displays a source-free uncertainty notice.
The dispatch-safety example now illustrates default spill after formatting and one
coherent structured suspension; its process-local checkpoint simulation and temporary
correlation file are explicitly labelled and cleaned up.

Final validation passes **8,340 unit tests / 373 files**, with **49 new corrective
cases** (48 library and one AMOS; 197 total Stage 05 cases); **190 live tests / 202
scenarios / 11 suites**, with OpenAI, Anthropic and Google and no failures/skips or
unavailable providers; **28 offline examples**; **38 Stage 05 + 54 preset ESM/CJS
controls** and the built compatibility consumer. Build/24 exports, type, lint,
examples, strict core/AMOS, AMOS build and generated API gates all pass.
Focused coverage passes 201 tests with 100% lines / 91.28% branches for assembly.ts
and AMOS contextInspection only; these are not whole-Agent/context/repository figures.

The six new live cases use actual provider calls: controlled candidate pressure
followed by actual formatting, and one local synthetic submission followed by
structured suspension. OpenAI's valid native suspension fast path uses two calls;
Anthropic/Google final formatting uses three. Unit/public tests independently force
native repair and real algorithmic spill. All original ten review reproductions
now pass their corrected predicates. No external service writes or general model
quality/cost/cache-hit claim is made. Historical review/validation remains available.

See [validation](../evaluations/STAGE_05_SECOND_CORRECTIONS_VALIDATION.json) and
[offline transcripts](../evaluations/STAGE_05_SECOND_CORRECTIONS_OFFLINE.txt).
README, User Guide, generated API, recipe, agent instructions, examples, AMOS docs,
Version 2 availability/adoption/handoff and roadmap are synchronized. Package inventory
and links are checked in the validation record. No commit, push, release, approved
API break or later-stage implementation.
