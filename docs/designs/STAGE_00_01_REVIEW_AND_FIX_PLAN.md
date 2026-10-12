# Stage 00 and Stage 01 review and fix plan

- Reviewed: 2026-10-07.
- Scope: all Stage 00/01 tracked changes and new files on `version2`, based on
  `43b34cd`; production context/agent code, evaluators, tests, AMOS, examples,
  exports, generated artifacts, and documentation.
- Status: all five fixes implemented and validated on 2026-10-08 in the `version2`
  working tree. No breaking API change, commit, push, or release is claimed.
- Follow-up: corrective Stage 01 work is complete; Stage 02 awaits its own authorization.

At review time, the test suite passed but missed the five cases below. One finding was a
new data-loss regression caused by expanding removals to native-output groups.
The other findings are gaps in the final-budget protection/accounting delivered
by Stage 01, including an existing auxiliary-call path that the new checks missed.
These findings supersede a blanket interpretation of the earlier completion claim;
the retained live results remain valid for their explicitly tested scenarios.

## Historical confirmed findings and approved fixes

The reproductions and original defect descriptions below record the pre-fix
behavior. All five now have permanent regressions and corrected implementations;
see the [validation record](../evaluations/STAGE_01_CORRECTIONS_VALIDATION.json).

### R1 — P1: native results can be deleted without being stored

Relevant code:
[pair extraction](../../src/core/context-nextgen/strategies/AlgorithmicCompactionStrategy.ts#L307),
[connected-pair spill](../../src/core/context-nextgen/strategies/AlgorithmicCompactionStrategy.ts#L238),
and [group expansion](../../src/core/context-nextgen/tool-pairs.ts#L74).

`removableToolGroups()` now connects message calls to native
`function_call_output` / `custom_tool_call_output` items. Algorithmic
`findToolPairs()` still reads only message content blocks. When a shared assistant
message calls A and B, and A has a large message-format result while B has a native
output, spilling A removes the entire group. B is absent from the spill inventory
and is silently lost from both history and working memory.

Offline reproduction: a 3,000-token window, one assistant message with two calls,
large message result A, native output B containing `UNIQUE_NATIVE_EVIDENCE`, and
new pending user text. Preparation compacted; history became empty; A was stored;
B was neither stored nor present in the selected request. The compaction log even
reported two messages removed while the expanded removal deleted three items.

**Fix:** Extend the existing internal tool-pair inventory to recognize both native
output formats. Determine the actual connected removal group before spilling;
store all supported results in that group, then remove it. Preserve protocol
namespace separation, native output content, and multimodal attachments. If a
group cannot be represented safely in working memory, retain it and report an
explicit fit failure rather than silently discarding its native result. Keep
existing keys for already supported cases; do not introduce a new evidence-store
API or session migration. Correct removal diagnostics to describe actual removals.

**Tests:** mixed message/native results in both directions, custom outputs,
multiple results in shared messages, pending dependencies, unresolved native async
calls, successful retrieval of every spilled result, and storage failure before
removal. Test both `prepare()` and eligible post-cycle consolidation. Keep ordinary
rolling-window retention behavior unchanged; a broader retention redesign remains
outside this fix.

### R2 — P1: the request can change after the final validation

Relevant code:
[validation followed by mutable request emission](../../src/core/Agent.ts#L2724)
and [provider dispatch](../../src/core/Agent.ts#L2738).

Non-streaming execution validates the request, then emits `llm:request` with the
same options object it passes to the provider. A synchronous listener can modify
input, instructions, or schemas after the check. Cloning input/tools before that
event does not protect the whole request or prevent subsequent property replacement.
The selected budget then describes a different request from the one dispatched.

Offline reproduction: a 1,000-token window passed a 31-token estimate. A request
listener replaced instructions with text estimated at 5,143 tokens. The provider
was called, and the prepared diagnostic still reported 31 tokens.

**Fix:** Make the last fit decision after the existing synchronous request-event
mutation opportunity. Capture the dispatch request and ensure subsequent budget
publication cannot change that captured request. Reuse a small private calculation
path rather than adding another compaction pass or moving observational hooks.
Preserve existing event names/shapes and supported hook/listener behavior; do not
freeze event payloads or silently stop applying existing mutations as a shortcut.
Apply equivalent protection to streaming hooks that retain an options reference.

**Tests:** fitting and overflowing listener replacements of instructions, input,
and tools; reference mutation through a hook; budget-event reentrancy; provider
call count zero on rejected replacements; counted and dispatched snapshots agree;
observational hooks still run once and compaction is not repeated.

### R3 — P1: structured-output repair bypasses all context checks

Relevant code:
[tool-free formatting/repair request](../../src/core/Agent.ts#L2595), especially
[the provider call](../../src/core/Agent.ts#L2633).

`_generateStructuredToolFree()` is called from managed `run()` for final formatting
and JSON repair. It retains `skipContextLimitCheck: true` but does not use the new
request validator. A long generated answer or repair prompt can exceed the
configured window even though the original managed request fitted.

Offline reproduction: a 1,000-token context accepted a small initial request.
The fake model returned invalid JSON; the subsequent repair input alone was
estimated at 1,517 tokens. The second provider call still occurred with its context
check disabled. The formatting/repair path existed before Stage 01; the omission
is in the new coverage of managed request validation.

**Fix:** Reuse a pure request-budget calculation for internal formatting/repair
calls before dispatch. Reject oversized requests explicitly without compacting or
mutating conversation to make an auxiliary call fit. Keep auxiliary validation
distinct from selecting a new full-context preparation revision, and preserve
structured-output coercion, usage merging, and final history replacement. Leave
public `runDirect()` / `streamDirect()` behavior intact. Full helper-call event/cost
accounting remains Stage 06 work.

**Tests:** prompt-fallback formatting with tools; invalid-JSON repair; fitting and
oversized generated answers; schema/instruction overhead; native and prompt paths;
no second provider call on overflow; successful fitting repair still updates
returned parsed output, usage, and persisted assistant response.

### R4 — P2: a model-changing hook uses the original model's window

Relevant code:
[hook modifications](../../src/core/Agent.ts#L2714) and
[validator's request contract](../../src/core/context-nextgen/AgentContextNextGen.ts#L1378).

The validator considers input, tools, and instructions, but has no request-model
field. It clones the previous preparation's `maxTokens`. A supported
`before:llm` modification can select a smaller model while retaining the original
model's larger validation window.

Offline reproduction using the library's registry: context/model `gpt-4.1`
selected a 1,000,000-token window. A hook dispatched `gpt-4o-mini`, whose registered
window is 128,000. A locally estimated 148,600-token request was accepted and sent
under the original window. This did not contact either actual provider model.

**Fix:** Pass the actual dispatch model into the final request-budget calculation
and resolve its supported capacity through the existing provider/model facilities.
Respect explicit host limits; an explicit context limit must not make a known
smaller dispatch model appear to have a larger supported capacity. Keep the
owning agent's configured model and durable context metadata unchanged for a
per-call override. Preserve custom/unknown-model fallback behavior instead of
inventing a capacity. Any added public validator fields must be optional. Do not
disable model-changing hooks or introduce a routing framework.

**Tests:** hooks selecting smaller/equal/larger same-vendor models, explicit context
limits, custom provider metadata, unknown models, streaming in-place options
changes, and no permanent model/window change after a per-call override.

### R5 — P2: replay-signature estimates are inconsistent

Relevant code:
[tool-use token calculation](../../src/core/context-nextgen/AgentContextNextGen.ts#L1747)
and [signature forwarding](../../src/infrastructure/providers/google/GoogleConverter.ts#L279).

Stage 01 counts `ThinkingContent.signature`, but still ignores
`ToolUseContent.thoughtSignature`. The converter forwards the latter as protocol
state, so the new documentation's broad claim that replay signatures are included
is inaccurate for this supported representation.

Offline reproduction: preparation reported 46 estimated tokens while retaining a
tool-call signature whose text alone has a 4,858-token estimate under the current
character heuristic. This proves omission from the local accounting policy; it
does **not** prove that Google tokenizes or bills encrypted metadata that way.
Google distinguishes function-part signatures in `generateContent` from dedicated
thought steps in Interactions; see its current
[thinking contract](https://ai.google.dev/gemini-api/docs/thinking).

**Fix:** Include tool-call signatures under the documented conservative local
replay-state policy, consistently with other known opaque signatures. Preserve
their bytes and placement. Document that this accounting is an estimate of known
request state rather than a claim about provider tokenization/billing. Audit the
other known replay fields for the same omission without introducing a tokenizer
or changing native protocol content.

**Tests:** equivalent signatures in thinking and tool-call representations,
prepare/final validation consistency, small fitting and large protected payloads,
save/load preservation, and native multimodal content still counted as images
rather than base64 text.

## Corrective implementation sequence

1. Turn each confirmed reproduction into a failing permanent regression. Add the
   relevant run/stream, custom/native, error, and compatibility cases above.
2. Fix R1 first: align result extraction and actual group removal before deleting
   history. Keep one internal inventory rather than maintaining inconsistent
   grouping and spill implementations.
3. Fix R4/R5's calculation inputs, then R2/R3's dispatch integration. Reuse the
   same bounded, pure request calculation across the existing paths. Keep the
   public diagnostic API additive and the compaction trigger/defaults unchanged.
4. Update the context example with mixed-format result retrieval, and add a small
   offline formatting/repair budget example. Extend AMOS inspection tests to
   verify the diagnostic budget actually corresponds to the selected request.
   No new AMOS setting or command is needed for these correctness repairs.
5. Run build, typecheck, lint, full unit tests, public-consumer compatibility,
   examples, scoped coverage, and AMOS checks. Re-run affected live retrieval and
   structured-output scenarios on the existing selected providers after the fixes;
   include a signature-capable Google path only if available and relevant. Retain
   prior reports as historical evidence instead of overwriting their measurements.
6. Update the roadmap completion assessment, Version 2 guide, preparation guide,
   generated API if signatures change, Changelog, and validation records. Restore
   the Stage 01 completion claim only after the corrective regressions and
   required examples/checks pass.

All proposed fixes can use optional API additions or internal changes. No breaking
public change is proposed. If investigation shows an event/hook/plugin contract
must be changed, stop that affected change and obtain the user's explicit approval
under the existing development agreement. Freezing existing public event objects
or rejecting supported model hooks is not an approved compatibility shortcut.

## Review validation and scope limits

- Current full unit suite: **324 files / 6,825 tests passed** on 2026-10-07.
- Root typecheck, unchanged built public-consumer compatibility compilation, and
  examples compilation passed.
- Five independent synthetic reproductions confirmed the findings above against
  the current source. They used local context instances and an injected replay
  provider; **no additional LLM calls were made**.
- Stage 00 fixture/reporter/replay, cleanup, completion gates, recorded limitations,
  and AMOS inspection were reviewed. No additional blocking defect was established
  in those changes; passing plumbing samples remain distinct from quality/cost
  evidence. The full suite passing does not negate the newly reproduced cases.
- Broader summary/evidence stores, helper roles, adaptive routing, typed plugin
  contribution frameworks, and retention redesigns remain their planned stages.
  Performance refactoring without a measured regression is not part of this fix.
- Production implementation, existing tests, saved live records, and credentials
  were left unchanged during this review. Only this review/fix-plan document was
  added to the repository.

## Corrective completion — 2026-10-08

- R1 inventories native function/custom outputs with message results, selects the
  whole connected group before writes, preserves attachments/errors, checks that
  every spill remains recoverable, and logs actual removals. Failed writes/evictions
  retain history; unsupported serialization groups remain protected from removal.
- R2 validates after the existing synchronous request-event mutation opportunity.
  Counted dispatch fields are detached before budget-event reentrancy. Fitting
  listener and hook changes retain their behavior; rejected requests emit the
  existing correlated `llm:error`. Streaming retains its existing event shape.
- R3 uses the same pure calculation before managed JSON formatting/repair, without
  changing history, preparation revisions, or main-request diagnostics.
- R4 checks the actual dispatch model/provider capacity, honors smaller explicit
  host limits, supports custom metadata and unknown-model fallbacks, and preserves
  the owning agent/context model and window after per-call overrides.
- R5 counts tool-call signatures under the same conservative local policy as
  thinking signatures. Real Google replay after serialized context passed.
- Added 38 corrective regression cases; the nine initial reproductions failed
  before production fixes. Full suite: **325 files / 6,863 tests passed**. Scoped
  coverage: **35 files / 872 tests**, **88.19% lines / 83.91% branches / 95.1%
  functions**; algorithmic compaction has **95.47% lines**.
- Build, root types/lint, examples, unchanged public-consumer fixture, strict new
  core/live test types, generated API, and AMOS types/build passed. Offline examples
  verify mixed-source recovery, fitting and rejected repair, AMOS inspection, and
  both baseline splits.
- Final live checks: **10 correction cases + 24 baseline scenarios passed** across
  OpenAI, Anthropic, and Google. The initial two-source fixture exceeded the tiny
  retrieval window; its recorded failure led to a fixture correction preserving
  production emergency truncation. All initial/final results and measurement
  boundaries are retained in the new record. Earlier Stage 00/01 records are intact.
- Preparation/user guides, README, generated API, examples, AMOS documentation,
  Changelog, agent instructions, roadmap and Version 2 handoff are synchronized.
  No Stage 02 behavior, new routing framework, tokenizer, storage migration, or
  session format change was introduced.
