# Stage 04 second review and fix plan

Reviewed 2026-10-15 on `version2`, against the corrective delivery based on
`152a0a3712ec294509cb95257a63df8add47bf92`.

**Current status: both compatibility findings fixed and validated on 2026-10-16.**
The previous four runtime findings remain fixed, and Stage 04 completion is restored
on branch. See the [corrective completion](#corrective-completion--2026-10-16) and
[evidence](../evaluations/STAGE_04_SECOND_CORRECTIONS_VALIDATION.json). The findings
and checks below describe the historical review. No package release or Stage 10
implementation is claimed.

The review covered note/correction/conflict/pruning invariants, action identity and
confirmation, bounded recovery, memory permissions/cancellation, asynchronous
preparation/rollover, final dispatch/repair, snapshot preflight, plugin registry
extension behavior, public declarations, AMOS host commands and examples. No
additional runtime defect was reproduced. All 45 delivery/build fingerprints
matched the previous corrective record before review documentation changed.

[Executable review evidence](../evaluations/STAGE_04_SECOND_REVIEW.json) retains
the consumer, compiler probe, runtime control, diagnostics, checks and fingerprints.
The comparison removes only the two new optional members from an in-memory copy
of the current declaration chunk; their previous shapes were checked against
`git show HEAD:src/core/context-nextgen/types.ts`. It is a controlled declaration
comparison, not a rebuilt historical package. Neither installed declarations nor
runtime files were modified.

## R1 — P2: An optional feature becomes mandatory in an existing exported type

Location: [new feature member](../../src/core/context-nextgen/types.ts#L764), through
[ResolvedContextFeatures](../../src/core/context-nextgen/types.ts#L802).

`ResolvedContextFeatures` is exported by the public package and uses
`Required<KnownContextFeatures>`. Adding `taskState?: boolean` therefore makes
`taskState` required in that existing type. A consumer that constructs the
previous eight-field resolved feature object now fails with TS2322, even when
task state is disabled. This also affects typed snapshot/configuration fixtures
and adapters that construct resolved feature values. Spreading the current
`DEFAULT_FEATURES` in the existing compatibility fixture masks the regression.

The tested legacy value contains `workingMemory`, `inContextMemory`,
`persistentInstructions`, `userInfo`, `toolCatalog`, `sharedWorkspace`, `memory`
and `memoryWrite`. It compiles with the previous feature declaration and fails
against the current built public package because `taskState` is missing.

**Fix:** Preserve the existing public resolved-feature construction contract while
retaining runtime normalization to `taskState: false`. Avoid coupling every new
optional feature to a newly required consumer member; keep any stronger internal
normalized representation separate where needed. Do not require applications to
add a field merely to continue compiling with a disabled opt-in capability.

**Regressions:** Compile the unchanged legacy object against built public exports,
including its use in public snapshot/configuration fixtures. Verify new explicit
task-state flags/configuration and normalized runtime defaults still work. Keep
the legacy fixture independent of the current `DEFAULT_FEATURES` spread.

## R2 — P2: Built-in configuration narrows a supported external plugin key

Location: [KnownPluginConfigs.taskState](../../src/core/context-nextgen/types.ts#L833).

Before Stage 04, `PluginConfigs` accepted arbitrary record configuration for the
external `taskState` feature key. `PluginRegistry` still permits that key, and
initialization explicitly selects the external factory instead of the built-in
when it is registered. The new known property nevertheless requires
`TaskStatePluginConfig`, so existing custom configuration such as
`{ taskState: { existingCustomOption: true } }` now fails with TS2739 for missing
`scope` and `taskId`. Runtime extension precedence was preserved, but its public
TypeScript configuration contract was narrowed.

**Reproduction/control:** Register a `legacy_task_view` factory using
`featureKey: 'taskState'`. The unchanged custom configuration initializes and
prepares correctly in source, public ESM and public CJS, with zero provider calls
and without creating the built-in task plugin. The same configuration compiles
with the previous declaration and fails with the current public declaration.
The existing same-plugin-name compatibility test does not exercise this feature
key and custom configuration path.

**Fix:** Retain the previously supported arbitrary record configuration for
registered external factories while still exposing the explicit
`TaskStatePluginConfig` for built-in consumers. Preserve built-in runtime
validation and external factory precedence. Reserving the formerly available
key or requiring custom plugins to supply irrelevant scope/task fields would be
a breaking workaround and is not approved.

**Regressions:** Add an unchanged custom-registry consumer to the built-package
type gate and an actual factory/configuration/preparation test. Cover public
ESM/CJS, cleanup, disabled behavior, normal built-in opt-in configuration and
rejection of a missing built-in scope/task when no external factory exists.

## Validation and fix sequence

1. Correct the two declarations without changing runtime defaults, required
   session/storage/runner fields or existing extension precedence. Add both
   unchanged legacy consumers before relying on the aggregate compatibility gate.
2. Build, regenerate public API documentation, and compile the root/public type
   entry points and relevant fixtures. Do not hand-edit bundled declarations.
3. Run focused Stage 04 tests, full units, root/strict/example/AMOS types, lint,
   public ESM/CJS controls and the two task-state offline examples. Broaden to
   real-provider gates if a runtime/model dispatch change becomes necessary.
4. Update current availability/adoption/handoff and record final corrective
   results before restoring Stage 04 completion. Preserve all historical
   delivery, review and corrective artifacts unchanged.

Fresh review checks:

- **7,784 units / 356 files**, zero failures/skips in the final full run; all
  **153 Stage 04 tests** also passed separately.
- Root typecheck, lint, existing built-package compatibility fixture and example
  typecheck pass. The two new adversarial public consumers fail as documented;
  existing green compatibility checks do not cover these shapes.
- Both task-state offline examples pass. Source/public ESM/CJS external-registry
  controls pass with zero model calls.
- The first sandboxed full suite had four localhost HTTP/WebSocket fixture
  failures (`listen EPERM`); the unchanged full suite passed with local socket
  access. This environmental failure is retained in the evidence.
- No new build or live LLM run was needed: reviewed source and built fingerprints
  matched the preceding corrective validation. Its 117 live cases / 129 scenarios
  remain historical evidence, not a fresh result of this review.

The fixes should preserve compatibility, not introduce a new context abstraction
or plugin registration system. No breaking API proposal or implementation is
authorized by this review. Stage 10 remains separately authorized work after
Stage 04's compatibility gate is restored.


## Corrective completion — 2026-10-16

The user authorized all fixes. Both second-review findings are fixed without
changing production execution logic or requiring a configuration/session migration.
Stage 04 completion is restored on the uncommitted `version2` tree based on
`152a0a3`. No breaking API proposal, release, commit, push or Stage 10 work.

- **R1:** `ResolvedContextFeatures` keeps the original eight fields required;
  later known additions remain optional. The required set no longer grows whenever
  a feature is added. Runtime defaults still include `taskState: false`. Root and
  `/types` consumers construct unchanged feature values and snapshot fragments
  without spreading current defaults. New optional flags remain inspectable;
  normalize absent flags when consuming legacy/application-created values.
- **R2:** The generic known `taskState` configuration accepts either the explicit
  `TaskStatePluginConfig` or an external factory's record. Strict built-in callers
  can use the exported type/`satisfies`; missing required built-in fields remain
  a compile error in that type and are rejected at runtime without an external
  factory. Existing registry precedence and disabled behavior are unchanged.
- **Regressions:** A new public consumer fixture reproduces nine compiler diagnostics
  before the fix across root/type-only feature/snapshot/configuration values; all
  compile after the real build, without suppressing those legacy assignments.
  An intentional negative built-in type assertion checks its required scope/task.
  Eleven runtime regressions cover default normalization, disabled factories,
  custom configuration/preparation, real file recovery, failure propagation,
  missing built-in fields, removal/selection and idempotent cleanup. Eighteen
  source/public ESM/CJS observations verify those boundaries; the original review's
  consumer compiles unchanged against the installed declarations.

Final validation: **7,795 units / 357 files**, including **164 Stage 04 cases**;
all pass without failures/skips. Build/export verification (24 files), root and
strict source/live/AMOS test types, expanded built-package compatibility, example
types, lint, AMOS build, both task-state offline examples and regenerated public
API documentation (**1,682 items**) pass. The first build was blocked by sandboxed
`tsx` local IPC (`listen EPERM`); the unchanged build passed with IPC access. The
expected pre-fix compiler failure and environmental build attempt are retained.

Only production type declarations/comments were edited in this pass; generation
also refreshed transitive tool implementation fingerprints. Agent/context/tool
execution implementations, plugin limits/defaults, session shapes and host
authority remain unchanged. No new billable LLM run was necessary. The previous
117 live cases / 129 scenarios remain historical evidence, not fresh validation
for this corrective pass.

Recipe/standard guides, generated API, example index, release notes, stage/roadmap,
Version 2 availability/adoption/handoff and packaged evidence are synchronized.
No new AMOS command or example behavior is needed for these type contracts; its
actual adapter/command/session tests, types, build and offline walkthrough pass.
Existing demonstrations remain current. Historical delivery, review and first
corrective JSON records remain unchanged.
