# Stage 12 — Minimal presets and capability inspection

Status: complete on branch after all three review/correction passes (2026-10-16).
See the [latest completion](STAGE_12_THIRD_REVIEW_AND_FIX_PLAN.md#third-corrective-completion--2026-10-16)
and [fresh validation](../evaluations/STAGE_12_THIRD_CORRECTIONS.json).
Earlier corrections and validation below remain historical.
Authorized by the user's “proceed” and “fix all”, on `version2` based on `393b10c`.
Original validation below remains historical; see the
[corrective completion](STAGE_12_REVIEW_AND_FIX_PLAN.md#corrective-completion--2026-10-16)
and [fresh validation](../evaluations/STAGE_12_CORRECTIONS.json).
No release or breaking change is authorized.

Implement two pure, opt-in configuration factories through one named selection:
`createAgentPreset('research' | 'workflow', config)`. Return ordinary AgentConfig;
reuse the existing context plugins, ToolManager, strategies and managed loop.
Research selects observation masking, workflow selects algorithmic compaction
and protected task state. Both enable evidence and bounded recovery, with 12/8
main-loop iterations respectively. Explicit settings override defaults, including
false flags, disabled loop policy and custom strategies. No invented credentials,
helper model, host completion callback, permission or budget authority.

Require explicit evidence backend/scope and matching host userId. Workflow task
state also needs a host-selected taskId/scope. Disabled features retain no preset
contribution; masking cannot remain selected after evidence is disabled. Existing
Agent.create and custom extension/session contracts stay unchanged.

Add instance inspection of actual configured plugins/strategy, provider capacities
and advanced capabilities, registry agreement, helpers and managed-loop settings.
Inspection makes no model/storage calls and excludes credentials, instructions,
task content and paths. It describes default managed execution; per-call overrides
and external drivers retain their existing ownership and inspection APIs.

AMOS saves an optional preset choice for the next agent initialization. Preflight
the selected composition before saving; leave the live agent unchanged. Inspect
active versus configured choice, preserve property absence on save failure, and
save descriptive session metadata without restoring authority from it. Existing
explicit evidence, task, strategy, loop and helper configuration remains authoritative.

Validate overrides, missing dependencies, isolation and disabled behavior, actual
run/stream and completion checks, lifecycle/cancellation/budgets, legacy settings
and sessions, portable new-host scope and provider-local rejection, runtime host
factories and unsupported external controls. Ship deterministic public examples,
AMOS demonstration and opt-in three-provider smoke tests. Build before built-package
consumers; complete full relevant checks, update standard docs/generated API and
Version 2 adoption/handoff before completion. Conditional stages remain deferred.

## Compatibility decisions and implementation review

`AgentPresetConfig` permits optional context.model; the main model is authoritative.
The public result remains AgentConfig. Factory composition preserves opaque host
objects and class-policy receivers. It validates unknown/dependency/ownership
conflicts without creating an Agent, instantiating a custom strategy/plugin, or
accessing credentials/storage/models. Explicit undefined feature entries remain
absent rather than disabling defaults. Existing config, plugin, tool and snapshot
contracts are retained.

`Agent.inspectCapabilities()` is a detached metadata-only instance API; it reads
actual plugins/current strategy and current provider support rather than inferring
capabilities from a preset name. Declared provider capability fields are projected into detached metadata, including
prototype/private-field getters; unrelated provider fields are never traversed.
It explicitly distinguishes default managed
settings from per-call/runtime execution and makes no native-compaction promise.

One small portable boundary widening was required: the existing trusted hydration
agentConfig accepts optional loopPolicy and modelExecution in addition to its
existing runtime snapshot fields. Runtime pass-through already existed; the
previous type excluded these host options. Export remains unchanged and no
callbacks/helpers/storage authority enter the wire package. Tests cover host-owned
policy reconstruction, legacy unscoped adoption and foreign scoped rejection.
No new preset field, protocol, driver profile registry or second SDK loop.

AMOS `/preset` selection applies on next Agent initialization, preserving current
history. Preflight uses current config-manager settings rather than the runner's
older config reference. Failed saves restore exact absence/null/value. Candidate
creation/resume precedes destroying the old Agent, preserving it on invalid next
settings. Active versus saved selections and host-only completion overrides remain
truthful in inspection. Explicit saves carry descriptive metadata in both checkpoint
and storage index; metadata never selects a preset during load.

No breaking API change was proposed or implemented. Existing call signatures,
defaults, events/statuses, supported extension objects and saved formats remain.
The implementation supplies no implicit helper, task budget, verifier, permissions,
context transfer or tenant identity. Conditional stages 05/08/09/11/13–16 are deferred.

## Final validation and handoff — 2026-10-16

- Root build and 24 export-file verification; typecheck/lint; generated public API;
  examples compilation; unchanged Stage 00–10 plus new Stage 12 public consumers.
- Full unit gate: **8,038 passed / 363 files**, zero failures/skips; **48 new Stage 12
  cases** plus two baseline calibration regressions cover factory/inspection/execution/lifecycle/budget/persistence, portable
  scope/host policy, external limits and AMOS legacy settings/rollback/adoption.
- **24 live tests / 36 scenarios**: both presets in run/stream on OpenAI, Anthropic
  and Google (12), plus unchanged baseline development/holdout trajectories (24
  scenarios in 12 tests). All providers available; zero failures/skips. No external
  writes or new model quality/cost claim. Other stage live suites were not rerun.
- **24 offline examples** (22 prior + two new), including deterministic AMOS;
  all pass and clean up temporary state. **20 ESM/CJS public controls** pass.
- AMOS build/typecheck, separate core/AMOS strict new-test/example compilation.
  Focused new factory/command coverage: **100% lines / 97.22% branches**; not a
  whole-Agent coverage claim.

Validation records: [gates](../evaluations/STAGE_12_VALIDATION.json),
[live](../evaluations/STAGE_12_LIVE.json),
[offline transcript](../evaluations/STAGE_12_OFFLINE.txt).
Recipe, README/User Guide/generated API, AGENTS, examples/index, AMOS help/config/
commands/example, Changelog, Version 2 availability/adoption/handoff, roadmap and
package file inventory are updated. Branch availability is separate from release.
No commit, push or release was performed. Core roadmap delivery ends here; next is
independent review/release readiness or an explicitly selected conditional scope.

## Final baseline calibration correction

A repeated final gate exposed one intermittent Google Stage 00 chat failure at the
full 512-token output cap. Preset cases still passed. Exact original output/status
were absent from the old payload-free reporter; do not claim a reconstructed
response or proven internal provider cause. Three diagnostic calls confirmed the
correct explicit thinkingBudget/cap and returned the exact marker. The fixture had
left temperature unspecified. Its setup now requests temperature zero where
registry metadata supports it, with requested/resolved values recorded. This is
controlled functional-test sampling, not a model determinism/quality guarantee;
ordinary Agent and preset defaults do not change.

Add two regressions for actual provider-boundary configuration and rejecting capped
wrong output. Add optional response status/stop reason/character count/hash to the
baseline reporter without storing payloads. Strict predicates, 512-token cap,
existing thinking budget and disabled retries remain unchanged. A separate bounded
20-call Google development/held-out calibration probe and the full three-provider
gate validate the change; preserve the earlier failed trajectory in final evidence.

The final calibrated gate passes all 24 live tests / 36 scenarios, all 20 additional
Google chat probes and 8,038 units. Earlier failed uncalibrated evidence is preserved
as history in the live record; no final failure is waived or retried into success.

## Historical review — 2026-10-16 (resolved)

Completion was withdrawn pending the seven confirmed findings in the
[review/fix plan](STAGE_12_REVIEW_AND_FIX_PLAN.md). Nine deterministic observations
reproduce missing scope/lifecycle/extension/protection/metadata coverage; the
existing 75 focused cases and strict public consumer compile still pass. Source
and public build match delivery. No runtime changes or new model calls were made
by review. Original full-unit/live/example records remain historical. Version 2
availability/handoff and roadmap recorded corrections pending at that time.
The [corrective completion](STAGE_12_REVIEW_AND_FIX_PLAN.md#corrective-completion--2026-10-16)
now closes all seven findings and restores branch completion.

## Second correction handoff

All four R1–R4 findings are closed by the
[latest completion](STAGE_12_SECOND_REVIEW_AND_FIX_PLAN.md#second-corrective-completion--2026-10-16).
Fresh gates pass 8,116 units, 148 live tests / 160 scenarios, 24 offline examples
and 44 public ESM/CJS controls. Examples, scope/lifecycle/checkpoint boundaries,
standard/generated docs and Version 2 handoff are synchronized; no release.


## Final third-correction delivery — 2026-10-16

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
