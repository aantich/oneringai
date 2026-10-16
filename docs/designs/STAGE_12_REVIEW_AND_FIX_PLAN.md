# Stage 12 review and fix plan — 2026-10-16

Status: this earlier review/correction record is historical. The
[third corrective completion](STAGE_12_THIRD_REVIEW_AND_FIX_PLAN.md#third-corrective-completion--2026-10-16)
closes all later findings with fresh validation. Earlier fixes and passing validation
below remain historical records; no release.

Reviewed the complete Stage 12 working tree: public preset composition and inspection,
portable hydration type widening, AMOS command/configuration/recreation/checkpoints,
examples, evaluation changes, tests, documentation and generated/exported surfaces.
Public ESM build/source hashes match the delivered artifacts. Seven findings were
reproduced in nine deterministic observations using injected local providers,
actual plugin/connector registries, real file storage/timers and the real AmosApp
replacement method. No credentials, network or real model calls were needed.

Existing focused suites still pass **75 tests / four files**. A strict consumer
compile confirms the getter-based provider, indexed class plugin configuration and
explicit undefined context principal are accepted public TypeScript inputs. The
extra probes demonstrate gaps not covered by those passing tests. See
[review evidence](../evaluations/STAGE_12_REVIEW.json).

## F01 — P1: validated host principal can be erased

Location: `src/core/presets.ts:65–71`; downstream BaseAgent context merging and
AgentContextNextGen connector-registry scoping.

`createAgentPreset('workflow', { userId: 'review-owner', context: {
userId: undefined, ...validScopedPlugins } })` passes validation because the check
ignores undefined. Spreading input retains that own property. BaseAgent subsequently
spreads the context over its host userId and creates an Agent whose userId is
undefined. Connector access policy selection depends on this effective principal.

Reproduction: a policy hides `review-foreign` from `review-owner`. Omitting the
context property preserves the owner and hides that connector. Explicit undefined
produces a null/undefined principal and makes the same connector visible through
ToolContext.connectorRegistry. Evidence/task configuration still names the owner
that the factory validated. This is a new preset preflight/authority defect; the
underlying ordinary-context merge is an existing integration behavior.

Fix: normalize the effective host principal in the composed context, consistently
with the authoritative main model, and validate the resulting authority rather
than only the top-level input. Audit undefined inherited authority settings such
as identities without changing intentional explicit overrides. Preserve ordinary
Agent compatibility. Add both-preset tests of omission/undefined/mismatch, actual
ToolContext principal and denied foreign connector lookup under an access policy.

## F02 — P1: the real AMOS replacement path still destroys the active session first

Locations: `apps/amos/src/app.ts:557–596`, new
`apps/amos/src/agent/AgentRunner.ts:128–139`, and SessionCommand's fresh-session path.

The candidate-before-destroy correction exists inside AgentRunner.initialize,
but AmosApp creates a different runner after destroying the previous one. Thus the
correction does not protect the actual UI path advertised by /preset. A valid
saved preset selection followed by a replacement startup failure leaves the old
runner destroyed and the replacement unready. A fresh-session replacement can
also have no saved checkpoint of the old conversation.

Reproduction: create a real app/runner with unsaved local history, successfully
select research through PresetCommand, then inject a failure at replacement
initialization and call the real `app.createAgent({ freshSession: true })`.
Both previousReady and replacementReady become false; previousSessionId is null.
The failure is deliberately injected, not attributed to a real external outage.
The destroy-first app structure predates Stage 12; this is an unfinished Stage 12
integration guarantee, not a newly introduced app method.

Fix: make the app-level replacement transactional. Prepare/load/validate the
candidate before swapping references or destroying the previous runner; clean up
failed candidates, restore session/configuration pointers on failure and preserve
interrupted observations when checkpointing is required. Commit steering/lifecycle
changes at the successful handoff. Test actual AmosApp + SessionCommand, not only
mocked createAgent callbacks or manually swapped runners. Cover fresh/resumed
sessions, backend/load/scope failure, autosave and protected pending observations.

## F03 — P2: failed resume leaves an orphan Agent registered

Locations: `src/core/Agent.ts:548–559`, exercised by the new
`apps/amos/src/agent/AgentRunner.ts:134` candidate path and Stage 12 foreign-scope tests.

Agent.resume constructs/registers an Agent, then awaits session loading without
failure cleanup. A scope rejection leaves the candidate retained by AgentRegistry.
The caller receives only the rejection, so cannot destroy that returned-never
instance. Repeated failures retain listeners/context/provider references and
create phantom idle agents. This is an existing cross-stage lifecycle defect
exposed by the Stage 12 rejection/cleanup coverage, rather than a new resume API.

Reproduction: checkpoint workflow state, change the receiving evidence/task owner
and initialize again. Restoration correctly rejects with Evidence invalid and the
previous runner stays ready, but AgentRegistry.count increases by one.

Fix: destroy unsuccessful resume candidates while preserving the original load
error and host-owned resource ownership. Add direct public resume and AMOS failure
regressions checking registry/listener/timer cleanup, unchanged old history and
repeated failed attempts. No signature or saved-format change is needed.

## F04 — P2: inspection clones representations instead of projecting capabilities

Location: `src/core/Agent.ts:4401–4402`.

A structurally valid ModelCapabilities class with prototype getters supports real
managed execution, but structuredClone produces an empty object. Inspection then
returns provider={} despite its public type requiring capability fields. Whole
object cloning also includes additional enumerable fields outside the declared
capability contract; a dummy privateDiagnostic sentinel appears in the report and
would be printed by AMOS. No real secret was used or exposed in the reproduction.

Fix: read/project declared basic and advanced capability fields into detached data,
validate relevant scalar/list shapes and omit unrelated provider fields. Preserve
getter-backed and ordinary class providers; do not require an entire SDK-facing
object to be cloneable. Extend tests to prototype getters, nested advanced getters,
extra fields/functions, mutation isolation and no model/storage calls. Update the
new cloneability limitation and its current test expectation accordingly.

## F05 — P2: preset assembly drops opaque plugin configuration

Location: `src/core/presets.ts:71`.

Every plugin configuration is spread into a plain object. Indexed class configs
with prototype getters or private implementation state lose their settings.
A registered extension receives limit=7 through ordinary Agent.create, but the
same configuration passed through the preset arrives with limit undefined. The
class is assignable to the public Record<string, unknown> plugin contract; this
is not an unsupported live AgentContext.

Fix: detach configuration maps while retaining opaque/class-backed plugin configs
and their receivers, consistent with the existing host-object preservation rule.
Only copy records where their semantics survive copying. Add real PluginRegistry
integration tests for getter/private-field-backed configs, host object identity,
plain record overrides and disabled factory inactivity.

## F06 — P2: presets accept replacements that do not provide their required protections

Locations: `src/core/presets.ts:77–100`; context initialization at
`src/core/context-nextgen/AgentContextNextGen.ts:524–533`.

PluginRegistry permits existing external evidence/taskState replacements. Preset
validation checks feature flags and config fields but does not establish that the
resolved plugins implement the built-in protections the compositions require.
A replacement named task_state is accepted and inspection reports taskState=true
although the built-in protected task-state guards are absent. A replacement named
evidence is accepted by research and fails later when compaction needs the built-in
evidence plugin: Transactional compaction requires the enabled built-in evidence plugin.

Fix: verify the required concrete capability at composition/admission, or report
that the selected composition is unsupported before model/action work. Keep ordinary
Agent and supported external plugin contracts intact; do not globally reserve or
remove legacy registry keys to conceal the mismatch. Cover incompatible replacements
for both features, verified compatible implementations, disabled features and actual
compaction/dispatch protection. Avoid adding a parallel provider/profile registry.
If a proposed contract restriction is truly breaking, obtain explicit approval
before implementing it.

## F07 — P2: ordinary autosave erases preset session metadata

Locations: `apps/amos/src/agent/AgentRunner.ts:539–545` and the existing
`src/core/BaseAgent.ts:620–626` periodic checkpoint path.

Explicit saves write agenticPreset/title, but periodic autosave calls context.save
without those values. That path rebuilds checkpoint metadata and FileContextStorage
replaces wrapper metadata with an empty object. With AMOS autosave enabled (its
default), the newly delivered preset tag disappears, as does the existing title.
The new tests explicitly disable autosave, which hides this interaction. The
underlying title-clearing behavior predates Stage 12; preset metadata persistence
is the new feature affected by it.

Reproduction: actual file-backed workflow runner, explicit named save, then an
ordinary timer tick. Wrapper metadata changes from {title: review-title,
agenticPreset: workflow} to {}; checkpoint agenticPreset also disappears.

Fix: retain descriptive metadata through every AMOS checkpoint/autosave path,
including unnamed saves and resume. Keep metadata non-authoritative and preserve
legacy storage/session contracts. Add timer-backed tests with default-enabled
saving, title/preset retention, save/load cycles, failures and cleanup. Avoid a
new workflow/storage framework for this metadata.

## Fix order and acceptance

1. Close F01 authority widening and F06 unsupported protection claims.
2. Fix F04/F05 data projection and extension compatibility.
3. Complete F02/F03 app replacement and rejected-candidate cleanup.
4. Fix F07 metadata retention through actual autosave/session paths.
5. Add meaningful regressions for all nine observations. Retain existing Stage 00–12
   controls; run focused checks first, then full unit/build/type/lint/examples/public
   compatibility and AMOS gates. Rerun live preset/baseline checks when final runtime
   changes affect their paths; do not substitute a passing rerun for a diagnosed fix.
6. Update recipe, generated API if signatures change, Version 2 availability/adoption/
   handoff, stage record and packaged validation evidence before restoring completion.

Use additive or corrective implementation and preserve ordinary Agent defaults,
custom providers/plugins, public signatures, existing event/result/session shapes
and storage interfaces. No breaking change is proposed by this review. Do not
implement an actual API break without the user's separate explicit approval.

## Corrective completion — 2026-10-16

All seven findings are fixed. The nine reproduced observations now have permanent
regressions, supplemented by owner mutation, opaque symbol/accessor receivers,
actual app/command handoff, background delivery, interrupted raw evidence,
caller-owned resources and overlapping old/new autosave adapters.

| Finding | Delivered correction |
| --- | --- |
| F01 | Force the validated host principal into the composed context; undefined inherited settings cannot erase authority. Enabled preset scopes are checked again at managed admission, including after host owner changes. |
| F02 | The real AmosApp loads/validates a candidate before swapping/destroying the old runner or resetting steering. Failure restores session pointers and cleans the candidate. Fresh replacement checkpoints unstored observations; failed checkpoints abort handoff. Active/background execution prevents replacement. SessionCommand delegates pointer clearing to the successful handoff. |
| F03 | Agent.resume destroys failed candidates before rethrowing the original load error. Registry entries, listeners and timers are released; caller-owned context/storage survive. Optional existing session settings, including autosave, are now accepted by its public type. |
| F04 | Project only declared basic/advanced capability fields, including getter-backed/nested class instances; validate scalar/list values locally. Extra fields/functions are omitted without traversal and report mutations are isolated. |
| F05 | Copy outer plugin maps and plain data records; preserve class/accessor/symbol-backed configurations and host receivers/objects. Disabled factories stay idle. |
| F06 | Preset-generated context carries internal host-local requirements. Creation and final managed admission verify actual built-in protections and selected scope/backend/task/association. Compatible built-in factories work; incompatible replacements reject before model/action work. Ordinary custom plugin contracts remain unchanged. |
| F07 | An AMOS-only FileContextStorage adapter retains titles/preset labels in checkpoint and listing for every save path. It serializes checkpoint saves per process/location, including old/new runners, and recovers after failed saves. Resume retains configured autosave. Library storage defaults/formats are unchanged. |

There is no new workflow engine, plugin/profile registry, wire/session version or
implicit authority. The requirement symbol and projection functions are internal;
session/portable metadata cannot restore them. The AMOS adapter/session-change
callback is application-local. Preset names still never confer permission or
workflow-completion authority. No breaking API was proposed or implemented.

Fresh final validation against stable source:

- **8,073 unit tests / 365 files**, including **35 new corrective regressions**
  and **83 total Stage 12 preset/AMOS cases**.
- **148 live tests / 160 scenarios / nine suites** across OpenAI, Anthropic and
  Google: presets, baseline, context freshness, tools, model tasks/helpers,
  evidence, strategies, task state and loop policies. Zero final failures/skips
  or unavailable providers. Fixtures make no real external service writes.
- **24 offline examples**, **32 ESM/CJS public runtime controls**, built public
  consumer compatibility, strict core/AMOS test checking, root/AMOS builds,
  types/lint/examples and generated API all pass. Build verifies 24 export files.
- Selected factory/inspection/command/AMOS-storage coverage is **100% lines /
  97.09% branches**; this is not whole-Agent/context coverage.
- Package inventory verifies the new corrective artifacts and existing public
  surfaces. Recipe, generated API, standard guides, AGENTS, examples/index, AMOS,
  release notes, stage/roadmap and Version 2 availability/adoption/handoff are synced.

The earlier review/delivery/live artifacts remain immutable historical evidence.
Development fixture failures and the outdated pre-existing mock are recorded in
[corrective validation](../evaluations/STAGE_12_CORRECTIONS.json), with the
[offline transcript](../evaluations/STAGE_12_CORRECTIONS_OFFLINE.txt). All final
checks pass; no observed failure is deferred or described as successful validation.
Branch completion is restored; publication and conditional scope remain separate.
