# Distributed Agent Execution

This document defines how one effective OneRingAI agent moves between a trusted
server and a desktop or browser client without introducing a second agent loop.
It covers text, OpenAI Realtime voice, remote tools, telephony, and context
restoration.

## Core rule

For native OneRingAI execution, exactly one OneRingAI `Agent` owns each model session. A server and a desktop may
both use OneRingAI, but they do not concurrently drive the same model session.

| Interface | Agent owner | Model path |
|---|---|---|
| Server text | Server | Server connector |
| Browser Realtime voice | Server | Direct WebRTC media plus server sideband |
| Telephony | Server | Telephony adapter plus Realtime or STT/TTS pipeline |
| Desktop text | Desktop main process | Host-provided connector or authenticated proxy |
| Desktop Realtime voice | Desktop main process | Direct WebRTC media through a browser peer |

The host remains responsible for catalog persistence, authentication,
authorization, tenant resolution, connector visibility, and deciding whether a
tool executes locally or remotely. OneRingAI owns the executable package,
hydration, Agent lifecycle, tool proxy behavior, Realtime events, and transport
interfaces.

## Portable agent package

`exportAgentPackage(agent)` creates a versioned, JSON-serializable snapshot of
an already-resolved Agent. The package contains:

- logical connector name and model, never connector credentials;
- the unrendered instruction template and portable runtime options;
- context feature flags, plugin names, and serialized state;
- enabled tool definitions with `local` or `remote` placement, a
  placement-appropriate compatibility fingerprint, and optional informational
  permission metadata;
- an optional provider-neutral Realtime profile;
- package ID, protocol version, revision, expiry, and host metadata.

It deliberately excludes trusted runtime identity, connector/model authority,
permission-policy authority, arbitrary `vendorOptions`, provider-hosted `nativeTools`,
prompt-cache policy, data-handling policy, and open-ended Realtime session
configuration. Those fields can contain authorization data or change where
data is processed and retained. The receiving host supplies `userId`, an
explicitly authorized connector and model, permissions, identities, executable
tools, `contextFactory`, and trusted provider-local policy while calling
`hydrateAgentPackage()`.

This package is an execution snapshot. It is not an authorization token, agent
catalog, database document, credential store, or security boundary. A client
that receives a package can inspect or modify it. Remote services must continue
to authorize every request from trusted host context.

### Context plugins

OneRingAI serializes plugin state, not executable plugin factories or external
storage dependencies. The receiving runtime must provide a trusted
`contextFactory` for every package. Package feature flags and plugin names are
compatibility hints only: they never activate plugins or select tool scopes.
The host factory owns feature flags, plugin dependencies, `toolCategories`, and
all other context policy. OneRingAI validates that all package plugin names
exist before restoring state.

Plugin-owned executable tools are not written into the package. The receiving
context recreates them against its own restored plugin state, preventing a
remote proxy from overwriting `store_*` or another plugin-local function.
Hydration checks the complete trusted tool set before registering package
tools. A portable tool that collides with a context, identity, or other
host-installed tool rejects the package rather than replacing trusted
behavior.

Plugin state is application data and may be private, but it must never be used
as credential storage. A custom plugin that currently serializes a key or token
must keep that dependency host-local and resolve it again in `contextFactory`.

Applications may instead materialize server-only context into ordinary
instructions or in-context memory before export. Do not silently enable a
plugin without its dependencies.

### Tools

Executable functions never cross the wire:

- `local` tools are resolved by `localToolResolver` in the receiving runtime;
- `remote` tools become normal `ToolFunction` proxies backed by
  `RemoteToolTransport`;
- omitted tools are not exported.

Hydration compares every local resolver's implementation fingerprint with the
package descriptor before registering the tool. A matching name and schema are
not enough. Custom local tools must receive an explicit fingerprint from the
exporting application and return it through `ResolvedLocalTool` in the
receiving host. Generated built-ins derive the fingerprint from the tool
definition, source file, and complete non-generated OneRingAI runtime source;
paths and line endings are canonicalized so equivalent cross-platform builds
agree. Fingerprints follow JSON-wire semantics, and dynamic function
descriptions are excluded from the local executable contract because each host
regenerates them from trusted context. Changes to the callable schema or
execution metadata still fail closed.

Remote descriptors carry a fingerprint of their complete canonical definition.
Package validation recomputes it before hydration or tool-server construction,
detecting inconsistent wire data. This unkeyed consistency check is not a
signature and does not make the editable package an authority boundary.
Packaged permission metadata is likewise never authoritative:
`toolPermissionResolver` must return the receiving host's trusted policy, or
the tool is registered without the packaged policy.

Protocol version 2 is intentionally exact and incompatible with version 1 for
both packages and remote-tool DTOs. Applications must deploy exporting and
receiving runtimes as a coordinated pair, or drain version 1 sessions before
routing traffic to version 2. A tool-server session never bridges versions.

`AgentPackageToolServer` owns the server-side tool execution lifecycle. It
allows only tools marked `remote` in its package and executes them through the
Agent external-execution path, preserving tool limits, hooks, approval,
permissions, metrics, and cancellation semantics. Request IDs are idempotent
for the bounded server-session lifetime: an exact retry receives the same
in-flight/completed response, while reuse for different arguments is rejected.

The host transport authenticates and authorizes each request before passing it
to `AgentPackageToolServer.execute()`. Client-supplied tenant, actor, connector,
or ACL fields must never be accepted as trusted input.

Remote requests and responses use exact, branch-specific JSON DTOs. Unknown
fields and values that cannot survive a JSON wire round trip are rejected
before execution. Arguments and successful results are each limited to
1,000,000 UTF-8 bytes, and one server session admits at most 1,000 distinct
request IDs. Closing a tool server is a shared asynchronous operation:
concurrent callers all wait for the same in-flight execution drain.

## Desktop text flow

1. The server authenticates the user and resolves the effective agent.
2. The server exports a short-lived `SerializedAgentPackage`.
3. Desktop main maps the package hints to an explicitly authorized local
   connector and model and supplies the host-owned permission policy. The
   connector may use the host's authenticated LLM proxy.
4. Desktop main resolves local tools and installs a `RemoteToolTransport` for
   session-bound server tools.
5. `hydrateAgentPackage()` creates the desktop Agent and restores context.
6. The desktop Agent owns `run()`, `stream()`, tools, compaction, and metrics.
7. Logout, tenant change, expiry, or session end destroys the Agent and closes
   the remote tool session.

## Desktop OpenAI Realtime flow

OpenAI recommends WebRTC for browser and client media. The unified setup flow
allows a trusted server to submit the browser SDP offer and session
configuration using the standard provider connector. The client receives the
SDP answer and opaque call ID, but no provider credentials; media then flows
directly between the browser peer and OpenAI.

1. Desktop main hydrates the Agent package with
   `executionProfile: 'realtime'`. The package's Realtime connector and model
   are hints; the trusted host resolver selects the authorized connector and
   model while preserving the same prompt, tools, context, and limits.
2. The renderer creates `OpenAIRealtimeWebRTCPeer` from the browser-safe
   `@everworker/oneringai/realtime-browser` export.
3. The renderer obtains microphone permission, adds the audio track, and creates
   the `oai-events` data channel.
4. A narrow host callback sends the SDP offer to the authenticated server.
5. Server `OpenAIRealtimeAPI.createWebRTCCallWithMetadata()` resolves the
   provider connector and returns `{ sdp, callId }`. The backward-compatible
   `createWebRTCCall()` continues to return only the SDP string.
6. The renderer applies the SDP answer. Audio flows directly to OpenAI.
7. A typed renderer/main bridge exposes the data channel as
   `RealtimeMessageChannel`.
8. Desktop main wraps it in `OpenAIRealtimeChannelTransport` and starts
   `OpenAIRealtimeAgentSession` with the hydrated Agent.
9. OneRingAI main handles context refresh, transcripts, tools, MCP approval,
   usage, cancellation, and lifecycle. The renderer only owns media and forwards
   Realtime messages.

The SDP callback receives the setup `AbortSignal` and must return both a
non-empty SDP answer and call ID. Configure `releaseCall(callId)` to invoke the
trusted server's hangup command. `closeAndRelease()` waits for that cleanup;
partial setup and terminal peer failure also release exactly once. The browser
peer retains a bounded, ordered event backlog until a channel bridge attaches;
the channel transport retains that backlog until `connect()` has consumers.
This prevents creation, transcript, tool, response, error, and usage events
from being lost during the renderer/main attachment gap. Each layer defaults
to 256 events and 1 MiB; exceeding either bound fails or closes the session
rather than discarding an older ordered event.

No standard provider key is sent to the renderer. A deployment may choose an
ephemeral client secret instead, but connector credentials remain outside the
portable package.

### Provider-session rollover

OpenAI Realtime sessions have a hard lifetime, while the logical OneRingAI Agent
may continue. On `session:expiring`, the Agent owner must finish or cancel the
active response, close the old `OpenAIRealtimeAgentSession`, call
`agent.rolloverContext({ reason: 'realtime-session-expiring' })`, and only then
create the replacement provider session. Execution ownership rejects rollover
while the old Realtime session still owns the Agent.

The explicit rollover is not threshold-gated compaction. It summarizes the
older conversation prefix, preserves the eight most-recent user turns and all
of their tool pairs exactly, retains provider-opaque compaction items, leaves
context-plugin state unchanged, and does not rewrite the append-only history
journal. The replacement Realtime session obtains the continuity brief, exact
tail, current instructions, tools, and plugin contents from the same Agent's
normal context preparation path.

By default the Agent uses a tool-free direct call through its configured
connector/model. A desktop host whose Realtime model cannot perform ordinary
text generation supplies the `summarize` callback and may route that one call
through its authenticated LLM proxy or a separate trusted text Agent. The
callback receives only a detached copy of the older prefix. The live context is
committed only after a non-empty summary succeeds; configured session storage
is checkpointed before `rolloverContext()` resolves.

Official protocol references:

- [OpenAI Realtime WebRTC](https://developers.openai.com/api/docs/guides/realtime-webrtc)
- [OpenAI Realtime server controls](https://developers.openai.com/api/docs/guides/realtime-server-controls)
- [OpenAI Realtime create call](https://developers.openai.com/api/reference/typescript/resources/realtime/subresources/calls/methods/create)

## Browser server-owned Realtime flow

For a browser product whose tools and context remain server-owned, the browser
still uses direct WebRTC media. The server keeps the Agent and attaches an
`OpenAIRealtimeAgentSession({ agent, callId })` sideband WebSocket using the
`callId` returned by `createWebRTCCallWithMetadata()`. The Agent session then
drives tools and context from the server. Because this sideband joins an
already-created provider session, connection readiness is established by an
acknowledged `session.update`; it does not wait for `session.created` to be
replayed.

This differs from desktop-local execution only in Agent ownership. The browser
WebRTC peer and SDP setup remain the same.

## Telephony

`VoiceBridge` accepts either a static `agent` configuration or an asynchronous
`agentFactory(session)`. The factory must return a new Agent for every call.
`VoiceSession` owns and destroys that Agent. Factory failures end and hang up
the pre-connect call rather than leaving a ringing session behind.

Use the factory when the host must resolve caller-specific authorization,
identities, tools, instructions, memory, or context plugins.

## Protocol compatibility and failure behavior

- `AGENT_PACKAGE_PROTOCOL_VERSION` versions both packages and remote tool DTOs.
- Incompatible or expired packages fail before Agent creation.
- Missing connector, plugin, local tool, or remote transport dependencies fail
  closed.
- Portable tool names cannot replace tools installed by trusted host context or
  identity policy.
- WebRTC setup closes tracks, peer connections, data channels, and Agent
  sessions after partial failure and releases a created provider call.
- Explicit WebRTC shutdown and concurrent `closeAndRelease()` callers wait for
  the same provider-release promise.
- Cross-package and non-allowlisted remote tool calls are rejected.
- Remote DTOs reject unexpected fields, non-JSON values, and oversized
  arguments or results.
- Remote errors expose bounded codes and safe messages, never internal stacks or
  credentials.
- Provider usage is authoritative. Client-reported metrics are observational.

## Non-goals

- OneRingAI does not define application tenant or role semantics.
- The package does not grant access to a connector or remote tool.
- The browser peer does not persist audio or transcripts.
- `RuntimeAgentSpec` remains the agent-runtime execution descriptor and is not
  reused as this portable native-Agent snapshot.


Harness expansion ownership: a definition-mode external runtime owns its own native conversation. It does not hydrate a native OneRingAI Agent checkpoint or restore C3/ModelTask authority. Host tools retain the original ToolManager/evidence owner. See [runtime delivery](AGENT_HARNESS_DELIVERY_LEDGER.md). Existing portable v2 semantics are unchanged.


Runtime H3 control records and their input/outcome outbox are separate from native portable v2 snapshots, evidence records and worker transport. They preserve native session identity under renewed host authorization; they never grant C3/ModelTask authority. Active local native work cannot be resumed by replaying its original input. Single-host file ownership is not a distributed worker lease.


Managed runtime observation is independent from execution ownership. Optional driver observationIndependent prevents native cancellation solely because a service-owned stream disconnected. Restoring its observer uses the same native session/input epoch and scoped control/outcome records. Native portable v2 and single-Agent composition ownership remain unchanged.


## External harness desktop ownership (H6)

For `agent-runtime` external bindings, the native harness owns its loop/history;
the desktop main process owns the observer, named Connector and selected host
ToolManager. It does not hydrate a second native `Agent` merely to drive an SDK.
An explicitly selected Agent tool owner may supply C7 external lifecycle hooks,
but a session reference never restores workflow/ModelTask authority.

Keep trusted scope, binding selection, SDK/bootstrap code, control files and transfer
roots in the main process. Renderer IPC receives bounded activity/result DTOs and
an application locator; it cannot assert native resource ownership or supply a
connector account. Reauthorize run/cancel/detach/resume/delete/transfer independently.
Control traffic differs from sandbox egress and native artifact URLs are not fetch
authority. File operations are explicit and bounded, never automatic prompt uploads.

The main process can detach managed observation without cancelling native work.
After restart it restores the same recorded binding and original run, with activity
gaps visible; uncertain input/actions are reconciled rather than submitted again.
Use [the canonical desktop/AMOS recipe](../../USER_GUIDE.md#desktop-and-amos-integration)
and [AMOS runtime mode](../../apps/amos/README.md#agent-runtime-mode). This delivery
adds no remote backend, IPC server, or changes to an unrelated desktop app.
