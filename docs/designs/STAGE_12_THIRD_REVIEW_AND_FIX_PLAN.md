# Stage 12 third review and fix plan — 2026-10-16

Status: **all T1–T3 findings corrected and validated on branch**. The review below
is historical; the [third corrective completion](#third-corrective-completion--2026-10-16)
records implementation, compatibility, tests and documentation handoff. No release.

Reviewed the entire Stage 12 working tree, including the latest preload,
transactional restore, rollback guard and best-effort teardown corrections, public
preset/inspection composition, AMOS adoption, portable/runtime boundaries,
examples and documentation. All recorded runtime/build/test/example fingerprints
match the [second correction validation](../evaluations/STAGE_12_SECOND_CORRECTIONS.json).
Fresh focused checks pass **222 tests / nine files**; a strict consumer of the
built public declarations accepts the inputs below. **Four deterministic public-API
observations establish three findings.** No credentials, network, real LLM calls
or external service writes were needed. One admitted local tool increments a
counter to expose the permission failure.

See [review evidence](../evaluations/STAGE_12_THIRD_REVIEW.json). Previous 8,116-unit,
148-live-test and 30 targeted live-recheck results remain historical; passing those
paths does not cover the errors below. No full unit or provider batch was rerun
for this review.

## T1 — P1: shared resume is not transactional through constructor and notification failures

Locations: `src/core/Agent.ts:553–562` and `566–572`.

The new preload protects storage/preflight rejection, but commits the shared
context's history, prompt and session ID before constructing the candidate. The
candidate subsequently installs permissions, roles, prompt, callbacks and tools.
Its `session:loaded` notification remains inside a catch that destroys the candidate
without restoring the caller's bindings.

Two observations demonstrate the incomplete transaction:

- A normal host `session:loaded` listener throws after a valid load. Resume rejects
  with that original error and destroys the candidate. The original Agent/context
  remain alive, but the attached policy manager is destroyed. With identical
  blocklist configuration, `blocked_write` changes from **denied** to **succeeded**
  and increments the local write counter once. Registry cleanup succeeds, while
  the rejected candidate prompt and session B remain installed. This reproduces
  the earlier permission failure after storage validation rather than during it.
- A missing named connector rejects candidate construction. Because preload
  already committed, the surviving original Agent switches from A/HISTORY_A to
  B/HISTORY_B and `B_STORED_PROMPT`, even though no candidate is returned. In the
  previous implementation connector resolution preceded context loading, so this
  failure did not touch the caller's context.

Fix: extend ownership/transaction handling across the entire resume operation,
including validation, candidate construction and post-load notifications. Perform
non-mutating admission checks before committing shared state, and restore the
previous state/bindings on rejected handoff without leaving destroyed authority
attached or orphaning the candidate. Retain the original error and supported live
contexts, listeners, custom plugins, optional session settings and successful
notification behavior. Preserve concurrent host edits during rejected backend IO.
Do not restore the old orphan leak, silently drop notifications, or restrict live
contexts to hide the failure. An actual breaking exception/event-contract proposal
requires explicit approval before implementation.

Regressions: a throwing `session:loaded` subscriber attached through the actual
AgentRegistry, constructor admission failures with an existing A and valid B,
allow/block execution before/during/after rejection, original Agent continuation,
state/roles/prompt/tools/callback/session pointer, registry/listener/timer cleanup,
original errors, successful and missing-session controls, and caller ownership.
Use local effects only.

## T2 — P2: rollback snapshots reject supported JSON-serializable plugin state

Location: `src/core/context-nextgen/AgentContextNextGen.ts:2760`.
The existing extension contract in `context-nextgen/types.ts:381–399` requires a
synchronous **JSON-serializable** state object. The new rollback path applies
`structuredClone(this.getState())`, introducing a stronger, incompatible requirement
on every currently enabled plugin before any valid high-level load can restore.

An ordinary plugin returns an object with a `toJSON()` method that produces
`{ version: 1, value: "SAVED_VALUE" }`. JSON serialization and actual
FileContextStorage save/load succeed; its public types compile. After changing the
live value, `context.load('valid')` rejects with **DataCloneError** because the live
snapshot's `toJSON` function cannot be structured-cloned. Direct public
`restoreState(stored.state)` succeeds and restores SAVED_VALUE, matching the
previous load path. This affects ordinary contexts/Agents, not only presets.

Fix: capture detached rollback data through the supported serialization contract,
using existing serialization facilities where suitable. Preserve JSON conversion
semantics and existing custom storage/plugin contracts; do not add a cloneable-only
or plain-record restriction. Any genuinely narrower API proposal requires explicit
approval. Serialization failure must still precede mutation and retain the original
context/checkpoint; rollback cannot silently replace plugin state with incomplete
data. Avoid introducing a new serialization framework.

Regressions: actual FileContextStorage round trips with JSON conversion hooks,
ordinary Agent/context and preset extension paths, successful loads and failed
restore rollback, strict public types, existing plain snapshots/legacy sessions,
and serialization errors with unchanged state/target. Preserve synchronous plugin
state methods and existing formats.

## T3 — P2: an unrelated legacy load clears the rollback guard without repairing the failed plugin

Location: `src/core/context-nextgen/AgentContextNextGen.ts:2783`, with the conditional
plugin restoration loop in `restoreState`.

The new guard correctly blocks saving after a plugin refuses both forward restore
and rollback. However, every successful overall load clears the boolean, even when
its checkpoint contains no state for that damaged plugin. Existing legacy loading
accepts missing plugin keys and leaves such custom plugins untouched.

Observation: the extension enters UNCERTAIN_STATE and throws on forward restore
and rollback. Saving is initially blocked. Loading a valid legacy checkpoint with
`pluginStates: {}` returns true without calling the damaged extension's restore
method. Its value remains UNCERTAIN_STATE; the next save succeeds and writes that
value into the legacy checkpoint. The claimed recovery therefore permits the
uncertain state the guard was introduced to protect against.

Fix: retain enough process-local failure identity to clear recovery protection
only when each affected plugin is actually restored from acknowledged checkpoint
state or repaired/replaced through a trusted existing host path. A load may preserve
legacy missing-plugin semantics while leaving saves blocked. Keep guards internal;
do not add required storage/plugin members, saved authority, model repair tools or
a new workflow engine. A fresh context with known initial state remains a valid
host recovery option.

Regressions: failed forward/rollback followed by a missing-plugin legacy load,
unrelated state-only loads, multiple failed plugins with partial recovery, actual
checkpoint bytes and autosave, subsequent successful repair and save, original
errors, and old snapshots without newly required fields. Never repeat an external
action to repair persistence.

## Fix order and completion gate

1. Close the shared-resume permission and ownership failure across the whole
   handoff. Preserve cleanup, original errors and existing notification contracts.
2. Preserve JSON serialization compatibility in rollback snapshots and make guard
   recovery depend on actual restoration of the affected plugins.
3. Add permanent failure/ownership/lifecycle/concurrency/compatibility regressions;
   retain existing getter-scope, original resume, AMOS autosave and teardown fixes.
4. Build stable source, run full units and relevant strict/public ESM/CJS/legacy
   compatibility, types/lint/examples/AMOS/API/package checks. Run affected actual
   provider suites, especially scoped evidence/task session paths. Old passing
   validation is not a waiver for these missing cases.
5. Update examples, recipe, affected standard/generated docs, AMOS where relevant,
   roadmap, Version 2 availability/adoption/handoff and fresh validation before
   restoring completion. Preserve historical evidence; do not narrow a supported
   API without the user's explicit approval.

Not promoted: AMOS replacement-versus-new-input concurrency would require host calls
outside its serialized REPL; no normal CLI failure was demonstrated. Nested
checkpoint IO in restore hooks is already excluded by the current recipe, so no
additional supported-contract regression is asserted here. Earlier context-option
getter and post-handoff config-save controls remain controls.


## Third corrective completion — 2026-10-16

All **T1–T3** findings are fixed on `version2`, base `393b10c`. Shared resume now
preflights the named connector, then keeps restoration, candidate construction and
the existing synchronous loaded notification inside one checkpoint transaction.
Rejection restores original tool registrations, permission authority, roles, prompt,
compaction callback, conversation and session target before candidate cleanup.
Partial constructor failures release initialized framework resources; original
notification/construction errors retain their identity even when teardown throws.
Ordinary managed loads also roll back a rejected synchronous loaded notification.

Rollback snapshots follow the existing **JSON serialization** contract, including
own/prototype `toJSON` and Date conversion; serialization failure precedes mutation.
The save guard tracks actual damaged plugin instances. Missing legacy keys or a
custom restore hook that ignores them cannot release protection. Every affected
instance must actually restore successfully from a checkpoint or through existing
trusted host `context.restoreState(goodSnapshot)`; otherwise saves stay blocked.
No plugin/storage/session schema, event field, required API, default, or supported
JSON extension contract was removed or narrowed. No breaking change was proposed.

Permanent regressions add **27 unit cases**: constructor/registry/tool-registration/
provider/connector/notification failure, policy/tool/role/prompt/callback/history/ID
rollback, original continuation, queued saves/autosave, original errors and cleanup,
JSON own/prototype/Date conversions in contexts/Agents/presets with real file storage,
serialization-before-mutation, multi-plugin/omitted-key/ignored-hook/host repair,
and actual AMOS commands/checkpoints. Three permanent live tests additionally
verify original-history continuation after all three recovery paths against each
provider, with zero blocked local writes. The existing preset example now shows
rejected shared resume, preserved authority/checkpoint and JSON plugin restoration;
built ESM/CJS/type consumers exercise the same compatibility contracts. AMOS needs
no new command: fixes apply to its existing `/session load` and `/session save` flows,
covered by actual app/command/file-adapter regressions and updated guidance.

Final gates pass **8,143 units / 367 files**, **153 Stage 12 preset/AMOS unit cases**,
**151 live tests / 163 scenarios / ten suites** (148/160 in the nine-suite batch,
plus three focused session-continuation cases) with OpenAI, Anthropic and Google,
zero failures/skips/unavailable providers; **24 offline examples**, **54 ESM/CJS
public controls**, root/AMOS builds, types/lint/examples, strict core/AMOS, legacy
public compatibility, generated API, documentation and package checks. Selected
preset/inspection/AMOS helper coverage remains **100% lines / 97.07% branches**,
not whole-Agent/context/ToolManager coverage. All four original third-review
observations verify fixed behavior on the final build. Functional synthetic fixtures
and local effects do not establish general model quality/cost or real-service writes.

Internal-only plumbing comprises the synchronous checkpoint admission callback,
ToolManager binding rollback, partial-construction capture and failed-plugin
identity/restoration tracking. No authority is serialized. Loads require idle host
execution/edits; separate contexts/backends need host concurrency coordination.
Successful shared-context handoff still needs host ownership coordination. Rollback
cannot undo model calls, external actions or arbitrary private listener/hook effects;
restore hooks must not await checkpoint IO on their own context. Rebuild the context
if a custom plugin cannot recover. Existing advanced `loadRaw` behavior is retained.

Recipe, README, User Guide, generated API, examples/index, AMOS, AGENTS, Changelog,
roadmap, stage records, Version 2 availability/adoption/handoff and package evidence
are synchronized. Historical review/validation records remain unchanged; no failure
is waived. See [fresh validation](../evaluations/STAGE_12_THIRD_CORRECTIONS.json) and
[offline transcript](../evaluations/STAGE_12_THIRD_CORRECTIONS_OFFLINE.txt).
The core sequence is complete on branch. No commit, push, package release or
later-stage work was performed.
