# Stage 14 — Routing API and delegation design

- **Status:** Stage 14A complete on branch; [S1–S3 corrected and validated](STAGE_14A_SECOND_REVIEW_AND_FIX_PLAN.md#corrective-completion--2026-10-23). Stage 14B remains a companion design only. Package release unverified.
- **Date / design revision:** 2026-10-22 / 1.
- **Repository baseline:** `version2`, `cf87b4a` (`stage 16A`); clean working tree before this design.
- **Authorization:** The user replied “proceed” after presentation of the 14A API and explicit routing-first approval request on 2026-10-22. This authorizes 14A implementation, tests, examples, AMOS and documentation. It does not authorize 14B, a breaking change or a package release.
- **Compatibility:** Additive and opt-in. Existing defaults, helpers, plugins, tools, events, sessions and orchestration remain supported. No breaking change is proposed or approved.
- **Parent plan:** [Stage 14](./AGENTIC_ARCHITECTURE_EVOLUTION.md#stage-14--adaptive-routing-and-bounded-delegation).

## 1. Recommendation and approval boundary

Split delivery into **14A: model routing** and **14B: bounded specialist delegation**. They solve different problems and can be enabled independently. A routing policy chooses the model for one managed execution. Delegation gives a worker a limited task, context and authority. Neither implies the other.

The user approved **14A first**, with the concrete API below. The 14B section records a companion design and the additional decisions required before its own implementation approval. Selecting this delivery order must not be reported as completing all of Stage 14.

Start with ordinary TypeScript selection rules and measured task outcomes. Preserve the selected route throughout a run, including its tool iterations, retries, recovery, compaction and JSON repair. Escalate at the next supported execution boundary. Learned routing, automatic retries on another model, mid-run switching and a distributed scheduler are outside 14A.

## 2. The small application API

Keep the existing main connector and model as the **default route**. Add named alternatives under `modelExecution.routing`; do not introduce a second Agent, Connector, context or tool-manager API.

The following 14A snippets describe the implemented branch API; see the [current recipe](../MODEL_ROUTING.md) and [implementation record](STAGE_14A_IMPLEMENTATION.md) for verified usage and validation. 14B snippets remain unimplemented companion designs. Connector names refer to host-configured named connectors. Model values are supplied by the application from tested, registry-supported configurations; the design does not recommend a particular vendor model.

```typescript
const agent = Agent.create({
  connector: 'primary',
  model: mainModel,
  tools: [lookupOrder],
  context: existingContextConfig,
  modelExecution: {
    helpers: existingHelperConfig,
    routing: {
      routes: {
        fast: { model: fastModel }, // Inherits the primary connector.
        specialist: {
          connector: 'secondary',
          model: specialistModel,
          allowContextTransfer: true,
        },
      },
      select: ({ hints }) =>
        hints.taskType === 'order-lookup' ? 'fast' : 'default',
    },
  },
});

const task = new ModelTask({ limits: { maxCalls: 8 } });
try {
  const response = await agent.run('Find the order status.', {
    routing: { taskType: 'order-lookup', phase: 'lookup' },
    modelTask: task,
  });
  console.log(response.output_text);
  console.log(response.routing); // Decision, selected identity and overhead.

  // A separately requested next step can explicitly use the main model.
  // This does not replay the previous run or repeat its external actions.
  await agent.run('Explain the verified status and the unresolved exception.', {
    routing: { route: 'default', phase: 'explanation' },
    modelTask: task,
  });
} finally {
  task.destroy();
  agent.destroy();
}
```

Three common controls:

```typescript
await agent.run(input); // Configured selector, if present; otherwise today's behavior.
await agent.run(input, { routing: { route: 'fast' } }); // Explicit route; no selector.
await agent.run(input, { routing: null }); // Configured main model; no selector/sticky reuse.
```

Routing options require an agent with a routing configuration, except `routing: null`, which is a harmless default-route opt-out. An unknown explicit route fails before dispatch. There is no implicit route selection by model name or by an LLM-generated tool argument.

`taskType` and `phase` are optional host-supplied routing hints. They do not become system instructions, evidence or authorization. The library does not infer task difficulty from prompt length or treat model confidence as proof. Applications can start with a few measured categories and use the default model for unknown categories.

## 3. Proposed 14A types

These declarations show the proposed additions. Existing interfaces keep all their current members; `ThinkingConfig`, `ModelPriceBound` and `DataHandlingPolicy` are existing types. The proposal does not expand the existing `HelperRole` union.

```typescript
export interface ModelRouteConfig {
  model: string;
  /** Inherit the Agent's configured connector when omitted. */
  connector?: string;
  thinking?: ThinkingConfig;
  temperature?: number;
  /** Optional tighter cap; cannot increase maxOutputTokensPerCall. */
  maxOutputTokens?: number;
  /** Bound for this route; another deployment's price bound is never inherited. */
  priceBound?: ModelPriceBound;
  dataHandling?: DataHandlingPolicy;
  /** Required to send the managed request to a different connector/account. */
  allowContextTransfer?: boolean;
}

export interface ModelRoutingHints {
  taskType?: string;
  phase?: string;
}

export interface ModelRoutingRunOptions extends ModelRoutingHints {
  /** 'default' is the existing configured main connector/model. */
  route?: string;
}

export interface ModelRouteCandidate {
  readonly route: string;
  readonly connector: string;
  readonly model: string;
  /** Preliminary state/capability eligibility, not a reservation or fit promise. */
  readonly eligible: boolean;
  readonly reasons: readonly string[];
}

export interface ModelRoutingContext {
  readonly hints: Readonly<ModelRoutingHints>;
  readonly candidates: readonly ModelRouteCandidate[];
  /** Last admitted route in this explicit ModelTask and phase, if any. */
  readonly previous?: Readonly<{
    route: string;
    connector: string;
    model: string;
  }>;
  readonly signal: AbortSignal;
}

export interface ModelRoutingDecision {
  route: string;
  /** Diagnostic only; never injected as an instruction. */
  reason?: string;
}

export interface ModelRoutingConfig {
  /** Nonempty, bounded names. 'default' is reserved and cannot be redefined. */
  routes: Record<string, ModelRouteConfig>;
  /** Omit for explicit named-route overrides only; otherwise default stays selected. */
  select?: (context: ModelRoutingContext) =>
    | string
    | ModelRoutingDecision
    | Promise<string | ModelRoutingDecision>;
  /** Default 'default'. Used only for selector exceptions/timeouts. */
  fallback?: string;
  /** Default 1000ms; also bounded by the current execution/task deadline. */
  timeoutMs?: number;
  /** Default 'run'. 'phase' reuses a route in the same explicit ModelTask/phase. */
  sticky?: 'run' | 'phase';
}

// Optional addition to existing ModelExecutionConfig:
// routing?: ModelRoutingConfig;

// Optional addition to existing managed RunOptions:
// routing?: ModelRoutingRunOptions | null;

export interface ModelRoutingDiagnostics {
  readonly decisionId: string;
  readonly executionId: string;
  readonly requestedRoute?: string;
  readonly selectedRoute: string;
  readonly connector: string;
  readonly model: string;
  readonly source: 'default' | 'policy' | 'explicit' | 'sticky' | 'fallback' | 'disabled';
  readonly reason?: string;
  readonly selectorFailure?: 'timeout' | 'exception';
  readonly selectionMs: number;
}

// Optional addition to existing managed response:
// routing?: ModelRoutingDiagnostics;

// Additive Agent method:
// getRoutingDiagnostics(): ModelRoutingDiagnostics | undefined;
```

Do not add redundant public router registries, model pools, capability enums, a rules DSL, a new budget class, a new helper role or a factory for each model. Route-name mistakes receive runtime configuration errors; this design does not promise compile-time key inference through the existing nongeneric `Agent.create()` API.

`select` is optional so an application can configure named routes and choose them explicitly without writing a placeholder policy. Initial configuration limits should be small and explicit: at most 16 alternative routes, route names of 1–64 characters, hint strings of at most 128 characters and diagnostic reasons of at most 512 characters. Reject oversized configuration/decisions rather than silently truncating them. Empty hints are allowed; an absent/empty phase does not establish a phase pin.

The selector gets a detached, bounded, frozen metadata view. It receives no automatic transcript, plugin bodies, credentials, evidence contents, workspace or tools. It is host code; its closure is not a sandbox. Plain local rules or local performance-table lookup are the supported 14A selection use. A later learned selector can fit this callback without changing ordinary call sites, but its model/data/training contract needs a separate design.

If a host already uses a bounded extractor to classify a request, it may call the existing `invokeHelper('extractor', ...)` **before** the managed run, explicitly sharing the same `ModelTask`, then pass validated category hints. Classification counts toward total cost and latency. Do not hide an untracked LLM call in `select`, add an automatic classifier, or send conversation state to an unconfigured router model. External work done by arbitrary host callbacks is outside library accounting; no total-cost claim can omit it.

## 4. Selection, fallback and stickiness

The execution lease is acquired before selection. Only one route can own an execution. Selection runs once, before managed input is committed, plugin preparation/compaction starts, or a model call is reserved. Registry/authorization/capability checks may resolve connector/provider metadata but must not make a generation call.

Order:

1. An explicit per-run `route` wins. `routing: null` selects the configured default. Neither invokes `select` or a routing fallback.
2. With `sticky: 'phase'`, reuse a compatible admitted route for this Agent, the same explicitly supplied `ModelTask` object, and the same nonempty phase. Otherwise call `select` once if present, or choose the configured default.
3. Resolve a returned route and preflight state, capabilities, data handling, context transfer and configuration. Reserve no generation call during selection.
4. Only a selector **exception or timeout** invokes the configured fallback, once. Unknown route names, malformed decisions, capability failures, missing authorization, budget rejection and state incompatibility are errors; a fallback must not conceal them.
5. Prepare the request once for the selected binding, admit model calls through the existing task ledger, and preserve that binding until the execution settles. Recheck scope/state and the actual counted request at dispatch.

An external/task cancellation or exhausted deadline never triggers fallback. A selector timeout aborts its own signal. Late results are ignored; the callback cannot mutate an admitted decision. Synchronous host code cannot be preempted by a JavaScript timer: elapsed time is checked on return, and CPU-bound/hanging callbacks are outside hard preemption guarantees. Never advertise `timeoutMs` as a sandbox.

Phase stickiness is optional. Without an explicitly supplied shared `ModelTask` and a nonempty phase, it degrades to run stickiness without creating a hidden task/session key. Keep only the latest admitted phase/route per Agent/task using weak task ownership; do not accumulate an unbounded phase map. A new phase clears that pin. Explicit `route` overrides the pin and becomes the next pin only after admission. A policy/explicit choice that never dispatches does not update it. No route is remembered across a restart.

This yields simple hysteresis: within an explicitly grouped phase, automatic selection cannot oscillate, and an explicit escalation remains selected until the phase changes. No numeric “model quality rank”, confidence threshold or automatic downgrade is inferred. The host decides when a phase changes. A fallback due to selector failure is visible in diagnostics; it is not a successful quality label.

Provider failures retain existing retry/recovery behavior **on the selected route**. Routing adds no provider failover, replay or retry allowance. Once a model request or tool action has happened, the library must not rerun the execution elsewhere. A host can inspect real state/evidence and request a distinct next step on a stronger route; “try the same task again” is not an automatic safe recovery rule.

## 5. Context plugins and native state are part of selection

Routing chooses an execution binding, not a replacement context architecture:

```text
Agent configuration + named route
  -> one execution binding (connector / provider / model / options)
  -> existing context plugins + history + shared ToolManager
  -> one bounded preparation for the selected model
  -> normal managed run/stream loop
```

Keep the same Agent identity, context instance, plugin instances, host task state, evidence scope, permissions, tool registrations and session. In particular, `agent.tools === agent.context.tools` remains true. Routing adds no prompt section or tools. Selecting another LLM connector never expands external-service identities or tool connector access.

The selected model supplies capacity, output reservation, structured-output support, native-tool support, reasoning support, multimodal support, pricing and prompt-cache compatibility. Context selection and the single compaction pass use that capacity from the start. Do not prepare for the default model, switch, and compact again. A smaller model that still cannot fit fails with existing fit diagnostics; there is no automatic summary or truncation just to make a route eligible.

`agent.model`, `agent.connector` and the persisted Agent definition continue to describe the configured default. `setModel()` keeps its existing explicit configuration semantics. Internally add an execution-scoped binding and pass its model/capacity through preparation and dispatch; do not implement routing by temporarily mutating these public properties. `context.model` remains its configured model; preparation diagnostics must identify the effective selected model and capacity. Existing custom plugins keep their current context contract. A custom plugin that depends on a particular model must be included in compatibility fixtures; do not assume changing the provider makes arbitrary plugin content portable.

Copy/validate route configuration at construction; mutating the caller's original object is not a hot-reconfiguration API. An explicit configuration change such as `setModel()` must invalidate stale future phase choices and revalidate state. During an active routed execution it cannot change that execution's captured binding; existing context/scope revision guards may still reject a stale request. No new mutation restriction is imposed on the legacy nonrouting path. Known protocol-state portability is enforced by the library; semantic suitability of arbitrary host plugin content remains the host's responsibility.

`response.model` retains its existing meaning: the model reported for the generation. New routing diagnostics record the selected connector/model and decision; they do not substitute for observed provider usage. A native compaction call uses the **selected main binding** for that run. Explicit configured compactor/extractor/verifier helpers stay independently configured and share the active task under their existing rules. A helper never silently becomes a main route.

Preflight must examine all active representations, including nested native items, continuations, reasoning signatures, attachments, pending native operations and replay dependencies. Examples:

| State/configuration | Proposed behavior |
| --- | --- |
| Ordinary portable text and settled local function call/result groups | Switching can proceed if target capabilities, scope and fit checks pass. |
| A different connector/account | Require `allowContextTransfer: true` on that alternative route, plus all existing host/data-handling permissions. This includes the first request's input. |
| Active native compaction or provider-bound signed/encrypted history | Only its exact compatible binding can continue; otherwise reject before transfer. Opt-in transfer cannot make opaque state portable. |
| Continuation token or pending provider-native operation | Keep its owning binding or reject; do not reinterpret, remove or send it to another provider/model. |
| Pending local/async observation or unstored evidence | Preserve existing protection and execution ownership; no automatic movement of in-flight work. An active async continuation is not a new routable user run. |
| Unsupported image/audio/schema/native tool/reasoning/cache control | Reject before generation; do not silently omit a requested capability. |
| Unknown model or injected custom provider | Preserve the existing nonrouting path. A routed target needs sufficient provider metadata and transport accounting to preflight its declared requirements. |

If native compaction pins an alternative route, `routing: null` may be incompatible with that state. It must fail clearly rather than discard state or secretly choose a different model. Recovery uses a documented compatible route, a host-selected fresh context, or an already supported source/checkpoint recovery procedure. Routing introduces no automatic conversion API.

Configuration precedence is existing Agent defaults → selected route's permitted inference settings → existing per-run overrides. Hard limits/data-handling restrictions can only tighten. A route's output cap cannot enlarge `maxOutputTokensPerCall` or the target's capacity. This does not introduce an output-cap option on existing `RunOptions`. A default deployment's custom price bound is not evidence about a different route. Resolve pricing for that actual target or require its own bound under a hard monetary ceiling.

Provider-specific `vendorOptions`, hosted tool identities and cache references are not translated between vendors. A cross-provider selection with incompatible inherited options fails preflight; the host must provide compatible existing per-run options (for example an explicit replacement `vendorOptions: {}`), or use a compatible route. Do not add provider-specific overrides to every route before a concrete workload needs them. Structured JSON prompt fallback remains an explicitly supported current behavior; routing must not turn it into an unannounced native-schema guarantee.

## 6. Budgets, streaming, lifecycle and persistence

Use the current `ModelTask`, `ModelExecutor` and invocation/attempt records. The selected main route, helpers, native compaction, existing transport retries, wrap-up and structured repair all consume the same execution task. Sharing across distinct runs/classification/agents remains explicit through `modelTask`. Routing alone introduces no new implicit ceiling. Selected-route conservative reservations and final usage attribution must agree on connector/model; cancellation, unknown charges and late billed outcomes remain visible.

No token-cost hard limit is possible from a route's optimistic local estimate or unknown price. Cost/latency comparisons include selector overhead, any host classifier, compaction, repair, verifier and failed attempts. A local selector consumes time but is not a fabricated model invocation.

Support managed `run()` and `stream()` with the same route resolver and guards. Streaming pins the route before the first chunk and never retracts chunks to switch models. Use an optional `routing` field in existing extensible completion metadata plus the getter; do not add a new required event or expand a closed stream discriminant union. Clear the getter at execution start; on preflight failure it exposes that execution's attempted decision where one exists, while the existing error explains why it was rejected. Do not expose an earlier execution's decision as the failed attempt. Diagnostics are decision observations, not workflow completion claims.

`runDirect()`, `streamDirect()`, external executions, realtime and external SDK drivers retain their existing fixed owner and are outside 14A. Do not accept an ignored routing option on unsupported paths. The vendorneutral Agent Runtime already has capability-gated `model`/`reasoning` overrides; adapt it separately only after it advertises an appropriate supported boundary. No external harness is assumed to inherit managed Agent portability.

Automatic async follow-ups, resumed tool batches and suspended executions keep their originating binding and task attribution. They do not invoke a new selector or accidentally fall back to the Agent's default connector. New user input must not steal an unresolved execution's native/evidence ownership. Test this lifecycle explicitly before enabling routing with async tools.

Routing callbacks, connector permission/transfer approvals, sticky choices and ModelTask authority are runtime-only. Saved context keeps its existing format and required fields. It may contain already supported provider-bound continuation metadata, which continues to constrain future choices. Loading a session does not recreate routes, credentials, a selector, a budget or transfer permission. AMOS may persist host-owned declarative route settings through its settings adapter; it must never serialize arbitrary callback code or infer approval from a checkpoint.

## 7. Companion 14B design: bounded tasks on the existing orchestrator

14B must be separately approved. Do not implement it as a side effect of 14A, and do not call existing unbounded `assign_turn` a bounded specialist facility.

Source review found that `createOrchestrator()` currently creates ordinary Agents with a shared workspace and asynchronous tools. Its worker factory does **not** currently propagate the full host identity/registry/permission configuration or a parent `ModelTask`. Those are implementation requirements for 14B, not guarantees of today's orchestrator. The historical multi-agent design draft is not the public API specification.

Prefer an optional `delegation` policy on the existing `createOrchestrator()` configuration, and an optional per-agent-type `delegation` restriction. Add only the missing host configuration pass-throughs using existing Agent types (`userId`, registry, identities, permissions, `modelExecution`, loop policy); preserve ordinary factory behavior and return type. Keep the existing agent registry, worker creation/cleanup and workspace implementation.

Illustrative companion configuration, **not yet the frozen 14B signature**:

```typescript
const team = await createOrchestrator({
  connector: 'primary',
  model: mainModel,
  userId: trustedUserId,
  permissions: hostPermissionPolicy,
  delegation: {
    maxConcurrent: 2,
    maxTasks: 4,
    timeoutMs: 60_000,
  },
  agentTypes: {
    researcher: {
      systemPrompt: 'Investigate the assigned question and cite observations.',
      tools: [scopedSearch],
      delegation: {
        limits: { maxCalls: 3 },
        maxInputTokens: 4_000,
        maxOutputTokens: 1_000,
        evidenceIds: hostApprovedEvidenceIds,
        workspace: { read: ['brief:'], write: ['finding:research:'] },
      },
    },
  },
});

await team.run(request, { modelTask: sharedTask });
```

Host configuration sets ceilings and authority. Model-generated assignment fields can select or narrow that envelope, never expand it. Use the existing `assign_turn` name and asynchronous result delivery, adding a bounded `task` packet when the new mode is selected:

```typescript
// Model-visible tool call shape in the proposed bounded mode:
assign_turn({
  agent: 'research-1',
  type: 'researcher',
  instruction: 'Compare the two proposed designs against the supplied constraints.',
  task: {
    id: 'comparison-1',
    constraints: ['Use only supplied sources; do not perform writes.'],
    evidenceIds: ['host-admitted-evidence-id'],
    successCriteria: ['Cite the source for each material difference.'],
  },
});
```

Keep `instruction` as the objective instead of adding a duplicate objective field. Under bounded mode a valid task packet is required; the legacy tool schema/behavior remains unchanged when the policy is absent. A model's constraints and success criteria are untrusted task data; host constraints and checks take precedence. No tenant/principal, credentials, permission grants or arbitrary budget increases belong in this packet.

The detailed 14B contract must settle the following before approval:

- **Authority:** Worker tools are a host-selected subset enforced through its existing ToolManager and the parent's effective permission policy. Carry actual user/registry/identity restrictions; a default-open child must not bypass a parent's denial. Instructions alone are insufficient. Catalog/discovery/connector fetch must obey the same boundary.
- **Evidence and workspace:** A filtered view enforces admitted IDs and read/write prefixes for lookup, list, search, prompt injection, compaction, save/load and direct APIs. A shared unfiltered workspace plugin is not an access boundary. Model-provided `author` or task IDs are not authority. Keep the same storage/workspace primitives underneath; scoped worker facades must cover every access path.
- **Packets:** Bound rendered input, evidence expansion, task counts and outputs before model admission. Pass the objective, host constraints, exact approved refs and explicit success criteria rather than cloning the parent transcript. Persistent workers cannot leak a prior task's context/authority into a narrower assignment; choose fresh bounded task contexts by default.
- **Budgets:** All parent/child/helper/repair calls share the explicit root ModelTask. Tighter per-child allowances need atomic admission against both parent and child limits, including concurrent outstanding reservations; independent child ledgers followed by post-hoc summation are insufficient. Derive child deadlines/cancellation from the parent; do not add a distributed quota service.
- **Lifecycle:** Enforce actual concurrent executing tasks, not just the number of Agent instances. Limit total admitted tasks; release slots exactly once on every exit. Cancel/destroy children and settle late diagnostics on parent teardown. Background result delivery keeps its original root task/identity; it cannot silently create a fresh unlimited task after the parent's run finishes.
- **Control paths:** `send_message`, reassignments, async continuation and any interactive handoff cannot bypass the bounded envelope. Exclude interactive delegation from the initial bounded mode unless its multi-turn authority/budget ownership has a separately tested contract. Do not leave legacy unbounded tools as an escape hatch in that opt-in mode.
- **Duplicate work:** Deduplicate `(host task scope, assignment id)` against an immutable admitted packet. Identical repeats observe the existing task; a changed packet with the same ID is a conflict. This suppresses duplicate assignments within the process; it is not durable exactly-once external execution.
- **Results and merge:** Worker completion yields a bounded untrusted result, evidence references, usage and execution status. A parent/host check resolves contradictory claims against actual sources before a single accountable merge. Existing host completion checks decide workflow success; worker prose and successful submission cannot confirm an external effect. Reuse workspace revisions for optimistic publication, not an invented consensus protocol.

Keep routing and delegation composable: a worker can have an explicitly configured routing policy with its own allowlisted targets, but it receives no parent routes or cross-connector transfer permissions by default. Its selected calls still consume the root budget and narrower child allowance. The initial examples should use fixed worker models so tests can isolate delegation from routing effects.

## 8. Compatibility and alternatives

| Existing consumer | Preservation requirement |
| --- | --- |
| `Agent.create({ connector, model })` | Same default model, request behavior, provider retries, prompts, tools and output. No routing callback, classifier, background activity or extra model calls. |
| Static helper roles | Same configuration and invocation methods; no new required role or closed-union expansion. |
| Custom context plugins/strategies/providers | No new required interface members. Existing nonrouting path stays unchanged. Opt-in routing may reject a target whose portability/capabilities cannot be established. |
| ToolManager, permission hooks and identities | One existing manager per Agent/context; route selection cannot replace it or broaden access. |
| `setModel`, `agent.model`, `agent.connector` | Existing explicit defaults and readonly configuration meanings preserved; effective routing is execution-scoped. |
| Response and stream consumers | Existing required fields/statuses/discriminants remain. Optional route diagnostics appear only for configured/explicit routing. |
| Agent definitions and saved context | Existing required fields/version and old-session loading preserved; runtime routing policy is not restored as authority. |
| Existing `createOrchestrator` users | No changed tool schema, default limits, approval policy or worker behavior without the new bounded mode. |

Rejected alternatives: instantiate another full Agent for each route (duplicates context/tools), mutate `setModel` and swap the connector (partial state and observer races), always use an LLM router (overhead and weaker auditability), switch after provider failure (implicit replay), infer permissions from a worker prompt (not enforcement), add a new orchestrator registry or task-DAG engine (unnecessary scope).

If implementation cannot preserve a supported contract, stop the affected part and present the exact break, affected consumers, alternatives and migration for explicit approval. General approval of this proposal would not waive that requirement.

## 9. Research grounding and limits

Primary sources rechecked on 2026-10-22:

- [Agent-as-a-Router, v3](https://arxiv.org/abs/2606.22902v3), June 2026: studies execution-grounded feedback and task/model performance information. Design inference: start with auditable rules and empirical outcome tables; do not learn from an agent's unsupported success claim.
- [AgentRouter, v1](https://arxiv.org/abs/2609.22951v1), September 2026: reports learned step-level routing on annotated trajectories. Design inference: preserve an extension point, but defer a trained router, model infrastructure and mid-trajectory portability until OneRingAI has validated labels and an appropriate workload. Its reported savings are not forecasts for this library.
- [Towards a Science of Scaling Agent Systems, v3](https://arxiv.org/abs/2512.08296v3), April 2026 revision: controlled evaluations show that coordination benefits depend on task structure; tool-heavy and sequential tasks can pay substantial overhead. Design inference: delegation is separately enabled, uses bounded separable tasks and centralized verification, and is compared against an ordinary single-agent baseline.

These papers motivate evaluation and boundaries, not specific API names or a universal quality/cost claim. Report local deterministic fixtures as contract tests, not evidence that cheap models match reasoning models. No production router is trained or benchmark claim established by this document.

## 10. Implementation sequence after separate approval

| Slice | Scope | Required completion evidence |
| --- | --- | --- |
| 14A.1 | Pin unchanged public/default traces; add optional config/types and pure selector validation/resolution. | Legacy ESM/CJS consumer fixtures; no new default prompt/tool/call; unknown names, malformed config, exception/timeout/cancel and late-result tests. |
| 14A.2 | Execution binding and one-preparation integration for managed run/stream. | Real Agent/context/provider mock integration; selected capacity/schema/reasoning/data-handling checks; no mutation of public defaults; no double compaction/dispatch. |
| 14A.3 | Native/state portability guards, phase stickiness and async-origin ownership. | Cross-provider/account denial, exact native binding, continuation/nested signatures, pending tool/evidence, resumed batch, scope-race and save/load tests. |
| 14A.4 | ModelTask usage, diagnostics, examples, AMOS and public documentation. | Root ledger attribution, conservative pricing/cancellation/repair, deterministic demo, bounded live pilot and all repository gates. |
| 14B design gate | Freeze bounded orchestration types and scoped evidence/workspace/child-reservation contract using 14A experience. | Separate API approval; no unapproved runtime changes. |
| 14B delivery | Authority-safe worker admission, root/child budgets, lifecycle, results and merge, then examples/AMOS/docs. | Separate extensive compatibility/failure/concurrency/security tests and single-agent comparison before claiming Stage 14B complete. |

No slice is a reason to skip the next required validation layer. Finish the approved scope before recommending another stage.

## 11. Tests, examples and quality gates

**14A regression matrix:** Default-only and fast/default/explicit specialist routes; missing/ambiguous hints; inaccurate model confidence not used as a label; optional phase pin and explicit escalation; same phase in different ModelTasks/users/Agents; task cancellation/deadline during selection and dispatch; thrown, malformed, never-settling and late selectors; sync timeout limits; fallback only for its documented cases; explicit invalid route and forbidden transfer never masked.

**Context/provider matrix:** Real managed run and stream with custom plugins, legacy strategies, tool catalog, task state, evidence, algorithmic/structured/native compaction and a smaller target window. Check exact connected tool groups, attachments, pending async results, original native ownership, nested signed items, final request-listener mutation, provider discovery/counting cancellation, stale scope, JSON repair and existing no-repeat protections. Include unsupported native state/capabilities and injected providers. No preflight failure may transfer protected history to a different target.

**Accounting/lifecycle matrix:** Correct connector/model on every main/helper/native/transport attempt; root limits and unknown prices; capacity reservations rather than optimistic prompt estimates; billed failures and cancellation; no selector model invocation; no cross-route repair or retry; getter/response/stream diagnostics agreement; temporary provider cleanup and Agent destruction; old context/definition/settings loading without policy restoration. Compare default traces and exact runtime identity invariants with routing omitted.

**14B matrix after its own approval:** Child/parent concurrent reservations and cancellation, tool/identity/catalog/connector permission subsets, filtered evidence/list/search/prompt/workspace access, malicious packet authority fields, bounded expansion/output, task dedup/conflict, persistent-worker scope narrowing, every orchestration control path, conflicting claims, revision conflicts, late completion/destruction and sequential tasks where no child is admitted.

Planned example filenames (do not link as shipped files):

- `examples/adaptive-model-routing.ts`: deterministic offline provider fixtures showing default, automatic cheap route, explicit next-step escalation, phase stickiness, native-state rejection and exact ledger/diagnostics. Opt-in live modes for OpenAI/Anthropic/Google portable-state contracts using named connectors and current supported models. Explicit call limits, cleanup and expected output.
- `examples/routing-with-context.ts`: existing plugins and compaction preserved while a selected model changes capacity; a protected incompatible native continuation fails before transfer. Offline first; optional live mode.
- `examples/bounded-specialist-task.ts`: 14B-only; two separable workers, scoped evidence/workspace, shared root budget and one host-verified merge. Include an ordinary sequential workload that stays single-agent.

Run the full relevant offline suite, build, typecheck, lint, examples checks, Stage 00 built-package compatibility/evaluation and AMOS adapters. After approval and implementation, run required live provider contracts using `.env` without exposing keys. A provider unavailable in a run is an unresolved validation gap, not a passing test or a reason to claim completion.

For quality/cost claims, use a held-out workload separate from rule tuning. Compare fixed main, fixed cheap and routing on identical task/tool fixtures with actual completion/constraint/evidence predicates. Record success and false-success rates, main/router/helper/verifier/repair/compaction usage, total estimated cost with unknowns, wall time and routing overhead. Predeclare acceptable quality loss and a cost or latency target for that workload before tuning; reject unsupported claims. Do not make a launch default or promotion decision from a small functional live pilot. 14B adds a single-agent baseline and all coordination/merge overhead.

## 12. AMOS and documentation handoff

14A: opt-in declarative named routes using existing configured provider connections; keep current model selection as the default route. Start with host command/configuration of task type/phase and explicit route choice; do not insert an automatic classifier into ordinary chat. Show configured default separately from selected execution connector/model, reason/fallback/stickiness, state incompatibility and task usage. Native-state settings changes must preflight before replacing active state. Test settings migration, route resolution, run/stream display, cancellation, rejected transitions and offline transcripts.

14B: opt-in bounded worker configuration, task status, admitted scopes, budgets and verified-versus-claimed results. Multiple available models alone must not cause worker creation.

During delivery update README, User Guide, generated API reference, AGENTS, model-task/context/native/loop guides where affected, examples index, AMOS docs/help/tests, Changelog, package documentation inventory, roadmap and Version 2 availability/adoption/handoff. Regenerate API docs from implemented exports; do not hand-add speculative signatures. A dedicated routing recipe belongs in public usage documentation only after signatures and examples are verified.

## 13. Approval checkpoint

Proposed approval is **14A only**: optional named routes under `modelExecution.routing`; bounded host selector; explicit per-run routing/opt-out; optional phase pin; one execution-scoped binding; fail-closed portability/scope/capability checks; existing shared budgets; additive diagnostics; tests/examples/AMOS/docs and bounded live validation as specified above.

The user approved the 14A scope and API by replying “proceed” on 2026-10-22. 14B remains a separately reviewed companion design; learned routing, automatic cross-model replay, mid-run switching and distributed scheduling remain deferred. No public API break or package release is approved.

## 14. Historical design validation record

Reviewed the current Agent/BaseAgent, managed request preparation, native binding, helper/task types, model metadata, orchestrator worker factory/tool path and Agent Runtime override capabilities. Rechecked the three primary research abstracts linked above. The design review removed a mandatory placeholder selector, avoided expanding existing closed unions, kept runtime defaults distinct from the selected binding, and corrected a draft reference to a nonexistent per-run output-cap option.

Before implementation approval, documentation verification passed **405 local links/anchors**, **five TypeScript snippet syntax checks**, and a **strict hypothetical 14A consumer check against existing built public types**. That consumer check declares the proposed extensions locally; it checks internal consistency and reuse of existing types, not availability of a new export. Whitespace checks pass. At that historical design checkpoint, no runtime code or generated docs changed and no live tests ran. The subsequent approved 14A delivery is recorded separately in [the implementation record](STAGE_14A_IMPLEMENTATION.md) and [validation evidence](../evaluations/STAGE_14A_VALIDATION.json).
