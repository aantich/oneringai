# Stage 12 second review and fix plan — 2026-10-16

Status: this earlier review/correction record is historical. The
[third corrective completion](STAGE_12_THIRD_REVIEW_AND_FIX_PLAN.md#third-corrective-completion--2026-10-16)
closes all later findings with fresh validation. Earlier fixes and passing validation
below remain historical records; no release.

Reviewed the full Stage 12 working tree and first corrective pass: preset assembly,
host-local requirements, provider inspection, managed admission, resume/ownership,
AMOS app/commands/storage/autosave, portable/runtime boundaries, examples and docs.
Runtime, built package, test and example fingerprints match the previous final
validation. Fresh focused validation passes **114 tests / seven files**; a strict
built-public consumer accepts the inputs used below. Six deterministic observations
reproduce four defects with actual public APIs, registries, app/adapters, file
storage and timers. No credentials, network, real LLM calls or external writes were
needed. The only simulated write increments a local counter.

See [review evidence](../evaluations/STAGE_12_SECOND_REVIEW.json). Previous
[corrective validation](../evaluations/STAGE_12_CORRECTIONS.json) remains historical:
its 8,073 units and 148 live tests passed, but did not cover these failure paths.

## R1 — P1: failed resume leaves a destroyed permission manager on a surviving context

Location: `src/core/Agent.ts:560–564`, with BaseAgent context/permission binding and
destruction. A supported caller-owned `AgentContextNextGen` can already belong to
a live Agent. Constructing a resume candidate replaces the shared ToolManager's
permission manager and the context's prompt/compaction callback. If loading fails,
the new catch destroys the candidate but leaves those bindings installed.

Reproduction uses identical blocklist configuration for the original Agent and
candidate. `blocked_write` is **denied before resume and while the candidate is
loading**, then **succeeds after resume rejects and cleanup finishes**. The attached
manager reports `isDestroyed: true`. Destroy clears its policy chain, whose legacy
no-approval-handler default remains allow. The original Agent/context are alive;
the registry count is correctly restored, but the permission boundary is lost.
The context also retains `REJECTED_CANDIDATE_PROMPT` in place of its original prompt.

This is a new failure-cleanup regression over an existing shared-context binding
behavior. An alive context and restored registry count are insufficient ownership
validation.

Fix: keep candidate cleanup and original-error propagation, while making failed
resume transactional for caller-owned context bindings. Preserve/restore the
original permission manager, prompt, compaction callback and other changed host
bindings/state; do not leave destroyed candidate authority attached. Preflight or
isolate candidate restoration before committing shared-context changes where
possible. Restoration must respect ownership/concurrency and not destroy the
caller's context, original manager or storage. Do not reintroduce the orphan leak
by skipping candidate destruction or reject supported live-context inputs to hide
the defect.

Regressions: identical allow/block policies before/during/after storage and scope
rejection; actual blocked tool execution and original Agent continuation; prompt,
callbacks, roles and session binding; repeated rejection; original-error retention;
registry/listener/timer cleanup and caller-owned resources. No external writes.

## R2 — P1: rejected scoped load redirects autosave into the rejected checkpoint

Locations: `src/core/context-nextgen/AgentContextNextGen.ts:2790–2796`,
`src/core/BaseAgent.ts:693–705`, and AMOS AgentRunner's load/autosave paths.
`loadRaw()` sets `_sessionId` before `BaseAgent.loadSession()` restores/preflights
the returned state. A foreign scope/task rejection preserves the conversation,
but leaves the live context targeting the rejected session ID.

Reproduction uses actual AMOS workflow sessions A (host/T42) and B
(foreign/FOREIGN_TASK), with actual periodic autosave enabled. Loading B into A
rejects with `Evidence invalid`. AMOS configuration still points to A, while
`runner.getSessionId()` now returns B. The next **timer-backed autosave**, without
another user/model operation, overwrites B with A's host/T42 state. B's original
history is gone. Scope refusal therefore does not protect checkpoint integrity.

The raw-load mutation predates Stage 12; scoped preset adoption and the newly
retained resume autosave expose an incomplete persistence guarantee. Direct
`context.load()` and the Agent raw-load/restore path must not be assumed equivalent.

Fix: make high-level load/restore commit the active checkpoint ID only after all
validation/restoration succeeds; every failure must retain the previous ID and
state. Guard against concurrent autosave during a tentative load. Preserve
supported custom restore hooks and direct raw-load contracts through an additive
internal/optional path if needed; do not silently change public side effects or
remove extension support. Keep AMOS's actual context ID, host config and later save
target consistent. Loading rejection must never authorize overwriting a different
owner/task checkpoint.

Regressions: owner, namespace, tenant, task, association, version and storage
failures with an existing active session; unchanged A/B bytes/state and pointers;
timer autosave, explicit save, named/unnamed metadata, resume and successful-load
controls. Exercise public Agent and actual AMOS adapters/commands. No action replay.

## R3 — P2: requirement snapshots drop valid getter-backed scope fields

Location: `src/core/presets.ts:120–122`. Preflight correctly calls `validateScope`,
which reads declared fields and returns a normalized frozen scope. The requirement
snapshot subsequently discards that normalized result and spreads the original
scope object. Prototype getter fields are not copied.

A stable class implementing public `EvidenceScope` with getters for `ownerId` and
`namespace` is accepted by the built declarations and ordinary Agent/plugins/store.
Both presets pass factory preflight but fail Agent creation with the built-in
evidence requirement error. A separate workflow case with plain evidence scope and
getter-backed task scope fails the task-state requirement instead. Actual plugins
and host ownership are correct; the frozen expected scope is missing its fields.

Fix: retain normalized validated scope values when capturing requirements, rather
than cloning the input representation. Preserve all owner/namespace/tenant checks
and matching host/backend requirements. Do not weaken guards or add a plain-record
restriction to the supported public scope contract.

Regressions: both presets, evidence and task scope independently, prototype and
non-enumerable getters, optional tenant, mutation isolation and real scope mismatch
rejection. Retain public type/runtime coverage and pure factory behavior.

## R4 — P2: a teardown exception stops all remaining rejected-candidate cleanup

Locations: `src/core/context-nextgen/AgentContextNextGen.ts:343–345` and
`3277–3302`, also relevant to Agent.resume cleanup. The new constructor rejection
path calls `destroy()` and suppresses teardown errors to preserve the composition
error. `destroy()` stops at the first throwing plugin, before releasing later
plugins, the store/tool managers and listeners or marking the context destroyed.

Reproduction registers a throwing cleanup plugin, then a separate well-behaved
resource plugin with a timer, plus incompatible task state and real built-in
evidence. Preset creation correctly rejects the task-state replacement. Afterwards
the well-behaved resource has **zero destroy calls and continues ticking**; its
ToolManager is not destroyed and the evidence outcome listener remains attached.
The unreturned candidate cannot be cleaned up by its caller. The probe explicitly
cleans its captured resources afterward.

The short-circuiting destroy loop is existing; automatic unreturned-candidate
rejection makes its incomplete cleanup consequential. Preserving the original
creation/load error should not suppress cleanup of unrelated owned resources.

Fix: attempt all owned teardown even when one plugin fails; clear managers,
listeners and references and finalize destruction reliably. Preserve shared-resource
ownership and idempotence. Retain original creation/load errors; direct destroy
may report its existing teardown error after completing cleanup. Apply the same
best-effort/finally discipline to remaining Agent cleanup where context destruction
can interrupt permission/listener cleanup. Avoid a new lifecycle framework.

Regressions: early/middle/late throwing plugin, later timer/listener resources,
constructor rejection and failed owned-context resume, original-error preservation,
double destroy and shared resources. Do not claim the framework can repair the
throwing plugin's unknown private resources; it must release the other resources
it owns and can reach.

## Fix order and completion gate

1. Close R1 permission fail-open and R2 checkpoint corruption first, with focused
   failure and concurrency regressions using local effects only.
2. Normalize requirement scopes (R3) and finish best-effort cleanup (R4).
3. Preserve original seven fixes, ordinary Agent/defaults, custom context/provider/
   plugin contracts, optional configuration, result/event shapes and legacy sessions.
   Any truly breaking proposal requires explicit user approval before implementation.
4. Build stable source, then run full units, built public compatibility/ESM/CJS,
   strict core/AMOS checks, types/lint/examples, AMOS and package/API gates. Run
   relevant real-provider suites, including presets/baseline and affected scoped
   evidence/task/loop paths. Passing old tests alone cannot close these findings.
5. Update the recipe, affected standard/generated docs, examples/AMOS, roadmap,
   Version 2 availability/adoption/handoff and fresh validation before restoring
   completion. Preserve historical evidence and identify actual limitations.

Two inspected cases were not promoted: prototype context-option getters already
receive the same fallback in plain Agent and preset; post-handoff config save
failure has an existing partial-success boundary. The evidence separates these
controls from the six observations establishing the four findings above.

## Second corrective completion — 2026-10-16

All four second-review findings R1–R4 are fixed on `version2`, base `393b10c`.
Failed shared-context resume now validates/restores before constructing a candidate:
no rejected candidate permission manager, prompt, compaction callback, role or tool
binding reaches the original Agent. Actual blocklisted tool executions remain denied
before/during/after rejection, and original Agent continuation remains usable.
Concurrent host edits during a rejected backend read are preserved; successful
shared resume retains the existing `session:loaded` notification.

High-level Agent/context loads preflight evidence/task scope, association and version,
then commit the checkpoint ID after successful restoration. Checkpoint operations
serialize with autosave and deferred managed snapshots, retaining immediate first
storage admission. Custom restore hooks remain supported; context/plugin snapshots
roll back after a hook failure. Failed custom-plugin rollback blocks further saves
until a valid session loads or the host rebuilds the context. Private/external hook
side effects remain host-owned. Direct `loadRaw` retains legacy ID selection without
validation. The optional `context.save` state argument additively accepts a snapshot
builder; existing signatures/inputs/formats/events/storage contracts remain usable.

Requirements capture normalized getter-backed owner/namespace/optional tenant values
without freezing host objects or weakening actual scope checks. Teardown attempts all
reachable owned plugin/manager/Agent resources after individual errors, preserves
skip-destroy ownership and idempotence, and reports the first direct teardown error
after cleanup. Failed creation/resume retains the original composition/load error.
A throwing plugin is still responsible for its unknown private resources.

Validation: **8,116 unit tests / 366 files**, including **43 new corrections / 126
Stage 12 preset and AMOS cases**; **148 live tests / 160 scenarios in nine suites**
with OpenAI, Anthropic and Google, zero failures/skips/unavailable providers;
**30 additional targeted live rechecks** cover final evidence/task load notifications;
**24 offline examples**, **44 ESM/CJS public controls**, build/export verification,
types/lint/examples, strict core/AMOS checks, AMOS build, public compatibility and
API generation pass. Selected new factory/inspection/command/storage helpers have
**100% line / 97.07% branch** coverage, not whole-Agent/context coverage. All six
original second-review observations are rerun against the final public build and
verify the fixes with real APIs, storage, timers and local counters. No service
writes or general model quality/cost/reliability claim.

The first full unit batch exposed two constructor-loading race assertions: queuing
had delayed first IO by one microtask. The final implementation preserves immediate
first admission while serializing overlap; both existing race tests and the entire
suite pass. Historical evidence is retained; no failure is waived as completion.

The AMOS example now rejects a foreign checkpoint and verifies a later save leaves
it untouched; the public example and ESM/CJS/type consumers accept getter scopes.
Recipe, standard/generated docs, examples/index, AMOS, AGENTS, release notes,
roadmap, Version 2 availability/adoption/handoff and packaged evidence are updated.
Internal-only coordination consists of the checkpoint queue/rollback guard,
`restoreSession` plumbing and candidate preload flag, not portable authority or a
new workflow/storage framework. Custom restore hooks must not await checkpoint IO
on their own context; loads require idle execution/host edits, and independent
contexts/backends need host concurrency coordination.

See [validation](../evaluations/STAGE_12_SECOND_CORRECTIONS.json) and
[offline transcript](../evaluations/STAGE_12_SECOND_CORRECTIONS_OFFLINE.txt).
Stage 12 and the core sequence are complete on branch. No breaking API change,
commit, push, release or later-stage implementation was performed.
