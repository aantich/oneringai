# Stage 04 review and fix plan

Reviewed 2026-10-15 on `version2`, against the uncommitted Stage 04 delivery based
on Stage 07 commit `152a0a3`.

**Current status: R1–R4 and both second-review compatibility findings are fixed
and validated.** See the [latest corrective completion](STAGE_04_SECOND_REVIEW_AND_FIX_PLAN.md#corrective-completion--2026-10-16),
[corrective completion](#corrective-completion--2026-10-15) and
[corrective evidence](../evaluations/STAGE_04_CORRECTIONS_VALIDATION.json).
The findings below describe the reviewed snapshot. This review changes documentation, status and the
package's review-document inventory only. It does not apply runtime fixes or add
permanent tests. [Original completion evidence](../evaluations/STAGE_04_VALIDATION.json)
remains an immutable historical snapshot, including its earlier Google failure
and unchanged baseline revalidation.

Fresh checks pass: **7,743 units / 354 files**, root/source/live/AMOS/example types,
lint and built public-package compatibility. All delivery source/test/example/docs
and built-public fingerprints matched at review start. The
[executable evidence](../evaluations/STAGE_04_REVIEW.json) contains exact scripts,
31 defect/control observations, commands and fingerprints. Script success means
that the asserted defects and controls reproduced; it does **not** mean they are
fixed. Existing green tests miss these paths.

The review covered host/proposal/observation authority, atomic/revision boundaries,
protected preparation and final dispatch, reentrant events, repair, compaction and
rollover, note corrections/conflicts/pruning, bounded recovery, receipt correlation,
file snapshots and task isolation, memory lifecycle/authorization/cancellation,
legacy extension/default compatibility, examples, prior provider evidence, and
AMOS host commands/configuration/session behavior. Library defects reproduce in
source and built public ESM/CJS. Actual FileContextStorage proves the restart failure;
actual AMOS runner/command proves the record-cap issue. Model calls are synthetic;
no credentials, billable provider calls or external actions are required. Live
calls were not rerun for a local review with no runtime changes.

## R1 — P1: Final budget events can invalidate protected state after its check

Location: [final validation/event](../../src/core/context-nextgen/AgentContextNextGen.ts#L1519),
especially [the event after validation](../../src/core/context-nextgen/AgentContextNextGen.ts#L1538).

`validateRequestBudget` checks task plugin identity/generation and exact prompt
presence, recounts the request, then can synchronously emit `budget:updated` before
returning it for provider dispatch. That public event can change task state. There
is no task guard after the event, so a request validated for an older generation
is sent while a newer host constraint is already active. Capturing a detached
request prevents event mutation of request objects but does not protect against
mutation of the authoritative plugin/context.

**Reproduction:** The host initially confirms CAP50. A harmless instruction added
by `before:llm` changes the final budget. A `context.on('budget:updated')` listener,
triggered during final recount, replaces it with CAP40. Both `run` and `stream`
call the synthetic provider once with CAP50 and without CAP40, despite live task
revision 2 containing the active CAP40 constraint. Two budget events fire; the
second changes state after the current guard. This reproduces in all three builds.
The provider has not been called when the correction occurs, so this is outside
the documented limitation about changes after a request has already been sent.

**Fix:** Treat task plugin identity/generation/owner and request presence as one
final invariant spanning every synchronous callback in the validation-to-dispatch
path. Recheck after the final budget event (and any other reentrant dispatch
callback), or move observational delivery to a point that cannot invalidate the
admitted request. Fail before the provider on change, retaining the host correction.
Preserve existing events/accounting and the single bounded preparation pass; do
not silently retry, add a second compaction pass or make an extra LLM call.

**Regressions:** Actual `run` and `stream` with final recount listeners that correct,
restore to the same revision, change/remove the owner, or destroy the context;
unchanged/read-only listener controls; native/schema budget changes; tool-free
repair behavior. Assert zero provider calls for stale state, current host state
retained and no action reexecution. Cover source and built ESM/CJS.

## R2 — P2: Reusing a pruned ID can save a checkpoint that cannot load

Locations: [admitting a new note ID](../../src/core/context-nextgen/plugins/TaskStatePluginNextGen.ts#L183),
[pruning retained links](../../src/core/context-nextgen/plugins/TaskStatePluginNextGen.ts#L262)
and [restoration link validation](../../src/core/context-nextgen/plugins/TaskStatePluginNextGen.ts#L279).

Pruning intentionally leaves historical correction IDs, and the documented API
allows IDs to be reused once pruned. Admission checks only currently retained note
IDs and does not reconcile dangling links. Reuse can therefore rebind an old link
to an unrelated new note. The live mutation succeeds, but `validateState` rejects
the snapshot it produced because the correction's inverse links no longer match.

**Reproduction:** Add `old`; add `new` superseding `old`; prune `old`; add an
independent new constraint with ID `old`. All four operations succeed, leaving
revision 4 with `new.supersedes = 'old'` and an unrelated active `old` record.
`getState()` succeeds, but `validateState/restoreState` throw `Invalid correction
links`. A real file checkpoint saves successfully and then fails to load into a
fresh context, leaving zero restored task notes. All three builds reproduce.
A control that resolves/prunes an unlinked note and reuses its ID restores normally.

**Fix:** Make reuse distinguish a new incarnation from stale historical links.
The smallest compatible approach is to detach dangling correction links to a
pruned incarnation when its ID is explicitly reused, before establishing any new
correction links. Keep genuinely retained chains intact, including host adoption
of proposals. Share candidate consistency validation between mutation and restore
so every admitted snapshot can be restored. Do not reject all documented ID reuse,
weaken restore checks or silently point old corrections at unrelated new records.
If a different design requires a breaking change, stop the affected work and seek
explicit approval under the standing compatibility rule.

**Regressions:** Reuse of a pruned predecessor/replacement, reuse as a correction,
multiple correction chains, proposal adoption, conflicts, deliberately dangling
historical references, atomic rejection and actual file/session recovery. Include
unlinked reuse and globally unique ID controls, and source/public ESM/CJS checks.

## R3 — P2: At exact capacity, the advertised resolve/prune recovery can deadlock

Locations: [capacity/commit](../../src/core/context-nextgen/plugins/TaskStatePluginNextGen.ts#L172),
[resolution update](../../src/core/context-nextgen/plugins/TaskStatePluginNextGen.ts#L199)
and [active-record prune guard](../../src/core/context-nextgen/plugins/TaskStatePluginNextGen.ts#L260).

An unresolved record can be admitted right at its content-token or snapshot-byte
limit. Marking it resolved adds metadata and must pass the same limit. Resolution
then fails; pruning also fails because the record is still active. There is no
atomic host resolve-and-prune path. A host cannot perform the recommended recovery
without replacing state or increasing configuration, even though its intended
final pruned snapshot would fit. The same issue can obstruct host action
confirmation needed before an action becomes eligible for pruning.

**Reproduction:** With the unchanged default 8,000-token limit, 14 valid active
constraints exactly fill the content budget. Resolving one raises `TASK_STATE_CAPACITY`;
pruning it raises `Cannot prune an active note`. Both fail without mutation. Smaller
exact-fit controls reproduce at 152 content tokens and 231 snapshot bytes; the byte
case reports the generic bounded-JSON error. Adding only transition headroom permits
resolution and pruning, proving that metadata growth causes the failure. All
three builds reproduce, including the unmodified default-token boundary.

**Fix:** Provide a small host-only atomic recovery operation, preferably an additive
option/API that validates explicit resolution/confirmation and pruning together
against the final candidate state. Keep current calls supported, revisions atomic,
proof/source requirements and active/pending protection intact. An alternative
headroom policy must remain compatible with existing supported limits and clearly
account for its cost; simply raising limits, admitting oversized intermediate
state, silently evicting records or clearing the task is not a fix. Distinguish
capacity overflow from malformed JSON in the resulting diagnostics.

**Regressions:** Exact/default token cap, exact byte cap, Unicode data, revision-digit
and confirmation/source growth, active constraints and unknown actions, cancellation
where relevant, stale revision and failed-proof/candidate atomicity. Assert safe
host-authorized recovery reaches a fitting final state, while ordinary compaction
and prune still cannot discard active/unconfirmed records.

## R4 — P2: AMOS cannot reclaim resolved task records at its entry cap

Locations: [task command operations](../../apps/amos/src/commands/commands/ContextCommand.ts#L114)
and [host edit adapter](../../apps/amos/src/agent/AgentRunner.ts#L195).

AMOS exposes add/correct/resolve, but no validated prune operation. Resolution
marks a record rather than deleting it. Once 100 combined records fill the default
entry cap, even resolving records does not permit new constraints/corrections.
The library's existing safe `pruneResolved` API is unreachable through the app's
host command adapter. AMOS configuration also does not expose the library capacity
options. This remains a separate app problem even after R3's metadata-boundary
recovery is fixed.

**Reproduction:** Through the actual runner and command, add 100 short constraints.
Resolve `note-0`: it succeeds at revision 101, but the record count stays 100.
Adding a new constraint and correcting another both fail capacity admission.
`/context task prune 101 note-0` is rejected as unsupported. No model call occurs.
Users must leave the documented command flow and manipulate state externally to
continue collecting host task state.

**Fix:** Add an explicit revision-checked host prune/recovery command and adapter,
reusing the library's safe pruning and R3's atomic recovery where needed. Reject
edits during execution, preserve active/unconfirmed records, retain the existing
in-memory/checkpoint semantics, and report capacity with an actionable recovery
instruction. Do not auto-evict history, auto-promote model command text or add
model-facing mutation tools. New adapter members should remain optional for legacy
AMOS runner implementations/mocks.

**Regressions:** Actual runner at 100 entries; resolve then reclaim/add/correct;
exact token/byte boundary recovery; refusal to prune active/unknown work; stale
revision, busy runner, malformed command and safe error presentation; session
save/reload after recovery and zero model calls for host commands.

## Corrective sequence and exit gate

1. Fix R1 and add managed run/stream regressions first: it protects the final
   constraint boundary before a model can act.
2. Fix R2 with shared mutation/restoration invariants and real checkpoint coverage.
3. Fix R3 with the smallest compatible atomic host recovery; retain hard limits
   and explicit host authority. Avoid introducing a new workflow/storage engine.
4. Wire that recovery and existing pruning into AMOS for R4, with actual command,
   adapter, checkpoint and no-model-call tests; update examples and the recipe.
5. Build before public/AMOS consumers; run focused regressions, full units, types,
   lint, built ESM/CJS compatibility, all offline examples and relevant real-provider
   agentic gates on the final source. Do not run a root build/clean concurrently
   with consumers. Record failures/providers truthfully, preserving earlier attempts.
6. Update the recipe/standard guides, regenerate API docs if public API/options
   change, update Version 2 availability/adoption/handoff and roadmap, and package
   the corrective evidence before restoring completion. No Stage 10 work or
   breaking API change is authorized by this review.

The overall design still fits the agreed scope: one opt-in host-controlled plugin,
existing lifecycle authorities, explicit observations and no automatic extraction
or action replay. The fixes should tighten that implementation, not introduce a
new context abstraction, workflow engine, scheduler or routing layer.


Package dry-run file membership verifies **161 files**, including this review/fix
plan and executable review evidence. No package was published. Runtime, permanent
tests, examples and built-public hashes remain identical to the reviewed delivery;
package changes are limited to the two review-document inventory entries.


## Corrective completion — 2026-10-15

The user authorized all fixes. All four findings are fixed and validated in the
uncommitted `version2` tree based on `152a0a3`; Stage 04 completion is restored.
This section supersedes the review status above; the original findings, scripts
and evidence remain historical. No API break, commit, push or release.

- **R1:** A shared final guard now spans final budget observers and tool-free repair,
  checking context lifetime plus task identity/owner/generation/presence after
  callbacks. Correct/restore/owner removal/destruction tests block before the
  provider; read-only schema/native recount controls dispatch once with one preparation.
- **R2:** New incarnations detach stale correction/conflict links to absent IDs.
  Historical predecessors remain inactive via resolution; unrelated active chains
  and authority labels remain intact, including proposal/assumption reuse. All
  committed candidates use the restoration consistency validator. Documented ID
  reuse and version-1 snapshots remain supported; real checkpoint roundtrips pass.
- **R3:** `TaskStateHostDelta` adds optional `confirmActions`/`prune`. Notes, resolution,
  sourced host confirmation and explicit pruning are one revision-checked candidate
  transaction. Only final state must fit; input limits still apply. Invalid proof,
  target, status or overflow leaves state unchanged. Standalone active/unknown prune
  guards remain enforced; byte overflow gets capacity diagnostics. No hard limit
  is raised, no oversized state is committed, and no action is repeated.
- **R4:** AMOS reuses the existing host adapter with explicit `prune`, `resolve-prune`,
  `prune-action`, `confirm-prune` commands. They reject stale/busy/invalid/unsafe
  requests, give actionable capacity guidance, use existing in-memory/checkpoint
  semantics and make no model call. No required runner member or mutation tool added.

Validation on the final built source:

- **7,784 units / 356 files**, including **153 Stage 04 cases** and **41 new
  regressions** (21 library recovery/ID/checkpoint, 10 Agent callback, 10 AMOS).
- Plugin coverage **99.61% lines/statements, 88.21% branches, 100% functions**.
- **117 live cases / 129 scenarios in one final seven-file batch**, no failures,
  skips or unavailable providers; OpenAI, Anthropic and Google verified. The 12
  task-state probes add explicit post-response ID reuse/atomic recovery assertions
  without additional model/submission calls. No real external writes.
- **19 offline examples**, public ESM/CJS compatibility and 18 retained scripted
  comparison cases. Eighteen corrected executable observations reproduce fixed
  behavior in source, ESM and CJS. Previously consumed tasks are regression coverage,
  not fresh held-out quality/cost evidence.
- Build/export verification, root and strict fixture types, lint, example types,
  AMOS build, generated API (**1,682 items**) and package documentation membership.

The workflow example reclaims/reuses an ID and roundtrips another checkpoint; actual
AMOS fills 100 entries, recovers atomically, adds a constraint and reloads with one
total synthetic response. [Corrective transcript](../evaluations/STAGE_04_CORRECTIONS_AMOS_OFFLINE.txt)
and [machine evidence](../evaluations/STAGE_04_CORRECTIONS_VALIDATION.json) accompany
the updated recipe, standard guides/API, examples/AMOS, Changelog, canonical agent
guide, roadmap and Version 2 availability/adoption/handoff. Original delivery and
review artifacts are unchanged, including the earlier Google marker failure and
revalidation. Every final corrective gate passed without a failed final live attempt.

Defaults, existing signatures, raw outcomes/events, single tool manager, task/memory
lifecycle and snapshot contracts remain supported. New recovery fields and host
commands are additive; explicit pruning is not audit retention or proof of semantic
truth. Automatic extraction, replay/exactly-once mechanisms and a completion-policy
loop remain deferred. **Stage 10** is next and requires separate authorization.
