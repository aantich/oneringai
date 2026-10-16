# Opt-in Agent presets and capability inspection

Available on the Version 2 development branch; this does not establish a published
package release. The [third corrective completion](designs/STAGE_12_THIRD_REVIEW_AND_FIX_PLAN.md#third-corrective-completion--2026-10-16)
records the shared-resume, JSON serialization and plugin recovery fixes and their validation.
Ordinary `Agent.create(config)` keeps its existing defaults.

`createAgentPreset(name, config)` returns an ordinary `AgentConfig`. It performs no
connector lookup, credential access, model call, storage IO or agent creation.
There is no separate execution engine or provider profile registry.

| Setting | `research` | `workflow` |
|---|---|---|
| Intended use | Long-running assistant/research | Evidence-aware host workflow |
| Context strategy | `observation-masking` | `algorithmic` |
| Evidence | Enabled | Enabled |
| Protected task state | Existing default (disabled) | Enabled |
| Main-loop iterations | 12 | 8 |
| Managed loop policy | Enabled, existing defaults: 2 recovery attempts | Same |
| Helper model / host completion callback | None supplied | None supplied |
| Tool permissions, connectors and task budgets | Supplied by host | Supplied by host |

Existing working/in-context memory defaults remain enabled. The compositions do
not add tools, prompts, background work or authority beyond their selected existing
features. They do not improve a model's intrinsic capabilities. The Stage 07
comparison remains a bounded functional pilot, not evidence of general quality or
cost improvements from preset selection.

## Create an explicitly scoped workflow

```typescript
import {
  Agent, createAgentPreset, FileEvidenceStorage, TaskStatePluginNextGen,
} from '@everworker/oneringai';

// A named AI connector must already exist. Identity and scope come from host auth.
const scope = { ownerId: authenticatedUser.id, namespace: 'invoice-review' };
const agent = Agent.create(createAgentPreset('workflow', {
  connector: 'main',
  model: 'gpt-4o-mini',
  userId: scope.ownerId,
  context: {
    plugins: {
      evidence: {
        scope,
        storage: new FileEvidenceStorage({ directory: './data/evidence', scope }),
      },
      taskState: { scope, taskId: trustedTask.id },
    },
  },
  tools: invoiceTools,
  // Host code must verify actual authorized state/evidence. Never inspect prose alone.
  loopPolicy: {
    completion: async () => ({ complete: await hostInvoiceCheck(trustedTask.id) }),
  },
}));
try {
  agent.context.getPlugin<TaskStatePluginNextGen>('task_state')!.updateHost({
    notes: [{ id: 'objective', category: 'objective', text: 'Verify the invoice.', source: { label: 'host' } }],
  }, 0);
  console.log(agent.inspectCapabilities());
  const response = await agent.run('Review the invoice using the supplied tools.');
  console.log(response.output_text, response.loop);
} finally {
  agent.destroy();
}
```

`authenticatedUser`, `trustedTask`, `invoiceTools` and `hostInvoiceCheck` above are
application-owned values. For a standalone runnable example use
[`agentic-presets.ts`](../examples/agentic-presets.ts).

Selecting `research` uses the same host evidence configuration without requiring
task state. Use an explicitly scoped `InMemoryEvidenceStorage` for experiments;
it acknowledges process-local storage only. File storage provides its declared
local durability, not remote replication. Capture/projection failure must never
cause an external action to be repeated; follow the [evidence recovery recipe](DURABLE_EVIDENCE.md).

## Overrides and preflight

Existing Agent options remain the configuration language. Explicit `maxIterations`,
`context.strategy`, `context.compactionStrategy`, feature flags and plugin settings
win. `compactionStrategy` has the existing precedence over the strategy name.
Feature maps merge by key; undefined entries are absent, false disables. Plugin
containers and plain data records are copied by key. Accessor-backed records and
opaque/class-backed plugin configurations retain their receiver and identity, as do
host stores, connectors, strategies, tools and policies. Undefined context values
do not erase inherited settings; the validated host userId is always the effective
context principal. This is
not deep cloning or freezing of host configuration. Class-method loop policies
retain their receiver and private host state.

`loopPolicy: null` disables preset recovery. An explicitly supplied policy keeps
its object identity and uses the managed loop's existing omitted-value defaults.
`modelExecution` and its helper roles/task limits are entirely explicit. The preset
chooses no “cheap model”, creates no hard task budget, and grants no cross-connector
context transfer. To opt into summaries, configure a compactor and select
`structured-summary`; read [helpers and task budgets](MODEL_TASKS_AND_HELPERS.md)
and [context strategies](CONTEXT_STRATEGIES.md), including output headroom,
transfer permission, usage uncertainty and bounded repair.

To disable evidence, also select a compatible strategy:

```typescript
const plainComposition = createAgentPreset('research', {
  connector: 'main', model: 'gpt-4o-mini', loopPolicy: null,
  context: { strategy: 'algorithmic', features: { evidence: false } },
});
```

No evidence configuration/userId is required when evidence and task state are
both disabled. Existing default scratch plugins remain enabled unless explicitly
disabled. No disabled preset feature contributes content, tools or helper calls.

Preflight rejects unknown presets/strategies, unavailable enabled extension
features, malformed feature values/iteration limits, conflicting context model or
principal, masking without evidence, summaries without a configured compactor,
missing evidence scope/backend, mismatched user/storage/scope, or missing/foreign
task state. Host-registered external plugins remain supported. Factory preflight
does not instantiate plugins. Agent creation and managed dispatch additionally
require the actual built-in evidence/task-state implementations for enabled preset
protections, with the selected backend, scope, taskId and association, including the effective
host owner after mutation. External
factories returning those implementations are supported; incompatible replacements
reject before model/action work. Ordinary Agents retain their existing replacement
contracts. These constraints are host-local configuration, never restored from
session metadata or a portable preset label. Preflight does not validate every
future execution option. Existing
Agent/provider admission validates requests, helpers, permissions and budgets.
Presets accept context configuration, not an existing live context to mutate.
Plain `Agent.create({ context: liveContext })` remains supported.

## Session restoration and cleanup

Preset scope requirements capture normalized owner/namespace/optional tenant
values, including stable prototype and non-enumerable getters. Actual plugins
still normalize and validate the supplied scope, and later mismatches reject.
This does not freeze the original host object or weaken dispatch protection.

High-level `agent.loadSession(id)` and `context.load(id)` validate evidence/task
scope, association and snapshot version before restoring any context state. The
active session ID commits only after successful restoration. Failed storage reads,
missing sessions and rejected protected state retain the previous target. Checkpoint
save/load/delete operations on one context are serialized; autosave and managed
explicit snapshots wait for restoration, so they cannot write tentative state into
either checkpoint. Independent contexts/backends still need their host's concurrency
policy. Perform loads while agent execution and host state edits are idle.

The existing `restoreContextState` extension hook remains in the Agent path.
Context/plugin snapshots roll back if that hook or the synchronous load notification
fails after mutation. Detached rollback snapshots use JSON serialization, including
own/prototype `toJSON` hooks and Date conversion, matching the existing plugin-state
contract. Serialization failure rejects before restoration. Custom plugins must
honor their JSON-serializable-state/restore contract; the library cannot undo a
hook's private/external side effects.

If a custom plugin also refuses rollback, subsequent saves reject until **every
affected plugin instance** has successfully restored from a valid checkpoint or
through trusted host `context.restoreState(goodSnapshot)`. Loading a legacy
checkpoint without that plugin keeps its existing missing-key behavior but does
not release the save guard. Key presence alone or a custom high-level restore hook
that ignores the plugin does not count as repair. Calling an individual plugin's
restore method directly is not tracked as context recovery; use the trusted context
path or rebuild the context if the plugin cannot recover. Restore hooks must not await checkpoint
save/load/delete on the same context; those operations wait for the hook to finish.

`context.save(id?, metadata?, snapshot?)` still accepts a supplied serialized state.
Its optional third argument also accepts a synchronous/asynchronous snapshot builder,
which runs after preceding checkpoint operations. Managed `saveSession` uses this
additive form for the existing overridable `getContextState`. `context.loadRaw(id)`
retains its legacy behavior: it selects a found session ID without validating or
restoring its state. It is an advanced host API, not the safe managed-load path.
No saved format, required config, storage interface, result or event field changed.

For `Agent.resume` with a caller-owned live context, known connector admission
precedes loading. Restoration, candidate construction and the synchronous loaded
notification participate in one checkpoint transaction. Rejection restores the
original permission policy, tool registrations, roles, prompt, compaction callback,
history and session ID **before** candidate cleanup. Partially initialized candidates
are cleaned as well, without destroying caller-owned context or replacing the
original error. Storage/preflight rejection preserves edits made while the backend
was reading. Successful resume uses the same caller-owned context, reads storage
once and emits the existing loaded notification once.
As with ordinary shared-context creation, the host coordinates successful ownership
handoff; one mutable context is not isolated execution for multiple concurrent Agents.

Destruction attempts every reachable owned plugin, store/tool manager and Agent
permission/listener resource even if an earlier destructor throws. Contexts finalize
as destroyed; repeat destroy is harmless and shared skip-destroy plugins remain
caller-owned. Direct destroy reports the first teardown error after cleanup.
Construction/resume rejection retains its original failure instead. A plugin remains
responsible for releasing its own private resources when its destructor fails.
The checkpoint queue, per-plugin recovery identities, synchronous admission callback,
ToolManager binding rollback and partial-construction capture are internal
coordination, not serialized policy or a new workflow/persistence framework.
This rollback does not undo model calls, external actions or arbitrary host listener
side effects. A successful shared-context handoff still needs host ownership coordination.

## Inspect the active managed Agent

`agent.inspectCapabilities()` returns detached metadata about the current model,
connector name, model-registry agreement, provider-reported basic and optional
advanced capabilities, actual context plugins/strategy/features/capacity, evidence
durability, configured helper roles, and default managed-loop enablement, iteration
cap and presence of a host completion check. It does not execute a model, storage
operation or helper. It excludes credentials, instructions, tool arguments,
observations, task text and storage paths. Destroyed agents reject inspection.
Only declared basic/advanced capability fields are projected into detached data,
including prototype/private-field getters and nested capability objects. Unrelated
fields, callbacks and provider internals are omitted without traversal; the whole
provider object need not be cloneable. Invalid declared scalar/list values fail
inspection locally without a model call.

Provider support and enabled managed features are different fields. Missing
advanced capability reporting stays absent. Registry absence/mismatch is visible;
inspection does not authenticate a key, guarantee custom-provider capacity, validate
semantic truth or claim workflow completion. It describes configuration rather than
a pending invocation's per-call overrides, current ModelTask usage or effective
permissions. Use `task.snapshot()`, `agent.getModelUsage()` and existing permission
inspection for those views. Without a host completion check, loop completion is
`answer_returned`, even in the workflow preset.

## Runtime and portable boundaries

Presets apply to managed Agent run/stream. Direct calls bypass managed context;
realtime and external SDK loops retain their existing owner. Selecting a context
strategy does not enable provider-native compaction or native tool search.
Use `RuntimeAgent.inspect()` for actual driver capabilities, not the managed Agent
report as a promise about external execution. Unsupported driver configuration or
required capabilities fail through the existing runtime validation.

For OneRingAIDriver, existing trusted host factories can return
`Agent.create(createAgentPreset(...))` using the factory's trusted principal.
Inspection does not instantiate such a factory. Inspect the created Agent for its
actual plugin configuration, or use an existing binding. Do not put a `preset`
field into a driver's `driverConfig` or start a second Agent loop to emulate missing
controls beside an external SDK.

No portable/session schema or protocol version changes. Receiving hosts reconstruct
context policy with the existing `contextFactory` and loop/helpers via trusted
`agentConfig`. Preset names, callbacks, credentials and backend objects are not
transferred as authority. Provider-local settings retain the existing export
exclusions and unsupported-field rejection. A legacy unscoped package may be
rehydrated with a new host-selected preset; an existing evidence/task checkpoint
is scoped data and rejects foreign ownership/task association. It must not be
silently rebound or stripped to make restoration pass.

## AMOS

Configure `evidence` in AMOS config.json with enabled=true, a directory, ownerId
and namespace; workflow also needs enabled `taskState` with matching scope and a
host-selected taskId. Then use:

```text
/preset inspect
/preset set research
/session new
/preset inspect
/preset set workflow
/session new
/preset set off
```

`/profile` is an alias. Selection is validated and persisted for the next agent
initialization, including `/session new` or another existing recreation action.
The live Agent/history stays unchanged when selection is saved. Inspection labels
active and saved choices separately. Preflight reads current settings; failed
persistence restores the previous value/property absence. Old configs with no
preset and explicit null retain their original behavior. Off removes preset
defaults on the next initialization; existing explicitly configured features remain.

`maxIterations`, `contextStrategy`, `loopPolicy`, `modelExecution`, `evidence` and
`taskState` are explicit overrides; keep strategy dependencies satisfied. AMOS
uses the public factory/inspection API and its existing AgentRunner. No helper or
host workflow-completion predicate is invented. Existing host-only loop overrides
are reflected in inspection. Explicit saves, unnamed saves and periodic autosave
retain the title and descriptive `agenticPreset` in both checkpoint and listing.
Resume retains configured autosave; loading metadata never selects a preset or
restores callbacks. The AMOS-only storage adapter orders overlapping checkpoint saves per process
and location (including old/new runners) and recovers its queue after failures; ordinary library storage defaults are unchanged.

The real app builds/loads a candidate before committing replacement or resetting
steering. Failed startup/load/scope/checkpoint validation keeps the prior runner
and session pointer usable and destroys failed candidates. A fresh session still
checkpoints retained unstored observations before releasing their raw copy; failed
checkpointing aborts the handoff. Active executions/background deliveries block
replacement. `Agent.resume()` also cleans failed candidates, including registry
entries, listeners and autosave timers, while preserving the original load error
and caller-owned context/storage. Its optional session settings remain usable.
Snapshots retain the existing scope/task checks and legacy loading behavior.

## Validation and examples

After building the root library:

```bash
npm run example:agentic-presets
npm run example:amos-presets
npm run test:agentic:compat
# Explicitly billable; OpenAI, Anthropic and Google keys in .env are required:
npm run test:presets:live
```

The offline examples show both presets, the plain baseline, overrides, diagnostics
and cleanup without network access. The live gate exercises both presets in run
and stream with actual providers and local synthetic reads, plus original-history
continuation after rejected resume, JSON plugin restoration and guarded legacy
recovery on every provider. It makes no external writes. It is a functional integration check, not a model-quality benchmark.

The latest correction gate passes 8,143 units, 151 live tests / 163 scenarios across
all three providers (nine-suite batch plus three focused session cases), 24 offline
examples and 54 ESM/CJS public controls. All four third-review observations verify
the fixes; 27 new unit regressions cover actual AMOS commands, file storage,
permissions, JSON extension state and plugin recovery. Earlier validation remains
historical; see the [fresh record](evaluations/STAGE_12_THIRD_CORRECTIONS.json).
No package release is claimed.
