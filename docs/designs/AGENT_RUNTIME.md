# Vendor-Neutral Agent Runtime

**Status:** H0–H6 implemented on branch with offline validation; live vendor verification and release pending

**Date:** 2026-08-22; harness expansion updated 2026-10-28

**Implemented drivers:** native OneRingAI, local Codex/Claude SDKs, OpenAI managed Agents API and Claude Managed Agents API

**Designed extensions:** Codex App Server, other harnesses, isolated server workers and A2A interoperability

**Public documentation:** [README overview](../../README.md#agent-runtime-run-complete-agents-through-one-api),
[detailed User Guide](../../USER_GUIDE.md#agent-runtime-preview), and
[runnable local example](../../examples/agent-runtime-local.ts)

## Decision

OneRingAI exposes an `agent-runtime` API above its existing `Agent` API. This API
runs complete agent harnesses—systems that own an agent loop, tools, context,
sessions, and possibly a workspace—rather than pretending they are text-model
providers.

The runtime has two independent extension points:

1. An **agent driver** adapts OneRingAI, Codex, Claude, a hosted agent, or a remote
   A2A agent to the generic session/run contract.
2. An **execution backend** decides where that driver executes: the current Node.js
   process, a future isolated worker, or a remote runtime service.

The implemented local preview contains:

- immutable runtime specifications;
- capability inspection and preflight;
- session and run lifecycles;
- model and reasoning selection at agent and per-run scope;
- live, sequence-numbered, bounded event observation;
- cancellation, limits, structured results, and explicit errors;
- a trusted in-process local backend;
- five interchangeable harness drivers, scoped host tools and explicit managed transfers;
- optional same-host acknowledged control storage and native checkpoint reconciliation;
- deterministic unit coverage and credential-gated live integration tests.

The local backend executes adapters in the trusted host process; managed harnesses run
remotely at the vendor. Durable control/native restore are explicitly capability-bound,
not durable event replay. Server control planes, containers, Codex App Server, A2A,
interactive approvals, user input and steering remain deferred. The approved
[harness design](AGENT_HARNESS_EXPANSION.md) and [delivery ledger](AGENT_HARNESS_DELIVERY_LEDGER.md)
record current contracts and validation; the User Guide owns usage recipes.

## Documentation contract

The agentic layer is a first-class public capability and must remain discoverable at
three levels:

1. The README gives a brief product-level explanation, current driver/support matrix,
   minimal API shape, and direct links onward.
2. The User Guide is the canonical usage document for choosing the right surface,
   installing optional drivers, configuring sources/model/reasoning, opening sessions,
   observing events, inspecting capabilities, and cleaning up resources.
3. This design document owns architecture, invariants, threat boundaries, rejected
   alternatives, and the separately approved server/App Server/Claude/A2A roadmap.

The runnable `examples/agent-runtime-local.ts` example must stay aligned with the User
Guide. Public type signatures remain authoritative in the exported declarations and
tests; generated API references must be regenerated rather than edited by hand.

Terminology in all entry points is intentionally consistent:

- **Agent Runtime** is the public layer above complete agent harnesses.
- **Agent driver** adapts native agent semantics without replacing the native loop.
- **Execution backend** decides placement and isolation.
- **Live observation** is independent from approvals and steering.
- **Local preview** means trusted same-host execution, never multi-tenant isolation.

## Final product semantics

“Interactive” is too ambiguous to be a mode name. The runtime models three separate
axes:

| Axis | Choices | Meaning |
|---|---|---|
| Execution | autonomous or approval-gated | Whether native work proceeds within pre-authorized policy or pauses for a decision |
| Observation | live or final-only | Whether the caller receives ongoing activity or only essential/final events |
| Intervention | observe-only or steerable | Whether the caller may change a running turn |

These axes are independent. A fully autonomous run is observable by default. A user
does not need to approve or intervene in order to see progress.

The local preview implements **autonomous + live + observe-only** for both drivers:

- `policy.approvals: 'deny'` means no approval bridge is available;
- `observation` defaults to `{ mode: 'live', detail: 'reasoning' }`;
- `controlMode` defaults to `'observe-only'`;
- requesting interactive approvals or steerable control fails preflight.

Future drivers may add approval-gated execution and steering independently. For
example, a future Codex App Server driver can expose bidirectional approval and user
input without changing how autonomous callers subscribe to events.

### What “reasoning visibility” promises

`detail: 'reasoning'` publishes every reasoning event the selected driver and model
make available for application display. It does not promise hidden chain-of-thought.
Vendors may expose reasoning summaries, selected reasoning text, or no reasoning
events at all. Capability inspection reports the driver's support and constraints.

This is the same observability principle used for messages, plans, command output,
file changes, and tool progress: normalize useful vendor-exposed activity, do not
invent private or unavailable data.

## Architectural invariants

- Agent drivers are not `ITextProvider` implementations.
- Execution placement is not encoded in a driver.
- The existing `Agent`, `StoredAgentDefinition`, context plugins, and `ToolManager`
  remain unchanged.
- `RuntimeAgentSpec` is an execution descriptor, not a second authoritative agent
  catalog or credential store.
- Named `Connector`s remain the only source of authentication.
- Capabilities are negotiated; unsupported requirements fail before native work.
- A session has at most one active mutating run.
- The backend owns the native event pump. Completion never depends on an application
  consuming the event stream.
- Observation filtering never controls execution and never gates approvals.
- The local backend is trusted developer infrastructure, not tenant isolation.
- A future server leases isolation to active work, with optional warm session
  affinity; a logical session does not inherently require a permanent VM.
- A2A belongs at external interoperability boundaries, not between an internal
  control plane and its workers.

## Why this layer belongs above `Agent`

OneRingAI already has a complete agent harness: connectors, tools, context plugins,
memory, permissions, persistence, and orchestration. Codex and Claude agent SDKs
operate at that same level. They have their own loops, built-in tools, sessions,
workspace assumptions, and approval models.

Putting Codex behind `ITextProvider` would create competing loops and tool systems.
Wrapping it only as one large tool is useful for delegation, but loses first-class
sessions, native events, cancellation, artifacts, and interaction. The runtime keeps
each harness intact and normalizes the boundary above it.

```text
Application / workflow / orchestrator
                 |
          AgentRuntime API
                 |
       AgentExecutionBackend
          /             \
   Local backend     Future remote backend
          |                 |
     Driver registry   Isolated execution lease
     /     |     \           |
OneRingAI Codex future     same driver contract
```

For a OneRingAI-native agent, `agent.tools === agent.context.tools` remains true. An
external driver owns its native tool pipeline; the runtime does not create a shadow
`ToolManager`.

## Vendor constraints

### OpenAI Codex TypeScript SDK

The SDK launches and communicates with a local Codex CLI process. It supports
threads, streamed turns, structured output, image input, workspace/sandbox options,
and `AbortSignal` cancellation. It also streams useful autonomous activity including
agent messages, reasoning summaries, plans, commands, command output, file changes,
and tool lifecycle events.

Consequences:

- there is no hosted Codex SDK server supplied for the application;
- the process running the driver must install the SDK/CLI and supervise it;
- the SDK is sufficient for the local observable-autonomous PoC;
- a native thread ID is not a portable checkpoint by itself;
- the child gets a deliberately constructed environment, not all server secrets;
- the SDK does not provide the complete bidirectional control surface required for
  generic approvals, user questions, and steering, so those remain unsupported.

### Codex App Server

Codex App Server is a separate local process started and supervised by the host with
`codex app-server`. It is not a dedicated hosted instance provisioned by OpenAI for
each application. It exposes a richer client protocol and streams fine-grained
thread items. It is the appropriate future Codex driver when OneRingAI needs native
approval requests, user-input requests, or richer steering/control.

App Server is not required merely to watch an autonomous Codex run: the SDK already
provides live activity. The future `openai.codex.app-server` driver may share event
mapping helpers with `openai.codex.sdk`, but remains a separate driver with different
process-supervision and capability contracts.

### Claude and other agent SDKs

Claude Agent SDK concepts—sessions, streaming, permissions, hooks, subagents, MCP,
and bidirectional interactions—fit the session/run model. Differences are represented
through capabilities and constraints rather than vendor fields on the generic API.
Any future driver must use supported API authentication and must not reuse an
interactive consumer login silently.

A hosted agent service is also a driver, not an execution backend. The driver adapts
the service's agent API; the backend places the adapter code.

### A2A

A2A is useful for discovery and communication across a network trust boundary. It
defines tasks, messages, artifacts, streaming, and cancellation, but not worker
scheduling, workspace mounts, credential leases, native checkpoints, or the runtime's
full activity event fidelity.

Future A2A support should therefore be:

- an outbound `a2a.remote` driver; and
- an inbound adapter that exposes selected runtime agents as A2A agents.

It should not replace the internal backend-to-worker protocol.

## Public domain model

### Runtime specification

`RuntimeAgentSpec` is cloned and frozen when `runtime.agent()` is called. It contains
no secrets or live objects.

```ts
interface RuntimeAgentSpec {
  id: string;
  name?: string;
  driver: string;
  connector?: string;
  model?: string;
  reasoning?: RuntimeReasoningConfig;
  instructions?: string;
  driverConfig?: JsonObject;
  requiredCapabilities?: AgentCapabilityRequirement[];
  metadata?: JsonObject;
}

interface RuntimeReasoningConfig {
  enabled?: boolean;
  effort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra';
  budgetTokens?: number;
}
```

`model` and `reasoning` are generic fields, not vendor driver configuration. A driver
validates the selected model and maps only reasoning fields it can verify.
Unsupported efforts, disabled reasoning, or token budgets fail explicitly; they are
never silently ignored.

The Codex SDK driver requires a named OpenAI API-key connector and an active model in
the OneRingAI registry. Explicit Codex reasoning efforts fail closed unless the
model/effort pair is in the driver's verified map; applications may extend that map
with `CodexSdkDriver({ modelReasoningEfforts })` when adopting a newly documented
model. Known non-reasoning models reject reasoning configuration before native work.
The OneRingAI driver obtains connector/instructions from its native source but permits
model and reasoning selection through the generic fields. It has a bundled verified
control map for the supported Codex models. New or custom models may be enabled with
`OneRingAIDriver({ modelReasoningControls })`, whose entries separately declare
accepted efforts, native disable support, and fixed-budget support. Explicit controls
without a verified mapping fail preflight. Known models are also validated against the
source connector's vendor and reasoning capability. Unknown model IDs remain possible
for custom or newly deployed OneRingAI providers when the host supplies their verified
control metadata.

`StoredAgentDefinition` remains OneRingAI-specific and unchanged. If a runtime catalog
is needed later, it will persist runtime specs separately without replacing native
definitions or connectors.

### OneRingAI local sources

The native driver accepts one of:

```ts
type OneRingAgentSource =
  | { type: 'stored-definition'; agentId: string }
  | { type: 'binding'; name: string }
  | { type: 'factory'; name: string };
```

Bindings are borrowed by default and are never destroyed by the runtime. Owned
bindings and factory/stored agents are destroyed with their sessions. A bound agent
may back only one runtime session at a time so its context is not shared accidentally.
Trusted scope is checked against its `userId`.

An application-supplied OneRingAI agent can contain arbitrary tools. The driver cannot
infer that those tools obey a generic filesystem/network policy. If a policy is
supplied, the host must construct the driver with `trustAgentPolicy: true`, explicitly
asserting that the agent's tools and `PermissionPolicyManager` enforce it. Without
that assertion, session preflight fails.

### Main interfaces

```ts
class AgentRuntime {
  constructor(options: {
    backend: AgentExecutionBackend;
    backendOwnership?: 'owned' | 'borrowed';
  });
  agent(spec: RuntimeAgentSpec): RuntimeAgent;
  destroy(): Promise<void>;
}

interface RuntimeAgent {
  readonly spec: Readonly<RuntimeAgentSpec>;
  inspect(request?: AgentInspectionRequest): Promise<ResolvedAgentCapabilities>;
  openSession(options: OpenAgentSessionOptions): Promise<AgentSession>;
}

interface AgentSession {
  readonly id: string;
  readonly agentId: string;
  readonly capabilities: ResolvedAgentCapabilities;
  readonly state: AgentSessionState;
  run(input: AgentRunInput, options?: AgentRunOptions): Promise<AgentRun>;
  cancelActiveRun(reason?: string): Promise<void>;
  destroy(): Promise<void>;
}

interface AgentRun {
  readonly id: string;
  readonly sessionId: string;
  readonly result: Promise<AgentRunResult>;
  events(options?: { afterSequence?: number }): AsyncIterable<AgentRunEvent>;
  cancel(reason?: string): Promise<void>;
  steer(input: AgentRunInput): Promise<void>;
  respondToInteraction(id: string, response: AgentInteractionResponse): Promise<void>;
}
```

`steer()` and `respondToInteraction()` are stable capability-gated methods. Current
drivers report them unsupported; calls fail with a typed capability
error. This permits future bidirectional drivers without equating event streaming
with intervention.

### Session options

```ts
interface OpenAgentSessionOptions {
  context: TrustedRuntimeContext;
  workspace?: WorkspaceRequest;
  policy: AgentExecutionPolicy;
  observation?: {
    mode?: 'live' | 'final-only';
    detail?: 'status' | 'activity' | 'reasoning';
  };
  controlMode?: 'observe-only' | 'steerable';
  requiredCapabilities?: AgentCapabilityRequirement[];
  metadata?: JsonObject;
}
```

Observation behavior:

- `live/reasoning` is the default and includes all normalized events;
- `live/activity` suppresses reasoning events while preserving visible work;
- `live/status` publishes essential/final state only;
- `final-only` publishes essential/final state only regardless of detail;
- native events are always pumped internally, so filtering cannot stall work.

`controlMode: 'steerable'` automatically requires `run.steer` during preflight.
Approval behavior remains in execution policy because it grants authority to pause
and ask for decisions; it is unrelated to observation detail.

### Run options

```ts
interface AgentRunOptions {
  signal?: AbortSignal;
  model?: string;
  reasoning?: RuntimeReasoningConfig;
  responseFormat?: RuntimeResponseFormat;
  metadata?: JsonObject;
}
```

Per-run `model` and `reasoning` override the spec defaults only for that turn and
require `run.model_override` or `run.reasoning_override`. They do not mutate the
runtime spec. Effective configuration is included in `run.started`, resolved
capabilities, and `AgentRunResult.configuration` so applications can display and
audit what actually ran.

Selecting a JSON Schema response format automatically requires
`run.structured_output`. Supplying a `workspace-file` image automatically requires
`input.image`. The backend enforces these feature gates even when the caller did not
repeat them in `requiredCapabilities`.

For OneRingAI, the driver temporarily applies the run model and restores the prior
model afterward. `Agent.setModel()` synchronizes the managed context model and its
registry-derived context window while preserving an explicitly configured
`maxContextTokens` override. The driver passes generic reasoning through
`Agent.stream` as `thinking`. For Codex, each turn starts or resumes its SDK thread
with the effective model and `modelReasoningEffort`.

### Capability model

Support is `native`, `emulated`, or `unsupported`. Required capabilities are checked
before native execution. `minimum: 'native'` rejects emulation.

Initial capability IDs are:

| Category | IDs |
|---|---|
| Session | `session.continue`, `session.restore` |
| Run | `run.cancel`, `run.structured_output`, `run.model_override`, `run.reasoning_override` |
| Interaction | `run.interaction`, `run.approval`, `run.user_input`, `run.steer` |
| Input | `input.image` |
| Events | `event.live`, `event.message`, `event.reasoning`, `event.plan`, `event.command`, `event.command_output`, `event.file_change`, `event.tool`, `event.tool_progress` |
| Isolation | `isolation.workspace`, `isolation.tenant` |

Capability metadata includes resolved default configuration. Applications must
inspect capabilities instead of guessing support from the driver or model name.

### Policy

```ts
interface AgentExecutionPolicy {
  filesystem: 'denied' | 'read-only' | 'workspace-write';
  commands: 'denied' | 'sandboxed';
  sandboxNetwork: 'denied' | 'allowed';
  providerWebSearch: 'denied' | 'allowed';
  approvals: 'deny' | 'interactive';
  limits?: {
    wallTimeMs?: number;
    eventBufferBytes?: number;
    outputBytes?: number;
    artifactBytes?: number;
  };
}
```

The model-provider connection is distinct from shell/tool egress. Denying
`sandboxNetwork` does not block the trusted control connection to OpenAI; enabling
`providerWebSearch` does not enable shell network access.

`commands: 'denied'` is accepted only when the driver can prevent command execution.
`approvals: 'interactive'` requires a complete driver/backend/caller interaction
bridge. Current drivers reject it. Current autonomous runs use
`approvals: 'deny'`; the Codex SDK maps that to `approvalPolicy: 'never'`.

Trusted tenant/user/group context is derived from host authentication, never model
output. Local IDs are scope metadata, not proof of isolation. The future server must
reauthorize every connector, session, event, artifact, and workspace lookup.

## Events and replay

Every event has runtime/session IDs, a monotonically increasing per-run sequence,
timestamp, type, and bounded JSON data.

```ts
type AgentRunEventType =
  | 'run.started'
  | 'agent.message.delta'
  | 'agent.message.completed'
  | 'reasoning.delta'
  | 'reasoning.completed'
  | 'plan.updated'
  | 'agent.iteration.completed'
  | 'command.started'
  | 'command.output.delta'
  | 'command.completed'
  | 'file.change.started'
  | 'file.changed'
  | 'tool.started'
  | 'tool.progress'
  | 'tool.completed'
  | 'interaction.requested'
  | 'interaction.resolved'
  | 'usage.updated'
  | 'diagnostic'
  | 'run.finished';
```

The backend subscribes to the native stream immediately and records events whether
or not an application subscriber exists. Calling `run.events()` later replays the
retained journal and follows live events. `afterSequence` supports reconnect within
the retained in-process journal. A cursor ahead of the run is invalid; a cursor older
than retained history raises `AgentEventHistoryExpiredError`.

All journal and subscriber buffers are byte-bounded. Incremental deltas/tool progress
are evicted first, then older events if necessary. A retained `EVENTS_DROPPED`
diagnostic reports gaps. Subscriber overflow affects that subscriber only; native
work and `run.result` continue. This is bounded local replay, not durable replay after
a process crash.

`run.result` resolves independently from events and includes status, bounded text,
validated structured output when available, artifacts, usage, effective
configuration, enforcement metadata, and sanitized/bounded native detail. If output,
parsed JSON, or artifacts exceed configured limits, the result becomes `incomplete`
with `finishReason: 'runtime_limit'`.

## Driver behavior

### `oneringai.agent`

- Resolves a stored definition, registered binding, or factory.
- Keeps the native agent's connector, instructions, context, tools, and loop.
- Supports generic spec/per-run model and reasoning selection.
- Streams messages, vendor-exposed reasoning, tool argument progress, tool lifecycle,
  iteration completion, usage, and diagnostics.
- Reports message phase as `unknown` because an output message may belong to an
  intermediate tool-producing iteration rather than the final answer.
- Structured-output runs use that same streamed path and are schema-validated before
  completion, so tools and reasoning remain visible while the final result is checked.
- Supports same-process continuation.
- Reports cancellation and structured output as emulated where native semantics are
  weaker than the generic guarantee.
- Does not claim workspace/tenant isolation, interactive approval, user input, plans,
  command events, file events, or steering.
- Requires the host's explicit `trustAgentPolicy` assertion whenever runtime policy
  is supplied.

### `openai.codex.sdk`

- Requires an explicit local directory, named OpenAI API-key connector, registered
  active OpenAI model, and at least read-only workspace policy.
- Rejects connector organization/project options because the SDK cannot forward them.
- Supports spec and per-run model/reasoning effort selection; unsupported model-effort
  pairs and unverified explicit effort mappings fail before native work.
- Supports native cancellation, structured output, image input, workspace sandboxing,
  and same-process continuation.
- Streams messages, readable reasoning summaries, plans, commands and output, file
  changes, tools, usage, diagnostics, and iteration state.
- The SDK does not identify message phase as commentary versus final; normalized
  message events therefore carry `phase: 'unknown'`.
- Uses a session-owned Codex home, non-login shell policy, a minimal inherited
  environment, command secret exclusions, and streaming/static secret redaction.
- Rejects project `.codex/config.toml` by default and rechecks before every turn.
  `allowProjectConfig: true` is an explicit local-workspace trust decision and remains
  unsuitable as a tenant boundary.
- Uses `approvalPolicy: 'never'`; interaction, steering and tenant isolation remain unsupported.
  Common definitions add authenticated loopback MCP and idle private-state checkpoint
  restoration when native dependencies survive. Active interrupted local input stays unknown.

### Future `openai.codex.app-server`

This driver should reuse the generic lifecycle/event contract while adding capability
support for interactions and possibly steering. It must own protocol initialization,
request IDs, server notifications, turn cancellation, process supervision, and
version compatibility. App Server is still run inside the host's local process domain
or isolated worker; it is not the remote OneRingAI server boundary itself.

### Claude and managed harness drivers

`anthropic.agent.sdk` uses an isolated optional local SDK with selected host tools.
`openai.agents.api` and `anthropic.managed.api` retain vendor-owned loops, native
resource ownership and canonical pending/terminal state. Durable admission/outbox
records are acknowledged before dispatch/delivery; only original receipts can
reconcile effects. `inspectState` separates observer connection from native activity.
See [current setup and support](../../USER_GUIDE.md#agent-runtime-preview).

### Future drivers

Each maps native model/reasoning options, permissions, interactions, sessions, and
events to capabilities. Vendor-specific options belong only in reviewed driver config
when no honest generic field exists. Arbitrary vendor passthrough is prohibited.

## Local lifecycle and safety

Local workspace drivers accept trusted `local-directory` workspaces. Managed drivers
accept only their declared `none`/`provider-managed` placements; no local directory
is implicitly transferred. It resolves the
real path, rejects filesystem roots and traversal, checks requested access, permits
one active run per session, and permits one writer per resolved workspace.

Run startup is reserved synchronously before awaiting native startup, preventing two
concurrent starts. Cancellation and wall-time limits race native startup and native
completion. Cleanup calls are bounded and tolerate synchronous driver failures. After
any post-start error, cancellation, or timeout, the backend requires both the native
result and event pump to reach a terminal state. If termination cannot be confirmed,
the session is failed rather than reused while work may still be running. Its workspace
lease remains quarantined until the backend is destroyed, preventing a different
session from overlapping a possibly live native process.

Runtime/session/driver inputs are cloned and frozen before asynchronous use. Runtime
destruction invalidates existing agent handles even when the backend is borrowed. A
session opened concurrently with destruction or rejected during post-open capability
normalization is cleaned up rather than leaked. Published run events are deeply
cloned and frozen; truncation counters are replacement events rather than mutable
journal records.

The local backend does not isolate mutually untrusted tenants. Codex sandboxing,
environment filtering, and OneRingAI permission policy are defense-in-depth for a
trusted development process, not a claim that hostile code cannot attack the host.

## Future server architecture

The same public API should be projected through a remote execution backend. The
default scheduling unit is an **execution lease for an active run**, not a permanent
VM per agent or per logical session.

The allocator may keep a worker warm and affined to a session for a short idle TTL to
reduce continuation latency. Warm affinity is an optimization, not session identity.
A stronger deployment may dedicate a VM to a tenant for compliance or hostile-code
isolation; that is policy, not a library invariant.

Required server properties:

- one untrusted tenant/workspace per worker at a time;
- exclusive workspace write lease per active run;
- container or microVM isolation selected from an explicit threat model;
- short-lived credential leases or a credential proxy;
- provider credentials inaccessible to agent-executed commands;
- separate provider control traffic and command/tool egress policy;
- externalized/versioned workspace and native checkpoint state where restore is
  advertised;
- lease termination as the ultimate cancellation primitive;
- residue cleanup before worker reuse;
- quotas for concurrency, queue depth, wall time, storage, and spend.

An idle logical session should not hold an expensive worker forever. A driver without
a verified portable checkpoint either remains on a bounded warm worker or reports
that continuation ends when the worker is released. `session.restore` must never be
inferred from the existence of a native thread ID.

The future control plane needs scoped session/run records, idempotency, append-only
durable events, artifact authorization, workspace versions, and compatible driver/
worker-image checkpoint envelopes. It must not automatically replay an ambiguous
agentic run after a crash because commands and file edits are not generally
idempotent.

HTTP/SSE or WebSocket transport belongs in the remote backend. A2A remains a separate
standards-facing adapter.

## Packaging

- `oneringai/agent-runtime` exports the generic runtime, local backend,
  OneRingAI driver, types, and errors.
- `oneringai/agent-runtime/codex` exports the optional Codex SDK driver.
- Codex remains an optional peer dependency and is lazy-loaded.
- Codex SDK types do not leak into the generic declarations.
- Importing the root package or generic runtime works without Codex installed.

## Testing and acceptance

Unit and contract coverage must verify:

- immutable specs, policy, run input, metadata, and published/replayed events;
- preflight for driver config, policy, and required capabilities;
- automatic feature gates for structured output and image input;
- model/reasoning defaults and per-run overrides for both drivers;
- rejection of unsupported reasoning options, disable/budget controls, and
  model-effort pairs;
- live messages/reasoning/activity and observation filtering;
- ordered late subscription, cursor replay, expired history, byte bounds, and
  subscriber overflow;
- completion without an event consumer;
- one active run/session and one writer/workspace;
- cancellation during native startup and execution, synchronous cancellation errors,
  post-start event-pump failures, unconfirmed-termination workspace quarantine,
  wall-time enforcement, and bounded cleanup;
- structured output validation and output/artifact/native bounds;
- secret redaction including fragmented streaming values;
- project-config rechecks and workspace path confinement;
- borrowed/owned lifecycle and runtime destruction races;
- optional dependency behavior and no eager Codex launch.

Credential-gated live tests run both OneRingAI and Codex routes with a real connector,
selected model/reasoning effort, streamed OneRingAI structured output, Codex thread
continuation, event consumption, and teardown. Tests never print keys. Standard
validation is:

```bash
npm run build
npm run typecheck
npm run lint
npm run test:unit
npm run examples:check
```

The harness expansion is accepted when all five declared profiles use the same caller workflow, expose
useful live autonomous activity, support multi-turn sessions, apply model/reasoning
selection, complete without subscribers, cancel/clean up correctly, preserve secrets,
and fail unsupported capabilities honestly.

## Deferred phases requiring separate approval

1. Server threat model, remote backend, queue, worker image, execution leases,
   credential leasing, durable event/replay/checkpoint protocol, and control API.
2. Codex App Server driver with interaction and steering semantics.
3. A2A inbound/outbound adapters.
4. Workflow/orchestrator integrations that schedule runtime agents.

## Rejected alternatives

- **Codex as `ITextProvider`:** loses its higher-level loop and duplicates tool/context
  ownership.
- **Codex only as one OneRingAI tool:** useful delegation option, but hides native
  session/event/control semantics.
- **Vendor-specific public wrapper:** repeats the API for every vendor.
- **App Server required for the PoC:** unnecessary for live autonomous observation;
  it adds protocol/control complexity needed only for richer interaction.
- **A2A as the internal worker protocol:** does not define placement, credentials,
  workspace leases, or native checkpoints.
- **Permanent container/VM per session as a library rule:** wastes idle capacity and
  confuses scheduling policy with runtime identity.
- **Local process as tenant isolation:** not a defensible security boundary.
- **Generic replacement for `StoredAgentDefinition`:** would destabilize a valid
  OneRingAI-native persistence contract without proving value.

## Original preview agreements

Items 9 and 11 below describe the original August preview. H0–H6 extend drivers and
acknowledged control/native recovery; bounded activity replay remains process-local.

1. Add a preview runtime above the existing `Agent` API.
2. Keep drivers independent from execution backends.
3. Preserve native loops and OneRingAI's single-tool-manager invariant.
4. Keep connector authentication and host-derived trusted scope authoritative.
5. Use generic model/reasoning fields at spec and per-run scope for every driver.
6. Make live autonomous observation the default and independent of approvals.
7. Expose all vendor-available reasoning activity without promising hidden
   chain-of-thought.
8. Keep observation, approval behavior, and steering as independent capabilities.
9. Implement only local OneRingAI and Codex SDK drivers in this phase.
10. Use Codex App Server later for richer bidirectional interaction, not merely for
    streaming.
11. Use bounded local replay now; defer durable replay to the server control plane.
12. Use per-active-run isolation leases with optional warm session affinity as the
    default future server model.
13. Keep A2A at external boundaries.
14. Do not claim tenant isolation, durable restore, approvals, user input, or steering
    until an implementation and threat model prove them.

## References

- [OpenAI Codex SDK documentation](https://developers.openai.com/codex/sdk)
- [OpenAI Codex App Server documentation](https://developers.openai.com/codex/app-server)
- [OpenAI Codex TypeScript SDK source](https://github.com/openai/codex/tree/main/sdk/typescript)
- [OpenAI Codex security documentation](https://developers.openai.com/codex/security)
- [Claude Agent SDK overview](https://platform.claude.com/docs/en/agent-sdk/overview)
- [A2A specification](https://a2a-protocol.org/latest/specification/)
- `src/agent-runtime/`


H1 additive definitions use the existing backend/driver/session contracts. Native materialization shares Agent/context tools; external tools retain their original manager/evidence owner. Codex uses a session-authenticated loopback MCP broker. See [delivery status](AGENT_HARNESS_DELIVERY_LEDGER.md) and [user recipes](../../USER_GUIDE.md#reusable-definitions-and-harness-bindings). No live parity claim is made.


H2 implements local Claude via optional SDK 0.3.312 with real in-process MCP raw schemas and synthetic-query coverage. Tools-only policy, isolated config/env, no native delegation/plugins/memory. Cross-process restore and live platform/account validation are not implied. See [setup](../../USER_GUIDE.md#local-claude-agent-sdk).


H3 control ownership: optional scoped IRuntimeSessionStorage (memory or acknowledged single-host file), one writer/revision queue, input admission before dispatch, settled result/outbox before delivery, explicit observation gaps. Existing DriverSession checkpoint/inspectState/detach and AgentDriver restoreSession/deleteSession hooks remain optional. Local restore uses complete context/transcript state only; interrupted local input stays unknown. [Recovery recipes](../../USER_GUIDE.md#runtime-recovery-and-control-storage) and [delivery evidence](AGENT_HARNESS_DELIVERY_LEDGER.md) are canonical.


H4 adds OpenAI managed sessions via official openai SDK: lazy inline-session creation, no-environment/explicit hosted placement, exact host functions, root-turn terminal reconciliation, all-page output recovery, idempotent result delivery and scoped owned deletion. Fixed-first-turn output schema and verified model/effort profiles are explicit limits. Source/wire validation is not live account authorization. See [canonical setup](../../USER_GUIDE.md#openai-managed-agents-api).


H5 implements Claude managed agent/environment/session ownership with pinned versions and explicit native tool denial, actual SDK custom-tool events, epoch-bound input echoes, paginated history and exact idle/interrupt semantics. Managed DriverSession.observationIndependent is optional/additive: observer loss does not itself cancel service-owned work. Per-session model/reasoning, unsupported native schema output and reasoning activity-only signals are explicit capability boundaries. [Canonical recipe](../../USER_GUIDE.md#claude-managed-agents-api).
