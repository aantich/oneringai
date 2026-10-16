# Protected task state

Stage 04 is opt-in branch functionality. Package version 1.2.0 is unchanged; a
published release has not been verified. `taskState` is disabled by default.

**Current review status:** Both reviews' findings are fixed and validated on
branch. The [second corrective completion](designs/STAGE_04_SECOND_REVIEW_AND_FIX_PLAN.md#corrective-completion--2026-10-16)
restores legacy public feature/configuration typing; its
[evidence](evaluations/STAGE_04_SECOND_CORRECTIONS_VALIDATION.json) includes 7,795
units and unchanged public consumers. Earlier review/corrective evidence and
failed diagnostic attempts remain historical. No package release or breaking
change is claimed.

The plugin keeps a bounded, host-controlled task view separate from conversation
prose. It stores objectives, constraints and corrections, decisions, questions,
artifacts, execution receipts and optional lifecycle observations. It does not
extract state automatically, schedule work, prevent duplicate external effects,
or guarantee that an LLM follows every constraint.

## Enable one host-selected task

Use the exported `TaskStatePluginConfig` when declaring built-in configuration so
TypeScript checks its required host scope and task ID. Generic `PluginConfigs`
also accepts arbitrary record configuration for existing external factories using
the `taskState` feature key; a registered factory retains precedence. Without one,
the built-in still validates its scope/task at runtime. Disabling the feature adds
no task plugin, content or tools, even when an external factory is registered.

`ResolvedContextFeatures` preserves its original eight required feature fields.
Later additions such as `taskState` remain optional in constructed legacy feature
values/snapshot fixtures. Live contexts continue to normalize `taskState: false`
when it is omitted; use `features.taskState ?? false` when inspecting a feature
value that may come from an older snapshot or application adapter.

```typescript
import { Agent, TaskStatePluginNextGen } from '@everworker/oneringai';
import type { TaskStatePluginConfig } from '@everworker/oneringai';

const taskConfig = {
  taskId: 'delivery-42',
  scope: { ownerId: 'host-user', namespace: 'deliveries', tenantId: 'tenant-a' },
  association: 'host-workflow-42', // optional immutable host association
} satisfies TaskStatePluginConfig;

const agent = Agent.create({
  connector: 'main',
  model: 'gpt-4o-mini',
  userId: 'host-user',
  context: {
    model: 'gpt-4o-mini',
    features: { taskState: true },
    plugins: { taskState: taskConfig },
  },
});
const task = agent.context.getPlugin<TaskStatePluginNextGen>('task_state')!;
task.updateHost({ notes: [{
  id: 'budget', category: 'constraint', text: 'Spend at most 50 EUR.',
  source: { label: 'Confirmed user instruction', turnId: 'turn-1' },
}] }, task.revision);
task.updateHost({ notes: [{
  id: 'budget-correction', category: 'constraint', text: 'Spend at most 40 EUR.',
  supersedes: 'budget', source: { label: 'User correction', turnId: 'turn-2' },
}] }, task.revision);
```

Scope, task selection, sources and host assertions come from the application's
trusted authorization layer. The scope's owner must match `context.userId` when it
is set; subsequent owner changes make plugin access fail. Choose a new context for
a different task. `association` can bind a stable application workflow/session ID;
it is not automatically derived from the library's generated session ID. Changing
task/scope/association requires a distinct plugin/context; there is no task-switch
mutation API. A plugin instance belongs to one context and must not be shared.

`updateHost(delta, expectedRevision)` admits an atomic batch of new notes and
resolutions. New IDs are unique among retained notes. Corrections reference an
active same-category note through `supersedes`; history retains its `supersededBy`
link. `conflictsWith: ['other-id']` records conflicts explicitly without choosing a
winner. `resolve: ['question-id']` records a host resolution. Categories are
`objective`, `constraint`, `decision`, `question`, and `artifact`. Sources require
`label`, with optional `turnId` and an existing scoped `EvidenceReference`.
An evidence pointer is a citation; it does not independently verify a decision.

## Keep observations and proposals below host authority

`propose(notes, revision)` and `assume(notes, revision)` let the host submit model
interpretations and assumptions as explicitly unconfirmed data. Preserve source
and uncertainty. They cannot supersede any note. A host can adopt a proposal by
adding a new host note that supersedes it, or resolve it without adoption. The
plugin exposes no model-facing mutation tools and no `store_*` handler. Neither
model text nor tool output can call `updateHost` or `confirmAction` by itself.
Hosts must not blindly promote extracted/tool text to host assertions or expose
these methods through a generic model-controlled invocation endpoint.

The existing `agent.invokeHelper('extractor', ..., { schema, modelTask })` remains
an explicitly selected, stateless way to obtain proposals. No helper is invoked by
this plugin, and no plugin extraction settings are restored from sessions. The
live probe verifies a bounded synthetic extraction path; broad extraction accuracy
has not been evaluated and no automatic flawless extraction is claimed.

## Record execution without inventing remote completion

```typescript
const observed = await agent.tools.executeWithOutcome('submit_delivery', args);
// The host retains observed even if notebook admission fails.
task.recordAction(observed.outcome, task.revision);
task.confirmAction(observed.outcome.executionId, 'waiting_external', {
  label: 'Submission accepted; host completion condition requires remote delivery',
}, task.revision);
// Later, after checking the remote system against the host completion condition:
task.confirmAction(observed.outcome.executionId, 'completed', {
  label: 'Host verified the remote delivered status',
}, task.revision);
```

`recordAction` trusts the host to route authentic outcomes belonging to this task;
it cannot independently authenticate an arbitrary outcome object. Recording is
explicit. Enabling the plugin does **not** subscribe to tools or
record every action automatically. A host can route trusted `tool:complete`
outcomes into it. Receipts keep execution/call/run IDs, status, completion,
cancellation, timing and optional evidence acknowledgement; raw returns, arguments
and error prose stay in the original outcome/evidence/history. Identical receipts
are idempotent. Correlated unknown completion can settle later; admitted identity
cannot change and settled execution fields cannot regress. Evidence references can
be repaired separately. `confirmation` is a separate host workflow status with a
required source; it never changes execution diagnostics. A succeeded/settled tool
may only mean the remote service accepted a job. Timeout/cancellation with unknown
completion does not prove whether an external write happened.

Admission failure is a local notebook failure, not an action failure. Retain the
original outcome/evidence, resolve the capacity/revision issue, then record that
same observation; never repeat a write just to repair task state. Failed notebook
recording has no automatic raw-result retention/replay mechanism. Use Stage 03
evidence for exact action arguments/results and its acknowledged durability.
This stage supplies no exactly-once guarantee or journal/retry policy.

## Reuse the existing lifecycle authority

Configure an optional immutable `lifecycle: { kind, id }` binding. For `kind: 'task'`
or `'routine'`, call `syncLifecycle(view, revision)` with the host-owned current
status. It reuses `TaskStatus` or `RoutineExecutionStatus` respectively. This is a
cached view and does not transition the Task or routine.

For `kind: 'memory'`, call
`await task.refreshMemoryTask(memory, trustedScope, revision, signal)` with the
existing MemorySystem and a host scope whose `userId` matches the task owner.
Existing MemorySystem permissions/principals still apply. The linked entity must
be a visible `task`; the cached state comes from `entity.metadata.state`, preserving
memory's own state vocabulary. The host transitions it through
`MemorySystem.transitionTaskState(id, state, options, scope)` and explicitly
refreshes afterward. No parallel state facts are created, and a cached lifecycle
view does not override memory. Cancellation, concurrent revision changes, restore,
or destruction prevents a pending refresh from committing. Clients, principals,
and transition configuration are never restored from task snapshots.

## Capacity, compaction and request integrity

Defaults are 100 combined notes/actions, 8,000 estimated content tokens, and 256 KiB
of strict JSON per input/snapshot (`maxEntries`, `maxPromptTokens`,
`maxSnapshotBytes`). Text/source/ID fields also have bounded lengths. Inputs must
be plain, bounded JSON; accessors, custom serialization, cycles and unknown fields
are rejected for task-state records; evidence references use the existing evidence
validator. Optional undefined top-level outcome fields and `error` are omitted
from action receipts. No note/action is evicted automatically. The full view,
including historical and unconfirmed records, consumes the normal context budget;
its instructions and request overhead are counted separately.

`pruneResolved(noteIds, executionIds, revision)` removes only explicitly resolved
or superseded notes and host-confirmed terminal actions. Active notes and
unconfirmed/pending actions remain protected. Retained historic links may refer to
IDs deliberately pruned by the host; pruning does not create an archive or delete
source evidence. Save/archive externally before pruning when audit history matters.
IDs may be reused after pruning, so hosts needing stable permanent correlation must
allocate globally unique IDs themselves. When an absent ID is reused, obsolete
correction/conflict links to its pruned incarnation are detached before adding the
new record. Already historical predecessors stay resolved/inactive, including reuse
by a proposal or assumption; unrelated live chains and active assertions remain
unchanged. Every committed candidate passes the same consistency validation as a
restored snapshot. Pruned links can remain until reuse, without rebinding to new data.

At an exact token/byte boundary, use an explicit atomic host delta so only the final
state must fit:

```typescript
task.updateHost({
  resolve: ['finished-question'],
  prune: { noteIds: ['finished-question'] },
}, task.revision);
// After the host verifies the required terminal remote condition:
task.updateHost({
  confirmActions: [{ executionId, status: 'completed', source: { label: 'Host verified remote delivery' } }],
  prune: { executionIds: [executionId] },
}, task.revision);
```

Optional `confirmActions` and `prune` extend `TaskStateHostDelta`. Notes, resolutions,
confirmations, then explicit pruning form one revision-checked transaction. The
final snapshot must satisfy all original limits; the delta itself must still fit
the input JSON limit. Invalid source/status/target or final overflow leaves all
state unchanged. Pruning still requires resolved/superseded notes or host-confirmed
terminal actions. No automatic eviction, confirmation, external action, or retry
is added. Archive proof/receipts first when audit retention matters: an explicitly
pruned confirmation is not retained in the notebook. Existing calls remain supported.

The plugin is noncompactable under algorithmic, masking, structured-summary and
explicit rollover paths. Preparation rebuilds after a task update; stale async
rollover/summary proposals are rejected. Managed `run`/`stream` dispatch validates
the current generation and exact full task view in a developer instruction
contribution after hooks/listeners, including a recheck after final budget observers
and on tool-free repair. Removing/modifying it fails before provider
dispatch. JSON formatting/repair retains the current task view and checks fit
without an extra compaction pass. If protected state does not fit, preparation or
final dispatch fails explicitly; reduce state through validated host resolution
and pruning, or select adequate capacity.

`runDirect`/`streamDirect` intentionally bypass managed context and do not include
this task view. Changes after a request is already sent cannot revoke it or prove
what a remote system did. Prompt presence and authority labels are structural
safeguards, not a proof of model obedience or factual/semantic truth.

## Persistence and failure handling

`context.save/load` and the existing Agent session APIs persist an optional
`pluginStates.task_state` version-1 snapshot. Configure the plugin and any memory
or evidence backend again on resume. Preflight rejects unsupported versions,
foreign scopes/tasks/associations/bindings, malformed fields and capacity overflow
before replacing conversation. No new required session field/backend method is
introduced. A legacy snapshot without task state clears the enabled notebook,
rather than inheriting notes from a previous session. Snapshots are host-owned
checkpoints, not signed authority records: never restore arbitrary model/tool JSON
as a trusted session. With task state disabled its saved entry is ignored by the
normal plugin restore path, preserving legacy behavior.

Updates require the current revision; stale callers get `TASK_STATE_CONFLICT`.
Inspect `getState()` before deciding whether to retry. Mutation methods return a
detached snapshot. `getContents()` exposes the same view through existing context
inspection. Other error codes include `TASK_STATE_INVALID`, `TASK_STATE_SCOPE`,
`TASK_STATE_CAPACITY` and `TASK_STATE_DESTROYED`; evidence field validation can also
raise existing evidence validation errors. Destruction releases the plugin's
context binding and rejects subsequent operations.

## Examples and AMOS

Build first, then `npm run example:task-state`. The offline walkthrough demonstrates
correction, an unconfirmed proposal, a single simulated accepted submission,
waiting across rollover and a file checkpoint, separate-process recovery and host
completion confirmation. It makes no LLM calls and removes temporary files.

AMOS accepts optional `taskState: { enabled: true, taskId, ownerId, namespace,
association? }` configuration. With evidence enabled, both owners must match.
`/context task` shows notes, proposals, receipts, pending confirmations and lifecycle.
Host commands are:

```text
/context task add 0 constraint cap Spend at most 50 EUR
/context task correct 1 cap cap-corrected Spend at most 40 EUR
/context task resolve 2 question-id
/context task prune 3 question-id
/context task resolve-prune 4 another-question-id
/context task prune-action 5 already-confirmed-execution
/context task confirm-prune 6 execution-id completed Host verified final remote status
/session save
```

`prune` removes resolved/superseded notes, and `prune-action` removes already host-
confirmed terminal actions. `resolve-prune` and `confirm-prune` provide explicit
atomic recovery at capacity; the latter requires a terminal status and host proof.
Capacity errors point to these host commands. They do not grant model authority.
Edits use the current revision, reject during execution, and change in-memory
state. The existing explicit session-save/checkpoint flow persists them. Inspect
and host edit commands make no LLM/helper call. Model-produced command text stays
text. AMOS does not automatically record execution receipts or connect a memory
lifecycle; applications use the host APIs for those. Run
`npm run example:amos-task-state` for the real adapter/command offline walkthrough.
Opt-in real-provider probes use `npm run test:task-state:live` and `.env`; they are
billable and verify synthetic run/stream/restart and explicit helper paths.
