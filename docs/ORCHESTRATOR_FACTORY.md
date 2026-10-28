# Complete host configuration for orchestrated agents

`createOrchestratorWithFactory(config, options)` is an opt-in companion to
`createOrchestrator()`. It returns a normal `Agent` and uses the same five tools,
shared workspace, delegation and monitoring engine. Existing orchestrator and
synchronous worker factory signatures/defaults are unchanged.

```typescript
import { createOrchestratorWithFactory, ModelTask } from '@everworker/oneringai';

const parent = await createOrchestratorWithFactory({
  connector: 'main', model: 'gpt-4o-mini',
  agentTypes: { researcher: { systemPrompt: 'Research authorized material.' } },
}, {
  configureAgent: async ({ role, type, name, baseline }) => ({
    ...baseline,
    // Resolve each role/type independently under host authorization.
    ...await hostResolveAuthorizedConfig({ role, type, name }),
  }),
  onChildOutcome: observation => hostRecordObservation(observation),
});
const task = new ModelTask({ limits: { maxCalls: 12 } });
try {
  const response = await parent.run('Research the approved topic.', { modelTask: task });
  console.log(response.output_text, task.snapshot());
} finally {
  parent.destroy();
  // Destroy borrowed tasks only after their admitted work/receipts are settled.
}
```

The host functions are application code. Configure named connectors before
construction. The library does not resolve tenant authority from model arguments.
The [offline runnable example](../examples/orchestrator-factory.ts) needs no keys:
build, then `npm run example:orchestrator-factory`. It verifies distinct root/worker
settings in actual requests, delegated execution plus an active monitor on one
task, and cleanup. Its expected result is two shared-operation calls (plus one independent root configuration probe) and `passed: true`. The selected factory forwards root inference/cache/data controls to its owned monitor call; standalone runDirect and legacy monitoring keep their defaults.

## Configuration and ownership

`configureAgent` is required, may be async, and receives a discriminated
`AgentConstructionRequest`: parent requests have no type; worker requests always
have one. `baseline` is detached role/type configuration, without required tools
or a live workspace. The callback returns a **complete** `OrchestratedAgentConfig`,
not a patch. Omission uses ordinary Agent defaults; nested bags are supplied whole.
Spread the baseline explicitly when its defaults are wanted. Callback/backend and
executable tool identities are preserved; mutable option containers are copied.

All ordinary Agent settings pass through before initialization: connector/model,
registry, identity/roles/permissions, inference/provider/cache/data controls,
model execution/routing/helpers, loop policy, tools, history, async/errors/limits,
hooks, session storage and complete plain context settings. Reserve, strategy,
timezone, storage and plugin settings apply even with memory disabled. Zero, false
and absence remain distinct. In particular, `asyncTools.autoContinue: false` is
honored. Lifecycle callbacks retain the ordinary Agent invocation semantics;
forwarding a callback does not introduce a new lifecycle phase.

Workers default to the original orchestrator connector/model or their type's
explicit override. A root callback override does not change worker defaults.
Never copy root accounts, native tools, inference, context or authorization into
workers implicitly; return each authorized effective configuration explicitly.

The library owns allocated `name`, `parentAgentId`, one new context/ToolManager per
Agent, the required orchestration/store tools and one shared workspace. Forbidden
own configuration keys are rejected even when undefined or passed through a
variable/JavaScript. Live contexts/Agents/tool managers are not accepted on this
new entry point. Ordinary Agent APIs retain their existing support for instances.
Agent-level user/identities are authoritative; explicit context copies must agree.

The board and required tools exist before plugins and lifecycle work initialize.
Tool/plugin collisions fail instead of overwriting. Failure disposes newly owned
resources, never borrowed connectors/backends/tasks. Worker failure cannot destroy
the shared board. An explicit sharedWorkspace feature flag is preserved; supplying
a competing `plugins.sharedWorkspace` configuration is rejected. Every admitted
worker can see this board; it is not private memory or tenant isolation.

Each live conversation/explicit session ID must be distinct. Sharing storage
handles, evidence scopes or an explicitly supplied ModelTask is allowed. Worker
name/capacity reservations precede async host lookup. Failed/cancelled lookup
releases the reservation, and late callback settlement cannot install an orphan.
The host lookup itself may still continue. `maxAgents: 0` admits no workers.

`autoDescribe` preserves explicit host instructions. Only recognized unchanged
library-generated prompt content can be refreshed. Optional
`descriptionExecution: { modelTask, signal }` binds that creation-time call only.
It does not become a constructor-lifetime task.

## Operations, cancellation and diagnostics

An explicit task on each `parent.run/stream` binds that operation's admitted
children, active monitor and automatic helpers. The task stays with original
async results after a later parent turn. Default continuation drains one original
operation at a time; explicit mixed/forged/replayed batches are rejected. A host
may repair a failed receipt with retained original raw content and a matching
result-bearing record from the owning evidence backend. It cannot change execution
status, use another invocation's receipt or repeat the external action to repair it.
Without an explicit parent task, child accounting is independent. Model ledgers
remain process-local estimates, with existing unknown-usage/cost limitations.

`assign_turn` deadlines include host configuration lookup. Timeout/parent
cancellation requests cooperative stop through a child controller, without
cancelling the shared ModelTask or siblings. The exact worker remains occupied
while raw provider/tool/evidence work settles. A new turn cannot reuse it merely
because its proxy returned. Early stream close requests cancellation too.

`onChildOutcome` receives stable parent/child execution IDs, child name, state,
optional response/reason, shared/independent accounting, task/invocation IDs,
acknowledged full-result references, optional actual `toolOutcomes`, and `late`.
Sync/async observer failures cannot repeat work. A settled model response, receipt
or `success: true` submission does not establish remote/business completion;
retain host verification and inspect loop/evidence diagnostics separately.
Negative JSON business text is data. Only the five orchestration tools' own
defined `success: false` results report an operational failure on the new path.

Workers with pending async results remain occupied. If their configured auto
continuation is false, the host can inspect/narrow the worker through
`AgentRegistry.getChildren(parent.registryId)` and explicitly call its ordinary
`continueWithAsyncResults()`; its original lease/task remains bound. Auto-destroy
is deferred until real work and retained evidence settle, so the returned
`destroyed` flag describes actual cleanup rather than a requested cleanup.

## Source recovery and shutdown

Evidence remains separately opt-in. Unacknowledged worker context/queued results
prevent automatic reuse/destruction. A late JSON tool result whose storage fails
is retained in the owned worker context under its original invocation, including
after parent destruction. Inspect/save that worker before releasing it. Use the
existing evidence backend and `context.acknowledgeToolEvidence(callId, reference)`
to repair the matching result-bearing record, then request worker destruction
again. Queued async observations use the existing explicit delivery/repair path;
archive interrupted observations before an explicit cancellation/discard. Never
rerun the action to clear state. Tools must return serializable data as required
by the ordinary tool contract.

Root destruction cancels owned child work and defers the shared board's disposal
while retained workers still need it. Host connectors, backends and shared tasks
remain host-owned. Save interrupted root observations before destroying the root,
as with ordinary Agents. Host code that independently starts work on an inspected
worker is responsible for its normal Agent lifecycle; the factory's operation
binding covers orchestration/delegation and retained continuation admissions.

No task authority, configuration callback, live child lease or async operation
identity is restored from saved sessions. This is not a durable scheduler,
duplicate-effect guard or distributed budget. AMOS currently builds a single
Agent and has no orchestrator factory control surface; no saved AMOS configuration
or command is changed. The library example and tests exercise the new boundary.

Opt-in live validation (billable): with the three named provider keys in `.env`,
run `RUN_ORCHESTRATOR_FACTORY_LIVE=1 npx vitest run tests/integration/text/OrchestratorFactory.live.integration.test.ts`.
Its six cases cover real cross-vendor run/stream delegation and active-monitor
accounting with host-disabled local tools for a bounded echo exercise. It makes
no external service writes and is a functional contract check, not an autonomous
quality or cost comparison.
