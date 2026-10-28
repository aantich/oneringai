# Consumer execution APIs — final compatibility-first design

- Date: 2026-10-23; **revision 5 approved; all remaining slices authorized**.
- C1 is complete on branch, unpublished; see [delivery](CONSUMER_C1_DELIVERY.md).
  The [delivery ledger](CONSUMER_DELIVERY_LEDGER.md) tracks each subsequent slice;
  APIs remain proposals until their slice passes its gates.
- Companion: [validated plan](CONSUMER_EXECUTION_HARDENING.md) and
  [holistic review](CONSUMER_PLAN_HOLISTIC_REVIEW.md),
  [registry follow-up](CONSUMER_REGISTRY_FOLLOWUP.md) and
  [final simplicity review](CONSUMER_PLAN_FINAL_SIMPLICITY_REVIEW.md).
- Breaking old agents is unacceptable. No breaking change, automatic migration or
  future default flip is included.

## 1. Boundaries and public surface

Existing applications must upgrade without changing agent code, callbacks,
configuration, storage adapters or remote peers. New behavior requires an explicit
host choice. Preserve old signatures, unions, raw result/event shapes, defaults,
loads and extension contracts. Separate types are necessary where a new contract
cannot safely fit an old shape; reuse the existing engines underneath them.

| Existing surface, unchanged | Proposed selected surface | Delivery |
| --- | --- | --- |
| `ToolFunction`, `ToolContext`, old execute callbacks | `createOutcomeTool()` returns a standard tool with an invocation callback | C1 |
| `executeRoutine()` and `createRoutineTool()` | `createRoutineRunner()` with host verification, explicit execution binding and same-process continuation | C2 private plumbing; C3 public facade |
| Existing connector factories and registrations | `ConnectorTools.enhanced()` selects a documented, fixed tool profile | C4/C5 |
| `createOrchestrator(): Promise<Agent>` and its synchronous worker callback | `createOrchestratorWithFactory(): Promise<Agent>` with host configuration before construction | C6 |
| Existing package hydration/server/transport and protocol v2 | `hydrateAgentPackageWithOutcomes()` and `AgentPackageOutcomeServer` use separate negotiated messages | C7 |

No replacement Agent, context system, tool pipeline, scheduler, global execution
registry or universal inspector is introduced. The earlier `inspectExecution()`
proposal and public enhanced-factory registry are removed. Existing inspection plus
new operation-owned reports cover the requested information.

The [compile-only contract prototype](../evaluations/consumer-api-design/contracts.ts)
checks representative new signatures against actual built public types. C1 imports
its real root exports; later contracts remain compile-only proposals. C1 runtime
coverage is recorded in its delivery. Stage implementations must add the paired
legacy/new-path tests below. C2 publishes no partial routine union that C3 must widen.

## 2. Invocation-owned failure reporting

```typescript
// C1 root public API. Domain helpers below belong to the host.
const lookup = createOutcomeTool({
  definition: lookupDefinition,
  execute: async (args, invocation) => {
    try {
      return await lookupRecord(args, invocation.context?.signal);
    } catch (error) {
      invocation.reportFailure(toOperationalError(error));
      return { success: false, error: publicErrorMessage(error) };
    }
  },
});
agent.tools.register(lookup);
```

The new callback receives `{ context, reportFailure }`. `context` is the existing
optional ToolContext; `reportFailure(error: Error): void` records an operational
failure without changing the raw return. No field is added to ToolContext, the raw
result or serialized definition. Old callbacks keep their arguments and receiver.

The manager captures the new callback's execution capability at admission and
creates a reporter for that exact invocation. Reuse the current pipeline's private
failure provenance. Do not identify a call through a shared result object, mutable
ToolContext identity, model field or new ambient AsyncLocalStorage. Library account
wrappers clone contexts and execute functions, so they must explicitly preserve the
capability/binding bridge. Test ESM/CJS and duplicate-bundle interoperability.

The reporter is valid only while its callback is executing. First valid reported
operational error wins; a later throw is retained as causal diagnostics. Reporting
is idempotent and cannot clear an earlier failure. Once the callback settles it is
inert. If the caller has timed out but the callback is still executing, its report
belongs only to that invocation's late diagnostics; cancellation/timeout precedence
stays intact. Direct `.execute()` returns the raw value; without managed admission
there is no framework outcome to publish. Arbitrary user wrappers that replace the
execute function are not automatically certified outcome bridges.

| Call | Raw value | Framework interpretation |
| --- | --- | --- |
| Existing unmarked tool returns `{ success: false }` | Unchanged | Existing classification unchanged. |
| Selected tool returns a declined business decision without reporting failure | Unchanged | Succeeded execution; business acceptance remains separate. |
| Selected tool reports an operational error and returns its supported error object | Unchanged | Failed admitted execution. |
| Cancellation/timeout wins before settlement | Retained where available | Existing cancellation precedence and late correlation. |
| Existing portable server receives negative business data | Existing DTO | Legacy classifier unchanged; corrected remote semantics are C7 only. |

Throwing, permission admission, normalizer recovery, evidence and observer-failure
rules remain in the shared pipeline. Do not add automatic retries in this helper.

## 3. Explicit execution binding and verified routines

### Binding and cancellation

```typescript
interface ExecutionBinding {
  modelTask?: ModelTask;
  signal?: AbortSignal;
}
```

This is a plain options value, not a new authority/lifetime object. A supplied task
is borrowed and explicitly forwarded through the selected local composition. Omitted
`modelTask` retains independent call accounting; do not silently claim a whole-task
ledger. No new hard budget or automatic helper/model choice is introduced.

**Managed RunOptions has no `signal`; DirectCallOptions already has one.**
Use existing `signal`/`modelTask` options on `runDirect()`/`streamDirect()` and helpers.
C2 needs a private invocation-bound bridge only for managed `run()`/`stream()` and
their execution lease/controller. Keep public signatures unchanged. Tools/connectors
receive their supported signal directly. Borrowed agents must be exclusively admitted
before the managed bridge can cancel them; never cancel an unrelated execution.

Each child/attempt derives its own controller. A child timeout cancels that child,
not its borrowed ModelTask or siblings. The host's shared signal/ModelTask cancel
can intentionally cancel the whole operation. Task deadlines and reservations do
not reset on continuation; an exhausted/cancelled borrowed task is not replaced
with a fresh one to evade its limits. Separate invocation IDs count each call once.

### One verified facade

```typescript
// Proposed API. No legacy-completion mode or checkpoint store is added here.
const runner = createRoutineRunner({
  verify: async observation => observation.phase === 'task'
    ? verifyTaskReadiness(observation)
    : verifyFinalArtifact(observation),
});
try {
  const result = await runner.run({
    definition,
    agent, // Borrowed, host-configured Agent; no second connector/model builder.
    execution: { modelTask, signal },
  });
  if (result.state === 'waiting') {
    await runner.resume(result.continuation, {
      execution: { modelTask, signal: resumedSignal },
      authorize: () => reauthorizeCurrentHost(),
    });
  }
} finally {
  runner.close();
}
```

`verify` is required; missing verification fails construction before I/O. There is
no unverified/legacy mode on this new facade. Existing callers wanting legacy
completion continue using `executeRoutine()` unchanged.

The verifier receives a detached observation: operation/phase/task identity,
relevant response/loop diagnostics, step/tool observations and source references,
plus `reason: 'settled' | 'reconcile'`. It returns one validated decision:

- `{ kind: 'verified', references? }`;
- `{ kind: 'waiting' | 'blocked' | 'uncertain', reason, references? }`.

Host functions check current authorized state; model text and receipts alone do
not establish artifact existence. The library validates the callback result but
cannot prove the semantic truth of an arbitrary host predicate. A second callback
argument supplies the current execution binding and signal; host-owned helper
calls must explicitly use them to join accounting/cancellation. Hidden external
model calls are not automatically counted. Observation size/admission is explicit; retain
unprojected observations when storage/projection fails and never repeat an action
to regenerate them. Callbacks do not receive live mutable internal plan state.

Retain one operation-owned observation set. Task callbacks receive the relevant
task/dependency view; final callbacks receive bounded task/step headers and source
references. Do not copy every prior response/tool body into every phase or progress
event. Large source stays in existing acknowledged evidence, or remains protected
until explicit capacity recovery; no second journal/backend. Report snapshots replace
prior snapshots rather than accumulating repeated full copies. Host observers may
retain their own history. Bounds and omitted-source references must be explicit;
truncated previews never become complete evidence or a verified result.

Verification occurs at two distinct boundaries:

1. **Task phase:** after a leaf/group has settled and required strict quality checks
   pass, before dependent tasks. Verify that task's readiness, not an artifact that
   a later post-step is meant to create. A false/missing expected managed verdict,
   refusal, suspension or uncertainty cannot silently become task success.
2. **Routine phase:** after applicable post-steps settle, before reporting whole-
   routine completion. Verify the final authorized artifact/provider state here.
   A successful task check is not this final check.

Optional LLM reflection remains a quality check. Its boolean and score must both
pass in strict mode. `warn` records a quality warning and does not claim quality
passed. Required host verification cannot be waived by reflection or a warning.
Malformed/throwing verification leaves the effect receipts retained and cannot
trigger another task submission. Return a correlated blocked/uncertain result with
recovery ownership when reconciliation remains possible; do not throw past the only
handle or release unacknowledged evidence as a terminal failed result.

### Results, definitions and execution policy

`RoutineRunResult` is a new discriminated union, separate from all old routine/task
unions and snapshots. `completed` requires final host verification. `waiting`,
`blocked` and `uncertain` contain an opaque continuation; `failed` and `cancelled`
are terminal. Every result retains operation identity, observations and available
usage. Cancellation with a possibly executed write/unknown effect is `uncertain`,
with cancellation recorded as the cause, not proof of non-execution.

The new run request requires a host-built `agent` and accepts the existing
`definition`, `inputs`, `initialUserMessage`, `disableToolScoping`, `hooks` and
`prompts` vocabulary, plus `execution`. New progress observers have separate types;
old callbacks and audit DTOs are not widened or reused for new states.

| Existing definition setting | New facade contract |
| --- | --- |
| Static task DAG, templates, conditions, sequential map/fold/until | Reuse existing mechanics; bind every nested model call and verify leaf/group boundaries. |
| Required tools/plugins and tool scoping | Validate before any pre-step; keep one shared manager and restore temporary state at terminal cleanup. |
| Pre/post steps and `onError` | Record each outcome; fail/continue/skip according to the declared step policy. Continued errors remain warnings visible to final verification. |
| `postStepsTrigger: 'always'` | Run once when task execution reaches a terminal outcome, not whenever a waiting handle is returned. Do not start further side effects after cancellation; independent cleanup/compensation is host-driven. |
| `timeoutMs` | A positive value sets one absolute deadline over steps, verification and waiting. Zero disables this routine deadline; omission adds no new routine cap. Existing step/provider limits still apply. |
| Omitted `maxAttempts` or `maxAttempts: 1` | One outer task submission. Managed-loop/provider recovery remains under its existing selected policy. |
| Explicit `maxAttempts > 1` | Reject in preflight for this first verified contract; blind outer task replay is excluded. A later safe read/idempotent retry design is separate. |
| `allowDynamicTasks: true`, parallel concurrency or model-led user-approval scheduling | Reject in preflight; no silent approximation or new scheduler. Existing APIs retain their supported behavior. |

Preflight validates the entire nested definition, supported options and required
verifier before **any** external action. Unknown required settings fail explicitly.
No product workflow restriction is imposed on the existing runner.

### C3 delivered recovery refinements

The branch implementation adds optional `maxObservationBytes` (default 1 MiB,
8 KiB–64 MiB) and `maxActiveOperations` (default 32, 1–1,000). Read-only host
`readSource(operationId, sourceId, { maxBytes? })` and `acknowledgeSource` retain
recovery after close; existing backends supply references, no journal/backend is
added. `inspect` exposes a bounded source index and cleanup errors. `executionId`
disambiguates repeated nested task IDs. Model tool results bound distinct references
to 32 and explicitly report omitted references. Oversized usage snapshots can be
omitted with a diagnostic while the borrowed task retains full accounting. See
[the verified routine recipe](../VERIFIED_ROUTINES.md) for the verified signatures,
limits, cleanup, async and source-acknowledgement boundaries.

### Same-process continuation and lifecycle

Continuation in C3 is **same-process only**. `resume(handle, { authorize, execution? })`
requires renewed host authorization, validates runner/run/agent identity and claims
the handle atomically. Concurrent/reused/foreign/closed handles fail before work.
Serialize authorization under that operation's private state: a false/throwing
authorization, aborted resume or invalid replacement binding starts no work and
leaves the still-paused handle usable by a later authorized retry. Consume it only
when an admitted resume starts; if reconciliation waits again, return one successor
handle. A fatal error exposes a correlated result/recovery view before releasing
ownership. Never strand the lease by consuming the only handle before admission.
The handle is opaque, not a model argument or serialized authorization token.
An omitted resume task retains the original binding; an explicit different task
is rejected. Replacing only a caller signal cannot reset the task's own deadline.

Resume first reconciles the retained task/final verification. A current host proof
can explicitly resolve a prior wait/negative verdict while preserving that earlier
observation. It never reruns the settled task prompt, accepted/uncertain action or
completed pre/post step. Only unstarted dependent work may proceed. Pending native
async work keeps its original Agent binding, task and delivery ownership.

The runner holds an exclusive composition lease across waiting. Guard library Agent
run/stream, direct and maintenance admission while leased, allowing only the owning
private binding; a direct call must not bypass it just because it already accepts
a signal. This guard is active only for the selected composition, not a new global
ban on ordinary direct-call concurrency. The host must not independently mutate a
borrowed Agent's context/tool registrations or use its separate connector/backend
handles during that ownership window; a lease cannot revoke references the host
already owns. Borrowed agents are not destroyed. Owned
routine-tool children are retained across waiting and destroyed once after terminal
cleanup; never destroy the child in a `finally` merely because `run()` returned a
waiting result. `close()` invalidates handles and requests cancellation; it does
not prove uncooperative work stopped. Retain occupancy/late correlation until actual
settlement, and preserve unacknowledged observations for host recovery.
Final artifact verification cannot release unacknowledged raw evidence; retain an
uncertain recovery handle until that protection is repaired or explicitly handled
by the host. The host's child factory can retain Agent access for existing evidence
repair APIs; never expose that access to the model.

`runner.asTool()` takes a fresh-agent factory, a distinct tool name, the definition,
and an optional host execution-binding resolver. The adapter returns bounded JSON
with operation/state/references, never the continuation capability, agent or task.
Host progress/inspection receives the handle. Its helper binding is explicit; old
ToolContext and `createRoutineTool()` stay unchanged. Reject reuse of the caller's
active Agent to avoid self-deadlock.
Combine admission `ToolContext.signal`, the resolver's optional signal and the
routine deadline; the resolver cannot remove caller cancellation. It supplies a
ModelTask only through the trusted host, never from model arguments.

Durable routine restore, cross-process resume, CAS/leases/fencing and action
write-ahead recovery are **deferred C3-R**, not a promised optional store in C3.
Existing evidence/context persistence remains useful, but is not a workflow cursor
or exactly-once effect ledger. After restart, recover receipts and report uncertainty;
never automatically replay an uncertain write. Adding durable resume requires a
separate design/selection after a real consumer workload establishes the need.

## 4. Connector profiles and page contracts

```typescript
// Existing tools retain names, schemas, results and behavior.
const legacy = ConnectorTools.for('microsoft-main');

// Proposed new method; profile is a host-selected, runtime-validated string.
const enhanced = ConnectorTools.enhanced('microsoft-main', {
  profile: 'collections-v1',
  registry: authorizedRegistry,
  accountId: authorizedAccount,
});
```

Use `profile`, replacing the vague plural `contracts` option. C4's `execution-v1`
selects operational provenance, cancellation/safe retry and tested effects. C5's
`collections-v1` reuses those mechanics and replaces affected listings/topic tools
with page-aware/strict contracts. Selecting it does not require two tool sets.
Each delivered profile's inventory/schema/behavior stays fixed; a future selection
uses a different ID. IDs are open strings validated before I/O, not a closed enum.

Start with the audited Microsoft, Google, Slack and GitHub owning factories. Publish
exact supported inventory and construction errors for unsupported/custom services.
Keep the enhanced manifest private: no second public service-registration framework.
Custom applications can use `createOutcomeTool()` plus existing hints directly;
old `registerService()` and factory callbacks are unchanged.

Enhanced tools have distinct names: `_exec` for enhanced existing-schema operations,
`_page` for new collection results and `_strict` for changed input validation.
Use the normal connector/account prefix; validate provider name limits/collisions
before dispatch. The collections profile replaces corresponding `_exec` variants,
not the legacy registrations. Use one enhanced profile per connector/account per agent.
Definitions, cache entries and account wrappers are isolated; never mutate a cached
legacy tool. Current authority is checked at every invocation.

**Registration is part of adoption.** The factory returns tools; it does not change
`Agent.identities` auto-generation, register source metadata, or replace a catalog's
cached legacy definitions. Register through the existing
`agent.tools.registerConnectorTools(connector, enhanced, { accountId })`, rather than
unattributed ordinary registration. For the minimal static example, construct the
Agent with the selected identities' `toolFilter` equal to the actual enhanced tool
names, and disable the tool catalog. This prevents automatic legacy generation for
that identity without dropping the identity/account restriction. An empty filter
does **not** mean deny-all: reject an empty selected set before constructing this
static recipe. Assert actual enabled names/source/account metadata.

Catalog support is a separate required C5 acceptance boundary: use the same private
profile manifest and manager-owned registration state for discovery, cached categories,
load/unload and temporary scoping. A selected identity must not regain legacy aliases
on reload. Freeze the smallest manager-local adapter at stage entry; no global
factory replacement, shared mutable category/profile selection, or new public
registration framework. Preserve unselected agents' catalog/default behavior.
C4 can deliver the explicit static path; C5 cannot claim catalog support or completion
until this gate passes. A factory unit test alone proves neither whole-Agent selection
nor catalog integration. Guarantees remain per admitted tool, not universal prevention
of arbitrary requests through a separately authorized generic API tool.

### Page results and source completeness

A page tool performs **one logical provider-page fetch**, with only the selected
C4 authentication/safe-read retries; physical attempts are observed and counted.
Keep HTTP attempt counts separate from logical page counts and model usage.
It never auto-traverses a second page. `pageSize` is a documented provider
hint, not a total-data cutoff or permission to slice a fetched page. Return the
whole allowed fetched page; retain oversized source before projection or fail
explicitly with the observation protected. This removes the unread-tail problem
without inventing a cursor database or per-item continuation state.
Hosts can traverse pages deterministically through the same ToolManager; this
contract does not require an LLM call per page or a new crawler framework.

The new result contains `items`, `returnedCount`, optional `reportedTotal`,
`searchCoverage: 'complete' | 'incomplete' | 'unknown'`, and:

```typescript
type PagePosition =
  | { state: 'more'; continuation: string; positionId: string }
  | { state: 'end' }
  | { state: 'unknown'; reason: string };
```

Page exhaustion and search coverage are independent. Carry a previously observed
Drive `incompleteSearch` through continuation; a later empty/end page cannot erase
it. Never infer more/end from item count alone. A provider claiming more without a
usable position is unknown, not a completed traversal. Examples detect repeated
`positionId` values and compare full stable-fixture ID sets. The position ID is a
stable opaque fingerprint for loop detection, never an authorization capability.

Use bounded stateless authenticated encrypted continuation tokens owned by the selected profile,
binding provider position to current connector/account/principal, normalized query,
order and coverage-so-far. In managed execution an internal registration companion
owns the ephemeral key for the current ToolManager/context lifetime, surviving
catalog unload/reload and temporary tool scoping. Direct tool calls use their
tool-set lifetime. No public cursor backend/registry or hidden durable guarantee.
Recreating the owning manager/process loses that key and returns explicit invalid/
expired continuation without dispatch. A durable host codec is deferred.
Never accept arbitrary model URLs, reconstruct Graph skip tokens, or treat a cursor
as authorization; validate current scope and allowed provider origin/path each time.

Strict mutation validates provider constraints before sending; old topic slicing
stays unchanged on old tools. Full source acknowledgement and evidence projections
remain separately opt-in through existing plugins. Profiles do not enable plugins,
extra prompt content or automatic write retries. Mutable remote collections still
require provider snapshot/delta guarantees for traversal consistency.

## 5. Trusted orchestration and per-operation ownership

```typescript
// Proposed API; still returns a normal Agent.
const parent = await createOrchestratorWithFactory(config, {
  configureAgent: async ({ role, type, baseline }) => ({
    ...baseline,
    ...await hostResolveAuthorizedAgentConfig(role, type),
  }),
  onChildOutcome: report => hostRecordChildObservation(report),
});
const response = await parent.run(input, { modelTask });
```

The host callback receives role (`parent`/`worker`), allocated name/type and detached
baseline configuration. It returns a complete `OrchestratedAgentConfig` or promise,
not an already constructed Agent. The library composes required orchestration tools
and its owned shared workspace **before context/plugin and lifecycle initialization**,
then constructs one normal Agent using the existing engine. Post-construction
attachment cannot satisfy creation-time configuration guarantees. This replaces the
revision-3 *proposal*; no shipped API or old factory callback changes.

```typescript
// Proposed restriction applies only to the new entry point.
type OrchestratedAgentConfig = Omit<AgentConfig,
  'context' | 'toolManager' | 'name' | 'parentAgentId'
> & {
  context?: AgentContextNextGenConfig;
  toolManager?: never;
  name?: never;
  parentAgentId?: never;
};
```

The host controls all ordinary Agent configuration: inference, hooks, lifecycle,
limits, async behavior, history, model execution/routing/helpers, session storage,
identity, named connectors, registry, permissions and complete context configuration.
Use a plain context configuration so required integration exists before initialization;
prebuilt contexts/Agents/tool managers are not accepted on this new path. The library
owns the single shared tool pipeline and allocated hierarchy. Existing Agent APIs
continue accepting their supported instances. Detach mutable option containers while
preserving opaque host handles/callback identities; never JSON-clone configuration.

Configuration precedence is explicit:

1. `baseline` contains the existing role/type defaults, without reserved tools or a
   live workspace. It is a convenience input, not a hidden merge layer. The callback
   returns the complete configuration; omitted fields use ordinary Agent defaults.
   Host spreading of `baseline` is intentional and visible.
2. Returned Agent settings override the corresponding top-level defaults. Nested
   context, inference and provider option bags are supplied whole; no speculative
   deep merge. Preserve zero, false and absence, including response reserve with no
   memory feature enabled. Honor disabled async auto-continuation; do not silently
   force the legacy orchestrator's async defaults back into a returned configuration.
3. Library-owned name/parent relationship, required tools and one shared workspace
   remain mandatory. Append required tools to host tools; reject name/plugin-ID or
   ownership collisions before construction. Do not overwrite host context features,
   timezone, strategy, storage or authorization to install the workspace. Supplying
   a competing workspace is an explicit configuration error on this new path.
4. Worker baseline uses only its role/type config and documented connector/model
   fallbacks. Never copy root inference/provider controls, native tools, prompt cache,
   data handling, user/connector identities, permissions, context or conversation.
   The host resolves each authorized effective worker definition, including
   provider/account changes. Parent relationship alone grants no authority.

### Configuration ownership

| Input | Owner and precedence on this new path |
| --- | --- |
| Inference and policies | Host returns ordinary Agent fields: temperature/thinking/vendorOptions/nativeTools/cache/data handling, modelExecution/helpers/routing and loopPolicy. Preserve normal per-call overrides and strict provider validation. |
| Limits, errors, async and history | Forward maxIterations, timeout/legacy alias, limits/errorHandling/asyncTools/emptyResponseRetry/historyMode and hooks/lifecycleHooks, including zero/false/absence. Existing Agent alias and context-timeout precedence applies. |
| User and connector identities | Agent-level userId/identities are the authority input. An explicit context copy must agree; reject conflicting copies rather than let spread order select a different principal. Registry/permissions/userRoles remain host-owned. |
| Context and local tools | Plain complete context config, including reserve/strategy/timezone/features/plugins/assembly/storage; apply even without memory. Preflight all Agent/context/plugin/identity/reserved tool names through the same manager, rejecting conflicting registrations instead of overwriting. |
| Session and storage | Preserve ordinary session/context-storage precedence. Distinct live conversation/session identity per worker; shared backend handles, evidence scopes and ModelTask are allowed when explicitly host-selected. Do not confuse shared evidence with shared conversation ownership. |
| Workspace and hierarchy | Library owns allocated names, parent relation, required tools and one shared board. Successful host configuration authorizes that worker's membership in this board; all board contents are visible to every admitted member. It is not private child memory or tenant isolation. Host must exclude incompatible workers/content. |
| Worker connector/model defaults | Baseline falls back to the original OrchestratorConfig connector/model, as existing role/type defaults do. A root callback override does not silently change worker defaults; host explicitly chooses each effective worker config. |

Do not add a second configuration merge/authorization engine. Reuse ordinary Agent
initialization after a small preflight/composition step. Structural TypeScript types
are not runtime validation: reject forbidden own keys/live instances on the new
entry point even for variables, JavaScript or decoded input. Parent/worker request
types are discriminated; a worker always has a type, a parent does not.
An existing prepared AgentConfig is input to the host adapter, not a value to cast:
strip library-owned keys and ensure plain context config explicitly, then preserve
the remaining settings. This is opt-in adoption, not a migration for old callers.

Preflight configuration and statically known reserved-name conflicts before
initialization/model calls. Dynamic plugin/identity registrations use collision
checks and rollback during construction, not a second trial construction to discover
their tools. Every created Agent/context is newly owned; dispose only those resources on
failure, never host connectors, storage backends, callbacks or a borrowed ModelTask.
Reject duplicate live conversation/session identities. Do not reject deliberate
host-selected shared storage/evidence/task scopes merely because their IDs match.
Reserve worker name/capacity before awaiting configuration; simultaneous requests
cannot create two workers for one name or exceed maxAgents. A rejected callback
releases the reservation once. Cancellation/teardown invalidates the admission;
late callback settlement cannot install an orphan worker. Do not claim an arbitrary
host lookup stopped merely because its result was abandoned.
`autoDescribe` must preserve explicit host instructions; generated descriptions may
update only library-generated prompt content. The new path requires construction-time
plugin/tool, request-body and lifecycle tests, not merely runtime-snapshot assertions.
Existing `createOrchestrator()` and synchronous worker callbacks stay unchanged.

**No live execution binding is captured in the constructor.** On this explicitly
selected factory path, a ModelTask supplied to each `parent.run()`/`stream()` binds
that operation's children, monitors and automatic helpers. Missing task means no
shared-operation accounting claim. Capture the binding at child admission, keep it
through async delivery and never rebind in-flight work to a later parent turn.
Creation-time `autoDescribe` is separate; an optional `descriptionExecution` binding
accounts that one creation call only. No new public `RunOptions.signal` is assumed.

Cooperative child timeout derives a child controller, requests cancellation and
retains that exact worker's occupancy until settlement. A host abandonment may
quarantine/remove the instance, never mark it reusable while old work continues.
Late results retain original IDs. Parent cancellation targets its own admitted
children; cancelling one child does not cancel the shared task/siblings.

`onChildOutcome` carries separate child response/loop/evidence/usage diagnostics;
exceptions in this observer do not repeat work. Returning a parent response or a
child submission receipt does not prove workflow completion. Inspect the existing
Agent report plus recorded child reports/ModelTask snapshot. No universal inspector
or Stage 14B delegation policy is added.

## 6. Negotiated remote observations

The actual existing package API is `hydrateAgentPackage()`. The earlier proposed
`restoreAgentPackageWithOutcomes` name is corrected to
`hydrateAgentPackageWithOutcomes()`, matching that established vocabulary.

Keep literal `AGENT_PACKAGE_PROTOCOL_VERSION = 2`, its literal type, old strict
request/response/package/descriptor shapes, server behavior and transports intact.
New server/hydration APIs use a separate envelope discriminator/version and separate
DTOs. Reuse the existing executor, authenticated transport and evidence interfaces.

The new transport contract has these bounded responsibilities:

| Operation | Required semantics |
| --- | --- |
| `negotiate` | Authenticated package/session/capability agreement before execution; unsupported required features cause no dispatch. |
| `execute` | Stable request ID and argument fingerprint; correlated server observation distinct from proxy settlement. |
| `getReceipt` | Reconcile a known request after interruption; pending/settled/unknown are explicit. Unknown is not permission to submit again. |
| `cancel` | Authenticated best-effort cancellation of that server invocation, beyond aborting the client HTTP request. Acknowledgement is not rollback. |
| `readEvidence` | Bounded authorized resolution of a server-scoped reference; no arbitrary URL fetch or local-store assumption. |

Transport disconnect/AbortSignal only establishes what the client observed. Server
work may continue; preserve correlation and allow explicit receipt lookup. All
execution/lookup/cancellation/evidence operations recheck current authorization.
Do not negotiate after sending an action, downgrade automatically, allocate a fresh
request ID after an uncertain write, or silently fall back to legacy execution.

The observation keeps **proxy settlement and server operation outcome separate**.
Reuse ToolExecutionOutcome fields for each observation without overwriting local
IDs, time or completion with remote facts. The new managed proxy bridge consumes
validated server status/uncertainty for retry/repetition/completion decisions; it
must not classify transport success as remote action success. Sidecar observation
reports expose both; old outcome/event DTOs gain no fields. Compare authoritative
local operation outcomes with server outcomes in parity tests, not with HTTP success.
Missing/unverified remote observations stay unknown and protect write/unknown effects.
The bridge must carry this distinction into evidence/compaction protection and
restart recovery, not merely a UI callback. Acknowledged immutable server observations
may use existing evidence interfaces with a separately documented new envelope;
raw tool returns and old evidence/session schemas remain unchanged. Missing or
unacknowledged sidecars cannot be reconstructed from proxy success or release a
protected observation. C7's schema gate must include round-trip/restart tests.

Effects/permissions come only from current trusted registrations. Package metadata
is descriptive. Process-local deduplication does not promise durable exactly-once
execution; restart lookup can return unknown and must not cause action replay.
No live ModelTask is serialized. Cross-process observations may join an authorized
aggregate with stable IDs; distributed hard-budget enforcement is outside scope.

C7's detailed wire schema is a stage-entry deliverable, with old/new peer fixtures
and this semantic contract as constraints. Plan approval is not approval for an
unreviewed wire shape or changed v2 types. No competing JSON-RPC/service framework
is introduced to implement these five transport operations.

## 7. Inspection, persistence and documentation

Use existing Agent/runtime inspection and task snapshots. New routine/remote
operations expose detached `inspect()` reports keyed by their own operation IDs;
orchestration uses its explicit child observer. Distinguish configured support,
observed verification and unknowns. Inspection performs no model/service call and
never trusts mutable model/package fields as authority. Preserve old report shapes.
Routine inspection covers active/paused/settling runs. Once a terminal result and
all protected observations have been delivered, release its internal entry; the
host owns the returned result/history. Do not build an unbounded implicit journal.
Close keeps late observation delivery alive until settlement; it does not silently
discard protected data or guarantee that no callback can follow cancellation.

Old snapshots and loaders stay unchanged. C3 handles/callbacks/tasks are not restored
from context snapshots. Keep restart evidence recovery separate from the deferred
workflow-resume design. AMOS new commands/settings ship with their slice; old
commands/configuration and presets retain their behavior. Record internal-only C2
availability explicitly. Public docs/examples and Version 2 handoff accompany each
implemented capability; generated API docs change only when APIs are implemented.

## 8. Compatibility gates

| Boundary | Frozen legacy assertions | Selected-path acceptance |
| --- | --- | --- |
| Public types | Old imports/overloads/literal unions/callbacks/factories/plugins/storage compile unchanged. | New declarations/examples compile; wrong result/phase/continuation/ownership combinations fail. |
| Results/events/defaults | Raw keys/statuses/arguments/receiver/order, prompt/tools/models/retries/calls unchanged. | Provenance and independent verification are correlated; observers never trigger replay. |
| Factories | Old schemas/counts/metadata/names/custom registration unchanged. | Fixed profile inventory, wrapper/ESM/CJS bridge, account isolation and cancellation verified. |
| Routines | Existing validation/retry/status/audit/storage behavior unchanged. | Task/final checks, post-step artifact, single submission, single-use handles, lease/teardown and whole-call accounting. |
| Orchestration | Existing Promise return, synchronous worker factory, timeout/reuse/results retained. | Complete pre-construction host config, actual parent/worker request bodies, plugin/lifecycle effects, precedence, isolation, per-run binding, quarantine and late reports. |
| Persistence | Old configurations/session formats remain loadable; no new required adapter methods. | Evidence survives where acknowledged; process loss does not pretend to restore a workflow or task authority. |
| Remote | Literal v2/exact-key/legacy peer fixtures unchanged. | Negotiation, server cancel/lookup, two observations, trusted effects, exact evidence and no fallback replay. |
| Inspection/AMOS | Existing reports/commands/configuration retained. | Bounded operation-owned reports accurately name actual support and unknowns. |
| Registry/parameters | Existing raw registry outputs, effort unions, STT streaming, request/count defaults, Vendor IDs and service/auth classification retained. | Explicit C9 companions/policy, per-model endpoint evidence, effective-request consistency, saved-value preservation and browser-safe presentation. |

Freeze fixtures from the exact installed consumer Git revision as well as the
current branch; a lockfile version label alone is insufficient. Existing 334 tests,
202 public controls and 17 characterization observations are baseline evidence,
not proof that proposed APIs work. Never rewrite a legacy expectation to accept a
new default. A failed legacy gate blocks delivery and requires redesign.

## 9. Approval and sequencing

Revision 5 of this additive direction is approved; C1 is the selected delivery.
The remaining C1–C8 stage boundaries still govern sequential implementation;
the [registry follow-up](CONSUMER_REGISTRY_FOLLOWUP.md) adds independently selectable
C9-A/C9-B/C9-C contract work. These are not prerequisites for C1–C8. Their exact
public signatures require stage-entry review under the same compatibility rules;
no existing registry output or request validation changes by default. Implementation
now proceeds through all authorized slices in order, reviewing and fixing each. C1 validation is recorded
in its delivery document. C2/C3 share one public release boundary. C4/C5 are separate
fixed profiles. C5 catalog integration needs its manager-local adapter reviewed at
stage entry and tested before completion. C6/C7 do not depend on each other. C8 conformance grows from C1 and
is the final composed gate. Durable routine resume/cursor persistence, production
backends, distributed budgets, Stage 14B/16B and consumer upgrades remain outside
this approval.

C6 delivery update: [the complete factory](CONSUMER_C6_DELIVERY.md) and its root
types are implemented and validated. The original proposal above records API
intent; [the usage recipe](../ORCHESTRATOR_FACTORY.md) records verified behavior.
`ChildObservation.toolOutcomes` is an optional additive diagnostic of actual tool
settlement, including late results. C7 wire/schema details remain a stage-entry
deliverable; no old protocol shape is broadened.
