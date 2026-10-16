# Stage 04 — Protected task-state view

Status: complete on branch; both reviews' findings fixed and validated. No package
release. See the [second corrective completion](STAGE_04_SECOND_REVIEW_AND_FIX_PLAN.md#corrective-completion--2026-10-16) and historical
[corrective completion](STAGE_04_REVIEW_AND_FIX_PLAN.md#corrective-completion--2026-10-15).
Authorized by the user's “proceed” on 2026-10-15, based on Stage 07 commit
`152a0a3` on `version2`. No commit, push, release or later-stage implementation is
implied.

The requested first delivery is host-controlled and deterministic. It adds one
opt-in plugin per host-selected task/context, with bounded notes (objectives,
constraints/corrections, decisions, questions and artifacts), explicit proposals
and assumptions, execution observations and host completion confirmations.
No model-facing mutation tools, automatic extraction, action journal, scheduler,
or replacement workflow engine is introduced. Hosts can use the existing explicit
extractor helper and submit its output as unconfirmed proposals; automatic
extraction remains deferred as proposed and authorized.

Existing TaskStatus and RoutineExecutionStatus vocabularies are reused. A linked
MemorySystem task is a read-through cached lifecycle view: the host transitions it
through MemorySystem.transitionTaskState, and explicitly refreshes the plugin with
its trusted memory scope. The plugin never writes competing state facts or restores
memory clients/principals from session data.

Task updates use revision checks and atomic bounded admission. The prompt view is
not compactable; protected content either remains present or dispatch fails. Task
state generation participates in context preparation guards, and final managed
requests must retain the current view in their trusted instruction contribution.
Snapshots remain optional pluginStates entries in the existing session schema,
with version/scope/task/association/binding preflight before context mutation.
Legacy snapshots without a task record clear the enabled task view instead of
inheriting another session's notes. Disabled features add no task content/tools.

Action observations are recorded explicitly by the host from ToolManager outcomes
or trusted execution events. No implicit observer duplicates or schedules effects.
A succeeded/settled tool receipt is distinct from external workflow completion;
only explicit host confirmation sets workflow status. Receipt admission failure
must be handled while retaining the original outcome/evidence, never by repeating
an external action. This view does not guarantee duplicate-effect prevention.

Planned validation covers correction/conflict authority, unconfirmed proposals,
execution/completion distinction, revision races, persistence/scope/legacy loading,
memory lifecycle/permissions, cancellation, budget and compaction guards, public
compatibility, AMOS inspection/host edits, offline examples and real-provider
run/stream integration. Existing Stage 00–07 gates remain required. No breaking
API change is proposed; new behavior is opt-in and additive.

## Delivered public surface

`TaskStatePluginNextGen` and ten accompanying types are exported through the public
package. Configuration is additive: `features.taskState: false` by default, with
host scope/task/optional immutable association/lifecycle under `plugins.taskState`.
No required Agent/session/storage/tool interface member is added. Built-in lookup
uses class identity, preserving third-party plugins with a similarly named helper
or plugin name.

- `updateHost`, `propose`, `assume`: atomic revision-checked sourced note deltas;
  same-category corrections retain historical links; conflicts remain explicit.
- `recordAction`: host-supplied ToolManager observations only, detached and bounded,
  retaining original execution/call/run identity, unknown completion and evidence.
  Duplicate observations are idempotent irrespective of property ordering. Late
  settlement can update unknown execution; settled diagnostics cannot regress.
- `confirmAction`: separately sourced host workflow status, with no inference from
  tool acceptance/success. No completion predicate, scheduler or action retry is added.
- `syncLifecycle` / `refreshMemoryTask`: cached views of existing Task/routine and
  authorized memory task metadata. Memory transitions remain in MemorySystem;
  no parallel state facts/client authority are persisted.
- `getState` / `getContents`: detached version-1 task snapshots;
  `pruneResolved`: explicit removal of resolved/superseded notes and host-confirmed
  terminal actions, preserving active/unknown state. Deliberately pruned links may
  remain as historical IDs. This is a bounded notebook, not an audit archive.

Defaults are 100 combined records, 8,000 estimated content tokens and 256 KiB plain
JSON. Field bounds, revision checks and capacity checks precede mutation. Inputs do
not execute accessors or custom serializers. All state is protected from compaction;
the normal request budget includes its full prompt contribution and instructions.
Final managed dispatch checks current plugin identity/generation and exact view
presence after hooks/listeners. JSON repair carries the view without preparing a
second compaction pass. Asynchronous rollover/summary and memory refresh reject
stale work, including restore-to-the-same-revision races and owner removal.

Session preflight rejects version/scope/task/association/binding/malformed/capacity
errors before replacing history. Legacy snapshots without a task entry clear the
enabled view. Configuration, memory clients and authorization are host supplied on
resume. Checkpoints themselves are trusted host state, not signed/model-safe imports.

## Examples and AMOS

`examples/task-state-workflow.ts` uses public exports and temporary evidence/session
stores. It demonstrates a correction, an unconfirmed proposal, one actual simulated
ToolManager submission, waiting across rollover/checkpoint/restart, separate-process
recovery and host-confirmed remote completion. No LLM calls or real external writes.

AMOS composes optional task configuration with existing evidence/strategy settings,
rejects owner mismatch, and uses the same context/tool manager. `/context task`
inspects state; `add`, `correct` and `resolve` commands require the current revision
and reject edits during execution. They make no model calls and change memory only;
the existing `/session save` flow checkpoints them. Model command text is never
executed. The offline walkthrough uses the actual runner/command/config and one
synthetic model response. Automatic action observation/memory linkage is deliberately
left to explicit host integration and documented accordingly.

## Compatibility and limits

Existing defaults, raw tool returns/events, run/direct semantics, supported custom
plugins/strategies/rollover and session loading remain supported. Generated tool
implementation fingerprints change because the generator includes transitive source
dependencies; no built-in tool API or effect policy was changed. No breaking API
change was proposed or implemented; no breaking-change approval was required.

Task views are prompt/state safeguards, not proofs of semantic truth, model obedience
or duplicate-effect prevention. `runDirect`/`streamDirect` bypass them. Updates cannot
revoke an in-flight provider request. Host-confirmation sources attest what the host
asserts; the library cannot verify arbitrary remote completion. Notebook admission
failure does not retain/replay raw outcomes automatically: the host must retain them
and use evidence as appropriate, then repair the notebook without repeating actions.
Automatic extraction and Stage 10 completion/recovery policy remain deferred.

## Validation record

The final build/export verification, root typecheck/lint, built public consumer,
all examples typecheck, strict new source/live/AMOS test typechecks, AMOS build and
API generation pass. Generated public API has 1,682 items. The full unit gate passes
**7,743 tests / 354 files**, including **112 Stage 04 cases**: 68 plugin, 20 context,
12 managed Agent and 12 AMOS. Targeted final plugin coverage is **99.55% statements/
lines, 85.81% branches, 100% functions** with the repository coverage thresholds.

The 12-case Stage 04 live pilot and final probes passed on OpenAI, Anthropic and
Google. The final scoped live gates cover **117 cases / 129 scenarios**, with no
final failures/skips or unavailable providers. Six files passed in the first
combined batch; the unchanged Stage 00 baseline passed in a complete separate
12-case/24-scenario revalidation after one initial Google development chat answer
failed its exact marker predicate. The original answer was not retained, so its
exact deviation/cause is unknown. Four diagnostic repetitions returned exact
markers. No fixture, predicate or runtime was changed to obtain the pass; earlier
failure/diagnostics remain in the [validation evidence](../evaluations/STAGE_04_VALIDATION.json).
This is not one all-green combined batch or a general quality claim.

**19 offline scripts**, public ESM/CJS consumers and 18 retained scripted
comparison cases pass. The initial existing localhost example hit sandbox EPERM;
the full batch passed with localhost permission. Previously consumed comparison
fixtures are regression coverage, not fresh held-out research. The new separate-
process workflow and actual AMOS transcript are included in the evidence.

The recipe, README, User Guide, generated API, canonical agent guide, memory guide,
examples/index, AMOS documentation, Changelog, roadmap and Version 2 availability/
adoption/handoff are synchronized. Package dry-run inventory verifies **159 files**, including the new recipe,
implementation/validation records, AMOS transcript and public workflow example. All new required source/live/AMOS fixtures pass strict typechecking;
earlier development fixture/narrowing/cast mistakes and a typecheck attempted
before DTS completion are retained as nonpassing diagnostic attempts.

The next core delivery is **Stage 10 — bounded recovery and verifiable completion**,
subject to separate user authorization. Stage 05 and other conditional work are
not prerequisites. Stage 10, automatic extraction, commits/pushes/releases and
breaking changes were not implemented or authorized here.


## Review status — 2026-10-15

The [review/fix plan](STAGE_04_REVIEW_AND_FIX_PLAN.md) supersedes the earlier
completion status, while preserving its validation as a historical record. Final
budget listeners can invalidate protected state after its guard; documented pruned
ID reuse can produce unloadable checkpoints; exact token/byte capacity can prevent
resolution/pruning; and AMOS cannot reclaim resolved records at its entry cap.
All four remain unfixed.

Fresh existing 7,743 units and local/public gates pass; 31 executable defect/control
observations cover source, public ESM/CJS and actual file/AMOS integrations. This
review applies no runtime fix or permanent test change and makes no billable call.
The outward Version 2 availability/adoption/handoff and current usage notices are
updated. Corrections and fresh validation precede Stage 10.


## Corrective completion — 2026-10-15

The user authorized all four fixes. They are validated and completion is restored.
Final guards span budget callbacks/repair; ID reuse detaches obsolete links without
reactivating history; optional host `confirmActions`/`prune` deltas supply atomic
final-state admission; AMOS exposes explicit safe reclamation using the existing
adapter and checkpoint flow. No breaking change or relaxed hard limit.

Final gates: **7,784 units / 356 files**, **153 Stage 04 cases / 41 new regressions**;
plugin coverage **99.61% lines/statements, 88.21% branches, 100% functions**; one
final **117-case / 129-scenario** real-provider batch with all three providers and
no failures/skips; **19 offline scripts**, ESM/CJS/public compatibility, 18 retained
scripted comparisons, source/example/strict fixtures/AMOS types, lint, builds and
API generation (1,682 items). Original validation/review records remain unchanged.
See [corrective evidence](../evaluations/STAGE_04_CORRECTIONS_VALIDATION.json) and
[AMOS transcript](../evaluations/STAGE_04_CORRECTIONS_AMOS_OFFLINE.txt).

Recipe, README, User Guide, generated API, AGENTS, examples/index, AMOS, Changelog,
Version 2 availability/adoption/handoff and roadmap are synchronized. Snapshot
version/required fields, existing APIs/defaults/raw events and lifecycle authorities
remain supported. No commit, push, release or Stage 10 work.


## Second review — 2026-10-15

Two P2 public declaration regressions remain open: legacy resolved-feature values
now require `taskState`, and existing custom registry configuration for that
feature key is narrowed to the built-in shape. The four original runtime findings
remain fixed, but stage completion is provisional pending compatible corrections.
See the [second review/fix plan](STAGE_04_SECOND_REVIEW_AND_FIX_PLAN.md) and
[evidence](../evaluations/STAGE_04_SECOND_REVIEW.json). Fresh units/local controls
pass; no runtime fix, permanent test change, rebuild or fresh LLM run in this review.


## Second corrective completion — 2026-10-16

Both public declaration regressions are fixed. Required resolved-feature keys stay
at the original eight; later additions are optional in legacy constructed values.
Generic task-state plugin configuration retains external records, while the
explicit built-in configuration type and runtime scope/task checks remain strict.
Factory precedence/defaults are unchanged. No production execution logic changes.

Fresh validation passes **7,795 units / 357 files**, including **164 Stage 04
cases / 11 new runtime regressions**, root/`types` legacy consumer compilation,
the unchanged review consumer, 18 source/ESM/CJS observations, full build/export
verification, source/live/AMOS strict types, example types, lint, AMOS build, both
task-state examples and API regeneration (1,682 items). Expected pre-fix compiler
diagnostics and the sandbox IPC build failure are preserved; the final build and
all final checks pass. No new LLM run for these type-only fixes; earlier live
evidence remains historical. See the [completion](STAGE_04_SECOND_REVIEW_AND_FIX_PLAN.md#corrective-completion--2026-10-16)
and [evidence](../evaluations/STAGE_04_SECOND_CORRECTIONS_VALIDATION.json).

Version 2 adoption/handoff, recipe/standard guides, generated API, example index,
Changelog, roadmap and package records are current. AMOS needs no new behavior;
its existing tests/types/build/offline workflow validate integration. No API break,
release, commit, push or Stage 10 work.
